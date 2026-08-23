/**
 * Premium channel open flow — always uses a post-init access snapshot (never stale hook closure).
 * Premium playback requires server POST /api/playback/authorize before navigation.
 */

import { authorizePremiumPlayback } from '../api/playbackAuthorize';
import { assertPlaybackAllowed } from '../context/SecurityContext';
import { assertDeviceIntelligenceAllowed } from './deviceIntelligenceAccess';
import {
  channelIsFreeAccess,
  channelIsPremiumAccess,
  getTrialChannelAccess,
} from './trialWatchAccess';
import { logChannelCardTap } from './channelCardTapDiagnostics';
import { hasFreshPremiumAccessIntent } from './premiumAccessIntent';
import { mayOpenPaymentOnExplicitTap } from './paymentAffordancePolicy';
import { buildPlayerChannelFromRow } from './playerChannelFromRow';
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
const TRIAL_GATE_MAX_MS = 50;

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
 * Merge server-authorized channel payload into the player channel.
 * @param {object} playerChannel
 * @param {Record<string, unknown> | null} authorizedApiChannel
 */
function mergeAuthorizedPlayerChannel(playerChannel, authorizedApiChannel) {
  if (!authorizedApiChannel || typeof authorizedApiChannel !== 'object') {
    return playerChannel;
  }
  const built = buildPlayerChannelFromRow(authorizedApiChannel, 0, false);
  return {
    ...playerChannel,
    ...built,
    id: playerChannel?.id ?? built.id,
    channel_id: playerChannel?.channel_id ?? built.channel_id,
    name: playerChannel?.name ?? built.name,
    accessType: 'premium',
    accessPremium: true,
    accessDenied: false,
    access_deny_reason: null,
    playback_authorized: true,
  };
}

