import React, { useEffect, useRef, useState, useCallback } from 'react';
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

const STALL_TIMEOUT_MS = 15000;
const MAX_RECOVERY_ATTEMPTS = 6;

function looksLikeHlsUrl(url) {
  return /\.m3u8(?:$|\?)/i.test(String(url ?? ''));
}

function buildWebViewSource(url) {
  if (!looksLikeHlsUrl(url)) return { uri: url };
  const escaped = JSON.stringify(String(url));
  const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no" />
    <style>
      html, body { margin:0; padding:0; width:100%; height:100%; background:#000; overflow:hidden; }
      video { width:100%; height:100%; background:#000; object-fit:contain; }
    </style>
  </head>
  <body>
    <video id="video" autoplay playsinline webkit-playsinline></video>
    <script src="https://cdn.jsdelivr.net/npm/hls.js@1.5.15/dist/hls.min.js"></script>
    <script>
      (function () {
        var src = ${escaped};
        var video = document.getElementById('video');
        var hls = null;
        var fitMode = 'contain';
        function post(kind, payload) {
          try {
            window.ReactNativeWebView.postMessage(JSON.stringify({ kind: kind, payload: payload || null }));
          } catch (e) {}
        }
        function setFit(mode) {
          fitMode = mode === 'cover' ? 'cover' : 'contain';
          video.style.objectFit = fitMode;
        }
        setFit('contain');
        if (window.Hls && window.Hls.isSupported()) {
          hls = new Hls({
            enableWorker: true,
            lowLatencyMode: true,
            backBufferLength: 90,
          });
          hls.on(Hls.Events.MANIFEST_PARSED, function () {
            post('hls_manifest', {
              levels: hls.levels ? hls.levels.map(function (l, i) {
                return { index: i, height: l.height || 0, bitrate: l.bitrate || 0 };
              }) : [],
              audioTracks: hls.audioTracks || [],
            });
          });
          hls.on(Hls.Events.LEVEL_LOADED, function () {
            post('hls_ready', null);
          });
          hls.on(Hls.Events.ERROR, function (event, data) { post('hls_error', data); });
          hls.loadSource(src);
          hls.attachMedia(video);
        } else {
          video.src = src;
        }
        video.addEventListener('error', function () {
          post('video_error', { code: video.error ? video.error.code : null });
        });
        video.addEventListener('playing', function () { post('video_playing', null); });
        video.addEventListener('waiting', function () { post('video_waiting', null); });
        window.addEventListener('message', function (e) {
          var raw = e && e.data ? e.data : '';
          var cmd = null;
          try { cmd = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch (_) {}
          if (!cmd || !cmd.type) return;
          if (cmd.type === 'play') video.play().catch(function(){});
          if (cmd.type === 'pause') video.pause();
          if (cmd.type === 'set-fit') setFit(cmd.mode);
          if (cmd.type === 'set-level' && hls && typeof cmd.level === 'number') hls.currentLevel = cmd.level;
          if (cmd.type === 'set-audio' && hls && typeof cmd.track === 'number') hls.audioTrack = cmd.track;
          if (cmd.type === 'get-meta') {
            post('hls_manifest', {
              levels: hls && hls.levels ? hls.levels.map(function (l, i) {
                return { index: i, height: l.height || 0, bitrate: l.bitrate || 0 };
              }) : [],
              audioTracks: hls && hls.audioTracks ? hls.audioTracks : [],
            });
          }
        });
      })();
    </script>
  </body>
</html>`;
  return { html, baseUrl: 'https://localhost/' };
}

export default function ChannelPlayerScreen({ route, navigation }) {
  const insets = useSafeAreaInsets();
  const initialChannel = route?.params?.channel ?? null;
  const [liveChannel, setLiveChannel] = useState(initialChannel);
  const [channelDisabledNotified, setChannelDisabledNotified] = useState(false);
  const { rawChannels, freeMode } = useOsmaniApp();
  const channel = liveChannel ?? initialChannel;

  const streams = [
    channel?.url ?? channel?.stream_url,
    channel?.backupStream1 ?? channel?.backup_stream_1,
    channel?.backupStream2 ?? channel?.backup_stream_2,
  ].filter(Boolean);

  const [currentUrlIndex, setCurrentUrlIndex] = useState(0);
  const uri = streams[currentUrlIndex];
  const headers = {
    ...((channel?.referer ?? channel?.referrer) && {
      Referer: channel?.referer ?? channel?.referrer,
    }),
    ...((channel?.origin ?? channel?.stream_origin) && {
      Origin: channel?.origin ?? channel?.stream_origin,
    }),
    ...((channel?.userAgent ?? channel?.user_agent) && {
      'User-Agent': channel?.userAgent ?? channel?.user_agent,
    }),
  };
  const normalizedPlayerType = normalizePlayerType(channel?.playerType ?? channel?.player_type);
  const [fallbackWebView, setFallbackWebView] = useState(false);
  const [isBuffering, setIsBuffering] = useState(true);
  const [retryMessage, setRetryMessage] = useState('');
  const [playbackError, setPlaybackError] = useState('');
  const [playerEpoch, setPlayerEpoch] = useState(0);
  const [qualityLevels, setQualityLevels] = useState([]);
  const [audioTracks, setAudioTracks] = useState([]);
  const effectivePlayerType = fallbackWebView ? 'webview' : normalizedPlayerType;
  const usesNativeVideo = effectivePlayerType !== 'webview';
  const liveLabel = 'LIVE';

  const videoRef = useRef(null);
  const webviewRef = useRef(null);
  const hideTimer = useRef(null);
  const reconnectTimerRef = useRef(null);
  const stallTimerRef = useRef(null);
  const reconnectAttemptsRef = useRef(0);
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
    setFallbackWebView(false);
    setIsBuffering(true);
    setRetryMessage('');
    setPlaybackError('');
    reconnectAttemptsRef.current = 0;
    setQualityLevels([]);
    setAudioTracks([]);
    setPlayerEpoch((e) => e + 1);
  }, [channel?.id, channel?.channel_id, channel?.name, channel?.url, channel?.backupStream1, channel?.backupStream2]);

  useEffect(() => {
    return () => {
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      if (stallTimerRef.current) clearTimeout(stallTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!uri) return;
    console.log('[player][debug] selected player type:', normalizedPlayerType);
    console.log('[player][debug] effective player type:', effectivePlayerType);
    console.log('[player][debug] final playback URL:', uri);
    console.log('[player][debug] request headers:', headers ?? {});
    console.log('[player][debug] active source object:', {
      uri,
      headers,
      player_type: normalizedPlayerType,
      backup_1: streams[1] ?? null,
      backup_2: streams[2] ?? null,
    });
  }, [uri, headers, normalizedPlayerType, effectivePlayerType]);

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

  const clearStallTimer = useCallback(() => {
    if (stallTimerRef.current) {
      clearTimeout(stallTimerRef.current);
      stallTimerRef.current = null;
    }
  }, []);

  const scheduleRecovery = useCallback((reason) => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    const reasonText = String(reason ?? '');
    if (/404|not[\s_-]?found|http\s*404/i.test(reasonText)) {
      setIsBuffering(false);
      setRetryMessage('');
      setPlaybackError('Stream link imeisha au haipatikani (404).');
      console.log('[player][debug] permanent failure, stop retry loop:', reasonText);
      return;
    }
    const attempt = reconnectAttemptsRef.current + 1;
    reconnectAttemptsRef.current = attempt;
    if (attempt > MAX_RECOVERY_ATTEMPTS) {
      setIsBuffering(false);
      setRetryMessage('');
      setPlaybackError('Imeshindwa kuendelea live stream. Jaribu tena.');
      console.log('[player][debug] recovery exhausted:', { reason, attempt });
      return;
    }
    const waitMs = Math.min(1200 * 2 ** (attempt - 1), 12000);
    setRetryMessage(`Inajaribu kuunganisha tena... (${attempt}/${MAX_RECOVERY_ATTEMPTS})`);
    console.log('[player][debug] schedule recovery:', { reason, attempt, waitMs });
    reconnectTimerRef.current = setTimeout(async () => {
      try {
        setPlaybackError('');
        setIsBuffering(true);
        if (effectivePlayerType === 'webview') {
          webviewRef.current?.postMessage(JSON.stringify({ type: 'play' }));
          webviewRef.current?.postMessage(JSON.stringify({ type: 'get-meta' }));
        } else {
          await videoRef.current?.replayAsync?.();
        }
      } catch (err) {
        console.log('[player][debug] recovery replay error:', String(err));
      }
      if (attempt >= 3 && currentUrlIndex < streams.length - 1) {
        setRetryMessage('Inajaribu stream nyingine...');
        setCurrentUrlIndex((i) => i + 1);
        return;
      }
      if (attempt >= 4 && usesNativeVideo && looksLikeHlsUrl(uri)) {
        setRetryMessage('Inabadili player mode...');
        setFallbackWebView(true);
        return;
      }
      setPlayerEpoch((e) => e + 1);
    }, waitMs);
  }, [currentUrlIndex, effectivePlayerType, uri, usesNativeVideo, streams.length]);

  // FALLBACK STREAM
  const onError = (error) => {
    console.log('[player][debug] playback error:', {
      player_type: effectivePlayerType,
      selected_player: normalizedPlayerType,
      url: uri,
      current_index: currentUrlIndex,
      total_streams: streams.length,
      error,
    });
    scheduleRecovery('onError');
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
        scheduleRecovery(`status-load-error:${String(status.error)}`);
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
    if (!status.isBuffering) setRetryMessage('');
    if (status.isPlaying) reconnectAttemptsRef.current = 0;
    setIsPlaying(status.isPlaying);
    setPlaybackError('');
    if (status.isPlaying && !status.isBuffering) {
      clearStallTimer();
    } else if (status.isBuffering) {
      clearStallTimer();
      stallTimerRef.current = setTimeout(() => {
        console.log('[player][debug] stall timeout reached');
        scheduleRecovery('stall-timeout');
      }, STALL_TIMEOUT_MS);
    }

    if (status.isPlaying) startHideTimer();
  };

  // PLAY / PAUSE
  const onPlayPause = async () => {
    if (effectivePlayerType === 'webview') {
      const cmd = isPlaying ? { type: 'pause' } : { type: 'play' };
      webviewRef.current?.postMessage(JSON.stringify(cmd));
      setIsPlaying((v) => !v);
      showControls();
      return;
    }
    const s = await videoRef.current?.getStatusAsync?.();
    if (s?.isPlaying) {
      await videoRef.current?.pauseAsync?.();
    } else {
      await videoRef.current?.playAsync?.();
    }
    showControls();
  };

  useEffect(() => {
    if (!uri) return;
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    clearStallTimer();
    setPlaybackError('');
    setRetryMessage((m) => (m.startsWith('Inajaribu') || m.startsWith('Inabadili') ? m : ''));
  }, [uri, effectivePlayerType, playerEpoch, clearStallTimer]);

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
        if (effectivePlayerType === 'webview') {
          if (!audioTracks.length) {
            Alert.alert('Lugha', 'No alternate audio');
            return;
          }
          Alert.alert(
            'Chagua Lugha',
            'Audio tracks',
            audioTracks
              .slice(0, 3)
              .map((t, i) => ({
                text: t?.name || t?.lang || `Track ${i + 1}`,
                onPress: () => webviewRef.current?.postMessage(JSON.stringify({ type: 'set-audio', track: i })),
              }))
              .concat([{ text: 'Close', style: 'cancel' }]),
          );
          return;
        }
        Alert.alert('Lugha', 'No alternate audio');
      },
    },
    {
      key: 'quality',
      icon: 'speedometer',
      label: 'Quality',
      onPress: () => {
        if (effectivePlayerType === 'webview') {
          if (!qualityLevels.length) {
            webviewRef.current?.postMessage(JSON.stringify({ type: 'get-meta' }));
            Alert.alert('Quality', 'Auto (default)');
            return;
          }
          Alert.alert(
            'Chagua Quality',
            'HLS levels',
            [{ text: 'Auto', onPress: () => webviewRef.current?.postMessage(JSON.stringify({ type: 'set-level', level: -1 })) }]
              .concat(
                qualityLevels.slice(0, 4).map((l) => ({
                  text: l.height ? `${l.height}p` : `${Math.round((l.bitrate || 0) / 1000)} kbps`,
                  onPress: () => webviewRef.current?.postMessage(JSON.stringify({ type: 'set-level', level: l.index })),
                })),
              )
              .concat([{ text: 'Close', style: 'cancel' }]),
          );
          return;
        }
        Alert.alert('Quality', 'Auto (default)');
      },
    },
    {
      key: 'fill',
      icon: resizeMode === 'cover' ? 'scan' : 'expand',
      label: 'Fill',
      onPress: () =>
        setResizeMode((m) => {
          const next = m === 'contain' ? 'cover' : 'contain';
          if (effectivePlayerType === 'webview') {
            webviewRef.current?.postMessage(JSON.stringify({ type: 'set-fit', mode: next }));
          }
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

      {/* VIDEO / WEBVIEW */}
      <Pressable style={{ flex: 1 }} onPress={showControls}>

        {effectivePlayerType === 'webview' ? (
          <WebView
            key={`wv-${playerEpoch}`}
            ref={webviewRef}
            source={buildWebViewSource(uri)}
            style={styles.video}
            allowsInlineMediaPlayback
            mediaPlaybackRequiresUserAction={false}
            onMessage={(event) => {
              const raw = event?.nativeEvent?.data ?? '';
              console.log('[player][debug] webview player message:', raw);
              try {
                const msg = JSON.parse(raw);
                if (msg?.kind === 'hls_manifest') {
                  setQualityLevels(Array.isArray(msg?.payload?.levels) ? msg.payload.levels : []);
                  setAudioTracks(Array.isArray(msg?.payload?.audioTracks) ? msg.payload.audioTracks : []);
                } else if (msg?.kind === 'hls_ready' || msg?.kind === 'video_playing') {
                  setIsBuffering(false);
                  setRetryMessage('');
                  setPlaybackError('');
                  reconnectAttemptsRef.current = 0;
                  setIsPlaying(true);
                  clearStallTimer();
                } else if (msg?.kind === 'video_waiting') {
                  setIsBuffering(true);
                  clearStallTimer();
                  stallTimerRef.current = setTimeout(() => {
                    scheduleRecovery('webview-waiting-stall');
                  }, STALL_TIMEOUT_MS);
                } else if (msg?.kind === 'hls_error' || msg?.kind === 'video_error') {
                  console.log('[player][debug] webview hls/video error payload:', msg?.payload ?? null);
                  onError(msg?.payload ?? msg);
                }
              } catch {
                // ignore parse errors
              }
            }}
          />
        ) : (
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
              {(isBuffering || retryMessage) ? (
                <View style={styles.bufferingWrap}>
                  <ActivityIndicator size="large" color="#FFFFFF" />
                  <Text style={styles.bufferingText}>
                    {retryMessage || 'Inapakia moja kwa moja...'}
                  </Text>
                  {playbackError ? (
                    <Text style={styles.bufferingError}>{playbackError}</Text>
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