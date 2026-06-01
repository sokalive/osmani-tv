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

  if (!playerChannel) return;

  const intelGate = assertDeviceIntelligenceAllowed();
  if (!intelGate.ok) return;

  const isFreeChannel = channelIsFreeAccess(playerChannel, { freeMode: snapshot.freeMode });
  const isPremiumChannel = channelIsPremiumAccess(playerChannel, { freeMode: snapshot.freeMode });
  const premiumContent =
    !snapshot.freeMode && !isFreeChannel && isPremiumChannel && cardIsPremium;

  if (!premiumContent) {
    const secGate = assertPlaybackAllowed(security);
    if (!secGate.ok) {
      Alert.alert('Usalama', secGate.message);
      return;
    }
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
        Alert.alert('Usalama', secGate.message);
        return;
      }
      navigation.navigate('ChannelPlayer', {
        channel: playerChannel,
        trialWatchBootstrap: trial.bootstrap,
      });
      return;
    }
    await openPaymentModal();
    return;
  }

  const ok = await verifySubscriptionBeforePlay();
  if (!ok) {
    Alert.alert(
      'Kifurushi',
      'Hakuna malipo halali au kifurushi kimekwisha. Lipa ili kuendelea.',
    );
    await openPaymentModal();
    return;
  }

  const secGate = assertPlaybackAllowed(security);
  if (!secGate.ok) {
    Alert.alert('Usalama', secGate.message);
    return;
  }
  navigation.navigate('ChannelPlayer', {
    channel: playerChannel,
    trialWatchBootstrap: null,
  });
}
