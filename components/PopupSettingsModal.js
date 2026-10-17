import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { getPopupSettings } from '../api';
import { normalizePopupSettings, popupContentKey, unwrapSettingsEvent } from '../lib/popupSettingsNormalize';
import { subscribeRealtimeEvent } from '../lib/realtimeSync';

const STORAGE_KEY_PREFIX = 'osmani_popup_settings_seen:';
const DISCLAIMER_LABEL = 'Tahadhari';
const POPUP_FETCH_ATTEMPTS = 3;

const DEFAULT_POPUP = {
  mode: 'disabled',
  title: '',
  greeting: '',
  bullet_points: [],
  disclaimer: '',
};

function normalizePopup(payload) {
  if (!payload || typeof payload !== 'object') return DEFAULT_POPUP;
  return normalizePopupSettings(payload);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export default function PopupSettingsModal() {
  const [settings, setSettings] = useState(DEFAULT_POPUP);
  const [visible, setVisible] = useState(false);
  const generationRef = useRef(0);

  const applySettings = useCallback(async (payload, reason, token) => {
    if (token != null && token !== generationRef.current) return;
    const next = normalizePopup(payload);
    if (token != null && token !== generationRef.current) return;
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
      const seen = await AsyncStorage.getItem(`${STORAGE_KEY_PREFIX}${popupContentKey(next)}`);
      if (token != null && token !== generationRef.current) return;
      setVisible(seen !== '1');
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    const bump = () => {
      generationRef.current += 1;
      return generationRef.current;
    };

    const fetchWithToken = (token, reason, force) => {
      const run = async () => {
        let lastError = null;
        for (let attempt = 0; attempt < POPUP_FETCH_ATTEMPTS; attempt += 1) {
          if (cancelled || token !== generationRef.current) return;
          try {
            const payload = await getPopupSettings({ force: force === true });
            if (cancelled || token !== generationRef.current) return;
            await applySettings(payload, reason, token);
            return;
          } catch (e) {
            lastError = e;
            if (attempt < POPUP_FETCH_ATTEMPTS - 1) {
              await sleep(400 * 2 ** attempt);
            }
          }
        }
        if (!cancelled && token === generationRef.current) {
          console.log('[POPUP_UPDATE]', 'fetch_failed', lastError?.message ?? lastError);
        }
      };
      void run();
    };

    const load = (reason, force) => {
      fetchWithToken(bump(), reason, force);
    };

    load('fetch', false);

    const onPopup = (payload) => {
      const inner = unwrapSettingsEvent(payload);
      const token = bump();
      if (inner && typeof inner.mode === 'string' && inner.mode.trim()) {
        void applySettings(inner, 'sse', token);
      }
      fetchWithToken(token, 'sse-refetch', true);
    };

    const unsubscribe = subscribeRealtimeEvent('popup_settings_changed', onPopup);
    const unsubscribeReconnect = subscribeRealtimeEvent('__sync_stream_connected', () => {
      load('sse-reconnect', true);
    });

    return () => {
      cancelled = true;
      generationRef.current += 1;
      unsubscribe();
      unsubscribeReconnect();
    };
  }, [applySettings]);

  const close = useCallback(() => {
    if (settings.mode === 'show_once') {
      AsyncStorage.setItem(`${STORAGE_KEY_PREFIX}${popupContentKey(settings)}`, '1').catch(() => {});
    }
    setVisible(false);
  }, [settings.mode]);

  const bulletPoints = settings.bullet_points.filter(
    (point) => String(point ?? '').trim().length > 0,
  );

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={close}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <View style={styles.iconWrap}>
            <Ionicons name="information-circle" size={34} color="#F59E0B" />
          </View>
          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollInner}
            showsVerticalScrollIndicator={false}
          >
            {settings.title ? (
              <Text style={styles.title} accessibilityRole="header">
                {settings.title}
              </Text>
            ) : null}

            {settings.greeting ? (
              <Text style={styles.greeting}>{settings.greeting}</Text>
            ) : null}

            {bulletPoints.length > 0 ? (
              <View style={styles.bullets}>
                {bulletPoints.map((point, index) => (
                  <View key={`${index}-${String(point)}`} style={styles.bulletRow}>
                    <Text style={styles.bulletDot}>{'\u2022'}</Text>
                    <Text style={styles.bulletText}>{String(point)}</Text>
                  </View>
                ))}
              </View>
            ) : null}

            {settings.disclaimer ? (
              <View style={styles.disclaimerBlock}>
                <Text style={styles.disclaimerTitle}>{DISCLAIMER_LABEL}</Text>
                <Text style={styles.disclaimerBody}>{settings.disclaimer}</Text>
              </View>
            ) : null}
          </ScrollView>

          <View style={styles.footer}>
            <Pressable
              style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
              onPress={close}
              accessibilityRole="button"
            >
              <Text style={styles.buttonText}>Sawa</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 22,
    paddingVertical: 28,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    maxHeight: '92%',
    backgroundColor: '#FFFFFF',
    borderRadius: 22,
    paddingHorizontal: 22,
    paddingTop: 22,
    paddingBottom: 18,
    overflow: 'hidden',
    ...Platform.select({
      android: { elevation: 14 },
      ios: {
        shadowColor: '#000000',
        shadowOpacity: 0.18,
        shadowRadius: 22,
        shadowOffset: { width: 0, height: 10 },
      },
      default: {},
    }),
  },
  iconWrap: {
    alignSelf: 'center',
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: 'rgba(245,158,11,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  scroll: {
    flexShrink: 1,
  },
  scrollInner: {
    paddingBottom: 4,
  },
  title: {
    color: '#0F172A',
    fontSize: 26,
    fontWeight: '800',
    textAlign: 'center',
    letterSpacing: 0.2,
  },
  greeting: {
    marginTop: 10,
    color: '#1F2937',
    fontSize: 15,
    fontWeight: '500',
    lineHeight: 22,
    textAlign: 'center',
  },
  bullets: {
    marginTop: 16,
    gap: 10,
  },
  bulletRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  bulletDot: {
    color: '#F59E0B',
    fontSize: 18,
    lineHeight: 22,
    marginRight: 10,
    marginTop: 1,
    fontWeight: '700',
  },
  bulletText: {
    flex: 1,
    color: '#1F2937',
    fontSize: 15,
    lineHeight: 22,
    flexShrink: 1,
    flexWrap: 'wrap',
  },
  disclaimerBlock: {
    marginTop: 18,
    paddingTop: 14,
    paddingBottom: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#E5E7EB',
  },
  disclaimerTitle: {
    color: '#0F172A',
    fontSize: 14,
    fontWeight: '800',
    marginBottom: 4,
  },
  disclaimerBody: {
    color: '#4B5563',
    fontSize: 13,
    lineHeight: 20,
  },
  footer: {
    paddingTop: 16,
  },
  button: {
    backgroundColor: '#FBBF24',
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonPressed: {
    backgroundColor: '#F59E0B',
  },
  buttonText: {
    color: '#111827',
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
});
