/** @type {number | null} */
let bootEpochMs = null;

const marks = new Map();

/**
 * Call once at JS entry (before React).
 */
export function markAppBootStart() {
  if (bootEpochMs == null) bootEpochMs = Date.now();
}

/**
 * @param {string} tag
 * @param {Record<string, unknown>} [extra]
 */
export function logStartupPaint(tag, extra = {}) {
  try {
    const now = Date.now();
    const bootMs = bootEpochMs != null ? now - bootEpochMs : null;
    const prev = marks.get(tag);
    marks.set(tag, now);
    console.log('[startup-paint]', tag, {
      bootMs,
      sincePrevMs: prev != null ? now - prev : null,
      ...extra,
    });
  } catch {
    /* ignore */
  }
}

/**
 * @returns {Record<string, number>}
 */
export function getStartupPaintMarks() {
  return Object.fromEntries(marks.entries());
}
