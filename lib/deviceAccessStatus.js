import { hasThreatSignals } from './security/constants';
import {
  resolveEffectivePlaybackAllowed,
  resolveEffectiveSmartMonitor,
} from './serverIntelAccess';

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

export function resolveThreatAccessReason(signals) {
  for (const s of signals ?? []) {
    const key = String(s?.risk_type ?? '').trim();
    if (THREAT_REASON[key]) return THREAT_REASON[key];
  }
  return DEVICE_ACCESS_REASON.OTHER;
}

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

export function resolveDeviceAccessStatus(input = {}) {
  const {
    serverIntelBlocked = false,
    serverIntelOpen = false,
    serverIntelStatus = null,
    explicitUnblock = false,
    intelSmartMonitor = false,
    securitySmartMonitor = false,
    serverPlaybackAllowed = null,
    serverSecurityBlocked = null,
    localSignals = [],
  } = input;

  const localThreat = hasThreatSignals(localSignals);

  const effectiveSmartMonitor = resolveEffectiveSmartMonitor({
    intelSmartMonitor,
    securitySmartMonitor,
    serverIntelOpen,
    serverPlaybackAllowed,
    serverSecurityBlocked,
    localThreat,
  });

  const playbackAllowed = resolveEffectivePlaybackAllowed({
    serverIntelOpen,
    serverIntelBlocked,
    serverPlaybackAllowed,
    serverSecurityBlocked,
    effectiveSmartMonitor,
    localThreat,
  });

  let deviceAccessReason = DEVICE_ACCESS_REASON.OTHER;
  let open = playbackAllowed;

  if (serverIntelBlocked) {
    deviceAccessReason = DEVICE_ACCESS_REASON.ADMIN_BLOCK;
    open = false;
  } else if (serverSecurityBlocked || serverPlaybackAllowed === false) {
    deviceAccessReason = DEVICE_ACCESS_REASON.SERVER_SECURITY;
    open = false;
  } else if (open) {
    deviceAccessReason = effectiveSmartMonitor
      ? DEVICE_ACCESS_REASON.SMART_MONITOR
      : explicitUnblock
        ? DEVICE_ACCESS_REASON.ADMIN_UNBLOCK
        : DEVICE_ACCESS_REASON.ADMIN_UNBLOCK;
  } else if (localThreat) {
    deviceAccessReason = resolveThreatAccessReason(localSignals);
    open = false;
  } else {
    deviceAccessReason = DEVICE_ACCESS_REASON.LOCAL_OVERRIDE;
    open = false;
  }

  const deviceAccessState = open ? DEVICE_ACCESS_STATE.OPEN : DEVICE_ACCESS_STATE.BLOCKED;
  const accessVerificationResult = open
    ? ACCESS_VERIFICATION_RESULT.OPENED
    : ACCESS_VERIFICATION_RESULT.STILL_BLOCKED;
  const userMessage = resolveUserAccessMessage(deviceAccessReason, {
    smartMonitorEnabled: effectiveSmartMonitor,
    open,
  });

  return {
    open,
    playbackAllowed,
    deviceAccessState,
    deviceAccessReason,
    userMessage,
    accessVerificationResult,
    diagnostics: {
      serverIntelBlocked,
      serverIntelOpen,
      serverIntelStatus,
      explicitUnblock,
      intelSmartMonitor,
      securitySmartMonitor,
      effectiveSmartMonitor,
      serverPlaybackAllowed,
      serverSecurityBlocked,
      localThreat,
      localThreatTypes: (localSignals ?? []).map((s) => s?.risk_type).filter(Boolean),
      playbackAllowed,
    },
  };
}

export function logDeviceAccessVerification(status, tag = 'verify') {
  const line = {
    tag,
    accessVerificationResult: status.accessVerificationResult,
    deviceAccessState: status.deviceAccessState,
    deviceAccessReason: status.deviceAccessReason,
    userMessage: status.userMessage,
    playbackAllowed: status.playbackAllowed,
    ...status.diagnostics,
  };
  console.log('[device-access]', JSON.stringify(line));
  return line;
}
