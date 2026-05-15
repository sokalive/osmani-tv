import AsyncStorage from '@react-native-async-storage/async-storage';
import { nativeApplicationVersion, nativeBuildVersion } from 'expo-application';
import { Platform } from 'react-native';
import { BASE_URL } from '../api';
import { getDeviceIdentity } from '../lib/deviceIdentity';

const REPORT_DEDUPE_KEY = 'osmani:security_report_v1';
const RETRY_DELAYS_MS = [0, 900, 2200];
const SECURITY_DEBUG = __DEV__ || process.env.EXPO_PUBLIC_SECURITY_STARTUP_LOGS === '1';

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
  try {
    const fp = reportFingerprint(signals);
    const raw = await AsyncStorage.getItem(REPORT_DEDUPE_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    if (parsed?.fingerprint !== fp) return false;
    const age = Date.now() - Number(parsed?.at ?? 0);
    return age < 6 * 60 * 60 * 1000;
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

/**
 * POST /api/security/device-report
 * @param {{
 *   signals: Array<{ risk_type: string; risk_score: number; detail?: string }>;
 *   risk_score: number;
 *   details?: Record<string, unknown>;
 * }} args
 * @returns {Promise<{ ok: boolean; enforcement?: string | null }>}
 */
export async function reportSecurityDevice(args) {
  if (await shouldSkipReport(args?.signals)) {
    if (SECURITY_DEBUG) console.log('[security] report deduped');
    return { ok: true, enforcement: null };
  }

  const { deviceId } = await getDeviceIdentity();
  const app_version = nativeApplicationVersion ?? '';
  const build_number = nativeBuildVersion ?? '';

  const signals = args?.signals ?? [];
  const primary = [...signals].sort((a, b) => (b?.risk_score ?? 0) - (a?.risk_score ?? 0))[0];
  const body = {
    device_id: deviceId,
    risk_type: primary?.risk_type ?? 'clean',
    risk_score: Number(args?.risk_score ?? 0),
    signals,
    details: {
      platform: Platform.OS,
      ...(args?.details ?? {}),
    },
    app_version,
    build_number,
  };

  const url = `${BASE_URL}/api/security/device-report`;
  let lastError = null;

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
      if (res.ok) {
        await markReported(args?.signals);
        const enforcement =
          typeof parsed?.enforcement === 'string'
            ? parsed.enforcement
            : typeof parsed?.data?.enforcement === 'string'
              ? parsed.data.enforcement
              : null;
        return { ok: true, enforcement };
      }
      lastError = new Error(`HTTP ${res.status}`);
    } catch (err) {
      lastError = err;
    }
  }

  if (SECURITY_DEBUG) {
    console.log('[security] report failed:', String(lastError ?? 'unknown'));
  }
  return { ok: false, enforcement: null };
}

/**
 * Legacy single-risk payload helper (one event per signal).
 * @param {Array<{ risk_type: string; risk_score: number; detail?: string }>} signals
 * @param {number} risk_score
 * @param {Record<string, unknown>} [details]
 */
export async function reportSecuritySignals(signals, risk_score, details) {
  return reportSecurityDevice({ signals, risk_score, details });
}
