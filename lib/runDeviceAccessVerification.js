import {
  logDeviceAccessVerification,
  resolveDeviceAccessStatus,
} from './deviceAccessStatus';
import { setLastDeviceAccessReportFields } from './deviceAccessReportFields';
import { getSecurityAccessSnapshot } from './deviceAccessSnapshot';
import { getLastDeviceIntelligenceResult } from './deviceIntelligenceAccess';
import { getLastSecurityReportSnapshot } from './lastSecurityReportSnapshot';
import { parseServerIntelAccess } from './serverIntelAccess';

/**
 * @param {{ intelResult?: object | null; tag?: string }} opts
 */
export function runDeviceAccessVerification({ intelResult = null, tag = 'verify' } = {}) {
  const resolvedIntel = intelResult ?? getLastDeviceIntelligenceResult();
  const raw = resolvedIntel?.raw ?? null;
  const intel = parseServerIntelAccess(raw);
  const securityLive = getSecurityAccessSnapshot();
  const securityCached = getLastSecurityReportSnapshot();

  const serverPlaybackAllowed =
    securityLive.serverPlaybackAllowed ?? securityCached.serverPlaybackAllowed ?? null;
  const serverSecurityBlocked =
    securityLive.serverSecurityBlocked ?? securityCached.serverSecurityBlocked ?? null;
  const securitySmartMonitor =
    securityLive.smartMonitorEnabled === true || securityCached.smartMonitorEnabled === true;

  const intelSmartMonitor =
    resolvedIntel?.smartMonitorEnabled === true || intel.smartMonitorEnabled === true;

  const status = resolveDeviceAccessStatus({
    serverIntelBlocked: intel.serverIntelBlocked,
    serverIntelOpen: intel.serverIntelOpen,
    serverIntelStatus: intel.status,
    explicitUnblock: resolvedIntel?.explicitUnblock === true || intel.explicitUnblock === true,
    intelSmartMonitor,
    securitySmartMonitor,
    serverPlaybackAllowed,
    serverSecurityBlocked,
    localSignals: securityLive.signals ?? [],
  });

  setLastDeviceAccessReportFields({
    deviceAccessState: status.deviceAccessState,
    deviceAccessReason: status.deviceAccessReason,
    accessVerificationResult: status.accessVerificationResult,
    userMessage: status.userMessage,
    playbackAllowed: status.playbackAllowed,
  });

  logDeviceAccessVerification(status, tag);
  return status;
}
