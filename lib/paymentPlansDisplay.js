/**
 * Payment plan display helpers — instant UI defaults + API/cache normalization.
 * Defaults mirror production VPS /api/plans (api.osmanitv.com) for offline/slow paths.
 */

/** Shown immediately when cache/network unavailable — real plan ids from VPS admin. */
export const DEFAULT_FALLBACK_PLANS = Object.freeze([
  { id: '3', name: 'Wiki 1', price: 3000, duration: '7', isActive: true },
  { id: '4', name: 'MWENZI 1', price: 5000, duration: '30', isActive: true },
  { id: '5', name: 'MIEZI 2', price: 15000, duration: '60', isActive: true },
  { id: '6', name: 'MWAKA', price: 40000, duration: '365', isActive: true },
]);

/**
 * @param {unknown} raw
 * @returns {{ id: string; name: string; price: number; duration: string; isActive: boolean }}
 */
export function normalizePlanRow(raw) {
  if (!raw || typeof raw !== 'object') {
    return { id: '', name: '', price: 0, duration: '', isActive: false };
  }
  const row = /** @type {Record<string, unknown>} */ (raw);
  if (row.id && row.name && row.price != null && row.isActive === true && !row.durationDays) {
    return {
      id: String(row.id).trim(),
      name: String(row.name).trim(),
      price: Number(row.price),
      duration: String(row.duration ?? '').trim(),
      isActive: true,
    };
  }
  const explicitlyInactive = row.is_active === false || row.isActive === false;
  const active =
    row.is_active === true ||
    row.isActive === true ||
    (!explicitlyInactive && row.id != null && row.price != null);
  return {
    id: String(row.id ?? row.plan_id ?? '').trim(),
    name: String(row.name ?? row.title ?? '').trim(),
    price: Number(row.price ?? row.amount ?? 0),
    duration: String(
      row.duration_days ??
        row.durationDays ??
        row.days ??
        row.validity_days ??
        row.validityDays ??
        row.period_days ??
        row.periodDays ??
        row.duration ??
        row.duration_label ??
        row.duration_text ??
        '',
    ).trim(),
    isActive: active,
  };
}

/**
 * @param {unknown} raw
 * @returns {ReturnType<typeof normalizePlanRow>[]}
 */
export function parsePlansFromRaw(raw) {
  let rows = [];
  if (Array.isArray(raw)) rows = raw;
  else if (raw && typeof raw === 'object') {
    const obj = /** @type {Record<string, unknown>} */ (raw);
    if (Array.isArray(obj.plans)) rows = obj.plans;
    else if (Array.isArray(obj.data)) rows = obj.data;
  }
  return rows
    .map(normalizePlanRow)
    .filter((p) => p.isActive && p.id && Number.isFinite(p.price) && p.price > 0);
}

/**
 * @param {ReturnType<typeof normalizePlanRow>[]} list
 * @returns {ReturnType<typeof normalizePlanRow>[]}
 */
export function mergeWithFallbackPlans(list) {
  const valid = Array.isArray(list) ? list.filter((p) => p?.id && p.price > 0) : [];
  if (valid.length > 0) return valid;
  return [...DEFAULT_FALLBACK_PLANS];
}

/**
 * @param {ReturnType<typeof normalizePlanRow> | null | undefined} plan
 * @returns {number}
 */
export function resolvePlanPrice(plan) {
  const price = Number(plan?.price);
  if (Number.isFinite(price) && price > 0) return price;
  return DEFAULT_FALLBACK_PLANS[0].price;
}

/**
 * User-facing plan load error — never expose internal timeout labels.
 *
 * @param {unknown} err
 * @returns {string}
 */
export function formatPlansLoadError(err) {
  const msg = String(err?.message ?? err ?? '').trim();
  if (!msg || msg === 'payment-plans' || msg === 'plans-timeout' || /timeout/i.test(msg)) {
    return '';
  }
  return msg;
}
