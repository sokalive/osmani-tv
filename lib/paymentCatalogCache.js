import AsyncStorage from '@react-native-async-storage/async-storage';

const KEYS = Object.freeze({
  plans: 'osmani:pay:plans_json',
  plansAt: 'osmani:pay:plans_at',
  checkout: 'osmani:pay:checkout_json',
  checkoutAt: 'osmani:pay:checkout_at',
  providers: 'osmani:pay:providers_json',
  providersAt: 'osmani:pay:providers_at',
});

const TTL_MS = 24 * 60 * 60 * 1000;

function isFresh(atRaw) {
  const at = Number(atRaw ?? 0);
  return Number.isFinite(at) && at > 0 && Date.now() - at < TTL_MS;
}

async function readJson(key, atKey, { ignoreTtl = false } = {}) {
  try {
    const [raw, atRaw] = await Promise.all([
      AsyncStorage.getItem(key),
      AsyncStorage.getItem(atKey),
    ]);
    if (!raw) return null;
    if (!ignoreTtl && !isFresh(atRaw)) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function writeJson(key, atKey, value) {
  try {
    await AsyncStorage.multiSet([
      [key, JSON.stringify(value)],
      [atKey, String(Date.now())],
    ]);
  } catch {
    // ignore
  }
}

export async function readCachedPaymentPlans(opts = {}) {
  return readJson(KEYS.plans, KEYS.plansAt, opts);
}

export async function writeCachedPaymentPlans(plans) {
  if (!Array.isArray(plans)) return;
  await writeJson(KEYS.plans, KEYS.plansAt, plans);
}

export async function readCachedCheckoutProviders(opts = {}) {
  return readJson(KEYS.checkout, KEYS.checkoutAt, opts);
}

export async function writeCachedCheckoutProviders(cfg) {
  if (!cfg || typeof cfg !== 'object') return;
  await writeJson(KEYS.checkout, KEYS.checkoutAt, cfg);
}

export async function readCachedPaymentProviders(opts = {}) {
  return readJson(KEYS.providers, KEYS.providersAt, opts);
}

export async function writeCachedPaymentProviders(providers) {
  if (!Array.isArray(providers)) return;
  await writeJson(KEYS.providers, KEYS.providersAt, providers);
}
