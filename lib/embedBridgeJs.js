/**
 * Injected before page load to avoid a white flash while provider CSS/JS boot.
 */
export function buildEmbedPageBootstrapJs() {
  return `
(function () {
  if (window.__OSMANI_EMBED_BOOTSTRAP__) return;
  window.__OSMANI_EMBED_BOOTSTRAP__ = true;
  try {
    var css = 'html,body{background:#000!important;margin:0;padding:0;overflow:hidden;}';
    var style = document.createElement('style');
    style.textContent = css;
    (document.head || document.documentElement).appendChild(style);
  } catch (e) {}
})();
true;
`;
}

/**
 * Injected bridge for embed-webview pages (player.php, iframe HTML, third-party).
 *
 * Goal: best-effort detection of quality/audio controls on common embedded
 * players (JW Player, Video.js, HTML5 <video> with audioTracks). Posts the
 * detection result back to React Native and exposes a `__OSMANI_EMBED_CMD__`
 * command function the host can call via `injectJavaScript()`.
 *
 * This script NEVER mutates the player UI or DOM — it only reads metadata and
 * forwards explicit user commands. If nothing is detected, posts
 * `embed_no_controls` so the host can show "controls handled internally".
 *
 * Use as the value of `injectedJavaScript` on the embed WebView.
 */
export function buildEmbedBridgeJs() {
  return `
(function () {
  if (window.__OSMANI_EMBED_BRIDGE_INSTALLED__) return;
  window.__OSMANI_EMBED_BRIDGE_INSTALLED__ = true;

  function safe(fn) { try { return fn(); } catch (e) { return null; } }

  function post(kind, payload) {
    try {
      window.ReactNativeWebView.postMessage(JSON.stringify({ kind: kind, payload: payload || null }));
    } catch (e) {}
  }

  function levelLabelFromHeight(h) { return h ? (h + 'p') : null; }

  function detectJW() {
    if (!window.jwplayer) return null;
    return safe(function () {
      var jw = window.jwplayer();
      if (!jw || typeof jw.getQualityLevels !== 'function') return null;
      var qls = jw.getQualityLevels() || [];
      var ats = (typeof jw.getAudioTracks === 'function') ? (jw.getAudioTracks() || []) : [];
      var current = (typeof jw.getCurrentQuality === 'function') ? jw.getCurrentQuality() : -1;
      var currentAudio = (typeof jw.getCurrentAudioTrack === 'function') ? jw.getCurrentAudioTrack() : -1;
      return {
        type: 'jwplayer',
        qualities: qls.map(function (q, i) {
          return { id: i, label: q.label || levelLabelFromHeight(q.height) || ('Q' + i) };
        }),
        currentQuality: typeof current === 'number' ? current : -1,
        audioTracks: ats.map(function (a, i) {
          return { id: i, label: a.name || a.language || ('Audio ' + i) };
        }),
        currentAudioTrack: typeof currentAudio === 'number' ? currentAudio : -1,
      };
    });
  }

  function detectVideoJs() {
    if (!window.videojs) return null;
    return safe(function () {
      var player = null;
      var players = (window.videojs && window.videojs.players) || {};
      for (var k in players) { if (players[k]) { player = players[k]; break; } }
      if (!player) {
        var el = document.querySelector('.video-js, video[data-vjs-player], video.vjs-tech');
        if (el && el.player) player = el.player;
      }
      if (!player) return null;
      var qualities = [];
      var current = -1;
      try {
        var ql = player.qualityLevels && player.qualityLevels();
        if (ql) {
          for (var i = 0; i < ql.length; i++) {
            var q = ql[i];
            var lbl = levelLabelFromHeight(q && q.height) || (q && q.bitrate ? Math.round(q.bitrate / 1000) + 'k' : 'Q' + i);
            qualities.push({ id: i, label: lbl, enabled: !!(q && q.enabled) });
            if (q && q.enabled) current = i;
          }
        }
      } catch (e) {}
      var audioTracks = [];
      var currentAudio = -1;
      try {
        var atl = player.audioTracks && player.audioTracks();
        if (atl) {
          for (var j = 0; j < atl.length; j++) {
            var t = atl[j];
            audioTracks.push({ id: j, label: (t && (t.label || t.language)) || ('Audio ' + j), enabled: !!(t && t.enabled) });
            if (t && t.enabled) currentAudio = j;
          }
        }
      } catch (e) {}
      if (!qualities.length && !audioTracks.length) return null;
      return {
        type: 'videojs',
        qualities: qualities,
        currentQuality: current,
        audioTracks: audioTracks,
        currentAudioTrack: currentAudio,
      };
    });
  }

  function detectHtml5() {
    var v = document.querySelector('video');
    if (!v) return null;
    return safe(function () {
      var audioTracks = [];
      var currentAudio = -1;
      if (v.audioTracks && v.audioTracks.length) {
        for (var i = 0; i < v.audioTracks.length; i++) {
          var t = v.audioTracks[i];
          audioTracks.push({ id: i, label: (t && (t.label || t.language)) || ('Audio ' + i), enabled: !!(t && t.enabled) });
          if (t && t.enabled) currentAudio = i;
        }
      }
      if (!audioTracks.length) return null;
      return {
        type: 'html5',
        qualities: [],
        currentQuality: -1,
        audioTracks: audioTracks,
        currentAudioTrack: currentAudio,
      };
    });
  }

  function detect() {
    return detectJW() || detectVideoJs() || detectHtml5() || null;
  }

  var lastSerialized = '';
  function postIfChanged() {
    var det = detect();
    var ser = JSON.stringify(det || null);
    if (ser === lastSerialized) return;
    lastSerialized = ser;
    if (det) post('embed_controls_detected', det);
    else post('embed_no_controls', null);
  }

  function applyCommand(cmd) {
    if (!cmd || !cmd.type) return;
    var det = detect();
    if (!det) return;
    if (cmd.type === 'set-level') {
      var level = (typeof cmd.level === 'number') ? cmd.level : -1;
      if (det.type === 'jwplayer' && window.jwplayer) {
        safe(function () {
          var jw = window.jwplayer();
          if (jw && typeof jw.setCurrentQuality === 'function') jw.setCurrentQuality(level === -1 ? 0 : level);
        });
      } else if (det.type === 'videojs' && window.videojs) {
        safe(function () {
          var players = window.videojs.players || {};
          for (var k in players) {
            var p = players[k];
            var ql = p && p.qualityLevels && p.qualityLevels();
            if (!ql) continue;
            for (var i = 0; i < ql.length; i++) ql[i].enabled = (level === -1) || (i === level);
          }
        });
      }
    } else if (cmd.type === 'set-audio-track') {
      var id = (typeof cmd.id === 'number') ? cmd.id : -1;
      if (det.type === 'jwplayer' && window.jwplayer) {
        safe(function () {
          var jw = window.jwplayer();
          if (jw && typeof jw.setCurrentAudioTrack === 'function') jw.setCurrentAudioTrack(id);
        });
      } else if (det.type === 'videojs' && window.videojs) {
        safe(function () {
          var players = window.videojs.players || {};
          for (var k in players) {
            var p = players[k];
            var atl = p && p.audioTracks && p.audioTracks();
            if (!atl) continue;
            for (var i = 0; i < atl.length; i++) atl[i].enabled = (i === id);
          }
        });
      } else if (det.type === 'html5') {
        safe(function () {
          var v = document.querySelector('video');
          if (v && v.audioTracks) {
            for (var i = 0; i < v.audioTracks.length; i++) v.audioTracks[i].enabled = (i === id);
          }
        });
      }
    } else if (cmd.type === 'request-tracks') {
      // force re-emit on next tick
      lastSerialized = '';
    }
    setTimeout(postIfChanged, 200);
  }

  window.__OSMANI_EMBED_CMD__ = applyCommand;

  /**
   * Embedded players load asynchronously. Poll detection for ~30s, then stop.
   * Each detection only posts when the result changes.
   */
  var attempts = 0;
  var detectTimer = setInterval(function () {
    attempts++;
    postIfChanged();
    if (attempts >= 30) clearInterval(detectTimer);
  }, 1000);

  postIfChanged();

  /**
   * Best-effort autoplay + notify RN when the provider video actually starts.
   * Keeps the native loading overlay until playback begins (avoids white flash).
   */
  var playbackStarted = false;
  function notifyPlaybackStarted() {
    if (playbackStarted) return;
    playbackStarted = true;
    post('embed_playback_started', null);
  }

  function tryPlayVideo(v) {
    if (!v || typeof v.play !== 'function') return;
    safe(function () {
      var wasMuted = !!v.muted;
      v.muted = true;
      var p = v.play();
      if (p && typeof p.then === 'function') {
        p.then(function () {
          if (!wasMuted) v.muted = false;
          notifyPlaybackStarted();
        }).catch(function () {
          v.muted = wasMuted;
        });
      }
    });
  }

  function watchPlayback() {
    var v = document.querySelector('video');
    if (!v) return false;
    ['playing', 'loadeddata', 'canplay'].forEach(function (ev) {
      v.addEventListener(ev, notifyPlaybackStarted);
    });
    tryPlayVideo(v);
    return true;
  }

  var bootstrapAttempts = 0;
  var bootstrapTimer = setInterval(function () {
    bootstrapAttempts++;
    if (watchPlayback() || bootstrapAttempts >= 40) clearInterval(bootstrapTimer);
  }, 500);

  setTimeout(function () {
    if (!playbackStarted) post('embed_playback_waiting', null);
  }, 12000);
})();
true;
`;
}

