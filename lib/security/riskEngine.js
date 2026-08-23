import {
  findPrimaryThreatSignal,
  hasThreatSignals,
} from './constants';

export const ENFORCEMENT_REASON = Object.freeze({
  SERVER_PLAYBACK_DENIED: 'server_playback_denied',
  SERVER_SECURITY_BLOCKED: 'server_security_blocked',
  SERVER_ENFORCEMENT_BLOCK: 'server_enforcement_block',
  SERVER_PLAYBACK_ALLOWED: 'server_playback_allowed',
  SMART_MONITOR: 'smart_monitor',
  INTEL_ACCESS_OPEN: 'intel_access_open',
  LOCAL_THREAT: 'local_threat',
  EVER_SEVERE_STALE: 'ever_severe_stale',
  VERIFICATION_UNKNOWN: 'verification_unknown',
  DEFAULT_ALLOWED: 'default_allowed',
});

/**
 * @typedef {'low' | 'medium' | 'high' | 'critical'} SecurityTier
 */

/** @type {Record<string, number>} */
export const RISK_WEIGHTS = {
  root_detected: 5,
  emulator_detected: 2,
  debug_detected: 4,
  debugger_attached: 6,
  frida_detected: 10,
  hook_detected: 7,
  clone_detected: 6,
  resigned_apk: 8,
  invalid_signature: 9,
  package_mismatch: 9,
  tampered_apk: 8,
  dev_client: 3,
  jailbreak_ios: 5,
};

/**
 * @param {boolean} blockPlayback
 * @param {string} enforcementReason
 * @param {string | null} [enforcementTrigger]
 */
function enforcementState(blockPlayback, enforcementReason, enforcementTrigger = null) {
  if (blockPlayback) {
    return {
      canPlay: false,
      showWarning: false,
      blockPlayback: true,
      limitedPlayback: false,
      enforcementReason,
      enforcementTrigger,
    };
  }
  return {
    canPlay: true,
    showWarning: false,
    blockPlayback: false,
    limitedPlayback: false,
    enforcementReason,
    enforcementTrigger,
  };
}

/**
 * @param {number} score
 * @returns {SecurityTier}
 */
export function tierFromScore(score) {
  if (score >= 18) return 'critical';
  if (score >= 10) return 'high';
  if (score >= 4) return 'medium';
  return 'low';
}

/**
 * @param {Array<{ risk_type: string; risk_score?: number }>} signals
 * @returns {{ score: number; signals: Array<{ risk_type: string; risk_score: number; detail?: string }>; tier: SecurityTier }}
 */
export function aggregateRiskSignals(signals) {
  const merged = [];
  let score = 0;
  const seen = new Set();
  for (const raw of signals ?? []) {
    const risk_type = String(raw?.risk_type ?? '').trim();
    if (!risk_type || seen.has(risk_type)) continue;
    seen.add(risk_type);
    const weight = RISK_WEIGHTS[risk_type];
    const risk_score =
      typeof raw?.risk_score === 'number' && Number.isFinite(raw.risk_score)
        ? raw.risk_score
        : typeof weight === 'number'
          ? weight
          : 1;
    score += risk_score;
    merged.push({
      risk_type,
      risk_score,
      ...(raw?.detail != null ? { detail: String(raw.detail) } : {}),
    });
  }
  return { score, signals: merged, tier: tierFromScore(score) };
}

/**
 * Strict zero-tolerance enforcement — any threat or server block stops playback.
 * No warn/limited stages for security threats.
 *
 * @param {{
 *   signals?: Array<{ risk_type?: string }>;
 *   tier?: SecurityTier;
 *   mode?: 'off' | 'warn' | 'enforce';
 *   serverEnforcement?: string | null;
 *   serverPlaybackAllowed?: boolean | null;
 *   smartMonitorEnabled?: boolean;
 *   intelAccessOpen?: boolean;
 *   serverSecurityBlocked?: boolean | null;
 *   everSevere?: boolean;
 *   verificationFresh?: boolean | null;
 *   trustState?: string | null;
 *   verifying?: boolean;
 * }} args
 */
