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
   * GET /auth/verify
   * Landing page for email verification links.
   */
  fastify.get('/auth/verify', async (request, reply) => {
    const token = request.query.token ?? '';
    reply.type('text/html').send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Verify email — SnapState</title>
  <style>
    *{box-sizing:border-box}
    body{margin:0;padding:40px 20px;background:#F3F4F6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;color:#111827}
    .card{max-width:480px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden}
    .bar{height:6px;background:#534AB7}
    .content{padding:40px 48px}
    .logo{font-size:22px;font-weight:700;color:#534AB7;letter-spacing:-0.5px;margin-bottom:32px;padding-bottom:32px;border-bottom:1px solid #E5E7EB}
    h1{font-size:22px;font-weight:700;margin:0 0 16px}
    p{font-size:16px;color:#374151;line-height:1.6;margin:0 0 16px}
    .key-box{background:#F9FAFB;border:1px solid #E5E7EB;border-radius:8px;padding:12px 16px;font-family:monospace;font-size:14px;word-break:break-all;margin:12px 0;position:relative;padding-right:72px}
    .copy-btn{position:absolute;right:8px;top:50%;transform:translateY(-50%);background:#534AB7;color:#fff;border:none;padding:5px 12px;border-radius:4px;font-size:12px;cursor:pointer;font-family:inherit}
    .copy-btn:hover{background:#3C3489}
    .success{color:#059669}
    .error-color{color:#DC2626}
    .icon{font-size:40px;margin-bottom:12px}
    .spinner{display:inline-block;width:24px;height:24px;border:3px solid #E5E7EB;border-top-color:#534AB7;border-radius:50%;animation:spin 0.6s linear infinite;vertical-align:middle;margin-right:10px}
    @keyframes spin{to{transform:rotate(360deg)}}
    .warning{font-size:14px;color:#D97706;background:#FFFBEB;border:1px solid #FCD34D;border-radius:6px;padding:10px 14px;margin:8px 0 16px}
    .link{color:#534AB7;text-decoration:none;font-weight:600}
    .link:hover{text-decoration:underline}
    .footer{text-align:center;padding:24px;font-size:13px;color:#9CA3AF}
    #state-loading,#state-success,#state-error{display:none}
  </style>
</head>
<body>
  <div class="card">
    <div class="bar"></div>
    <div class="content">
      <div class="logo">SnapState</div>

      <div id="state-loading">
        <p><span class="spinner"></span> Verifying your email…</p>
      </div>

      <div id="state-success">
        <div class="icon success">✓</div>
        <h1 class="success">Email verified!</h1>
        <p>Your account is now active. Here is your API key:</p>
        <div class="key-box" id="key-display">
          <span id="key-text"></span>
          <button class="copy-btn" onclick="copyKey()">Copy</button>
        </div>
        <div class="warning">⚠ Save this key — it won't be shown again.</div>
        <p style="margin-top:8px">
          <a class="link" href="/docs/">Go to documentation →</a>
        </p>
      </div>

      <div id="state-error">
        <div class="icon error-color">✕</div>
        <h1 class="error-color">Verification failed</h1>
        <p id="error-msg" style="color:#DC2626"></p>
        <p><a class="link" href="/docs/#/pricing">Back to sign up →</a></p>
      </div>
    </div>
  </div>
  <div class="footer">SnapState — Persistent state for AI agent workflows</div>

  <script>
    const token = ${JSON.stringify(token)};

    function show(id) {
      ['state-loading','state-success','state-error'].forEach(s => {
        document.getElementById(s).style.display = s === id ? 'block' : 'none';
      });
    }

    function copyKey() {
      const key = document.getElementById('key-text').textContent;
      navigator.clipboard.writeText(key).then(() => {
        const btn = document.querySelector('.copy-btn');
        btn.textContent = 'Copied!';
        setTimeout(() => { btn.textContent = 'Copy'; }, 2000);
      });
    }

    async function verify() {
      show('state-loading');
      if (!token) {
        document.getElementById('error-msg').textContent = 'No verification token found in the URL.';
        show('state-error');
        return;
      }
      try {
        const res = await fetch('/auth/verify-email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
        });
        const data = await res.json();
        if (!res.ok) {
          document.getElementById('error-msg').textContent =
            data?.error?.message ?? 'Verification failed. The link may have expired.';
          show('state-error');
          return;
        }
        document.getElementById('key-text').textContent = data.api_key;
        show('state-success');
      } catch (err) {
        document.getElementById('error-msg').textContent = 'Network error. Please try again.';
        show('state-error');
      }
    }

    verify();
  </script>
</body>
</html>`);
  });

  /**
   * GET /auth/reset
   * Landing page for password reset links.
   */
  fastify.get('/auth/reset', async (request, reply) => {
    const token = request.query.token ?? '';
    reply.type('text/html').send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Reset password — SnapState</title>
  <style>
    *{box-sizing:border-box}
    body{margin:0;padding:40px 20px;background:#F3F4F6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;color:#111827}
    .card{max-width:480px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden}
    .bar{height:6px;background:#534AB7}
    .content{padding:40px 48px}
    .logo{font-size:22px;font-weight:700;color:#534AB7;letter-spacing:-0.5px;margin-bottom:32px;padding-bottom:32px;border-bottom:1px solid #E5E7EB}
    h1{font-size:22px;font-weight:700;margin:0 0 16px}
    p{font-size:16px;color:#374151;line-height:1.6;margin:0 0 16px}
    .btn{display:block;width:100%;background:#534AB7;color:#fff;font-size:16px;font-weight:600;padding:14px 36px;border-radius:8px;border:none;cursor:pointer;text-align:center;font-family:inherit;margin-top:8px}
    .btn:hover{background:#3C3489}
    .btn:disabled{background:#A5B4FC;cursor:not-allowed}
    input[type="password"]{width:100%;padding:12px 16px;font-size:16px;border:1px solid #D1D5DB;border-radius:8px;margin-bottom:16px;font-family:inherit}
    input[type="password"]:focus{outline:none;border-color:#534AB7;box-shadow:0 0 0 3px rgba(83,74,183,0.1)}
    label{display:block;font-size:14px;font-weight:600;color:#374151;margin-bottom:6px}
    .success{color:#059669}
    .error-color{color:#DC2626}
    .icon{font-size:40px;margin-bottom:12px}
    .field-error{font-size:13px;color:#DC2626;margin:-10px 0 12px}
    .api-error{font-size:14px;color:#DC2626;background:#FEF2F2;border:1px solid #FECACA;border-radius:6px;padding:10px 14px;margin-bottom:16px}
    .link{color:#534AB7;text-decoration:none;font-weight:600}
    .link:hover{text-decoration:underline}
    .footer{text-align:center;padding:24px;font-size:13px;color:#9CA3AF}
    #state-form,#state-success{display:none}
  </style>
</head>
<body>
  <div class="card">
    <div class="bar"></div>
    <div class="content">
      <div class="logo">SnapState</div>

      <div id="state-form">
        <h1>Reset your password</h1>
        <p style="font-size:15px;color:#6B7280;margin-bottom:24px">Enter a new password for your account.</p>

        <div id="api-error" class="api-error" style="display:none"></div>

        <label for="pw">New password</label>
        <input type="password" id="pw" placeholder="At least 8 characters" autocomplete="new-password">
        <div id="pw-error" class="field-error" style="display:none"></div>

        <label for="pw2">Confirm new password</label>
        <input type="password" id="pw2" placeholder="Repeat password" autocomplete="new-password">
        <div id="pw2-error" class="field-error" style="display:none"></div>

        <button class="btn" id="submit-btn" onclick="submitReset()">Reset password</button>
      </div>

      <div id="state-success">
        <div class="icon success">✓</div>
        <h1 class="success">Password updated!</h1>
        <p>You can now log in with your new password.</p>
        <p><a class="link" href="/docs/">Go to documentation →</a></p>
      </div>
    </div>
  </div>
  <div class="footer">SnapState — Persistent state for AI agent workflows</div>

  <script>
    const token = ${JSON.stringify(token)};

    function show(id) {
      ['state-form','state-success'].forEach(s => {
        document.getElementById(s).style.display = s === id ? 'block' : 'none';
      });
    }

    function showFieldError(id, msg) {
      const el = document.getElementById(id);
      el.textContent = msg;
      el.style.display = msg ? 'block' : 'none';
    }

    function showApiError(msg) {
      const el = document.getElementById('api-error');
      el.textContent = msg;
      el.style.display = msg ? 'block' : 'none';
    }

    async function submitReset() {
      showApiError('');
      showFieldError('pw-error', '');
      showFieldError('pw2-error', '');

      const pw = document.getElementById('pw').value;
      const pw2 = document.getElementById('pw2').value;

      if (pw.length < 8) {
        showFieldError('pw-error', 'Password must be at least 8 characters.');
        return;
      }
      if (pw !== pw2) {
        showFieldError('pw2-error', 'Passwords do not match.');
        return;
      }

      const btn = document.getElementById('submit-btn');
      btn.disabled = true;
      btn.textContent = 'Resetting…';

      try {
        const res = await fetch('/auth/reset-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token, password: pw }),
        });
        const data = await res.json();
        if (!res.ok) {
          showApiError(data?.error?.message ?? 'Reset failed. The link may have expired.');
          btn.disabled = false;
          btn.textContent = 'Reset password';
          return;
        }
        show('state-success');
      } catch (err) {
        showApiError('Network error. Please try again.');
        btn.disabled = false;
        btn.textContent = 'Reset password';
      }
    }

    // Allow Enter key to submit
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submitReset();
    });

    if (!token) {
      document.getElementById('api-error').textContent = 'No reset token found in the URL. Please use the link from your email.';
      document.getElementById('api-error').style.display = 'block';
    }

    show('state-form');
  </script>
</body>
</html>`);
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