/**
 * @param {PremiumAccessSnapshot} snapshot
 * @param {{ playerChannel: object; cardIsPremium: boolean; navigation: object; openPaymentModal: () => void | Promise<void>; verifySubscriptionBeforePlay?: () => Promise<boolean>; verifySubscriptionInBackground?: (reason?: string) => void; awaitEntitlementForTap?: () => Promise<object>; onEntitlementDeferred?: (channel: object) => void; onSubscriptionDeniedByServer?: (reason: string) => void; security: object; Alert: { alert: (title: string, msg: string) => void } }} ctx
 * @returns {Promise<'navigated'|'payment'|'deferred'>}
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
    onSubscriptionDeniedByServer,
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

  const tryNavigateFreeOrIncluded = () => {
    const secGate = assertPlaybackAllowed(security);
    if (!secGate.ok) {
      logChannelCardTap('navigation_blocked', { channelKey, reason: 'security', message: secGate.message });
      Alert.alert('Usalama', secGate.message);
      return false;
    }
    logChannelCardTap('navigation_navigate', { channelKey, path: 'free_or_included' });
    navigation.navigate('ChannelPlayer', {
      channel: playerChannel,
      trialWatchBootstrap: null,
    });
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
      try {
        const auth = await withTimeout(
          authorizePremiumPlayback({ channelId: channelKey }),
          10_000,
          'playback-authorize-trial',
        );
        if (auth?.allowed && auth.channel) {
          const authorizedChannel = mergeAuthorizedPlayerChannel(playerChannel, auth.channel);
          logChannelCardTap('navigation_navigate', { channelKey, path: 'trial_server_authorized' });
          navigation.navigate('ChannelPlayer', {
            channel: authorizedChannel,
            trialWatchBootstrap: trial.bootstrap,
            playbackGrant: auth.grant ?? null,
            playbackAuthorized: true,
          });
          return 'navigated';
        }
      } catch {
        /* fall through to payment */
      }
      logChannelCardTap('navigation_blocked', { channelKey, reason: 'payment_modal_after_trial_denied' });
      void openPaymentModal();
      return 'payment';
    }
    logChannelCardTap('navigation_blocked', { channelKey, reason: 'payment_modal', phase: snap.entitlementPhase });
    void openPaymentModal();
    return 'payment';
  };

  /**
   * Server authorize is mandatory for premium — local isSubscribed alone is not enough.
   */
  const tryNavigatePremiumAuthorized = async () => {
    const secGate = assertPlaybackAllowed(security);
    if (!secGate.ok) {
      logChannelCardTap('navigation_blocked', {
        channelKey,
        reason: 'security_premium',
        message: secGate.message,
      });
      Alert.alert('Usalama', secGate.message);
      return 'deferred';
    }

    let auth;
    try {
      auth = await withTimeout(
        authorizePremiumPlayback({ channelId: channelKey }),
        10_000,
        'playback-authorize',
      );
    } catch (err) {
      logChannelCardTap('navigation_blocked', {
        channelKey,
        reason: 'authorize_transport',
        message: String(err?.message ?? err),
      });
      Alert.alert('Mtandao', 'Imeshindikana kuthibitisha kifurushi. Jaribu tena.');
      return 'deferred';
    }

    if (auth?.securityDeny) {
      logChannelCardTap('navigation_blocked', {
        channelKey,
        reason: 'security_policy_denied',
        message: auth.reason,
      });
      Alert.alert('Usalama', 'Uchezaji umezuiwa kwa sababu za usalama.');
      return 'deferred';
    }

    if (!auth?.allowed) {
      logChannelCardTap('navigation_blocked', {
        channelKey,
        reason: 'server_entitlement_denied',
        denyReason: auth?.reason ?? null,
      });
      if (auth?.subscriptionDeny) {
        onSubscriptionDeniedByServer?.(auth.reason);
      }
      return tryOpenPaymentFlow();
    }

    const authorizedChannel = mergeAuthorizedPlayerChannel(playerChannel, auth.channel);
    if (!String(authorizedChannel?.url ?? '').trim()) {
      logChannelCardTap('navigation_blocked', {
        channelKey,
        reason: 'authorize_ok_but_empty_url',
      });
      return tryOpenPaymentFlow();
    }

    logChannelCardTap('navigation_navigate', {
      channelKey,
      path: 'premium_server_authorized',
      grant: Boolean(auth.grant),
    });
    navigation.navigate('ChannelPlayer', {
      channel: authorizedChannel,
      trialWatchBootstrap: null,
      playbackGrant: auth.grant ?? null,
      playbackAuthorized: true,
    });
    void (verifySubscriptionInBackground ?? verifySubscriptionBeforePlay)?.('channel-tap');
    return 'navigated';
  };

  if (!premiumContent) {
    if (tryNavigateFreeOrIncluded()) return 'navigated';
    return 'deferred';
  }

  if (snapshotHasActiveSubscription(snap) || mayNavigatePremiumImmediate(snap.entitlementPhase)) {
    return tryNavigatePremiumAuthorized();
  }

  if (hasFreshPremiumAccessIntent() && mayOpenPaymentOnExplicitTap(snap)) {
    logChannelCardTap('navigation_blocked', {
      channelKey,
      reason: 'payment_modal_explicit_tap_no_bootstrap',
      phase: snap.entitlementPhase ?? null,
    });
    return tryOpenPaymentFlow();
  }

  if (snapshotNeedsEntitlementAwait(snap) && awaitEntitlementForTap) {
    logChannelCardTap('entitlement_resolving', { channelKey, path: 'await_tap' });
    snap = withCanonicalEntitlement(await awaitEntitlementForTap());
    if (snapshotHasActiveSubscription(snap) || mayNavigatePremiumImmediate(snap.entitlementPhase)) {
      return tryNavigatePremiumAuthorized();
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
      return tryNavigatePremiumAuthorized();
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

  if (hasFreshPremiumAccessIntent() && mayOpenPaymentOnExplicitTap(snap)) {
    logChannelCardTap('navigation_blocked', {
      channelKey,
      reason: 'payment_modal_d3ba89c_explicit_tap',
      phase,
    });
    return tryOpenPaymentFlow();
  }

  if (phase === 'UNKNOWN') {
    logChannelCardTap('navigation_deferred', {
      channelKey,
      reason: 'entitlement_pending_deferred',
      phase,
    });
    onEntitlementDeferred?.(playerChannel);
    return 'deferred';
  }

  if (mayOpenPaymentPopup(snap) || snapshotAllowsExplicitTapPayment(snap)) {
    return tryOpenPaymentFlow();
  }

  logChannelCardTap('navigation_blocked', {
    channelKey,
    reason: 'entitlement_unknown_no_popup',
    phase: snap.entitlementPhase ?? null,
  });
  return tryOpenPaymentFlow();
}
