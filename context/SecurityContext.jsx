import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import Constants from 'expo-constants';
import { reportSecurityDevice } from '../api/security';
import { setSecurityAccessSnapshot } from '../lib/deviceAccessSnapshot';
import { runDeviceAccessVerification } from '../lib/runDeviceAccessVerification';
import {
  getDeviceIntelligenceAccessVersion,
  isDeviceIntelligenceSmartMonitorEnabled,
  registerSecurityAccessRefresh,
  subscribeDeviceIntelligenceAccess,
  getLastDeviceIntelligenceResult,
} from '../lib/deviceIntelligenceAccess';
import { loadPersistedSecurityReportSnapshot } from '../lib/lastSecurityReportSnapshot';
import { parseServerIntelAccess } from '../lib/serverIntelAccess';
import { SECURITY_BLOCK_MESSAGE } from '../lib/security/constants';
import { resolveEnforcement, tierFromScore } from '../lib/security/riskEngine';
import { logSecurityEnforcement } from '../lib/securityEnforcementLog';
import { runRuntimeSecurityScan } from '../lib/security/runtimeScan';
import { deriveVerificationState } from '../lib/security/verificationState';

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
  const [serverSecurityBlocked, setServerSecurityBlocked] = useState(null);
  const [serverSmartMonitorEnabled, setServerSmartMonitorEnabled] = useState(false);
  const [trustState, setTrustState] = useState(null);
  const [verificationFresh, setVerificationFresh] = useState(null);
  const [challengeValid, setChallengeValid] = useState(null);
  const [everSevere, setEverSevere] = useState(false);
  const [serverCalculatedScore, setServerCalculatedScore] = useState(null);
  const [lastReportOk, setLastReportOk] = useState(null);
  const [lastErrorCode, setLastErrorCode] = useState(null);
  const scanRunning = useRef(false);
  const intelAccessVersion = useSyncExternalStore(
    subscribeDeviceIntelligenceAccess,
    getDeviceIntelligenceAccessVersion,
    () => 0,
  );

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
    if (report.securityBlocked === true) {
      setServerSecurityBlocked(true);
      setServerPlaybackAllowed(false);
      setServerSmartMonitorEnabled(false);
    } else if (report.securityBlocked === false) {
      setServerSecurityBlocked(false);
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
    if (typeof report.trustState === 'string' && report.trustState.trim()) {
      setTrustState(report.trustState.trim().toLowerCase());
    }
    if (report.verificationFresh === true || report.verificationFresh === false) {
      setVerificationFresh(report.verificationFresh);
    }
    if (report.challengeValid === true || report.challengeValid === false) {
      setChallengeValid(report.challengeValid);
    }
    if (report.everSevere === true) {
      setEverSevere(true);
    } else if (report.everSevere === false && report.ok === true) {
      // Only clear everSevere when server explicitly returns false on a successful report.
      setEverSevere(false);
    }
    if (typeof report.serverCalculatedScore === 'number' && Number.isFinite(report.serverCalculatedScore)) {
      setServerCalculatedScore(report.serverCalculatedScore);
      setScore(report.serverCalculatedScore);
      setTier(tierFromScore(report.serverCalculatedScore));
    }
  }, []);

  const applyHydratedPolicy = useCallback((cached) => {
    if (!cached || !(cached.at > 0)) return;
    if (cached.serverPlaybackAllowed === true) setServerPlaybackAllowed(true);
    else if (cached.serverPlaybackAllowed === false) setServerPlaybackAllowed(false);
    if (cached.serverSecurityBlocked === true) setServerSecurityBlocked(true);
    else if (cached.serverSecurityBlocked === false) setServerSecurityBlocked(false);
    if (cached.smartMonitorEnabled === true) setServerSmartMonitorEnabled(true);
    if (typeof cached.enforcement === 'string' && cached.enforcement.trim()) {
      setServerEnforcement(cached.enforcement.trim().toLowerCase());
    }
    if (typeof cached.trustState === 'string') setTrustState(cached.trustState);
    if (cached.verificationFresh === true || cached.verificationFresh === false) {
      setVerificationFresh(cached.verificationFresh);
    }
    if (cached.challengeValid === true || cached.challengeValid === false) {
      setChallengeValid(cached.challengeValid);
    }
    if (cached.everSevere === true) setEverSevere(true);
    if (typeof cached.serverCalculatedScore === 'number') {
      setServerCalculatedScore(cached.serverCalculatedScore);
      setScore(cached.serverCalculatedScore);
      setTier(tierFromScore(cached.serverCalculatedScore));
    }
  }, []);

  const refresh = useCallback(async () => {
    if (scanRunning.current) return;
    scanRunning.current = true;
    const detected_at = new Date().toISOString();
    setLastErrorCode(null);
    try {
      const scan = await runRuntimeSecurityScan();

      const report = await reportSecurityDevice({
        signals: scan.signals,
        risk_score: scan.score,
        details: scan.details,
        detected_at,
      });
      applyServerReport(report);
      setLastReportOk(report?.ok === true);
      if (report?.ok !== true) {
        setLastErrorCode(report?.errorCode ?? 'report_failed');
      }

      // Prefer server score; fall back to local scan score for display only.
      if (!(typeof report?.serverCalculatedScore === 'number')) {
        setScore(scan.score);
        setTier(scan.tier);
      }
      setSignals(scan.signals);
      setDetails(scan.details);
      setLoading(false);

      const intel = parseServerIntelAccess(getLastDeviceIntelligenceResult()?.raw);
      const smartMonitor =
        report.smartMonitorEnabled === true ||
        isDeviceIntelligenceSmartMonitorEnabled() ||
        intel.smartMonitorEnabled === true;

      // Successful reports are authoritative for everSevere; failures keep prior latch.
      const ever =
        report.ok === true ? report.everSevere === true : everSevere === true || report.everSevere === true;

      const blockPlayback = resolveEnforcement({
        signals: scan.signals,
        mode,
        serverEnforcement: report.enforcement ?? null,
        serverPlaybackAllowed: report.playbackAllowed ?? null,
        serverSecurityBlocked: report.securityBlocked ?? null,
        smartMonitorEnabled: smartMonitor,
        intelAccessOpen: intel.serverIntelOpen,
        everSevere: ever,
        verificationFresh: report.verificationFresh ?? null,
        trustState: report.trustState ?? null,
        verifying: false,
      });

      logSecurityEnforcement({
        allowed: !blockPlayback.blockPlayback,
        enforcementReason: blockPlayback.enforcementReason,
        enforcementTrigger: blockPlayback.enforcementTrigger,
        tag: 'security-refresh',
      });

      setSecurityAccessSnapshot({
        serverPlaybackAllowed: report.playbackAllowed ?? null,
        serverSecurityBlocked: report.securityBlocked ?? null,
        smartMonitorEnabled: smartMonitor,
        blockPlayback: blockPlayback.blockPlayback,
        signals: scan.signals,
        serverEnforcement: report.enforcement ?? null,
        enforcementReason: blockPlayback.enforcementReason,
        enforcementTrigger: blockPlayback.enforcementTrigger,
        everSevere: ever,
        trustState: report.trustState ?? null,
        verificationFresh: report.verificationFresh ?? null,
      });

      runDeviceAccessVerification({ tag: 'security-refresh' });
    } catch (err) {
      if (__DEV__ || process.env.EXPO_PUBLIC_SECURITY_STARTUP_LOGS === '1') {
        console.log('[security] scan failed:', String(err));
      }
      setLastReportOk(false);
      setLastErrorCode('scan_failed');
      setLoading(false);
    } finally {
      scanRunning.current = false;
    }
  }, [applyServerReport, mode, everSevere]);

  useEffect(() => {
    registerSecurityAccessRefresh(refresh);
    return () => registerSecurityAccessRefresh(null);
  }, [refresh]);

  useEffect(() => {
    void (async () => {
      const cached = await loadPersistedSecurityReportSnapshot();
      applyHydratedPolicy(cached);
    })();
  }, [applyHydratedPolicy]);

  useEffect(() => {
    void refresh();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refresh();
    });
    return () => sub.remove();
  }, [refresh]);

  const enforcement = useMemo(() => {
    const intel = parseServerIntelAccess(getLastDeviceIntelligenceResult()?.raw);
    return resolveEnforcement({
      signals,
      tier,
      mode,
      serverEnforcement,
      serverPlaybackAllowed,
      serverSecurityBlocked,
      smartMonitorEnabled:
        serverSmartMonitorEnabled || isDeviceIntelligenceSmartMonitorEnabled() || intel.smartMonitorEnabled,
      intelAccessOpen: intel.serverIntelOpen,
      everSevere,
      verificationFresh,
      trustState,
      verifying: loading,
    });
  }, [
    signals,
    tier,
    mode,
    serverEnforcement,
    serverPlaybackAllowed,
    serverSecurityBlocked,
    serverSmartMonitorEnabled,
    intelAccessVersion,
    everSevere,
    verificationFresh,
    trustState,
    loading,
  ]);

  const verificationState = useMemo(
    () =>
      deriveVerificationState({
        loading,
        reportOk: lastReportOk,
        trustState,
        verificationFresh,
        challengeValid,
        everSevere,
        serverPlaybackAllowed,
        serverSecurityBlocked,
        blockPlayback: enforcement.blockPlayback,
        errorCode: lastErrorCode,
      }),
    [
      loading,
      lastReportOk,
      trustState,
      verificationFresh,
      challengeValid,
      everSevere,
      serverPlaybackAllowed,
      serverSecurityBlocked,
      enforcement.blockPlayback,
      lastErrorCode,
    ],
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
      serverSecurityBlocked,
      trustState,
      verificationFresh,
      challengeValid,
      everSevere,
      serverCalculatedScore,
      verificationState,
      lastErrorCode,
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
      serverSecurityBlocked,
      trustState,
      verificationFresh,
      challengeValid,
      everSevere,
      serverCalculatedScore,
      verificationState,
      lastErrorCode,
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
      verificationState: 'unknown',
      everSevere: false,
      refresh: async () => {},
    };
  }
  return ctx;
}

