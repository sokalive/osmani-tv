import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { getBanners, getChannels, getServerHealth } from '../api';
import { sortChannelsByAdminOrder } from '../lib/channelOrder';
import { parseAppSettingsRealtimePatch, tryGetViewerAppSettings } from '../api/settings';
import { tryGetViewerTrialWatchSettings } from '../api/trialWatchSettings';
import {
  DEFAULT_TRIAL_WATCH_SETTINGS,
  parseTrialWatchSettings,
} from '../lib/trialWatchSettings.shared';
import {
  clearSubscriptionCache,
  readSubscriptionCache,
  recoverSubscription,
  verifySubscription,
  writeSubscriptionCache,
} from '../api/subscription';
import { ADMIN_RUNTIME_MODE_SSE_EVENTS, ADMIN_SOFT_REFRESH_SSE_EVENTS } from '../lib/adminSseRefreshEvents';
import {
  dropLegacyBannersCache,
  readBannersCache,
  writeBannersCache,
} from '../lib/bannersCache';
import { enrichBannersForViewer } from '../lib/bannerViewerSerializer';
import { logBannerRuntimeDiagnostics } from '../lib/normalizeBanner';
import { getDeviceIdentity } from '../lib/deviceIdentity';
import { subscribeRealtimeEvent } from '../lib/realtimeSync';

