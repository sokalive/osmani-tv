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
  const primaryUrl =
    typeof raw?.url === 'string' && raw.url.trim()
      ? raw.url.trim()
      : typeof raw?.stream_url === 'string' && raw.stream_url.trim()
        ? raw.stream_url.trim()
        : '';
  const backup1 =
    typeof raw?.backupStream1 === 'string' && raw.backupStream1.trim()
      ? raw.backupStream1.trim()
      : typeof raw?.backup_stream_1 === 'string' && raw.backup_stream_1.trim()
        ? raw.backup_stream_1.trim()
        : '';
  const backup2 =
    typeof raw?.backupStream2 === 'string' && raw.backupStream2.trim()
      ? raw.backupStream2.trim()
      : typeof raw?.backup_stream_2 === 'string' && raw.backup_stream_2.trim()
        ? raw.backup_stream_2.trim()
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
  const playerType =
    raw?.playerType != null
      ? String(raw.playerType)
      : raw?.player_type != null
        ? String(raw.player_type)
        : 'exo';
  return {
    id: channelId,
    channel_id: channelId,
    name,
    url: primaryUrl,
    stream_url: primaryUrl,
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
