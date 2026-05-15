import { BASE_URL } from '../api';

/**
 * Payment + subscription HTTP API (ZenoPay STK push).
 * Expected routes on the same host as `BASE_URL`:
 *   GET  /api/plans
 *   POST /api/payments/create-payment   body: { phone, plan_id, amount, device_id, device_fingerprint }
 *   GET  /api/payment-status/:orderId   → { status: SUCCESS|FAILED|PENDING, reason? }
 *   GET  /api/subscription-status?device_id=...             → { isActive|active, expiresAt|expires_at }
 * Change `P` if your server uses `/plans` instead of `/api/plans`, etc.
 */
const P = `${BASE_URL}/api`;

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

/**
 * @returns {Promise<unknown[]>}
 */
export async function getPlans() {
  const res = await fetch(`${P}/plans`);
  const body = await readJson(res);
  if (!res.ok) {
    const msg = body?.error != null ? String(body.error) : `HTTP ${res.status}`;
    throw new Error(msg || 'Could not load plans');
  }
  if (Array.isArray(body)) return body;
  if (body && Array.isArray(body.plans)) return body.plans;
  if (body && Array.isArray(body.data)) return body.data;
  throw new Error('Invalid plans response');
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
  return {
    id: id || name.toLowerCase(),
    name,
    logoUrl: pickProviderLogoUrl(raw),
    active: pickProviderActive(raw),
  };
}

/**
 * Live payment providers (admin-managed). Falls back to caller's local
 * defaults when the endpoint is unreachable or returns nothing.
 *
 * GET /api/payment-providers → []|{ providers: [] }|{ data: [] }
 *
 * @returns {Promise<{ id: string; name: string; logoUrl: string|null; active: boolean }[]>}
 */
export async function getPaymentProviders() {
  const res = await fetch(`${P}/payment-providers`);
  const body = await readJson(res);
  if (!res.ok) {
    const msg = body?.error != null ? String(body.error) : `HTTP ${res.status}`;
    throw new Error(msg || 'Could not load providers');
  }
  let raw = [];
  if (Array.isArray(body)) raw = body;
  else if (body && Array.isArray(body.providers)) raw = body.providers;
  else if (body && Array.isArray(body.data)) raw = body.data;
  return raw
    .map(normalizeProviderRow)
    .filter((p) => p && p.active === true);
}

/**
 * Active checkout gateway from admin (zenopay | sonicpesa).
 * GET /api/payments/checkout-providers
 *
 * @returns {Promise<{ payment_provider: 'zenopay'|'sonicpesa'; zenopay: boolean; sonicpesa: boolean }>}
 */
export async function getCheckoutPaymentProviders() {
  const res = await fetch(`${P}/payments/checkout-providers`);
  const body = await readJson(res);
  if (!res.ok) {
    const msg = body?.error != null ? String(body.error) : `HTTP ${res.status}`;
    throw new Error(msg || 'Could not load checkout provider');
  }
  const provider = String(body?.payment_provider ?? 'zenopay').toLowerCase();
  return {
    payment_provider: provider === 'sonicpesa' ? 'sonicpesa' : 'zenopay',
    zenopay: body?.zenopay !== false,
    sonicpesa: Boolean(body?.sonicpesa),
  };
}

/**
 * SonicPesa STK — POST /api/payments/sonicpesa/create-order
 * @param {{ phone: string; plan_id: string; amount: number; device_id: string; device_fingerprint?: string }} payload
 * @returns {Promise<{ order_id: string; expiresInSeconds?: number }>}
 */
export async function createSonicpesaOrder(payload) {
  const url = `${P}/payments/sonicpesa/create-order`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      phone: payload.phone,
      plan_id: payload.plan_id,
      amount: payload.amount,
      device_id: payload.device_id,
    }),
  });
  const body = await readJson(res);
  if (!res.ok) {
    const msg =
      body?.error != null
        ? String(body.error)
        : body?.message != null
          ? String(body.message)
          : `HTTP ${res.status}`;
    throw new Error(msg || 'SonicPesa payment could not be started');
  }
  const orderId = pickOrderId(body);
  if (!orderId) throw new Error('Missing order_id from server');
  const expiresInSeconds = Number(body.expires_in_seconds ?? body.expiresIn ?? body.timeout_seconds);
  return {
    order_id: orderId,
    expiresInSeconds: Number.isFinite(expiresInSeconds) ? expiresInSeconds : undefined,
  };
}

/**
 * @param {{ phone: string; plan_id: string; amount: number; device_id: string; device_fingerprint: string }} payload
 * @returns {Promise<{ order_id: string; expiresInSeconds?: number }>}
 */
export async function createPayment(payload) {
  const url = `${P}/payments/create-payment`;
  const requestBody = JSON.stringify(payload);

  console.log('[createPayment] BASE_URL (from api.js):', BASE_URL);
  console.log('[createPayment] Full URL:', url);
  console.log('[createPayment] Request body:', requestBody);
  console.log('SENDING REQUEST TO BACKEND...');

  let res;
  let responseText = '';
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: requestBody,
    });
    responseText = await res.text();
  } catch (error) {
    console.log('FETCH ERROR:', String(error));
    throw error;
  }

  console.log('[createPayment] Response status:', res.status, res.statusText);
  console.log('[createPayment] Response text:', responseText);

  let body = null;
  if (responseText) {
    try {
      body = JSON.parse(responseText);
    } catch {
      body = null;
    }
  }

  if (!res.ok) {
    const msg =
      body?.error != null
        ? String(body.error)
        : body?.message != null
          ? String(body.message)
          : `HTTP ${res.status}`;
    throw new Error(msg || 'Payment could not be started');
  }
  const orderId = pickOrderId(body);
  if (!orderId) throw new Error('Missing order_id from server');
  const expiresInSeconds = Number(body.expires_in_seconds ?? body.expiresIn ?? body.timeout_seconds);
  return {
    order_id: orderId,
    expiresInSeconds: Number.isFinite(expiresInSeconds) ? expiresInSeconds : undefined,
  };
}

/**
 * Poll after create-payment. Backend: GET /api/payment-status/:orderId
 * @param {string} orderId
 * @returns {Promise<{ status: 'SUCCESS' | 'FAILED' | 'PENDING'; reason: string }>}
 */
export async function getPaymentStatus(orderId) {
  const q = encodeURIComponent(orderId);
  const res = await fetch(`${P}/payment-status/${q}`);
  const body = await readJson(res);
  if (!res.ok) {
    if (res.status === 404) {
      return {
        status: 'FAILED',
        reason: String(body?.reason ?? body?.error ?? 'Order not found'),
      };
    }
    const msg = body?.error != null ? String(body.error) : `HTTP ${res.status}`;
    throw new Error(msg || 'Could not check payment status');
  }
  const st = String(body?.status ?? 'PENDING').toUpperCase();
  const reason = String(body?.reason ?? '');
  if (st === 'SUCCESS') return { status: 'SUCCESS', reason };
  if (st === 'FAILED') return { status: 'FAILED', reason };
  return { status: 'PENDING', reason };
}

/**
 * @param {string} orderId
 * @returns {Promise<{ status: string; reason: string }>}
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
  const url = `${P}/subscription-status?device_id=${encodeURIComponent(deviceId)}`;
  const res = await fetch(url);
  const body = await readJson(res);
  if (!res.ok) {
    if (res.status === 404) return { active: false, expiresAt: null };
    const msg = body?.error != null ? String(body.error) : `HTTP ${res.status}`;
    throw new Error(msg || 'Could not load subscription');
  }
  return pickSubscription(body);
}

/**
 * Verify subscription is active (e.g. before playback).
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

