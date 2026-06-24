import {
  isOutdated,
  latestVersionCodeFromBody,
  PUBLISHED_PLAY_VERSION_CODE,
} from './parseUpdateCheckResponse';
import { readNativeAndroidVersionCode } from './playVpsApiHost';
import {
  forceRecheck,
  getUpdateAction,
  openPlayStoreFromInfo,
  startDownload,
} from './updateClient';

export const ACCOUNT_UPDATE_ALREADY_LATEST_SWAHILI =
  'Tayari una toleo jipya. Hakuna update inayohitajika kwa sasa.';

/**
 * Manual update from Account screen — reuses global APK update pipeline.
 * @returns {Promise<{ outcome: 'already_latest' | 'downloading' | 'store' | 'unavailable' | 'error'; message?: string }>}
 */
export async function runAccountAppUpdate() {
  let info;
  try {
    info = await forceRecheck();
  } catch (e) {
    return {
      outcome: 'error',
      message: String(e?.message ?? e ?? 'Imeshindwa kukagua sasisho'),
    };
  }

  const installed =
    readNativeAndroidVersionCode() ??
    Number(info?.installedVersionCode ?? info?.installed_version_code ?? 0);
  const latest = Number(
    info?.latestVersionCode ?? info?.latest_version_code ?? latestVersionCodeFromBody(info) ?? 0,
  );

  if (
    Number.isFinite(installed) &&
    installed >= PUBLISHED_PLAY_VERSION_CODE &&
    (!latest || installed >= latest)
  ) {
    return { outcome: 'already_latest' };
  }

  if (!isOutdated(installed, latest)) {
    return { outcome: 'already_latest' };
  }

  const action = getUpdateAction();
  if (action.canDownload) {
    try {
      await startDownload();
      return { outcome: 'downloading' };
    } catch (e) {
      return {
        outcome: 'error',
        message: String(e?.message ?? e ?? 'Imeshindwa kupakua sasisho'),
      };
    }
  }

  if (action.canOpenStore) {
    try {
      await openPlayStoreFromInfo();
      return { outcome: 'store' };
    } catch (e) {
      return {
        outcome: 'error',
        message: String(e?.message ?? e ?? 'Imeshindwa kufungua Play Store'),
      };
    }
  }

  return { outcome: 'unavailable' };
}
