import React, { useCallback, useEffect, useLa
youtEffect, useRef, useState } from 'react';

import {
  ActivityIndicator,
  Alert,
  Anim
ated,
  Dimensions,
  Easing,
  Image,
  Inte
ractionManager,
  KeyboardAvoidingView,
  Mod
al,
  Platform,
  Pressable,
  ScrollView,
  
StyleSheet,
  Text,
  TextInput,
  View,
} fr
om 'react-native';
import { SafeAreaView, use
SafeAreaInsets } from 'react-native-safe-area
-context';
import { LinearGradient } from 'ex
po-linear-gradient';
import { Ionicons } from
 '@expo/vector-icons';
import EventSource fro
m 'react-native-sse';
import { subscribeRealt
imeEvent } from '../lib/realtimeSync';
import
 {
  fetchSubscription,
  getCheckoutPaymentP
roviders,
  getPaymentProviders,
  getPayment
Status,
  getPlans,
  resolveCheckoutStartPay
ment,
} from '../api/payment';
import { getAp
iBaseUrl } from '../api';
import { verifySubs
cription } from '../api/subscription';
import
 { useMfalmeApp } from '../context/MfalmeAppC
ontext';
import { getDeviceIdentity } from '.
./lib/deviceIdentity';
import { cacheSecurity
Phone } from '../lib/security/securityPhone';

import { formatSubscriptionExpiry } from '..
/lib/formatExpiry';

const ACCENT = '#FACC15'
;
const ACCENT_GRADIENT = ['#FFE066', '#F5C51
8', '#A87410'];
const ACCENT_GLOW = 'rgba(250
, 204, 21, 0.55)';
const SHEET_BG = '#0F1115'
;
const CARD_BG = '#1E222B';
const CARD_BG_AC
TIVE = '#2A2F3A';
const TEXT_MUTED = '#9CA3AF
';

const NETWORK_COLORS = {
  Tigo: '#1F8FFF
',
  'M-Pesa': '#22C55E',
  Airtel: '#EF4444'
,
  HaloPesa: '#F59E0B',
};

const WINDOW_HEI
GHT = Dimensions.get('window').height;
const 
MODAL_MAX_HEIGHT = Math.round(WINDOW_HEIGHT *
 0.85);

const POLL_MS = 3000;

/**
 * Local 
fallback used only when GET /api/payment-prov
iders fails or
 * returns an empty list. Live
 admin-managed providers + logos populate
 * 
the grid at runtime via `getPaymentProviders(
)`.
 */
const FALLBACK_NETWORKS = [
  { id: '
tigo', name: 'Tigo', logoUrl: null, active: t
rue },
  { id: 'mpesa', name: 'M-Pesa', logoU
rl: null, active: true },
  { id: 'airtel', n
ame: 'Airtel', logoUrl: null, active: true },

  { id: 'halopesa', name: 'HaloPesa', logoUr
l: null, active: true },
];

function formatC
ountdown(totalSeconds) {
  const s = Math.max
(0, Math.floor(totalSeconds));
  const m = Ma
th.floor(s / 60);
  const sec = s % 60;
  ret
urn `${m}:${sec.toString().padStart(2, '0')}`
;
}

function formatPriceTz(n) {
  const num 
= Number(n);
  if (!Number.isFinite(num)) ret
urn '0';
  try {
    return new Intl.NumberFo
rmat('en-TZ', { maximumFractionDigits: 0 }).f
ormat(num);
  } catch {
    return String(Mat
h.round(num));
  }
}

function formatPlanDura
tion(raw) {
  const value = String(raw ?? '')
.trim();
  if (!value || value === '-' || val
ue === '—') return '(—)';
  const match =
 value.match(/\d+/);
  if (match) return `(${
match[0]} siku)`;
  return `(${value.replace(
/^\(|\)$/g, '')})`;
}

function isSubscriptio
nActive(subscription) {
  if (!subscription |
| typeof subscription !== 'object') return fa
lse;
  return subscription.active === true ||
 subscription.isActive === true;
}

