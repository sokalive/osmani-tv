import AsyncStorage from '@react-native-async-storage/async-storage';
import { resolveApiBaseUrl } from '../lib/apiBaseUrl';
import {
  fetchAdminApiResponse,
  isNetworkTransportError,
  SUBSCRIPTION_API_TIMEOUT_MS,
} from '../lib/catalogApiFetch';
import { isTransientServerError } from '../lib/catalogConnectivity';
import { LEGACY_ANDROID_PACKAGE } from '../lib/deviceIdentity';
import { cacheSecurityPhone, getSecurityPhoneForReport, pickPhoneFromApiBody } from '../lib/security/securityPhone';
import { formatTanzaniaPhoneForApi, normalizeTanzaniaMobilePhone } from '../lib/tanzaniaPhone';
import { createTransferRequestError } from '../lib/transferRequestErrors';

/**
 * Device-bound subscription HTTP client.
 *
 * Single source of truth: the backend's `active` field.
 * The app NEVER compares `expires_at` against the device clock.
 *
 * Endpoints (production /api):
 *   POST /api/subscription/verify   { device_id, device_fingerprint }
 *   POST /api/subscription/recover  { device_id, device_fingerprint }
 *   POST /api/subscription/acknowledge-manual-gift { device_id, device_fingerprint, manual_gift_ack_key }
 *   POST /api/subscription/redeem-offer-code { device_id, device_fingerprint, offer_code }
 *   POST /api/transfer/request      { source_device_id, target_device_id, phone? }
 *   POST /api/transfer/confirm      { code, target_device_id, device_fingerprint }
 *   GET  /api/subscription/transfer/:code
 *   POST /api/transfer/respond      { code, decision }
 */

function apiRoot() {
  return `${resolveApiBaseUrl().replace(/\/+$/, '')}/api`;
}

/** @param {unknown} result */
export function isSubscriptionTransportFailure(result) {
  if (!result?.error) return false;
  const err = result.error;
  return isNetworkTransportError(err) || isTransientServerError(err);
}

function pickInactiveReason(body) {
  if (!isPlainObject(body)) return null;
  const data = isPlainObject(body.data) ? body.data : null;
  const sub = isPlainObject(body.subscription) ? body.subscription : null;
  const candidates = [
    body.reason,
    body.inactive_reason,
    body.inactiveReason,
    body.revoke_reason,
    body.revokeReason,
    body.status,
    data?.reason,
    data?.inactive_reason,
    data?.inactiveReason,
    data?.status,
    sub?.reason,
    sub?.status,
  ];
  for (const c of candidates) {
    if (c != null && String(c).trim() !== '') return String(c).trim();
  }
  return null;
}

function subscriptionHttpFailureResult(status, body) {
  const error = `HTTP ${status}`;
  if (isTransientServerError(error)) {
    return {
      active: false,
      expiresAt: null,
      error,
      raw: body,
      resolveSource: 'transport:http',
    };
  }
  return { active: false, expiresAt: null, error, raw: body };
}

