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
  return {
    id: channelId,
    channel_id: channelId,
    name,
    url: typeof raw?.url === 'string' ? raw.url : '',
    backupStream1: typeof raw?.backupStream1 === 'string' ? raw.backupStream1 : '',
    backupStream2: typeof raw?.backupStream2 === 'string' ? raw.backupStream2 : '',
    origin: typeof raw?.origin === 'string' ? raw.origin : '',
    referer: typeof raw?.referer === 'string' ? raw.referer : '',
    userAgent: typeof raw?.userAgent === 'string' ? raw.userAgent : '',
    playerType: raw?.playerType != null ? String(raw.playerType) : 'exo',
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
