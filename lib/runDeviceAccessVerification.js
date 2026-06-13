import { parseDeviceIntelligenceAccess } from '../api/usersIntelligence';
import {
  logDeviceAccessVerification,
  resolveDeviceAccessStatus,
} from './deviceAccessStatus';
import { setLastDeviceAccessReportFields } from './deviceAccessReportFields';
import { getSecurityAccessSnapshot } from './deviceAccessSnapshot';
import { getLastDeviceIntelligenceResult, isDeviceIntelligenceBlocked } from './deviceIntelligenceAccess';
import { resolveEnforcement } from './security/riskEngine';

/**
 * Merge Users Intelligence + security snapshots into admin-readable access status.
 *
 * @param {{
 *   intelResult?: {
 *     ok?: boolean;
 *     status?: string | null;
 *     blocked?: boolean;
 *     smartMonitorEnabled?: boolean;
 *     explicitUnblock?: boolean;
 *     raw?: unknown;
 *   } | null;
 *   cachedIntelBlocked?: boolean;
 *   tag?: string;
 * }}
 */
export function runDeviceAccessVerification({ intelResult = null, cachedIntelBlocked = false, tag = 'verify' } = {}) {
  const resolvedIntel = intelResult ?? getLastDeviceIntelligenceResult();
  const raw = resolvedIntel?.raw ?? null;
  const access = raw ? parseDeviceIntelligenceAccess(raw) : null;
  const serverIntelBlocked =
    isDeviceIntelligenceBlocked() ||
    resolvedIntel?.blocked === true ||
    resolvedIntel?.status === 'blocked' ||
    access?.status === 'blocked';
  const serverIntelStatus = resolvedIntel?.status ?? access?.status ?? null;
  const serverIntelAllowed =
    raw && typeof raw === 'object' && 'allowed' in raw
      ? raw.allowed
      : raw?.registry?.allowed ?? null;

  const security = getSecurityAccessSnapshot();
  const smartMonitorEnabled =
    resolvedIntel?.smartMonitorEnabled === true ||
    access?.smartMonitorEnabled === true ||
    security.smartMonitorEnabled === true;

  const enforcement = resolveEnforcement({
    signals: security.signals,
    mode: 'enforce',
    serverEnforcement: security.serverEnforcement,
    serverPlaybackAllowed: security.serverPlaybackAllowed,
    smartMonitorEnabled,
  });

  const status = resolveDeviceAccessStatus({
    serverIntelBlocked,
    serverIntelStatus,
    serverIntelAllowed,
    explicitUnblock: resolvedIntel?.explicitUnblock === true || access?.explicitUnblock === true,
    smartMonitorEnabled,
    serverPlaybackAllowed: security.serverPlaybackAllowed,
    serverSecurityBlocked: security.serverSecurityBlocked,
    localSecurityBlocked: enforcement.blockPlayback === true,
    localSignals: security.signals,
    networkIntelOk: resolvedIntel?.ok !== false,
    cachedIntelBlocked,
  });

  setLastDeviceAccessReportFields({
    deviceAccessState: status.deviceAccessState,
    deviceAccessReason: status.deviceAccessReason,
    accessVerificationResult: status.accessVerificationResult,
    userMessage: status.userMessage,
  });

  logDeviceAccessVerification(status, tag);
  return status;
}
