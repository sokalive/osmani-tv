import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import Constants from 'expo-constants';
import { reportSecurityDevice } from '../api/security';
import { setSecurityAccessSnapshot } from '../lib/deviceAccessSnapshot';
import { runDeviceAccessVerification } from '../lib/runDeviceAccessVerification';
import { isDeviceIntelligenceSmartMonitorEnabled } from '../lib/deviceIntelligenceAccess';
import { SECURITY_BLOCK_MESSAGE } from '../lib/security/constants';
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
  const [serverPlaybackAllowed, setServerPlaybackAllowed] = useState(null);
  const [serverSmartMonitorEnabled, setServerSmartMonitorEnabled] = useState(false);
  const scanRunning = useRef(false);

  const mode = useMemo(() => readSecurityMode(), []);

  const applyServerReport = useCallback((report) => {
    if (!report) return;
    if (typeof report.enforcement === 'string' && report.enforcement.trim()) {
      setServerEnforcement(report.enforcement.trim().toLowerCase());
    }
    if (report.playbackAllowed === false) {
      setServerPlaybackAllowed(false);
    } else if (report.playbackAllowed === true) {
      setServerPlaybackAllowed(true);
    }
    if (report.blocked === true && report.playbackAllowed !== true) {
      setServerPlaybackAllowed(false);
      setServerEnforcement((prev) => prev || 'block');
      setServerSmartMonitorEnabled(false);
    }
    if (report.smartMonitorEnabled === true && report.blocked !== true) {
      setServerSmartMonitorEnabled(true);
    } else if (report.smartMonitorEnabled === false || report.blocked === true) {
      setServerSmartMonitorEnabled(false);
    }
  }, []);

  const refresh = useCallback(async () => {
    if (scanRunning.current) return;
    scanRunning.current = true;
    const detected_at = new Date().toISOString();
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
        detected_at,
      });
      applyServerReport(report);
      setLoading(false);

      setSecurityAccessSnapshot({
        serverPlaybackAllowed: report.playbackAllowed ?? null,
        serverSecurityBlocked: report.securityBlocked ?? null,
        smartMonitorEnabled: report.smartMonitorEnabled === true,
        blockPlayback: resolveEnforcement({
          signals: scan.signals,
          mode,
          serverEnforcement: report.enforcement ?? null,
          serverPlaybackAllowed: report.playbackAllowed ?? null,
          smartMonitorEnabled:
            report.smartMonitorEnabled === true || isDeviceIntelligenceSmartMonitorEnabled(),
        }).blockPlayback,
        signals: scan.signals,
        serverEnforcement: report.enforcement ?? null,
      });

      runDeviceAccessVerification({ tag: 'security-refresh' });
    } catch (err) {
      if (__DEV__) {
        console.log('[security] scan failed:', String(err));
      }
      setLoading(false);
    } finally {
      scanRunning.current = false;
    }
  }, [applyServerReport, mode]);

  useEffect(() => {
    void refresh();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refresh();
    });
    return () => sub.remove();
  }, [refresh]);

  const enforcement = useMemo(
    () =>
      resolveEnforcement({
        signals,
        tier,
        mode,
        serverEnforcement,
        serverPlaybackAllowed,
        smartMonitorEnabled:
          serverSmartMonitorEnabled || isDeviceIntelligenceSmartMonitorEnabled(),
      }),
    [signals, tier, mode, serverEnforcement, serverPlaybackAllowed, serverSmartMonitorEnabled],
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
      serverPlaybackAllowed,
      ...enforcement,
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
      serverPlaybackAllowed,
      enforcement,
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
      serverPlaybackAllowed: null,
      refresh: async () => {},
    };
  }
  return ctx;
}

/**
 * @returns {{ allowed: boolean; message: string; tier: string; score: number }}
 */
export function usePlaybackSecurityGate() {
  const { canPlay, blockPlayback, tier, score } = useSecurity();

  if (blockPlayback || canPlay === false) {
    return {
      allowed: false,
      message: SECURITY_BLOCK_MESSAGE,
      tier,
      score,
      showWarning: false,
      limitedPlayback: false,
    };
  }

  return {
    allowed: true,
    message: '',
    tier,
    score,
    showWarning: false,
    limitedPlayback: false,
  };
}

export function assertPlaybackAllowed(security) {
  if (!security) return { ok: true };
  if (security.blockPlayback || security.canPlay === false) {
    return { ok: false, message: SECURITY_BLOCK_MESSAGE };
  }
  return { ok: true };
}
