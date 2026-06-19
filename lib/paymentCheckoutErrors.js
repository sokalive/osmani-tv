/**
 * User-facing checkout payment errors (Swahili). Maps raw API / gateway text.
 */

/** @typedef {'zenopay'|'sonicpesa'|'auraxpay'} CheckoutProviderId */

/**
 * @param {unknown} rawMessage
 * @param {{ httpStatus?: number; provider?: CheckoutProviderId|string }} [ctx]
 * @returns {string}
 */
export function formatCheckoutPaymentError(rawMessage, ctx = {}) {
  const msg = String(rawMessage ?? '').trim();
  const lower = msg.toLowerCase();
  const status = Number(ctx.httpStatus);
  const provider = String(ctx.provider ?? '').toLowerCase();

  if (
    status === 404 ||
    /endpoint not found|route not found|not[\s_-]?found/.test(lower)
  ) {
    if (provider === 'auraxpay') {
      return 'Huduma ya Aurax Pay haipatikani kwa sasa. Tafadhali jaribu tena baadae au wasiliana na msaada.';
    }
    return 'Huduma ya malipo haipatikani kwa sasa. Tafadhali jaribu tena baadae.';
  }

  if (
    status === 503 ||
    /disabled|not configured|haijawashwa|haijasanidiwa|haipatikani/i.test(lower)
  ) {
    if (provider === 'auraxpay') {
      return 'Aurax Pay haijawashwa au haijasanidiwa. Tafadhali tumia njia nyingine ya malipo.';
    }
    return 'Huduma ya malipo haipatikani kwa sasa. Jaribu tena baadae.';
  }

  if (status === 502 || /bad gateway|gateway error|502/.test(lower)) {
    return 'Seva ya malipo haipatikani kwa sasa. Jaribu tena baadae.';
  }

  if (/^http\s*\d{3}/i.test(msg) || /endpoint|route not found/i.test(msg)) {
    return 'Imeshindwa kuanzisha malipo. Jaribu tena baadae.';
  }

  if (msg) return msg;
  return 'Imeshindwa kuanzisha malipo';
}
