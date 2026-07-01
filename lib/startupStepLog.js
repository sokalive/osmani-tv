/** Ordered startup diagnostics — first failure is logged as [STARTUP_FAIL_FIRST]. */

let stepOrder = 0;
/** @type {Record<string, unknown> | null} */
let firstFailure = null;

/**
 * @param {string} step
 * @param {'start' | 'ok' | 'fail' | 'skip'} status
 * @param {Record<string, unknown>} [detail]
 */
export function logStartupStep(step, status, detail = {}) {
  const entry = {
    order: (stepOrder += 1),
    step,
    status,
    at: Date.now(),
    ...detail,
  };
  try {
    console.log('[STARTUP_STEP]', JSON.stringify(entry));
  } catch {
    console.log('[STARTUP_STEP]', step, status);
  }
  if (status === 'fail' && !firstFailure) {
    firstFailure = entry;
    try {
      console.error('[STARTUP_FAIL_FIRST]', JSON.stringify(entry));
    } catch {
      console.error('[STARTUP_FAIL_FIRST]', step);
    }
  }
  return entry;
}

/** @returns {Record<string, unknown> | null} */
export function getFirstStartupFailure() {
  return firstFailure;
}

export function resetStartupStepLog() {
  stepOrder = 0;
  firstFailure = null;
}
