/**
 * Canonical admin channel id for analytics (Top 5 / session heartbeats).
 * Never use display name or synthetic card ids as channel_id.
 */

/**
 * @param {Record<string, unknown>|null|undefined} channelOrRow
 * @returns {string}
 */
export function resolveAnalyticsChannelId(channelOrRow) {
  if (!channelOrRow || typeof channelOrRow !== 'object') return '';
  for (const key of ['id', 'channel_id', '_id']) {
    if (!Object.prototype.hasOwnProperty.call(channelOrRow, key)) continue;
    const v = channelOrRow[key];
    if (v == null) continue;
    const s = String(v).trim();
    if (!s) continue;
    if (s.startsWith('ch-') && /^ch-\d+-/.test(s)) continue;
    return s;
  }
  return '';
}
