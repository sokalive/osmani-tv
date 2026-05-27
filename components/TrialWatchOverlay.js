import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { formatTrialCountdown } from '../lib/trialWatchState';

/**
 * @param {{ phase: 'trial' | 'preview'; remainingMs: number; topInset?: number }} props
 */
export default function TrialWatchOverlay({ phase, remainingMs, topInset = 0 }) {
  if (phase !== 'trial' && phase !== 'preview') return null;
  const label = phase === 'trial' ? 'Muda wa jaribio' : 'Onyesho fupi';
  const clock = formatTrialCountdown(remainingMs);

  return (
    <View
      pointerEvents="none"
      style={[styles.wrap, { top: Math.max(10, topInset + 8) }]}
    >
      <View style={[styles.pill, phase === 'preview' ? styles.pillPreview : null]}>
        <Text style={styles.label}>{label}</Text>
        <Text style={styles.clock}>{clock}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 12,
    right: 12,
    zIndex: 100,
    elevation: 24,
    alignItems: 'flex-start',
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: 'rgba(220, 38, 38, 0.92)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.22)',
    maxWidth: '92%',
  },
  pillPreview: {
    backgroundColor: 'rgba(185, 28, 28, 0.9)',
  },
  label: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  clock: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
    letterSpacing: 0.5,
  },
});
