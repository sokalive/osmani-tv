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
  ScrollView,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Video } from 'expo-av';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { Ionicons } from '@expo/vector-icons';
import * as ScreenOrientation from 'expo-screen-orientation';
import { WebView } from 'react-native-webview';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PING_MS, pingLiveSession, startLiveSession, stopLiveSession } from '../api/analytics';
import { clearActiveChannel, setActiveChannel } from '../lib/presenceTracker';
import { useOsmaniApp } from '../context/OsmaniAppContext';
import { subscribeRealtimeEvent } from '../lib/realtimeSync';
import { buildPlayerChannelFromRow, findRawChannelById } from '../lib/playerChannelFromRow';
import { normalizePlayerType } from '../lib/channelStream';
import {
  looksLikeHlsPlaybackUri,
  resolveHlsProxiedManifestUrl,
} from '../lib/hlsPlayback';
import { STREAM_PROXY_BASE } from '../lib/streamProxy';
import { buildHlsJsPlayerHtml } from '../lib/hlsJsPlayerHtml';
import { buildEmbedBridgeJs, buildEmbedSuppressNativeUiJs } from '../lib/embedBridgeJs';
import { getServerAnchoredRemainingMs } from '../lib/subscriptionMath';
import {
  SecurityPlaybackBlock,
  SecurityPlayerBanner,
} from '../components/SecurityPlaybackGate';
import { usePlaybackSecurityGate } from '../context/SecurityContext';

/**
 * Pick a playback engine:
 *   HLS (.m3u8)     → 'native' by default (expo-av / ExoPlayer + stream-proxy manifest URL)
 *                    Admin may force 'hls-webview' when playerType is `webview`.
 *   .mp4/.ts/.mts  → 'native' (expo-av direct)
 *   anything else  → 'embed-webview' (player.php / iframe pages)
 */
