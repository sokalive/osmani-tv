import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { fetchDevicePhoneProfile, saveDevicePhoneNumber } from '../api/deviceProfile';
import { registerDeviceIntelligence } from '../api/usersIntelligence';
import { useOsmaniApp } from '../context/OsmaniAppContext';
import { readLocalPhoneSavedFlag, writeLocalPhoneSaved } from '../lib/devicePhoneCache';
import { isValidInternationalPhone } from '../lib/internationalPhone';
import { subscribeRealtimeEvent } from '../lib/realtimeSync';
import { logStartupStep } from '../lib/startupStepLog';

const BG = '#0C0608';
const ACCENT = '#FFCB3D';
const MUTED = '#A1A8B5';

/**
 * Phone/profile verification runs silently in the background.
 * Home renders immediately; phone capture appears only as a modal when required.
 *
 * @param {{ children: React.ReactNode }} props
 */
export default function PhoneNumberGate({ children }) {
  const { phoneNumberGateEnabled, refreshSettingsOnly } = useOsmaniApp();
  const [phoneModalVisible, setPhoneModalVisible] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [phoneInput, setPhoneInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [remoteGateEnabled, setRemoteGateEnabled] = useState(true);

  const gateEnabled = phoneNumberGateEnabled !== false && remoteGateEnabled !== false;

  const runProfileCheck = useCallback(async () => {
    if (!gateEnabled) {
      logStartupStep('phone_gate', 'skip', { reason: 'gate_disabled' });
      setPhoneModalVisible(false);
      return;
    }

    logStartupStep('phone_gate', 'start');

    try {
      logStartupStep('device_profile', 'start');
      const result = await fetchDevicePhoneProfile();
      logStartupStep('device_profile', result.ok ? 'ok' : 'fail', {
        hasPhone: result.hasPhone,
        status: result.status ?? null,
        error: result.error ?? null,
      });

      if (result.phoneGateEnabled === false) {
        setRemoteGateEnabled(false);
        logStartupStep('phone_gate', 'skip', { reason: 'remote_gate_off' });
        setPhoneModalVisible(false);
        return;
      }
      setRemoteGateEnabled(true);

      if (result.ok && result.hasPhone) {
        await writeLocalPhoneSaved(result.phoneNumber || '');
        logStartupStep('phone_gate', 'ok', { reason: 'has_phone' });
        setPhoneModalVisible(false);
        return;
      }

      if (result.ok && !result.hasPhone) {
        logStartupStep('phone_gate', 'ok', { reason: 'phone_required_modal' });
        setPhoneModalVisible(true);
        return;
      }

      if (result.status === 404) {
        logStartupStep('phone_gate', 'skip', { reason: 'profile_404' });
        setPhoneModalVisible(false);
        return;
      }

      const localSaved = await readLocalPhoneSavedFlag();
      if (localSaved) {
        logStartupStep('phone_gate', 'ok', { reason: 'local_saved_fallback' });
        setPhoneModalVisible(false);
        return;
      }

      logStartupStep('phone_gate', 'fail', { reason: 'profile_error', error: result.error });
    } catch (e) {
      console.error('[PHONE_GATE]', 'check_unhandled', e?.message ?? e);
      logStartupStep('phone_gate', 'fail', {
        message: String(e?.message ?? e),
        stack: typeof e?.stack === 'string' ? e.stack : null,
      });
      try {
        const localSaved = await readLocalPhoneSavedFlag();
        if (localSaved) {
          setPhoneModalVisible(false);
          return;
        }
      } catch {
        /* ignore */
      }
    }
  }, [gateEnabled]);

  useEffect(() => {
    void runProfileCheck();
  }, [runProfileCheck]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void refreshSettingsOnly('phone_gate_resume');
        void runProfileCheck();
      }
    });
    const offSettings = subscribeRealtimeEvent('config.settings_changed', () => {
      void refreshSettingsOnly('phone_gate_sse');
      void runProfileCheck();
    });
    const offModes = subscribeRealtimeEvent('app_settings_changed', () => {
      void refreshSettingsOnly('phone_gate_sse_modes');
      void runProfileCheck();
    });
    const offPhoneGate = subscribeRealtimeEvent('phone_gate_changed', (payload) => {
      const enabled =
        payload?.phone_gate_enabled !== false && payload?.phoneGateEnabled !== false;
      setRemoteGateEnabled(enabled);
      void runProfileCheck();
    });
    return () => {
      sub.remove();
      offSettings();
      offModes();
      offPhoneGate();
    };
  }, [refreshSettingsOnly, runProfileCheck]);

  const onSubmitPhone = useCallback(async () => {
    if (saving) return;
    if (!isValidInternationalPhone(phoneInput)) {
      setErrorMessage('Weka nambari sahihi ya simu (kimataifa).');
      return;
    }
    setSaving(true);
    setErrorMessage('');
    try {
      const saved = await saveDevicePhoneNumber(phoneInput);
      if (!saved.ok) {
        setErrorMessage(saved.error || 'Imeshindikana kuhifadhi nambari ya simu.');
        return;
      }
      await writeLocalPhoneSaved(saved.phoneNumber || '');
      void registerDeviceIntelligence();
      setPhoneModalVisible(false);
      logStartupStep('phone_gate', 'ok', { reason: 'phone_saved' });
    } catch (e) {
      console.error('[PHONE_GATE]', 'save_unhandled', e?.message ?? e);
      setErrorMessage('Imeshindikana kuhifadhi nambari ya simu.');
    } finally {
      setSaving(false);
    }
  }, [phoneInput, saving]);

  return (
    <>
      {children}
      <Modal
        visible={gateEnabled && phoneModalVisible}
        animationType="slide"
        presentationStyle="fullScreen"
        onRequestClose={() => {}}
      >
        <SafeAreaView style={styles.screen}>
          <KeyboardAvoidingView
            style={styles.flex}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          >
            <View style={styles.content}>
              <Text style={styles.title}>Nambari ya Simu</Text>
              <Text style={styles.message}>
                Weka nambari yako ya simu ili kuendelea kutumia Osmani TV. Unaweza kutumia nambari
                ya nchi yoyote duniani.
              </Text>
              <TextInput
                value={phoneInput}
                onChangeText={(t) => {
                  setPhoneInput(t);
                  if (errorMessage) setErrorMessage('');
                }}
                placeholder="+255712345678 au 0712345678"
                placeholderTextColor="#6B7280"
                keyboardType="phone-pad"
                autoComplete="tel"
                textContentType="telephoneNumber"
                editable={!saving}
                style={styles.input}
              />
              {errorMessage ? <Text style={styles.errorText}>{errorMessage}</Text> : null}
              <Pressable
                style={[styles.primaryBtn, saving ? styles.primaryBtnDisabled : null]}
                disabled={saving}
                onPress={() => void onSubmitPhone()}
              >
                {saving ? (
                  <ActivityIndicator color="#111827" />
                ) : (
                  <Text style={styles.primaryBtnText}>ENDELEA</Text>
                )}
              </Pressable>
            </View>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  screen: {
    flex: 1,
    backgroundColor: BG,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
    gap: 14,
  },
  title: {
    color: '#FFFFFF',
    fontSize: 24,
    fontWeight: '800',
    textAlign: 'center',
  },
  message: {
    color: MUTED,
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
  },
  input: {
    marginTop: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: Platform.OS === 'ios' ? 14 : 12,
    color: '#FFFFFF',
    fontSize: 17,
    backgroundColor: '#151014',
  },
  errorText: {
    color: '#FCA5A5',
    fontSize: 13,
    textAlign: 'center',
  },
  primaryBtn: {
    marginTop: 8,
    backgroundColor: ACCENT,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 50,
  },
  primaryBtnDisabled: {
    opacity: 0.7,
  },
  primaryBtnText: {
    color: '#111827',
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
});
