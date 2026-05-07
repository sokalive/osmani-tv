/**
 * Inline HTML shell that plays an HLS manifest with hls.js inside a WebView.
 *
 * Behavior:
 * - Autoplay, muted=false (audio respects channel), inline playback on iOS.
 * - Object-fit: contain (matches native resizeMode='contain').
 * - hls.js tuned for tokenized IPTV streams (longer retries, bigger backoff).
 * - Network/Media fatal errors trigger the documented hls.js recovery path
 *   (`startLoad()` for network, `recoverMediaError()` for media). No top-level
 *   replay loops; the WebView is the single owner of recovery.
 * - Stall watchdog: if the <video> stops advancing while not paused/ended for
 *   STALL_MS, posts a `stall_detected` diagnostic event (no auto-restart).
 * - Diagnostic events are postMessage'd as JSON so React Native can log them.
 *
 * @param {string} proxiedUrl — HLS manifest URL (already routed via /stream-proxy)
 * @param {{ diagnostics?: boolean }} [options]
 */
export function buildHlsJsPlayerHtml(proxiedUrl, options = {}) {
  const escaped = JSON.stringify(String(proxiedUrl ?? ''));
  const diagnostics = options?.diagnostics === true ? 'true' : 'false';
  const fetchProbe = JSON.stringify(
    'https://osmani-admin-api.onrender.com/stream-proxy?url=https%3A%2F%2Ftest-streams.mux.dev%2Fx36xhzz%2Fx36xhzz.m3u8',
  );
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no" />
    <style>
      html, body { margin:0; padding:0; width:100%; height:100%; background:#000; overflow:hidden; }
      #v { width:100%; height:100%; background:#000; object-fit:contain; }
    </style>
  </head>
  <body>
    <video id="v" autoplay playsinline webkit-playsinline></video>
    <script>
      (function () {
        function serialize(value, depth, seen) {
          if (value == null) return value;
          if (depth > 4) return '[max-depth]';
          var t = typeof value;
          if (t === 'string' || t === 'number' || t === 'boolean') return value;
          if (t === 'function') return '[function]';
          seen = seen || [];
          if (seen.indexOf(value) !== -1) return '[circular]';
          seen.push(value);
          if (value instanceof Error) {
            return {
              name: value.name,
              message: value.message,
              stack: value.stack,
            };
          }
          if (typeof XMLHttpRequest !== 'undefined' && value instanceof XMLHttpRequest) {
            return {
              status: value.status,
              statusText: value.statusText,
              responseURL: value.responseURL,
              readyState: value.readyState,
            };
          }
          if (Array.isArray(value)) {
            return value.slice(0, 30).map(function (v) { return serialize(v, depth + 1, seen); });
          }
          var out = {};
          Object.keys(value).slice(0, 80).forEach(function (k) {
            try { out[k] = serialize(value[k], depth + 1, seen); } catch (e) { out[k] = '[unserializable]'; }
          });
          return out;
        }

        function post(kind, payload) {
          try {
            window.ReactNativeWebView.postMessage(JSON.stringify({ kind: kind, payload: serialize(payload || null, 0, []) }));
          } catch (e) {}
        }

        window.__OSMANI_HLS_POST__ = post;
        window.__OSMANI_HLS_SCRIPT_LOADED__ = false;
        window.onerror = function (message, source, lineno, colno, error) {
          post('window_error', {
            message: message,
            source: source,
            lineno: lineno,
            colno: colno,
            error: error,
          });
        };
        window.addEventListener('unhandledrejection', function (event) {
          post('window_unhandled_rejection', {
            reason: event && event.reason,
          });
        });
      })();
    </script>
    <script
      src="https://cdn.jsdelivr.net/npm/hls.js@1.5.15/dist/hls.min.js"
      onload="window.__OSMANI_HLS_SCRIPT_LOADED__=true;window.__OSMANI_HLS_POST__&&window.__OSMANI_HLS_POST__('hls_script_load',{src:this.src,hasHls:!!window.Hls,version:window.Hls&&window.Hls.version});"
      onerror="window.__OSMANI_HLS_POST__&&window.__OSMANI_HLS_POST__('hls_script_error',{src:this.src});"
    ></script>
    <script>
      (function () {
        var SRC = ${escaped};
        var DIAGNOSTICS = ${diagnostics};
        var FETCH_PROBE_URL = ${fetchProbe};
        var STALL_MS = 9000;
        var video = document.getElementById('v');
        var hls = null;
        var lastTime = 0;
        var lastTimeAt = Date.now();
        var stallReported = false;

        function post(kind, payload) {
          if (window.__OSMANI_HLS_POST__) window.__OSMANI_HLS_POST__(kind, payload || null);
        }

        function probeFetch(label, url) {
          post('html_fetch_start', { label: label, url: url });
          fetch(url, { cache: 'no-store' })
            .then(function (res) {
              return res.text().then(function (text) {
                post('html_fetch_result', {
                  label: label,
                  url: url,
                  ok: res.ok,
                  status: res.status,
                  statusText: res.statusText,
                  contentType: res.headers.get('content-type'),
                  sample: text.slice(0, 120),
                });
              });
            })
            .catch(function (error) {
              post('html_fetch_error', { label: label, url: url, error: error });
            });
        }

        function attachHls() {
          post('hls_src', { src: SRC });
          post('hls_supported', {
            scriptLoaded: !!window.__OSMANI_HLS_SCRIPT_LOADED__,
            hasHls: !!window.Hls,
            isSupported: !!(window.Hls && window.Hls.isSupported && window.Hls.isSupported()),
            version: window.Hls && window.Hls.version,
          });
          if (!window.Hls || !window.Hls.isSupported()) {
            post('hls_fallback_native', { src: SRC });
            video.src = SRC;
            return;
          }
          hls = new Hls({
            // IPTV-tolerant retry configuration.
            enableWorker: true,
            lowLatencyMode: false,
            liveDurationInfinity: true,
            backBufferLength: 30,
            // Manifest
            manifestLoadingMaxRetry: 6,
            manifestLoadingRetryDelay: 1000,
            manifestLoadingMaxRetryTimeout: 64000,
            // Level / playlist
            levelLoadingMaxRetry: 6,
            levelLoadingRetryDelay: 1000,
            levelLoadingMaxRetryTimeout: 32000,
            // Fragments / segments (most tokenized IPTV failures live here)
            fragLoadingMaxRetry: 8,
            fragLoadingRetryDelay: 500,
            fragLoadingMaxRetryTimeout: 32000,
          });
          hls.on(Hls.Events.MEDIA_ATTACHED, function () { post('hls_media_attached', null); });
          hls.on(Hls.Events.MANIFEST_PARSED, function () { post('hls_manifest_parsed', null); });
          hls.on(Hls.Events.LEVEL_LOADED, function () { post('hls_level_loaded', null); });
          hls.on(Hls.Events.ERROR, function (event, data) {
            var errPayload = {
              event: event,
              type: data && data.type,
              details: data && data.details,
              fatal: !!(data && data.fatal),
              reason: data && data.reason,
              response_code: data && data.response && data.response.code,
              response_text: data && data.response && data.response.text,
              response_url: data && data.response && data.response.url,
              context: data && data.context,
              error: data && data.error,
              networkDetails: data && data.networkDetails,
              raw: data,
            };
            post('hls_error', errPayload);
            if (!data || !data.fatal) return;
            if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
              try { hls.startLoad(); post('hls_recover', { mode: 'startLoad' }); } catch (e) {}
              return;
            }
            if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
              try { hls.recoverMediaError(); post('hls_recover', { mode: 'recoverMediaError' }); } catch (e) {}
              return;
            }
            try { hls.destroy(); } catch (e) {}
            post('hls_fatal_giveup', errPayload);
          });
          hls.attachMedia(video);
          post('hls_load_source', { src: SRC });
          hls.loadSource(SRC);
        }

        post('html_boot', {
          location: String(window.location && window.location.href),
          userAgent: navigator.userAgent,
        });
        if (DIAGNOSTICS) {
          probeFetch('actual-src', SRC);
          probeFetch('public-mux-proxy', FETCH_PROBE_URL);
        }
        attachHls();

        video.addEventListener('playing', function () {
          stallReported = false;
          post('video_playing', null);
        });
        video.addEventListener('waiting', function () { post('video_waiting', null); });
        video.addEventListener('error', function () {
          post('video_error', {
            code: video.error ? video.error.code : null,
            message: video.error ? video.error.message : null,
            networkState: video.networkState,
            readyState: video.readyState,
            currentSrc: video.currentSrc,
            src: video.src,
          });
        });
        video.addEventListener('timeupdate', function () {
          if (Math.abs(video.currentTime - lastTime) > 0.1) {
            lastTime = video.currentTime;
            lastTimeAt = Date.now();
            stallReported = false;
          }
        });

        setInterval(function () {
          if (!video) return;
          if (video.paused || video.ended) return;
          if (stallReported) return;
          if (Date.now() - lastTimeAt > STALL_MS) {
            stallReported = true;
            post('stall_detected', { lastTime: lastTime, currentTime: video.currentTime });
          }
        }, 1500);

        window.addEventListener('message', function (e) {
          var raw = e && e.data ? e.data : '';
          var cmd = null;
          try { cmd = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch (_) {}
          if (!cmd || !cmd.type) return;
          if (cmd.type === 'play') video.play().catch(function(){});
          if (cmd.type === 'pause') video.pause();
          if (cmd.type === 'set-fit' && cmd.mode) {
            video.style.objectFit = cmd.mode === 'cover' ? 'cover' : 'contain';
          }
        });
      })();
    </script>
  </body>
</html>`;
}
