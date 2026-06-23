import { PUBLISHED_PLAY_VERSION_CODE } from './parseUpdateCheckResponse';
import { readNativeAndroidVersionCode } from './playVpsApiHost';

export const CHANNEL_UPDATE_GATE_TITLE = 'Huwezi kutazama channel hii hadi ufanye update';
export const CHANNEL_UPDATE_GATE_MESSAGE =
  'Bonyeza UPDATE kupata toleo jipya. Baada ya update, utaendelea kutumia Osmani TV kwenye mfumo mpya.';
export const CHANNEL_UPDATE_GATE_BUTTON = 'UPDATE';

/**
 * Legacy Play APKs (native versionCode below v24) may be blocked from channel
 * playback when admin enables require_update_before_channel_playback.
 *
 * @param {boolean|undefined|null} requireUpdateBeforeChannelPlayback
 * @returns {boolean}
 */
export function shouldBlockChannelForUpdate(requireUpdateBeforeChannelPlayback) {
  if (!requireUpdateBeforeChannelPlayback) return false;
  const vc = readNativeAndroidVersionCode();
  if (vc == null || vc >= PUBLISHED_PLAY_VERSION_CODE) return false;
  return true;
}