function 
parseExpiryMs(v) {
  if (v == null || v === '
') return null;
  const t = Date.parse(String
(v));
  return Number.isFinite(t) ? t : null;

}

/** Prefer the furthest future expiry whe
n verify and subscription-status disagree (e.
g. renewal). */
function latestExpiryIso(...c
andidates) {
  let bestStr = null;
  let best
Ms = null;
  for (const raw of candidates) {

    if (raw == null || raw === '') continue;

    const s = String(raw).trim();
    const m
s = parseExpiryMs(s);
    if (ms == null) con
tinue;
    if (bestMs == null || ms > bestMs)
 {
      bestMs = ms;
      bestStr = s;
    
}
  }
  return bestStr;
}

function normalize
PlanRow(raw) {
  const active = raw?.is_activ
e === true || raw?.isActive === true;
  retur
n {
    id: String(raw?.id ?? raw?.plan_id ??
 '').trim(),
    name: String(raw?.name ?? ra
w?.title ?? '').trim(),
    price: Number(raw
?.price ?? raw?.amount ?? 0),
    duration: S
tring(
      raw?.duration_days ??
        ra
w?.durationDays ??
        raw?.days ??
     
   raw?.validity_days ??
        raw?.validit
yDays ??
        raw?.period_days ??
        
raw?.periodDays ??
        raw?.duration ??
 
       raw?.duration_label ??
        raw?.du
ration_text ??
        '',
    ).trim(),
    
isActive: active,
  };
}

/**
 * @param {{ vi
sible: boolean; onClose: () => void; onUnlock
Success?: () => void }} props
 */
export defa
ult function PremiumModal({ visible, onClose,
 onUnlockSuccess, channelName = 'Chaneli Uliy
ofungua' }) {
  const insets = useSafeAreaIns
ets();
  const { refreshSubscription, unlockC
hannels } = useMfalmeApp();
  const [step, se
tStep] = useState(1);
  const [plans, setPlan
s] = useState([]);
  const [plansLoading, set
PlansLoading] = useState(false);
  const [pla
nsError, setPlansError] = useState('');
  con
st [selectedPlan, setSelectedPlan] = useState
(null);
  const [phoneNumber, setPhoneNumber]
 = useState('');
  const [remainingSeconds, s
etRemainingSeconds] = useState(0);
  const [o
rderId, setOrderId] = useState(null);
  const
 [waitingDeviceId, setWaitingDeviceId] = useS
tate('');
  const [submitting, setSubmitting]
 = useState(false);
  const [failureReason, s
etFailureReason] = useState('');
  const [suc
cessExpiresAt, setSuccessExpiresAt] = useStat
e(null);
  const [finalizingSuccess, setFinal
izingSuccess] = useState(false);
  const [pro
viders, setProviders] = useState(FALLBACK_NET
WORKS);
  const [logoErrors, setLogoErrors] =
 useState({});
  const [checkoutProvider, set
CheckoutProvider] = useState('zenopay');

  c
onst fadeAnim = useRef(new Animated.Value(1))
.current;
  const slideAnim = useRef(new Anim
ated.Value(0)).current;
  const ringRotate = 
useRef(new Animated.Value(0)).current;
  cons
t pollTimerRef = useRef(null);
  const countd
ownTimerRef = useRef(null);
  const sseRef = 
useRef(null);
  const doneRef = useRef(false)
;

  const animateStepChange = useCallback(()
 => {
    fadeAnim.setValue(0);
    slideAnim
.setValue(12);
    Animated.parallel([
      
Animated.timing(fadeAnim, {
        toValue: 
1,
        duration: 240,
        useNativeDr
iver: true,
      }),
      Animated.timing(s
lideAnim, {
        toValue: 0,
        durat
ion: 240,
        useNativeDriver: true,
    
  }),
    ]).start();
  }, [fadeAnim, slideAn
im]);

  const clearTimers = useCallback(() =
> {
    if (pollTimerRef.current) {
      cle
arInterval(pollTimerRef.current);
      pollT
imerRef.current = null;
    }
    if (countdo
wnTimerRef.current) {
      clearInterval(cou
ntdownTimerRef.current);
      countdownTimer
Ref.current = null;
    }
  }, []);

  const 
closeSse = useCallback(() => {
    if (sseRef
.current) {
      try {
        sseRef.curren
t.close();
      } catch {
        // no-op
 
     }
      sseRef.current = null;
    }
  }
, []);

  useLayoutEffect(() => {
    if (!vi
sible) return;
    clearTimers();
    doneRef
.current = false;
    setStep(1);
    setPlan
s([]);
    setPlansError('');
    setSelected
Plan(null);
    setPhoneNumber('');
    setRe
mainingSeconds(0);
    setOrderId(null);
    
setWaitingDeviceId('');
    setSubmitting(fal
se);
    setFailureReason('');
    setSuccess
ExpiresAt(null);
    setFinalizingSuccess(fal
se);
    fadeAnim.setValue(1);
    slideAnim.
setValue(0);
  }, [visible, clearTimers, fade
Anim, slideAnim]);

  useEffect(() => {
    i
f (!visible) {
      clearTimers();
      clo
seSse();
      doneRef.current = false;
    }

  }, [visible, clearTimers, closeSse]);

  u
seEffect(() => {
    animateStepChange();
  }
, [step, animateStepChange]);

  useEffect(()
 => {
    if (step !== 3) {
      ringRotate.
setValue(0);
      return undefined;
    }
  
  ringRotate.setValue(0);
    const loop = An
imated.loop(
      Animated.timing(ringRotate
, {
        toValue: 1,
        duration: 140
0,
        easing: Easing.linear,
        use
NativeDriver: true,
      }),
    );
    loop
.start();
    return () => loop.stop();
  }, 
[step, ringRotate]);

  useEffect(() => {
   
 if (!visible) return undefined;
    let canc
elled = false;
    (async () => {
      setPl
ansLoading(true);
      setPlansError('');
  
    try {
        const raw = await getPlans(
);
        if (cancelled) return;
        con
st list = Array.isArray(raw) ? raw.map(normal
izePlanRow).filter((p) => p.isActive === true
) : [];
        setPlans(list);
        setSe
lectedPlan((prev) => {
          if (prev && 
list.some((x) => x.id === prev.id)) return pr
ev;
          return list[0] ?? null;
       
 });
      } catch (e) {
        if (!cancell
ed) setPlansError(e?.message ?? 'Imeshindwa k
upakia mipango');
      } finally {
        i
f (!cancelled) setPlansLoading(false);
      
}
    })();
    return () => {
      cancelle
d = true;
    };
  }, [visible]);

  /** Load
 active checkout gateway (zenopay | sonicpesa
 | auraxpay) when modal opens. */
  useEffect
(() => {
    if (!visible) return undefined;

    let cancelled = false;
    (async () => {

      try {
        const cfg = await getChe
ckoutPaymentProviders();
        if (cancelle
d) return;
        setCheckoutProvider(cfg.pa
yment_provider);
      } catch {
        if (
!cancelled) setCheckoutProvider('zenopay');
 
     }
    })();
    return () => {
      can
celled = true;
    };
  }, [visible]);

  /**
 When modal opens, always sync subscription f
rom server (do not trust stale context). */
 
 useEffect(() => {
    if (!visible) return u
ndefined;
    void refreshSubscription();
  }
, [visible, refreshSubscription]);

  /**
   
* Fetch admin-managed payment providers when 
the modal opens.
   * On failure or empty lis
t, the local FALLBACK_NETWORKS stays in place
.
   */
  const reloadPaymentProviders = useC
allback(async () => {
    try {
      const l
ist = await getPaymentProviders();
      if (
Array.isArray(list) && list.length > 0) {
   
     setProviders(list);
        setLogoError
s({});
      }
    } catch {
      // keep fa
llback providers; do not surface to user
    
}
  }, []);

  useEffect(() => {
    if (!vis
ible) return undefined;
    let cancelled = f
alse;
    (async () => {
      if (cancelled)
 return;
      await reloadPaymentProviders()
;
    })();
    return () => {
      cancelle
d = true;
    };
  }, [visible, reloadPayment
Providers]);

  useEffect(() => {
    if (!vi
sible) return undefined;
    const paymentRef
reshEvents = [
      'payment_providers_chang
ed',
      'zenopay_settings_changed',
      
'aurax_settings_changed',
      'sonicpesa_se
ttings_changed',
      'plans_changed',
    ]
;
    const offs = paymentRefreshEvents.map((
ev) =>
      subscribeRealtimeEvent(ev, () =>
 {
        void reloadPaymentProviders();
   
   }),
    );
    return () => offs.forEach((
off) => off());
  }, [visible, reloadPaymentP
roviders]);

  /** After payment gateway / ve
rify confirms active: apply context + success
 UI only when verify succeeds. */
  const mov
eToSuccessStep = useCallback(async () => {
  
  if (doneRef.current) return;
    clearTimer
s();
    closeSse();
    let verified = null;

    let fetchExpires = null;
    try {
     
 verified = await refreshSubscription();
    
  try {
        const { deviceId } = await ge
tDeviceIdentity();
        const sub = await 
fetchSubscription(deviceId);
        fetchExp
ires = sub?.expiresAt ?? null;
      } catch 
{
        // optional enrichment only
      }

      if (verified && isSubscriptionActive(v
erified)) {
        doneRef.current = true;
 
       const mergedExpires = latestExpiryIso(
verified?.expiresAt, fetchExpires);
        u
nlockChannels({
          ...verified,
      
    active: true,
          isActive: true,
 
         expiresAt: mergedExpires ?? verified
?.expiresAt ?? null,
        });
        cons
t mergedForUi = latestExpiryIso(verified?.exp
iresAt, fetchExpires);
        setSuccessExpi
resAt(mergedForUi ?? verified?.expiresAt ?? n
ull);
        setStep(4);
        return;
   
   }
    } catch (e) {
      console.log('[PA
YMENT_SUCCESS_VERIFY]', 'refresh_failed', e?.
message ?? e);
    }
    console.log('[PAYMEN
T_SUCCESS_VERIFY]', 'verify_not_active_stay_w
aiting', {
      active: verified?.active,
  
    isActive: verified?.isActive,
    });
  }
, [clearTimers, closeSse, refreshSubscription
, unlockChannels]);

  /** ENDELEA: always aw
ait fresh API via context; branch only on ret
urned object (never stale context). */
  cons
t handleCompleted = useCallback(async () => {

    setFinalizingSuccess(true);
    try {
  
    const subscription = await refreshSubscri
ption();
      console.log('[PAYMENT_CONTINUE
_VERIFY]', subscription);
      if (isSubscri
ptionActive(subscription)) {
        unlockCh
annels(subscription);
        onUnlockSuccess
?.();
        await new Promise((resolve) => 
{
          InteractionManager.runAfterIntera
ctions(() => resolve(null));
        });
    
    onClose?.();
      } else {
        Alert
.alert('Kifurushi', 'Sub bado haija-activate,
 jaribu tena sekunde chache');
      }
    } 
catch (e) {
      Alert.alert('Kifurushi', e?
.message ?? 'Imeshindwa kusasisha kifurushi')
;
    } finally {
      setFinalizingSuccess(
false);
    }
  }, [refreshSubscription, unlo
ckChannels, onUnlockSuccess, onClose]);

  co
nst handleFailed = useCallback(
    (reason) 
=> {
      if (doneRef.current) return;
     
 doneRef.current = true;
      clearTimers();

      setFailureReason(reason || 'Malipo hay
ajafanikiwa');
      setStep(5);
    },
    [
clearTimers],
  );

  const pollOnce = useCal
lback(
    async (oid) => {
      if (doneRef
.current) return;
      try {
        const {
 status, reason } = await getPaymentStatus(oi
d);
        if (doneRef.current) return;
    
    if (status === 'FAILED') {
          hand
leFailed(reason);
          return;
        }


        let peek = null;
        try {
    
      const { deviceId, deviceFingerprint } =
 await getDeviceIdentity();
          peek = 
await verifySubscription(deviceId, deviceFing
erprint);
        } catch {
          peek = 
null;
        }
        if (doneRef.current) 
return;
        if (peek && isSubscriptionAct
ive(peek)) {
          await moveToSuccessSte
p();
          return;
        }

        if 
(status === 'SUCCESS') {
          await move
ToSuccessStep();
        }
      } catch {
  
      // transient network — keep polling
 
     }
    },
    [moveToSuccessStep, handleF
ailed],
  );

  useEffect(() => {
    if (!vi
sible || step !== 3 || !orderId || doneRef.cu
rrent) return undefined;

    (async () => {

      await pollOnce(orderId);
    })();

   
 pollTimerRef.current = setInterval(() => {
 
     if (doneRef.current) return;
      pollO
nce(orderId);
    }, POLL_MS);

    countdown
TimerRef.current = setInterval(() => {
      
setRemainingSeconds((prev) => {
        retur
n prev > 0 ? prev - 1 : 0;
      });
    }, 1
000);

    return () => clearTimers();
  }, [
visible, step, orderId, clearTimers, pollOnce
, handleFailed]);

  useEffect(() => {
    if
 (!visible || step !== 3 || !waitingDeviceId 
|| doneRef.current) return undefined;
    clo
seSse();
    const url = `${getApiBaseUrl()}/
api/subscription-stream?device_id=${encodeURI
Component(waitingDeviceId)}`;
    const strea
m = new EventSource(url, { pollingInterval: 0
 });
    sseRef.current = stream;

    const 
onMessage = (event) => {
      if (doneRef.cu
rrent) return;
      void (async () => {
    
    try {
          const payload = JSON.pars
e(event?.data ?? '{}');
          const paylo
adActive = payload?.isActive === true || payl
oad?.active === true;
          if (!payloadA
ctive) return;
          const { deviceId, de
viceFingerprint } = await getDeviceIdentity()
;
          const verified = await verifySubs
cription(deviceId, deviceFingerprint);
      
    if (doneRef.current) return;
          if
 (verified && isSubscriptionActive(verified))
 {
            void moveToSuccessStep();
    
      }
        } catch {
          // ignore
 malformed stream payloads / transient verify
 errors
        }
      })();
    };

    str
eam.addEventListener('message', onMessage);
 
   stream.addEventListener('error', () => {
 
     // Keep polling fallback active; no moda
l failure on SSE issues.
    });

    return 
() => {
      try {
        stream.removeAllE
ventListeners();
      } catch {
        // n
o-op
      }
      closeSse();
    };
  }, [v
isible, step, waitingDeviceId, closeSse, move
ToSuccessStep]);

  const handleCancel = () =
> {
    clearTimers();
    onClose?.();
  };


  const isPhoneValid =
    !!phoneNumber && 
phoneNumber.length === 10 && phoneNumber.star
tsWith('0');

  const selectedAmountDisplay =

    selectedPlan && Number.isFinite(selected
Plan.price)
      ? `TSh ${formatPriceTz(sele
ctedPlan.price)}`
      : 'TSh —';

  const
 ringSpin = ringRotate.interpolate({
    inpu
tRange: [0, 1],
    outputRange: ['0deg', '36
0deg'],
  });

  const handleStep2Pay = async
 () => {
    console.log('PAYMENT TRIGGERED')
;
    if (!isPhoneValid) {
      Alert.alert(
'', 'Weka namba sahihi ya simu');
      retur
n;
    }
    if (!selectedPlan?.id) {
      A
lert.alert('', 'Chagua mpango');
      return
;
    }
    setSubmitting(true);
    try {
  
    const { deviceId, deviceFingerprint } = a
wait getDeviceIdentity();
      const payPayl
oad = {
        phone: phoneNumber.replace(/\
s/g, ''),
        plan_id: selectedPlan.id,
 
       amount: selectedPlan.price,
        de
vice_id: deviceId,
        device_fingerprint
: deviceFingerprint,
        buyer_name: 'MFA
LME TV',
        buyer_email: 'noreply@mfalme
.tv',
      };
      void cacheSecurityPhone(
payPayload.phone);
      const startPayment =
 resolveCheckoutStartPayment(checkoutProvider
);
      const { order_id: oid, expiresInSeco
nds } = await startPayment(payPayload);
     
 doneRef.current = false;
      setWaitingDev
iceId(deviceId);
      setOrderId(oid);
     
 const wait =
        typeof expiresInSeconds
 === 'number' && expiresInSeconds > 0
       
   ? Math.floor(expiresInSeconds)
          :
 0;
      setRemainingSeconds(wait);
      se
tStep(3);
    } catch (e) {
      Alert.alert
('Malipo', e?.message ?? 'Imeshindwa kuanzish
a malipo');
    } finally {
      setSubmitti
ng(false);
    }
  };

  const goStep2 = () =
> {
    if (!selectedPlan) {
      Alert.aler
t('', 'Hakuna mpango wa kulipa');
      retur
n;
    }
    setStep(2);
  };

  const handle
Retry = () => {
    doneRef.current = false;

    setFailureReason('');
    setOrderId(null
);
    setRemainingSeconds(0);
    setStep(2)
;
  };

  const compactResultStep = step === 
4 || step === 5;
  const compactSheetHeight =
 Math.min(460, Math.round(WINDOW_HEIGHT * 0.5
6));

  return (
    <Modal visible={visible}
 transparent animationType="fade" onRequestCl
ose={handleCancel}>
      <KeyboardAvoidingVi
ew
        style={styles.overlay}
        beh
avior={Platform.OS === 'ios' ? 'padding' : un
defined}
        keyboardVerticalOffset={inse
ts.top}
      >
        <Pressable style={sty
les.backdrop} onPress={handleCancel} />
     
   <View style={styles.centeredWrap} pointerE
vents="box-none">
          <View
           
 style={[
              styles.sheet,
       
       compactResultStep
                ? { 
height: compactSheetHeight, maxHeight: compac
tSheetHeight }
                : { height: MO
DAL_MAX_HEIGHT, maxHeight: MODAL_MAX_HEIGHT }
,
            ]}
          >
            <Saf
eAreaView
              edges={['top', 'botto
m']}
              style={step === 2 ? [style
s.sheetSafe, styles.sheetSafeCompactBottom] :
 styles.sheetSafe}
            >
            
  <View style={styles.sheetBody}>
           
     <ScrollView
                  showsVerti
calScrollIndicator={false}
                  
keyboardShouldPersistTaps="handled"
         
         style={styles.modalScroll}
         
         contentContainerStyle={
            
        step === 2
                      ? [s
tyles.modalScrollContentStep2Centered]
      
                : compactResultStep
         
               ? styles.modalScrollContentCom
pactResult
                        : styles.m
odalScrollContent
                  }
       
           bounces={false}
                >

                  <View style={styles.handleB
ar} />
                  <Animated.View
     
               style={[
                     
 {
                        opacity: fadeAnim,

                        transform: [{ transl
ateY: slideAnim }],
                      },

                      step === 2 && styles.st
ep2AnimatedFill,
                    ]}
     
             >
                    {step === 
1 && (
                      <View>
         
               <View style={styles.crownHaloW
rap}>
                          <View style={
styles.crownGlow} />
                        
  <View style={styles.crownCircle}>
         
                   <Ionicons name="diamond" s
ize={26} color="#0F172A" />
                 
         </View>
                        </Vi
ew>
                        <Text style={styl
es.titleCentered}>Karibu Osman TV</Text>
    
                    <Text style={styles.subti
tleCentered} numberOfLines={2}>
             
             {channelName} ni channel ya prem
ium
                        </Text>
         
               {plansLoading ? (
            
              <ActivityIndicator size="large"
 color={ACCENT} style={styles.plansSpinner} /
>
                        ) : null}
         
               {plansError ? <Text style={sty
les.errorText}>{plansError}</Text> : null}
  
                      {!plansLoading && !plan
sError && plans.length === 0 ? (
            
              <Text style={styles.mutedCenter
}>Hakuna mipango inayopatikana kwa sasa.</Tex
t>
                        ) : null}
        
                <View style={styles.plansList
}>
                          {plans.map((plan
) => {
                            const sele
cted = selectedPlan?.id === plan.id;
        
                    return (
                
              <Pressable
                    
            key={plan.id}
                   
             onPress={() => setSelectedPlan(p
lan)}
                                style={
[styles.planRow, selected && styles.planRowSe
lected]}
                              >
    
                            {selected ? (
   
                               <LinearGradien
t
                                    colors=
{['rgba(250,204,21,0.14)', 'rgba(250,204,21,0
.02)']}
                                    s
tart={{ x: 0, y: 0 }}
                       
             end={{ x: 1, y: 1 }}
           
                         style={StyleSheet.ab
soluteFill}
                                 
   pointerEvents="none"
                     
             />
                             
   ) : null}
                                
<View style={[styles.radioOuter, selected && 
styles.radioOuterOn]}>
                      
            {selected ? <View style={styles.r
adioInner} /> : null}
                       
         </View>
                            
    <View style={styles.planTextCol}>
       
                           <Text style={style
s.planLabel}>{plan.name}</Text>
             
                     <Text style={styles.plan
Meta}>{formatPlanDuration(plan.duration)}</Te
xt>
                                </View>
 
                               <Text style={s
tyles.planPriceRight}>
                      
            TSh {formatPriceTz(plan.price)}
 
                               </Text>
      
                        </Pressable>
        
                    );
                      
    })}
                        </View>
     
                   <View style={styles.benefi
tsList}>
                          {[
       
                     'Ukilipia Una Tazama Cha
nnel zote',
                            'Chan
nel Zote Ni HD & 4K Streaming',
             
               'Hakuna Kuganda kwa Channel',

                            'Channel Zipo Liv
e Muda Wote',
                          ].map
((line) => (
                            <Vie
w key={line} style={styles.benefitRow}>
     
                         <Ionicons name="chec
kmark-circle" size={18} color={ACCENT} />
   
                           <Text style={style
s.benefitText}>{line}</Text>
                
            </View>
                         
 ))}
                        </View>
        
              </View>
                    )}


                    {step === 2 && (
       
               <View style={styles.step2Outer
Padding}>
                        <View style
={styles.step2TopSection}>
                  
        <View style={styles.titleRow}>
      
                      <View style={styles.tit
leIconCircle}>
                              
<Ionicons name="phone-portrait" size={14} col
or="#0F172A" />
                            <
/View>
                            <Text styl
e={[styles.title, styles.step2GapClear]}>Weka
 Namba ya Simu</Text>
                       
   </View>
                          <Text st
yle={styles.subtitleNetworks}>Tigo, M-Pesa, A
irtel, HaloPesa</Text>
                      
    <View style={[styles.inputWrap, styles.st
ep2GapClear]}>
                            <I
onicons
                              name="c
all"
                              size={18}

                              color={ACCENT}

                              style={styles.i
nputIcon}
                            />
    
                        <TextInput
          
                    style={styles.inputField}

                              placeholder="0
712345678"
                              plac
eholderTextColor="#6B7280"
                  
            keyboardType="phone-pad"
        
                      maxLength={10}
        
                      value={phoneNumber}
   
                           onChangeText={setP
honeNumber}
                            />
  
                        </View>
             
             <Text style={[styles.networksLab
el, styles.step2GapClear]}>Mitandao inayokuba
liwa</Text>
                          <View s
tyle={[styles.networksGrid, styles.step2GapCl
ear]}>
                            {providers
.map((n) => {
                              c
onst tint = NETWORK_COLORS[n.name] || ACCENT;

                              const initial 
= (n.name || '').slice(0, 1).toUpperCase();
 
                             const failed = !
!logoErrors[n.id];
                          
    const showLogo = !!n.logoUrl && !failed;

                              return (
      
                          <View key={n.id} st
yle={styles.networkCardOuter}>
              
                    <View
                   
                 style={[
                   
                   styles.networkCard,
      
                                !showLogo && 
{ backgroundColor: tint, borderColor: tint },

                                    ]}
     
                             >
              
                      {showLogo ? (
         
                             <Image
         
                               source={{ uri:
 n.logoUrl }}
                               
         style={styles.networkLogoFill}
     
                                   resizeMode
="cover"
                                    
    onError={() =>
                          
                setLogoErrors((prev) =>
     
                                       prev[n
.id] ? prev : { ...prev, [n.id]: true },
    
                                      )
     
                                   }
        
                              />
            
                        ) : (
               
                       <Text style={styles.ne
tworkInitialFillText}>{initial}</Text>
      
                              )}
            
                      </View>
               
                   <Text style={styles.networ
kCardText} numberOfLines={1}>
               
                     {n.name}
               
                   </Text>
                  
              </View>
                       
       );
                            })}
   
                       </View>
              
          </View>
                        <Vi
ew style={styles.step2FlexSpacer} />
        
                <View style={styles.step2Bott
omSection}>
                          <Pressa
ble
                            disabled={!is
PhoneValid || submitting}
                   
         style={[
                           
   styles.ctaWrap,
                          
    styles.ctaDockBtn,
                      
        (!isPhoneValid || submitting) && styl
es.ctaDisabled,
                            ]
}
                            onPress={handle
Step2Pay}
                          >
       
                     <LinearGradient
        
                      colors={ACCENT_GRADIENT
}
                              start={{ x: 0
, y: 0 }}
                              end={
{ x: 1, y: 1 }}
                             
 style={styles.ctaGradient}
                 
           >
                              {s
ubmitting ? (
                               
 <ActivityIndicator color="#111827" />
      
                        ) : (
               
                 <Text style={styles.ctaText}
>Lipia — {selectedAmountDisplay}</Text>
   
                           )}
               
             </LinearGradient>
              
            </Pressable>
                    
    </View>
                      </View>
   
                 )}

                    {ste
p === 3 && (
                      <View styl
e={styles.step3Wrap}>
                       
 <View style={styles.loaderHaloWrap}>
       
                   <Animated.View
           
                 style={[
                   
           styles.loaderRing,
               
               { transform: [{ rotate: ringSp
in }] },
                            ]}
     
                     />
                     
     <View style={styles.loaderInner}>
      
                      <Ionicons name="card" s
ize={26} color={ACCENT} />
                  
        </View>
                        </Vie
w>
                        <Text style={style
s.waitTitle}>Inasubiri uthibitisho wa malipo<
/Text>
                        <Text style={s
tyles.waitPin}>
                          Thi
bitisha malipo kwenye simu yako (PIN).
      
                  </Text>
                   
     <View style={styles.amountPill}>
       
                   <Ionicons name="wallet" si
ze={14} color={ACCENT} />
                   
       <Text style={styles.amountPillText}>{s
electedAmountDisplay}</Text>
                
        </View>
                        <Text
 style={styles.countdown}>
                  
        {remainingSeconds > 0 ? formatCountdo
wn(remainingSeconds) : '--:--'}
             
           </Text>
                        {o
rderId ? (
                          <View st
yle={styles.orderPill}>
                     
       <Text style={styles.orderPillLabel}>Or
der ID</Text>
                            <Te
xt style={styles.orderPillValue} numberOfLine
s={1}>
                              {orderId
}
                            </Text>
       
                   </View>
                  
      ) : null}
                      </View>

                    )}

                    
{step === 4 && (
                      <View 
style={styles.resultWrap}>
                  
      <View style={styles.successIconHalo}>
 
                         <View style={styles.
successIconCircle}>
                         
   <Ionicons name="checkmark" size={28} color
="#0F172A" />
                          </Vie
w>
                        </View>
          
              <Text style={styles.successTitl
e}>Malipo yamefanikiwa</Text>
               
         <Text style={styles.successBody}>
  
                        Kifurushi chako kinai
sha:{' '}
                          <Text sty
le={styles.successHighlight}>
               
             {formatSubscriptionExpiry(succes
sExpiresAt)}
                          </Text
>
                        </Text>
           
             <Text style={styles.successFootn
ote}>
                          Sasa unaweza 
kutazama channel zote live muda wote. Kumbuka
 kulipia kifurushi chako kabla
              
            ya muda kuisha.
                 
       </Text>
                        <Press
able
                          style={[styles
.ctaWrap, styles.resultCta, finalizingSuccess
 && styles.ctaDisabled]}
                    
      disabled={finalizingSuccess}
          
                onPress={() => void handleCom
pleted()}
                        >
         
                 <LinearGradient
            
                colors={ACCENT_GRADIENT}
    
                        start={{ x: 0, y: 0 }
}
                            end={{ x: 1, y:
 1 }}
                            style={styl
es.ctaGradient}
                          >
 
                           {finalizingSuccess
 ? (
                              <ActivityI
ndicator color="#111827" />
                 
           ) : (
                            
  <Text style={styles.ctaText}>ENDELEA</Text>

                            )}
             
             </LinearGradient>
              
          </Pressable>
                      
</View>
                    )}

             
       {step === 5 && (
                     
 <View style={styles.resultWrap}>
           
             <View style={styles.failIconHalo
}>
                          <View style={sty
les.failIconCircle}>
                        
    <Ionicons name="alert" size={28} color="#
FFFFFF" />
                          </View>

                        </View>
             
           <Text style={styles.failTitle}>Mal
ipo hayajakamilika</Text>
                   
     <Text style={styles.failBody}>{failureRe
ason}</Text>
                        <Pressab
le style={[styles.ctaWrap, styles.resultCta]}
 onPress={handleRetry}>
                     
     <LinearGradient
                        
    colors={ACCENT_GRADIENT}
                
            start={{ x: 0, y: 0 }}
          
                  end={{ x: 1, y: 1 }}
      
                      style={styles.ctaGradie
nt}
                          >
             
               <Text style={styles.ctaText}>J
ARIBU TENA</Text>
                          <
/LinearGradient>
                        </Pr
essable>
                        <Pressable s
tyle={[styles.cancelBtn, styles.resultSeconda
ry]} onPress={handleCancel}>
                
          <Text style={styles.cancelBtnText}>
FUNGA</Text>
                        </Pressa
ble>
                      </View>
          
          )}
                  </Animated.Vie
w>
                </ScrollView>
            
    <View
                  style={styles.cta
Dock}
                  pointerEvents={step =
== 1 || step === 3 ? 'box-none' : 'none'}
   
             >
                  {step === 1 
? (
                    <Pressable
          
            style={[styles.ctaWrap, styles.ct
aDockBtn, (!selectedPlan || plansLoading) && 
styles.ctaDisabled]}
                      di
sabled={!selectedPlan || plansLoading}
      
                onPress={goStep2}
           
         >
                      <LinearGradi
ent
                        colors={ACCENT_GR
ADIENT}
                        start={{ x: 0
, y: 0 }}
                        end={{ x: 1
, y: 1 }}
                        style={styl
es.ctaGradient}
                      >
     
                   <Text style={styles.ctaTex
t}>Lipia — {selectedAmountDisplay}</Text>
 
                     </LinearGradient>
      
              </Pressable>
                  
) : null}
                  {step === 3 ? (
 
                   <Pressable style={[styles.
cancelBtn, styles.ctaDockBtn]} onPress={handl
eCancel}>
                      <Text style={
styles.cancelBtnText}>GHAIRI</Text>
         
           </Pressable>
                  ) :
 null}
                </View>
              
</View>
            </SafeAreaView>
         
 </View>
        </View>
      </KeyboardAvoi
dingView>
    </Modal>
  );
}

const styles =
 StyleSheet.create({
  overlay: {
    flex: 1
,
    justifyContent: 'center',
    alignItem
s: 'center',
    backgroundColor: 'rgba(0,0,0
,0.7)',
  },
  backdrop: {
    ...StyleSheet.
absoluteFillObject,
  },
  centeredWrap: {
  
  flex: 1,
    justifyContent: 'center',
    
alignItems: 'center',
    width: '100%',
    
paddingHorizontal: 16,
  },
  sheet: {
    wi
dth: '100%',
    overflow: 'hidden',
    back
groundColor: SHEET_BG,
    borderRadius: 22,

    paddingHorizontal: 20,
    paddingVertica
l: 20,
    borderWidth: 1,
    borderColor: '
rgba(250,204,21,0.18)',
    alignSelf: 'cente
r',
    elevation: 18,
    shadowColor: '#000
',
    shadowOffset: { width: 0, height: 12 }
,
    shadowOpacity: 0.45,
    shadowRadius: 
22,
  },
  sheetSafe: {
    flex: 1,
    minH
eight: 0,
    width: '100%',
    overflow: 'h
idden',
  },
  sheetBody: {
    flex: 1,
    
minHeight: 0,
    position: 'relative',
  },

  modalScroll: {
    flex: 1,
    minHeight: 
0,
  },
  modalScrollContent: {
    paddingBo
ttom: 100,
  },
  modalScrollContentCompactRe
sult: {
    paddingBottom: 24,
  },
  modalSc
rollContentStep2Centered: {
    flexGrow: 1,

    paddingBottom: 16,
  },
  sheetSafeCompac
tBottom: {
    paddingBottom: 12,
  },
  step
2AnimatedFill: {
    flex: 1,
    width: '100
%',
    minHeight: 0,
  },
  step2OuterPaddin
g: {
    flex: 1,
    padding: 12,
    width:
 '100%',
    minHeight: 0,
    justifyContent
: 'center',
  },
  step2TopSection: {
    gap
: 12,
  },
  step2FlexSpacer: {
    height: 1
6,
  },
  step2BottomSection: {
    width: '1
00%',
    marginBottom: 4,
  },
  step2GapCle
ar: {
    marginBottom: 0,
  },
  ctaDisabled
: {
    opacity: 0.5,
  },
  ctaDock: {
    p
osition: 'absolute',
    bottom: 24,
    left
: 16,
    right: 16,
    zIndex: 2,
  },
  ct
aDockBtn: {
    marginTop: 0,
    marginBotto
m: 0,
  },
  handleBar: {
    alignSelf: 'cen
ter',
    width: 44,
    height: 4,
    borde
rRadius: 2,
    backgroundColor: 'rgba(250,20
4,21,0.30)',
    marginBottom: 12,
  },
  tit
leRow: {
    flexDirection: 'row',
    alignI
tems: 'center',
    marginBottom: 8,
    gap:
 10,
  },
  titleIconCircle: {
    width: 26,

    height: 26,
    borderRadius: 13,
    al
ignItems: 'center',
    justifyContent: 'cent
er',
    backgroundColor: ACCENT,
    shadowC
olor: ACCENT,
    shadowOffset: { width: 0, h
eight: 0 },
    shadowOpacity: 0.6,
    shado
wRadius: 8,
    elevation: 4,
  },
  title: {

    color: '#FFFFFF',
    fontSize: 22,
    
fontWeight: '800',
    letterSpacing: 0.3,
  
  flexShrink: 1,
  },
  subtitle: {
    color
: TEXT_MUTED,
    fontSize: 13,
    marginBot
tom: 18,
    fontWeight: '500',
    letterSpa
cing: 0.2,
  },
  crownHaloWrap: {
    alignS
elf: 'center',
    width: 76,
    height: 76,

    alignItems: 'center',
    justifyContent
: 'center',
    marginBottom: 14,
    marginT
op: 2,
  },
  crownGlow: {
    position: 'abs
olute',
    width: 76,
    height: 76,
    bo
rderRadius: 38,
    backgroundColor: 'rgba(25
0,204,21,0.16)',
  },
  crownCircle: {
    wi
dth: 56,
    height: 56,
    borderRadius: 28
,
    backgroundColor: ACCENT,
    alignItems
: 'center',
    justifyContent: 'center',
   
 borderWidth: 1,
    borderColor: 'rgba(255,2
55,255,0.18)',
    shadowColor: ACCENT,
    s
hadowOffset: { width: 0, height: 0 },
    sha
dowOpacity: 0.75,
    shadowRadius: 16,
    e
levation: 12,
  },
  titleCentered: {
    col
or: '#FFFFFF',
    fontSize: 24,
    fontWeig
ht: '800',
    textAlign: 'center',
    lette
rSpacing: 0.4,
    marginBottom: 6,
  },
  su
btitleCentered: {
    color: TEXT_MUTED,
    
fontSize: 13,
    textAlign: 'center',
    ma
rginBottom: 18,
    letterSpacing: 0.2,
    p
addingHorizontal: 8,
    lineHeight: 19,
  },

  plansList: {
    width: '100%',
  },
  ben
efitsList: {
    marginTop: 14,
    marginBot
tom: 8,
    paddingHorizontal: 4,
    gap: 10
,
  },
  benefitRow: {
    flexDirection: 'ro
w',
    alignItems: 'center',
    gap: 10,
  
},
  benefitText: {
    color: '#E5E7EB',
   
 fontSize: 14,
    fontWeight: '500',
    let
terSpacing: 0.2,
    flexShrink: 1,
  },
  su
btitleNetworks: {
    color: TEXT_MUTED,
    
fontSize: 12,
    marginTop: -2,
    marginBo
ttom: 4,
    letterSpacing: 0.2,
  },
  plans
Spinner: {
    marginVertical: 24,
  },
  err
orText: {
    color: '#F87171',
    fontSize:
 14,
    marginBottom: 12,
    lineHeight: 20
,
  },
  mutedCenter: {
    color: '#9CA3AF',

    fontSize: 15,
    textAlign: 'center',
 
   marginVertical: 16,
  },
  planRow: {
    
flexDirection: 'row',
    alignItems: 'center
',
    paddingVertical: 16,
    paddingHorizo
ntal: 16,
    borderRadius: 16,
    marginBot
tom: 10,
    backgroundColor: '#161A22',
    
borderWidth: 1.5,
    borderColor: 'rgba(255,
255,255,0.06)',
    overflow: 'hidden',
    p
osition: 'relative',
  },
  planRowSelected: 
{
    borderColor: ACCENT,
    backgroundColo
r: '#1B1F28',
    shadowColor: ACCENT,
    sh
adowOffset: { width: 0, height: 0 },
    shad
owOpacity: 0.40,
    shadowRadius: 14,
    el
evation: 8,
  },
  planBadge: {
    position:
 'absolute',
    right: 12,
    top: '50%',
 
   marginTop: -10,
    width: 20,
    height:
 20,
    borderRadius: 10,
    backgroundColo
r: ACCENT,
    alignItems: 'center',
    just
ifyContent: 'center',
    shadowColor: ACCENT
,
    shadowOffset: { width: 0, height: 0 },

    shadowOpacity: 0.6,
    shadowRadius: 6,

    elevation: 4,
  },
  radioOuter: {
    wi
dth: 22,
    height: 22,
    borderRadius: 11
,
    borderWidth: 2,
    borderColor: '#4B55
63',
    marginRight: 14,
    alignItems: 'ce
nter',
    justifyContent: 'center',
  },
  r
adioOuterOn: {
    borderColor: ACCENT,
    b
ackgroundColor: 'rgba(250,204,21,0.10)',
  },

  radioInner: {
    width: 12,
    height: 1
2,
    borderRadius: 6,
    backgroundColor: 
ACCENT,
  },
  planTextCol: {
    flex: 1,
  
},
  planLabel: {
    color: '#F9FAFB',
    f
ontSize: 15,
    fontWeight: '800',
    lette
rSpacing: 0.6,
    textTransform: 'uppercase'
,
  },
  planMeta: {
    color: TEXT_MUTED,
 
   fontSize: 12,
    fontWeight: '500',
    m
arginTop: 4,
    letterSpacing: 0.2,
  },
  p
lanPrice: {
    color: ACCENT,
    fontSize: 
15,
    fontWeight: '800',
    marginTop: 6,

    letterSpacing: 0.3,
  },
  planPriceRight
: {
    color: ACCENT,
    fontSize: 16,
    
fontWeight: '800',
    letterSpacing: 0.3,
  
  marginLeft: 12,
  },
  cta: {
    backgroun
dColor: ACCENT,
    width: '100%',
    minHei
ght: 56,
    paddingVertical: 16,
    padding
Horizontal: 20,
    borderRadius: 16,
    ali
gnItems: 'center',
    justifyContent: 'cente
r',
    alignSelf: 'stretch',
    marginTop: 
20,
    marginBottom: 20,
  },
  ctaWrap: {
 
   width: '100%',
    minHeight: 58,
    bord
erRadius: 18,
    alignSelf: 'stretch',
    m
arginTop: 20,
    marginBottom: 20,
    overf
low: 'hidden',
    elevation: 14,
    shadowC
olor: ACCENT,
    shadowOffset: { width: 0, h
eight: 8 },
    shadowOpacity: 0.55,
    shad
owRadius: 18,
  },
  ctaGradient: {
    flex:
 1,
    minHeight: 58,
    paddingVertical: 1
7,
    paddingHorizontal: 20,
    alignItems:
 'center',
    justifyContent: 'center',
    
borderRadius: 18,
  },
  ctaText: {
    color
: '#111827',
    fontSize: 17,
    fontWeight
: '800',
    textAlign: 'center',
    letterS
pacing: 0.5,
  },
  input: {
    backgroundCo
lor: '#1A1F28',
    borderRadius: 14,
    pad
dingHorizontal: 16,
    paddingVertical: 16,

    fontSize: 17,
    color: '#FFFFFF',
    m
arginBottom: 16,
    borderWidth: 1,
    bord
erColor: '#2A323F',
  },
  inputWrap: {
    f
lexDirection: 'row',
    alignItems: 'center'
,
    backgroundColor: '#1A1F28',
    borderR
adius: 14,
    paddingHorizontal: 14,
    pad
dingVertical: 4,
    marginBottom: 14,
    bo
rderWidth: 1,
    borderColor: 'rgba(250,204,
21,0.18)',
  },
  inputIcon: {
    marginRigh
t: 10,
  },
  inputField: {
    flex: 1,
    
paddingVertical: 14,
    fontSize: 17,
    co
lor: '#FFFFFF',
    letterSpacing: 0.4,
  },

  networksLabel: {
    color: '#9CA3AF',
    
fontSize: 11,
    marginBottom: 10,
    lette
rSpacing: 0.6,
    textTransform: 'uppercase'
,
    fontWeight: '700',
  },
  networksRow: 
{
    flexDirection: 'row',
    flexWrap: 'wr
ap',
    gap: 8,
    marginBottom: 16,
  },
 
 networkChip: {
    flexDirection: 'row',
   
 alignItems: 'center',
    paddingHorizontal:
 12,
    paddingVertical: 7,
    borderRadius
: 999,
    backgroundColor: '#1F242E',
    bo
rderWidth: 1,
    borderColor: 'rgba(255,255,
255,0.06)',
    gap: 6,
  },
  networkDot: {

    width: 8,
    height: 8,
    borderRadius
: 4,
  },
  networkChipText: {
    color: '#E
5E7EB',
    fontSize: 12,
    fontWeight: '60
0',
  },
  networksGrid: {
    width: '100%',

    flexDirection: 'row',
    flexWrap: 'wra
p',
    justifyContent: 'space-between',
    
marginBottom: 16,
  },
  networkCardOuter: {

    width: '48%',
    marginBottom: 12,
  },

  networkCard: {
    width: '100%',
    heigh
t: 84,
    borderRadius: 14,
    overflow: 'h
idden',
    borderWidth: 1,
    borderColor: 
'rgba(255,255,255,0.06)',
    backgroundColor
: '#1F242E',
    alignItems: 'center',
    ju
stifyContent: 'center',
    elevation: 2,
   
 shadowColor: '#000',
    shadowOffset: { wid
th: 0, height: 2 },
    shadowOpacity: 0.18,

    shadowRadius: 4,
  },
  networkLogoFill: 
{
    width: '100%',
    height: '100%',
  },

  networkInitialFillText: {
    color: '#0F1
72A',
    fontSize: 32,
    fontWeight: '900'
,
    letterSpacing: 0.5,
  },
  networkCardT
ext: {
    marginTop: 8,
    color: '#E5E7EB'
,
    fontSize: 13,
    fontWeight: '700',
  
  textAlign: 'center',
    letterSpacing: 0.3
,
  },
  step3Wrap: {
    alignItems: 'center
',
    paddingVertical: 8,
  },
  spinner: {

    marginBottom: 20,
  },
  loaderHaloWrap: 
{
    width: 92,
    height: 92,
    alignIte
ms: 'center',
    justifyContent: 'center',
 
   alignSelf: 'center',
    marginBottom: 22,

    shadowColor: ACCENT,
    shadowOffset: {
 width: 0, height: 0 },
    shadowOpacity: 0.
65,
    shadowRadius: 18,
    elevation: 10,

  },
  loaderRing: {
    position: 'absolute'
,
    width: 92,
    height: 92,
    borderRa
dius: 46,
    borderWidth: 3,
    borderColor
: 'rgba(250,204,21,0.18)',
    borderTopColor
: ACCENT,
  },
  loaderInner: {
    width: 70
,
    height: 70,
    borderRadius: 35,
    b
ackgroundColor: '#161B23',
    alignItems: 'c
enter',
    justifyContent: 'center',
    bor
derWidth: 1,
    borderColor: 'rgba(250,204,2
1,0.20)',
  },
  waitTitle: {
    color: '#FF
FFFF',
    fontSize: 18,
    fontWeight: '700
',
    textAlign: 'center',
    marginBottom:
 6,
    letterSpacing: 0.3,
  },
  waitPin: {

    color: '#D1D5DB',
    fontSize: 13,
    
textAlign: 'center',
    lineHeight: 20,
    
paddingHorizontal: 8,
    marginBottom: 14,
 
 },
  amountPill: {
    flexDirection: 'row',

    alignItems: 'center',
    gap: 6,
    ba
ckgroundColor: 'rgba(250,204,21,0.10)',
    b
orderRadius: 999,
    paddingHorizontal: 12,

    paddingVertical: 6,
    borderWidth: 1,
 
   borderColor: 'rgba(250,204,21,0.30)',
    
marginBottom: 14,
  },
  amountPillText: {
  
  color: ACCENT,
    fontSize: 13,
    fontWe
ight: '800',
    letterSpacing: 0.4,
  },
  c
ountdown: {
    color: ACCENT,
    fontSize: 
38,
    fontWeight: '800',
    letterSpacing:
 3,
    marginBottom: 16,
    textShadowColor
: ACCENT_GLOW,
    textShadowOffset: { width:
 0, height: 0 },
    textShadowRadius: 12,
  
},
  orderHint: {
    color: '#6B7280',
    f
ontSize: 11,
    fontWeight: '500',
    paddi
ngHorizontal: 12,
  },
  orderPill: {
    fle
xDirection: 'row',
    alignItems: 'center',

    gap: 8,
    backgroundColor: '#1A1F28',
 
   borderRadius: 999,
    paddingHorizontal: 
14,
    paddingVertical: 8,
    borderWidth: 
1,
    borderColor: 'rgba(255,255,255,0.06)',

    maxWidth: '92%',
  },
  orderPillLabel: 
{
    color: '#9CA3AF',
    fontSize: 11,
   
 fontWeight: '700',
    letterSpacing: 0.4,
 
   textTransform: 'uppercase',
  },
  orderPi
llValue: {
    color: '#E5E7EB',
    fontSize
: 11,
    fontWeight: '600',
    letterSpacin
g: 0.3,
    flexShrink: 1,
  },
  resultWrap:
 {
    paddingVertical: 6,
    paddingHorizon
tal: 4,
    alignItems: 'center',
  },
  succ
essIconHalo: {
    width: 76,
    height: 76,

    alignItems: 'center',
    justifyContent
: 'center',
    marginBottom: 10,
    shadowC
olor: '#22C55E',
    shadowOffset: { width: 0
, height: 0 },
    shadowOpacity: 0.55,
    s
hadowRadius: 16,
    elevation: 10,
  },
  su
ccessIconCircle: {
    width: 56,
    height:
 56,
    borderRadius: 28,
    backgroundColo
r: '#4ADE80',
    alignItems: 'center',
    j
ustifyContent: 'center',
    borderWidth: 2,

    borderColor: 'rgba(74,222,128,0.45)',
  }
,
  successIcon: {
    alignSelf: 'center',
 
   width: 44,
    height: 44,
    borderRadiu
s: 22,
    textAlign: 'center',
    textAlign
Vertical: 'center',
    lineHeight: 44,
    f
ontSize: 24,
    fontWeight: '900',
    color
: '#0F172A',
    backgroundColor: '#4ADE80',

    marginBottom: 10,
  },
  successTitle: {

    color: '#4ADE80',
    fontSize: 20,
    f
ontWeight: '800',
    marginBottom: 8,
    te
xtAlign: 'center',
    letterSpacing: 0.3,
  
},
  successBody: {
    color: '#D1D5DB',
   
 fontSize: 15,
    lineHeight: 22,
    textAl
ign: 'center',
    marginBottom: 10,
    padd
ingHorizontal: 4,
  },
  successFootnote: {
 
   color: TEXT_MUTED,
    fontSize: 13,
    l
ineHeight: 19,
    textAlign: 'center',
    m
arginBottom: 14,
    paddingHorizontal: 6,
  
},
  successHighlight: {
    color: '#FFFFFF'
,
    fontWeight: '800',
  },
  failIconHalo:
 {
    width: 76,
    height: 76,
    alignIt
ems: 'center',
    justifyContent: 'center',

    marginBottom: 14,
    shadowColor: '#EF44
44',
    shadowOffset: { width: 0, height: 0 
},
    shadowOpacity: 0.55,
    shadowRadius:
 16,
    elevation: 10,
  },
  failIconCircle
: {
    width: 56,
    height: 56,
    border
Radius: 28,
    backgroundColor: '#EF4444',
 
   alignItems: 'center',
    justifyContent: 
'center',
    borderWidth: 2,
    borderColor
: 'rgba(239,68,68,0.45)',
  },
  failTitle: {

    color: '#F87171',
    fontSize: 20,
    
fontWeight: '800',
    marginBottom: 12,
    
textAlign: 'center',
    letterSpacing: 0.3,

  },
  failIcon: {
    alignSelf: 'center',
 
   width: 44,
    height: 44,
    borderRadiu
s: 22,
    textAlign: 'center',
    textAlign
Vertical: 'center',
    lineHeight: 44,
    f
ontSize: 24,
    fontWeight: '900',
    color
: '#FFFFFF',
    backgroundColor: '#EF4444',

    marginBottom: 10,
  },
  failBody: {
    
color: '#E5E7EB',
    fontSize: 14,
    lineH
eight: 21,
    textAlign: 'center',
    margi
nBottom: 22,
  },
  resultCta: {
    marginTo
p: 0,
    marginBottom: 8,
  },
  resultSecon
dary: {
    marginTop: 0,
    marginBottom: 8
,
  },
  cancelBtn: {
    width: '100%',
    
minHeight: 56,
    paddingVertical: 16,
    p
addingHorizontal: 20,
    borderRadius: 16,
 
   borderWidth: 1,
    borderColor: 'rgba(255
,255,255,0.12)',
    alignItems: 'center',
  
  justifyContent: 'center',
    alignSelf: 's
tretch',
    backgroundColor: 'rgba(255,255,2
55,0.02)',
  },
  cancelBtnText: {
    color:
 '#E5E7EB',
    fontSize: 16,
    fontWeight:
 '700',
    textAlign: 'center',
    letterSp
acing: 0.4,
  },
});



