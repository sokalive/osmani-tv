import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { getBanners, getChannels, getServerHealth } from '../api';
import { getSettings } from '../api/settings';
import {
  clearSubscriptionCache,
  readSubscriptionCache,
  recoverSubscription,
  verifySubscription,
  writeSubscriptionCache,
} from '../api/subscription';
import { readBannersCache, writeBannersCache } from '../lib/bannersCache';
import { getDeviceIdentity } from '../lib/deviceIdentity';
import { subscribeRealtimeEvent } from '../lib/realtimeSync';

const defaultSettings = {
  freeMode: false,
  emergencyMode: false,
  maintenanceMode: false,
};
const LIVE_SYNC_BASE_MS = 15000;
const LIVE_SYNC_MAX_MS = 120000;

const OsmaniAppContext = createContext(null);

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

  const verifyInFlightRef = useRef(false);
  const lastVerifyKeyRef = useRef(0);

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
      setSubscriptionDetails(active
        ? {
            amount: r.amount ?? null,
            currency: r.currency ?? null,
            planName: r.planName ?? null,
            planDurationDays: r.planDurationDays ?? null,
            startedAt: r.startedAt ?? null,
            expiresAt,
            serverTime: r.serverTime ?? null,
            serverTimeFetchedAt,
            plans: Array.isArray(r.plans) ? r.plans : [],
          }
        : null,
      );
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
    readBannersCache().then((cached) => {
      if (cancelled || !cached?.banners?.length) return;
      setRawBanners(cached.banners);
    });
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
  const refresh = useCallback(async (opts = {}) => {
    const showGlobalLoading = opts.showGlobalLoading !== false;
    const preserveDataOnError = opts.preserveDataOnError === true;
    if (showGlobalLoading) setLoading(true);
    setError(null);
    try {
      const [s, list, bannersResult] = await Promise.all([
        getSettings(),
        getChannels(),
        getBanners().catch(() => null),
      ]);
      setSettings({
        freeMode: Boolean(s.freeMode),
        emergencyMode: Boolean(s.emergencyMode),
        maintenanceMode: Boolean(s.maintenanceMode),
      });
      setRawChannels(Array.isArray(list) ? list : []);
      const nextBanners = Array.isArray(bannersResult) ? bannersResult : null;
      setRawBanners((prev) => (nextBanners != null ? nextBanners : prev));
      if (nextBanners != null) {
        writeBannersCache(nextBanners).catch(() => {});
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
      setPendingTransfer(null);
      void reverifySubscription('sse:transfer_completed').then((r) => {
        if (r?.active !== true) {
          setRevokedReason('transferred');
        }
      });
    });
    const offRequested = subscribeRealtimeEvent('transfer_requested', (payload) => {
      console.log('[TRANSFER_REQUESTED]', 'sse', payload);
      if (payload && typeof payload === 'object' && typeof payload.code === 'string') {
        setPendingTransfer(payload);
      } else {
        setPendingTransfer({ code: '', raw: payload });
      }
    });
    const offSettings = subscribeRealtimeEvent('app_settings_changed', (payload) => {
      console.log('[APP_SETTINGS_CHANGED]', 'sse', payload);
      void refresh({ showGlobalLoading: false, preserveDataOnError: true });
      void reverifySubscription('sse:app_settings_changed');
    });
    return () => {
      offRevoked();
      offCompleted();
      offRequested();
      offSettings();
    };
  }, [refresh, reverifySubscription]);

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

  const dismissPendingTransfer = useCallback(() => {
    setPendingTransfer(null);
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
    }),
    [
      settings,
      rawChannels,
      rawBanners,
      serverHealth,
      loading,
      error,
      refresh,
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
