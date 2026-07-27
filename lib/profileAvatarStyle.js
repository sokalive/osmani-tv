/**
 * Deterministic human-style cartoon avatar traits from a stable seed
 * (device/account id). Same seed → same avatar; different seeds → different looks.
 */

const BG_PALETTES = Object.freeze([
  ['#1D4ED8', '#312E81'],
  ['#BE123C', '#9F1239'],
  ['#047857', '#065F46'],
  ['#B45309', '#92400E'],
  ['#7C3AED', '#5B21B6'],
  ['#0F766E', '#115E59'],
  ['#C2410C', '#9A3412'],
  ['#DB2777', '#9D174D'],
  ['#4338CA', '#312E81'],
  ['#4D7C0F', '#3F6212'],
  ['#0369A1', '#0C4A6E'],
  ['#A16207', '#854D0E'],
]);

const SKIN_TONES = Object.freeze([
  '#FFE8D1',
  '#F9D5B5',
  '#F0C29B',
  '#E0A878',
  '#D19560',
  '#C68642',
  '#A86B38',
  '#8D5524',
  '#6F4018',
  '#FFD7B5',
  '#E8B98A',
  '#B8794A',
]);

const HAIR_COLORS = Object.freeze([
  '#111827',
  '#1F2937',
  '#374151',
  '#78350F',
  '#92400E',
  '#B45309',
  '#4C1D95',
  '#0F172A',
  '#44403C',
  '#7C2D12',
  '#F59E0B',
  '#9F1239',
]);

const EYE_COLORS = Object.freeze([
  '#1F2937',
  '#1E3A8A',
  '#14532D',
  '#7C2D12',
  '#312E81',
  '#0F766E',
  '#44403C',
]);

const SHIRT_COLORS = Object.freeze([
  '#1E40AF',
  '#BE123C',
  '#047857',
  '#7C3AED',
  '#0F766E',
  '#C2410C',
  '#334155',
  '#DB2777',
]);

/** Presentation + hairstyle variants (human cartoon). */
const PRESENTATIONS = Object.freeze([
  { gender: 'female', hair: 'bob' },
  { gender: 'female', hair: 'long' },
  { gender: 'female', hair: 'bun' },
  { gender: 'female', hair: 'pony' },
  { gender: 'male', hair: 'short' },
  { gender: 'male', hair: 'side' },
  { gender: 'male', hair: 'fade' },
  { gender: 'male', hair: 'curly' },
  { gender: 'female', hair: 'pixie' },
  { gender: 'male', hair: 'top' },
  { gender: 'female', hair: 'waves' },
  { gender: 'male', hair: 'bald' },
]);

const EXPRESSIONS = Object.freeze(['smile', 'grin', 'soft', 'bright']);

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
 */
export function resolveProfileAvatarStyle(seed) {
  const h = hashAvatarSeed(seed);
  const pick = (arr, shift) => arr[(h >>> shift) % arr.length];
  const presentation = pick(PRESENTATIONS, 20);
  return {
    bg: pick(BG_PALETTES, 0),
    skin: pick(SKIN_TONES, 4),
    hair: pick(HAIR_COLORS, 8),
    eye: pick(EYE_COLORS, 12),
    shirt: pick(SHIRT_COLORS, 16),
    presentation,
    expression: pick(EXPRESSIONS, 24),
    blush: ((h >>> 28) & 1) === 1,
    variant: h % 1000,
  };
}
