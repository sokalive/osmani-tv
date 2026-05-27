import AsyncStorage from '@react-native-async-storage/async-storage';
import { getDeviceIdentity } from './deviceIdentity';
import {
  TRIAL_WATCH_FAIL_CLOSED,
  previewMsFromSettings,
  trialMsFromSettings,
} from './trialWatchSettings.shared';

const STORAGE_PREFIX = 'osmani:trial_watch:v2:';

/**
 * @typedef {'trial' | 'preview' | 'blocked'} TrialWatchPhase
 */

/**
 * @typedef {Object} TrialWatchPersistedState
 * @property {number} v
 * @property {string} fingerprint
 * @property {number} trialConsumedMs
 * @property {boolean} trialExhausted
 */

async function storageKey() {
  const { deviceFingerprint } = await getDeviceIdentity();
  return `${STORAGE_PREFIX}${deviceFingerprint}`;
}

/**
 * @returns {Promise<TrialWatchPersistedState>}
 */
export async function loadTrialWatchState() {
  const { deviceFingerprint } = await getDeviceIdentity();
  const empty = {
    v: 2,
    fingerprint: deviceFingerprint,
    trialConsumedMs: 0,
    trialExhausted: false,
  };
  try {
    const raw = await AsyncStorage.getItem(await storageKey());
    if (!raw) return empty;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return empty;
    if (String(parsed.fingerprint ?? '') !== deviceFingerprint) return empty;
    return {
      v: 2,
      fingerprint: deviceFingerprint,
      trialConsumedMs: Math.max(0, Number(parsed.trialConsumedMs ?? 0)),
      trialExhausted: parsed.trialExhausted === true,
    };
  } catch {
    return empty;
  }
}

/**
 * @param {TrialWatchPersistedState} state
 */
export async function saveTrialWatchState(state) {
  try {
    await AsyncStorage.setItem(await storageKey(), JSON.stringify(state));
  } catch {
    /* ignore */
  }
}

/**
 * @param {TrialWatchPersistedState} state
 * @param {typeof DEFAULT_TRIAL_WATCH_SETTINGS} settings
 * @returns {{ phase: TrialWatchPhase; allowanceMs: number; remainingMs: number; consumedMs: number }}
 */
export function resolveTrialWatchAllowance(state, settings = TRIAL_WATCH_FAIL_CLOSED) {
  const trialBudget = trialMsFromSettings(settings);
  const previewBudget = previewMsFromSettings(settings);

  if (!settings.enableTrial && !settings.enablePreviewAfterTrial) {
    return { phase: 'blocked', allowanceMs: 0, remainingMs: 0, consumedMs: 0 };
  }

  if (!state.trialExhausted && settings.enableTrial && trialBudget > 0) {
    const consumed = Math.min(trialBudget, Math.max(0, state.trialConsumedMs));
    const remaining = Math.max(0, trialBudget - consumed);
    if (remaining > 0) {
      return {
        phase: 'trial',
        allowanceMs: trialBudget,
        remainingMs: remaining,
        consumedMs: consumed,
      };
    }
  }

  if (settings.enablePreviewAfterTrial && previewBudget > 0) {
    return {
      phase: 'preview',
      allowanceMs: previewBudget,
      remainingMs: previewBudget,
      consumedMs: 0,
    };
  }

  return { phase: 'blocked', allowanceMs: 0, remainingMs: 0, consumedMs: state.trialConsumedMs };
}

/**
 * @param {TrialWatchPersistedState} state
 * @param {number} deltaMs
 * @param {typeof DEFAULT_TRIAL_WATCH_SETTINGS} settings
 * @returns {TrialWatchPersistedState}
 */
export function applyTrialWatchConsumption(state, deltaMs, settings = TRIAL_WATCH_FAIL_CLOSED) {
  const trialBudget = trialMsFromSettings(settings);
  const next = { ...state, trialConsumedMs: Math.max(0, state.trialConsumedMs) };

  if (!state.trialExhausted && settings.enableTrial && trialBudget > 0) {
    next.trialConsumedMs = Math.min(trialBudget, next.trialConsumedMs + Math.max(0, deltaMs));
    if (next.trialConsumedMs >= trialBudget) {
      next.trialExhausted = true;
    }
    return next;
  }

  return next;
}

export function formatTrialCountdown(remainingMs) {
  const totalSec = Math.max(0, Math.ceil(remainingMs / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
