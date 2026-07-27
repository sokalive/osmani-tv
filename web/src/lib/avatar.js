/** Deterministic human cartoon avatar traits (ported from mobile). */

const BG = [
  ['#1D4ED8', '#312E81'],
  ['#BE123C', '#9F1239'],
  ['#047857', '#065F46'],
  ['#7C3AED', '#5B21B6'],
  ['#C2410C', '#9A3412'],
  ['#0F766E', '#115E59'],
  ['#DB2777', '#9D174D'],
  ['#4338CA', '#312E81'],
];
const SKIN = ['#FFE8D1', '#F9D5B5', '#F0C29B', '#E0A878', '#C68642', '#A86B38', '#8D5524', '#6F4018'];
const HAIR = ['#111827', '#1F2937', '#78350F', '#92400E', '#B45309', '#4C1D95', '#0F172A'];
const EYE = ['#1F2937', '#1E3A8A', '#14532D', '#7C2D12', '#312E81'];
const SHIRT = ['#1E40AF', '#BE123C', '#047857', '#7C3AED', '#0F766E', '#C2410C', '#334155'];
const PRES = [
  { gender: 'female', hair: 'bob' },
  { gender: 'female', hair: 'long' },
  { gender: 'female', hair: 'bun' },
  { gender: 'male', hair: 'short' },
  { gender: 'male', hair: 'side' },
  { gender: 'male', hair: 'fade' },
  { gender: 'female', hair: 'pixie' },
  { gender: 'male', hair: 'curly' },
];

export function hashSeed(seed) {
  const s = String(seed || 'osmani-guest');
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function resolveAvatar(seed) {
  const h = hashSeed(seed);
  const pick = (arr, shift) => arr[(h >>> shift) % arr.length];
  return {
    bg: pick(BG, 0),
    skin: pick(SKIN, 4),
    hair: pick(HAIR, 8),
    eye: pick(EYE, 12),
    shirt: pick(SHIRT, 16),
    presentation: pick(PRES, 20),
    blush: ((h >>> 28) & 1) === 1,
  };
}
