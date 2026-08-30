#!/usr/bin/env node
'use strict';

/**
 * Measure production API + SSE baseline latency for realtime catalog sync.
 * Run: node scripts/verify-realtime-e2e-latency.js
 */

const https = require('https');
const {
  CATALOG_IMMEDIATE_SSE_EVENTS,
  PAYMENT_PLANS_SSE_EVENTS,
} = require('../lib/subscriptionReconcile');
const { ADMIN_SOFT_REFRESH_SSE_EVENTS: SOFT } = require('../lib/adminSseRefreshEvents');

const BASE = (process.env.EXPO_PUBLIC_API_URL || 'https://api.osmanitv.com').replace(/\/+$/, '');

function fail(msg) {
  console.error('FAIL:', msg);
  process.exitCode = 1;
}

function pass(msg) {
  console.log('PASS:', msg);
}

function fetchJson(path, cacheBust = false) {
  const sep = path.includes('?') ? '&' : '?';
  const url = cacheBust ? `${BASE}${path}${sep}_=${Date.now()}` : `${BASE}${path}`;
  const t0 = Date.now();
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { Accept: 'application/json', 'Cache-Control': 'no-cache' } }, (res) => {
        let body = '';
        res.on('data', (c) => {
          body += c;
        });
        res.on('end', () => {
          const ms = Date.now() - t0;
          try {
            resolve({ ms, status: res.statusCode, data: JSON.parse(body) });
          } catch (e) {
            reject(new Error(`parse ${path}: ${e.message}`));
          }
        });
      })
      .on('error', reject);
  });
}

function probeSse(ms = 6000) {
  const t0 = Date.now();
  return new Promise((resolve) => {
    const req = https.get(
      `${BASE}/api/sync/stream`,
      { headers: { Accept: 'text/event-stream', 'Cache-Control': 'no-cache' } },
      (res) => {
        let buf = '';
        const finish = (result) => {
          try {
            req.destroy();
          } catch {}
          resolve({ ...result, connectMs: Date.now() - t0 });
        };
        res.on('data', (chunk) => {
          buf += chunk.toString();
          if (buf.includes('event:')) {
            const events = [...buf.matchAll(/^event: (.+)$/gm)].map((m) => m[1].trim());
            finish({ status: res.statusCode, events: [...new Set(events)], sampleBytes: buf.length });
          }
        });
        setTimeout(() => finish({ status: res.statusCode, events: [], sampleBytes: buf.length, timeout: true }), ms);
      },
    );
    req.on('error', (e) => resolve({ error: e.message, connectMs: Date.now() - t0 }));
  });
}

(async () => {
  console.log('\n=== REALTIME E2E LATENCY PROBE ===');
  console.log('API base:', BASE);

  const sse = await probeSse(5000);
  if (sse.error) fail(`SSE probe error: ${sse.error}`);
  else pass(`SSE connected HTTP ${sse.status} in ${sse.connectMs}ms`);
  if (sse.events?.length) {
    pass(`SSE init events (${sse.events.length}): ${sse.events.slice(0, 8).join(', ')}${sse.events.length > 8 ? '…' : ''}`);
  }

  const [channels, banners, plans] = await Promise.all([
    fetchJson('/api/channels', true),
    fetchJson('/api/banners', true),
    fetchJson('/api/plans', true).catch(() => ({ ms: -1, status: 0, data: [] })),
  ]);

  if (channels.status !== 200) fail(`channels HTTP ${channels.status}`);
  else pass(`GET /api/channels (cache-bust) ${channels.ms}ms — ${channels.data?.length ?? 0} rows`);

  if (banners.status !== 200) fail(`banners HTTP ${banners.status}`);
  else pass(`GET /api/banners (cache-bust) ${banners.ms}ms — ${banners.data?.length ?? 0} rows`);

  if (plans.status === 200) pass(`GET /api/plans (cache-bust) ${plans.ms}ms — ${plans.data?.length ?? 0} rows`);

  const immediateEvents = [...CATALOG_IMMEDIATE_SSE_EVENTS].filter((e) => SOFT.includes(e));
  const debouncedOnly = SOFT.filter((e) => !CATALOG_IMMEDIATE_SSE_EVENTS.has(e) && !PAYMENT_PLANS_SSE_EVENTS.has(e));

  console.log('\n=== HANDLER TIMING MODEL ===');
  console.log(`Immediate catalog events: ${immediateEvents.length} (0ms debounce + network)`);
  console.log(`Payment plans immediate: ${[...PAYMENT_PLANS_SSE_EVENTS].join(', ')}`);
  console.log(`Debounced fallback events: ${debouncedOnly.length} (320ms + network)`);

  const catalogFetchMs = Math.max(channels.ms, banners.ms);
  const immediateE2e = sse.connectMs + catalogFetchMs;
  const debouncedE2e = 320 + catalogFetchMs;
  console.log('\n=== ESTIMATED PROPAGATION (post-fix) ===');
  console.log(`SSE already connected + immediate handler: ~${catalogFetchMs}ms (network only)`);
  console.log(`Cold SSE connect + immediate refresh: ~${immediateE2e}ms`);
  console.log(`Debounced-only event path: ~${debouncedE2e}ms`);
  console.log('(Admin save → backend broadcast not measured without admin credentials)');

  const sampleChannel = channels.data?.[0];
  const sampleBanner = banners.data?.[0];
  if (sampleChannel?.thumbnail && sampleChannel?.updatedAt) {
    pass(`channel image revision token present (updatedAt=${sampleChannel.updatedAt})`);
  }
  if (sampleBanner?.image && (sampleBanner?.updatedAt || sampleBanner?.updated_at)) {
    pass(`banner image revision token present`);
  }

  if (!process.exitCode) console.log('\n[verify-realtime-e2e-latency] ok');
})().catch((e) => {
  fail(String(e?.message ?? e));
  process.exit(1);
});
