/**
 * Deep links: `osmani://home`, `osmani://sports`, `osmani://tamthilia`, `osmani://akaunti`
 * (also accepts path form `osmani:///home` and https launchUrl with same paths if configured).
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
 * @returns {string | null} React Navigation tab screen name under MainTabs
 */
export function resolveMainTabFromOsmaniUrl(url) {
  const s = String(url ?? '').trim();
  if (!s) return null;

  let segment = '';
  if (/^osmani:\/\//i.test(s)) {
    try {
      const normalized = s.replace(/^osmani:\/\//i, 'https://x/');
      const u = new URL(normalized);
      const path = (u.pathname || '').replace(/^\/+|\/+$/g, '');
      segment = (path || u.hostname || '').toLowerCase();
    } catch {
      const m = /^osmani:\/\/([^/?#]+)/i.exec(s);
      segment = m ? String(m[1]).toLowerCase() : '';
    }
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
