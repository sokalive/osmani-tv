/**
 * Pure unit checks (no Expo runtime). Run: node scripts/test-osmani-link-silent-auth.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(root, 'lib', 'osmaniLinkSilentAuth.js'), 'utf8');

assert.match(src, /OSMANI_AUTHORIZE_URL/);
assert.match(src, /app_authorize\.php/);
assert.match(src, /app_token_refresh\.php/);
assert.match(src, /X-Osmani-App-Id/);
assert.match(src, /X-Osmani-Access-Key/);
assert.match(src, /single-flight|state\.promise/);
assert.match(src, /missing_access_key/);
assert.doesNotMatch(src, /EXPO_PUBLIC_OSMANI_LINK_ACCESS_KEY\s*=\s*['\"][0-9a-f]{20,}/i);

function isOsmaniLinkEmbedUrl(url) {
  const s = String(url || '').trim();
  try {
    const u = new URL(s);
    if (u.hostname.toLowerCase() !== 'links.osmanlink.site') return false;
    return (
      u.pathname === '/embed' ||
      u.pathname === '/embed.php' ||
      u.pathname === '/embed/' ||
      /^\/c\/\d+$/.test(u.pathname) ||
      u.pathname === '/player.php'
    );
  } catch {
    return false;
  }
}

assert.equal(isOsmaniLinkEmbedUrl('https://links.osmanlink.site/embed?channel=11'), true);
assert.equal(isOsmaniLinkEmbedUrl('https://links.osmanlink.site/c/5'), true);
assert.equal(isOsmaniLinkEmbedUrl('https://evil.example/embed?channel=11'), false);

const playerScreen = fs.readFileSync(path.join(root, 'screens', 'ChannelPlayerScreen.js'), 'utf8');
assert.match(playerScreen, /ensureOsmaniLinkSession/);
assert.match(playerScreen, /sharedCookiesEnabled/);
assert.match(playerScreen, /needsOsmaniLinkAuth/);

console.log('PASS osmani-link silent auth static checks');
