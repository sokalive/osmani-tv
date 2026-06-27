import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { getBanners, getChannels, getServerHealth, invalidateCatalogCache } from '../api';
import { devLog } from '../lib/devLog';
import { sortChannelsByAdminOrder } from '../lib/channelOrder';
import { parseAppSettingsRealtimePatch, tryGetViewerAppSettings } from '../api/settings';
import { tryGetViewerTrialWatchSettings } from '../api/trialWatchSettings';
import {
  TRIAL_WATCH_FAIL_CLOSED,
  parseTrialWatchSettings,
} from '../lib/trialWatchSettings.shared';
import {
  clearSubscriptionCache,
  isSubscriptionTransportFailure,
  readSubscriptionCache,
  recoverSubscription,
  resolveActiveSubscription,
  writeSubscriptionCache,
} from '../api/subscription';
import { ADMIN_RUNTIME_MODE_SSE_EVENTS, ADMIN_SOFT_REFRESH_SSE_EVENTS, SUBSCRIPTION_SSE_EVENTS } from '../lib/adminSseRefreshEvents';
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
import {
  devicesShareIdentity,
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
  subscriptionDetailsFromCache,
} from '../lib/subscriptionCacheHydrate';
import {
  extractPlanSnapshotFromDetails,
  mergeSubscriptionDetails,
} from '../lib/subscriptionDetailsMerge';
import { enrichCanonicalSubscriptionTiming } from '../lib/subscriptionCanonical';

