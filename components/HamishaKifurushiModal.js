import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useOsmaniApp } from '../context/OsmaniAppContext';
import { getDeviceIdentity } from '../lib/deviceIdentity';
import { initiateTransfer, redeemTransfer } from '../api/subscription';

const COLORS = {
  background: '#111215',
  card: '#1A1D23',
  yellow: '#FFCB3D',
  mutedText: '#A1A8B5',
  white: '#FFFFFF',
};

const MODAL_W = '85%';
const MODAL_MAX_W = 400;

const GRADIENT_CTA = [COLORS.yellow, '#E5A020'];

const BULLETS = [
  'Tengeneza code ya kuhamisha kifurushi kwenda kifaa kingine.',
  'Code inaisha baada ya muda mfupi — itumie haraka.',
  'Kifaa cha asili kitapokea ujumbe wa uthibitisho na kupoteza ufikiaji.',
  'Kifaa kipya kitapata muda uliobaki wa kifurushi mara moja.',
];

const STEPS = Object.freeze({
  CHOOSE: 'choose',
  GENERATE: 'generate',
  REDEEM: 'redeem',
  REDEEMED: 'redeemed',
});

export default function HamishaKifurushiModal({ visible, onClose }) {
  const { height: windowHeight } = useWindowDimensions();
  const cardMaxHeight = windowHeight * 0.85;
  const { reverifySubscription } = useOsmaniApp();

  const [step, setStep] = useState(STEPS.CHOOSE);
  const [code, setCode] = useState('');
  const [generatedCode, setGeneratedCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const opacity = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(0.92)).current;

  const runEnterAnim = useCallback(() => {
    opacity.setValue(0);
    scale.setValue(0.92);
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration: 220,
        useNativeDriver: true,
      }),
      Animated.spring(scale, {
        toValue: 1,
        friction: 7,
        tension: 80,
        useNativeDriver: true,
      }),
    ]).start();
  }, [opacity, scale]);

  useEffect(() => {
    if (visible) {
      setStep(STEPS.CHOOSE);
      setCode('');
      setGeneratedCode('');
      setBusy(false);
      setError('');
      runEnterAnim();
    }
  }, [visible, runEnterAnim]);

  const close = useCallback(() => {
    onClose?.();
  }, [onClose]);

  const handleGenerate = useCallback(async () => {
    setBusy(true);
    setError('');
    try {
      const { deviceId, deviceFingerprint } = await getDeviceIdentity();
      const r = await initiateTransfer(deviceId, deviceFingerprint);
      setGeneratedCode(r.code);
      setStep(STEPS.GENERATE);
    } catch (e) {
      const msg = e?.message ?? String(e ?? 'unknown_error');
      setError(msg);
    } finally {
      setBusy(false);
    }
  }, []);

  const handleRedeem = useCallback(async () => {
    const c = code.trim();
    if (!c) {
      setError('Weka code ya uhamisho.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const { deviceId, deviceFingerprint } = await getDeviceIdentity();
      const r = await redeemTransfer(c, deviceId, deviceFingerprint);
      if (r?.active === true) {
        setStep(STEPS.REDEEMED);
        await reverifySubscription?.('transfer-redeem');
      } else {
        setError('Code haijafanikiwa. Hakikisha umeingiza code sahihi.');
      }
    } catch (e) {
      const msg = e?.message ?? String(e ?? 'unknown_error');
      setError(msg);
    } finally {
      setBusy(false);
    }
  }, [code, reverifySubscription]);

  const copyGeneratedCode = useCallback(async () => {
    if (!generatedCode) return;
    await Clipboard.setStringAsync(generatedCode);
    Alert.alert('', 'Code imenakiliwa');
  }, [generatedCode]);

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={close}>
      <KeyboardAvoidingView
        style={styles.kav}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Pressable style={styles.backdropPress} onPress={close}>
          <BlurView intensity={45} tint="dark" style={StyleSheet.absoluteFill} />
          <View style={styles.dimOverlay} />
          <View style={styles.centerContent} pointerEvents="box-none">
            <Pressable onPress={() => {}} style={styles.cardHitArea}>
              <Animated.View
                style={[
                  styles.card,
                  { maxHeight: cardMaxHeight, opacity, transform: [{ scale }] },
                ]}
              >
                <Pressable style={styles.closeBtn} onPress={close} hitSlop={12}>
                  <Ionicons name="close" size={26} color={COLORS.white} />
                </Pressable>

                {step === STEPS.CHOOSE ? (
                  <View style={styles.stepColumn}>
                    <Text style={styles.stepTitleCenter}>HAMISHA KIFURUSHI</Text>
                    <View style={styles.bulletBlock}>
                      {BULLETS.map((line) => (
                        <Text key={line} style={styles.bulletLine}>
                          {'\u2022'} {line}
                        </Text>
                      ))}
                    </View>
                    {error ? <Text style={styles.errorText}>{error}</Text> : null}
                    <View style={styles.actionsBlock}>
                      <Pressable
                        style={[styles.primaryWrap, busy && styles.btnDisabled]}
                        onPress={handleGenerate}
                        disabled={busy}
                      >
                        <LinearGradient
                          colors={GRADIENT_CTA}
                          start={{ x: 0, y: 0.5 }}
                          end={{ x: 1, y: 0.5 }}
                          style={styles.primaryGradient}
                        >
                          {busy ? (
                            <ActivityIndicator color="#111827" />
                          ) : (
                            <Text style={styles.primaryText}>TENGENEZA CODE YA UHAMISHO</Text>
                          )}
                        </LinearGradient>
                      </Pressable>
                      <Pressable
                        style={styles.secondaryBtn}
                        onPress={() => {
                          setError('');
                          setStep(STEPS.REDEEM);
                        }}
                      >
                        <Text style={styles.secondaryText}>Nina code ya kuhamisha</Text>
                      </Pressable>
                    </View>
                  </View>
                ) : null}

                {step === STEPS.GENERATE ? (
                  <View style={styles.stepColumn}>
                    <Text style={styles.stepTitleLeft}>Code ya Uhamisho</Text>
                    <Text style={styles.desc}>
                      Andika au nakili code hii kwenye kifaa kipya, kisha bonyeza
                      <Text style={styles.descBold}> {'"Nina code ya kuhamisho"'}</Text>.
                    </Text>
                    <View style={styles.codeBox}>
                      <Text style={styles.codeText} selectable>
                        {generatedCode}
                      </Text>
                    </View>
                    <View style={styles.actionsBlockStep2}>
                      <Pressable style={styles.primaryWrap} onPress={copyGeneratedCode}>
                        <LinearGradient
                          colors={GRADIENT_CTA}
                          start={{ x: 0, y: 0.5 }}
                          end={{ x: 1, y: 0.5 }}
                          style={styles.primaryGradient}
                        >
                          <Text style={styles.primaryText}>NAKILI CODE</Text>
                        </LinearGradient>
                      </Pressable>
                      <Pressable style={styles.secondaryBtn} onPress={close}>
                        <Text style={styles.secondaryText}>Funga</Text>
                      </Pressable>
                    </View>
                  </View>
                ) : null}

                {step === STEPS.REDEEM ? (
                  <View style={styles.stepColumn}>
                    <Text style={styles.stepTitleLeft}>Ingiza Code ya Uhamisho</Text>
                    <Text style={styles.desc}>
                      Weka code uliyopata kutoka kifaa cha asili ili kuhamisha
                      kifurushi kwenye simu hii.
                    </Text>
                    <TextInput
                      style={styles.input}
                      placeholder="Code"
                      placeholderTextColor="#6B7280"
                      autoCapitalize="characters"
                      autoCorrect={false}
                      value={code}
                      onChangeText={(t) => {
                        setError('');
                        setCode(t.toUpperCase());
                      }}
                    />
                    {error ? <Text style={styles.errorText}>{error}</Text> : null}
                    <View style={styles.actionsBlockStep2}>
                      <Pressable
                        style={[styles.primaryWrap, busy && styles.btnDisabled]}
                        onPress={handleRedeem}
                        disabled={busy}
                      >
                        <LinearGradient
                          colors={GRADIENT_CTA}
                          start={{ x: 0, y: 0.5 }}
                          end={{ x: 1, y: 0.5 }}
                          style={styles.primaryGradient}
                        >
                          {busy ? (
                            <ActivityIndicator color="#111827" />
                          ) : (
                            <Text style={styles.primaryText}>THIBITISHA</Text>
                          )}
                        </LinearGradient>
                      </Pressable>
                      <Pressable
                        style={styles.secondaryBtn}
                        onPress={() => {
                          setError('');
                          setStep(STEPS.CHOOSE);
                        }}
                      >
                        <Text style={styles.secondaryText}>Rudi</Text>
                      </Pressable>
                    </View>
                  </View>
                ) : null}

                {step === STEPS.REDEEMED ? (
                  <View style={styles.stepColumn}>
                    <Text style={styles.stepTitleCenter}>Umefanikiwa</Text>
                    <Text style={styles.desc}>
                      Kifurushi kimehamishwa kwenye simu hii. Sasa unaweza kutazama channel zote
                      za kulipia.
                    </Text>
                    <View style={styles.actionsBlock}>
                      <Pressable style={styles.primaryWrap} onPress={close}>
                        <LinearGradient
                          colors={GRADIENT_CTA}
                          start={{ x: 0, y: 0.5 }}
                          end={{ x: 1, y: 0.5 }}
                          style={styles.primaryGradient}
                        >
                          <Text style={styles.primaryText}>SAWA</Text>
                        </LinearGradient>
                      </Pressable>
                    </View>
                  </View>
                ) : null}
              </Animated.View>
            </Pressable>
          </View>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  kav: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  backdropPress: {
    ...StyleSheet.absoluteFillObject,
  },
  dimOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  centerContent: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  cardHitArea: {
    width: MODAL_W,
    maxWidth: MODAL_MAX_W,
    alignSelf: 'center',
    alignItems: 'stretch',
  },
  card: {
    width: '100%',
    backgroundColor: COLORS.card,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(250,204,21,0.12)',
    padding: 20,
    elevation: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.35,
    shadowRadius: 16,
  },
  closeBtn: {
    position: 'absolute',
    top: 16,
    right: 16,
    zIndex: 10,
    padding: 4,
  },
  stepColumn: {
    width: '100%',
    paddingTop: 40,
  },
  stepTitleCenter: {
    color: COLORS.white,
    fontSize: 17,
    fontWeight: '800',
    textAlign: 'center',
    marginBottom: 16,
    letterSpacing: 0.5,
    width: '100%',
  },
  stepTitleLeft: {
    color: COLORS.white,
    fontSize: 17,
    fontWeight: '800',
    textAlign: 'left',
    marginBottom: 12,
    width: '100%',
  },
  bulletBlock: {
    width: '100%',
    marginBottom: 20,
  },
  bulletLine: {
    color: COLORS.mutedText,
    fontSize: 14,
    lineHeight: 22,
    marginBottom: 12,
    textAlign: 'left',
    width: '100%',
  },
  desc: {
    color: COLORS.mutedText,
    fontSize: 14,
    lineHeight: 22,
    marginBottom: 16,
    textAlign: 'left',
    width: '100%',
  },
  descBold: {
    color: COLORS.white,
    fontWeight: '700',
  },
  input: {
    alignSelf: 'stretch',
    width: '100%',
    backgroundColor: '#1F2229',
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 18,
    letterSpacing: 2,
    color: COLORS.white,
    marginBottom: 12,
  },
  errorText: {
    color: '#FCA5A5',
    fontSize: 13,
    marginBottom: 12,
  },
  codeBox: {
    backgroundColor: '#1F2229',
    borderWidth: 1,
    borderColor: 'rgba(255,203,61,0.25)',
    borderRadius: 14,
    paddingVertical: 22,
    paddingHorizontal: 16,
    alignItems: 'center',
    marginBottom: 18,
  },
  codeText: {
    color: COLORS.yellow,
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: 4,
  },
  actionsBlock: {
    width: '100%',
    alignSelf: 'stretch',
    alignItems: 'stretch',
  },
  actionsBlockStep2: {
    width: '100%',
    alignSelf: 'stretch',
    alignItems: 'stretch',
  },
  primaryWrap: {
    alignSelf: 'stretch',
    width: '100%',
    borderRadius: 16,
    overflow: 'hidden',
    elevation: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
  },
  primaryGradient: {
    width: '100%',
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryText: {
    color: '#111827',
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  secondaryBtn: {
    width: '100%',
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
  },
  secondaryText: {
    color: COLORS.yellow,
    fontSize: 14,
    fontWeight: '700',
    textAlign: 'center',
  },
  btnDisabled: {
    opacity: 0.7,
  },
});
