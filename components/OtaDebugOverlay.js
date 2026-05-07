import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  forceRecheck,
  getDebugSnapshot,
  isNativeAvailable,
  subscribeDebug,
  UPDATE_DEBUG_ENDPOINT_URL,
} from '../lib/updateClient';

/**
 * Hidden, dev-only OTA debug overlay.
 *
 * Activation: 7 taps within 2 seconds on the wrapped child element
 * (the "Osmani TV" home title — the wrapper is invisible, the existing
 * UI is unchanged).
 *
 * Renders a full-screen Modal showing the entire OTA state machine plus
 * the latest payload from /api/update-debug (when the backend exposes it).
 *
 * The overlay is intentionally fixed text — no theme/look changes to
 * the rest of the app.
 */

const COLORS = {
  scrim: 'rgba(0,0,0,0.92)',
  card: '#0F1115',
  border: 'rgba(255,255,255,0.10)',
  text: '#F2F2F2',
  muted: '#9AA3B2',
  ok: '#34D399',
  warn: '#FBBF24',
  bad: '#F87171',
  accent: '#60A5FA',
};

const TAP_WINDOW_MS = 2000;
const TAP_THRESHOLD = 7;

let visibilityListeners = new Set();
let _visible = false;

function setOverlayVisible(next) {
  _visible = !!next;
  for (const cb of visibilityListeners) {
    try { cb(_visible); } catch {}
  }
}

function subscribeVisibility(cb) {
  visibilityListeners.add(cb);
  try { cb(_visible); } catch {}
  return () => visibilityListeners.delete(cb);
}

export function showOtaDebugOverlay() {
  setOverlayVisible(true);
}

export function hideOtaDebugOverlay() {
  setOverlayVisible(false);
}

/**
 * Invisible Pressable wrapper. Wrap the home-screen title with this so
 * a 7-tap gesture activates the debug overlay. Children render exactly
 * as if the wrapper were not there.
 */
export function OtaDebugTitleTap({ children, threshold = TAP_THRESHOLD }) {
  const tapsRef = useRef([]);

  const onPress = useCallback(() => {
    const now = Date.now();
    const cutoff = now - TAP_WINDOW_MS;
    tapsRef.current = tapsRef.current.filter((t) => t >= cutoff);
    tapsRef.current.push(now);
    if (tapsRef.current.length >= threshold) {
      tapsRef.current = [];
      try {
        console.log('[update]', '[DEBUG_OVERLAY]', 'activated by 7-tap gesture');
      } catch {}
      setOverlayVisible(true);
    }
  }, [threshold]);

  return (
    <Pressable
      onPress={onPress}
      hitSlop={4}
      android_disableSound
      style={styles.tapWrap}
    >
      {children}
    </Pressable>
  );
}

function fmtTs(ts) {
  if (!ts) return '—';
  try {
    const d = new Date(ts);
    return d.toLocaleTimeString();
  } catch {
    return String(ts);
  }
}

function fmtBool(b) {
  return b ? 'true' : 'false';
}

