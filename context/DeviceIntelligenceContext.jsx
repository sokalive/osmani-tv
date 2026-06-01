import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AppState } from 'react-native';
import {
  readDeviceIntelligenceLastStatus,
  registerDeviceIntelligence,
} from '../api/usersIntelligence';
import {
  assertDeviceIntelligenceAllowed,
  setDeviceIntelligenceAccessState,
} from '../lib/deviceIntelligenceAccess';

const POLL_MS = 90 * 1000;

const DeviceIntelligenceContext = createContext(null);

export function DeviceIntelligenceProvider({ children }) {
  const [blocked, setBlocked] = useState(false);
  const [blockedModalVisible, setBlockedModalVisible] = useState(false);
  const [unblockModalVisible, setUnblockModalVisible] = useState(false);
  const [ready, setReady] = useState(false);
  const pollTimerRef = useRef(null);
  const runningRef = useRef(false);

  const showBlockedModal = useCallback(() => {
    setBlockedModalVisible(true);
  }, []);

  const dismissBlockedModal = useCallback(() => {
    setBlockedModalVisible(false);
  }, []);

  const dismissUnblockModal = useCallback(() => {
    setUnblockModalVisible(false);
  }, []);

  useEffect(() => {
    setDeviceIntelligenceAccessState({ blocked, showBlockedModal });
  }, [blocked, showBlockedModal]);

  const refresh = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    try {
      const prev = await readDeviceIntelligenceLastStatus();
      const result = await registerDeviceIntelligence();
      if (result.status === 'blocked') {
        setBlocked(true);
        setBlockedModalVisible(true);
        setUnblockModalVisible(false);
        return;
      }
      if (result.status === 'active') {
        setBlocked(false);
        setBlockedModalVisible(false);
        if (prev === 'blocked') setUnblockModalVisible(true);
        return;
      }
      if (!result.ok && prev === 'blocked') {
        setBlocked(true);
        setBlockedModalVisible(true);
      }
    } finally {
      runningRef.current = false;
      setReady(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refresh();
    });
    pollTimerRef.current = setInterval(() => {
      if (AppState.currentState === 'active') void refresh();
    }, POLL_MS);
    return () => {
      sub.remove();
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    };
  }, [refresh]);

  const guardUsage = useCallback(() => assertDeviceIntelligenceAllowed(), []);

  const value = useMemo(
    () => ({
      ready,
      blocked,
      blockedModalVisible,
      unblockModalVisible,
      showBlockedModal,
      dismissBlockedModal,
      dismissUnblockModal,
      refresh,
      guardUsage,
    }),
    [
      ready,
      blocked,
      blockedModalVisible,
      unblockModalVisible,
      showBlockedModal,
      dismissBlockedModal,
      dismissUnblockModal,
      refresh,
      guardUsage,
    ],
  );

  return (
    <DeviceIntelligenceContext.Provider value={value}>{children}</DeviceIntelligenceContext.Provider>
  );
}

export function useDeviceIntelligence() {
  const ctx = useContext(DeviceIntelligenceContext);
  if (!ctx) {
    return {
      ready: true,
      blocked: false,
      blockedModalVisible: false,
      unblockModalVisible: false,
      showBlockedModal: () => {},
      dismissBlockedModal: () => {},
      dismissUnblockModal: () => {},
      refresh: async () => {},
      guardUsage: () => ({ ok: true }),
    };
  }
  return ctx;
}
