import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import {
  DEFAULT_TRIAL_WATCH_SETTINGS,
  shouldApplyTrialWatch,
} from '../lib/trialWatchSettings.shared';
import {
  applyTrialWatchConsumption,
  loadTrialWatchState,
  resolveTrialWatchAllowance,
  saveTrialWatchState,
} from '../lib/trialWatchState';

const TICK_MS = 250;

/**
 * Non-subscriber trial / preview countdown while the player screen is focused.
 *
 * @param {{
 *   enabled: boolean;
 *   isSubscribed?: boolean;
 *   freeMode?: boolean;
 *   trialWatchSettings?: typeof DEFAULT_TRIAL_WATCH_SETTINGS;
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
  trialWatchSettings = DEFAULT_TRIAL_WATCH_SETTINGS,
  isPlaybackActive,
  stopPlayback,
  onExpired,
  navigation,
}) {
  const [remainingMs, setRemainingMs] = useState(0);
  const [phase, setPhase] = useState(/** @type {'trial'|'preview'|null} */ (null));
  const [ready, setReady] = useState(false);

  const stateRef = useRef(null);
  const sessionRemainingRef = useRef(0);
  const sessionPhaseRef = useRef(/** @type {'trial'|'preview'|null} */ (null));
  const lastTickAtRef = useRef(0);
  const expiredRef = useRef(false);
  const screenFocusedRef = useRef(false);
  const appActiveRef = useRef(AppState.currentState === 'active');
  const tickTimerRef = useRef(null);

  const active =
    enabled &&
    shouldApplyTrialWatch({ isSubscribed, freeMode, trialWatchSettings });

  const persistState = useCallback(async () => {
    if (!stateRef.current) return;
    await saveTrialWatchState(stateRef.current);
  }, []);

  const finishExpired = useCallback(
    async (reason) => {
      if (expiredRef.current) return;
      expiredRef.current = true;
      if (tickTimerRef.current) {
        clearInterval(tickTimerRef.current);
        tickTimerRef.current = null;
      }
      setRemainingMs(0);
      setPhase(null);
      await persistState();
      try {
        await stopPlayback();
      } catch {
        /* ignore */
      }
      try {
        navigation?.navigate?.('MainTabs', { screen: 'Home' });
      } catch {
        try {
          navigation?.goBack?.();
        } catch {
          /* ignore */
        }
      }
      try {
        onExpired?.(reason);
      } catch {
        /* ignore */
      }
    },
    [navigation, onExpired, persistState, stopPlayback],
  );

  const bootstrap = useCallback(async () => {
    if (!active) {
      setReady(true);
      setPhase(null);
      setRemainingMs(0);
      return;
    }
    const loaded = await loadTrialWatchState();
    stateRef.current = loaded;
    const allowance = resolveTrialWatchAllowance(loaded, trialWatchSettings);
    if (allowance.phase === 'blocked' || allowance.remainingMs <= 0) {
      setReady(true);
      setPhase(null);
      setRemainingMs(0);
      void finishExpired(loaded.trialExhausted ? 'preview' : 'trial');
      return;
    }
    sessionPhaseRef.current = allowance.phase;
    sessionRemainingRef.current = allowance.remainingMs;
    setPhase(allowance.phase);
    setRemainingMs(allowance.remainingMs);
    setReady(true);
    lastTickAtRef.current = Date.now();
  }, [active, finishExpired, trialWatchSettings]);

  useEffect(() => {
    expiredRef.current = false;
    setReady(false);
    void bootstrap();
  }, [bootstrap, trialWatchSettings?.trialMinutes, trialWatchSettings?.previewSeconds]);

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
        setRemainingMs(sessionRemainingRef.current);
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
        setRemainingMs(allowance.remainingMs);
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
  ]);

  return {
    active,
    ready,
    phase,
    remainingMs,
    visible: active && ready && (phase === 'trial' || phase === 'preview') && remainingMs > 0,
  };
}
