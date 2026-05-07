import { Platform } from 'react-native';

/**
 * Best-effort human-friendly device name without pulling in `expo-device`.
 *
 * On Android we read `Platform.constants.{Manufacturer,Brand,Model}`.
 * Manufacturers report "samsung" / "Xiaomi" / "TECNO"; some Models are
 * marketing names ("Spark 10", "Redmi Note 13") and some are SKU codes
 * ("SM-G991B"). We capitalize the manufacturer and trim. If the result
 * looks empty or pathological, fall back to "Android Device".
 */
function titleCase(s) {
  return String(s || '')
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function isMostlyCodename(s) {
  const v = String(s || '').trim();
  if (!v) return true;
  // Patterns like "SM-G991B", "RMX2185", "M2102J20SG", etc.
  return /^[A-Z]{1,5}[-_]?[A-Z0-9]{4,}$/.test(v);
}

export function getDeviceLabel() {
  try {
    if (Platform.OS === 'android') {
      const c = Platform.constants || {};
      const rawManuf = String(c.Manufacturer || c.Brand || '').trim();
      const rawModel = String(c.Model || '').trim();
      const manuf = titleCase(rawManuf);
      const codenameModel = isMostlyCodename(rawModel);
      const model = codenameModel ? '' : rawModel;
      const combined = [manuf, model].filter(Boolean).join(' ').trim();
      if (combined.length > 0 && combined.length <= 60) return combined;
      if (manuf) return `${manuf} Device`;
      return 'Android Device';
    }
    if (Platform.OS === 'ios') {
      const c = Platform.constants || {};
      const model = String(c.systemName || c.Model || 'iPhone').trim();
      return model || 'iPhone';
    }
  } catch {}
  return 'Android Device';
}
