import { AppState } from 'react-native';
import EventSource from 'react-native-sse';
import { getApiBaseUrl } from './apiBaseUrl';
import {
  ADMIN_RUNTIME_MODE_SSE_EVENTS,
  ADMIN_SOFT_REFRESH_SSE_EVENTS,
  DEVICE_INTELLIGENCE_SSE_EVENTS,
  SUBSCRIPTION_WAKE_SSE_EVENTS,
  UPDATE_SETTINGS_SSE_EVENTS,
  USER_CENTER_SSE_EVENTS,
} from './adminSseRefreshEvents';

/**
 * Realtime SSE bridge against /api/sync/stream.
 *
 * Diagnostic mode: this file is intentionally verbose right now. The
 * goal is to make backend delivery problems trivial to diagnose from
 * the device console — every connection state change, every parsed
 * frame, and every dispatch is logged with a stable tag.
 *
 * Stable diagnostic tags (search for these in the device log):
 *   [SSE_DIAG]          — high-level lifecycle / config
 *   [SSE_CONNECTED]     — open
 *   [SSE_DISCONNECTED]  — close / reconnect
 *   [SSE_EVENT]         — any frame delivered to the bus
 *   [SSE_RAW_FRAME]     — raw frame inspector (every event before parse)
 *   [SSE_UNKNOWN_EVENT] — frame whose event name is not in the whitelist
 *   [SSE_HEARTBEAT]     — periodic alive ping (every 30s)
 *   [SSE_LISTENER]      — subscribe/unsubscribe at the JS bus level
 */

const RECONNECT_MS = 15_000;
const RECONNECT_MAX_MS = 60_000;
const HEARTBEAT_MS = 30_000;
const SSE_VERBOSE = __DEV__;

/** Resolve at connect time so VPS/Render embedded URLs stay correct after OTA. */
function syncStreamEndpoints() {
  const base = getApiBaseUrl().replace(/\/+$/, '');
  return [`${base}/api/sync/stream`];
}

function currentSyncUrl() {
  const endpoints = syncStreamEndpoints();
  return endpoints[endpointIndex % endpoints.length];
}

/**
 * Whitelisted event channels we explicitly subscribe to. Every backend
 * event we _know_ about goes here. Unknown event names are still
 * captured by `[SSE_UNKNOWN_EVENT]` via a probe-listener for a wide
 * candidate list — see TRANSFER_CANDIDATES below.
 */
const EVENTS = [
  'whatsapp_settings_changed',
  'popup_settings_changed',
  'server_health_changed',
  // Transfer lifecycle (pending-confirmation flow):
  //   target submits code -> backend emits `transfer_confirmation_required`
  //     to source and `transfer_pending` to target.
  //   source approves     -> backend emits `transfer_approved` (target)
  //                          and `transfer_completed` (both).
  //   source rejects      -> backend emits `transfer_rejected` (target).
  'transfer_requested',
  'transfer_confirmation_required',
  'transfer_pending',
  'transfer_approved',
  'transfer_rejected',
  'transfer_completed',
  'subscription_revoked',
  'app_settings_changed',
  'config.settings_changed',
  'phone_gate_changed',
  ...ADMIN_RUNTIME_MODE_SSE_EVENTS,
  ...ADMIN_SOFT_REFRESH_SSE_EVENTS,
  ...SUBSCRIPTION_WAKE_SSE_EVENTS,
  ...UPDATE_SETTINGS_SSE_EVENTS,
  ...DEVICE_INTELLIGENCE_SSE_EVENTS,
  ...USER_CENTER_SSE_EVENTS,
];

/**
 * Speculative candidate event names we ALSO listen on as probes. If the
 * backend ships a transfer event under a slightly different name, the
 * listener for that candidate will fire and we'll surface it via
 * `[SSE_UNKNOWN_EVENT]` — no code change required to discover it.
 *
 * react-native-sse has no wildcard, so we addEventListener for each
 * candidate name. Probes are cheap.
 */
const TRANSFER_CANDIDATES = [
  'transfer',
  'transfer_event',
  'transfer_update',
  'transfer_status',
  'transfer_status_changed',
  'transfer_notification',
  'transfer_request',
  'transfer_create',
  'transfer_created',
  'transfer_initiated',
  'transfer_confirm',
  'transfer_confirmed',
  'transfer_received',
  'transfer_redeemed',
  'transfer_pending_confirmation',
  'transfer_awaiting_confirmation',
  'transfer_request_confirmation',
  'subscription_transfer',
  'subscription_transfer_pending',
  'subscription_transferred',
  'pending_transfer',
  'incoming_transfer',
  'snapshot', // top-level state snapshot
];

let source = null;
let reconnectTimer = null;
let heartbeatTimer = null;
let started = false;
let connectedAt = null;
let frameCount = 0;
let unknownFrameCount = 0;
let connectionAttempts = 0;
let reconnectBackoffMs = RECONNECT_MS;
let endpointIndex = 0;
let activeSyncUrl = null;
let appStateSub = null;
const listeners = new Map();
const seenEventNames = new Set();
const recentFrames = []; // last 10 frames, for getRealtimeDebugSnapshot()
const RECENT_FRAMES_MAX = 20;

