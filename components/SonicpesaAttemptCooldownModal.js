import React from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COOLDOWN_POPUP_COPY } from '../lib/sonicpesaAttemptCooldown';

/**
 * Three-minute SonicPesa attempt cooldown. Matches the supplied reference:
 * black backdrop, red glow card, red clock, white heading, red SAWA button.
 * SAWA only dismisses. It does not start a payment or clear the cooldown.
 */
export default function SonicpesaAttemptCooldownModal({ visible, onDismiss }) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onDismiss}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <View style={styles.clockHalo}>
            <Ionicons name="time-outline" size={54} color="#FF1A1A" />
          </View>
          <Text style={styles.heading}>{COOLDOWN_POPUP_COPY.heading}</Text>
          <Text style={styles.message}>{COOLDOWN_POPUP_COPY.message}</Text>
          <Pressable style={styles.button} onPress={onDismiss} accessibilityRole="button">
            <Text style={styles.buttonText}>{COOLDOWN_POPUP_COPY.button}</Text>
          </Pressable>
          <Text style={styles.support}>{COOLDOWN_POPUP_COPY.support}</Text>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: '#000000',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 22,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: '#0A0A0A',
    borderRadius: 28,
    borderWidth: 1.5,
    borderColor: '#FF2A2A',
    paddingTop: 36,
    paddingBottom: 28,
    paddingHorizontal: 26,
    alignItems: 'center',
    shadowColor: '#FF1A1A',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 22,
    elevation: 18,
  },
  clockHalo: {
    width: 78,
    height: 78,
    borderRadius: 39,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 26, 26, 0.08)',
    shadowColor: '#FF1A1A',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.95,
    shadowRadius: 16,
    elevation: 12,
  },
  heading: {
    marginTop: 22,
    color: '#FFFFFF',
    fontSize: 26,
    lineHeight: 32,
    fontWeight: '800',
    textAlign: 'center',
  },
  message: {
    marginTop: 16,
    color: '#F4F4F5',
    fontSize: 16,
    lineHeight: 24,
    fontWeight: '400',
    textAlign: 'center',
  },
  button: {
    marginTop: 26,
    width: '100%',
    minHeight: 54,
    borderRadius: 16,
    backgroundColor: '#E10600',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 1.2,
  },
  support: {
    marginTop: 16,
    color: '#8A8A8E',
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
  },
});
