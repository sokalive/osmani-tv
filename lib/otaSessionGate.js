/**
 * Session gate for Expo OTA reloads: never interrupt ChannelPlayer.
 * Lightweight module (no React) so expoUpdatesClient can query it.
 */

let channelPlaybackActive = false;
/** @type {Set<() => void>} */
const listeners = new Set();

/**
 * @param {boolean} active
 */
export function setChannelPlaybackActive(active) {
  const next = active === true;
  if (channelPlaybackActive === next) return;
  channelPlaybackActive = next;
  listeners.forEach((fn) => {
    try {
      fn(next);
    } catch {
      /* ignore */
    }
  });
}

/**
 * @returns {boolean}
 */
export function isChannelPlaybackActive() {
  return channelPlaybackActive === true;
}

/**
 * @param {(active: boolean) => void} listener
 * @returns {() => void}
 */
export function subscribeChannelPlaybackActive(listener) {
  if (typeof listener !== 'function') return () => {};
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
