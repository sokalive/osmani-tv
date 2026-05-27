/**
 * Premium channel access vs free — trial must never run on free content.
 */

import { shouldApplyTrialWatch } from './trialWatchSettings.shared';
import {
  loadTrialWatchState,
  resolveTrialWatchAllowance,
} from './trialWatchState';

/**
 * @param {Record<string, unknown> | null | undefined} channel
 * @param {{ freeMode?: boolean }} [ctx]
 */
export function channelIsFreeAccess(channel, ctx = {}) {
  if (ctx.freeMode) return true;
  if (!channel || typeof channel !== 'object') return false;

  const accessType = String(channel.accessType ?? channel.access_type ?? '').toLowerCase();
  if (accessType === 'free') return true;
  if (accessType === 'premium') return false;

  if (channel.accessPremium === true || channel.access_premium === true) return false;
  if (channel.isPremium === true) return false;

  return true;
}

/**
 * @param {Record<string, unknown> | null | undefined} channel
 * @param {{ freeMode?: boolean }} [ctx]
 */
export function channelIsPremiumAccess(channel, ctx = {}) {
  if (ctx?.freeMode) return false;
  if (!channel || typeof channel !== 'object') return false;
  if (channelIsFreeAccess(channel, ctx)) return false;

  return (
    channel.isPremium === true ||
    channel.accessPremium === true ||
    channel.access_premium === true ||
    accessTypeIsPremium(channel)
  );
}

function accessTypeIsPremium(channel) {
  return String(channel?.accessType ?? channel?.access_type ?? '').toLowerCase() === 'premium';
}

/**
 * Trial may run only on premium content for non-subscribers with runtime trial enabled.
 * @param {{ isSubscribed?: boolean; freeMode?: boolean; trialWatchSettings?: import('./trialWatchSettings.shared').TRIAL_WATCH_FAIL_CLOSED; channel?: Record<string, unknown> | null }} input
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
 * @param {typeof import('./trialWatchSettings.shared').TRIAL_WATCH_FAIL_CLOSED} trialWatchSettings
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
