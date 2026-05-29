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
  'jailbreak_ios',
]);

export const SECURITY_BLOCK_MESSAGE =
  'Kifaa chako kimezuiwa kutumia Osmani TV kwa sababu mfumo wa usalama umebaini mabadiliko yasiyoruhusiwa kwenye simu au programu. Tafadhali wasiliana na huduma kwa wateja ili kifaa chako kikaguliwe na kufunguliwa.';

/** Poll security while the channel player is focused (ms). */
export const PLAYER_SECURITY_POLL_MS = 30000;

/**
 * @param {Array<{ risk_type?: string }> | null | undefined} signals
 * @returns {boolean}
 */
export function hasThreatSignals(signals) {
  const threatSet = new Set(THREAT_RISK_TYPES);
  return (signals ?? []).some((s) => threatSet.has(String(s?.risk_type ?? '').trim()));
}
