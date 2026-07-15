import { fetchSubscription } from '../api/payment';
import {
  getSubscriptionStatusForDevice,
  recoverSubscription,
  verifySubscription,
} from '../api/subscription';

export function isSubscriptionActive(subscription) {
  if (!subscription || typeof subscription !== 'object') return false;
  return subscription.active === true || subscription.isActive === true;
}

function parseExpiryMs(v) {
  if (v == null || v === '') return null;
  const t = Date.parse(String(v));
  return Number.isFinite(t) ? t : null;
}

/** Prefer the furthest future expiry when verify and subscription-status disagree. */
export function latestExpiryIso(...candidates) {
  let bestStr = null;
  let bestMs = null;
  for (const raw of candidates) {
    if (raw == null || raw === '') continue;
    const s = String(raw).trim();
    const ms = parseExpiryMs(s);
    if (ms == null) continue;
    if (bestMs == null || ms > bestMs) {
      bestMs = ms;
      bestStr = s;
    }
  }
  return bestStr;
}

/**
 * Backend payment-status has already confirmed entitlement on this device.
 * Do not wait for a separate verify round-trip before unlocking UI.
 */
export function isPaymentEntitlementConfirmed(statusResult) {
  if (!statusResult || typeof statusResult !== 'object') return false;
  if (statusResult.entitlementActive === true) return true;
  const waiting = String(statusResult.appWaitingState ?? '').trim();
  if (waiting === 'ACTIVE') return true;
  const activation = String(statusResult.activationState ?? '').trim().toUpperCase();
  return activation === 'ACTIVATED' || activation === 'ALREADY_APPLIED';
}

/**
 * Pull subscription fields from payment-status raw body when present.
 * @param {unknown} raw
 * @returns {{ active: boolean; isActive: boolean; expiresAt: string|null; planName?: string|null; planId?: string|null; amount?: number|null; startedAt?: string|null; remainingDays?: number|null }}
 */
export function subscriptionHintFromPaymentStatusRaw(raw) {
  const body = raw && typeof raw === 'object' ? raw : {};
  const data = body.data && typeof body.data === 'object' ? body.data : null;
  const sub = body.subscription && typeof body.subscription === 'object' ? body.subscription : null;
  const activation =
    body.activation && typeof body.activation === 'object' ? body.activation : null;

  const expiresAt =
    body.expires_at ??
    body.expiresAt ??
    data?.expires_at ??
    data?.expiresAt ??
    sub?.expires_at ??
    sub?.expiresAt ??
    activation?.expires_at ??
    activation?.expiresAt ??
    null;

  const startedAt =
    body.started_at ??
    body.startedAt ??
    data?.started_at ??
    data?.startedAt ??
    sub?.started_at ??
    sub?.startedAt ??
    activation?.started_at ??
    activation?.startedAt ??
    null;

  const planName =
    body.plan_name ?? body.planName ?? data?.plan_name ?? data?.planName ?? sub?.plan_name ?? null;
  const planId = body.plan_id ?? body.planId ?? data?.plan_id ?? data?.planId ?? sub?.plan_id ?? null;
  const amountRaw = body.amount ?? data?.amount ?? sub?.amount ?? null;
  const amount = Number.isFinite(Number(amountRaw)) ? Number(amountRaw) : null;
  const remainingDaysRaw =
    body.remaining_days ??
    body.remainingDays ??
    data?.remaining_days ??
    data?.remainingDays ??
    null;
  const remainingDays = Number.isFinite(Number(remainingDaysRaw))
    ? Number(remainingDaysRaw)
    : null;

  return {
    active: true,
    isActive: true,
    expiresAt: expiresAt != null ? String(expiresAt) : null,
    startedAt: startedAt != null ? String(startedAt) : null,
    planName: planName != null ? String(planName) : null,
    planId: planId != null ? String(planId) : null,
    amount,
    remainingDays,
  };
}

