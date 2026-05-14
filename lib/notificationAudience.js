/**
 * Normalized audience fields from OneSignal `additionalData` (dashboard Data / API payload).
 * Backend can send any subset; unknown keys are ignored.
 *
 * Suggested dashboard keys (string values):
 * - `audience_tier` | `tier` → premium | free | inactive
 * - `subscription_state` | `sub_state` → active | expired | none
 */

/** @typedef {'premium' | 'free' | 'inactive' | 'unknown'} AudienceTier */
/** @typedef {'active' | 'expired' | 'none' | 'unknown'} SubscriptionState */

/**
 * @param {unknown} v
 * @returns {string}
 */
function str(v) {
  if (v == null) return '';
  return String(v).trim().toLowerCase();
}

/**
 * @param {Record<string, unknown> | null | undefined} additionalData
 * @returns {{ audienceTier: AudienceTier; subscriptionState: SubscriptionState; raw: Record<string, unknown> }}
 */
export function parseNotificationAudience(additionalData) {
  const raw =
    additionalData && typeof additionalData === 'object' && !Array.isArray(additionalData)
      ? /** @type {Record<string, unknown>} */ (additionalData)
      : {};

  const tierRaw = str(
    raw.audience_tier ?? raw.audienceTier ?? raw.tier ?? raw.segment ?? raw.user_tier,
  );
  let /** @type {AudienceTier} */ audienceTier = 'unknown';
  if (tierRaw === 'premium' || tierRaw === 'paid' || tierRaw === 'subscriber') audienceTier = 'premium';
  else if (tierRaw === 'free' || tierRaw === 'bure') audienceTier = 'free';
  else if (tierRaw === 'inactive' || tierRaw === 'lapsed' || tierRaw === 'expired') audienceTier = 'inactive';

  const subRaw = str(
    raw.subscription_state ?? raw.subscriptionState ?? raw.sub_state ?? raw.subscription,
  );
  let /** @type {SubscriptionState} */ subscriptionState = 'unknown';
  if (subRaw === 'active' || subRaw === 'subscribed') subscriptionState = 'active';
  else if (subRaw === 'expired' || subRaw === 'lapsed') subscriptionState = 'expired';
  else if (subRaw === 'none' || subRaw === '' || subRaw === 'unsubscribed') subscriptionState = 'none';

  return { audienceTier, subscriptionState, raw };
}

/** @type {ReturnType<typeof parseNotificationAudience> | null} */
let lastAudienceSnapshot = null;

/** Last parsed audience from a foreground or opened notification (for app logic / segmentation). */
export function getLastNotificationAudienceSnapshot() {
  return lastAudienceSnapshot;
}

/**
 * @param {ReturnType<typeof parseNotificationAudience> | null} snapshot
 */
export function setLastNotificationAudienceSnapshot(snapshot) {
  lastAudienceSnapshot = snapshot;
}
