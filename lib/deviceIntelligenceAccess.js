/**
 * Imperative gate + pub/sub so SecurityContext reacts to Users Intelligence updates.
 */

let blocked = false;
let smartMonitorEnabled = false;
/** @type {{ ok?: boolean; status?: string | null; blocked?: boolean; smartMonitorEnabled?: boolean; explicitUnblock?: boolean; raw?: unknown } | null} */
let lastIntelResult = null;
/** @type {() => void} */
let showBlockedModal = () => {};
/** @type {(() => void) | null} */
let navigateHome = null;
/** @type {(() => void) | null} */
let securityRefreshHandler = null;

let accessVersion = 0;
/** @type {Set<() => void>} */
const listeners = new Set();

function bumpAccessVersion() {
  accessVersion += 1;
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      /* ignore */
    }
  }
}

export function subscribeDeviceIntelligenceAccess(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getDeviceIntelligenceAccessVersion() {
  return accessVersion;
}

/**
 * @param {{ blocked?: boolean; smartMonitorEnabled?: boolean; lastIntelResult?: object | null; showBlockedModal?: () => void; navigateHome?: (() => void) | null }} next
 */
export function setDeviceIntelligenceAccessState(next) {
  let changed = false;
  if (typeof next.blocked === 'boolean' && next.blocked !== blocked) {
    blocked = next.blocked;
    changed = true;
  }
  if (typeof next.smartMonitorEnabled === 'boolean' && next.smartMonitorEnabled !== smartMonitorEnabled) {
    smartMonitorEnabled = next.smartMonitorEnabled;
    changed = true;
  }
  if (next.lastIntelResult !== undefined) lastIntelResult = next.lastIntelResult;
  if (typeof next.showBlockedModal === 'function') showBlockedModal = next.showBlockedModal;
  if (next.navigateHome !== undefined) navigateHome = next.navigateHome;
  if (changed) bumpAccessVersion();
}

export function registerDeviceIntelligenceNavigateHome(fn) {
  navigateHome = typeof fn === 'function' ? fn : null;
}

export function registerSecurityAccessRefresh(fn) {
  securityRefreshHandler = typeof fn === 'function' ? fn : null;
}

export function requestSecurityAccessRefresh() {
  try {
    securityRefreshHandler?.();
  } catch {
    /* ignore */
  }
}

export function isDeviceIntelligenceBlocked() {
  return blocked;
}

export function isDeviceIntelligenceSmartMonitorEnabled() {
  return smartMonitorEnabled;
}

export function getLastDeviceIntelligenceResult() {
  return lastIntelResult;
}

/**
 * @returns {{ ok: true } | { ok: false }}
 */
export function assertDeviceIntelligenceAllowed() {
  if (!blocked) return { ok: true };
  try {
    showBlockedModal();
  } catch {
    /* ignore */
  }
  return { ok: false };
}

export function runDeviceIntelligenceNavigateHome() {
  try {
    navigateHome?.();
  } catch {
    /* ignore */
  }
}
