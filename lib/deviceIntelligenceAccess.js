/**
 * Imperative gate for navigation helpers outside React (deep links, channel open).
 * Updated by DeviceIntelligenceProvider on status changes.
 */

let blocked = false;
/** @type {() => void} */
let showBlockedModal = () => {};
/** @type {(() => void) | null} */
let navigateHome = null;

/**
 * @param {{ blocked?: boolean; showBlockedModal?: () => void; navigateHome?: (() => void) | null }} next
 */
export function setDeviceIntelligenceAccessState(next) {
  if (typeof next.blocked === 'boolean') blocked = next.blocked;
  if (typeof next.showBlockedModal === 'function') showBlockedModal = next.showBlockedModal;
  if (next.navigateHome !== undefined) navigateHome = next.navigateHome;
}

export function registerDeviceIntelligenceNavigateHome(fn) {
  navigateHome = typeof fn === 'function' ? fn : null;
}

export function isDeviceIntelligenceBlocked() {
  return blocked;
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
