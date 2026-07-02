/**
 * UI-only channel tap snapshot — instant payment modal for confirmed unsubscribed users.
 * Subscribed / uncertain boot state still uses the async snapshot await (d8428ad guard).
 */

/**
 * @param {{
 *   getPremiumAccessSnapshot: () => { isSubscribed: boolean; premiumPlaybackReady: boolean; freeMode: boolean; trialWatchSettings: unknown };
 *   awaitPremiumAccessSnapshot: () => Promise<{ isSubscribed: boolean; premiumPlaybackReady: boolean; freeMode: boolean; trialWatchSettings: unknown }>;
 *   premiumPlaybackReady: boolean;
 *   isFreeChannel: boolean;
 * }} ctx
 * @returns {Promise<{ snapshot: { isSubscribed: boolean; premiumPlaybackReady: boolean; freeMode: boolean; trialWatchSettings: unknown }; paymentImmediate: boolean }>}
 */
export async function resolveChannelTapAccessSnapshot(ctx) {
  const { getPremiumAccessSnapshot, awaitPremiumAccessSnapshot, premiumPlaybackReady, isFreeChannel } =
    ctx;
  const snapshotSync = getPremiumAccessSnapshot();
  const paymentImmediate = !isFreeChannel && snapshotSync.isSubscribed !== true;

  if (paymentImmediate) {
    return { snapshot: snapshotSync, paymentImmediate: true };
  }

  const snapshot =
    premiumPlaybackReady || isFreeChannel
      ? getPremiumAccessSnapshot()
      : await awaitPremiumAccessSnapshot();

  return { snapshot, paymentImmediate: false };
}
