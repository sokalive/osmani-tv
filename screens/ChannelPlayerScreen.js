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
import { Video, ResizeMode } from 'expo-av';
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
import { buildPlaybackRequestHeaders } from '../lib/authorizedPackageName';
import {
  CHROME_WEBVIEW_PROPS,
  resolveChromeUserAgent,
} from '../lib/chromePlayerWebView';
import {
  canFallbackToProxyPlayback,
  looksLikeHlsPlaybackUri,
  logPlaybackDiagnostics,
  logSegmentDiagnostics,
  resolveHlsPlaybackManifestUrl,
  shouldUseDirectHlsSegments,
} from '../lib/hlsPlayback';
import { devLog } from '../lib/devLog';
import { STREAM_PROXY_BASE } from '../lib/streamProxy';
import { buildHlsJsPlayerHtml } from '../lib/hlsJsPlayerHtml';
import { buildEmbedBridgeJs, buildEmbedPageBootstrapJs, buildEmbedSuppressNativeUiJs } from '../lib/embedBridgeJs';
import { getServerAnchoredRemainingMs } from '../lib/subscriptionMath';
import {
  SecurityPlaybackBlock,
  SecurityPlayerBanner,
} from '../components/SecurityPlaybackGate';
import TrialWatchOverlay from '../components/TrialWatchOverlay';
import { useDeviceIntelligence } from '../context/DeviceIntelligenceContext';
import { usePlaybackSecurityGate, useSecurity } from '../context/SecurityContext';
import { PLAYER_SECURITY_POLL_MS } from '../lib/security/constants';
import { useTrialWatchSession } from '../hooks/useTrialWatchSession';
import {
  channelIsPremiumAccess,
  shouldRunTrialWatchOnChannel,
} from '../lib/trialWatchAccess';
import {
  applyNativeVideoResizeMode,
  normalizeVideoResizeMode,
} from '../lib/nativeVideoResize';
import {
  logPlayerTeardown,
  teardownPlayback,
} from '../lib/playerTeardown';
import { playbackStreamIdentity } from '../lib/playbackStreamIdentity';
import { fetchNativeHlsManifestTracksForPlayback } from '../lib/nativeHlsManifestTracks';

/**
 * Pick a playback engine (stable routing from e196fff + chrome-only branch).
 *   HLS (.m3u8)     → native (Exo) by default; webview → hls-webview; chrome → chrome-webview
 *   .mp4/.ts/.mts  → native; chrome → chrome-webview
 *   player.php etc → embed-webview; chrome → chrome-webview
 */
