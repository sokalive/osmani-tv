/** Zero-tolerance threat signals — any one triggers immediate playback block. */
export const THREAT_RISK_TYPES = Object.freeze([
  'root_detected',
  'emulator_detected',
  'clone_detected',
  'frida_detected',
  'debugger_attached',
  'debug_detected',
  'hook_detected',
  'resigned_apk',
  'invalid_signature',
  'package_mismatch',
  'tampered_apk',
  'jailbreak_ios',
]);

export const SECURITY_BLOCK_MESSAGE =
  'Kifaa chako kimezuiwa kutumia Osmani TV kwa sababu mfumo wa usalama umebaini mabadiliko yasiyoruhusiwa kwenye simu au programu. Tafadhali wasiliana na huduma kwa wateja ili kifaa chako kikaguliwe na kufunguliwa.';

/** Poll security while the channel player is focused (ms). */
export const PLAYER_SECURITY_POLL_MS = 30000;

/** ROOT / emulator signals eligible for Smart Monitor (server may allow while monitoring). */
export const MONITORABLE_THREAT_TYPES = Object.freeze([
  'root_detected',
  'emulator_detected',
  'jailbreak_ios',
]);

/**
 * @param {Array<{ risk_type?: string }> | null | undefined} signals
 * @returns {boolean}
 */
export function hasThreatSignals(signals) {
  const threatSet = new Set(THREAT_RISK_TYPES);
  return (signals ?? []).some((s) => threatSet.has(String(s?.risk_type ?? '').trim()));
}

/**
 * True when every detected threat is ROOT/emulator-only (Smart Monitor policy scope).
 *
 * @param {Array<{ risk_type?: string }> | null | undefined} signals
 * @returns {boolean}
 */
export function hasOnlyMonitorableThreats(signals) {
  const monitorable = new Set(MONITORABLE_THREAT_TYPES);
  const threatSet = new Set(THREAT_RISK_TYPES);
  let sawThreat = false;
  for (const s of signals ?? []) {
    const t = String(s?.risk_type ?? '').trim();
    if (!threatSet.has(t)) continue;
    sawThreat = true;
    if (!monitorable.has(t)) return false;
  }
  return sawThreat;
}

/**
 * @param {Array<{ risk_type?: string }> | null | undefined} signals
 * @returns {string | null}
 */
export function findPrimaryThreatSignal(signals) {
  const threatSet = new Set(THREAT_RISK_TYPES);
  for (const s of signals ?? []) {
    const t = String(s?.risk_type ?? '').trim();
    if (threatSet.has(t)) return t;
  }
  return null;
}
