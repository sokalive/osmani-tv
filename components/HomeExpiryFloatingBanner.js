import React, { useEffect, useRef } from 'react';
import { Animated, Pressable, StyleSheet, Text, View, Platform } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const ACCENT_GRADIENT = ['#FFE066', '#F5C518', '#A87410'];

/**
 * Non-blocking floating reminder on Home (near-expiry only).
 * @param {{ visible: boolean; detailLine: string; onPayPress: () => void }} props
 */
export default function HomeExpiryFloatingBanner({ visible, detailLine, onPayPress }) {
  const insets = useSafeAreaInsets();
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(-12)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: visible ? 1 : 0,
        duration: 280,
        useNativeDriver: true,
      }),
      Animated.timing(translateY, {
        toValue: visible ? 0 : -12,
        duration: 280,
        useNativeDriver: true,
      }),
    ]).start();
  }, [visible, opacity, translateY]);

  return (
    <Animated.View
      pointerEvents={visible ? 'box-none' : 'none'}
      style={[
        styles.wrap,
        {
          top: insets.top + 6,
          opacity,
          transform: [{ translateY }],
        },
      ]}
    >
      <View style={styles.card}>
        <Text style={styles.line1}>Kifurushi chako kinaisha hivi karibuni. Lipia tena mapema.</Text>
        <Text style={styles.line2}>{detailLine}</Text>
        <Pressable style={styles.btnWrap} onPress={onPayPress}>
          <LinearGradient
            colors={ACCENT_GRADIENT}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.btnGrad}
          >
            <Text style={styles.btnText}>Lipia Tena</Text>
          </LinearGradient>
        </Pressable>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 12,
    right: 12,
    zIndex: 30,
    elevation: Platform.OS === 'android' ? 12 : 0,
  },
  card: {
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: 'rgba(15,17,21,0.94)',
    borderWidth: 1,
    borderColor: 'rgba(250,204,21,0.22)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
  },
  line1: {
    color: '#E5E7EB',
    fontSize: 12,
    fontWeight: '600',
    lineHeight: 16,
  },
  line2: {
    color: '#9CA3AF',
    fontSize: 11,
    marginTop: 4,
    marginBottom: 8,
  },
  btnWrap: {
    alignSelf: 'flex-start',
    borderRadius: 12,
    overflow: 'hidden',
    marginTop: 2,
  },
  btnGrad: {
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  btnText: {
    color: '#111827',
    fontSize: 13,
    fontWeight: '800',
  },
});
