'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const sub = fs.readFileSync(path.join(root, 'api/subscription.js'), 'utf8');
const sec = fs.readFileSync(path.join(root, 'lib/security/secureScreen.js'), 'utf8');
const aka = fs.readFileSync(path.join(root, 'screens/AkauntiYanguScreen.js'), 'utf8');

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL', msg);
    process.exit(1);
  }
  console.log('OK', msg);
}

assert(!/t\.includes\('block'\)/.test(sub), 'no loose block substring');
assert(!/t\.includes\('forbidden'\)/.test(sub), 'no loose forbidden substring');
assert(!/t\.includes\('zui'\)/.test(sub), 'no loose zui substring');
assert(sub.includes("return 'Code hii imezuiwa'"), 'imezuiwa retained for exact block');
assert(sub.includes('ACTIVE_SUBSCRIPTION_PAYMENT_BLOCK_MESSAGE'), '409 uses payment block message');
assert(sub.includes('OFFER_REDEEM_GENERIC_MESSAGE'), 'generic fallback present');
assert(sub.includes('code_blocked'), 'exact CODE_BLOCKED token');
assert(sub.includes("return 'Code si sahihi'"), 'invalid message retained');
assert(sub.includes("return 'Code hii imeisha muda wake'"), 'expired message retained');
assert(sec.includes('beginSecureScreenExemption'), 'exemption begin');
assert(sec.includes('endSecureScreenExemption'), 'exemption end');
assert(sec.includes('screenshotExemptDepth'), 'ref-counted exemption');
assert(sec.includes('screenshotExemptDepth > 0'), 'refresh respects exemption');
assert(aka.includes('beginSecureScreenExemption'), 'Akaunti begins exemption');
assert(aka.includes('endSecureScreenExemption'), 'Akaunti ends exemption');

console.log('static verify passed');
