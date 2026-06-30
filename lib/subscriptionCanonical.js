/**
 * Canonical subscription timing for Account display.
 * Backend `expires_at` + `remaining_seconds` are authoritative.
 * Plan catalog `duration_days` is package metadata only — never used to
 * infer expiry or active period length when backend timing is present.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

function parseMs(v) {
  if (v == null) return null;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  const t = Date.parse(String(v));
  return Number.isFinite(t) ? t : null;
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
 * @param {Record<string, unknown>|null|undefined} input
 */
export function enrichCanonicalSubscriptionTiming(input = {}) {
  if (!input || typeof input !== 'object') return input;

  const expiresAt = input.expiresAt ?? input.expires_at ?? null;
  const expiresMs = parseMs(expiresAt);
  const startedAtRaw = input.startedAt ?? input.started_at ?? null;
  let startedMs = parseMs(startedAtRaw);

  const remainingSeconds = pickNumber(
    input.remainingSeconds,
    input.remaining_seconds,
  );
  const remainingDays = pickNumber(input.remainingDays, input.remaining_days);
  const planDurationDays = pickNumber(
    input.displayDurationDays,
    input.planDurationDays,
    input.plan_duration_days,
  );

  if (startedMs == null && expiresMs != null && remainingSeconds != null && remainingSeconds > 0) {
    startedMs = expiresMs - remainingSeconds * 1000;
  }

  let displayDurationDays = null;
  if (startedMs != null && expiresMs != null && expiresMs > startedMs) {
    displayDurationDays = Math.max(1, Math.ceil((expiresMs - startedMs) / DAY_MS));
  } else if (remainingSeconds != null && remainingSeconds > 0) {
    displayDurationDays = Math.max(1, Math.ceil(remainingSeconds / 86400));
  } else {
    displayDurationDays = pickNumber(input.planDurationDays, input.plan_duration_days);
  }

  const periodStartAt =
    startedMs != null ? new Date(startedMs).toISOString() : input.periodStartAt ?? null;

  return {
    ...input,
    expiresAt: expiresAt != null ? String(expiresAt) : null,
    startedAt: periodStartAt,
    periodStartAt,
    displayDurationDays: displayDurationDays ?? null,
    remainingSeconds: remainingSeconds ?? null,
    remainingDays:
      remainingDays ??
      (remainingSeconds != null && remainingSeconds > 0
        ? Math.max(0, Math.ceil(remainingSeconds / 86400))
        : null),
  };
}

/**
 * Unified expiry for all Account cards (never mix top-level state vs details).
 * @param {Record<string, unknown>|null|undefined} details
 * @param {string|null|undefined} subscriptionExpiresAt
 */
export function resolveCanonicalExpiresAt(details, subscriptionExpiresAt = null) {
  const fromDetails = details?.expiresAt ?? details?.expires_at ?? null;
  if (fromDetails != null && String(fromDetails).trim() !== '') return String(fromDetails);
  if (subscriptionExpiresAt != null && String(subscriptionExpiresAt).trim() !== '') {
    return String(subscriptionExpiresAt);
  }
  return null;
}

/**
 * Duration stat card — active period from backend expiry window only.
 * @param {Record<string, unknown>|null|undefined} details
 */
export function resolveDisplayDurationDays(details) {
  if (!details || typeof details !== 'object') return null;
  const display = pickNumber(details.displayDurationDays);
  if (display != null && display > 0) return Math.trunc(display);
  const expiresMs = parseMs(details.expiresAt ?? details.expires_at);
  const remainingSeconds = pickNumber(details.remainingSeconds, details.remaining_seconds);
  let startMs = parseMs(details.periodStartAt ?? details.startedAt ?? details.started_at);
  if (startMs == null && expiresMs != null && remainingSeconds != null && remainingSeconds > 0) {
    startMs = expiresMs - remainingSeconds * 1000;
  }
  if (expiresMs != null && startMs != null && expiresMs > startMs) {
    return Math.max(1, Math.ceil((expiresMs - startMs) / DAY_MS));
  }
  if (remainingSeconds != null && remainingSeconds > 0) {
    return Math.max(1, Math.ceil(remainingSeconds / 86400));
  }
  const catalog = pickNumber(details.planDurationDays, details.plan_duration_days);
  return catalog != null && catalog > 0 ? Math.trunc(catalog) : null;
}

export const SUBSCRIPTION_CANONICAL_INTERNAL = { DAY_MS, parseMs };
