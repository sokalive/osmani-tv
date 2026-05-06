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
} from 'react-native';
import { Video } from 'expo-av';
import { Ionicons } from '@expo/vector-icons';
import * as ScreenOrientation from 'expo-screen-orientation';
import { WebView } from 'react-native-webview';
import { PING_MS, pingLiveSession, startLiveSession, stopLiveSession } from '../api/analytics';
import { useOsmaniApp } from '../context/OsmaniAppContext';
import { buildPlayerChannelFromRow, findRawChannelById } from '../lib/playerChannelFromRow';
import { buildStreamRequestHeaders, normalizePlayerType } from '../lib/channelStream';

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
    <video id="video" controls autoplay playsinline webkit-playsinline></video>
    <script src="https://cdn.jsdelivr.net/npm/hls.js@1.5.15/dist/hls.min.js"></script>
    <script>
      (function () {
        var src = ${escaped};
        var video = document.getElementById('video');
        function post(kind, payload) {
          try {
            window.ReactNativeWebView.postMessage(JSON.stringify({ kind: kind, payload: payload || null }));
          } catch (e) {}
        }
        if (window.Hls && window.Hls.isSupported()) {
          var hls = new Hls({ enableWorker: true, lowLatencyMode: true });
          hls.on(Hls.Events.ERROR, function (event, data) { post('hls_error', data); });
          hls.loadSource(src);
          hls.attachMedia(video);
        } else {
          video.src = src;
        }
        video.addEventListener('error', function () {
          post('video_error', { code: video.error ? video.error.code : null });
        });
      })();
    </script>
  </body>
</html>`;
  return { html, baseUrl: 'https://localhost/' };
}

export default function ChannelPlayerScreen({ route, navigation }) {
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
  const headers = buildStreamRequestHeaders(channel);
  const normalizedPlayerType = normalizePlayerType(channel?.playerType);
  const [fallbackWebView, setFallbackWebView] = useState(false);
  const [isBuffering, setIsBuffering] = useState(true);
  const effectivePlayerType = fallbackWebView ? 'webview' : normalizedPlayerType;
  const usesNativeVideo = effectivePlayerType !== 'webview';
  const liveLabel = 'LIVE';

  const videoRef = useRef(null);
  const hideTimer = useRef(null);

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
  }, [channel?.id, channel?.channel_id, channel?.name, channel?.url, channel?.backupStream1, channel?.backupStream2]);

  // Temporary diagnostics for stream compatibility failures.
  useEffect(() => {
    let cancelled = false;
    if (!uri) return undefined;
    console.log('[player][debug] selected player type:', normalizedPlayerType);
    console.log('[player][debug] effective player type:', effectivePlayerType);
    console.log('[player][debug] final playback URL:', uri);
    console.log('[player][debug] request headers:', headers ?? {});
    const probe = async () => {
      try {
        const res = await fetch(uri, { method: 'GET', headers: headers ?? {} });
        if (cancelled) return;
        const responseHeaders = {};
        try {
          res.headers.forEach((v, k) => {
            responseHeaders[k] = v;
          });
        } catch {
          // ignore headers iteration issues
        }
        console.log('[player][debug] probe status:', res.status);
        console.log('[player][debug] probe final URL:', res.url || uri);
        console.log('[player][debug] probe headers:', responseHeaders);
      } catch (err) {
        if (!cancelled) {
          console.log('[player][debug] probe network/tls error:', String(err));
        }
      }
    };
    void probe();
    return () => {
      cancelled = true;
    };
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
    if (currentUrlIndex < streams.length - 1) {
      setCurrentUrlIndex((i) => i + 1);
      setIsBuffering(true);
      return;
    }
    // Compatibility fallback: tokenized/redirected HLS may fail in native engine on some devices.
    if (usesNativeVideo && looksLikeHlsUrl(uri)) {
      console.log('[player][debug] switching fallback engine to webview/hls.js');
      setFallbackWebView(true);
      setIsBuffering(true);
    } else {
      Alert.alert('ERROR', 'Stream zote zimegoma 😢');
    }
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
  const startHideTimer = useCallback(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => {
      setControlsVisible(false);
    }, 3000);
  }, []);

  const showControls = () => {
    setControlsVisible(true);
    startHideTimer();
  };

  // STATUS
  const onStatusUpdate = (status) => {
    if (!status.isLoaded) {
      if (status?.error) {
        console.log('[player][debug] status load error:', status.error);
      }
      return;
    }
    setIsBuffering(Boolean(status.isBuffering));
    setIsPlaying(status.isPlaying);

    if (status.isPlaying) startHideTimer();
  };

  // PLAY / PAUSE
  const onPlayPause = async () => {
    const s = await videoRef.current.getStatusAsync();
    if (s.isPlaying) {
      await videoRef.current.pauseAsync();
    } else {
      await videoRef.current.playAsync();
    }
    showControls();
  };

  return (
    <View style={styles.root}>

      {/* VIDEO / WEBVIEW */}
      <Pressable style={{ flex: 1 }} onPress={showControls}>

        {effectivePlayerType === 'webview' ? (
          <WebView
            source={buildWebViewSource(uri)}
            style={styles.video}
            onMessage={(event) => {
              console.log('[player][debug] webview player message:', event?.nativeEvent?.data ?? '');
            }}
          />
        ) : (
          <Video
            ref={videoRef}
            source={{ uri, headers }}
            style={styles.video}
            resizeMode={resizeMode}
            shouldPlay
            onPlaybackStatusUpdate={onStatusUpdate}
            onError={onError}
            useNativeControls={false}
          />
        )}

        {/* CONTROLS */}
        {controlsVisible && (
          <View style={styles.controls} pointerEvents="box-none">

            {/* TOP */}
            <View style={styles.topBar}>
              <Pressable onPress={() => navigation.goBack()}>
                <Ionicons name="arrow-back" size={26} color="#fff" />
              </Pressable>
              <Text style={styles.title}>{channel?.name || 'Live'}</Text>
            </View>

            {/* CENTER */}
            <View style={styles.center}>
              {isBuffering ? (
                <View style={styles.bufferingWrap}>
                  <ActivityIndicator size="large" color="#FFFFFF" />
                </View>
              ) : null}
              <Pressable onPress={onPlayPause} style={styles.playBtn}>
                <Ionicons
                  name={isPlaying ? 'pause' : 'play'}
                  size={44}
                  color="#000"
                />
              </Pressable>
            </View>

            <View style={styles.bottom}>
              <View style={styles.liveBadge}>
                <Text style={styles.liveBadgeText}>{liveLabel}</Text>
              </View>
            </View>

          </View>
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
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
  },

  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  bufferingWrap: {
    position: 'absolute',
    top: '38%',
    alignSelf: 'center',
    zIndex: 12,
  },

  playBtn: {
    width: 90,
    height: 90,
    borderRadius: 45,
    backgroundColor: '#FFD700',
    justifyContent: 'center',
    alignItems: 'center',
  },

  bottom: {
    position: 'absolute',
    bottom: 20,
    left: 10,
    right: 10,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  liveBadge: {
    backgroundColor: '#DC2626',
    borderRadius: 12,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  liveBadgeText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 12,
  },

  title: {
    color: '#fff',
    marginLeft: 10,
  },
});