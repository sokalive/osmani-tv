#!/usr/bin/env node
'use strict';

/**
 * SonicPesa PIN wait (02:00), attempt cooldown popup, and no generic retry popup.
 * Mocks only — no network and no charges.
 * Run: node scripts/verify-sonicpesa-attempt-cooldown.js
 */

const fs = require('fs');
const path = require('path');
const { createRequire } = require('module');
const requireCjs = createRequire(__filename);
const {
  COOLDOWN_POPUP_COPY,
  SONICPESA_ATTEMPT_COOLDOWN_CODE,
  SONICPESA_PIN_WAIT_SEC,
  cooldownFromCheckoutError,
  formatPinCountdown,
  parseSonicpesaAttemptCooldown,
  sonicpesaCancelAction,
  sonicpesaCheckoutGate,
  sonicpesaInitFailurePresentation,
  sonicpesaPaymentFailureAction,
  sonicpesaPinTimerExpiredAction,
} = require('../lib/sonicpesaAttemptCooldown');

const root = path.join(__dirname, '..');

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

function fail(msg) {
  console.error('FAIL:', msg);
  process.exitCode = 1;
}

function pass(msg) {
  console.log('PASS:', msg);
}

function assert(cond, msg) {
  if (!cond) fail(msg);
  else pass(msg);
}

const modal = read('components/PremiumModal.js');
const waiting = read('components/PaymentWaitingStep.js');
const popup = read('components/SonicpesaAttemptCooldownModal.js');
const payment = read('api/payment.js');
const store = read('lib/sonicpesaAttemptCooldownStore.js');

const UNTIL = '2026-10-19T06:03:00.000Z';
const NOW = Date.parse('2026-10-19T06:00:00.000Z');
const cooldownBody = {
  ok: false,
  code: 'SONICPESA_PAY_ATTEMPT_COOLDOWN',
  cooldown_seconds: 180,
  cooldown_until: UNTIL,
  pin_wait_allowed: false,
  retryable: false,
};

assert(formatPinCountdown(SONICPESA_PIN_WAIT_SEC) === '02:00', 'PIN countdown starts at 02:00');
assert(formatPinCountdown(0) === '00:00', 'PIN countdown reaches 00:00');
assert(SONICPESA_PIN_WAIT_SEC === 120, 'PIN wait is 120 seconds');

const parsed = parseSonicpesaAttemptCooldown(cooldownBody, 429);
assert(
  parsed &&
    parsed.code === SONICPESA_ATTEMPT_COOLDOWN_CODE &&
    parsed.cooldownUntilMs === Date.parse(UNTIL) &&
    parsed.cooldownSeconds === 180,
  'backend 429 cooldown contract is recognized',
);
assert(parseSonicpesaAttemptCooldown({ error: 'Too Many Attempts.' }, 429) == null, 'provider 429 is not the attempt cooldown');
assert(parseSonicpesaAttemptCooldown(cooldownBody, 201) == null, 'HTTP 201 is not a cooldown');

const fromError = cooldownFromCheckoutError({
  code: cooldownBody.code,
  cooldownUntil: cooldownBody.cooldown_until,
  cooldownSeconds: 180,
  httpStatus: 429,
});
assert(fromError && fromError.cooldownUntilMs === Date.parse(UNTIL), 'checkout error carries cooldown_until');

assert(
  sonicpesaInitFailurePresentation('sonicpesa', { httpStatus: 429, code: 'OTHER' }) === 'payment_screen',
  'SonicPesa rejection stays on the payment screen',
);
assert(
  sonicpesaInitFailurePresentation('sonicpesa', {
    httpStatus: 429,
    code: SONICPESA_ATTEMPT_COOLDOWN_CODE,
    cooldownUntil: UNTIL,
  }) === 'cooldown_popup',
  'attempt-limit response opens the cooldown popup',
);
assert(
  sonicpesaInitFailurePresentation('zenopay', { httpStatus: 500 }) === 'payment_screen',
  'other providers do not get the removed generic popup',
);

const expired = sonicpesaPinTimerExpiredAction();
assert(
  expired.closeModal === true &&
    expired.createOrder === false &&
    expired.showGenericFailure === false &&
    expired.definitiveFailure === false,
  'PIN timer expiry returns to the channel without a new payment',
);
const cancel = sonicpesaCancelAction();
assert(cancel.closeModal === true && cancel.createOrder === false, 'GHAIRI does not start another payment');

assert(sonicpesaCheckoutGate(null, NOW).action === 'allow_server', 'no stored cooldown asks the server');
assert(
  sonicpesaCheckoutGate({ cooldownUntilMs: NOW + 180000 }, NOW + 1000).action === 'block_local',
  'active cooldown blocks without a create-order',
);
assert(
  sonicpesaCheckoutGate({ cooldownUntilMs: NOW - 1 }, NOW).action === 'revalidate_server',
  'expired cooldown must be revalidated on the server',
);

