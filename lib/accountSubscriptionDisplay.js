/**
 * Account screen subscription card display — backend fields first, catalog fill for gaps only.
 */

import { normalizePaymentPlansList } from './paymentPlansCache';

function hasValue(value) {
  if (value == null) return false;
  if (typeof value === 'string') return value.trim() !== '';
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

function pickNumber(...candidates) {
  for (const c of candidates) {
    if (c == null) continue;
    const n = typeof c === 'number' ? c : Number(c);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

/**
 * @param {unknown} raw
 * @returns {import('./paymentPlansCache').NormalizedPaymentPlan[]}
 */
export function collectPlanCatalogSources(details, catalogPlans = []) {
  const fromDetails = Array.isArray(details?.plans) ? details.plans : [];
  return normalizePaymentPlansList([...fromDetails, ...(catalogPlans ?? [])]);
}

/**
 * @param {Record<string, unknown>|null|undefined} details
 * @param {unknown[]} [catalogPlans]
 */
export function findCatalogPlanForDetails(details, catalogPlans = []) {
  if (!details || typeof details !== 'object') return null;
  const catalog = collectPlanCatalogSources(details, catalogPlans);
  if (!catalog.length) return null;

  const wantId = String(details.planId ?? details.plan_id ?? '').trim();
  if (wantId) {
    const byId = catalog.find((p) => p.id === wantId);
    if (byId) return byId;
  }

  const wantName = String(details.planName ?? details.plan_name ?? '').trim().toLowerCase();
  if (wantName) {
    const byName = catalog.find((p) => String(p.name ?? '').trim().toLowerCase() === wantName);
    if (byName) return byName;
  }

  return catalog.length === 1 ? catalog[0] : null;
}

/**
 * Fill missing plan metadata from verify `plans` or payment-plans cache (display only).
 *
 * @param {Record<string, unknown>|null|undefined} details
 * @param {unknown[]} [catalogPlans]
 * @returns {Record<string, unknown>|null}
 */
export function enrichSubscriptionDetailsForDisplay(details, catalogPlans = []) {
  if (!details || typeof details !== 'object') return details ?? null;
  const catalogPlan = findCatalogPlanForDetails(details, catalogPlans);
  if (!catalogPlan) return { ...details };

  const catalogDurationDays = pickNumber(catalogPlan.duration);
  const catalogPrice = pickNumber(catalogPlan.price);

  return {
    ...details,
    planName: hasValue(details.planName) ? details.planName : catalogPlan.name || null,
    planId: details.planId ?? details.plan_id ?? catalogPlan.id ?? null,
    amount: pickNumber(details.amount) ?? (catalogPrice != null && catalogPrice > 0 ? catalogPrice : null),
    currency: details.currency ?? 'TZS',
    planDurationDays:
      pickNumber(details.planDurationDays, details.plan_duration_days) ??
      (catalogDurationDays != null && catalogDurationDays > 0 ? catalogDurationDays : null),
    plan_duration_days:
      pickNumber(details.plan_duration_days, details.planDurationDays) ??
      (catalogDurationDays != null && catalogDurationDays > 0 ? catalogDurationDays : null),
  };
}

/**
 * @param {number|string|null|undefined} amount
 * @param {string|null|undefined} currency
 */
export function formatAccountPackagePrice(amount, currency) {
  if (amount == null || amount === '') return null;
  const n =
    typeof amount === 'number' && Number.isFinite(amount)
      ? amount
      : Number(String(amount).replace(/,/g, ''));
  if (!Number.isFinite(n)) return null;
  const code = String(currency || '').toUpperCase();
  const prefix = code === 'TZS' || code === '' ? 'TSh' : code;
  let formatted;
  try {
    formatted = n.toLocaleString('en-US');
  } catch {
    formatted = String(n);
  }
  return `${prefix} ${formatted}`;
}

/**
 * Malipo / Kifurushi card — package name + amount when both exist.
 *
 * @param {Record<string, unknown>|null|undefined} details
 * @param {unknown[]} [catalogPlans]
 */
export function formatAccountPackageLabel(details, catalogPlans = []) {
  if (!details) return null;
  const enriched = enrichSubscriptionDetailsForDisplay(details, catalogPlans);
  const name = String(enriched?.planName ?? '').trim();
  const price = formatAccountPackagePrice(enriched?.amount, enriched?.currency);

  if (name && price) return `${name} · ${price}`;
  if (name) return name;
  if (price) return price;
  return null;
}