function copyJson(value) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export default function OtaDebugOverlay() {
  const [visible, setVisible] = useState(false);
  const [snapshot, setSnapshot] = useState(() => getDebugSnapshot());
  const [endpointStatus, setEndpointStatus] = useState({
    state: 'idle',
    httpStatus: null,
    body: null,
    error: null,
    fetchedAt: 0,
  });

  useEffect(() => {
    const unsubVis = subscribeVisibility(setVisible);
    const unsubDbg = subscribeDebug(setSnapshot);
    return () => {
      try { unsubVis(); } catch {}
      try { unsubDbg(); } catch {}
    };
  }, []);

  const fetchEndpoint = useCallback(async () => {
    setEndpointStatus((prev) => ({ ...prev, state: 'fetching', error: null }));
    try {
      const res = await fetch(UPDATE_DEBUG_ENDPOINT_URL, {
        method: 'GET',
        headers: { Accept: 'application/json' },
      });
      const text = await res.text();
      let body;
      try { body = JSON.parse(text); } catch { body = text; }
      setEndpointStatus({
        state: 'done',
        httpStatus: res.status,
        body,
        error: res.ok ? null : `HTTP ${res.status}`,
        fetchedAt: Date.now(),
      });
      try {
        console.log('[update]', '[DEBUG_FETCH]', UPDATE_DEBUG_ENDPOINT_URL, '→', res.status);
      } catch {}
    } catch (e) {
      setEndpointStatus({
        state: 'done',
        httpStatus: null,
        body: null,
        error: e?.message ?? 'fetch failed',
        fetchedAt: Date.now(),
      });
      try {
        console.warn('[update]', '[DEBUG_FETCH]', 'failed', e?.message ?? e);
      } catch {}
    }
  }, []);

  useEffect(() => {
    if (!visible) return undefined;
    void fetchEndpoint();
    const id = setInterval(fetchEndpoint, 4000);
    return () => clearInterval(id);
  }, [visible, fetchEndpoint]);

  if (!visible) return null;

  const decision = snapshot.decision;
  const decisionColor =
    decision === 'FORCE' ? COLORS.bad : decision === 'SOFT' ? COLORS.warn : decision === 'PLAY_STORE' ? COLORS.accent : COLORS.muted;

  return (
    <Modal
      visible
      transparent
      statusBarTranslucent
      animationType="fade"
      onRequestClose={hideOtaDebugOverlay}
    >
      <View style={styles.scrim}>
        <View style={styles.card}>
          <View style={styles.header}>
            <View style={styles.headerLeft}>
              <Ionicons name="bug" size={18} color={COLORS.accent} />
              <Text style={styles.headerTitle}>OTA Debug</Text>
            </View>
            <Pressable onPress={hideOtaDebugOverlay} hitSlop={12} style={styles.closeBtn}>
              <Ionicons name="close" size={22} color={COLORS.text} />
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={styles.body}>
            <Section title="Status">
              <Row label="Platform" value={snapshot.platform} />
              <Row label="Native module detected" value={fmtBool(snapshot.nativeAvailable)} valueColor={snapshot.nativeAvailable ? COLORS.ok : COLORS.bad} />
              <Row label="Update client started" value={fmtBool(snapshot.started)} valueColor={snapshot.started ? COLORS.ok : COLORS.muted} />
              <Row label="Overlay visible" value={fmtBool(snapshot.overlayVisible)} valueColor={snapshot.overlayVisible ? COLORS.warn : COLORS.muted} />
            </Section>

            <Section title="Decision">
              <Row label="decision" value={decision} valueColor={decisionColor} />
              <Row label="source" value={snapshot.info?.source || '—'} />
              <Row label="apk_url" value={snapshot.info?.apkUrl || '—'} mono />
              <Row label="playstore_url" value={snapshot.info?.playStoreUrl || '—'} mono />
              <Row label="apk_sha256" value={snapshot.info?.apkSha256 || '—'} mono />
              <Row label="auto_download" value={fmtBool(snapshot.info?.autoDownload)} />
              <Row label="latest_version_name" value={snapshot.info?.latestVersionName || '—'} />
              <Row label="latest_version_code" value={String(snapshot.info?.latestVersionCode ?? '—')} />
              <Row label="installed_version_name" value={snapshot.info?.installedVersionName || '—'} />
              <Row label="installed_version_code" value={String(snapshot.info?.installedVersionCode ?? '—')} />
              <Row label="notice" value={snapshot.info?.notice || '—'} />
            </Section>

            <Section title="Last update-check">
              <Row label="lastCheckAt" value={fmtTs(snapshot.lastCheckAt)} />
              <Row label="lastUpdateInfoAt" value={fmtTs(snapshot.lastUpdateInfoAt)} />
              <Row label="base" value={snapshot.base} mono />
              <Row label="error" value={snapshot.lastCheckError || '—'} valueColor={snapshot.lastCheckError ? COLORS.bad : COLORS.muted} />
              <Pressable onPress={() => { void forceRecheck(); }} style={styles.btn}>
                <Text style={styles.btnText}>Re-check now</Text>
              </Pressable>
            </Section>

            <Section title="SSE">
              <Row label="connected" value={fmtBool(snapshot.sse.connected)} valueColor={snapshot.sse.connected ? COLORS.ok : COLORS.bad} />
              <Row label="url" value={snapshot.sse.url || '—'} mono />
              <Row label="attemptIndex" value={String(snapshot.sse.attemptIndex)} />
              <Row label="lastOpenAt" value={fmtTs(snapshot.sse.lastOpenAt)} />
              <Row label="lastEventAt" value={fmtTs(snapshot.sse.lastEventAt)} />
              <Row label="lastError" value={snapshot.sse.lastError || '—'} valueColor={snapshot.sse.lastError ? COLORS.bad : COLORS.muted} />
            </Section>

            <Section title="Overlay state">
              <Row label="downloading" value={fmtBool(snapshot.overlayState.downloading)} />
              <Row label="verifying" value={fmtBool(snapshot.overlayState.verifying)} />
              <Row label="installing" value={fmtBool(snapshot.overlayState.installing)} />
              <Row label="needsUnknownSourcesPermission" value={fmtBool(snapshot.overlayState.needsUnknownSourcesPermission)} />
              <Row label="failedReason" value={snapshot.overlayState.failedReason || '—'} valueColor={snapshot.overlayState.failedReason ? COLORS.bad : COLORS.muted} />
              <Row label="progress.percent" value={String(snapshot.overlayState.progress?.percent ?? '—')} />
              <Row label="progress.bytes" value={`${snapshot.overlayState.progress?.downloaded ?? 0}/${snapshot.overlayState.progress?.total ?? 0}`} />
            </Section>

            <Section title={`/api/update-debug — ${endpointStatus.httpStatus ?? endpointStatus.state}`}>
              <Row label="endpoint" value={UPDATE_DEBUG_ENDPOINT_URL} mono />
              <Row label="last fetch" value={fmtTs(endpointStatus.fetchedAt)} />
              <Row label="error" value={endpointStatus.error || '—'} valueColor={endpointStatus.error ? COLORS.bad : COLORS.muted} />
              <Pressable onPress={fetchEndpoint} style={styles.btn}>
                <Text style={styles.btnText}>Fetch now</Text>
              </Pressable>
              <Text style={styles.code}>
                {endpointStatus.body == null ? '(no body yet)' : copyJson(endpointStatus.body)}
              </Text>
            </Section>

            <Section title="Latest backend response (mobile)">
              <Text style={styles.code}>
                {snapshot.info ? copyJson(snapshot.info) : '(no payload yet)'}
              </Text>
            </Section>

            <Section title="Native state">
              <Text style={styles.code}>{copyJson(snapshot.native?.state)}</Text>
            </Section>

            <Section title="Snapshot (debug)">
              <Text style={styles.code}>{copyJson(snapshot)}</Text>
            </Section>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function Section({ title, children }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.sectionBody}>{children}</View>
    </View>
  );
}

