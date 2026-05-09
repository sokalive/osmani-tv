import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
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
import { getTransferStatus, initiateTransfer, redeemTransfer } from '../api/subscription';
import { subscribeRealtimeEvent } from '../lib/realtimeSync';

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

const INTRO_TRANSFER_STEPS = [
  '1. Tap CONTINUE TRANSFER below',
  '2. Enter the phone number used for payment',
  '3. You will receive transfer codes',
  '4. Copy the codes',
  '5. Open the phone that should receive the subscription',
  '6. Tap TRANSFER SUBSCRIPTION again',
  '7. Choose "I ALREADY HAVE A CODE"',
  '8. Paste the transfer codes to complete transfer ✅',
];

const STEPS = Object.freeze({
  INTRO: 'intro',
  PHONE: 'phone',
  GENERATED: 'generated',
  REDEEM: 'redeem',
  WAITING: 'waiting',
  REDEEMED: 'redeemed',
  REJECTED: 'rejected',
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

/**
 * Strip "TR-" prefix and non-alphanumerics so we can compare codes from
 * different sources (raw user entry, prefixed backend payload, etc.).
 */
function bareCode(raw) {
  return String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^TR/, '');
}

/**
 * Best-effort code extraction from an SSE payload object — different
 * backend versions key this differently.
 */
function pickEventCode(payload) {
  if (!payload || typeof payload !== 'object') return '';
  return String(
    payload.code ??
      payload.transfer_code ??
      payload.transferCode ??
      payload.transfer?.code ??
      '',
  );
}

function pickPayloadString(payload, keys) {
  if (!payload || typeof payload !== 'object') return '';
  for (const key of keys) {
    const value = key.split('.').reduce((acc, part) => (acc && typeof acc === 'object' ? acc[part] : undefined), payload);
    if (value != null && String(value).trim() !== '') return String(value).trim();
  }
  return '';
}

function pickSourceDeviceId(payload) {
  return pickPayloadString(payload, [
    'source_device_id',
    'sourceDeviceId',
    'source_device.device_id',
    'source_device.id',
    'sourceDevice.deviceId',
    'sourceDevice.id',
    'source.id',
  ]);
}

export default function HamishaKifurushiModal({ visible, onClose }) {
  const { height: windowHeight } = useWindowDimensions();
  const { reverifySubscription, pendingTransfer, triggerPendingTransfer } = useOsmaniApp();

  const [step, setStep] = useState(STEPS.INTRO);
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [generatedCode, setGeneratedCode] = useState('');
  const [remainingSeconds, setRemainingSeconds] = useState(TRANSFER_CODE_SECONDS);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  /**
   * Code currently being awaited by the TARGET device, matched against
   * `transfer_approved` / `transfer_rejected` / `transfer_completed` SSE
   * payloads. Empty unless the WAITING step is active.
   */
  const [waitingCode, setWaitingCode] = useState('');
  const [rejectionReason, setRejectionReason] = useState('');

  const cardMaxHeight = useMemo(() => {
    if (step === STEPS.INTRO) return Math.min(windowHeight * 0.62, 520);
    return windowHeight * 0.82;
  }, [step, windowHeight]);

  const introScrollMaxHeight = Math.min(windowHeight * 0.44, 400);

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
      setWaitingCode('');
      setRejectionReason('');
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
    return () => clearInterval(timer);
  }, [visible, step, generatedCode]);

  const isPhoneValid = useMemo(() => /^0[67]\d{8}$/.test(phone), [phone]);
  const redeemCode = code.trim();
  const isRedeemCodeValid = /^\d{6}$/.test(redeemCode);

  /**
   * SOURCE-device bridge.
   *
   * The global context owns `TransferConfirmModal`, but this native
   * `<Modal>` can visually cover it on Android. While the GENERATED step
   * is showing the 6-digit code we MUST close this modal as soon as we
   * have ANY signal that the target device has confirmed — we let the
   * global approval modal take over. We also force-set the global
   * `pendingTransfer` context so the approve/reject popup absolutely
   * shows even if the SSE event was missed by the consumer entirely.
   *
   * Permissive matching: while we are in GENERATED with our own code, any
   * source-targeted transfer event is treated as belonging to us — this
   * device is the only one in this state.
   */
  useEffect(() => {
    if (!visible) return undefined;
    let cancelled = false;
    const onConfirmationRequired = (eventName) => async (payload) => {
      if (cancelled) return;
      let currentDeviceId = '';
      try {
        const identity = await getDeviceIdentity();
        currentDeviceId = identity?.deviceId ? String(identity.deviceId) : '';
      } catch {}
      if (cancelled) return;
      const sourceDeviceId = pickSourceDeviceId(payload);
      const eventCode = pickEventCode(payload);
      const codeMatches = Boolean(generatedCode) && bareCode(generatedCode) === bareCode(eventCode);
      const sourceMatches = Boolean(sourceDeviceId && currentDeviceId && sourceDeviceId === currentDeviceId);
      // While we are showing the GENERATED step, this device is the
      // ONLY device in source-of-transfer state — accept the event as
      // ours unless it is *explicitly* tagged for another device.
      const inSourceFlow = step === STEPS.GENERATED && Boolean(generatedCode);
      const explicitlyOtherDevice =
        Boolean(sourceDeviceId && currentDeviceId && sourceDeviceId !== currentDeviceId);
      const shouldClose =
        codeMatches ||
        sourceMatches ||
        (inSourceFlow && !explicitlyOtherDevice);
      console.log('[TRANSFER_CONFIRMATION_REQUIRED]', 'hamisha_modal_event', {
        eventName,
        payload,
        currentDeviceId,
        sourceDeviceId,
        eventCode,
        codeMatches,
        sourceMatches,
        inSourceFlow,
        explicitlyOtherDevice,
        shouldClose,
        modalStep: step,
      });
      if (shouldClose) {
        console.log('[transfer-ui]', 'closing code modal', {
          source: 'sse',
          eventName,
          generatedCode,
          eventCode,
        });
        // Force the global context to render the approve/reject modal
        // even if the upstream context listener somehow dropped this
        // payload — defensive double-set is idempotent.
        const merged = (payload && typeof payload === 'object')
          ? { ...payload, code: eventCode || generatedCode }
          : { code: eventCode || generatedCode };
        try {
          triggerPendingTransfer?.(merged, `sse:${eventName}`);
        } catch {}
        console.log('[transfer-ui]', 'opening confirm modal', {
          source: 'sse',
          eventName,
          code: merged.code,
        });
        close();
      }
    };
    const offConfirmationRequired = subscribeRealtimeEvent(
      'transfer_confirmation_required',
      onConfirmationRequired('transfer_confirmation_required'),
    );
    const offRequested = subscribeRealtimeEvent(
      'transfer_requested',
      onConfirmationRequired('transfer_requested'),
    );
    const offPending = subscribeRealtimeEvent(
      'transfer_pending',
      onConfirmationRequired('transfer_pending'),
    );
    return () => {
      cancelled = true;
      offConfirmationRequired();
      offRequested();
      offPending();
    };
  }, [visible, step, generatedCode, waitingCode, redeemCode, close, triggerPendingTransfer]);

  /**
   * Auto-close fail-safe. If the global context decides a pending
   * transfer popup should appear (from SSE OR from the polling fallback
   * below) we MUST close this native modal — otherwise it visually
   * stacks on top of `TransferConfirmModal` on Android and blocks the
   * approve/reject buttons.
   *
   * Skip close on terminal target-side states (REDEEMED/REJECTED) which
   * already replaced the GENERATED UI.
   */
  useEffect(() => {
    if (!visible) return;
    if (!pendingTransfer) return;
    if (step === STEPS.REDEEMED || step === STEPS.REJECTED) return;
    console.log('[transfer-ui]', 'closing code modal', {
      source: 'context.pendingTransfer',
      modalStep: step,
      pendingCode: pendingTransfer?.code ?? null,
    });
    close();
  }, [visible, pendingTransfer, step, close]);

  /**
   * Polling fallback. SSE may fail silently (network, proxy, sleep).
   * While the GENERATED step is showing the code, poll the backend every
   * 2 seconds for a `pending_confirmation` state. The polling helper
   * gracefully tolerates missing endpoints (multi-URL probe with 404
   * fallback), so this becomes a no-op until the backend exposes a
   * status route — but the moment one exists, the source device flips
   * into the approval state without waiting for SSE.
   */
  useEffect(() => {
    if (!visible) return undefined;
    if (step !== STEPS.GENERATED) return undefined;
    if (!generatedCode) return undefined;
    let cancelled = false;
    let timer = null;
    const tick = async () => {
      if (cancelled) return;
      try {
        const r = await getTransferStatus(generatedCode);
        if (cancelled) return;
        if (r?.pending === true || r?.status === 'pending_confirmation') {
          console.log('[transfer-ui]', 'pending transfer detected', {
            source: 'poll',
            url: r?.url ?? null,
            generatedCode,
          });
          const payload = (r?.raw && typeof r.raw === 'object') ? r.raw : { code: generatedCode };
          try {
            triggerPendingTransfer?.({ ...payload, code: payload.code || generatedCode }, 'poll');
          } catch {}
          console.log('[transfer-ui]', 'closing code modal', { source: 'poll' });
          console.log('[transfer-ui]', 'opening confirm modal', { source: 'poll' });
          close();
          return;
        }
      } catch (e) {
        console.log('[transfer-ui]', 'poll_error', e?.message ?? e);
      }
      if (cancelled) return;
      timer = setTimeout(tick, 2000);
    };
    timer = setTimeout(tick, 1500);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [visible, step, generatedCode, close, triggerPendingTransfer]);

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

  const handleRedeem = useCallback(async () => {
    if (!isRedeemCodeValid) {
      setError('Weka code sahihi ya tarakimu 6.');
      return;
    }
    setBusy(true);
    setError('');
    setRejectionReason('');
    try {
      const { deviceId, deviceFingerprint } = await getDeviceIdentity();
      const r = await redeemTransfer(redeemCode, deviceId, deviceFingerprint);
      // Pending mode: backend is waiting for SOURCE device to approve.
      // Switch to the WAITING step and listen for SSE outcome events.
      if (r?.status === 'pending') {
        setWaitingCode(String(r.code ?? redeemCode));
        setStep(STEPS.WAITING);
        return;
      }
      if (r?.active === true) {
        setStep(STEPS.REDEEMED);
        await reverifySubscription?.('transfer-redeem');
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

  /**
   * TARGET-device SSE bridge. Active only while the modal is on the
   * WAITING step. Resolves to REDEEMED on `transfer_approved` /
   * `transfer_completed` (matching code), or REJECTED on
   * `transfer_rejected`. Verify is ALWAYS re-issued before unlocking
   * so backend remains the source of truth.
   */
  useEffect(() => {
    if (!visible || step !== STEPS.WAITING || !waitingCode) return undefined;
    const targetBare = bareCode(waitingCode);
    const matches = (payload) => {
      const incoming = bareCode(pickEventCode(payload));
      // Empty payload is treated as a match — backend may broadcast
      // without a code, and this device is the only one in WAITING.
      return !incoming || !targetBare || incoming === targetBare;
    };
    const offApproved = subscribeRealtimeEvent('transfer_approved', async (payload) => {
      if (!matches(payload)) return;
      console.log('[TRANSFER_APPROVED]', 'target_redeem', payload);
      try {
        await reverifySubscription?.('transfer_approved');
      } catch {}
      setStep(STEPS.REDEEMED);
    });
    const offCompleted = subscribeRealtimeEvent('transfer_completed', async (payload) => {
      if (!matches(payload)) return;
      console.log('[TRANSFER_COMPLETED]', 'target_redeem', payload);
      try {
        await reverifySubscription?.('transfer_completed');
      } catch {}
      setStep(STEPS.REDEEMED);
    });
    const offRejected = subscribeRealtimeEvent('transfer_rejected', (payload) => {
      if (!matches(payload)) return;
      console.log('[TRANSFER_REJECTED]', 'target_redeem', payload);
      const reason =
        (payload && typeof payload === 'object' && typeof payload.reason === 'string')
          ? payload.reason
          : '';
      setRejectionReason(reason);
      setStep(STEPS.REJECTED);
    });
    const offPending = subscribeRealtimeEvent('transfer_pending', (payload) => {
      if (!matches(payload)) return;
      console.log('[TRANSFER_PENDING]', 'target_redeem', payload);
    });
    return () => {
      offApproved();
      offCompleted();
      offRejected();
      offPending();
    };
  }, [visible, step, waitingCode, reverifySubscription]);

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
                  <ScrollView
                    style={[styles.introScroll, { maxHeight: introScrollMaxHeight }]}
                    contentContainerStyle={styles.introScrollContent}
                    showsVerticalScrollIndicator={false}
                    keyboardShouldPersistTaps="handled"
                    bounces={false}
                  >
                    <View style={styles.iconHaloCompact}>
                      <View style={styles.iconCircle}>
                        <Ionicons name="swap-horizontal" size={26} color="#111827" />
                      </View>
                    </View>
                    <Text style={styles.introMainTitle}>TRANSFER YOUR SUBSCRIPTION</Text>
                    <Text style={styles.introBodyPara}>
                      Hello, you can transfer your subscription to another phone.
                    </Text>
                    <Text style={[styles.introBodyPara, styles.introBodyParaLast]}>
                      Your current phone will no longer keep the subscription after transfer.
                    </Text>
                    <Text style={styles.introHowHeading}>HOW TO TRANSFER</Text>
                    {INTRO_TRANSFER_STEPS.map((line, idx) => (
                      <Text key={idx} style={styles.introStepLine}>
                        {line}
                      </Text>
                    ))}
                    {error ? <Text style={styles.errorText}>{error}</Text> : null}
                    <View style={styles.actionsBlockIntroCompact}>
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
                          <Text style={styles.primaryText}>CONTINUE TRANSFER</Text>
                        </LinearGradient>
                      </Pressable>
                    </View>
                  </ScrollView>
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
                          <Text style={styles.primaryText}>THIBITISHA UHAMISHO</Text>
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

                {step === STEPS.WAITING ? (
                  <View style={styles.stepColumn}>
                    <View style={styles.iconHaloSmall}>
                      <View style={styles.iconCircleSmall}>
                        <Ionicons name="hourglass" size={22} color="#111827" />
                      </View>
                    </View>
                    <Text style={styles.stepTitleCenter}>Subiri Uthibitisho</Text>
                    <Text style={styles.descCenter}>
                      Tunasubiri uthibitisho kutoka kwenye simu yenye kifurushi...
                    </Text>
                    <View style={styles.waitingSpinnerWrap}>
                      <ActivityIndicator size="large" color={COLORS.yellow} />
                    </View>
                    <Text style={styles.waitingHint}>
                      Mwombe mtumiaji wa simu ya zamani akubali ombi la uhamisho.
                    </Text>
                    <View style={styles.actionsBlockStep}>
                      <Pressable style={styles.secondaryBtn} onPress={close}>
                        <Text style={styles.secondaryText}>Funga</Text>
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

                {step === STEPS.REJECTED ? (
                  <View style={styles.stepColumn}>
                    <View style={styles.rejectCircle}>
                      <Ionicons name="close" size={28} color="#FFFFFF" />
                    </View>
                    <Text style={styles.stepTitleCenter}>Uhamisho Umekataliwa</Text>
                    <Text style={styles.descCenter}>
                      {rejectionReason
                        ? rejectionReason
                        : 'Mtumiaji wa simu ya zamani amekataa ombi la uhamisho.'}
                    </Text>
                    <View style={styles.actionsBlockStep}>
                      <Pressable
                        style={styles.primaryWrap}
                        onPress={() => {
                          setError('');
                          setRejectionReason('');
                          setWaitingCode('');
                          setCode('');
                          setStep(STEPS.REDEEM);
                        }}
                      >
                        <LinearGradient
                          colors={GRADIENT_CTA}
                          start={{ x: 0, y: 0.5 }}
                          end={{ x: 1, y: 0.5 }}
                          style={styles.primaryGradient}
                        >
                          <Text style={styles.primaryText}>JARIBU TENA</Text>
                        </LinearGradient>
                      </Pressable>
                      <Pressable style={styles.secondaryBtn} onPress={close}>
                        <Text style={styles.secondaryText}>Funga</Text>
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
  introScroll: {
    width: '100%',
    alignSelf: 'stretch',
  },
  introScrollContent: {
    paddingTop: 8,
    paddingBottom: 8,
    alignItems: 'stretch',
  },
  iconHaloCompact: {
    alignSelf: 'center',
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
    backgroundColor: 'rgba(255,203,61,0.12)',
  },
  introMainTitle: {
    color: COLORS.white,
    fontSize: 17,
    fontWeight: '800',
    textAlign: 'center',
    marginBottom: 12,
    letterSpacing: 0.5,
    width: '100%',
  },
  introBodyPara: {
    color: '#E5E7EB',
    fontSize: 14,
    lineHeight: 21,
    textAlign: 'center',
    marginBottom: 10,
    paddingHorizontal: 2,
    width: '100%',
  },
  introBodyParaLast: {
    marginBottom: 14,
  },
  introHowHeading: {
    color: COLORS.mutedText,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.2,
    textAlign: 'center',
    marginBottom: 10,
    marginTop: 2,
    width: '100%',
  },
  introStepLine: {
    color: '#F3F4F6',
    fontSize: 13,
    lineHeight: 20,
    marginBottom: 7,
    textAlign: 'left',
    width: '100%',
  },
  actionsBlockIntroCompact: {
    width: '100%',
    alignSelf: 'stretch',
    alignItems: 'stretch',
    marginTop: 12,
  },
  card: {
    width: '100%',
    backgroundColor: COLORS.card,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: 'rgba(250,204,21,0.18)',
    paddingHorizontal: 20,
    paddingTop: 22,
    paddingBottom: 18,
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
  rejectCircle: {
    alignSelf: 'center',
    width: 58,
    height: 58,
    borderRadius: 29,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#EF4444',
    marginBottom: 16,
  },
  waitingSpinnerWrap: {
    alignSelf: 'center',
    marginBottom: 14,
  },
  waitingHint: {
    color: COLORS.mutedText,
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
    marginBottom: 18,
  },
});
