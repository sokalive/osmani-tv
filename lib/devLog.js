/**
 * Production-safe logging — verbose traces only in development builds.
 */

/** @param {...unknown} args */
export function devLog(...args) {
  if (!__DEV__) return;
  try {
    console.log(...args);
  } catch {
    /* ignore */
  }
}

/** @param {...unknown} args */
export function devWarn(...args) {
  if (!__DEV__) return;
  try {
    console.warn(...args);
  } catch {
    /* ignore */
  }
}
