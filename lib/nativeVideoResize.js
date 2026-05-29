import ExpoVideoManager from 'expo-av/build/ExpoVideoManager';
import { ResizeMode } from 'expo-av';

/**
 * Map app resize mode to expo-av / ExoPlayer native scale constant.
 * @param {unknown} mode
 * @returns {number}
 */
export function nativeResizeModeConstant(mode) {
  const s = String(mode ?? ResizeMode.CONTAIN).toLowerCase();
  if (s === ResizeMode.COVER || s === 'cover') {
    return ExpoVideoManager.ScaleAspectFill;
  }
  if (s === ResizeMode.STRETCH || s === 'stretch') {
    return ExpoVideoManager.ScaleToFill;
  }
  return ExpoVideoManager.ScaleAspectFit;
}

/**
 * Apply resize mode on the mounted expo-av Video (Android ExoPlayer needs this
 * after mount — prop-only updates often do not redraw the texture view).
 *
 * @param {{ current?: { setNativeProps?: (props: object) => void } | null }} videoRef
 * @param {unknown} mode
 */
export function applyNativeVideoResizeMode(videoRef, mode) {
  const ref = videoRef?.current;
  if (!ref || typeof ref.setNativeProps !== 'function') return;
  try {
    ref.setNativeProps({ resizeMode: nativeResizeModeConstant(mode) });
  } catch {
    /* ignore — prop fallback still set on Video */
  }
}

/**
 * @param {unknown} mode
 * @returns {'contain' | 'cover'}
 */
export function normalizeVideoResizeMode(mode) {
  return String(mode ?? '').toLowerCase() === ResizeMode.COVER ? ResizeMode.COVER : ResizeMode.CONTAIN;
}
