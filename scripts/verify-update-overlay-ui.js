#!/usr/bin/env node
'use strict';

/**
 * Verify UpdateOverlay visual styling (message contrast + CTA colors/label).
 * Run: node scripts/verify-update-overlay-ui.js
 */

const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'components', 'UpdateOverlay.js');
const src = fs.readFileSync(file, 'utf8');

function fail(msg) {
  console.error('FAIL:', msg);
  process.exitCode = 1;
}

function pass(msg) {
  console.log('PASS:', msg);
}

if (!src.includes("const BODY_TEXT = '#FFFFFF'")) {
  fail('body text must use pure white BODY_TEXT');
} else pass('body text color is #FFFFFF');

if (!/body:\s*\{[^}]*color:\s*BODY_TEXT/.test(src)) {
  fail('styles.body must reference BODY_TEXT');
} else pass('styles.body uses BODY_TEXT');

if (!/body:\s*\{[^}]*opacity:\s*1/.test(src)) {
  fail('styles.body must set opacity: 1');
} else pass('body text has full opacity');

if (src.includes('OPEN PLAY STORE')) {
  fail('Play Store button label must not be OPEN PLAY STORE');
} else pass('OPEN PLAY STORE label removed');

const playStoreLabelMatches = src.match(
  /if \(isPlayStore \|\| \(!action\.canDownload && action\.canOpenStore\)\) return '([^']+)'/,
);
if (!playStoreLabelMatches || playStoreLabelMatches[1] !== 'UPDATE NOW') {
  fail('Play Store path primary label must be UPDATE NOW');
} else pass('Play Store path uses UPDATE NOW label');

if (src.includes('ACCENT_GRADIENT') || src.includes('LinearGradient')) {
  fail('yellow gradient CTA must be removed');
} else pass('yellow gradient CTA removed');

if (!src.includes("const CTA_RED = '#DC2626'")) {
  fail('CTA must use red background constant');
} else pass('CTA red background defined');

if (!src.includes("const CTA_TEXT = '#FFFFFF'")) {
  fail('CTA text must be pure white');
} else pass('CTA text is #FFFFFF');

if (!/ctaText:\s*\{[^}]*color:\s*CTA_TEXT/.test(src)) {
  fail('styles.ctaText must use CTA_TEXT');
} else pass('styles.ctaText uses white');

if (!/ctaGradient:\s*\{[^}]*backgroundColor:\s*CTA_RED/.test(src)) {
  fail('ctaGradient must use red backgroundColor');
} else pass('cta button background is red');

if (!process.exitCode) {
  console.log('\n[verify-update-overlay-ui] ok');
}
