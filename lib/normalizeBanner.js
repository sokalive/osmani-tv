import { BASE_URL } from '../api';

function parseTs(v) {
  if (v == null || v === '') return null;
  const t = Date.parse(String(v));
  return Number.isFinite(t) ? t : null;
}

function firstDefinedTs(...candidates) {
  for (const c of candidates) {
    const t = parseTs(c);
    if (t != null) return t;
  }
  return null;
}

function resolveImageUri(rawImg, baseUrl) {
  const s = String(rawImg ?? '').trim();
  if (!s) return '';
  if (s.startsWith('http')) return s;
  if (s.startsWith('/')) return `${baseUrl}${s}`;
  return `${baseUrl}/${s}`;
}

/**
 * @param {Record<string, unknown>} raw
 * @param {number} index
 * @param {string} [baseUrl]
 */
export function normalizeBanner(raw, index, baseUrl = BASE_URL) {
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

  const rawImg =
    raw?.image_url != null
      ? String(raw.image_url).trim()
      : raw?.imageUrl != null
        ? String(raw.imageUrl).trim()
        : raw?.image != null
          ? String(raw.image).trim()
          : '';

  const imageUri = resolveImageUri(rawImg, baseUrl);

  const badgeEnabled = Boolean(raw?.badge_enabled ?? raw?.badgeEnabled ?? false);
  const badgeBlink = Boolean(raw?.badge_blink ?? raw?.badgeBlink ?? false);
  const badgeColor = String(raw?.badge_color ?? raw?.badgeColor ?? '#DC2626').trim() || '#DC2626';
  const badgeText = String(
    raw?.badge_text ?? raw?.badgeText ?? raw?.badge_label ?? raw?.badgeLabel ?? '',
  ).trim();

  const enableCountdown = Boolean(raw?.enable_countdown ?? raw?.enableCountdown ?? false);
  const startsAt = firstDefinedTs(
    raw?.starts_at,
    raw?.startsAt,
    raw?.start_at,
    raw?.startAt,
    raw?.event_start,
    raw?.eventStart,
    raw?.countdown_start,
    raw?.countdownStart,
  );
  const endsAt = firstDefinedTs(
    raw?.ends_at,
    raw?.endsAt,
    raw?.end_at,
    raw?.endAt,
    raw?.event_end,
    raw?.eventEnd,
    raw?.countdown_end,
    raw?.countdownEnd,
  );

  const rid = raw?.redirect_channel_id ?? raw?.redirectChannelId;
  const redirectChannelId =
    rid != null && String(rid).trim() !== '' ? String(rid).trim() : null;

  return {
    id,
    title,
    description,
    imageUri,
    badgeEnabled,
    badgeBlink,
    badgeColor,
    badgeText,
    enableCountdown,
    startsAt,
    endsAt,
    redirectChannelId,
  };
}

/**
 * @param {ReturnType<typeof normalizeBanner>} slide
 * @param {number} nowMs
 * @returns {{ prefix: string; remainingSec: number } | null}
 */
export function getCountdownState(slide, nowMs) {
  if (!slide.enableCountdown) return null;
  const start = slide.startsAt;
  const end = slide.endsAt;
  if (start != null && nowMs < start) {
    return { prefix: 'STARTS IN', remainingSec: Math.max(0, Math.ceil((start - nowMs) / 1000)) };
  }
  if (end != null && nowMs <= end) {
    const eventStarted = start == null || nowMs >= start;
    if (!eventStarted) return null;
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
