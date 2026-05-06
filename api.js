/**
 * Production Render API host for the mobile app.
 * All HTTP modules (`api.js`, `api/payment.js`, `api/settings.js`, etc.) must use this `BASE_URL`.
 */
const DEFAULT_API_URL = "https://osmani-admin-api.onrender.com";

function getExpoPublicApiUrl() {
  try {
    const env = typeof process !== "undefined" ? process.env : undefined;
    const v = env?.EXPO_PUBLIC_API_URL;
    return typeof v === "string" && v.trim() ? v.trim() : null;
  } catch {
    return null;
  }
}

// Centralized API base URL:
// - Uses EXPO_PUBLIC_API_URL when provided (Expo web build-time injection)
// - Falls back to the current Render API host for safety
export const BASE_URL = (() => {
  const raw = getExpoPublicApiUrl() ?? DEFAULT_API_URL;
  return String(raw).replace(/\/+$/, "");
})();

export async function getChannels() {
  const res = await fetch(`${BASE_URL}/api/channels`);
  let body;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (!res.ok) {
    const extra =
      body && typeof body === 'object' && body.error != null
        ? ` — ${String(body.error)}`
        : '';
    throw new Error(`Could not load channels (${res.status})${extra}`);
  }
  if (!Array.isArray(body)) {
    throw new Error('Could not load channels (invalid response)');
  }
  return body;
}

export async function getBanners() {
  const res = await fetch(`${BASE_URL}/api/banners`);
  let body;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (!res.ok) {
    const extra =
      body && typeof body === 'object' && body.error != null
        ? ` — ${String(body.error)}`
        : '';
    throw new Error(`Could not load banners (${res.status})${extra}`);
  }
  if (!Array.isArray(body)) {
    throw new Error('Could not load banners (invalid response)');
  }
  return body;
}