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
import { DEVICE_INTELLIGENCE_SSE_EVENTS } from '../lib/adminSseRefreshEvents';
import {
  assertDeviceIntelligenceAllowed,
  setDeviceIntelligenceAccessState,
} from '../lib/deviceIntelligenceAccess';
import { subscribeRealtimeEvent } from '../lib/realtimeSync';

/** Active-session access check interval while app is foregrounded. */
const POLL_MS = 15 * 1000;

const DeviceIntelligenceContext = createContext(null);

export function DeviceIntelligenceProvider({ children }) {
  const [blocked, setBlocked] = useState(false);
  const [blockedModalVisible, setBlockedModalVisible] = useState(false);
  const [unblockModalVisible, setUnblockModalVisible] = useState(false);
  const [ready, setReady] = useState(false);
  const pollTimerRef = useRef(null);
  const runningRef = useRef(false);
  const blockedRef = useRef(false);

  const showBlockedModal = useCallback(() => {
    setBlockedModalVisible(true);
  }, []);

  const dismissBlockedModal = useCallback(() => {
    setBlockedModalVisible(false);
  }, []);

  const dismissUnblockModal = useCallback(() => {
    setUnblockModalVisible(false);
  }, []);

  const applyBlockedState = useCallback((nextBlocked, { showModal = true } = {}) => {
    const wasBlocked = blockedRef.current;
    blockedRef.current = nextBlocked;
    setBlocked(nextBlocked);
    if (nextBlocked) {
      setUnblockModalVisible(false);
      if (showModal) setBlockedModalVisible(true);
      return;
    }
    setBlockedModalVisible(false);
    if (wasBlocked) setUnblockModalVisible(true);
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
      if (result.status === 'blocked' || result.blocked === true) {
        applyBlockedState(true, { showModal: true });
        return;
      }
      if (result.status === 'active') {
        applyBlockedState(false);
        return;
      }
      if (!result.ok && prev === 'blocked') {
        applyBlockedState(true, { showModal: true });
      }
    } finally {
      runningRef.current = false;
      setReady(true);
    }
  }, [applyBlockedState]);

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

  useEffect(() => {
    const unsubs = DEVICE_INTELLIGENCE_SSE_EVENTS.map((eventName) =>
      subscribeRealtimeEvent(eventName, () => {
        void refresh();
      }),
    );
    return () => {
      for (const off of unsubs) off();
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
