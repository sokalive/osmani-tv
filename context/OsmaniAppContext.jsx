import React, { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { getBanners, getChannels, getServerHealth, invalidateCatalogCache } from '../api';
import { devLog } from '../lib/devLog';
import { logStartupStep } from '../lib/startupStepLog';
import { sortChannelsByAdminOrder } from '../lib/channelOrder';
import { parseAppSettingsRealtimePatch, tryGetViewerAppSettings } from '../api/settings';
import { tryGetViewerTrialWatchSettings } from '../api/trialWatchSettings';
import {
  TRIAL_WATCH_FAIL_CLOSED,
  parseTrialWatchSettings,
} from '../lib/trialWatchSettings.shared';
import {
  clearSubscriptionCache,
  getSubscriptionStatusForDevice,
  isSubscriptionPendingActivation,
  isSubscriptionTransportFailure,
  readSubscriptionCache,
  recoverSubscription,
  resolveActiveSubscription,
  writeSubscriptionCache,
} from '../api/subscription';
import { ADMIN_RUNTIME_MODE_SSE_EVENTS, ADMIN_SOFT_REFRESH_SSE_EVENTS, SUBSCRIPTION_WAKE_SSE_EVENTS, USER_CENTER_SSE_EVENTS, DELETE_USER_SSE_EVENTS } from '../lib/adminSseRefreshEvents';
import {
  dropLegacyBannersCache,
  readBannersCache,
  writeBannersCache,
} from '../lib/bannersCache';
import { readChannelsCache, writeChannelsCache } from '../lib/channelsCache';
import { isNetworkTransportError } from '../lib/catalogApiFetch';
import { shouldMarkCatalogOffline, isTransientServerError, formatUserFacingApiError } from '../lib/catalogConnectivity';
import { getApiBaseUrl } from '../lib/apiBaseUrl';
import { probeApiHostRouting } from '../lib/playVpsApiHost';
import { enrichBannersForViewer } from '../lib/bannerViewerSerializer';
import { logBannerRuntimeDiagnostics } from '../lib/normalizeBanner';
import { getDeviceIdentity } from '../lib/deviceIdentity';
import { subscribeRealtimeEvent } from '../lib/realtimeSync';
import { startSubscriptionDeviceStream } from '../lib/subscriptionDeviceStream';
import {
  CHANNEL_ACCESS_IMMEDIATE_SSE_EVENTS,
  isAuthoritativeReconcileReason,
} from '../lib/subscriptionReconcile';
import {
  devicesShareIdentity,
  isAuthoritativeInactiveEntitlement,
  isConfirmedSubscriptionLoss,
  isExplicitTransferRevokeReason,
  isUserConfirmedTransferReason,
  logSubscriptionLossModalDecision,
  pickTransferSseReason,
  resolveSubscriptionLossModalReason,
  subscriptionTransferSseRole,
  unwrapSubscriptionSsePayload,
} from '../lib/subscriptionSseGuard';
import { withTimeout } from '../lib/asyncTimeout';
import {
  readHydratableSubscriptionCache,
  isSameDeviceSubscriptionCache,
  subscriptionDetailsFromCache,
  subscriptionDetailsFromVerifyResult,
} from '../lib/subscriptionCacheHydrate';
import { isStaleActiveSubscriptionCache, shouldHydrateSubscriptionCache } from '../lib/subscriptionCacheRepair';
import { deriveEntitlementPhase, isTrustworthyActiveCache } from '../lib/entitlementStateMachine';
import {
  applyChannelAccessPatches,
  catalogRealtimeEventMayCarryChannelAccess,
  parseChannelAccessRealtimePatches,
} from '../lib/channelCatalogRealtime';
import { purgeUnreliableSubscriptionCache, SUBSCRIPTION_RECOVERY_BOOT_TIMEOUT_MS } from '../lib/subscriptionRecoveryBoot';
import {
  extractPlanSnapshotFromDetails,
  mergeSubscriptionDetails,
} from '../lib/subscriptionDetailsMerge';
import { enrichCanonicalSubscriptionTiming } from '../lib/subscriptionCanonical';
import { enrichSubscriptionDetailsForDisplay, buildAccountDisplayDetails } from '../lib/accountSubscriptionDisplay';
import { traceAccountDisplay } from '../lib/accountDisplayTrace';
import { buildPaymentSuccessDetails } from '../lib/paymentSuccessDisplay';
import {
  isActivationSuccessSseEvent,
  parseInstantSubscriptionFromSse,
  sseGrantTargetsThisDevice,
} from '../lib/subscriptionSseInstant';
import {
  getCachedPaymentPlansSync,
  hydratePaymentPlansCacheFromStorage,
  refreshPaymentPlansCache,
  seedPaymentPlansCacheFromVerify,
} from '../lib/paymentPlansCache';
import { reportUserCenterEvent } from '../api/userCenterSync';
import { registerDeviceIntelligence } from '../api/usersIntelligence';
import { isTransferAwaitingSourceApproval } from '../lib/transferAwaitingSourceApproval';
import { runTransferNavigateHome } from '../lib/transferNavigation';

const STARTUP_FETCH_TIMEOUT_MS = 20_000;
const COLD_START_SUBSCRIPTION_TIMEOUT_MS = SUBSCRIPTION_RECOVERY_BOOT_TIMEOUT_MS;
/** Fast identity resolve on boot — status probe + migration candidates before sync ready. */
const RECOVER_BOOT_TIMEOUT_MS = 8_000;
/** Multi-candidate verify + status + recover on slow mobile networks (reinstall). */
const SUBSCRIPTION_VERIFY_TIMEOUT_MS = SUBSCRIPTION_RECOVERY_BOOT_TIMEOUT_MS;
const TRIAL_WATCH_BOOT_TIMEOUT_MS = 5_000;

const defaultSettings = {
  freeMode: false,
  emergencyMode: false,
  maintenanceMode: false,
  requireUpdateBeforeChannelPlayback: false,
  phoneNumberGateEnabled: true,
};
/** SSE names that carry free / emergency / maintenance — must not share the catalog debouncer. */
const RUNTIME_MODE_SSE_NAMES = Object.freeze(['app_settings_changed', ...ADMIN_RUNTIME_MODE_SSE_EVENTS]);
const LIVE_SYNC_BASE_MS = 30000;
const LIVE_SYNC_MAX_MS = 120000;
/** Admin flags poll while foreground; SSE is primary — conservative interval for cost. */
const SETTINGS_POLL_MS = 10000;

function isLikelyOfflineError(errorLike) {
  if (isTransientServerError(errorLike)) return false;
  return isNetworkTransportError(errorLike);
}

const OsmaniAppContext = createContext(null);

function pickPayloadString(payload, keys) {
  if (!payload || typeof payload !== 'object') return '';
  for (const key of keys) {
    const value = key.split('.').reduce((acc, part) => (acc && typeof acc === 'object' ? acc[part] : undefined), payload);
    if (value != null && String(value).trim() !== '') return String(value).trim();
  }
  return '';
}

function pickSourceDeviceId(payload) {
  return pickPayloadString(payload, [
    'source_device_id',
    'sourceDeviceId',
    'source_device.device_id',
    'source_device.id',
    'sourceDevice.deviceId',
    'sourceDevice.id',
    'source.id',
  ]);
}

function pickTransferCode(payload) {
  return pickPayloadString(payload, [
    'code',
    'transfer_code',
    'transferCode',
    'transfer.code',
  ]);
}

function bareTransferCode(raw) {
  return String(raw || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .replace(/^TR/, '');
}

export function OsmaniAppProvider({ children }) {
  const [settings, setSettings] = useState(defaultSettings);
  const [rawChannels, setRawChannels] = useState([]);
  const [rawBanners, setRawBanners] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [isOffline, setIsOffline] = useState(false);
  const [serverHealth, setServerHealth] = useState(null);
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [subscriptionExpiresAt, setSubscriptionExpiresAt] = useState(null);
  /**
   * Live, backend-derived view of the active subscription. UI-only: the
   * `active` boolean state lives in `isSubscribed`. This struct exposes
   * `amount`, `planName`, `startedAt`, `serverTime` (+ the local
   * `serverTimeFetchedAt` anchor used for monotonic interpolation) and
   * the available `plans` list returned by the backend.
   */
  const [subscriptionDetails, setSubscriptionDetails] = useState(null);
  const [availablePlans, setAvailablePlans] = useState([]);
  /** Bumps after subscription fetch so consumers can invalidate memos tied to premium access. */
  const [subscriptionVersion, setSubscriptionVersion] = useState(0);
  /** Bumps when channel catalog rows change (access badges, ordering). */
  const [catalogRevision, setCatalogRevision] = useState(0);
  /** True after first successful network channel fetch — gates access badges to avoid stale disk flicker. */
  const [catalogAccessReady, setCatalogAccessReady] = useState(false);
  /** Source device: transfer-out success popup (replaces transferred TransferredAwayModal). */
  const [sourceTransferSuccessVisible, setSourceTransferSuccessVisible] = useState(false);
  /** Active `transfer_requested` payload (source-device approval popup). */
  const [pendingTransfer, setPendingTransfer] = useState(null);
  /** Bumped to re-open global emergency modal (banner / channel tap while emergency). */
  const [emergencyModalRequestVersion, setEmergencyModalRequestVersion] = useState(0);
  const [trialWatchSettings, setTrialWatchSettings] = useState(TRIAL_WATCH_FAIL_CLOSED);
  /** True once we've attempted the initial viewer-safe trial-watch fetch (success or fail). */
  const [trialWatchSettingsLoaded, setTrialWatchSettingsLoaded] = useState(false);
  const trialWatchReadyResolveRef = useRef(null);
  const trialWatchReadyPromiseRef = useRef(null);
  if (!trialWatchReadyPromiseRef.current) {
    trialWatchReadyPromiseRef.current = new Promise((resolve) => {
      trialWatchReadyResolveRef.current = resolve;
    });
  }

  /** True once cold-start subscription recover+verify has completed (success or fail). */
  const [subscriptionSyncLoaded, setSubscriptionSyncLoaded] = useState(false);
  const [subscriptionRecoveryComplete, setSubscriptionRecoveryComplete] = useState(false);
  const subscriptionReadyResolveRef = useRef(null);
  const subscriptionReadyPromiseRef = useRef(null);
  if (!subscriptionReadyPromiseRef.current) {
    subscriptionReadyPromiseRef.current = new Promise((resolve) => {
      subscriptionReadyResolveRef.current = resolve;
    });
  }
  /** Incremented to open PremiumModal from any screen (trial / preview expiry). */
  const [paymentModalRequest, setPaymentModalRequest] = useState(0);
  /** Global activation success (admin grant, offer code, transfer target — not payment modal). */
  const [activationSuccessVisible, setActivationSuccessVisible] = useState(false);
  const [activationSuccessDetails, setActivationSuccessDetails] = useState(null);
  const [activationSuccessSource, setActivationSuccessSource] = useState('admin_grant');
  /** Legacy channel playback blocked until APK update (admin toggle). */
  const [channelUpdateGateVisible, setChannelUpdateGateVisible] = useState(false);
  const presentChannelUpdateGateRef = useRef(() => false);

  const verifyInFlightRef = useRef(false);
  const refreshInFlightRef = useRef(0);
  const refreshPromiseRef = useRef(null);
  /** Prevents cold-start disk cache hydrate from overwriting fresher catalog network sync. */
  const catalogNetworkHydratedRef = useRef({ channels: false, banners: false });
  const verifyPromiseRef = useRef(null);
  const recoverBootPromiseRef = useRef(null);
  const lastVerifyKeyRef = useRef(0);
  /** Authoritative subscription flag for playback gates (updated synchronously on verify). */
  const isSubscribedRef = useRef(false);
  /** Backend confirmed inactive — only then may payment popup open on cold start. */
  const authoritativeInactiveRef = useRef(false);
  /** Same-device unexpired cache trusted while server reconcile in flight. */
  const cacheTrustedActiveRef = useRef(false);
  /** Last cold-start resolve result for gate diagnostics. */
  const lastBootResolveRef = useRef(null);
  /** Prevents duplicate Hongera popups for the same grant within a session. */
  const lastActivationSuccessKeyRef = useRef('');
  /**
   * After optimistic SSE/payment unlock, ignore non-authoritative inactive verify
   * briefly so replica lag cannot re-lock — and so we can reverify immediately
   * (Account boxes) instead of waiting 2.5s before reconcile.
   */
  const instantUnlockProtectUntilRef = useRef(0);
  const instantUnlockExpiresAtRef = useRef(null);
  const instantUnlockGraceRetryTimerRef = useRef(null);
  const INSTANT_UNLOCK_GRACE_MS = 5000;
  const isWithinInstantUnlockGrace = useCallback(
    () => Date.now() < instantUnlockProtectUntilRef.current,
    [],
  );
  const trialWatchSettingsRef = useRef(TRIAL_WATCH_FAIL_CLOSED);
  const settingsRef = useRef(defaultSettings);
  const rawChannelsRef = useRef([]);
  /** Set after source POST /transfer/request succeeds; gates Kubali/Kataa popup. */
  const sourceTransferSessionRef = useRef(null);
  /** Blocks cache hydrate / verify re-activation on source after transfer-out. */
  const sourceTransferClearLockUntilRef = useRef(0);
  const SOURCE_TRANSFER_CLEAR_LOCK_MS = 10 * 60 * 1000;

  /**
   * Apply cached active subscription for instant UI / gates. Server verify
   * runs in background and may revoke only on confirmed inactive.
   */
  const hydrateSubscriptionFromCache = useCallback(async (reason = 'cache-hydrate') => {
    if (authoritativeInactiveRef.current) {
      console.log('[SUBSCRIPTION_CACHE]', reason, 'skipped_hydrate_authoritative_inactive');
      return false;
    }
    if (sourceTransferClearLockUntilRef.current > Date.now()) {
      console.log('[SUBSCRIPTION_CACHE]', reason, 'skipped_hydrate_after_source_transfer');
      return false;
    }
    const { cached } = await readHydratableSubscriptionCache();
    if (!cached?.active || !shouldHydrateSubscriptionCache(cached)) return false;
    isSubscribedRef.current = true;
    authoritativeInactiveRef.current = false;
    cacheTrustedActiveRef.current = true;
    setIsSubscribed(true);
    setSubscriptionExpiresAt(cached.expiresAt ?? null);
    setSubscriptionDetails((prev) =>
      mergeSubscriptionDetails(
        prev,
        enrichSubscriptionDetailsForDisplay(
          subscriptionDetailsFromCache(cached),
          getCachedPaymentPlansSync() ?? [],
        ),
      ),
    );
    setSubscriptionVersion((v) => v + 1);
    console.log('[SUBSCRIPTION_CACHE]', reason, 'hydrated_active', {
      expiresAt: cached.expiresAt ?? null,
    });
    return true;
  }, []);

  /**
   * v1.0.0-style instant subscription UI — SSE hints, unlock, admin grants.
   * Persists cache + details immediately; background verify still confirms access.
   */
  const applyInstantSubscriptionState = useCallback(async (hint, reason = 'instant') => {
    if (!hint || hint.active !== true) return null;
    const expiresAt = hint.expiresAt ?? null;
    // Invalidate any in-flight reverify so a stale inactive result cannot re-lock
    // channels right after payment / SSE / unlock-channels apply.
    lastVerifyKeyRef.current += 1;
    instantUnlockProtectUntilRef.current = Date.now() + INSTANT_UNLOCK_GRACE_MS;
    instantUnlockExpiresAtRef.current = expiresAt;
    isSubscribedRef.current = true;
    authoritativeInactiveRef.current = false;
    cacheTrustedActiveRef.current = false;
    setIsSubscribed(true);
    setSubscriptionExpiresAt(expiresAt);

    const catalogPlans = [
      ...(Array.isArray(hint.plans) ? hint.plans : []),
      ...(getCachedPaymentPlansSync() ?? []),
    ];
    const detailsBase = subscriptionDetailsFromVerifyResult({ ...hint, active: true });
    const enriched = buildAccountDisplayDetails(
      detailsBase,
      expiresAt,
      catalogPlans,
    );

    let mergedDetails = enriched;
    setSubscriptionDetails((prev) => {
      mergedDetails = mergeSubscriptionDetails(prev, enriched);
      return mergedDetails;
    });
    setSubscriptionVersion((v) => v + 1);

    if (Array.isArray(hint.plans) && hint.plans.length > 0) {
      setAvailablePlans(hint.plans);
      void seedPaymentPlansCacheFromVerify(hint.plans);
    }

    try {
      const identity = await getDeviceIdentity();
      const planSnapshot = extractPlanSnapshotFromDetails(mergedDetails);
      await writeSubscriptionCache({
        active: true,
        expiresAt,
        deviceId: identity.deviceId,
        fingerprint: identity.deviceFingerprint,
        planSnapshot,
      });
    } catch (e) {
      console.log('[SUBSCRIPTION_INSTANT]', reason, 'cache_write_error', e?.message ?? e);
    }

    console.log('[SUBSCRIPTION_INSTANT]', reason, {
      expiresAt,
      planName: mergedDetails?.planName ?? null,
      planDurationDays: mergedDetails?.planDurationDays ?? null,
    });
    traceAccountDisplay('applyInstantSubscriptionState', {
      reason,
      planName: mergedDetails?.planName ?? null,
      amount: mergedDetails?.amount ?? null,
      planDurationDays: mergedDetails?.planDurationDays ?? null,
      planId: mergedDetails?.planId ?? null,
      plansCount: Array.isArray(mergedDetails?.plans) ? mergedDetails.plans.length : 0,
    });
    return mergedDetails;
  }, []);

  const showActivationSuccess = useCallback((details, source = 'admin_grant') => {
    const built = buildPaymentSuccessDetails(details);
    const hasDisplayable =
      Boolean(built?.expiresAt) ||
      Boolean(built?.planName) ||
      (source === 'transfer' &&
        (Number.isFinite(built?.amount) || Number.isFinite(built?.remainingDays)));
    if (!hasDisplayable) return;
    const dedupeKey = `${source}:${built.expiresAt ?? ''}:${built.planName ?? ''}:${built.amount ?? ''}`;
    if (lastActivationSuccessKeyRef.current === dedupeKey) {
      console.log('[ACTIVATION_SUCCESS]', 'deduped', { dedupeKey });
      return;
    }
    lastActivationSuccessKeyRef.current = dedupeKey;
    setActivationSuccessDetails(built);
    setActivationSuccessSource(source);
    setActivationSuccessVisible(true);
  }, []);

  const dismissActivationSuccess = useCallback(() => {
    setActivationSuccessVisible(false);
    setActivationSuccessDetails(null);
  }, []);

  const tryInstantApplyFromSse = useCallback(
    async (eventName, payload) => {
      if (!(await sseGrantTargetsThisDevice(payload))) {
        console.log('[SUBSCRIPTION_INSTANT]', 'sse_skipped_other_device', { eventName });
        return null;
      }
      const hint = parseInstantSubscriptionFromSse(payload, eventName);
      if (hint?.active !== true) return null;
      const details = await applyInstantSubscriptionState(hint, `sse-instant:${eventName}`);
      if (
        details &&
        isActivationSuccessSseEvent(eventName) &&
        eventName !== 'payment_success' &&
        eventName !== 'payment_completed'
      ) {
        const source =
          eventName === 'manual_subscription_granted' ? 'admin_grant' : 'custom_grant';
        showActivationSuccess(details, source);
      }
      return details;
    },
    [applyInstantSubscriptionState, showActivationSuccess],
  );

  /**
   * Single trust path. Always hits the backend and treats `active` as the
   * sole source of truth. Updates context state, AsyncStorage cache, and
   * the revoked banner. Returns the verify response so callers (e.g. the
   * player) can gate playback on the same atomic answer.
   */
  const reverifySubscription = useCallback(async (reason = 'manual') => {
    if (verifyPromiseRef.current) {
      console.log('[SUBSCRIPTION_VERIFY]', 'awaiting in-flight', { reason });
      return verifyPromiseRef.current;
    }

    const run = (async () => {
      verifyInFlightRef.current = true;
      const verifyKey = ++lastVerifyKeyRef.current;
      const authoritativeReconcile = isAuthoritativeReconcileReason(reason);
      try {
      const identity = await getDeviceIdentity();
      const { deviceId, deviceFingerprint } = identity;
      if (authoritativeReconcile && String(reason).includes('subscription_revoked')) {
        try {
          await clearSubscriptionCache(`pre-reconcile:${reason}`);
        } catch {
          /* ignore */
        }
      }
      let r;
      try {
        r = await withTimeout(
          resolveActiveSubscription(identity, { skipFastProbe: authoritativeReconcile }),
          SUBSCRIPTION_VERIFY_TIMEOUT_MS,
          'resolve-active-subscription',
        );
      } catch (e) {
        r = {
          active: false,
          expiresAt: null,
          error: String(e?.message ?? e),
          resolveSource: 'transport:timeout',
        };
      }
      if (verifyKey !== lastVerifyKeyRef.current) return r;
        let active = r.active === true;
        let expiresAt = r.expiresAt ?? null;
        let effectiveResult = r;
        const transferLockActive = sourceTransferClearLockUntilRef.current > Date.now();
        const authoritativeInactive = isAuthoritativeInactiveEntitlement(r);

        const cacheSameDevice = async () => {
          const cached = await readSubscriptionCache();
          return { cached, sameDevice: isSameDeviceSubscriptionCache(cached, identity) };
        };

        if (transferLockActive && active) {
          const src = String(r.resolveSource ?? '');
          if (src !== 'inactive') {
            console.log('[SUBSCRIPTION_VERIFY]', reason, 'blocked_reactivate_after_source_transfer', {
              resolveSource: src,
            });
            active = false;
            expiresAt = null;
            effectiveResult = { ...r, active: false, expiresAt: null };
          } else {
            sourceTransferClearLockUntilRef.current = 0;
          }
        }

        if (!active && !authoritativeInactive && !authoritativeReconcile && isSubscriptionTransportFailure(r)) {
          if (transferLockActive) {
            console.log('[SUBSCRIPTION_VERIFY]', reason, 'skipped_transport_cache_after_source_transfer');
          } else {
          const { cached, sameDevice } = await cacheSameDevice();
          if (cached?.active && sameDevice) {
            active = true;
            expiresAt = cached.expiresAt ?? null;
            effectiveResult = {
              ...r,
              active: true,
              expiresAt,
              transportPreserved: true,
            };
            console.log('[SUBSCRIPTION_VERIFY]', reason, 'transport_preserved_cache', {
              expiresAt,
              error: r.error,
            });
          }
          }
        }

        if (
          !authoritativeInactive &&
          !authoritativeReconcile &&
          !active &&
          !transferLockActive &&
          (isSubscriptionTransportFailure(r) || String(r.resolveSource ?? '').includes('timeout'))
        ) {
          const statusIds = [
            identity.packageAndroidId,
            identity.legacyPackageAndroidId,
            identity.subscriptionDeviceId,
            deviceId,
          ];
          const seen = new Set();
          for (const rawId of statusIds) {
            const sid = String(rawId ?? '').trim();
            if (!sid || seen.has(sid)) continue;
            seen.add(sid);
            const statusHit = await getSubscriptionStatusForDevice(sid);
            console.log('[SUBSCRIPTION_STATUS]', reason, 'transport_fallback_probe', {
              deviceId: `${sid.slice(0, 8)}…`,
              active: statusHit?.active === true,
              expiresAt: statusHit?.expiresAt ?? null,
            });
            if (statusHit?.active === true) {
              active = true;
              expiresAt = statusHit.expiresAt ?? null;
              effectiveResult = { ...statusHit, resolveSource: 'status:transport_fallback' };
              break;
            }
          }
        } else if (
          !authoritativeInactive &&
          !authoritativeReconcile &&
          !transferLockActive &&
          !active &&
          r.resolveSource === 'inactive' &&
          isSubscriptionPendingActivation(r)
        ) {
          const { cached, sameDevice } = await cacheSameDevice();
          if (cached?.active && sameDevice) {
            active = true;
            expiresAt = cached.expiresAt ?? null;
            effectiveResult = {
              ...r,
              active: true,
              expiresAt,
              pendingPreserved: true,
            };
            console.log('[SUBSCRIPTION_VERIFY]', reason, 'pending_preserved_cache', {
              status: r.status ?? r.raw?.status ?? null,
            });
          }
        } else if (
          !authoritativeInactive &&
          !authoritativeReconcile &&
          !transferLockActive &&
          !active &&
          r.resolveSource !== 'inactive' &&
          isSubscribedRef.current
        ) {
          const { cached, sameDevice } = await cacheSameDevice();
          if (cached?.active && sameDevice) {
            active = true;
            expiresAt = cached.expiresAt ?? null;
            effectiveResult = {
              ...r,
              active: true,
              expiresAt,
              transportPreserved: true,
            };
            console.log('[SUBSCRIPTION_VERIFY]', reason, 'ambiguous_preserved_cache', {
              resolveSource: r.resolveSource ?? null,
            });
          }
        } else if (
          !authoritativeInactive &&
          !authoritativeReconcile &&
          !transferLockActive &&
          !active &&
          isSubscribedRef.current &&
          Date.now() < instantUnlockProtectUntilRef.current
        ) {
          const { cached, sameDevice } = await cacheSameDevice();
          active = true;
          expiresAt =
            instantUnlockExpiresAtRef.current ??
            (sameDevice && cached?.active ? cached.expiresAt ?? null : null) ??
            null;
          effectiveResult = {
            ...r,
            active: true,
            expiresAt,
            instantUnlockPreserved: true,
            amount: cached?.planSnapshot?.amount ?? r.amount ?? null,
            planName: cached?.planSnapshot?.planName ?? r.planName ?? null,
            planId: cached?.planSnapshot?.planId ?? r.planId ?? null,
            planDurationDays:
              cached?.planSnapshot?.planDurationDays ?? r.planDurationDays ?? null,
          };
          console.log('[SUBSCRIPTION_VERIFY]', reason, 'instant_unlock_grace_preserved', {
            resolveSource: r.resolveSource ?? null,
            protectMsLeft: Math.max(0, instantUnlockProtectUntilRef.current - Date.now()),
          });
          if (instantUnlockGraceRetryTimerRef.current == null) {
            const delayMs = Math.max(80, instantUnlockProtectUntilRef.current - Date.now() + 40);
            instantUnlockGraceRetryTimerRef.current = setTimeout(() => {
              instantUnlockGraceRetryTimerRef.current = null;
              void reverifySubscription(`${reason}:grace-retry`);
            }, delayMs);
          }
          // Keep optimistic unlock + Account/Hongera details; do not apply sparse inactive body.
          return effectiveResult;
        }

        if (
          verifyKey !== lastVerifyKeyRef.current ||
          (active === false &&
            r.resolveSource !== 'inactive' &&
            !transferLockActive &&
            !authoritativeReconcile)
        ) {
          if (
            active === false &&
            r.resolveSource !== 'inactive' &&
            !transferLockActive &&
            !authoritativeReconcile
          ) {
            console.log('[SUBSCRIPTION_VERIFY]', reason, 'preserved_subscribed_state', {
              resolveSource: r.resolveSource ?? null,
              hadActive: isSubscribedRef.current,
            });
            return effectiveResult;
          }
          if (verifyKey !== lastVerifyKeyRef.current) return r;
        }

        if (authoritativeInactive) {
          authoritativeInactiveRef.current = true;
          cacheTrustedActiveRef.current = false;
          const modalReason = resolveSubscriptionLossModalReason(r);
          logSubscriptionLossModalDecision(reason, r, modalReason ?? 'silent_no_modal', {
            authoritativeInactive,
          });
        }
        isSubscribedRef.current = active;
        if (active) {
          authoritativeInactiveRef.current = false;
          if (effectiveResult.transportPreserved === true || effectiveResult.pendingPreserved === true) {
            cacheTrustedActiveRef.current = true;
          } else {
            cacheTrustedActiveRef.current = false;
          }
        } else if (!authoritativeInactive) {
          authoritativeInactiveRef.current = false;
        }
        const serverTimeFetchedAt = Date.now();
        setIsSubscribed(active);
        setSubscriptionExpiresAt(active ? expiresAt : null);
        console.log(
          '[SUBSCRIPTION_STATE]',
          JSON.stringify({
            phase: reason,
            isSubscribed: active,
            subscriptionStatus: active ? 'ACTIVE' : 'INACTIVE',
            expiresAt: active ? expiresAt : null,
            remainingSeconds: effectiveResult.remainingSeconds ?? effectiveResult.remaining_seconds ?? null,
            remainingDays: effectiveResult.remainingDays ?? effectiveResult.remaining_days ?? null,
            resolveSource: r.resolveSource ?? null,
            subscriptionSyncLoaded,
            subscriptionRecoveryComplete,
          }),
        );
        if (Array.isArray(effectiveResult.plans) && effectiveResult.plans.length > 0) {
          setAvailablePlans(effectiveResult.plans);
          void seedPaymentPlansCacheFromVerify(effectiveResult.plans);
        }
        const detailSource = effectiveResult;
        const resolvedManualGiftShowPopup = r?.manualGiftShowPopup === true;
        const resolvedManualGiftAckKey = resolvedManualGiftShowPopup
          ? (r?.manualGiftAckKey ?? detailSource?.manualGiftAckKey ?? null)
          : null;
        const catalogPlans = [
          ...(Array.isArray(detailSource.plans) ? detailSource.plans : []),
          ...(getCachedPaymentPlansSync() ?? []),
        ];
        const rawDetailsPayload = active
          ? enrichCanonicalSubscriptionTiming(
              enrichSubscriptionDetailsForDisplay(
                {
                  amount: detailSource.amount ?? null,
                  currency: detailSource.currency ?? null,
                  planName: detailSource.planName ?? null,
                  planId: detailSource.planId ?? null,
                  planDurationDays: detailSource.planDurationDays ?? detailSource.plan_duration_days ?? null,
                  plan_duration_days: detailSource.plan_duration_days ?? detailSource.planDurationDays ?? null,
                  startedAt: detailSource.startedAt ?? null,
                  expiresAt,
                  remainingSeconds: detailSource.remainingSeconds ?? detailSource.remaining_seconds ?? null,
                  remainingDays: detailSource.remainingDays ?? detailSource.remaining_days ?? null,
                  serverTime: detailSource.serverTime ?? null,
                  serverTimeFetchedAt,
                  plans: Array.isArray(detailSource.plans) ? detailSource.plans : [],
                  manualGiftShowPopup: resolvedManualGiftShowPopup,
                  manualGiftAckKey: resolvedManualGiftAckKey,
                  transportPreserved: effectiveResult.transportPreserved === true,
                },
                catalogPlans,
              ),
            )
          : null;
        const detailsPayload = rawDetailsPayload;
        let mergedDetails = null;
        setSubscriptionDetails((prev) => {
          if (!active) return null;
          mergedDetails = mergeSubscriptionDetails(prev, detailsPayload);
          return mergedDetails;
        });
        traceAccountDisplay('reverifySubscription', {
          reason,
          verifyPlanId: detailSource.planId ?? null,
          verifyPlanName: detailSource.planName ?? null,
          verifyAmount: detailSource.amount ?? null,
          verifyPlanDurationDays: detailSource.planDurationDays ?? null,
          mergedPlanName: mergedDetails?.planName ?? null,
          mergedAmount: mergedDetails?.amount ?? null,
          mergedPlanDurationDays: mergedDetails?.planDurationDays ?? null,
          plansInVerify: Array.isArray(detailSource.plans) ? detailSource.plans.length : 0,
        });
        console.log('[MANUAL_GIFT]', 'context_after_verify', {
          reason,
          active,
          manualGiftShowPopup: detailsPayload?.manualGiftShowPopup === true,
          manualGiftAckKey: detailsPayload?.manualGiftAckKey ?? null,
          rawVerifyManualGiftAckKey: r?.manualGiftAckKey ?? null,
        });
        if (__DEV__) {
          console.log('[ACCOUNT_DURATION]', 'context_after_verify', {
            planDurationDays: detailsPayload?.planDurationDays ?? null,
            raw_verify_planDurationDays: r?.planDurationDays,
            raw_verify_plan_duration_days: r?.plan_duration_days,
          });
        }
        setSubscriptionVersion((v) => v + 1);
        if (active) {
          let planSnapshot = extractPlanSnapshotFromDetails(mergedDetails);
          if (!planSnapshot && (effectiveResult.transportPreserved === true || effectiveResult.instantUnlockPreserved === true)) {
            const cachedSnap = await readSubscriptionCache();
            planSnapshot = cachedSnap.planSnapshot ?? null;
          }
          const cached = await readSubscriptionCache();
          const cacheExpiresMs = cached?.expiresAt ? Date.parse(String(cached.expiresAt)) : NaN;
          const verifyExpiresMs = expiresAt ? Date.parse(String(expiresAt)) : NaN;
          const backendNewer =
            Number.isFinite(verifyExpiresMs) &&
            (!Number.isFinite(cacheExpiresMs) || verifyExpiresMs > cacheExpiresMs);
          const cachedPlanId = String(cached?.planSnapshot?.planId ?? '').trim();
          const verifyPlanId = String(planSnapshot?.planId ?? '').trim();
          const cachedAmount = Number(cached?.planSnapshot?.amount);
          const verifyAmount = Number(planSnapshot?.amount);
          const planMetadataChanged =
            (verifyPlanId !== '' && cachedPlanId !== '' && verifyPlanId !== cachedPlanId) ||
            (Number.isFinite(verifyAmount) &&
              Number.isFinite(cachedAmount) &&
              verifyAmount !== cachedAmount);
          if (
            (backendNewer || planMetadataChanged) &&
            effectiveResult.transportPreserved !== true &&
            effectiveResult.instantUnlockPreserved !== true
          ) {
            console.log('[SUBSCRIPTION_CACHE]', reason, 'overwrite_canonical_plan', {
              cacheExpiresAt: cached?.expiresAt ?? null,
              verifyExpiresAt: expiresAt,
              cachedPlanId: cachedPlanId || null,
              verifyPlanId: verifyPlanId || null,
              cachedAmount: Number.isFinite(cachedAmount) ? cachedAmount : null,
              verifyAmount: Number.isFinite(verifyAmount) ? verifyAmount : null,
            });
          }
          await writeSubscriptionCache({
            active: true,
            expiresAt,
            deviceId,
            fingerprint: deviceFingerprint,
            planSnapshot,
          });
        } else if (
          !active &&
          !isSubscriptionTransportFailure(r) &&
          !isSubscriptionTransportFailure(effectiveResult) &&
          r.resolveSource === 'inactive' &&
          !isSubscriptionPendingActivation(r)
        ) {
          await clearSubscriptionCache(`verify:${reason}`);
        }
        console.log('[SUBSCRIPTION_VERIFY]', reason, {
          active,
          expiresAt,
          resolveSource: r.resolveSource ?? null,
          amount: detailSource.amount ?? null,
          planName: detailSource.planName ?? null,
          startedAt: detailSource.startedAt ?? null,
          serverTime: detailSource.serverTime ?? null,
          transportPreserved: effectiveResult.transportPreserved === true,
        });
        // Sparse SSE may unlock without plan fields — Hongera after verify fills them.
        if (active && detailsPayload) {
          const reasonText = String(reason);
          if (
            /sse:(manual_subscription_granted|manual_gift|package_granted|admin_subscription_granted|subscription_manual_grant|device_subscription_granted|manual_subscription(?:_changed|_granted)?)\b/.test(
              reasonText,
            )
          ) {
            showActivationSuccess(detailsPayload, 'admin_grant');
          } else if (reasonText.includes('subscription_request_updated')) {
            showActivationSuccess(detailsPayload, 'custom_grant');
          }
        }
        return effectiveResult;
      } catch (e) {
        console.log('[SUBSCRIPTION_VERIFY]', reason, 'error', e?.message ?? e);
        if (verifyKey === lastVerifyKeyRef.current) {
          const identity = await getDeviceIdentity().catch(() => ({
            deviceId: '',
            androidId: null,
          }));
          const { deviceId } = identity;
          const cached = await readSubscriptionCache();
          const sameDevice =
            cached &&
            (!cached.deviceId ||
              cached.deviceId === deviceId ||
              (identity.androidId && cached.deviceId === identity.androidId));
          if (
            sourceTransferClearLockUntilRef.current <= Date.now() &&
            !authoritativeReconcile &&
            cached?.active &&
            sameDevice
          ) {
            isSubscribedRef.current = true;
            setIsSubscribed(true);
            setSubscriptionExpiresAt(cached.expiresAt ?? null);
            setSubscriptionDetails((prev) =>
              mergeSubscriptionDetails(prev, subscriptionDetailsFromCache(cached)),
            );
            setSubscriptionVersion((v) => v + 1);
            console.log('[SUBSCRIPTION_VERIFY]', reason, 'error_preserved_cache', {
              error: e?.message ?? e,
            });
            return {
              active: true,
              expiresAt: cached.expiresAt ?? null,
              transportPreserved: true,
            };
          }
          if (isSubscribedRef.current) {
            console.log('[SUBSCRIPTION_VERIFY]', reason, 'error_preserved_active_state', {
              error: e?.message ?? e,
            });
            return {
              active: true,
              transportPreserved: true,
            };
          }
          isSubscribedRef.current = false;
          setIsSubscribed(false);
          setSubscriptionExpiresAt(null);
          setSubscriptionDetails(null);
          setSubscriptionVersion((v) => v + 1);
          if (!isNetworkTransportError(e) && !isTransientServerError(e)) {
            await clearSubscriptionCache(`verify-error:${reason}`);
          }
        }
        return { active: false, expiresAt: null, error: String(e?.message ?? e) };
      } finally {
        verifyInFlightRef.current = false;
      }
    })();

    verifyPromiseRef.current = run;
    try {
      return await run;
    } finally {
      if (verifyPromiseRef.current === run) {
        verifyPromiseRef.current = null;
      }
    }
  }, []);

  /**
   * Reinstall recovery on cold start. Asks the backend to attach this
   * device to any active subscription bound to it, then reverifies. The
   * recover call is idempotent and safe to retry.
   */
  const recoverAndVerify = useCallback(async (reason = 'launch') => {
    try {
      const identity = await getDeviceIdentity();
      const { deviceId, deviceFingerprint } = identity;
      const r = await recoverSubscription(deviceId, deviceFingerprint, {
        installInstanceId: identity.installInstanceId,
        packageName: identity.packageName,
        packageAndroidId: identity.packageAndroidId,
        legacyPackageAndroidId: identity.legacyPackageAndroidId,
        stableHardwareId: identity.stableHardwareId,
        displayedAccountId: identity.displayedAccountId,
        androidId: identity.androidId,
        legacyDeviceFingerprint: identity.legacyDeviceFingerprint,
        legacyPackageName: identity.legacyPackageName,
        migration_bridge: true,
      });
      console.log('[SUBSCRIPTION_RECOVER]', reason, {
        active: r.active,
        expiresAt: r.expiresAt,
        recoverRefreshed: r.recoverRefreshed === true,
      });
      if (r.active === true || r.recoverRefreshed === true) {
        await writeSubscriptionCache({
          active: true,
          expiresAt: r.expiresAt ?? null,
          deviceId,
          fingerprint: deviceFingerprint,
        });
      }
    } catch (e) {
      console.log('[SUBSCRIPTION_RECOVER]', reason, 'error', e?.message ?? e);
    }
    return reverifySubscription(reason);
  }, [reverifySubscription]);

  /**
   * Pre-playback gate. EVERY playback attempt MUST call this — the
   * boolean answer is sourced from the backend, not the device clock.
   * @returns {Promise<boolean>}
   */
  const gateForPlayback = useCallback(async (reason = 'play') => {
    const fastReason = String(reason);
    const isBackground = fastReason.startsWith('gate-bg:') || fastReason.includes('-bg');

    if (isBackground) {
      if (isSubscribedRef.current) {
        void reverifySubscription(reason);
        return isSubscribedRef.current;
      }
      const { cached } = await readHydratableSubscriptionCache();
      if (cached?.active) {
        void reverifySubscription(reason);
        return true;
      }
      const r = await reverifySubscription(reason);
      return r?.active === true;
    }

    const hadSubscriptionBefore = isSubscribedRef.current;
    const r = await reverifySubscription(`gate:${reason}`);
    const active = r?.active === true;
    if (!active) {
      console.log('[PLAYBACK_GATE]', 'denied', reason);
      if (hadSubscriptionBefore && isConfirmedSubscriptionLoss(r)) {
        const modalReason = resolveSubscriptionLossModalReason(r);
        logSubscriptionLossModalDecision(`gate:${reason}`, r, modalReason ?? 'silent_no_modal', {
          hadSubscriptionBefore,
        });
      } else if (hadSubscriptionBefore) {
        logSubscriptionLossModalDecision(`gate:${reason}`, r, 'skipped', {
          hadSubscriptionBefore,
          notConfirmedLoss: true,
        });
      }
    } else {
      console.log('[PLAYBACK_GATE]', 'allowed', reason);
    }
    return active;
  }, [reverifySubscription]);

  /** Apply the same object returned from `reverifySubscription` / API (strict `isActive`). */
  const unlockChannels = useCallback(
    (subscription) => {
      if (!subscription) return;
      const active = subscription.isActive === true || subscription.active === true;
      if (!active) return;
      void applyInstantSubscriptionState(
        { ...subscription, active: true },
        'unlock-channels',
      );
    },
    [applyInstantSubscriptionState],
  );

  const refreshServerHealth = useCallback(async (reason = 'fetch') => {
    try {
      const payload = await getServerHealth();
      devLog('[SERVER_HEALTH_UPDATE]', reason, payload);
      setServerHealth(payload);
      return payload;
    } catch (e) {
      devLog('[SERVER_HEALTH_UPDATE]', 'fetch_failed', e?.message ?? e);
      return null;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await dropLegacyBannersCache();
      const cachedChannels = await readChannelsCache();
      if (
        !cancelled &&
        !catalogNetworkHydratedRef.current.channels &&
        cachedChannels?.channels?.length
      ) {
        setRawChannels(sortChannelsByAdminOrder(cachedChannels.channels));
        setCatalogAccessReady(true);
      }
      const cached = await readBannersCache();
      if (
        cancelled ||
        catalogNetworkHydratedRef.current.banners ||
        !cached?.banners?.length
      ) {
        return;
      }
      const enriched = enrichBannersForViewer(cached.banners);
      setRawBanners(enriched);
      logBannerRuntimeDiagnostics(enriched);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  useEffect(() => {
    trialWatchSettingsRef.current = trialWatchSettings;
  }, [trialWatchSettings]);

  useEffect(() => {
    isSubscribedRef.current = isSubscribed;
  }, [isSubscribed]);

  useEffect(() => {
    rawChannelsRef.current = rawChannels;
  }, [rawChannels]);

  /**
   * Reload settings + channels.
   * @param {{ showGlobalLoading?: boolean }} [opts] — set showGlobalLoading: false for pull-to-refresh (no full-screen blocking load).
   */
  /**
   * Lightweight: viewer-safe app flags via GET /api/public/app-settings only.
   */
  const refreshTrialWatchSettings = useCallback(async (reason = 'poll') => {
    try {
      const s = await withTimeout(
        tryGetViewerTrialWatchSettings(),
        TRIAL_WATCH_BOOT_TIMEOUT_MS,
        'trial-watch-settings',
      ).catch(() => null);
      if (s) {
        trialWatchSettingsRef.current = s;
        setTrialWatchSettings(s);
        devLog('[TRIAL_WATCH_SYNC]', reason, s);
      } else {
        trialWatchSettingsRef.current = TRIAL_WATCH_FAIL_CLOSED;
        setTrialWatchSettings(TRIAL_WATCH_FAIL_CLOSED);
        devLog('[TRIAL_WATCH_SYNC]', reason, 'fail_closed_no_runtime_config');
      }
    } finally {
      setTrialWatchSettingsLoaded(true);
      if (trialWatchReadyResolveRef.current) {
        trialWatchReadyResolveRef.current(true);
        trialWatchReadyResolveRef.current = null;
      }
    }
  }, []);

  const refreshSettingsOnly = useCallback(async (reason = 'poll') => {
    const s = await tryGetViewerAppSettings();
    if (s) {
      setSettings((prev) => ({ ...prev, ...s }));
      devLog('[SETTINGS_SYNC]', reason, s);
    } else if (__DEV__) {
      devLog('[SETTINGS_SYNC]', reason, 'skip_no_public_flags');
    }
    await refreshTrialWatchSettings(reason);
  }, [refreshTrialWatchSettings]);

  const applyChannelCatalogRealtime = useCallback((eventName, payload, source = 'sse') => {
    if (!catalogRealtimeEventMayCarryChannelAccess(eventName, payload)) {
      return false;
    }
    const patches = parseChannelAccessRealtimePatches(eventName, payload);
    if (!patches.length) return false;

    const current = rawChannelsRef.current;
    const { channels: patched, changed, applied } = applyChannelAccessPatches(current, patches);
    if (!changed || applied === 0) return false;

    const sorted = sortChannelsByAdminOrder(patched);
    rawChannelsRef.current = sorted;
    setRawChannels(sorted);
    setCatalogRevision((v) => v + 1);
    setCatalogAccessReady(true);
    void writeChannelsCache(sorted);
    devLog('[CHANNEL_ACCESS_PATCH]', source, eventName, {
      applied,
      at: Date.now(),
      patches,
    });
    return true;
  }, []);

  const refresh = useCallback(async (opts = {}) => {
    const showGlobalLoading = opts.showGlobalLoading !== false;
    const preserveDataOnError = opts.preserveDataOnError !== false;
    const skipSettingsFromHttp = opts.skipSettingsFromHttp === true;
    const forceNetwork = opts.forceNetwork === true;
    const catalogOpts = forceNetwork ? { force: true } : {};

    if (forceNetwork) {
      invalidateCatalogCache();
    }
    if (!forceNetwork && refreshPromiseRef.current) {
      return refreshPromiseRef.current;
    }

    const run = (async () => {
    refreshInFlightRef.current += 1;
    const shouldShowLoading =
      showGlobalLoading || rawChannelsRef.current.length === 0;
    if (shouldShowLoading) setLoading(true);
    setError(null);
    try {
      let [list, bannersResult, flags, trialFlags] = await Promise.all([
        withTimeout(getChannels(catalogOpts), STARTUP_FETCH_TIMEOUT_MS, 'startup-channels'),
        withTimeout(getBanners(catalogOpts), STARTUP_FETCH_TIMEOUT_MS, 'startup-banners').catch(
          () => null,
        ),
        withTimeout(tryGetViewerAppSettings(), STARTUP_FETCH_TIMEOUT_MS, 'startup-settings').catch(
          () => null,
        ),
        withTimeout(
          tryGetViewerTrialWatchSettings(),
          STARTUP_FETCH_TIMEOUT_MS,
          'startup-trial-watch',
        ).catch(() => null),
      ]);
      if (forceNetwork && bannersResult == null) {
        bannersResult = await withTimeout(
          getBanners({ force: true }),
          STARTUP_FETCH_TIMEOUT_MS,
          'startup-banners-retry',
        ).catch(() => null);
      }
      if (flags && !skipSettingsFromHttp) {
        setSettings((prev) => ({ ...prev, ...flags }));
      }
      if (trialFlags) {
        trialWatchSettingsRef.current = trialFlags;
        setTrialWatchSettings(trialFlags);
      } else if (!skipSettingsFromHttp) {
        trialWatchSettingsRef.current = TRIAL_WATCH_FAIL_CLOSED;
        setTrialWatchSettings(TRIAL_WATCH_FAIL_CLOSED);
      }
      const nextChannels = sortChannelsByAdminOrder(Array.isArray(list) ? list : []);
      catalogNetworkHydratedRef.current.channels = true;
      setCatalogAccessReady(true);
      setRawChannels(nextChannels);
      setCatalogRevision((v) => v + 1);
      await writeChannelsCache(nextChannels);
      devLog('[CATALOG_SYNC]', 'channels', {
        total: nextChannels.length,
        premium: nextChannels.filter(
          (c) =>
            c?.accessType === 'premium' ||
            c?.accessPremium === true ||
            c?.access_premium === true,
        ).length,
        forceNetwork,
      });
      const nextBanners = Array.isArray(bannersResult) ? bannersResult : null;
      if (nextBanners != null) {
        catalogNetworkHydratedRef.current.banners = true;
        setRawBanners(nextBanners);
        await dropLegacyBannersCache();
        await writeBannersCache(nextBanners);
        logBannerRuntimeDiagnostics(nextBanners);
      }
      setIsOffline(false);
    } catch (e) {
      let catalogCount = rawChannelsRef.current.length;
      if (catalogCount === 0 && preserveDataOnError) {
        const cached = await readChannelsCache();
        if (cached?.channels?.length) {
          setRawChannels(sortChannelsByAdminOrder(cached.channels));
          catalogCount = cached.channels.length;
          devLog('[CATALOG_SYNC]', 'offline_cache_fallback', { count: catalogCount });
        }
      }
      const markOffline = shouldMarkCatalogOffline(e, catalogCount);
      if (markOffline) {
        setIsOffline(true);
        setError(null);
        devLog('[CATALOG_SYNC]', 'catalog_offline', { reason: e?.message ?? e, catalogCount });
      } else if (isLikelyOfflineError(e)) {
        setIsOffline(false);
        setError(null);
        devLog('[CATALOG_SYNC]', 'refresh_failed_catalog_usable', {
          reason: e?.message ?? e,
          catalogCount,
        });
      } else {
        setError(formatUserFacingApiError(e));
        if (catalogCount > 0) setIsOffline(false);
      }
      if (!preserveDataOnError) {
        setRawChannels([]);
      }
    } finally {
      refreshInFlightRef.current = Math.max(0, refreshInFlightRef.current - 1);
      setTrialWatchSettingsLoaded(true);
      if (trialWatchReadyResolveRef.current) {
        trialWatchReadyResolveRef.current(true);
        trialWatchReadyResolveRef.current = null;
      }
      if (refreshInFlightRef.current === 0) {
        setLoading(false);
      }
    }
    })();

    refreshPromiseRef.current = run;
    try {
      return await run;
    } finally {
      if (refreshPromiseRef.current === run) {
        refreshPromiseRef.current = null;
      }
    }
  }, []);

  /** Debounced channels/banners + subscription reverify after admin SSE bursts. */
  const adminSoftSyncTimerRef = useRef(null);
  const scheduleAdminDrivenSoftSync = useCallback(
    (reason = 'sse:admin') => {
      void refreshSettingsOnly(`${reason}-immediate`);
      void reverifySubscription(`${reason}-immediate`);
      if (adminSoftSyncTimerRef.current) clearTimeout(adminSoftSyncTimerRef.current);
      adminSoftSyncTimerRef.current = setTimeout(() => {
        adminSoftSyncTimerRef.current = null;
        devLog('[ADMIN_SYNC]', 'soft_refresh', reason);
        invalidateCatalogCache();
        void refresh({
          showGlobalLoading: false,
          preserveDataOnError: true,
          skipSettingsFromHttp: true,
          forceNetwork: true,
        });
      }, 320);
    },
    [refresh, refreshSettingsOnly, reverifySubscription],
  );

  useEffect(
    () => () => {
      if (adminSoftSyncTimerRef.current) clearTimeout(adminSoftSyncTimerRef.current);
    },
    [],
  );

  useEffect(() => {
    console.log(
      '[catalog-bootstrap]',
      JSON.stringify({
        apiBaseUrl: getApiBaseUrl(),
        ...probeApiHostRouting(getApiBaseUrl()),
      }),
    );
    void refresh({ showGlobalLoading: false, preserveDataOnError: true, forceNetwork: true });
    void (async () => {
      await hydratePaymentPlansCacheFromStorage();
      void refreshPaymentPlansCache({ reason: 'boot' });
    })();
  }, [refresh]);

  useEffect(() => {
    logStartupStep('remote_config', 'start');
    void refreshTrialWatchSettings('boot').then(() => logStartupStep('remote_config', 'ok'));
  }, [refreshTrialWatchSettings]);

  // Eager cache hydrate before first paint — premium tap must not wait for useEffect boot.
  useLayoutEffect(() => {
    void hydrateSubscriptionFromCache('provider-eager-hydrate');
  }, [hydrateSubscriptionFromCache]);

  // Cold-start: purge wrong-device hints → hydrate cache → fast resolve (reinstall) → sync ready → background verify.
  useEffect(() => {
    let cancelled = false;
    logStartupStep('subscription_verify', 'start');
    recoverBootPromiseRef.current = (async () => {
      try {
        await purgeUnreliableSubscriptionCache();
      } catch (e) {
        console.log('[SUBSCRIPTION_RECOVERY]', 'purge_failed', e?.message ?? e);
      }

      try {
        await hydrateSubscriptionFromCache('cold-start-cache');
      } catch (e) {
        console.log('[SUBSCRIPTION_COLD_START]', 'cache_hydrate_error', e?.message ?? e);
        logStartupStep('subscription_verify', 'fail', {
          phase: 'cache_hydrate',
          message: String(e?.message ?? e),
        });
      }

      try {
        logStartupStep('device_identity', 'start');
        const identity = await getDeviceIdentity();
        logStartupStep('device_identity', 'ok');
        const { deviceId, deviceFingerprint } = identity;
        const r = await withTimeout(
          resolveActiveSubscription(identity),
          RECOVER_BOOT_TIMEOUT_MS,
          'cold-start-resolve',
        );
        lastBootResolveRef.current = r;
        const authoritativeInactive = isAuthoritativeInactiveEntitlement(r);
        console.log('[SUBSCRIPTION_RECOVER]', 'cold-start', {
          active: r?.active,
          expiresAt: r?.expiresAt,
          resolveSource: r?.resolveSource ?? null,
          recoverRefreshed: r?.recoverRefreshed === true,
          authoritativeInactive,
        });

        let bootActive = r?.active === true || r?.recoverRefreshed === true;

        if (!bootActive && !authoritativeInactive) {
          const { cached } = await readHydratableSubscriptionCache();
          if (
            isTrustworthyActiveCache(cached) &&
            isSameDeviceSubscriptionCache(cached, identity)
          ) {
            bootActive = true;
            cacheTrustedActiveRef.current = true;
            authoritativeInactiveRef.current = false;
            if (!isSubscribedRef.current) {
              isSubscribedRef.current = true;
              setIsSubscribed(true);
              setSubscriptionExpiresAt(cached.expiresAt ?? null);
              setSubscriptionDetails((prev) =>
                mergeSubscriptionDetails(
                  prev,
                  enrichSubscriptionDetailsForDisplay(
                    subscriptionDetailsFromCache(cached),
                    getCachedPaymentPlansSync() ?? [],
                  ),
                ),
              );
              setSubscriptionVersion((v) => v + 1);
            }
            console.log('[SUBSCRIPTION_COLD_START]', 'cache_preserved_after_resolve', {
              resolveSource: r?.resolveSource ?? null,
              expiresAt: cached.expiresAt ?? null,
            });
          }
        }

        if (authoritativeInactive) {
          authoritativeInactiveRef.current = true;
          cacheTrustedActiveRef.current = false;
          isSubscribedRef.current = false;
          setIsSubscribed(false);
          setSubscriptionExpiresAt(null);
        } else if (bootActive && r?.active === true) {
          authoritativeInactiveRef.current = false;
          cacheTrustedActiveRef.current = false;
        }

        if (bootActive && (r?.active === true || r?.recoverRefreshed === true)) {
          isSubscribedRef.current = true;
          setIsSubscribed(true);
          setSubscriptionExpiresAt(r.expiresAt ?? null);
          const detailsRaw = subscriptionDetailsFromVerifyResult({ ...r, active: true });
          const recoverCatalog = [
            ...(Array.isArray(r.plans) ? r.plans : []),
            ...(getCachedPaymentPlansSync() ?? []),
          ];
          const details =
            buildAccountDisplayDetails(detailsRaw, r.expiresAt ?? null, recoverCatalog) ??
            subscriptionDetailsFromCache({ active: true, expiresAt: r.expiresAt });
          setSubscriptionDetails((prev) => mergeSubscriptionDetails(prev, details));
          setSubscriptionVersion((v) => v + 1);
          const planSnapshot =
            extractPlanSnapshotFromDetails(details) ??
            (r.expiresAt || r.remainingSeconds != null || r.remaining_seconds != null
              ? {
                  expiresAt: r.expiresAt ?? null,
                  remainingSeconds: r.remainingSeconds ?? r.remaining_seconds ?? null,
                  remainingDays: r.remainingDays ?? r.remaining_days ?? null,
                  planDurationDays: r.planDurationDays ?? r.plan_duration_days ?? null,
                }
              : null);
          await writeSubscriptionCache({
            active: true,
            expiresAt: r.expiresAt ?? null,
            deviceId,
            fingerprint: deviceFingerprint,
            planSnapshot,
          });
          if (Array.isArray(r.plans) && r.plans.length > 0) {
            setAvailablePlans(r.plans);
            void seedPaymentPlansCacheFromVerify(r.plans);
          }
          void reportUserCenterEvent('subscription_recovery', {
            active: r?.active === true,
            recoverRefreshed: r?.recoverRefreshed === true,
            resolveSource: r?.resolveSource ?? null,
            source: 'cold-start-resolve',
          });
        }
      } catch (e) {
        console.log('[SUBSCRIPTION_COLD_START]', 'recover_timeout_or_error', e?.message ?? e);
        logStartupStep('subscription_verify', 'fail', {
          phase: 'recover',
          message: String(e?.message ?? e),
        });
      }

      if (!cancelled) {
        setSubscriptionSyncLoaded(true);
        setSubscriptionRecoveryComplete(true);
        logStartupStep('subscription_verify', 'ok', { phase: 'sync_ready' });
        if (subscriptionReadyResolveRef.current) {
          subscriptionReadyResolveRef.current(true);
          subscriptionReadyResolveRef.current = null;
        }
      }

      try {
        const cachedBeforeVerify = await readSubscriptionCache();
        if (isStaleActiveSubscriptionCache(cachedBeforeVerify)) {
          console.log('[SUBSCRIPTION_CACHE]', 'repair_stale_active_before_verify', {
            expiresAt: cachedBeforeVerify.expiresAt ?? null,
          });
        }
        await withTimeout(
          reverifySubscription('cold-start-bg'),
          COLD_START_SUBSCRIPTION_TIMEOUT_MS,
          'cold-start-verify',
        );
      } catch (e) {
        console.log('[SUBSCRIPTION_COLD_START]', 'verify_timeout_or_error', e?.message ?? e);
      }
    })();

    recoverBootPromiseRef.current.finally(() => {
      recoverBootPromiseRef.current = null;
    });

    return () => {
      cancelled = true;
    };
  }, [hydrateSubscriptionFromCache, reverifySubscription]);

  const awaitTrialWatchSettingsReady = useCallback(async () => {
    if (trialWatchSettingsLoaded) return true;
    return trialWatchReadyPromiseRef.current;
  }, [trialWatchSettingsLoaded]);

  const awaitSubscriptionSyncReady = useCallback(async () => {
    if (subscriptionSyncLoaded) return true;
    return subscriptionReadyPromiseRef.current;
  }, [subscriptionSyncLoaded]);

  const awaitRecoverBoot = useCallback(async () => {
    if (subscriptionSyncLoaded) return true;
    const boot = recoverBootPromiseRef.current;
    if (!boot) return awaitSubscriptionSyncReady();
    try {
      await withTimeout(boot, RECOVER_BOOT_TIMEOUT_MS + 500, 'await-recover-boot');
    } catch {
      /* proceed with cache / fail-closed */
    }
    return true;
  }, [subscriptionSyncLoaded, awaitSubscriptionSyncReady]);

  const getPremiumAccessSnapshot = useCallback(
    () => {
      const base = {
        premiumPlaybackReady: subscriptionSyncLoaded && trialWatchSettingsLoaded,
        subscriptionSyncLoaded,
        isSubscribed: isSubscribedRef.current,
        freeMode: settingsRef.current.freeMode,
        trialWatchSettings: trialWatchSettingsRef.current,
        authoritativeInactiveConfirmed: authoritativeInactiveRef.current,
        cacheTrustedActive:
          cacheTrustedActiveRef.current && isSubscribedRef.current && !authoritativeInactiveRef.current,
        lastResolveSource: lastBootResolveRef.current?.resolveSource ?? null,
        subscriptionExpiresAt: subscriptionExpiresAt,
      };
      return { ...base, entitlementPhase: deriveEntitlementPhase(base) };
    },
    [subscriptionSyncLoaded, trialWatchSettingsLoaded, subscriptionExpiresAt],
  );

  const awaitPremiumAccessSnapshot = useCallback(async () => {
    await awaitTrialWatchSettingsReady();
    if (!isSubscribedRef.current && !subscriptionSyncLoaded) {
      try {
        await hydrateSubscriptionFromCache('premium-await-hydrate');
      } catch {
        /* non-fatal */
      }
    }
    if (isSubscribedRef.current) {
      return getPremiumAccessSnapshot();
    }
    await awaitSubscriptionSyncReady();
    return getPremiumAccessSnapshot();
  }, [
    awaitSubscriptionSyncReady,
    awaitTrialWatchSettingsReady,
    getPremiumAccessSnapshot,
    hydrateSubscriptionFromCache,
    subscriptionSyncLoaded,
  ]);

  /** Bounded cold-start / tap entitlement resolution — preserves original tap intent. */
  const awaitEntitlementForTap = useCallback(async () => {
    if (!isSubscribedRef.current) {
      try {
        await hydrateSubscriptionFromCache('tap-entitlement-hydrate');
      } catch {
        /* non-fatal */
      }
    }
    if (isSubscribedRef.current) {
      await awaitTrialWatchSettingsReady();
      return getPremiumAccessSnapshot();
    }
    await awaitRecoverBoot();
    if (!isSubscribedRef.current && !authoritativeInactiveRef.current) {
      try {
        await hydrateSubscriptionFromCache('tap-entitlement-post-boot');
      } catch {
        /* non-fatal */
      }
    }
    if (!isSubscribedRef.current && !authoritativeInactiveRef.current) {
      try {
        await withTimeout(reverifySubscription('tap-entitlement-resolve'), 4_000, 'tap-entitlement-verify');
      } catch {
        /* bounded — gate uses cache/phase, not false inactive */
      }
      if (!isSubscribedRef.current) {
        try {
          await hydrateSubscriptionFromCache('tap-entitlement-post-verify');
        } catch {
          /* non-fatal */
        }
      }
    }
    await awaitTrialWatchSettingsReady();
    return getPremiumAccessSnapshot();
  }, [
    awaitRecoverBoot,
    awaitTrialWatchSettingsReady,
    getPremiumAccessSnapshot,
    hydrateSubscriptionFromCache,
    reverifySubscription,
  ]);

  const awaitPremiumGateReady = awaitPremiumAccessSnapshot;

  const premiumPlaybackReady = subscriptionSyncLoaded && trialWatchSettingsLoaded;

  useEffect(() => {
    void refreshServerHealth('initial');
    const unsubscribe = subscribeRealtimeEvent('server_health_changed', (payload) => {
      devLog('[SERVER_HEALTH_UPDATE]', 'sse', payload);
      if (payload && typeof payload === 'object') {
        setServerHealth(payload);
      } else {
        void refreshServerHealth('sse');
      }
    });
    return unsubscribe;
  }, [refresh, refreshServerHealth]);

  // Fast settings poll + resume: admin flags update without waiting for full catalog refresh.
  useEffect(() => {
    let interval = null;
    const onAppState = (next) => {
      if (next === 'active') {
        void refreshSettingsOnly('app_resume');
        scheduleAdminDrivenSoftSync('app_resume');
      }
    };
    const sub = AppState.addEventListener('change', onAppState);
    interval = setInterval(() => {
      if (AppState.currentState !== 'active') return;
      void refreshSettingsOnly('interval');
    }, SETTINGS_POLL_MS);
    return () => {
      sub.remove();
      if (interval) clearInterval(interval);
    };
  }, [refreshSettingsOnly, scheduleAdminDrivenSoftSync]);

  // Realtime subscription lifecycle events from /api/sync/stream.
  useEffect(() => {
    const offSyncReconnect = subscribeRealtimeEvent('__sync_stream_connected', () => {
      void reverifySubscription('sse:sync_stream_connected');
    });
    const offDeviceStream = startSubscriptionDeviceStream((reason, payload) => {
      const eventName = String(reason).replace(/^subscription-stream:/, '');
      if (payload != null && eventName !== 'open') {
        void tryInstantApplyFromSse(eventName, payload);
      }
      void reverifySubscription(reason);
    });
    const offSnapshot = subscribeRealtimeEvent('snapshot', (payload) => {
      const patched = applyChannelCatalogRealtime('snapshot', payload, 'sse:snapshot');
      if (patched) {
        invalidateCatalogCache();
        void refresh({
          showGlobalLoading: false,
          preserveDataOnError: true,
          skipSettingsFromHttp: true,
          forceNetwork: true,
        });
      }
      const inner = unwrapSubscriptionSsePayload(payload);
      if (!inner || typeof inner !== 'object') return;
      const hasSubHint =
        inner.subscription != null ||
        inner.active !== undefined ||
        inner.isActive !== undefined ||
        inner.manualGift != null ||
        inner.manual_gift != null ||
        inner.device_id != null ||
        inner.deviceId != null;
      if (hasSubHint) {
        void reverifySubscription('sse:snapshot');
      }
    });
    const offRevoked = subscribeRealtimeEvent('subscription_revoked', (payload) => {
      void (async () => {
        const role = await subscriptionTransferSseRole(payload, 'subscription_revoked');
        if (role === 'other') return;
        console.log('[SUBSCRIPTION_REVOKED]', 'sse', payload, { role });
        const hadActiveBefore = isSubscribedRef.current;
        const inner = unwrapSubscriptionSsePayload(payload);
        const sseReason = pickTransferSseReason(inner, 'subscription_revoked');

        if (hadActiveBefore) {
          try {
            await clearSubscriptionCache('sse:subscription_revoked:pre-verify');
          } catch {
            /* ignore */
          }
          if (role === 'device' || role === 'source') {
            isSubscribedRef.current = false;
            setIsSubscribed(false);
            setSubscriptionExpiresAt(null);
            setSubscriptionDetails(null);
            setSubscriptionVersion((v) => v + 1);
            console.log('[SUBSCRIPTION_REVOKED]', 'optimistic_clear', {
              at: Date.now(),
              role,
            });
          }
        }

        const r = await reverifySubscription('sse:subscription_revoked');
        if (r?.active === true) {
          logSubscriptionLossModalDecision('sse:subscription_revoked', r, 'skipped', {
            role,
            hadActiveBefore,
            sseReason,
            skip: 'verify_still_active',
          });
          return;
        }
        if (!hadActiveBefore && !isConfirmedSubscriptionLoss(r)) {
          logSubscriptionLossModalDecision('sse:subscription_revoked', r, 'skipped', {
            role,
            hadActiveBefore,
            sseReason,
            skip: 'no_prior_active',
          });
          return;
        }
        if (
          (sseReason === 'admin_force' || sseReason === 'admin_force_transfer') &&
          (role === 'source' || role === 'device')
        ) {
          await applySourceTransferCompleted('sse:subscription_revoked:admin_force', {
            showSuccessModal: false,
          });
          return;
        }
        if (
          isExplicitTransferRevokeReason(sseReason) &&
          (role === 'source' || role === 'device')
        ) {
          const userInitiated =
            Boolean(sourceTransferSessionRef.current?.code) ||
            isUserConfirmedTransferReason(sseReason);
          logSubscriptionLossModalDecision('sse:subscription_revoked', r, 'skipped', {
            role,
            hadActiveBefore,
            sseReason,
            skip: userInitiated ? 'user_transfer_clear' : 'silent_transfer_clear',
          });
          await handleRemoteTransferAway(payload, 'subscription_revoked', {
            showSuccessModal: false,
          });
          return;
        }
        logSubscriptionLossModalDecision('sse:subscription_revoked', r, 'silent_admin_revoke', {
          role,
          hadActiveBefore,
          sseReason,
        });
        authoritativeInactiveRef.current = true;
        cacheTrustedActiveRef.current = false;
        await clearLocalActiveSubscription('sse:subscription_revoked');
      })();
    });
    // Admin DELETE USER — wipe Premium immediately; never wait for restart/cache.
    const offDeleteUser = DELETE_USER_SSE_EVENTS.map((ev) =>
      subscribeRealtimeEvent(ev, (payload) => {
        void (async () => {
          const role = await subscriptionTransferSseRole(payload, ev);
          if (role === 'other') return;
          console.log('[DELETE_USER_SSE]', ev, payload, { role });
          authoritativeInactiveRef.current = true;
          cacheTrustedActiveRef.current = false;
          try {
            await clearSubscriptionCache(`sse:${ev}:pre-clear`);
          } catch {
            /* ignore */
          }
          isSubscribedRef.current = false;
          setIsSubscribed(false);
          setSubscriptionExpiresAt(null);
          setSubscriptionDetails(null);
          setSubscriptionVersion((v) => v + 1);
          await clearLocalActiveSubscription(`sse:${ev}`);
          const r = await reverifySubscription(`sse:${ev}`);
          if (r?.active !== true) {
            authoritativeInactiveRef.current = true;
            cacheTrustedActiveRef.current = false;
          }
          scheduleAdminDrivenSoftSync(`sse:${ev}`);
        })();
      }),
    );
    const offSubscriptionLifecycle = SUBSCRIPTION_WAKE_SSE_EVENTS.map((ev) =>
      subscribeRealtimeEvent(ev, (payload) => {
        console.log('[SUBSCRIPTION_SSE]', ev, payload);
          void (async () => {
          await tryInstantApplyFromSse(ev, payload);
          // Reverify immediately so Account boxes / gift flags refresh without a
          // multi-second wait. Replica-lag re-lock is blocked by instant-unlock grace.
          void reverifySubscription(`sse:${ev}`);
          scheduleAdminDrivenSoftSync(`sse:${ev}`);
          if (ev === 'payment_success' || ev === 'payment_completed') {
            void reportUserCenterEvent('payment_success', { source: 'sse', sse_event: ev });
          }
        })();
      }),
    );
    const offUserCenter = USER_CENTER_SSE_EVENTS.map((ev) =>
      subscribeRealtimeEvent(ev, (payload) => {
        console.log('[USER_CENTER_SSE]', ev, payload);
        void registerDeviceIntelligence();
        void tryInstantApplyFromSse(ev, payload);
        void reverifySubscription(`sse:${ev}`);
        void refreshPaymentPlansCache({ reason: `sse:${ev}` });
        scheduleAdminDrivenSoftSync(`sse:${ev}`);
        void reportUserCenterEvent(ev, { source: 'sse', payload });
      }),
    );
    const offCompleted = subscribeRealtimeEvent('transfer_completed', (payload) => {
      void (async () => {
        const role = await subscriptionTransferSseRole(payload, 'transfer_completed');
        if (role === 'none' || role === 'other') return;
        const inner = unwrapSubscriptionSsePayload(payload);
        const sseReason = pickTransferSseReason(inner, 'transfer_completed');
        console.log('[TRANSFER_COMPLETED]', 'sse', payload, { role, sseReason });
        if (role === 'source' || role === 'device') {
          const userInitiated =
            Boolean(sourceTransferSessionRef.current?.code) ||
            isUserConfirmedTransferReason(sseReason);
          await handleRemoteTransferAway(payload, 'transfer_completed', {
            showSuccessModal: false,
          });
          return;
        }
        sourceTransferSessionRef.current = null;
        setPendingTransfer(null);
        void tryInstantApplyFromSse('transfer_completed', payload);
        const r = await reverifySubscription('sse:transfer_completed');
        if (r?.active === true) {
          await completeTargetTransferRedemption(r, 'sse:transfer_completed');
        }
      })();
    });
    // `transfer_approved` fires on the TARGET device once the source
    // approves the pending transfer. Treat it the same as
    // `transfer_completed` for context purposes — the destination
    // refreshes and gains access.
    const offApproved = subscribeRealtimeEvent('transfer_approved', (payload) => {
      console.log('[TRANSFER_APPROVED]', 'sse', payload);
      sourceTransferSessionRef.current = null;
      setPendingTransfer(null);
      void tryInstantApplyFromSse('transfer_approved', payload);
      void reverifySubscription('sse:transfer_approved').then(async (r) => {
        if (r?.active === true) {
          await completeTargetTransferRedemption(r, 'sse:transfer_approved');
        }
      });
    });
    // Source-device approve/reject popup fires on EITHER event name —
    // the new backend uses `transfer_confirmation_required`; the older
    // alias `transfer_requested` is kept as a fallback for backward
    // compatibility.
    const handleSourceTransferRequest = (eventName) => async (payload) => {
      if (!isTransferAwaitingSourceApproval(payload, eventName)) {
        console.log('[TRANSFER_CONFIRMATION_REQUIRED]', 'ignored_not_awaiting_approval', {
          eventName,
          status:
            (payload && typeof payload === 'object' && (payload.status ?? payload.payload?.status)) ||
            null,
        });
        return;
      }
      const session = sourceTransferSessionRef.current;
      if (!session?.code) {
        console.log('[TRANSFER_CONFIRMATION_REQUIRED]', 'ignored_no_source_session', {
          eventName,
        });
        return;
      }
      let deviceId = '';
      try {
        const identity = await getDeviceIdentity();
        deviceId = identity?.deviceId ? String(identity.deviceId) : '';
      } catch {}
      const sourceDeviceId = pickSourceDeviceId(payload);
      const sourceMatches = sourceDeviceId
        ? await devicesShareIdentity(sourceDeviceId, deviceId)
        : true;
      console.log('[TRANSFER_CONFIRMATION_REQUIRED]', 'event_received', {
        eventName,
        payload,
        currentDeviceId: deviceId,
        sourceDeviceId,
        sourceMatches,
        sessionCode: session.code,
      });
      if (!sourceMatches) {
        console.log('[TRANSFER_CONFIRMATION_REQUIRED]', 'ignored_non_source_device', {
          currentDeviceId: deviceId,
          sourceDeviceId,
        });
        return;
      }
      const code = pickTransferCode(payload);
      const eventBare = bareTransferCode(code);
      const sessionBare = bareTransferCode(session.code);
      if (eventBare && sessionBare && eventBare !== sessionBare) {
        console.log('[TRANSFER_CONFIRMATION_REQUIRED]', 'ignored_code_mismatch', {
          eventCode: code,
          sessionCode: session.code,
        });
        return;
      }
      console.log('[transfer-ui]', 'pending transfer detected', { eventName, code, source: 'sse' });
      if (payload && typeof payload === 'object') {
        setPendingTransfer({ ...payload, code: code || session.code });
      } else {
        setPendingTransfer({ code: code || session.code, raw: payload });
      }
      console.log('[transfer-ui]', 'source approval state entered', { code, source: 'sse' });
    };
    const offRequested = subscribeRealtimeEvent(
      'transfer_requested',
      handleSourceTransferRequest('transfer_requested'),
    );
    const offConfirmationRequired = subscribeRealtimeEvent(
      'transfer_confirmation_required',
      handleSourceTransferRequest('transfer_confirmation_required'),
    );
    const offRejected = subscribeRealtimeEvent('transfer_rejected', (payload) => {
      void (async () => {
        const role = await subscriptionTransferSseRole(payload, 'transfer_rejected');
        if (role === 'target') {
          sourceTransferSessionRef.current = null;
          setPendingTransfer(null);
        }
        if (role === 'source') {
          setPendingTransfer(null);
        }
      })();
    });
    const offRuntimeModes = RUNTIME_MODE_SSE_NAMES.map((ev) =>
      subscribeRealtimeEvent(ev, (payload) => {
        console.log('[RUNTIME_MODES_SSE]', ev, payload);
        const patch = parseAppSettingsRealtimePatch(payload);
        if (patch) {
          setSettings((prev) => ({ ...prev, ...patch }));
          console.log('[SETTINGS_SYNC]', ev, patch);
          if (Object.prototype.hasOwnProperty.call(patch, 'freeMode')) {
            invalidateCatalogCache();
            void refresh({
              showGlobalLoading: false,
              preserveDataOnError: true,
              skipSettingsFromHttp: true,
              forceNetwork: true,
            });
          }
        } else {
          console.log('[SETTINGS_SYNC]', ev, 'no_mode_keys_in_payload');
        }
        setTrialWatchSettings((prev) => {
          const parsed = parseTrialWatchSettings(payload);
          if (!parsed.configLoaded) {
            void refreshTrialWatchSettings(`sse:${ev}`);
            return prev;
          }
          const next = { ...prev, ...parsed };
          trialWatchSettingsRef.current = next;
          return next;
        });
        void reverifySubscription(`sse:${ev}`);
      }),
    );
    const offCatalogAliases = ADMIN_SOFT_REFRESH_SSE_EVENTS.map((ev) =>
      subscribeRealtimeEvent(ev, (payload) => {
        const patch = parseAppSettingsRealtimePatch(payload);
        if (patch) {
          setSettings((prev) => ({ ...prev, ...patch }));
          console.log('[SETTINGS_SYNC]', ev, patch);
        }
        const patched = applyChannelCatalogRealtime(ev, payload, 'sse');
        if (CHANNEL_ACCESS_IMMEDIATE_SSE_EVENTS.has(ev) || patched) {
          invalidateCatalogCache();
          void refresh({
            showGlobalLoading: false,
            preserveDataOnError: true,
            skipSettingsFromHttp: true,
            forceNetwork: true,
          });
        }
        if (!patched) {
          scheduleAdminDrivenSoftSync(`sse:${ev}`);
        }
      }),
    );
    return () => {
      offSyncReconnect();
      offDeviceStream();
      offSnapshot();
      offRevoked();
      offDeleteUser.forEach((off) => off());
      offSubscriptionLifecycle.forEach((off) => off());
      offUserCenter.forEach((off) => off());
      offCompleted();
      offApproved();
      offRequested();
      offConfirmationRequired();
      offRejected();
      offRuntimeModes.forEach((off) => off());
      offCatalogAliases.forEach((off) => off());
    };
  }, [refresh, refreshTrialWatchSettings, reverifySubscription, scheduleAdminDrivenSoftSync, applySourceTransferCompleted, handleRemoteTransferAway, tryInstantApplyFromSse, showActivationSuccess, completeTargetTransferRedemption, applyChannelCatalogRealtime]);

  // Foreground sync: refresh catalog + reverify periodically while app is active.
  useEffect(() => {
    let stopped = false;
    let timer = null;
    let inFlight = false;
    let failCount = 0;
    let appState = AppState.currentState;

    const nextDelay = () => {
      if (failCount <= 0) return LIVE_SYNC_BASE_MS;
      return Math.min(LIVE_SYNC_BASE_MS * 2 ** failCount, LIVE_SYNC_MAX_MS);
    };

    const schedule = (ms) => {
      if (stopped) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(tick, ms);
    };

    const tick = async () => {
      if (stopped) return;
      if (appState !== 'active' || inFlight) {
        schedule(LIVE_SYNC_BASE_MS);
        return;
      }
      inFlight = true;
      try {
        invalidateCatalogCache();
        await refresh({
          showGlobalLoading: false,
          preserveDataOnError: true,
          forceNetwork: true,
        });
        await reverifySubscription('foreground-tick');
        failCount = 0;
      } catch {
        failCount += 1;
      } finally {
        inFlight = false;
        schedule(nextDelay());
      }
    };

    const sub = AppState.addEventListener('change', (next) => {
      appState = next;
      if (next === 'active') {
        schedule(1000);
        invalidateCatalogCache();
        void refresh({
          showGlobalLoading: false,
          preserveDataOnError: true,
          forceNetwork: true,
        });
        void reverifySubscription('app-resume');
      }
    });

    schedule(LIVE_SYNC_BASE_MS);

    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      sub.remove();
    };
  }, [refresh, reverifySubscription]);

  /** Drop local active subscription immediately — cache, refs, and UI gates. */
  const clearLocalActiveSubscription = useCallback(async (reason = 'manual') => {
    isSubscribedRef.current = false;
    setIsSubscribed(false);
    setSubscriptionExpiresAt(null);
    setSubscriptionDetails(null);
    setSubscriptionVersion((v) => v + 1);
    try {
      await clearSubscriptionCache(`clear-local:${reason}`);
    } catch {
      /* ignore */
    }
    console.log('[SUBSCRIPTION_CLEAR_LOCAL]', reason);
  }, []);

  /** Clear stale manual-gift popup state without touching subscription active flag. */
  const dismissManualGiftClientState = useCallback((reason = 'dismiss') => {
    setSubscriptionDetails((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        manualGiftShowPopup: false,
        manualGiftAckKey: null,
      };
    });
    console.log('[MANUAL_GIFT]', 'client_state_cleared', { reason });
  }, []);

  /**
   * Target device: instant unlock + Hongera after transfer redeem/SSE.
   */
  const completeTargetTransferRedemption = useCallback(
    async (verified, reason = 'transfer-redeem') => {
      if (!verified || verified.active !== true) return null;
      unlockChannels(verified);
      showActivationSuccess(verified, 'transfer');
      console.log('[TRANSFER_TARGET]', 'redemption_complete', { reason });
      return verified;
    },
    [unlockChannels, showActivationSuccess],
  );

  /**
   * Source Phone A: instant loss of premium access; navigate Home (no blocking modal).
   */
  const applySourceTransferCompleted = useCallback(
    async (reason = 'transfer_completed', opts = {}) => {
      const showSuccessModal = opts.showSuccessModal === true;
      sourceTransferClearLockUntilRef.current = Date.now() + SOURCE_TRANSFER_CLEAR_LOCK_MS;
      const hadActive = isSubscribedRef.current;
      sourceTransferSessionRef.current = null;
      setPendingTransfer(null);
      await clearLocalActiveSubscription(reason);
      if (hadActive && showSuccessModal) setSourceTransferSuccessVisible(true);
      runTransferNavigateHome();
      void reverifySubscription(`bg:${reason}`);
    },
    [clearLocalActiveSubscription, reverifySubscription],
  );

  const handleRemoteTransferAway = useCallback(
    async (payload, eventName, { showSuccessModal = false } = {}) => {
      const inner = unwrapSubscriptionSsePayload(payload);
      const sseReason = pickTransferSseReason(inner, eventName);
      const sourceId = pickSourceDeviceId(inner) || pickPayloadString(inner, ['device_id', 'deviceId']);
      const targetId = pickPayloadString(inner, [
        'target_device_id',
        'targetDeviceId',
        'to_device_id',
        'toDeviceId',
      ]);
      if (sourceId && targetId && (await devicesShareIdentity(sourceId, targetId))) {
        console.log('[TRANSFER_SSE]', eventName, 'ignored_same_device_identity', { sseReason });
        return;
      }
      const userInitiated =
        Boolean(sourceTransferSessionRef.current?.code) || isUserConfirmedTransferReason(sseReason);
      const hadActiveBefore = isSubscribedRef.current;
      if (!hadActiveBefore) return;
      await applySourceTransferCompleted(`sse:${eventName}`, {
        showSuccessModal: false,
      });
    },
    [applySourceTransferCompleted],
  );

  const dismissSourceTransferSuccess = useCallback(() => {
    setSourceTransferSuccessVisible(false);
  }, []);

  const clearSourceTransferSession = useCallback(() => {
    sourceTransferSessionRef.current = null;
    setPendingTransfer(null);
  }, []);

  const markSourceTransferSession = useCallback((code) => {
    const trimmed = String(code ?? '').trim();
    if (!trimmed) return;
    sourceTransferSessionRef.current = { code: trimmed, startedAt: Date.now() };
    console.log('[transfer-ui]', 'source transfer session started', { code: trimmed });
  }, []);

  const dismissPendingTransfer = useCallback(() => {
    setPendingTransfer(null);
  }, []);

  const requestEmergencyModal = useCallback(() => {
    setEmergencyModalRequestVersion((v) => v + 1);
  }, []);

  const requestPaymentModal = useCallback(() => {
    setPaymentModalRequest((v) => v + 1);
  }, []);

  const requestChannelUpdateGate = useCallback(() => {
    return presentChannelUpdateGateRef.current() === true;
  }, []);

  const presentChannelUpdateGate = useCallback(() => {
    setChannelUpdateGateVisible(true);
  }, []);

  const bindPresentChannelUpdateGate = useCallback((fn) => {
    presentChannelUpdateGateRef.current = typeof fn === 'function' ? fn : () => false;
    return () => {
      if (presentChannelUpdateGateRef.current === fn) {
        presentChannelUpdateGateRef.current = () => false;
      }
    };
  }, []);

  const dismissChannelUpdateGate = useCallback(() => {
    setChannelUpdateGateVisible(false);
  }, []);

  /**
   * Force-set the pending transfer payload from an external code path
   * (polling fallback, optimistic local transition, etc). Logs the
   * transition explicitly so the source-device approval state entry is
   * always traceable in the device console.
   */
  const triggerPendingTransfer = useCallback((payload, reason = 'external') => {
    const session = sourceTransferSessionRef.current;
    if (!session?.code) {
      console.log('[transfer-ui]', 'ignored pending transfer — no source session', { reason });
      return;
    }
    if (!payload || typeof payload !== 'object') {
      setPendingTransfer({ code: session.code, raw: payload, source: reason });
      console.log('[transfer-ui]', 'source approval state entered', { reason, payloadType: typeof payload });
      return;
    }
    const code = pickTransferCode(payload) || session.code;
    const eventBare = bareTransferCode(code);
    const sessionBare = bareTransferCode(session.code);
    if (eventBare && sessionBare && eventBare !== sessionBare) {
      console.log('[transfer-ui]', 'ignored pending transfer — code mismatch', {
        reason,
        eventCode: code,
        sessionCode: session.code,
      });
      return;
    }
    console.log('[transfer-ui]', 'pending transfer detected', { reason, code });
    setPendingTransfer({ ...payload, code });
    console.log('[transfer-ui]', 'source approval state entered', { reason, code });
  }, []);

  const value = useMemo(
    () => ({
      settings,
      freeMode: settings.freeMode,
      emergencyMode: settings.emergencyMode,
      maintenanceMode: settings.maintenanceMode,
      rawChannels,
      rawBanners,
      catalogAccessReady,
      catalogRevision,
      serverHealth,
      loading,
      error,
      isOffline,
      refresh,
      refreshSettingsOnly,
      isSubscribed,
      setIsSubscribed,
      subscriptionExpiresAt,
      subscriptionDetails,
      availablePlans,
      subscriptionVersion,
      // canonical names
      reverifySubscription,
      gateForPlayback,
      // legacy aliases (kept for existing screens)
      refreshSubscription: reverifySubscription,
      verifySubscriptionBeforePlay: gateForPlayback,
      unlockChannels,
      // transfer
      sourceTransferSuccessVisible,
      applySourceTransferCompleted,
      dismissSourceTransferSuccess,
      completeTargetTransferRedemption,
      clearLocalActiveSubscription,
      dismissManualGiftClientState,
      pendingTransfer,
      dismissPendingTransfer,
      triggerPendingTransfer,
      markSourceTransferSession,
      clearSourceTransferSession,
      emergencyModalRequestVersion,
      requestEmergencyModal,
      trialWatchSettings,
      trialWatchSettingsLoaded,
      subscriptionSyncLoaded,
      subscriptionRecoveryComplete,
      premiumPlaybackReady,
      getPremiumAccessSnapshot,
      awaitPremiumAccessSnapshot,
      awaitEntitlementForTap,
      awaitRecoverBoot,
      hydrateSubscriptionFromCache,
      awaitTrialWatchSettingsReady,
      awaitSubscriptionSyncReady,
      awaitPremiumGateReady,
      paymentModalRequest,
      requestPaymentModal,
      activationSuccessVisible,
      activationSuccessDetails,
      activationSuccessSource,
      showActivationSuccess,
      dismissActivationSuccess,
      applyInstantSubscriptionState,
      isWithinInstantUnlockGrace,
      requireUpdateBeforeChannelPlayback: settings.requireUpdateBeforeChannelPlayback,
      phoneNumberGateEnabled: settings.phoneNumberGateEnabled !== false,
      channelUpdateGateVisible,
      requestChannelUpdateGate,
      presentChannelUpdateGate,
      bindPresentChannelUpdateGate,
      dismissChannelUpdateGate,
    }),
    [
      settings,
      rawChannels,
      rawBanners,
      catalogAccessReady,
      catalogRevision,
      serverHealth,
      loading,
      error,
      isOffline,
      refresh,
      refreshSettingsOnly,
      isSubscribed,
      subscriptionExpiresAt,
      subscriptionDetails,
      availablePlans,
      subscriptionVersion,
      reverifySubscription,
      gateForPlayback,
      unlockChannels,
      sourceTransferSuccessVisible,
      applySourceTransferCompleted,
      dismissSourceTransferSuccess,
      completeTargetTransferRedemption,
      clearLocalActiveSubscription,
      dismissManualGiftClientState,
      pendingTransfer,
      dismissPendingTransfer,
      triggerPendingTransfer,
      markSourceTransferSession,
      clearSourceTransferSession,
      emergencyModalRequestVersion,
      requestEmergencyModal,
      trialWatchSettings,
      trialWatchSettingsLoaded,
      subscriptionSyncLoaded,
      subscriptionRecoveryComplete,
      premiumPlaybackReady,
      getPremiumAccessSnapshot,
      awaitPremiumAccessSnapshot,
      awaitEntitlementForTap,
      awaitRecoverBoot,
      hydrateSubscriptionFromCache,
      awaitTrialWatchSettingsReady,
      awaitSubscriptionSyncReady,
      awaitPremiumGateReady,
      paymentModalRequest,
      requestPaymentModal,
      activationSuccessVisible,
      activationSuccessDetails,
      activationSuccessSource,
      showActivationSuccess,
      dismissActivationSuccess,
      applyInstantSubscriptionState,
      channelUpdateGateVisible,
      requestChannelUpdateGate,
      presentChannelUpdateGate,
      bindPresentChannelUpdateGate,
      dismissChannelUpdateGate,
      isWithinInstantUnlockGrace,
    ],
  );

  return <OsmaniAppContext.Provider value={value}>{children}</OsmaniAppContext.Provider>;
}

export function useOsmaniApp() {
  const ctx = useContext(OsmaniAppContext);
  if (!ctx) {
    throw new Error('useOsmaniApp must be used within OsmaniAppProvider');
  }
  return ctx;
}
