import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_ACK_KEY = 'osmani:manual_subscription_gift:acked_key';
/** Outstanding gift that must be acknowledged via ASANTE + API before removal. */
const STORAGE_PENDING_KEY = 'osmani:manual_subscription_gift:pending_ack_key';

export async function readManualGiftAck() {
  try {
    const v = await AsyncStorage.getItem(STORAGE_ACK_KEY);
    return v != null ? String(v) : '';
  } catch {
    return '';
  }
}

/** Persist server-acknowledged gift key after successful acknowledge-manual-gift API. */
export async function writeManualGiftAck(key) {
  if (key == null || String(key).trim() === '') return;
  try {
    await AsyncStorage.setItem(STORAGE_ACK_KEY, String(key).trim());
  } catch {}
}

export async function readPendingManualGiftKey() {
  try {
    const v = await AsyncStorage.getItem(STORAGE_PENDING_KEY);
    return v != null ? String(v).trim() : '';
  } catch {
    return '';
  }
}

/** Call when a manual gift must be shown until ASANTE (survives restart). */
export async function writePendingManualGiftKey(key) {
  if (key == null || String(key).trim() === '') return;
  try {
    await AsyncStorage.setItem(STORAGE_PENDING_KEY, String(key).trim());
  } catch {}
}

export async function clearPendingManualGiftKey() {
  try {
    await AsyncStorage.removeItem(STORAGE_PENDING_KEY);
  } catch {}
}
