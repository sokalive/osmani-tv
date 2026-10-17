/**
 * Public GET /api/popup-settings uses legacy mode aliases (`once`, `always`).
 * Admin SSE publishes the stored names (`show_once`, `always_show`).
 * Both must drive the same popup. An unrecognized mode is disabled.
 */

const MODE_ALIASES = Object.freeze({
  show_once: 'show_once',
  once: 'show_once',
  always_show: 'always_show',
  always: 'always_show',
  disabled: 'disabled',
});

export function normalizePopupMode(mode) {
  const key = String(mode ?? '').trim().toLowerCase();
  return MODE_ALIASES[key] ?? 'disabled';
}

export function normalizePopupSettings(payload) {
  const source = payload && typeof payload === 'object' ? payload : {};
  const bulletSource = Array.isArray(source.bullet_points)
    ? source.bullet_points
    : Array.isArray(source.bullets)
      ? source.bullets
      : [];
  return {
    mode: normalizePopupMode(source.mode),
    title: typeof source.title === 'string' ? source.title : '',
    greeting: typeof source.greeting === 'string' ? source.greeting : '',
    bullet_points: bulletSource.map((point) => String(point ?? '')),
    disclaimer: typeof source.disclaimer === 'string' ? source.disclaimer : '',
  };
}

/** Changes when the admin edits popup copy, so show-once can show the new text once. */
export function popupContentKey(settings) {
  const next = normalizePopupSettings(settings);
  return JSON.stringify({
    title: next.title,
    greeting: next.greeting,
    bullet_points: next.bullet_points,
    disclaimer: next.disclaimer,
  });
}

export function unwrapSettingsEvent(payload) {
  if (
    payload &&
    typeof payload === 'object' &&
    payload.payload &&
    typeof payload.payload === 'object' &&
    !Array.isArray(payload.payload)
  ) {
    return payload.payload;
  }
  return payload && typeof payload === 'object' ? payload : null;
}

/**
 * configVersion on SSE frames is a process-local counter. A backend restart
 * can drop it (for example 12838 → 55). Callers must not treat a lower value
 * as proof the event is stale.
 */
export function shouldAcceptAdminConfigEvent(previousVersion, nextVersion) {
  void previousVersion;
  void nextVersion;
  return true;
}
