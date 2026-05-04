import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  BackHandler,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import EmergencyModal from '../components/EmergencyModal';
import MaintenanceScreen from '../components/MaintenanceScreen';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { Audio } from 'expo-av';
import * as ScreenOrientation from 'expo-screen-orientation';
import { StatusBar } from 'expo-status-bar';
import { VideoView, useVideoPlayer } from 'expo-video';
import { WebView } from 'react-native-webview';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useOsmaniApp } from '../context/OsmaniAppContext';
import { buildStreamRequestHeaders, normalizePlayerType, resolveStream } from '../lib/channelStream';

const COLORS = {
  white: '#FFFFFF',
  overlay: 'rgba(0,0,0,0.72)',
};

function legacyChannelFromRoute(params) {
  const uri = typeof params?.streamUri === 'string' ? params.streamUri.trim() : '';
  return {
    name: params?.channelTitle ?? 'Channel',
    url: uri,
    backupStream1: '',
    backupStream2: '',
    origin: '',
    referer: '',
    userAgent: '',
    playerType: 'exo',
    accessType: 'free',
  };
}

function BlockedPlayback({ message, onExit, topPad, leftPad, rightPad }) {
  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <View
        style={[
          styles.topBar,
          {
            paddingTop: topPad,
            paddingLeft: 12 + leftPad,
            paddingRight: 12 + rightPad,
          },
        ]}
      >
        <Pressable onPress={onExit} hitSlop={14} style={styles.backHit}>
          <Ionicons name="chevron-back" size={28} color={COLORS.white} />
        </Pressable>
      </View>
      <View style={styles.blockedBody}>
        <Text style={styles.blockedTitle}>{message}</Text>
      </View>
    </View>
  );
}

function VlcPlaceholder({ title, onExit, topPad, leftPad, rightPad }) {
  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <View
        style={[
          styles.topBar,
          {
            paddingTop: topPad,
            paddingLeft: 12 + leftPad,
            paddingRight: 12 + rightPad,
          },
        ]}
      >
        <Pressable onPress={onExit} hitSlop={14} style={styles.backHit}>
          <Ionicons name="chevron-back" size={28} color={COLORS.white} />
        </Pressable>
        <Text style={styles.topTitle} numberOfLines={1}>
          {title}
        </Text>
      </View>
      <View style={styles.blockedBody}>
        <Text style={styles.blockedTitle}>VLC bado haijunganishwa</Text>
        <Text style={styles.blockedSub}>Chagua Exo au WebView kwenye Admin.</Text>
      </View>
    </View>
  );
}

function WebPlayer({ uri, headers, title, onExit, topPad, leftPad, rightPad }) {
  const [webLoading, setWebLoading] = useState(true);

  useEffect(() => {
    setWebLoading(true);
  }, [uri]);

  useEffect(() => {
    if (headers && Platform.OS === 'ios') {
      console.warn(
        '[OsmaniTV] WebView on iOS may not apply custom Referer/Origin/User-Agent the same as native players.',
      );
    }
  }, [headers]);

  const source = useMemo(() => {
    if (headers && Object.keys(headers).length) return { uri, headers };
    return { uri };
  }, [uri, headers]);

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <WebView
        source={source}
        style={styles.webFill}
        allowsFullscreenVideo
        mediaPlaybackRequiresUserAction={false}
        originWhitelist={['*']}
        javaScriptEnabled
        domStorageEnabled
        onLoadStart={() => setWebLoading(true)}
        onLoadEnd={() => setWebLoading(false)}
        onError={() => setWebLoading(false)}
      />
      {webLoading ? (
        <View style={styles.webLoadingOverlay} pointerEvents="none">
          <ActivityIndicator size="large" color={COLORS.white} />
        </View>
      ) : null}
      <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
        <Pressable
          onPress={onExit}
          hitSlop={14}
          style={[
            styles.backFloating,
            {
              top: topPad + 6,
              left: 12 + leftPad,
            },
          ]}
        >
          <Ionicons name="chevron-back" size={28} color={COLORS.white} />
        </Pressable>
        <Text
          style={[
            styles.titleFloating,
            {
              top: topPad + 10,
              left: 52 + leftPad,
              right: 16 + rightPad,
            },
          ]}
          numberOfLines={1}
          pointerEvents="none"
        >
          {title}
        </Text>
      </View>
    </View>
  );
}