export function resolveEnforcement(args) {
  const {
    signals = [],
    mode = 'enforce',
    serverEnforcement = null,
    serverPlaybackAllowed = null,
    smartMonitorEnabled = false,
    intelAccessOpen = false,
    serverSecurityBlocked = null,
    everSevere = false,
    verificationFresh = null,
    trustState = null,
    verifying = false,
  } = args ?? {};

  /** Server DENY is absolute — never locally override into ALLOW. */
  if (serverPlaybackAllowed === false) {
    return enforcementState(true, ENFORCEMENT_REASON.SERVER_PLAYBACK_DENIED, 'server_playback_allowed');
  }

  if (serverSecurityBlocked === true) {
    return enforcementState(true, ENFORCEMENT_REASON.SERVER_SECURITY_BLOCKED, 'security_blocked');
  }

  const server = String(serverEnforcement ?? '').trim().toLowerCase();
  if (server === 'block') {
    return enforcementState(true, ENFORCEMENT_REASON.SERVER_ENFORCEMENT_BLOCK, 'enforcement_block');
  }

  const trust = String(trustState ?? '').trim().toLowerCase();
  if (trust === 'blocked') {
    return enforcementState(true, ENFORCEMENT_REASON.SERVER_SECURITY_BLOCKED, 'trust_blocked');
  }

  /**
   * Severe history without a fresh server ALLOW must not silently become trusted
   * from a clean local scan or missing verification.
   */
  if (everSevere === true && serverPlaybackAllowed !== true) {
    if (verificationFresh !== true) {
      return enforcementState(true, ENFORCEMENT_REASON.EVER_SEVERE_STALE, 'ever_severe');
    }
  }

  /** Backend Smart Monitor / admin override: trust server playbackAllowed over local scan. */
  if (serverPlaybackAllowed === true) {
    const trigger = findPrimaryThreatSignal(signals);
    return enforcementState(
      false,
      ENFORCEMENT_REASON.SERVER_PLAYBACK_ALLOWED,
      trigger ?? 'server_playback_allowed',
    );
  }

  if (smartMonitorEnabled === true) {
    const trigger = findPrimaryThreatSignal(signals);
    return enforcementState(false, ENFORCEMENT_REASON.SMART_MONITOR, trigger ?? 'smart_monitor');
  }

  /**
   * While a verification is in-flight with no prior allow and active local threats,
   * keep local zero-tolerance (do not open protected playback as "safe").
   */
  if (verifying === true && hasThreatSignals(signals) && serverPlaybackAllowed == null) {
    const trigger = findPrimaryThreatSignal(signals);
    return enforcementState(true, ENFORCEMENT_REASON.LOCAL_THREAT, trigger);
  }

  /** Intel open + no explicit server deny: do not block locally while awaiting security report. */
  if (intelAccessOpen === true && serverPlaybackAllowed !== false && serverSecurityBlocked !== true) {
    if (everSevere === true) {
      return enforcementState(true, ENFORCEMENT_REASON.EVER_SEVERE_STALE, 'ever_severe_intel');
    }
    const trigger = findPrimaryThreatSignal(signals);
    return enforcementState(false, ENFORCEMENT_REASON.INTEL_ACCESS_OPEN, trigger ?? 'intel_open');
  }

  if (hasThreatSignals(signals)) {
    const trigger = findPrimaryThreatSignal(signals);
    return enforcementState(true, ENFORCEMENT_REASON.LOCAL_THREAT, trigger);
  }

  if (server === 'none' || server === 'off') {
    return enforcementState(false, ENFORCEMENT_REASON.DEFAULT_ALLOWED, server || 'enforcement_off');
  }
  if (mode === 'off') {
    return enforcementState(false, ENFORCEMENT_REASON.DEFAULT_ALLOWED, 'mode_off');
  }

  return enforcementState(false, ENFORCEMENT_REASON.DEFAULT_ALLOWED, null);
}
