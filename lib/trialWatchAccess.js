/**
 * Premium channel access via trial (non-subscribers) vs subscription verify.
 */

import {
  shouldApplyTrialWatch,
} from './trialWatchSettings.shared';
import {
  loadTrialWatchState,
  resolveTrialWatchAllowance,
} from './trialWatchState';

/**
 * @param {Record<string, unknown> | null | undefined} channel
 * @param {{ freeMode?: boolean }} [ctx]
 */
export function channelIsPremiumAccess(channel, ctx = {}) {
  if (ctx.freeMode) return false;
  return Boolean(
    channel?.isPremium ||
      channel?.accessPremium ||
      channel?.access_premium ||
      String(channel?.accessType ?? '').toLowerCase() === 'premium',
  );
}

/**
 * Trial may run only on premium/live content for non-subscribers.
 * @param {{ isSubscribed?: boolean; freeMode?: boolean; trialWatchSettings?: import('./trialWatchSettings.shared').DEFAULT_TRIAL_WATCH_SETTINGS; channel?: Record<string, unknown> | null }} input
 */
export function shouldRunTrialWatchOnChannel(input) {
  if (input?.freeMode || input?.isSubscribed) return false;
  if (!channelIsPremiumAccess(input?.channel, { freeMode: input?.freeMode })) return false;
  return shouldApplyTrialWatch({
    isSubscribed: input?.isSubscribed,
    freeMode: input?.freeMode,
    trialWatchSettings: input?.trialWatchSettings,
  });
}

/**
 * @param {typeof import('./trialWatchSettings.shared').DEFAULT_TRIAL_WATCH_SETTINGS} trialWatchSettings
 * @returns {Promise<{ allowViaTrial: boolean; bootstrap: { phase: 'trial' | 'preview'; remainingMs: number } | null; exhausted: boolean }>}
 */
export async function getTrialChannelAccess(trialWatchSettings) {
  if (!shouldApplyTrialWatch({ isSubscribed: false, freeMode: false, trialWatchSettings })) {
    return { allowViaTrial: false, bootstrap: null, exhausted: true };
  }
  const state = await loadTrialWatchState();
  const allowance = resolveTrialWatchAllowance(state, trialWatchSettings);
  const allow = allowance.phase !== 'blocked' && allowance.remainingMs > 0;
  return {
    allowViaTrial: allow,
    bootstrap: allow
      ? { phase: allowance.phase, remainingMs: allowance.remainingMs }
      : null,
    exhausted: !allow,
  };
}
