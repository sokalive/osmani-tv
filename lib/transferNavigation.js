/** @type {(() => void) | null} */
let navigateHome = null;

/**
 * Register a global Home navigation handler (wired from App.js).
 * @param {(() => void) | null} fn
 */
export function registerTransferNavigateHome(fn) {
  navigateHome = typeof fn === 'function' ? fn : null;
}

/** Source device after transfer-out — return user to Home immediately. */
export function runTransferNavigateHome() {
  try {
    navigateHome?.();
  } catch {
    /* ignore */
  }
}
