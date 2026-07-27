/**
 * Shared design tokens — matched to Android App.js COLORS.
 */
export const COLORS = Object.freeze({
  background: '#0C0608',
  card: '#151014',
  cardAlt: '#1A1D23',
  live: '#1BCB5A',
  free: '#2AAE5E',
  yellow: '#FFCB3D',
  greenButton: '#1EC967',
  filterPill: '#2A2E37',
  filterSelected: '#3A4151',
  mutedText: '#A1A8B5',
  nav: '#12090C',
  white: '#FFFFFF',
  tabActive: '#FFB347',
  tabInactive: '#DDE3EC',
  danger: '#EF4444',
});

export const FILTER_VISUAL = Object.freeze({
  Zote: {
    icon: '▦',
    colors: 'linear-gradient(135deg, #0B1F3A 0%, #1E4A8C 48%, #2563EB 100%)',
    selected: 'linear-gradient(135deg, #38BDF8 0%, #2563EB 48%, #1E3A8A 100%)',
    glow: '#3B82F6',
  },
  Trending: {
    icon: '🔥',
    colors: 'linear-gradient(135deg, #3F0D0D 0%, #9A1F1F 48%, #C2410C 100%)',
    selected: 'linear-gradient(135deg, #FB923C 0%, #EF4444 48%, #B91C1C 100%)',
    glow: '#F97316',
  },
  Sports: {
    icon: '⚽',
    colors: 'linear-gradient(135deg, #052E16 0%, #166534 48%, #15803D 100%)',
    selected: 'linear-gradient(135deg, #4ADE80 0%, #22C55E 48%, #15803D 100%)',
    glow: '#22C55E',
  },
  Tamthilia: {
    icon: '🎬',
    colors: 'linear-gradient(135deg, #2E1065 0%, #5B21B6 48%, #7C3AED 100%)',
    selected: 'linear-gradient(135deg, #C084FC 0%, #A855F7 48%, #6D28D9 100%)',
    glow: '#A855F7',
  },
});

export const API_BASE = 'https://api.osmanitv.com';
export const STREAM_PROXY_BASE = `${API_BASE}/stream-proxy`;
export const MEDIA_CDN = 'https://osmanitv.b-cdn.net';