/** Collect unique device id candidates for activation status probes. */
export function activationDeviceIdCandidates(deviceId, identity) {
  const candidateIds = [
    identity?.packageAndroidId,
    identity?.legacyPackageAndroidId,
    identity?.subscriptionDeviceId,
    identity?.displayedAccountId,
    identity?.stableHardwareId,
    deviceId,
  ];
  const out = [];
  const seen = new Set();
  for (const raw of candidateIds) {
    const id = String(raw ?? '').trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/**
 * Parallel GET /subscription-status across identity candidates.
 * Prefer this over sequential probe during payment waiting — seconds, not minutes.
 * @returns {Promise<{ verified: object|null; fetchExpires: string|null }>}
 */
export async function probeSubscriptionStatusParallel(deviceId, identity) {
  let fetchExpires = null;
  const ids = activationDeviceIdCandidates(deviceId, identity);

  const results = await Promise.all(
    ids.map(async (id) => {
      try {
        return await getSubscriptionStatusForDevice(id);
      } catch {
        return null;
      }
    }),
  );

  for (const hit of results) {
    if (hit?.expiresAt) {
      fetchExpires = latestExpiryIso(fetchExpires, hit.expiresAt) ?? fetchExpires;
    }
    if (hit?.active === true) {
      return {
        verified: { active: true, isActive: true, expiresAt: hit.expiresAt ?? null, ...hit },
        fetchExpires: hit.expiresAt ?? fetchExpires,
      };
    }
  }

  try {
    const sub = await fetchSubscription(deviceId);
    fetchExpires = latestExpiryIso(fetchExpires, sub?.expiresAt) ?? fetchExpires;
    if (sub?.active === true) {
      return {
        verified: { active: true, isActive: true, expiresAt: sub.expiresAt ?? null },
        fetchExpires,
      };
    }
  } catch {
    // subscription-status optional
  }

  return { verified: null, fetchExpires };
}

/**
 * Fast subscription probes before slow reverify — critical after payment SUCCESS.
 * Never shares OsmaniAppContext's in-flight reverify promise.
 *
 * @param {string} deviceId
 * @param {string} deviceFingerprint
 * @param {object} identity
 * @param {{ light?: boolean }} [opts] light=true skips verify+recover (status GETs only)
 * @returns {Promise<{ verified: object|null; fetchExpires: string|null }>}
 */
export async function probeSubscriptionActivation(
  deviceId,
  deviceFingerprint,
  identity,
  opts = {},
) {
  const light = opts.light === true;
  const statusProbe = await probeSubscriptionStatusParallel(deviceId, identity);
  if (statusProbe.verified && isSubscriptionActive(statusProbe.verified)) {
    return statusProbe;
  }

  let fetchExpires = statusProbe.fetchExpires;

  if (light) {
    return { verified: null, fetchExpires };
  }

  try {
    const verified = await verifySubscription(deviceId, deviceFingerprint, identity ?? {});
    if (isSubscriptionActive(verified)) {
      return { verified, fetchExpires: verified.expiresAt ?? fetchExpires };
    }
  } catch {
    // verify optional during activation race
  }

  try {
    const recovered = await recoverSubscription(deviceId, deviceFingerprint, identity ?? {});
    if (isSubscriptionActive(recovered)) {
      return {
        verified: recovered,
        fetchExpires: recovered.expiresAt ?? fetchExpires,
      };
    }
  } catch {
    // recover optional during activation race
  }

  return { verified: null, fetchExpires };
}

/**
 * MFALME-style single activation tick per poll/SSE event.
 * Uses dedicated probes only — never joins shared context reverify (avoids stale inactive).
 *
 * @returns {Promise<{ active: boolean; subscription: object|null; fetchExpires: string|null }>}
 */
export async function runPaymentActivationTick({
  deviceId,
  deviceFingerprint,
  identity,
  light = false,
}) {
  const probed = await probeSubscriptionActivation(deviceId, deviceFingerprint, identity, {
    light,
  });
  if (probed.verified && isSubscriptionActive(probed.verified)) {
    return { active: true, subscription: probed.verified, fetchExpires: probed.fetchExpires };
  }

  return { active: false, subscription: probed.verified, fetchExpires: probed.fetchExpires };
}
