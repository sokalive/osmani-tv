/**
 * User-facing checkout payment errors (Swahili) + backend reason extraction/logging.
 */

/** @typedef {'zenopay'|'sonicpesa'|'auraxpay'} CheckoutProviderId */

/**
 * @param {Record<string, unknown>|null|undefined} body
 * @param {number} [httpStatus]
 * @returns {string}
 */
export function extractPaymentBackendReason(body, httpStatus) {
  if (!body || typeof body !== 'object') {
    return httpStatus != null ? `HTTP ${httpStatus}` : 'unknown_error';
  }
  const parts = [];
  const push = (v) => {
    const s = v != null ? String(v).trim() : '';
    if (s && !parts.includes(s)) parts.push(s);
  };
  push(body.providerMessage);
  push(body.error);
  push(body.message);
  if (body.providerError && typeof body.providerError === 'object') {
    push(body.providerError.error);
    push(body.providerError.message);
  }
  if (body.details && typeof body.details === 'object') {
    push(body.details.error);
    push(body.details.message);
  } else if (typeof body.details === 'string') {
    push(body.details);
  }
  if (parts.length) return parts.join(' — ');
  return httpStatus != null ? `HTTP ${httpStatus}` : 'unknown_error';
}

/**
 * @param {Record<string, unknown>} detail
 */
export function logPaymentCheckoutFailure(detail) {
  console.log('[PAYMENT_CHECKOUT]', JSON.stringify(detail));
  try {
    const { reportPaymentTelemetry } = require('../api/userCenterSync');
    void reportPaymentTelemetry('failure', {
      ...(detail && typeof detail === 'object' ? detail : {}),
      source: 'payment_checkout',
    });
  } catch {
    /* telemetry optional */
  }
}

export class CheckoutPaymentError extends Error {
  /**
   * @param {string} userMessage
   * @param {{
   *   backendReason?: string;
   *   httpStatus?: number;
   *   provider?: CheckoutProviderId|string;
   *   path?: string;
   *   providerHttpStatus?: number;
   * }} [meta]
   */
  constructor(userMessage, meta = {}) {
    super(userMessage);
    this.name = 'CheckoutPaymentError';
    this.userMessage = userMessage;
    this.backendReason = meta.backendReason ?? null;
    this.httpStatus = meta.httpStatus ?? null;
    this.provider = meta.provider ?? null;
    this.path = meta.path ?? null;
    this.providerHttpStatus = meta.providerHttpStatus ?? null;
  }
}

/** Phone already has active subscription on another device — stop checkout immediately. */
export class PhoneSubscriptionConflictError extends Error {
  /**
   * @param {string} userMessage
   * @param {{
   *   code?: string;
   *   backendReason?: string;
   *   httpStatus?: number;
   *   provider?: CheckoutProviderId|string;
   *   path?: string;
   *   conflict?: Record<string, unknown>;
   * }} [meta]
   */
  constructor(userMessage, meta = {}) {
    super(userMessage);
    this.name = 'PhoneSubscriptionConflictError';
    this.userMessage = userMessage;
    this.code = meta.code ?? 'PHONE_ALREADY_HAS_ACTIVE_SUBSCRIPTION';
    this.backendReason = meta.backendReason ?? null;
    this.httpStatus = meta.httpStatus ?? 409;
    this.provider = meta.provider ?? null;
    this.path = meta.path ?? null;
    this.conflict = meta.conflict ?? null;
  }
}

/**
 * @param {string} lower
 * @param {number} httpStatus
 * @param {Record<string, unknown>|null|undefined} body
 */
function isAuraxProviderGatewayMisconfig(lower, httpStatus, body) {
  if (!/endpoint not found|route not found/.test(lower)) return false;
  const providerHttp = Number(body?.httpStatus ?? body?.providerHttpStatus);
  return httpStatus === 502 || providerHttp === 404 || body?.apiStyle === 'aurax';
}

/**
 * @param {unknown} rawMessage
 * @param {{
 *   httpStatus?: number;
 *   provider?: CheckoutProviderId|string;
 *   body?: Record<string, unknown>|null;
 * }} [ctx]
 * @returns {string}
 */
export function formatCheckoutPaymentError(rawMessage, ctx = {}) {
  const msg = String(rawMessage ?? '').trim();
  const lower = msg.toLowerCase();
  const status = Number(ctx.httpStatus);
  const provider = String(ctx.provider ?? '').toLowerCase();
  const body = ctx.body && typeof ctx.body === 'object' ? ctx.body : null;

  if (/endpoint not found/i.test(lower) && provider === 'auraxpay') {
    return 'Malipo ya Aurax hayawezi kuanzishwa — tatizo la usanidi wa Aurax kwenye seva. Jaribu tena baadae au wasiliana na msaada.';
  }

  if (provider === 'auraxpay' && isAuraxProviderGatewayMisconfig(lower, status, body)) {
    return 'Malipo ya Aurax hayawezi kuanzishwa — tatizo la usanidi wa Aurax kwenye seva. Jaribu tena baadae au wasiliana na msaada.';
  }

  if (
    status === 503 ||
    (/disabled|not configured|haijawashwa|haijasanidiwa/i.test(lower) &&
      !/endpoint not found|route not found/.test(lower))
  ) {
    if (provider === 'auraxpay') {
      return 'Aurax Pay haijawashwa au haijasanidiwa kwenye admin. Tafadhali wasiliana na msaada.';
    }
    return 'Huduma ya malipo haipatikani kwa sasa. Jaribu tena baadae.';
  }

  if (status === 404 || (/route not found/i.test(lower) && !body?.orderId)) {
    if (provider === 'auraxpay') {
      return 'Njia ya malipo ya Aurax haipatikani kwenye seva. Jaribu tena baadae.';
    }
    return 'Huduma ya malipo haipatikani kwa sasa. Tafadhali jaribu tena baadae.';
  }

  if (status === 502 || /bad gateway|gateway error/.test(lower)) {
    if (provider === 'auraxpay') {
      return 'Seva ya Aurax imeshindwa kujibu. Jaribu tena baadae.';
    }
    return 'Seva ya malipo haipatikani kwa sasa. Jaribu tena baadae.';
  }

  if (/^http\s*\d{3}/i.test(msg)) {
    return 'Imeshindwa kuanzisha malipo. Jaribu tena baadae.';
  }

  if (/plan not found|inactive/i.test(lower)) {
    return 'Mpango uliyochagua haupatikani. Chagua mpango mwingine.';
  }

  if (/deviceid is required|device_id is required/i.test(lower)) {
    return 'Imeshindwa kutambua kifaa. Fungua programu tena na ujaribu.';
  }

  if (msg) return msg;
  return 'Imeshindwa kuanzisha malipo';
}
