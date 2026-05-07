import { AppState, Platform } from 'react-native';
import EventSource from 'react-native-sse';
import { BASE_URL } from '../api';

let OsmaniUpdate = null;

if (Platform.OS === 'android') {
  try {
    OsmaniUpdate = require('../modules/osmani-update');
  } catch (e) {
    if (__DEV__) {
      console.warn('[update] native module unavailable:', e?.message ?? e);
    }
    OsmaniUpdate = null;
  }
}

const DEBUG = true;
function log(...args) {
  if (!DEBUG) return;
  try {
    console.log('[update]', ...args);
  } catch {}
}

const RECHECK_DEBOUNCE_MS = 1500;
const RESUME_RECHECK_GUARD_MS = 30_000;
const SSE_RETRY_MS = 15_000;

let listeners = new Set();
let nativeStateSub = null;
let appStateSub = null;
let sseSource = null;
let sseRetryTimer = null;
let started = false;
let lastCheckAt = 0;
let lastResumeCheckAt = 0;
let recheckDebounce = null;

let lastUpdateInfo = null;
let lastNativeState = { state: 'idle' };
let lastUiState = {
  decision: 'NONE',
  visible: false,
  downloading: false,
  verifying: false,
  installing: false,
  needsUnknownSourcesPermission: false,
  failedReason: null,
  progress: { downloaded: 0, total: 0, percent: -1 },
  info: null,
};

function isAndroidNativeAvailable() {
  return Platform.OS === 'android' && OsmaniUpdate != null;
}

function notify() {
  for (const cb of listeners) {
    try { cb(lastUiState); } catch {}
  }
}

function setUi(patch) {
  lastUiState = { ...lastUiState, ...patch };
  notify();
}

function shouldShowFor(decision) {
  return decision === 'SOFT' || decision === 'FORCE' || decision === 'PLAY_STORE';
}

function recomputeUiFromNative(nativeState) {
  lastNativeState = nativeState ?? { state: 'idle' };
  const next = {
    downloading: false,
    verifying: false,
    installing: false,
    needsUnknownSourcesPermission: false,
  };
  switch (lastNativeState.state) {
    case 'downloading':
      next.downloading = true;
      lastUiState.progress = {
        downloaded: lastNativeState.downloaded ?? 0,
        total: lastNativeState.total ?? 0,
        percent:
          typeof lastNativeState.percent === 'number' ? lastNativeState.percent : -1,
      };
      break;
    case 'verifying':
      next.verifying = true;
      break;
    case 'installing':
      next.installing = true;
      break;
    case 'needs_unknown_sources_permission':
      next.needsUnknownSourcesPermission = true;
      break;
    case 'failed':
      lastUiState.failedReason = lastNativeState.error ?? 'unknown_error';
      break;
    default:
      break;
  }
  setUi(next);
}

function applyUpdateInfo(info) {
  lastUpdateInfo = info;
  const decision = info?.decision ?? 'NONE';
  setUi({
    decision,
    visible: shouldShowFor(decision),
    info,
    failedReason: null,
  });
}

async function performCheckOnce(reason) {
  if (!isAndroidNativeAvailable()) return null;
  const now = Date.now();
  if (now - lastCheckAt < RECHECK_DEBOUNCE_MS) return lastUpdateInfo;
  lastCheckAt = now;
  try {
    log('check →', reason);
    const info = await OsmaniUpdate.checkForUpdate(BASE_URL);
    log('check result', info?.decision, info?.latestVersionName);
    applyUpdateInfo(info);

    if (
      (info?.decision === 'SOFT' || info?.decision === 'FORCE') &&
      info?.autoDownload === true &&
      info?.apkUrl &&
      info?.apkSha256 &&
      !lastUiState.downloading &&
      !lastUiState.installing
    ) {
      void startDownload();
    }
    return info;
  } catch (e) {
    log('check failed', e?.message ?? e);
    return null;
  }
}

function scheduleCheck(reason, delayMs = 0) {
  if (recheckDebounce) {
    clearTimeout(recheckDebounce);
    recheckDebounce = null;
  }
  if (delayMs <= 0) {
    void performCheckOnce(reason);
    return;
  }
  recheckDebounce = setTimeout(() => {
    recheckDebounce = null;
    void performCheckOnce(reason);
  }, delayMs);
}

function handleAppState(state) {
  if (state !== 'active') return;
  const now = Date.now();
  if (now - lastResumeCheckAt < RESUME_RECHECK_GUARD_MS) return;
  lastResumeCheckAt = now;
  scheduleCheck('app-resume', 250);
}

