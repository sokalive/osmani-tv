function parseTs(v) {
  if (v == null || v === '') return null;
  const t = Date.parse(String(v));
  return Number.isFinite(t) ? t : null;
}

/** @param {string | null | undefined} raw */
function parseDailyHm(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(s);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(min) || h < 0 || h > 23 || min < 0 || min > 59) {
    return null;
  }
  return { h, min };
}

/**
 * Local calendar time on the same day as `anchorMs`.
 *
 * @param {number} anchorMs
 * @param {{ h: number; min: number }} hm
 */
function localTimeOnDay(anchorMs, hm) {
  const d = new Date(anchorMs);
  d.setHours(hm.h, hm.min, 0, 0);
  return d.getTime();
}

/**
 * @param {number} ms
 */
export function formatBannerWallTime(ms) {
  if (!Number.isFinite(ms)) return '';
  return new Date(ms).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
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

  const imageUrl = String(raw?.image_url ?? raw?.imageUrl ?? '').trim();

  const badgeEnabled = Boolean(raw?.badge_enabled ?? raw?.badgeEnabled ?? false);
  const badgeBlink = Boolean(raw?.badge_blink ?? raw?.badgeBlink ?? false);
  const badgeColorRaw = String(raw?.badge_color ?? raw?.badgeColor ?? '').trim();
  const badgeColor = badgeColorRaw || '#DC2626';
  const badgeText = String(
    raw?.badge ?? raw?.badge_text ?? raw?.badgeText ?? raw?.badge_label ?? raw?.badgeLabel ?? '',
  ).trim();

  const enableCountdown = Boolean(raw?.enable_countdown ?? raw?.enableCountdown ?? false);
  const useTimer = Boolean(
    raw?.use_timer ?? raw?.useTimer ?? raw?.event_timer ?? raw?.eventTimer ?? false,
  );

  const dailyStartHm = parseDailyHm(
    raw?.daily_start ?? raw?.dailyStart ?? raw?.startTime ?? raw?.start_time,
  );
  const dailyEndHm = parseDailyHm(
    raw?.daily_end ?? raw?.dailyEnd ?? raw?.endTime ?? raw?.end_time,
  );

  const eventStart = parseTs(raw?.event_start ?? raw?.eventStart);
  const eventEnd = parseTs(raw?.event_end ?? raw?.eventEnd);

  const rid = raw?.redirect_channel_id ?? raw?.redirectChannelId;
  const redirectChannelId =
    rid != null && String(rid).trim() !== '' ? String(rid).trim() : null;

  const hasDailyTimer = useTimer && dailyStartHm != null && dailyEndHm != null;
  const hasEventSchedule =
    enableCountdown && (eventStart != null || eventEnd != null);

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
    useTimer,
    dailyStartHm,
    dailyEndHm,
    hasDailyTimer,
    hasEventSchedule,
    eventStart,
    eventEnd,
    redirectChannelId,
  };
}

/** @param {ReturnType<typeof normalizeBanner>} slide */
export function bannerNeedsRuntimeTick(slide) {
  if (slide.hasDailyTimer || slide.hasEventSchedule) return true;
  if (slide.eventEnd != null) return true;
  return false;
}

/**
 * Recurring daily window phases (local device timezone).
 *
 * @param {ReturnType<typeof normalizeBanner>} slide
 * @param {number} nowMs
 * @returns {{ statusLine: string; remainingSec: number } | null}
 */
function getDailyTimerRuntimeState(slide, nowMs) {
  const startHm = slide.dailyStartHm;
  const endHm = slide.dailyEndHm;
  if (!startHm || !endHm) return null;

  const todayStartMs = localTimeOnDay(nowMs, startHm);
  let todayEndMs = localTimeOnDay(nowMs, endHm);
  if (todayEndMs <= todayStartMs) {
    todayEndMs += 24 * 60 * 60 * 1000;
  }

  if (nowMs < todayStartMs) {
    return {
      statusLine: `COMING SOON ${formatBannerWallTime(todayStartMs)}`,
      remainingSec: Math.max(0, Math.ceil((todayStartMs - nowMs) / 1000)),
    };
  }

  if (nowMs >= todayStartMs && nowMs <= todayEndMs) {
    return {
      statusLine: 'LIVE NOW',
      remainingSec: Math.max(0, Math.ceil((todayEndMs - nowMs) / 1000)),
    };
  }

  const tomorrowStartMs = localTimeOnDay(nowMs + 24 * 60 * 60 * 1000, startHm);
  return {
    statusLine: `NEXT COMING SOON ${formatBannerWallTime(tomorrowStartMs)}`,
    remainingSec: Math.max(0, Math.ceil((tomorrowStartMs - nowMs) / 1000)),
  };
}

/**
 * One-shot event window (ISO timestamps).
 *
 * @param {ReturnType<typeof normalizeBanner>} slide
 * @param {number} nowMs
 * @returns {{ statusLine: string; remainingSec: number } | null}
 */
function getEventRuntimeState(slide, nowMs) {
  const start = slide.eventStart;
  const end = slide.eventEnd;

  if (start != null && nowMs < start) {
    return {
      statusLine: `COMING SOON ${formatBannerWallTime(start)}`,
      remainingSec: Math.max(0, Math.ceil((start - nowMs) / 1000)),
    };
  }

  if (start != null && end != null && nowMs >= start && nowMs <= end) {
    return {
      statusLine: 'LIVE NOW',
      remainingSec: Math.max(0, Math.ceil((end - nowMs) / 1000)),
    };
  }

  if (start == null && end != null && nowMs <= end) {
    return {
      statusLine: 'LIVE NOW',
      remainingSec: Math.max(0, Math.ceil((end - nowMs) / 1000)),
    };
  }

  return null;
}

/**
 * Osmani TV banner phase: status line + countdown target.
 *
 * @param {ReturnType<typeof normalizeBanner>} slide
 * @param {number} nowMs
 * @returns {{ statusLine: string; remainingSec: number } | null}
 */
export function getBannerRuntimeState(slide, nowMs) {
  if (slide.hasDailyTimer) {
    return getDailyTimerRuntimeState(slide, nowMs);
  }
  if (slide.hasEventSchedule) {
    return getEventRuntimeState(slide, nowMs);
  }
  return null;
}

/**
 * Hide one-shot event banners after `eventEnd`. Daily timers always stay visible.
 *
 * @param {ReturnType<typeof normalizeBanner>} slide
 * @param {number} nowMs
 */
export function isBannerVisibleAt(slide, nowMs) {
  if (slide.hasDailyTimer) return true;

  const start = slide.eventStart;
  const end = slide.eventEnd;
  if (start == null && end == null) return true;
  if (end != null && nowMs > end) return false;
  if (start != null && end == null) return nowMs >= start;
  if (start == null && end != null) return nowMs <= end;
  return true;
}

/**
 * @deprecated Use getBannerRuntimeState — kept for any external imports.
 * @param {ReturnType<typeof normalizeBanner>} slide
 * @param {number} nowMs
 */
export function getCountdownState(slide, nowMs) {
  const runtime = getBannerRuntimeState(slide, nowMs);
  if (!runtime) return null;
  const prefix = runtime.statusLine.replace(/\s+\d{1,2}:\d{2}\s*(AM|PM)$/i, '').trim();
  return { prefix, remainingSec: runtime.remainingSec };
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
