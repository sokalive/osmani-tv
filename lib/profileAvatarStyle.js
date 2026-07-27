/**
 * Deterministic cartoon profile avatar styles from a stable seed (device/account id).
 * Same seed → same avatar across launches; different seeds → different looks.
 */

const BG_PALETTES = Object.freeze([
  ['#3B82F6', '#1D4ED8'],
  ['#EF4444', '#B91C1C'],
  ['#22C55E', '#15803D'],
  ['#F59E0B', '#D97706'],
  ['#A855F7', '#7E22CE'],
  ['#14B8A6', '#0F766E'],
  ['#F97316', '#C2410C'],
  ['#EC4899', '#BE185D'],
  ['#6366F1', '#4338CA'],
  ['#84CC16', '#4D7C0F'],
  ['#06B6D4', '#0E7490'],
  ['#EAB308', '#A16207'],
]);

const SKIN_TONES = Object.freeze([
  '#FDE7C7',
  '#F5D0A9',
  '#E8B98A',
  '#D29B6A',
  '#C68642',
  '#A66A3C',
  '#8D5524',
  '#FFE0BD',
]);

const HAIR_COLORS = Object.freeze([
  '#1F2937',
  '#374151',
  '#78350F',
  '#92400E',
  '#111827',
  '#B45309',
  '#4C1D95',
  '#0F766E',
]);

const EYE_COLORS = Object.freeze([
  '#1F2937',
  '#1E3A8A',
  '#14532D',
  '#7C2D12',
  '#312E81',
]);

const MOUTH_STYLES = Object.freeze(['smile', 'grin', 'open', 'calm']);
const HAIR_STYLES = Object.freeze(['short', 'side', 'top', 'none']);
const ACCESSORIES = Object.freeze(['none', 'glasses', 'none', 'blush', 'none']);

/**
 * FNV-1a style hash for stable avatar indexing.
 * @param {string} seed
 * @returns {number}
 */
export function hashAvatarSeed(seed) {
  const s = String(seed || 'osmani-guest');
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * @param {string} seed deviceId / account key
 * @returns {{
 *   bg: [string, string];
 *   skin: string;
 *   hair: string;
 *   eye: string;
 *   mouth: string;
 *   hairStyle: string;
 *   accessory: string;
 *   variant: number;
 * }}
 */
export function resolveProfileAvatarStyle(seed) {
  const h = hashAvatarSeed(seed);
  const pick = (arr, shift) => arr[(h >>> shift) % arr.length];
  return {
    bg: pick(BG_PALETTES, 0),
    skin: pick(SKIN_TONES, 4),
    hair: pick(HAIR_COLORS, 8),
    eye: pick(EYE_COLORS, 12),
    mouth: pick(MOUTH_STYLES, 16),
    hairStyle: pick(HAIR_STYLES, 20),
    accessory: pick(ACCESSORIES, 24),
    variant: h % 1000,
  };
}
