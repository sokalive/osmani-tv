import { fetchSubscription } from '../api/payment';
import { verifySubscription, getSubscriptionStatusForDevice } from '../api/subscription';

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
 * Fast subscription probes before slow reverify — critical after payment SUCCESS.
 * @returns {Promise<{ verified: object|null; fetchExpires: string|null }>}
 */
export async function probeSubscriptionActivation(deviceId, deviceFingerprint, identity) {
  let fetchExpires = null;

  try {
    const sub = await fetchSubscription(deviceId);
    fetchExpires = sub?.expiresAt ?? null;
    if (sub?.active === true) {
      return {
        verified: { active: true, isActive: true, expiresAt: sub.expiresAt ?? null },
        fetchExpires,
      };
    }
  } catch {
    // subscription-status optional
  }

  const candidateIds = [
    identity?.packageAndroidId,
    identity?.legacyPackageAndroidId,
    identity?.subscriptionDeviceId,
    identity?.displayedAccountId,
    deviceId,
  ];
  const seen = new Set();
  for (const raw of candidateIds) {
    const id = String(raw ?? '').trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const hit = await getSubscriptionStatusForDevice(id);
    if (hit?.active === true) {
      return {
        verified: { active: true, isActive: true, expiresAt: hit.expiresAt ?? null },
        fetchExpires: hit.expiresAt ?? fetchExpires,
      };
    }
  }

  try {
    const verified = await verifySubscription(deviceId, deviceFingerprint);
    if (isSubscriptionActive(verified)) {
      return { verified, fetchExpires };
    }
  } catch {
    // verify optional during activation race
  }

  return { verified: null, fetchExpires };
}

/**
 * MFALME-style single activation tick per poll/SSE event.
 * One fast probe, then one refresh+fetch merge — no blocking multi-minute loops.
 *
 * @returns {Promise<{ active: boolean; subscription: object|null; fetchExpires: string|null }>}
 */
export async function runPaymentActivationTick({
  deviceId,
  deviceFingerprint,
  identity,
  refreshSubscription,
}) {
  const probed = await probeSubscriptionActivation(deviceId, deviceFingerprint, identity);
  if (probed.verified && isSubscriptionActive(probed.verified)) {
    return { active: true, subscription: probed.verified, fetchExpires: probed.fetchExpires };
  }

  let verified = await refreshSubscription();
  let fetchExpires = probed.fetchExpires ?? null;
  try {
    const sub = await fetchSubscription(deviceId);
    fetchExpires = sub?.expiresAt ?? fetchExpires;
    if (sub?.active === true && !isSubscriptionActive(verified)) {
      verified = {
        ...verified,
        active: true,
        isActive: true,
        expiresAt: sub.expiresAt ?? null,
      };
    }
  } catch {
    // optional enrichment
  }

  if (verified && isSubscriptionActive(verified)) {
    return { active: true, subscription: verified, fetchExpires };
  }

  return { active: false, subscription: verified, fetchExpires };
}
