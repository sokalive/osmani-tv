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
 *  - `stopPresence()` runs on root unmount (mostly dev reloads / true
 *    app teardown).
 *  - AppState `background` is the ONLY transient signal that tears the
 *    session down, and even then only after a short grace window so
 *    quick `active → background → active` flickers do not interrupt
 *    Live User Locations. AppState `inactive` is intentionally ignored
 *    (it is fired during orientation changes, navigation transitions,
 *    control center, biometric prompts, etc., and must not remove the
 *    user from the dashboard).
 *
 * Channel attachment is deliberately decoupled from the session:
 *  - `setActiveChannel(id, name)` and `clearActiveChannel()` only
 *    update the channel fields on the live session and send an
 *    immediate heartbeat — they NEVER stop the heartbeat, NEVER flip
 *    `started`, and NEVER POST `presence/stop`. Leaving a channel
 *    therefore can NOT remove the user from Live User Locations.
 *
 * The tracker is intentionally side-effect free for any other
 * subsystem (UI, player, payment) — it only POSTs to
 * `/api/analytics/presence/*`.
 */

const DEBUG = __DEV__;
/**
 * Grace period before honoring a `background` event. Quick OS-level
 * transitions (app switcher peek, biometric prompt, brief
 * notification-shade pull) can flicker `active → background → active`
 * inside a second; without this delay the dashboard would briefly
 * lose the user. Real backgrounding stays past this window and the
 * stop fires normally.
 */
const BACKGROUND_GRACE_MS = 4000;

let sessionId = '';
let deviceId = '';
let activeChannelId = null;
let activeChannelName = null;
let heartbeatTimer = null;
let appStateSub = null;
let started = false;
let starting = false;
let pendingStopTimer = null;

function log(...args) {
  if (!DEBUG) return;
  try {
    console.log('[presence]', ...args);
  } catch {
    // logging must never crash app
  }
}

function resetActiveChannelRefs() {
  activeChannelId = null;
  activeChannelName = null;
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

function cancelPendingStop(reason) {
  if (pendingStopTimer) {
    clearTimeout(pendingStopTimer);
    pendingStopTimer = null;
    log('pending stop cancelled', reason || '');
  }
}

async function handleAppStateChange(state) {
  log('app state →', state);
  if (state === 'active') {
    cancelPendingStop('back-to-active');
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
  // 'inactive' is a transient state — emitted by the OS during
  // orientation changes, navigation transitions, control center pulls,
  // incoming calls, the app switcher peek, biometric prompts, etc.
  // It MUST NOT remove the user from Live User Locations. We only treat
  // a sustained `background` as truly offline, and even then only after
  // a short grace window so `active → background → active` flickers do
  // not interrupt the live session.
  if (state === 'background') {
    if (!started) return;
    if (pendingStopTimer) return;
    pendingStopTimer = setTimeout(() => {
      pendingStopTimer = null;
      if (!started) return;
      stopHeartbeat();
      resetActiveChannelRefs();
      const sid = sessionId;
      const did = deviceId;
      started = false;
      log('background grace elapsed → stopping presence');
      void stopAppPresence({ sessionId: sid, deviceId: did });
    }, BACKGROUND_GRACE_MS);
    log('background detected; scheduled stop in', BACKGROUND_GRACE_MS, 'ms');
  }
  // Any other state (notably 'inactive') is intentionally ignored.
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
  cancelPendingStop('explicit-stop');
  stopHeartbeat();
  resetActiveChannelRefs();
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

/**
 * Detach the channel from the app-level presence session WITHOUT
 * touching the session itself. This must never:
 *   - stop the heartbeat
 *   - flip `started` to false
 *   - call `stopAppPresence`
 *   - remove the row from Live User Locations
 *
 * It only nulls the channel fields and sends one immediate heartbeat
 * so the admin dashboard's per-channel watcher count drops without
 * waiting for the next 25 s tick. The user remains visible in Live
 * User Locations as long as the app itself is still open.
 */
export function clearActiveChannel() {
  if (activeChannelId == null && activeChannelName == null) return;
  activeChannelId = null;
  activeChannelName = null;
  log('active channel cleared (presence session unaffected)');
  if (started && sessionId) {
    void pingAppPresence({
      sessionId,
      deviceId,
      channelId: null,
      channelName: null,
    });
  }
}
