import Constants from 'expo-constants';
import { nativeApplicationVersion } from 'expo-application';
import { parseCheckoutProvidersResponse } from '../lib/checkoutPaymentProviders';
import { formatCheckoutPaymentError, extractPaymentBackendReason, logPaymentCheckoutFailure, CheckoutPaymentError, PhoneSubscriptionConflictError, DeviceSubscriptionConflictError } from '../lib/paymentCheckoutErrors';
import {
  isPhoneSubscriptionConflict,
  isDeviceSubscriptionConflict,
  isSubscriptionCheckoutConflict,
  parsePhoneSubscriptionConflict,
} from '../lib/phoneSubscriptionGuard';
import { ACTIVE_SUBSCRIPTION_PAYMENT_BLOCK_MESSAGE } from '../lib/paymentEntryGuard';
import { resolveMediaAssetUrl } from '../lib/mediaDelivery';
import { resolveApiBaseUrl } from '../lib/apiBaseUrl';
import { fetchAdminApiJson, fetchAdminApiResponse } from '../lib/catalogApiFetch';
import { readNativeAndroidVersionCode } from '../lib/playVpsApiHost';
import { parsePaymentActivationStatus } from '../lib/paymentWaitingState';

/**
 * Create-order must return an order_id quickly so the UI can leave Lipia
 * and enter the waiting step. PIN/USSD continues on the handset after that —
 * do NOT wait forever for the HTTP response (that stuck the Lipia spinner).
 * On timeout, PremiumModal recovers into the orphan waiting / pending state.
 */
export const PAYMENT_CREATE_ORDER_NO_TIMEOUT = false;
/** Client abort for create-order. Long enough for slow mobile networks; short enough to never leave Lipia spinning. */
export const PAYMENT_CREATE_ORDER_TIMEOUT_MS = 45_000;

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

/**
 * @returns {Promise<unknown[]>}
 */
