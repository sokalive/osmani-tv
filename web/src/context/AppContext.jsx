import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { apiGet, apiPost, parseSubscription, isChannelVisible } from '../lib/api';
import {
  getDeviceIdentity,
  getSavedPhone,
  identityPayload,
  savePhone,
} from '../lib/deviceId';

const AppContext = createContext(null);

export function AppProvider({ children }) {
  const [identity, setIdentity] = useState(null);
  const [phone, setPhoneState] = useState(getSavedPhone());
  const [channels, setChannels] = useState([]);
  const [banners, setBanners] = useState([]);
  const [plans, setPlans] = useState([]);
  const [subscription, setSubscription] = useState({ active: false, expiresAt: null });
  const [loadingCatalog, setLoadingCatalog] = useState(true);
  const [catalogError, setCatalogError] = useState('');
  const [premiumOpen, setPremiumOpen] = useState(false);
  const [hamishaOpen, setHamishaOpen] = useState(false);
  const [phoneGateOpen, setPhoneGateOpen] = useState(false);

  useEffect(() => {
    getDeviceIdentity().then(setIdentity).catch(() => setIdentity(null));
  }, []);

  const refreshCatalog = useCallback(async () => {
    setLoadingCatalog(true);
    setCatalogError('');
    try {
      const [ch, bn] = await Promise.all([
        apiGet('/api/channels', { cacheBust: true }),
        apiGet('/api/banners').catch(() => []),
      ]);
      setChannels(Array.isArray(ch) ? ch.filter(isChannelVisible) : []);
      setBanners(Array.isArray(bn) ? bn.filter((b) => b?.isActive !== false && b?.is_active !== false) : []);
    } catch (e) {
      setCatalogError(e?.message || 'Imeshindwa kupakia chaneli');
    } finally {
      setLoadingCatalog(false);
    }
  }, []);

  const refreshPlans = useCallback(async () => {
    try {
      const body = await apiGet('/api/plans');
      const list = Array.isArray(body) ? body : body?.plans || [];
      setPlans(list.filter((p) => p?.isActive !== false && p?.is_active !== false));
    } catch {
      setPlans([]);
    }
  }, []);

  const refreshSubscription = useCallback(async () => {
    if (!identity?.deviceId) return null;
    try {
      const verified = await apiPost('/api/subscription/verify', {
        ...identityPayload(identity, phone),
      });
      const parsed = parseSubscription(verified);
      setSubscription(parsed);
      return parsed;
    } catch {
      try {
        const st = await apiGet(
          `/api/subscription-status?device_id=${encodeURIComponent(identity.deviceId)}`,
          { cacheBust: true },
        );
        const parsed = parseSubscription(st);
        setSubscription(parsed);
        return parsed;
      } catch {
        return null;
      }
    }
  }, [identity, phone]);

  useEffect(() => {
    refreshCatalog();
    refreshPlans();
  }, [refreshCatalog, refreshPlans]);

  useEffect(() => {
    if (identity?.deviceId) refreshSubscription();
  }, [identity, refreshSubscription]);

  const setPhone = useCallback(
    async (value) => {
      const cleaned = String(value || '').trim();
      savePhone(cleaned);
      setPhoneState(cleaned);
      if (identity?.deviceId && cleaned) {
        try {
          await apiPost('/api/device/phone', {
            device_id: identity.deviceId,
            deviceId: identity.deviceId,
            phone: cleaned,
          });
        } catch {
          /* optional on web */
        }
      }
    },
    [identity],
  );

  const requirePhoneThen = useCallback(
    (fn) => {
      if (!getSavedPhone()) {
        setPhoneGateOpen(true);
        return;
      }
      fn?.();
    },
    [],
  );

  const openPremium = useCallback(() => {
    requirePhoneThen(() => {
      refreshPlans();
      setPremiumOpen(true);
    });
  }, [refreshPlans, requirePhoneThen]);

  const value = useMemo(
    () => ({
      identity,
      phone,
      setPhone,
      channels,
      banners,
      plans,
      subscription,
      loadingCatalog,
      catalogError,
      refreshCatalog,
      refreshSubscription,
      refreshPlans,
      premiumOpen,
      setPremiumOpen,
      openPremium,
      hamishaOpen,
      setHamishaOpen,
      phoneGateOpen,
      setPhoneGateOpen,
      isPremium: Boolean(subscription?.active),
    }),
    [
      identity,
      phone,
      setPhone,
      channels,
      banners,
      plans,
      subscription,
      loadingCatalog,
      catalogError,
      refreshCatalog,
      refreshSubscription,
      refreshPlans,
      premiumOpen,
      openPremium,
      hamishaOpen,
      phoneGateOpen,
    ],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp outside provider');
  return ctx;
}