function log(tag, ...args) {
  if (!SSE_VERBOSE) return;
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

/**
 * Some backend frames wrap the actual payload as
 *   { event: "<name>", payload: {...}, configVersion, serverTime }
 * Surface both shapes — the bus delivers the OUTER frame to consumers
 * (so existing handlers keep working), and we ALSO log the inner
 * payload separately for clarity.
 */
function unwrapPayload(parsed) {
  if (parsed && typeof parsed === 'object' && parsed.event && 'payload' in parsed) {
    return { wrapper: true, eventName: String(parsed.event), inner: parsed.payload, outer: parsed };
  }
  return { wrapper: false, eventName: null, inner: parsed, outer: parsed };
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

function scheduleReconnect(reason = 'unknown') {
  if (!started || reconnectTimer) return;
  const delay = reconnectBackoffMs;
  reconnectBackoffMs = Math.min(reconnectBackoffMs * 2, RECONNECT_MAX_MS);
  log('[SSE_DIAG]', 'reconnect_scheduled', { reason, delayMs: delay, url: activeSyncUrl });
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, delay);
}

function resetReconnectBackoff() {
  reconnectBackoffMs = RECONNECT_MS;
}

function clearHeartbeat() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

function disconnect(reason = 'unknown') {
  log('[SSE_DISCONNECTED]', reason, {
    url: activeSyncUrl,
    connectedAt,
    upMs: connectedAt ? Date.now() - connectedAt : null,
    framesReceived: frameCount,
    unknownFrames: unknownFrameCount,
  });
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  clearHeartbeat();
  connectedAt = null;
  activeSyncUrl = null;
  if (source) {
    try {
      source.close();
    } catch {}
    source = null;
  }
}

/**
 * Centralised frame handler. Logs the raw frame (with stable tag),
 * unwraps backend envelopes, dispatches the inner data to registered
 * consumers, and tracks any event name we haven't seen before.
 */
function handleFrame(eventName, event) {
  frameCount += 1;
  const lastEventId = event?.lastEventId ?? null;
  const url = event?.url ?? null;
  const parsed = parsePayload(event);
  const unwrapped = unwrapPayload(parsed);
  const isFirstSeenName = !seenEventNames.has(eventName);
  if (isFirstSeenName) seenEventNames.add(eventName);
  const logRow = {
    name: eventName,
    firstSeenName: isFirstSeenName,
    wrapper: unwrapped.wrapper,
    declaredEvent: unwrapped.eventName,
    lastEventId,
    url,
    rawDataLength: typeof event?.data === 'string' ? event.data.length : null,
    inner: unwrapped.inner,
  };
  log('[SSE_RAW_FRAME]', logRow);
  pushRecent({ ts: Date.now(), ...logRow });
  // Bus consumers receive the OUTER parsed payload (back-compat), but
  // they can read `.payload` if the backend wraps. Existing handlers
  // already tolerate both shapes via `pickPayloadString` etc.
  log('[SSE_EVENT]', eventName, parsed);
  emit(eventName, parsed);
  if (unwrapped.wrapper && unwrapped.eventName) {
    const innerName = String(unwrapped.eventName).trim();
    if (innerName && innerName !== eventName) {
      emit(innerName, unwrapped.inner ?? parsed);
    }
  }
  // Also fan out to a synthetic '*' bus so callers can subscribe to
  // every event regardless of name (used by diagnostic overlays).
  emit('*', { name: eventName, payload: parsed, lastEventId, url });
}

function attachListenerWithName(es, eventName, kind) {
  try {
    es.addEventListener(eventName, (event) => {
      // Probe-channel events are tagged differently so the user can
      // grep for unknown traffic specifically.
      if (kind === 'probe') {
        unknownFrameCount += 1;
        log('[SSE_UNKNOWN_EVENT]', eventName, parsePayload(event));
      }
      handleFrame(eventName, event);
    });
  } catch (e) {
    log('[SSE_DIAG]', 'addEventListener_failed', { eventName, kind, error: e?.message ?? e });
  }
}

function startHeartbeat() {
  if (!SSE_VERBOSE) return;
  clearHeartbeat();
  heartbeatTimer = setInterval(() => {
    log('[SSE_HEARTBEAT]', {
      url: activeSyncUrl ?? currentSyncUrl(),
      connected: Boolean(source) && Boolean(connectedAt),
      connectedAt,
      upMs: connectedAt ? Date.now() - connectedAt : null,
      framesReceived: frameCount,
      unknownFrames: unknownFrameCount,
      seenEventNames: Array.from(seenEventNames),
      registeredConsumerEvents: Array.from(listeners.keys()),
      reconnectAttempts: connectionAttempts,
    });
  }, HEARTBEAT_MS);
}

function connect() {
  if (!started || source) return;
  const url = currentSyncUrl();
  activeSyncUrl = url;
  connectionAttempts += 1;
  log('[SSE_DIAG]', 'connecting', {
    url,
    attempt: connectionAttempts,
    whitelistEvents: EVENTS.length,
    probeEvents: TRANSFER_CANDIDATES.length,
    timestamp: new Date().toISOString(),
  });
  try {
    source = new EventSource(url, {
      headers: { Accept: 'text/event-stream', 'Cache-Control': 'no-cache' },
      timeout: 0,
      // Verbose internal logs from react-native-sse. Helps diagnose
      // proxy/CDN truncation and silent stream death.
      debug: SSE_VERBOSE,
    });
  } catch (e) {
    log('[SSE_DIAG]', 'construct_failed', e?.message ?? e);
    endpointIndex += 1;
    scheduleReconnect('construct_failed');
    return;
  }

  source.addEventListener('open', () => {
    connectedAt = Date.now();
    resetReconnectBackoff();
    log('[SSE_CONNECTED]', url, {
      attempt: connectionAttempts,
      timestamp: new Date().toISOString(),
    });
    emit('__sync_stream_connected', { url, timestamp: connectedAt });
  });

  // Default 'message' channel — events without an explicit `event:` line
  // land here. We must capture this; backends that don't tag the event
  // name still deliver via `message`.
  attachListenerWithName(source, 'message', 'default');

  for (const name of EVENTS) {
    attachListenerWithName(source, name, 'whitelist');
  }
  for (const name of TRANSFER_CANDIDATES) {
    if (EVENTS.includes(name)) continue;
    attachListenerWithName(source, name, 'probe');
  }

  source.addEventListener('error', (event) => {
    log('[SSE_DIAG]', 'error', {
      message: event?.message ?? '(no message)',
      xhrState: event?.xhrState ?? null,
      xhrStatus: event?.xhrStatus ?? null,
      type: event?.type ?? null,
      framesBeforeError: frameCount,
      upMs: connectedAt ? Date.now() - connectedAt : null,
      url,
    });
    disconnect('error');
    endpointIndex += 1;
    if (started) scheduleReconnect('error');
  });

  source.addEventListener('close', () => {
    log('[SSE_DIAG]', 'close', {
      framesReceived: frameCount,
      upMs: connectedAt ? Date.now() - connectedAt : null,
      url,
    });
    disconnect('close');
    endpointIndex += 1;
    if (started) scheduleReconnect('close');
  });

  startHeartbeat();
}

function handleAppStateChange(next) {
  if (next !== 'active' || !started) return;
  if (source && connectedAt) return;
  log('[SSE_DIAG]', 'app_foreground_reconnect');
  disconnect('app_foreground');
  resetReconnectBackoff();
  connect();
}

export function startRealtimeSync() {
  if (started) return;
  started = true;
  log('[SSE_DIAG]', 'startRealtimeSync', { url: currentSyncUrl() });
  if (!appStateSub) {
    appStateSub = AppState.addEventListener('change', handleAppStateChange);
  }
  connect();
}

export function stopRealtimeSync() {
  started = false;
  log('[SSE_DIAG]', 'stopRealtimeSync', { framesReceived: frameCount });
  if (appStateSub) {
    try {
      appStateSub.remove();
    } catch {}
    appStateSub = null;
  }
  disconnect('manual_stop');
}

/** Force a fresh SSE connection (e.g. after API base URL change). */
export function reconnectRealtimeSync(reason = 'manual') {
  if (!started) return;
  log('[SSE_DIAG]', 'reconnect_requested', reason);
  disconnect(reason);
  resetReconnectBackoff();
  connect();
}

export function subscribeRealtimeEvent(name, cb) {
  if (!listeners.has(name)) listeners.set(name, new Set());
  listeners.get(name).add(cb);
  log('[SSE_LISTENER]', 'subscribe', {
    name,
    consumers: listeners.get(name).size,
    totalNames: listeners.size,
  });
  return () => {
    const set = listeners.get(name);
    if (!set) return;
    set.delete(cb);
    log('[SSE_LISTENER]', 'unsubscribe', {
      name,
      consumers: set.size,
      totalNames: listeners.size,
    });
    if (set.size === 0) listeners.delete(name);
  };
}

/**
 * Snapshot for diagnostic overlays / debug mode. Returns a JSON-safe
 * object describing the current SSE connection state, observed event
 * names, and the most recent frames seen.
 */
export function getRealtimeDebugSnapshot() {
  return {
    url: activeSyncUrl ?? currentSyncUrl(),
    started,
    connected: Boolean(source) && Boolean(connectedAt),
    connectedAt,
    upMs: connectedAt ? Date.now() - connectedAt : null,
    reconnectAttempts: connectionAttempts,
    reconnectBackoffMs,
    framesReceived: frameCount,
    unknownFrames: unknownFrameCount,
    seenEventNames: Array.from(seenEventNames),
    registeredConsumerEvents: Array.from(listeners.keys()),
    recentFrames: recentFrames.slice(),
    timestamp: new Date().toISOString(),
  };
}
