/**
 * Shared banner viewer serializer (used by lib/ and backend/lib/ copies).
 *
 * Mobile app: passthrough — preserve admin timer/schedule fields for runtime overlays.
 */

export const RED_BADGE = '#DC2626';

/**
 * @param {Record<string, unknown>} row
 * @returns {Record<string, unknown>}
 */
export function enrichBannerForViewer(row) {
  if (!row || typeof row !== 'object') return row;
  return { ...row };
}

/**
 * @param {unknown} value
 * @returns {unknown}
 */
export function enrichBannersForViewer(value) {
  if (!Array.isArray(value)) return value;
  return value.map((row) => enrichBannerForViewer(row));
}
