import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import {
  ACCOUNT_UPDATE_ALREADY_LATEST_SWAHILI,
  runAccountAppUpdate,
} from '../lib/accountAppUpdate';
import { useModalSheetCoordinator } from '../context/ModalSheetCoordinatorContext';
import { readNativeAndroidVersionCode } from '../lib/playVpsApiHost';

const COLORS = {
  card: '#1A1D23',
  mutedText: '#A1A8B5',
  white: '#FFFFFF',
};

/**
 * Account tab update control — always rendered in scroll flow below offer code.
 * No subscription or device-intelligence gates.
 */
export default function UpdateAppSection() {
  const [updateBusy, setUpdateBusy] = useState(false);
  const { isBlockingSheetActive } = useModalSheetCoordinator();

  useFocusEffect(
    useCallback(() => {
      console.log('[ACCOUNT_UPDATE] rendered', {
        nativeVersionCode: readNativeAndroidVersionCode() ?? null,
      });
    }, []),
  );

  const handlePress = useCallback(async () => {
    if (updateBusy || isBlockingSheetActive) return;
    setUpdateBusy(true);
    try {
      const result = await runAccountAppUpdate();
      if (result.outcome === 'already_latest') {
        Alert.alert('', ACCOUNT_UPDATE_ALREADY_LATEST_SWAHILI);
        return;
      }
      if (result.outcome === 'error' || result.outcome === 'unavailable') {
        Alert.alert('', result.message ?? 'Imeshindwa kukagua sasisho.');
      }
    } finally {
      setUpdateBusy(false);
    }
  }, [updateBusy, isBlockingSheetActive]);

  return (
    <View
      style={styles.wrap}
      testID="account-update-section"
      accessibilityLabel="Update App section"
    >
      <Text style={styles.title}>Update App</Text>
      <Text style={styles.subtitle}>Pakua toleo jipya la programu ikiwa linapatikana</Text>
      <Pressable
        style={[styles.btnOuter, updateBusy && styles.btnDisabled]}
        onPress={() => void handlePress()}
        disabled={updateBusy}
        testID="account-update-button"
        accessibilityRole="button"
        accessibilityLabel="UPDATE APP"
      >
        <LinearGradient
          colors={['#38BDF8', '#0EA5E9']}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 1, y: 0.5 }}
          style={styles.btnGradient}
        >
          {updateBusy ? (
            <ActivityIndicator color="#0F172A" />
          ) : (
            <Text style={styles.btnText}>UPDATE APP</Text>
          )}
        </LinearGradient>
      </Pressable>
    </View>
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
    borderColor: 'rgba(56,189,248,0.35)',
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
  btnDisabled: {
    opacity: 0.55,
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
