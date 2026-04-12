import Stripe from 'stripe';
import { config } from '../config.js';
import { getPool } from '../store/postgres.js';
import { setStripeCustomerId, updateAccountPlan } from './account-service.js';

const FREE_TIER = {
  checkpoint_writes: 10_000,
  storage_gb: 1,
  resume_calls: 5_000,
  replay_calls: 1_000,
};

const PRICES = {
  checkpoint_write: 0.001,    // per write after free tier
  storage_gb: 0.10,           // per GB-month after free tier
  resume: 0.0005,             // per resume call after free tier
  replay: 0.002,              // per replay call after free tier
};

function getStripe() {
  if (!config.stripe.secretKey) return null;
  return new Stripe(config.stripe.secretKey, { apiVersion: '2024-06-20' });
}

export const billingService = {
  /**
   * Create a Stripe Customer for a new account and store the customer ID.
   * Called non-blocking after account creation.
   */
  async createCustomer(account) {
    const stripe = getStripe();
    if (!stripe) return;

    const customer = await stripe.customers.create({
      email: account.email,
      name: account.name ?? undefined,
      metadata: { account_id: String(account.id) },
    });

    await setStripeCustomerId(account.id, customer.id);
    return customer;
  },

  /**
   * Get current-period usage breakdown with free-tier calculations.
   *
   * @param {number} accountId
   */
  async getCurrentUsage(accountId) {
    const pool = getPool();
    const now = new Date();
    const periodStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
    const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);

    const result = await pool.query(
      `SELECT
         COALESCE(SUM(checkpoint_writes), 0)::int AS checkpoint_writes,
         COALESCE(SUM(checkpoint_reads), 0)::int AS checkpoint_reads,
         COALESCE(SUM(resume_calls), 0)::int AS resume_calls,
         COALESCE(SUM(replay_calls), 0)::int AS replay_calls,
         COALESCE(SUM(storage_bytes_written), 0)::bigint AS storage_bytes_written
       FROM usage_daily
       WHERE account_id = $1 AND date >= $2 AND date <= $3`,
      [accountId, periodStart, periodEnd]
    );

    const u = result.rows[0];
    const storageGb = Number(u.storage_bytes_written) / (1024 ** 3);

    const writes = parseInt(u.checkpoint_writes, 10);
    const resumes = parseInt(u.resume_calls, 10);
    const replays = parseInt(u.replay_calls, 10);

    const billableWrites = Math.max(0, writes - FREE_TIER.checkpoint_writes);
    const billableStorageGb = Math.max(0, storageGb - FREE_TIER.storage_gb);
    const billableResumes = Math.max(0, resumes - FREE_TIER.resume_calls);
    const billableReplays = Math.max(0, replays - FREE_TIER.replay_calls);

    const charge =
      billableWrites * PRICES.checkpoint_write +
      billableStorageGb * PRICES.storage_gb +
      billableResumes * PRICES.resume +
      billableReplays * PRICES.replay;

    return {
      period: { start: periodStart, end: periodEnd },
      usage: {
        checkpoint_writes: {
          count: writes,
          free_remaining: Math.max(0, FREE_TIER.checkpoint_writes - writes),
          billable: billableWrites,
        },
        storage_gb: {
          current: parseFloat(storageGb.toFixed(4)),
          free_remaining: parseFloat(Math.max(0, FREE_TIER.storage_gb - storageGb).toFixed(4)),
          billable: parseFloat(billableStorageGb.toFixed(4)),
        },
        resume_calls: {
          count: resumes,
          free_remaining: Math.max(0, FREE_TIER.resume_calls - resumes),
          billable: billableResumes,
        },
        replay_calls: {
          count: replays,
          free_remaining: Math.max(0, FREE_TIER.replay_calls - replays),
          billable: billableReplays,
        },
      },
      estimated_charge: `$${charge.toFixed(2)}`,
    };
  },

  /**
   * Report current usage to Stripe Billing Meter.
   * Called on a schedule or before invoice generation.
   */
  async reportUsage(accountId) {
    const stripe = getStripe();
    if (!stripe) return;

    const pool = getPool();
    const account = await pool.query('SELECT stripe_customer_id FROM accounts WHERE id = $1', [accountId]);
    if (!account.rows[0]?.stripe_customer_id) return;

    const usage = await this.getCurrentUsage(accountId);

    // Report billable quantities to Stripe meters (if configured)
    const meters = [
      { price: config.stripe.prices.checkpointWrite, quantity: usage.usage.checkpoint_writes.billable },
      { price: config.stripe.prices.resume, quantity: usage.usage.resume_calls.billable },
      { price: config.stripe.prices.replay, quantity: usage.usage.replay_calls.billable },
    ];

    await Promise.allSettled(
      meters
        .filter((m) => m.price && m.quantity > 0)
        .map((m) =>
          stripe.billing.meterEvents.create({
            event_name: m.price,
            payload: { value: String(m.quantity), stripe_customer_id: account.rows[0].stripe_customer_id },
          })
        )
    );
  },

  /**
   * Get upcoming invoice from Stripe.
   */
  async getInvoicePreview(accountId) {
    const stripe = getStripe();
    if (!stripe) return null;

    const pool = getPool();
    const result = await pool.query('SELECT stripe_customer_id FROM accounts WHERE id = $1', [accountId]);
    const customerId = result.rows[0]?.stripe_customer_id;
    if (!customerId) return null;

    return stripe.invoices.retrieveUpcoming({ customer: customerId });
  },

  /**
   * List past invoices for an account.
   */
  async listInvoices(accountId) {
    const stripe = getStripe();
    if (!stripe) return [];

    const pool = getPool();
    const result = await pool.query('SELECT stripe_customer_id FROM accounts WHERE id = $1', [accountId]);
    const customerId = result.rows[0]?.stripe_customer_id;
    if (!customerId) return [];

    const invoices = await stripe.invoices.list({ customer: customerId, limit: 24 });
    return invoices.data.map((inv) => ({
      id: inv.id,
      amount_due: inv.amount_due,
      amount_paid: inv.amount_paid,
      status: inv.status,
      period_start: new Date(inv.period_start * 1000).toISOString(),
      period_end: new Date(inv.period_end * 1000).toISOString(),
      invoice_pdf: inv.invoice_pdf,
    }));
  },

  /**
   * Handle Stripe webhook events.
   */
  async handleWebhookEvent(event) {
    const stripe = getStripe();
    const pool = getPool();

    switch (event.type) {
      case 'invoice.paid': {
        const customerId = event.data.object.customer;
        const result = await pool.query(
          'SELECT id FROM accounts WHERE stripe_customer_id = $1',
          [customerId]
        );
        if (result.rows[0]) {
          await updateAccountPlan(result.rows[0].id, { plan: 'paid', status: 'active' });
        }
        break;
      }
      case 'invoice.payment_failed': {
        const customerId = event.data.object.customer;
        const result = await pool.query(
          'SELECT id FROM accounts WHERE stripe_customer_id = $1',
          [customerId]
        );
        if (result.rows[0]) {
          await updateAccountPlan(result.rows[0].id, { plan: 'free', status: 'payment_failed' });
        }
        break;
      }
      case 'customer.subscription.updated': {
        const sub = event.data.object;
        const result = await pool.query(
          'SELECT id FROM accounts WHERE stripe_customer_id = $1',
          [sub.customer]
        );
        if (result.rows[0]) {
          const plan = sub.status === 'active' ? 'paid' : 'free';
          await updateAccountPlan(result.rows[0].id, { plan, status: sub.status });
        }
        break;
      }
    }
  },
};
