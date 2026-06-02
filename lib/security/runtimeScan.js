import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import { readExpectedAndroidPackage, readExpectedSigningCertSha256 } from './expectedIntegrity';
import { runNativeSecurityAudit } from './nativeSecurity';
import { aggregateRiskSignals } from './riskEngine';

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

  const expectedCert = readExpectedSigningCertSha256();
  const expectedPackage = readExpectedAndroidPackage();
  const nativeAudit =
    Platform.OS === 'android'
      ? await runNativeSecurityAudit(expectedCert, expectedPackage)
      : null;
  const nativeSignals = nativeAudit?.signals ?? [];

  if (Platform.OS === 'android' && expectedPackage && nativeAudit?.package_name) {
    const actual = String(nativeAudit.package_name).trim();
    if (actual && actual !== expectedPackage) {
      jsSignals.push({
        risk_type: 'package_mismatch',
        risk_score: 9,
        detail: `expected=${expectedPackage} actual=${actual}`,
      });
    }
  }

  if (
    Platform.OS === 'android' &&
    expectedCert &&
    nativeAudit &&
    !nativeAudit.signing_cert_sha256 &&
    !__DEV__
  ) {
    const hasInvalid = nativeSignals.some((s) => s.risk_type === 'invalid_signature');
    if (!hasInvalid) {
      jsSignals.push({
        risk_type: 'invalid_signature',
        risk_score: 9,
        detail: 'signing_cert_unreadable_js_fallback',
      });
    }
  }

  const merged = aggregateRiskSignals([...nativeSignals, ...jsSignals]);

  const actualPackage = nativeAudit?.package_name ?? '';
  const signingCert = nativeAudit?.signing_cert_sha256 ?? '';
  const packageMatches =
    !expectedPackage || !actualPackage
      ? null
      : actualPackage === expectedPackage;

  return {
    score: merged.score,
    tier: merged.tier,
    signals: merged.signals,
    details: {
      platform: Platform.OS,
      native_total: nativeAudit?.total_score ?? null,
      signing_cert_sha256: signingCert || null,
      package_name: actualPackage || null,
      expected_package: expectedPackage || null,
      package_matches: packageMatches,
      signing_cert_matches:
        expectedCert && signingCert ? signingCert === expectedCert : null,
      version_code: nativeAudit?.version_code ?? null,
      version_name: nativeAudit?.version_name ?? null,
      expected_cert_configured: Boolean(expectedCert),
      expected_package_configured: Boolean(expectedPackage),
      application_id: Constants.expoConfig?.android?.package ?? null,
    },
  };
}
