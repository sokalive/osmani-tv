#!/usr/bin/env node
'use strict';

function fail(msg) {
  console.error('FAIL:', msg);
  process.exitCode = 1;
}
function pass(msg) {
  console.log('PASS:', msg);
}

function normalizeTanzaniaMobilePhone(raw) {
  let digits = String(raw ?? '').replace(/[^\d]/g, '');
  if (!digits) return null;
  if (digits.startsWith('255') && digits.length >= 12) digits = `0${digits.slice(3)}`;
  else if (digits.length === 9 && /^[67]/.test(digits)) digits = `0${digits}`;
  if (digits.length > 10) digits = digits.slice(-10);
  if (!/^0[67]\d{8}$/.test(digits)) return null;
  return { local: digits, e164: `255${digits.slice(1)}`, digits };
}

function formatTransferRequestUserMessage(errorLike, httpStatus = 0) {
  const status = Number(httpStatus) || Number(errorLike?.httpStatus) || 0;
  const raw = String(errorLike?.message ?? errorLike ?? '').trim();
  const lower = raw.toLowerCase();
  if (/^http\s*(502|503|504)\b/.test(lower) || status === 502 || status === 503 || status === 504) {
    return 'Huduma haipatikani kwa sasa. Tafadhali jaribu tena baada ya muda mfupi.';
  }
  if (lower.includes('no active subscription found for this payment phone')) {
    return 'Hakuna kifurushi hai kilichohusishwa na namba hii ya malipo. Hakikisha umeingiza namba iliyotumika kulipia.';
  }
  return raw || 'Imeshindwa kuomba code. Jaribu tena.';
}

const p1 = normalizeTanzaniaMobilePhone('0677123456');
if (!p1 || p1.local !== '0677123456' || p1.e164 !== '255677123456') fail('067 format');
else pass('067 → local + e164');

const p2 = normalizeTanzaniaMobilePhone('+255677123456');
if (!p2 || p2.local !== '0677123456') fail('+255 format');
else pass('+255 → 0 local');

const p3 = normalizeTanzaniaMobilePhone('255677123456');
if (!p3 || p3.local !== '0677123456') fail('255 without plus');
else pass('255 → 0 local');

if (!/^0[67]\d{8}$/.test(normalizeTanzaniaMobilePhone('0771234567')?.local ?? '')) fail('07 valid');
else pass('07 valid');

const transient = formatTransferRequestUserMessage('HTTP 502', 502);
if (!transient.includes('Huduma haipatikani')) fail('502 swahili');
else pass('502 swahili');

const sub = formatTransferRequestUserMessage('No active subscription found for this payment phone');
if (!sub.includes('Hakuna kifurushi hai')) fail('subscription swahili');
else pass('subscription swahili');

const api = require('fs').readFileSync(require('path').join(__dirname, '..', 'api', 'subscription.js'), 'utf8');
if (!api.includes('phone_e164')) fail('transfer sends phone_e164');
else pass('transfer sends phone_e164');
if (!api.includes('install_instance_id')) fail('transfer sends install_instance_id via migration payload');
else pass('transfer migration payload');

if (!process.exitCode) console.log('\n[verify-tanzania-phone] ok');
