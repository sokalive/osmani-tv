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
 *  1. Prefer the backend-supplied `startedAt`.
 *  2. Otherwise derive from `expiresAt - planDurationDays`.
 *  3. Return null if neither is available (caller should hide the bar).
 */
export function resolveStartMs({ startedAt, expiresAt, planDurationDays } = {}) {
  const start = parseMs(startedAt);
  if (start != null) return start;
  const end = parseMs(expiresAt);
  const days = Number(planDurationDays);
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
 * Compute progress for the "Matumizi ya Kifurushi" card.
 *
 * @returns {{
 *   ok: boolean,
 *   percentRemaining: number, // 0..100
 *   percentUsed: number,      // 0..100
 *   remainingMs: number,
 *   remainingDays: number,    // ceil
 *   totalDurationMs: number,
 *   startMs: number|null,
 *   expiresMs: number|null,
 *   nowMs: number,
 * }}
 */
export function computeSubscriptionProgress(input = {}) {
  const {
    startedAt = null,
    expiresAt = null,
    planDurationDays = null,
    serverTime = null,
    serverTimeFetchedAt = null,
    nowMsOverride = null,
  } = input;

  const expiresMs = parseMs(expiresAt);
  const startMs = resolveStartMs({ startedAt, expiresAt, planDurationDays });
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

  const totalDurationMs = expiresMs - startMs;
  const remainingMs = Math.max(0, expiresMs - nowMs);
  const percentRemaining = Math.max(0, Math.min(100, (remainingMs / totalDurationMs) * 100));
  const percentUsed = 100 - percentRemaining;
  const remainingDays = Math.max(0, Math.ceil(remainingMs / DAY_MS));

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
