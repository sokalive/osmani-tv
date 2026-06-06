import { StatusBar } from 'react-native';
import * as ScreenOrientation from 'expo-screen-orientation';

const LOG_PREFIX = '[player][teardown]';

/**
 * @param {string} step
 * @param {unknown} [detail]
 */
export function logPlayerTeardown(step, detail) {
  if (detail !== undefined) {
    console.log(LOG_PREFIX, step, detail);
  } else {
    console.log(LOG_PREFIX, step);
  }
}

export const WEBVIEW_STOP_HLS_SCRIPT =
  `(function(){try{var v=document.getElementById('v');if(v){v.pause();v.removeAttribute('src');v.load();}}catch(e){}})();true;`;

export const WEBVIEW_STOP_EMBED_SCRIPT =
  `(function(){try{var v=document.querySelector('video');if(v){v.pause();v.removeAttribute('src');v.load();}}catch(e){}})();true;`;

export const WEBVIEW_HARD_BLANK_SCRIPT =
  `(function(){try{window.stop();if(document.body){document.body.innerHTML='';document.body.style.background='#000';}}catch(e){}})();true;`;

/**
 * @param {{ current?: { pauseAsync?: () => Promise<void>; stopAsync?: () => Promise<void>; unloadAsync?: () => Promise<void> } | null }} videoRef
 * @param {string} [reason]
 */
export async function teardownNativeVideo(videoRef, reason = 'native') {
  const ref = videoRef?.current;
  if (!ref) {
    logPlayerTeardown(`${reason}:native_skip`, 'no_ref');
    return { ok: true, skipped: true };
  }
  try {
    await ref.pauseAsync?.();
    await ref.stopAsync?.();
    await ref.unloadAsync?.();
    logPlayerTeardown(`${reason}:native_ok`);
    return { ok: true };
  } catch (e) {
    logPlayerTeardown(`${reason}:native_error`, e?.message ?? e);
    return { ok: false, error: e };
  }
}

/**
 * @param {{
 *   hlsWebRef?: { current?: { injectJavaScript?: (s: string) => void } | null };
 *   embedWebRef?: { current?: { injectJavaScript?: (s: string) => void } | null };
 *   reason?: string;
 * }} opts
 */
export function teardownWebViewRefs({ hlsWebRef, embedWebRef, chromeWebRef, reason = 'webview' }) {
  const targets = [
    { ref: hlsWebRef, script: WEBVIEW_STOP_HLS_SCRIPT, label: 'hls' },
    { ref: embedWebRef, script: WEBVIEW_STOP_EMBED_SCRIPT, label: 'embed' },
    { ref: chromeWebRef, script: WEBVIEW_STOP_EMBED_SCRIPT, label: 'chrome' },
  ];
  for (const { ref, script, label } of targets) {
    const web = ref?.current;
    if (!web?.injectJavaScript) continue;
    try {
      web.injectJavaScript(script);
      web.injectJavaScript(WEBVIEW_HARD_BLANK_SCRIPT);
      logPlayerTeardown(`${reason}:${label}_injected`);
    } catch (e) {
      logPlayerTeardown(`${reason}:${label}_error`, e?.message ?? e);
    }
  }
}

/**
 * @param {{ resetStatusBar?: boolean }} [opts]
 */
export async function resetPlayerChrome(opts = {}) {
  const resetStatusBar = opts.resetStatusBar !== false;
  try {
    await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT);
    logPlayerTeardown('chrome:portrait');
  } catch (e) {
    logPlayerTeardown('chrome:portrait_error', e?.message ?? e);
  }
  if (resetStatusBar) {
    try {
      StatusBar.setHidden(false);
      logPlayerTeardown('chrome:statusbar_visible');
    } catch (e) {
      logPlayerTeardown('chrome:statusbar_error', e?.message ?? e);
    }
  }
}

/**
 * @param {{
 *   reason?: string;
 *   videoRef?: { current?: unknown };
 *   hlsWebRef?: { current?: { injectJavaScript?: (s: string) => void } | null };
 *   embedWebRef?: { current?: { injectJavaScript?: (s: string) => void } | null };
 *   chromeWebRef?: { current?: { injectJavaScript?: (s: string) => void } | null };
 *   resetChrome?: boolean;
 * }} opts
 */
export async function teardownPlayback(opts = {}) {
  const reason = String(opts.reason ?? 'unknown');
  logPlayerTeardown('start', reason);
  teardownWebViewRefs({
    hlsWebRef: opts.hlsWebRef,
    embedWebRef: opts.embedWebRef,
    chromeWebRef: opts.chromeWebRef,
    reason,
  });
  await teardownNativeVideo(opts.videoRef, reason);
  if (opts.resetChrome !== false) {
    await resetPlayerChrome();
  }
  logPlayerTeardown('done', reason);
}
