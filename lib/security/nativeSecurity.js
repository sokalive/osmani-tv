import { Platform } from 'react-native';

let OsmaniSecurity = null;

function loadNative() {
  if (Platform.OS !== 'android') return null;
  if (OsmaniSecurity) return OsmaniSecurity;
  try {
    // eslint-disable-next-line global-require
    OsmaniSecurity = require('../../modules/osmani-security');
    return OsmaniSecurity;
  } catch {
    return null;
  }
}

/**
 * @param {boolean} enabled
 */
export function setSecureWindowNative(enabled) {
  const mod = loadNative();
  if (!mod?.setSecureWindow) return;
  try {
    mod.setSecureWindow(Boolean(enabled));
  } catch {
    /* ignore */
  }
}

/**
 * @param {string | null | undefined} expectedCertSha256
 * @returns {Promise<import('../../modules/osmani-security').SecurityAuditResult | null>}
 */
export async function runNativeSecurityAudit(expectedCertSha256) {
  const mod = loadNative();
  if (!mod?.runSecurityAudit) return null;
  try {
    const raw = await mod.runSecurityAudit(expectedCertSha256 ?? null);
    const signals = Array.isArray(raw?.signals)
      ? raw.signals.map((s) => ({
          risk_type: String(s?.risk_type ?? s?.riskType ?? ''),
          risk_score: Number(s?.risk_score ?? s?.riskScore ?? 0),
          detail: s?.detail != null ? String(s.detail) : undefined,
        }))
      : [];
    return {
      signals: signals.filter((s) => s.risk_type),
      total_score: Number(raw?.total_score ?? raw?.totalScore ?? 0),
      signing_cert_sha256: String(raw?.signing_cert_sha256 ?? raw?.signingCertSha256 ?? ''),
      package_name: String(raw?.package_name ?? raw?.packageName ?? ''),
      version_code: Number(raw?.version_code ?? raw?.versionCode ?? 0),
      version_name: String(raw?.version_name ?? raw?.versionName ?? ''),
    };
  } catch {
    return null;
  }
}

export function getNativeSigningCertSha256() {
  const mod = loadNative();
  if (!mod?.getSigningCertSha256) return '';
  try {
    return String(mod.getSigningCertSha256() ?? '');
  } catch {
    return '';
  }
}
