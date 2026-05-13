import React, { useCallback, useEffect, useState } from 'react';
import { Linking, Pressable, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { getWhatsappSettings } from '../api';
import { subscribeRealtimeEvent } from '../lib/realtimeSync';

const DEFAULT_SETTINGS = {
  enabled: false,
  url: '',
};

function normalizeSettings(payload) {
  if (!payload || typeof payload !== 'object') return DEFAULT_SETTINGS;
  return {
    ...payload,
    enabled: payload.enabled === true,
    url: typeof payload.url === 'string' ? payload.url.trim() : '',
  };
}

export default function WhatsAppFloatingButton() {
  const insets = useSafeAreaInsets();
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);

  const applySettings = useCallback((payload) => {
    const next = normalizeSettings(payload);
    console.log('[WHATSAPP_UPDATE]', next);
    setSettings(next);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const load = () => getWhatsappSettings()
      .then((payload) => {
        if (!cancelled) applySettings(payload);
      })
      .catch((e) => {
        console.log('[WHATSAPP_UPDATE]', 'fetch_failed', e?.message ?? e);
      });
    load();

    const unsubscribe = subscribeRealtimeEvent('whatsapp_settings_changed', (payload) => {
      const inner =
        payload && typeof payload === 'object' && payload.payload && typeof payload.payload === 'object'
          ? payload.payload
          : payload;
      if (inner && typeof inner === 'object' && Object.prototype.hasOwnProperty.call(inner, 'enabled')) {
        applySettings(inner);
      } else {
        load();
      }
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [applySettings]);

  const openWhatsApp = useCallback(() => {
    if (!settings.url) return;
    Linking.openURL(settings.url).catch((e) => {
      console.log('[WHATSAPP_UPDATE]', 'open_failed', e?.message ?? e);
    });
  }, [settings.url]);

  if (settings.enabled !== true) return null;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Open WhatsApp"
      onPress={openWhatsApp}
      style={[styles.floatingButton, { bottom: Math.max(insets.bottom + 96, 104) }]}
    >
      <Ionicons name="logo-whatsapp" size={30} color="#FFFFFF" />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  floatingButton: {
    position: 'absolute',
    right: 18,
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: '#25D366',
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 18,
    shadowColor: '#000000',
    shadowOpacity: 0.28,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    zIndex: 1000,
  },
});