export function usePlaybackSecurityGate() {
  const { canPlay, blockPlayback, tier, score, verificationState, everSevere, serverPlaybackAllowed } =
    useSecurity();

  /**
   * Protected playback must not proceed as "safe" when verification is unknown
   * after a severe history, or when server has denied.
   */
  const denyUnknownSevere =
    everSevere === true &&
    serverPlaybackAllowed !== true &&
    (verificationState === 'unknown' || verificationState === 'verifying' || verificationState === 'degraded');

  if (blockPlayback || canPlay === false || denyUnknownSevere) {
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
    logSecurityEnforcement({
      allowed: false,
      enforcementReason: security.enforcementReason ?? 'local_threat',
      enforcementTrigger: security.enforcementTrigger ?? null,
      tag: 'playback-gate',
    });
    return { ok: false, message: SECURITY_BLOCK_MESSAGE };
  }
  if (
    security.everSevere === true &&
    security.serverPlaybackAllowed !== true &&
    (security.verificationState === 'unknown' ||
      security.verificationState === 'verifying' ||
      security.verificationState === 'degraded' ||
      security.verificationState === 'blocked' ||
      security.verificationState === 'suspicious')
  ) {
    logSecurityEnforcement({
      allowed: false,
      enforcementReason: 'ever_severe_stale',
      enforcementTrigger: 'ever_severe',
      tag: 'playback-gate',
    });
    return { ok: false, message: SECURITY_BLOCK_MESSAGE };
  }
  if (
    security.enforcementReason &&
    security.enforcementReason !== 'default_allowed'
  ) {
    logSecurityEnforcement({
      allowed: true,
      enforcementReason: security.enforcementReason,
      enforcementTrigger: security.enforcementTrigger ?? null,
      tag: 'playback-gate',
    });
  }
  return { ok: true };
}
