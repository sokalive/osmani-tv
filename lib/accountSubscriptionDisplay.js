/**
 * Account screen subscription card display — backend fields first, catalog fill for gaps only.
 */

import {
  enrichCanonicalSubscriptionTiming,
  resolveCanonicalExpiresAt,
  resolveDisplayDurationDays,
} from './subscriptionCanonical';
import { getBackendAnchoredRemainingMs } from './subscriptionMath';
import { boundAccountRemainingDays } from './accountRemainingDisplay';
import { normalizePaymentPlansList } from './paymentPlansCache';
import { traceAccountDisplay } from './accountDisplayTrace';

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

function parseCatalogPlanDurationDays(plan) {
  if (!plan) return null;
  return pickNumber(
    plan.duration,
    plan.duration_days,
    plan.durationDays,
    plan.days,
    plan.plan_duration_days,
    plan.planDurationDays,
  );
}

/**
 * Checkout plan selected in PremiumModal — fills sparse verify/SSE payloads.
 *
 * @param {Record<string, unknown>|null|undefined} subscription
 * @param {{ id?: string; name?: string; price?: number; duration?: string|number }|null|undefined} selectedPlan
 */
export function mergeCheckoutPlanIntoSubscription(subscription, selectedPlan) {
  if (!selectedPlan) return subscription ?? null;
  const base = subscription && typeof subscription === 'object' ? { ...subscription } : {};
  const durationDays = parseCatalogPlanDurationDays(selectedPlan);
  const catalogRow = {
    id: selectedPlan.id ?? null,
    name: selectedPlan.name ?? null,
    price: selectedPlan.price ?? null,
    duration_days: durationDays,
    durationDays,
    isActive: true,
    is_active: true,
  };
  const existingPlans = Array.isArray(base.plans) ? base.plans : [];
  return {
    ...base,
    planName: hasValue(base.planName) ? base.planName : selectedPlan.name ?? null,
    planId: hasValue(base.planId) ? base.planId : selectedPlan.id ?? null,
    amount:
      pickNumber(base.amount) ??
      (Number.isFinite(Number(selectedPlan.price)) && Number(selectedPlan.price) > 0
        ? Number(selectedPlan.price)
        : null),
    currency: base.currency ?? 'TZS',
    planDurationDays: pickNumber(base.planDurationDays, base.plan_duration_days) ?? durationDays,
    plan_duration_days: pickNumber(base.plan_duration_days, base.planDurationDays) ?? durationDays,
    plans: existingPlans.length > 0 ? existingPlans : [catalogRow],
  };
}

/**
 * @param {unknown} raw
 * @returns {import('./paymentPlansCache').NormalizedPaymentPlan[]}
 */
export function collectPlanCatalogSources(details, catalogPlans = []) {
  const fromDetails = Array.isArray(details?.plans) ? details.plans : [];
  const merged = normalizePaymentPlansList([...fromDetails, ...(catalogPlans ?? [])]);
  const seen = new Set();
  return merged.filter((p) => {
    if (!p?.id || seen.has(p.id)) return false;
    seen.add(p.id);
    return true;
  });
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

  const wantDuration = pickNumber(
    details.displayDurationDays,
    details.planDurationDays,
    details.plan_duration_days,
  );
  if (wantDuration != null && wantDuration > 0) {
    const byDuration = catalog.filter((p) => parseCatalogPlanDurationDays(p) === wantDuration);
    if (byDuration.length === 1) return byDuration[0];
  }

  return catalog.length === 1 ? catalog[0] : null;
}

/**
 * Duration of the plan currently assigned to this subscription.
 *
 * Old stacked subscriptions can have a period span (startedAt → expiresAt)
 * larger than the package itself. Account UI must display package metadata,
 * never that accumulated span.
 */
export function resolveAssignedPlanDurationDays(details, catalogPlans = []) {
  if (!details || typeof details !== 'object') return null;
  const catalogPlan = findCatalogPlanForDetails(details, catalogPlans);
  const duration = pickNumber(
    parseCatalogPlanDurationDays(catalogPlan),
    details.planDurationDays,
    details.plan_duration_days,
  );
  return duration != null && duration > 0 ? Math.trunc(duration) : null;
}

/**
 * Calendar-style remaining days for Account UI. The final partial day is day
 * 1, and the value is capped at the assigned plan duration. This is display
 * only; it never changes entitlement or expiry.
 */
