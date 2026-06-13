import { hasThreatSignals } from './constants';

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

const BLOCKED = Object.freeze({
  canPlay: false,
  showWarning: false,
  blockPlayback: true,
  limitedPlayback: false,
});

const ALLOWED = Object.freeze({
  canPlay: true,
  showWarning: false,
  blockPlayback: false,
  limitedPlayback: false,
});

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
  } = args ?? {};

  if (serverPlaybackAllowed === false) return BLOCKED;

  if (serverSecurityBlocked === true) return BLOCKED;

  const server = String(serverEnforcement ?? '').trim().toLowerCase();
  if (server === 'block') return BLOCKED;

  /** Backend Smart Monitor / admin override: trust server playbackAllowed over local scan. */
  if (serverPlaybackAllowed === true) return ALLOWED;

  if (smartMonitorEnabled === true) return ALLOWED;

  /** Intel open + no explicit server deny: do not block locally while awaiting security report. */
  if (intelAccessOpen === true && serverPlaybackAllowed !== false && serverSecurityBlocked !== true) {
    return ALLOWED;
  }

  if (hasThreatSignals(signals)) return BLOCKED;

  if (server === 'none' || server === 'off') return ALLOWED;
  if (mode === 'off') return ALLOWED;

  return ALLOWED;
}
