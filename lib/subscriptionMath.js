/**
 * Pure math for the "Matumizi ya Kifurushi" progress card.
 *
 * Trust model:
 *   - The backend's `active` flag is the ONLY source of truth for whether
 *     playback is allowed. This module never participates in that decision.
 *   - For the visual progress bar / "X siku" countdown we anchor to the
 *     backend's `serverTime`. If the device's clock jumps, the bar drifts
 *     slightly between verifies; the next verify (≤ ~15s in foreground)
 *     resnaps the anchor.
 *   - Date.now() is used here ONLY as a monotonic interpolator (delta
 *     since the last verify), never as truth.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

function parseMs(v) {
  if (v == null) return null;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  const t = Date.parse(String(v));
  return Number.isFinite(t) ? t : null;
}

/**
 * Resolve the subscription start instant in ms.
 *  1. Prefer the backend-supplied `startedAt` / `periodStartAt`.
 *  2. Otherwise derive from `expiresAt - remainingSeconds` (backend truth).
 *  3. Otherwise derive from `expiresAt - displayDurationDays` (computed span).
 *  4. Last resort: `expiresAt - planDurationDays` (catalog only when timing absent).
 *  Return null if neither is available (caller should hide the bar).
 */
export function resolveStartMs({
  startedAt,
  periodStartAt,
  expiresAt,
  planDurationDays,
  displayDurationDays,
  remainingSeconds,
} = {}) {
  const start = parseMs(startedAt) ?? parseMs(periodStartAt);
  if (start != null) return start;
  const end = parseMs(expiresAt);
  const remSec = Number(remainingSeconds);
  if (end != null && Number.isFinite(remSec) && remSec > 0) {
    return end - remSec * 1000;
  }
  const days = Number(displayDurationDays ?? planDurationDays);
  if (end != null && Number.isFinite(days) && days > 0) {
    return end - days * DAY_MS;
  }
  return null;
}

/**
 * Estimate "now" in ms anchored to the backend.
 *
 * @param {string|number|null} serverTime  ISO/ms from the verify response.
 * @param {number|null} serverTimeFetchedAt  Date.now() captured at fetch.
 * @param {number} [nowMsOverride]  For tests; defaults to Date.now().
 */
export function effectiveNowMs(serverTime, serverTimeFetchedAt, nowMsOverride) {
  const localNow = Number.isFinite(nowMsOverride) ? nowMsOverride : Date.now();
  const anchor = parseMs(serverTime);
  if (anchor == null || !Number.isFinite(serverTimeFetchedAt)) return localNow;
  const elapsed = localNow - serverTimeFetchedAt;
  if (!Number.isFinite(elapsed) || elapsed < 0) return anchor;
  return anchor + elapsed;
}

/**
 * Milliseconds until `expiresAt` using backend-anchored "now" (same trust model as
 * {@link computeSubscriptionProgress}). Returns null if `expiresAt` is missing.
 * Value may be negative if already past expiry.
 *
 * @param {{ expiresAt?: string|number|null; serverTime?: string|number|null; serverTimeFetchedAt?: number|null; nowMsOverride?: number|null }} input
 * @returns {number|null}
 */
export function getServerAnchoredRemainingMs(input = {}) {
  const {
    expiresAt = null,
    serverTime = null,
    serverTimeFetchedAt = null,
    nowMsOverride = null,
  } = input;
  const expiresMs = parseMs(expiresAt);
  if (expiresMs == null) return null;
  const nowMs = effectiveNowMs(serverTime, serverTimeFetchedAt, nowMsOverride);
  return expiresMs - nowMs;
}

/**
 * Prefer backend `remaining_seconds` anchored at fetch time (matches verify/SMS),
 * then fall back to expiresAt − server-anchored now.
 *
 * @param {{ expiresAt?: string|number|null; remainingSeconds?: number|null; remaining_seconds?: number|null; serverTime?: string|number|null; serverTimeFetchedAt?: number|null; nowMsOverride?: number|null }} input
 * @returns {number|null}
 */
