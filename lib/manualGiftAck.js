import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'osmani:manual_subscription_gift:acked_key';

export async function readManualGiftAck() {
  try {
    const v = await AsyncStorage.getItem(STORAGE_KEY);
    return v != null ? String(v) : '';
  } catch {
    return '';
  }
}

/** Persist which gift key the user acknowledged — must match backend `manualGiftAckKey`. */
export async function writeManualGiftAck(key) {
  if (key == null || String(key).trim() === '') return;
  try {
    await AsyncStorage.setItem(STORAGE_KEY, String(key).trim());
  } catch {}
}
