import { resolveApiBaseUrl } from '../lib/apiBaseUrl';
import { guardProductionFetchUrl } from '../lib/playVpsApiHost';

async function parseJson(res) {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function normalizeAppFlags(body) {
  if (!body || typeof body !== 'object') return null;
  const patch = parseViewerSettingsPatch(body);
  return {
    freeMode: Boolean(body.freeMode),
    emergencyMode: Boolean(body.emergencyMode),
    maintenanceMode: Boolean(body.maintenanceMode),
    requireUpdateBeforeChannelPlayback: Boolean(patch?.requireUpdateBeforeChannelPlayback),
  };
}

function updatePlaybackGateFromObject(o) {
  const v = pickDefined(o, [
    'require_update_before_channel_playback',
    'requireUpdateBeforeChannelPlayback',
    'require_update_before_playback',
    'requireUpdateBeforePlayback',
    'block_channel_playback_until_update',
    'blockChannelPlaybackUntilUpdate',
  ]);
  if (v === undefined) return undefined;
  return coerceBool(v);
}

/**
 * Viewer-safe app flags beyond free/emergency/maintenance.
 * @param {Record<string, unknown>} o
 */
function parseViewerSettingsPatchFromObject(o) {
  /** @type {{ requireUpdateBeforeChannelPlayback?: boolean }} */
  const patch = {};
  const gate = updatePlaybackGateFromObject(o);
  if (gate !== undefined) patch.requireUpdateBeforeChannelPlayback = gate;
  return patch;
}

/**
 * @param {unknown} payload
 * @returns {{ freeMode?: boolean, emergencyMode?: boolean, maintenanceMode?: boolean, requireUpdateBeforeChannelPlayback?: boolean } | null}
 */
export function parseViewerSettingsPatch(payload) {
  const candidates = [];
  const push = (x) => {
    if (x && typeof x === 'object' && !candidates.includes(x)) candidates.push(x);
  };
  push(payload);
  if (payload && typeof payload === 'object') {
    push(payload.payload);
    push(payload.data);
    push(payload.body);
    push(payload.settings);
    push(payload.current_settings);
    push(payload.app_settings);
    push(payload.app_modes);
    push(payload.appModes);
    push(payload.runtime_modes);
    push(payload.runtimeModes);
    push(payload.config);
    if (payload.config && typeof payload.config === 'object') {
      push(payload.config.app_settings);
      push(payload.config.settings);
      push(payload.config.app_modes);
      push(payload.config.appModes);
      push(payload.config.modes);
    }
    if (payload.data && typeof payload.data === 'object') {
      push(payload.data.settings);
      push(payload.data.app_settings);
      push(payload.data.app_modes);
    }
  }
  /** @type {{ freeMode?: boolean, emergencyMode?: boolean, maintenanceMode?: boolean, requireUpdateBeforeChannelPlayback?: boolean }} */
  const out = {};
  for (const o of candidates) {
    const modes = triStateModesFromObject(o);
    if (modes.freeMode !== undefined) out.freeMode = modes.freeMode;
    if (modes.emergencyMode !== undefined) out.emergencyMode = modes.emergencyMode;
    if (modes.maintenanceMode !== undefined) out.maintenanceMode = modes.maintenanceMode;
    const gate = parseViewerSettingsPatchFromObject(o);
    if (gate.requireUpdateBeforeChannelPlayback !== undefined) {
      out.requireUpdateBeforeChannelPlayback = gate.requireUpdateBeforeChannelPlayback;
    }
  }
  return Object.keys(out).length ? out : null;
}

function pickDefined(obj, keys) {
  if (!obj || typeof obj !== 'object') return undefined;
  for (const k of keys) {
    if (Object.prototype.hasOwnProperty.call(obj, k)) return obj[k];
  }
  return undefined;
}

function coerceBool(v) {
  if (v === true || v === 1) return true;
  if (v === false || v === 0) return false;
  if (typeof v === 'string') {
    const t = v.trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(t)) return true;
    if (['0', 'false', 'no', 'off', ''].includes(t)) return false;
  }
  return Boolean(v);
}