export const SUB_CACHE_KEYS = Object.freeze({
  active: 'osmani:sub:active',
  expiresAt: 'osmani:sub:expires_at',
  deviceId: 'osmani:sub:device_id',
  fingerprint: 'osmani:sub:fingerprint',
  revokedAt: 'osmani:sub:revoked_at',
  planSnapshot: 'osmani:sub:plan_snapshot',
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
    body.has_subscription,
    body.hasSubscription,
    body.subscribed,
    data?.active,
    data?.is_active,
    data?.isActive,
    data?.has_subscription,
    data?.hasSubscription,
    data?.subscribed,
    sub?.active,
    sub?.is_active,
    sub?.isActive,
    sub?.has_subscription,
    sub?.subscribed,
  ];
  for (const c of candidates) {
    if (c === true || c === 1 || c === '1' || c === 'true') return true;
    if (c === false || c === 0 || c === '0' || c === 'false') return false;
  }
  const status = String(body.status ?? data?.status ?? sub?.status ?? '').toLowerCase();
  if (['active', 'paid', 'live', 'ok'].includes(status)) return true;
  const rem = Number(
    body.remaining_seconds ??
      body.remainingSeconds ??
      data?.remaining_seconds ??
      data?.remainingSeconds ??
      sub?.remaining_seconds ??
      sub?.remainingSeconds ??
      0,
  );
  return Number.isFinite(rem) && rem > 0;
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

/** `data.subscription` wrapper shape some verify payloads use */
function pickDataSubscription(body) {
  if (!isPlainObject(body)) return null;
  const data = isPlainObject(body.data) ? body.data : null;
  return isPlainObject(data?.subscription) ? data.subscription : null;
}

function pickPriceFromPlanRow(planRow) {
  if (!isPlainObject(planRow)) return null;
  return pickNumber(planRow.price, planRow.amount, planRow.Price, planRow.Amount);
}

function pickPlanId(body) {
  if (!isPlainObject(body)) return null;
  const data = isPlainObject(body.data) ? body.data : null;
  const sub = isPlainObject(body.subscription) ? body.subscription : null;
  const dataSub = pickDataSubscription(body);
  const plan = pickPlan(body);
  return pickTruthyString(
    plan?.id,
    plan?.plan_id,
    plan?.planId,
    sub?.plan_id,
    sub?.planId,
    dataSub?.plan_id,
    dataSub?.planId,
    body.plan_id,
    body.planId,
    data?.plan_id,
    data?.planId,
  );
}

function pickResolvablePlanName(body) {
  if (!isPlainObject(body)) return null;
  const data = isPlainObject(body.data) ? body.data : null;
  const sub = isPlainObject(body.subscription) ? body.subscription : null;
  const dataSub = pickDataSubscription(body);
  const plan = pickPlan(body);
  return pickTruthyString(
    plan?.name,
    plan?.title,
    dataSub?.plan_name,
    dataSub?.planName,
    sub?.plan_name,
    sub?.planName,
    body.plan_name,
    body.planName,
    data?.plan_name,
    data?.planName,
  );
}

/** Canonical package price from the active subscription's linked plan record. */
function pickAmountFromLinkedPlan(body) {
  if (!isPlainObject(body)) return null;
  const data = isPlainObject(body.data) ? body.data : null;
  const sub = isPlainObject(body.subscription) ? body.subscription : null;
  const dataSub = pickDataSubscription(body);
  const dataSubPlan = isPlainObject(dataSub?.plan) ? dataSub.plan : null;
  const rootPlan = isPlainObject(body.plan) ? body.plan : null;
  const subPlan = isPlainObject(sub?.plan) ? sub.plan : null;
  const dataPlan = isPlainObject(data?.plan) ? data.plan : null;
  const pickedPlan = pickPlan(body);

  for (const mg of collectManualGiftObjects(body)) {
    const mgPlan = isPlainObject(mg?.plan) ? mg.plan : null;
    const fromGift = pickNumber(
      pickPriceFromPlanRow(mgPlan),
      mg?.plan_price,
      mg?.planPrice,
      mg?.package_price,
      mg?.packagePrice,
    );
    if (fromGift != null) return fromGift;
  }

  return pickNumber(
    pickPriceFromPlanRow(pickedPlan),
    pickPriceFromPlanRow(rootPlan),
    pickPriceFromPlanRow(subPlan),
    pickPriceFromPlanRow(dataSubPlan),
    pickPriceFromPlanRow(dataPlan),
    sub?.plan_price,
    sub?.planPrice,
    dataSub?.plan_price,
    dataSub?.planPrice,
    body.plan_price,
    body.planPrice,
    data?.plan_price,
    data?.planPrice,
  );
}

function pickAmountFromPlansCatalog(body) {
  const plans = pickPlans(body);
  if (!plans.length) return null;
  const wantId = pickPlanId(body);
  if (wantId) {
    for (const p of plans) {
      const id = String(p?.id ?? p?.plan_id ?? p?.planId ?? '').trim();
      if (id && id === wantId) {
        const price = pickPriceFromPlanRow(p);
        if (price != null) return price;
      }
    }
  }
  const wantName = pickResolvablePlanName(body);
  if (wantName) {
    const norm = wantName.trim().toLowerCase();
    for (const p of plans) {
      const label = String(p?.name ?? p?.title ?? '').trim().toLowerCase();
      if (label && label === norm) {
        const price = pickPriceFromPlanRow(p);
        if (price != null) return price;
      }
    }
  }
  if (plans.length === 1) {
    const price = pickPriceFromPlanRow(plans[0]);
    if (price != null) return price;
  }
  return null;
}

function pickDurationFromPlanRow(planRow) {
  if (!isPlainObject(planRow)) return null;
  return pickNumber(
    planRow.duration_days,
    planRow.durationDays,
    planRow.days,
    planRow.plan_duration_days,
    planRow.planDurationDays,
  );
}

function pickDurationFromPlansCatalog(body) {
  const plans = pickPlans(body);
  if (!plans.length) return null;
  const wantId = pickPlanId(body);
  if (wantId) {
    for (const p of plans) {
      const id = String(p?.id ?? p?.plan_id ?? p?.planId ?? '').trim();
      if (id && id === wantId) {
        const days = pickDurationFromPlanRow(p);
        if (days != null) return days;
      }
    }
  }
  const wantName = pickResolvablePlanName(body);
  if (wantName) {
    const norm = wantName.trim().toLowerCase();
    for (const p of plans) {
      const label = String(p?.name ?? p?.title ?? '').trim().toLowerCase();
      if (label && label === norm) {
        const days = pickDurationFromPlanRow(p);
        if (days != null) return days;
      }
    }
  }
  if (plans.length === 1) {
    const days = pickDurationFromPlanRow(plans[0]);
    if (days != null) return days;
  }
  return null;
}

/** Canonical package duration from active subscription plan_id/name + plans catalog. */
function pickPlanDurationDays(body) {
  if (!isPlainObject(body)) return null;

  const catalogDays = pickDurationFromPlansCatalog(body);
  if (catalogDays != null) return catalogDays;

  const nestedSub = pickDataSubscription(body);
  const subRoot = isPlainObject(body.subscription) ? body.subscription : null;
  const data = isPlainObject(body.data) ? body.data : null;
  const plan = pickPlan(body);

  return pickNumber(
    plan?.duration_days,
    plan?.durationDays,
    plan?.days,
    plan?.plan_duration_days,
    plan?.planDurationDays,
    nestedSub?.plan_duration_days,
    nestedSub?.planDurationDays,
    nestedSub?.duration_days,
    subRoot?.plan_duration_days,
    subRoot?.planDurationDays,
    subRoot?.duration_days,
    body.plan_duration_days,
    body.planDurationDays,
    data?.plan_duration_days,
    data?.planDurationDays,
    data?.duration_days,
    data?.durationDays,
    body.duration_days,
    body.durationDays,
  );
}

function pickAmount(body) {
  if (!isPlainObject(body)) return null;

  // Subscription plan_id/name + catalog beats stale embedded plan objects (common on admin grants).
  const catalogPrice = pickAmountFromPlansCatalog(body);
  if (catalogPrice != null) return catalogPrice;

  const linkedPlanPrice = pickAmountFromLinkedPlan(body);
  if (linkedPlanPrice != null) return linkedPlanPrice;

  const data = isPlainObject(body.data) ? body.data : null;
  const sub = isPlainObject(body.subscription) ? body.subscription : null;
  const dataSub = pickDataSubscription(body);
  const pay = isPlainObject(body.payment) ? body.payment : null;

  // Payment / transaction amount before generic subscription placeholders (e.g. admin manual `1000`).
  return pickNumber(
    pay?.amount,
    pay?.price,
    sub?.amount,
    sub?.price,
    dataSub?.amount,
    dataSub?.price,
    data?.amount,
    data?.price,
    body.amount,
    body.price,
  );
}

function pickPlan(body) {
  if (!isPlainObject(body)) return null;
  const data = isPlainObject(body.data) ? body.data : null;
  const sub = isPlainObject(body.subscription) ? body.subscription : null;
  const dataSub = pickDataSubscription(body);
  return (
    (isPlainObject(body.plan) && body.plan) ||
    (isPlainObject(sub?.plan) && sub.plan) ||
    (isPlainObject(data?.plan) && data.plan) ||
    (isPlainObject(dataSub?.plan) && dataSub.plan) ||
    null
  );
}

function pickPlans(body) {
  if (!isPlainObject(body)) return [];
  const data = isPlainObject(body.data) ? body.data : null;
  const dataSub = pickDataSubscription(body);
  const candidates = [
    body.plans,
    body.available_plans,
    body.availablePlans,
    data?.plans,
    dataSub?.plans,
  ];
  for (const c of candidates) {
    if (Array.isArray(c) && c.length > 0) return c;
  }
  return [];
}

function pickCurrency(body) {
  if (!isPlainObject(body)) return null;
  const data = isPlainObject(body.data) ? body.data : null;
  const sub = isPlainObject(body.subscription) ? body.subscription : null;
  const dataSub = pickDataSubscription(body);
  const dataSubPlan = isPlainObject(dataSub?.plan) ? dataSub.plan : null;
  const plan = isPlainObject(body.plan) ? body.plan : null;
  const v =
    body.currency ??
    body.currency_code ??
    body.currencyCode ??
    data?.currency ??
    sub?.currency ??
    dataSub?.currency ??
    dataSubPlan?.currency ??
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

function pickTruthyString(...vals) {
  for (const v of vals) {
    if (v == null || v === '') continue;
    const s = String(v).trim();
    if (s !== '') return s;
  }
  return null;
}

function collectManualGiftObjects(body) {
  if (!isPlainObject(body)) return [];
  const data = isPlainObject(body.data) ? body.data : null;
  const subRoot = isPlainObject(body.subscription) ? body.subscription : null;
  const nestedSub = pickDataSubscription(body);
  const pay = isPlainObject(body.payment) ? body.payment : null;
  const list = [];
  const push = (x) => {
    if (isPlainObject(x)) list.push(x);
  };
  push(body.manualGift);
  push(body.manual_gift);
  push(data?.manualGift);
  push(data?.manual_gift);
  push(subRoot?.manualGift);
  push(subRoot?.manual_gift);
  push(nestedSub?.manualGift);
  push(nestedSub?.manual_gift);
  push(pay?.manualGift);
  push(pay?.manual_gift);
  return list;
}

/**
 * Build ack key from backend `manualGift` object (admin grant payload).
 */
function ackKeyFromManualGiftObject(mg) {
  if (!isPlainObject(mg)) return null;
  const id = pickTruthyString(
    mg.id,
    mg._id,
    mg.grant_id,
    mg.grantId,
    mg.gift_id,
    mg.giftId,
    mg.subscription_gift_id,
    mg.subscriptionGiftId,
    mg.manual_gift_id,
    mg.manualGiftId,
  );
  const version = pickNumber(
    mg.version,
    mg.grant_version,
    mg.grantVersion,
    mg.manual_gift_version,
    mg.manualGiftVersion,
  );
  if (id) {
    return version != null ? `${id}:${version}` : String(id);
  }
  if (version != null) {
    return `manual_gift:${version}`;
  }
  const created = pickTruthyString(mg.created_at, mg.createdAt, mg.granted_at, mg.grantedAt);
  const exp = pickTruthyString(mg.expires_at, mg.expiresAt);
  if (created || exp) {
    return `manual_gift_meta:${created ?? ''}:${exp ?? ''}`;
  }
  return null;
}

/**
 * Stable key for admin-applied manual subscription gifts. Must change when the
 * backend issues a NEW gift so the app can show the one-time congratulations again.
 */
function pickManualGiftAckKey(body) {
  if (!isPlainObject(body)) return null;
  const data = isPlainObject(body.data) ? body.data : null;
  const sub = isPlainObject(body.subscription) ? body.subscription : null;
  const nestedSub = pickDataSubscription(body);
  const pay = isPlainObject(body.payment) ? body.payment : null;

  const giftObjs = collectManualGiftObjects(body);
  for (const mg of giftObjs) {
    const k = ackKeyFromManualGiftObject(mg);
    if (k) {
      if (__DEV__) console.log('[MANUAL_GIFT]', 'pick_ack_key_from_manualGift_object', { key: k });
      return k;
    }
  }

  const stringGiftId = pickTruthyString(
    typeof body.manualGift === 'string' ? body.manualGift : '',
    typeof body.manual_gift === 'string' ? body.manual_gift : '',
    typeof data?.manualGift === 'string' ? data.manualGift : '',
    typeof data?.manual_gift === 'string' ? data.manual_gift : '',
  );
  if (stringGiftId) {
    if (__DEV__) console.log('[MANUAL_GIFT]', 'pick_ack_key_from_string_manualGift', { key: stringGiftId });
    return stringGiftId;
  }

  const explicitId = pickTruthyString(
    body.manual_gift_id,
    body.manualGiftId,
    body.admin_manual_gift_id,
    body.adminManualGiftId,
    body.subscription_gift_id,
    body.subscriptionGiftId,
    data?.manual_gift_id,
    data?.manualGiftId,
    sub?.manual_gift_id,
    sub?.manualGiftId,
    nestedSub?.manual_gift_id,
    nestedSub?.manualGiftId,
    pay?.manual_gift_id,
    pay?.manualGiftId,
  );

  const version = pickNumber(
    body.manual_gift_version,
    body.manualGiftVersion,
    body.gift_version,
    body.giftVersion,
    data?.manual_gift_version,
    data?.manualGiftVersion,
    sub?.manual_gift_version,
    nestedSub?.manual_gift_version,
    pay?.manual_gift_version,
  );

  const flag =
    body.manualGift === true ||
    data?.manualGift === true ||
    body.manual_subscription_gift === true ||
    body.manualSubscriptionGift === true ||
    body.is_manual_subscription_gift === true ||
    body.isManualSubscriptionGift === true ||
    data?.manual_subscription_gift === true ||
    sub?.manual_subscription_gift === true ||
    nestedSub?.manual_subscription_gift === true;

  if (!explicitId && version == null && !flag && giftObjs.length === 0) return null;

  if (explicitId) {
    const k = version != null ? `${explicitId}:${version}` : explicitId;
    if (__DEV__) console.log('[MANUAL_GIFT]', 'pick_ack_key_flat_id', { key: k });
    return k;
  }
  if (version != null) {
    const k = `manual_gift:${version}`;
    if (__DEV__) console.log('[MANUAL_GIFT]', 'pick_ack_key_version_only', { key: k });
    return k;
  }
  if (flag || giftObjs.length > 0) {
    const started = pickStartedAt(body);
    if (started) {
      const k = `manual_gift_started:${started}`;
      if (__DEV__) console.log('[MANUAL_GIFT]', 'pick_ack_key_flag_started', { key: k });
      return k;
    }
    const exp = pickExpiresAt(body);
    if (exp) {
      const k = `manual_gift_exp:${exp}`;
      if (__DEV__) console.log('[MANUAL_GIFT]', 'pick_ack_key_flag_exp', { key: k });
      return k;
    }
  }
  if (__DEV__ && (giftObjs.length > 0 || flag)) {
    console.log('[MANUAL_GIFT]', 'pick_ack_key_miss', {
      hasManualGiftObjects: giftObjs.length > 0,
      flag,
    });
  }
  return null;
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
      plan_duration_days: null,
      plans: [],
      manualGiftAckKey: null,
      phone: null,
      raw: body,
      ...fallback,
    };
  }
  const nestedSub = pickDataSubscription(body);
  const subRoot = isPlainObject(body.subscription) ? body.subscription : null;
  const data = isPlainObject(body.data) ? body.data : null;
  const plan = pickPlan(body);
  const planName =
    plan?.name ??
    plan?.title ??
    nestedSub?.plan_name ??
    nestedSub?.planName ??
    subRoot?.plan_name ??
    subRoot?.planName ??
    body.plan_name ??
    body.planName ??
    null;
  const planDurationDays = pickPlanDurationDays(body);
  const planId = pickPlanId(body);
  const active = pickActive(body);
  const inactiveReason = active ? null : pickInactiveReason(body);
  return {
    active,
    expiresAt: pickExpiresAt(body),
    startedAt: pickStartedAt(body),
    serverTime: pickServerTime(body),
    amount: pickAmount(body),
    currency: pickCurrency(body),
    planName: planName != null ? String(planName) : null,
    planId: planId != null ? String(planId) : null,
    planDurationDays,
    plan_duration_days: planDurationDays,
    plans: pickPlans(body),
    deviceId: pickStringList(body.device_id, body.deviceId),
    phone: pickPhoneFromApiBody(body),
    manualGiftAckKey: pickManualGiftAckKey(body),
    inactiveReason,
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

/**
 * Migration bridge for Render APK (com.osmantv.app) → VPS APK (com.burudanitv.app).
 * @param {string} deviceId
 * @param {string} deviceFingerprint
 * @param {object} [identityContext]
 */
function buildMigrationIdentityPayload(deviceId, deviceFingerprint, identityContext = {}) {
  const payload = {
    device_id: deviceId,
    device_fingerprint: deviceFingerprint,
    fingerprint: deviceFingerprint,
    current_device_id:
      identityContext.packageAndroidId ?? identityContext.current_device_id ?? deviceId,
    legacy_device_id:
      identityContext.legacyPackageAndroidId ?? identityContext.legacy_device_id ?? null,
    displayed_account_id:
      identityContext.displayedAccountId ??
      identityContext.packageAndroidId ??
      identityContext.current_device_id ??
      deviceId,
    android_id: identityContext.packageAndroidId ?? identityContext.androidId ?? deviceId,
    stable_hardware_id: identityContext.stableHardwareId ?? null,
    install_instance_id: identityContext.installInstanceId ?? null,
    package_name: identityContext.packageName ?? null,
    legacy_package_name: identityContext.legacyPackageName ?? LEGACY_ANDROID_PACKAGE,
    legacy_package: identityContext.legacyPackageName ?? LEGACY_ANDROID_PACKAGE,
  };
  if (identityContext.legacyDeviceFingerprint) {
    payload.legacy_device_fingerprint = identityContext.legacyDeviceFingerprint;
    payload.legacy_fingerprint = identityContext.legacyDeviceFingerprint;
  }
  if (identityContext.migration_bridge === true) {
    payload.migration_bridge = true;
  }
  if (identityContext.restore_role) payload.restore_role = identityContext.restore_role;
  if (identityContext.phone) payload.phone = identityContext.phone;
  return expandDeviceKeys(payload);
}

async function buildIdentityContext(identityContext = {}) {
  if (identityContext.phone) return identityContext;
  try {
    const phone = await getSecurityPhoneForReport();
    if (phone) return { ...identityContext, phone };
  } catch {
    /* ignore */
  }
  return identityContext;
}

async function postJson(path, payload, tag = 'subscription-post') {
  const pathSuffix = path.startsWith('/api/') ? path : `/api${path.startsWith('/') ? path : `/${path}`}`;
  const { res, parsed: body } = await fetchAdminApiResponse(pathSuffix, {
    method: 'POST',
    body: expandDeviceKeys(payload) ?? {},
    tag,
    timeoutMs: SUBSCRIPTION_API_TIMEOUT_MS,
  });
  return { res, body };
}

/**
 * Hard subscription verification. Always hits the backend.
 * @param {string} deviceId
 * @param {string} deviceFingerprint
 * @param {object} [identityContext]
 */
export async function verifySubscription(deviceId, deviceFingerprint, identityContext = {}) {
  const url = '/api/subscription/verify';
  const ctx = await buildIdentityContext(identityContext);
  console.log('[SUBSCRIPTION_VERIFY]', 'request', {
    url,
    deviceId: String(deviceId).slice(0, 8),
    packageName: ctx.packageName ?? null,
    legacyPackage: ctx.legacyPackageName ?? LEGACY_ANDROID_PACKAGE,
  });
  try {
    const { res, body } = await postJson(
      url,
      buildMigrationIdentityPayload(deviceId, deviceFingerprint, ctx),
      'subscription-verify',
    );
    if (!res.ok) {
      console.log('[SUBSCRIPTION_VERIFY]', 'failed', res.status, body);
      return subscriptionHttpFailureResult(res.status, body);
    }
    const out = normalizeVerifyResponse(body);
    if (out.phone) void cacheSecurityPhone(out.phone);
    console.log('[SUBSCRIPTION_VERIFY]', 'response', { active: out.active, expiresAt: out.expiresAt });
    console.log('[MANUAL_GIFT]', 'verify_subscription_payload', {
      manualGiftAckKey: out.manualGiftAckKey ?? null,
      active: out.active,
      rawManualGift:
        body?.manualGift ??
        body?.manual_gift ??
        body?.data?.manualGift ??
        body?.data?.manual_gift ??
        null,
    });
    if (__DEV__) {
      console.log('[ACCOUNT_DURATION]', 'verify_raw_shape', {
        root_plan_duration_days: body?.plan_duration_days,
        root_planDurationDays: body?.planDurationDays,
        data_plan_duration_days: body?.data?.plan_duration_days,
        data_planDurationDays: body?.data?.planDurationDays,
      });
      console.log('[ACCOUNT_DURATION]', 'verify_normalized', { planDurationDays: out.planDurationDays });
    }
    return out;
  } catch (e) {
    console.log('[SUBSCRIPTION_VERIFY]', 'error', e?.message ?? e);
    return { active: false, expiresAt: null, error: String(e?.message ?? e) };
  }
}

async function fetchSubscriptionStatus(deviceId) {
  const { res, body } = await fetchAdminApiResponse(
    `/api/subscription-status?device_id=${encodeURIComponent(deviceId)}`,
    { tag: 'subscription-status-recover', timeoutMs: SUBSCRIPTION_API_TIMEOUT_MS },
  );
  if (!res.ok) return null;
  return normalizeVerifyResponse(body);
}

async function refreshSubscriptionAfterRecover(deviceId, deviceFingerprint, identityContext = {}) {
  const ctx = await buildIdentityContext(identityContext);
  const verified = await verifySubscription(deviceId, deviceFingerprint, ctx).catch(() => null);
  if (verified?.active === true) return verified;
  if (
    ctx.legacyDeviceFingerprint &&
    ctx.legacyDeviceFingerprint !== deviceFingerprint
  ) {
    const legacyVerified = await verifySubscription(
      deviceId,
      ctx.legacyDeviceFingerprint,
      { ...ctx, packageName: ctx.legacyPackageName ?? LEGACY_ANDROID_PACKAGE },
    ).catch(() => null);
    if (legacyVerified?.active === true) return legacyVerified;
  }
  const status = await fetchSubscriptionStatus(deviceId);
  if (status?.active === true) return status;
  return null;
}

async function tryResolveForDeviceId(candidateDeviceId, identity, role) {
  const ctx = await buildIdentityContext({
    installInstanceId: identity.installInstanceId,
    packageName: identity.packageName,
    packageAndroidId: identity.packageAndroidId,
    legacyPackageAndroidId: identity.legacyPackageAndroidId,
    stableHardwareId: identity.stableHardwareId,
    displayedAccountId: identity.displayedAccountId,
    androidId: identity.androidId,
    legacyDeviceFingerprint: identity.legacyDeviceFingerprint,
    legacyPackageName: identity.legacyPackageName,
    migration_bridge: role !== 'package_android_id',
    restore_role: role,
  });

  const fingerprint =
    role === 'legacy_package_android_id' && identity.legacyDeviceFingerprint
      ? identity.legacyDeviceFingerprint
      : identity.deviceFingerprint;

  const verified = await verifySubscription(candidateDeviceId, fingerprint, ctx);
  if (verified.active === true) {
    return { ...verified, resolveSource: `verify:${role}`, restoreRole: role };
  }
  if (isSubscriptionTransportFailure(verified)) {
    return { ...verified, resolveSource: `transport:${role}`, restoreRole: role };
  }

  const recovered = await recoverSubscription(candidateDeviceId, fingerprint, ctx);
  if (recovered.active === true) {
    return { ...recovered, resolveSource: `recover:${role}`, restoreRole: role };
  }

  const statusAfter = await fetchSubscriptionStatus(candidateDeviceId);
  if (statusAfter?.active === true) {
    return { ...statusAfter, resolveSource: `status_after_recover:${role}`, restoreRole: role };
  }

  return null;
}

/**
 * Full resolve chain for package migration / reinstall — recover before giving up.
 */
export async function resolveActiveSubscription(identity) {
  const candidates = Array.isArray(identity.identityCandidates)
    ? identity.identityCandidates
    : [{ role: 'primary', deviceId: identity.deviceId }];

  console.log(
    '[SUBSCRIPTION_MIGRATION]',
    JSON.stringify({
      displayedAccountId: identity.displayedAccountId?.slice(0, 8) + '…',
      subscriptionDeviceId: identity.subscriptionDeviceId?.slice(0, 8) + '…',
      legacyPackageAndroidId: identity.legacyPackageAndroidId?.slice(0, 8) + '…' || null,
      stableHardwareId: identity.stableHardwareId?.slice(0, 12) + '…' || null,
      packageAndroidId: identity.packageAndroidId?.slice(0, 8) + '…' || null,
      candidateCount: candidates.length,
    }),
  );

  let lastInactive = null;
  for (const candidate of candidates) {
    const result = await tryResolveForDeviceId(candidate.deviceId, identity, candidate.role);
    if (!result) continue;
    if (result.active === true) {
      console.log(
        '[SUBSCRIPTION_RESTORE_RESULT]',
        JSON.stringify({
          active: true,
          resolveSource: result.resolveSource,
          restoreRole: result.restoreRole,
          deviceId: candidate.deviceId.slice(0, 8) + '…',
          expiresAt: result.expiresAt ?? null,
        }),
      );
      return result;
    }
    if (isSubscriptionTransportFailure(result)) {
      console.log(
        '[SUBSCRIPTION_RESTORE_RESULT]',
        JSON.stringify({
          active: false,
          transport: true,
          restoreRole: candidate.role,
          error: result.error ?? null,
        }),
      );
      return result;
    }
    lastInactive = result;
  }

  if (lastInactive && isSubscriptionTransportFailure(lastInactive)) {
    console.log(
      '[SUBSCRIPTION_RESTORE_RESULT]',
      JSON.stringify({
        active: false,
        transport: true,
        resolveSource: 'transport:last',
        error: lastInactive.error ?? null,
      }),
    );
    return { ...lastInactive, resolveSource: 'transport:last' };
  }

  const inactive = {
    active: false,
    expiresAt: null,
    resolveSource: 'inactive',
    ...(lastInactive ?? {}),
  };
  console.log(
    '[SUBSCRIPTION_RESTORE_RESULT]',
    JSON.stringify({
      active: false,
      resolveSource: 'inactive',
      candidateCount: candidates.length,
    }),
  );
  return inactive;
}

/**
 * Reinstall recovery — ask the backend if any active subscription is
 * bound to this device. Backend matches by deviceId / fingerprint and
 * returns the live active flag.
 * @param {object} [identityContext]
 */
export async function recoverSubscription(deviceId, deviceFingerprint, identityContext = {}) {
  const url = '/api/subscription/recover';
  const ctx = await buildIdentityContext(identityContext);
  console.log('[SUBSCRIPTION_RECOVER]', 'request', {
    url,
    deviceId: String(deviceId).slice(0, 8),
    packageName: ctx.packageName ?? null,
    legacyPackage: ctx.legacyPackageName ?? LEGACY_ANDROID_PACKAGE,
  });
  try {
    const { res, body } = await postJson(
      url,
      buildMigrationIdentityPayload(deviceId, deviceFingerprint, ctx),
      'subscription-recover',
    );
    if (!res.ok) {
      console.log('[SUBSCRIPTION_RECOVER]', 'failed', res.status);
      return subscriptionHttpFailureResult(res.status, body);
    }
    let out = normalizeVerifyResponse(body);
    const recoverAck =
      body?.ok === true ||
      body?.ok === 1 ||
      body?.ok === 'true' ||
      (body?.recovered_from != null && String(body.recovered_from).trim() !== '');
    if (recoverAck && out.active !== true) {
      const refreshed = await refreshSubscriptionAfterRecover(deviceId, deviceFingerprint, ctx);
      if (refreshed?.active === true) {
        out = { ...out, ...refreshed, active: true, recoverRefreshed: true };
        console.log('[SUBSCRIPTION_RECOVER]', 'refreshed_after_ok', {
          expiresAt: out.expiresAt,
          planName: out.planName ?? null,
        });
      }
    }
    if (out.phone) void cacheSecurityPhone(out.phone);
    console.log('[SUBSCRIPTION_RECOVER]', 'response', { active: out.active, expiresAt: out.expiresAt });
    console.log('[MANUAL_GIFT]', 'recover_payload', {
      manualGiftAckKey: out.manualGiftAckKey ?? null,
      active: out.active,
      rawManualGift:
        body?.manualGift ??
        body?.manual_gift ??
        body?.data?.manualGift ??
        body?.data?.manual_gift ??
        null,
    });
    if (__DEV__) {
      console.log('[ACCOUNT_DURATION]', 'recover_normalized', { planDurationDays: out.planDurationDays });
    }
    return out;
  } catch (e) {
    console.log('[SUBSCRIPTION_RECOVER]', 'error', e?.message ?? e);
    return { active: false, expiresAt: null, error: String(e?.message ?? e) };
  }
}

/**
 * Required acknowledgement for admin manual subscription gifts.
 * POST /api/subscription/acknowledge-manual-gift
 *
 * @param {string} manualGiftAckKey Same stable key as verify `manualGiftAckKey`.
 */
function mapOfferRedeemErrorMessage(body, httpStatus) {
  const msg = String(body?.error ?? body?.message ?? '').toLowerCase();
  const code = String(body?.code ?? body?.reason ?? '').toLowerCase();
  const t = `${msg} ${code}`;
  if (
    t.includes('already') ||
    t.includes('other_device') ||
    t.includes('other device') ||
    t.includes('imetumika') ||
    t.includes('kingine')
  ) {
    return 'Code hii tayari imetumika kwenye kifaa kingine';
  }
  if (t.includes('expired') || t.includes('expires') || t.includes('imeisha') || t.includes('muda wake')) {
    return 'Code hii imeisha muda wake';
  }
  if (t.includes('block') || t.includes('banned') || t.includes('zui') || t.includes('forbidden')) {
    return 'Code hii imezuiwa';
  }
  if (
    t.includes('invalid') ||
    t.includes('wrong') ||
    t.includes('si sahihi') ||
    httpStatus === 400 ||
    httpStatus === 404 ||
    httpStatus === 422
  ) {
    return 'Code si sahihi';
  }
  return 'Code si sahihi';
}

/**
 * Redeem admin offer code from Account screen.
 * POST /api/subscription/redeem-offer-code
 *
 * @returns {Promise<
 *   | { ok: true; raw: object }
 *   | { ok: false; locked: true; remainingSeconds: number; raw: object }
 *   | { ok: false; locked: false; message: string; raw: object }
 * >}
 */
export async function redeemOfferCode(deviceId, deviceFingerprint, offerCode) {
  const url = '/api/subscription/redeem-offer-code';
  const code = String(offerCode ?? '').trim();
  console.log('[OFFER_CODE]', 'redeem_try', { codeLen: code.length });
  try {
    const { res, body } = await postJson(url, {
      device_id: deviceId,
      device_fingerprint: deviceFingerprint,
      offer_code: code,
    });
    const plain = isPlainObject(body) ? body : {};
    if (res.ok) {
      console.log('[OFFER_CODE]', 'redeem_success', { status: res.status });
      return { ok: true, raw: plain };
    }
    if (plain.locked === true || plain.locked === 1 || plain.locked === 'true') {
      const rs = Number(plain.remaining_seconds ?? plain.remainingSeconds ?? 0);
      const remainingSeconds = Number.isFinite(rs) ? Math.max(0, Math.floor(rs)) : 0;
      console.log('[OFFER_CODE]', 'cooldown_active', { remaining_seconds: remainingSeconds });
      return {
        ok: false,
        locked: true,
        remainingSeconds,
        raw: plain,
      };
    }
    const message = mapOfferRedeemErrorMessage(plain, res.status);
    console.log('[OFFER_CODE]', 'redeem_fail', { status: res.status, message });
    return { ok: false, locked: false, message, raw: plain };
  } catch (e) {
    console.log('[OFFER_CODE]', 'redeem_fail', { error: String(e?.message ?? e) });
    throw e;
  }
}

export async function acknowledgeManualGift(deviceId, deviceFingerprint, manualGiftAckKey) {
  const url = '/api/subscription/acknowledge-manual-gift';
  const key = String(manualGiftAckKey ?? '').trim();
  console.log('[MANUAL_GIFT]', 'acknowledge_request', { url, keyPreview: key.slice(0, 24) });
  try {
    const { res, body } = await postJson(url, {
      device_id: deviceId,
      device_fingerprint: deviceFingerprint,
      manual_gift_ack_key: key,
      manualGiftAckKey: key,
      gift_ack_key: key,
    });
    if (!res.ok) {
      console.log('[MANUAL_GIFT]', 'acknowledge_failed', res.status, body);
      const msg =
        (body && typeof body === 'object' && (body.message || body.error)) || `HTTP ${res.status}`;
      throw new Error(typeof msg === 'string' ? msg : `HTTP ${res.status}`);
    }
    console.log('[MANUAL_GIFT]', 'acknowledge_ok', res.status);
    return { ok: true, raw: body };
  } catch (e) {
    console.log('[MANUAL_GIFT]', 'acknowledge_error', e?.message ?? e);
    throw e;
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
 * Initiate a transfer FROM the calling device. Returns a one-time code
 * that the destination device confirms. The current device is treated
 * as the source; backend rebinds ownership to the actual `target_device_id`
 * passed at confirm time.
 *
 * Backend route: POST /api/transfer/request
 * @param {object} [identityContext] install_instance_id, android_id, etc.
 */
export async function initiateTransfer(
  deviceId,
  deviceFingerprint,
  phone = '',
  identityContext = {},
) {
  const url = '/api/transfer/request';
  const phoneNorm = normalizeTanzaniaMobilePhone(phone);
  const ctx = await buildIdentityContext({
    ...identityContext,
    phone: phoneNorm?.local ?? undefined,
  });
  const basePayload = buildMigrationIdentityPayload(deviceId, deviceFingerprint, ctx);
  const payload = {
    ...basePayload,
    source_device_id: deviceId,
    target_device_id: deviceId,
    device_id: deviceId,
    device_fingerprint: deviceFingerprint,
  };
  if (phoneNorm?.local) {
    payload.phone = phoneNorm.local;
    payload.payment_phone = phoneNorm.local;
    payload.phone_e164 = phoneNorm.e164;
  } else {
    const fallback = formatTanzaniaPhoneForApi(phone);
    if (fallback) {
      payload.phone = fallback;
      payload.payment_phone = fallback;
    }
  }
  console.log('[TRANSFER_REQUEST]', 'request', {
    url,
    phone: payload.phone ? `${String(payload.phone).slice(0, 4)}…` : null,
    phone_e164: payload.phone_e164 ? `${String(payload.phone_e164).slice(0, 6)}…` : null,
    deviceId: String(deviceId).slice(0, 8),
    install_instance_id: payload.install_instance_id ? `${String(payload.install_instance_id).slice(0, 8)}…` : null,
  });
  const { res, body } = await postJson(url, payload);
  if (!res.ok) {
    const reason = body?.error ?? body?.message ?? `HTTP ${res.status}`;
    console.log('[TRANSFER_REQUEST]', 'failed', res.status, reason);
    throw createTransferRequestError(res.status, String(reason), body);
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
 * Detect whether the confirm response indicates the backend is waiting for
 * the SOURCE device to approve/reject the transfer before activating.
 * Multiple flag names accepted to stay forward-compatible with backend
 * naming changes.
 */
function isPendingConfirmation(body) {
  if (!isPlainObject(body)) return false;
  const status = String(body.status ?? body.state ?? '').toLowerCase();
  if (status === 'pending' || status === 'awaiting_confirmation' || status === 'awaiting_approval') return true;
  if (body.pending === true) return true;
  if (body.awaiting_confirmation === true) return true;
  if (body.requires_confirmation === true) return true;
  if (body.needs_confirmation === true) return true;
  if (body.transfer_mode === 'confirmation' && body.active !== true && body.is_active !== true) return true;
  return false;
}

/**
 * Confirm / redeem a transfer code on the destination device.
 *
 * The backend supports a "pending confirmation" mode where the SOURCE
 * device must approve the transfer before activation. In that case the
 * confirm endpoint returns success but does NOT yet activate the
 * subscription on this device — we surface a `{ status: 'pending' }`
 * response and the caller waits for the realtime `transfer_approved`
 * or `transfer_rejected` SSE event.
 *
 * Legacy / direct-activation responses still flow through the canonical
 * `/api/subscription/verify` endpoint for the authoritative `active`
 * answer; we never trust the confirm response alone.
 *
 * Backend route: POST /api/transfer/confirm
 */
export async function redeemTransfer(code, deviceId, deviceFingerprint) {
  const url = '/api/transfer/confirm';
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
  if (isPendingConfirmation(body)) {
    console.log('[TRANSFER_CONFIRM]', 'pending', {
      code: codeWithPrefix,
      transferMode: body?.transfer_mode ?? null,
    });
    return {
      status: 'pending',
      active: false,
      code: codeWithPrefix,
      expiresAt: pickExpiresAt(body) ?? body?.expires_at ?? null,
      raw: body,
    };
  }
  // Legacy direct-activation path (no SOURCE confirmation step).
  const confirmedActiveSignal =
    body?.ok === true ||
    body?.success === true ||
    body?.active === true ||
    body?.is_active === true;
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
      status: 'approved',
    });
    return { ...verified, status: 'approved' };
  }
  if (confirmedActiveSignal) {
    const out = normalizeVerifyResponse(body);
    console.log('[TRANSFER_CONFIRM]', 'response', {
      active: true,
      expiresAt: out.expiresAt,
      status: 'approved',
      source: 'confirm-body',
    });
    return { ...out, active: true, status: 'approved' };
  }
  console.log('[TRANSFER_CONFIRM]', 'response', { active: false, status: 'unknown' });
  return { ...normalizeVerifyResponse(body), active: false, status: 'unknown' };
}

/**
 * Respond to a `transfer_requested` SSE event on the SOURCE device.
 * @param {'approve'|'reject'} decision
 */
export async function respondToTransfer(code, decision) {
  const url = '/api/transfer/respond';
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
 * The backend has been renamed multiple times across deploys; we probe a list
 * of candidate URLs and gracefully fall back on 404 so this keeps working when
 * the backend adds (or renames) the route. Failure modes never throw — the
 * caller just waits for SSE.
 */
const TRANSFER_STATUS_PATHS = Object.freeze([
  '/transfer/status/{code}',
  '/transfer/status?code={code}',
  '/transfer/{code}',
  '/transfer/poll/{code}',
  '/transfer/info/{code}',
  '/subscription/transfer/{code}',
  '/subscription/transfer/status/{code}',
]);

/**
 * Heuristic: does this body indicate the backend is awaiting source-device
 * approval for an in-flight transfer?
 */
function isPendingPollBody(body) {
  if (!isPlainObject(body)) return false;
  if (isPendingConfirmation(body)) return true;
  const sub =
    (isPlainObject(body.transfer) && body.transfer) ||
    (isPlainObject(body.data) && body.data) ||
    null;
  if (sub && isPendingConfirmation(sub)) return true;
  if (typeof body.target_device_id === 'string' && body.target_device_id) return true;
  if (sub && typeof sub.target_device_id === 'string' && sub.target_device_id) return true;
  return false;
}

export async function getTransferStatus(code) {
  const trimmed = String(code ?? '').trim();
  if (!trimmed) return { status: 'unknown' };
  const codeWithPrefix = ensureTransferPrefix(trimmed);
  const codeBare = stripTransferPrefix(trimmed);
  const candidates = TRANSFER_STATUS_PATHS.flatMap((path) => {
    return [codeWithPrefix, codeBare].map((c) =>
      `${apiRoot()}${path.replace('{code}', encodeURIComponent(c))}`,
    );
  });
  for (const url of candidates) {
    let res;
    let body;
    try {
      res = await fetch(url, { headers: { Accept: 'application/json' } });
      body = await readJson(res);
    } catch {
      continue;
    }
    if (!res || res.status === 404) continue;
    if (!res.ok) continue;
    const pending = isPendingPollBody(body);
    return { status: pending ? 'pending_confirmation' : (body?.status ?? 'ok'), pending, raw: body, url };
  }
  return { status: 'unknown', pending: false };
}

/* -----------------------------------------------------------------
 * Local cache (UI hint only — never used for trust decisions).
 * ----------------------------------------------------------------- */

export async function readSubscriptionCache() {
  try {
    const [active, expiresAt, deviceId, fingerprint, revokedAt, planSnapshotRaw] =
      await Promise.all([
      AsyncStorage.getItem(SUB_CACHE_KEYS.active),
      AsyncStorage.getItem(SUB_CACHE_KEYS.expiresAt),
      AsyncStorage.getItem(SUB_CACHE_KEYS.deviceId),
      AsyncStorage.getItem(SUB_CACHE_KEYS.fingerprint),
      AsyncStorage.getItem(SUB_CACHE_KEYS.revokedAt),
      AsyncStorage.getItem(SUB_CACHE_KEYS.planSnapshot),
    ]);
    let planSnapshot = null;
    if (planSnapshotRaw) {
      try {
        planSnapshot = JSON.parse(planSnapshotRaw);
      } catch {
        planSnapshot = null;
      }
    }
    return {
      active: active === '1',
      expiresAt: expiresAt || null,
      deviceId: deviceId || null,
      fingerprint: fingerprint || null,
      revokedAt: revokedAt || null,
      planSnapshot,
    };
  } catch {
    return {
      active: false,
      expiresAt: null,
      deviceId: null,
      fingerprint: null,
      revokedAt: null,
      planSnapshot: null,
    };
  }
}

export async function writeSubscriptionCache({
  active,
  expiresAt,
  deviceId,
  fingerprint,
  planSnapshot,
}) {
  try {
    const pairs = [
      [SUB_CACHE_KEYS.active, active ? '1' : '0'],
      [SUB_CACHE_KEYS.expiresAt, expiresAt ? String(expiresAt) : ''],
      [SUB_CACHE_KEYS.deviceId, deviceId ? String(deviceId) : ''],
      [SUB_CACHE_KEYS.fingerprint, fingerprint ? String(fingerprint) : ''],
    ];
    if (planSnapshot && typeof planSnapshot === 'object') {
      pairs.push([SUB_CACHE_KEYS.planSnapshot, JSON.stringify(planSnapshot)]);
    } else if (!active) {
      pairs.push([SUB_CACHE_KEYS.planSnapshot, '']);
    }
    await AsyncStorage.multiSet(pairs);
  } catch {}
}

export async function clearSubscriptionCache(reason = 'unknown') {
  try {
    await AsyncStorage.multiRemove([
      SUB_CACHE_KEYS.active,
      SUB_CACHE_KEYS.expiresAt,
      SUB_CACHE_KEYS.deviceId,
      SUB_CACHE_KEYS.fingerprint,
      SUB_CACHE_KEYS.planSnapshot,
    ]);
    await AsyncStorage.setItem(SUB_CACHE_KEYS.revokedAt, new Date().toISOString());
    console.log('[SUBSCRIPTION_CACHE]', 'cleared', { reason });
  } catch {}
}
