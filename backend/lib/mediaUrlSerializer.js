/**
 * Admin API helper: rewrite Render media URLs to BunnyCDN in JSON responses.
 * Set PUBLIC_MEDIA_CDN_BASE on the Admin API service (default below).
 */

const DEFAULT_MEDIA_CDN_BASE = "https://osmanitv.b-cdn.net";

const LEGACY_MEDIA_HOSTS = [
  "osmani-admin-api.onrender.com",
  "osmani-tv.onrender.com",
];

function mediaCdnBase() {
  const raw = process.env.PUBLIC_MEDIA_CDN_BASE || DEFAULT_MEDIA_CDN_BASE;
  return String(raw).replace(/\/+$/, "");
}

function isStreamProxyUrl(input) {
  return /\/stream-proxy(?:\?|$)/i.test(String(input ?? ""));
}

function rewriteLegacyRenderMediaUrl(input) {
  if (input == null) return input;
  const s = String(input).trim();
  if (!s) return s;

  if (s.startsWith("/")) {
    return `${mediaCdnBase()}${s}`;
  }

  if (!/^https?:\/\//i.test(s)) {
    return `${mediaCdnBase()}/${s.replace(/^\/+/, "")}`;
  }

  try {
    const u = new URL(s);
    const host = u.host.toLowerCase();
    const isLegacy = LEGACY_MEDIA_HOSTS.some((h) => host === h.toLowerCase());
    if (!isLegacy) return s;
    const cdn = new URL(mediaCdnBase());
    u.protocol = cdn.protocol;
    u.host = cdn.host;
    return u.toString();
  } catch {
    return s;
  }
}

function rewriteMediaUrlsInJson(value) {
  if (value == null) return value;
  if (typeof value === "string") {
    if (!/^https?:\/\//i.test(value) && !value.startsWith("/")) return value;
    if (value.includes("/uploads/") || isStreamProxyUrl(value) || value.startsWith("/uploads/")) {
      return rewriteLegacyRenderMediaUrl(value);
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => rewriteMediaUrlsInJson(item));
  }
  if (typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = rewriteMediaUrlsInJson(v);
    }
    return out;
  }
  return value;
}

module.exports = {
  DEFAULT_MEDIA_CDN_BASE,
  mediaCdnBase,
  isStreamProxyUrl,
  rewriteLegacyRenderMediaUrl,
  rewriteMediaUrlsInJson,
};
