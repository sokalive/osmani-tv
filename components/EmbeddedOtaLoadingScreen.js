import React, { useEffect, useMemo, useRef } from 'react';
import {
  Animated,
  Easing,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';

/**
 * Full-screen Swahili OTA progress UI for embedded first launch.
 *
 * @param {{
 *   phase: 'idle' | 'checking' | 'downloading' | 'applying' | 'reloading',
 *   downloadProgress: number | null,
 * }} props
 */
export default function EmbeddedOtaLoadingScreen({ phase, downloadProgress }) {
  const pulse = useRef(new Animated.Value(0.25)).current;
  const indeterminate = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 900,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: false,
        }),
        Animated.timing(pulse, {
          toValue: 0.25,
          duration: 900,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: false,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  useEffect(() => {
    if (downloadProgress != null) return undefined;
    const loop = Animated.loop(
      Animated.timing(indeterminate, {
        toValue: 1,
        duration: 1400,
        easing: Easing.linear,
        useNativeDriver: false,
      }),
    );
    loop.start();
    return () => {
      indeterminate.setValue(0);
      loop.stop();
    };
  }, [downloadProgress, indeterminate]);

  const percent = useMemo(() => {
    if (downloadProgress == null) return null;
    return Math.round(downloadProgress * 100);
  }, [downloadProgress]);

  const statusLine = useMemo(() => {
    if (phase === 'reloading') return 'Inafungua upya programu...';
    if (phase === 'applying') return 'Inaweka sasisho...';
    if (phase === 'downloading') {
      if (percent != null) return `Inapakua sasisho... ${percent}%`;
      return 'Inapakua sasisho...';
    }
    if (phase === 'checking') return 'Inakagua sasisho...';
    return 'Inaandaa programu...';
  }, [phase, percent]);

  const barWidth = useMemo(() => {
    if (downloadProgress != null) {
      return `${Math.max(8, Math.round(downloadProgress * 100))}%`;
    }
    return indeterminate.interpolate({
      inputRange: [0, 0.5, 1],
      outputRange: ['12%', '78%', '12%'],
    });
  }, [downloadProgress, indeterminate]);

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar style="light" backgroundColor="#000000" />
      <View style={styles.content}>
        <Text style={styles.title}>Inasasisha programu...</Text>
        <Text style={styles.subtitle}>Tafadhali subiri kidogo...</Text>
        <Text style={styles.status}>{statusLine}</Text>
        <View style={styles.track}>
          <Animated.View
            style={[
              styles.fill,
              typeof barWidth === 'string'
                ? { width: barWidth }
                : { width: barWidth, opacity: pulse },
            ]}
          />
        </View>
        {percent != null ? (
          <Text style={styles.percent}>{percent}%</Text>
        ) : (
          <Text style={styles.percentMuted}>Inaendelea...</Text>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#000000',
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  title: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 12,
  },
  subtitle: {
    color: 'rgba(255,255,255,0.75)',
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 28,
  },
  status: {
    color: '#F5C518',
    fontSize: 15,
    fontWeight: '600',
    textAlign: 'center',
    marginBottom: 16,
  },
  track: {
    width: '100%',
    maxWidth: 320,
    height: 8,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.12)',
    overflow: 'hidden',
    marginBottom: 10,
  },
  fill: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: '#F5C518',
  },
  percent: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
  percentMuted: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: 14,
  },
});
