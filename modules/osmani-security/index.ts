import { requireNativeModule } from 'expo-modules-core';

/* eslint-disable @typescript-eslint/no-explicit-any */
const NativeModule: any = requireNativeModule('OsmaniSecurity');

export interface SecuritySignal {
  risk_type: string;
  risk_score: number;
  detail?: string;
}

export interface SecurityAuditResult {
  signals: SecuritySignal[];
  total_score: number;
  signing_cert_sha256: string;
  package_name: string;
  version_code: number;
  version_name: string;
}

export function setSecureWindow(enabled: boolean): void {
  NativeModule.setSecureWindow(Boolean(enabled));
}

export async function runSecurityAudit(expectedCertSha256?: string | null): Promise<SecurityAuditResult> {
  return (await NativeModule.runSecurityAudit(expectedCertSha256 ?? null)) as SecurityAuditResult;
}

export function getSigningCertSha256(): string {
  return String(NativeModule.getSigningCertSha256?.() ?? '');
}
