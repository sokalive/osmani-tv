import { resolveChannelBackupPlaybackUrl } from './hlsPlayback';
import {
  isDirectHlsPlayerType,
  resolveDirectHlsBackupUrl,
} from './directHlsPlayback';
import {
  enrichPlayerChannelInstructionVideo,
  isInstructionVideoChannel,
  resolveInstructionVideoUrl,
} from './instructionVideoChannel';
import {
  channelAccessDeniedByServer,
  sanitizeCatalogChannelForClient,
} from './playbackEntitlementClient';
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
  const safeRaw =
    raw && typeof raw === 'object' ? sanitizeCatalogChannelForClient(raw) : raw;
  const name = safeRaw?.name != null ? String(safeRaw.name) : `Channel ${index + 1}`;
  const channelId =
    safeRaw?.id != null
      ? String(safeRaw.id)
      : safeRaw?._id != null
        ? String(safeRaw._id)
        : safeRaw?.channel_id != null
          ? String(safeRaw.channel_id)
          : '';
  const isPremiumApi =
    safeRaw?.accessType === 'premium' ||
    Boolean(safeRaw?.accessPremium === true || safeRaw?.access_premium === true);
  const serverAccessDenied = channelAccessDeniedByServer(safeRaw);
  const accessDenyReason = String(safeRaw?.access_deny_reason ?? '').trim() || null;

  if (isInstructionVideoChannel(safeRaw)) {
    const videoUrl = resolveInstructionVideoUrl(safeRaw);
    const playerType = 'exo';
    const base = {
      id: channelId,
      channel_id: channelId,
      name,
      url: videoUrl,
      stream_url: videoUrl,
      videoUrl,
      video_url: videoUrl,
      playbackUrl: videoUrl,
      playback_url: videoUrl,
      streamDeliveryMode: 'direct',
      stream_delivery_mode: 'direct',
      directStreamUrl: videoUrl,
      direct_stream_url: videoUrl,
      proxyFallbackUrl: '',
      proxy_fallback_url: '',
      backupStream1: '',
      backup_stream_1: '',
      backupStream2: '',
      backup_stream_2: '',
      origin: '',
      referer: '',
      userAgent: '',
      user_agent: '',
      playerType,
      player_type: playerType,
      accessType: 'free',
      accessPremium: false,
      accessDenied: false,
      access_deny_reason: null,
      playback_authorized: true,
    };
    return enrichPlayerChannelInstructionVideo(base, safeRaw);
  }

  const rawUrl =
    typeof safeRaw?.url === 'string' && safeRaw.url.trim()
      ? safeRaw.url.trim()
      : typeof safeRaw?.stream_url === 'string' && safeRaw.stream_url.trim()
        ? safeRaw.stream_url.trim()
        : '';
  const playbackUrl =
    typeof safeRaw?.playbackUrl === 'string' && safeRaw.playbackUrl.trim()
      ? safeRaw.playbackUrl.trim()
      : typeof safeRaw?.playback_url === 'string' && safeRaw.playback_url.trim()
        ? safeRaw.playback_url.trim()
        : '';
  const streamProxyPrimary =
    safeRaw?.streamProxy && typeof safeRaw.streamProxy === 'object' && safeRaw.streamProxy !== null
      ? String(safeRaw.streamProxy.primaryUrl ?? safeRaw.streamProxy.primary_url ?? '').trim()
      : '';

  const referer =
    typeof safeRaw?.referer === 'string' && safeRaw.referer.trim()
      ? safeRaw.referer.trim()
      : typeof safeRaw?.referrer === 'string' && safeRaw.referrer.trim()
        ? safeRaw.referrer.trim()
        : '';
  const origin =
    typeof safeRaw?.origin === 'string' && safeRaw.origin.trim()
      ? safeRaw.origin.trim()
      : typeof safeRaw?.stream_origin === 'string' && safeRaw.stream_origin.trim()
        ? safeRaw.stream_origin.trim()
        : '';
  const userAgent =
    typeof safeRaw?.userAgent === 'string' && safeRaw.userAgent.trim()
      ? safeRaw.userAgent.trim()
      : typeof safeRaw?.user_agent === 'string' && safeRaw.user_agent.trim()
        ? safeRaw.user_agent.trim()
        : '';

  const headerInput = { referer, origin, userAgent };
  const delivery = readStreamDeliveryFields(safeRaw);
  const playerType =
    safeRaw?.playerType != null
      ? String(safeRaw.playerType)
      : safeRaw?.player_type != null
        ? String(safeRaw.player_type)
        : 'exo';
  const directHls = isDirectHlsPlayerType(playerType);
  const deniedPremium = !freeMode && isPremiumApi && (serverAccessDenied || (!rawUrl && !playbackUrl));
  const playbackPlan = deniedPremium
    ? { deliveryMode: 'proxy', playUrl: '', proxyFallbackUrl: '', directUrl: '' }
    : resolveChannelPlaybackPlan({
        rawUrl,
        playbackUrl,
        streamProxyPrimary,
        directStreamUrl: delivery.directStreamUrl,
        proxyFallbackUrl: delivery.proxyFallbackUrl,
        deliveryMode: directHls ? 'direct' : delivery.deliveryMode,
        ...headerInput,
      });
  const primaryUrl =
    deniedPremium
      ? ''
      : directHls && rawUrl
        ? resolveDirectHlsBackupUrl(rawUrl)
        : playbackPlan.playUrl;

  const backup1Raw =
    deniedPremium
      ? ''
      : typeof safeRaw?.backupStream1 === 'string' && safeRaw.backupStream1.trim()
        ? safeRaw.backupStream1.trim()
        : typeof safeRaw?.backup_stream_1 === 'string' && safeRaw.backup_stream_1.trim()
          ? safeRaw.backup_stream_1.trim()
          : '';
  const backup2Raw =
    deniedPremium
      ? ''
      : typeof safeRaw?.backupStream2 === 'string' && safeRaw.backupStream2.trim()
        ? safeRaw.backupStream2.trim()
        : typeof safeRaw?.backup_stream_2 === 'string' && safeRaw.backup_stream_2.trim()
          ? safeRaw.backup_stream_2.trim()
          : '';
  const backup1 = directHls
    ? resolveDirectHlsBackupUrl(backup1Raw)
    : resolveChannelBackupPlaybackUrl(backup1Raw, headerInput);
  const backup2 = directHls
    ? resolveDirectHlsBackupUrl(backup2Raw)
    : resolveChannelBackupPlaybackUrl(backup2Raw, headerInput);

  const base = {
    id: channelId,
    channel_id: channelId,
    name,
    url: primaryUrl,
    stream_url: primaryUrl,
    streamDeliveryMode: directHls ? 'direct' : playbackPlan.deliveryMode,
    stream_delivery_mode: directHls ? 'direct' : playbackPlan.deliveryMode,
    directStreamUrl: deniedPremium ? '' : playbackPlan.directUrl,
    direct_stream_url: deniedPremium ? '' : playbackPlan.directUrl,
    proxyFallbackUrl: deniedPremium ? '' : playbackPlan.proxyFallbackUrl,
    proxy_fallback_url: deniedPremium ? '' : playbackPlan.proxyFallbackUrl,
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
    accessDenied: deniedPremium,
    access_deny_reason: deniedPremium ? accessDenyReason || 'no_active_subscription' : null,
    playback_authorized: deniedPremium ? false : safeRaw?.playback_authorized !== false,
  };
  if (isInstructionVideoChannel(safeRaw)) {
    return enrichPlayerChannelInstructionVideo(base, safeRaw);
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
