import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { usePlaybackSecurityGate, useSecurity } from '../context/SecurityContext';

export function SecurityPlaybackBlock({ onBack }) {
  const gate = usePlaybackSecurityGate();
  if (gate.allowed) return null;

  return (
    <View style={styles.blockRoot}>
      <Ionicons name="shield-outline" size={56} color="#facc15" />
      <Text style={styles.blockTitle}>Usalama wa kifaa</Text>
      <Text style={styles.blockBody}>{gate.message}</Text>
      {onBack ? (
        <Pressable style={styles.blockBtn} onPress={onBack}>
          <Text style={styles.blockBtnText}>Rudi nyuma</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/** Security warnings/limited playback removed under strict zero-tolerance policy. */
export function SecurityPlayerBanner() {
  return null;
}

export function SecurityScanSplash() {
  const { loading } = useSecurity();
  if (!loading) return null;
  return (
    <View style={styles.splash} pointerEvents="none">
      <ActivityIndicator color="#facc15" />
    </View>
  );
}

const styles = StyleSheet.create({
  blockRoot: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#0a0a0a',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
    zIndex: 50,
  },
  blockTitle: {
    color: '#fff',
    fontSize: 22,
    fontWeight: '700',
    marginTop: 16,
    marginBottom: 10,
  },
  blockBody: {
    color: '#d1d5db',
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 22,
  },
  blockBtn: {
    marginTop: 24,
    backgroundColor: '#facc15',
    paddingHorizontal: 22,
    paddingVertical: 12,
    borderRadius: 10,
  },
  blockBtnText: {
    color: '#111',
    fontWeight: '700',
    fontSize: 15,
  },
  splash: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.35)',
    zIndex: 30,
  },
});
