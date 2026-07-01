/**
 * Normalize WhatsApp support settings from admin API / SSE (many envelope shapes).
 * @param {unknown} raw
 * @returns {{ enabled: boolean, url: string }}
 */
export function normalizeWhatsappSettings(raw) {
  const empty = { enabled: false, url: '' };
  if (!raw || typeof raw !== 'object') return empty;

  const candidates = [];
  const push = (x) => {
    if (x && typeof x === 'object' && !candidates.includes(x)) candidates.push(x);
  };
  push(raw);
  push(raw.payload);
  push(raw.data);
  push(raw.settings);
  push(raw.whatsapp_settings);
  push(raw.whatsappSettings);
  if (raw.config && typeof raw.config === 'object') {
    push(raw.config);
    push(raw.config.whatsapp_settings);
    push(raw.config.whatsappSettings);
  }

  let enabled;
  let url;
  for (const o of candidates) {
    if (enabled === undefined && Object.prototype.hasOwnProperty.call(o, 'enabled')) {
      enabled = coerceBool(o.enabled);
    }
    if (url === undefined || url === '') {
      const u = pickUrl(o);
      if (u) url = u;
    }
    if (enabled === undefined) {
      const e = pickDefined(o, ['is_enabled', 'isEnabled', 'whatsapp_enabled', 'whatsappEnabled']);
      if (e !== undefined) enabled = coerceBool(e);
    }
  }

  return {
    enabled: enabled === true,
    url: typeof url === 'string' ? url.trim() : '',
  };
}

function pickDefined(obj, keys) {
  for (const k of keys) {
    if (Object.prototype.hasOwnProperty.call(obj, k)) return obj[k];
  }
  return undefined;
}

function pickUrl(o) {
  const v = pickDefined(o, ['url', 'whatsapp_url', 'whatsappUrl', 'link', 'href']);
  return typeof v === 'string' ? v.trim() : '';
}

function coerceBool(v) {
  if (v === true || v === 1) return true;
  if (v === false || v === 0) return false;
  if (typeof v === 'string') {
    const t = v.trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(t)) return true;
    if (['0', 'false', 'no', 'off', ''].includes(t)) return false;
  }
  return Boolean(v);
}

/**
 * @param {unknown} payload SSE or HTTP body
 * @returns {boolean}
 */
export function whatsappPayloadLooksComplete(payload) {
  const n = normalizeWhatsappSettings(payload);
  return n.enabled === true && n.url.length > 0;
}