function simulateCustomerAttempts() {
  let stored = null;
  let now = NOW;
  const calls = [];
  function press(backend) {
    const gate = sonicpesaCheckoutGate(stored, now);
    if (gate.action === 'block_local') {
      return { createOrder: false, ui: 'cooldown_popup' };
    }
    calls.push(gate.action);
    const response = backend();
    if (response.kind === 'accepted') {
      stored = null;
      return { createOrder: true, ui: 'pin', reference: response.provider_order_id };
    }
    if (response.kind === 'cooldown') {
      stored = { cooldownUntilMs: Date.parse(response.cooldown_until) };
      return { createOrder: true, ui: 'cooldown_popup' };
    }
    if (response.kind === 'ambiguous') {
      return { createOrder: true, ui: 'payment_screen', autoRetry: false };
    }
    return { createOrder: true, ui: 'payment_screen', autoRetry: false };
  }
  return { press, calls: () => calls.slice(), stored: () => stored };
}

const flow = simulateCustomerAttempts();
const accepted = () => ({ kind: 'accepted', provider_order_id: 'sp_ok', provider_initiation: 'accepted' });
const first = flow.press(accepted);
const second = flow.press(accepted);
const third = flow.press(accepted);
assert(
  first.ui === 'pin' && second.ui === 'pin' && third.ui === 'pin' && first.reference === 'sp_ok',
  'first three attempts open PIN only after provider acceptance',
);
assert(flow.calls().length === 3 && flow.calls().every((a) => a === 'allow_server'), 'each allowed attempt is a new server request');

const fourth = flow.press(() => ({ kind: 'cooldown', cooldown_until: UNTIL }));
assert(fourth.ui === 'cooldown_popup' && fourth.createOrder === true, 'fourth attempt receives the backend cooldown response');
const repeated = flow.press(accepted);
assert(repeated.createOrder === false && repeated.ui === 'cooldown_popup', 'cooldown blocks another create-order');
assert(flow.calls().length === 4, 'no create-order is issued while cooldown is active');

const ambiguous = flow.press;
void ambiguous;
const ambFlow = simulateCustomerAttempts();
const amb = ambFlow.press(() => ({ kind: 'ambiguous' }));
assert(amb.ui === 'payment_screen' && amb.autoRetry === false && ambFlow.calls().length === 1, 'ambiguous response does not auto-retry');

const reopen = sonicpesaCheckoutGate({ cooldownUntilMs: Date.parse(UNTIL) }, NOW + 5000);
assert(reopen.action === 'block_local', 'reopening the app does not bypass a stored cooldown');

assert(COOLDOWN_POPUP_COPY.heading === 'Tafadhali subiri kidogo', 'heading text');
assert(
  COOLDOWN_POPUP_COPY.message ===
    'Umefikia kikomo cha maombi 3 ya\nmalipo. Tafadhali subiri dakika 3\nkabla ya kujaribu kulipia tena.',
  'message text matches the reference line breaks',
);
assert(COOLDOWN_POPUP_COPY.button === 'SAWA', 'SAWA label');
assert(COOLDOWN_POPUP_COPY.support === 'Unaweza kujaribu tena baada ya muda kuisha.', 'supporting text');

assert(popup.includes('time-outline'), 'popup uses a clock icon');
assert(popup.includes("backgroundColor: '#000000'"), 'popup backdrop is black');
assert(popup.includes("borderColor: '#FF2A2A'"), 'popup card has a red outline');
assert(popup.includes("shadowColor: '#FF1A1A'"), 'popup card has a red glow');
assert(popup.includes('COOLDOWN_POPUP_COPY.heading'), 'popup shows the heading');
assert(popup.includes('COOLDOWN_POPUP_COPY.message'), 'popup shows the message');
assert(popup.includes('COOLDOWN_POPUP_COPY.button'), 'popup shows SAWA');
assert(popup.includes('COOLDOWN_POPUP_COPY.support'), 'popup shows the supporting line');
assert(popup.includes('onPress={onDismiss}'), 'SAWA only dismisses the popup');
assert(!popup.includes('startPayment') && !popup.includes('createSonicpesaOrder'), 'popup does not start a payment');
assert(!popup.includes('countdown') && !popup.includes('remaining'), 'popup does not add its own countdown');

