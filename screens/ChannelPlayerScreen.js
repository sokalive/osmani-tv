import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  StatusBar,
  BackHandler,
  Alert,
  AppState,
  ActivityIndicator,
  Animated,
} from 'react-native';
import { Video } from 'expo-av';
import { Ionicons } from '@expo/vector-icons';
import * as ScreenOrientation from 'expo-screen-orientation';
import { WebView } from 'react-native-webview';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PING_MS, pingLiveSession, startLiveSession, stopLiveSession } from '../api/analytics';
import { useOsmaniApp } from '../context/OsmaniAppContext';
import { buildPlayerChannelFromRow, findRawChannelById } from '../lib/playerChannelFromRow';
import { normalizePlayerType } from '../lib/channelStream';

function looksLikeHlsUrl(url) {
  return /\.m3u8(?:$|\?)/i.test(String(url ?? ''));
}

/** Direct streams → expo-av. Everything else (player.php, embed pages, HTML) → plain WebView. */
function isDirectMediaStreamUrl(url) {
  const s = String(url ?? '');
  if (!s.trim()) return false;
  const u = s.split(/[#?]/)[0].toLowerCase();
  return (
    /\.m3u8$/i.test(u) ||
    /\.mp4$/i.test(u) ||
    /\.(?:m2ts|mts|ts)$/i.test(u)
  );
}

function playbackFailureMessage(reasonText) {
  const r = String(reasonText ?? '');
  if (/404|not[\s_-]?found|http\s*404/i.test(r)) return 'Stream link imeisha au haipatikani (404).';
  const short = r.length > 120 ? `${r.slice(0, 117)}...` : r;
  return short ? `Playback: ${short}` : 'Playback imeshindikana.';
}

export default function ChannelPlayerScreen({ route, navigation }) {
  const insets = useSafeAreaInsets();
  const initialChannel = route?.params?.channel ?? null;
  const [liveChannel, setLiveChannel] = useState(initialChannel);
  const [channelDisabledNotified, setChannelDisabledNotified] = useState(false);
  const { rawChannels, freeMode } = useOsmaniApp();
  const channel = liveChannel ?? initialChannel;

  const streams = [
    channel?.url,
    channel?.backupStream1,
    channel?.backupStream2,
  ].filter(Boolean);

  const [currentUrlIndex, setCurrentUrlIndex] = useState(0);
  const uri = streams[currentUrlIndex];
  const headers = {
    ...(channel?.referer && { Referer: channel.referer }),
    ...(channel?.origin && { Origin: channel.origin }),
    ...(channel?.userAgent && { 'User-Agent': channel.userAgent }),
  };
  const normalizedPlayerType = normalizePlayerType(channel?.playerType);
  const useNativePlayer = useMemo(() => isDirectMediaStreamUrl(uri), [uri]);
  const webViewSource = useMemo(() => {
    const hEntries = Object.entries(headers).filter(([, v]) => v != null && String(v).trim() !== '');
    if (!hEntries.length) return { uri };
    return { uri, headers: Object.fromEntries(hEntries) };
  }, [uri, channel?.referer, channel?.origin, channel?.userAgent]);
  const [isBuffering, setIsBuffering] = useState(true);
  const [playbackError, setPlaybackError] = useState('');
  const [playerEpoch, setPlayerEpoch] = useState(0);
  const liveLabel = 'LIVE';

  const videoRef = useRef(null);
  const embedWebRef = useRef(null);
  const hideTimer = useRef(null);
  const lastStatusRef = useRef({
    isLoaded: null,
    isBuffering: null,
    isPlaying: null,
  });
  const controlsOpacity = useRef(new Animated.Value(1)).current;

  const [isPlaying, setIsPlaying] = useState(true);
  const [controlsVisible, setControlsVisible] = useState(true);

  const [resizeMode, setResizeMode] = useState('contain');
  const sessionDeviceIdRef = useRef('');
  const sessionChannelIdRef = useRef('');
  const pingTimerRef = useRef(null);
  const stopSentRef = useRef(false);

  // LOG
  useEffect(() => {
    if (!uri) {
      Alert.alert('ERROR', 'Hakuna stream URL 😢');
    }
  }, [uri]);

  useEffect(() => {
    setCurrentUrlIndex(0);
    setIsBuffering(true);
    setPlaybackError('');
    setPlayerEpoch((e) => e + 1);
  }, [channel?.id, channel?.channel_id, channel?.name, channel?.url, channel?.backupStream1, channel?.backupStream2]);

  useEffect(() => {
    if (!uri) return;
    console.log('[player][debug] hybrid route:', {
      native_expo_av: useNativePlayer,
      webview_embed: !useNativePlayer,
      api_playerType: normalizedPlayerType,
      url: uri,
      headers_present: Boolean(webViewSource?.headers && Object.keys(webViewSource.headers).length),
    });
  }, [uri, normalizedPlayerType, useNativePlayer, webViewSource?.headers]);

  // Keep local channel snapshot in sync when route params change.
  useEffect(() => {
    setLiveChannel(route?.params?.channel ?? null);
    setChannelDisabledNotified(false);
  }, [route?.params?.channel]);

  // Realtime stream/channel updates from live app catalog.
  useEffect(() => {
    const current = liveChannel ?? route?.params?.channel;
    if (!current) return;
    const cid = String(current?.id ?? current?.channel_id ?? '').trim();
    if (!cid) return;
    const found = findRawChannelById(rawChannels, cid);
    if (!found) return;
    const { raw, index } = found;
    const showInApp =
      raw?.showInApp !== undefined
        ? Boolean(raw.showInApp)
        : raw?.show_in_app !== undefined
          ? Boolean(raw.show_in_app)
          : true;
    const isActive =
      raw?.isActive !== undefined
        ? Boolean(raw.isActive)
        : raw?.active !== undefined
          ? Boolean(raw.active)
          : true;
    if ((!showInApp || !isActive) && !channelDisabledNotified) {
      setChannelDisabledNotified(true);
      Alert.alert('Taarifa', 'Channel hii imezuiwa au kufichwa na admin.');
      navigation.goBack();
      return;
    }
    const next = buildPlayerChannelFromRow(raw, index, freeMode);
    setLiveChannel((prev) => {
      const p = prev ?? {};
      const changed =
        String(p.name ?? '') !== String(next.name ?? '') ||
        String(p.url ?? '') !== String(next.url ?? '') ||
        String(p.backupStream1 ?? '') !== String(next.backupStream1 ?? '') ||
        String(p.backupStream2 ?? '') !== String(next.backupStream2 ?? '') ||
        String(p.origin ?? '') !== String(next.origin ?? '') ||
        String(p.referer ?? '') !== String(next.referer ?? '') ||
        String(p.userAgent ?? '') !== String(next.userAgent ?? '') ||
        String(p.playerType ?? '') !== String(next.playerType ?? '');
      return changed ? next : prev;
    });
  }, [rawChannels, freeMode, liveChannel, route?.params?.channel, navigation, channelDisabledNotified]);

  const applyPlaybackFailure = useCallback((reasonText) => {
    setIsBuffering(false);
    setPlaybackError(playbackFailureMessage(reasonText));
    setControlsVisible(true);
    controlsOpacity.setValue(1);
  }, [controlsOpacity]);

  /** User-only: fresh mount without automatic timers or replay loops. */
  const manualReloadSameStream = useCallback(() => {
    setPlaybackError('');
    setIsBuffering(true);
    setPlayerEpoch((e) => e + 1);
  }, []);

  const onError = (error) => {
    console.log('[player][debug] playback error:', {
      player_type: useNativePlayer ? 'native-expo-av' : 'webview',
      declared_player_type: normalizedPlayerType,
      url: uri,
      current_index: currentUrlIndex,
      total_streams: streams.length,
      error,
    });
    const errMsg =
      error == null ? 'onError' : typeof error === 'string' ? error : JSON.stringify(error);
    applyPlaybackFailure(errMsg);
  };

  // ROTATION
  useEffect(() => {
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE);
    StatusBar.setHidden(true);

    return () => {
      ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT);
      StatusBar.setHidden(false);
    };
  }, []);

  // BACK
  useEffect(() => {
    const backAction = () => {
      navigation.goBack();
      return true;
    };

    const backHandler = BackHandler.addEventListener('hardwareBackPress', backAction);
    return () => backHandler.remove();
  }, []);

  // ANALYTICS: start session + heartbeat + stop on exit
  useEffect(() => {
    let cancelled = false;
    const channelId = channel?.id ?? channel?.channel_id ?? channel?.name ?? 'unknown';
    const channelName = channel?.name ?? '';
    sessionChannelIdRef.current = String(channelId);
    console.log('[player][analytics] mounting session with channel:', {
      channel_id: sessionChannelIdRef.current,
      channel_name: channelName,
    });

    (async () => {
      const deviceId = await startLiveSession(channelId, channelName);
      if (cancelled) return;
      sessionDeviceIdRef.current = deviceId;
      stopSentRef.current = false;
      console.log('[player][analytics] session started with device_id:', deviceId);

      pingTimerRef.current = setInterval(() => {
        console.log('[player][analytics] heartbeat tick', {
          device_id: sessionDeviceIdRef.current,
          channel_id: sessionChannelIdRef.current,
          interval_ms: PING_MS,
        });
        void pingLiveSession(sessionDeviceIdRef.current, sessionChannelIdRef.current);
      }, PING_MS);
      console.log('[player][analytics] heartbeat timer started:', PING_MS);
    })();

    return () => {
      cancelled = true;
      console.log('[player][analytics] cleanup session effect');
      if (pingTimerRef.current) {
        clearInterval(pingTimerRef.current);
        pingTimerRef.current = null;
        console.log('[player][analytics] heartbeat timer cleared on cleanup');
      }
      if (!stopSentRef.current) {
        stopSentRef.current = true;
        console.log('[player][analytics] sending session end on cleanup', {
          device_id: sessionDeviceIdRef.current,
          channel_id: sessionChannelIdRef.current,
        });
        void stopLiveSession(sessionDeviceIdRef.current, sessionChannelIdRef.current);
      }
    };
  }, [channel?.id, channel?.channel_id, channel?.name]);

  // If app goes to background while player is open, close analytics session safely.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (nextState) => {
      console.log('[player][analytics] app state changed:', nextState);
      if (nextState === 'active') return;
      if (pingTimerRef.current) {
        clearInterval(pingTimerRef.current);
        pingTimerRef.current = null;
        console.log('[player][analytics] heartbeat timer cleared on app state change');
      }
      if (!stopSentRef.current) {
        stopSentRef.current = true;
        console.log('[player][analytics] sending session end on app state change', {
          device_id: sessionDeviceIdRef.current,
          channel_id: sessionChannelIdRef.current,
        });
        void stopLiveSession(sessionDeviceIdRef.current, sessionChannelIdRef.current);
      }
    });
    return () => sub.remove();
  }, []);

  // AUTO HIDE CONTROLS
  const hideControls = useCallback(() => {
    Animated.timing(controlsOpacity, {
      toValue: 0,
      duration: 220,
      useNativeDriver: true,
    }).start(() => setControlsVisible(false));
  }, [controlsOpacity]);

  const showControlsAnimated = useCallback(() => {
    setControlsVisible(true);
    Animated.timing(controlsOpacity, {
      toValue: 1,
      duration: 180,
      useNativeDriver: true,
    }).start();
  }, [controlsOpacity]);

  const startHideTimer = useCallback(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => {
      hideControls();
    }, 3000);
  }, [hideControls]);

  const showControls = () => {
    showControlsAnimated();
    startHideTimer();
  };

  // STATUS
  const onStatusUpdate = (status) => {
    if (!status.isLoaded) {
      if (status?.error) {
        console.log('[player][debug] status load error:', status.error);
        applyPlaybackFailure(`status-load-error:${String(status.error)}`);
      }
      return;
    }
    const prev = lastStatusRef.current;
    const nextState = {
      isLoaded: Boolean(status.isLoaded),
      isBuffering: Boolean(status.isBuffering),
      isPlaying: Boolean(status.isPlaying),
    };
    if (
      prev.isLoaded !== nextState.isLoaded ||
      prev.isBuffering !== nextState.isBuffering ||
      prev.isPlaying !== nextState.isPlaying
    ) {
      console.log('[player][debug] playback state:', {
        state: nextState,
        didJustFinish: Boolean(status.didJustFinish),
        positionMillis: status.positionMillis ?? null,
        playableDurationMillis: status.playableDurationMillis ?? null,
      });
      lastStatusRef.current = nextState;
    }
    setIsBuffering(Boolean(status.isBuffering));
    setIsPlaying(status.isPlaying);
    setPlaybackError('');
    if (status.isPlaying) startHideTimer();
  };

  const onEmbedLoadStart = () => {
    setIsBuffering(true);
  };

  const onEmbedLoadEnd = () => {
    setIsBuffering(false);
    setPlaybackError('');
    startHideTimer();
  };

  const onEmbedHttpError = (ev) => {
    const status = ev?.nativeEvent?.statusCode;
    console.log('[player][debug] embed http error:', status);
    applyPlaybackFailure(`embed-http:${status}`);
  };

  const onEmbedError = (ev) => {
    const desc = ev?.nativeEvent?.description ?? ev?.nativeEvent?.message ?? 'unknown';
    console.log('[player][debug] embed load error:', desc);
    applyPlaybackFailure(`webview-error:${String(desc)}`);
  };

  // PLAY / PAUSE
  const onPlayPause = async () => {
    if (useNativePlayer) {
      const s = await videoRef.current?.getStatusAsync?.();
      if (s?.isPlaying) {
        await videoRef.current?.pauseAsync?.();
      } else {
        await videoRef.current?.playAsync?.();
      }
    } else {
      embedWebRef.current?.injectJavaScript(`(function(){try{var v=document.querySelector('video');if(v){if(v.paused)v.play().catch(function(){});else v.pause();}}catch(e){}})();true;`);
      setIsPlaying((v) => !v);
    }
    showControls();
  };

  useEffect(() => {
    if (!uri) return;
    setPlaybackError('');
  }, [uri, playerEpoch, useNativePlayer]);

  const bottomActions = [
    {
      key: 'pause',
      icon: isPlaying ? 'pause' : 'play',
      label: isPlaying ? 'Pause' : 'Play',
      onPress: () => {
        void onPlayPause();
      },
    },
    {
      key: 'language',
      icon: 'language',
      label: 'Badili Lugha',
      onPress: () => {
        Alert.alert('Lugha', useNativePlayer ? 'No alternate audio' : 'Tumia mipangilio kwenye embed page.');
      },
    },
    {
      key: 'quality',
      icon: 'speedometer',
      label: 'Quality',
      onPress: () => {
        Alert.alert(
          'Quality',
          useNativePlayer ? 'Auto (default)' : 'Quality hurekebishwa katika embed/page ya tovuti.',
        );
      },
    },
    {
      key: 'fill',
      icon: resizeMode === 'cover' ? 'scan' : 'expand',
      label: 'Fill',
      onPress: () =>
        setResizeMode((m) => {
          const next = m === 'contain' ? 'cover' : 'contain';
          return next;
        }),
    },
    {
      key: 'fullscreen',
      icon: 'resize',
      label: 'Full Screen',
      onPress: async () => {
        await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE);
      },
    },
  ];

  return (
    <View style={styles.root}>

      {/* Hybrid: direct media → expo-av; embed/player pages → plain WebView (no hls.js shell) */}
      <Pressable style={{ flex: 1 }} onPress={showControls}>

        {useNativePlayer ? (
          <Video
            key={`native-${playerEpoch}`}
            ref={videoRef}
            source={{
              uri,
              headers,
              ...(looksLikeHlsUrl(uri) ? { overrideFileExtensionAndroid: 'm3u8' } : {}),
            }}
            style={styles.video}
            resizeMode={resizeMode}
            shouldPlay
            progressUpdateIntervalMillis={1000}
            onPlaybackStatusUpdate={onStatusUpdate}
            onError={onError}
            useNativeControls={false}
          />
        ) : (
          <WebView
            key={`embed-${playerEpoch}`}
            ref={embedWebRef}
            style={styles.video}
            source={webViewSource}
            allowsInlineMediaPlayback
            mediaPlaybackRequiresUserAction={false}
            javaScriptEnabled
            domStorageEnabled
            originWhitelist={['*']}
            mixedContentMode="always"
            onLoadStart={onEmbedLoadStart}
            onLoadEnd={onEmbedLoadEnd}
            onError={onEmbedError}
            onHttpError={onEmbedHttpError}
          />
        )}

        {/* CONTROLS */}
        {controlsVisible && (
          <Animated.View style={[styles.controls, { opacity: controlsOpacity }]} pointerEvents="box-none">

            {/* TOP */}
            <View style={[styles.topBar, { paddingTop: Math.max(8, insets.top) }]}>
              <Pressable onPress={() => navigation.goBack()} style={styles.topBack}>
                <Ionicons name="arrow-back" size={26} color="#fff" />
              </Pressable>
              <View style={styles.titleBlock}>
                <Text style={styles.title} numberOfLines={1}>{channel?.name || 'Live'}</Text>
                <Text style={styles.subtitle}>Live Stream</Text>
              </View>
              <View style={styles.liveBadge}>
                <Text style={styles.liveBadgeText}>{liveLabel}</Text>
              </View>
            </View>

            {/* CENTER */}
            <View style={styles.center}>
              {(isBuffering || playbackError) ? (
                <View style={styles.bufferingWrap}>
                  {isBuffering ? <ActivityIndicator size="large" color="#FFFFFF" /> : null}
                  <Text style={styles.bufferingText}>
                    {playbackError ? 'Hitilafu ya uchezi' : 'Inapakia moja kwa moja...'}
                  </Text>
                  {playbackError ? (
                    <>
                      <Text style={styles.bufferingError}>{playbackError}</Text>
                      <Pressable onPress={manualReloadSameStream} style={styles.bufferingRetryBtn}>
                        <Text style={styles.bufferingRetryText}>Jaribu tena</Text>
                      </Pressable>
                    </>
                  ) : null}
                </View>
              ) : null}
            </View>

            <View style={[styles.bottom, { paddingBottom: Math.max(12, insets.bottom + 4) }]}>
              {bottomActions.map((action) => (
                <Pressable key={action.key} style={styles.actionBtn} onPress={action.onPress}>
                  <Ionicons name={action.icon} size={18} color="#E5E7EB" />
                  <Text style={styles.actionLabel} numberOfLines={1}>{action.label}</Text>
                </Pressable>
              ))}
            </View>

          </Animated.View>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },

  video: {
    ...StyleSheet.absoluteFillObject,
  },

  controls: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 10,
    elevation: 10,
  },

  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingBottom: 8,
    backgroundColor: 'rgba(5,8,14,0.36)',
  },
  topBack: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(17,24,39,0.58)',
    marginRight: 10,
  },
  titleBlock: {
    flex: 1,
    minWidth: 0,
  },

  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  bufferingWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: 'rgba(9,12,18,0.45)',
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    zIndex: 12,
  },
  bufferingText: {
    color: '#E5E7EB',
    fontSize: 13,
    fontWeight: '500',
  },
  bufferingError: {
    color: '#FCA5A5',
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'center',
    marginTop: 2,
  },
  bufferingRetryBtn: {
    marginTop: 8,
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 10,
    backgroundColor: 'rgba(59,130,246,0.35)',
    borderWidth: 1,
    borderColor: 'rgba(147,197,253,0.45)',
  },
  bufferingRetryText: {
    color: '#EFF6FF',
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'center',
  },

  bottom: {
    position: 'absolute',
    bottom: 0,
    left: 10,
    right: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  actionBtn: {
    flex: 1,
    minHeight: 48,
    borderRadius: 12,
    backgroundColor: 'rgba(17,24,39,0.56)',
    borderWidth: 1,
    borderColor: 'rgba(148,163,184,0.26)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
    gap: 3,
  },
  actionLabel: {
    color: '#E5E7EB',
    fontSize: 10,
    fontWeight: '600',
  },
  liveBadge: {
    backgroundColor: '#B91C1C',
    borderRadius: 10,
    paddingVertical: 5,
    paddingHorizontal: 10,
  },
  liveBadgeText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 12,
  },

  title: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  subtitle: {
    color: '#94A3B8',
    fontSize: 12,
    marginTop: 2,
  },
});