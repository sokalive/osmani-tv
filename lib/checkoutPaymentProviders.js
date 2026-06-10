/**
 * Checkout gateway metadata and parsing (ZenoPay, SonicPesa, Aurax Pay).
 * Active gateway is selected in admin; app routes create-order by payment_provider.
 */

import { resolveMediaAssetUrl } from './mediaDelivery.js';

export const CHECKOUT_GATEWAY_META = Object.freeze({
  zenopay: {
    id: 'zenopay',
    name: 'ZenoPay',
    accent: '#2563EB',
    initial: 'Z',
  },
  sonicpesa: {
    id: 'sonicpesa',
    name: 'SonicPesa',
    accent: '#7C3AED',
    initial: 'S',
  },
  auraxpay: {
    id: 'auraxpay',
    name: 'Aurax Pay',
    accent: '#0891B2',
    initial: 'A',
  },
});

/** @typedef {'zenopay'|'sonicpesa'|'auraxpay'} CheckoutProviderId */

/**
 * @param {unknown} raw
 * @returns {CheckoutProviderId}
 */
export function normalizeCheckoutProvider(raw) {
  const p = String(raw ?? 'zenopay')
    .trim()
    .toLowerCase()
    .replace(/_/g, '');
  if (p === 'sonicpesa' || p === 'sonic') return 'sonicpesa';
  if (p === 'auraxpay' || p === 'aurax') return 'auraxpay';
  return 'zenopay';
}

function pickLogo(body, id) {
  if (!body || typeof body !== 'object') return null;
  const keys = [
    `${id}_logo`,
    `${id}_logo_url`,
    `${id}Logo`,
    `${id}LogoUrl`,
    `logo_${id}`,
  ];
  if (body.logos && typeof body.logos === 'object') {
    const fromNest = body.logos[id] ?? body.logos[id.replace('pay', '')];
    if (typeof fromNest === 'string' && fromNest.trim()) {
      return resolveMediaAssetUrl(fromNest.trim());
    }
  }
  for (const k of keys) {
    const v = body[k];
    if (typeof v === 'string' && v.trim()) return resolveMediaAssetUrl(v.trim());
  }
  return null;
}

/**
 * @param {Record<string, unknown>|null|undefined} body
 * @returns {{
 *   payment_provider: CheckoutProviderId;
 *   zenopay: boolean;
 *   sonicpesa: boolean;
 *   auraxpay: boolean;
 *   logos: Record<CheckoutProviderId, string|null>;
 * }}
 */
export function parseCheckoutProvidersResponse(body) {
  const payment_provider = normalizeCheckoutProvider(body?.payment_provider);
  return {
    payment_provider,
    zenopay: body?.zenopay !== false,
    sonicpesa: Boolean(body?.sonicpesa),
    auraxpay: Boolean(body?.auraxpay),
    logos: {
      zenopay: pickLogo(body, 'zenopay'),
      sonicpesa: pickLogo(body, 'sonicpesa'),
      auraxpay: pickLogo(body, 'auraxpay'),
    },
  };
}

/**
 * @param {{
 *   payment_provider: CheckoutProviderId;
 *   zenopay: boolean;
 *   sonicpesa: boolean;
 *   auraxpay: boolean;
 *   logos: Record<CheckoutProviderId, string|null>;
 * }} cfg
 */
export function listEnabledCheckoutGateways(cfg) {
  /** @type {CheckoutProviderId[]} */
  const ids = ['zenopay', 'sonicpesa', 'auraxpay'];
  return ids
    .filter((id) => {
      if (id === 'zenopay') return cfg.zenopay !== false;
      if (id === 'sonicpesa') return cfg.sonicpesa === true;
      return cfg.auraxpay === true;
    })
    .map((id) => ({
      ...CHECKOUT_GATEWAY_META[id],
      logoUrl: cfg.logos?.[id] ?? null,
      active: id === cfg.payment_provider,
    }));
}
