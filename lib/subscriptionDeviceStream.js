/**
 * Persistent device-targeted subscription SSE — wake-up only.
 * Admin manual grants may emit on /api/subscription-stream before global /api/sync/stream.
 * Always pairs with authoritative verify in OsmaniAppContext (never unlocks from stream alone).
 */

import { AppState } from 'react-native';
import EventSource from 'react-native-sse';
import { resolveApiBaseUrl } from './apiBaseUrl';
import { SUBSCRIPTION_WAKE_SSE_EVENTS } from './adminSseRefreshEvents';
import { getDeviceIdentity } from './deviceIdentity';

/** Device stream also carries exact-device revoke / entitlement mutations. */
const SUBSCRIPTION_DEVICE_STREAM_EVENTS = Object.freeze([
  ...SUBSCRIPTION_WAKE_SSE_EVENTS,
  'subscription_revoked',
  'entitlement_changed',
]);

const RECONNECT_MS = 12_000;
const RECONNECT_MAX_MS = 60_000;
const WAKE_COALESCE_MS = 80;

/** @type {EventSource | null} */
let source = null;
let started = false;
let reconnectTimer = null;
let wakeTimer = null;
let reconnectBackoffMs = RECONNECT_MS;
/** @type {string} */
let activeDeviceId = '';
/** @type {((reason: string, payload: unknown) => void) | null} */
let onWake = null;
let appStateSub = null;

function log(tag, detail) {
  try {
    console.log('[SUBSCRIPTION_DEVICE_STREAM]', tag, detail ?? '');
  } catch {
    /* ignore */
  }
}

function parsePayload(event) {
  const raw = event?.data;
  if (raw == null || raw === '') return null;
  try {
    return JSON.parse(String(raw));
  } catch {
    return raw;
  }
}

function scheduleWake(reason, payload) {
  if (!onWake) return;
  if (wakeTimer) clearTimeout(wakeTimer);
  wakeTimer = setTimeout(() => {
    wakeTimer = null;
    try {
      onWake(reason, payload);
    } catch (e) {
      log('wake_handler_error', e?.message ?? e);
    }
  }, WAKE_COALESCE_MS);
}

function disconnect(reason = 'unknown') {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (source) {
    try {
      source.close();
    } catch {
      /* ignore */
    }
    source = null;
  }
  log('disconnected', { reason, deviceId: activeDeviceId ? `${activeDeviceId.slice(0, 4)}…` : '' });
}

function scheduleReconnect(reason) {
  if (!started || reconnectTimer) return;
  const delay = reconnectBackoffMs;
  reconnectBackoffMs = Math.min(reconnectBackoffMs * 2, RECONNECT_MAX_MS);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    void connect();
  }, delay);
  log('reconnect_scheduled', { reason, delayMs: delay });
}

async function connect() {
  if (!started) return;
  disconnect('reconnect');
  let deviceId = activeDeviceId;
  if (!deviceId) {
    try {
      const identity = await getDeviceIdentity();
      deviceId = String(identity?.deviceId ?? '').trim();
      activeDeviceId = deviceId;
    } catch (e) {
      log('identity_error', e?.message ?? e);
      scheduleReconnect('identity_error');
      return;
    }
  }
  if (!deviceId) {
    scheduleReconnect('no_device_id');
    return;
  }

  const base = resolveApiBaseUrl().replace(/\/+$/, '');
  const url = `${base}/api/subscription-stream?device_id=${encodeURIComponent(deviceId)}`;
  log('connecting', { url: `${base}/api/subscription-stream?device_id=…` });

  try {
    source = new EventSource(url, { pollingInterval: 0 });
  } catch (e) {
    log('construct_failed', e?.message ?? e);
    scheduleReconnect('construct_failed');
    return;
  }

  const handleWake = (eventName, event) => {
    const payload = parsePayload(event);
    log('wake', { eventName, hasPayload: payload != null });
    scheduleWake(`subscription-stream:${eventName}`, payload);
  };

  source.addEventListener('open', () => {
    reconnectBackoffMs = RECONNECT_MS;
    log('connected', { deviceId: `${deviceId.slice(0, 4)}…` });
    scheduleWake('subscription-stream:open', { device_id: deviceId });
  });

  source.addEventListener('message', (event) => handleWake('message', event));

  for (const name of SUBSCRIPTION_DEVICE_STREAM_EVENTS) {
    source.addEventListener(name, (event) => handleWake(name, event));
  }

  source.addEventListener('error', () => {
    disconnect('error');
    if (started) scheduleReconnect('error');
  });

  source.addEventListener('close', () => {
    disconnect('close');
    if (started) scheduleReconnect('close');
  });
}

function handleAppState(next) {
  if (next !== 'active' || !started) return;
  reconnectBackoffMs = RECONNECT_MS;
  void connect();
}

/**
 * @param {(reason: string, payload: unknown) => void} wakeHandler
 * @returns {() => void}
 */
export function startSubscriptionDeviceStream(wakeHandler) {
  onWake = wakeHandler;
  if (started) return stopSubscriptionDeviceStream;
  started = true;
  if (!appStateSub) {
    appStateSub = AppState.addEventListener('change', handleAppState);
  }
  void connect();
  return stopSubscriptionDeviceStream;
}

export function stopSubscriptionDeviceStream() {
  started = false;
  onWake = null;
  if (wakeTimer) {
    clearTimeout(wakeTimer);
    wakeTimer = null;
  }
  if (appStateSub) {
    try {
      appStateSub.remove();
    } catch {
      /* ignore */
    }
    appStateSub = null;
  }
  disconnect('stop');
}
