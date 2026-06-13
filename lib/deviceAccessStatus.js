import { hasThreatSignals } from './security/constants';

/** Admin-readable access state (Swahili). */
export const DEVICE_ACCESS_STATE = Object.freeze({
  OPEN: 'Kifaa Kimefunguliwa',
  BLOCKED: 'Kifaa Bado Kimefungwa',
});

/** Admin-readable block / allow reason (Swahili). */
export const DEVICE_ACCESS_REASON = Object.freeze({
  ADMIN_UNBLOCK: 'Kimefunguliwa na Admin',
  SMART_MONITOR: 'Smart Monitor Inatumika',
  ADMIN_BLOCK: 'Kimefungwa na Admin',
  ROOT: 'Root Imegunduliwa',
  EMULATOR: 'Emulator Imegunduliwa',
  TAMPERED_APK: 'APK Imeharibiwa',
  FRIDA: 'Frida Imegunduliwa',
  DEBUGGER: 'Debugger Imegunduliwa',
  HOOK: 'Hook Imegunduliwa',
  CLONE: 'Clone Imegunduliwa',
  SIGNATURE: 'Saini Isiyo Rasmi',
  PACKAGE: 'Paketi Isiyo Sahihi',
  SERVER_SECURITY: 'Usalama wa Seva',
  LOCAL_OVERRIDE: 'Usalama wa Kifaa',
  NETWORK_STALE: 'Hali ya Zamani (Mtandao)',
  OTHER: 'Sababu Nyingine',
});

export const ACCESS_VERIFICATION_RESULT = Object.freeze({
  OPENED: 'OPENED',
  STILL_BLOCKED: 'STILL BLOCKED',
});

const THREAT_REASON = Object.freeze({
  root_detected: DEVICE_ACCESS_REASON.ROOT,
  emulator_detected: DEVICE_ACCESS_REASON.EMULATOR,
  frida_detected: DEVICE_ACCESS_REASON.FRIDA,
  debugger_attached: DEVICE_ACCESS_REASON.DEBUGGER,
  debug_detected: DEVICE_ACCESS_REASON.DEBUGGER,
  hook_detected: DEVICE_ACCESS_REASON.HOOK,
  clone_detected: DEVICE_ACCESS_REASON.CLONE,
  resigned_apk: DEVICE_ACCESS_REASON.TAMPERED_APK,
  invalid_signature: DEVICE_ACCESS_REASON.SIGNATURE,
  package_mismatch: DEVICE_ACCESS_REASON.PACKAGE,
  tampered_apk: DEVICE_ACCESS_REASON.TAMPERED_APK,
  jailbreak_ios: DEVICE_ACCESS_REASON.ROOT,
});

const USER_MESSAGE = Object.freeze({
  OPEN: 'Kifaa Kimefunguliwa Kikamilifu',
  SMART_MONITOR: 'Kifaa Kinafuatiliwa Na Smart Monitor',
  ROOT: 'Kifaa Kimefungwa Kwa Sababu Ya Root',
  EMULATOR: 'Kifaa Kimefungwa Kwa Sababu Ya Emulator',
  TAMPERED_APK: 'Kifaa Kimefungwa Kwa Sababu Ya APK Isiyo Rasmi',
  FRIDA: 'Kifaa Kimefungwa Kwa Sababu Ya Frida',
  DEBUGGER: 'Kifaa Kimefungwa Kwa Sababu Ya Debugger',
  ADMIN: 'Kifaa Kimefungwa Na Admin',
  OTHER: 'Kifaa Kimefungwa — Tafadhali Wasiliana Na Huduma',
});

/**
 * @param {Array<{ risk_type?: string }> | null | undefined} signals
 * @returns {string}
 */
export function resolveThreatAccessReason(signals) {
  for (const s of signals ?? []) {
    const key = String(s?.risk_type ?? '').trim();
    if (THREAT_REASON[key]) return THREAT_REASON[key];
  }
  return DEVICE_ACCESS_REASON.OTHER;
}

/**
 * @param {string} reason
 * @returns {string}
 */
export function resolveUserAccessMessage(reason, { smartMonitorEnabled = false, open = false } = {}) {
  if (open && smartMonitorEnabled) return USER_MESSAGE.SMART_MONITOR;
  if (open) return USER_MESSAGE.OPEN;
  if (reason === DEVICE_ACCESS_REASON.ROOT) return USER_MESSAGE.ROOT;
  if (reason === DEVICE_ACCESS_REASON.EMULATOR) return USER_MESSAGE.EMULATOR;
  if (reason === DEVICE_ACCESS_REASON.TAMPERED_APK || reason === DEVICE_ACCESS_REASON.SIGNATURE) {
    return USER_MESSAGE.TAMPERED_APK;
  }
  if (reason === DEVICE_ACCESS_REASON.FRIDA) return USER_MESSAGE.FRIDA;
  if (reason === DEVICE_ACCESS_REASON.DEBUGGER) return USER_MESSAGE.DEBUGGER;
  if (reason === DEVICE_ACCESS_REASON.ADMIN_BLOCK) return USER_MESSAGE.ADMIN;
  if (smartMonitorEnabled) return USER_MESSAGE.SMART_MONITOR;
  return USER_MESSAGE.OTHER;
}

