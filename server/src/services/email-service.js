import { config } from '../config.js';

async function send({ to, subject, text, html }) {
  const apiKey = config.smtp.pass; // Resend API key (re_...)
  const from = config.smtp.from;

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject,
      text,
      html,
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(`Resend API error: ${response.status} - ${JSON.stringify(error)}`);
  }

  return response.json();
}

/**
 * Wrap email content in the standard SnapState HTML shell.
 * @param {string} content - Inner HTML (replaces {{CONTENT}})
 */
function buildEmailHtml(content) {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#F3F4F6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#F3F4F6;padding:40px 20px;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">

        <!-- Purple top bar -->
        <tr><td style="background-color:#534AB7;height:6px;border-radius:8px 8px 0 0;"></td></tr>

        <!-- White card -->
        <tr><td style="background-color:#FFFFFF;padding:40px 48px;border-radius:0 0 8px 8px;">

          <!-- Logo text -->
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr><td style="padding-bottom:32px;border-bottom:1px solid #E5E7EB;">
              <span style="font-size:22px;font-weight:700;color:#534AB7;letter-spacing:-0.5px;">SnapState</span>
            </td></tr>
          </table>

          ${content}

        </td></tr>

        <!-- Footer -->
        <tr><td style="padding:24px 48px;text-align:center;">
          <p style="margin:0 0 8px;font-size:13px;color:#9CA3AF;">SnapState — Persistent state for AI agent workflows</p>
          <p style="margin:0;font-size:12px;color:#D1D5DB;">
            <a href="https://snapstate.dev" style="color:#9CA3AF;text-decoration:none;">snapstate.dev</a>
          </p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

export const emailService = {
  /**
   * Send email verification link.
   * @param {string} email
   * @param {string} token
   */
  async sendVerificationEmail(email, token) {
    const verifyUrl = `${config.appUrl}/auth/verify?token=${token}`;

    const html = buildEmailHtml(`
      <h1 style="margin:32px 0 16px;font-size:22px;font-weight:700;color:#111827;line-height:1.3;">
        Verify your email address
      </h1>

      <p style="margin:0 0 24px;font-size:16px;color:#374151;line-height:1.6;">
        Thanks for signing up for SnapState. Click the button below to verify your email address and activate your account.
      </p>

      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        <tr><td align="center" style="padding:8px 0 32px;">
          <a href="${verifyUrl}" style="display:inline-block;background-color:#534AB7;color:#FFFFFF;font-size:16px;font-weight:600;text-decoration:none;padding:14px 36px;border-radius:8px;letter-spacing:0.2px;">
            Verify email address
          </a>
        </td></tr>
      </table>

      <p style="margin:0 0 12px;font-size:14px;color:#6B7280;line-height:1.5;">
        This link will expire in <strong style="color:#374151;">24 hours</strong>.
      </p>

      <p style="margin:0 0 8px;font-size:13px;color:#9CA3AF;">If the button doesn't work, copy and paste this link into your browser:</p>
      <p style="margin:0;font-size:13px;color:#534AB7;word-break:break-all;">
        <a href="${verifyUrl}" style="color:#534AB7;text-decoration:none;">${verifyUrl}</a>
      </p>

      <p style="margin:24px 0 0;font-size:13px;color:#9CA3AF;border-top:1px solid #E5E7EB;padding-top:24px;">
        If you didn't create a SnapState account, you can safely ignore this email.
      </p>
    `);

    const text = `Welcome to SnapState!\n\nVerify your email address by clicking the link below:\n\n${verifyUrl}\n\nThis link expires in 24 hours.\n\nIf you didn't sign up, you can safely ignore this email.`;

    await send({
      to: email,
      subject: 'Verify your SnapState account',
      text,
      html,
    });
  },

  /**
   * Send welcome email after successful email verification.
   * @param {string} email
   * @param {string|null} name
   */
  async sendWelcomeEmail(email, name) {
    const displayName = name || 'there';
    const docsUrl = 'https://snapstate.dev/docs/';

    const html = buildEmailHtml(`
      <h1 style="margin:32px 0 16px;font-size:22px;font-weight:700;color:#111827;line-height:1.3;">
        You're all set, ${displayName}!
      </h1>

      <p style="margin:0 0 24px;font-size:16px;color:#374151;line-height:1.6;">
        Your SnapState account is now active. You can start saving and resuming AI agent workflows right away.
      </p>

      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        <tr><td style="background-color:#F5F3FF;border-radius:8px;padding:24px;margin-bottom:24px;">
          <p style="margin:0 0 12px;font-size:14px;font-weight:700;color:#534AB7;">Quick start</p>
          <p style="margin:0 0 6px;font-size:14px;color:#374151;line-height:1.5;">
            <strong>1.</strong> Install the SDK: <code style="background:#E5E7EB;padding:2px 6px;border-radius:4px;font-size:13px;">npm install @snapstate/sdk</code>
          </p>
          <p style="margin:0 0 6px;font-size:14px;color:#374151;line-height:1.5;">
            <strong>2.</strong> Use your API key to save your first checkpoint
          </p>
          <p style="margin:0;font-size:14px;color:#374151;line-height:1.5;">
            <strong>3.</strong> Read the <a href="${docsUrl}" style="color:#534AB7;text-decoration:none;font-weight:600;">documentation</a> for guides and examples
          </p>
        </td></tr>
      </table>

      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        <tr><td align="center" style="padding:24px 0 8px;">
          <a href="${docsUrl}" style="display:inline-block;background-color:#534AB7;color:#FFFFFF;font-size:16px;font-weight:600;text-decoration:none;padding:14px 36px;border-radius:8px;">
            Read the docs
          </a>
        </td></tr>
      </table>
    `);

    const text = `Hi ${displayName},\n\nYour SnapState account is verified and ready to use.\n\nGet started:\n  1. Install the SDK: npm install @snapstate/sdk\n  2. Use your API key to save your first checkpoint\n  3. Read the docs: ${docsUrl}\n\nHappy building.`;

    await send({
      to: email,
      subject: 'Welcome to SnapState',
      text,
      html,
    });
  },

  /**
   * Send password-reset link.
   * @param {string} email
   * @param {string} token
   */
  async sendPasswordResetEmail(email, token) {
    const resetUrl = `${config.appUrl}/auth/reset?token=${token}`;

    const html = buildEmailHtml(`
      <h1 style="margin:32px 0 16px;font-size:22px;font-weight:700;color:#111827;line-height:1.3;">
        Reset your password
      </h1>

      <p style="margin:0 0 24px;font-size:16px;color:#374151;line-height:1.6;">
        We received a request to reset the password for your SnapState account. Click the button below to choose a new password.
      </p>

      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        <tr><td align="center" style="padding:8px 0 32px;">
          <a href="${resetUrl}" style="display:inline-block;background-color:#534AB7;color:#FFFFFF;font-size:16px;font-weight:600;text-decoration:none;padding:14px 36px;border-radius:8px;">
            Reset password
          </a>
        </td></tr>
      </table>

      <p style="margin:0 0 12px;font-size:14px;color:#6B7280;line-height:1.5;">
        This link will expire in <strong style="color:#374151;">1 hour</strong>.
      </p>

      <p style="margin:0 0 8px;font-size:13px;color:#9CA3AF;">If the button doesn't work, copy and paste this link:</p>
      <p style="margin:0;font-size:13px;word-break:break-all;">
        <a href="${resetUrl}" style="color:#534AB7;text-decoration:none;">${resetUrl}</a>
      </p>

      <p style="margin:24px 0 0;font-size:13px;color:#9CA3AF;border-top:1px solid #E5E7EB;padding-top:24px;">
        If you didn't request a password reset, you can safely ignore this email. Your password will remain unchanged.
      </p>
    `);

    const text = `A password reset was requested for your SnapState account.\n\nReset your password by clicking the link below:\n\n${resetUrl}\n\nThis link expires in 1 hour.\n\nIf you didn't request this, you can safely ignore this email. Your password will remain unchanged.`;

    await send({
      to: email,
      subject: 'Reset your SnapState password',
      text,
      html,
    });
  },
};
