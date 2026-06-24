import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  instructionVideoOfflineEnabled,
  isInstructionVideoChannel,
  pickInstructionVideoOfflineUrl,
} from './instructionVideoChannel';

const CACHE_META_PREFIX = 'osmani:instruction_video:';

function cacheKey(channelId) {
  return `${CACHE_META_PREFIX}${String(channelId).trim()}`;
}

async function getFileSystem() {
  try {
    const mod = await import('expo-file-system');
    return mod.default ?? mod;
  } catch {
    return null;
  }
}

/**
 * Resolve playback URI — prefers on-device cache when offline hint + FileSystem available.
 * @param {Record<string, unknown>} channel
 * @param {string} remoteUri
 * @returns {Promise<string>}
 */
export async function resolveInstructionVideoPlaybackUri(channel, remoteUri) {
  const remote = String(remoteUri ?? '').trim();
  if (!channel || !isInstructionVideoChannel(channel)) return remote;

  const channelId = String(channel.id ?? channel.channel_id ?? '').trim();
  const offlineSource = pickInstructionVideoOfflineUrl(channel) || remote;
  if (!instructionVideoOfflineEnabled(channel) || !channelId || !offlineSource) {
    return remote;
  }

  const FileSystem = await getFileSystem();
  if (!FileSystem?.documentDirectory || !FileSystem.downloadAsync) {
    return remote;
  }

  try {
    const metaRaw = await AsyncStorage.getItem(cacheKey(channelId));
    if (metaRaw) {
      const meta = JSON.parse(metaRaw);
      const localUri = String(meta?.localUri ?? '').trim();
      if (localUri) {
        const info = await FileSystem.getInfoAsync(localUri);
        if (info?.exists) return localUri;
      }
    }
  } catch {
    /* fall through to download */
  }

  try {
    const ext = offlineSource.includes('.mp4') ? '.mp4' : '.video';
    const dest = `${FileSystem.documentDirectory}instruction-video-${channelId}${ext}`;
    const result = await FileSystem.downloadAsync(offlineSource, dest);
    if (result?.uri) {
      await AsyncStorage.setItem(
        cacheKey(channelId),
        JSON.stringify({ localUri: result.uri, source: offlineSource, cachedAt: Date.now() }),
      );
      console.log('[INSTRUCTION_VIDEO]', 'cached', { channelId, uri: result.uri });
      return result.uri;
    }
  } catch (e) {
    console.log('[INSTRUCTION_VIDEO]', 'cache_miss', e?.message ?? e);
  }

  return remote || offlineSource;
}