function pickPlaybackRoute(url, playerTypeNorm) {
  const s = String(url ?? '');
  if (!s.trim()) {
    return playerTypeNorm === 'chrome' ? 'chrome-webview' : 'embed-webview';
  }
  const lower = s.split(/[#?]/)[0].toLowerCase();
  if (looksLikeHlsPlaybackUri(s)) {
    if (playerTypeNorm === 'webview') return 'hls-webview';
    if (playerTypeNorm === 'chrome') return 'chrome-webview';
    return 'native';
  }
  if (/\.mp4$/i.test(lower)) {
    if (playerTypeNorm === 'chrome') return 'chrome-webview';
    return 'native';
  }
  if (/\.(?:m2ts|mts|ts)$/i.test(lower)) {
    if (playerTypeNorm === 'chrome') return 'chrome-webview';
    return 'native';
  }
  if (playerTypeNorm === 'chrome') return 'chrome-webview';
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
/** Native Exo: debounce full-screen buffer overlay after first playback start. */
const NATIVE_BUFFER_OVERLAY_DEBOUNCE_MS = 2000;
/** Native Exo: frozen playback (not active rebuffer) before silent recovery. */
const NATIVE_STALL_DETECT_MS = 12000;
const NATIVE_STALL_RECOVERY_COOLDOWN_MS = 8000;

/**
 * @param {string} event
 * @param {unknown} [detail]
 */
function logPlayerBuffer(event, detail) {
  if (detail !== undefined) {
    console.log('[player][buffer]', event, detail);
  } else {
    console.log('[player][buffer]', event);
  }
}

/** Stable stream identity — token rotation alone must not remount Exo. */
function logPlayerInterrupt(path, detail = {}) {
  console.log('[player][interrupt]', path, detail);
}

export default function ChannelPlayerScreen({ route, navigation }) {
  const insets = useSafeAreaInsets();
  const initialChannel = route?.params?.channel ?? null;
  const [liveChannel, setLiveChannel] = useState(initialChannel);
  const [channelDisabledNotified, setChannelDisabledNotified] = useState(false);
  const {
    rawChannels,
    freeMode,
    isSubscribed,
    gateForPlayback,
    reverifySubscription,
    emergencyMode,
    subscriptionDetails,
    subscriptionExpiresAt,
    subscriptionVersion,
    trialWatchSettings,
    requestPaymentModal,
  } = useOsmaniApp();
  const security = useSecurity();
  const { blocked: deviceIntelligenceBlocked } = useDeviceIntelligence();
  const playbackSecurity = usePlaybackSecurityGate();
  const channel = liveChannel ?? initialChannel;
  const channelIsPremium = channelIsPremiumAccess(channel, { freeMode });
  const channelPlaybackKey = String(
    channel?.id ?? channel?.channel_id ?? channel?.name ?? '',
  ).trim();
  const routeTrialBootstrap = route?.params?.trialWatchBootstrap ?? null;
  const viaTrialPlayback = shouldRunTrialWatchOnChannel({
    channel,
    isSubscribed,
    freeMode,
    trialWatchSettings,
  });
  const trialBootstrapForSession =
    viaTrialPlayback &&
    routeTrialBootstrap?.phase &&
    routeTrialBootstrap.remainingMs > 0
      ? routeTrialBootstrap
      : null;
  const [accessChecked, setAccessChecked] = useState(
    () => !channelIsPremium || freeMode || viaTrialPlayback,
  );
  const [accessAllowed, setAccessAllowed] = useState(
    () => !channelIsPremium || freeMode || viaTrialPlayback,
  );

  const streams = [
    channel?.url,
    channel?.backupStream1,
    channel?.backupStream2,
  ].filter(Boolean);

  const [currentUrlIndex, setCurrentUrlIndex] = useState(0);
  /** When direct/auto playback fails, retry once through CDN stream-proxy. */
  const [hlsForceProxy, setHlsForceProxy] = useState(false);
  const manifestRefreshAttemptRef = useRef(0);
  const nativeLoadedUriRef = useRef('');
  /** Premium gate passed once per channel session — catalog token rotation must not re-gate. */
  const premiumGateSessionRef = useRef({ channelKey: '', granted: false });
  const nativeStallRef = useRef({
    lastPositionMs: 0,
    lastPlayableMs: 0,
    lastProgressWallMs: 0,
    recoveryAttempt: 0,
    lastRecoveryWallMs: 0,
    recovering: false,
  });
  const uri = streams[currentUrlIndex];
  /** Stream headers for native sidecar fetch + direct media (no package headers on HLS manifest). */
  const headers = useMemo(
    () => ({
      ...(channel?.referer && { Referer: channel.referer }),
      ...(channel?.origin && { Origin: channel.origin }),
      ...(channel?.userAgent && { 'User-Agent': channel.userAgent }),
    }),
    [channel?.referer, channel?.origin, channel?.userAgent],
  );
  /** WebView/Chrome page load headers (includes authorizedPackageName when configured). */
  const webPlaybackHeaders = useMemo(() => buildPlaybackRequestHeaders(channel), [channel]);
  const normalizedPlayerType = normalizePlayerType(channel?.playerType);
  const streamIdentity = useMemo(() => playbackStreamIdentity(channel), [channel]);
  const playbackRoute = useMemo(
    () => pickPlaybackRoute(uri, normalizedPlayerType),
    [uri, normalizedPlayerType],
  );
  const useNativePlayer = playbackRoute === 'native';
  const useHlsWebView = playbackRoute === 'hls-webview';
  const useEmbedWebView = playbackRoute === 'embed-webview';
  const useChromeWebView = playbackRoute === 'chrome-webview';
  const useEmbedLikeWebView = useEmbedWebView || useChromeWebView;

  const isHlsManifest = Boolean(uri && looksLikeHlsPlaybackUri(uri));

  /** HLS manifest for native Exo / hls.js (direct, proxy, or auto with fallback). */
  const hlsManifestUrl = useMemo(() => {
    if (!uri || !isHlsManifest) return '';
    return resolveHlsPlaybackManifestUrl(
      uri,
      {
        referer: channel?.referer,
        origin: channel?.origin,
        userAgent: channel?.userAgent,
      },
      {
        deliveryMode: channel?.streamDeliveryMode,
        directStreamUrl: channel?.directStreamUrl,
        proxyFallbackUrl: channel?.proxyFallbackUrl,
        forceProxy: hlsForceProxy,
      },
    );
  }, [
    isHlsManifest,
    uri,
    channel?.referer,
    channel?.origin,
    channel?.userAgent,
    channel?.streamDeliveryMode,
    channel?.directStreamUrl,
    channel?.proxyFallbackUrl,
    hlsForceProxy,
  ]);

  const useDirectHlsSegments = useMemo(
    () => shouldUseDirectHlsSegments(channel?.streamDeliveryMode, hlsForceProxy),
    [channel?.streamDeliveryMode, hlsForceProxy],
  );

  const refreshManifestFromCatalog = useCallback(
    (reason = 'manifest_refresh') => {
      const channelId = String(channel?.id ?? channel?.channel_id ?? '').trim();
      if (!channelId) return false;
      const found = findRawChannelById(rawChannels, channelId);
      if (!found) return false;
      const next = buildPlayerChannelFromRow(found.raw, found.index, freeMode);
      const identityChanged = playbackStreamIdentity(channel) !== playbackStreamIdentity(next);
      logSegmentDiagnostics('manifest_refresh', {
        reason,
        channelId,
        directStreamUrl: next.directStreamUrl ?? null,
        identityChanged,
      });
      setLiveChannel(next);
      setHlsForceProxy(false);
      setPlaybackError('');
      if (identityChanged) {
        logPlayerInterrupt('manifest_catalog_remount', { reason });
        setIsBuffering(true);
        setPlayerEpoch((e) => e + 1);
      } else {
        logPlayerInterrupt('manifest_catalog_skip_remount', { reason });
      }
      return true;
    },
    [channel, rawChannels, freeMode],
  );

  /**
   * expo-av source: remote HLS manifest only (live refresh). Native Exo must not use
   * static data: manifests — they freeze the live window and cause repeated stalls.
   */
  const nativeVideoSource = useMemo(() => {
    if (!useNativePlayer || !uri) return null;
    if (looksLikeHlsPlaybackUri(uri)) {
      const u = hlsManifestUrl || uri;
      return {
        uri: u,
        overrideFileExtensionAndroid: 'm3u8',
      };
    }
    return { uri, headers };
  }, [useNativePlayer, uri, hlsManifestUrl, headers]);

  const hlsWebViewSource = useMemo(() => {
    if (!useHlsWebView || !hlsManifestUrl) return null;
    return {
      html: buildHlsJsPlayerHtml(hlsManifestUrl, {
        diagnostics: __DEV__,
        directSegments: useDirectHlsSegments,
      }),
      baseUrl: baseUrlFromUrl(hlsManifestUrl),
    };
  }, [useHlsWebView, hlsManifestUrl, useDirectHlsSegments]);

  /** Plain WebView source for player.php / embed/iframe HTML pages. Headers as-is. */
  const embedWebViewSource = useMemo(() => {
    if (!useEmbedWebView) return null;
    const hEntries = Object.entries(webPlaybackHeaders).filter(
      ([, v]) => v != null && String(v).trim() !== '',
    );
    if (!hEntries.length) return { uri };
    return { uri, headers: Object.fromEntries(hEntries) };
  }, [useEmbedWebView, uri, webPlaybackHeaders]);

  /** Chromium WebView for admin playerType=chrome (Mpingo embed pages, full browser features). */
  const chromeWebViewSource = useMemo(() => {
    if (!useChromeWebView) return null;
    const hEntries = Object.entries(webPlaybackHeaders).filter(
      ([, v]) => v != null && String(v).trim() !== '',
    );
    if (!hEntries.length) return { uri };
    return { uri, headers: Object.fromEntries(hEntries) };
  }, [useChromeWebView, uri, webPlaybackHeaders]);

  const chromeUserAgent = useMemo(
    () => resolveChromeUserAgent(channel?.userAgent ?? channel?.user_agent),
    [channel?.userAgent, channel?.user_agent],
  );

  const embedBridgeJs = useMemo(() => buildEmbedBridgeJs(), []);
  const embedPageBootstrapJs = useMemo(
    () =>
      buildEmbedPageBootstrapJs({
        authorizedPackageName:
          channel?.authorizedPackageName ?? channel?.authorized_package_name ?? '',
      }),
    [channel?.authorizedPackageName, channel?.authorized_package_name],
  );
  const [isBuffering, setIsBuffering] = useState(true);
  const [showNativeBufferOverlay, setShowNativeBufferOverlay] = useState(true);
  const [playbackError, setPlaybackError] = useState('');
  const nativePlaybackStartedRef = useRef(false);
  const nativeBufferDebounceRef = useRef(null);
  const nativeOverlayVisibleRef = useRef(false);
  const clearNativeBufferDebounceRef = useRef(() => {});
  const [playerEpoch, setPlayerEpoch] = useState(0);
  const liveLabel = 'LIVE';

  const videoRef = useRef(null);
  const hlsWebRef = useRef(null);
  const embedWebRef = useRef(null);
  const chromeWebRef = useRef(null);
  const activeEmbedWebRef = useChromeWebView ? chromeWebRef : embedWebRef;
  const hideTimer = useRef(null);
  const pickerKindRef = useRef(null);
  const playbackErrorRef = useRef('');
  /** One auto-hide arm per player mount (epoch); playback/message spam must not reset the timer. */
  const playbackHideArmedRef = useRef(false);
  const AUTO_HIDE_MS = 4000;
  const allowNavigationRemoveRef = useRef(false);
  const teardownDoneRef = useRef(false);
  const exitInFlightRef = useRef(false);
  const playerLifecycleRef = useRef({ focused: false, mounted: true, tearingDown: false });
  const exitPlayerRef = useRef(null);
  const statusBarHiddenRef = useRef(true);
  const [playbackSurfacesMounted, setPlaybackSurfacesMounted] = useState(true);
  const [playerShellHidden, setPlayerShellHidden] = useState(false);

  const runPlaybackTeardown = useCallback(async (reason, opts = {}) => {
    if (teardownDoneRef.current && !opts.force) {
      logPlayerTeardown('skip_duplicate', reason);
      return;
    }
    teardownDoneRef.current = true;
    playerLifecycleRef.current.tearingDown = true;
    setPickerKind(null);
    pickerKindRef.current = null;
    setPlaybackSurfacesMounted(false);
    if (opts.hideShell !== false) {
      setPlayerShellHidden(true);
      logPlayerTeardown('shell_hidden', reason);
    }
    await teardownPlayback({
      reason,
      videoRef,
      hlsWebRef,
      embedWebRef,
      chromeWebRef,
      resetChrome: opts.resetChrome !== false,
    });
    statusBarHiddenRef.current = false;
    setPlayerEpoch((e) => e + 1);
  }, []);

  const stopPlaybackForSecurity = useCallback(async () => {
    await runPlaybackTeardown('security', { resetChrome: false, force: true, hideShell: false });
  }, [runPlaybackTeardown]);

  useEffect(() => {
    if (!playbackSecurity.allowed) {
      void stopPlaybackForSecurity();
    }
  }, [playbackSecurity.allowed, stopPlaybackForSecurity]);

  useFocusEffect(
    useCallback(() => {
      void security.refresh();
      const pollId = setInterval(() => {
        void security.refresh();
      }, PLAYER_SECURITY_POLL_MS);
      return () => clearInterval(pollId);
    }, [security.refresh]),
  );

  const lastStatusRef = useRef({
    isLoaded: null,
    isBuffering: null,
    isPlaying: null,
  });
  const controlsOpacity = useRef(new Animated.Value(1)).current;

  const [isPlaying, setIsPlaying] = useState(true);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [resizeMode, setResizeMode] = useState(ResizeMode.CONTAIN);

  useEffect(() => {
    if (!useNativePlayer) return undefined;
    applyNativeVideoResizeMode(videoRef, resizeMode);
    const t = setTimeout(() => applyNativeVideoResizeMode(videoRef, resizeMode), 0);
    return () => clearTimeout(t);
  }, [resizeMode, useNativePlayer, playerEpoch]);

  const onNativeReadyForDisplay = useCallback(() => {
    applyNativeVideoResizeMode(videoRef, resizeMode);
  }, [resizeMode]);

  /** HLS track bridge state (populated by hls.js inside WebView). */
  const [hlsLevels, setHlsLevels] = useState([]);
  const [hlsCurrentLevel, setHlsCurrentLevel] = useState(-1);
  const [hlsAutoLevel, setHlsAutoLevel] = useState(true);
  const [hlsAudioTracks, setHlsAudioTracks] = useState([]);
  const [hlsCurrentAudioTrack, setHlsCurrentAudioTrack] = useState(-1);

  /** Native Exo: parsed from the same HLS manifest URL (expo-av exposes no track API). */
  const [nativeManifestVariants, setNativeManifestVariants] = useState([]);
  const [nativeManifestAudioTracks, setNativeManifestAudioTracks] = useState([]);
  const [nativeSelectedVariantId, setNativeSelectedVariantId] = useState(-1);
  const [nativeSelectedAudioId, setNativeSelectedAudioId] = useState(-1);

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
  const deviceIntelInterruptOnceRef = useRef(false);
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
    logPlayerInterrupt('channel_change_remount', {
      channelId: channel?.id ?? channel?.channel_id ?? null,
    });
    setCurrentUrlIndex(0);
    setHlsForceProxy(false);
    manifestRefreshAttemptRef.current = 0;
    setIsBuffering(true);
    setPlaybackError('');
    setPlayerEpoch((e) => e + 1);
    setHlsLevels([]);
    setHlsCurrentLevel(-1);
    setHlsAutoLevel(true);
    setHlsAudioTracks([]);
    setHlsCurrentAudioTrack(-1);
    setNativeManifestVariants([]);
    setNativeManifestAudioTracks([]);
    setNativeSelectedVariantId(-1);
    setNativeSelectedAudioId(-1);
    setEmbedControls(null);
    setEmbedHasControls(null);
    setPickerKind(null);
    playbackHideArmedRef.current = false;
    hardWallClockExpiryDoneRef.current = false;
    teardownDoneRef.current = false;
    exitInFlightRef.current = false;
    allowNavigationRemoveRef.current = false;
    playerLifecycleRef.current.tearingDown = false;
    setPlaybackSurfacesMounted(true);
    setPlayerShellHidden(false);
    setPlaybackSuppressed(false);
    setExpiryOverlay({ visible: false, minuteCeil: 0, secondCeil: 0, critical: false });
    premiumGateSessionRef.current = { channelKey: '', granted: false };
    nativeStallRef.current = {
      lastPositionMs: 0,
      lastPlayableMs: 0,
      lastProgressWallMs: 0,
      recoveryAttempt: 0,
      lastRecoveryWallMs: 0,
      recovering: false,
    };
  }, [
    channel?.id,
    channel?.channel_id,
    streamIdentity,
  ]);

  /** Rotate signed manifest URL in-place when catalog refreshes tokens (no Exo remount). */
  useEffect(() => {
    if (!useNativePlayer || !nativeVideoSource?.uri) return undefined;
    const nextUri = String(nativeVideoSource.uri);
    if (!nativeLoadedUriRef.current) {
      nativeLoadedUriRef.current = nextUri;
      return undefined;
    }
    if (nativeLoadedUriRef.current === nextUri) return undefined;
    nativeLoadedUriRef.current = nextUri;
    logPlayerInterrupt('native_source_hot_swap', { uriPrefix: nextUri.slice(0, 96) });
    const ref = videoRef.current;
    if (!ref?.loadAsync) return undefined;
    let cancelled = false;
    void ref
      .loadAsync(nativeVideoSource, { shouldPlay: true })
      .catch((e) => {
        if (!cancelled) {
          console.log('[player][debug] native hot-swap load failed:', e?.message ?? e);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [useNativePlayer, nativeVideoSource]);

  /** Parse master manifest for variant/audio metadata (read-only; same URL Exo plays). */
  useEffect(() => {
    if (!useNativePlayer || !isHlsManifest || !hlsManifestUrl) {
      setNativeManifestVariants([]);
      setNativeManifestAudioTracks([]);
      setNativeSelectedVariantId(-1);
      setNativeSelectedAudioId(-1);
      return undefined;
    }
    let cancelled = false;
    (async () => {
      const parsed = await fetchNativeHlsManifestTracksForPlayback(hlsManifestUrl, uri, headers);
      if (cancelled) return;
      setNativeManifestVariants(parsed.variants);
      setNativeManifestAudioTracks(parsed.audioTracks);
      setNativeSelectedVariantId(-1);
      const defaultAudio = parsed.audioTracks.find((t) => t.default);
      setNativeSelectedAudioId(
        defaultAudio ? defaultAudio.id : parsed.audioTracks.length === 1 ? 0 : -1,
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [useNativePlayer, isHlsManifest, hlsManifestUrl, uri, headers]);

  useEffect(() => {
    if (!useNativePlayer) return undefined;
    nativeLoadedUriRef.current = '';
    nativeStallRef.current = {
      lastPositionMs: 0,
      lastPlayableMs: 0,
      lastProgressWallMs: 0,
      recoveryAttempt: 0,
      lastRecoveryWallMs: 0,
      recovering: false,
    };
    return undefined;
  }, [playerEpoch, useNativePlayer]);

  useEffect(() => {
    if (!uri) return;
    logPlaybackDiagnostics('route', {
      route: playbackRoute,
      api_playerType: normalizedPlayerType,
      url: uri,
      proxy_base: STREAM_PROXY_BASE,
      hls_manifest_url: hlsManifestUrl || null,
      stream_delivery_mode: channel?.streamDeliveryMode ?? 'proxy',
      hls_force_proxy: hlsForceProxy,
      direct_hls_segments: useDirectHlsSegments,
      native_remote_manifest: useNativePlayer && Boolean(hlsManifestUrl),
      embed_headers_present: Boolean(
        embedWebViewSource?.headers && Object.keys(embedWebViewSource.headers).length,
      ),
    });
  }, [
    uri,
    normalizedPlayerType,
    playbackRoute,
    hlsManifestUrl,
    hlsForceProxy,
    channel?.streamDeliveryMode,
    useDirectHlsSegments,
    useNativePlayer,
    embedWebViewSource?.headers,
  ]);

  // Keep local channel snapshot in sync when route params change.
  useEffect(() => {
    setLiveChannel(route?.params?.channel ?? null);
    setChannelDisabledNotified(false);
  }, [route?.params?.channel]);

  // Drop stale trial bootstrap when playback is free (premium → free switch).
  useEffect(() => {
    if (viaTrialPlayback || !routeTrialBootstrap) return;
    try {
      navigation.setParams({ trialWatchBootstrap: null });
    } catch {
      /* ignore */
    }
  }, [channelPlaybackKey, viaTrialPlayback, routeTrialBootstrap, navigation]);

  /**
   * Hard pre-play gate: APP -> BACKEND VERIFY -> PLAY.
   *
   * Runs once per channel session. Catalog/SSE signed-URL rotation must NOT
   * re-trigger this gate (that was causing "Inathibitisha kifurushi…" flashes).
   */
  useEffect(() => {
    let cancelled = false;
    if (!channel) return undefined;
    const channelKey = String(channel?.id ?? channel?.channel_id ?? '').trim();

    if (!channelIsPremium || freeMode) {
      setAccessChecked(true);
      setAccessAllowed(true);
      premiumGateSessionRef.current = { channelKey, granted: true };
      return undefined;
    }
    if (viaTrialPlayback) {
      setAccessChecked(true);
      setAccessAllowed(true);
      premiumGateSessionRef.current = { channelKey, granted: true };
      return undefined;
    }

    if (
      premiumGateSessionRef.current.granted &&
      premiumGateSessionRef.current.channelKey === channelKey
    ) {
      return undefined;
    }

    setAccessChecked(false);
    setAccessAllowed(false);
    (async () => {
      const ok = await gateForPlayback('player-mount');
      if (cancelled) return;
      setAccessChecked(true);
      setAccessAllowed(ok);
      if (ok) {
        premiumGateSessionRef.current = { channelKey, granted: true };
      } else {
        premiumGateSessionRef.current = { channelKey, granted: false };
        console.log('[player][gate]', 'denied', { channel: channel?.name });
        if (exitPlayerRef.current) {
          void exitPlayerRef.current('gate_denied');
        } else {
          try {
            navigation.goBack();
          } catch {}
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    channel?.id,
    channel?.channel_id,
    channelIsPremium,
    freeMode,
    viaTrialPlayback,
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
      if (exitPlayerRef.current) {
        void exitPlayerRef.current(`gate_${label}`);
      } else {
        try {
          navigation.goBack();
        } catch {}
      }
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
      await runPlaybackTeardown('emergency');
      allowNavigationRemoveRef.current = true;
      try {
        navigation.navigate('MainTabs', { screen: 'Home' });
      } catch {
        try {
          navigation.goBack();
        } catch {}
      }
    })();
  }, [emergencyMode, navigation, runPlaybackTeardown]);

  // Users Intelligence block: stop playback; "Nimeelewa" navigates Home via global gate.
  useEffect(() => {
    if (!deviceIntelligenceBlocked) {
      deviceIntelInterruptOnceRef.current = false;
      return;
    }
    if (deviceIntelInterruptOnceRef.current) return;
    deviceIntelInterruptOnceRef.current = true;
    console.log('[player][device-intel] interrupt_stop_playback');
    void runPlaybackTeardown('device_intelligence_blocked');
  }, [deviceIntelligenceBlocked, runPlaybackTeardown]);

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
      if (exitPlayerRef.current) {
        void exitPlayerRef.current('channel_disabled');
      } else {
        navigation.goBack();
      }
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
        String(p.playerType ?? '') !== String(next.playerType ?? '') ||
        String(p.authorizedPackageName ?? p.authorized_package_name ?? '') !==
          String(next.authorizedPackageName ?? next.authorized_package_name ?? '') ||
        String(p.streamDeliveryMode ?? '') !== String(next.streamDeliveryMode ?? '') ||
        String(p.proxyFallbackUrl ?? '') !== String(next.proxyFallbackUrl ?? '');
      return changed ? next : prev;
    });
  }, [rawChannels, freeMode, liveChannel, route?.params?.channel, navigation, channelDisabledNotified]);

  const attemptPlaybackRecovery = useCallback(
    (reasonText) => {
      const reason = String(reasonText ?? '');
      const tokenExpiry =
        /token_expired|401|403/i.test(reason) || reason.includes('hls_token_expired');
      if (
        tokenExpiry &&
        manifestRefreshAttemptRef.current < 2 &&
        refreshManifestFromCatalog('playback_token_expired')
      ) {
        manifestRefreshAttemptRef.current += 1;
        logSegmentDiagnostics('token_expiry_refresh', {
          reason,
          attempt: manifestRefreshAttemptRef.current,
        });
        return true;
      }
      if (
        isHlsManifest &&
        !hlsForceProxy &&
        canFallbackToProxyPlayback({
          deliveryMode: channel?.streamDeliveryMode,
          proxyFallbackUrl: channel?.proxyFallbackUrl,
          uri,
        })
      ) {
        logPlaybackDiagnostics('direct_failed_proxy_fallback', {
          reason: reasonText,
          channel: channel?.name,
          deliveryMode: channel?.streamDeliveryMode,
          fallback_reason: 'segment_or_manifest_error',
        });
        logSegmentDiagnostics('proxy_fallback', { reason });
        logPlayerInterrupt('proxy_fallback_remount', { reason });
        setHlsForceProxy(true);
        setPlaybackError('');
        setIsBuffering(true);
        setPlayerEpoch((e) => e + 1);
        return true;
      }
      if (currentUrlIndex < streams.length - 1) {
        logPlaybackDiagnostics('backup_stream_rotate', {
          reason: reasonText,
          from: currentUrlIndex,
          to: currentUrlIndex + 1,
        });
        logPlayerInterrupt('backup_stream_remount', {
          reason,
          from: currentUrlIndex,
          to: currentUrlIndex + 1,
        });
        setCurrentUrlIndex((i) => i + 1);
        setHlsForceProxy(false);
        setPlaybackError('');
        setIsBuffering(true);
        setPlayerEpoch((e) => e + 1);
        return true;
      }
      return false;
    },
    [
      isHlsManifest,
      hlsForceProxy,
      channel?.streamDeliveryMode,
      channel?.proxyFallbackUrl,
      channel?.name,
      uri,
      currentUrlIndex,
      streams.length,
      refreshManifestFromCatalog,
    ],
  );

  const applyPlaybackFailure = useCallback((reasonText) => {
    clearNativeBufferDebounceRef.current();
    if (nativeOverlayVisibleRef.current) {
      logPlayerBuffer('overlay_hide', 'playback_error');
      nativeOverlayVisibleRef.current = false;
    }
    setShowNativeBufferOverlay(false);
    setIsBuffering(false);
    setPlaybackError(playbackFailureMessage(reasonText));
    clearHideTimer();
    setControlsVisible(true);
    controlsOpacity.setValue(1);
  }, [controlsOpacity, clearHideTimer]);

  /** User-only: fresh mount without automatic timers or replay loops. */
  const manualReloadSameStream = useCallback(() => {
    logPlayerInterrupt('manual_reload_remount', {});
    setHlsForceProxy(false);
    setPlaybackError('');
    setIsBuffering(true);
    setPlayerEpoch((e) => e + 1);
  }, []);

  const tryNativeStallRecovery = useCallback(async () => {
    const stall = nativeStallRef.current;
    if (stall.recovering) return;
    const now = Date.now();
    if (now - stall.lastRecoveryWallMs < NATIVE_STALL_RECOVERY_COOLDOWN_MS) return;

    stall.recovering = true;
    stall.lastRecoveryWallMs = now;
    stall.recoveryAttempt += 1;
    const attempt = stall.recoveryAttempt;
    const ref = videoRef.current;

    logPlayerInterrupt('native_stall_recovery', { attempt });

    try {
      if (!ref) return;
      if (attempt === 1) {
        await ref.playAsync?.();
      } else if (attempt === 2) {
        const s = await ref.getStatusAsync?.();
        const pos = s?.positionMillis;
        if (typeof pos === 'number') {
          await ref.setPositionAsync?.(pos);
        }
        await ref.playAsync?.();
      } else if (attempt === 3 && nativeVideoSource) {
        await ref.loadAsync?.(nativeVideoSource, { shouldPlay: true });
        nativeLoadedUriRef.current = String(nativeVideoSource.uri ?? '');
      } else {
        stall.recoveryAttempt = 0;
        manualReloadSameStream();
        return;
      }
      stall.lastProgressWallMs = Date.now();
    } catch (e) {
      console.log('[player][stall]', 'recovery_failed', e?.message ?? e);
    } finally {
      stall.recovering = false;
    }
  }, [manualReloadSameStream, nativeVideoSource]);

  const watchNativePlaybackProgress = useCallback(
    (status) => {
      if (!useNativePlayer || playbackErrorRef.current) return;
      if (!status?.isLoaded || !nativePlaybackStartedRef.current) return;

      const now = Date.now();
      const pos = Number(status.positionMillis ?? 0);
      const playable = Number(status.playableDurationMillis ?? 0);
      const playing = Boolean(status.isPlaying);
      const buffering = Boolean(status.isBuffering);
      const stall = nativeStallRef.current;

      if (buffering) return;

      if (playing) {
        const advanced =
          pos > stall.lastPositionMs + 300 || playable > stall.lastPlayableMs + 300;
        if (advanced || stall.lastProgressWallMs === 0) {
          stall.lastPositionMs = pos;
          stall.lastPlayableMs = playable;
          stall.lastProgressWallMs = now;
          if (advanced) stall.recoveryAttempt = 0;
          return;
        }
        if (now - stall.lastProgressWallMs >= NATIVE_STALL_DETECT_MS) {
          void tryNativeStallRecovery();
        }
        return;
      }

      if (now - stall.lastProgressWallMs >= NATIVE_STALL_DETECT_MS) {
        void tryNativeStallRecovery();
      }
    },
    [useNativePlayer, tryNativeStallRecovery],
  );

  const handlePlaybackFailure = useCallback(
    (reasonText) => {
      if (attemptPlaybackRecovery(reasonText)) return;
      applyPlaybackFailure(reasonText);
    },
    [attemptPlaybackRecovery, applyPlaybackFailure],
  );

  const onError = (error) => {
    devLog('[player][debug] playback error:', {
      route: playbackRoute,
      declared_player_type: normalizedPlayerType,
      url: uri,
      current_index: currentUrlIndex,
      total_streams: streams.length,
      hls_force_proxy: hlsForceProxy,
      error,
    });
    const errMsg =
      error == null ? 'onError' : typeof error === 'string' ? error : JSON.stringify(error);
    handlePlaybackFailure(errMsg);
  };

  // ROTATION — portrait/StatusBar also reset synchronously in exitPlayer / teardown.
  useEffect(() => {
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE);
    StatusBar.setHidden(true);
    statusBarHiddenRef.current = true;

    return () => {
      ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT);
      StatusBar.setHidden(false);
    };
  }, []);

  useEffect(() => {
    playerLifecycleRef.current.mounted = true;
    return () => {
      playerLifecycleRef.current.mounted = false;
      if (!teardownDoneRef.current) {
        void teardownPlayback({
          reason: 'unmount_fallback',
          videoRef,
          hlsWebRef,
          embedWebRef,
          chromeWebRef,
        });
      }
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

  useFocusEffect(
    useCallback(() => {
      playerLifecycleRef.current.focused = true;
      return () => {
        playerLifecycleRef.current.focused = false;
        if (!allowNavigationRemoveRef.current && !teardownDoneRef.current) {
          void runPlaybackTeardown('focus_blur', { resetChrome: true });
        }
      };
    }, [runPlaybackTeardown]),
  );

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

  const clearNativeBufferDebounce = useCallback(() => {
    if (nativeBufferDebounceRef.current) {
      clearTimeout(nativeBufferDebounceRef.current);
      nativeBufferDebounceRef.current = null;
    }
  }, []);

  useEffect(() => {
    clearNativeBufferDebounceRef.current = clearNativeBufferDebounce;
  }, [clearNativeBufferDebounce]);

  const hideNativeBufferOverlay = useCallback((reason) => {
    clearNativeBufferDebounce();
    if (nativeOverlayVisibleRef.current) {
      logPlayerBuffer('overlay_hide', reason);
      nativeOverlayVisibleRef.current = false;
      setShowNativeBufferOverlay(false);
    }
  }, [clearNativeBufferDebounce]);

  const resetNativeBufferUiForLoad = useCallback(
    (reason) => {
      clearNativeBufferDebounce();
      nativePlaybackStartedRef.current = false;
      nativeOverlayVisibleRef.current = true;
      setShowNativeBufferOverlay(true);
      logPlayerBuffer('overlay_show', reason);
    },
    [clearNativeBufferDebounce],
  );

  const applyNativeBufferStatus = useCallback(
    ({ playing, nativeBuffering }) => {
      const stalled = !playing && nativeBuffering;

      if (playing) {
        if (!nativePlaybackStartedRef.current) {
          nativePlaybackStartedRef.current = true;
          logPlayerBuffer('buffer_end', 'first_play');
        } else if (nativeBufferDebounceRef.current || nativeOverlayVisibleRef.current) {
          logPlayerBuffer('buffer_end', 'resumed');
        }
        hideNativeBufferOverlay('resumed');
        return;
      }

      if (!nativePlaybackStartedRef.current) {
        if (stalled && !nativeOverlayVisibleRef.current) {
          nativeOverlayVisibleRef.current = true;
          setShowNativeBufferOverlay(true);
          logPlayerBuffer('overlay_show', 'initial_load');
        }
        return;
      }

      if (!stalled) return;

      if (nativeOverlayVisibleRef.current || nativeBufferDebounceRef.current) return;

      logPlayerBuffer('buffer_start', 'rebuffer');
      nativeBufferDebounceRef.current = setTimeout(() => {
        nativeBufferDebounceRef.current = null;
        nativeOverlayVisibleRef.current = true;
        setShowNativeBufferOverlay(true);
        logPlayerBuffer('overlay_show', 'debounced_rebuffer');
      }, NATIVE_BUFFER_OVERLAY_DEBOUNCE_MS);
    },
    [hideNativeBufferOverlay],
  );

  useEffect(() => {
    if (!useNativePlayer) return undefined;
    resetNativeBufferUiForLoad('player_mount');
    return () => clearNativeBufferDebounce();
  }, [playerEpoch, useNativePlayer, resetNativeBufferUiForLoad, clearNativeBufferDebounce]);

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

  const exitPlayer = useCallback(
    async (source, pendingAction) => {
      if (exitInFlightRef.current) {
        logPlayerTeardown('exit_skip_inflight', source);
        return;
      }
      exitInFlightRef.current = true;
      logPlayerTeardown('exit_start', source);
      clearHideTimer();
      setPickerKind(null);
      pickerKindRef.current = null;
      await runPlaybackTeardown(`exit:${source}`);
      allowNavigationRemoveRef.current = true;
      try {
        if (pendingAction) {
          navigation.dispatch(pendingAction);
        } else {
          navigation.goBack();
        }
      } catch (e) {
        logPlayerTeardown('exit_nav_error', e?.message ?? e);
      }
    },
    [clearHideTimer, navigation, runPlaybackTeardown],
  );

  useEffect(() => {
    exitPlayerRef.current = exitPlayer;
  }, [exitPlayer]);

  useEffect(() => {
    const sub = navigation.addListener('beforeRemove', (e) => {
      if (allowNavigationRemoveRef.current) return;
      e.preventDefault();
      void exitPlayer('beforeRemove', e.data.action);
    });
    return sub;
  }, [navigation, exitPlayer]);

  useEffect(() => {
    const backAction = () => {
      void exitPlayer('hardware_back');
      return true;
    };
    const backHandler = BackHandler.addEventListener('hardwareBackPress', backAction);
    return () => backHandler.remove();
  }, [exitPlayer]);

  const TEN_MIN_MS = 10 * 60 * 1000;
  const ONE_MIN_MS = 60 * 1000;

  const performHardExpiryShutdown = useCallback(async () => {
    if (hardWallClockExpiryDoneRef.current) return;
    hardWallClockExpiryDoneRef.current = true;
    logPlayerTeardown('expiry_wallclock_start');
    clearHideTimer();
    setExpiryOverlay({ visible: false, minuteCeil: 0, secondCeil: 0, critical: false });
    setPlaybackSuppressed(true);
    setPickerKind(null);
    pickerKindRef.current = null;
    setIsBuffering(false);
    setIsPlaying(false);

    const shouldNavigate =
      playerLifecycleRef.current.mounted && playerLifecycleRef.current.focused;
    await runPlaybackTeardown('expiry_wallclock');

    if (!shouldNavigate) {
      logPlayerTeardown('expiry_wallclock_skip_nav', 'inactive');
      return;
    }

    try {
      await reverifySubscription('player-expiry-wallclock');
    } catch (e) {
      console.log('[player][expiry] reverify_after_shutdown', e?.message ?? e);
    }

    allowNavigationRemoveRef.current = true;
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
  }, [clearHideTimer, navigation, reverifySubscription, runPlaybackTeardown]);

  const stopTrialPlayback = useCallback(async () => {
    clearHideTimer();
    setPickerKind(null);
    pickerKindRef.current = null;
    setPlaybackSuppressed(true);
    setIsPlaying(false);
    setIsBuffering(false);
    await runPlaybackTeardown('trial_expired', { resetChrome: true });
  }, [clearHideTimer, runPlaybackTeardown]);

  const trialWatch = useTrialWatchSession({
    enabled: viaTrialPlayback && accessAllowed && !playbackSuppressed,
    playbackKey: channelPlaybackKey,
    isSubscribed,
    freeMode,
    trialWatchSettings,
    initialBootstrap: trialBootstrapForSession,
    isPlaybackActive:
      isPlaying && accessAllowed && Boolean(uri) && !playbackError && !playbackSuppressed,
    stopPlayback: stopTrialPlayback,
    onExpired: () => requestPaymentModal(),
    navigation,
    lifecycleRef: playerLifecycleRef,
  });

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
      void (async () => {
        const r = await reverifySubscription('player-expiry-sync');
        if (r?.active !== false) return;
        if (!premiumGateSessionRef.current.granted) return;
        premiumGateSessionRef.current.granted = false;
        setAccessChecked(true);
        setAccessAllowed(false);
        if (exitPlayerRef.current) {
          void exitPlayerRef.current('gate_expiry_sync');
        }
      })();
    }, 120 * 1000);
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
    const prevPlaying = Boolean(lastStatusRef.current.isPlaying);
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
    const playing = Boolean(status.isPlaying);
    const nativeBuffering = Boolean(status.isBuffering);
    applyNativeBufferStatus({ playing, nativeBuffering });
    setIsPlaying(playing);
    setPlaybackError('');
    if (playing && !prevPlaying) {
      markPlaybackStartedForHide();
      nativeStallRef.current.lastProgressWallMs = Date.now();
    }
    watchNativePlaybackProgress(status);
  };

  const onEmbedLoadStart = () => {
    setIsBuffering(true);
  };

  const onEmbedLoadEnd = () => {
    setPlaybackError('');
    if (useEmbedLikeWebView) {
      activeEmbedWebRef.current?.injectJavaScript(buildEmbedCmdScript({ type: 'request-tracks' }));
      // Keep isBuffering true until embed_playback_started (provider video actually playing).
      markPlaybackStartedForHide();
      return;
    }
    setIsBuffering(false);
    if (useHlsWebView) {
      hlsWebRef.current?.injectJavaScript(buildHlsCmdScript({ type: 'request-tracks' }));
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
    handlePlaybackFailure(`webview-error:${String(desc)}`);
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
    if (kind === 'hls_token_expired') {
      logSegmentDiagnostics('hls_token_expired', payload);
      handlePlaybackFailure(`hls_token_expired:${payload?.code ?? ''}`);
      return;
    }
    if (kind === 'segment_source') {
      logSegmentDiagnostics('segment_source', payload);
      return;
    }
    if (
      kind === 'hls_script_error' ||
      kind === 'html_fetch_error' ||
      kind === 'window_error' ||
      kind === 'window_unhandled_rejection'
    ) {
      devLog('[player][debug] hls.js webview error diagnostic:', kind, payload);
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
        handlePlaybackFailure(`hls-recovery:${payload?.mode || 'failed'}`);
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
      handlePlaybackFailure(`video-error:${payload?.code ?? ''}`);
      return;
    }
    if (kind === 'hls_fatal_giveup') {
      console.log('[player][debug] hls.js: fatal giveup', payload);
      handlePlaybackFailure(`hls.js-fatal:${payload?.type || ''}:${payload?.details || ''}`);
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
      activeEmbedWebRef.current?.injectJavaScript(buildEmbedSuppressNativeUiJs());
      return;
    }
    if (kind === 'embed_playback_started') {
      setIsBuffering(false);
      setPlaybackError('');
      markPlaybackStartedForHide();
      return;
    }
    if (kind === 'embed_playback_waiting') {
      // Page loaded but autoplay has not started — hide spinner so user can tap play.
      setIsBuffering(false);
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
    handlePlaybackFailure(`hls-shell-http:${status}`);
  };

  const onHlsWebError = (ev) => {
    const desc = ev?.nativeEvent?.description ?? ev?.nativeEvent?.message ?? 'unknown';
    console.log('[player][debug] hls.js webview shell error:', desc);
    handlePlaybackFailure(`hls-shell-error:${String(desc)}`);
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
    } else if (useEmbedLikeWebView) {
      activeEmbedWebRef.current?.injectJavaScript(`(function(){try{var v=document.querySelector('video');if(v){if(v.paused)v.play().catch(function(){});else v.pause();}}catch(e){}})();true;`);
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
    if (useEmbedLikeWebView && embedControls && embedControls.qualities?.length) {
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
    if (useNativePlayer && nativeManifestVariants.length) {
      const selectedId = nativeSelectedVariantId;
      const options = [
        { id: -1, label: 'Auto', selected: selectedId === -1 },
        ...nativeManifestVariants.map((v) => ({
          id: v.id,
          label: v.label,
          selected: selectedId === v.id,
        })),
      ];
      const current = options.find((o) => o.selected) ?? options[0];
      return { available: true, options, currentLabel: current?.label ?? 'Auto' };
    }
    return { available: false, options: [], currentLabel: useNativePlayer ? 'Auto' : '—' };
  }, [
    useHlsWebView,
    useEmbedLikeWebView,
    useNativePlayer,
    hlsLevels,
    hlsCurrentLevel,
    hlsAutoLevel,
    embedControls,
    nativeManifestVariants,
    nativeSelectedVariantId,
  ]);

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
    if (useEmbedLikeWebView && embedControls && embedControls.audioTracks?.length) {
      const selectedId = typeof embedControls.currentAudioTrack === 'number' ? embedControls.currentAudioTrack : -1;
      const options = embedControls.audioTracks.map((t) => ({
        id: t.id,
        label: t.label || `Audio ${t.id}`,
        selected: selectedId === t.id,
      }));
      const current = options.find((o) => o.selected) ?? options[0];
      return { available: true, options, currentLabel: current?.label ?? '—' };
    }
    if (useNativePlayer && nativeManifestAudioTracks.length) {
      const selectedId =
        nativeSelectedAudioId >= 0
          ? nativeSelectedAudioId
          : nativeManifestAudioTracks.find((t) => t.default)?.id ?? 0;
      const options = nativeManifestAudioTracks.map((t) => ({
        id: t.id,
        label: t.label,
        selected: selectedId === t.id,
      }));
      const current = options.find((o) => o.selected) ?? options[0];
      return { available: true, options, currentLabel: current?.label ?? '—' };
    }
    return { available: false, options: [], currentLabel: '—' };
  }, [
    useHlsWebView,
    useEmbedLikeWebView,
    useNativePlayer,
    hlsAudioTracks,
    hlsCurrentAudioTrack,
    embedControls,
    nativeManifestAudioTracks,
    nativeSelectedAudioId,
  ]);

  const applyNativeHlsPlaybackUri = useCallback(async (playbackUri) => {
    const u = String(playbackUri ?? '').trim();
    if (!u || !videoRef.current?.loadAsync) return false;
    const source = {
      uri: u,
      overrideFileExtensionAndroid: 'm3u8',
    };
    try {
      logPlayerInterrupt('native_track_selection_load', { uriPrefix: u.slice(0, 96) });
      await videoRef.current.loadAsync(source, { shouldPlay: true });
      nativeLoadedUriRef.current = u;
      return true;
    } catch (e) {
      console.log('[player][native-hls-tracks] load failed:', e?.message ?? e);
      return false;
    }
  }, []);

  const openQualityPicker = useCallback(() => {
    revealControlsUser();
    if ((qualityModel.options?.length ?? 0) === 0) {
      if (useNativePlayer) {
        Alert.alert('Quality', 'Channel hii haina quality za kuchagua.');
      }
      return;
    }
    pickerKindRef.current = 'quality';
    clearHideTimer();
    setPickerKind('quality');
  }, [qualityModel.options, useNativePlayer, revealControlsUser, clearHideTimer]);

  const openLanguagePicker = useCallback(() => {
    revealControlsUser();
    if ((languageModel.options?.length ?? 0) === 0) {
      if (useNativePlayer) {
        Alert.alert('Lugha', 'Channel hii haina sauti za kubadili.');
      }
      return;
    }
    pickerKindRef.current = 'language';
    clearHideTimer();
    setPickerKind('language');
  }, [languageModel.options, useNativePlayer, revealControlsUser, clearHideTimer]);

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
        } else if (useEmbedLikeWebView) {
          activeEmbedWebRef.current?.injectJavaScript(buildEmbedCmdScript({ type: 'set-level', level: option.id }));
          setEmbedControls((prev) => (prev ? { ...prev, currentQuality: option.id } : prev));
        } else if (useNativePlayer) {
          setNativeSelectedVariantId(option.id);
          if (option.id === -1) {
            void applyNativeHlsPlaybackUri(hlsManifestUrl || uri);
          } else {
            const variant = nativeManifestVariants.find((v) => v.id === option.id);
            if (variant?.uri) {
              void applyNativeHlsPlaybackUri(variant.uri);
            }
          }
        }
      } else if (pickerKind === 'language') {
        if (useHlsWebView) {
          hlsWebRef.current?.injectJavaScript(buildHlsCmdScript({ type: 'set-audio-track', id: option.id }));
          setHlsCurrentAudioTrack(option.id);
        } else if (useEmbedLikeWebView) {
          activeEmbedWebRef.current?.injectJavaScript(buildEmbedCmdScript({ type: 'set-audio-track', id: option.id }));
          setEmbedControls((prev) => (prev ? { ...prev, currentAudioTrack: option.id } : prev));
        } else if (useNativePlayer) {
          setNativeSelectedAudioId(option.id);
          const track = nativeManifestAudioTracks.find((t) => t.id === option.id);
          if (track?.uri) {
            void (async () => {
              const parsed = await fetchNativeHlsManifestTracksForPlayback(track.uri, track.uri, headers);
              if (parsed.isMaster && parsed.variants.length) {
                const best = parsed.variants[parsed.variants.length - 1];
                await applyNativeHlsPlaybackUri(best.uri);
              } else if (parsed.isMaster) {
                await applyNativeHlsPlaybackUri(track.uri);
              } else {
                devLog('[native-hls-tracks] audio_group_switch_unsupported', {
                  label: track.label,
                });
              }
            })();
          } else {
            devLog('[native-hls-tracks] audio_group_switch_unsupported', {
              label: track?.label ?? option.id,
            });
          }
        }
      }
      setPickerKind(null);
      bumpAutoHideTimer();
    },
    [
      pickerKind,
      useHlsWebView,
      useEmbedLikeWebView,
      useNativePlayer,
      bumpAutoHideTimer,
      applyNativeHlsPlaybackUri,
      hlsManifestUrl,
      uri,
      nativeManifestVariants,
      nativeManifestAudioTracks,
      headers,
    ],
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
        icon: resizeMode === ResizeMode.COVER ? 'scan' : 'expand',
        label: 'Fill',
        onPress: () =>
          setResizeMode((m) => {
            const next = m === ResizeMode.CONTAIN ? ResizeMode.COVER : ResizeMode.CONTAIN;
            if (useNativePlayer) {
              requestAnimationFrame(() => applyNativeVideoResizeMode(videoRef, next));
            } else if (useHlsWebView) {
              const fit = next === ResizeMode.COVER ? 'cover' : 'contain';
              hlsWebRef.current?.injectJavaScript(
                `(function(){try{var v=document.getElementById('v');if(v)v.style.objectFit=${JSON.stringify(fit)};}catch(e){}})();true;`,
              );
            } else if (useEmbedLikeWebView) {
              const fit = next === ResizeMode.COVER ? 'cover' : 'contain';
              activeEmbedWebRef.current?.injectJavaScript(
                `(function(){try{var v=document.querySelector('video');if(v)v.style.objectFit=${JSON.stringify(fit)};}catch(e){}})();true;`,
              );
            }
            return next;
          }),
      },
      {
        key: 'fullscreen',
        icon: 'resize',
        label: 'Full Screen',
        onPress: () => {
          statusBarHiddenRef.current = !statusBarHiddenRef.current;
          StatusBar.setHidden(statusBarHiddenRef.current);
          if (statusBarHiddenRef.current) {
            void ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE);
          }
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
      useEmbedLikeWebView,
      useNativePlayer,
      onPlayPause,
      openLanguagePicker,
      openQualityPicker,
    ],
  );

  if (playerShellHidden) {
    return <View style={styles.rootHidden} pointerEvents="none" collapsable={false} />;
  }

  if (!playbackSecurity.allowed) {
    return (
      <View style={[styles.root, styles.gateScreen]}>
        <SecurityPlaybackBlock onBack={() => void exitPlayer('security_back')} />
      </View>
    );
  }

  if (
    channelIsPremium &&
    !freeMode &&
    !viaTrialPlayback &&
    (!accessChecked || !accessAllowed)
  ) {
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

      {viaTrialPlayback && trialWatch.visible && trialWatch.phase ? (
        <TrialWatchOverlay
          phase={trialWatch.phase}
          displaySeconds={trialWatch.displaySeconds}
          topInset={insets.top + 52}
        />
      ) : null}

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
          - player.php / embed pages → embed-webview (default) or chrome-webview when playerType=chrome
      */}
      <View style={styles.playerStage}>
        {playbackSurfacesMounted ? (
          <View pointerEvents="none" style={styles.videoUnderlay} />
        ) : null}

        {playbackSurfacesMounted && useNativePlayer && nativeVideoSource ? (
          <Video
            key={`native-${playerEpoch}`}
            ref={videoRef}
            source={nativeVideoSource}
            style={styles.video}
            resizeMode={normalizeVideoResizeMode(resizeMode)}
            shouldPlay
            progressUpdateIntervalMillis={1000}
            onPlaybackStatusUpdate={onStatusUpdate}
            onError={onError}
            onReadyForDisplay={onNativeReadyForDisplay}
            useNativeControls={false}
            pointerEvents="none"
          />
        ) : playbackSurfacesMounted && useHlsWebView ? (
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
            pointerEvents={controlsVisible && !pickerKind ? 'none' : 'auto'}
          />
        ) : playbackSurfacesMounted && useChromeWebView ? (
          <WebView
            key={`chrome-${playerEpoch}`}
            ref={chromeWebRef}
            style={[styles.video, styles.embedWebView]}
            source={chromeWebViewSource}
            userAgent={chromeUserAgent}
            injectedJavaScriptBeforeContentLoaded={embedPageBootstrapJs}
            injectedJavaScript={embedBridgeJs}
            onLoadStart={onEmbedLoadStart}
            onLoadEnd={onEmbedLoadEnd}
            onMessage={onEmbedMessage}
            onError={onEmbedError}
            onHttpError={onEmbedHttpError}
            pointerEvents={controlsVisible && !pickerKind ? 'none' : 'auto'}
            {...CHROME_WEBVIEW_PROPS}
          />
        ) : playbackSurfacesMounted && useEmbedWebView ? (
          <WebView
            key={`embed-${playerEpoch}`}
            ref={embedWebRef}
            style={[styles.video, styles.embedWebView]}
            source={embedWebViewSource}
            allowsInlineMediaPlayback
            mediaPlaybackRequiresUserAction={false}
            javaScriptEnabled
            domStorageEnabled
            originWhitelist={['*']}
            mixedContentMode="always"
            injectedJavaScriptBeforeContentLoaded={embedPageBootstrapJs}
            injectedJavaScript={embedBridgeJs}
            onLoadStart={onEmbedLoadStart}
            onLoadEnd={onEmbedLoadEnd}
            onMessage={onEmbedMessage}
            onError={onEmbedError}
            onHttpError={onEmbedHttpError}
            pointerEvents={controlsVisible && !pickerKind ? 'none' : 'auto'}
          />
        ) : null}

        {!pickerKind ? (
          <Pressable
            style={styles.videoTapTarget}
            onPress={revealControlsUser}
            pointerEvents={
              useNativePlayer
                ? controlsVisible
                  ? 'none'
                  : 'auto'
                : controlsVisible
                  ? 'box-none'
                  : 'auto'
            }
            accessibilityRole="button"
            accessibilityLabel="Show player controls"
          />
        ) : null}

        {/* CONTROLS */}
        {controlsVisible && (
          <Animated.View style={[styles.controls, { opacity: controlsOpacity }]} pointerEvents="box-none" collapsable={false}>

            {/* TOP */}
            <View style={[styles.topBar, { paddingTop: Math.max(8, insets.top) }]} pointerEvents="box-none">
              <Pressable onPress={() => void exitPlayer('ui_back')} style={styles.topBack}>
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
            <View style={styles.center} pointerEvents="box-none">
              {(playbackError || (useNativePlayer ? showNativeBufferOverlay : isBuffering)) ? (
                <View style={styles.bufferingWrap} pointerEvents="auto">
                  {(useNativePlayer ? showNativeBufferOverlay : isBuffering) && !playbackError ? (
                    <ActivityIndicator size="large" color="#FFFFFF" />
                  ) : null}
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

            <View
              style={[
                styles.bottom,
                { paddingBottom: Math.max(12, insets.bottom + 4) },
                useNativePlayer ? styles.bottomNativePicker : null,
              ]}
              pointerEvents="box-none"
            >
              {bottomActions.map((action) => (
                <Pressable
                  key={action.key}
                  style={styles.actionBtn}
                  pointerEvents="auto"
                  onPress={(e) => {
                    e?.stopPropagation?.();
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

        {pickerKind && activePickerModel?.options?.length ? (
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
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  rootHidden: { flex: 1, backgroundColor: 'transparent' },
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

  playerStage: {
    flex: 1,
  },
  video: {
    ...StyleSheet.absoluteFillObject,
  },
  embedWebView: {
    backgroundColor: 'transparent',
  },
  videoTapTarget: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 5,
    elevation: 5,
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
    zIndex: 12,
    elevation: 12,
  },
  bottomNativePicker: {
    zIndex: 16,
    elevation: 16,
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
    zIndex: 13,
    elevation: 13,
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