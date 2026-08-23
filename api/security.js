import AsyncStorage from '@react-native-async-storage/async-storage';
import { nativeApplicationVersion, nativeBuildVersion } from 'expo-application';
import { Platform } from 'react-native';
import { resolveApiBaseUrl } from '../lib/apiBaseUrl';
import { getDeviceIdentity } from '../lib/deviceIdentity';
import { getLastDeviceAccessReportFields } from '../lib/deviceAccessReportFields';
import {
  getLastSecurityReportSnapshot,
  isSecuritySnapshotFresh,
  setLastSecurityReportSnapshot,
} from '../lib/lastSecurityReportSnapshot';
import { hasThreatSignals } from '../lib/security/constants';
import { obtainPlayIntegrityToken } from '../lib/security/playIntegrityCapability';
import { getSecurityPhoneForReport } from '../lib/security/securityPhone';

const REPORT_DEDUPE_KEY = 'osmani:security_report_v1';
const CHALLENGE_RETRY_DELAYS_MS = [0, 700, 1600];
const MAX_CHALLENGE_ATTEMPTS = 3;
const SECURITY_DEBUG = __DEV__ || process.env.EXPO_PUBLIC_SECURITY_STARTUP_LOGS === '1';

const NONCE_ERROR_CODES = new Set([
  'nonce_replay',
  'nonce_expired',
  'unknown_nonce',
  'device_mismatch',
  'install_mismatch',
]);

function reportUrls() {
  const base = resolveApiBaseUrl();
  return [`${base}/api/runtime/security-report`, `${base}/api/security/device-report`];
}

function challengeUrls() {
  const base = resolveApiBaseUrl();
  return [
    `${base}/api/runtime/security-challenge`,
    `${base}/api/security/verification-challenge`,
  ];
}

