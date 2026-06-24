import { PUBLISHED_PLAY_VERSION_CODE } from './parseUpdateCheckResponse';
import { readNativeAndroidVersionCode } from './playVpsApiHost';

const VIDEO_NAME = 'video';

/**
 * Admin marks the instruction channel named VIDEO (or sets instruction_video flag).
 * @param {unknown} row
 */
export function isInstructionVideoChannel(row) {
  if (!row || typeof row !== 'object') return false;
  if (row.instruction_video === true || row.instructionVideo === true) return true;
  if (row.is_instruction_video === true || row.isInstructionVideo === true) return true;
  const name = String(row.name ?? row.title ?? '').trim().toLowerCase();
  return name === VIDEO_NAME;
}

function pickVisibilityMode(row) {
  const raw =
    row?.instruction_video_visibility ??
    row?.instructionVideoVisibility ??
    row?.video_visibility ??
    row?.videoVisibility ??
    row?.instruction_visibility ??
    row?.instructionVisibility ??
    'all';
  const t = String(raw ?? 'all').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (['below_v24', 'below_latest', 'legacy_only', 'legacy', 'below_v_24'].includes(t)) {
    return 'below_v24';
  }
  if (
    ['hide_v24', 'hide_from_v24', 'hide_latest', 'latest_only', 'v24_hide', 'hide_from_latest'].includes(
      t,
    )
  ) {
    return 'hide_v24';
  }
  return 'all';
}

/**
 * @param {unknown} row
 * @param {number} [installedVersionCode]
 */
export function instructionVideoVisibleForInstall(row, installedVersionCode) {
  if (!isInstructionVideoChannel(row)) return true;
  const vc =
    Number.isFinite(installedVersionCode) && installedVersionCode > 0
      ? installedVersionCode
      : readNativeAndroidVersionCode() ?? 0;
  const mode = pickVisibilityMode(row);
  if (mode === 'below_v24') return vc > 0 && vc < PUBLISHED_PLAY_VERSION_CODE;
  if (mode === 'hide_v24') return vc > 0 && vc < PUBLISHED_PLAY_VERSION_CODE;
  return true;
}

/** @param {unknown} channel */
export function isPortraitInstructionVideoChannel(channel) {
  if (!channel || typeof channel !== 'object') return false;
  if (!isInstructionVideoChannel(channel)) return false;
  if (channel.instructionVideoPortrait === true || channel.instruction_video_portrait === true) {
    return true;
  }
  return true;
}

function pickString(row, keys) {
  if (!row || typeof row !== 'object') return '';
  for (const key of keys) {
    const v = row[key];
    if (v != null && String(v).trim()) return String(v).trim();
  }
  return '';
}

/** @param {unknown} row */
export function instructionVideoOfflineEnabled(row) {
  if (!isInstructionVideoChannel(row)) return false;
  return (
    row.offline_enabled === true ||
    row.offlineEnabled === true ||
    row.cacheable === true ||
    row.downloadable === true ||
    row.offline_playback === true ||
    row.offlinePlayback === true
  );
}

/** @param {unknown} row */
export function pickInstructionVideoOfflineUrl(row) {
  if (!instructionVideoOfflineEnabled(row)) return '';
  return pickString(row, [
    'offline_url',
    'offlineUrl',
    'download_url',
    'downloadUrl',
    'cached_url',
    'cachedUrl',
    'offline_video_url',
    'offlineVideoUrl',
  ]);
}

/**
 * Force instruction VIDEO channels to free access + portrait metadata on player object.
 * @param {Record<string, unknown>} playerChannel
 * @param {unknown} raw
 */
export function enrichPlayerChannelInstructionVideo(playerChannel, raw) {
  if (!isInstructionVideoChannel(raw)) return playerChannel;
  const offlineUrl = pickInstructionVideoOfflineUrl(raw);
  return {
    ...playerChannel,
    accessType: 'free',
    access_type: 'free',
    accessPremium: false,
    access_premium: false,
    isPremium: false,
    instructionVideo: true,
    instruction_video: true,
    instructionVideoPortrait: true,
    instruction_video_portrait: true,
    instructionVideoOffline: instructionVideoOfflineEnabled(raw),
    instruction_video_offline: instructionVideoOfflineEnabled(raw),
    offlineUrl: offlineUrl || playerChannel.offlineUrl || '',
    offline_url: offlineUrl || playerChannel.offline_url || '',
  };
}
