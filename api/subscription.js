import AsyncStorage from '@react-native-async-storage/async-storage';
import { BASE_URL } from '../api';

/**
 * Device-bound subscription HTTP client.
 *
 * Single source of truth: the backend's `active` field.
 * The app NEVER compares `expires_at` against the device clock.
 *
 * Endpoints (production /api):
 *   POST /api/subscription/verify             { device_id, device_fingerprint }
 *   POST /api/subscription/recover            { device_id, device_fingerprint }
 *   POST /api/subscription/transfer/initiate  { device_id, device_fingerprint }
 *   POST /api/subscription/transfer/redeem    { code, device_id, device_fingerprint }
 *   GET  /api/subscription/transfer/:code
 *   POST /api/transfer/respond                { code, decision }
 */

const API = `${BASE_URL.replace(/\/+$/, '')}/api`;

export const SUB_CACHE_KEYS = Object.freeze({
  active: 'osmani:sub:active',
  expiresAt: 'osmani:sub:expires_at',
  deviceId: 'osmani:sub:device_id',
  fingerprint: 'osmani:sub:fingerprint',
  revokedAt: 'osmani:sub:revoked_at',
});

async function readJson(res) {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

function isPlainObject(x) {
  return x != null && typeof x === 'object' && !Array.isArray(x);
}

function pickActive(body) {
  if (!isPlainObject(body)) return false;
  const data = isPlainObject(body.data) ? body.data : null;
  const sub = isPlainObject(body.subscription) ? body.subscription : null;
  const candidates = [
    body.active,
    body.is_active,
    body.isActive,
    data?.active,
    data?.is_active,
    data?.isActive,
    sub?.active,
    sub?.is_active,
    sub?.isActive,
  ];
  for (const c of candidates) {
    if (c === true || c === 1 || c === '1' || c === 'true') return true;
    if (c === false || c === 0 || c === '0' || c === 'false') return false;
  }
  const status = String(body.status ?? data?.status ?? sub?.status ?? '').toLowerCase();
  return ['active', 'paid', 'live', 'ok'].includes(status);
}

function pickExpiresAt(body) {
  if (!isPlainObject(body)) return null;
  const data = isPlainObject(body.data) ? body.data : null;
  const sub = isPlainObject(body.subscription) ? body.subscription : null;
  const v =
    body.expires_at ??
    body.expiresAt ??
    data?.expires_at ??
    data?.expiresAt ??
    sub?.expires_at ??
    sub?.expiresAt ??
    null;
  return v != null ? String(v) : null;
}

function pickTransferCode(body) {
  if (!isPlainObject(body)) return '';
  const data = isPlainObject(body.data) ? body.data : null;
  const tr = isPlainObject(body.transfer) ? body.transfer : null;
  const v = body.code ?? body.transfer_code ?? data?.code ?? tr?.code ?? null;
  return v != null ? String(v).trim() : '';
}

function pickStringList(...keys) {
  return keys.find((k) => typeof k === 'string' && k.trim() !== '') ?? '';
}

/**
 * Normalize a verify/recover response to the shape the app uses.
 * Note: `active` here is the backend's verdict — the app does NOT
 * recompute it from `expiresAt` against the device clock.
 */
function normalizeVerifyResponse(body, fallback = {}) {
  if (!isPlainObject(body)) {
    return { active: false, expiresAt: null, raw: body, ...fallback };
  }
  return {
    active: pickActive(body),
    expiresAt: pickExpiresAt(body),
    serverTime: pickStringList(body.server_time, body.serverTime),
    deviceId: pickStringList(body.device_id, body.deviceId),
    raw: body,
  };
}

function expandDeviceKeys(payload) {
  if (!payload || typeof payload !== 'object') return payload;
  const out = { ...payload };
  if (out.device_fingerprint != null && out.fingerprint == null) {
    out.fingerprint = out.device_fingerprint;
  }
  if (out.fingerprint != null && out.device_fingerprint == null) {
    out.device_fingerprint = out.fingerprint;
  }
  return out;
}

async function postJson(url, payload) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(expandDeviceKeys(payload) ?? {}),
  });
  const body = await readJson(res);
  return { res, body };
}

/**
 * Hard subscription verification. Always hits the backend.
 * @param {string} deviceId
 * @param {string} deviceFingerprint
 */
export async function verifySubscription(deviceId, deviceFingerprint) {
  const url = `${API}/subscription/verify`;
  console.log('[SUBSCRIPTION_VERIFY]', 'request', { url, deviceId: String(deviceId).slice(0, 8) });
  try {
    const { res, body } = await postJson(url, {
      device_id: deviceId,
      device_fingerprint: deviceFingerprint,
    });
    if (!res.ok) {
      console.log('[SUBSCRIPTION_VERIFY]', 'failed', res.status, body);
      return { active: false, expiresAt: null, error: `HTTP ${res.status}`, raw: body };
    }
    const out = normalizeVerifyResponse(body);
    console.log('[SUBSCRIPTION_VERIFY]', 'response', { active: out.active, expiresAt: out.expiresAt });
    return out;
  } catch (e) {
    console.log('[SUBSCRIPTION_VERIFY]', 'error', e?.message ?? e);
    return { active: false, expiresAt: null, error: String(e?.message ?? e) };
  }
}

/**
 * Reinstall recovery — ask the backend if any active subscription is
 * bound to this device. Backend matches by deviceId / fingerprint and
 * returns the live active flag.
 */
