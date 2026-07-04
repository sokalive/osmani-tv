import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect } from '@react-navigation/native';
import OmbaKifurushiModal from './OmbaKifurushiModal';
import { fetchOmbaKifurushiSettings } from '../api/subscriptionRequest';
import { subscribeRealtimeEvent } from '../lib/realtimeSync';
import { useModalSheetCoordinator } from '../context/ModalSheetCoordinatorContext';

const COLORS = {
  card: '#1A1D23',
  mutedText: '#A1A8B5',
  white: '#FFFFFF',
  yellow: '#FFCB3D',
  yellowDark: '#E5A020',
};

/**
 * Account tab — OMBA KIFURUSHI CHAKO (below Update App).
 */
export default function OmbaKifurushiSection() {
  const [modalVisible, setModalVisible] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const { isBlockingSheetActive } = useModalSheetCoordinator();

  const refreshSettings = useCallback(async () => {
    try {
      const s = await fetchOmbaKifurushiSettings();
      setEnabled(s.enabled);
    } catch {
      setEnabled(true);
    } finally {
      setSettingsLoaded(true);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void refreshSettings();
    }, [refreshSettings]),
  );

  useEffect(() => {
    const off = subscribeRealtimeEvent('omba_kifurushi_settings_changed', (payload) => {
      const next =
        payload?.omba_kifurushi_enabled !== false && payload?.ombaKifurushiEnabled !== false;
      setEnabled(next);
    });
    return off;
  }, []);

  const handleOpen = () => {
    if (isBlockingSheetActive) return;
    setModalVisible(true);
  };

  if (settingsLoaded && !enabled) {
    return null;
  }

  return (
    <>
      <View
        style={styles.wrap}
        testID="omba-kifurushi-section"
        accessibilityLabel="Omba Kifurushi Chako section"
      >
        <Text style={styles.title}>Omba Kifurushi</Text>
        <Text style={styles.subtitle}>
          Tuma ombi kwa Admin ikiwa huwezi kulipia moja kwa moja
        </Text>
        <Pressable
          style={styles.btnOuter}
          onPress={handleOpen}
          disabled={!settingsLoaded}
          testID="omba-kifurushi-button"
          accessibilityRole="button"
          accessibilityLabel="OMBA KIFURUSHI CHAKO"
        >
          <LinearGradient
            colors={[COLORS.yellow, COLORS.yellowDark]}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 1, y: 0.5 }}
            style={styles.btnGradient}
          >
            {!settingsLoaded ? (
              <ActivityIndicator color="#111827" />
            ) : (
              <Text style={styles.btnText}>OMBA KIFURUSHI CHAKO</Text>
            )}
          </LinearGradient>
        </Pressable>
      </View>

      <OmbaKifurushiModal visible={modalVisible} onClose={() => setModalVisible(false)} />
    </>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginTop: 16,
    marginBottom: 8,
    backgroundColor: COLORS.card,
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,203,61,0.35)',
  },
  title: {
    color: COLORS.white,
    fontSize: 16,
    fontWeight: '800',
    marginBottom: 8,
  },
  subtitle: {
    color: COLORS.mutedText,
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 14,
  },
  btnOuter: {
    borderRadius: 16,
    overflow: 'hidden',
  },
  btnGradient: {
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnText: {
    color: '#111827',
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
});
