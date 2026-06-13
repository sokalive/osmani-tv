import { parseDeviceIntelligenceAccess } from '../api/usersIntelligence';

/**
 * Server-authoritative Users Intelligence open/blocked (never local React state).
 *
 * @param {unknown} raw
 */
export function parseServerIntelAccess(raw) {
  const access = raw ? parseDeviceIntelligenceAccess(raw) : null;
  const root = raw && typeof raw === 'object' ? raw : {};
  const registry = root.registry && typeof root.registry === 'object' ? root.registry : null;

  const blockedFlag =
    access?.status === 'blocked' ||
    root.blocked === true ||
    registry?.blocked === true;

  const allowedFlag =
    root.allowed === true ||
    registry?.allowed === true ||
    access?.status === 'active';

  const status =
    access?.status ??
    (registry?.status != null ? String(registry.status).trim().toLowerCase() : null);

  const serverIntelOpen =
    !blockedFlag &&
    (allowedFlag ||
      status === 'active' ||
      status === 'unblocked' ||
      status === 'ok' ||
      status === 'allowed' ||
      status === 'smart_monitor' ||
      status === 'monitor');

  return {
    serverIntelBlocked: blockedFlag,
    serverIntelOpen,
    status,
    smartMonitorEnabled: access?.smartMonitorEnabled === true,
    explicitUnblock: access?.explicitUnblock === true,
    allowed: root.allowed ?? registry?.allowed ?? null,
    blocked: root.blocked ?? registry?.blocked ?? null,
  };
}

/**
 * @param {{
 *   intelSmartMonitor?: boolean;
 *   securitySmartMonitor?: boolean;
 *   serverIntelOpen?: boolean;
 *   serverPlaybackAllowed?: boolean | null;
 *   serverSecurityBlocked?: boolean | null;
 *   localThreat?: boolean;
 * }} input
 */
export function resolveEffectiveSmartMonitor(input = {}) {
  if (input.intelSmartMonitor === true || input.securitySmartMonitor === true) return true;
  if (input.serverIntelOpen !== true) return false;
  if (input.serverSecurityBlocked === true || input.serverPlaybackAllowed === false) return false;
  if (input.serverPlaybackAllowed === true && input.localThreat === true) return true;
  return false;
}

/**
 * @param {{
 *   serverIntelOpen?: boolean;
 *   serverIntelBlocked?: boolean;
 *   serverPlaybackAllowed?: boolean | null;
 *   serverSecurityBlocked?: boolean | null;
 *   effectiveSmartMonitor?: boolean;
 *   localThreat?: boolean;
 * }} input
 */
export function resolveEffectivePlaybackAllowed(input = {}) {
  if (input.serverIntelBlocked === true) return false;
  if (input.serverSecurityBlocked === true) return false;
  if (input.serverPlaybackAllowed === false) return false;
  if (input.serverPlaybackAllowed === true) return true;
  if (input.effectiveSmartMonitor === true && input.serverIntelOpen === true) return true;
  if (input.serverIntelOpen === true && input.localThreat !== true) return true;
  return false;
}
