#!/usr/bin/env node
'use strict';

/**
 * Hamisha Kifurushi / transfer wiring verification.
 * Run: node scripts/verify-hamisha-transfer.js
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

function fail(msg) {
  console.error('FAIL:', msg);
  process.exitCode = 1;
}
function pass(msg) {
  console.log('PASS:', msg);
}

const hamisha = fs.readFileSync(path.join(root, 'components/HamishaKifurushiModal.js'), 'utf8');
const ctx = fs.readFileSync(path.join(root, 'context/OsmaniAppContext.jsx'), 'utf8');
const policy = fs.readFileSync(path.join(root, 'lib/transferAwaitingSourceApproval.js'), 'utf8');
const sub = fs.readFileSync(path.join(root, 'api/subscription.js'), 'utf8');
const account = fs.readFileSync(path.join(root, 'screens/AkauntiYanguScreen.js'), 'utf8');
const contract = fs.readFileSync(path.join(root, 'docs/device-control-app-backend-contract.md'), 'utf8');

if (hamisha.includes('clearSourceTransferSession?.()') && hamisha.includes('if (visible)')) {
  const openBlock = hamisha.match(/useEffect\(\(\) => \{[\s\S]*?if \(!visible\) return;[\s\S]*?runEnterAnim/);
  if (openBlock && openBlock[0].includes('clearSourceTransferSession')) {
    fail('Hamisha must not clear source session on modal open');
  } else pass('source session preserved on modal reopen');
} else pass('no session wipe on open');

if (!hamisha.includes('isTransferAwaitingSourceApproval')) fail('Hamisha uses approval filter');
else pass('Hamisha approval filter');

if (!hamisha.includes('transfer-source-poll')) fail('source bounded verify poll');
else pass('source bounded verify poll');

if (!hamisha.includes('transfer-target-poll')) fail('target bounded verify poll');
else pass('target bounded verify poll');

if (!ctx.includes('isTransferAwaitingSourceApproval')) fail('context uses approval filter');
else pass('context approval filter');

if (!ctx.includes('devicesShareIdentity(sourceDeviceId')) fail('context uses devicesShareIdentity');
else pass('context devicesShareIdentity match');

if (ctx.includes('ignored_non_transfer_reason')) fail('transfer_completed must not ignore source role');
else pass('transfer_completed source path relaxed');

if (!ctx.includes('admin_force')) fail('admin_force revoke handling');
else pass('admin_force silent revoke');

if (!sub.includes('transferred === true')) fail('redeem detects transferred:true');
else pass('redeem transferred:true');

if (!account.includes('identity.deviceId')) fail('Account canonical deviceId');
else pass('Account canonical deviceId');

if (!contract.includes('/transfer/request')) fail('handoff contract exists');
else pass('handoff contract');

console.log('\nverify-hamisha-transfer:', process.exitCode ? 'FAIL' : 'PASS');
