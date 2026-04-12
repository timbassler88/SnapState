import { ErrorCodes } from './errors.js';

// RFC 5322-inspired regex — basic, practical
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
// Alphanumeric, underscore, hyphen — max 255 chars
const ID_RE = /^[a-zA-Z0-9_-]{1,255}$/;

/**
 * Validate, trim, and lowercase an email address.
 * @param {string} email
 * @returns {string} sanitized email
 * @throws {{code, message}} if invalid
 */
export function validateEmail(email) {
  if (typeof email !== 'string') throw { code: ErrorCodes.INVALID_EMAIL, message: 'Email must be a string' };
  const sanitized = email.trim().toLowerCase();
  if (!EMAIL_RE.test(sanitized)) {
    throw { code: ErrorCodes.INVALID_EMAIL, message: 'Invalid email address format' };
  }
  return sanitized;
}

/**
 * Validate a password meets minimum requirements.
 * @param {string} password
 * @returns {boolean} true if valid
 */
export function validatePassword(password) {
  return typeof password === 'string' && password.length >= 8;
}

/**
 * Trim a string, strip ASCII control characters, and enforce a max length.
 * @param {string} str
 * @param {number} maxLength
 * @returns {string}
 */
export function sanitizeString(str, maxLength) {
  if (typeof str !== 'string') return '';
  // Remove control characters (C0 range 0x00–0x1F excluding \t, \n, \r, and 0x7F DEL)
  const cleaned = str.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '').trim();
  return cleaned.slice(0, maxLength);
}

/**
 * Validate a workflow ID (alphanumeric, underscores, hyphens, max 255 chars).
 * @param {string} id
 * @returns {boolean}
 */
export function validateWorkflowId(id) {
  return typeof id === 'string' && ID_RE.test(id);
}

/**
 * Validate an agent ID (same rules as workflow ID).
 * @param {string} id
 * @returns {boolean}
 */
export function validateAgentId(id) {
  return validateWorkflowId(id);
}