export async function getPlans() {
  const body = await fetchAdminApiJson('/api/plans', { tag: 'payment-plans' });
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
export async function getPaymentProviders() {
  const body = await fetchAdminApiJson('/api/payment-providers', { tag: 'payment-providers' });
  let raw = [];
  if (Array.isArray(body)) raw = body;
  else if (body && Array.isArray(body.providers)) raw = body.providers;
  else if (body && Array.isArray(body.data)) raw = body.data;
  return raw
    .map(normalizeProviderRow)
    .filter((p) => p && p.active === true);
}

/**
 * GET /api/payments/checkout-providers
 */
export async function getCheckoutPaymentProviders() {
  const body = await fetchAdminApiJson('/api/payments/checkout-providers', {
    tag: 'payment-checkout-providers',
  });
  const cfg = parseCheckoutProvidersResponse(body);
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
}

function readPaymentRuntimeVersion() {
  try {
    const Updates = require('expo-updates');
    const rv = Updates?.runtimeVersion;
    if (rv != null && String(rv).trim()) return String(rv).trim();
  } catch {
    /* optional */
  }
  const cfg = Constants.expoConfig?.version ?? Constants.manifest?.version;
  return cfg != null ? String(cfg) : '';
}

/** Correlation metadata for Admin payment recovery — no client-side order_id minting. */
function buildCreateOrderPayload(payload, provider) {
  const planId = payload.plan_id ?? payload.planId;
  const versionCode = readNativeAndroidVersionCode();
  const appVersion = nativeApplicationVersion ?? '';
  const runtimeVersion = readPaymentRuntimeVersion();
  return {
    phone: payload.phone,
    plan_id: planId,
    planId,
    amount: payload.amount,
    device_id: payload.device_id ?? payload.deviceId,
    deviceId: payload.device_id ?? payload.deviceId,
    provider: provider ?? payload.provider ?? null,
    payment_provider: provider ?? payload.payment_provider ?? null,
    app_version: appVersion,
    appVersion,
    runtime_version: runtimeVersion,
    runtimeVersion,
    client_version_code:
      Number.isFinite(versionCode) && versionCode > 0 ? versionCode : null,
    clientVersionCode:
      Number.isFinite(versionCode) && versionCode > 0 ? versionCode : null,
    ...(payload.device_fingerprint != null
      ? { device_fingerprint: payload.device_fingerprint, deviceFingerprint: payload.device_fingerprint }
      : {}),
    install_instance_id: payload.install_instance_id ?? payload.installInstanceId ?? null,
    installInstanceId: payload.install_instance_id ?? payload.installInstanceId ?? null,
    package_name: payload.package_name ?? payload.packageName ?? null,
    packageName: payload.package_name ?? payload.packageName ?? null,
    package_android_id: payload.package_android_id ?? payload.packageAndroidId ?? null,
    packageAndroidId: payload.package_android_id ?? payload.packageAndroidId ?? null,
    legacy_package_android_id:
      payload.legacy_package_android_id ?? payload.legacyPackageAndroidId ?? null,
    legacyPackageAndroidId:
      payload.legacy_package_android_id ?? payload.legacyPackageAndroidId ?? null,
    stable_hardware_id: payload.stable_hardware_id ?? payload.stableHardwareId ?? null,
    stableHardwareId: payload.stable_hardware_id ?? payload.stableHardwareId ?? null,
    displayed_account_id:
      payload.displayed_account_id ?? payload.displayedAccountId ?? null,
    displayedAccountId:
      payload.displayed_account_id ?? payload.displayedAccountId ?? null,
    subscription_device_id:
      payload.subscription_device_id ?? payload.subscriptionDeviceId ?? null,
    subscriptionDeviceId:
      payload.subscription_device_id ?? payload.subscriptionDeviceId ?? null,
    legacy_device_fingerprint:
      payload.legacy_device_fingerprint ?? payload.legacyDeviceFingerprint ?? null,
    legacyDeviceFingerprint:
      payload.legacy_device_fingerprint ?? payload.legacyDeviceFingerprint ?? null,
    identity_candidates: (
      Array.isArray(payload.identity_candidates)
        ? payload.identity_candidates
        : Array.isArray(payload.identityCandidates)
          ? payload.identityCandidates
          : []
    ).map((candidate) => ({
      role: candidate?.role ?? null,
      device_id: candidate?.device_id ?? candidate?.deviceId ?? null,
      deviceId: candidate?.device_id ?? candidate?.deviceId ?? null,
    })),
  };
}

async function postCreateOrder(pathSuffixes, payload, errorLabel, provider) {
  const paths = Array.isArray(pathSuffixes) ? pathSuffixes : [pathSuffixes];
  const bodyPayload = buildCreateOrderPayload(payload, provider);
  let last = null;

  for (let i = 0; i < paths.length; i += 1) {
    const pathSuffix = paths[i];
    const attempt = await fetchAdminApiResponse(pathSuffix, {
      method: 'POST',
      body: bodyPayload,
      tag: 'payment-create-order',
      noTimeout: PAYMENT_CREATE_ORDER_NO_TIMEOUT,
      timeoutMs: PAYMENT_CREATE_ORDER_TIMEOUT_MS,
    });
    last = attempt;
    if (isSubscriptionCheckoutConflict(attempt.res.status, attempt.parsed)) {
      break;
    }
    const routeMissing = attempt.res.status === 404;
    if (routeMissing && i < paths.length - 1) continue;
    break;
  }

  const { res, parsed: body, url } = last;
  if (!res.ok) {
    if (isDeviceSubscriptionConflict(res.status, body)) {
      const conflict = parsePhoneSubscriptionConflict(body);
      const backendReason = extractPaymentBackendReason(body, res.status);
      logPaymentCheckoutFailure({
        phase: 'device-subscription-guard',
        provider,
        path: url,
        httpStatus: res.status,
        backendReason,
        code: conflict.code,
        existing_device_id: conflict.existingDeviceId,
        remaining_days: conflict.remainingDays,
      });
      throw new DeviceSubscriptionConflictError(ACTIVE_SUBSCRIPTION_PAYMENT_BLOCK_MESSAGE, {
        code: conflict.code || 'DEVICE_ALREADY_HAS_ACTIVE_SUBSCRIPTION',
        backendReason,
        httpStatus: res.status,
        provider,
        path: url,
        title: 'Kifurushi Kinaendelea',
        conflict,
      });
    }
    if (isPhoneSubscriptionConflict(res.status, body)) {
      const conflict = parsePhoneSubscriptionConflict(body);
      const backendReason = extractPaymentBackendReason(body, res.status);
      logPaymentCheckoutFailure({
        phase: 'phone-subscription-guard',
        provider,
        path: url,
        httpStatus: res.status,
        backendReason,
        code: conflict.code,
        existing_device_id: conflict.existingDeviceId,
        remaining_days: conflict.remainingDays,
      });
      throw new PhoneSubscriptionConflictError(conflict.messageSw, {
        code: conflict.code,
        backendReason,
        httpStatus: res.status,
        provider,
        path: url,
        title: conflict.title,
        conflict,
      });
    }
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

function enrichPaymentStatusResponse(body, httpStatus) {
  const parsed = parsePaymentActivationStatus(body);
  return {
    status: parsed.status,
    reason: parsed.reason,
    appWaitingState: parsed.appWaitingState,
    activationState: parsed.activationState,
    entitlementActive: parsed.entitlementActive,
    retryable: parsed.retryable,
    userActionRequired: parsed.userActionRequired,
    transactionStatus: parsed.transactionStatus,
    expiresAt: parsed.expiresAt,
    httpStatus,
    raw: body,
  };
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
        appWaitingState: 'FAILED',
        reason: formatCheckoutPaymentError(body?.reason ?? body?.error ?? 'Order not found', {
          httpStatus: 404,
        }),
      };
    }
    if (res.status === 429) {
      return {
        status: 'PENDING',
        appWaitingState: 'RETRYING',
        retryable: true,
        reason: 'Rate limited — retrying',
        httpStatus: 429,
      };
    }
    const msg = body?.error != null ? String(body.error) : `HTTP ${res.status}`;
    throw new Error(formatCheckoutPaymentError(msg, { httpStatus: res.status }));
  }
  return enrichPaymentStatusResponse(body, res.status);
}

