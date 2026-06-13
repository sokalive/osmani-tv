/**
 * Swahili remaining-subscription countdown for Akaunti Yangu stat card.
 * Uses backend-anchored remainingMs (from subscriptionMath).
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;
const SECOND_MS = 1000;

/**
 * @param {number|null|undefined} remainingMs Milliseconds until expiry (may be negative).
 * @returns {string}
 */
export function formatSubscriptionRemainingCountdown(remainingMs) {
  const ms = Number(remainingMs);
  if (!Number.isFinite(ms) || ms <= 0) {
    return 'Kifurushi Kimeisha';
  }

  if (ms >= DAY_MS) {
    const days = Math.floor(ms / DAY_MS);
    if (days === 1) return 'Siku 1 Imebaki';
    return `Siku ${days} Zimebaki`;
  }

  if (ms >= HOUR_MS) {
    const hours = Math.floor(ms / HOUR_MS);
    if (hours === 1) return 'Saa 1 Imebaki';
    return `Masaa ${hours} Yamebaki`;
  }

  if (ms >= MINUTE_MS) {
    const minutes = Math.floor(ms / MINUTE_MS);
    if (minutes === 1) return 'Dakika 1 Imebaki';
    return `Dakika ${minutes} Zimebaki`;
  }

  const seconds = Math.max(1, Math.floor(ms / SECOND_MS));
  if (seconds === 1) return 'Sekunde 1 Imebaki';
  return `Sekunde ${seconds} Zimebaki`;
}
