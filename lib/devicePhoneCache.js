import AsyncStorage from '@react-native-async-storage/async-storage';

const PHONE_SAVED_KEY = 'osmani:device_phone_saved_v1';
const PHONE_DIGITS_KEY = 'osmani:device_phone_digits_v1';

/** @returns {Promise<boolean>} */
export async function readLocalPhoneSavedFlag() {
  try {
    const v = await AsyncStorage.getItem(PHONE_SAVED_KEY);
    return v === '1' || v === 'true';
  } catch {
    return false;
  }
}

/** @returns {Promise<string>} */
export async function readLocalPhoneDigits() {
  try {
    const v = await AsyncStorage.getItem(PHONE_DIGITS_KEY);
    return typeof v === 'string' ? v.trim() : '';
  } catch {
    return '';
  }
}

/** @param {string} digits */
export async function writeLocalPhoneSaved(digits) {
  try {
    await AsyncStorage.setItem(PHONE_SAVED_KEY, '1');
    if (digits) await AsyncStorage.setItem(PHONE_DIGITS_KEY, String(digits));
  } catch {
    /* ignore */
  }
}

export async function clearLocalPhoneSaved() {
  try {
    await AsyncStorage.multiRemove([PHONE_SAVED_KEY, PHONE_DIGITS_KEY]);
  } catch {
    /* ignore */
  }
}