const STARTUP_FETCH_TIMEOUT_MS = 20_000;
const COLD_START_SUBSCRIPTION_TIMEOUT_MS = 15_000;
/** Fast recover on boot — v24 migration must finish before premium taps decide "unpaid". */
const RECOVER_BOOT_TIMEOUT_MS = 5_000;
const SUBSCRIPTION_VERIFY_TIMEOUT_MS = 12_000;
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
  /** Set when the backend reports the subscription is no longer active on this device. */
  const [revokedReason, setRevokedReason] = useState(null);
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
  const subscriptionReadyResolveRef = useRef(null);
  const subscriptionReadyPromiseRef = useRef(null);
  if (!subscriptionReadyPromiseRef.current) {
    subscriptionReadyPromiseRef.current = new Promise((resolve) => {
      subscriptionReadyResolveRef.current = resolve;
    });
  }
  /** Incremented to open PremiumModal from any screen (trial / preview expiry). */
  const [paymentModalRequest, setPaymentModalRequest] = useState(0);
  /** Legacy channel playback blocked until APK update (admin toggle). */
  const [channelUpdateGateVisible, setChannelUpdateGateVisible] = useState(false);
  const presentChannelUpdateGateRef = useRef(() => false);

  const verifyInFlightRef = useRef(false);
  const refreshInFlightRef = useRef(0);
  const refreshPromiseRef = useRef(null);
  const verifyPromiseRef = useRef(null);
  const recoverBootPromiseRef = useRef(null);
  const lastVerifyKeyRef = useRef(0);
  /** Authoritative subscription flag for playback gates (updated synchronously on verify). */
  const isSubscribedRef = useRef(false);
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
    if (sourceTransferClearLockUntilRef.current > Date.now()) {
      console.log('[SUBSCRIPTION_CACHE]', reason, 'skipped_hydrate_after_source_transfer');
      return false;
    }
    const { cached } = await readHydratableSubscriptionCache();
    if (!cached?.active) return false;
    isSubscribedRef.current = true;
    setIsSubscribed(true);
    setSubscriptionExpiresAt(cached.expiresAt ?? null);
    setSubscriptionDetails(subscriptionDetailsFromCache(cached));
    setSubscriptionVersion((v) => v + 1);
    console.log('[SUBSCRIPTION_CACHE]', reason, 'hydrated_active', {
      expiresAt: cached.expiresAt ?? null,
    });
    return true;
  }, []);

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
      try {
      const identity = await getDeviceIdentity();
      const { deviceId, deviceFingerprint } = identity;
      let r;
      try {
        r = await withTimeout(
          resolveActiveSubscription(identity),
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

        if (!active && isSubscriptionTransportFailure(r)) {
          if (transferLockActive) {
            console.log('[SUBSCRIPTION_VERIFY]', reason, 'skipped_transport_cache_after_source_transfer');
          } else {
          const cached = await readSubscriptionCache();
          const sameDevice =
            !cached.deviceId ||
            cached.deviceId === deviceId ||
            (identity.androidId && cached.deviceId === identity.androidId);
          if (cached.active && sameDevice) {
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
        } else if (
          !transferLockActive &&
          !active &&
          r.resolveSource !== 'inactive' &&
          isSubscribedRef.current
        ) {
          const cached = await readSubscriptionCache();
          const sameDevice =
            !cached.deviceId ||
            cached.deviceId === deviceId ||
            (identity.androidId && cached.deviceId === identity.androidId);
          if (cached.active && sameDevice) {
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
        }

        if (
          verifyKey !== lastVerifyKeyRef.current ||
          (active === false && r.resolveSource !== 'inactive' && !transferLockActive)
        ) {
          if (active === false && r.resolveSource !== 'inactive' && !transferLockActive) {
            console.log('[SUBSCRIPTION_VERIFY]', reason, 'preserved_subscribed_state', {
              resolveSource: r.resolveSource ?? null,
              hadActive: isSubscribedRef.current,
            });
            return effectiveResult;
          }
          if (verifyKey !== lastVerifyKeyRef.current) return r;
        }

        isSubscribedRef.current = active;
        const serverTimeFetchedAt = Date.now();
        setIsSubscribed(active);
        setSubscriptionExpiresAt(active ? expiresAt : null);
        if (Array.isArray(effectiveResult.plans) && effectiveResult.plans.length > 0) {
          setAvailablePlans(effectiveResult.plans);
        }
        const detailSource = effectiveResult;
        const rawDetailsPayload = active
          ? enrichCanonicalSubscriptionTiming({
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
              manualGiftAckKey: detailSource.manualGiftAckKey ?? null,
              transportPreserved: effectiveResult.transportPreserved === true,
            })
          : null;
        const detailsPayload = rawDetailsPayload;
        let mergedDetails = null;
        setSubscriptionDetails((prev) => {
          if (!active) return null;
          mergedDetails = mergeSubscriptionDetails(prev, detailsPayload);
          return mergedDetails;
        });
        console.log('[MANUAL_GIFT]', 'context_after_verify', {
          reason,
          active,
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
          setRevokedReason(null);
          let planSnapshot = extractPlanSnapshotFromDetails(mergedDetails);
          if (!planSnapshot && effectiveResult.transportPreserved === true) {
            const cachedSnap = await readSubscriptionCache();
            planSnapshot = cachedSnap.planSnapshot ?? null;
          }
          const cached = await readSubscriptionCache();
          const cacheExpiresMs = cached?.expiresAt ? Date.parse(String(cached.expiresAt)) : NaN;
          const verifyExpiresMs = expiresAt ? Date.parse(String(expiresAt)) : NaN;
          const backendNewer =
            Number.isFinite(verifyExpiresMs) &&
            (!Number.isFinite(cacheExpiresMs) || verifyExpiresMs > cacheExpiresMs);
          if (backendNewer && effectiveResult.transportPreserved !== true) {
            console.log('[SUBSCRIPTION_CACHE]', reason, 'overwrite_newer_expiry', {
              cacheExpiresAt: cached?.expiresAt ?? null,
              verifyExpiresAt: expiresAt,
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
          r.resolveSource === 'inactive'
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
            cached?.active &&
            sameDevice
          ) {
            isSubscribedRef.current = true;
            setIsSubscribed(true);
            setSubscriptionExpiresAt(cached.expiresAt ?? null);
            setSubscriptionDetails(subscriptionDetailsFromCache(cached));
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

    if (!isBackground) {
      if (isSubscribedRef.current) {
        void reverifySubscription(`gate-bg:${reason}`);
        console.log('[PLAYBACK_GATE]', 'allowed_cache_ref', reason);
        return true;
      }
      const { cached } = await readHydratableSubscriptionCache();
      if (cached?.active) {
        isSubscribedRef.current = true;
        setIsSubscribed(true);
        setSubscriptionExpiresAt(cached.expiresAt ?? null);
        if (!subscriptionDetails) {
          setSubscriptionDetails(subscriptionDetailsFromCache(cached));
        }
        setSubscriptionVersion((v) => v + 1);
        void reverifySubscription(`gate-bg:${reason}`);
        console.log('[PLAYBACK_GATE]', 'allowed_cache_read', reason);
        return true;
      }
    }

    const hadSubscriptionBefore = isSubscribedRef.current;
    const r = await reverifySubscription(isBackground ? reason : `gate:${reason}`);
    const active = r?.active === true;
    if (!active) {
      console.log('[PLAYBACK_GATE]', 'denied', reason);
      if (hadSubscriptionBefore && isConfirmedSubscriptionLoss(r)) {
        const modalReason = resolveSubscriptionLossModalReason(r);
        logSubscriptionLossModalDecision(`gate:${reason}`, r, modalReason ?? 'skipped', {
          hadSubscriptionBefore,
        });
        if (modalReason) {
          setRevokedReason((cur) => cur ?? modalReason);
        }
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
  }, [reverifySubscription, subscriptionDetails]);

  /** Apply the same object returned from `reverifySubscription` / API (strict `isActive`). */
  const unlockChannels = useCallback((subscription) => {
    if (!subscription) return;
    const active = subscription.isActive === true || subscription.active === true;
    if (!active) return;
    isSubscribedRef.current = true;
    setIsSubscribed(true);
    if (subscription.expiresAt != null) setSubscriptionExpiresAt(String(subscription.expiresAt));
    setRevokedReason(null);
    setSubscriptionVersion((v) => v + 1);
  }, []);

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
      if (!cancelled && cachedChannels?.channels?.length) {
        setRawChannels(sortChannelsByAdminOrder(cachedChannels.channels));
      }
      const cached = await readBannersCache();
      if (cancelled || !cached?.banners?.length) return;
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
      const [list, bannersResult, flags, trialFlags] = await Promise.all([
        withTimeout(getChannels(catalogOpts), STARTUP_FETCH_TIMEOUT_MS, 'startup-channels'),
        withTimeout(getBanners(catalogOpts), STARTUP_FETCH_TIMEOUT_MS, 'startup-banners').catch(() => null),
        withTimeout(tryGetViewerAppSettings(), STARTUP_FETCH_TIMEOUT_MS, 'startup-settings').catch(
          () => null,
        ),
        withTimeout(
          tryGetViewerTrialWatchSettings(),
          STARTUP_FETCH_TIMEOUT_MS,
          'startup-trial-watch',
        ).catch(() => null),
      ]);
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
      setRawChannels(nextChannels);
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
      setRawBanners((prev) => (nextBanners != null ? nextBanners : prev));
      setIsOffline(false);
      if (nextBanners != null) {
        await dropLegacyBannersCache();
        await writeBannersCache(nextBanners);
        logBannerRuntimeDiagnostics(nextBanners);
      }
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
  }, [refresh]);

  useEffect(() => {
    void refreshTrialWatchSettings('boot');
  }, [refreshTrialWatchSettings]);

  // Cold-start: hydrate cache → fast recover (v24 migration) → mark sync ready → background verify.
  useEffect(() => {
    let cancelled = false;
    recoverBootPromiseRef.current = (async () => {
      try {
        await hydrateSubscriptionFromCache('cold-start-cache');
      } catch (e) {
        console.log('[SUBSCRIPTION_COLD_START]', 'cache_hydrate_error', e?.message ?? e);
      }

      try {
        const identity = await getDeviceIdentity();
        const { deviceId, deviceFingerprint } = identity;
        const r = await withTimeout(
          recoverSubscription(deviceId, deviceFingerprint, {
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
          }),
          RECOVER_BOOT_TIMEOUT_MS,
          'cold-start-recover',
        );
        console.log('[SUBSCRIPTION_RECOVER]', 'cold-start', {
          active: r?.active,
          expiresAt: r?.expiresAt,
          recoverRefreshed: r?.recoverRefreshed === true,
        });
        if (r?.active === true || r?.recoverRefreshed === true) {
          isSubscribedRef.current = true;
          setIsSubscribed(true);
          setSubscriptionExpiresAt(r.expiresAt ?? null);
          setSubscriptionDetails(subscriptionDetailsFromCache({ active: true, expiresAt: r.expiresAt }));
          setSubscriptionVersion((v) => v + 1);
          await writeSubscriptionCache({
            active: true,
            expiresAt: r.expiresAt ?? null,
            deviceId,
            fingerprint: deviceFingerprint,
          });
        }
      } catch (e) {
        console.log('[SUBSCRIPTION_COLD_START]', 'recover_timeout_or_error', e?.message ?? e);
      }

      if (!cancelled) {
        setSubscriptionSyncLoaded(true);
        if (subscriptionReadyResolveRef.current) {
          subscriptionReadyResolveRef.current(true);
          subscriptionReadyResolveRef.current = null;
        }
      }

      try {
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
    () => ({
      premiumPlaybackReady: subscriptionSyncLoaded && trialWatchSettingsLoaded,
      isSubscribed: isSubscribedRef.current,
      freeMode: settingsRef.current.freeMode,
      trialWatchSettings: trialWatchSettingsRef.current,
    }),
    [subscriptionSyncLoaded, trialWatchSettingsLoaded],
  );

  const awaitPremiumAccessSnapshot = useCallback(async () => {
    await Promise.all([awaitTrialWatchSettingsReady(), awaitSubscriptionSyncReady()]);
    return getPremiumAccessSnapshot();
  }, [
    awaitSubscriptionSyncReady,
    awaitTrialWatchSettingsReady,
    getPremiumAccessSnapshot,
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
    const offRevoked = subscribeRealtimeEvent('subscription_revoked', (payload) => {
      void (async () => {
        const role = await subscriptionTransferSseRole(payload, 'subscription_revoked');
        if (role === 'none' || role === 'other') return;
        console.log('[SUBSCRIPTION_REVOKED]', 'sse', payload, { role });
        const hadActiveBefore = isSubscribedRef.current;
        const inner = unwrapSubscriptionSsePayload(payload);
        const sseReason = pickTransferSseReason(inner, 'subscription_revoked');
        const r = await reverifySubscription('sse:subscription_revoked');
        if (r?.active === true) {
          logSubscriptionLossModalDecision('sse:subscription_revoked', r, 'cleared', {
            role,
            hadActiveBefore,
            sseReason,
          });
          setRevokedReason(null);
          return;
        }
        if (!hadActiveBefore) {
          logSubscriptionLossModalDecision('sse:subscription_revoked', r, 'skipped', {
            role,
            hadActiveBefore,
            sseReason,
            skip: 'no_prior_active',
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
            showSuccessModal: userInitiated,
          });
          return;
        }
        if (!isConfirmedSubscriptionLoss(r)) {
          logSubscriptionLossModalDecision('sse:subscription_revoked', r, 'skipped', {
            role,
            hadActiveBefore,
            sseReason,
            skip: 'not_confirmed_loss',
          });
          return;
        }
        const modalReason = resolveSubscriptionLossModalReason(r);
        logSubscriptionLossModalDecision('sse:subscription_revoked', r, modalReason ?? 'skipped', {
          role,
          hadActiveBefore,
          sseReason,
        });
        if (!modalReason) return;
        setRevokedReason(modalReason);
        isSubscribedRef.current = false;
        setIsSubscribed(false);
        setSubscriptionExpiresAt(null);
        setSubscriptionDetails(null);
        void clearSubscriptionCache('sse:subscription_revoked');
      })();
    });
    const offSubscriptionLifecycle = SUBSCRIPTION_SSE_EVENTS.map((ev) =>
      subscribeRealtimeEvent(ev, (payload) => {
        console.log('[SUBSCRIPTION_SSE]', ev, payload);
        void reverifySubscription(`sse:${ev}`);
        scheduleAdminDrivenSoftSync(`sse:${ev}`);
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
          if (sseReason && !isExplicitTransferRevokeReason(sseReason)) {
            console.log('[TRANSFER_COMPLETED]', 'ignored_non_transfer_reason', { sseReason, role });
            void reverifySubscription('sse:transfer_completed:ignored');
            return;
          }
          const userInitiated =
            Boolean(sourceTransferSessionRef.current?.code) ||
            isUserConfirmedTransferReason(sseReason);
          await handleRemoteTransferAway(payload, 'transfer_completed', {
            showSuccessModal: userInitiated,
          });
          return;
        }
        sourceTransferSessionRef.current = null;
        setPendingTransfer(null);
        const r = await reverifySubscription('sse:transfer_completed');
        if (r?.active === true) {
          setRevokedReason(null);
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
      void reverifySubscription('sse:transfer_approved');
    });
    // Source-device approve/reject popup fires on EITHER event name —
    // the new backend uses `transfer_confirmation_required`; the older
    // alias `transfer_requested` is kept as a fallback for backward
    // compatibility.
    const handleSourceTransferRequest = (eventName) => async (payload) => {
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
      const sourceMatches = Boolean(
        sourceDeviceId && deviceId && sourceDeviceId === deviceId,
      );
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
    const offRuntimeModes = RUNTIME_MODE_SSE_NAMES.map((ev) =>
      subscribeRealtimeEvent(ev, (payload) => {
        console.log('[RUNTIME_MODES_SSE]', ev, payload);
        const patch = parseAppSettingsRealtimePatch(payload);
        if (patch) {
          setSettings((prev) => ({ ...prev, ...patch }));
          console.log('[SETTINGS_SYNC]', ev, patch);
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
        scheduleAdminDrivenSoftSync(`sse:${ev}`);
      }),
    );
    return () => {
      offRevoked();
      offSubscriptionLifecycle.forEach((off) => off());
      offCompleted();
      offApproved();
      offRequested();
      offConfirmationRequired();
      offRuntimeModes.forEach((off) => off());
      offCatalogAliases.forEach((off) => off());
    };
  }, [refresh, refreshTrialWatchSettings, reverifySubscription, scheduleAdminDrivenSoftSync, applySourceTransferCompleted, handleRemoteTransferAway]);

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

  const dismissRevoked = useCallback(() => {
    setRevokedReason(null);
  }, []);

  /** Drop local active subscription immediately — cache, refs, and UI gates. */
  const clearLocalActiveSubscription = useCallback(async (reason = 'manual') => {
    isSubscribedRef.current = false;
    setIsSubscribed(false);
    setSubscriptionExpiresAt(null);
    setSubscriptionDetails(null);
    setSubscriptionVersion((v) => v + 1);
    setRevokedReason(null);
    try {
      await clearSubscriptionCache(`clear-local:${reason}`);
    } catch {
      /* ignore */
    }
    console.log('[SUBSCRIPTION_CLEAR_LOCAL]', reason);
  }, []);

  /**
   * Source Phone A: instant loss of premium access; success popup only when user initiated transfer.
   */
  const applySourceTransferCompleted = useCallback(
    async (reason = 'transfer_completed', opts = {}) => {
      const showSuccessModal = opts.showSuccessModal !== false;
      sourceTransferClearLockUntilRef.current = Date.now() + SOURCE_TRANSFER_CLEAR_LOCK_MS;
      const hadActive = isSubscribedRef.current;
      sourceTransferSessionRef.current = null;
      setPendingTransfer(null);
      await clearLocalActiveSubscription(reason);
      if (hadActive && showSuccessModal) setSourceTransferSuccessVisible(true);
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
        showSuccessModal: showSuccessModal && userInitiated,
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
    sourceTransferSessionRef.current = null;
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
      // revoke / transfer
      revokedReason,
      dismissRevoked,
      sourceTransferSuccessVisible,
      applySourceTransferCompleted,
      dismissSourceTransferSuccess,
      clearLocalActiveSubscription,
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
      premiumPlaybackReady,
      getPremiumAccessSnapshot,
      awaitPremiumAccessSnapshot,
      awaitRecoverBoot,
      awaitTrialWatchSettingsReady,
      awaitSubscriptionSyncReady,
      awaitPremiumGateReady,
      paymentModalRequest,
      requestPaymentModal,
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
      revokedReason,
      dismissRevoked,
      sourceTransferSuccessVisible,
      applySourceTransferCompleted,
      dismissSourceTransferSuccess,
      clearLocalActiveSubscription,
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
      premiumPlaybackReady,
      getPremiumAccessSnapshot,
      awaitPremiumAccessSnapshot,
      awaitRecoverBoot,
      awaitTrialWatchSettingsReady,
      awaitSubscriptionSyncReady,
      awaitPremiumGateReady,
      paymentModalRequest,
      requestPaymentModal,
      channelUpdateGateVisible,
      requestChannelUpdateGate,
      presentChannelUpdateGate,
      bindPresentChannelUpdateGate,
      dismissChannelUpdateGate,
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
