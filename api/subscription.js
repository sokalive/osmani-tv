import AsyncStorage from '@react-native-async-storage/async-storage';
import { BASE_URL } from '../api';

/**
 * Device-bound subscription HTTP client.
 *
 * Single source of truth: the backend's `active` field.
 * The app NEVER compares `expires_at` against the device clock.
 *
 * Simple device-transfer flow (no approve/reject handshake):
 *   1. Source calls /api/transfer/request, receives a one-time code.
 *   2. Target calls /api/transfer/confirm with the code.
 *   3. Backend rebinds ownership to target on success.
 *   4. Target calls /api/subscription/verify to confirm activation.
 *   5. Source loses access automatically — its next foreground reverify
 *      (or the broadcast `transfer_completed` / `subscription_revoked`
 *      SSE event, when present) returns active=false.
 *
 * Endpoints (production /api):
 *   POST /api/subscription/verify   { device_id, device_fingerprint }
 *   POST /api/subscription/recover  { device_id, device_fingerprint }
 *   POST /api/transfer/request      { source_device_id, target_device_id, phone? }
 *   POST /api/transfer/confirm      { code, target_device_id, device_fingerprint }
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

/**
 * Extract the subscription start timestamp. Backends may name this many
 * things, and some never include it. Caller MUST be prepared to derive it
 * from `expiresAt - planDurationDays` when missing.
 */
function pickStartedAt(body) {
  if (!isPlainObject(body)) return null;
  const data = isPlainObject(body.data) ? body.data : null;
  const sub = isPlainObject(body.subscription) ? body.subscription : null;
  const pay = isPlainObject(body.payment) ? body.payment : null;
  const v =
    body.started_at ??
    body.startedAt ??
    body.start_at ??
    body.startAt ??
    body.activated_at ??
    body.activatedAt ??
    body.paid_at ??
    body.paidAt ??
    body.payment_date ??
    body.paymentDate ??
    body.created_at ??
    body.createdAt ??
    data?.started_at ??
    data?.startedAt ??
    data?.paid_at ??
    data?.paidAt ??
    data?.created_at ??
    data?.createdAt ??
    sub?.started_at ??
    sub?.startedAt ??
    sub?.activated_at ??
    sub?.activatedAt ??
    sub?.created_at ??
    sub?.createdAt ??
    pay?.paid_at ??
    pay?.paidAt ??
    pay?.created_at ??
    pay?.createdAt ??
    null;
  return v != null ? String(v) : null;
}

function pickServerTime(body) {
  if (!isPlainObject(body)) return null;
  const data = isPlainObject(body.data) ? body.data : null;
  const v =
    body.server_time ??
    body.serverTime ??
    body.now ??
    body.timestamp ??
    data?.server_time ??
    data?.serverTime ??
    data?.now ??
    null;
  return v != null ? String(v) : null;
}

