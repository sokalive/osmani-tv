import { parseCheckoutProvidersResponse } from '../lib/checkoutPaymentProviders';
import { formatCheckoutPaymentError, extractPaymentBackendReason, logPaymentCheckoutFailure, CheckoutPaymentError } from '../lib/paymentCheckoutErrors';
import { resolveMediaAssetUrl } from '../lib/mediaDelivery';
import { resolveApiBaseUrl } from '../lib/apiBaseUrl';
import { fetchAdminApiJson, fetchAdminApiResponse } from '../lib/catalogApiFetch';
import { withTimeout } from '../lib/asyncTimeout';
import {
  readCachedCheckoutProviders,
  readCachedPaymentPlans,
  readCachedPaymentProviders,
  writeCachedCheckoutProviders,
  writeCachedPaymentPlans,
  writeCachedPaymentProviders,
} from '../lib/paymentCatalogCache';

/** Max wait for payment UI network fetches — modal shows cache/defaults first. */
export const PLANS_FETCH_TIMEOUT_MS = 3000;
export const CHECKOUT_PROVIDER_TIMEOUT_MS = 3000;
export const PAYMENT_PROVIDERS_TIMEOUT_MS = 3000;

/**
 * Payment + subscription HTTP API (ZenoPay STK push).
 * Uses {@link fetchAdminApiResponse} — VPS builds never fall back to Render.
 */

function apiPrefix() {
  return `${resolveApiBaseUrl().replace(/\/+$/, '')}/api`;
}

