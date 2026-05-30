/**
 * Deep links:
 * - `osmani://home` (and sports / tamthilia / akaunti tabs)
 * - `osmani://channel/{channelId}`
 * - path form `osmani:///channel/{channelId}`
 * - query form `osmani://channel?id={channelId}`
 */

const TAB_BY_SEGMENT = Object.freeze({
  home: 'Home',
  sports: 'Sports',
  tamthilia: 'Tamthilia',
  akaunti: 'Akaunti Yangu',
  account: 'Akaunti Yangu',
  'akaunti-yangu': 'Akaunti Yangu',
});

/**
 * @param {string} url
 * @returns {{ host: string; pathParts: string[]; searchParams: URLSearchParams } | null}
 */
function parseOsmaniUrlParts(url) {
  const s = String(url ?? '').trim();
  if (!/^osmani:\/\//i.test(s)) return null;
  try {
    const normalized = s.replace(/^osmani:\/\//i, 'https://placeholder/');
    const u = new URL(normalized);
    const host = (u.hostname || '').toLowerCase();
    const pathParts = (u.pathname || '')
      .split('/')
      .map((p) => p.trim())
      .filter(Boolean);
    return { host, pathParts, searchParams: u.searchParams };
  } catch {
    const hostMatch = /^osmani:\/\/([^/?#]+)/i.exec(s);
    const host = hostMatch ? String(hostMatch[1]).toLowerCase() : '';
    return { host, pathParts: [], searchParams: new URLSearchParams() };
  }
}

/**
 * @param {string} url
 * @returns {string | null}
 */
function readChannelIdFromOsmaniUrl(url) {
  const parts = parseOsmaniUrlParts(url);
  if (!parts) return null;

  const fromQuery =
    parts.searchParams.get('id') ||
    parts.searchParams.get('channelId') ||
    parts.searchParams.get('channel_id');
  if (fromQuery && String(fromQuery).trim()) return String(fromQuery).trim();

  if (parts.host === 'channel' && parts.pathParts[0]) {
    try {
      return decodeURIComponent(String(parts.pathParts[0]).trim());
    } catch {
      return String(parts.pathParts[0]).trim();
    }
  }

  if (parts.pathParts[0] === 'channel' && parts.pathParts[1]) {
    try {
      return decodeURIComponent(String(parts.pathParts[1]).trim());
    } catch {
      return String(parts.pathParts[1]).trim();
    }
  }

  return null;
}

/**
 * @typedef {{ kind: 'tab'; tab: string }} OsmaniTabDeepLink
 * @typedef {{ kind: 'channel'; channelId: string }} OsmaniChannelDeepLink
 * @typedef {{ kind: 'custom'; url: string }} OsmaniCustomDeepLink
 * @typedef {OsmaniTabDeepLink | OsmaniChannelDeepLink | OsmaniCustomDeepLink} OsmaniDeepLinkTarget
 */

/**
 * @param {string} url
 * @returns {OsmaniDeepLinkTarget | null}
 */
export function parseOsmaniDeepLink(url) {
  const s = String(url ?? '').trim();
  if (!s) return null;

  const channelId = readChannelIdFromOsmaniUrl(s);
  if (channelId) {
    return { kind: 'channel', channelId };
  }

  const tab = resolveMainTabFromOsmaniUrl(s);
  if (tab) {
    return { kind: 'tab', tab };
  }

  if (/^osmani:\/\//i.test(s)) {
    return { kind: 'custom', url: s };
  }

  return null;
}

/**
 * @param {string} url
 * @returns {string | null} React Navigation tab screen name under MainTabs
 */
export function resolveMainTabFromOsmaniUrl(url) {
  const s = String(url ?? '').trim();
  if (!s) return null;

  let segment = '';
  if (/^osmani:\/\//i.test(s)) {
    const parts = parseOsmaniUrlParts(s);
    if (!parts) return null;
    if (parts.host === 'channel' || parts.pathParts[0] === 'channel') return null;
    const path = parts.pathParts.join('/');
    segment = (path || parts.host || '').toLowerCase();
  } else {
    try {
      const u = new URL(s);
      const host = (u.hostname || '').toLowerCase();
      const path = (u.pathname || '').replace(/^\/+|\/+$/g, '').toLowerCase();
      segment = path || host;
    } catch {
      return null;
    }
  }

  if (!segment) return 'Home';
  const tab = TAB_BY_SEGMENT[segment];
  return tab ?? null;
}
