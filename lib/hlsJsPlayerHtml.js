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
 */
export function buildHlsJsPlayerHtml(proxiedUrl) {
  const escaped = JSON.stringify(String(proxiedUrl ?? ''));
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
    <script src="https://cdn.jsdelivr.net/npm/hls.js@1.5.15/dist/hls.min.js"></script>
    <script>
      (function () {
        var SRC = ${escaped};
        var STALL_MS = 9000;
        var video = document.getElementById('v');
        var hls = null;
        var lastTime = 0;
        var lastTimeAt = Date.now();
        var stallReported = false;

        function post(kind, payload) {
          try {
            window.ReactNativeWebView.postMessage(JSON.stringify({ kind: kind, payload: payload || null }));
          } catch (e) {}
        }

        function attachHls() {
          if (!window.Hls || !window.Hls.isSupported()) {
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
          hls.on(Hls.Events.MANIFEST_PARSED, function () { post('hls_manifest_parsed', null); });
          hls.on(Hls.Events.LEVEL_LOADED, function () { post('hls_level_loaded', null); });
          hls.on(Hls.Events.ERROR, function (event, data) {
            var errPayload = {
              type: data && data.type,
              details: data && data.details,
              fatal: !!(data && data.fatal),
              reason: data && data.reason,
              response_code: data && data.response && data.response.code,
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
          hls.loadSource(SRC);
          hls.attachMedia(video);
        }

        attachHls();

        video.addEventListener('playing', function () {
          stallReported = false;
          post('video_playing', null);
        });
        video.addEventListener('waiting', function () { post('video_waiting', null); });
        video.addEventListener('error', function () {
          post('video_error', { code: video.error ? video.error.code : null });
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