assert(modal.includes('SONICPESA_PIN_WAIT_SEC'), 'waiting screen uses the two-minute SonicPesa window');
assert(modal.includes("checkoutProvider === 'sonicpesa' ? SONICPESA_PIN_WAIT_SEC"), 'SonicPesa total wait is 02:00');
assert(modal.includes('sonicpesaPinCountdownAllowed(created)'), 'PIN opens only after provider acceptance');
assert(modal.includes("checkoutProviderRef.current === 'sonicpesa'"), 'SonicPesa timer expiry is handled separately');
assert(modal.includes('sonicpesaCheckoutGate'), 'checkout consults the stored server cooldown');
assert(modal.includes("gate.action === 'block_local'"), 'active cooldown returns before create-order');
assert(modal.includes('sonicpesaInitFailurePresentation'), 'SonicPesa initiation does not use the generic failure route blindly');
assert(modal.includes('SonicpesaAttemptCooldownModal'), 'cooldown popup is mounted');
assert(modal.includes('onDismiss={() => setAttemptCooldownVisible(false)}'), 'dismiss does not clear cooldown or pay');
assert(waiting.includes('formatPinCountdown'), 'waiting clock uses the 02:00 formatter');
assert(payment.includes('cooldown_until'), 'create-order keeps the backend cooldown fields');
assert(store.includes('osmani_sonicpesa_pay_attempt_cooldown_v1'), 'cooldown survives app restart in storage');
const failed = sonicpesaPaymentFailureAction();
assert(
  failed.stayOnWaitingScreen === true &&
    failed.showGenericFailurePopup === false &&
    failed.createOrder === false &&
    failed.grantEntitlement === false,
  'failed SonicPesa status stays on the waiting screen',
);
assert(!modal.includes('Malipo hayajakamilika'), 'generic failure title is not in the payment modal');
assert(!modal.includes('Malipo hayajafanikiwa'), 'generic failure body is not in the payment modal');
assert(!modal.includes('>FUNGA<') && !modal.includes('FUNGA'), 'generic FUNGA button is removed');
assert(!modal.includes('setStep(5)'), 'failure no longer opens the removed popup step');
assert(modal.includes('sonicpesaPaymentFailureAction'), 'status failure uses the waiting-screen action');
assert(modal.includes('setStep(3)'), 'failed status remains on the waiting screen');
assert(waiting.includes('Hatujapata uthibitisho wa malipo'), 'waiting screen shows the failed status inline');
assert(!waiting.includes('Malipo hayajakamilika') && !waiting.includes('JARIBU TENA'), 'waiting screen does not recreate the popup');

const payIdx = modal.indexOf('const handleStep2Pay');
const gateIdx = modal.indexOf("gate.action === 'block_local'", payIdx);
const startIdx = modal.indexOf('const startPayment = resolveCheckoutStartPayment', payIdx);
assert(gateIdx > payIdx && startIdx > gateIdx, 'cooldown block is before create-order');

const { formatCheckoutPaymentError } = requireCjs('../lib/paymentCheckoutErrors.js');
const terminal = formatCheckoutPaymentError('Imeshindwa kuanzisha malipo. Jaribu tena baadae.', {
  httpStatus: 502,
  provider: 'sonicpesa',
  body: {
    error: 'Imeshindwa kuanzisha malipo. Jaribu tena baadae.',
    checkout_phase: 'terminal_failure',
    provider_initiation: 'failed',
    pin_wait_allowed: false,
  },
});
assert(
  terminal === 'Imeshindwa kuanzisha malipo. Jaribu tena baadae.' &&
    !terminal.includes('Seva ya malipo haipatikani'),
  'SonicPesa terminal rejection is not rewritten as server unavailable',
);
const gateway = formatCheckoutPaymentError('Bad Gateway', {
  httpStatus: 502,
  provider: 'sonicpesa',
  body: { error: 'Bad Gateway' },
});
assert(gateway.includes('Seva ya malipo haipatikani'), 'a real gateway 502 stays server-unavailable');
const rate = formatCheckoutPaymentError('Maombi mengi sana. Subiri kidogo kisha ujaribu tena.', {
  httpStatus: 429,
  provider: 'sonicpesa',
  body: { error: 'Maombi mengi sana. Subiri kidogo kisha ujaribu tena.', checkout_phase: 'retryable_rejection', provider_initiation: 'rejected_retryable' },
});
assert(!rate.includes('Seva ya malipo haipatikani') && !rate.includes('SONICPESA_PAY_ATTEMPT_COOLDOWN'), 'provider 429 is not the cooldown or a dead server');
const ambiguousMessage = formatCheckoutPaymentError('Hatujapata jibu la malipo. Subiri kidogo usijaribu mara mbili.', {
  httpStatus: 409,
  provider: 'sonicpesa',
  body: { checkout_phase: 'ambiguous', provider_initiation: 'ambiguous' },
});
assert(ambiguousMessage.includes('Hatujapata jibu la malipo') && !ambiguousMessage.includes('Seva ya malipo haipatikani'), 'ambiguous timeout is not server-unavailable');
assert(!modal.includes('[Jaribio]'), 'diagnostic Jaribio prefix is not shown to customers');
assert(modal.includes("setSonicpesaNotice('')"), 'phone screen clears a previous checkout notice');
const openReset = modal.indexOf('useLayoutEffect');
const clearIdx = modal.indexOf("setSonicpesaNotice('')", openReset);
assert(openReset > 0 && clearIdx > openReset, 'opening the payment screen clears a stale notice');

if (process.exitCode) process.exit(1);
console.log('\n[verify-sonicpesa-attempt-cooldown] ok');
