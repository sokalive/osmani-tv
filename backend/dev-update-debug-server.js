/**
 * Standalone local dev server for the OTA debug surface.
 *
 * NOTE: This file is intentionally NOT registered from `backend/server.js`
 * and is NOT included in the Render deployment of `osmani-admin-api`. It is a
 * developer tool you can run locally to validate the mobile-side debug
 * overlay end-to-end against the same JSON shape your real admin-api will
 * eventually expose.
 *
 * Endpoints:
 *   GET  /                           HTML help page
 *   GET  /api                        Self-description
 *   GET  /api/health                 Liveness
 *   GET  /api/update-check           Returns the currently-set decision payload
 *   GET  /api/sync/stream            SSE stream — admin pushes change events here
 *   GET  /api/update-debug           Aggregated debug snapshot
 *   POST /api/admin/update-settings  Sets the decision payload + broadcasts SSE
 *
 * Run:
 *   node backend/dev-update-debug-server.js
 *   PORT=4001 node backend/dev-update-debug-server.js
 *
 * Set EXPO_PUBLIC_API_URL=http://10.0.2.2:4001 (Android emulator) or your LAN
 * IP (physical device) before `expo start` to point the mobile app at this
 * server instead of production.
 */

'use strict';

const http = require('http');
const express = require('express');
const createUpdateDebug = require('./routes/updateDebug');

const PORT = Number(process.env.PORT || 4001);
const app = express();
app.use(express.json({ limit: '64kb' }));
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
});

const updateDebug = createUpdateDebug();
updateDebug.attach(app);

let currentSettings = {
  decision: 'NONE',
  source: 'apk',
  apk_url: '',
  apk_sha256: '',
  playstore_url: '',
  auto_download: false,
  notice: '',
  latest_version_code: 1,
  latest_version_name: '1.0.0',
  min_supported_version_code: 1,
  apk_size_bytes: 0,
  release_notes: '',
};
updateDebug.recordSettingsSave(currentSettings);

function nowIso() {
  return new Date().toISOString();
}

app.get('/', (_req, res) => {
  res.type('html').send(`<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>OTA Debug Dev Server</title>
    <style>
      body { font: 14px/1.5 system-ui, sans-serif; margin: 28px; color: #111; }
      code { background: #f3f4f6; padding: 1px 6px; border-radius: 4px; }
      h1 { font-size: 20px; }
      ul { line-height: 1.8; }
    </style>
  </head>
  <body>
    <h1>OTA Debug Dev Server</h1>
    <p>Listening on port <code>${PORT}</code>.</p>
    <ul>
      <li><a href="/api">/api</a> — self-description</li>
      <li><a href="/api/update-check?platform=android&package=com.osmantv.app&version_code=1&version_name=1.0.0">/api/update-check</a></li>
      <li><a href="/api/update-debug">/api/update-debug</a></li>
      <li><a href="/api/sync/stream">/api/sync/stream</a> (SSE)</li>
      <li>POST <code>/api/admin/update-settings</code> with a JSON body to change the live decision payload.</li>
    </ul>
    <p>Set <code>EXPO_PUBLIC_API_URL=http://YOUR_HOST:${PORT}</code> in the mobile workspace before <code>expo start</code>.</p>
  </body>
</html>`);
});

app.get('/api', (_req, res) => {
  res.json({
    service: 'osmani-update-debug-dev',
    started_at: nowIso(),
    endpoints: ['/api/health', '/api/update-check', '/api/update-debug', '/api/sync/stream', '/api/admin/update-settings'],
  });
});

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'osmani-update-debug-dev' });
});

app.get('/api/update-check', (req, res) => {
  const payload = {
    decision: currentSettings.decision || 'NONE',
    source: currentSettings.source || 'apk',
    apk_url: currentSettings.apk_url || '',
    apk_sha256: currentSettings.apk_sha256 || '',
    playstore_url: currentSettings.playstore_url || '',
    auto_download: !!currentSettings.auto_download,
    server_time: nowIso(),
    notice: currentSettings.notice || '',
    latest_version_code: Number(currentSettings.latest_version_code || 0),
    latest_version_name: String(currentSettings.latest_version_name || ''),
    min_supported_version_code: Number(currentSettings.min_supported_version_code || 0),
    apk_size_bytes: Number(currentSettings.apk_size_bytes || 0),
    release_notes: String(currentSettings.release_notes || ''),
  };
  console.log(
    '[update-debug]',
    '[CHECK_REQ]',
    JSON.stringify({
      ip: (req.headers['x-forwarded-for'] || req.connection.remoteAddress || '').toString(),
      ua: String(req.headers['user-agent'] || '').slice(0, 120),
      query: req.query,
    }),
  );
  updateDebug.recordCheck(req, payload);
  res.json(payload);
});

app.post('/api/admin/update-settings', (req, res) => {
  const body = req.body || {};
  currentSettings = { ...currentSettings, ...body };
  console.log('[update-debug]', '[ADMIN_REQ]', JSON.stringify(body));
  updateDebug.recordSettingsSave(currentSettings);
  // Tell connected clients to re-check.
  updateDebug.broadcast('app_version_changed', {
    at: nowIso(),
    latest_version_code: currentSettings.latest_version_code,
    latest_version_name: currentSettings.latest_version_name,
  });
  res.json({ ok: true, current_settings: currentSettings });
});

const server = http.createServer(app);
server.listen(PORT, '0.0.0.0', () => {
  console.log('[update-debug]', '[SERVER_READY]', `http://0.0.0.0:${PORT}`);
});

server.on('close', () => {
  console.log('[update-debug]', '[SERVER_STOPPED]');
});