function pickNumber(...candidates) {
  for (const c of candidates) {
    if (c == null) continue;
    const n = typeof c === 'number' ? c : Number(c);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function pickAmount(body) {
  if (!isPlainObject(body)) return null;
  const data = isPlainObject(body.data) ? body.data : null;
  const sub = isPlainObject(body.subscription) ? body.subscription : null;
  const plan = isPlainObject(body.plan) ? body.plan : null;
  const subPlan = isPlainObject(sub?.plan) ? sub.plan : null;
  const pay = isPlainObject(body.payment) ? body.payment : null;
  return pickNumber(
    body.amount,
    body.price,
    data?.amount,
    data?.price,
    sub?.amount,
    sub?.price,
    plan?.price,
    plan?.amount,
    subPlan?.price,
    subPlan?.amount,
    pay?.amount,
    pay?.price,
  );
}

function pickPlan(body) {
  if (!isPlainObject(body)) return null;
  const data = isPlainObject(body.data) ? body.data : null;
  const sub = isPlainObject(body.subscription) ? body.subscription : null;
  return (
    (isPlainObject(body.plan) && body.plan) ||
    (isPlainObject(sub?.plan) && sub.plan) ||
    (isPlainObject(data?.plan) && data.plan) ||
    null
  );
}

function pickPlans(body) {
  if (!isPlainObject(body)) return [];
  const data = isPlainObject(body.data) ? body.data : null;
  const candidates = [body.plans, body.available_plans, body.availablePlans, data?.plans];
  for (const c of candidates) {
    if (Array.isArray(c) && c.length > 0) return c;
  }
  return [];
}

function pickCurrency(body) {
  if (!isPlainObject(body)) return null;
  const data = isPlainObject(body.data) ? body.data : null;
  const sub = isPlainObject(body.subscription) ? body.subscription : null;
  const plan = isPlainObject(body.plan) ? body.plan : null;
  const v =
    body.currency ??
    body.currency_code ??
    body.currencyCode ??
    data?.currency ??
    sub?.currency ??
    plan?.currency ??
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
    return {
      active: false,
      expiresAt: null,
      startedAt: null,
      serverTime: null,
      amount: null,
      currency: null,
      planName: null,
      planDurationDays: null,
      plans: [],
      raw: body,
      ...fallback,
    };
  }
  const plan = pickPlan(body);
  const planName = plan?.name ?? plan?.title ?? body.plan_name ?? body.planName ?? null;
  const planDurationDays = pickNumber(
    plan?.duration_days,
    plan?.durationDays,
    plan?.days,
    body.duration_days,
    body.durationDays,
  );
  return {
    active: pickActive(body),
    expiresAt: pickExpiresAt(body),
    startedAt: pickStartedAt(body),
    serverTime: pickServerTime(body),
    amount: pickAmount(body),
    currency: pickCurrency(body),
    planName: planName != null ? String(planName) : null,
    planDurationDays,
    plans: pickPlans(body),
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
 * Strip / re-add the "TR-" prefix used by the backend's transfer codes.
 * The mobile UI accepts a 6-digit code, while the backend issues
 * `TR-XXXXXX`. We normalize at the API boundary so neither side cares.
 */
function stripTransferPrefix(raw) {
  return String(raw || '').trim().replace(/^TR[\s\-_]*/i, '');
}

function ensureTransferPrefix(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  return /^TR[-_]/i.test(s) ? s.toUpperCase().replace(/^TR[_]/, 'TR-') : `TR-${s}`;
}

/**
 * Best-effort extraction of cooldown metadata from a `/transfer/request`
 * error response. Backends key this many ways — we accept all known
 * variants and the HTTP `Retry-After` header.
 *
 * Returns `null` when the response is not a cooldown rejection.
 * Otherwise returns `{ cooldownUntilMs, retryAfterSec, cooldownUntilIso }`.
 *
 * The `cooldownUntilMs` value is anchored to the local `Date.now()` at
 * the instant of the response when only a duration is supplied (so the
 * UI countdown stays in sync with whatever the backend told us, even
 * across SSE/connection drops).
 */
export function extractTransferCooldown(body, statusCode, headers) {
  const errStr = String(body?.error ?? body?.message ?? '').toLowerCase();
  const matchesText = errStr.includes('cooldown') || errStr.includes('subiri');
  const retryAfterSec = pickNumber(
    body?.retry_after,
    body?.retryAfter,
    body?.retry_in,
    body?.retryIn,
    body?.cooldown_seconds,
    body?.cooldownSeconds,
    body?.cooldown_remaining,
    body?.cooldownRemaining,
    body?.seconds_remaining,
    body?.secondsRemaining,
    body?.cooldown?.seconds,
    body?.cooldown?.remaining,
  );
  const cooldownUntilIso = (() => {
    const v =
      body?.cooldown_until ??
      body?.cooldownUntil ??
      body?.cooldown_expires_at ??
      body?.cooldownExpiresAt ??
      body?.retry_at ??
      body?.retryAt ??
      body?.cooldown?.until ??
      body?.cooldown?.expires_at ??
      null;
    return v != null ? String(v) : null;
  })();
  let headerRetryAfterSec = null;
  try {
    if (headers && typeof headers.get === 'function') {
      const ra = headers.get('Retry-After') ?? headers.get('retry-after');
      if (ra) {
        const n = Number(ra);
        if (Number.isFinite(n)) {
          headerRetryAfterSec = n;
        } else {
          // HTTP date format
          const t = Date.parse(String(ra));
          if (Number.isFinite(t)) {
            headerRetryAfterSec = Math.max(0, Math.round((t - Date.now()) / 1000));
          }
        }
      }
    }
  } catch {}
  const looksLikeCooldown =
    matchesText ||
    statusCode === 429 ||
    retryAfterSec != null ||
    cooldownUntilIso != null ||
    headerRetryAfterSec != null;
  if (!looksLikeCooldown) return null;
  let cooldownUntilMs = null;
  if (cooldownUntilIso) {
    const t = Date.parse(cooldownUntilIso);
    if (Number.isFinite(t)) cooldownUntilMs = t;
  }
  if (cooldownUntilMs == null && retryAfterSec != null) {
    cooldownUntilMs = Date.now() + Math.max(0, retryAfterSec) * 1000;
  }
  if (cooldownUntilMs == null && headerRetryAfterSec != null) {
    cooldownUntilMs = Date.now() + Math.max(0, headerRetryAfterSec) * 1000;
  }
  return {
    cooldownUntilMs,
    retryAfterSec: retryAfterSec ?? headerRetryAfterSec ?? null,
    cooldownUntilIso,
  };
}

/**
 * Initiate a transfer FROM the calling device. Returns a one-time code
 * that the destination device confirms. The current device is treated
 * as the source; backend rebinds ownership to the actual `target_device_id`
 * passed at confirm time.
 *
 * Backend route: POST /api/transfer/request
 *
 * On a cooldown rejection (the backend enforces a per-device transfer
 * cooldown — duration is admin-configurable and entirely backend-side)
 * we throw a structured Error with `code === 'TRANSFER_COOLDOWN'` and
 * `cooldownUntilMs` / `retryAfterSec` so the UI can render a live
 * countdown anchored to the backend's authoritative expiry.
 */
export async function initiateTransfer(deviceId, deviceFingerprint, phone = '') {
  const url = `${API}/transfer/request`;
  console.log('[TRANSFER_REQUEST]', 'request', { url });
  const payload = {
    source_device_id: deviceId,
    // The source device doesn't yet know the target id. Backend rebinds
    // ownership to whatever `target_device_id` is presented at confirm.
    target_device_id: deviceId,
    device_id: deviceId,
    device_fingerprint: deviceFingerprint,
  };
  const normalizedPhone = String(phone || '').replace(/[^\d]/g, '');
  if (normalizedPhone) {
    payload.phone = normalizedPhone;
    payload.payment_phone = normalizedPhone;
  }
  const { res, body } = await postJson(url, payload);
  if (!res.ok) {
    const reason = body?.error ?? body?.message ?? `HTTP ${res.status}`;
    const cooldown = extractTransferCooldown(body, res.status, res.headers);
    if (cooldown) {
      console.log('[TRANSFER_REQUEST]', 'cooldown', {
        cooldownUntilMs: cooldown.cooldownUntilMs,
        retryAfterSec: cooldown.retryAfterSec,
        cooldownUntilIso: cooldown.cooldownUntilIso,
        backendMessage: reason,
      });
      const err = new Error(String(reason));
      err.code = 'TRANSFER_COOLDOWN';
      err.cooldownUntilMs = cooldown.cooldownUntilMs;
      err.retryAfterSec = cooldown.retryAfterSec;
      err.cooldownUntilIso = cooldown.cooldownUntilIso;
      err.raw = body;
      throw err;
    }
    console.log('[TRANSFER_REQUEST]', 'failed', reason);
    throw new Error(String(reason));
  }
  const rawCode = pickTransferCode(body);
  if (!rawCode) throw new Error('Transfer code missing in response');
  // Strip the "TR-" prefix so the existing 6-digit modal display + input
  // keeps working unchanged. We re-add the prefix at confirm time.
  const stripped = stripTransferPrefix(rawCode);
  const expiresAt = pickExpiresAt(body) ?? body?.expires_at ?? null;
  console.log('[TRANSFER_REQUEST]', 'response', {
    code: stripped || rawCode,
    expiresAt,
    transferMode: body?.transfer_mode ?? null,
  });
  return {
    code: stripped || rawCode,
    expiresAt,
    raw: body,
  };
}

/**
 * Confirm / redeem a transfer code on the destination device.
 *
 * Simple direct-activation flow: the backend rebinds ownership to the
 * target device immediately on successful confirm. We then re-issue
 * /api/subscription/verify so the authoritative `active` answer comes
 * straight from the backend (never the confirm body alone).
 *
 * Backend route: POST /api/transfer/confirm
 */
export async function redeemTransfer(code, deviceId, deviceFingerprint) {
  const url = `${API}/transfer/confirm`;
  const codeWithPrefix = ensureTransferPrefix(code);
  console.log('[TRANSFER_CONFIRM]', 'request', { url, code: codeWithPrefix });
  const { res, body } = await postJson(url, {
    code: codeWithPrefix,
    target_device_id: deviceId,
    device_id: deviceId,
    device_fingerprint: deviceFingerprint,
  });
  if (!res.ok) {
    const reason = body?.error ?? body?.message ?? `HTTP ${res.status}`;
    console.log('[TRANSFER_CONFIRM]', 'failed', reason);
    throw new Error(String(reason));
  }
  // Always reverify against the canonical /subscription/verify so the
  // `active` answer is the backend's, not a possibly-stale confirm body.
  let verified = null;
  try {
    verified = await verifySubscription(deviceId, deviceFingerprint);
  } catch (e) {
    console.log('[TRANSFER_CONFIRM]', 'verify_failed', e?.message ?? e);
  }
  if (verified && verified.active === true) {
    console.log('[TRANSFER_CONFIRM]', 'response', {
      active: true,
      expiresAt: verified.expiresAt,
    });
    return { ...verified, status: 'active' };
  }
  // Some backends already activate inside the confirm response itself;
  // accept it as a fallback only when verify hasn't yet caught up.
  const confirmedActiveSignal =
    body?.ok === true ||
    body?.success === true ||
    body?.active === true ||
    body?.is_active === true;
  if (confirmedActiveSignal) {
    const out = normalizeVerifyResponse(body);
    console.log('[TRANSFER_CONFIRM]', 'response', {
      active: true,
      expiresAt: out.expiresAt,
      source: 'confirm-body',
    });
    return { ...out, active: true, status: 'active' };
  }
  console.log('[TRANSFER_CONFIRM]', 'response', { active: false, status: 'inactive' });
  return { ...normalizeVerifyResponse(body), active: false, status: 'inactive' };
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