async function wait(ms) {
  if (!ms) return;
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function reportFingerprint(signals) {
  const types = (signals ?? [])
    .map((s) => s?.risk_type)
    .filter(Boolean)
    .sort()
    .join('|');
  return types || 'clean';
}

/**
 * Short-circuit only when a challenge-validated fresh policy already exists.
 * Threat scans never skip — they must always obtain a fresh challenge.
 */
async function shouldSkipReport(signals) {
  if (hasThreatSignals(signals)) return false;
  if (!isSecuritySnapshotFresh()) return false;
  const snap = getLastSecurityReportSnapshot();
  if (snap.everSevere === true) return false;
  if (snap.serverSecurityBlocked === true || snap.serverPlaybackAllowed === false) return false;
  if (snap.challengeValid !== true || snap.verificationFresh !== true) return false;
  try {
    const fp = reportFingerprint(signals);
    const raw = await AsyncStorage.getItem(REPORT_DEDUPE_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    if (parsed?.fingerprint !== fp) return false;
    return true;
  } catch {
    return false;
  }
}

async function markReported(signals) {
  try {
    await AsyncStorage.setItem(
      REPORT_DEDUPE_KEY,
      JSON.stringify({ fingerprint: reportFingerprint(signals), at: Date.now() }),
    );
  } catch {
    /* ignore */
  }
}

function readBoolish(value) {
  if (value === true || value === 1) return true;
  if (value === false || value === 0) return false;
  if (typeof value === 'string') {
    const v = value.trim().toLowerCase();
    if (v === 'true' || v === '1' || v === 'yes') return true;
    if (v === 'false' || v === '0' || v === 'no') return false;
  }
  return null;
}

function readNumberish(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return null;
}

/**
 * Strip client risk scores from signal objects so the hardened backend does not
 * treat mismatched client weights as score_mismatch / security_blocked.
 * Local scoring remains available to callers via the original scan object.
 * @param {Array<{ risk_type?: string; detail?: string }> | null | undefined} signals
 */
export function signalsForServerReport(signals) {
  return (signals ?? [])
    .map((s) => {
      const risk_type = String(s?.risk_type ?? '').trim();
      if (!risk_type) return null;
      const out = { risk_type };
      if (s?.detail != null && String(s.detail).trim()) out.detail = String(s.detail);
      return out;
    })
    .filter(Boolean);
}

/**
 * @param {unknown} parsed
 */
export function parseSecurityReportResponse(parsed) {
  const root = parsed && typeof parsed === 'object' ? parsed : {};
  const data =
    root.data && typeof root.data === 'object' && !Array.isArray(root.data) ? root.data : root;

  const enforcement =
    typeof data.enforcement === 'string'
      ? data.enforcement
      : typeof root.enforcement === 'string'
        ? root.enforcement
        : null;

  let playbackAllowed =
    readBoolish(data.playbackAllowed) ??
    readBoolish(data.playback_allowed) ??
    readBoolish(root.playbackAllowed) ??
    readBoolish(root.playback_allowed);

  const securityBlocked =
    readBoolish(data.security_blocked) === true ||
    readBoolish(data.securityBlocked) === true ||
    readBoolish(root.security_blocked) === true ||
    readBoolish(root.securityBlocked) === true;

  const blockedFlag =
    readBoolish(data.blocked) === true ||
    readBoolish(root.blocked) === true ||
    String(data.status ?? root.status ?? '').trim().toLowerCase() === 'blocked';

  const smartMonitorEnabled =
    readBoolish(data.smart_monitor_enabled) === true ||
    readBoolish(data.smartMonitorEnabled) === true ||
    readBoolish(root.smart_monitor_enabled) === true ||
    readBoolish(root.smartMonitorEnabled) === true ||
    readBoolish(data.smartMonitor) === true ||
    readBoolish(root.smartMonitor) === true ||
    String(enforcement ?? '').trim().toLowerCase() === 'monitor';

  const strictEnforcement =
    readBoolish(data.strict_enforcement) === true ||
    readBoolish(root.strict_enforcement) === true;

  if (securityBlocked || blockedFlag) {
    playbackAllowed = false;
  }
  if (String(enforcement ?? '').trim().toLowerCase() === 'block' && playbackAllowed !== false) {
    playbackAllowed = false;
  }

  const blocked =
    securityBlocked ||
    blockedFlag ||
    playbackAllowed === false ||
    String(enforcement ?? '').trim().toLowerCase() === 'block';

  const inferredSmartMonitor =
    !blocked &&
    playbackAllowed === true &&
    securityBlocked !== true &&
    (smartMonitorEnabled || strictEnforcement === true);

  const playbackGateReason =
    typeof data.playbackGateReason === 'string'
      ? data.playbackGateReason
      : typeof data.playback_gate_reason === 'string'
        ? data.playback_gate_reason
        : typeof root.playbackGateReason === 'string'
          ? root.playbackGateReason
          : typeof root.playback_gate_reason === 'string'
            ? root.playback_gate_reason
            : null;

  const trustState =
    typeof data.trust_state === 'string'
      ? data.trust_state
      : typeof data.trustState === 'string'
        ? data.trustState
        : typeof root.trust_state === 'string'
          ? root.trust_state
          : typeof root.trustState === 'string'
            ? root.trustState
            : null;

  const verificationFresh =
    readBoolish(data.verification_fresh) ??
    readBoolish(data.verificationFresh) ??
    readBoolish(root.verification_fresh) ??
    readBoolish(root.verificationFresh);

  const challengeValid =
    readBoolish(data.challenge_valid) ??
    readBoolish(data.challengeValid) ??
    readBoolish(root.challenge_valid) ??
    readBoolish(root.challengeValid);

  const everSevere =
    readBoolish(data.ever_severe) === true ||
    readBoolish(data.everSevere) === true ||
    readBoolish(root.ever_severe) === true ||
    readBoolish(root.everSevere) === true;

  const serverCalculatedScore =
    readNumberish(data.server_calculated_score) ??
    readNumberish(data.serverCalculatedScore) ??
    readNumberish(root.server_calculated_score) ??
    readNumberish(root.serverCalculatedScore) ??
    readNumberish(data.risk_score) ??
    readNumberish(root.risk_score);

  const scoreMismatch =
    readBoolish(data.score_mismatch) === true ||
    readBoolish(data.scoreMismatch) === true ||
    readBoolish(root.score_mismatch) === true ||
    readBoolish(root.scoreMismatch) === true;

  const securityLevel =
    typeof data.security_level === 'string'
      ? data.security_level
      : typeof data.securityLevel === 'string'
        ? data.securityLevel
        : typeof root.security_level === 'string'
          ? root.security_level
          : typeof root.securityLevel === 'string'
            ? root.securityLevel
            : null;

  const attestationStatus =
    typeof data.attestation_status === 'string'
      ? data.attestation_status
      : typeof data.attestationStatus === 'string'
        ? data.attestationStatus
        : typeof root.attestation_status === 'string'
          ? root.attestation_status
          : typeof root.attestationStatus === 'string'
            ? root.attestationStatus
            : null;

  return {
    enforcement,
    playbackAllowed,
    blocked,
    smartMonitorEnabled: inferredSmartMonitor,
    strictEnforcement,
    securityBlocked,
    playbackGateReason,
    trustState,
    verificationFresh,
    challengeValid,
    everSevere,
    serverCalculatedScore,
    scoreMismatch,
    securityLevel,
    attestationStatus,
  };
}

/**
 * Parse challenge / report error code from JSON or HTTP body.
 * @param {unknown} parsed
 * @param {number} [status]
 */
export function parseSecurityErrorCode(parsed, status) {
  const root = parsed && typeof parsed === 'object' ? parsed : {};
  const code = String(root.code ?? root.error_code ?? '').trim().toLowerCase();
  if (code) return code;
  const err = String(root.error ?? '').toLowerCase();
  for (const known of NONCE_ERROR_CODES) {
    if (err.includes(known)) return known;
  }
  if (status === 403 && err.includes('nonce')) return 'unknown_nonce';
  return code || null;
}

/**
 * @param {{ deviceId: string; installId: string }} args
 * @returns {Promise<{ ok: boolean; nonce?: string; challengeId?: string; expiresAt?: string; ttlSec?: number; errorCode?: string | null }>}
 */
export async function requestSecurityChallenge({ deviceId, installId }) {
  const body = {
    device_id: deviceId,
    install_id: installId,
  };
  let lastError = null;

  for (const url of challengeUrls()) {
    for (let i = 0; i < CHALLENGE_RETRY_DELAYS_MS.length; i += 1) {
      await wait(CHALLENGE_RETRY_DELAYS_MS[i]);
      try {
        if (SECURITY_DEBUG) console.log('[security] challenge POST', url);
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify(body),
        });
        const text = await res.text();
        let parsed = null;
        try {
          parsed = text ? JSON.parse(text) : null;
        } catch {
          parsed = null;
        }
        if (SECURITY_DEBUG) {
          console.log('[security] challenge response', res.status, text?.slice?.(0, 300) ?? '');
        }
        if (res.status === 404 && url === challengeUrls()[0]) {
          lastError = new Error('HTTP 404 primary challenge');
          break;
        }
        if (res.ok && parsed?.ok !== false) {
          const nonce = String(parsed?.nonce ?? '').trim();
          if (!nonce) {
            lastError = new Error('challenge missing nonce');
            continue;
          }
          return {
            ok: true,
            nonce,
            challengeId: parsed?.challenge_id ? String(parsed.challenge_id) : null,
            expiresAt: parsed?.expires_at ? String(parsed.expires_at) : null,
            ttlSec: typeof parsed?.ttl_sec === 'number' ? parsed.ttl_sec : null,
          };
        }
        lastError = new Error(`HTTP ${res.status}`);
      } catch (err) {
        lastError = err;
      }
    }
  }

  if (SECURITY_DEBUG) {
    console.log('[security] challenge failed:', String(lastError ?? 'unknown'));
  }
  return { ok: false, errorCode: 'challenge_failed' };
}

