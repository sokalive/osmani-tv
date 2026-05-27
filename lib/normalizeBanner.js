import { enrichBannerForViewer } from './bannerViewerSerializer';
import { resolveMediaAssetUrl } from './mediaDelivery';

function parseTs(v) {
  if (v == null || v === '') return null;
  const t = Date.parse(String(v));
  return Number.isFinite(t) ? t : null;
}

/** API booleans may arrive as true/false, 0/1, or "true"/"false" strings. */
function parseBool(v) {
  if (v === true || v === 1) return true;
  if (v === false || v === 0 || v == null) return false;
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase();
    if (s === '' || s === 'false' || s === '0' || s === 'no' || s === 'off') return false;
    if (s === 'true' || s === '1' || s === 'yes' || s === 'on') return true;
  }
  return Boolean(v);
}

function firstDailyHm(raw, keys) {
  for (const key of keys) {
    const hm = parseDailyHm(raw?.[key]);
    if (hm) return hm;
  }
  return null;
}

/** @type {readonly ['center', 'bottom_center', 'bottom_left', 'bottom_right', 'top_left', 'top_right']} */
export const BANNER_RUNTIME_POSITIONS = [
  'center',
  'bottom_center',
  'bottom_left',
  'bottom_right',
  'top_left',
  'top_right',
];

const RUNTIME_POSITION_SET = new Set(BANNER_RUNTIME_POSITIONS);

const RUNTIME_POSITION_RAW_KEYS = [
  'runtime_position',
  'runtimePosition',
  'overlay_position',
  'overlayPosition',
  'runtime_align',
  'runtimeAlign',
];

const BADGE_POSITION_RAW_KEYS = [
  'badge_position',
  'badgePosition',
  'badge_align',
  'badgeAlign',
];

/**
 * @param {Record<string, unknown>} raw
 * @param {readonly string[]} keys
 * @returns {{ key: string | null; value: unknown }}
 */
function readPositionRaw(raw, keys) {
  if (!raw || typeof raw !== 'object') {
    return { key: null, value: null };
  }
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(raw, key)) continue;
    const value = raw[key];
    if (value == null) continue;
    if (typeof value === 'string' && value.trim() === '') continue;
    return { key, value };
  }
  return { key: null, value: null };
}

/**
 * @param {Record<string, unknown>} raw
 * @returns {{ key: string | null; value: unknown }}
 */
export function readRuntimePositionRaw(raw) {
  return readPositionRaw(raw, RUNTIME_POSITION_RAW_KEYS);
}

/**
 * @param {unknown} value
 * @returns {(typeof BANNER_RUNTIME_POSITIONS)[number]}
 */
