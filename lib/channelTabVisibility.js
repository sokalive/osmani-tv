/**
 * Channel bottom-tab visibility aligned with admin/backend:
 * - `visibleTabs` string[] (or comma-separated string)
 * - `bottom_tab` CSV compatibility (and legacy `bottomTab` / `bottomTabsDisplay`)
 * - `category`: Home | Sports | Tamthilia (plus legacy spellings)
 *
 * Navigator tabs: home | sports | tamthilia
 */

/** @typedef {'home' | 'sports' | 'tamthilia'} NavigatorTabKey */

/**
 * @param {unknown} s
 * @returns {NavigatorTabKey | null}
 */
export function normalizeTabToken(s) {
  const t = String(s ?? '')
    .trim()
    .toLowerCase();
  if (!t) return null;
  if (t === 'home' || t === 'general' || t === 'zote') return 'home';
  if (t === 'sports' || t === 'sport' || t === 'michezo') return 'sports';
  if (t === 'tamthilia' || t === 'movies' || t === 'movie' || t === 'filamu') return 'tamthilia';
  return null;
}

/**
 * @param {Record<string, unknown>} raw
 * @returns {string[]}
 */
function readStringListField(raw) {
  const vt = raw?.visibleTabs ?? raw?.visible_tabs;
  if (Array.isArray(vt)) {
    return vt.map((x) => String(x).trim()).filter(Boolean);
  }
  if (typeof vt === 'string' && vt.trim()) {
    const str = vt.trim();
    if (str.startsWith('[')) {
      try {
        const p = JSON.parse(str);
        if (Array.isArray(p)) return p.map((x) => String(x).trim()).filter(Boolean);
      } catch {
        /* fall through */
      }
    }
    return str.split(/[,;|]/).map((x) => x.trim()).filter(Boolean);
  }
  return [];
}

/**
 * @param {Record<string, unknown>} raw
 * @returns {string[]}
 */
function readBottomTabCsvTokens(raw) {
  const b = raw?.bottom_tab ?? raw?.bottomTab ?? raw?.bottomTabsDisplay ?? raw?.bottom_tabs_display;
  if (Array.isArray(b)) return b.map((x) => String(x).trim()).filter(Boolean);
  if (typeof b === 'string' && b.trim()) {
    return b
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean);
  }
  return [];
}

function displaySectionSlug(raw) {
  return String(raw?.display_section ?? raw?.displaySection ?? '')
    .trim()
    .toLowerCase();
}

/**
 * Keys from legacy `category` / `display_section` when visibleTabs / bottom_tab are absent.
 * @param {Record<string, unknown>} raw
 * @returns {Set<NavigatorTabKey>}
 */
function legacyTabKeysFromCategoryAndSection(raw) {
  /** @type {Set<NavigatorTabKey>} */
  const keys = new Set();
  const slug = displaySectionSlug(raw);
  if (slug === 'sports' || slug === 'sport') keys.add('sports');
  if (slug === 'tamthilia' || slug === 'movies' || slug === 'movie') keys.add('tamthilia');
  if (slug === 'home' || slug === 'general') keys.add('home');

  const cat = String(raw?.category ?? '')
    .trim()
    .toLowerCase();
  if (cat === 'sports' || cat === 'sport') keys.add('sports');
  if (cat === 'tamthilia' || cat === 'movies' || cat === 'movie') keys.add('tamthilia');
  if (cat === 'home' || cat === 'general' || cat === 'zote') keys.add('home');

  return keys;
}

/**
 * Which bottom-nav tabs should list this channel.
 * @param {Record<string, unknown>} raw
 * @returns {Set<NavigatorTabKey>}
 */
export function getChannelTabKeys(raw) {
  /** @type {Set<NavigatorTabKey>} */
  const keys = new Set();

  for (const token of readStringListField(raw)) {
    const k = normalizeTabToken(token);
    if (k) keys.add(k);
  }
  if (keys.size > 0) return keys;

  for (const token of readBottomTabCsvTokens(raw)) {
    const k = normalizeTabToken(token);
    if (k) keys.add(k);
  }
  if (keys.size > 0) return keys;

  const legacy = legacyTabKeysFromCategoryAndSection(raw);
  if (legacy.size > 0) {
    legacy.forEach((k) => keys.add(k));
    return keys;
  }

  // Legacy flat catalog: appear everywhere we surface channels.
  keys.add('home');
  keys.add('sports');
  keys.add('tamthilia');
  return keys;
}

/**
 * @param {Record<string, unknown>} raw
 * @param {NavigatorTabKey} tab
 */
export function channelAppearsOnNavigatorTab(raw, tab) {
  return getChannelTabKeys(raw).has(tab);
}

/**
 * @param {Record<string, unknown>} raw
 * @param {'Sports' | 'Tamthilia' | 'Zote' | 'Trending' | string} pill
 */
export function matchesHomePillFilter(raw, pill) {
  if (pill === 'Zote' || pill === 'Trending') return true;
  if (pill === 'Sports') return channelAppearsOnNavigatorTab(raw, 'sports');
  if (pill === 'Tamthilia') return channelAppearsOnNavigatorTab(raw, 'tamthilia');
  return true;
}

function truthyFlag(v) {
  if (v === true || v === 1) return true;
  if (typeof v === 'string') {
    const t = v.trim().toLowerCase();
    return t === '1' || t === 'true' || t === 'yes' || t === 'on';
  }
  return false;
}

/**
 * Popular / featured blocks for the Home mixed layout (admin-driven flags).
 * @param {Record<string, unknown>} raw
 */
export function channelIsPopular(raw) {
  if (truthyFlag(raw?.isPopular) || truthyFlag(raw?.is_popular) || truthyFlag(raw?.popular)) return true;
  const slug = displaySectionSlug(raw);
  return slug === 'popular' || slug === 'maarufu';
}

/**
 * @param {Record<string, unknown>} raw
 */
export function channelIsFeatured(raw) {
  if (truthyFlag(raw?.featured) || truthyFlag(raw?.isFeatured) || truthyFlag(raw?.is_featured)) return true;
  const slug = displaySectionSlug(raw);
  return slug === 'featured' || slug === 'vipengele';
}

/**
 * @deprecated Use {@link sortChannelsByAdminOrder} from `channelOrder.js`.
 * Kept for compatibility — now follows admin sort_order only (no alphabetical mix).
 */
export { compareChannelsByAdminOrder as compareHomeMixChannels } from './channelOrder';
