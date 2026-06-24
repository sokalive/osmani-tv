/**
 * Tanzania mobile payment / transfer phone normalization.
 * Payment flow stores 10-digit local numbers (0712345678).
 */

/**
 * @param {unknown} raw
 * @returns {{ local: string; e164: string; digits: string } | null}
 */
export function normalizeTanzaniaMobilePhone(raw) {
  let digits = String(raw ?? '').replace(/[^\d]/g, '');
  if (!digits) return null;

  if (digits.startsWith('255') && digits.length >= 12) {
    digits = `0${digits.slice(3)}`;
  } else if (digits.length === 9 && /^[67]/.test(digits)) {
    digits = `0${digits}`;
  }

  if (digits.length > 10) {
    digits = digits.slice(-10);
  }

  if (!/^0[67]\d{8}$/.test(digits)) return null;

  return {
    local: digits,
    e164: `255${digits.slice(1)}`,
    digits,
  };
}

/** @param {unknown} raw */
export function isValidTanzaniaMobilePhone(raw) {
  return normalizeTanzaniaMobilePhone(raw) != null;
}

/**
 * Canonical form for subscription transfer / payment APIs.
 * @param {unknown} raw
 * @returns {string}
 */
export function formatTanzaniaPhoneForApi(raw) {
  return normalizeTanzaniaMobilePhone(raw)?.local ?? '';
}