export function resolveAccountRemainingDays(
  details,
  subscriptionExpiresAt = null,
  catalogPlans = [],
  nowMsOverride = null,
) {
  if (!details || typeof details !== 'object') return null;
  const assignedDurationDays = resolveAssignedPlanDurationDays(details, catalogPlans);
  // Prefer backend entitlement calendar days (midnight EAT policy) so Account
  // matches the assigned package (e.g. 3 on purchase day, never a floored 2).
  const backendDays = pickNumber(
    details.entitlement_remaining_days,
    details.entitlementRemainingDays,
    details.remainingDays,
    details.remaining_days,
  );
  if (backendDays != null && backendDays > 0) {
    return boundAccountRemainingDays({
      remainingDays: backendDays,
      assignedPlanDurationDays: assignedDurationDays,
    });
  }

  const expiresAt = resolveCanonicalExpiresAt(details, subscriptionExpiresAt);
  const remainingMs = getBackendAnchoredRemainingMs({
    expiresAt,
    remainingSeconds: details.remainingSeconds ?? details.remaining_seconds ?? null,
    serverTime: details.serverTime ?? null,
    serverTimeFetchedAt: details.serverTimeFetchedAt ?? null,
    nowMsOverride,
  });

  return boundAccountRemainingDays({
    remainingMs,
    remainingDays: null,
    assignedPlanDurationDays: assignedDurationDays,
  });
}

/**
 * Account Box 4 expiry — always the backend canonical `expires_at`.
 * Never invent or recalculate a display date from plan duration / remaining days.
 *
 * @param {Record<string, unknown>|null|undefined} details
 * @param {string|null|undefined} subscriptionExpiresAt
 * @param {unknown[]} [_catalogPlans] unused — kept for call-site compatibility
 * @param {number|null} [_nowMsOverride] unused — kept for call-site compatibility
 * @returns {string|null}
 */
export function resolveAccountDisplayExpiresAt(
  details,
  subscriptionExpiresAt = null,
  _catalogPlans = [],
  _nowMsOverride = null,
) {
  return resolveCanonicalExpiresAt(details, subscriptionExpiresAt);
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

  const durationDays = resolveDisplayDurationDays(enriched);
  if (durationDays != null) {
    const catalogPlan = findCatalogPlanForDetails(enriched, catalogPlans);
    if (catalogPlan?.name) {
      const catalogPrice = formatAccountPackagePrice(catalogPlan.price, enriched?.currency ?? 'TZS');
      if (catalogPrice) return `${catalogPlan.name} · ${catalogPrice}`;
      return String(catalogPlan.name);
    }
    return `${durationDays} siku`;
  }
  return null;
}

/**
 * Malipo box (Box 1) — price ONLY, sourced from the assigned Admin plan.
 * Never includes plan name or duration (e.g. never `Siku 3 · TSh 1,000`).
 * Returns strings like `TSh 1,000` / `TSh 3,000` / `TSh 5,000`, or null.
 *
 * @param {Record<string, unknown>|null|undefined} details
 * @param {unknown[]} [catalogPlans]
 */
export function formatAccountPackagePriceLabel(details, catalogPlans = []) {
  if (!details) return null;
  const enriched = enrichSubscriptionDetailsForDisplay(details, catalogPlans);
  const price = formatAccountPackagePrice(enriched?.amount, enriched?.currency);
  if (price) return price;
  const catalogPlan = findCatalogPlanForDetails(enriched, catalogPlans);
  if (catalogPlan) {
    const catalogPrice = formatAccountPackagePrice(
      catalogPlan.price,
      enriched?.currency ?? 'TZS',
    );
    if (catalogPrice) return catalogPrice;
  }
  return null;
}

/**
 * Unified Account display object — merges top-level expiry, canonical timing, catalog fill.
 *
 * @param {Record<string, unknown>|null|undefined} subscriptionDetails
 * @param {string|null|undefined} subscriptionExpiresAt
 * @param {unknown[]} [catalogPlans]
 */
export function buildAccountDisplayDetails(
  subscriptionDetails,
  subscriptionExpiresAt = null,
  catalogPlans = [],
) {
  const expiresAt = resolveCanonicalExpiresAt(subscriptionDetails, subscriptionExpiresAt);
  const base =
    subscriptionDetails && typeof subscriptionDetails === 'object'
      ? { ...subscriptionDetails, expiresAt }
      : { expiresAt };
  const timed = enrichCanonicalSubscriptionTiming(base);
  const enriched = enrichSubscriptionDetailsForDisplay(timed, catalogPlans);
  const assignedPlanDurationDays = resolveAssignedPlanDurationDays(enriched, catalogPlans);
  traceAccountDisplay('buildAccountDisplayDetails', {
    planName: enriched?.planName ?? null,
    amount: enriched?.amount ?? null,
    planDurationDays: enriched?.planDurationDays ?? null,
    displayDurationDays: enriched?.displayDurationDays ?? null,
    planId: enriched?.planId ?? null,
    expiresAt: enriched?.expiresAt ?? null,
    catalogCount: collectPlanCatalogSources(enriched, catalogPlans).length,
  });
  return {
    ...enriched,
    assignedPlanDurationDays,
  };
}