/**
 * Single POST attempt with a specific nonce. Does not retry the same nonce.
 * @returns {Promise<{
 *   kind: 'ok' | 'nonce_error' | 'http_error' | 'transport_error';
 *   status?: number;
 *   parsed?: unknown;
 *   errorCode?: string | null;
 *   out?: ReturnType<typeof parseSecurityReportResponse>;
 * }>}
 */
async function postSecurityReportOnce(url, body) {
  try {
    if (SECURITY_DEBUG) {
      console.log('[security] POST', url, JSON.stringify({ ...body, security_nonce: '[redacted]' }));
    }
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    let parsed = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = null;
    }
    if (SECURITY_DEBUG) {
      console.log('[security] response', res.status, text?.slice?.(0, 500) ?? '');
    }

    if (res.ok) {
      const out = parseSecurityReportResponse(parsed);
      return { kind: 'ok', status: res.status, parsed, out };
    }

    const errorCode = parseSecurityErrorCode(parsed, res.status);
    if (errorCode && NONCE_ERROR_CODES.has(errorCode)) {
      return { kind: 'nonce_error', status: res.status, parsed, errorCode };
    }
    return { kind: 'http_error', status: res.status, parsed, errorCode };
  } catch (err) {
    return {
      kind: 'transport_error',
      errorCode: 'transport_error',
      parsed: { message: String(err?.message ?? err) },
    };
  }
}

