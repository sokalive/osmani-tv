import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { useCallback, useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { getPopupSettings } from '../api';
import { subscribeRealtimeEvent } from '../lib/realtimeSync';

const STORAGE_KEY = 'osmani_popup_settings_seen';
const VALID_MODES = new Set(['show_once', 'always_show', 'disabled']);

const DEFAULT_POPUP = {
  mode: 'disabled',
  title: '',
  greeting: '',
  bullet_points: [],
  disclaimer: '',
};

function normalizePopup(payload) {
  if (!payload || typeof payload !== 'object') return DEFAULT_POPUP;
  const mode = VALID_MODES.has(payload.mode) ? payload.mode : 'disabled';
  return {
    ...payload,
    mode,
    title: typeof payload.title === 'string' ? payload.title : '',
    greeting: typeof payload.greeting === 'string' ? payload.greeting : '',
    bullet_points: Array.isArray(payload.bullet_points) ? payload.bullet_points : [],
    disclaimer: typeof payload.disclaimer === 'string' ? payload.disclaimer : '',
  };
}

export default function PopupSettingsModal() {
  const [settings, setSettings] = useState(DEFAULT_POPUP);
  const [visible, setVisible] = useState(false);

  const applySettings = useCallback(async (payload, reason) => {
    const next = normalizePopup(payload);
    console.log('[POPUP_UPDATE]', reason, next);
    setSettings(next);

    if (next.mode === 'disabled') {
      setVisible(false);
      return;
    }

    if (next.mode === 'always_show') {
      setVisible(true);
      return;
    }

    if (next.mode === 'show_once') {
      const seen = await AsyncStorage.getItem(STORAGE_KEY);
      setVisible(seen !== '1');
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const load = () => getPopupSettings()
      .then((payload) => {
        if (!cancelled) void applySettings(payload, 'fetch');
      })
      .catch((e) => {
        console.log('[POPUP_UPDATE]', 'fetch_failed', e?.message ?? e);
      });
    load();

    const unsubscribe = subscribeRealtimeEvent('popup_settings_changed', (payload) => {
      if (payload && typeof payload === 'object' && VALID_MODES.has(payload.mode)) {
        void applySettings(payload, 'sse');
      } else {
        load();
      }
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [applySettings]);

  const close = useCallback(() => {
    if (settings.mode === 'show_once') {
      AsyncStorage.setItem(STORAGE_KEY, '1').catch(() => {});
    }
    setVisible(false);
  }, [settings.mode]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={close}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <View style={styles.iconWrap}>
            <Ionicons name="information-circle" size={34} color="#FBBF24" />
          </View>
          {settings.title ? <Text style={styles.title}>{settings.title}</Text> : null}
          {settings.greeting ? <Text style={styles.greeting}>{settings.greeting}</Text> : null}
          {settings.bullet_points.length > 0 ? (
            <ScrollView style={styles.bullets} contentContainerStyle={styles.bulletsInner}>
              {settings.bullet_points.map((point, index) => (
                <View key={`${index}-${String(point)}`} style={styles.bulletRow}>
                  <Text style={styles.bulletDot}>•</Text>
                  <Text style={styles.bulletText}>{String(point)}</Text>
                </View>
              ))}
            </ScrollView>
          ) : null}
          {settings.disclaimer ? <Text style={styles.disclaimer}>{settings.disclaimer}</Text> : null}
          <Pressable style={styles.button} onPress={close}>
            <Text style={styles.buttonText}>Sawa</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.68)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    maxHeight: '82%',
    backgroundColor: '#171A20',
    borderRadius: 22,
    paddingHorizontal: 22,
    paddingTop: 22,
    paddingBottom: 18,
    borderWidth: 1,
    borderColor: 'rgba(251,191,36,0.28)',
  },
  iconWrap: {
    alignSelf: 'center',
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'rgba(251,191,36,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  title: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '800',
    textAlign: 'center',
  },
  greeting: {
    marginTop: 10,
    color: '#E5E7EB',
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
  },
  bullets: {
    marginTop: 14,
    maxHeight: 180,
  },
  bulletsInner: {
    gap: 8,
  },
  bulletRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  bulletDot: {
    color: '#FBBF24',
    fontSize: 18,
    lineHeight: 22,
  },
  bulletText: {
    flex: 1,
    color: '#F3F4F6',
    fontSize: 14,
    lineHeight: 22,
  },
  disclaimer: {
    marginTop: 14,
    color: '#A1A8B5',
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
  },
  button: {
    marginTop: 18,
    backgroundColor: '#FBBF24',
    borderRadius: 14,
    paddingVertical: 13,
    alignItems: 'center',
  },
  buttonText: {
    color: '#111827',
    fontSize: 15,
    fontWeight: '800',
  },
});