/**
 * SonicPesa-specific reconcile + app_waiting_state (same host as create-order).
 * @param {string} orderId
 */
export async function getSonicpesaOrderStatus(orderId) {
  const q = encodeURIComponent(orderId);
  const { res, parsed: body } = await fetchAdminApiResponse(`/api/payments/sonicpesa/status/${q}`, {
    tag: 'sonicpesa-payment-status',
  });
  if (!res.ok) {
    if (res.status === 404) {
      return getPaymentStatus(orderId);
    }
    if (res.status === 429) {
      return {
        status: 'PENDING',
        appWaitingState: 'RETRYING',
        retryable: true,
        reason: 'Rate limited — retrying',
        httpStatus: 429,
      };
    }
    const msg = body?.error != null ? String(body.error) : `HTTP ${res.status}`;
    throw new Error(formatCheckoutPaymentError(msg, { httpStatus: res.status }));
  }
  return enrichPaymentStatusResponse(body, res.status);
}

/**
 * Route status poll to the same provider path used for create-order.
 * @param {string} orderId
 * @param {'zenopay'|'sonicpesa'|'auraxpay'|string|null} provider
 */
export async function resolveOrderPaymentStatus(orderId, provider) {
  const p = String(provider ?? '').toLowerCase();
  if (p === 'sonicpesa' || p === 'sonic') {
    return getSonicpesaOrderStatus(orderId);
  }
  return getPaymentStatus(orderId);
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
