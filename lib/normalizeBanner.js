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
 * East African Swahili clock (saa) from local 24h time.
 *
 * @param {number} hour24
 * @returns {{ saa: number; period: string }}
 */
function getSwahiliSaaParts(hour24) {
  let period;
  if (hour24 >= 7 && hour24 < 12) {
    period = 'Asubuhi';
  } else if (hour24 >= 12 && hour24 < 16) {
    period = 'Mchana';
  } else if (hour24 >= 16 && hour24 < 19) {
    period = 'Jioni';
  } else {
    period = 'Usiku';
  }

  /** 16:00 is still "saa 10" — afternoon drama slots use Mchana, not Jioni. */
  if (hour24 === 16) {
    period = 'Mchana';
  }

  let saa;
  if (hour24 >= 7 && hour24 < 19) {
    saa = hour24 - 6;
  } else if (hour24 >= 19) {
    saa = hour24 - 18;
  } else {
    saa = hour24 + 6;
  }

  return { saa, period };
}

/**
 * Swahili wall clock, e.g. "saa 4 Usiku", "saa 10 Mchana".
 *
 * @param {number} ms
 */
export function formatSwahiliSaaWallTime(ms) {
  if (!Number.isFinite(ms)) return '';
  const d = new Date(ms);
  const hour24 = d.getHours();
  const minute = d.getMinutes();
  const { saa, period } = getSwahiliSaaParts(hour24);
  if (minute > 0) {
    return `saa ${saa} na dakika ${minute} ${period}`;
  }
  return `saa ${saa} ${period}`;
}

/** @param {number} ms */
export function formatSwahiliKeshoTime(ms) {
  const sw = formatSwahiliSaaWallTime(ms);
  return sw ? `Kesho ${sw}` : '';
}

/**
 * Natural Kiswahili countdown phrasing (kuanza | kuisha).
 *
 * @param {number} remainingSec
 * @param {'kuanza' | 'kuisha'} suffix
 */
export function formatSwahiliRemaining(remainingSec, suffix) {
  let s = Math.max(1, Math.ceil(remainingSec));
  const days = Math.floor(s / 86400);
  if (days >= 1) {
    return days === 1 ? `Bado siku 1 ${suffix}` : `Bado siku ${days} ${suffix}`;
  }

  const hours = Math.floor((s % 86400) / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const seconds = s % 60;

  if (hours >= 2) {
    if (minutes > 0) {
      return `Bado masaa ${hours} na dakika ${minutes} ${suffix}`;
    }
    return `Bado masaa ${hours} ${suffix}`;
  }
  if (hours === 1) {
    if (minutes > 0) {
      return `Bado saa 1 na dakika ${minutes} ${suffix}`;
    }
    return `Bado saa 1 ${suffix}`;
  }
  if (minutes >= 1) {
    return minutes === 1 ? `Bado dakika 1 ${suffix}` : `Bado dakika ${minutes} ${suffix}`;
  }
  return seconds === 1 ? `Bado sekunde 1 ${suffix}` : `Bado sekunde ${seconds} ${suffix}`;
}

/**
 * @param {number} remainingSec
 */
export function formatSwahiliLiveSubtitle(remainingSec) {
  if (remainingSec < 120) {
    return 'Inaendelea sasa hivi';
  }
  return formatSwahiliRemaining(remainingSec, 'kuisha');
}

/**
 * @param {string} statusLine
 * @param {string} subtitleLine
 * @param {number} remainingSec
 */
function buildRuntimeState(statusLine, subtitleLine, remainingSec) {
  return {
    statusLine,
    subtitleLine,
    remainingSec: Math.max(0, Math.ceil(remainingSec)),
  };
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
 * @returns {{ statusLine: string; subtitleLine: string; remainingSec: number } | null}
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
    const remainingSec = (todayStartMs - nowMs) / 1000;
    return buildRuntimeState(
      `COMING SOON ${formatBannerWallTime(todayStartMs)}`,
      formatSwahiliRemaining(remainingSec, 'kuanza'),
      remainingSec,
    );
  }

  if (nowMs >= todayStartMs && nowMs <= todayEndMs) {
    const remainingSec = (todayEndMs - nowMs) / 1000;
    return buildRuntimeState(
      'LIVE NOW',
      formatSwahiliLiveSubtitle(remainingSec),
      remainingSec,
    );
  }

  const tomorrowStartMs = localTimeOnDay(nowMs + 24 * 60 * 60 * 1000, startHm);
  const remainingSec = (tomorrowStartMs - nowMs) / 1000;
  return buildRuntimeState(
    `NEXT COMING SOON ${formatBannerWallTime(tomorrowStartMs)}`,
    formatSwahiliKeshoTime(tomorrowStartMs),
    remainingSec,
  );
}

/**
 * One-shot event window (ISO timestamps).
 *
 * @param {ReturnType<typeof normalizeBanner>} slide
 * @param {number} nowMs
 * @returns {{ statusLine: string; subtitleLine: string; remainingSec: number } | null}
 */
function getEventRuntimeState(slide, nowMs) {
  const start = slide.eventStart;
  const end = slide.eventEnd;

  if (start != null && nowMs < start) {
    const remainingSec = (start - nowMs) / 1000;
    return buildRuntimeState(
      `COMING SOON ${formatBannerWallTime(start)}`,
      formatSwahiliRemaining(remainingSec, 'kuanza'),
      remainingSec,
    );
  }

  if (start != null && end != null && nowMs >= start && nowMs <= end) {
    const remainingSec = (end - nowMs) / 1000;
    return buildRuntimeState(
      'LIVE NOW',
      formatSwahiliLiveSubtitle(remainingSec),
      remainingSec,
    );
  }

  if (start == null && end != null && nowMs <= end) {
    const remainingSec = (end - nowMs) / 1000;
    return buildRuntimeState(
      'LIVE NOW',
      formatSwahiliLiveSubtitle(remainingSec),
      remainingSec,
    );
  }

  return null;
}

/**
 * Osmani TV banner phase: status line + countdown target.
 *
 * @param {ReturnType<typeof normalizeBanner>} slide
 * @param {number} nowMs
 * @returns {{ statusLine: string; subtitleLine: string; remainingSec: number } | null}
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
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  }
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}