function persistPolicyFromOut(out) {
  setLastSecurityReportSnapshot({
    serverPlaybackAllowed: out.playbackAllowed ?? null,
    serverSecurityBlocked: out.securityBlocked ?? null,
    smartMonitorEnabled: out.smartMonitorEnabled === true,
    enforcement: out.enforcement ?? null,
    playbackGateReason: out.playbackGateReason ?? null,
    trustState: out.trustState ?? null,
    verificationFresh: out.verificationFresh ?? null,
    challengeValid: out.challengeValid ?? null,
    everSevere: out.everSevere === true,
    serverCalculatedScore: out.serverCalculatedScore ?? null,
    scoreMismatch: out.scoreMismatch === true,
    securityLevel: out.securityLevel ?? null,
  });
}

/**
 * POST /api/runtime/security-report with single-use challenge nonce.
 * @param {{
 *   signals: Array<{ risk_type: string; risk_score?: number; detail?: string }>;
 *   risk_score?: number;
 *   details?: Record<string, unknown>;
 *   detected_at?: string;
 * }} args
 */
export async function reportSecurityDevice(args) {
  if (await shouldSkipReport(args?.signals)) {
    if (SECURITY_DEBUG) console.log('[security] report short-circuit (fresh challenge-validated)');
    const cached = getLastSecurityReportSnapshot();
    if (cached.at > 0) {
      return {
        ok: true,
        deduped: true,
        enforcement: cached.enforcement,
        playbackAllowed: cached.serverPlaybackAllowed,
        securityBlocked: cached.serverSecurityBlocked,
        blocked: cached.serverSecurityBlocked === true || cached.serverPlaybackAllowed === false,
        smartMonitorEnabled: cached.smartMonitorEnabled === true,
        trustState: cached.trustState,
        verificationFresh: cached.verificationFresh,
        challengeValid: cached.challengeValid,
        everSevere: cached.everSevere === true,
        serverCalculatedScore: cached.serverCalculatedScore,
        scoreMismatch: cached.scoreMismatch === true,
        securityLevel: cached.securityLevel,
        playbackGateReason: cached.playbackGateReason,
      };
    }
    return { ok: true, deduped: true, enforcement: null, playbackAllowed: null, blocked: false };
  }

  const identity = await getDeviceIdentity();
  const deviceId = identity.deviceId;
  const installId = identity.installInstanceId;
  const deviceFingerprint = identity.deviceFingerprint;
  const phone = await getSecurityPhoneForReport();
  const app_version = nativeApplicationVersion ?? '';
  const build_number = nativeBuildVersion ?? '';
  const detected_at = args?.detected_at ?? new Date().toISOString();
  const serverSignals = signalsForServerReport(args?.signals);
  const primary = serverSignals[0];

  let lastErrorCode = null;
  let deviceMismatch = false;

  for (let attempt = 0; attempt < MAX_CHALLENGE_ATTEMPTS; attempt += 1) {
    if (attempt > 0) await wait(CHALLENGE_RETRY_DELAYS_MS[Math.min(attempt, CHALLENGE_RETRY_DELAYS_MS.length - 1)]);

    const challenge = await requestSecurityChallenge({ deviceId, installId });
    if (!challenge.ok || !challenge.nonce) {
      lastErrorCode = challenge.errorCode || 'challenge_failed';
      continue;
    }

    const integrityToken = await obtainPlayIntegrityToken({ nonce: challenge.nonce });

    const body = {
      device_id: deviceId,
      install_id: installId,
      security_nonce: challenge.nonce,
      device_fingerprint: deviceFingerprint,
      risk_type: primary?.risk_type ?? 'clean',
      signals: serverSignals,
      detected_at,
      details: {
        platform: Platform.OS,
        device_id: deviceId,
        install_id: installId,
        device_fingerprint: deviceFingerprint,
        integrity: {
          expected_package: args?.details?.expected_package ?? null,
          package_name: args?.details?.package_name ?? null,
          package_matches: args?.details?.package_matches ?? null,
          signing_cert_sha256: args?.details?.signing_cert_sha256 ?? null,
          signing_cert_matches: args?.details?.signing_cert_matches ?? null,
          expected_cert_configured: args?.details?.expected_cert_configured ?? null,
        },
        ...(args?.details ?? {}),
        challenge_id: challenge.challengeId ?? null,
        play_integrity_available: false,
      },
      app_version,
      build_number,
    };
    // Intentionally omit client risk_score — server calculates authoritatively.
    if (phone) body.phone = phone;
    if (integrityToken) body.integrity_token = integrityToken;

    const accessFields = getLastDeviceAccessReportFields();
    if (accessFields) {
      body.device_access_state = accessFields.deviceAccessState;
      body.device_access_reason = accessFields.deviceAccessReason;
      body.access_verification_result = accessFields.accessVerificationResult;
      body.device_access_message = accessFields.userMessage;
      body.playback_allowed = accessFields.playbackAllowed === true;
    }

    let needFreshChallenge = false;

    for (const url of reportUrls()) {
      const result = await postSecurityReportOnce(url, body);

      if (result.kind === 'ok' && result.out) {
        await markReported(args?.signals);
        persistPolicyFromOut(result.out);
        return { ok: true, ...result.out };
      }

      if (result.kind === 'nonce_error') {
        lastErrorCode = result.errorCode;
        if (result.errorCode === 'device_mismatch' || result.errorCode === 'install_mismatch') {
          deviceMismatch = true;
          console.log(
            '[security] anomaly',
            JSON.stringify({ code: result.errorCode, attempt, url }),
          );
          // Do not silently downgrade — stop retrying with wrong identity binding.
          return {
            ok: false,
            enforcement: null,
            playbackAllowed: null,
            blocked: false,
            errorCode: result.errorCode,
            deviceMismatch: true,
            challengeFailed: false,
          };
        }
        // nonce_replay / nonce_expired / unknown_nonce → fresh challenge (outer loop)
        needFreshChallenge = true;
        break;
      }

      if (result.status === 404 && url === reportUrls()[0]) {
        // try fallback URL with SAME nonce only once (same report attempt; nonce not yet consumed)
        continue;
      }

      if (result.kind === 'transport_error' || result.kind === 'http_error') {
        lastErrorCode = result.errorCode || result.kind;
        // Uncertain whether server consumed the nonce — always obtain a fresh challenge.
        needFreshChallenge = true;
        break;
      }
    }

    if (deviceMismatch) break;
    if (!needFreshChallenge && lastErrorCode) {
      // exhausted URLs without a clear next action
      break;
    }
  }

  if (SECURITY_DEBUG) {
    console.log('[security] report failed:', lastErrorCode ?? 'unknown');
  }

  return {
    ok: false,
    enforcement: null,
    playbackAllowed: null,
    blocked: false,
    errorCode: lastErrorCode,
    challengeFailed: lastErrorCode === 'challenge_failed',
    deviceMismatch,
  };
}

/**
 * @param {Array<{ risk_type: string; risk_score: number; detail?: string }>} signals
 * @param {number} risk_score
 * @param {Record<string, unknown>} [details]
 */
export async function reportSecuritySignals(signals, risk_score, details) {
  return reportSecurityDevice({ signals, risk_score, details });
}
