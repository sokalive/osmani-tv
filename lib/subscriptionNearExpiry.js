import { computeSubscriptionProgress, SUBSCRIPTION_MATH_INTERNAL } from './subscriptionMath';

const { DAY_MS } = SUBSCRIPTION_MATH_INTERNAL;
const HOUR_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;
const FORTY_EIGHT_H_MS = 48 * HOUR_MS;

/**
 * Near-expiry UI (reminders only). Trust: `isSubscribed` + backend `expiresAt` / `serverTime`
 * via {@link computeSubscriptionProgress} — same model as the account progress card.
 *
 * Eligible when subscription is active and either:
 * - ceil calendar days remaining ≤ 2, or
 * - wall-time remaining ≤ 48 hours
 *
 * @param {{ isSubscribed: boolean; freeMode?: boolean; subscriptionDetails: object | null; subscriptionExpiresAt: string | null }} input
 */
export function computeNearExpirySnapshot(input = {}) {
  const { isSubscribed, freeMode, subscriptionDetails, subscriptionExpiresAt } = input;

  if (freeMode || !isSubscribed) {
    return {
      eligible: false,
      progress: null,
      displaySikuX: 0,
      remainingHoursCeil: 0,
      remainingMs: 0,
    };
  }

  const expiresAt = subscriptionDetails?.expiresAt ?? subscriptionExpiresAt ?? null;
  const progress = computeSubscriptionProgress({
    startedAt: subscriptionDetails?.startedAt ?? null,
    expiresAt,
    planDurationDays:
      subscriptionDetails?.planDurationDays ?? subscriptionDetails?.plan_duration_days ?? null,
    serverTime: subscriptionDetails?.serverTime ?? null,
    serverTimeFetchedAt: subscriptionDetails?.serverTimeFetchedAt ?? null,
    nowMsOverride: Date.now(),
  });

  if (!progress.ok || progress.remainingMs <= 0) {
    return {
      eligible: false,
      progress,
      displaySikuX: 0,
      remainingHoursCeil: 0,
      remainingMs: progress?.remainingMs ?? 0,
    };
  }

  const withinTwoCeilingDays = progress.remainingDays <= 2;
  const withinFortyEightHours = progress.remainingMs <= FORTY_EIGHT_H_MS;
  const eligible = withinTwoCeilingDays || withinFortyEightHours;

  const displaySikuX = Math.max(1, Math.ceil(progress.remainingMs / DAY_MS));
  const remainingHoursCeil = Math.max(1, Math.ceil(progress.remainingMs / HOUR_MS));

  return {
    eligible,
    progress,
    displaySikuX,
    remainingHoursCeil,
    remainingMs: progress.remainingMs,
  };
}

/**
 * Swahili phrase for the near-expiry reminder body (server-anchored `remainingMs`).
 * Examples: "imebakiza siku 2", "imebakiza siku 1", "imebakiza saa 5", "imebakiza dakika 12".
 *
 * @param {number} remainingMs
 */
export function formatNearExpiryReminderPhrase(remainingMs) {
  const ms = Math.max(0, Number(remainingMs) || 0);
  if (ms >= DAY_MS) {
    const days = Math.max(1, Math.ceil(ms / DAY_MS));
    return `imebakiza siku ${days}`;
  }
  if (ms >= HOUR_MS) {
    const hours = Math.max(1, Math.ceil(ms / HOUR_MS));
    return hours === 1 ? 'imebakiza saa 1' : `imebakiza saa ${hours}`;
  }
  const minutes = Math.max(1, Math.ceil(ms / MINUTE_MS));
  return minutes === 1 ? 'imebakiza dakika 1' : `imebakiza dakika ${minutes}`;
}
