import { getPool } from '../store/postgres.js';
import { getRedis } from '../store/redis.js';
import { authService, JWT_EXPIRY_SECONDS_EXPORT as JWT_EXPIRY } from '../services/auth-service.js';
import { emailService } from '../services/email-service.js';
import { generateApiKey } from '../services/account-service.js';
import { validateEmail, validatePassword } from '../utils/validation.js';
import { sendError, ErrorCodes } from '../utils/errors.js';

// Rate-limit: 10 requests per minute per IP on all auth routes
const AUTH_RATE_LIMIT = { max: 10, timeWindow: 60_000 };

export async function authPublicRoutes(fastify) {
  // Per-route rate limiting on IP (not API key)
  await fastify.register(import('@fastify/rate-limit'), {
    global: false,
    keyGenerator: (request) =>
      request.headers['x-forwarded-for']?.split(',')[0].trim() ?? request.ip,
  });

  /**
   * POST /auth/signup
   */
  fastify.post('/auth/signup', { config: { rateLimit: AUTH_RATE_LIMIT } }, async (request, reply) => {
    const { email: rawEmail, password, name } = request.body ?? {};

    let email;
    try {
      email = validateEmail(rawEmail ?? '');
    } catch (e) {
      return sendError(reply, 400, ErrorCodes.INVALID_EMAIL, e.message);
    }

    if (!validatePassword(password)) {
      return sendError(reply, 400, ErrorCodes.WEAK_PASSWORD, 'Password must be at least 8 characters');
    }

    const pool = getPool();

    // Check for duplicate email (case-insensitive)
    const existing = await pool.query(
      `SELECT id FROM accounts WHERE LOWER(email) = $1`,
      [email]
    );
    if (existing.rows.length > 0) {
      return sendError(reply, 409, ErrorCodes.EMAIL_ALREADY_EXISTS, 'An account with this email already exists');
    }

    const passwordHash = await authService.hashPassword(password);

    // Create account with status 'pending' until email is verified
    const result = await pool.query(
      `INSERT INTO accounts (email, name, password_hash, status, email_verified, plan)
       VALUES ($1, $2, $3, 'pending', FALSE, 'free')
       RETURNING id`,
      [email, name ?? null, passwordHash]
    );
    const accountId = result.rows[0].id;

    // Generate and store verification token
    const token = await authService.generateVerificationToken(accountId);

    // Send email (fire-and-forget — don't block response on SMTP)
    emailService.sendVerificationEmail(email, token).catch((err) => {
      fastify.log.error({ msg: 'Failed to send verification email', err: err.message });
    });

    return reply.code(201).send({ message: 'Check your email to verify your account' });
  });

  /**
   * POST /auth/verify-email
   */
  fastify.post('/auth/verify-email', { config: { rateLimit: AUTH_RATE_LIMIT } }, async (request, reply) => {
    const { token } = request.body ?? {};
    if (!token) return sendError(reply, 400, ErrorCodes.VALIDATION_ERROR, 'Token is required');

    const pool = getPool();
    const result = await pool.query(
      `SELECT id, email, name, verification_expires_at
       FROM accounts
       WHERE verification_token = $1`,
      [token]
    );

    if (result.rows.length === 0) {
      return sendError(reply, 400, ErrorCodes.TOKEN_EXPIRED, 'Invalid or expired verification token');
    }

    const account = result.rows[0];
    if (new Date(account.verification_expires_at) < new Date()) {
      return sendError(reply, 400, ErrorCodes.TOKEN_EXPIRED, 'Verification token has expired');
    }

    // Activate account
    await pool.query(
      `UPDATE accounts
       SET email_verified = TRUE,
           status = 'active',
           verification_token = NULL,
           verification_expires_at = NULL
       WHERE id = $1`,
      [account.id]
    );

    // Auto-generate first API key
    const { rawKey } = await generateApiKey(account.id, { label: 'default' });

    // Send welcome email non-blocking
    emailService.sendWelcomeEmail(account.email, account.name).catch(() => {});

    return reply.send({ message: 'Email verified', api_key: rawKey });
  });

  /**
   * POST /auth/login
   */
  fastify.post('/auth/login', { config: { rateLimit: AUTH_RATE_LIMIT } }, async (request, reply) => {
    const { email: rawEmail, password } = request.body ?? {};

    let email;
    try {
      email = validateEmail(rawEmail ?? '');
    } catch {
      // Return same generic error to prevent user enumeration
      return sendError(reply, 401, ErrorCodes.INVALID_CREDENTIALS, 'Invalid email or password');
    }

    const pool = getPool();
    const result = await pool.query(
      `SELECT id, email, name, password_hash, status, email_verified
       FROM accounts WHERE LOWER(email) = $1`,
      [email]
    );

    // Constant-time path: always attempt bcrypt compare to prevent timing attacks
    const account = result.rows[0] ?? null;
    const hashToCheck = account?.password_hash ?? '$2b$12$invalidhashpaddingtomakeittaketime000000000000000000000';
    const passwordOk = await authService.verifyPassword(password ?? '', hashToCheck);

    if (!account || !passwordOk) {
      return sendError(reply, 401, ErrorCodes.INVALID_CREDENTIALS, 'Invalid email or password');
    }

    if (account.status !== 'active') {
      return sendError(reply, 403, ErrorCodes.ACCOUNT_DISABLED, 'Account is not active');
    }

    if (!account.email_verified) {
      return sendError(reply, 403, ErrorCodes.EMAIL_NOT_VERIFIED, 'Please verify your email address before logging in');
    }

    const jwtToken = authService.generateJWT(account.id);

    // Update last_login_at non-blocking
    pool.query('UPDATE accounts SET last_login_at = NOW() WHERE id = $1', [account.id]).catch(() => {});

    return reply.send({ token: jwtToken, expires_in: JWT_EXPIRY });
  });

  /**
   * POST /auth/forgot-password
   * Always returns 200 regardless of whether email exists (prevents enumeration).
   */
  fastify.post('/auth/forgot-password', { config: { rateLimit: AUTH_RATE_LIMIT } }, async (request, reply) => {
    const { email: rawEmail } = request.body ?? {};

    let email;
    try {
      email = validateEmail(rawEmail ?? '');
    } catch {
      // Return same 200 response regardless
      return reply.send({ message: "If that email exists, a reset link has been sent" });
    }

    // Generate token if account exists (fire-and-forget)
    authService.generateResetToken(email).then(async (result) => {
      if (!result) return;
      emailService.sendPasswordResetEmail(email, result.token).catch(() => {});
    }).catch(() => {});

    return reply.send({ message: "If that email exists, a reset link has been sent" });
  });

  /**
   * POST /auth/reset-password
   */
  fastify.post('/auth/reset-password', { config: { rateLimit: AUTH_RATE_LIMIT } }, async (request, reply) => {
    const { token, password } = request.body ?? {};

    if (!token) return sendError(reply, 400, ErrorCodes.VALIDATION_ERROR, 'Token is required');
    if (!validatePassword(password ?? '')) {
      return sendError(reply, 400, ErrorCodes.WEAK_PASSWORD, 'Password must be at least 8 characters');
    }

    const pool = getPool();
    const result = await pool.query(
      `SELECT id, reset_expires_at FROM accounts WHERE reset_token = $1`,
      [token]
    );

    if (result.rows.length === 0) {
      return sendError(reply, 400, ErrorCodes.TOKEN_EXPIRED, 'Invalid or expired reset token');
    }

    const account = result.rows[0];
    if (new Date(account.reset_expires_at) < new Date()) {
      return sendError(reply, 400, ErrorCodes.TOKEN_EXPIRED, 'Reset token has expired');
    }

    const passwordHash = await authService.hashPassword(password);

    await pool.query(
      `UPDATE accounts
       SET password_hash = $1, reset_token = NULL, reset_expires_at = NULL
       WHERE id = $2`,
      [passwordHash, account.id]
    );

    // Invalidate all existing sessions for this account
    await pool.query('DELETE FROM sessions WHERE account_id = $1', [account.id]);

    // Also clear the Redis auth cache for any active API keys belonging to this account
    // (The cache is keyed by key_hash, so we'd need to iterate — skip for now, keys expire in 5 min naturally)

    return reply.send({ message: 'Password reset successfully' });
  });
}
