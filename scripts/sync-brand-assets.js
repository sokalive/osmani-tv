/**
 * Copies newer duplicate brand files into canonical Expo paths.
 * Expo only bundles: assets/icon.png, assets/adaptive-icon.png, assets/splash-icon.png, assets/favicon.png
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const pairs = [
  ['assets/icon (2).png', 'assets/icon.png'],
  ['assets/adaptive-icon (2).png', 'assets/adaptive-icon.png'],
];

function copyIfNewer(srcRel, destRel) {
  const src = path.join(root, srcRel);
  const dest = path.join(root, destRel);
  if (!fs.existsSync(src)) {
    console.log(`[sync-brand-assets] skip (missing): ${srcRel}`);
    return;
  }
  if (!fs.existsSync(dest)) {
    fs.copyFileSync(src, dest);
    console.log(`[sync-brand-assets] copied → ${destRel}`);
    return;
  }
  const srcStat = fs.statSync(src);
  const destStat = fs.statSync(dest);
  if (srcStat.mtimeMs > destStat.mtimeMs + 500 || srcStat.size > destStat.size * 2) {
    fs.copyFileSync(src, dest);
    console.log(`[sync-brand-assets] updated ${destRel} from ${srcRel}`);
  } else {
    console.log(`[sync-brand-assets] up to date: ${destRel}`);
  }
}

for (const [src, dest] of pairs) {
  copyIfNewer(src, dest);
}

const required = ['assets/icon.png', 'assets/adaptive-icon.png', 'assets/splash-icon.png', 'assets/favicon.png'];
for (const rel of required) {
  const abs = path.join(root, rel);
  if (!fs.existsSync(abs)) {
    console.error(`[sync-brand-assets] missing required asset: ${rel}`);
    process.exitCode = 1;
  }
}
