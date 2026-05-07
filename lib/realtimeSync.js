import EventSource from 'react-native-sse';
import { BASE_URL } from '../api';

const SYNC_URL = `${BASE_URL.replace(/\/+$/, '')}/api/sync/stream`;
const RECONNECT_MS = 15000;
const EVENTS = [
  'whatsapp_settings_changed',
  'popup_settings_changed',
  'server_health_changed',
  'transfer_requested',
  'transfer_completed',
  'subscription_revoked',
  'app_settings_changed',
];

let source = null;
let reconnectTimer = null;
let started = false;
const listeners = new Map();

function log(tag, ...args) {
  try {
    console.log(tag, ...args);
  } catch {}
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

function emit(name, payload) {
  const set = listeners.get(name);
  if (!set) return;
  for (const cb of set) {
    try {
      cb(payload);
    } catch {}
  }
}

function clearReconnect() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

function disconnect() {
  clearReconnect();
  if (source) {
    try {
      source.close();
    } catch {}
    source = null;
  }
}

function connect() {
  if (!started || source) return;
  try {
    source = new EventSource(SYNC_URL, {
      headers: { Accept: 'text/event-stream' },
      timeout: 0,
    });
  } catch (e) {
    log('[SSE_EVENT]', 'construct_failed', e?.message ?? e);
    reconnectTimer = setTimeout(connect, RECONNECT_MS);
    return;
  }

  source.addEventListener('open', () => {
    log('[SSE_CONNECTED]', SYNC_URL);
  });

  for (const name of EVENTS) {
    source.addEventListener(name, (event) => {
      const payload = parsePayload(event);
      log('[SSE_EVENT]', name, payload);
      emit(name, payload);
    });
  }

  source.addEventListener('error', (event) => {
    log('[SSE_EVENT]', 'error', event?.message ?? '(no message)');
    disconnect();
    if (started) reconnectTimer = setTimeout(connect, RECONNECT_MS);
  });
}

export function startRealtimeSync() {
  if (started) return;
  started = true;
  connect();
}

export function stopRealtimeSync() {
  started = false;
  disconnect();
}

export function subscribeRealtimeEvent(name, cb) {
  if (!listeners.has(name)) listeners.set(name, new Set());
  listeners.get(name).add(cb);
  return () => {
    const set = listeners.get(name);
    if (!set) return;
    set.delete(cb);
    if (set.size === 0) listeners.delete(name);
  };
}

