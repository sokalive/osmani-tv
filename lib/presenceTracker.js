import { AppState } from 'react-native';
import {
  PRESENCE_PING_MS,
  pingAppPresence,
  startAppPresence,
  stopAppPresence,
} from '../api/analytics';

/**
 * App-level presence tracker.
 *
 * Lifecycle:
 *  - `startPresence()` is called once at app launch from `App.js`.
 *  - A heartbeat fires every PRESENCE_PING_MS while the app is in
 *    foreground; stale sessions are reaped server-side after timeout.
 *  - `stopPresence()` runs on unmount (rare; mostly dev reloads).
 *  - AppState 'background'/'inactive' sends `stopAppPresence` so the
 *    user disappears from Live User Locations the moment the app is
 *    minimised. AppState 'active' restarts the session.
 *
 * Channel attachment:
 *  - `setActiveChannel(id, name)` records the channel currently being
 *    watched and sends an immediate heartbeat so admin watcher counts
 *    update without waiting for the next tick.
 *  - `clearActiveChannel()` removes channel context the same way.
 *
 * The tracker is intentionally side-effect free for any other
 * subsystem (UI, player, payment) — it only POSTs to
 * `/api/analytics/presence/*`.
 */

const DEBUG = true;

let sessionId = '';
let deviceId = '';
let activeChannelId = null;
let activeChannelName = null;
let heartbeatTimer = null;
let appStateSub = null;
let started = false;
let starting = false;

function log(...args) {
  if (!DEBUG) return;
  try {
    console.log('[presence]', ...args);
  } catch {
    // logging must never crash app
  }
}

function startHeartbeat() {
  stopHeartbeat();
  heartbeatTimer = setInterval(() => {
    void pingAppPresence({
      sessionId,
      deviceId,
      channelId: activeChannelId,
      channelName: activeChannelName,
    });
  }, PRESENCE_PING_MS);
  log('heartbeat started every', PRESENCE_PING_MS, 'ms');
}

function stopHeartbeat() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
    log('heartbeat cleared');
  }
}

async function handleAppStateChange(state) {
  log('app state →', state);
  if (state === 'active') {
    if (!started && !starting) {
      await startPresence();
    } else if (started) {
      startHeartbeat();
      void pingAppPresence({
        sessionId,
        deviceId,
        channelId: activeChannelId,
        channelName: activeChannelName,
      });
    }
    return;
  }
  if (state === 'background' || state === 'inactive') {
    if (started) {
      stopHeartbeat();
      const sid = sessionId;
      const did = deviceId;
      started = false;
      void stopAppPresence({ sessionId: sid, deviceId: did });
    }
  }
}

function ensureAppStateSub() {
  if (appStateSub) return;
  appStateSub = AppState.addEventListener('change', (next) => {
    void handleAppStateChange(next);
  });
}

/** Idempotent — safe to call multiple times. */
export async function startPresence() {
  if (started || starting) return;
  starting = true;
  try {
    const result = await startAppPresence();
    sessionId = result.sessionId || sessionId;
    deviceId = result.deviceId || deviceId;
    if (sessionId) {
      started = true;
      startHeartbeat();
      ensureAppStateSub();
      log('presence started', { sessionId, deviceId });
      // Send an immediate channel-attached ping if a channel was set
      // before presence finished bootstrapping.
      if (activeChannelId || activeChannelName) {
        void pingAppPresence({
          sessionId,
          deviceId,
          channelId: activeChannelId,
          channelName: activeChannelName,
        });
      }
    } else {
      log('presence start returned empty sessionId; will retry on next AppState change');
      ensureAppStateSub();
    }
  } finally {
    starting = false;
  }
}

/** Stops heartbeat and notifies backend the user is going offline. */
export async function stopPresence({ keepAppStateListener = false } = {}) {
  stopHeartbeat();
  if (started && sessionId) {
    const sid = sessionId;
    const did = deviceId;
    started = false;
    await stopAppPresence({ sessionId: sid, deviceId: did });
    log('presence stopped');
  }
  if (!keepAppStateListener && appStateSub) {
    try {
      appStateSub.remove();
    } catch {
      // ignore
    }
    appStateSub = null;
  }
}

export function setActiveChannel(channelId, channelName) {
  const id = channelId != null && channelId !== '' ? String(channelId) : null;
  const name = channelName != null && channelName !== '' ? String(channelName) : null;
  activeChannelId = id;
  activeChannelName = name;
  log('active channel set', { id, name });
  if (started && sessionId) {
    void pingAppPresence({
      sessionId,
      deviceId,
      channelId: activeChannelId,
      channelName: activeChannelName,
    });
  }
}

export function clearActiveChannel() {
  if (activeChannelId == null && activeChannelName == null) return;
  activeChannelId = null;
  activeChannelName = null;
  log('active channel cleared');
  if (started && sessionId) {
    void pingAppPresence({
      sessionId,
      deviceId,
      channelId: null,
      channelName: null,
    });
  }
}