function clearSseRetry() {
  if (sseRetryTimer) {
    clearTimeout(sseRetryTimer);
    sseRetryTimer = null;
  }
}

function disconnectSse() {
  clearSseRetry();
  if (sseSource) {
    try { sseSource.close(); } catch {}
    sseSource = null;
  }
}

function connectSse() {
  if (sseSource) return;
  const url = `${BASE_URL.replace(/\/+$/, '')}/api/app-settings/stream`;
  let es;
  try {
    es = new EventSource(url, {
      headers: { Accept: 'text/event-stream' },
      timeout: 0,
    });
  } catch (e) {
    log('sse construct failed', e?.message ?? e);
    sseRetryTimer = setTimeout(connectSse, SSE_RETRY_MS);
    return;
  }
  sseSource = es;
  log('sse connecting →', url);

  const onChange = (label) => () => {
    log('sse event:', label);
    scheduleCheck(`sse:${label}`, 200);
  };

  es.addEventListener('open', () => log('sse open'));
  es.addEventListener('app_version_changed', onChange('app_version_changed'));
  es.addEventListener('app_settings_changed', onChange('app_settings_changed'));
  es.addEventListener('update', onChange('update'));
  es.addEventListener('message', (event) => {
    if (event?.data) log('sse message', String(event.data).slice(0, 200));
    scheduleCheck('sse:message', 200);
  });
  es.addEventListener('error', (event) => {
    log('sse error', event?.message ?? '(no message)');
    disconnectSse();
    sseRetryTimer = setTimeout(connectSse, SSE_RETRY_MS);
  });
}

export function startUpdateClient() {
  if (started) return;
  started = true;
  if (!isAndroidNativeAvailable()) {
    log('skipped — not android or native module unavailable');
    return;
  }

  nativeStateSub = OsmaniUpdate.addStateListener((nativeState) => {
    log('native state', nativeState?.state);
    recomputeUiFromNative(nativeState);
  });

  appStateSub = AppState.addEventListener('change', handleAppState);

  scheduleCheck('app-launch', 0);
  connectSse();
}

export function stopUpdateClient() {
  if (!started) return;
  started = false;
  if (nativeStateSub) {
    try { nativeStateSub.remove(); } catch {}
    nativeStateSub = null;
  }
  if (appStateSub) {
    try { appStateSub.remove(); } catch {}
    appStateSub = null;
  }
  disconnectSse();
  if (recheckDebounce) {
    clearTimeout(recheckDebounce);
    recheckDebounce = null;
  }
}

export function subscribe(listener) {
  listeners.add(listener);
  try { listener(lastUiState); } catch {}
  return () => {
    listeners.delete(listener);
  };
}

export async function startDownload() {
  if (!isAndroidNativeAvailable()) return;
  const info = lastUpdateInfo;
  if (!info?.apkUrl || !info?.apkSha256) {
    log('startDownload: missing apkUrl/apkSha256');
    return;
  }
  if (lastUiState.downloading || lastUiState.installing) {
    log('startDownload: already in progress');
    return;
  }
  setUi({ failedReason: null });
  try {
    const result = await OsmaniUpdate.downloadAndInstall(info.apkUrl, info.apkSha256);
    log('install result', result?.status);
  } catch (e) {
    log('download/install failed', e?.message ?? e);
    setUi({ failedReason: e?.message ?? 'unknown_error' });
  }
}

export function cancelDownload() {
  if (!isAndroidNativeAvailable()) return;
  try { OsmaniUpdate.cancelDownload(); } catch {}
}

export function dismissSoft() {
  if (lastUiState.decision === 'FORCE') return;
  setUi({ visible: false });
}

export function quitForForceCancel() {
  if (!isAndroidNativeAvailable()) return;
  try { OsmaniUpdate.quitApp(); } catch {}
}

export async function openPlayStoreFromInfo() {
  if (!isAndroidNativeAvailable()) return;
  const url = lastUpdateInfo?.playStoreUrl;
  if (!url) return;
  try { await OsmaniUpdate.openPlayStore(url); } catch (e) {
    log('openPlayStore failed', e?.message ?? e);
  }
}

export function getCurrentState() {
  return lastUiState;
}

export function isNativeAvailable() {
  return isAndroidNativeAvailable();
}

export async function forceRecheck() {
  lastCheckAt = 0;
  return performCheckOnce('manual');
}
