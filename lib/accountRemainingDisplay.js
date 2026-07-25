const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Convert backend timing to calendar-style remaining days and cap it at the
 * assigned package duration. Display-only: never changes entitlement.
 */
export function boundAccountRemainingDays({
  remainingMs = null,
  remainingDays = null,
  assignedPlanDurationDays = null,
} = {}) {
  let days = null;
  const ms = Number(remainingMs);
  if (Number.isFinite(ms) && ms > 0) {
    days = Math.max(1, Math.ceil(ms / DAY_MS));
  } else {
    const backendDays = Number(remainingDays);
    if (Number.isFinite(backendDays) && backendDays > 0) {
      days = Math.max(1, Math.ceil(backendDays));
    }
  }
  if (days == null) return null;

  const planDays = Number(assignedPlanDurationDays);
  return Number.isFinite(planDays) && planDays > 0
    ? Math.min(days, Math.trunc(planDays))
    : days;
}

export function formatAccountRemainingDays(days) {
  const n = Number(days);
  if (!Number.isFinite(n) || n <= 0) return 'Kifurushi Kimeisha';
  const whole = Math.max(1, Math.ceil(n));
  return whole === 1 ? 'Siku 1 Imebaki' : `Siku ${whole} Zimebaki`;
}

export const ACCOUNT_REMAINING_DISPLAY_INTERNAL = { DAY_MS };
