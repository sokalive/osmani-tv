import { PUBLISHED_PLAY_VERSION_CODE } from './parseUpdateCheckResponse';
import { readNativeAndroidVersionCode } from './playVpsApiHost';
import { resolveMediaAssetUrl } from './mediaDelivery';

const VIDEO_NAME = 'video';

/**
 * Admin marks the instruction channel named VIDEO (or sets instruction_video flag).
 * @param {unknown} row
 */
export function isInstructionVideoChannel(row) {
  if (!row || typeof row !== 'object') return false;
  const kind = String(row.channel_kind ?? row.channelKind ?? '')
    .trim()
    .toLowerCase();
  if (kind === 'instruction_video') return true;
  if (row.instruction_video === true || row.instructionVideo === true) return true;
  if (row.is_instruction_video === true || row.isInstructionVideo === true) return true;
  const name = String(row.name ?? row.title ?? '').trim().toLowerCase();
  return name === VIDEO_NAME;
}

function pickString(row, keys) {
  if (!row || typeof row !== 'object') return '';
  for (const key of keys) {
    const v = row[key];
    if (v != null && String(v).trim()) return String(v).trim();
  }
  return '';
}

function looksLikeInstructionVideoAsset(url) {
  const s = String(url ?? '').trim();
  if (!s) return false;
  const path = s.split(/[#?]/)[0].toLowerCase();
  return (
    path.startsWith('/uploads/') ||
    /\.(?:mp4|webm|mov|m4v)(?:$|[?#])/i.test(path)
  );
}

/**
 * Instruction VIDEO uses uploaded file URL — never live stream_url / HLS backups.
 * @param {unknown} row
 * @returns {string}
 */
export function pickInstructionVideoUrl(row) {
  if (!row || typeof row !== 'object') return '';
  const explicit = pickString(row, [
    'instruction_video_url',
    'instructionVideoUrl',
    'video_url',
    'videoUrl',
  ]);
  if (explicit) return explicit;

  const playback = pickString(row, ['playbackUrl', 'playback_url']);
  if (playback && looksLikeInstructionVideoAsset(playback)) return playback;

  const url = pickString(row, ['url', 'stream_url', 'streamUrl']);
  if (url && looksLikeInstructionVideoAsset(url)) return url;

  return explicit || url || playback;
}

/**
 * Resolved HTTPS/CDN URI for instruction video playback.
 * @param {unknown} row
 * @returns {string}
 */
export function resolveInstructionVideoUrl(row) {
  return resolveMediaAssetUrl(pickInstructionVideoUrl(row));
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
    ['hide_v24', 'hide_from_v24', 'hide_latest', 'latest_only', 'v24_hide', 'hide_from_latest', 'hide_v24_plus'].includes(
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
  const videoUrl = resolveInstructionVideoUrl(raw);
  return {
    ...playerChannel,
    url: videoUrl || playerChannel.url,
    stream_url: videoUrl || playerChannel.stream_url,
    videoUrl,
    video_url: videoUrl,
    playbackUrl: videoUrl,
    playback_url: videoUrl,
    backupStream1: '',
    backup_stream_1: '',
    backupStream2: '',
    backup_stream_2: '',
    streamDeliveryMode: 'direct',
    stream_delivery_mode: 'direct',
    playerType: 'exo',
    player_type: 'exo',
    channel_kind: 'instruction_video',
    channelKind: 'instruction_video',
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