function NativeVideoPlayer({ uri, headers, title, onExit, topPad, leftPad, rightPad }) {
  const [playerStatus, setPlayerStatus] = useState('loading');
  const [hasRenderedFrame, setHasRenderedFrame] = useState(false);

  useEffect(() => {
    if (!headers) return;
    if (Platform.OS === 'web') {
      console.warn('[OsmaniTV] expo-video stream headers are not reliable on web; use native builds for origin-locked streams.');
    }
  }, [headers]);

  const source = useMemo(() => {
    if (!uri) return null;
    return headers && Object.keys(headers).length ? { uri, headers } : uri;
  }, [uri, headers]);

  const player = useVideoPlayer(source, (p) => {
    p.loop = false;
    if (source) {
      p.play();
    }
  });

  useEffect(() => {
    setHasRenderedFrame(false);
    setPlayerStatus('loading');
  }, [uri, source]);

  useEffect(() => {
    if (!player) return undefined;
    setPlayerStatus(player.status);
    const sub = player.addListener('statusChange', ({ status }) => {
      setPlayerStatus(status);
    });
    return () => sub.remove();
  }, [player]);

  const showLoadingOverlay =
    !hasRenderedFrame && playerStatus !== 'error';

  if (!uri) {
    return (
      <BlockedPlayback
        message="Hakuna mfululizo."
        onExit={onExit}
        topPad={topPad}
        leftPad={leftPad}
        rightPad={rightPad}
      />
    );
  }

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <VideoView
        player={player}
        style={styles.videoFill}
        nativeControls
        contentFit="contain"
        fullscreenOptions={{ enable: true }}
        allowsPictureInPicture
        onFirstFrameRender={() => setHasRenderedFrame(true)}
      />
      {showLoadingOverlay ? (
        <View style={styles.nativeLoadingOverlay} pointerEvents="none">
          <ActivityIndicator size="large" color={COLORS.white} />
        </View>
      ) : null}
      <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
        <Pressable
          onPress={onExit}
          hitSlop={14}
          style={[
            styles.backFloating,
            {
              top: topPad + 6,
              left: 12 + leftPad,
            },
          ]}
        >
          <Ionicons name="chevron-back" size={28} color={COLORS.white} />
        </Pressable>
        <Text
          style={[
            styles.titleFloating,
            {
              top: topPad + 10,
              left: 52 + leftPad,
              right: 16 + rightPad,
            },
          ]}
          numberOfLines={1}
          pointerEvents="none"
        >
          {title}
        </Text>
      </View>
    </View>
  );
}

