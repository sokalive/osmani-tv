/**
 * Admin catalog order — matches backend fields on /api/channels (sort_order / sortOrder).
 * Preserves API array order when no numeric order field is present.
 */

/**
 * @param {Record<string, unknown>} raw
 * @returns {number|null}
 */
export function readChannelSortOrder(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const candidates = [
    raw.sort_order,
    raw.sortOrder,
    raw.display_order,
    raw.displayOrder,
    raw.position,
    raw.order_index,
    raw.orderIndex,
  ];
  for (const v of candidates) {
    if (v == null || v === '') continue;
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

/**
 * @param {Record<string, unknown>} a
 * @param {Record<string, unknown>} b
 */
export function compareChannelsByAdminOrder(a, b) {
  const oa = readChannelSortOrder(a);
  const ob = readChannelSortOrder(b);
  if (oa != null && ob != null && oa !== ob) return oa - ob;
  if (oa != null && ob == null) return -1;
  if (oa == null && ob != null) return 1;
  const ia = Number(a?.id);
  const ib = Number(b?.id);
  if (Number.isFinite(ia) && Number.isFinite(ib) && ia !== ib) return ia - ib;
  return 0;
}

/**
 * Stable admin order for channel lists (does not reorder when keys tie).
 * @param {unknown[]} list
 * @param {{ preserveApiIndex?: boolean }} [opts]
 */
export function sortChannelsByAdminOrder(list, opts = {}) {
  const { preserveApiIndex = true } = opts;
  if (!Array.isArray(list) || list.length <= 1) return Array.isArray(list) ? [...list] : [];

  const indexed = list.map((raw, index) => ({
    raw,
    index,
    order: readChannelSortOrder(raw),
  }));

  indexed.sort((a, b) => {
    if (a.order != null && b.order != null && a.order !== b.order) {
      return a.order - b.order;
    }
    if (a.order != null && b.order == null) return -1;
    if (a.order == null && b.order != null) return 1;
    if (preserveApiIndex) return a.index - b.index;
    return compareChannelsByAdminOrder(a.raw, b.raw);
  });

  return indexed.map((row) => row.raw);
}
