import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  card: '#151922',
  input: '#1D222C',
  yellow: '#FFCB3D',
  yellowDark: '#E5A020',
  mutedText: '#A1A8B5',
  white: '#FFFFFF',
  border: 'rgba(255,255,255,0.08)',
};

const MODAL_W = '88%';
const MODAL_MAX_W = 392;
const TRANSFER_CODE_SECONDS = 120;

const GRADIENT_CTA = [COLORS.yellow, COLORS.yellowDark];

/**
 * Simple device-transfer flow:
 *   INTRO     → introduction copy + "ENDELEA KUHAMISHA"
 *   PHONE     → enter source phone, fetch one-time code
 *   GENERATED → display code + countdown for the receiving device
 *   REDEEM    → enter code on the receiving device
 *   REDEEMED  → activation success
 *
 * No approve/reject popup, no waiting state, no SSE handshake — the
 * backend rebinds ownership directly on POST /api/transfer/confirm.
 */
const STEPS = Object.freeze({
  INTRO: 'intro',
  PHONE: 'phone',
  GENERATED: 'generated',
  REDEEM: 'redeem',
  REDEEMED: 'redeemed',
});

function formatTimer(totalSeconds) {
  const safe = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function normalizePhone(raw) {
  return String(raw || '').replace(/[^\d]/g, '').slice(0, 10);
}

export default function HamishaKifurushiModal({ visible, onClose }) {
  const { height: windowHeight } = useWindowDimensions();
  const cardMaxHeight = windowHeight * 0.82;
  const { reverifySubscription, revokedReason, isSubscribed } = useOsmaniApp();

  const [step, setStep] = useState(STEPS.INTRO);
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [generatedCode, setGeneratedCode] = useState('');
  const [remainingSeconds, setRemainingSeconds] = useState(TRANSFER_CODE_SECONDS);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  /**
   * Manual countdown ref. The interval-based effect below already
   * clears itself on visibility/step change, but we keep this ref so
   * the revoke watcher can `clearInterval` defensively the instant the
   * backend tells us this device lost access — no leaked tick can drag
   * us into a negative state if the effect cleanup is delayed.
   */
  const countdownIntervalRef = useRef(null);

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
      setStep(STEPS.INTRO);
      setPhone('');
      setCode('');
      setGeneratedCode('');
      setRemainingSeconds(TRANSFER_CODE_SECONDS);
      setBusy(false);
      setError('');
      runEnterAnim();
    }
  }, [visible, runEnterAnim]);

  const close = useCallback(() => {
    onClose?.();
  }, [onClose]);

  useEffect(() => {
    if (!visible || step !== STEPS.GENERATED || !generatedCode) return undefined;
    setRemainingSeconds(TRANSFER_CODE_SECONDS);
    const timer = setInterval(() => {
      setRemainingSeconds((prev) => Math.max(0, prev - 1));
    }, 1000);
    countdownIntervalRef.current = timer;
    return () => {
      clearInterval(timer);
      if (countdownIntervalRef.current === timer) {
        countdownIntervalRef.current = null;
      }
    };
  }, [visible, step, generatedCode]);

  /**
   * Revoke watcher.
   *
   * The moment the backend reports this device lost access (via
   * `subscription_revoked` or `transfer_completed` SSE, or any verify
   * tick that returns active=false), tear down the local transfer flow:
   *   - stop the countdown interval defensively
   *   - clear all transfer-related state (code, generatedCode, phone,
   *     step, error)
   *   - close the modal so the global `TransferredAwayModal` ("Kifurushi
   *     Kimehamishwa" + LIPIA TENA) becomes the sole foreground UI
   *
   * Skip when the modal is not visible (no UI to dismiss) or already on
   * the success screen (REDEEMED is a target-side outcome and does NOT
   * imply the source revoke path).
   */
  useEffect(() => {
    if (!visible) return;
    const revoked = Boolean(revokedReason) || isSubscribed === false;
    if (!revoked) return;
    if (step === STEPS.REDEEMED) return;
    console.log('[HAMISHA_MODAL]', 'revoke_detected', {
      revokedReason,
      isSubscribed,
      step,
      hadGeneratedCode: Boolean(generatedCode),
    });
    if (countdownIntervalRef.current) {
      clearInterval(countdownIntervalRef.current);
      countdownIntervalRef.current = null;
      console.log('[HAMISHA_MODAL]', 'countdown_timer_cleared');
    }
    setRemainingSeconds(0);
    setGeneratedCode('');
    setCode('');
    setPhone('');
    setError('');
    setBusy(false);
    setStep(STEPS.INTRO);
    console.log('[HAMISHA_MODAL]', 'transfer_state_cleared');
    onClose?.();
    console.log('[HAMISHA_MODAL]', 'modal_closed_for_revoked_state');
  }, [visible, revokedReason, isSubscribed, step, generatedCode, onClose]);

  const isPhoneValid = useMemo(() => /^0[67]\d{8}$/.test(phone), [phone]);
  const redeemCode = code.trim();
  const isRedeemCodeValid = /^\d{6}$/.test(redeemCode);

  const handleGenerate = useCallback(async () => {
    if (!isPhoneValid) {
      setError('Weka namba sahihi ya simu.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const { deviceId, deviceFingerprint } = await getDeviceIdentity();
      const r = await initiateTransfer(deviceId, deviceFingerprint, phone);
      setGeneratedCode(r.code);
      setRemainingSeconds(TRANSFER_CODE_SECONDS);
      setStep(STEPS.GENERATED);
    } catch (e) {
      const msg = e?.message ?? String(e ?? 'unknown_error');
      setError(msg);
    } finally {
      setBusy(false);
    }
  }, [isPhoneValid, phone]);

  /**
   * Direct activation. The backend rebinds ownership on a successful
   * confirm, so we just verify and flip to REDEEMED if the backend
   * agrees we are now active. No waiting, no SSE.
   */
  const handleRedeem = useCallback(async () => {
    if (!isRedeemCodeValid) {
      setError('Weka code sahihi ya tarakimu 6.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const { deviceId, deviceFingerprint } = await getDeviceIdentity();
      const r = await redeemTransfer(redeemCode, deviceId, deviceFingerprint);
      if (r?.active === true) {
        setStep(STEPS.REDEEMED);
        try {
          await reverifySubscription?.('transfer-redeem');
        } catch {}
        return;
      }
      setError('Code haijafanikiwa. Hakikisha umeingiza code sahihi.');
    } catch (e) {
      const msg = e?.message ?? String(e ?? 'unknown_error');
      setError(msg);
    } finally {
      setBusy(false);
    }
  }, [isRedeemCodeValid, redeemCode, reverifySubscription]);

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

                {step === STEPS.INTRO ? (
                  <View style={styles.stepColumn}>
                    <View style={styles.iconHalo}>
                      <View style={styles.iconCircle}>
                        <Ionicons name="swap-horizontal" size={28} color="#111827" />
                      </View>
                    </View>
                    <Text style={styles.stepTitleCenter}>HAMISHA KIFURUSHI</Text>
                    <Text style={styles.introLead}>
                      Unaweza kuhamisha kifurushi chako kwenda simu nyingine.
                    </Text>
                    <Text style={styles.bulletLine}>• Simu ya zamani itapoteza ufikiaji mara moja.</Text>
                    <Text style={styles.bulletLine}>• Simu mpya itaanza kutumia kifurushi mara moja.</Text>
                    <Text style={styles.bulletLine}>
                      • Muda uliobaki wa kifurushi utaendelea kwenye simu mpya.
                    </Text>
                    {error ? <Text style={styles.errorText}>{error}</Text> : null}
                    <View style={styles.actionsBlockIntro}>
                      <Pressable
                        style={styles.primaryWrap}
                        onPress={() => {
                          setError('');
                          setStep(STEPS.PHONE);
                        }}
                      >
                        <LinearGradient
                          colors={GRADIENT_CTA}
                          start={{ x: 0, y: 0.5 }}
                          end={{ x: 1, y: 0.5 }}
                          style={styles.primaryGradient}
                        >
                          <Text style={styles.primaryText}>ENDELEA KUHAMISHA</Text>
                        </LinearGradient>
                      </Pressable>
                    </View>
                  </View>
                ) : null}

                {step === STEPS.PHONE ? (
                  <View style={styles.stepColumn}>
                    <View style={styles.iconHaloSmall}>
                      <View style={styles.iconCircleSmall}>
                        <Ionicons name="call" size={22} color="#111827" />
                      </View>
                    </View>
                    <Text style={styles.stepTitleCenter}>Hamisha Kifurushi</Text>
                    <Text style={styles.descCenter}>
                      Weka namba ya simu uliyolipia kifurushi.{'\n'}
                      Tutakutumia code ya kuhamisha.
                    </Text>
                    <TextInput
                      style={styles.phoneInput}
                      placeholder="06XXXXXXXX au 07XXXXXXXX"
                      placeholderTextColor="#6B7280"
                      keyboardType="phone-pad"
                      maxLength={10}
                      value={phone}
                      onChangeText={(t) => {
                        setError('');
                        setPhone(normalizePhone(t));
                      }}
                    />
                    {error ? <Text style={styles.errorText}>{error}</Text> : null}
                    <View style={styles.actionsBlockStep}>
                      <Pressable
                        style={[styles.primaryWrap, (!isPhoneValid || busy) && styles.btnDisabled]}
                        onPress={handleGenerate}
                        disabled={!isPhoneValid || busy}
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
                            <Text style={styles.primaryText}>PATA CODE</Text>
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
                        <Text style={styles.secondaryText}>Nina code tayari</Text>
                      </Pressable>
                    </View>
                  </View>
                ) : null}

                {step === STEPS.GENERATED ? (
                  <View style={styles.stepColumn}>
                    <View style={styles.iconHaloSmall}>
                      <View style={styles.iconCircleSmall}>
                        <Ionicons name="keypad" size={22} color="#111827" />
                      </View>
                    </View>
                    <Text style={styles.stepTitleCenter}>Code ya Uhamisho</Text>
                    <Text style={styles.descCenter}>
                      Tumia code hii kwenye simu nyingine.{'\n'}
                      Code itaisha baada ya dakika 2.
                    </Text>
                    <View style={styles.codeBox}>
                      <Text style={styles.codeText} selectable>
                        {generatedCode}
                      </Text>
                    </View>
                    <Pressable style={styles.copyPill} onPress={copyGeneratedCode}>
                      <Ionicons name="copy-outline" size={17} color={COLORS.yellow} />
                      <Text style={styles.copyPillText}>Nakili Code</Text>
                    </Pressable>
                    <Text style={styles.countdownLabel}>Muda uliobaki</Text>
                    <Text style={styles.countdownText}>{formatTimer(remainingSeconds)}</Text>
                    {remainingSeconds <= 0 ? (
                      <Text style={styles.errorText}>Code imeisha muda. Tengeneza code mpya.</Text>
                    ) : null}
                    <View style={styles.actionsBlockStep}>
                      <Pressable
                        style={styles.primaryWrap}
                        onPress={() => {
                          setError('');
                          close();
                        }}
                      >
                        <LinearGradient
                          colors={GRADIENT_CTA}
                          start={{ x: 0, y: 0.5 }}
                          end={{ x: 1, y: 0.5 }}
                          style={styles.primaryGradient}
                        >
                          <Text style={styles.primaryText}>NIMETUMA CODE</Text>
                        </LinearGradient>
                      </Pressable>
                    </View>
                  </View>
                ) : null}

                {step === STEPS.REDEEM ? (
                  <View style={styles.stepColumn}>
                    <View style={styles.iconHaloSmall}>
                      <View style={styles.iconCircleSmall}>
                        <Ionicons name="lock-open" size={22} color="#111827" />
                      </View>
                    </View>
                    <Text style={styles.stepTitleCenter}>Weka Code</Text>
                    <Text style={styles.descCenter}>
                      Weka code ya tarakimu 6 uliyoipata kutoka simu ya zamani.
                    </Text>
                    <TextInput
                      style={styles.codeInput}
                      placeholder="000000"
                      placeholderTextColor="#6B7280"
                      keyboardType="number-pad"
                      maxLength={6}
                      value={code}
                      onChangeText={(t) => {
                        setError('');
                        setCode(t.replace(/[^\d]/g, '').slice(0, 6));
                      }}
                    />
                    {error ? <Text style={styles.errorText}>{error}</Text> : null}
                    <View style={styles.actionsBlockStep}>
                      <Pressable
                        style={[styles.primaryWrap, (!isRedeemCodeValid || busy) && styles.btnDisabled]}
                        onPress={handleRedeem}
                        disabled={!isRedeemCodeValid || busy}
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
                            <Text style={styles.primaryText}>THIBITISHA UHAMISHO</Text>
                          )}
                        </LinearGradient>
                      </Pressable>
                      <Pressable
                        style={styles.secondaryBtn}
                        onPress={() => {
                          setError('');
                          setStep(STEPS.PHONE);
                        }}
                      >
                        <Text style={styles.secondaryText}>Rudi nyuma</Text>
                      </Pressable>
                    </View>
                  </View>
                ) : null}

                {step === STEPS.REDEEMED ? (
                  <View style={styles.stepColumn}>
                    <View style={styles.successCircle}>
                      <Ionicons name="checkmark" size={30} color="#111827" />
                    </View>
                    <Text style={styles.stepTitleCenter}>Umefanikiwa</Text>
                    <Text style={styles.descCenter}>
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
    backgroundColor: 'rgba(0,0,0,0.58)',
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
    borderRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(255,203,61,0.18)',
    paddingHorizontal: 22,
    paddingTop: 24,
    paddingBottom: 22,
    elevation: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.35,
    shadowRadius: 16,
  },
  closeBtn: {
    position: 'absolute',
    top: 14,
    right: 14,
    zIndex: 10,
    padding: 4,
  },
  stepColumn: {
    width: '100%',
    paddingTop: 18,
    alignItems: 'stretch',
  },
  iconHalo: {
    alignSelf: 'center',
    width: 78,
    height: 78,
    borderRadius: 39,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
    backgroundColor: 'rgba(255,203,61,0.12)',
  },
  iconCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.yellow,
    shadowColor: COLORS.yellow,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.65,
    shadowRadius: 12,
    elevation: 8,
  },
  iconHaloSmall: {
    alignSelf: 'center',
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
    backgroundColor: 'rgba(255,203,61,0.12)',
  },
  iconCircleSmall: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.yellow,
  },
  stepTitleCenter: {
    color: COLORS.white,
    fontSize: 22,
    fontWeight: '800',
    textAlign: 'center',
    marginBottom: 12,
    letterSpacing: 0.5,
    width: '100%',
  },
  introLead: {
    color: '#E5E7EB',
    fontSize: 15,
    lineHeight: 23,
    textAlign: 'center',
    marginBottom: 22,
    paddingHorizontal: 4,
  },
  bulletLine: {
    color: '#F3F4F6',
    fontSize: 14,
    lineHeight: 23,
    marginBottom: 14,
    textAlign: 'left',
    width: '100%',
  },
  descCenter: {
    color: '#D1D5DB',
    fontSize: 14,
    lineHeight: 22,
    marginBottom: 22,
    textAlign: 'center',
    width: '100%',
  },
  phoneInput: {
    alignSelf: 'stretch',
    width: '100%',
    backgroundColor: COLORS.input,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: 16,
    paddingVertical: 16,
    fontSize: 17,
    letterSpacing: 0.4,
    color: COLORS.white,
    marginBottom: 14,
    textAlign: 'center',
  },
  codeInput: {
    alignSelf: 'stretch',
    width: '100%',
    backgroundColor: COLORS.input,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: 16,
    paddingVertical: 16,
    fontSize: 28,
    letterSpacing: 9,
    color: COLORS.white,
    marginBottom: 14,
    textAlign: 'center',
    fontWeight: '800',
  },
  errorText: {
    color: '#FCA5A5',
    fontSize: 13,
    lineHeight: 19,
    marginBottom: 12,
    textAlign: 'center',
  },
  codeBox: {
    backgroundColor: COLORS.input,
    borderWidth: 1,
    borderColor: 'rgba(255,203,61,0.35)',
    borderRadius: 18,
    paddingVertical: 24,
    paddingHorizontal: 16,
    alignItems: 'center',
    marginBottom: 12,
  },
  codeText: {
    color: COLORS.yellow,
    fontSize: 36,
    fontWeight: '900',
    letterSpacing: 7,
  },
  copyPill: {
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255,203,61,0.24)',
    backgroundColor: 'rgba(255,203,61,0.08)',
    marginBottom: 18,
  },
  copyPillText: {
    color: COLORS.yellow,
    fontSize: 13,
    fontWeight: '800',
  },
  countdownLabel: {
    color: COLORS.mutedText,
    fontSize: 12,
    textTransform: 'uppercase',
    textAlign: 'center',
    letterSpacing: 0.7,
    fontWeight: '700',
    marginBottom: 4,
  },
  countdownText: {
    color: COLORS.yellow,
    fontSize: 34,
    fontWeight: '900',
    textAlign: 'center',
    letterSpacing: 3,
    marginBottom: 14,
  },
  actionsBlockIntro: {
    width: '100%',
    alignSelf: 'stretch',
    alignItems: 'stretch',
    marginTop: 12,
  },
  actionsBlock: {
    width: '100%',
    alignSelf: 'stretch',
    alignItems: 'stretch',
    marginTop: 18,
  },
  actionsBlockStep: {
    width: '100%',
    alignSelf: 'stretch',
    alignItems: 'stretch',
    marginTop: 6,
  },
  primaryWrap: {
    alignSelf: 'stretch',
    width: '100%',
    borderRadius: 18,
    overflow: 'hidden',
    elevation: 6,
    shadowColor: COLORS.yellow,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
  },
  primaryGradient: {
    width: '100%',
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryText: {
    color: '#111827',
    fontSize: 16,
    fontWeight: '900',
    letterSpacing: 0.5,
    textAlign: 'center',
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
    fontSize: 15,
    fontWeight: '800',
    textAlign: 'center',
  },
  btnDisabled: {
    opacity: 0.55,
  },
  successCircle: {
    alignSelf: 'center',
    width: 58,
    height: 58,
    borderRadius: 29,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#4ADE80',
    marginBottom: 16,
  },
});
