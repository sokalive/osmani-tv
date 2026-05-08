import EventSource from 'react-native-sse';
import { BASE_URL } from '../api';

/**
 * Realtime SSE bridge against /api/sync/stream.
 *
 * The simple device-transfer flow has NO approve/reject handshake, so
 * this bus only listens to the small set of security/UX-critical
 * channels:
 *
 *   - `subscription_revoked`     — source must lose access immediately
 *   - `transfer_completed`       — final state, also revokes the source
 *   - `app_settings_changed`     — refresh catalog + settings
 *   - `whatsapp_settings_changed`
 *   - `popup_settings_changed`
 *   - `server_health_changed`
 *
 * Stable diagnostic tags (greppable in device console):
 *   [SSE_DIAG]          — high-level lifecycle / config
 *   [SSE_CONNECTED]     — open
 *   [SSE_DISCONNECTED]  — close / reconnect
 *   [SSE_EVENT]         — any frame delivered to the bus
 *   [SSE_RAW_FRAME]     — raw frame inspector (every event before parse)
 *   [SSE_HEARTBEAT]     — periodic alive ping (every 60s)
 *   [SSE_LISTENER]      — subscribe/unsubscribe at the JS bus level
 */

const SYNC_URL = `${BASE_URL.replace(/\/+$/, '')}/api/sync/stream`;
const RECONNECT_MS = 15000;
const HEARTBEAT_MS = 60000;

const EVENTS = [
  'whatsapp_settings_changed',
  'popup_settings_changed',
  'server_health_changed',
  'subscription_revoked',
  'transfer_completed',
  'app_settings_changed',
];

let source = null;
let reconnectTimer = null;
let heartbeatTimer = null;
let started = false;
let connectedAt = null;
let frameCount = 0;
let connectionAttempts = 0;
const listeners = new Map();
const seenEventNames = new Set();
const recentFrames = [];
const RECENT_FRAMES_MAX = 10;

function log(tag, ...args) {
  try {
    console.log(tag, ...args);
  } catch {}
}

function pushRecent(frame) {
  recentFrames.push(frame);
  if (recentFrames.length > RECENT_FRAMES_MAX) {
    recentFrames.splice(0, recentFrames.length - RECENT_FRAMES_MAX);
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

function emit(name, payload) {
  const set = listeners.get(name);
  if (!set) return;
  for (const cb of set) {
    try {
      cb(payload);
    } catch (e) {
      log('[SSE_LISTENER]', 'consumer_threw', name, e?.message ?? e);
    }
  }
}

function clearReconnect() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

function clearHeartbeat() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

function disconnect(reason = 'unknown') {
  log('[SSE_DISCONNECTED]', reason, {
    connectedAt,
    upMs: connectedAt ? Date.now() - connectedAt : null,
    framesReceived: frameCount,
  });
  clearReconnect();
  clearHeartbeat();
  connectedAt = null;
  if (source) {
    try {
      source.close();
    } catch {}
    source = null;
  }
}

function handleFrame(eventName, event) {
  frameCount += 1;
  const parsed = parsePayload(event);
  if (!seenEventNames.has(eventName)) seenEventNames.add(eventName);
  const logRow = {
    name: eventName,
    rawDataLength: typeof event?.data === 'string' ? event.data.length : null,
    payload: parsed,
  };
  log('[SSE_RAW_FRAME]', logRow);
  pushRecent({ ts: Date.now(), ...logRow });
  log('[SSE_EVENT]', eventName, parsed);
  emit(eventName, parsed);
}

function startHeartbeat() {
  clearHeartbeat();
  heartbeatTimer = setInterval(() => {
    log('[SSE_HEARTBEAT]', {
      url: SYNC_URL,
      connected: Boolean(source) && Boolean(connectedAt),
      upMs: connectedAt ? Date.now() - connectedAt : null,
      framesReceived: frameCount,
      seenEventNames: Array.from(seenEventNames),
      reconnectAttempts: connectionAttempts,
    });
  }, HEARTBEAT_MS);
}

function connect() {
  if (!started || source) return;
  connectionAttempts += 1;
  log('[SSE_DIAG]', 'connecting', {
    url: SYNC_URL,
    attempt: connectionAttempts,
    events: EVENTS.length,
  });
  try {
    source = new EventSource(SYNC_URL, {
      headers: { Accept: 'text/event-stream', 'Cache-Control': 'no-cache' },
      timeout: 0,
    });
  } catch (e) {
    log('[SSE_DIAG]', 'construct_failed', e?.message ?? e);
    reconnectTimer = setTimeout(connect, RECONNECT_MS);
    return;
  }

  source.addEventListener('open', () => {
    connectedAt = Date.now();
    log('[SSE_CONNECTED]', SYNC_URL, { attempt: connectionAttempts });
  });

  for (const name of EVENTS) {
    source.addEventListener(name, (event) => handleFrame(name, event));
  }

  source.addEventListener('error', (event) => {
    log('[SSE_DIAG]', 'error', {
      message: event?.message ?? '(no message)',
      xhrStatus: event?.xhrStatus ?? null,
      framesBeforeError: frameCount,
      upMs: connectedAt ? Date.now() - connectedAt : null,
    });
    disconnect('error');
    if (started) reconnectTimer = setTimeout(connect, RECONNECT_MS);
  });

  startHeartbeat();
}

export function startRealtimeSync() {
  if (started) return;
  started = true;
  log('[SSE_DIAG]', 'startRealtimeSync', { url: SYNC_URL });
  connect();
}

export function stopRealtimeSync() {
  started = false;
  log('[SSE_DIAG]', 'stopRealtimeSync', { framesReceived: frameCount });
  disconnect('manual_stop');
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

export function getRealtimeDebugSnapshot() {
  return {
    url: SYNC_URL,
    started,
    connected: Boolean(source) && Boolean(connectedAt),
    connectedAt,
    upMs: connectedAt ? Date.now() - connectedAt : null,
    reconnectAttempts: connectionAttempts,
    framesReceived: frameCount,
    seenEventNames: Array.from(seenEventNames),
    registeredConsumerEvents: Array.from(listeners.keys()),
    recentFrames: recentFrames.slice(),
    timestamp: new Date().toISOString(),
  };
}
