import { resolveChannelBackupPlaybackUrl } from './hlsPlayback';
import {
  enrichPlayerChannelInstructionVideo,
  isInstructionVideoChannel,
} from './instructionVideoChannel';
import {
  readStreamDeliveryFields,
  resolveChannelPlaybackPlan,
} from './streamDelivery';

/**
 * @param {Record<string, unknown>} raw
 * @param {number} index
 * @param {boolean} freeMode
 */
export function buildPlayerChannelFromRow(raw, index, freeMode) {
  const name = raw?.name != null ? String(raw.name) : `Channel ${index + 1}`;
  const channelId =
    raw?.id != null
      ? String(raw.id)
      : raw?._id != null
        ? String(raw._id)
        : raw?.channel_id != null
          ? String(raw.channel_id)
          : '';
  const isPremiumApi =
    raw?.accessType === 'premium' ||
    Boolean(raw?.accessPremium === true || raw?.access_premium === true);

  const rawUrl =
    typeof raw?.url === 'string' && raw.url.trim()
      ? raw.url.trim()
      : typeof raw?.stream_url === 'string' && raw.stream_url.trim()
        ? raw.stream_url.trim()
        : '';
  const playbackUrl =
    typeof raw?.playbackUrl === 'string' && raw.playbackUrl.trim()
      ? raw.playbackUrl.trim()
      : typeof raw?.playback_url === 'string' && raw.playback_url.trim()
        ? raw.playback_url.trim()
        : '';
  const streamProxyPrimary =
    raw?.streamProxy && typeof raw.streamProxy === 'object' && raw.streamProxy !== null
      ? String(raw.streamProxy.primaryUrl ?? raw.streamProxy.primary_url ?? '').trim()
      : '';

  const referer =
    typeof raw?.referer === 'string' && raw.referer.trim()
      ? raw.referer.trim()
      : typeof raw?.referrer === 'string' && raw.referrer.trim()
        ? raw.referrer.trim()
        : '';
  const origin =
    typeof raw?.origin === 'string' && raw.origin.trim()
      ? raw.origin.trim()
      : typeof raw?.stream_origin === 'string' && raw.stream_origin.trim()
        ? raw.stream_origin.trim()
        : '';
  const userAgent =
    typeof raw?.userAgent === 'string' && raw.userAgent.trim()
      ? raw.userAgent.trim()
      : typeof raw?.user_agent === 'string' && raw.user_agent.trim()
        ? raw.user_agent.trim()
        : '';

  const headerInput = { referer, origin, userAgent };
  const delivery = readStreamDeliveryFields(raw);
  const playbackPlan = resolveChannelPlaybackPlan({
    rawUrl,
    playbackUrl,
    streamProxyPrimary,
    directStreamUrl: delivery.directStreamUrl,
    proxyFallbackUrl: delivery.proxyFallbackUrl,
    deliveryMode: delivery.deliveryMode,
    ...headerInput,
  });
  const primaryUrl = playbackPlan.playUrl;

  const backup1Raw =
    typeof raw?.backupStream1 === 'string' && raw.backupStream1.trim()
      ? raw.backupStream1.trim()
      : typeof raw?.backup_stream_1 === 'string' && raw.backup_stream_1.trim()
        ? raw.backup_stream_1.trim()
        : '';
  const backup2Raw =
    typeof raw?.backupStream2 === 'string' && raw.backupStream2.trim()
      ? raw.backupStream2.trim()
      : typeof raw?.backup_stream_2 === 'string' && raw.backup_stream_2.trim()
        ? raw.backup_stream_2.trim()
        : '';
  const backup1 = resolveChannelBackupPlaybackUrl(backup1Raw, headerInput);
  const backup2 = resolveChannelBackupPlaybackUrl(backup2Raw, headerInput);

  const playerType =
    raw?.playerType != null
      ? String(raw.playerType)
      : raw?.player_type != null
        ? String(raw.player_type)
        : 'exo';
  const base = {
    id: channelId,
    channel_id: channelId,
    name,
    url: primaryUrl,
    stream_url: primaryUrl,
    streamDeliveryMode: playbackPlan.deliveryMode,
    stream_delivery_mode: playbackPlan.deliveryMode,
    directStreamUrl: playbackPlan.directUrl,
    direct_stream_url: playbackPlan.directUrl,
    proxyFallbackUrl: playbackPlan.proxyFallbackUrl,
    proxy_fallback_url: playbackPlan.proxyFallbackUrl,
    backupStream1: backup1,
    backup_stream_1: backup1,
    backupStream2: backup2,
    backup_stream_2: backup2,
    origin,
    referer,
    userAgent,
    user_agent: userAgent,
    playerType,
    player_type: playerType,
    accessType: freeMode ? 'free' : isPremiumApi ? 'premium' : 'free',
    accessPremium: freeMode ? false : isPremiumApi,
  };
  if (isInstructionVideoChannel(raw)) {
    return enrichPlayerChannelInstructionVideo(base, raw);
  }
  return base;
}

/**
 * @param {unknown[]} rawChannels
 * @param {string} channelId
 * @returns {{ raw: Record<string, unknown>; index: number } | null}
 */
export function findRawChannelById(rawChannels, channelId) {
  const sid = String(channelId).trim();
  if (!sid) return null;
  const list = Array.isArray(rawChannels) ? rawChannels : [];
  for (let i = 0; i < list.length; i++) {
    const c = list[i];
    if (!c || typeof c !== 'object') continue;
    const id = c.id != null ? String(c.id) : c._id != null ? String(c._id) : '';
    if (id === sid) return { raw: c, index: i };
  }
  return null;
}
