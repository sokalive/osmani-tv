import React from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

const MESSAGE =
  'Kuna Hitilafu Imetokea Muda Huu. Timu Yetu Ya Ufundi Ina Shughulikia. Tafadhali Jaribu Tena Baada Ya Dakika Chache.';

export default function EmergencyModal({
  visible,
  onSawa,
  title = 'Taarifa',
  message = MESSAGE,
  iconName = 'warning',
  primaryLabel = 'Sawa',
  secondaryLabel = '',
  onSecondary,
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onSawa}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Ionicons name={iconName} size={52} color="#EF4444" style={styles.icon} />
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.message}>{message}</Text>
          {secondaryLabel ? (
            <Pressable
              style={({ pressed }) => [styles.secondaryButton, pressed && styles.buttonPressed]}
              onPress={onSecondary || onSawa}
            >
              <Text style={styles.secondaryButtonLabel}>{secondaryLabel}</Text>
            </Pressable>
          ) : null}
          <Pressable style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]} onPress={onSawa}>
            <Text style={styles.buttonLabel}>{primaryLabel}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.88)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 28,
  },
  card: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: '#1A1D23',
    borderRadius: 18,
    paddingVertical: 28,
    paddingHorizontal: 22,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.35)',
  },
  icon: {
    marginBottom: 10,
  },
  title: {
    color: '#F9FAFB',
    fontSize: 20,
    fontWeight: '800',
    marginBottom: 10,
  },
  message: {
    color: '#F3F4F6',
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'center',
    lineHeight: 24,
  },
  secondaryButton: {
    marginTop: 16,
    minWidth: 160,
    paddingVertical: 13,
    paddingHorizontal: 24,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(148,163,184,0.5)',
    alignItems: 'center',
    backgroundColor: 'rgba(30,41,59,0.35)',
  },
  secondaryButtonLabel: {
    color: '#E5E7EB',
    fontSize: 15,
    fontWeight: '800',
  },
  button: {
    marginTop: 26,
    minWidth: 160,
    paddingVertical: 14,
    paddingHorizontal: 28,
    borderRadius: 14,
    backgroundColor: '#FBBF24',
    alignItems: 'center',
  },
  buttonPressed: {
    opacity: 0.9,
  },
  buttonLabel: {
    color: '#111827',
    fontSize: 16,
    fontWeight: '800',
  },
});
