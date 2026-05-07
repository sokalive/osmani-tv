/**
 * Reference implementation of the OTA debug surface.
 *
 * Exports a factory that returns:
 *   - `attach(app)`            — registers the routes/handlers on an Express app
 *   - `recordCheck(req, payload)` — call from your real /api/update-check
 *                                  handler so the debug endpoint can show the
 *                                  most recent client request and the decision
 *                                  payload that was returned to it.
 *   - `recordSettingsSave(s)`  — call from your admin "save update settings"
 *                                  handler so the debug endpoint shows the
 *                                  current settings and broadcasts an SSE
 *                                  event to connected clients.
 *
 * Endpoints:
 *   GET /api/update-debug    JSON snapshot
 *   GET /api/sync/stream     Server-Sent Events stream (admin -> client push)
 *
 * The handler is **stateless across deploys** by design — the data comes from
 * an in-memory snapshot. That is intentional: this is a debug aid, not a
 * source of truth.
 *
 * Drop-in usage in the real osmani-admin-api repo:
 *
 *     const createUpdateDebug = require('./routes/updateDebug');
 *     const updateDebug = createUpdateDebug();
 *     updateDebug.attach(app);
 *
 *     // Inside your existing /api/update-check handler:
 *     const payload = computeUpdatePayload(req);
 *     updateDebug.recordCheck(req, payload);
 *     return res.json(payload);
 *
 *     // Inside your admin "save update settings" handler:
 *     await db.saveUpdateSettings(next);
 *     updateDebug.recordSettingsSave(next);
 *
 * Constraints honored:
 *   - No DB calls; pure JS objects. Safe to mount even if your DB is offline.
 *   - No auth here. If you want to gate this endpoint, mount it behind your
 *     admin middleware in the real repo.
 */

'use strict';

const MAX_RECENT_CHECKS = 25;

function nowIso() {
  return new Date().toISOString();
}

function safeShortStr(v, max = 200) {
  if (v == null) return null;
  const s = String(v);
  if (s.length <= max) return s;
  return s.slice(0, max) + '…';
}

function pickClientHints(req) {
  if (!req) return {};
  const ua = req.headers ? req.headers['user-agent'] : null;
  const ip =
    (req.headers && (req.headers['x-forwarded-for'] || req.headers['x-real-ip'])) ||
    (req.connection && req.connection.remoteAddress) ||
    req.ip ||
    null;
  return {
    ip: typeof ip === 'string' ? ip.split(',')[0].trim() : null,
    user_agent: safeShortStr(ua, 256),
    query: req.query ? { ...req.query } : {},
  };
}

function createUpdateDebug() {
  const state = {
    started_at: nowIso(),
    current_settings: null,
    current_decision: null,
    latest_update_payload: null,
    latest_client_check: null,
    recent_checks: [],
    last_settings_save_at: null,
  };

  const sseClients = new Set();

  function recordCheck(req, payload) {
    const entry = {
      at: nowIso(),
      client: pickClientHints(req),
      decision: payload && payload.decision ? String(payload.decision) : null,
      source: payload && payload.source ? String(payload.source) : null,
      payload_keys: payload ? Object.keys(payload) : [],
    };
    state.latest_client_check = entry;
    state.latest_update_payload = payload || null;
    state.current_decision = entry.decision;
    state.recent_checks.unshift(entry);
    if (state.recent_checks.length > MAX_RECENT_CHECKS) {
      state.recent_checks.length = MAX_RECENT_CHECKS;
    }
    console.log(
      '[update-debug]',
      '[CHECK_EXECUTED]',
      JSON.stringify({
        decision: entry.decision,
        source: entry.source,
        ip: entry.client.ip,
        ua: safeShortStr(entry.client.user_agent, 80),
        version_code: entry.client.query && entry.client.query.version_code,
      }),
    );
  }

  function recordSettingsSave(next) {
    state.current_settings = next || null;
    state.last_settings_save_at = nowIso();
    console.log(
      '[update-debug]',
      '[ADMIN_SAVE]',
      JSON.stringify({ at: state.last_settings_save_at, current_settings: next || null }),
    );
    broadcast('app_settings_changed', { at: state.last_settings_save_at });
  }

  function broadcast(eventName, data) {
    const payload =
      typeof data === 'string' ? data : JSON.stringify(data == null ? {} : data);
    const frame = `event: ${eventName}\n` + `data: ${payload}\n\n`;
    let delivered = 0;
    for (const res of sseClients) {
      try {
        res.write(frame);
        delivered += 1;
      } catch (_) {
        try { sseClients.delete(res); } catch (_) {}
      }
    }
    console.log(
      '[update-debug]',
      '[SSE_BROADCAST]',
      JSON.stringify({ event: eventName, clients: sseClients.size, delivered }),
    );
  }

  function snapshot() {
    return {
      service: 'osmani-admin-api',
      role: 'update-debug',
      started_at: state.started_at,
      server_time: nowIso(),
      current_settings: state.current_settings,
      current_decision: state.current_decision,
      sse_status: {
        active_clients_count: sseClients.size,
        events: ['app_settings_changed', 'app_version_changed', 'sync', 'update'],
      },
      latest_update_payload: state.latest_update_payload,
      latest_client_check: state.latest_client_check,
      recent_checks: state.recent_checks.slice(0, 10),
      last_settings_save_at: state.last_settings_save_at,
      active_clients_count: sseClients.size,
    };
  }

  function debugHandler(req, res) {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.status(200).end(JSON.stringify(snapshot(), null, 2));
  }

  function streamHandler(req, res) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.flushHeaders && res.flushHeaders();

    res.write('retry: 15000\n\n');
    res.write(
      `event: hello\n` +
        `data: ${JSON.stringify({ at: nowIso(), service: 'update-debug' })}\n\n`,
    );

    sseClients.add(res);
    console.log(
      '[update-debug]',
      '[CLIENT_CONNECTED]',
      JSON.stringify({ active_clients: sseClients.size, ip: pickClientHints(req).ip }),
    );

    const heartbeat = setInterval(() => {
      try {
        res.write(`event: heartbeat\n` + `data: ${JSON.stringify({ at: nowIso() })}\n\n`);
      } catch (_) {}
    }, 25000);

    req.on('close', () => {
      clearInterval(heartbeat);
      try { sseClients.delete(res); } catch (_) {}
      console.log(
        '[update-debug]',
        '[CLIENT_DISCONNECTED]',
        JSON.stringify({ active_clients: sseClients.size }),
      );
    });
  }

  function attach(app) {
    if (!app || typeof app.get !== 'function') {
      throw new Error('updateDebug.attach: pass an Express app');
    }
    app.get('/api/update-debug', debugHandler);
    app.get('/api/sync/stream', streamHandler);
    return { debugHandler, streamHandler };
  }

  return {
    attach,
    debugHandler,
    streamHandler,
    recordCheck,
    recordSettingsSave,
    broadcast,
    snapshot,
  };
}

module.exports = createUpdateDebug;
