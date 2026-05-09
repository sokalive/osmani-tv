/**
 * Normalises a backend `/api/banners` row into a flat shape the engine
 * (`lib/bannerEngine.js`) and the carousel can consume directly.
 *
 * The engine derives badge text / colour / blink / countdown from
 * schedule state — admin no longer types LIVE NOW / COMING SOON /
 * COMING NEXT / ENDED. The legacy admin badge fields are preserved for
 * unscheduled banners only (state = NONE), where they pass through verbatim
 * so existing pre-engine rows continue to render.
 *
 * Backend wire format (snake_case is canonical, camelCase tolerated):
 *   id, title, description, image_url, is_active, sort_order,
 *   redirect_channel_id,
 *   event_start, event_end,                 — epoch / ISO timestamps
 *   repeat_mode    : 'none' | 'daily',      — NEW (default 'none')
 *   timezone       : IANA tz string | null, — NEW (engine falls back to default)
 *   badge, badge_color, badge_blink, badge_enabled — legacy passthrough
 */

function parseTs(v) {
  if (v == null || v === '') return null;
  const t = Date.parse(String(v));
  return Number.isFinite(t) ? t : null;
}

/**
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

  const imageUrl =
    raw?.image_url != null ? String(raw.image_url).trim() : '';

  const isActiveRaw = raw?.is_active ?? raw?.isActive;
  const isActive = isActiveRaw == null ? true : Boolean(isActiveRaw);

  // --- Schedule fields (engine inputs) ----------------------------------
  const eventStart = parseTs(raw?.event_start ?? raw?.eventStart);
  const eventEnd = parseTs(raw?.event_end ?? raw?.eventEnd);

  const repeatModeRaw = String(
    raw?.repeat_mode ?? raw?.repeatMode ?? 'none',
  ).trim().toLowerCase();
  const repeatMode = repeatModeRaw === 'daily' ? 'daily' : 'none';

  const tzRaw = String(raw?.timezone ?? raw?.scheduleTimezone ?? '').trim();
  const timezone = tzRaw.length > 0 ? tzRaw : null;

  // --- Legacy badge passthrough (engine ignores for scheduled rows) -----
  // Used only when the engine returns state = NONE (banner has no
  // schedule). These keep existing pre-engine rows rendering as-is.
  const legacyBadgeEnabled = Boolean(raw?.badge_enabled ?? raw?.badgeEnabled ?? false);
  const legacyBadgeBlink = Boolean(raw?.badge_blink ?? raw?.badgeBlink ?? false);
  const legacyBadgeColorRaw = String(raw?.badge_color ?? raw?.badgeColor ?? '').trim();
  const legacyBadgeColor = legacyBadgeColorRaw || '#DC2626';
  const legacyBadgeText = String(
    raw?.badge ?? raw?.badge_text ?? raw?.badgeText ?? raw?.badge_label ?? raw?.badgeLabel ?? '',
  ).trim();

  // Optional colour override applied to engine-driven states too
  // (text + blink stay engine-owned). Lets brand banners keep a custom
  // LIVE colour even when the schedule engine takes over.
  const legacyBadgeColorOverride = legacyBadgeColorRaw || null;

  const rid = raw?.redirect_channel_id ?? raw?.redirectChannelId;
  const redirectChannelId =
    rid != null && String(rid).trim() !== '' ? String(rid).trim() : null;

  return {
    id,
    title,
    description,
    imageUrl,
    isActive,

    // Engine inputs
    eventStart,
    eventEnd,
    repeatMode,
    timezone,

    // Legacy passthrough (state=NONE only)
    legacyBadgeEnabled,
    legacyBadgeBlink,
    legacyBadgeColor,
    legacyBadgeText,
    legacyBadgeColorOverride,

    redirectChannelId,
  };
}
