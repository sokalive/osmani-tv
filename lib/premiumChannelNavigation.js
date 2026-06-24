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
import { shouldBlockChannelForUpdate } from './channelUpdateGate';
import { isInstructionVideoChannel } from './instructionVideoChannel';

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
 * @param {{ playerChannel: object; cardIsPremium: boolean; navigation: object; openPaymentModal: () => void | Promise<void>; verifySubscriptionBeforePlay: () => Promise<boolean>; security: object; Alert: { alert: (title: string, msg: string) => void }; requireUpdateBeforeChannelPlayback?: boolean; onChannelUpdateRequired?: () => void }} ctx
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
    requireUpdateBeforeChannelPlayback,
    onChannelUpdateRequired,
  } = ctx;

  const channelKey = String(
    playerChannel?.id ?? playerChannel?.channel_id ?? playerChannel?.name ?? '',
  ).trim();
  if (!playerChannel) {
    logChannelCardTap('navigation_blocked', { channelKey, reason: 'missing_player_channel' });
    return;
  }

  if (
    shouldBlockChannelForUpdate(requireUpdateBeforeChannelPlayback) &&
    !isInstructionVideoChannel(playerChannel)
  ) {
    const shown = onChannelUpdateRequired?.() === true;
    logChannelCardTap('navigation_blocked', {
      channelKey,
      reason: shown ? 'channel_update_gate' : 'channel_update_gate_deferred',
    });
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
    const trial = await getTrialChannelAccess(snapshot.trialWatchSettings);
    if (trial.allowViaTrial && trial.bootstrap) {
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
    openPaymentModal();
    return;
  }

  if (snapshot.isSubscribed) {
    logChannelCardTap('verify_subscription_skipped_cache', { channelKey });
    void verifySubscriptionBeforePlay();
  } else {
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
