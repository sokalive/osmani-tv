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
  runDeviceIntelligenceNavigateHome,
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
  const smartMonitorRef = useRef(false);
  /** User pressed "Nimeelewa" — browse app; modal only on new block or restricted action. */
  const blockedNoticeAckRef = useRef(false);

  const showBlockedModal = useCallback(() => {
    setBlockedModalVisible(true);
  }, []);

  const acknowledgeBlockedNotice = useCallback(() => {
    blockedNoticeAckRef.current = true;
    setBlockedModalVisible(false);
    runDeviceIntelligenceNavigateHome();
  }, []);

  const dismissUnblockModal = useCallback(() => {
    setUnblockModalVisible(false);
  }, []);

  const applyBlockedState = useCallback((nextBlocked, { showModal = false, showUnblockModal = false } = {}) => {
    const wasBlocked = blockedRef.current;
    blockedRef.current = nextBlocked;
    setBlocked(nextBlocked);
    if (nextBlocked) {
      setUnblockModalVisible(false);
      const newlyBlocked = !wasBlocked;
      if (newlyBlocked) blockedNoticeAckRef.current = false;
      if (showModal && (!blockedNoticeAckRef.current || newlyBlocked)) {
        setBlockedModalVisible(true);
      }
      return;
    }
    blockedNoticeAckRef.current = false;
    setBlockedModalVisible(false);
    if (wasBlocked && showUnblockModal) setUnblockModalVisible(true);
  }, []);

  useEffect(() => {
    setDeviceIntelligenceAccessState({ blocked, smartMonitorEnabled: smartMonitorRef.current, showBlockedModal });
  }, [blocked, showBlockedModal]);

  const refresh = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    try {
      const prev = await readDeviceIntelligenceLastStatus();
      const result = await registerDeviceIntelligence();
      smartMonitorRef.current = result.smartMonitorEnabled === true;
      setDeviceIntelligenceAccessState({
        blocked: result.status === 'blocked' || result.blocked === true,
        smartMonitorEnabled: smartMonitorRef.current,
        showBlockedModal,
      });
      if (result.status === 'blocked' || result.blocked === true) {
        const newlyBlocked = prev !== 'blocked' && !blockedRef.current;
        applyBlockedState(true, { showModal: newlyBlocked || !blockedNoticeAckRef.current });
        return;
      }
      if (result.status === 'active') {
        applyBlockedState(false, { showUnblockModal: result.explicitUnblock === true });
        return;
      }
      if (!result.ok && prev === 'blocked') {
        applyBlockedState(true, { showModal: !blockedNoticeAckRef.current });
      }
    } finally {
      runningRef.current = false;
      setReady(true);
    }
  }, [applyBlockedState, showBlockedModal]);

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
      acknowledgeBlockedNotice,
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
      acknowledgeBlockedNotice,
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
      acknowledgeBlockedNotice: () => {},
      dismissUnblockModal: () => {},
      refresh: async () => {},
      guardUsage: () => ({ ok: true }),
    };
  }
  return ctx;
}
