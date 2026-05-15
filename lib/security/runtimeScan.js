import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import { runNativeSecurityAudit } from './nativeSecurity';
import { aggregateRiskSignals } from './riskEngine';

function readExpectedCertSha256() {
  try {
    const extra = Constants.expoConfig?.extra ?? {};
    const v =
      extra.expectedSigningCertSha256 ??
      process.env.EXPO_PUBLIC_ANDROID_SIGNING_CERT_SHA256 ??
      '';
    return typeof v === 'string' ? v.trim().toLowerCase() : '';
  } catch {
    return '';
  }
}

/**
 * @returns {Promise<{ score: number; tier: import('./riskEngine').SecurityTier; signals: Array<{ risk_type: string; risk_score: number; detail?: string }>; details: Record<string, unknown> }>}
 */
export async function runRuntimeSecurityScan() {
  const jsSignals = [];

  if (__DEV__) {
    jsSignals.push({ risk_type: 'dev_client', risk_score: 3, detail: '__DEV__' });
  }

  try {
    if (Constants.debugMode) {
      jsSignals.push({ risk_type: 'debug_detected', risk_score: 4, detail: 'expo_constants_debugMode' });
    }
  } catch {
    /* ignore */
  }

  try {
    if (Device.isDevice === false) {
      jsSignals.push({ risk_type: 'emulator_detected', risk_score: 2, detail: 'expo_device_not_physical' });
    }
  } catch {
    /* ignore */
  }

  try {
  if (Platform.OS === 'ios' && typeof Device.isRootedExperimentalAsync === 'function') {
      const rooted = await Device.isRootedExperimentalAsync();
      if (rooted) {
        jsSignals.push({ risk_type: 'jailbreak_ios', risk_score: 5, detail: 'expo_device_rooted' });
      }
    }
  } catch {
    /* ignore */
  }

  const expectedCert = readExpectedCertSha256();
  const nativeAudit = Platform.OS === 'android' ? await runNativeSecurityAudit(expectedCert) : null;
  const nativeSignals = nativeAudit?.signals ?? [];

  const merged = aggregateRiskSignals([...nativeSignals, ...jsSignals]);

  return {
    score: merged.score,
    tier: merged.tier,
    signals: merged.signals,
    details: {
      platform: Platform.OS,
      native_total: nativeAudit?.total_score ?? null,
      signing_cert_sha256: nativeAudit?.signing_cert_sha256 ?? null,
      package_name: nativeAudit?.package_name ?? null,
      version_code: nativeAudit?.version_code ?? null,
      version_name: nativeAudit?.version_name ?? null,
      expected_cert_configured: Boolean(expectedCert),
    },
  };
}
