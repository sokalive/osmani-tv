import AsyncStorage from '@react-native-async-storage/async-storage';
import { nativeApplicationVersion, nativeBuildVersion } from 'expo-application';
import { Platform } from 'react-native';
import { BASE_URL } from '../api';
import { getDeviceIdentity } from '../lib/deviceIdentity';
import { getLastDeviceAccessReportFields } from '../lib/deviceAccessReportFields';
import { hasThreatSignals } from '../lib/security/constants';
import { getSecurityPhoneForReport } from '../lib/security/securityPhone';

const REPORT_DEDUPE_KEY = 'osmani:security_report_v1';
const CLEAN_REPORT_DEDUPE_MS = 6 * 60 * 60 * 1000;
const RETRY_DELAYS_MS = [0, 900, 2200];
const SECURITY_DEBUG = __DEV__ || process.env.EXPO_PUBLIC_SECURITY_STARTUP_LOGS === '1';

const REPORT_URLS = [
  `${BASE_URL}/api/runtime/security-report`,
  `${BASE_URL}/api/security/device-report`,
];

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

async function shouldSkipReport(signals) {
  if (hasThreatSignals(signals)) return false;
  try {
    const fp = reportFingerprint(signals);
    const raw = await AsyncStorage.getItem(REPORT_DEDUPE_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    if (parsed?.fingerprint !== fp) return false;
    const age = Date.now() - Number(parsed?.at ?? 0);
    return age < CLEAN_REPORT_DEDUPE_MS;
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

/**
 * @param {unknown} parsed
 * @returns {{ enforcement: string | null; playbackAllowed: boolean | null; blocked: boolean; smartMonitorEnabled: boolean }}
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

  return {
    enforcement,
    playbackAllowed,
    blocked,
    smartMonitorEnabled: inferredSmartMonitor,
    strictEnforcement,
    securityBlocked,
    playbackGateReason,
  };
}

/**
 * POST /api/runtime/security-report (fallback: /api/security/device-report)
 * @param {{
 *   signals: Array<{ risk_type: string; risk_score: number; detail?: string }>;
 *   risk_score: number;
 *   details?: Record<string, unknown>;
 *   detected_at?: string;
 * }} args
 * @returns {Promise<{ ok: boolean; enforcement?: string | null; playbackAllowed?: boolean | null; blocked?: boolean; smartMonitorEnabled?: boolean }>}
 */
export async function reportSecurityDevice(args) {
  if (await shouldSkipReport(args?.signals)) {
    if (SECURITY_DEBUG) console.log('[security] report deduped (clean scan)');
    return { ok: true, enforcement: null, playbackAllowed: null, blocked: false };
  }

  const { deviceId, deviceFingerprint } = await getDeviceIdentity();
  const phone = await getSecurityPhoneForReport();
  const app_version = nativeApplicationVersion ?? '';
  const build_number = nativeBuildVersion ?? '';
  const detected_at = args?.detected_at ?? new Date().toISOString();

  const signals = args?.signals ?? [];
  const primary = [...signals].sort((a, b) => (b?.risk_score ?? 0) - (a?.risk_score ?? 0))[0];
  const body = {
    device_id: deviceId,
    device_fingerprint: deviceFingerprint,
    risk_type: primary?.risk_type ?? 'clean',
    risk_score: Number(args?.risk_score ?? 0),
    signals,
    detected_at,
    details: {
      platform: Platform.OS,
      device_id: deviceId,
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
    },
    app_version,
    build_number,
  };
  if (phone) body.phone = phone;

  const accessFields = getLastDeviceAccessReportFields();
  if (accessFields) {
    body.device_access_state = accessFields.deviceAccessState;
    body.device_access_reason = accessFields.deviceAccessReason;
    body.access_verification_result = accessFields.accessVerificationResult;
    body.device_access_message = accessFields.userMessage;
  }

  let lastError = null;

  for (const url of REPORT_URLS) {
    for (let i = 0; i < RETRY_DELAYS_MS.length; i += 1) {
      await wait(RETRY_DELAYS_MS[i]);
      try {
        if (SECURITY_DEBUG) {
          console.log('[security] POST', url, JSON.stringify(body));
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
          console.log('[security] response', res.status, text?.slice?.(0, 400) ?? '');
        }
        if (res.status === 404 && url === REPORT_URLS[0]) {
          lastError = new Error('HTTP 404 primary endpoint');
          break;
        }
        if (res.ok) {
          await markReported(args?.signals);
          const out = parseSecurityReportResponse(parsed);
          return { ok: true, ...out };
        }
        lastError = new Error(`HTTP ${res.status}`);
      } catch (err) {
        lastError = err;
      }
    }
  }

  if (SECURITY_DEBUG) {
    console.log('[security] report failed:', String(lastError ?? 'unknown'));
  }
  return { ok: false, enforcement: null, playbackAllowed: null, blocked: false };
}

/**
 * @param {Array<{ risk_type: string; risk_score: number; detail?: string }>} signals
 * @param {number} risk_score
 * @param {Record<string, unknown>} [details]
 */
export async function reportSecuritySignals(signals, risk_score, details) {
  return reportSecurityDevice({ signals, risk_score, details });
}
