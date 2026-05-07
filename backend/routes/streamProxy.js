/**
 * Tokenized-IPTV stream proxy.
 *
 * Design goals (per app team requirements):
 *   - True streaming passthrough using Node streams (no axios / fetch buffering).
 *   - .m3u8 manifests are fetched as text, URLs rewritten to flow back through
 *     the proxy, and returned as UTF-8 plain text with the HLS Content-Type.
 *   - Segments / keys / fragments are piped from the upstream response straight
 *     to the client (`upstream.pipe(res)`).
 *   - Permissive CORS on every response: `*` for Origin / Headers / Expose-Headers.
 *   - We never set Content-Length on streamed bodies; Node will use chunked
 *     transfer encoding so there is no length / encoding mismatch.
 *   - We override Content-Encoding because we ask upstream for `identity`.
 *   - Diagnostic endpoint at GET /stream-proxy-test?url= returns the first
 *     300 chars and logs upstream status / content-type.
 */

const express = require('express');
const https = require('node:https');
const http = require('node:http');
const { URL } = require('node:url');

const MAX_REDIRECTS = 5;
const UPSTREAM_TIMEOUT_MS = 30_000;
const DEFAULT_UA =
  'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36';

function isManifestPath(u) {
  const p = String(u).split(/[?#]/)[0].toLowerCase();
  return p.endsWith('.m3u8') || p.endsWith('.m3u');
}

function isManifestContentType(ct) {
  const c = String(ct || '').toLowerCase();
  return c.includes('mpegurl') || c.includes('x-mpegurl');
}

function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Expose-Headers', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
}

function pickUpstreamHeaders(req) {
  const q = req.query || {};
  const h = {
    Accept: '*/*',
    // Force unencoded upstream so we never have to deal with content-encoding
    // mismatches when piping straight to the client.
    'Accept-Encoding': 'identity',
    'User-Agent': String(q.ua ?? DEFAULT_UA),
  };
  if (q.referer) h.Referer = String(q.referer);
  if (q.origin) h.Origin = String(q.origin);
  // Forward Range so HLS segment range fetches still work.
  if (req.headers.range) h.Range = req.headers.range;
  return h;
}

function fetchUpstream(targetUrl, headers, redirectsLeft = MAX_REDIRECTS) {
  return new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new URL(targetUrl);
    } catch (err) {
      return reject(err);
    }
    if (!/^https?:$/.test(parsed.protocol)) {
      return reject(new Error(`Unsupported protocol: ${parsed.protocol}`));
    }
    const lib = parsed.protocol === 'http:' ? http : https;
    const req = lib.request(
      {
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === 'http:' ? 80 : 443),
        path: (parsed.pathname || '/') + (parsed.search || ''),
        method: 'GET',
        headers,
      },
      (upstream) => {
        const status = upstream.statusCode || 0;
        if (
          status >= 300 &&
          status < 400 &&
          upstream.headers.location &&
          redirectsLeft > 0
        ) {
          upstream.resume();
          let next;
          try {
            next = new URL(upstream.headers.location, parsed).toString();
          } catch (e) {
            return reject(e);
          }
          return resolve(fetchUpstream(next, headers, redirectsLeft - 1));
        }
        resolve({ upstream, finalUrl: parsed.toString() });
      },
    );
    req.on('error', reject);
    req.setTimeout(UPSTREAM_TIMEOUT_MS, () => {
      req.destroy(new Error('upstream timeout'));
    });
    req.end();
  });
}

function readAll(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on('data', (c) => chunks.push(c));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}

function rewriteManifest(manifestText, finalUrl, proxyPath, query) {
  const buildParams = (target) => {
    const p = new URLSearchParams();
    p.set('url', new URL(target, finalUrl).toString());
    if (query.referer) p.set('referer', String(query.referer));
    if (query.origin) p.set('origin', String(query.origin));
    if (query.ua) p.set('ua', String(query.ua));
    return p.toString();
  };
  return manifestText
    .split(/\r?\n/)
    .map((line) => {
      const trimmed = line.trim();
      if (trimmed === '') return line;
      if (trimmed.startsWith('#')) {
        // Rewrite URI="..." attributes inside tags like
        // #EXT-X-KEY, #EXT-X-MAP, #EXT-X-MEDIA, #EXT-X-I-FRAME-STREAM-INF
        return line.replace(
          /URI="([^"]+)"/g,
          (_, u) => `URI="${proxyPath}?${buildParams(u)}"`,
        );
      }
      return `${proxyPath}?${buildParams(trimmed)}`;
    })
    .join('\n');
}