export default function ChannelPlayerScreen() {
  const navigation = useNavigation();
  const route = useRoute();
  const insets = useSafeAreaInsets();
  const { isSubscribed, freeMode, emergencyMode, maintenanceMode } = useOsmaniApp();

  const channel = useMemo(
    () => route.params?.channel ?? legacyChannelFromRoute(route.params ?? {}),
    [route.params],
  );

  const title = typeof channel.name === 'string' && channel.name.trim() ? channel.name.trim() : 'Channel';
  const streamUrl = resolveStream(channel);
  const headers = buildStreamRequestHeaders(channel);
  const playerKind = normalizePlayerType(channel.playerType);
  const accessType =
    channel.accessType === 'premium' || channel.accessPremium === true ? 'premium' : 'free';

  const topPad = Math.max(insets.top, 8);
  const leftPad = Math.max(insets.left, 0);
  const rightPad = Math.max(insets.right, 0);

  const exitPlayer = useCallback(async () => {
    try {
      if (Platform.OS !== 'web') {
        await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
      }
    } catch {
      /* ignore */
    }
    navigation.goBack();
  }, [navigation]);

  const playbackBlocked = maintenanceMode || emergencyMode;

  useFocusEffect(
    useCallback(() => {
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        exitPlayer();
        return true;
      });

      const lockLandscape = async () => {
        if (playbackBlocked) return;
        try {
          await Audio.setAudioModeAsync({
            playsInSilentModeIOS: true,
            staysActiveInBackground: false,
          });
        } catch {
          /* ignore */
        }
        try {
          if (Platform.OS !== 'web') {
            await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE);
          }
        } catch {
          /* ignore */
        }
      };
      lockLandscape();

      return () => {
        sub.remove();
        if (playbackBlocked) return;
        (async () => {
          try {
            if (Platform.OS !== 'web') {
              await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
            }
          } catch {
            /* ignore */
          }
        })();
      };
    }, [exitPlayer, playbackBlocked]),
  );

  if (maintenanceMode) {
    return <MaintenanceScreen showBack onBack={exitPlayer} />;
  }

  if (emergencyMode) {
    return (
      <View style={styles.emergencyHost}>
        <EmergencyModal visible onSawa={exitPlayer} />
      </View>
    );
  }

  const premiumLocked = !freeMode && accessType === 'premium' && !isSubscribed;
  if (premiumLocked) {
    return (
      <BlockedPlayback
        message="LIPIA TENA"
        onExit={exitPlayer}
        topPad={topPad}
        leftPad={leftPad}
        rightPad={rightPad}
      />
    );
  }

  if (!streamUrl) {
    return (
      <BlockedPlayback
        message="Hakuna mfululizo."
        onExit={exitPlayer}
        topPad={topPad}
        leftPad={leftPad}
        rightPad={rightPad}
      />
    );
  }

  if (playerKind === 'webview') {
    return (
      <WebPlayer
        uri={streamUrl}
        headers={headers}
        title={title}
        onExit={exitPlayer}
        topPad={topPad}
        leftPad={leftPad}
        rightPad={rightPad}
      />
    );
  }

  if (playerKind === 'vlc') {
    return (
      <VlcPlaceholder
        title={title}
        onExit={exitPlayer}
        topPad={topPad}
        leftPad={leftPad}
        rightPad={rightPad}
      />
    );
  }

  return (
    <NativeVideoPlayer
      uri={streamUrl}
      headers={headers}
      title={title}
      onExit={exitPlayer}
      topPad={topPad}
      leftPad={leftPad}
      rightPad={rightPad}
    />
  );
}

const styles = StyleSheet.create({
  emergencyHost: {
    flex: 1,
    backgroundColor: '#000000',
  },
  root: {
    flex: 1,
    backgroundColor: '#000000',
  },
  videoFill: {
    flex: 1,
    width: '100%',
    height: '100%',
    backgroundColor: '#000000',
  },
  webFill: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#000000',
  },
  webLoadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#000000',
  },
  nativeLoadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  backFloating: {
    position: 'absolute',
    zIndex: 10,
    padding: 8,
    borderRadius: 22,
    backgroundColor: COLORS.overlay,
  },
  titleFloating: {
    position: 'absolute',
    zIndex: 9,
    color: COLORS.white,
    fontSize: 16,
    fontWeight: '700',
    textShadowColor: 'rgba(0,0,0,0.85)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.overlay,
    minHeight: 48,
    paddingBottom: 10,
  },
  backHit: {
    marginRight: 8,
  },
  topTitle: {
    flex: 1,
    color: COLORS.white,
    fontSize: 17,
    fontWeight: '700',
  },
  blockedBody: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  blockedTitle: {
    color: COLORS.white,
    fontSize: 20,
    fontWeight: '800',
    textAlign: 'center',
  },
  blockedSub: {
    marginTop: 10,
    color: 'rgba(255,255,255,0.75)',
    fontSize: 14,
    textAlign: 'center',
  },
});
