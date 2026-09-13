/**
 * Payment-flow visual tokens — sampled from the redesign reference images.
 * Scope: PremiumModal + PaymentWaitingStep only (not global app chrome).
 */

export const PAYMENT = Object.freeze({
  /** Vibrant primary red from package / phone / PIN references */
  accent: '#E60000',
  accentBright: '#FF1A1A',
  accentSoft: 'rgba(230, 0, 0, 0.14)',
  accentBorder: 'rgba(230, 0, 0, 0.55)',
  accentGlow: 'rgba(230, 0, 0, 0.55)',
  accentMuted: 'rgba(230, 0, 0, 0.22)',

  overlay: 'rgba(0, 0, 0, 0.78)',
  sheetBg: '#0D0D0D',
  sheetBorder: 'rgba(230, 0, 0, 0.35)',
  cardBg: '#1A1A1A',
  cardBgElevated: '#222222',
  cardBorder: 'rgba(255, 255, 255, 0.08)',
  cardBorderMuted: 'rgba(255, 255, 255, 0.06)',

  text: '#FFFFFF',
  textSecondary: '#C8C8C8',
  textMuted: '#8E8E93',
  textDim: '#6B6B70',

  radioOff: '#FFFFFF',
  planBorder: 'rgba(255, 255, 255, 0.10)',
  planBorderSelected: '#E60000',
  planPriceSelected: '#E60000',
  planPrice: '#FFFFFF',

  inputBorder: '#E60000',
  inputBg: '#121212',

  ctaBg: '#E60000',
  ctaText: '#FFFFFF',
  ctaRadius: 14,
  ctaMinHeight: 54,

  sheetRadius: 28,
  cardRadius: 16,
  planRadius: 14,

  network: Object.freeze({
    Tigo: '#0082C8',
    'M-Pesa': '#00A651',
    Airtel: '#E60000',
    HaloPesa: '#F5A623',
  }),
});