function validateTargetParam(req, res) {
  const target = String(req.query.url ?? '').trim();
  if (!target) {
    setCorsHeaders(res);
    res.status(400).type('text/plain').send('Missing url query param');
    return null;
  }
  let parsed;
  try {
    parsed = new URL(target);
  } catch {
    setCorsHeaders(res);
    res.status(400).type('text/plain').send('Invalid url');
    return null;
  }
  if (!/^https?:$/.test(parsed.protocol)) {
    setCorsHeaders(res);
    res.status(400).type('text/plain').send('Only http(s) URLs are supported');
    return null;
  }
  return target;
}

async function handleStreamProxy(req, res) {
  setCorsHeaders(res);
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }
  const target = validateTargetParam(req, res);
  if (!target) return;

  const upstreamHeaders = pickUpstreamHeaders(req);
  let upstream;
  let finalUrl = target;
  try {
    const result = await fetchUpstream(target, upstreamHeaders);
    upstream = result.upstream;
    finalUrl = result.finalUrl;
  } catch (err) {
    console.error('[stream-proxy] upstream error:', err && err.message, 'for', target);
    setCorsHeaders(res);
    return res.status(502).type('text/plain').send(`Upstream error: ${err && err.message}`);
  }

  const upstreamStatus = upstream.statusCode || 502;
  const upstreamCt = String(upstream.headers['content-type'] || '');
  const looksLikeManifest = isManifestPath(finalUrl) || isManifestContentType(upstreamCt);

  console.log('[stream-proxy] upstream:', {
    target,
    finalUrl,
    status: upstreamStatus,
    contentType: upstreamCt,
    manifest: looksLikeManifest,
  });

  if (looksLikeManifest) {
    let bodyBuf;
    try {
      bodyBuf = await readAll(upstream);
    } catch (e) {
      setCorsHeaders(res);
      return res
        .status(502)
        .type('text/plain')
        .send(`Manifest read error: ${e && e.message}`);
    }
    const text = bodyBuf.toString('utf8');
    const rewritten = rewriteManifest(text, finalUrl, '/stream-proxy', req.query);
    setCorsHeaders(res);
    res.removeHeader('Content-Length');
    res.removeHeader('Transfer-Encoding');
    res.removeHeader('Content-Encoding');
    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    return res
      .status(upstreamStatus >= 200 && upstreamStatus < 300 ? 200 : upstreamStatus)
      .send(rewritten);
  }

  // ----- Streaming passthrough (segments, keys, init fragments, etc.) -----
  setCorsHeaders(res);
  const passHeaders = [
    'content-type',
    'accept-ranges',
    'content-range',
    'last-modified',
    'etag',
    'cache-control',
  ];
  for (const h of passHeaders) {
    const v = upstream.headers[h];
    if (v) res.setHeader(h, v);
  }
  // We forced Accept-Encoding: identity upstream, but make sure no encoding
  // header bleeds through and forces the client to decompress non-compressed
  // bytes (which would corrupt segments).
  res.removeHeader('Content-Encoding');
  // Drop Content-Length / Transfer-Encoding headers that Express may have
  // copied; let Node use chunked encoding so there's no length mismatch.
  res.removeHeader('Content-Length');
  res.removeHeader('Transfer-Encoding');

  res.status(upstreamStatus);

  upstream.on('error', (e) => {
    console.error('[stream-proxy] upstream stream error:', e && e.message);
    if (!res.headersSent) {
      try {
        res.status(502).end();
        return;
      } catch {}
    }
    try {
      res.destroy(e);
    } catch {}
  });

  upstream.pipe(res);
}

async function handleStreamProxyTest(req, res) {
  setCorsHeaders(res);
  const target = validateTargetParam(req, res);
  if (!target) return;
  const upstreamHeaders = pickUpstreamHeaders(req);
  try {
    const { upstream, finalUrl } = await fetchUpstream(target, upstreamHeaders);
    const status = upstream.statusCode;
    const ct = upstream.headers['content-type'];
    console.log('[stream-proxy-test]', { target, finalUrl, status, contentType: ct });
    const buf = await readAll(upstream);
    const sample = buf.subarray(0, 300).toString('utf8');
    setCorsHeaders(res);
    res.type('text/plain').send(
      [
        `target: ${target}`,
        `finalUrl: ${finalUrl}`,
        `status: ${status}`,
        `content-type: ${ct ?? ''}`,
        `bytes: ${buf.length}`,
        '--- first 300 chars ---',
        sample,
      ].join('\n'),
    );
  } catch (err) {
    console.error('[stream-proxy-test] error:', err && err.message);
    setCorsHeaders(res);
    res.status(502).type('text/plain').send(`error: ${err && err.message}`);
  }
}

module.exports = {
  handleStreamProxy,
  handleStreamProxyTest,
};
