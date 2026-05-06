function parseTs(v) {
  if (v == null || v === '') return null;
  const t = Date.parse(String(v));
  return Number.isFinite(t) ? t : null;
}

/**
 * API → app shape (camelCase). Preserves array index order — do not re-sort.
 *
 * @param {Record<string, unknown>} raw
 * @param {number} index
 */
export function normalizeBanner(raw, index) {
  const id =
    raw?.id != null
      ? String(raw.id)
      : raw?._id != null
        ? String(raw._id)
        : `banner-${index}`;

  const title = raw?.title != null ? String(raw.title).trim() : '';
  const description =
    raw?.description != null && String(raw.description).trim() !== ''
      ? String(raw.description).trim()
      : '';

  /** Use `image_url` as sent by the API (no static/demo URLs). */
  const imageUrl =
    raw?.image_url != null ? String(raw.image_url).trim() : '';

  const badgeEnabled = Boolean(raw?.badge_enabled ?? raw?.badgeEnabled ?? false);
  const badgeBlink = Boolean(raw?.badge_blink ?? raw?.badgeBlink ?? false);
  const badgeColorRaw = String(raw?.badge_color ?? raw?.badgeColor ?? '').trim();
  const badgeColor = badgeColorRaw || '#DC2626';
  const badgeText = String(
    raw?.badge ?? raw?.badge_text ?? raw?.badgeText ?? raw?.badge_label ?? raw?.badgeLabel ?? '',
  ).trim();

  const enableCountdown = Boolean(raw?.enable_countdown ?? raw?.enableCountdown ?? false);

  const eventStart = parseTs(raw?.event_start ?? raw?.eventStart);
  const eventEnd = parseTs(raw?.event_end ?? raw?.eventEnd);

  const rid = raw?.redirect_channel_id ?? raw?.redirectChannelId;
  const redirectChannelId =
    rid != null && String(rid).trim() !== '' ? String(rid).trim() : null;

  return {
    id,
    title,
    description,
    imageUrl,
    badgeEnabled,
    badgeBlink,
    badgeColor,
    badgeText,
    enableCountdown,
    eventStart,
    eventEnd,
    redirectChannelId,
  };
}

/**
 * Hide banners outside the event window. After `event_end`, never render.
 * Before `event_start`, still render when `event_end` is set (so "STARTS IN" can show).
 * When only `event_start` is set, render from that time onward.
 *
 * @param {ReturnType<typeof normalizeBanner>} slide
 * @param {number} nowMs
 */
export function isBannerVisibleAt(slide, nowMs) {
  const start = slide.eventStart;
  const end = slide.eventEnd;
  if (start == null && end == null) return true;
  if (end != null && nowMs > end) return false;
  if (start != null && end == null) return nowMs >= start;
  if (start == null && end != null) return nowMs <= end;
  return true;
}

/**
 * @param {ReturnType<typeof normalizeBanner>} slide
 * @param {number} nowMs
 * @returns {{ prefix: string; remainingSec: number } | null}
 */
export function getCountdownState(slide, nowMs) {
  if (!slide.enableCountdown) return null;
  const start = slide.eventStart;
  const end = slide.eventEnd;

  if (start != null && nowMs < start) {
    return { prefix: 'STARTS IN', remainingSec: Math.max(0, Math.ceil((start - nowMs) / 1000)) };
  }
  if (start != null && end != null && nowMs >= start && nowMs <= end) {
    return { prefix: 'ENDS IN', remainingSec: Math.max(0, Math.ceil((end - nowMs) / 1000)) };
  }
  return null;
}

/**
 * @param {number} totalSec
 */
export function formatCountdownClock(totalSec) {
  const s = Math.max(0, Math.floor(totalSec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  }
  return `${m}:${String(sec).padStart(2, '0')}`;
}