function normalizePositionValue(value) {
  if (value == null) return 'center';

  const v = String(value)
    .trim()
    .toLowerCase()
    .replace(/^\uFEFF/, '')
    .replace(/^['"]|['"]$/g, '')
    .replace(/[\s-]+/g, '_')
    .replace(/_+/g, '_');

  if (RUNTIME_POSITION_SET.has(v)) {
    return v;
  }

  console.warn('[BANNER_POSITION] unknown position, fallback center', {
    value,
    normalized: v,
  });
  return 'center';
}

/**
 * Visual-only preset for runtime pill overlay alignment.
 *
 * @param {Record<string, unknown>} raw
 * @returns {(typeof BANNER_RUNTIME_POSITIONS)[number]}
 */
export function parseRuntimePosition(raw) {
  const { value } = readRuntimePositionRaw(raw);
  return normalizePositionValue(value);
}

/**
 * Admin red badge overlay alignment (defaults top-left for viewer serializer).
 *
 * @param {Record<string, unknown>} raw
 * @returns {(typeof BANNER_RUNTIME_POSITIONS)[number]}
 */
export function parseBadgePosition(raw) {
  const { value } = readPositionRaw(raw, BADGE_POSITION_RAW_KEYS);
  if (value == null) return 'top_left';
  return normalizePositionValue(value);
}

/**
 * @param {ReturnType<typeof normalizeBanner>} slide
 * @returns {(typeof BANNER_RUNTIME_POSITIONS)[number]}
 */
export function getSlideBadgePosition(slide) {
  const pos = slide?.badgePosition;
  if (typeof pos === 'string' && RUNTIME_POSITION_SET.has(pos)) {
    return pos;
  }
  return 'top_left';
}

/**
 * @param {ReturnType<typeof normalizeBanner>} slide
 * @returns {(typeof BANNER_RUNTIME_POSITIONS)[number]}
 */
export function getSlideRuntimePosition(slide) {
  const pos = slide?.runtimePosition;
  if (typeof pos === 'string' && RUNTIME_POSITION_SET.has(pos)) {
    return pos;
  }
  return 'center';
}

/** @param {string | null | undefined} raw */
function parseDailyHm(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return null;

  let m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(s);
  if (m) {
    const h = Number(m[1]);
    const min = Number(m[2]);
    if (Number.isFinite(h) && Number.isFinite(min) && h >= 0 && h <= 23 && min >= 0 && min <= 59) {
      return { h, min };
    }
  }

  m = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(s);
  if (m) {
    let h = Number(m[1]);
    const min = Number(m[2]);
    const ap = m[3].toUpperCase();
    if (!Number.isFinite(h) || !Number.isFinite(min) || min < 0 || min > 59) return null;
    if (ap === 'PM' && h < 12) h += 12;
    if (ap === 'AM' && h === 12) h = 0;
    if (h < 0 || h > 23) return null;
    return { h, min };
  }

  return null;
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

/** @type {readonly ['coming', 'coming_near', 'live', 'end', 'next_today']} */
export const BANNER_RUNTIME_PHASES = [
  'coming',
  'coming_near',
  'live',
  'end',
  'next_today',
];

const END_WINDOW_MS = 3 * 60 * 1000;
const FAR_COMING_SEC = 6 * 3600;
const NEAR_HOURS_SEC = 3600;

/**
 * @param {number} ms
 */
function localDayKey(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/**
 * Pre-start badge: English wall time when far; Kiswahili relative when close.
 *
 * @param {number} remainingSec
 * @param {number} startMs
 */
export function formatPreStartStatusLine(remainingSec, startMs) {
  const sec = Math.max(0, remainingSec);
  if (sec >= FAR_COMING_SEC) {
    return `COMING SOON ${formatBannerWallTime(startMs)}`;
  }
  if (sec >= NEAR_HOURS_SEC) {
    const hours = Math.max(1, Math.ceil(sec / 3600));
    return `BADO MASAA ${hours} KUANZA`;
  }
  const minutes = Math.max(1, Math.ceil(sec / 60));
  return `BADO DAKIKA ${minutes} KUANZA`;
}

/**
 * @param {number} remainingSec
 */
function preStartPhase(remainingSec) {
  return remainingSec >= FAR_COMING_SEC ? 'coming' : 'coming_near';
}

/**
 * @param {string} statusLine
 * @param {number} remainingSec
 * @param {{ phase?: string; pulse?: boolean }} [opts]
 */
function buildRuntimeState(statusLine, remainingSec, opts = {}) {
  return {
    statusLine,
    subtitleLine: '',
    remainingSec: Math.max(0, Math.ceil(remainingSec)),
    phase: opts.phase ?? 'coming',
    pulse: opts.pulse === true,
  };
}

/**
 * @param {number} nextStartMs
 * @param {number} nowMs
 */
function buildNextTodayStatus(nextStartMs, nowMs) {
  return buildRuntimeState(
    `NEXT TODAY ${formatBannerWallTime(nextStartMs)}`,
    Math.max(0, (nextStartMs - nowMs) / 1000),
    { phase: 'next_today' },
  );
}

/**
 * @param {number} startMs
 * @param {number} nowMs
 */
function buildPreStartStatus(startMs, nowMs) {
  const remainingSec = (startMs - nowMs) / 1000;
  return buildRuntimeState(formatPreStartStatusLine(remainingSec, startMs), remainingSec, {
    phase: preStartPhase(remainingSec),
  });
}

/**
 * @param {number} endMs
 * @param {number} nowMs
 */
function buildLiveStatus(endMs, nowMs) {
  const remainingSec = (endMs - nowMs) / 1000;
  return buildRuntimeState('LIVE NOW', remainingSec, { phase: 'live', pulse: true });
}

/**
 * @param {number} endMs
 * @param {number} nowMs
 * @param {number} nextStartMs
 */
function buildPostEndStatus(endMs, nowMs, nextStartMs) {
  const sinceEndMs = nowMs - endMs;
  if (sinceEndMs <= END_WINDOW_MS) {
    return buildRuntimeState('END', 0, { phase: 'end' });
  }
  if (localDayKey(nowMs) === localDayKey(endMs)) {
    return buildNextTodayStatus(nextStartMs, nowMs);
  }
  return null;
}

/**
 * API → app shape (camelCase). Preserves array index order — do not re-sort.
 *
 * @param {Record<string, unknown>} raw
 * @param {number} index
 */
export function normalizeBanner(raw, index) {
  if (raw && typeof raw === 'object') {
    raw = enrichBannerForViewer(raw);
  }
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

  const imageUrl = resolveMediaAssetUrl(String(raw?.image_url ?? raw?.imageUrl ?? '').trim());

  const badgeEnabled = parseBool(raw?.badge_enabled ?? raw?.badgeEnabled ?? false);
  const badgeBlink = parseBool(raw?.badge_blink ?? raw?.badgeBlink ?? false);
  const badgeColorRaw = String(raw?.badge_color ?? raw?.badgeColor ?? '').trim();
  const badgeColor = badgeColorRaw || '#DC2626';
  const badgeText = String(
    raw?.badge ?? raw?.badge_text ?? raw?.badgeText ?? raw?.badge_label ?? raw?.badgeLabel ?? '',
  ).trim();

  const enableCountdown = parseBool(
    raw?.enable_countdown ??
      raw?.enableCountdown ??
      raw?.countdown_enabled ??
      raw?.countdownEnabled,
  );
  const eventTimer = parseBool(
    raw?.event_timer ?? raw?.eventTimer ?? raw?.event_timer_enabled ?? raw?.eventTimerEnabled,
  );
  const showRedRuntime = parseBool(raw?.show_red_badge ?? raw?.showRedBadge ?? false);
  const useTimer =
    parseBool(raw?.use_timer ?? raw?.useTimer ?? raw?.timer_enabled ?? raw?.timerEnabled) ||
    eventTimer;

  const dailyStartHm = firstDailyHm(raw, [
    'daily_start',
    'dailyStart',
    'startTime',
    'start_time',
    'daily_start_time',
    'dailyStartTime',
  ]);
  const dailyEndHm = firstDailyHm(raw, [
    'daily_end',
    'dailyEnd',
    'endTime',
    'end_time',
    'daily_end_time',
    'dailyEndTime',
  ]);

  const eventStart = parseTs(raw?.event_start ?? raw?.eventStart);
  const eventEnd = parseTs(raw?.event_end ?? raw?.eventEnd);

  const rid = raw?.redirect_channel_id ?? raw?.redirectChannelId;
  const redirectChannelId =
    rid != null && String(rid).trim() !== '' ? String(rid).trim() : null;

  const hasDailyWindow = dailyStartHm != null && dailyEndHm != null;
  /** Daily recurring window: legacy timer flags or admin show_red_badge + daily start/end. */
  const hasDailyTimer =
    hasDailyWindow &&
    (useTimer || enableCountdown || eventTimer || showRedRuntime);
  const hasEventSchedule =
    (enableCountdown || eventTimer || showRedRuntime) &&
    (eventStart != null || eventEnd != null);

  const runtimePositionInput = readRuntimePositionRaw(raw);
  const badgePositionInput = readPositionRaw(raw, BADGE_POSITION_RAW_KEYS);

  return {
    id,
    title,
    description,
    imageUrl,
    badgeEnabled,
    badgeBlink,
    badgeColor,
    badgeText,
    badgePosition: parseBadgePosition(raw),
    badgePositionField: badgePositionInput.key,
    badgePositionRaw: badgePositionInput.value,
    enableCountdown,
    eventTimer,
    showRedRuntime,
    useTimer,
    dailyStartHm,
    dailyEndHm,
    hasDailyTimer,
    hasEventSchedule,
    eventStart,
    eventEnd,
    redirectChannelId,
    runtimePosition: parseRuntimePosition(raw),
    runtimePositionField: runtimePositionInput.key,
    runtimePositionRaw: runtimePositionInput.value,
  };
}

/** @param {ReturnType<typeof normalizeBanner>} slide */
export function bannerNeedsRuntimeTick(slide) {
  if (slide.hasDailyTimer || slide.hasEventSchedule) return true;
  if (slide.eventEnd != null) return true;
  return false;
}

/** @param {ReturnType<typeof normalizeBanner>} slide */
export function bannerShowsRuntimeUi(slide) {
  return slide.hasDailyTimer || slide.hasEventSchedule;
}

function hmToLabel(hm) {
  if (!hm) return null;
  return `${String(hm.h).padStart(2, '0')}:${String(hm.min).padStart(2, '0')}`;
}

/**
 * Full payload trace for one banner (network raw → normalized → runtime).
 *
 * @param {Record<string, unknown>} raw
 * @param {number} [index]
 * @param {number} [nowMs]
 */
export function inspectBannerRuntime(raw, index = 0, nowMs = Date.now()) {
  const slide = normalizeBanner(raw, index);
  const runtime = getBannerRuntimeState(slide, nowMs);
  return {
    id: slide.id,
    title: slide.title,
    raw: {
      useTimer: raw?.useTimer ?? raw?.use_timer ?? null,
      eventTimer: raw?.eventTimer ?? raw?.event_timer ?? null,
      enableCountdown: raw?.enableCountdown ?? raw?.enable_countdown ?? null,
      startTime: raw?.startTime ?? raw?.daily_start ?? raw?.start_time ?? null,
      endTime: raw?.endTime ?? raw?.daily_end ?? raw?.end_time ?? null,
      eventStart: raw?.eventStart ?? raw?.event_start ?? null,
      eventEnd: raw?.eventEnd ?? raw?.event_end ?? null,
      badgeEnabled: raw?.badgeEnabled ?? raw?.badge_enabled ?? null,
      badge: raw?.badge ?? null,
      runtime_position: raw?.runtime_position ?? null,
      runtimePosition: raw?.runtimePosition ?? null,
    },
    normalized: {
      useTimer: slide.useTimer,
      eventTimer: slide.eventTimer,
      enableCountdown: slide.enableCountdown,
      dailyStart: hmToLabel(slide.dailyStartHm),
      dailyEnd: hmToLabel(slide.dailyEndHm),
      hasDailyTimer: slide.hasDailyTimer,
      hasEventSchedule: slide.hasEventSchedule,
      bannerShowsRuntimeUi: bannerShowsRuntimeUi(slide),
      eventStart: slide.eventStart,
      eventEnd: slide.eventEnd,
      runtimePosition: slide.runtimePosition,
      runtimePositionField: slide.runtimePositionField,
      runtimePositionRaw: slide.runtimePositionRaw,
    },
    runtime,
  };
}

/**
 * @param {unknown[]} rawBanners
 * @param {number} [nowMs]
 */
export function logBannerRuntimeDiagnostics(rawBanners, nowMs = Date.now()) {
  if (!Array.isArray(rawBanners)) return;
  rawBanners.forEach((raw, i) => {
    if (!raw || typeof raw !== 'object') return;
    try {
      const diag = inspectBannerRuntime(raw, i, nowMs);
      console.warn('[BANNER_RUNTIME]', JSON.stringify(diag));
      logBannerPositionDiagnostic(raw, i);
    } catch (e) {
      console.warn('[BANNER_RUNTIME]', 'inspect_failed', i, e?.message ?? e);
    }
  });
}

/**
 * @param {Record<string, unknown>} raw
 * @param {number} [index]
 */
export function logBannerPositionDiagnostic(raw, index = 0) {
  const slide = normalizeBanner(raw, index);
  const appliedStyle = getSlideRuntimePosition(slide);
  console.warn(
    '[BANNER_POSITION]',
    JSON.stringify({
      id: slide.id,
      title: slide.title,
      raw: {
        runtime_position: raw?.runtime_position ?? null,
        runtimePosition: raw?.runtimePosition ?? null,
      },
      normalized: {
        runtimePosition: slide.runtimePosition,
        runtimePositionField: slide.runtimePositionField,
        runtimePositionRaw: slide.runtimePositionRaw,
      },
      appliedStyle,
      useCenterStack: appliedStyle === 'center',
    }),
  );
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
  const nextStartMs = todayStartMs + 24 * 60 * 60 * 1000;

  if (nowMs < todayStartMs) {
    return buildPreStartStatus(todayStartMs, nowMs);
  }

  if (nowMs >= todayStartMs && nowMs <= todayEndMs) {
    return buildLiveStatus(todayEndMs, nowMs);
  }

  const postEnd = buildPostEndStatus(todayEndMs, nowMs, nextStartMs);
  if (postEnd) return postEnd;

  return buildPreStartStatus(nextStartMs, nowMs);
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
    return buildPreStartStatus(start, nowMs);
  }

  if (start != null && end != null && nowMs >= start && nowMs <= end) {
    return buildLiveStatus(end, nowMs);
  }

  if (start == null && end != null && nowMs <= end) {
    return buildLiveStatus(end, nowMs);
  }

  if (end != null && nowMs > end) {
    const nextStartMs = start != null ? start + 24 * 60 * 60 * 1000 : end + 24 * 60 * 60 * 1000;
    const postEnd = buildPostEndStatus(end, nowMs, nextStartMs);
    if (postEnd) {
      if (postEnd.phase === 'next_today' && start != null) {
        return buildRuntimeState(
          `NEXT TODAY ${formatBannerWallTime(start)}`,
          Math.max(0, (nextStartMs - nowMs) / 1000),
          { phase: 'next_today' },
        );
      }
      return postEnd;
    }
    return null;
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
  if (slide.hasEventSchedule) {
    return getEventRuntimeState(slide, nowMs) != null;
  }
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
