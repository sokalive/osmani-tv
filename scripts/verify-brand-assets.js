/**
 * Prebuild guard: canonical brand assets exist; warn if "(2)" duplicates are newer than bundled paths.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.join(__dirname, '..');

const CANONICAL = {
  icon: 'assets/icon.png',
  adaptiveIcon: 'assets/adaptive-icon.png',
  splash: 'assets/splash-icon.png',
  favicon: 'assets/favicon.png',
};

const DUPLICATE_PAIRS = [
  ['assets/icon (2).png', CANONICAL.icon],
  ['assets/adaptive-icon (2).png', CANONICAL.adaptiveIcon],
];

function sha256(rel) {
  const abs = path.join(root, rel);
  return crypto.createHash('sha256').update(fs.readFileSync(abs)).digest('hex').slice(0, 12);
}

let failed = false;

for (const rel of Object.values(CANONICAL)) {
  const abs = path.join(root, rel);
  if (!fs.existsSync(abs)) {
    console.error(`[verify-brand-assets] missing: ${rel}`);
    failed = true;
    continue;
  }
  console.log(`[verify-brand-assets] ok ${rel} sha=${sha256(rel)} size=${fs.statSync(abs).size}`);
}

for (const [dupe, canonical] of DUPLICATE_PAIRS) {
  const dupeAbs = path.join(root, dupe);
  const canAbs = path.join(root, canonical);
  if (!fs.existsSync(dupeAbs) || !fs.existsSync(canAbs)) continue;
  if (fs.statSync(dupeAbs).mtimeMs > fs.statSync(canAbs).mtimeMs + 1000) {
    console.warn(
      `[verify-brand-assets] "${dupe}" is newer than "${canonical}". Run: npm run sync:brand-assets — Expo only bundles canonical paths.`,
    );
    failed = true;
  }
}

if (failed) {
  process.exit(1);
}
