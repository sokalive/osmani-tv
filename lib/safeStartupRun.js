/**
 * Never let optional startup work crash the app process.
 * @param {string} tag
 * @param {() => void | Promise<void>} fn
 */
export function safeStartupRun(tag, fn) {
  try {
    const result = fn();
    if (result && typeof result.then === 'function') {
      void result.catch((e) => {
        try {
          console.log('[startup-safe]', tag, e?.message ?? e);
        } catch {
          /* ignore */
        }
      });
    }
  } catch (e) {
    try {
      console.log('[startup-safe]', tag, e?.message ?? e);
    } catch {
      /* ignore */
    }
  }
}
