import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import Constants from 'expo-constants';
import { reportSecurityDevice } from '../api/security';
import { resolveEnforcement } from '../lib/security/riskEngine';
import { runRuntimeSecurityScan } from '../lib/security/runtimeScan';

const SecurityContext = createContext(null);

function readSecurityMode() {
  try {
    const extra = Constants.expoConfig?.extra ?? {};
    const v = extra.securityEnforcement ?? process.env.EXPO_PUBLIC_SECURITY_ENFORCEMENT ?? 'enforce';
    const mode = String(v).trim().toLowerCase();
    if (mode === 'off' || mode === 'warn' || mode === 'enforce') return mode;
    return 'enforce';
  } catch {
    return 'enforce';
  }
}

export function SecurityProvider({ children }) {
  const [loading, setLoading] = useState(true);
  const [score, setScore] = useState(0);
  const [tier, setTier] = useState('low');
  const [signals, setSignals] = useState([]);
  const [details, setDetails] = useState({});
  const [serverEnforcement, setServerEnforcement] = useState(null);
  const [warningDismissed, setWarningDismissed] = useState(false);
  const scanRunning = useRef(false);

  const mode = useMemo(() => readSecurityMode(), []);

  const refresh = useCallback(async () => {
    if (scanRunning.current) return;
    scanRunning.current = true;
    try {
      const scan = await runRuntimeSecurityScan();
      setScore(scan.score);
      setTier(scan.tier);
      setSignals(scan.signals);
      setDetails(scan.details);

      const report = await reportSecurityDevice({
        signals: scan.signals,
        risk_score: scan.score,
        details: scan.details,
      });
      if (report?.enforcement) {
        setServerEnforcement(report.enforcement);
      }
    } catch (err) {
      if (__DEV__) {
        console.log('[security] scan failed:', String(err));
      }
    } finally {
      setLoading(false);
      scanRunning.current = false;
    }
  }, []);

  useEffect(() => {
    void refresh();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refresh();
    });
    return () => sub.remove();
  }, [refresh]);

  const enforcement = useMemo(
    () => resolveEnforcement(tier, mode, serverEnforcement),
    [tier, mode, serverEnforcement],
  );

  const value = useMemo(
    () => ({
      loading,
      score,
      tier,
      signals,
      details,
      mode,
      serverEnforcement,
      ...enforcement,
      warningDismissed,
      dismissWarning: () => setWarningDismissed(true),
      refresh,
    }),
    [
      loading,
      score,
      tier,
      signals,
      details,
      mode,
      serverEnforcement,
      enforcement,
      warningDismissed,
      refresh,
    ],
  );

  return <SecurityContext.Provider value={value}>{children}</SecurityContext.Provider>;
}

export function useSecurity() {
  const ctx = useContext(SecurityContext);
  if (!ctx) {
    return {
      loading: false,
      score: 0,
      tier: 'low',
      signals: [],
      canPlay: true,
      showWarning: false,
      blockPlayback: false,
      limitedPlayback: false,
      warningDismissed: true,
      dismissWarning: () => {},
      refresh: async () => {},
    };
  }
  return ctx;
}

/**
 * @returns {{ allowed: boolean; message: string; tier: string; score: number }}
 */
export function usePlaybackSecurityGate() {
  const { loading, canPlay, blockPlayback, tier, score, showWarning, limitedPlayback } = useSecurity();

  if (loading || canPlay !== false && !blockPlayback) {
    return {
      allowed: true,
      message: '',
      tier,
      score,
      showWarning,
      limitedPlayback,
    };
  }

  return {
    allowed: false,
    message:
      'Kifaa chako kimegunduliwa na hatari ya usalama. Tafadhali wasiliana na msaada wa Osmani TV ili kuendelea kutazama.',
    tier,
    score,
    showWarning: true,
    limitedPlayback: false,
  };
}

export function assertPlaybackAllowed(security) {
  if (!security) return { ok: true };
  if (security.loading) return { ok: true };
  if (security.blockPlayback || security.canPlay === false) {
    return {
      ok: false,
      message:
        'Uchezaji umezuiwa kwa muda kwa sababu ya usalama wa kifaa. Wasiliana na msaada wa Osmani TV.',
    };
  }
  return { ok: true };
}
