/**
 * Imperative gate for navigation helpers outside React (deep links, channel open).
 * Updated by DeviceIntelligenceProvider on status changes.
 */

let blocked = false;
/** @type {() => void} */
let showBlockedModal = () => {};

/**
 * @param {{ blocked?: boolean; showBlockedModal?: () => void }} next
 */
export function setDeviceIntelligenceAccessState(next) {
  if (typeof next.blocked === 'boolean') blocked = next.blocked;
  if (typeof next.showBlockedModal === 'function') showBlockedModal = next.showBlockedModal;
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