function Row({ label, value, valueColor, mono }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text
        style={[
          styles.rowValue,
          mono ? styles.mono : null,
          valueColor ? { color: valueColor } : null,
        ]}
        selectable
      >
        {String(value ?? '—')}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  tapWrap: {
    // Invisible — exists only as a tap target. Cannot be styled to
    // affect the wrapped child layout.
  },
  scrim: {
    flex: 1,
    backgroundColor: COLORS.scrim,
    paddingTop: 36,
    paddingBottom: 16,
    paddingHorizontal: 12,
  },
  card: {
    flex: 1,
    backgroundColor: COLORS.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerTitle: {
    color: COLORS.text,
    fontSize: 15,
    fontWeight: '700',
  },
  closeBtn: {
    padding: 6,
  },
  body: {
    padding: 12,
    paddingBottom: 28,
  },
  section: {
    marginBottom: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 10,
    overflow: 'hidden',
  },
  sectionTitle: {
    color: COLORS.accent,
    fontSize: 12,
    fontWeight: '700',
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: 'rgba(96,165,250,0.07)',
    letterSpacing: 0.4,
  },
  sectionBody: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 6,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  rowLabel: {
    color: COLORS.muted,
    fontSize: 12,
    fontWeight: '600',
    minWidth: 138,
  },
  rowValue: {
    flex: 1,
    color: COLORS.text,
    fontSize: 12,
  },
  mono: {
    fontFamily: Platform.select({ android: 'monospace', ios: 'Menlo' }),
  },
  code: {
    marginTop: 6,
    color: COLORS.text,
    fontSize: 11,
    lineHeight: 15,
    fontFamily: Platform.select({ android: 'monospace', ios: 'Menlo' }),
    backgroundColor: 'rgba(255,255,255,0.04)',
    padding: 8,
    borderRadius: 6,
  },
  btn: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(96,165,250,0.16)',
    borderWidth: 1,
    borderColor: 'rgba(96,165,250,0.4)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    marginTop: 6,
  },
  btnText: {
    color: COLORS.accent,
    fontSize: 12,
    fontWeight: '700',
  },
});

// Stub for non-Android platforms so callers don't need a Platform check.
if (Platform.OS !== 'android') {
  // eslint-disable-next-line no-console
  console.log('[update]', '[OTA_INIT]', 'OtaDebugOverlay loaded on non-android platform; native module is android-only');
  // Keep isNativeAvailable usage referenced so bundlers don't strip the import.
  void isNativeAvailable;
}