/**
 * Hide duplicate native player chrome when the app overlay owns quality/audio.
 * Safe to inject after `embed_controls_detected`.
 */
export function buildEmbedSuppressNativeUiJs() {
  return `
(function () {
  var id = 'osmani-embed-hide-native-ui';
  if (document.getElementById(id)) return;
  var style = document.createElement('style');
  style.id = id;
  style.textContent = [
    'video::-webkit-media-controls { display: none !important; }',
    'video::-webkit-media-controls-enclosure { display: none !important; }',
    '.jw-controlbar, .jw-settings-menu, .jw-rightclick, .jw-icon-settings, .jw-icon-hd, .jw-icon-cc {',
    '  opacity: 0 !important; pointer-events: none !important; visibility: hidden !important;',
    '}',
    '.vjs-control-bar, .vjs-menu-button-popup, .vjs-quality-selector, .vjs-audio-button,',
    '.vjs-subs-caps-button, .vjs-text-track-settings {',
    '  opacity: 0 !important; pointer-events: none !important; visibility: hidden !important;',
    '}',
    '.plyr__controls, .plyr__menu, .quality-selector, .quality-menu, .audio-track-selector {',
    '  opacity: 0 !important; pointer-events: none !important; visibility: hidden !important;',
    '}',
  ].join('\\n');
  (document.head || document.documentElement).appendChild(style);
})();
true;
`;
}
