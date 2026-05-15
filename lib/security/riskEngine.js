/**
 * SAFE MODE risk scoring — additive signals, tiered enforcement.
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
  dev_client: 3,
  jailbreak_ios: 5,
};

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
 * @param {SecurityTier} tier
 * @param {'off' | 'warn' | 'enforce'} mode
 * @param {string | null | undefined} serverEnforcement
 */
export function resolveEnforcement(tier, mode, serverEnforcement) {
  const server = String(serverEnforcement ?? '').trim().toLowerCase();
  if (server === 'none' || server === 'off') {
    return { canPlay: true, showWarning: false, blockPlayback: false, limitedPlayback: false };
  }
  if (server === 'warn') {
    return { canPlay: true, showWarning: true, blockPlayback: false, limitedPlayback: false };
  }
  if (server === 'limit') {
    return { canPlay: true, showWarning: true, blockPlayback: false, limitedPlayback: true };
  }
  if (server === 'block') {
    return { canPlay: false, showWarning: true, blockPlayback: true, limitedPlayback: false };
  }

  if (mode === 'off') {
    return { canPlay: true, showWarning: false, blockPlayback: false, limitedPlayback: false };
  }
  if (mode === 'warn') {
    return {
      canPlay: true,
      showWarning: tier !== 'low',
      blockPlayback: false,
      limitedPlayback: tier === 'medium',
    };
  }

  switch (tier) {
    case 'critical':
      return { canPlay: false, showWarning: true, blockPlayback: true, limitedPlayback: false };
    case 'high':
      return { canPlay: false, showWarning: true, blockPlayback: true, limitedPlayback: false };
    case 'medium':
      return { canPlay: true, showWarning: true, blockPlayback: false, limitedPlayback: true };
    default:
      return {
        canPlay: true,
        showWarning: tier === 'low' && false,
        blockPlayback: false,
        limitedPlayback: false,
      };
  }
}
