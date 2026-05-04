import React from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

const MESSAGE =
  'Hitilafu imetokea. Timu yetu ya ufundi inaishughulikia. Tafadhali jaribu tena baadaye.';

export default function EmergencyModal({ visible, onSawa }) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onSawa}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Ionicons name="warning" size={52} color="#EF4444" style={styles.icon} />
          <Text style={styles.message}>{MESSAGE}</Text>
          <Pressable style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]} onPress={onSawa}>
            <Text style={styles.buttonLabel}>Sawa</Text>
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
    marginBottom: 18,
  },
  message: {
    color: '#F3F4F6',
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'center',
    lineHeight: 24,
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
