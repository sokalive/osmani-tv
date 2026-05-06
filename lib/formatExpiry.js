export function formatSubscriptionExpiry(iso) {
  if (!iso) return '—';
  const t = Date.parse(String(iso));
  if (!Number.isFinite(t)) return String(iso);
  try {
    return new Intl.DateTimeFormat('sw-TZ', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(t));
  } catch {
    return String(iso);
  }
}
