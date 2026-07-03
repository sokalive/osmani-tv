/**
 * Temporary Account card pipeline tracing — enable with EXPO_PUBLIC_ACCOUNT_DISPLAY_DEBUG=1
 * or __DEV__ builds.
 */

function tracingEnabled() {
  if (typeof __DEV__ !== 'undefined' && __DEV__) return true;
  try {
    return process.env.EXPO_PUBLIC_ACCOUNT_DISPLAY_DEBUG === '1';
  } catch {
    return false;
  }
}

/**
 * @param {string} stage
 * @param {Record<string, unknown>} [fields]
 */
export function traceAccountDisplay(stage, fields = {}) {
  if (!tracingEnabled()) return;
  console.log(
    '[ACCOUNT_DISPLAY_TRACE]',
    stage,
    JSON.stringify({
      ...fields,
      ts: Date.now(),
    }),
  );
}