export function getBackendAnchoredRemainingMs(input = {}) {
  const {
    expiresAt = null,
    remainingSeconds = null,
    remaining_seconds = null,
    serverTime = null,
    serverTimeFetchedAt = null,
    nowMsOverride = null,
  } = input;
  const remSec = Number(remainingSeconds ?? remaining_seconds);
  const nowMs = effectiveNowMs(serverTime, serverTimeFetchedAt, nowMsOverride);
  if (Number.isFinite(remSec) && remSec > 0 && Number.isFinite(serverTimeFetchedAt)) {
    const elapsed = nowMs - serverTimeFetchedAt;
    if (Number.isFinite(elapsed) && elapsed >= 0) {
      return remSec * 1000 - elapsed;
    }
  }
  return getServerAnchoredRemainingMs({
    expiresAt,
    serverTime,
    serverTimeFetchedAt,
    nowMsOverride,
  });
}

/**
 * Compute progress for the "Matumizi ya Kifurushi" card.
 *
 * @returns {{
 *   ok: boolean,
 *   percentRemaining: number, // 0..100
 *   percentUsed: number,      // 0..100
 *   remainingMs: number,
 *   remainingDays: number,    // calendar-style; final partial day is day 1
 *   totalDurationMs: number,
 *   startMs: number|null,
 *   expiresMs: number|null,
 *   nowMs: number,
 * }}
 */
export function computeSubscriptionProgress(input = {}) {
  const {
    startedAt = null,
    periodStartAt = null,
    expiresAt = null,
    planDurationDays = null,
    displayDurationDays = null,
    remainingSeconds = null,
    serverTime = null,
    serverTimeFetchedAt = null,
    nowMsOverride = null,
  } = input;

  const expiresMs = parseMs(expiresAt);
  const startMs = resolveStartMs({
    startedAt,
    periodStartAt,
    expiresAt,
    planDurationDays,
    displayDurationDays,
    remainingSeconds,
  });
  const nowMs = effectiveNowMs(serverTime, serverTimeFetchedAt, nowMsOverride);

  if (expiresMs == null || startMs == null || expiresMs <= startMs) {
    return {
      ok: false,
      percentRemaining: 0,
      percentUsed: 0,
      remainingMs: 0,
      remainingDays: 0,
      totalDurationMs: 0,
      startMs,
      expiresMs,
      nowMs,
    };
  }

  const assignedPlanDays = Number(planDurationDays);
  const periodDurationMs = expiresMs - startMs;
  const totalDurationMs =
    Number.isFinite(assignedPlanDays) && assignedPlanDays > 0
      ? assignedPlanDays * DAY_MS
      : periodDurationMs;
  const rawRemainingMs = getBackendAnchoredRemainingMs({
    expiresAt,
    remainingSeconds,
    serverTime,
    serverTimeFetchedAt,
    nowMsOverride,
  });
  // Stacked legacy expiry can exceed the assigned package duration. Preserve
  // backend entitlement, but cap all visual values to the package itself.
  const remainingMs = Math.min(
    totalDurationMs,
    Math.max(0, rawRemainingMs ?? expiresMs - nowMs),
  );
  const percentRemaining = Math.max(0, Math.min(100, (remainingMs / totalDurationMs) * 100));
  const percentUsed = 100 - percentRemaining;
  const remainingDays =
    remainingMs > 0 ? Math.max(1, Math.ceil(remainingMs / DAY_MS)) : 0;

  return {
    ok: true,
    percentRemaining,
    percentUsed,
    remainingMs,
    remainingDays,
    totalDurationMs,
    startMs,
    expiresMs,
    nowMs,
  };
}

export const SUBSCRIPTION_MATH_INTERNAL = { DAY_MS, parseMs };
