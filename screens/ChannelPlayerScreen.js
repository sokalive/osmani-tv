import React, { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
  BackHandler,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { Audio, Video, ResizeMode } from 'expo-av';
import * as ScreenOrientation from 'expo-screen-orientation';
import { Ionicons } from '@expo/vector-icons';
import Slider from '@react-native-community/slider';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';

const COLORS = {
  yellow: '#FFCB3D',
  white: '#FFFFFF',
  overlay: 'rgba(0,0,0,0.42)',
  bottomBarBg: 'rgba(0,0,0,0.72)',
};

const QUALITIES = ['Auto', '1080p', '720p', '480p'];
const LANGUAGES = ['Kiswahili', 'English', 'Original'];

const FALLBACK_STREAM_URI =
  'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4';

function BottomControlButton({ icon, label, sublabel, onPress, compact }) {
  return (
    <Pressable
      style={({ pressed }) => [styles.bottomBtn, pressed && styles.bottomBtnPressed, compact && styles.bottomBtnCompact]}
      onPress={onPress}
      hitSlop={8}
    >
      <Ionicons name={icon} size={compact ? 20 : 22} color={COLORS.white} />
      <Text style={[styles.bottomBtnLabel, compact && styles.bottomBtnLabelCompact]} numberOfLines={2}>
        {label}
      </Text>
      {sublabel ? (
        <Text style={[styles.bottomBtnSublabel, compact && styles.bottomBtnSublabelCompact]} numberOfLines={1}>
          {sublabel}
        </Text>
      ) : null}
    </Pressable>
  );
}

export default function ChannelPlayerScreen() {
  const navigation = useNavigation();
  const route = useRoute();
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  const videoRef = useRef(null);
  const compact = windowWidth < 380;

  const channelTitle = route.params?.channelTitle ?? 'Channel';
  const streamUri = route.params?.streamUri ?? FALLBACK_STREAM_URI;

  const [status, setStatus] = useState({});
  const [paused, setPaused] = useState(false);
  const [qualityMenuVisible, setQualityMenuVisible] = useState(false);
  const [languageMenuVisible, setLanguageMenuVisible] = useState(false);
  const [quality, setQuality] = useState('Auto');
  const [language, setLanguage] = useState('Kiswahili');
  const [resizeMode, setResizeMode] = useState(ResizeMode.CONTAIN);
  const [chromeHidden, setChromeHidden] = useState(false);

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

  useFocusEffect(
    useCallback(() => {
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        exitPlayer();
        return true;
      });

      const lockLandscape = async () => {
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
    }, [exitPlayer])
  );

  const onPlaybackStatusUpdate = useCallback((s) => {
    setStatus(s);
  }, []);

  const togglePlay = async () => {
    if (!videoRef.current) return;
    if (paused) {
      await videoRef.current.playAsync();
      setPaused(false);
    } else {
      await videoRef.current.pauseAsync();
      setPaused(true);
    }
  };

  const onSeekComplete = async (value) => {
    const dur = status.durationMillis;
    if (!videoRef.current || !dur || dur <= 0) return;
    await videoRef.current.setPositionAsync(value * dur);
  };

  const toggleFill = () => {
    setResizeMode((m) => (m === ResizeMode.CONTAIN ? ResizeMode.COVER : ResizeMode.CONTAIN));
  };

  const toggleFullScreen = () => {
    setChromeHidden((h) => !h);
  };

  const duration = status.isLoaded ? status.durationMillis ?? 0 : 0;
  const position = status.isLoaded ? status.positionMillis ?? 0 : 0;
  const progress = duration > 0 ? position / duration : 0;
  const hasProgress = duration > 0;

  const isBuffering = Boolean(status.isLoaded && status.isBuffering);
  const isLoaded = Boolean(status.isLoaded);
  const showInitialOverlay = !isLoaded;
  const showBufferSpinner = Boolean(isLoaded && isBuffering);

  const topPad = Math.max(insets.top, 8);
  const leftPad = Math.max(insets.left, 0);
  const rightPad = Math.max(insets.right, 0);
  const bottomInset = Math.max(insets.bottom, 8);

  const isFillActive = resizeMode === ResizeMode.COVER;

  return (
    <View style={styles.root}>
      <StatusBar hidden={chromeHidden} style="light" />

      <Video
        ref={videoRef}
        style={StyleSheet.absoluteFill}
        source={{ uri: streamUri }}
        resizeMode={resizeMode}
        shouldPlay={!paused}
        isMuted={false}
        useNativeControls={false}
        onPlaybackStatusUpdate={onPlaybackStatusUpdate}
      />

      {chromeHidden ? (
        <Pressable style={styles.chromeDismissLayer} onPress={() => setChromeHidden(false)} />
      ) : null}

      <View style={styles.centerLayer} pointerEvents="none">
        {showInitialOverlay ? (
          <View style={styles.centerCluster}>
            <ActivityIndicator size="large" color={COLORS.yellow} />
            <Text style={styles.loadingChannelText}>Loading channel...</Text>
          </View>
        ) : null}
        {showBufferSpinner ? (
          <View style={styles.bufferSpinnerWrap}>
            <ActivityIndicator size="large" color={COLORS.yellow} />
          </View>
        ) : null}
      </View>

      {!chromeHidden ? (
        <>
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
            <Pressable onPress={exitPlayer} hitSlop={14} style={styles.backHit}>
              <Ionicons name="chevron-back" size={28} color={COLORS.white} />
            </Pressable>
            <Text style={styles.topTitle} numberOfLines={1}>
              {channelTitle}
            </Text>
          </View>

          {/* Bottom overlay: progress + horizontal controls */}
          <View
            style={[
              styles.bottomOverlay,
              {
                paddingLeft: 14 + leftPad,
                paddingRight: 14 + rightPad,
                paddingBottom: bottomInset + 6,
              },
            ]}
            pointerEvents="box-none"
          >
            {hasProgress ? (
              <View style={styles.seekRow}>
                <Slider
                  style={styles.slider}
                  minimumValue={0}
                  maximumValue={1}
                  value={progress}
                  onSlidingComplete={onSeekComplete}
                  minimumTrackTintColor={COLORS.yellow}
                  maximumTrackTintColor="rgba(255,255,255,0.35)"
                  thumbTintColor={COLORS.yellow}
                />
              </View>
            ) : null}

            <View style={styles.bottomControlsRow}>
              <View style={styles.bottomBtnSlot}>
                <BottomControlButton
                  icon={paused ? 'play' : 'pause'}
                  label={paused ? 'Play' : 'Pause'}
                  onPress={togglePlay}
                  compact={compact}
                />
              </View>
              <View style={styles.bottomBtnSlot}>
                <BottomControlButton
                  icon="language"
                  label="Audio"
                  sublabel="Badili Lugha"
                  onPress={() => {
                    setLanguageMenuVisible(true);
                  }}
                  compact={compact}
                />
              </View>
              <View style={styles.bottomBtnSlot}>
                <BottomControlButton
                  icon="options"
                  label="Quality"
                  onPress={() => setQualityMenuVisible(true)}
                  compact={compact}
                />
              </View>
              <View style={styles.bottomBtnSlot}>
                <BottomControlButton
                  icon={isFillActive ? 'contract' : 'expand'}
                  label="Fill"
                  onPress={toggleFill}
                  compact={compact}
                />
              </View>
              <View style={styles.bottomBtnSlot}>
                <BottomControlButton
                  icon="expand-outline"
                  label="Full Screen"
                  onPress={toggleFullScreen}
                  compact={compact}
                />
              </View>
            </View>
          </View>
        </>
      ) : null}

      <Modal
        visible={qualityMenuVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setQualityMenuVisible(false)}
      >
        <View style={styles.modalBackdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setQualityMenuVisible(false)} />
          <View style={styles.qualityCard} pointerEvents="box-none">
            <Text style={styles.qualityTitle}>Ubora</Text>
            {QUALITIES.map((q) => (
              <Pressable
                key={q}
                style={[styles.qualityRow, quality === q && styles.qualityRowOn]}
                onPress={() => {
                  setQuality(q);
                  setQualityMenuVisible(false);
                }}
              >
                <Text style={[styles.qualityLabel, quality === q && styles.qualityLabelOn]}>{q}</Text>
                {quality === q ? <Ionicons name="checkmark" size={20} color={COLORS.yellow} /> : null}
              </Pressable>
            ))}
          </View>
        </View>
      </Modal>

      <Modal
        visible={languageMenuVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setLanguageMenuVisible(false)}
      >
        <View style={styles.modalBackdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setLanguageMenuVisible(false)} />
          <View style={styles.qualityCard} pointerEvents="box-none">
            <Text style={styles.qualityTitle}>Badili Lugha</Text>
            {LANGUAGES.map((lang) => (
              <Pressable
                key={lang}
                style={[styles.qualityRow, language === lang && styles.qualityRowOn]}
                onPress={() => {
                  setLanguage(lang);
                  setLanguageMenuVisible(false);
                }}
              >
                <Text style={[styles.qualityLabel, language === lang && styles.qualityLabelOn]}>{lang}</Text>
                {language === lang ? <Ionicons name="checkmark" size={20} color={COLORS.yellow} /> : null}
              </Pressable>
            ))}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#000000',
  },
  chromeDismissLayer: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 50,
  },
  centerLayer: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 5,
  },
  centerCluster: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingChannelText: {
    marginTop: 14,
    color: COLORS.white,
    fontSize: 15,
    fontWeight: '600',
  },
  bufferSpinnerWrap: {
    position: 'absolute',
    alignSelf: 'center',
  },
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.overlay,
    zIndex: 20,
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
  bottomOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 25,
    backgroundColor: COLORS.bottomBarBg,
    paddingTop: 10,
    borderTopLeftRadius: 14,
    borderTopRightRadius: 14,
  },
  seekRow: {
    marginBottom: 6,
    paddingHorizontal: 4,
  },
  slider: {
    width: '100%',
    height: 36,
  },
  bottomControlsRow: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 72,
  },
  bottomBtnSlot: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bottomBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
    paddingHorizontal: 2,
    width: '100%',
  },
  bottomBtnCompact: {
    paddingHorizontal: 0,
  },
  bottomBtnPressed: {
    opacity: 0.75,
  },
  bottomBtnLabel: {
    marginTop: 4,
    color: COLORS.white,
    fontSize: 11,
    fontWeight: '700',
    textAlign: 'center',
  },
  bottomBtnLabelCompact: {
    fontSize: 9,
    marginTop: 2,
  },
  bottomBtnSublabel: {
    marginTop: 1,
    color: 'rgba(255,255,255,0.85)',
    fontSize: 9,
    fontWeight: '600',
    textAlign: 'center',
  },
  bottomBtnSublabelCompact: {
    fontSize: 8,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  qualityCard: {
    width: '100%',
    maxWidth: 320,
    backgroundColor: '#1A1D23',
    borderRadius: 16,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: 'rgba(250,204,21,0.15)',
    zIndex: 2,
  },
  qualityTitle: {
    color: COLORS.white,
    fontSize: 16,
    fontWeight: '700',
    paddingHorizontal: 16,
    paddingBottom: 10,
  },
  qualityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  qualityRowOn: {
    backgroundColor: 'rgba(255,203,61,0.12)',
  },
  qualityLabel: {
    color: '#A1A8B5',
    fontSize: 15,
    fontWeight: '600',
  },
  qualityLabelOn: {
    color: COLORS.white,
  },
});