export async function recoverSubscription(deviceId, deviceFingerprint) {
  const url = `${API}/subscription/recover`;
  console.log('[SUBSCRIPTION_RECOVER]', 'request', { url });
  try {
    const { res, body } = await postJson(url, {
      device_id: deviceId,
      device_fingerprint: deviceFingerprint,
    });
    if (!res.ok) {
      console.log('[SUBSCRIPTION_RECOVER]', 'failed', res.status);
      return { active: false, expiresAt: null, error: `HTTP ${res.status}` };
    }
    const out = normalizeVerifyResponse(body);
    console.log('[SUBSCRIPTION_RECOVER]', 'response', { active: out.active, expiresAt: out.expiresAt });
    return out;
  } catch (e) {
    console.log('[SUBSCRIPTION_RECOVER]', 'error', e?.message ?? e);
    return { active: false, expiresAt: null, error: String(e?.message ?? e) };
  }
}

/**
 * Initiate a transfer FROM the calling device. Returns a one-time code
 * that the destination device redeems. Source device retains access
 * until the transfer completes.
 */
export async function initiateTransfer(deviceId, deviceFingerprint) {
  const url = `${API}/subscription/transfer/initiate`;
  console.log('[TRANSFER_INITIATE]', 'request', { url });
  const { res, body } = await postJson(url, {
    device_id: deviceId,
    device_fingerprint: deviceFingerprint,
  });
  if (!res.ok) {
    const reason = body?.error ?? body?.message ?? `HTTP ${res.status}`;
    console.log('[TRANSFER_INITIATE]', 'failed', reason);
    throw new Error(String(reason));
  }
  const code = pickTransferCode(body);
  if (!code) throw new Error('Transfer code missing in response');
  console.log('[TRANSFER_INITIATE]', 'response', { code, raw: body });
  return {
    code,
    expiresAt: pickExpiresAt(body),
    raw: body,
  };
}

/**
 * Redeem a transfer code on the destination device.
 */
export async function redeemTransfer(code, deviceId, deviceFingerprint) {
  const url = `${API}/subscription/transfer/redeem`;
  console.log('[TRANSFER_REDEEM]', 'request', { url, code });
  const { res, body } = await postJson(url, {
    code: String(code).trim(),
    device_id: deviceId,
    device_fingerprint: deviceFingerprint,
  });
  if (!res.ok) {
    const reason = body?.error ?? body?.message ?? `HTTP ${res.status}`;
    console.log('[TRANSFER_REDEEM]', 'failed', reason);
    throw new Error(String(reason));
  }
  const out = normalizeVerifyResponse(body);
  console.log('[TRANSFER_REDEEM]', 'response', { active: out.active, expiresAt: out.expiresAt });
  return out;
}

/**
 * Respond to a `transfer_requested` SSE event on the SOURCE device.
 * @param {'approve'|'reject'} decision
 */
export async function respondToTransfer(code, decision) {
  const url = `${API}/transfer/respond`;
  console.log('[TRANSFER_RESPOND]', 'request', { url, code, decision });
  const { res, body } = await postJson(url, {
    code: String(code).trim(),
    decision: String(decision).toLowerCase(),
  });
  if (!res.ok) {
    const reason = body?.error ?? body?.message ?? `HTTP ${res.status}`;
    console.log('[TRANSFER_RESPOND]', 'failed', reason);
    throw new Error(String(reason));
  }
  console.log('[TRANSFER_RESPOND]', 'response', body);
  return body ?? {};
}

/**
 * Optional polling for the source device while it shows "transfer in progress".
 */
export async function getTransferStatus(code) {
  const url = `${API}/subscription/transfer/${encodeURIComponent(String(code).trim())}`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  const body = await readJson(res);
  if (!res.ok) {
    if (res.status === 404) return { status: 'unknown', raw: body };
    throw new Error(body?.error ?? body?.message ?? `HTTP ${res.status}`);
  }
  return body ?? {};
}

/* -----------------------------------------------------------------
 * Local cache (UI hint only — never used for trust decisions).
 * ----------------------------------------------------------------- */

export async function readSubscriptionCache() {
  try {
    const [active, expiresAt, deviceId, fingerprint, revokedAt] = await Promise.all([
      AsyncStorage.getItem(SUB_CACHE_KEYS.active),
      AsyncStorage.getItem(SUB_CACHE_KEYS.expiresAt),
      AsyncStorage.getItem(SUB_CACHE_KEYS.deviceId),
      AsyncStorage.getItem(SUB_CACHE_KEYS.fingerprint),
      AsyncStorage.getItem(SUB_CACHE_KEYS.revokedAt),
    ]);
    return {
      active: active === '1',
      expiresAt: expiresAt || null,
      deviceId: deviceId || null,
      fingerprint: fingerprint || null,
      revokedAt: revokedAt || null,
    };
  } catch {
    return { active: false, expiresAt: null, deviceId: null, fingerprint: null, revokedAt: null };
  }
}

export async function writeSubscriptionCache({ active, expiresAt, deviceId, fingerprint }) {
  try {
    await AsyncStorage.multiSet([
      [SUB_CACHE_KEYS.active, active ? '1' : '0'],
      [SUB_CACHE_KEYS.expiresAt, expiresAt ? String(expiresAt) : ''],
      [SUB_CACHE_KEYS.deviceId, deviceId ? String(deviceId) : ''],
      [SUB_CACHE_KEYS.fingerprint, fingerprint ? String(fingerprint) : ''],
    ]);
  } catch {}
}

export async function clearSubscriptionCache(reason = 'unknown') {
  try {
    await AsyncStorage.multiRemove([
      SUB_CACHE_KEYS.active,
      SUB_CACHE_KEYS.expiresAt,
      SUB_CACHE_KEYS.deviceId,
      SUB_CACHE_KEYS.fingerprint,
    ]);
    await AsyncStorage.setItem(SUB_CACHE_KEYS.revokedAt, new Date().toISOString());
    console.log('[SUBSCRIPTION_CACHE]', 'cleared', { reason });
  } catch {}
}
