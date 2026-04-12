import { randomBytes } from 'node:crypto';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { getPool } from '../store/postgres.js';
import { config } from '../config.js';

const BCRYPT_ROUNDS = 12;
const JWT_EXPIRY_SECONDS = 86_400; // 24 hours
const VERIFICATION_EXPIRY_HOURS = 24;
const RESET_EXPIRY_HOURS = 1;

export const authService = {
  /**
   * Hash a plaintext password with bcrypt.
   * @param {string} password
   * @returns {Promise<string>} bcrypt hash
   */
  async hashPassword(password) {
    return bcrypt.hash(password, BCRYPT_ROUNDS);
  },

  /**
   * Verify a plaintext password against a stored bcrypt hash.
   * @param {string} password
   * @param {string} hash
   * @returns {Promise<boolean>}
   */
  async verifyPassword(password, hash) {
    return bcrypt.compare(password, hash);
  },

  /**
   * Generate a cryptographically random hex token.
   * @returns {string} 64-char hex string
   */
  generateToken() {
    return randomBytes(32).toString('hex');
  },

  /**
   * Sign a JWT for a given account ID.
   * @param {number} accountId
   * @returns {string} signed JWT
   */
  generateJWT(accountId) {
    return jwt.sign(
      { sub: accountId },
      config.jwtSecret,
      { expiresIn: JWT_EXPIRY_SECONDS }
    );
  },

  /**
   * Verify and decode a JWT.
   * @param {string} token
   * @returns {number} accountId from sub claim
   * @throws if token is invalid or expired
   */
  verifyJWT(token) {
    const payload = jwt.verify(token, config.jwtSecret);
    return payload.sub;
  },

  /**
   * Generate an email verification token for an account and persist it.
   * @param {number} accountId
   * @returns {Promise<string>} raw token
   */
  async generateVerificationToken(accountId) {
    const token = this.generateToken();
    const expiresAt = new Date(Date.now() + VERIFICATION_EXPIRY_HOURS * 3_600_000);
    const pool = getPool();
    await pool.query(
      `UPDATE accounts
       SET verification_token = $1, verification_expires_at = $2
       WHERE id = $3`,
      [token, expiresAt, accountId]
    );
    return token;
  },

  /**
   * Generate a password-reset token for an account identified by email.
   * @param {string} email - lower-cased
   * @returns {Promise<{ token: string, accountId: number }|null>} null if no active account found
   */
  async generateResetToken(email) {
    const pool = getPool();
    const result = await pool.query(
      `SELECT id FROM accounts WHERE LOWER(email) = $1 AND status = 'active'`,
      [email.toLowerCase()]
    );
    if (result.rows.length === 0) return null;

    const accountId = result.rows[0].id;
    const token = this.generateToken();
    const expiresAt = new Date(Date.now() + RESET_EXPIRY_HOURS * 3_600_000);

    await pool.query(
      `UPDATE accounts SET reset_token = $1, reset_expires_at = $2 WHERE id = $3`,
      [token, expiresAt, accountId]
    );
    return { token, accountId };
  },
};

export const JWT_EXPIRY_SECONDS_EXPORT = JWT_EXPIRY_SECONDS;
