import { safeStartupRun } from './safeStartupRun';
import { logStartupPaint } from './startupPaintDiagnostics';

/**
 * Run optional startup work after the first frame — never block Home paint.
 * Uses rAF + setTimeout(0) instead of InteractionManager (can stall on cold start).
 *
 * @param {string} tag
 * @param {() => void | Promise<void>} fn
 */
export function deferStartupTask(tag, fn) {
  safeStartupRun(`${tag}:schedule`, () => {
    logStartupPaint(`defer_schedule:${tag}`);
    requestAnimationFrame(() => {
      setTimeout(() => {
        logStartupPaint(`defer_run:${tag}`);
        safeStartupRun(tag, fn);
      }, 0);
    });
  });
}