const defaultSettings = {
  freeMode: false,
  emergencyMode: false,
  maintenanceMode: false,
};
/** SSE names that carry free / emergency / maintenance — must not share the catalog debouncer. */
const RUNTIME_MODE_SSE_NAMES = Object.freeze(['app_settings_changed', ...ADMIN_RUNTIME_MODE_SSE_EVENTS]);
const LIVE_SYNC_BASE_MS = 15000;
const LIVE_SYNC_MAX_MS = 120000;
/** Fast poll for admin flags (maintenance / emergency / free); complements SSE. */
const SETTINGS_POLL_MS = 2500;

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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
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
  /** Active `transfer_requested` payload (source-device approval popup). */
  const [pendingTransfer, setPendingTransfer] = useState(null);
  /** Bumped to re-open global emergency modal (banner / channel tap while emergency). */
  const [emergencyModalRequestVersion, setEmergencyModalRequestVersion] = useState(0);
  const [trialWatchSettings, setTrialWatchSettings] = useState(DEFAULT_TRIAL_WATCH_SETTINGS);
  /** Incremented to open PremiumModal from any screen (trial / preview expiry). */
  const [paymentModalRequest, setPaymentModalRequest] = useState(0);

  const verifyInFlightRef = useRef(false);
  const lastVerifyKeyRef = useRef(0);
  /** Set after source POST /transfer/request succeeds; gates Kubali/Kataa popup. */
  const sourceTransferSessionRef = useRef(null);

  /**
   * Single trust path. Always hits the backend and treats `active` as the
   * sole source of truth. Updates context state, AsyncStorage cache, and
   * the revoked banner. Returns the verify response so callers (e.g. the
   * player) can gate playback on the same atomic answer.
   */
  const reverifySubscription = useCallback(async (reason = 'manual') => {
    if (verifyInFlightRef.current) {
      console.log('[SUBSCRIPTION_VERIFY]', 'in-flight; skipping duplicate', { reason });
    }
    verifyInFlightRef.current = true;
    const verifyKey = ++lastVerifyKeyRef.current;
    try {
      const { deviceId, deviceFingerprint } = await getDeviceIdentity();
      const r = await verifySubscription(deviceId, deviceFingerprint);
      if (verifyKey !== lastVerifyKeyRef.current) return r;
      const active = r.active === true;
      const expiresAt = r.expiresAt ?? null;
      // Capture the monotonic anchor for the server-time at the instant
      // we received the response. Used by `subscriptionMath` for the
      // visual progress bar — never for trust.
      const serverTimeFetchedAt = Date.now();
      setIsSubscribed(active);
      setSubscriptionExpiresAt(active ? expiresAt : null);
      if (Array.isArray(r.plans) && r.plans.length > 0) {
        setAvailablePlans(r.plans);
      }
      const detailsPayload = active
        ? {
            amount: r.amount ?? null,
            currency: r.currency ?? null,
            planName: r.planName ?? null,
            planDurationDays: r.planDurationDays ?? r.plan_duration_days ?? null,
            plan_duration_days: r.plan_duration_days ?? r.planDurationDays ?? null,
            startedAt: r.startedAt ?? null,
            expiresAt,
            serverTime: r.serverTime ?? null,
            serverTimeFetchedAt,
            plans: Array.isArray(r.plans) ? r.plans : [],
            /** When set, Home may show a one-time admin gift popup until acknowledged. */
            manualGiftAckKey: r.manualGiftAckKey ?? null,
          }
        : null;
      setSubscriptionDetails(detailsPayload);
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
        await writeSubscriptionCache({ active: true, expiresAt, deviceId, fingerprint: deviceFingerprint });
      } else {
        await clearSubscriptionCache(`verify:${reason}`);
      }
      console.log('[SUBSCRIPTION_VERIFY]', reason, {
        active,
        expiresAt,
        amount: r.amount ?? null,
        planName: r.planName ?? null,
        startedAt: r.startedAt ?? null,
        serverTime: r.serverTime ?? null,
      });
      return r;
    } catch (e) {
      console.log('[SUBSCRIPTION_VERIFY]', reason, 'error', e?.message ?? e);
      if (verifyKey === lastVerifyKeyRef.current) {
        setIsSubscribed(false);
        setSubscriptionExpiresAt(null);
        setSubscriptionDetails(null);
        setSubscriptionVersion((v) => v + 1);
        await clearSubscriptionCache(`verify-error:${reason}`);
      }
      return { active: false, expiresAt: null, error: String(e?.message ?? e) };
    } finally {
      verifyInFlightRef.current = false;
    }
  }, []);

  /**
   * Reinstall recovery on cold start. Asks the backend to attach this
   * device to any active subscription bound to it, then reverifies. The
   * recover call is idempotent and safe to retry.
   */
  const recoverAndVerify = useCallback(async (reason = 'launch') => {
    try {
      const { deviceId, deviceFingerprint } = await getDeviceIdentity();
      const r = await recoverSubscription(deviceId, deviceFingerprint);
      console.log('[SUBSCRIPTION_RECOVER]', reason, { active: r.active, expiresAt: r.expiresAt });
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
    const r = await reverifySubscription(`gate:${reason}`);
    const active = r?.active === true;
    if (!active) {
      console.log('[PLAYBACK_GATE]', 'denied', reason);
      setRevokedReason((cur) => cur ?? 'expired');
    } else {
      console.log('[PLAYBACK_GATE]', 'allowed', reason);
    }
    return active;
  }, [reverifySubscription]);

  /** Apply the same object returned from `reverifySubscription` / API (strict `isActive`). */
  const unlockChannels = useCallback((subscription) => {
    if (!subscription) return;
    const active = subscription.isActive === true || subscription.active === true;
    if (!active) return;
    setIsSubscribed(true);
    if (subscription.expiresAt != null) setSubscriptionExpiresAt(String(subscription.expiresAt));
    setRevokedReason(null);
    setSubscriptionVersion((v) => v + 1);
  }, []);

  const refreshServerHealth = useCallback(async (reason = 'fetch') => {
    try {
      const payload = await getServerHealth();
      console.log('[SERVER_HEALTH_UPDATE]', reason, payload);
      setServerHealth(payload);
      return payload;
    } catch (e) {
      console.log('[SERVER_HEALTH_UPDATE]', 'fetch_failed', e?.message ?? e);
      return null;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await dropLegacyBannersCache();
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

  /**
   * Optimistic UI hint from local cache. NEVER used to grant playback —
   * `gateForPlayback` always reverifies against the backend before play.
   */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const cached = await readSubscriptionCache();
      if (cancelled || !cached?.active) return;
      setIsSubscribed(true);
      if (cached.expiresAt) setSubscriptionExpiresAt(cached.expiresAt);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * Reload settings + channels.
   * @param {{ showGlobalLoading?: boolean }} [opts] — set showGlobalLoading: false for pull-to-refresh (no full-screen blocking load).
   */
  /**
   * Lightweight: viewer-safe app flags via GET /api/public/app-settings only.
   */
  const refreshTrialWatchSettings = useCallback(async (reason = 'poll') => {
    const s = await tryGetViewerTrialWatchSettings();
    if (s) {
      setTrialWatchSettings(s);
      console.log('[TRIAL_WATCH_SYNC]', reason, s);
    }
  }, []);

  const refreshSettingsOnly = useCallback(async (reason = 'poll') => {
    const s = await tryGetViewerAppSettings();
    if (s) {
      setSettings((prev) => ({ ...prev, ...s }));
      console.log('[SETTINGS_SYNC]', reason, s);
    } else if (__DEV__) {
      console.log('[SETTINGS_SYNC]', reason, 'skip_no_public_flags');
    }
    await refreshTrialWatchSettings(reason);
  }, [refreshTrialWatchSettings]);

  const refresh = useCallback(async (opts = {}) => {
    const showGlobalLoading = opts.showGlobalLoading !== false;
    const preserveDataOnError = opts.preserveDataOnError === true;
    const skipSettingsFromHttp = opts.skipSettingsFromHttp === true;
    if (showGlobalLoading) setLoading(true);
    setError(null);
    try {
      const [list, bannersResult, flags, trialFlags] = await Promise.all([
        getChannels(),
        getBanners().catch(() => null),
        tryGetViewerAppSettings(),
        tryGetViewerTrialWatchSettings(),
      ]);
      if (flags && !skipSettingsFromHttp) {
        setSettings((prev) => ({ ...prev, ...flags }));
      }
      if (trialFlags) {
        setTrialWatchSettings(trialFlags);
      }
      setRawChannels(sortChannelsByAdminOrder(Array.isArray(list) ? list : []));
      const nextBanners = Array.isArray(bannersResult) ? bannersResult : null;
      setRawBanners((prev) => (nextBanners != null ? nextBanners : prev));
      if (nextBanners != null) {
        await dropLegacyBannersCache();
        await writeBannersCache(nextBanners);
        logBannerRuntimeDiagnostics(nextBanners);
      }
    } catch (e) {
      setError(e?.message ?? 'Failed to load');
      if (!preserveDataOnError) {
        setRawChannels([]);
      }
    } finally {
      if (showGlobalLoading) setLoading(false);
    }
  }, []);

  /** Debounced channels/banners + subscription reverify after admin SSE bursts. */
  const adminSoftSyncTimerRef = useRef(null);
  const scheduleAdminDrivenSoftSync = useCallback(
    (reason = 'sse:admin') => {
      if (adminSoftSyncTimerRef.current) clearTimeout(adminSoftSyncTimerRef.current);
      adminSoftSyncTimerRef.current = setTimeout(() => {
        adminSoftSyncTimerRef.current = null;
        console.log('[ADMIN_SYNC]', 'soft_refresh', reason);
        void refreshTrialWatchSettings(reason);
        void refresh({
          showGlobalLoading: false,
          preserveDataOnError: true,
          skipSettingsFromHttp: true,
        });
        void reverifySubscription(reason);
      }, 320);
    },
    [refresh, refreshTrialWatchSettings, reverifySubscription],
  );

  useEffect(
    () => () => {
      if (adminSoftSyncTimerRef.current) clearTimeout(adminSoftSyncTimerRef.current);
    },
    [],
  );

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Cold-start: recover (in case of reinstall) and immediately verify.
  useEffect(() => {
    void recoverAndVerify('cold-start');
  }, [recoverAndVerify]);

  useEffect(() => {
    void refreshServerHealth('initial');
    const unsubscribe = subscribeRealtimeEvent('server_health_changed', (payload) => {
      console.log('[SERVER_HEALTH_UPDATE]', 'sse', payload);
      if (payload && typeof payload === 'object') {
        setServerHealth(payload);
      }
      void refreshServerHealth('sse');
      void refresh({ showGlobalLoading: false, preserveDataOnError: true });
    });
    return unsubscribe;
  }, [refresh, refreshServerHealth]);

  // Fast settings poll + resume: admin flags update without waiting for full catalog refresh.
  useEffect(() => {
    let interval = null;
    const onAppState = (next) => {
      if (next === 'active') void refreshSettingsOnly('app_resume');
    };
    const sub = AppState.addEventListener('change', onAppState);
    interval = setInterval(() => {
      void refreshSettingsOnly('interval');
    }, SETTINGS_POLL_MS);
    return () => {
      sub.remove();
      if (interval) clearInterval(interval);
    };
  }, [refreshSettingsOnly]);

  // Realtime subscription lifecycle events from /api/sync/stream.
  useEffect(() => {
    const offRevoked = subscribeRealtimeEvent('subscription_revoked', (payload) => {
      console.log('[SUBSCRIPTION_REVOKED]', 'sse', payload);
      const reason =
        (payload && typeof payload === 'object' && typeof payload.reason === 'string')
          ? payload.reason
          : 'revoked';
      setRevokedReason(reason);
      setIsSubscribed(false);
      setSubscriptionExpiresAt(null);
      setSubscriptionDetails(null);
      void clearSubscriptionCache('sse:subscription_revoked');
      void reverifySubscription('sse:subscription_revoked');
    });
    const offCompleted = subscribeRealtimeEvent('transfer_completed', (payload) => {
      console.log('[TRANSFER_COMPLETED]', 'sse', payload);
      // The source device loses access; the destination gains it. Either
      // way, ask the backend who owns the subscription right now.
      sourceTransferSessionRef.current = null;
      setPendingTransfer(null);
      void reverifySubscription('sse:transfer_completed').then((r) => {
        if (r?.active !== true) {
          setRevokedReason('transferred');
        }
      });
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
        setTrialWatchSettings((prev) => ({
          ...prev,
          ...parseTrialWatchSettings(payload),
        }));
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
      offCompleted();
      offApproved();
      offRequested();
      offConfirmationRequired();
      offRuntimeModes.forEach((off) => off());
      offCatalogAliases.forEach((off) => off());
    };
  }, [refresh, reverifySubscription, scheduleAdminDrivenSoftSync]);

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
        await refresh({ showGlobalLoading: false, preserveDataOnError: true });
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
      pendingTransfer,
      dismissPendingTransfer,
      triggerPendingTransfer,
      markSourceTransferSession,
      clearSourceTransferSession,
      emergencyModalRequestVersion,
      requestEmergencyModal,
      trialWatchSettings,
      paymentModalRequest,
      requestPaymentModal,
    }),
    [
      settings,
      rawChannels,
      rawBanners,
      serverHealth,
      loading,
      error,
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
      pendingTransfer,
      dismissPendingTransfer,
      triggerPendingTransfer,
      markSourceTransferSession,
      clearSourceTransferSession,
      emergencyModalRequestVersion,
      requestEmergencyModal,
      trialWatchSettings,
      paymentModalRequest,
      requestPaymentModal,
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
