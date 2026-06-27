import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  KeyboardAvoidingView,
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

const BG = '#0C0608';
const ACCENT = '#FFCB3D';
const MUTED = '#A1A8B5';

/**
 * Mandatory phone capture before Home. Blocks navigation children until complete.
 * @param {{ children: React.ReactNode }} props
 */
export default function PhoneNumberGate({ children }) {
  const { phoneNumberGateEnabled, refreshSettingsOnly } = useOsmaniApp();
  const [phase, setPhase] = useState('checking');
  const [statusMessage, setStatusMessage] = useState('Inakagua nambari ya simu…');
  const [errorMessage, setErrorMessage] = useState('');
  const [phoneInput, setPhoneInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [remoteGateEnabled, setRemoteGateEnabled] = useState(true);

  const gateEnabled = phoneNumberGateEnabled !== false && remoteGateEnabled !== false;

  const runProfileCheck = useCallback(async () => {
    if (!gateEnabled) {
      setPhase('ready');
      return;
    }
    setPhase('checking');
    setStatusMessage('Inakagua nambari ya simu…');
    setErrorMessage('');

    const result = await fetchDevicePhoneProfile();
    if (result.phoneGateEnabled === false) {
      setRemoteGateEnabled(false);
      setPhase('ready');
      return;
    }
    setRemoteGateEnabled(true);

    if (result.ok && result.hasPhone) {
      await writeLocalPhoneSaved(result.phoneNumber || '');
      setPhase('ready');
      return;
    }

    if (result.ok && !result.hasPhone) {
      setPhase('required');
      return;
    }

    if (result.status === 404) {
      setPhase('error');
      setErrorMessage('Huduma ya nambari ya simu haijawashwa kwenye seva. Jaribu tena baadae.');
      return;
    }

    const localSaved = await readLocalPhoneSavedFlag();
    if (localSaved) {
      setPhase('ready');
      return;
    }

    setPhase('error');
    setErrorMessage(result.error || 'Imeshindikana kuangalia nambari ya simu.');
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
    setStatusMessage('Inahifadhi nambari ya simu…');
    try {
      const saved = await saveDevicePhoneNumber(phoneInput);
      if (!saved.ok) {
        setErrorMessage(saved.error || 'Imeshindikana kuhifadhi nambari ya simu.');
        return;
      }
      await writeLocalPhoneSaved(saved.phoneNumber || '');
      void registerDeviceIntelligence();
      setPhase('ready');
    } finally {
      setSaving(false);
    }
  }, [phoneInput, saving]);

  if (!gateEnabled || phase === 'ready') {
    return children;
  }

  if (phase === 'checking') {
    return (
      <View style={styles.centerScreen}>
        <ActivityIndicator color={ACCENT} size="large" />
        <Text style={styles.statusText}>{statusMessage}</Text>
      </View>
    );
  }

  if (phase === 'error') {
    return (
      <View style={styles.centerScreen}>
        <Text style={styles.title}>Hitilafu ya mtandao</Text>
        <Text style={styles.message}>{errorMessage}</Text>
        <Pressable style={styles.primaryBtn} onPress={() => void runProfileCheck()}>
          <Text style={styles.primaryBtnText}>Jaribu tena</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.screen}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.content}>
          <Text style={styles.title}>Nambari ya Simu</Text>
          <Text style={styles.message}>
            Weka nambari yako ya simu ili kuendelea kutumia Osmani TV. Unaweza kutumia nambari ya
            nchi yoyote duniani.
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
          {saving ? <Text style={styles.statusText}>Inahifadhi nambari ya simu…</Text> : null}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  screen: {
    flex: 1,
    backgroundColor: BG,
  },
  centerScreen: {
    flex: 1,
    backgroundColor: BG,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
    gap: 14,
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
  statusText: {
    color: MUTED,
    fontSize: 14,
    textAlign: 'center',
    marginTop: 4,
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
