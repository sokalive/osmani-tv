import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, InteractionManager } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import {
  TRIAL_WATCH_FAIL_CLOSED,
  shouldApplyTrialWatch,
} from '../lib/trialWatchSettings.shared';
import {
  applyTrialWatchConsumption,
  loadTrialWatchState,
  resolveTrialWatchAllowance,
  saveTrialWatchState,
} from '../lib/trialWatchState';

const TICK_MS = 250;
const PAYMENT_MODAL_DELAY_MS = 480;

function secondsFromMs(ms) {
  return Math.max(0, Math.ceil(ms / 1000));
}

/**
 * @param {{
 *   enabled: boolean;
 *   isSubscribed?: boolean;
 *   freeMode?: boolean;
 *   trialWatchSettings?: typeof DEFAULT_TRIAL_WATCH_SETTINGS;
 *   initialBootstrap?: { phase: 'trial' | 'preview'; remainingMs: number } | null;
 *   playbackKey?: string;
 *   isPlaybackActive: boolean;
 *   stopPlayback: () => void | Promise<void>;
 *   onExpired: (reason: 'trial' | 'preview') => void;
 *   navigation: { goBack?: () => void; navigate?: (name: string, params?: object) => void };
 * }} options
 */
export function useTrialWatchSession({
  enabled,
  isSubscribed = false,
  freeMode = false,
  trialWatchSettings = TRIAL_WATCH_FAIL_CLOSED,
  initialBootstrap = null,
  playbackKey = '',
  isPlaybackActive,
  stopPlayback,
  onExpired,
  navigation,
}) {
  const boot =
    enabled &&
    initialBootstrap?.phase &&
    (initialBootstrap.phase === 'trial' || initialBootstrap.phase === 'preview') &&
    initialBootstrap.remainingMs > 0
      ? initialBootstrap
      : null;
  const [phase, setPhase] = useState(
    boot?.phase === 'trial' || boot?.phase === 'preview' ? boot.phase : null,
  );
  const [displaySeconds, setDisplaySeconds] = useState(() =>
    secondsFromMs(boot?.remainingMs ?? 0),
  );
  const [ready, setReady] = useState(!enabled || Boolean(boot));

  const stateRef = useRef(null);
  const sessionRemainingRef = useRef(boot?.remainingMs ?? 0);
  const sessionPhaseRef = useRef(
    boot?.phase === 'trial' || boot?.phase === 'preview' ? boot.phase : null,
  );
  const displaySecondsRef = useRef(secondsFromMs(boot?.remainingMs ?? 0));
  const lastTickAtRef = useRef(Date.now());
  const expiredRef = useRef(false);
  const screenFocusedRef = useRef(false);
  const appActiveRef = useRef(AppState.currentState === 'active');
  const tickTimerRef = useRef(null);
  const paymentDelayRef = useRef(null);

  const active =
    enabled &&
    shouldApplyTrialWatch({ isSubscribed, freeMode, trialWatchSettings });

  const syncDisplaySeconds = useCallback((remainingMs) => {
    const next = secondsFromMs(remainingMs);
    if (next === displaySecondsRef.current) return;
    displaySecondsRef.current = next;
    setDisplaySeconds(next);
  }, []);

  const persistState = useCallback(async () => {
    if (!stateRef.current) return;
    await saveTrialWatchState(stateRef.current);
  }, []);

  const schedulePaymentModal = useCallback(
    (reason) => {
      if (paymentDelayRef.current) clearTimeout(paymentDelayRef.current);
      paymentDelayRef.current = setTimeout(() => {
        paymentDelayRef.current = null;
        try {
          onExpired?.(reason);
        } catch {
          /* ignore */
        }
      }, PAYMENT_MODAL_DELAY_MS);
    },
    [onExpired],
  );

  const finishExpired = useCallback(
    async (reason) => {
      if (expiredRef.current) return;
      expiredRef.current = true;
      if (tickTimerRef.current) {
        clearInterval(tickTimerRef.current);
        tickTimerRef.current = null;
      }
      displaySecondsRef.current = 0;
      setDisplaySeconds(0);
      setPhase(null);
      await persistState();
      try {
        await stopPlayback();
      } catch {
        /* ignore */
      }
      InteractionManager.runAfterInteractions(() => {
        try {
          navigation?.navigate?.('MainTabs', { screen: 'Home' });
        } catch {
          try {
            navigation?.goBack?.();
          } catch {
            /* ignore */
          }
        }
        schedulePaymentModal(reason);
      });
    },
    [navigation, persistState, schedulePaymentModal, stopPlayback],
  );

  const applyAllowanceToSession = useCallback(
    (allowance) => {
      sessionPhaseRef.current = allowance.phase;
      sessionRemainingRef.current = allowance.remainingMs;
      setPhase(allowance.phase);
      syncDisplaySeconds(allowance.remainingMs);
    },
    [syncDisplaySeconds],
  );

  const bootstrap = useCallback(async () => {
    if (!active) {
      setReady(true);
      setPhase(null);
      displaySecondsRef.current = 0;
      setDisplaySeconds(0);
      return;
    }

    if (boot?.phase && boot.remainingMs > 0) {
      sessionPhaseRef.current = boot.phase;
      sessionRemainingRef.current = boot.remainingMs;
      setPhase(boot.phase);
      syncDisplaySeconds(boot.remainingMs);
      setReady(true);
      lastTickAtRef.current = Date.now();
    }

    const loaded = await loadTrialWatchState();
    stateRef.current = loaded;
    const allowance = resolveTrialWatchAllowance(loaded, trialWatchSettings);

    if (allowance.phase === 'blocked') {
      if (boot?.phase && boot.remainingMs > 0) {
        setReady(true);
        lastTickAtRef.current = Date.now();
        return;
      }
      setReady(true);
      setPhase(null);
      displaySecondsRef.current = 0;
      setDisplaySeconds(0);
      void finishExpired(loaded.trialExhausted ? 'preview' : 'trial');
      return;
    }

    applyAllowanceToSession(allowance);
    setReady(true);
    lastTickAtRef.current = Date.now();
  }, [active, applyAllowanceToSession, boot, finishExpired, syncDisplaySeconds, trialWatchSettings]);

  useEffect(() => {
    expiredRef.current = false;
    if (tickTimerRef.current) {
      clearInterval(tickTimerRef.current);
      tickTimerRef.current = null;
    }
    if (!active) {
      sessionPhaseRef.current = null;
      sessionRemainingRef.current = 0;
      displaySecondsRef.current = 0;
      setPhase(null);
      setDisplaySeconds(0);
      setReady(true);
      return undefined;
    }
    if (!boot) setReady(false);
    void bootstrap();
    return () => {
      if (paymentDelayRef.current) clearTimeout(paymentDelayRef.current);
    };
  }, [
    active,
    bootstrap,
    boot,
    playbackKey,
    trialWatchSettings?.trialMinutes,
    trialWatchSettings?.previewSeconds,
  ]);

  useFocusEffect(
    useCallback(() => {
      screenFocusedRef.current = true;
      lastTickAtRef.current = Date.now();
      return () => {
        screenFocusedRef.current = false;
        void persistState();
      };
    }, [persistState]),
  );

  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      appActiveRef.current = next === 'active';
      if (next !== 'active') {
        void persistState();
      } else {
        lastTickAtRef.current = Date.now();
      }
    });
    return () => sub.remove();
  }, [persistState]);

  useEffect(() => {
    if (!active || !ready) return undefined;

    tickTimerRef.current = setInterval(() => {
      if (expiredRef.current) return;
      if (!screenFocusedRef.current || !appActiveRef.current) {
        lastTickAtRef.current = Date.now();
        return;
      }
      if (!isPlaybackActive) {
        lastTickAtRef.current = Date.now();
        return;
      }

      const now = Date.now();
      const delta = Math.max(0, now - (lastTickAtRef.current || now));
      lastTickAtRef.current = now;

      if (sessionPhaseRef.current === 'preview') {
        sessionRemainingRef.current = Math.max(0, sessionRemainingRef.current - delta);
        syncDisplaySeconds(sessionRemainingRef.current);
        if (sessionRemainingRef.current <= 0) {
          void finishExpired('preview');
        }
        return;
      }

      if (sessionPhaseRef.current === 'trial' && stateRef.current) {
        stateRef.current = applyTrialWatchConsumption(
          stateRef.current,
          delta,
          trialWatchSettings,
        );
        const allowance = resolveTrialWatchAllowance(stateRef.current, trialWatchSettings);
        sessionRemainingRef.current = allowance.remainingMs;
        syncDisplaySeconds(allowance.remainingMs);
        if (allowance.phase === 'preview') {
          sessionPhaseRef.current = 'preview';
          sessionRemainingRef.current = allowance.remainingMs;
          setPhase('preview');
        } else if (allowance.remainingMs <= 0) {
          void finishExpired('trial');
        }
      }
    }, TICK_MS);

    return () => {
      if (tickTimerRef.current) {
        clearInterval(tickTimerRef.current);
        tickTimerRef.current = null;
      }
      void persistState();
    };
  }, [
    active,
    ready,
    isPlaybackActive,
    trialWatchSettings,
    finishExpired,
    persistState,
    syncDisplaySeconds,
  ]);

  const showOverlay =
    active &&
    (phase === 'trial' || phase === 'preview') &&
    displaySeconds > 0 &&
    (ready || Boolean(boot));

  return {
    active,
    ready,
    phase,
    displaySeconds,
    visible: showOverlay,
  };
}
