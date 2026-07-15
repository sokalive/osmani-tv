import { formatSubscriptionExpiry } from './formatExpiry';

/**
 * Build success-popup rows from backend subscription fields only.
 * No local expiry/remaining calculation.
 *
 * @param {object|null|undefined} subscription
 * @param {{ name?: string; price?: number; duration?: string|number }|null} [planFallback]
 */
export function buildPaymentSuccessDetails(subscription, planFallback = null) {
  const planName =
    subscription?.planName ??
    subscription?.plan_name ??
    planFallback?.name ??
    null;

  const amountRaw = subscription?.amount ?? planFallback?.price ?? null;
  const amount = Number.isFinite(Number(amountRaw)) ? Number(amountRaw) : null;

  const currency = subscription?.currency != null ? String(subscription.currency) : 'TZS';

  const planDurationDaysRaw =
    subscription?.planDurationDays ??
    subscription?.plan_duration_days ??
    null;
  const planDurationDays = Number.isFinite(Number(planDurationDaysRaw))
    ? Number(planDurationDaysRaw)
    : null;

  const startedAt =
    subscription?.startedAt ??
    subscription?.started_at ??
    subscription?.activatedAt ??
    subscription?.activated_at ??
    null;

  const expiresAt = subscription?.expiresAt ?? subscription?.expires_at ?? null;

  const remainingDaysRaw =
    subscription?.remainingDays ??
    subscription?.remaining_days ??
    subscription?.entitlement_remaining_days ??
    subscription?.entitlementRemainingDays ??
    null;
  const remainingDays = Number.isFinite(Number(remainingDaysRaw))
    ? Number(remainingDaysRaw)
    : null;

  return {
    planName: planName != null ? String(planName).trim() : null,
    amount,
    currency,
    planDurationDays,
    startedAt: startedAt != null ? String(startedAt) : null,
    expiresAt: expiresAt != null ? String(expiresAt) : null,
    remainingDays,
  };
}

export function formatPaymentAmount(amount, currency = 'TZS') {
  if (!Number.isFinite(amount)) return '—';
  try {
    const formatted = new Intl.NumberFormat('en-TZ', { maximumFractionDigits: 0 }).format(amount);
    return `${currency} ${formatted}`;
  } catch {
    return `${currency} ${amount}`;
  }
}

export function formatBackendDurationDays(planDurationDays) {
  if (!Number.isFinite(planDurationDays)) return '—';
  return `${planDurationDays} siku`;
}

export function formatBackendRemainingDays(remainingDays) {
  if (!Number.isFinite(remainingDays)) return '—';
  return `${remainingDays} siku`;
}

export function formatBackendDateTime(iso) {
  return formatSubscriptionExpiry(iso);
}

/** DD/MM/YYYY for payment success body (Swahili handoff). */
export function formatExpiryDateDMY(iso) {
  if (!iso) return '—';
  const t = Date.parse(String(iso));
  if (!Number.isFinite(t)) return String(iso);
  const d = new Date(t);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = String(d.getFullYear());
  return `${dd}/${mm}/${yyyy}`;
}
