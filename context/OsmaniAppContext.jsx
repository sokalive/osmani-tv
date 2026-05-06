import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { AppState } from 'react-native';
import { getBanners, getChannels } from '../api';
import { getSettings } from '../api/settings';
import { fetchSubscription, verifySubscriptionActive } from '../api/payment';
import { readBannersCache, writeBannersCache } from '../lib/bannersCache';
import { getDeviceIdentity } from '../lib/deviceIdentity';

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
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [subscriptionExpiresAt, setSubscriptionExpiresAt] = useState(null);
  /** Bumps after subscription fetch so consumers can invalidate memos tied to premium access. */
  const [subscriptionVersion, setSubscriptionVersion] = useState(0);

  const refreshSubscription = useCallback(async () => {
    try {
      const { deviceId } = await getDeviceIdentity();
      const sub = await fetchSubscription(deviceId);
      const expiresAt = sub.expiresAt != null ? String(sub.expiresAt) : null;
      const expiryTs = expiresAt ? Date.parse(expiresAt) : NaN;
      const isActive = sub.active === true && Number.isFinite(expiryTs) && expiryTs > Date.now();
      /** Always derive from this fetch — do not read React state here. */
      const subscription = { isActive, expiresAt };
      if (isActive) {
        setIsSubscribed(true);
        setSubscriptionExpiresAt(expiresAt);
      } else {
        setIsSubscribed(false);
        setSubscriptionExpiresAt(null);
      }
      setSubscriptionVersion((v) => v + 1);
      return subscription;
    } catch {
      const subscription = { isActive: false, expiresAt: null };
      setIsSubscribed(false);
      setSubscriptionExpiresAt(null);
      setSubscriptionVersion((v) => v + 1);
      return subscription;
    }
  }, []);

  /** Apply the same object returned from `refreshSubscription` / API (strict `isActive`). */
  const unlockChannels = useCallback((subscription) => {
    if (!subscription || subscription.isActive !== true) return;
    setIsSubscribed(true);
    if (subscription.expiresAt != null) setSubscriptionExpiresAt(String(subscription.expiresAt));
  }, []);

  const verifySubscriptionBeforePlay = useCallback(async () => {
    try {
      const { deviceId } = await getDeviceIdentity();
      return await verifySubscriptionActive(deviceId);
    } catch {
      return false;
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

  useEffect(() => {
    refreshSubscription();
  }, [refreshSubscription]);

  // Realtime sync via efficient foreground polling with automatic reconnect/backoff.
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
        await refreshSubscription();
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
      }
    });

    schedule(LIVE_SYNC_BASE_MS);

    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      sub.remove();
    };
  }, [refresh, refreshSubscription]);

  const value = useMemo(
    () => ({
      settings,
      freeMode: settings.freeMode,
      emergencyMode: settings.emergencyMode,
      maintenanceMode: settings.maintenanceMode,
      rawChannels,
      rawBanners,
      loading,
      error,
      refresh,
      isSubscribed,
      setIsSubscribed,
      subscriptionExpiresAt,
      subscriptionVersion,
      refreshSubscription,
      unlockChannels,
      verifySubscriptionBeforePlay,
    }),
    [
      settings,
      rawChannels,
      rawBanners,
      loading,
      error,
      refresh,
      isSubscribed,
      subscriptionExpiresAt,
      subscriptionVersion,
      refreshSubscription,
      unlockChannels,
      verifySubscriptionBeforePlay,
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
