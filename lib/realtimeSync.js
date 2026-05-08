import EventSource from 'react-native-sse';
import { BASE_URL } from '../api';

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

const SYNC_URL = `${BASE_URL.replace(/\/+$/, '')}/api/sync/stream`;
const RECONNECT_MS = 15000;
const HEARTBEAT_MS = 30000;

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
const listeners = new Map();
const seenEventNames = new Set();
const recentFrames = []; // last 10 frames, for getRealtimeDebugSnapshot()
const RECENT_FRAMES_MAX = 20;

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
    unknownFrames: unknownFrameCount,
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
  clearHeartbeat();
  heartbeatTimer = setInterval(() => {
    log('[SSE_HEARTBEAT]', {
      url: SYNC_URL,
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
  connectionAttempts += 1;
  log('[SSE_DIAG]', 'connecting', {
    url: SYNC_URL,
    attempt: connectionAttempts,
    whitelistEvents: EVENTS.length,
    probeEvents: TRANSFER_CANDIDATES.length,
    timestamp: new Date().toISOString(),
  });
  try {
    source = new EventSource(SYNC_URL, {
      headers: { Accept: 'text/event-stream', 'Cache-Control': 'no-cache' },
      timeout: 0,
      // Verbose internal logs from react-native-sse. Helps diagnose
      // proxy/CDN truncation and silent stream death.
      debug: true,
    });
  } catch (e) {
    log('[SSE_DIAG]', 'construct_failed', e?.message ?? e);
    reconnectTimer = setTimeout(connect, RECONNECT_MS);
    return;
  }

  source.addEventListener('open', () => {
    connectedAt = Date.now();
    log('[SSE_CONNECTED]', SYNC_URL, {
      attempt: connectionAttempts,
      timestamp: new Date().toISOString(),
    });
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
    });
    disconnect('error');
    if (started) reconnectTimer = setTimeout(connect, RECONNECT_MS);
  });

  source.addEventListener('close', () => {
    log('[SSE_DIAG]', 'close', {
      framesReceived: frameCount,
      upMs: connectedAt ? Date.now() - connectedAt : null,
    });
    disconnect('close');
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
    url: SYNC_URL,
    started,
    connected: Boolean(source) && Boolean(connectedAt),
    connectedAt,
    upMs: connectedAt ? Date.now() - connectedAt : null,
    reconnectAttempts: connectionAttempts,
    framesReceived: frameCount,
    unknownFrames: unknownFrameCount,
    seenEventNames: Array.from(seenEventNames),
    registeredConsumerEvents: Array.from(listeners.keys()),
    recentFrames: recentFrames.slice(),
    timestamp: new Date().toISOString(),
  };
}
