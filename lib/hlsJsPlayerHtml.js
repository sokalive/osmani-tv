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
 * @param {string} manifestUrl — HLS master manifest URL (direct or proxy)
 * @param {{ diagnostics?: boolean, directSegments?: boolean }} [options]
 */
export function buildHlsJsPlayerHtml(manifestUrl, options = {}) {
  const escaped = JSON.stringify(String(manifestUrl ?? ''));
  const diagnostics = options?.diagnostics === true ? 'true' : 'false';
  const directSegments = options?.directSegments === true ? 'true' : 'false';
  const fetchProbe = JSON.stringify(
    'https://osmanitv.b-cdn.net/stream-proxy?url=https%3A%2F%2Ftest-streams.mux.dev%2Fx36xhzz%2Fx36xhzz.m3u8',
  );
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no" />
    <style>
      html, body { margin:0; padding:0; width:100%; height:100%; background:#000; overflow:hidden; }
      #v { width:100%; height:100%; background:#000; object-fit:contain; }
      #v::-webkit-media-controls { display: none !important; }
      #v::-webkit-media-controls-enclosure { display: none !important; }
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
        var DIRECT_SEGMENTS = ${directSegments};
        var FETCH_PROBE_URL = ${fetchProbe};

        function isStreamProxyUrl(u) {
          return /\\/stream-proxy(?:\\?|$)/i.test(String(u || ''));
        }

        function unwrapProxyUrl(u) {
          var s = String(u || '').trim();
          if (!s || !isStreamProxyUrl(s)) return s;
          try {
            var parsed = new URL(s);
            var inner = parsed.searchParams.get('url');
            if (inner) return decodeURIComponent(inner);
          } catch (e) {}
          return s;
        }

        function wrapLoaderCallbacks(originalUrl, callbacks) {
          return {
            onSuccess: function (response, stats, context) {
              callbacks.onSuccess(response, stats, context);
            },
            onError: function (response, stats, context) {
              var code = response && response.code;
              if (code === 401 || code === 403) {
                post('hls_token_expired', {
                  url: context && context.url,
                  code: code,
                  original: originalUrl,
                });
              }
              callbacks.onError(response, stats, context);
            },
            onTimeout: function (stats, context, networkDetails) {
              callbacks.onTimeout(stats, context, networkDetails);
            },
            onProgress: function (stats, context, data, networkDetails) {
              callbacks.onProgress(stats, context, data, networkDetails);
            },
          };
        }

        function createDirectSegmentLoaderClass() {
          if (!DIRECT_SEGMENTS || !window.Hls || !Hls.DefaultConfig || !Hls.DefaultConfig.loader) {
            return null;
          }
          var BaseLoader = Hls.DefaultConfig.loader;
          function DirectSegmentLoader(config) {
            this.base = new BaseLoader(config);
          }
          DirectSegmentLoader.prototype.destroy = function () {
            try { this.base.destroy(); } catch (e) {}
          };
          DirectSegmentLoader.prototype.abort = function () {
            try { this.base.abort(); } catch (e) {}
          };
          DirectSegmentLoader.prototype.load = function (context, config, callbacks) {
            var original = context.url;
            try {
              context.url = unwrapProxyUrl(original);
            } catch (e) {}
            if (DIAGNOSTICS && original !== context.url) {
              post('segment_source', {
                from: original,
                to: context.url,
                fragType: context.frag && context.frag.type,
              });
            }
            this.base.load(context, config, wrapLoaderCallbacks(original, callbacks));
          };
          return DirectSegmentLoader;
        }
        var FREEZE_MS = 18000;
        var WATCH_INTERVAL_MS = 2000;
        var POST_NUDGE_WAIT_MS = 15000;
        var RECOVERY_COOLDOWN_MS = 45000;
        var video = document.getElementById('v');
        var hls = null;
        var lastTime = 0;
        var lastTimeAt = Date.now();
        var stallReported = false;
        var lastBufferedEnd = 0;
        var lastBufferedGrowthAt = Date.now();
        var freezeStartedAt = 0;
        var recoveryStage = 0; // 0:none, 1:nudge used, 2:startLoad used
        var recoveryStageAt = 0;
        var cooldownUntil = 0;
        var lastRecoveryReason = '';
        var pendingNetworkRetry = false;

        function post(kind, payload) {
          if (window.__OSMANI_HLS_POST__) window.__OSMANI_HLS_POST__(kind, payload || null);
        }

        function levelLabel(lv) {
          if (!lv) return '';
          if (lv.height) return String(lv.height) + 'p';
          if (lv.bitrate) return Math.round(lv.bitrate / 1000) + ' kbps';
          if (lv.name) return String(lv.name);
          return '';
        }

        function postLevels() {
          if (!hls) return;
          var raw = hls.levels || [];
          var levels = raw.map(function (lv, i) {
            return {
              index: i,
              width: lv && lv.width ? lv.width : null,
              height: lv && lv.height ? lv.height : null,
              bitrate: lv && lv.bitrate ? lv.bitrate : null,
              name: lv && lv.name ? lv.name : null,
              codecs: lv && (lv.codecSet || lv.videoCodec || lv.attrs && lv.attrs.CODECS) || null,
              label: levelLabel(lv),
            };
          });
          post('hls_levels', {
            levels: levels,
            currentLevel: typeof hls.currentLevel === 'number' ? hls.currentLevel : -1,
            autoLevelEnabled: !!hls.autoLevelEnabled,
          });
        }

        function postAudioTracks() {
          if (!hls) return;
          var raw = hls.audioTracks || [];
          var tracks = raw.map(function (t, i) {
            return {
              id: t && typeof t.id === 'number' ? t.id : i,
              index: i,
              name: t && t.name ? t.name : null,
              lang: t && (t.lang || t.language) ? (t.lang || t.language) : null,
              groupId: t && t.groupId ? t.groupId : null,
              isDefault: !!(t && t.default),
              autoselect: !!(t && t.autoselect),
            };
          });
          post('hls_audio_tracks', {
            tracks: tracks,
            currentAudioTrack: typeof hls.audioTrack === 'number' ? hls.audioTrack : -1,
          });
        }

        window.__OSMANI_HLS_CMD__ = function (cmd) {
          if (!cmd || !cmd.type) return;
          if (cmd.type === 'set-level' && hls) {
            var lvl = (typeof cmd.level === 'number') ? cmd.level : -1;
            try { hls.currentLevel = lvl; } catch (e) {}
            postLevels();
            return;
          }
          if (cmd.type === 'set-audio-track' && hls) {
            if (typeof cmd.id === 'number') {
              try { hls.audioTrack = cmd.id; } catch (e) {}
            }
            postAudioTracks();
            return;
          }
          if (cmd.type === 'request-tracks') {
            postLevels();
            postAudioTracks();
            return;
          }
        };

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

        function bufferedEnd() {
          if (!video || !video.buffered || video.buffered.length === 0) return 0;
          try {
            return video.buffered.end(video.buffered.length - 1);
          } catch (_) {
            return 0;
          }
        }

        function resetFreezeTracking() {
          freezeStartedAt = 0;
          stallReported = false;
        }

        function markRecoverySuccess(source) {
          recoveryStage = 0;
          recoveryStageAt = 0;
          cooldownUntil = Date.now() + RECOVERY_COOLDOWN_MS;
          resetFreezeTracking();
          post('recovery_success', {
            source: source || 'playback-advanced',
            reason: lastRecoveryReason || null,
          });
          post('reconnect_backoff', {
            reason: lastRecoveryReason || null,
            delay_ms: RECOVERY_COOLDOWN_MS,
            mode: 'cooldown',
          });
          lastRecoveryReason = '';
        }

        function runSingleRecovery(stepName, reason) {
          if (!video) return;
          var now = Date.now();
          if (now < cooldownUntil) {
            post('recovery_failed', {
              mode: 'cooldown',
              reason: reason,
              cooldown_ms_left: cooldownUntil - now,
            });
            return;
          }
          if (!hls) {
            post('recovery_failed', { mode: 'no-hls', reason: reason });
            return;
          }
          lastRecoveryReason = reason || 'freeze-watchdog';
          post('recovery_attempt', { step: stepName, reason: lastRecoveryReason });
          try {
            // Avoid overlapping playback session/audio while recovering.
            if (!video.paused) video.pause();
            if (stepName === 'seek-nudge') {
              if (isFinite(video.currentTime)) video.currentTime = Math.max(0, video.currentTime + 0.1);
              recoveryStage = 1;
              recoveryStageAt = now;
            } else if (stepName === 'startLoad') {
              if (typeof hls.startLoad === 'function') hls.startLoad();
              recoveryStage = 2;
              recoveryStageAt = now;
              cooldownUntil = now + RECOVERY_COOLDOWN_MS;
              post('reconnect_backoff', {
                reason: lastRecoveryReason,
                delay_ms: RECOVERY_COOLDOWN_MS,
                mode: 'cooldown',
              });
            }
            video.play().catch(function () {});
          } catch (e) {
            post('recovery_failed', {
              step: stepName,
              reason: lastRecoveryReason,
              error: e && e.message ? e.message : String(e),
            });
          }
        }

        function createHlsInstance() {
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
          var LoaderClass = createDirectSegmentLoaderClass();
          var hlsConfig = {
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
          };
          if (LoaderClass) {
            hlsConfig.loader = LoaderClass;
            hlsConfig.fLoader = LoaderClass;
            hlsConfig.pLoader = LoaderClass;
          }
          hls = new Hls(hlsConfig);
          hls.on(Hls.Events.MEDIA_ATTACHED, function () { post('hls_media_attached', null); });
          hls.on(Hls.Events.MANIFEST_PARSED, function () {
            post('hls_manifest_parsed', null);
            postLevels();
            postAudioTracks();
          });
          hls.on(Hls.Events.LEVEL_LOADED, function () { post('hls_level_loaded', null); });
          hls.on(Hls.Events.LEVEL_SWITCHED, function (_, data) {
            post('hls_level_switched', { level: data && typeof data.level === 'number' ? data.level : null });
            postLevels();
          });
          hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, function () { postAudioTracks(); });
          hls.on(Hls.Events.AUDIO_TRACK_SWITCHED, function (_, data) {
            post('hls_audio_track_switched', { id: data && typeof data.id === 'number' ? data.id : null });
            postAudioTracks();
          });
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
            // Defer fatal network recovery until online event to avoid churn.
            if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
              pendingNetworkRetry = true;
              post('recovery_failed', { mode: 'fatal-network', reason: 'await-online' });
            }
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
        createHlsInstance();

        video.addEventListener('playing', function () {
          resetFreezeTracking();
          post('video_playing', null);
          if (recoveryStage > 0) {
            markRecoverySuccess('video_playing');
          }
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
          if (Math.abs(video.currentTime - lastTime) > 0.001) {
            lastTime = video.currentTime;
            lastTimeAt = Date.now();
            resetFreezeTracking();
            if (recoveryStage > 0) {
              markRecoverySuccess('time_advanced');
            }
          }
        });

        setInterval(function () {
          if (!video) return;
          var now = Date.now();
          var current = isFinite(video.currentTime) ? video.currentTime : 0;
          var bEnd = bufferedEnd();
          var bufferGrowing = bEnd > lastBufferedEnd + 0.02;
          if (bufferGrowing) {
            lastBufferedGrowthAt = now;
            lastBufferedEnd = bEnd;
          }
          var timeFrozen = Math.abs(current - lastTime) <= 0.001;
          var visible = !document.hidden;
          var notPaused = !video.paused;
          var ready = video.readyState >= 2;
          var notLoading = video.networkState !== 2; // NETWORK_LOADING
          var bufferStable = now - lastBufferedGrowthAt >= FREEZE_MS;

          if (!visible || !notPaused || !ready || !timeFrozen || !notLoading || !bufferStable) {
            resetFreezeTracking();
            if (!timeFrozen) {
              lastTime = current;
              lastTimeAt = now;
            }
            return;
          }

          if (!freezeStartedAt) freezeStartedAt = now;
          var frozenFor = now - freezeStartedAt;
          if (!stallReported && frozenFor >= FREEZE_MS) {
            stallReported = true;
            post('stall_detected', {
              currentTime: current,
              readyState: video.readyState,
              networkState: video.networkState,
              bufferedEnd: bEnd,
              frozen_ms: frozenFor,
            });
          }
          if (frozenFor < FREEZE_MS) return;

          if (recoveryStage === 0) {
            runSingleRecovery('seek-nudge', 'strict-freeze');
            return;
          }
          if (recoveryStage === 1 && now - recoveryStageAt >= POST_NUDGE_WAIT_MS) {
            runSingleRecovery('startLoad', 'freeze-after-nudge');
          }
        }, WATCH_INTERVAL_MS);

        window.addEventListener('online', function () {
          if (!pendingNetworkRetry) return;
          pendingNetworkRetry = false;
          runSingleRecovery('startLoad', 'online-reconnect');
        });
        window.addEventListener('offline', function () {
          post('recovery_failed', { mode: 'offline-event', reason: 'network-offline' });
        });

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