async function readJson(res) {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

function pickOrderId(body) {
  if (!body || typeof body !== 'object') return null;
  const v =
    body.order_id ??
    body.orderId ??
    body.data?.order_id ??
    body.data?.orderId ??
    body.transaction?.order_id;
  return v != null && String(v).trim() !== '' ? String(v).trim() : null;
}

function isPlainObject(x) {
  return x != null && typeof x === 'object' && !Array.isArray(x);
}

/** Normalize API truthiness (avoids missing nested `data` vs root `active`). */
function parseSubscriptionActive(value) {
  if (value === true || value === 1) return true;
  if (value === false || value === 0) return false;
  if (typeof value === 'string') {
    const s = value.trim().toLowerCase();
    if (s === 'true' || s === '1' || s === 'yes' || s === 'active' || s === 'paid') return true;
    if (s === 'false' || s === '0' || s === 'no' || s === 'inactive' || s === '') return false;
  }
  return Boolean(value);
}

function pickSubscription(body) {
  if (!isPlainObject(body)) return { active: false, expiresAt: null };
  const data = isPlainObject(body.data) ? body.data : null;
  const subNest = isPlainObject(body.subscription) ? body.subscription : null;
  const obj = subNest ?? data ?? body;
  const rawActive =
    body.active ??
    body.is_active ??
    body.isActive ??
    body.has_subscription ??
    body.subscribed ??
    data?.active ??
    data?.is_active ??
    data?.isActive ??
    subNest?.active ??
    subNest?.is_active ??
    subNest?.isActive ??
    obj.active ??
    obj.is_active ??
    obj.isActive;
  let active = parseSubscriptionActive(rawActive);
  if (!active) {
    const st = String(body.status ?? obj.status ?? data?.status ?? '').toLowerCase();
    if (['active', 'paid', 'success', 'live', 'ok'].includes(st)) active = true;
  }
  if (!active) {
    const rem = Number(
      body.remaining_seconds ??
        body.remainingSeconds ??
        data?.remaining_seconds ??
        data?.remainingSeconds ??
        0,
    );
    if (Number.isFinite(rem) && rem > 0) active = true;
  }
  const expiresAt =
    body.expires_at ??
    body.expiresAt ??
    data?.expires_at ??
    data?.expiresAt ??
    subNest?.expires_at ??
    subNest?.expiresAt ??
    obj.expires_at ??
    obj.expiresAt ??
    obj.end_date ??
    obj.ends_at ??
    null;
  const exp = expiresAt != null ? String(expiresAt) : null;
  return { active, expiresAt: exp };
}

function isExpiryValid(expiresAt) {
  if (!expiresAt) return false;
  const t = Date.parse(String(expiresAt));
  return Number.isFinite(t) && t > Date.now();
}

function normalizePlansBody(body) {
  if (Array.isArray(body)) return body;
  if (body && Array.isArray(body.plans)) return body.plans;
  if (body && Array.isArray(body.data)) return body.data;
  return null;
}

/**
 * @returns {Promise<unknown[]>}
 */
export async function getPlans(opts = {}) {
  if (!opts.force) {
    const cached = await readCachedPaymentPlans();
    if (Array.isArray(cached) && cached.length > 0) return cached;
  }
  try {
    const body = await withTimeout(
      fetchAdminApiJson('/api/plans', { tag: 'payment-plans' }),
      PLANS_FETCH_TIMEOUT_MS,
      'payment-plans',
    );
    const list = normalizePlansBody(body);
    if (!list) throw new Error('Invalid plans response');
    await writeCachedPaymentPlans(list);
    return list;
  } catch (e) {
    const stale = await readCachedPaymentPlans({ ignoreTtl: true });
    if (Array.isArray(stale) && stale.length > 0) {
      console.log('[payment-plans]', 'stale_cache_fallback', e?.message ?? e);
      return stale;
    }
    throw e;
  }
}

/** Return cached plans immediately when available; refresh in background. */
export async function getPlansCachedFirst() {
  const cached = await readCachedPaymentPlans();
  void getPlans({ force: true }).catch(() => null);
  if (Array.isArray(cached) && cached.length > 0) return cached;
  return getPlans();
}

function pickProviderLogoUrl(raw) {
  const candidates = [
    raw?.logoUrl,
    raw?.logo_url,
    raw?.logoURL,
    raw?.logo,
    raw?.image,
    raw?.image_url,
    raw?.imageUrl,
  ];
  for (const c of candidates) {
    if (typeof c === 'string') {
      const v = c.trim();
      if (v !== '') return v;
    }
  }
  return null;
}

function pickProviderActive(raw) {
  const candidates = [raw?.active, raw?.is_active, raw?.isActive, raw?.enabled];
  for (const c of candidates) {
    if (c === false || c === 0 || c === 'false' || c === '0') return false;
    if (c === true || c === 1 || c === 'true' || c === '1') return true;
  }
  return true;
}

function normalizeProviderRow(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const name = String(raw.name ?? raw.title ?? raw.label ?? '').trim();
  if (!name) return null;
  const id = String(raw.id ?? raw.provider_id ?? raw.code ?? raw.slug ?? name)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-');
  const logo = pickProviderLogoUrl(raw);
  return {
    id: id || name.toLowerCase(),
    name,
    logoUrl: logo ? resolveMediaAssetUrl(logo) : null,
    active: pickProviderActive(raw),
  };
}

/**
 * @returns {Promise<{ id: string; name: string; logoUrl: string|null; active: boolean }[]>}
 */
export async function getPaymentProviders(opts = {}) {
  if (!opts.force) {
    const cached = await readCachedPaymentProviders();
    if (Array.isArray(cached) && cached.length > 0) return cached;
  }
  try {
    const body = await withTimeout(
      fetchAdminApiJson('/api/payment-providers', { tag: 'payment-providers' }),
      PAYMENT_PROVIDERS_TIMEOUT_MS,
      'payment-providers',
    );
    let raw = [];
    if (Array.isArray(body)) raw = body;
    else if (body && Array.isArray(body.providers)) raw = body.providers;
    else if (body && Array.isArray(body.data)) raw = body.data;
    const list = raw
      .map(normalizeProviderRow)
      .filter((p) => p && p.active === true);
    if (list.length > 0) await writeCachedPaymentProviders(list);
    return list;
  } catch (e) {
    const stale = await readCachedPaymentProviders({ ignoreTtl: true });
    if (Array.isArray(stale) && stale.length > 0) {
      console.log('[payment-providers]', 'stale_cache_fallback', e?.message ?? e);
      return stale;
    }
    throw e;
  }
}

export async function getPaymentProvidersCachedFirst() {
  const cached = await readCachedPaymentProviders();
  void getPaymentProviders({ force: true }).catch(() => null);
  if (Array.isArray(cached) && cached.length > 0) return cached;
  return getPaymentProviders();
}

/**
 * GET /api/payments/checkout-providers
 */
export async function getCheckoutPaymentProviders(opts = {}) {
  if (!opts.force) {
    const cached = await readCachedCheckoutProviders();
    if (cached && typeof cached === 'object' && cached.payment_provider) return cached;
  }
  try {
    const body = await withTimeout(
      fetchAdminApiJson('/api/payments/checkout-providers', {
        tag: 'payment-checkout-providers',
      }),
      CHECKOUT_PROVIDER_TIMEOUT_MS,
      'payment-checkout-providers',
    );
    const cfg = parseCheckoutProvidersResponse(body);
    await writeCachedCheckoutProviders(cfg);
    console.log(
      '[payment-checkout-providers]',
      JSON.stringify({
        payment_provider: cfg.payment_provider,
        auraxpay: cfg.auraxpay,
        auraxpay_test: cfg.auraxpay_test,
        sonicpesa: cfg.sonicpesa,
        zenopay: cfg.zenopay,
      }),
    );
    return cfg;
  } catch (e) {
    const stale = await readCachedCheckoutProviders({ ignoreTtl: true });
    if (stale && typeof stale === 'object' && stale.payment_provider) {
      console.log('[payment-checkout-providers]', 'stale_cache_fallback', e?.message ?? e);
      return stale;
    }
    throw e;
  }
}

export async function getCheckoutPaymentProvidersCachedFirst() {
  const cached = await readCachedCheckoutProviders();
  void getCheckoutPaymentProviders({ force: true }).catch(() => null);
  if (cached && typeof cached === 'object' && cached.payment_provider) return cached;
  return getCheckoutPaymentProviders();
}

/** Prefetch plans + providers after startup so premium modal opens instantly. */
export async function warmPaymentCatalogCache() {
  await Promise.allSettled([
    getPlansCachedFirst(),
    getCheckoutPaymentProvidersCachedFirst(),
    getPaymentProvidersCachedFirst(),
  ]);
}

function buildCreateOrderPayload(payload) {
  const planId = payload.plan_id ?? payload.planId;
  return {
    phone: payload.phone,
    plan_id: planId,
    planId,
    amount: payload.amount,
    device_id: payload.device_id ?? payload.deviceId,
    deviceId: payload.device_id ?? payload.deviceId,
    ...(payload.device_fingerprint != null
      ? { device_fingerprint: payload.device_fingerprint, deviceFingerprint: payload.device_fingerprint }
      : {}),
  };
}

async function postCreateOrder(pathSuffixes, payload, errorLabel, provider) {
  const paths = Array.isArray(pathSuffixes) ? pathSuffixes : [pathSuffixes];
  const bodyPayload = buildCreateOrderPayload(payload);
  let last = null;

  for (let i = 0; i < paths.length; i += 1) {
    const pathSuffix = paths[i];
    const attempt = await fetchAdminApiResponse(pathSuffix, {
      method: 'POST',
      body: bodyPayload,
      tag: 'payment-create-order',
    });
    last = attempt;
    const routeMissing = attempt.res.status === 404;
    if (routeMissing && i < paths.length - 1) continue;
    break;
  }

  const { res, parsed: body, url } = last;
  if (!res.ok) {
    const backendReason = extractPaymentBackendReason(body, res.status);
    const providerHttpStatus = Number(body?.httpStatus ?? body?.providerHttpStatus);
    logPaymentCheckoutFailure({
      phase: 'create-order-failed',
      provider,
      path: url,
      httpStatus: res.status,
      providerHttpStatus: Number.isFinite(providerHttpStatus) ? providerHttpStatus : undefined,
      backendReason,
      apiStyle: body?.apiStyle ?? undefined,
      orderId: body?.orderId ?? body?.order_id ?? undefined,
    });
    const userMessage = formatCheckoutPaymentError(backendReason, {
      httpStatus: res.status,
      provider,
      body,
    });
    throw new CheckoutPaymentError(userMessage, {
      backendReason,
      httpStatus: res.status,
      provider,
      path: url,
      providerHttpStatus: Number.isFinite(providerHttpStatus) ? providerHttpStatus : undefined,
    });
  }
  const orderId = pickOrderId(body);
  if (!orderId) throw new Error('Missing order_id from server');
  const expiresInSeconds = Number(body.expires_in_seconds ?? body.expiresIn ?? body.timeout_seconds);
  return {
    order_id: orderId,
    expiresInSeconds: Number.isFinite(expiresInSeconds) ? expiresInSeconds : undefined,
  };
}

export async function createSonicpesaOrder(payload) {
  return postCreateOrder('/api/payments/sonicpesa/create-order', payload, 'SonicPesa payment', 'sonicpesa');
}

export async function createAuraxpayOrder(payload) {
  return postCreateOrder(
    [
      '/api/payments/auraxpay/create-order',
      '/api/payments/auraxPay/create-order',
    ],
    payload,
    'Aurax Pay payment',
    'auraxpay',
  );
}

/**
 * @param {'zenopay'|'sonicpesa'|'auraxpay'} provider
 */
export function resolveCheckoutStartPayment(provider) {
  if (provider === 'sonicpesa') return createSonicpesaOrder;
  if (provider === 'auraxpay') return createAuraxpayOrder;
  return createPayment;
}

/**
 * @param {{ phone: string; plan_id: string; amount: number; device_id: string; device_fingerprint: string }} payload
 */
export async function createPayment(payload) {
  return postCreateOrder('/api/payments/create-payment', payload, 'Payment', 'zenopay');
}

/**
 * @param {string} orderId
 */
export async function getPaymentStatus(orderId) {
  const q = encodeURIComponent(orderId);
  const { res, parsed: body } = await fetchAdminApiResponse(`/api/payment-status/${q}`, {
    tag: 'payment-status',
  });
  if (!res.ok) {
    if (res.status === 404) {
      return {
        status: 'FAILED',
        reason: formatCheckoutPaymentError(body?.reason ?? body?.error ?? 'Order not found', {
          httpStatus: 404,
        }),
      };
    }
    const msg = body?.error != null ? String(body.error) : `HTTP ${res.status}`;
    throw new Error(formatCheckoutPaymentError(msg, { httpStatus: res.status }));
  }
  const st = String(body?.status ?? 'PENDING').toUpperCase();
  const reason = String(body?.reason ?? '');
  if (st === 'SUCCESS') return { status: 'SUCCESS', reason };
  if (st === 'FAILED') return { status: 'FAILED', reason };
  return { status: 'PENDING', reason };
}

/**
 * @param {string} orderId
 */
export async function getTransactionStatus(orderId) {
  const r = await getPaymentStatus(orderId);
  if (r.status === 'SUCCESS') return { status: 'COMPLETED', reason: r.reason };
  if (r.status === 'FAILED') return { status: 'FAILED', reason: r.reason };
  return { status: 'PENDING', reason: r.reason };
}

/**
 * @param {string} deviceId
 */
export async function fetchSubscription(deviceId) {
  const { res, parsed: body } = await fetchAdminApiResponse(
    `/api/subscription-status?device_id=${encodeURIComponent(deviceId)}`,
    { tag: 'subscription-status' },
  );
  if (!res.ok) {
    if (res.status === 404) return { active: false, expiresAt: null };
    const msg = body?.error != null ? String(body.error) : `HTTP ${res.status}`;
    throw new Error(msg || 'Could not load subscription');
  }
  return pickSubscription(body);
}

/**
 * @param {string} deviceId
 */
export async function verifySubscriptionActive(deviceId) {
  const sub = await fetchSubscription(deviceId).catch(() => ({
    active: false,
    expiresAt: null,
  }));
  if (sub.active !== true) return false;
  return isExpiryValid(sub.expiresAt);
}

/** @deprecated use resolveApiBaseUrl — runtime snapshot for SSE URL builders */
export function getPaymentApiBaseUrl() {
  return resolveApiBaseUrl();
}

export { apiPrefix };
