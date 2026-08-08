/**
 * Persist the last backend-verified checkout provider so a temporary
 * checkout-providers failure does not invent ZenoPay.
 * Never written unless the App successfully parsed a live API response.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { normalizeCheckoutProvider } from './checkoutPaymentProviders';

export const CHECKOUT_PROVIDER_CACHE_KEY = '@osmani/checkout_provider_verified_v1';

/** @typedef {'zenopay'|'sonicpesa'|'auraxpay'} CheckoutProviderId */

/**
 * @param {unknown} raw
 * @returns {CheckoutProviderId|null}
 */
export function coerceVerifiedCheckoutProvider(raw) {
  const p = String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/[_-]/g, '');
  if (p === 'sonicpesa' || p === 'sonic') return 'sonicpesa';
  if (p === 'auraxpay' || p === 'aurax') return 'auraxpay';
  if (p === 'zenopay' || p === 'zeno') return 'zenopay';
  return null;
}

/**
 * @returns {Promise<{ provider: CheckoutProviderId; savedAt: string }|null>}
 */
export async function readCachedCheckoutProvider() {
  try {
    const raw = await AsyncStorage.getItem(CHECKOUT_PROVIDER_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const provider = coerceVerifiedCheckoutProvider(parsed?.provider ?? parsed?.payment_provider);
    if (!provider) return null;
    return {
      provider,
      savedAt: typeof parsed?.savedAt === 'string' ? parsed.savedAt : '',
    };
  } catch {
    return null;
  }
}

/**
 * @param {CheckoutProviderId|string} provider
 * @returns {Promise<boolean>}
 */
export async function writeCachedCheckoutProvider(provider) {
  const id = coerceVerifiedCheckoutProvider(provider) ?? normalizeCheckoutProvider(provider);
  const verified = coerceVerifiedCheckoutProvider(id);
  if (!verified) return false;
  try {
    await AsyncStorage.setItem(
      CHECKOUT_PROVIDER_CACHE_KEY,
      JSON.stringify({
        provider: verified,
        payment_provider: verified,
        savedAt: new Date().toISOString(),
      }),
    );
    return true;
  } catch {
    return false;
  }
}
