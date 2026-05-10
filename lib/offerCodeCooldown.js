import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'osmani:offer_code:cooldown_until_ms';

export async function readOfferCodeCooldownEndMs() {
  try {
    const v = await AsyncStorage.getItem(KEY);
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

export async function writeOfferCodeCooldownEndMs(ms) {
  try {
    await AsyncStorage.setItem(KEY, String(ms));
  } catch {}
}

export async function clearOfferCodeCooldown() {
  try {
    await AsyncStorage.removeItem(KEY);
  } catch {}
}
