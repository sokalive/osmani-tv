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
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';

/** Matches AkauntiYanguScreen / App theme — same as LIPIA TENA */
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
  'Unaweza kuhamisha kifurushi chako kwenda simu nyingine.',
  'Simu ya zamani itapoteza ufikiaji mara moja.',
  'Simu ya zamani itahitaji kuthibitisha uhamisho.',
  'Muda uliobaki wa kifurushi utaendelea kwenye simu mpya.',
];

async function requestTransferSms(phone) {
  await new Promise((r) => setTimeout(r, 900));
  return { ok: true };
}

async function verifyTransferCode(phone, code) {
  await new Promise((r) => setTimeout(r, 600));
  return { ok: true };
}

export default function HamishaKifurushiModal({ visible, onClose }) {
  const { height: windowHeight } = useWindowDimensions();
  const cardMaxHeight = windowHeight * 0.85;

  const [step, setStep] = useState(1);
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);

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
      setStep(1);
      setPhone('');
      setCode('');
      runEnterAnim();
    }
  }, [visible, runEnterAnim]);

  const close = useCallback(() => {
    onClose?.();
  }, [onClose]);

  const goStep2 = () => setStep(2);

  const handlePataCode = async () => {
    const p = phone.trim();
    if (!p) {
      Alert.alert('', 'Weka namba ya simu kwanza');
      return;
    }
    setSending(true);
    try {
      await requestTransferSms(p);
      Alert.alert('', 'Code imetumwa kwenye namba yako');
      setStep(3);
    } catch {
      Alert.alert('', 'Imeshindikana. Jaribu tena.');
    } finally {
      setSending(false);
    }
  };

  const handleNinaCode = () => {
    setStep(3);
  };

  const handleThibitisha = async () => {
    const p = phone.trim();
    if (!p) {
      Alert.alert('', 'Weka namba ya simu kwanza (Rudi hatua ya 2)');
      return;
    }
    const c = code.trim();
    if (!c) {
      Alert.alert('', 'Weka code ya uthibitisho');
      return;
    }
    setVerifying(true);
    try {
      await verifyTransferCode(p, c);
      Alert.alert('', 'Uhamisho umethibitishwa');
      close();
    } catch {
      Alert.alert('', 'Code si sahihi');
    } finally {
      setVerifying(false);
    }
  };

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

                {step === 1 ? (
                  <View style={styles.stepColumn}>
                    <Text style={styles.stepTitleCenter}>HAMISHA KIFURUSHI</Text>
                    <View style={styles.bulletBlock}>
                      {BULLETS.map((line) => (
                        <Text key={line} style={styles.bulletLine}>
                          • {line}
                        </Text>
                      ))}
                    </View>
                    <View style={styles.actionsBlock}>
                      <Pressable style={styles.primaryWrap} onPress={goStep2}>
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

                {step === 2 ? (
                  <View style={styles.stepColumn}>
                    <Text style={styles.stepTitleLeft}>Hamisha Kifurushi</Text>
                    <Text style={styles.desc}>
                      Weka namba ya simu uliyolipia kifurushi. Tutakutumia code ya kuhamisha.
                    </Text>
                    <TextInput
                      style={styles.input}
                      placeholder="06XXXXXXXX au 07XXXXXXXX"
                      placeholderTextColor="#6B7280"
                      keyboardType="phone-pad"
                      value={phone}
                      onChangeText={setPhone}
                    />
                    <View style={styles.actionsBlockStep2}>
                      <Pressable
                        style={[styles.primaryWrap, sending && styles.btnDisabled]}
                        onPress={handlePataCode}
                        disabled={sending}
                      >
                        <LinearGradient
                          colors={GRADIENT_CTA}
                          start={{ x: 0, y: 0.5 }}
                          end={{ x: 1, y: 0.5 }}
                          style={styles.primaryGradient}
                        >
                          {sending ? (
                            <ActivityIndicator color="#111827" />
                          ) : (
                            <Text style={styles.primaryText}>PATA CODE</Text>
                          )}
                        </LinearGradient>
                      </Pressable>
                      <Pressable style={styles.secondaryBtn} onPress={handleNinaCode}>
                        <Text style={styles.secondaryText}>Nina code tayari</Text>
                      </Pressable>
                    </View>
                  </View>
                ) : null}

                {step === 3 ? (
                  <View style={styles.stepColumn}>
                    <Text style={styles.stepTitleLeft}>Thibitisha Code</Text>
                    <Text style={styles.desc}>
                      Weka code ya uthibitisho uliopokea kwa SMS au uliyonayo tayari.
                    </Text>
                    <TextInput
                      style={styles.input}
                      placeholder="Code"
                      placeholderTextColor="#6B7280"
                      keyboardType="number-pad"
                      value={code}
                      onChangeText={setCode}
                    />
                    <View style={styles.actionsBlockStep2}>
                      <Pressable
                        style={[styles.primaryWrap, verifying && styles.btnDisabled]}
                        onPress={handleThibitisha}
                        disabled={verifying}
                      >
                        <LinearGradient
                          colors={GRADIENT_CTA}
                          start={{ x: 0, y: 0.5 }}
                          end={{ x: 1, y: 0.5 }}
                          style={styles.primaryGradient}
                        >
                          {verifying ? (
                            <ActivityIndicator color="#111827" />
                          ) : (
                            <Text style={styles.primaryText}>THIBITISHA</Text>
                          )}
                        </LinearGradient>
                      </Pressable>
                      <Pressable style={styles.secondaryBtn} onPress={() => setStep(2)}>
                        <Text style={styles.secondaryText}>Rudi</Text>
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

/** Same primary CTA metrics as AkauntiYanguScreen `primaryWrap` / `primaryGradient` / `primaryText` */
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
  input: {
    alignSelf: 'stretch',
    width: '100%',
    backgroundColor: '#1F2229',
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 17,
    color: COLORS.white,
    marginBottom: 16,
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
    fontSize: 17,
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
