/**
 * Premium channel open flow — always uses a post-init access snapshot (never stale hook closure).
 */

import { assertPlaybackAllowed } from '../context/SecurityContext';
import { assertDeviceIntelligenceAllowed } from './deviceIntelligenceAccess';
import {
  channelIsFreeAccess,
  channelIsPremiumAccess,
  getTrialChannelAccess,
} from './trialWatchAccess';
import { logChannelCardTap } from './channelCardTapDiagnostics';
import { withTimeout } from './asyncTimeout';

/** Do not delay payment modal while trial state loads from AsyncStorage. */
const TRIAL_GATE_MAX_MS = 250;

/**
 * @typedef {import('./trialWatchSettings.shared').DEFAULT_TRIAL_WATCH_SETTINGS} TrialWatchSettings
 */

/**
 * @typedef {{
 *   premiumPlaybackReady: boolean;
 *   isSubscribed: boolean;
 *   freeMode: boolean;
 *   trialWatchSettings: TrialWatchSettings;
 * }} PremiumAccessSnapshot
 */

/**
 * @param {PremiumAccessSnapshot} snapshot
 * @param {{ playerChannel: object; cardIsPremium: boolean; navigation: object; openPaymentModal: () => void | Promise<void>; verifySubscriptionBeforePlay: () => Promise<boolean>; security: object; Alert: { alert: (title: string, msg: string) => void } }} ctx
 */
export async function openPremiumChannelFromSnapshot(snapshot, ctx) {
  const {
    playerChannel,
    cardIsPremium,
    navigation,
    openPaymentModal,
    verifySubscriptionBeforePlay,
    security,
    Alert,
  } = ctx;

  const channelKey = String(
    playerChannel?.id ?? playerChannel?.channel_id ?? playerChannel?.name ?? '',
  ).trim();
  if (!playerChannel) {
    logChannelCardTap('navigation_blocked', { channelKey, reason: 'missing_player_channel' });
    return;
  }

  const intelGate = assertDeviceIntelligenceAllowed();
  if (!intelGate.ok) {
    logChannelCardTap('navigation_blocked', { channelKey, reason: 'device_intelligence' });
    return;
  }

  const isFreeChannel = channelIsFreeAccess(playerChannel, { freeMode: snapshot.freeMode });
  const isPremiumChannel = channelIsPremiumAccess(playerChannel, { freeMode: snapshot.freeMode });
  const premiumContent =
    !snapshot.freeMode && !isFreeChannel && isPremiumChannel && cardIsPremium;

  if (!premiumContent) {
    const secGate = assertPlaybackAllowed(security);
    if (!secGate.ok) {
      logChannelCardTap('navigation_blocked', { channelKey, reason: 'security', message: secGate.message });
      Alert.alert('Usalama', secGate.message);
      return;
    }
    logChannelCardTap('navigation_navigate', { channelKey, path: 'free_or_included' });
    navigation.navigate('ChannelPlayer', {
      channel: playerChannel,
      trialWatchBootstrap: null,
    });
    return;
  }

  if (!snapshot.isSubscribed) {
    let trial = null;
    try {
      trial = await withTimeout(
        getTrialChannelAccess(snapshot.trialWatchSettings),
        TRIAL_GATE_MAX_MS,
        'trial-gate',
      );
    } catch {
      trial = null;
    }
    if (trial?.allowViaTrial && trial.bootstrap) {
      const secGate = assertPlaybackAllowed(security);
      if (!secGate.ok) {
        logChannelCardTap('navigation_blocked', { channelKey, reason: 'security_trial', message: secGate.message });
        Alert.alert('Usalama', secGate.message);
        return;
      }
      logChannelCardTap('navigation_navigate', { channelKey, path: 'trial' });
      navigation.navigate('ChannelPlayer', {
        channel: playerChannel,
        trialWatchBootstrap: trial.bootstrap,
      });
      return;
    }
    logChannelCardTap('navigation_blocked', { channelKey, reason: 'payment_modal' });
    void openPaymentModal();
    return;
  }

  const verifyStartedAt = Date.now();
  logChannelCardTap('verify_subscription_start', { channelKey });
  const ok = await verifySubscriptionBeforePlay();
  logChannelCardTap('verify_subscription_done', {
    channelKey,
    ok,
    waitedMs: Date.now() - verifyStartedAt,
  });
  if (!ok) {
    logChannelCardTap('navigation_blocked', { channelKey, reason: 'subscription_verify_failed' });
    Alert.alert(
      'Kifurushi',
      'Hakuna malipo halali au kifurushi kimekwisha. Lipa ili kuendelea.',
    );
    await openPaymentModal();
    return;
  }

  const secGate = assertPlaybackAllowed(security);
  if (!secGate.ok) {
    logChannelCardTap('navigation_blocked', { channelKey, reason: 'security_premium', message: secGate.message });
    Alert.alert('Usalama', secGate.message);
    return;
  }
  logChannelCardTap('navigation_navigate', { channelKey, path: 'premium_subscribed' });
  navigation.navigate('ChannelPlayer', {
    channel: playerChannel,
    trialWatchBootstrap: null,
  });
}
