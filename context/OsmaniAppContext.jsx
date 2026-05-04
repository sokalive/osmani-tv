import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { getChannels } from '../api';
import { getSettings } from '../api/settings';

const defaultSettings = {
  freeMode: false,
  emergencyMode: false,
  maintenanceMode: false,
};

const OsmaniAppContext = createContext(null);

export function OsmaniAppProvider({ children }) {
  const [settings, setSettings] = useState(defaultSettings);
  const [rawChannels, setRawChannels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isSubscribed, setIsSubscribed] = useState(false);

  /**
   * Reload settings + channels.
   * @param {{ showGlobalLoading?: boolean }} [opts] — set showGlobalLoading: false for pull-to-refresh (no full-screen blocking load).
   */
  const refresh = useCallback(async (opts = {}) => {
    const showGlobalLoading = opts.showGlobalLoading !== false;
    if (showGlobalLoading) setLoading(true);
    setError(null);
    try {
      const [s, list] = await Promise.all([getSettings(), getChannels()]);
      setSettings({
        freeMode: Boolean(s.freeMode),
        emergencyMode: Boolean(s.emergencyMode),
        maintenanceMode: Boolean(s.maintenanceMode),
      });
      setRawChannels(Array.isArray(list) ? list : []);
    } catch (e) {
      setError(e?.message ?? 'Failed to load');
      setRawChannels([]);
    } finally {
      if (showGlobalLoading) setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const value = useMemo(
    () => ({
      settings,
      freeMode: settings.freeMode,
      emergencyMode: settings.emergencyMode,
      maintenanceMode: settings.maintenanceMode,
      rawChannels,
      loading,
      error,
      refresh,
      isSubscribed,
      setIsSubscribed,
    }),
    [settings, rawChannels, loading, error, refresh, isSubscribed],
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