/**
 * Read booleans for the three runtime modes from one object (many admin/API shapes).
 * @param {Record<string, unknown>} o
 * @returns {{ freeMode?: boolean, emergencyMode?: boolean, maintenanceMode?: boolean }}
 */
function triStateModesFromObject(o) {
  /** @type {{ freeMode?: boolean, emergencyMode?: boolean, maintenanceMode?: boolean }} */
  const patch = {};
  const fm = pickDefined(o, [
    'freeMode',
    'free_mode',
    'free',
    'isFreeMode',
    'is_free_mode',
    'freeModeEnabled',
    'free_mode_enabled',
  ]);
  if (fm !== undefined) patch.freeMode = coerceBool(fm);
  const em = pickDefined(o, [
    'emergencyMode',
    'emergency_mode',
    'emergency',
    'isEmergencyMode',
    'is_emergency_mode',
    'emergencyModeEnabled',
    'emergency_mode_enabled',
  ]);
  if (em !== undefined) patch.emergencyMode = coerceBool(em);
  const mm = pickDefined(o, [
    'maintenanceMode',
    'maintenance_mode',
    'maintenance',
    'isMaintenanceMode',
    'is_maintenance_mode',
    'maintenanceModeEnabled',
    'maintenance_mode_enabled',
  ]);
  if (mm !== undefined) patch.maintenanceMode = coerceBool(mm);
  return patch;
}

/**
 * Merge admin app flags from SSE / realtime envelopes (outer frame, nested
 * `payload`, `settings`, `app_modes`, `config`, snake_case DB fields). Used so
 * Android updates immediately without calling protected GET /api/settings.
 *
 * @param {unknown} payload
 * @returns {{ freeMode?: boolean, emergencyMode?: boolean, maintenanceMode?: boolean } | null}
 */
export function parseAppSettingsRealtimePatch(payload) {
  const patch = parseViewerSettingsPatch(payload);
  if (!patch) return null;
  const { requireUpdateBeforeChannelPlayback, ...modes } = patch;
  const out = { ...modes };
  if (requireUpdateBeforeChannelPlayback !== undefined) {
    out.requireUpdateBeforeChannelPlayback = requireUpdateBeforeChannelPlayback;
  }
  return Object.keys(out).length ? out : null;
}

/**
 * Global app flags from admin (Free / Emergency / Maintenance).
 * GET /api/settings — may require admin session on hardened APIs.
 */
export async function getSettings() {
  const url = `${resolveApiBaseUrl()}/api/settings`;
  guardProductionFetchUrl(url, 'settings');
  const res = await fetch(url);
  const body = await parseJson(res);
  if (!res.ok) {
    const err = body && typeof body === 'object' && body.error != null ? String(body.error) : '';
    throw new Error(`Could not load settings (${res.status})${err ? ` — ${err}` : ''}`);
  }
  if (!body || typeof body !== 'object') {
    throw new Error('Could not load settings (invalid response)');
  }
  return normalizeAppFlags(body);
}

/**
 * Viewer / APK bootstrap: public app flags only (never calls admin GET /api/settings).
 * Prefer live values from {@link parseAppSettingsRealtimePatch} + SSE; optional cold start
 * when GET /api/public/app-settings is deployed.
 */
export async function tryGetViewerAppSettings() {
  const paths = [
    '/api/public/app-settings',
    '/api/public/runtime-modes',
    '/api/settings',
  ];
  for (const path of paths) {
    try {
      const url = `${resolveApiBaseUrl()}${path}`;
      guardProductionFetchUrl(url, 'viewer-app-settings');
      const res = await fetch(url);
      const body = await parseJson(res);
      if (!res.ok) continue;
      const patch = parseAppSettingsRealtimePatch(body);
      if (patch && Object.keys(patch).length > 0) return patch;
    } catch {
      /* ignore */
    }
  }
  return null;
}
