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
} from 'react-native';
import { Video } from 'expo-av';
import Slider from '@react-native-community/slider';
import { Ionicons } from '@expo/vector-icons';
import * as ScreenOrientation from 'expo-screen-orientation';
import { WebView } from 'react-native-webview';
import { PING_MS, pingLiveSession, startLiveSession, stopLiveSession } from '../api/analytics';

function formatTime(ms = 0) {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m < 10 ? '0' : ''}${m}:${s < 10 ? '0' : ''}${s}`;
}

export default function ChannelPlayerScreen({ route, navigation }) {

  const channel = route?.params?.channel;

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

  const playerType = channel?.playerType || 'exo';

  const videoRef = useRef(null);
  const hideTimer = useRef(null);

  const [isPlaying, setIsPlaying] = useState(true);
  const [controlsVisible, setControlsVisible] = useState(true);

  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isSeeking, setIsSeeking] = useState(false);
  const [sliderValue, setSliderValue] = useState(0);

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

  // FALLBACK STREAM
  const onError = () => {
    if (currentUrlIndex < streams.length - 1) {
      setCurrentUrlIndex((i) => i + 1);
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

    (async () => {
      const deviceId = await startLiveSession(channelId, channelName);
      if (cancelled) return;
      sessionDeviceIdRef.current = deviceId;
      stopSentRef.current = false;

      pingTimerRef.current = setInterval(() => {
        void pingLiveSession(sessionDeviceIdRef.current, sessionChannelIdRef.current);
      }, PING_MS);
    })();

    return () => {
      cancelled = true;
      if (pingTimerRef.current) {
        clearInterval(pingTimerRef.current);
        pingTimerRef.current = null;
      }
      if (!stopSentRef.current) {
        stopSentRef.current = true;
        void stopLiveSession(sessionDeviceIdRef.current, sessionChannelIdRef.current);
      }
    };
  }, [channel?.id, channel?.channel_id, channel?.name]);

  // If app goes to background while player is open, close analytics session safely.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') return;
      if (pingTimerRef.current) {
        clearInterval(pingTimerRef.current);
        pingTimerRef.current = null;
      }
      if (!stopSentRef.current) {
        stopSentRef.current = true;
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
    if (!status.isLoaded) return;

    setDuration(status.durationMillis || 0);

    if (!isSeeking) {
      setPosition(status.positionMillis || 0);
      setSliderValue(status.positionMillis || 0);
    }

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

  // SEEK
  const onSeekStart = () => setIsSeeking(true);

  const onSeekComplete = async (value) => {
    setIsSeeking(false);
    await videoRef.current.setPositionAsync(value);
  };

  return (
    <View style={styles.root}>

      {/* VIDEO / WEBVIEW */}
      <Pressable style={{ flex: 1 }} onPress={showControls}>

        {playerType === 'webview' ? (
          <WebView source={{ uri }} style={styles.video} />
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
              <Pressable onPress={onPlayPause} style={styles.playBtn}>
                <Ionicons
                  name={isPlaying ? 'pause' : 'play'}
                  size={44}
                  color="#000"
                />
              </Pressable>
            </View>

            {/* BOTTOM */}
            <View style={styles.bottom}>
              <Text style={styles.time}>{formatTime(position)}</Text>

              <Slider
                style={{ flex: 1 }}
                minimumValue={0}
                maximumValue={duration || 1}
                value={sliderValue}
                onSlidingStart={onSeekStart}
                onSlidingComplete={onSeekComplete}
                onValueChange={setSliderValue}
                minimumTrackTintColor="#fff"
                maximumTrackTintColor="#777"
                thumbTintColor="#fff"
              />

              <Text style={styles.time}>{formatTime(duration)}</Text>
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
    alignItems: 'center',
  },

  time: {
    color: '#fff',
    width: 50,
    textAlign: 'center',
  },

  title: {
    color: '#fff',
    marginLeft: 10,
  },
});