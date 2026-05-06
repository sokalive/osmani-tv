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
  Platform,
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
import { VLCPlayer } from 'react-native-vlc-media-player';

const STALL_TIMEOUT_MS = 15000;
const MAX_RECOVERY_ATTEMPTS = 6;
const WEBVIEW_UA =
  'Mozilla/5.0 (Linux; Android 13; Pixel 7 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Mobile Safari/537.36';

function looksLikeHlsUrl(url) {
  return /\.m3u8(?:$|\?)/i.test(String(url ?? ''));
}

function looksLikeEmbedUrl(url) {
  const s = String(url ?? '').toLowerCase();
  return s.includes('player.php') || s.includes('embed') || s.includes('iframe');
}

function isHttpUrl(value) {
  return /^https?:\/\//i.test(String(value ?? '').trim());
}

function normalizePlaybackUrl(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return '';
  if (/^http:\/\//i.test(s) && /ycn-redirect\.com/i.test(s)) {
    return s.replace(/^http:\/\//i, 'https://');
  }
  return s;
}

function choosePlaybackRoute(url, declaredPlayerType) {
  const pt = String(declaredPlayerType ?? '').toLowerCase();
  if (looksLikeEmbedUrl(url)) return 'embed-webview';
  if (looksLikeHlsUrl(url)) {
    return pt === 'vlc' ? 'direct-hls-vlc' : 'native-exo';
  }
  if (pt === 'webview' || pt === 'vlc' || pt === 'ijk') return 'embed-webview';
  return 'native-exo';
}

function isVlcFallbackHlsUrl(url) {
  const s = String(url ?? '').toLowerCase();
  if (!looksLikeHlsUrl(s)) return false;
  if (s.includes('ycn-redirect')) return true;
  if (s.includes('iptv')) return true;
  if (s.includes('redirect')) return true;
  if (/[?&](token|t|e|expires|exp|signature|sig)=/i.test(s)) return true;
  return false;
}

function buildVlcInitOptions(headers = {}) {
  const out = [];
  const referer = String(headers?.Referer ?? '').trim();
  const origin = String(headers?.Origin ?? '').trim();
  const userAgent = String(headers?.['User-Agent'] ?? '').trim();
  if (referer) out.push(`:http-referrer=${referer}`);
  if (origin) out.push(`:http-origin=${origin}`);
  if (userAgent) out.push(`:http-user-agent=${userAgent}`);
  out.push(':network-caching=1500');
  out.push(':live-caching=1500');
  out.push(':http-reconnect=true');
  return out;
}

function resolveM3u8Url(baseUrl, line) {
  try {
    return new URL(line, baseUrl).toString();
  } catch {
    return line;
  }
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
        var src = '';
        var video = document.getElementById('video');
        var hls = null;
        var fitMode = 'contain';
        var lastManifestUrl = '';
        function post(kind, payload) {
          try {
            window.ReactNativeWebView.postMessage(JSON.stringify({ kind: kind, payload: payload || null }));
          } catch (e) {}
        }
        function isPlaylist(url) {
          return /\\.m3u8(\\?|$)/i.test(String(url || ''));
        }
        function normalizeUrl(url) {
          var s = String(url || '');
          if (/^http:\\/\\//i.test(s) && /ycn-redirect\\.com/i.test(s)) {
            s = s.replace(/^http:\\/\\//i, 'https://');
          }
          return s;
        }
        function resolveUrl(base, ref) {
          try { return new URL(ref, base).toString(); } catch (_) { return ref; }
        }
        function rewritePlaylistText(text, base) {
          var lines = String(text || '').split('\\n');
          var out = [];
          for (var i = 0; i < lines.length; i++) {
            var line = lines[i].trim();
            if (!line || line[0] === '#') { out.push(lines[i]); continue; }
            out.push(resolveUrl(base, line));
          }
          return out.join('\\n');
        }
        function getJsonHeaders() {
          try {
            var raw = localStorage.getItem('__osmani_headers');
            var parsed = raw ? JSON.parse(raw) : {};
            return parsed && typeof parsed === 'object' ? parsed : {};
          } catch (_) {
            return {};
          }
        }
        function setJsonHeaders(h) {
          try { localStorage.setItem('__osmani_headers', JSON.stringify(h || {})); } catch (_) {}
        }
        function withHeaders(reqHeaders) {
          var baseHeaders = getJsonHeaders();
          var out = {};
          Object.keys(baseHeaders || {}).forEach(function (k) {
            if (typeof baseHeaders[k] === 'string') out[k] = baseHeaders[k];
          });
          Object.keys(reqHeaders || {}).forEach(function (k) { out[k] = reqHeaders[k]; });
          return out;
        }
        function logProxy(kind, payload) {
          post('proxy_log', { kind: kind, payload: payload || null });
        }
        function classifyHtmlGate(body, headers) {
          var text = String(body || '').toLowerCase();
          var h = headers || {};
          if (text.includes('sorry, you have been blocked') || text.includes('cloudflare')) return 'cloudflare-block';
          if (text.includes('attention required') || text.includes('just a moment')) return 'anti-bot-page';
          if (text.includes('forbidden') || text.includes('hotlink') || text.includes('referer')) return 'anti-hotlink-page';
          if (text.includes('expired') || text.includes('token')) return 'expired-token';
          if (text.includes('login') || text.includes('sign in') || text.includes('session')) return 'login-session-gate';
          if (h['x-frame-options']) return 'x-frame-options-block';
          if (h['content-security-policy']) return 'csp-block';
          return 'html-unexpected';
        }
        function headMap(headersObj) {
          var out = {};
          try {
            headersObj.forEach(function (v, k) {
              out[String(k || '').toLowerCase()] = String(v || '');
            });
          } catch (_) {}
          return out;
        }
        function ProxyLoader(config) {
          this.config = config;
          this.controller = null;
        }
        ProxyLoader.prototype.load = function (context, config, callbacks) {
          var url = normalizeUrl(context.url);
          var reqHeaders = withHeaders(context.headers || {});
          var isM3u8 = isPlaylist(url);
          logProxy('request', { type: context.type, url: url, isPlaylist: isM3u8, headers: reqHeaders });
          this.controller = new AbortController();
          fetch(url, {
            method: 'GET',
            redirect: 'follow',
            headers: withHeaders({
              Accept: reqHeaders.Accept || 'application/vnd.apple.mpegurl,application/x-mpegURL,*/*',
              'Accept-Language': reqHeaders['Accept-Language'] || 'en-US,en;q=0.9',
              ...reqHeaders,
            }),
            signal: this.controller.signal,
          })
            .then(function (res) {
              var finalUrl = res.url || url;
              var lowerHeaders = headMap(res.headers);
              logProxy('response', {
                type: context.type,
                url: url,
                finalUrl: finalUrl,
                status: res.status,
                headers: {
                  'content-type': lowerHeaders['content-type'] || '',
                  'x-frame-options': lowerHeaders['x-frame-options'] || '',
                  'content-security-policy': lowerHeaders['content-security-policy'] || '',
                  server: lowerHeaders.server || '',
                },
              });
              if (!res.ok) {
                throw new Error('HTTP ' + res.status + ' for ' + finalUrl);
              }
              if (isM3u8) {
                lastManifestUrl = finalUrl;
                return res.text().then(function (text) {
                  var contentType = lowerHeaders['content-type'] || '';
                  var looksHtml = /^\\s*</.test(String(text || '')) || /text\\/html/i.test(contentType);
                  if (looksHtml) {
                    var classification = classifyHtmlGate(text, lowerHeaders);
                    logProxy('html_gate', {
                      url: finalUrl,
                      classification: classification,
                      sample: String(text || '').slice(0, 300),
                      contentType: contentType,
                    });
                    throw new Error('Playlist returned HTML gate: ' + classification);
                  }
                  if (!/#EXTM3U/i.test(String(text || ''))) {
                    logProxy('manifest_mismatch', {
                      url: finalUrl,
                      contentType: contentType,
                      sample: String(text || '').slice(0, 300),
                    });
                    throw new Error('Invalid m3u8 response payload');
                  }
                  var rewritten = rewritePlaylistText(text, finalUrl);
                  logProxy('rewrite', { from: finalUrl, length: rewritten.length });
                  callbacks.onSuccess(
                    {
                      url: finalUrl,
                      data: rewritten,
                    },
                    context,
                    undefined,
                  );
                });
              }
              return res.arrayBuffer().then(function (ab) {
                var contentType = lowerHeaders['content-type'] || '';
                if (/text\\/html/i.test(contentType)) {
                  throw new Error('Segment returned HTML content-type at ' + finalUrl);
                }
                callbacks.onSuccess(
                  {
                    url: finalUrl,
                    data: new Uint8Array(ab),
                  },
                  context,
                  undefined,
                );
              });
            })
            .catch(function (err) {
              logProxy('error', { type: context.type, url: url, message: String(err) });
              callbacks.onError(
                {
                  code: 0,
                  text: String(err),
                  url: url,
                },
                context,
                undefined,
              );
            });
        };
        ProxyLoader.prototype.abort = function () {
          try { this.controller && this.controller.abort(); } catch (_) {}
        };
        ProxyLoader.prototype.destroy = function () {
          try { this.controller && this.controller.abort(); } catch (_) {}
          this.controller = null;
        };
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
            loader: ProxyLoader,
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
            post('hls_ready', { details: hls && hls.levels ? hls.levels.length : 0 });
          });
          hls.on(Hls.Events.ERROR, function (event, data) { post('hls_error', data); });
          hls.attachMedia(video);
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
          if (cmd.type === 'set-headers' && cmd.headers && typeof cmd.headers === 'object') {
            setJsonHeaders(cmd.headers);
            post('headers_set', cmd.headers);
          }
          if (cmd.type === 'set-src' && cmd.url) {
            src = normalizeUrl(String(cmd.url));
            if (hls) {
              try { hls.stopLoad(); } catch (_) {}
              hls.loadSource(src);
              hls.startLoad(-1);
            } else {
              video.src = src;
            }
            post('src_set', { src: src });
          }
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
  ].map(normalizePlaybackUrl).filter(Boolean);

  const [currentUrlIndex, setCurrentUrlIndex] = useState(0);
  const uri = streams[currentUrlIndex];
  const headers = {
    ...(isHttpUrl(channel?.referer ?? channel?.referrer) && {
      Referer: String(channel?.referer ?? channel?.referrer).trim(),
    }),
    ...(isHttpUrl(channel?.origin ?? channel?.stream_origin) && {
      Origin: String(channel?.origin ?? channel?.stream_origin).trim(),
    }),
    ...((channel?.userAgent ?? channel?.user_agent) && {
      'User-Agent': channel?.userAgent ?? channel?.user_agent,
    }),
  };
  const normalizedPlayerType = normalizePlayerType(channel?.playerType ?? channel?.player_type);
  const [isBuffering, setIsBuffering] = useState(true);
  const [retryMessage, setRetryMessage] = useState('');
  const [playbackError, setPlaybackError] = useState('');
  const [playerEpoch, setPlayerEpoch] = useState(0);
  const [qualityLevels, setQualityLevels] = useState([]);
  const [audioTracks, setAudioTracks] = useState([]);
  const isDirectHls = looksLikeHlsUrl(uri);
  const shouldUseVlcFallback =
    Platform.OS === 'android' && isDirectHls && (normalizedPlayerType === 'vlc' || isVlcFallbackHlsUrl(uri));
  const effectivePlayerType = shouldUseVlcFallback ? 'vlc' : isDirectHls ? 'exo' : normalizedPlayerType;
  const playbackRoute = choosePlaybackRoute(uri, effectivePlayerType);
  const playbackUri = uri;
  const usesNativeVideo =
    playbackRoute === 'native-exo' || effectivePlayerType === 'exo' || effectivePlayerType === 'native';
  const usesVlcEngine = playbackRoute === 'direct-hls-vlc';
  const usesWebEngine = playbackRoute === 'embed-webview';
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
  const [vlcPaused, setVlcPaused] = useState(false);

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
    setRetryMessage('');
    setPlaybackError('');
    reconnectAttemptsRef.current = 0;
    setVlcPaused(false);
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
    if (!playbackUri) return;
    console.log('[player][debug] selected player type:', normalizedPlayerType);
    console.log('[player][debug] effective player type:', effectivePlayerType);
    console.log('[player][debug] final playback URL:', playbackUri);
    console.log('[player][debug] request headers:', headers ?? {});
    console.log('[player][debug] active source object:', {
      uri: playbackUri,
      headers,
      player_type: normalizedPlayerType,
      effective_player_type: effectivePlayerType,
      playback_route: playbackRoute,
      backup_1: streams[1] ?? null,
      backup_2: streams[2] ?? null,
    });
  }, [uri, playbackUri, headers, normalizedPlayerType, effectivePlayerType, playbackRoute]);

  const runHlsFailureDiagnostics = useCallback(async () => {
    if (!playbackUri || !looksLikeHlsUrl(uri)) return;
    try {
      console.log('[player][diag] start m3u8 diagnostics:', playbackUri);
      const masterRes = await fetch(playbackUri, { headers: {} });
      const masterText = await masterRes.text();
      console.log('[player][diag] master status:', masterRes.status, 'url:', masterRes.url || playbackUri);
      if (!masterRes.ok) return;
      const masterLines = String(masterText)
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith('#'));
      const firstChildCandidate = masterLines.find((l) => /\.m3u8(\?|$)/i.test(l));
      if (!firstChildCandidate) {
        const firstSegment = masterLines.find((l) => /\.(ts|m4s|mp4)(\?|$)/i.test(l));
        if (!firstSegment) return;
        const segUrl = resolveM3u8Url(masterRes.url || playbackUri, firstSegment);
        const segRes = await fetch(segUrl, { headers: {} });
        console.log('[player][diag] first segment status:', segRes.status, 'url:', segRes.url || segUrl);
        return;
      }
      const childUrl = resolveM3u8Url(masterRes.url || playbackUri, firstChildCandidate);
      const childRes = await fetch(childUrl, { headers: {} });
      const childText = await childRes.text();
      console.log('[player][diag] child playlist status:', childRes.status, 'url:', childRes.url || childUrl);
      if (!childRes.ok) return;
      const childLines = String(childText)
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith('#'));
      const firstSegment = childLines.find((l) => /\.(ts|m4s|mp4)(\?|$)/i.test(l));
      if (!firstSegment) return;
      const segUrl = resolveM3u8Url(childRes.url || childUrl, firstSegment);
      const segRes = await fetch(segUrl, { headers: {} });
      console.log('[player][diag] first segment status:', segRes.status, 'url:', segRes.url || segUrl);
    } catch (err) {
      console.log('[player][diag] diagnostics error:', String(err));
    }
  }, [uri, playbackUri]);

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
        if (usesWebEngine) {
          webviewRef.current?.postMessage(JSON.stringify({ type: 'play' }));
          webviewRef.current?.postMessage(JSON.stringify({ type: 'get-meta' }));
        } else if (usesVlcEngine) {
          setVlcPaused(false);
          setPlayerEpoch((e) => e + 1);
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
      setPlayerEpoch((e) => e + 1);
    }, waitMs);
  }, [currentUrlIndex, usesWebEngine, usesVlcEngine, uri, usesNativeVideo, streams.length]);

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
    void runHlsFailureDiagnostics();
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
    if (usesWebEngine) {
      const cmd = isPlaying ? { type: 'pause' } : { type: 'play' };
      webviewRef.current?.postMessage(JSON.stringify(cmd));
      setIsPlaying((v) => !v);
      showControls();
      return;
    }
    if (usesVlcEngine) {
      setVlcPaused((v) => {
        const next = !v;
        setIsPlaying(!next);
        return next;
      });
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
    if (!playbackUri) return;
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    clearStallTimer();
    setPlaybackError('');
    setRetryMessage((m) => (m.startsWith('Inajaribu') || m.startsWith('Inabadili') ? m : ''));
  }, [playbackUri, effectivePlayerType, playerEpoch, clearStallTimer]);

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
        if (usesWebEngine) {
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
        if (usesWebEngine) {
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
          if (usesWebEngine) {
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

        {usesWebEngine ? (
          <WebView
            key={`wv-${playerEpoch}`}
            ref={webviewRef}
            source={looksLikeHlsUrl(playbackUri) ? buildWebViewSource(playbackUri) : { uri: playbackUri }}
            style={styles.video}
            allowsInlineMediaPlayback
            mediaPlaybackRequiresUserAction={false}
            javaScriptEnabled
            domStorageEnabled
            sharedCookiesEnabled
            thirdPartyCookiesEnabled
            mixedContentMode="always"
            cacheEnabled
            userAgent={WEBVIEW_UA}
            originWhitelist={['*']}
            setSupportMultipleWindows={false}
            onShouldStartLoadWithRequest={(req) => {
              if (!looksLikeHlsUrl(playbackUri)) return true;
              const u = String(req?.url ?? '');
              // Keep proxy playback inside internal HTML shell.
              if (
                u.startsWith('about:blank') ||
                u.startsWith('data:text/html') ||
                u.startsWith('https://localhost/')
              ) {
                return true;
              }
              console.log('[player][diag][proxy] blocked external nav:', u);
              return false;
            }}
            onMessage={(event) => {
              const raw = event?.nativeEvent?.data ?? '';
              console.log('[player][debug] webview player message:', raw);
              try {
                const msg = JSON.parse(raw);
                if (msg?.kind === 'proxy_log') {
                  console.log('[player][diag][proxy]', msg?.payload ?? null);
                  return;
                }
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
            onLoadEnd={() => {
              if (!looksLikeHlsUrl(playbackUri)) return;
              try {
                const setHeaders = JSON.stringify({
                  type: 'set-headers',
                  headers: {
                    ...headers,
                    Accept: 'application/vnd.apple.mpegurl,application/x-mpegURL,*/*',
                    'Accept-Language': 'en-US,en;q=0.9',
                  },
                });
                const setSrc = JSON.stringify({ type: 'set-src', url: playbackUri });
                webviewRef.current?.postMessage(setHeaders);
                webviewRef.current?.postMessage(setSrc);
              } catch {
                // ignore
              }
            }}
          />
        ) : usesVlcEngine ? (
          <VLCPlayer
            key={`vlc-${playerEpoch}`}
            source={{
              uri: playbackUri,
              initOptions: buildVlcInitOptions(headers),
              autoplay: true,
            }}
            style={styles.video}
            paused={vlcPaused}
            autoplay
            resizeMode={resizeMode}
            onPlaying={() => {
              setIsPlaying(true);
              setIsBuffering(false);
              setRetryMessage('');
              setPlaybackError('');
              reconnectAttemptsRef.current = 0;
              clearStallTimer();
            }}
            onBuffering={() => {
              setIsBuffering(true);
              clearStallTimer();
              stallTimerRef.current = setTimeout(() => {
                scheduleRecovery('vlc-buffering-stall');
              }, STALL_TIMEOUT_MS);
            }}
            onPaused={() => {
              setIsPlaying(false);
            }}
            onStopped={() => {
              setIsPlaying(false);
              scheduleRecovery('vlc-stopped');
            }}
            onError={(err) => {
              console.log('[player][debug] vlc error:', err);
              onError(err);
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