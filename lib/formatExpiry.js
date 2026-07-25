/** Africa/Dar_es_Salaam is UTC+3 year-round (no DST). */
const EAT_OFFSET_MS = 3 * 60 * 60 * 1000;

const MONTHS_EN = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/**
 * Wall-clock parts in Africa/Dar_es_Salaam.
 * Hermes/Android Intl often ignores `timeZone`, so we shift UTC manually.
 */
export function toDarEsSalaamParts(iso) {
  if (!iso) return null;
  const t = Date.parse(String(iso));
  if (!Number.isFinite(t)) return null;
  const d = new Date(t + EAT_OFFSET_MS);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
    second: d.getUTCSeconds(),
  };
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

/**
 * Account / subscription expiry: always Tanzania midnight-capable wall clock.
 * Example: `29 Jul 2026, 00:00`
 */
export function formatSubscriptionExpiry(iso) {
  if (!iso) return '—';
  const p = toDarEsSalaamParts(iso);
  if (!p) return String(iso);
  return `${p.day} ${MONTHS_EN[p.month - 1]} ${p.year}, ${pad2(p.hour)}:${pad2(p.minute)}`;
}

export const FORMAT_EXPIRY_INTERNAL = { EAT_OFFSET_MS, toDarEsSalaamParts };
