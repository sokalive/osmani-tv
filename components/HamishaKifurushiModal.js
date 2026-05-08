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
 *   INTRO                     → introduction copy + "ENDELEA KUHAMISHA"
 *   PHONE                     → enter source phone, fetch one-time code
 *   GENERATED                 → display code + countdown for the
 *                               receiving device
 *   REDEEM                    → enter code on the receiving device
 *   REDEEMED                  → target-side activation success
 *   COOLDOWN                  → backend per-device cooldown gate
 *   TRANSFER_COMPLETED_SOURCE → source-side success: this device just
 *                               handed off its subscription to the
 *                               target (revealed by `transfer_completed`
 *                               / `subscription_revoked` SSE while we
 *                               were on the GENERATED step)
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
  COOLDOWN: 'cooldown',
  TRANSFER_COMPLETED_SOURCE: 'transfer_completed_source',
});

function formatTimer(totalSeconds) {
  const safe = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

/**
 * Convert any backend-supplied cooldown timestamp into an absolute epoch
 * milliseconds value usable by `Date.now()`-based math.
 *
 * Strict — never invents a timer when the backend supplied nothing
 * actionable. Ambiguously small numbers (< 1e9) are NOT interpreted as
 * "duration ms" because in practice that produced an immediate-expiry
 * value and froze the UI at 0:00.
 *
 * Accepted shapes:
 *   - epoch ms (n > 1e12)            → returned as-is
 *   - epoch seconds (1e9 < n ≤ 1e12) → multiplied by 1000
 *   - retryAfterSec (positive int)   → Date.now() + sec * 1000
 *
 * Anything else returns null and the caller must NOT enter the COOLDOWN
 * step.
 */
function normalizeCooldownUntilMs(rawUntilMs, retryAfterSec = null) {
  const n = Number(rawUntilMs);
  if (Number.isFinite(n) && n > 1000000000000) return n;
  if (Number.isFinite(n) && n > 1000000000) return n * 1000;
  const retry = Number(retryAfterSec);
  if (Number.isFinite(retry) && retry > 0) {
    return Date.now() + retry * 1000;
  }
  return null;
}

function secondsUntil(untilMs) {
  const n = Number(untilMs);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.max(0, Math.ceil((n - Date.now()) / 1000));
}

function normalizePhone(raw) {
  return String(raw || '').replace(/[^\d]/g, '').slice(0, 10);
}

export default function HamishaKifurushiModal({ visible, onClose, onOpenPlans }) {
  const { height: windowHeight } = useWindowDimensions();
  const cardMaxHeight = windowHeight * 0.82;
  const {
    reverifySubscription,
    revokedReason,
    isSubscribed,
    dismissRevoked,
  } = useOsmaniApp();

  const [step, setStep] = useState(STEPS.INTRO);
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [generatedCode, setGeneratedCode] = useState('');
  const [remainingSeconds, setRemainingSeconds] = useState(TRANSFER_CODE_SECONDS);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  /**
   * Backend-anchored cooldown expiry. The backend enforces and supplies
   * the duration; the UI just renders a countdown to the absolute
   * timestamp. Never compute or hardcode a duration here.
   */
  const [cooldownUntilMs, setCooldownUntilMs] = useState(null);
  const [cooldownSecondsLeft, setCooldownSecondsLeft] = useState(0);
  /**
   * Total cooldown duration in minutes (rounded up), captured at the
   * moment the backend rejected with `TRANSFER_COOLDOWN`. Used purely
   * to render a stable Swahili line ("Subiri dakika N kabla ya kuomba
   * code nyingine.") that does NOT change as the live countdown ticks
   * down. Always derived from backend metadata — never hardcoded.
   */
  const [cooldownTotalMinutes, setCooldownTotalMinutes] = useState(null);
  /**
   * Manual countdown ref. The interval-based effect below already
   * clears itself on visibility/step change, but we keep this ref so
   * the revoke watcher can `clearInterval` defensively the instant the
   * backend tells us this device lost access — no leaked tick can drag
   * us into a negative state if the effect cleanup is delayed.
   */
  const countdownIntervalRef = useRef(null);
  const cooldownTickIntervalRef = useRef(null);
  const cooldownSnapshotRef = useRef(null);

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
      const savedCooldown = cooldownSnapshotRef.current;
      const nowMs = Date.now();
      const restoredLeft = savedCooldown?.cooldownUntilMs
        ? secondsUntil(savedCooldown.cooldownUntilMs)
        : 0;
      console.log('[TRANSFER_COOLDOWN]', 'modal_open_evaluate', {
        nowMs,
        savedCooldown,
        restoredLeft,
      });
      setPhone('');
      setCode('');
      setGeneratedCode('');
      setRemainingSeconds(TRANSFER_CODE_SECONDS);
      setBusy(false);
      setError('');
      if (restoredLeft > 0) {
        console.log('[TRANSFER_COOLDOWN]', 'restore_on_modal_open', {
          cooldownUntilMs: savedCooldown.cooldownUntilMs,
          restoredLeft,
          totalMinutes: savedCooldown.totalMinutes ?? null,
        });
        setCooldownUntilMs(savedCooldown.cooldownUntilMs);
        setCooldownSecondsLeft(restoredLeft);
        setCooldownTotalMinutes(savedCooldown.totalMinutes ?? null);
        setStep(STEPS.COOLDOWN);
      } else {
        if (savedCooldown) {
          console.log('[TRANSFER_COOLDOWN]', 'clear_stale_on_modal_open', {
            cooldownUntilMs: savedCooldown.cooldownUntilMs ?? null,
            restoredLeft,
          });
        }
        cooldownSnapshotRef.current = null;
        setCooldownUntilMs(null);
        setCooldownSecondsLeft(0);
        setCooldownTotalMinutes(null);
        setStep(STEPS.INTRO);
      }
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
   * Revoke watcher (SOURCE-side only).
   *
   * Drives the smooth source-side post-transfer transition. Triggered
   * only when this device was actively acting as the SOURCE (had
   * generated a code) and the backend just told us we lost access via
   * `subscription_revoked` / `transfer_completed` SSE — or any verify
   * tick that returns active=false. In that case we:
   *   - stop the countdown interval defensively
   *   - clear all in-flight transfer state (code, generatedCode, phone,
   *     error, cooldown)
   *   - swap the visible step to TRANSFER_COMPLETED_SOURCE so the
   *     "Hongera!" success screen replaces the lingering code/timer UI
   *   - dismiss the global `revokedReason` so the hard-block
   *     `TransferredAwayModal` does NOT stack on top — the user already
   *     gets a clear, contextual success screen here
   *
   * Important non-triggers:
   *   - target / unsubscribed devices opening the modal to redeem
   *     arrive with `isSubscribed === false` as their normal initial
   *     state — `wasActingAsSource` (gated on `generatedCode` /
   *     GENERATED step, which is only reachable after a successful
   *     `/api/transfer/request`) keeps the watcher silent for them
   *   - REDEEMED is the target-side success state, untouched
   *   - TRANSFER_COMPLETED_SOURCE is its own terminal state and must
   *     not re-fire (prevents the watcher running again on every
   *     subsequent verify tick)
   *
   * If the modal is NOT visible when the revoke arrives, this watcher
   * does nothing and the global `TransferredAwayModal` continues to
   * handle the hard-block path.
   */
  useEffect(() => {
    if (!visible) return;
    if (step === STEPS.REDEEMED) return;
    if (step === STEPS.TRANSFER_COMPLETED_SOURCE) return;
    const revokeSignal = Boolean(revokedReason) || isSubscribed === false;
    if (!revokeSignal) return;
    const wasActingAsSource = step === STEPS.GENERATED || Boolean(generatedCode);
    if (!wasActingAsSource) return;
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
    setCooldownUntilMs(null);
    setCooldownSecondsLeft(0);
    setCooldownTotalMinutes(null);
    cooldownSnapshotRef.current = null;
    setStep(STEPS.TRANSFER_COMPLETED_SOURCE);
    console.log('[HAMISHA_MODAL]', 'transfer_completed_source_entered');
    // Suppress the global hard-block modal — this in-modal success
    // screen is the contextual UI for the source-initiated transfer.
    try {
      dismissRevoked?.();
      console.log('[HAMISHA_MODAL]', 'global_revoke_dismissed');
    } catch {}
  }, [visible, revokedReason, isSubscribed, step, generatedCode, dismissRevoked]);

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
      cooldownSnapshotRef.current = null;
      setCooldownUntilMs(null);
      setCooldownSecondsLeft(0);
      setCooldownTotalMinutes(null);
      setGeneratedCode(r.code);
      setRemainingSeconds(TRANSFER_CODE_SECONDS);
      setStep(STEPS.GENERATED);
    } catch (e) {
      console.log('[TRANSFER_REQUEST_RUNTIME]', 'handle_generate_error', {
        code: e?.code ?? null,
        message: e?.message ?? null,
        rawPayload: e?.raw ?? null,
      });
      if (e?.code === 'TRANSFER_DISABLED') {
        console.log('[TRANSFER_DISABLED]', 'response_payload', e?.raw ?? null);
        // Maintenance must override any prior per-device gate. Clear
        // any stale cooldown snapshot/state so the modal can't pop
        // back into a cooldown screen when the user reopens it.
        if (cooldownTickIntervalRef.current) {
          clearInterval(cooldownTickIntervalRef.current);
          cooldownTickIntervalRef.current = null;
        }
        cooldownSnapshotRef.current = null;
        setCooldownUntilMs(null);
        setCooldownSecondsLeft(0);
        setCooldownTotalMinutes(null);
        setError(e?.message || 'Huduma ya kuhamisha kifurushi imesitishwa kwa muda. Tafadhali jaribu tena baadaye.');
        setStep(STEPS.PHONE);
        return;
      }
      if (e?.code === 'TRANSFER_DAILY_LIMIT' || e?.code === 'TRANSFER_WEEKLY_LIMIT') {
        // Limit gates also clear stale cooldown — the limit message
        // is the source of truth for "why you can't transfer right now".
        if (cooldownTickIntervalRef.current) {
          clearInterval(cooldownTickIntervalRef.current);
          cooldownTickIntervalRef.current = null;
        }
        cooldownSnapshotRef.current = null;
        setCooldownUntilMs(null);
        setCooldownSecondsLeft(0);
        setCooldownTotalMinutes(null);
        setError(e?.message || 'Umefikia kikomo cha kuomba code. Tafadhali jaribu tena baadaye.');
        setStep(STEPS.PHONE);
        return;
      }
      // Backend-enforced cooldown: surface a dedicated screen with a
      // live countdown anchored to the backend's expiry timestamp.
      // Duration is NEVER hardcoded — `cooldownUntilMs` comes from the
      // backend response (admin-configurable on the server).
      if (e?.code === 'TRANSFER_COOLDOWN') {
        const nowMs = Date.now();
        const untilMs = normalizeCooldownUntilMs(e?.cooldownUntilMs, e?.retryAfterSec);
        const deltaMs = Number.isFinite(untilMs) ? untilMs - nowMs : null;
        const initialLeft = secondsUntil(untilMs);
        console.log('[TRANSFER_COOLDOWN]', 'parse_runtime', {
          rawCooldownUntilMs: e?.cooldownUntilMs ?? null,
          rawRetryAfterSec: e?.retryAfterSec ?? null,
          rawCooldownUntilIso: e?.cooldownUntilIso ?? null,
          rawBackendPayload: e?.raw ?? null,
          parsedUntilMs: untilMs,
          nowMs,
          deltaMs,
          initialLeft,
        });
        // Refuse to render a frozen 0:00 cooldown screen. If the backend
        // signalled cooldown but supplied no usable expiry (or one
        // already in the past), surface the message inline on the PHONE
        // step and let the user retry manually instead of trapping them
        // on a non-counting timer.
        if (!Number.isFinite(untilMs) || untilMs <= nowMs || initialLeft <= 0) {
          const reason = !Number.isFinite(untilMs)
            ? 'no_valid_until_ms'
            : untilMs <= nowMs
              ? 'until_ms_in_past'
              : 'initial_left_zero';
          console.log('[TRANSFER_COOLDOWN]', 'reject_invalid_runtime', {
            reason,
            untilMs,
            nowMs,
            deltaMs,
            initialLeft,
          });
          cooldownSnapshotRef.current = null;
          setCooldownUntilMs(null);
          setCooldownSecondsLeft(0);
          setCooldownTotalMinutes(null);
          setError(
            e?.message
              || 'Subiri kidogo kabla ya kuhamisha tena kifurushi.',
          );
          setStep(STEPS.PHONE);
          return;
        }
        // Capture the original cooldown duration in minutes so the
        // descriptive Swahili line stays stable while the live timer
        // ticks down. Prefer `retryAfterSec` (the original duration
        // the backend returned) and fall back to deriving from
        // `cooldownUntilMs - now`. NEVER hardcoded.
        const totalMinutes = (() => {
          if (Number.isFinite(e?.retryAfterSec) && e.retryAfterSec > 0) {
            return Math.max(1, Math.ceil(e.retryAfterSec / 60));
          }
          return Math.max(1, Math.ceil(deltaMs / 60000));
        })();
        console.log('[TRANSFER_COOLDOWN]', 'enter_cooldown_step', {
          cooldownUntilMs: untilMs,
          retryAfterSec: e?.retryAfterSec ?? null,
          nowMs,
          deltaMs,
          initialLeft,
          totalMinutes,
          backendMessage: e?.message ?? null,
        });
        cooldownSnapshotRef.current = {
          cooldownUntilMs: untilMs,
          totalMinutes,
        };
        setCooldownUntilMs(untilMs);
        setCooldownSecondsLeft(initialLeft);
        setCooldownTotalMinutes(totalMinutes);
        setError('');
        setStep(STEPS.COOLDOWN);
        return;
      }
      const msg = e?.message ?? String(e ?? 'unknown_error');
      setError(msg);
    } finally {
      setBusy(false);
    }
  }, [isPhoneValid, phone]);

  /**
   * Cooldown countdown ticker. Drives `cooldownSecondsLeft` by sampling
   * the backend-anchored absolute expiry every second. When no
   * `cooldownUntilMs` is available (older backend that only returns a
   * raw seconds value) we still tick down the local copy — but never
   * extend it.
   */
  useEffect(() => {
    if (!visible) return undefined;
    if (step !== STEPS.COOLDOWN) return undefined;
    if (cooldownTickIntervalRef.current) {
      clearInterval(cooldownTickIntervalRef.current);
      cooldownTickIntervalRef.current = null;
    }
    const tick = () => {
      const sourceUntilMs = cooldownSnapshotRef.current?.cooldownUntilMs ?? cooldownUntilMs;
      const nowMs = Date.now();
      const deltaMs = Number.isFinite(sourceUntilMs) ? sourceUntilMs - nowMs : null;
      const left = secondsUntil(sourceUntilMs);
      console.log('[TRANSFER_COOLDOWN]', 'tick', {
        cooldownUntilMs: sourceUntilMs ?? null,
        nowMs,
        deltaMs,
        remainingSeconds: left,
        retryEnabled: left <= 0 && !busy,
      });
      setCooldownSecondsLeft(left);
      if (left <= 0) {
        const reason = !Number.isFinite(sourceUntilMs)
          ? 'no_until_ms'
          : 'expired';
        console.log('[TRANSFER_COOLDOWN]', 'reached_zero', {
          reason,
          sourceUntilMs,
          nowMs,
          deltaMs,
        });
        if (cooldownTickIntervalRef.current) {
          clearInterval(cooldownTickIntervalRef.current);
          cooldownTickIntervalRef.current = null;
        }
        cooldownSnapshotRef.current = null;
        setCooldownUntilMs(null);
        setCooldownTotalMinutes(null);
        console.log('[TRANSFER_COOLDOWN]', 'expired_and_cleared', {
          retryEnabled: !busy,
        });
      }
    };
    tick();
    const t = setInterval(tick, 1000);
    cooldownTickIntervalRef.current = t;
    return () => {
      clearInterval(t);
      if (cooldownTickIntervalRef.current === t) {
        cooldownTickIntervalRef.current = null;
      }
    };
  }, [visible, step, cooldownUntilMs, busy]);

  const cooldownRetryEnabled = step === STEPS.COOLDOWN && cooldownSecondsLeft <= 0 && !busy;

  useEffect(() => {
    if (step !== STEPS.COOLDOWN) return;
    console.log('[TRANSFER_COOLDOWN]', 'retry_button_state', {
      cooldownSecondsLeft,
      busy,
      enabled: cooldownRetryEnabled,
    });
  }, [step, cooldownSecondsLeft, busy, cooldownRetryEnabled]);

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
                        <Ionicons name="swap-horizontal" size={26} color="#111827" />
                      </View>
                    </View>
                    <Text style={styles.stepTitleCenter}>HAMISHA KIFURUSHI</Text>
                    <Text style={styles.introLead}>
                      Unaweza kuhamisha kifurushi chako kwenda kwenye simu nyingine.
                    </Text>
                    <View style={styles.bulletList}>
                      <View style={styles.bulletRow}>
                        <Text style={styles.bulletDot}>•</Text>
                        <Text style={styles.bulletText}>Simu ya zamani itapoteza ufikiaji mara moja.</Text>
                      </View>
                      <View style={styles.bulletRow}>
                        <Text style={styles.bulletDot}>•</Text>
                        <Text style={styles.bulletText}>Simu mpya itaanza kutumia kifurushi mara moja.</Text>
                      </View>
                      <View style={styles.bulletRow}>
                        <Text style={styles.bulletDot}>•</Text>
                        <Text style={styles.bulletText}>
                          Muda uliobaki wa kifurushi utaendelea kwenye simu mpya.
                        </Text>
                      </View>
                    </View>
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

                {step === STEPS.COOLDOWN ? (
                  <View style={styles.stepColumn}>
                    <View style={styles.iconHaloSmall}>
                      <View style={styles.iconCircleSmall}>
                        <Ionicons name="time-outline" size={24} color="#111827" />
                      </View>
                    </View>
                    <Text style={styles.stepTitleCenter}>Hamisha Kifurushi</Text>
                    <Text style={styles.descCenter}>
                      {cooldownTotalMinutes
                        ? `Subiri dakika ${cooldownTotalMinutes} kabla ya kuomba code nyingine.`
                        : 'Subiri kidogo kabla ya kuhamisha tena kifurushi.'}
                    </Text>
                    <Text style={styles.cooldownLabel}>Jaribu tena baada ya:</Text>
                    <Text style={styles.cooldownTimer}>{formatTimer(cooldownSecondsLeft)}</Text>
                    <View style={styles.actionsBlockStep}>
                      <Pressable
                        style={[
                          styles.primaryWrap,
                          !cooldownRetryEnabled && styles.btnDisabled,
                        ]}
                        onPress={() => {
                          setError('');
                          cooldownSnapshotRef.current = null;
                          setCooldownUntilMs(null);
                          setCooldownSecondsLeft(0);
                          setCooldownTotalMinutes(null);
                          setStep(STEPS.PHONE);
                        }}
                        disabled={!cooldownRetryEnabled}
                        accessibilityRole="button"
                        accessibilityLabel="Jaribu tena"
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

                {step === STEPS.TRANSFER_COMPLETED_SOURCE ? (
                  <View style={styles.stepColumn}>
                    <View style={styles.successCircle}>
                      <Ionicons name="checkmark" size={30} color="#111827" />
                    </View>
                    <Text style={styles.stepTitleCenter}>Hongera!</Text>
                    <Text style={styles.descCenter}>
                      Umefanikiwa kuhamisha kifurushi chako kwenda kwenye simu nyingine.{'\n\n'}
                      Kifaa hiki hakina tena huduma ya premium.
                    </Text>
                    <View style={styles.actionsBlock}>
                      <Pressable
                        style={styles.primaryWrap}
                        onPress={() => {
                          // Hand control to the parent: it closes this
                          // modal and opens the plans/payment flow.
                          // Falls back to a plain close when no
                          // handler is wired (defensive).
                          if (onOpenPlans) {
                            onOpenPlans();
                          } else {
                            close();
                          }
                        }}
                        accessibilityRole="button"
                        accessibilityLabel="Lipia tena"
                      >
                        <LinearGradient
                          colors={GRADIENT_CTA}
                          start={{ x: 0, y: 0.5 }}
                          end={{ x: 1, y: 0.5 }}
                          style={styles.primaryGradient}
                        >
                          <Text style={styles.primaryText}>LIPIA TENA</Text>
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
  card: {
    width: '100%',
    backgroundColor: COLORS.card,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: 'rgba(255,203,61,0.18)',
    paddingHorizontal: 22,
    paddingTop: 20,
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
    paddingTop: 12,
    alignItems: 'stretch',
  },
  iconHalo: {
    alignSelf: 'center',
    width: 68,
    height: 68,
    borderRadius: 34,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
    backgroundColor: 'rgba(255,203,61,0.12)',
  },
  iconCircle: {
    width: 50,
    height: 50,
    borderRadius: 25,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.yellow,
    shadowColor: COLORS.yellow,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.55,
    shadowRadius: 10,
    elevation: 6,
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
    fontSize: 20,
    fontWeight: '800',
    textAlign: 'center',
    marginBottom: 10,
    letterSpacing: 0.6,
    width: '100%',
  },
  introLead: {
    color: '#E5E7EB',
    fontSize: 14,
    lineHeight: 21,
    textAlign: 'center',
    marginBottom: 16,
    paddingHorizontal: 4,
  },
  bulletList: {
    width: '100%',
    marginBottom: 6,
  },
  bulletRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: 2,
    marginBottom: 8,
  },
  bulletDot: {
    color: COLORS.yellow,
    fontSize: 16,
    lineHeight: 21,
    width: 16,
    fontWeight: '900',
  },
  bulletText: {
    flex: 1,
    color: '#F3F4F6',
    fontSize: 13.5,
    lineHeight: 21,
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
  cooldownLabel: {
    color: COLORS.mutedText,
    fontSize: 13,
    textAlign: 'center',
    fontWeight: '700',
    letterSpacing: 0.4,
    marginBottom: 6,
  },
  cooldownTimer: {
    color: COLORS.yellow,
    fontSize: 40,
    fontWeight: '900',
    textAlign: 'center',
    letterSpacing: 3,
    marginBottom: 18,
  },
  actionsBlockIntro: {
    width: '100%',
    alignSelf: 'stretch',
    alignItems: 'stretch',
    marginTop: 14,
  },
  actionsBlock: {
    width: '100%',
    alignSelf: 'stretch',
    alignItems: 'stretch',
    marginTop: 16,
  },
  actionsBlockStep: {
    width: '100%',
    alignSelf: 'stretch',
    alignItems: 'stretch',
    marginTop: 4,
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
    paddingVertical: 14,
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
