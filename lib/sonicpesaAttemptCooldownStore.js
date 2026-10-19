import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'osmani_sonicpesa_pay_attempt_cooldown_v1';

/**
 * @returns {Promise<{ cooldownUntilMs: number }|null>}
 */
export async function readSonicpesaAttemptCooldown() {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const cooldownUntilMs = Date.parse(String(parsed?.cooldownUntil ?? ''));
    if (!Number.isFinite(cooldownUntilMs)) return null;
    return { cooldownUntilMs };
  } catch {
    return null;
  }
}

/**
 * @param {{ cooldownUntilMs: number }} cooldown
 */
export async function writeSonicpesaAttemptCooldown(cooldown) {
  const cooldownUntilMs = Number(cooldown?.cooldownUntilMs);
  if (!Number.isFinite(cooldownUntilMs)) return;
  await AsyncStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ cooldownUntil: new Date(cooldownUntilMs).toISOString() }),
  );
}

export async function clearSonicpesaAttemptCooldown() {
  try {
    await AsyncStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
