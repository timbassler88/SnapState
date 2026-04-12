import Stripe from 'stripe';
import { adminAuthMiddleware } from '../middleware/admin-auth.js';
import { billingService } from '../services/billing-service.js';
import { sendError, ErrorCodes } from '../utils/errors.js';
import { config } from '../config.js';

export async function billingRoutes(fastify) {
  /** GET /admin/accounts/:id/usage */
  fastify.get('/admin/accounts/:id/usage', {
    preHandler: adminAuthMiddleware,
  }, async (request, reply) => {
    const accountId = parseInt(request.params.id, 10);
    if (isNaN(accountId)) return sendError(reply, 400, ErrorCodes.VALIDATION_ERROR, 'Invalid account ID');

    const usage = await billingService.getCurrentUsage(accountId);
    return reply.send(usage);
  });

  /** GET /admin/accounts/:id/invoices */
  fastify.get('/admin/accounts/:id/invoices', {
    preHandler: adminAuthMiddleware,
  }, async (request, reply) => {
    const accountId = parseInt(request.params.id, 10);
    if (isNaN(accountId)) return sendError(reply, 400, ErrorCodes.VALIDATION_ERROR, 'Invalid account ID');

    const invoices = await billingService.listInvoices(accountId);
    return reply.send({ invoices });
  });

  /**
   * POST /billing/stripe-webhook
   * No auth middleware — Stripe signature verification used instead.
   */
  fastify.post('/billing/stripe-webhook', {
    config: { rawBody: true },
  }, async (request, reply) => {
    if (!config.stripe.secretKey || !config.stripe.webhookSecret) {
      return reply.code(200).send({ received: true });
    }

    const stripe = new Stripe(config.stripe.secretKey, { apiVersion: '2024-06-20' });
    const sig = request.headers['stripe-signature'];

    let event;
    try {
      // request.rawBody is populated by @fastify/formbody or by reading the body buffer
      const rawBody = request.rawBody ?? JSON.stringify(request.body);
      event = stripe.webhooks.constructEvent(rawBody, sig, config.stripe.webhookSecret);
    } catch (err) {
      return sendError(reply, 400, 'STRIPE_SIGNATURE_INVALID', `Webhook signature verification failed: ${err.message}`);
    }

    await billingService.handleWebhookEvent(event);
    return reply.send({ received: true });
  });
}
