import React, { useCallback } from 'react';
import {
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import {
  CHANNEL_UPDATE_GATE_BUTTON,
  CHANNEL_UPDATE_GATE_MESSAGE,
  CHANNEL_UPDATE_GATE_TITLE,
} from '../lib/channelUpdateGate';
import { forceRecheck, openPlayStoreFromInfo, startDownload, getUpdateAction } from '../lib/updateClient';

/**
 * Shown when legacy APK (versionCode &lt; 24) must update before channel playback.
 * UPDATE reuses the existing native APK download/install pipeline.
 */
export default function ChannelUpdateGateModal({ visible, onDismiss }) {
  const onUpdate = useCallback(async () => {
    onDismiss?.();
    try {
      await forceRecheck();
    } catch {
      /* proceed with cached update info */
    }
    const action = getUpdateAction();
    if (action.canDownload) {
      await startDownload();
      return;
    }
    if (action.canOpenStore) {
      await openPlayStoreFromInfo();
    }
  }, [onDismiss]);

  return (
    <Modal
      visible={Boolean(visible)}
      transparent
      statusBarTranslucent
      animationType="fade"
      onRequestClose={onDismiss}
    >
      <Pressable style={styles.backdrop} onPress={onDismiss}>
        <Pressable style={styles.card} onPress={() => {}}>
          <View style={styles.iconWrap}>
            <Ionicons name="cloud-download-outline" size={36} color="#FACC15" />
          </View>
          <Text style={styles.title}>{CHANNEL_UPDATE_GATE_TITLE}</Text>
          <Text style={styles.body}>{CHANNEL_UPDATE_GATE_MESSAGE}</Text>
          <Pressable
            onPress={() => {
              void onUpdate();
            }}
            style={styles.primaryWrap}
            accessibilityRole="button"
            accessibilityLabel={CHANNEL_UPDATE_GATE_BUTTON}
          >
            <LinearGradient
              colors={['#FFCB3D', '#E5A020']}
              start={{ x: 0, y: 0.5 }}
              end={{ x: 1, y: 0.5 }}
              style={styles.primaryGradient}
            >
              <Text style={styles.primaryText}>{CHANNEL_UPDATE_GATE_BUTTON}</Text>
            </LinearGradient>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.86)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: '#0F1115',
    borderRadius: 22,
    padding: 22,
    borderWidth: 1,
    borderColor: 'rgba(250,204,21,0.34)',
    ...Platform.select({
      android: { elevation: 18 },
      ios: {
        shadowColor: '#000',
        shadowOpacity: 0.35,
        shadowRadius: 22,
        shadowOffset: { width: 0, height: 10 },
      },
      default: {},
    }),
  },
  iconWrap: {
    alignSelf: 'center',
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: 'rgba(250,204,21,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  title: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '800',
    textAlign: 'center',
  },
  body: {
    marginTop: 12,
    color: '#CBD5E1',
    fontSize: 14,
    lineHeight: 22,
    textAlign: 'center',
  },
  primaryWrap: {
    marginTop: 22,
    borderRadius: 16,
    overflow: 'hidden',
  },
  primaryGradient: {
    paddingVertical: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryText: {
    color: '#111827',
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
});
