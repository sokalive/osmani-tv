import { computeSubscriptionProgress, SUBSCRIPTION_MATH_INTERNAL } from './subscriptionMath';

const { DAY_MS } = SUBSCRIPTION_MATH_INTERNAL;
const HOUR_MS = 60 * 60 * 1000;
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
