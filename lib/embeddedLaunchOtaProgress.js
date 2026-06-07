/** @typedef {'idle' | 'checking' | 'downloading' | 'applying' | 'reloading'} EmbeddedOtaPhase */

/** @type {EmbeddedOtaPhase} */
let phase = 'idle';
/** @type {number | null} */
let downloadProgress = null;
/** @type {Set<(snap: { phase: EmbeddedOtaPhase, downloadProgress: number | null }) => void>} */
const listeners = new Set();

/**
 * @param {EmbeddedOtaPhase} next
 */
export function setEmbeddedOtaPhase(next) {
  phase = next;
  notify();
}

/**
 * @param {number | null | undefined} value 0–1 when known
 */
export function setEmbeddedOtaDownloadProgress(value) {
  if (value == null || !Number.isFinite(value)) {
    downloadProgress = null;
  } else {
    downloadProgress = Math.min(1, Math.max(0, value));
  }
  notify();
}

export function resetEmbeddedOtaProgress() {
  phase = 'idle';
  downloadProgress = null;
  notify();
}

/**
 * @returns {{ phase: EmbeddedOtaPhase, downloadProgress: number | null }}
 */
export function getEmbeddedOtaProgressSnapshot() {
  return { phase, downloadProgress };
}

/**
 * @param {(snap: { phase: EmbeddedOtaPhase, downloadProgress: number | null }) => void} fn
 * @returns {() => void}
 */
export function subscribeEmbeddedOtaProgress(fn) {
  listeners.add(fn);
  fn(getEmbeddedOtaProgressSnapshot());
  return () => listeners.delete(fn);
}

function notify() {
  const snap = getEmbeddedOtaProgressSnapshot();
  listeners.forEach((fn) => {
    try {
      fn(snap);
    } catch {
      /* ignore */
    }
  });
}
