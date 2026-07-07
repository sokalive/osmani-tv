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
import {
  deriveEntitlementPhase,
  mayOpenPaymentPopup,
  mayNavigatePremiumImmediate,
  snapshotHasActiveSubscription,
  snapshotAllowsExplicitTapPayment,
  snapshotNeedsEntitlementAwait,
  withCanonicalEntitlement,
} from './entitlementStateMachine';

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
 *   entitlementPhase?: string;
 *   authoritativeInactiveConfirmed?: boolean;
 *   cacheTrustedActive?: boolean;
 *   subscriptionSyncLoaded?: boolean;
 * }} PremiumAccessSnapshot
 */

/**
 * @param {PremiumAccessSnapshot} snapshot
 * @param {{ playerChannel: object; cardIsPremium: boolean; navigation: object; openPaymentModal: () => void | Promise<void>; verifySubscriptionBeforePlay?: () => Promise<boolean>; verifySubscriptionInBackground?: (reason?: string) => void; awaitEntitlementForTap?: () => Promise<object>; onEntitlementDeferred?: (channel: object) => void; security: object; Alert: { alert: (title: string, msg: string) => void } }} ctx
 * @returns {'navigated'|'payment'|'deferred'}
 */
export async function openPremiumChannelFromSnapshot(snapshot, ctx) {
  const {
    playerChannel,
    navigation,
    openPaymentModal,
    verifySubscriptionBeforePlay,
    verifySubscriptionInBackground,
    awaitEntitlementForTap,
    onEntitlementDeferred,
    security,
    Alert,
  } = ctx;

  const channelKey = String(
    playerChannel?.id ?? playerChannel?.channel_id ?? playerChannel?.name ?? '',
  ).trim();
  if (!playerChannel) {
    logChannelCardTap('navigation_blocked', { channelKey, reason: 'missing_player_channel' });
    return 'deferred';
  }

  const intelGate = assertDeviceIntelligenceAllowed();
  if (!intelGate.ok) {
    logChannelCardTap('navigation_blocked', { channelKey, reason: 'device_intelligence' });
    return 'deferred';
  }

  const isFreeChannel = channelIsFreeAccess(playerChannel, { freeMode: snapshot.freeMode });
  const isPremiumChannel = channelIsPremiumAccess(playerChannel, { freeMode: snapshot.freeMode });
  const premiumContent =
    !snapshot.freeMode && !isFreeChannel && isPremiumChannel;

  let snap = withCanonicalEntitlement(snapshot);

  const tryNavigatePremium = () => {
    const secGate = assertPlaybackAllowed(security);
    if (!secGate.ok) {
      logChannelCardTap('navigation_blocked', { channelKey, reason: 'security_premium', message: secGate.message });
      Alert.alert('Usalama', secGate.message);
      return false;
    }
    logChannelCardTap('navigation_navigate', { channelKey, path: 'premium_subscribed_cache_fast' });
    navigation.navigate('ChannelPlayer', {
      channel: playerChannel,
      trialWatchBootstrap: null,
    });
    void (verifySubscriptionInBackground ?? verifySubscriptionBeforePlay)?.('channel-tap');
    return true;
  };

  const tryOpenPaymentFlow = async () => {
    let trial = null;
    try {
      trial = await withTimeout(
        getTrialChannelAccess(snap.trialWatchSettings),
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
        return 'deferred';
      }
      logChannelCardTap('navigation_navigate', { channelKey, path: 'trial' });
      navigation.navigate('ChannelPlayer', {
        channel: playerChannel,
        trialWatchBootstrap: trial.bootstrap,
      });
      return 'navigated';
    }
    logChannelCardTap('navigation_blocked', { channelKey, reason: 'payment_modal', phase: snap.entitlementPhase });
    void openPaymentModal();
    return 'payment';
  };

  if (!premiumContent) {
    const secGate = assertPlaybackAllowed(security);
    if (!secGate.ok) {
      logChannelCardTap('navigation_blocked', { channelKey, reason: 'security', message: secGate.message });
      Alert.alert('Usalama', secGate.message);
      return 'deferred';
    }
    logChannelCardTap('navigation_navigate', { channelKey, path: 'free_or_included' });
    navigation.navigate('ChannelPlayer', {
      channel: playerChannel,
      trialWatchBootstrap: null,
    });
    return 'navigated';
  }

  if (snapshotHasActiveSubscription(snap) || mayNavigatePremiumImmediate(snap.entitlementPhase)) {
    if (tryNavigatePremium()) return 'navigated';
    return 'deferred';
  }

  if (snapshotNeedsEntitlementAwait(snap) && awaitEntitlementForTap) {
    logChannelCardTap('entitlement_resolving', { channelKey, path: 'await_tap' });
    snap = withCanonicalEntitlement(await awaitEntitlementForTap());
    if (snapshotHasActiveSubscription(snap) || mayNavigatePremiumImmediate(snap.entitlementPhase)) {
      if (tryNavigatePremium()) return 'navigated';
      return 'deferred';
    }
    if (snapshotAllowsExplicitTapPayment(snap)) {
      return tryOpenPaymentFlow();
    }
  }

  if (snapshotAllowsExplicitTapPayment(snap)) {
    return tryOpenPaymentFlow();
  }

  const phase = snap.entitlementPhase ?? deriveEntitlementPhase(snap);
  if (phase === 'UNKNOWN' && awaitEntitlementForTap) {
    logChannelCardTap('entitlement_resolving', { channelKey, path: 'await_unknown' });
    snap = withCanonicalEntitlement(await awaitEntitlementForTap());
    if (snapshotHasActiveSubscription(snap) || mayNavigatePremiumImmediate(snap.entitlementPhase)) {
      if (tryNavigatePremium()) return 'navigated';
      return 'deferred';
    }
    if (snapshotAllowsExplicitTapPayment(snap)) {
      return tryOpenPaymentFlow();
    }
  }

  if (snapshotNeedsEntitlementAwait(snap)) {
    logChannelCardTap('navigation_deferred', {
      channelKey,
      reason: 'entitlement_still_resolving_no_popup',
      phase: snap.entitlementPhase ?? null,
    });
    onEntitlementDeferred?.(playerChannel);
    return 'deferred';
  }

  if (
    phase === 'UNKNOWN' ||
    phase === 'ERROR_UNKNOWN' ||
    (!snapshotHasActiveSubscription(snap) && !mayNavigatePremiumImmediate(phase))
  ) {
    logChannelCardTap('navigation_deferred', {
      channelKey,
      reason: 'entitlement_pending_deferred',
      phase,
    });
    onEntitlementDeferred?.(playerChannel);
    return 'deferred';
  }

  if (!snap.isSubscribed && snap.subscriptionSyncLoaded === true) {
    logChannelCardTap('navigation_blocked', {
      channelKey,
      reason: 'payment_modal_d3ba89c_fallback',
      phase,
    });
    return tryOpenPaymentFlow();
  }

  logChannelCardTap('navigation_blocked', {
    channelKey,
    reason: 'entitlement_unknown_no_popup',
    phase: snap.entitlementPhase ?? null,
  });
  return 'deferred';
}
