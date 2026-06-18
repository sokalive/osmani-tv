/**
 * Live check: WhatsApp API + SSE bootstrap (run: node scripts/verify-whatsapp-support.js)
 */
const BASE = process.env.API_URL || process.env.EXPO_PUBLIC_API_URL || 'http://144.91.117.90:10001';

async function parseJson(res) {
  const t = await res.text();
  try {
    return t ? JSON.parse(t) : null;
  } catch {
    return { _raw: t?.slice(0, 200) };
  }
}

async function checkHttp() {
  const paths = ['/api/whatsapp-settings', '/api/public/whatsapp-settings'];
  const out = {};
  for (const path of paths) {
    const res = await fetch(`${BASE}${path}`);
    const body = await parseJson(res);
    out[path] = { status: res.status, body };
  }
  return out;
}

function listenSse(ms = 10000) {
  return new Promise((resolve) => {
    const https = require('https');
    const events = [];
    const streamUrl = `${BASE.replace(/\/+$/, '')}/api/sync/stream`;
    const req = https.get(
      streamUrl,
      { headers: { Accept: 'text/event-stream' } },
      (res) => {
        let buf = '';
        const done = () => resolve({ status: res.statusCode, events });
        const timer = setTimeout(done, ms);
        res.on('data', (chunk) => {
          buf += chunk.toString();
          const blocks = buf.split('\n\n');
          buf = blocks.pop() || '';
          for (const block of blocks) {
            const name = (block.match(/^event:\s*(.+)$/m) || [])[1]?.trim();
            if (name) events.push(name);
            if (name && name.includes('whatsapp')) {
              clearTimeout(timer);
              done();
            }
          }
        });
        res.on('end', () => {
          clearTimeout(timer);
          done();
        });
      },
    );
    req.on('error', (e) => resolve({ error: e.message }));
  });
}

async function main() {
  console.log('[WHATSAPP_VERIFY] base', BASE);
  const http = await checkHttp();
  console.log('[WHATSAPP_VERIFY] HTTP', JSON.stringify(http, null, 2));

  const sse = await listenSse(12000);
  console.log('[WHATSAPP_VERIFY] SSE', JSON.stringify(sse, null, 2));

  const canonical = http['/api/whatsapp-settings'];
  if (canonical?.status === 200 && canonical.body?.enabled === true) {
    console.log('[WHATSAPP_VERIFY] OK — public GET returns enabled + url (existing APKs recover without store update).');
  } else if (canonical?.status === 401) {
    console.log(
      '[WHATSAPP_VERIFY] BLOCKER — GET /api/whatsapp-settings requires admin session (NO_SESSION).',
    );
    console.log(
      '  Fix on osmani-admin-api: allow anonymous GET on /api/whatsapp-settings (read-only),',
    );
    console.log(
      '  OR emit whatsapp_settings_changed on /api/sync/stream connect (like server_health_changed).',
    );
  } else {
    console.log('[WHATSAPP_VERIFY] WARN — unexpected HTTP state; check admin DB + route.');
  }

  const hasWhatsappSse = (sse.events || []).some((e) => String(e).includes('whatsapp'));
  if (!hasWhatsappSse) {
    console.log('[WHATSAPP_VERIFY] SSE init does not include whatsapp_settings_changed (cold start needs public GET).');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