/**
 * Combined Users Intelligence + security access decision.
 *
 * @param {{
 *   serverIntelBlocked?: boolean;
 *   serverIntelStatus?: string | null;
 *   serverIntelAllowed?: boolean | null;
 *   explicitUnblock?: boolean;
 *   smartMonitorEnabled?: boolean;
 *   serverPlaybackAllowed?: boolean | null;
 *   serverSecurityBlocked?: boolean | null;
 *   localSecurityBlocked?: boolean;
 *   localSignals?: Array<{ risk_type?: string }>;
 *   networkIntelOk?: boolean;
 *   cachedIntelBlocked?: boolean;
 * }} input
 */
export function resolveDeviceAccessStatus(input = {}) {
  const {
    serverIntelBlocked = false,
    serverIntelStatus = null,
    serverIntelAllowed = null,
    explicitUnblock = false,
    smartMonitorEnabled = false,
    serverPlaybackAllowed = null,
    serverSecurityBlocked = null,
    localSecurityBlocked = false,
    localSignals = [],
    networkIntelOk = true,
    cachedIntelBlocked = false,
  } = input;

  const serverSaysOpen =
    serverIntelBlocked !== true &&
    serverIntelStatus === 'active' &&
    serverIntelAllowed !== false;

  const serverSecurityOpen =
    serverSecurityBlocked !== true && serverPlaybackAllowed !== false;

  const serverAuthoritativeOpen =
    serverPlaybackAllowed === true || (serverSaysOpen && serverSecurityOpen);

  const localThreat = hasThreatSignals(localSignals);
  const appWouldBlockLocally = localSecurityBlocked || (localThreat && !smartMonitorEnabled);

  let deviceAccessReason = DEVICE_ACCESS_REASON.OTHER;
  let open = false;

  if (serverIntelBlocked === true) {
    deviceAccessReason = DEVICE_ACCESS_REASON.ADMIN_BLOCK;
  } else if (serverSecurityBlocked === true || serverPlaybackAllowed === false) {
    deviceAccessReason = DEVICE_ACCESS_REASON.SERVER_SECURITY;
  } else if (serverAuthoritativeOpen) {
    open = true;
    if (smartMonitorEnabled) {
      deviceAccessReason = DEVICE_ACCESS_REASON.SMART_MONITOR;
    } else if (explicitUnblock) {
      deviceAccessReason = DEVICE_ACCESS_REASON.ADMIN_UNBLOCK;
    } else if (localThreat) {
      deviceAccessReason = DEVICE_ACCESS_REASON.SMART_MONITOR;
    } else {
      deviceAccessReason = DEVICE_ACCESS_REASON.ADMIN_UNBLOCK;
    }
  } else if (appWouldBlockLocally) {
    deviceAccessReason = resolveThreatAccessReason(localSignals);
    if (!localThreat) deviceAccessReason = DEVICE_ACCESS_REASON.LOCAL_OVERRIDE;
  } else if (!networkIntelOk && cachedIntelBlocked) {
    deviceAccessReason = DEVICE_ACCESS_REASON.NETWORK_STALE;
  } else {
    open = true;
    deviceAccessReason = DEVICE_ACCESS_REASON.ADMIN_UNBLOCK;
  }

  const deviceAccessState = open ? DEVICE_ACCESS_STATE.OPEN : DEVICE_ACCESS_STATE.BLOCKED;
  const accessVerificationResult = open
    ? ACCESS_VERIFICATION_RESULT.OPENED
    : ACCESS_VERIFICATION_RESULT.STILL_BLOCKED;
  const userMessage = resolveUserAccessMessage(deviceAccessReason, { smartMonitorEnabled, open });

  return {
    open,
    deviceAccessState,
    deviceAccessReason,
    userMessage,
    accessVerificationResult,
    diagnostics: {
      serverIntelBlocked,
      serverIntelStatus,
      serverIntelAllowed,
      explicitUnblock,
      smartMonitorEnabled,
      serverPlaybackAllowed,
      serverSecurityBlocked,
      localSecurityBlocked,
      localThreat,
      localThreatTypes: (localSignals ?? []).map((s) => s?.risk_type).filter(Boolean),
      serverAuthoritativeOpen,
      appWouldBlockLocally,
      networkIntelOk,
      cachedIntelBlocked,
    },
  };
}

/**
 * @param {ReturnType<typeof resolveDeviceAccessStatus>} status
 */
export function logDeviceAccessVerification(status, tag = 'verify') {
  const line = {
    tag,
    accessVerificationResult: status.accessVerificationResult,
    deviceAccessState: status.deviceAccessState,
    deviceAccessReason: status.deviceAccessReason,
    userMessage: status.userMessage,
    ...status.diagnostics,
  };
  console.log('[device-access]', JSON.stringify(line));
  return line;
}