function pickPlaybackRoute(url, playerTypeNorm) {
  const s = String(url ?? '');
  if (!s.trim()) return 'embed-webview';
  const lower = s.split(/[#?]/)[0].toLowerCase();
  if (looksLikeHlsPlaybackUri(s)) {
    if (playerTypeNorm === 'webview') return 'hls-webview';
    return 'native';
  }
  if (/\.mp4$/i.test(lower)) return 'native';
  if (/\.(?:m2ts|mts|ts)$/i.test(lower)) return 'native';
  return 'embed-webview';
}

function baseUrlFromUrl(url) {
  try {
    return `${new URL(url).origin}/`;
  } catch {
    return 'https://localhost/';
  }
}

function buildHlsCmdScript(cmd) {
  const json = JSON.stringify(cmd ?? {});
  return `(function(){try{if(window.__OSMANI_HLS_CMD__){window.__OSMANI_HLS_CMD__(${json});}}catch(e){}})();true;`;
}

function buildEmbedCmdScript(cmd) {
  const json = JSON.stringify(cmd ?? {});
  return `(function(){try{if(window.__OSMANI_EMBED_CMD__){window.__OSMANI_EMBED_CMD__(${json});}}catch(e){}})();true;`;
}

function hlsLevelLabel(level) {
  if (!level) return '';
  if (level.label) return String(level.label);
  if (level.height) return `${level.height}p`;
  if (level.bitrate) return `${Math.round(level.bitrate / 1000)} kbps`;
  return level.name ? String(level.name) : '';
}

function hlsAudioLabel(track) {
  if (!track) return '';
  if (track.name && track.lang) return `${track.name} (${track.lang})`;
  if (track.name) return String(track.name);
  if (track.lang) return String(track.lang);
  return `Audio ${track.index ?? track.id ?? ''}`.trim();
}

function playbackFailureMessage(reasonText) {
  const r = String(reasonText ?? '');
  if (/404|not[\s_-]?found|http\s*404/i.test(r)) return 'Stream link imeisha au haipatikani (404).';
  const short = r.length > 120 ? `${r.slice(0, 117)}...` : r;
  return short ? `Playback: ${short}` : 'Playback imeshindikana.';
}

/** Stable tag for expo-keep-awake (Android FLAG_KEEP_SCREEN_ON while watching). */
const PLAYER_KEEP_AWAKE_TAG = 'osmani-channel-player';

export default function ChannelPlayerScreen({ route, navigation }) {
  const insets = useSafeAreaInsets();
  const initialChannel = route?.params?.channel ?? null;
  const [liveChannel, setLiveChannel] = useState(initialChannel);
  const [channelDisabledNotified, setChannelDisabledNotified] = useState(false);
  const {
    rawChannels,
    freeMode,
    gateForPlayback,
    reverifySubscription,
    emergencyMode,
    subscriptionDetails,
    subscriptionExpiresAt,
    subscriptionVersion,
  } = useOsmaniApp();
  const playbackSecurity = usePlaybackSecurityGate();
  const channel = liveChannel ?? initialChannel;
  const channelIsPremium = Boolean(
    channel?.isPremium ||
    channel?.accessPremium ||
    channel?.access_premium ||
    String(channel?.accessType ?? '').toLowerCase() === 'premium',
  );
  const [accessChecked, setAccessChecked] = useState(false);
  const [accessAllowed, setAccessAllowed] = useState(!channelIsPremium || freeMode);

  const streams = [
    channel?.url,
    channel?.backupStream1,
    channel?.backupStream2,
  ].filter(Boolean);

  const [currentUrlIndex, setCurrentUrlIndex] = useState(0);
  const uri = streams[currentUrlIndex];
  const headers = useMemo(
    () => ({
      ...(channel?.referer && { Referer: channel.referer }),
      ...(channel?.origin && { Origin: channel.origin }),
      ...(channel?.userAgent && { 'User-Agent': channel.userAgent }),
    }),
    [channel?.referer, channel?.origin, channel?.userAgent],
  );
  const normalizedPlayerType = normalizePlayerType(channel?.playerType);
  const playbackRoute = useMemo(
    () => pickPlaybackRoute(uri, normalizedPlayerType),
    [uri, normalizedPlayerType],
  );
  const useNativePlayer = playbackRoute === 'native';
  const useHlsWebView = playbackRoute === 'hls-webview';
  const useEmbedWebView = playbackRoute === 'embed-webview';

  const isHlsManifest = Boolean(uri && looksLikeHlsPlaybackUri(uri));

  /** Tokenized IPTV-safe proxy URL for HLS (native Exo + optional hls.js webview). */
  const proxiedHlsUrl = useMemo(() => {
    if (!uri || !isHlsManifest) return '';
    return resolveHlsProxiedManifestUrl(uri, {
      referer: channel?.referer,
      origin: channel?.origin,
      userAgent: channel?.userAgent,
    });
  }, [isHlsManifest, uri, channel?.referer, channel?.origin, channel?.userAgent]);

  /** expo-av source: HLS plays through proxy URL so Exo gets a stable manifest; override extension when URI has no .m3u8 suffix. */
  const nativeVideoSource = useMemo(() => {
    if (!useNativePlayer || !uri) return null;
    if (looksLikeHlsPlaybackUri(uri)) {
      const u = proxiedHlsUrl || uri;
      return {
        uri: u,
        overrideFileExtensionAndroid: 'm3u8',
      };
    }
    return { uri, headers };
  }, [useNativePlayer, uri, proxiedHlsUrl, headers]);

  const hlsWebViewSource = useMemo(() => {
    if (!useHlsWebView || !proxiedHlsUrl) return null;
    return {
      html: buildHlsJsPlayerHtml(proxiedHlsUrl, { diagnostics: __DEV__ }),
      baseUrl: baseUrlFromUrl(proxiedHlsUrl),
    };
  }, [useHlsWebView, proxiedHlsUrl]);

  /** Plain WebView source for player.php / embed/iframe HTML pages. Headers as-is. */
  const embedWebViewSource = useMemo(() => {
    if (!useEmbedWebView) return null;
    const hEntries = Object.entries(headers).filter(([, v]) => v != null && String(v).trim() !== '');
    if (!hEntries.length) return { uri };
    return { uri, headers: Object.fromEntries(hEntries) };
  }, [useEmbedWebView, uri, headers]);

  const embedBridgeJs = useMemo(() => buildEmbedBridgeJs(), []);
  const [isBuffering, setIsBuffering] = useState(true);
  const [playbackError, setPlaybackError] = useState('');
  const [playerEpoch, setPlayerEpoch] = useState(0);
  const liveLabel = 'LIVE';

  const videoRef = useRef(null);
  const hlsWebRef = useRef(null);
  const embedWebRef = useRef(null);
  const hideTimer = useRef(null);
  const pickerKindRef = useRef(null);
  const playbackErrorRef = useRef('');
  /** One auto-hide arm per player mount (epoch); playback/message spam must not reset the timer. */
  const playbackHideArmedRef = useRef(false);
  const AUTO_HIDE_MS = 4000;
  const lastStatusRef = useRef({
    isLoaded: null,
    isBuffering: null,
    isPlaying: null,
  });
  const controlsOpacity = useRef(new Animated.Value(1)).current;

  const [isPlaying, setIsPlaying] = useState(true);
  const [controlsVisible, setControlsVisible] = useState(true);

  const [resizeMode, setResizeMode] = useState('contain');

  /** HLS track bridge state (populated by hls.js inside WebView). */
  const [hlsLevels, setHlsLevels] = useState([]);
  const [hlsCurrentLevel, setHlsCurrentLevel] = useState(-1);
  const [hlsAutoLevel, setHlsAutoLevel] = useState(true);
  const [hlsAudioTracks, setHlsAudioTracks] = useState([]);
  const [hlsCurrentAudioTrack, setHlsCurrentAudioTrack] = useState(-1);

  /** Embed-page detection state (populated by embed bridge). */
  const [embedControls, setEmbedControls] = useState(null);
  const [embedHasControls, setEmbedHasControls] = useState(null); // null=unknown, false=none, true=yes

  /** Picker overlay: 'quality' | 'language' | null. */
  const [pickerKind, setPickerKind] = useState(null);

  const sessionDeviceIdRef = useRef('');
  const sessionChannelIdRef = useRef('');
  const pingTimerRef = useRef(null);
  const stopSentRef = useRef(false);
  const emergencyInterruptOnceRef = useRef(false);
  /** True after hard expiry: no Video/WebView surfaces (buffers cleared by unmount). */
  const [playbackSuppressed, setPlaybackSuppressed] = useState(false);
  const hardWallClockExpiryDoneRef = useRef(false);
  /** @type {React.MutableRefObject<ReturnType<typeof setInterval> | null>} */
  const premiumExpiryTickRef = useRef(null);
  const [expiryOverlay, setExpiryOverlay] = useState({
    visible: false,
    minuteCeil: 0,
    secondCeil: 0,
    critical: false,
  });

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
    setHlsLevels([]);
    setHlsCurrentLevel(-1);
    setHlsAutoLevel(true);
    setHlsAudioTracks([]);
    setHlsCurrentAudioTrack(-1);
    setEmbedControls(null);
    setEmbedHasControls(null);
    setPickerKind(null);
    playbackHideArmedRef.current = false;
    hardWallClockExpiryDoneRef.current = false;
    setPlaybackSuppressed(false);
    setExpiryOverlay({ visible: false, minuteCeil: 0, secondCeil: 0, critical: false });
  }, [channel?.id, channel?.channel_id, channel?.name, channel?.url, channel?.backupStream1, channel?.backupStream2]);

  useEffect(() => {
    if (!uri) return;
    console.log('[player][debug] route:', {
      route: playbackRoute,
      api_playerType: normalizedPlayerType,
      url: uri,
      proxy_base: STREAM_PROXY_BASE,
      proxied_url: proxiedHlsUrl || null,
      embed_headers_present: Boolean(
        embedWebViewSource?.headers && Object.keys(embedWebViewSource.headers).length,
      ),
    });
  }, [uri, normalizedPlayerType, playbackRoute, proxiedHlsUrl, embedWebViewSource?.headers]);

  // Keep local channel snapshot in sync when route params change.
  useEffect(() => {
    setLiveChannel(route?.params?.channel ?? null);
    setChannelDisabledNotified(false);
  }, [route?.params?.channel]);

  /**
   * Hard pre-play gate: APP -> BACKEND VERIFY -> PLAY.
   *
   * The backend is the only source of truth for "active". We refuse to
   * mount the player surface for premium channels until the backend
   * confirms `active === true`. If it returns false, we navigate back
   * immediately and the global TransferredAwayModal takes over.
   */
  useEffect(() => {
    let cancelled = false;
    if (!channel) return undefined;
    if (!channelIsPremium || freeMode) {
      setAccessChecked(true);
      setAccessAllowed(true);
      return undefined;
    }
    setAccessChecked(false);
    setAccessAllowed(false);
    (async () => {
      const ok = await gateForPlayback('player-mount');
      if (cancelled) return;
      setAccessChecked(true);
      setAccessAllowed(ok);
      if (!ok) {
        console.log('[player][gate]', 'denied', { channel: channel?.name });
        try {
          navigation.goBack();
        } catch {}
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    channel?.id,
    channel?.channel_id,
    channel?.url,
    channelIsPremium,
    freeMode,
    gateForPlayback,
    navigation,
  ]);

  // Realtime revoke / transfer-away kills the player instantly.
  useEffect(() => {
    if (!channelIsPremium) return undefined;
    const handleKill = (label) => () => {
      console.log('[player][gate]', `kill:${label}`);
      setAccessAllowed(false);
      void reverifySubscription(`player-${label}`);
      try {
        navigation.goBack();
      } catch {}
    };
    const offRevoked = subscribeRealtimeEvent('subscription_revoked', handleKill('revoked'));
    const offCompleted = subscribeRealtimeEvent('transfer_completed', handleKill('transfer_completed'));
    return () => {
      offRevoked();
      offCompleted();
    };
  }, [channelIsPremium, navigation, reverifySubscription]);

  // Admin emergency: stop all playback surfaces, portrait, then leave player so global Emergency modal shows.
  useEffect(() => {
    if (!emergencyMode) {
      emergencyInterruptOnceRef.current = false;
      return;
    }
    if (emergencyInterruptOnceRef.current) return;
    emergencyInterruptOnceRef.current = true;
    console.log('[player][emergency] interrupt_stop_playback');
    (async () => {
      try {
        await videoRef.current?.pauseAsync?.();
        await videoRef.current?.unloadAsync?.();
      } catch {}
      try {
        hlsWebRef.current?.injectJavaScript(
          `(function(){try{var v=document.getElementById('v');if(v){v.pause();}}catch(e){}})();true;`,
        );
      } catch {}
      try {
        embedWebRef.current?.injectJavaScript(
          `(function(){try{var v=document.querySelector('video');if(v)v.pause();}catch(e){}})();true;`,
        );
      } catch {}
      try {
        await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT);
        StatusBar.setHidden(false);
      } catch {}
      try {
        navigation.navigate('MainTabs', { screen: 'Home' });
      } catch {
        try {
          navigation.goBack();
        } catch {}
      }
    })();
  }, [emergencyMode, navigation]);

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
    clearHideTimer();
    setControlsVisible(true);
    controlsOpacity.setValue(1);
  }, [controlsOpacity, clearHideTimer]);

  /** User-only: fresh mount without automatic timers or replay loops. */
  const manualReloadSameStream = useCallback(() => {
    setPlaybackError('');
    setIsBuffering(true);
    setPlayerEpoch((e) => e + 1);
  }, []);

  const onError = (error) => {
    console.log('[player][debug] playback error:', {
      route: playbackRoute,
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

  /**
   * Prevent Android display sleep while this screen is focused and the app is
   * foreground. Unrelated to overlay auto-hide (opacity only). Released on blur,
   * background, and unmount so battery optimization is not fought while away.
   */
  useFocusEffect(
    useCallback(() => {
      const tag = PLAYER_KEEP_AWAKE_TAG;
      const enable = () => {
        void activateKeepAwakeAsync(tag).catch((e) => {
          console.log('[player][keep-awake]', 'activate_failed', e?.message ?? e);
        });
      };
      const disable = () => {
        try {
          deactivateKeepAwake(tag);
        } catch (e) {
          console.log('[player][keep-awake]', 'deactivate_failed', e?.message ?? e);
        }
      };

      if (AppState.currentState === 'active') {
        enable();
      }

      const appSub = AppState.addEventListener('change', (next) => {
        if (next === 'active') {
          enable();
        } else {
          disable();
        }
      });

      return () => {
        appSub.remove();
        disable();
      };
    }, []),
  );

  // BACK
  useEffect(() => {
    const backAction = () => {
      navigation.goBack();
      return true;
    };

    const backHandler = BackHandler.addEventListener('hardwareBackPress', backAction);
    return () => backHandler.remove();
  }, [navigation]);

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

    // App-level presence: attach the channel to the live session so the
    // admin Live User Locations watcher count updates immediately.
    setActiveChannel(channelId, channelName);

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
      // Detach channel from the app-level presence session so the
      // admin watcher count drops without waiting for the next tick.
      clearActiveChannel();
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
  const clearHideTimer = useCallback(() => {
    if (hideTimer.current) {
      clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
  }, []);

  const hideControls = useCallback(() => {
    if (pickerKindRef.current) return;
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

  useEffect(() => {
    playbackErrorRef.current = playbackError;
  }, [playbackError]);

  /** (Re)start the 4s hide countdown — user interactions and first-playback arm only. */
  const bumpAutoHideTimer = useCallback(() => {
    if (pickerKindRef.current || playbackErrorRef.current) return;
    clearHideTimer();
    hideTimer.current = setTimeout(() => {
      if (pickerKindRef.current || playbackErrorRef.current) return;
      hideControls();
    }, AUTO_HIDE_MS);
  }, [clearHideTimer, hideControls]);

  /** First confirmed playback per mount: arm hide once (not on every progress/status/message). */
  const markPlaybackStartedForHide = useCallback(() => {
    if (playbackHideArmedRef.current) return;
    playbackHideArmedRef.current = true;
    bumpAutoHideTimer();
  }, [bumpAutoHideTimer]);

  /** Explicit user intent: tap surface or press a control button. */
  const revealControlsUser = useCallback(() => {
    showControlsAnimated();
    bumpAutoHideTimer();
  }, [showControlsAnimated, bumpAutoHideTimer]);

  useEffect(() => {
    pickerKindRef.current = pickerKind;
    if (pickerKind) {
      clearHideTimer();
      showControlsAnimated();
    } else if (!playbackErrorRef.current) {
      bumpAutoHideTimer();
    }
  }, [pickerKind, clearHideTimer, showControlsAnimated, bumpAutoHideTimer]);

  useEffect(() => {
    return () => clearHideTimer();
  }, [clearHideTimer]);

  const TEN_MIN_MS = 10 * 60 * 1000;
  const ONE_MIN_MS = 60 * 1000;

  const performHardExpiryShutdown = useCallback(async () => {
    if (hardWallClockExpiryDoneRef.current) return;
    hardWallClockExpiryDoneRef.current = true;
    console.log('[player][expiry] hard_wallclock_shutdown');
    clearHideTimer();
    setExpiryOverlay({ visible: false, minuteCeil: 0, secondCeil: 0, critical: false });
    setPlaybackSuppressed(true);
    setPickerKind(null);
    setIsBuffering(false);
    setIsPlaying(false);

    try {
      await videoRef.current?.pauseAsync?.();
      await videoRef.current?.unloadAsync?.();
    } catch {
      /* ignore */
    }
    try {
      hlsWebRef.current?.injectJavaScript(
        `(function(){try{var v=document.getElementById('v');if(v){v.pause();v.removeAttribute('src');v.load();}}catch(e){}})();true;`,
      );
    } catch {
      /* ignore */
    }
    try {
      embedWebRef.current?.injectJavaScript(
        `(function(){try{var v=document.querySelector('video');if(v){v.pause();v.removeAttribute('src');v.load();}}catch(e){}})();true;`,
      );
    } catch {
      /* ignore */
    }

    setPlayerEpoch((e) => e + 1);

    try {
      await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT);
      StatusBar.setHidden(false);
    } catch {
      /* ignore */
    }

    try {
      await reverifySubscription('player-expiry-wallclock');
    } catch (e) {
      console.log('[player][expiry] reverify_after_shutdown', e?.message ?? e);
    }

    try {
      navigation.navigate('MainTabs', {
        screen: 'Home',
        params: { openPremiumAfterExpiry: true },
      });
    } catch {
      try {
        navigation.navigate('MainTabs', {
          screen: 'Akaunti Yangu',
          params: { openPremiumAfterExpiry: true },
        });
      } catch {
        try {
          navigation.goBack();
        } catch {
          /* ignore */
        }
      }
    }
  }, [clearHideTimer, navigation, reverifySubscription]);

  useEffect(() => {
    if (!channelIsPremium || freeMode || !accessAllowed || playbackSuppressed) {
      if (premiumExpiryTickRef.current) {
        clearInterval(premiumExpiryTickRef.current);
        premiumExpiryTickRef.current = null;
      }
      if (!channelIsPremium || freeMode) {
        setExpiryOverlay({ visible: false, minuteCeil: 0, secondCeil: 0, critical: false });
      }
      return undefined;
    }
    const tick = () => {
      if (hardWallClockExpiryDoneRef.current || playbackSuppressed) return;
      const expiresAt =
        subscriptionDetails?.expiresAt != null && String(subscriptionDetails.expiresAt).trim() !== ''
          ? subscriptionDetails.expiresAt
          : subscriptionExpiresAt;
      const rem = getServerAnchoredRemainingMs({
        expiresAt,
        serverTime: subscriptionDetails?.serverTime ?? null,
        serverTimeFetchedAt: subscriptionDetails?.serverTimeFetchedAt ?? null,
        nowMsOverride: Date.now(),
      });
      if (rem == null) {
        setExpiryOverlay((s) => ({ ...s, visible: false }));
        return;
      }
      if (rem <= 0) {
        void performHardExpiryShutdown();
        return;
      }
      if (rem > TEN_MIN_MS) {
        setExpiryOverlay({ visible: false, minuteCeil: 0, secondCeil: 0, critical: false });
        return;
      }
      const critical = rem <= ONE_MIN_MS;
      setExpiryOverlay({
        visible: true,
        minuteCeil: Math.max(1, Math.ceil(rem / ONE_MIN_MS)),
        secondCeil: Math.max(0, Math.ceil(rem / 1000)),
        critical,
      });
    };
    premiumExpiryTickRef.current = setInterval(tick, 1000);
    tick();
    return () => {
      if (premiumExpiryTickRef.current) {
        clearInterval(premiumExpiryTickRef.current);
        premiumExpiryTickRef.current = null;
      }
    };
  }, [
    channelIsPremium,
    freeMode,
    accessAllowed,
    playbackSuppressed,
    subscriptionDetails,
    subscriptionExpiresAt,
    subscriptionVersion,
    performHardExpiryShutdown,
  ]);

  useEffect(() => {
    if (!channelIsPremium || freeMode || !accessAllowed || playbackSuppressed) return undefined;
    const id = setInterval(() => {
      if (hardWallClockExpiryDoneRef.current) return;
      void reverifySubscription('player-expiry-sync');
    }, 90 * 1000);
    return () => clearInterval(id);
  }, [channelIsPremium, freeMode, accessAllowed, playbackSuppressed, reverifySubscription]);

  useEffect(() => {
    if (!accessAllowed || !uri) return undefined;
    playbackHideArmedRef.current = false;
    setControlsVisible(true);
    controlsOpacity.setValue(1);
    return undefined;
  }, [accessAllowed, uri, playerEpoch, controlsOpacity]);

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
    const prevPlaying = lastStatusRef.current.isPlaying === true;
    const playing = Boolean(status.isPlaying);
    const nativeBuffering = Boolean(status.isBuffering);
    // Exo/HLS often keeps isBuffering true briefly (or stuck) while isPlaying is
    // already true — hide the blocking loader as soon as playback has started.
    setIsBuffering(playing ? false : nativeBuffering);
    setIsPlaying(playing);
    setPlaybackError('');
    if (playing && !prevPlaying) {
      markPlaybackStartedForHide();
    }
  };

  const onEmbedLoadStart = () => {
    setIsBuffering(true);
  };

  const onEmbedLoadEnd = () => {
    setIsBuffering(false);
    setPlaybackError('');
    if (useEmbedWebView) {
      embedWebRef.current?.injectJavaScript(buildEmbedCmdScript({ type: 'request-tracks' }));
    }
    if (useHlsWebView) {
      hlsWebRef.current?.injectJavaScript(buildHlsCmdScript({ type: 'request-tracks' }));
    }
    // Embed pages may never post a playing event; arm hide once after load (not on every message).
    if (useEmbedWebView) {
      markPlaybackStartedForHide();
    }
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

  const onHlsWebMessage = (event) => {
    const raw = event?.nativeEvent?.data ?? '';
    let msg = null;
    try {
      msg = JSON.parse(raw);
    } catch {
      console.log('[player][debug] hls.js webview raw:', raw);
      return;
    }
    if (!msg || typeof msg !== 'object') return;
    const kind = String(msg.kind || '');
    const payload = msg.payload ?? null;
    if (
      kind === 'html_boot' ||
      kind === 'hls_src' ||
      kind === 'hls_script_load' ||
      kind === 'hls_supported' ||
      kind === 'hls_load_source' ||
      kind === 'hls_media_attached' ||
      kind === 'html_fetch_start' ||
      kind === 'html_fetch_result'
    ) {
      console.log('[player][debug] hls.js webview diagnostic:', kind, payload);
      return;
    }
    if (
      kind === 'hls_script_error' ||
      kind === 'html_fetch_error' ||
      kind === 'window_error' ||
      kind === 'window_unhandled_rejection'
    ) {
      console.log('[player][debug] hls.js webview error diagnostic:', kind, payload);
      return;
    }
    if (kind === 'hls_manifest_parsed' || kind === 'hls_level_loaded') {
      console.log('[player][debug] hls.js event:', kind);
      return;
    }
    if (kind === 'hls_levels') {
      const levels = Array.isArray(payload?.levels) ? payload.levels : [];
      setHlsLevels(levels);
      if (typeof payload?.currentLevel === 'number') setHlsCurrentLevel(payload.currentLevel);
      if (typeof payload?.autoLevelEnabled === 'boolean') setHlsAutoLevel(payload.autoLevelEnabled);
      return;
    }
    if (kind === 'hls_audio_tracks') {
      const tracks = Array.isArray(payload?.tracks) ? payload.tracks : [];
      setHlsAudioTracks(tracks);
      if (typeof payload?.currentAudioTrack === 'number') setHlsCurrentAudioTrack(payload.currentAudioTrack);
      return;
    }
    if (kind === 'hls_level_switched' || kind === 'hls_audio_track_switched') {
      console.log('[player][debug] hls.js track switched:', kind, payload);
      return;
    }
    if (kind === 'video_playing') {
      setIsBuffering(false);
      setIsPlaying(true);
      setPlaybackError('');
      markPlaybackStartedForHide();
      console.log('[player][debug] hls.js: playing');
      return;
    }
    if (kind === 'video_waiting') {
      setIsBuffering(true);
      console.log('[player][debug] hls.js: waiting/buffering');
      return;
    }
    if (kind === 'stall_detected') {
      console.log('[player][debug] hls.js: stall_detected', payload);
      setIsBuffering(true);
      return;
    }
    if (kind === 'reconnect_backoff') {
      console.log('[player][debug] hls.js: reconnect_backoff', payload);
      return;
    }
    if (kind === 'recovery_attempt') {
      console.log('[player][debug] hls.js: recovery_attempt', payload);
      setIsBuffering(true);
      return;
    }
    if (kind === 'recovery_success') {
      console.log('[player][debug] hls.js: recovery_success', payload);
      setIsBuffering(false);
      setPlaybackError('');
      return;
    }
    if (kind === 'recovery_failed') {
      console.log('[player][debug] hls.js: recovery_failed', payload);
      if (payload?.mode === 'max-consecutive' || payload?.mode === 'cooldown') {
        applyPlaybackFailure(`hls-recovery:${payload?.mode || 'failed'}`);
      }
      return;
    }
    if (kind === 'hls_recover') {
      console.log('[player][debug] hls.js: recover ->', payload);
      return;
    }
    if (kind === 'hls_error') {
      const fatal = Boolean(payload?.fatal);
      console.log('[player][debug] hls.js error', { fatal, ...payload });
      if (fatal) setIsBuffering(true);
      return;
    }
    if (kind === 'video_error') {
      console.log('[player][debug] hls.js: video element error', payload);
      applyPlaybackFailure(`video-error:${payload?.code ?? ''}`);
      return;
    }
    if (kind === 'hls_fatal_giveup') {
      console.log('[player][debug] hls.js: fatal giveup', payload);
      applyPlaybackFailure(`hls.js-fatal:${payload?.type || ''}:${payload?.details || ''}`);
      return;
    }
    console.log('[player][debug] hls.js unknown event:', kind, payload);
  };

  const onEmbedMessage = (event) => {
    const raw = event?.nativeEvent?.data ?? '';
    let msg = null;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (!msg || typeof msg !== 'object') return;
    const kind = String(msg.kind || '');
    const payload = msg.payload ?? null;
    if (kind === 'embed_controls_detected') {
      setEmbedControls(payload || null);
      setEmbedHasControls(Boolean(payload));
      embedWebRef.current?.injectJavaScript(buildEmbedSuppressNativeUiJs());
      return;
    }
    if (kind === 'embed_no_controls') {
      setEmbedControls(null);
      setEmbedHasControls(false);
      return;
    }
  };

  const onHlsWebHttpError = (ev) => {
    const status = ev?.nativeEvent?.statusCode;
    console.log('[player][debug] hls.js webview shell http error:', status);
    applyPlaybackFailure(`hls-shell-http:${status}`);
  };

  const onHlsWebError = (ev) => {
    const desc = ev?.nativeEvent?.description ?? ev?.nativeEvent?.message ?? 'unknown';
    console.log('[player][debug] hls.js webview shell error:', desc);
    applyPlaybackFailure(`hls-shell-error:${String(desc)}`);
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
    } else if (useHlsWebView) {
      const cmd = isPlaying
        ? `(function(){try{var v=document.getElementById('v');if(v)v.pause();}catch(e){}})();true;`
        : `(function(){try{var v=document.getElementById('v');if(v)v.play().catch(function(){});}catch(e){}})();true;`;
      hlsWebRef.current?.injectJavaScript(cmd);
      setIsPlaying((v) => !v);
    } else {
      embedWebRef.current?.injectJavaScript(`(function(){try{var v=document.querySelector('video');if(v){if(v.paused)v.play().catch(function(){});else v.pause();}}catch(e){}})();true;`);
      setIsPlaying((v) => !v);
    }
    revealControlsUser();
  };

  useEffect(() => {
    if (!uri) return;
    setPlaybackError('');
  }, [uri, playerEpoch, playbackRoute]);

  /** Quality picker model (auto + per-level). */
  const qualityModel = useMemo(() => {
    if (useHlsWebView) {
      const selectedId = hlsAutoLevel ? -1 : hlsCurrentLevel;
      const options = [
        { id: -1, label: 'Auto', selected: selectedId === -1 },
        ...hlsLevels.map((lv) => ({
          id: lv.index,
          label: hlsLevelLabel(lv) || `Level ${lv.index}`,
          selected: selectedId === lv.index,
        })),
      ];
      const current = options.find((o) => o.selected) ?? options[0];
      return { available: true, options, currentLabel: current?.label ?? 'Auto' };
    }
    if (useEmbedWebView && embedControls && embedControls.qualities?.length) {
      const selectedId = typeof embedControls.currentQuality === 'number' ? embedControls.currentQuality : -1;
      const options = [
        { id: -1, label: 'Auto', selected: selectedId === -1 },
        ...embedControls.qualities.map((q) => ({
          id: q.id,
          label: q.label || `Q${q.id}`,
          selected: selectedId === q.id,
        })),
      ];
      const current = options.find((o) => o.selected) ?? options[0];
      return { available: true, options, currentLabel: current?.label ?? 'Auto' };
    }
    return { available: false, options: [], currentLabel: useNativePlayer ? 'Auto' : '—' };
  }, [useHlsWebView, useEmbedWebView, useNativePlayer, hlsLevels, hlsCurrentLevel, hlsAutoLevel, embedControls]);

  /** Language / audio track picker model. */
  const languageModel = useMemo(() => {
    if (useHlsWebView && hlsAudioTracks.length) {
      const options = hlsAudioTracks.map((t) => ({
        id: t.id,
        label: hlsAudioLabel(t),
        selected: hlsCurrentAudioTrack === t.id,
      }));
      const current = options.find((o) => o.selected) ?? options[0];
      return { available: true, options, currentLabel: current?.label ?? '—' };
    }
    if (useEmbedWebView && embedControls && embedControls.audioTracks?.length) {
      const selectedId = typeof embedControls.currentAudioTrack === 'number' ? embedControls.currentAudioTrack : -1;
      const options = embedControls.audioTracks.map((t) => ({
        id: t.id,
        label: t.label || `Audio ${t.id}`,
        selected: selectedId === t.id,
      }));
      const current = options.find((o) => o.selected) ?? options[0];
      return { available: true, options, currentLabel: current?.label ?? '—' };
    }
    return { available: false, options: [], currentLabel: '—' };
  }, [useHlsWebView, useEmbedWebView, hlsAudioTracks, hlsCurrentAudioTrack, embedControls]);

  const openQualityPicker = useCallback(() => {
    revealControlsUser();
    if (useNativePlayer) {
      Alert.alert('Quality', 'Auto (default) — native player itachagua ubora yenyewe.');
      return;
    }
    if (!qualityModel.available) {
      if (useEmbedWebView && embedHasControls === false) {
        Alert.alert('Quality', 'Stream hii inadhibiti ubora ndani ya page yenyewe.');
        return;
      }
      Alert.alert('Quality', useHlsWebView ? 'Inasubiri taarifa za ubora kutoka kwenye stream...' : 'Quality controls hazijapatikana bado.');
      return;
    }
    setPickerKind('quality');
  }, [useNativePlayer, useHlsWebView, useEmbedWebView, embedHasControls, qualityModel.available, revealControlsUser]);

  const openLanguagePicker = useCallback(() => {
    revealControlsUser();
    if (useNativePlayer) {
      Alert.alert('Lugha', 'Native player haitumii audio tracks za ziada.');
      return;
    }
    if (!languageModel.available) {
      if (useEmbedWebView && embedHasControls === false) {
        Alert.alert('Lugha', 'Stream hii inadhibiti audio/lugha ndani ya page yenyewe.');
        return;
      }
      Alert.alert('Lugha', useHlsWebView ? 'Stream hii haina audio tracks za ziada.' : 'Audio tracks hazijapatikana bado.');
      return;
    }
    setPickerKind('language');
  }, [useNativePlayer, useHlsWebView, useEmbedWebView, embedHasControls, languageModel.available, revealControlsUser]);

  const onPickOption = useCallback(
    (option) => {
      if (pickerKind === 'quality') {
        if (useHlsWebView) {
          hlsWebRef.current?.injectJavaScript(buildHlsCmdScript({ type: 'set-level', level: option.id }));
          if (option.id === -1) {
            setHlsAutoLevel(true);
            setHlsCurrentLevel(-1);
          } else {
            setHlsAutoLevel(false);
            setHlsCurrentLevel(option.id);
          }
        } else if (useEmbedWebView) {
          embedWebRef.current?.injectJavaScript(buildEmbedCmdScript({ type: 'set-level', level: option.id }));
          setEmbedControls((prev) => (prev ? { ...prev, currentQuality: option.id } : prev));
        }
      } else if (pickerKind === 'language') {
        if (useHlsWebView) {
          hlsWebRef.current?.injectJavaScript(buildHlsCmdScript({ type: 'set-audio-track', id: option.id }));
          setHlsCurrentAudioTrack(option.id);
        } else if (useEmbedWebView) {
          embedWebRef.current?.injectJavaScript(buildEmbedCmdScript({ type: 'set-audio-track', id: option.id }));
          setEmbedControls((prev) => (prev ? { ...prev, currentAudioTrack: option.id } : prev));
        }
      }
      setPickerKind(null);
      bumpAutoHideTimer();
    },
    [pickerKind, useHlsWebView, useEmbedWebView, bumpAutoHideTimer],
  );

  const closePicker = useCallback(() => {
    setPickerKind(null);
    bumpAutoHideTimer();
  }, [bumpAutoHideTimer]);

  const activePickerModel = pickerKind === 'quality' ? qualityModel : pickerKind === 'language' ? languageModel : null;
  const activePickerTitle = pickerKind === 'quality' ? 'Chagua Ubora' : 'Chagua Lugha / Audio';

  const bottomActions = useMemo(
    () => [
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
        label: languageModel.available ? languageModel.currentLabel : 'Lugha',
        onPress: openLanguagePicker,
      },
      {
        key: 'quality',
        icon: 'speedometer',
        label: qualityModel.available ? qualityModel.currentLabel : 'Quality',
        onPress: openQualityPicker,
      },
      {
        key: 'fill',
        icon: resizeMode === 'cover' ? 'scan' : 'expand',
        label: 'Fill',
        onPress: () =>
          setResizeMode((m) => {
            const next = m === 'contain' ? 'cover' : 'contain';
            if (useHlsWebView) {
              const fit = next === 'cover' ? 'cover' : 'contain';
              hlsWebRef.current?.injectJavaScript(
                `(function(){try{var v=document.getElementById('v');if(v)v.style.objectFit=${JSON.stringify(fit)};}catch(e){}})();true;`,
              );
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
    ],
    [
      isPlaying,
      languageModel.available,
      languageModel.currentLabel,
      qualityModel.available,
      qualityModel.currentLabel,
      resizeMode,
      useHlsWebView,
      onPlayPause,
      openLanguagePicker,
      openQualityPicker,
    ],
  );

  if (!playbackSecurity.allowed) {
    return (
      <View style={[styles.root, styles.gateScreen]}>
        <SecurityPlaybackBlock onBack={() => navigation.goBack()} />
      </View>
    );
  }

  if (channelIsPremium && !freeMode && (!accessChecked || !accessAllowed)) {
    return (
      <View style={[styles.root, styles.gateScreen]}>
        <ActivityIndicator color="#FBBF24" size="large" />
        <Text style={styles.gateText}>
          {accessChecked ? 'Hauna kifurushi hai' : 'Inathibitisha kifurushi…'}
        </Text>
      </View>
    );
  }

  if (playbackSuppressed) {
    return (
      <View style={[styles.root, styles.gateScreen]}>
        <ActivityIndicator color="#FBBF24" size="large" />
        <Text style={styles.gateText}>Kifurushi kimekwisha…</Text>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <SecurityPlayerBanner />

      {channelIsPremium && !freeMode && expiryOverlay.visible ? (
        <View
          pointerEvents="none"
          style={[
            styles.subscriptionExpiryStrip,
            expiryOverlay.critical ? styles.subscriptionExpiryStripCritical : null,
            { top: Math.max(10, insets.top + 6) },
          ]}
        >
          <Text
            style={[
              styles.subscriptionExpiryStripText,
              expiryOverlay.critical ? styles.subscriptionExpiryStripTextCritical : null,
            ]}
            numberOfLines={2}
          >
            {expiryOverlay.critical
              ? `Kifurushi chako kinaisha baada ya sekunde ${expiryOverlay.secondCeil}`
              : `Kifurushi chako kinaisha baada ya dakika ${expiryOverlay.minuteCeil}`}
          </Text>
        </View>
      ) : null}

      {/*
        Routing:
          - HLS (.m3u8)     → expo-av / ExoPlayer + stream-proxy (default); optional hls.js WebView if playerType=webview
          - .mp4 / .ts ... → expo-av native
          - everything else (player.php, embed pages, iframe HTML) → plain WebView
      */}
      <Pressable style={{ flex: 1 }} onPress={revealControlsUser}>
        <View pointerEvents="none" style={styles.videoUnderlay} />

        {useNativePlayer && nativeVideoSource ? (
          <Video
            key={`native-${playerEpoch}`}
            ref={videoRef}
            source={nativeVideoSource}
            style={styles.video}
            resizeMode={resizeMode}
            shouldPlay
            progressUpdateIntervalMillis={1000}
            onPlaybackStatusUpdate={onStatusUpdate}
            onError={onError}
            useNativeControls={false}
          />
        ) : useHlsWebView ? (
          <WebView
            key={`hls-${playerEpoch}`}
            ref={hlsWebRef}
            style={styles.video}
            source={hlsWebViewSource}
            allowsInlineMediaPlayback
            mediaPlaybackRequiresUserAction={false}
            javaScriptEnabled
            domStorageEnabled
            originWhitelist={['*']}
            mixedContentMode="always"
            onLoadStart={onEmbedLoadStart}
            onLoadEnd={onEmbedLoadEnd}
            onMessage={onHlsWebMessage}
            onHttpError={onHlsWebHttpError}
            onError={onHlsWebError}
          />
        ) : (
          <WebView
            key={`embed-${playerEpoch}`}
            ref={embedWebRef}
            style={styles.video}
            source={embedWebViewSource}
            allowsInlineMediaPlayback
            mediaPlaybackRequiresUserAction={false}
            javaScriptEnabled
            domStorageEnabled
            originWhitelist={['*']}
            mixedContentMode="always"
            injectedJavaScript={embedBridgeJs}
            onLoadStart={onEmbedLoadStart}
            onLoadEnd={onEmbedLoadEnd}
            onMessage={onEmbedMessage}
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
                <Pressable
                  key={action.key}
                  style={styles.actionBtn}
                  onPress={() => {
                    action.onPress();
                    revealControlsUser();
                  }}
                >
                  <Ionicons name={action.icon} size={18} color="#E5E7EB" />
                  <Text style={styles.actionLabel} numberOfLines={1}>{action.label}</Text>
                </Pressable>
              ))}
            </View>

          </Animated.View>
        )}

        {pickerKind && activePickerModel ? (
          <Pressable style={styles.pickerBackdrop} onPress={closePicker}>
            <Pressable style={styles.pickerSheet} onPress={() => {}}>
              <View style={styles.pickerHeader}>
                <Text style={styles.pickerTitle}>{activePickerTitle}</Text>
                <Pressable onPress={closePicker} style={styles.pickerClose} hitSlop={12}>
                  <Ionicons name="close" size={20} color="#E5E7EB" />
                </Pressable>
              </View>
              <ScrollView style={styles.pickerScroll} contentContainerStyle={styles.pickerList}>
                {activePickerModel.options.map((opt) => (
                  <Pressable
                    key={`${pickerKind}-${opt.id}`}
                    onPress={() => onPickOption(opt)}
                    style={[styles.pickerRow, opt.selected ? styles.pickerRowSelected : null]}
                  >
                    <Text
                      style={[styles.pickerLabel, opt.selected ? styles.pickerLabelSelected : null]}
                      numberOfLines={1}
                    >
                      {opt.label}
                    </Text>
                    {opt.selected ? (
                      <Ionicons name="checkmark" size={18} color="#1EC967" />
                    ) : null}
                  </Pressable>
                ))}
              </ScrollView>
            </Pressable>
          </Pressable>
        ) : null}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  videoUnderlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#000000',
  },
  gateScreen: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
    paddingHorizontal: 28,
  },
  gateText: {
    color: '#E5E7EB',
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
  },

  subscriptionExpiryStrip: {
    position: 'absolute',
    left: 12,
    right: 12,
    zIndex: 25,
    elevation: 14,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: 'rgba(15,17,21,0.92)',
    borderWidth: 1,
    borderColor: 'rgba(250,204,21,0.38)',
  },
  subscriptionExpiryStripCritical: {
    backgroundColor: 'rgba(60,12,12,0.96)',
    borderColor: 'rgba(252,165,165,0.95)',
  },
  subscriptionExpiryStripText: {
    color: '#FEF9C3',
    fontSize: 13,
    fontWeight: '800',
    textAlign: 'center',
    lineHeight: 18,
  },
  subscriptionExpiryStripTextCritical: {
    color: '#FEE2E2',
  },

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

  pickerBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(2,4,8,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 30,
    elevation: 30,
    paddingHorizontal: 20,
  },
  pickerSheet: {
    width: '100%',
    maxWidth: 360,
    maxHeight: '80%',
    backgroundColor: '#10141C',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(148,163,184,0.22)',
    overflow: 'hidden',
  },
  pickerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(148,163,184,0.18)',
  },
  pickerTitle: {
    color: '#F8FAFC',
    fontSize: 14,
    fontWeight: '700',
  },
  pickerClose: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(30,41,59,0.7)',
  },
  pickerScroll: {
    flexGrow: 0,
  },
  pickerList: {
    paddingVertical: 6,
  },
  pickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 8,
  },
  pickerRowSelected: {
    backgroundColor: 'rgba(30,201,103,0.12)',
  },
  pickerLabel: {
    color: '#E5E7EB',
    fontSize: 13,
    fontWeight: '500',
    flexShrink: 1,
  },
  pickerLabelSelected: {
    color: '#A7F3D0',
    fontWeight: '700',
  },
});