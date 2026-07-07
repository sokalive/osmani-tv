/**
 * Channel catalog FREE/PREMIUM realtime patches — decoupled from subscription bootstrap.
 */

/** @typedef {{ id: string; accessType?: string; accessPremium?: boolean; access_premium?: boolean; revision?: number; updatedAt?: string; updated_at?: string; version?: number }} ChannelAccessPatch */

const CHANNEL_ROW_KEYS = new Set([
  'id',
  'channel_id',
  'accessType',
  'access_type',
  'accessPremium',
  'access_premium',
  'name',
  'updatedAt',
  'updated_at',
  'revision',
  'version',
  'catalogRevision',
  'catalog_revision',
]);

/**
 * @param {unknown} raw
 * @returns {{ eventName: string | null; data: unknown }}
 */
export function unwrapCatalogRealtimeEnvelope(raw) {
  if (!raw || typeof raw !== 'object') {
    return { eventName: null, data: raw };
  }
  const o = /** @type {Record<string, unknown>} */ (raw);
  if (o.event != null && 'payload' in o) {
    return { eventName: String(o.event).trim() || null, data: o.payload };
  }
  if (o.type != null && o.data != null) {
    return { eventName: String(o.type).trim() || null, data: o.data };
  }
  return { eventName: null, data: raw };
}

/**
 * @param {unknown} row
 * @returns {ChannelAccessPatch | null}
 */
export function normalizeChannelAccessPatch(row) {
  if (!row || typeof row !== 'object') return null;
  const r = /** @type {Record<string, unknown>} */ (row);
  const id = String(r.id ?? r.channel_id ?? '').trim();
  if (!id) return null;

  const accessTypeRaw = r.accessType ?? r.access_type;
  const accessType =
    accessTypeRaw != null ? String(accessTypeRaw).trim().toLowerCase() : undefined;
  const accessPremium =
    r.accessPremium !== undefined
      ? Boolean(r.accessPremium)
      : r.access_premium !== undefined
        ? Boolean(r.access_premium)
        : undefined;

  if (accessType == null && accessPremium === undefined) return null;

  const revision = pickRevision(r);
  return {
    id,
    ...(accessType != null ? { accessType } : {}),
    ...(accessPremium !== undefined ? { accessPremium } : {}),
    ...(revision != null ? { revision } : {}),
    ...(r.updatedAt != null ? { updatedAt: String(r.updatedAt) } : {}),
    ...(r.updated_at != null ? { updatedAt: String(r.updated_at) } : {}),
  };
}

/**
 * @param {Record<string, unknown>} row
 * @returns {number | null}
 */
function pickRevision(row) {
  const candidates = [
    row.revision,
    row.version,
    row.catalogRevision,
    row.catalog_revision,
    row.updatedAt,
    row.updated_at,
  ];
  for (const c of candidates) {
    if (c == null || c === '') continue;
    const n = Date.parse(String(c));
    if (Number.isFinite(n)) return n;
    const num = Number(c);
    if (Number.isFinite(num)) return num;
  }
  return null;
}

/**
 * @param {ChannelAccessPatch} patch
 * @param {Record<string, unknown>} existing
 * @returns {boolean}
 */
export function channelAccessPatchIsNewer(patch, existing) {
  const nextRev = patch.revision ?? null;
  if (nextRev == null) return true;
  const prevRev = pickRevision(existing);
  if (prevRev == null) return true;
  return nextRev >= prevRev;
}

/**
 * @param {string} eventName
 * @param {unknown} rawPayload
 * @returns {ChannelAccessPatch[]}
 */
export function parseChannelAccessRealtimePatches(eventName, rawPayload) {
  const { eventName: innerEv, data } = unwrapCatalogRealtimeEnvelope(rawPayload);
  const ev = String(innerEv ?? eventName ?? '').trim().toLowerCase();
  const patches = [];

  const pushRow = (row) => {
    const p = normalizeChannelAccessPatch(row);
    if (p) patches.push(p);
  };

  if (Array.isArray(data)) {
    for (const row of data) pushRow(row);
  } else if (data && typeof data === 'object') {
    const d = /** @type {Record<string, unknown>} */ (data);
    if (Array.isArray(d.channels)) {
      for (const row of d.channels) pushRow(row);
    } else if (d.channel) {
      pushRow(d.channel);
    } else if (d.id != null || d.channel_id != null) {
      pushRow(d);
    } else if (ev.includes('channel') || ev.includes('catalog')) {
      for (const [key, val] of Object.entries(d)) {
        if (!CHANNEL_ROW_KEYS.has(key) && val && typeof val === 'object') {
          pushRow(val);
        }
      }
    }
  }

  return patches;
}

/**
 * Apply access patches in-place on a new array (immutable output).
 * @param {unknown[]} channels
 * @param {ChannelAccessPatch[]} patches
 * @returns {{ channels: unknown[]; changed: boolean; applied: number }}
 */
export function applyChannelAccessPatches(channels, patches) {
  if (!Array.isArray(channels) || !patches?.length) {
    return { channels: channels ?? [], changed: false, applied: 0 };
  }

  const byId = new Map();
  for (const row of channels) {
    if (!row || typeof row !== 'object') continue;
    const id = String(row.id ?? row.channel_id ?? '').trim();
    if (id) byId.set(id, row);
  }

  let applied = 0;
  for (const patch of patches) {
    const id = String(patch.id).trim();
    const existing = byId.get(id);
    if (!existing || typeof existing !== 'object') continue;
    if (!channelAccessPatchIsNewer(patch, /** @type {Record<string, unknown>} */ (existing))) {
      continue;
    }

    const ex = /** @type {Record<string, unknown>} */ (existing);
    const accessType =
      patch.accessType ??
      (patch.accessPremium === true ? 'premium' : patch.accessPremium === false ? 'free' : undefined) ??
      ex.accessType ??
      ex.access_type;
    const accessPremium =
      patch.accessPremium !== undefined
        ? patch.accessPremium
        : String(accessType).toLowerCase() === 'premium';

    const next = {
      ...ex,
      accessType,
      access_type: accessType,
      accessPremium,
      access_premium: accessPremium,
    };
    if (patch.updatedAt) {
      next.updatedAt = patch.updatedAt;
      next.updated_at = patch.updatedAt;
    }
    if (patch.revision != null) {
      next.revision = patch.revision;
    }

    byId.set(id, next);
    applied += 1;
  }

  if (applied === 0) {
    return { channels, changed: false, applied: 0 };
  }

  const nextChannels = channels.map((row) => {
    if (!row || typeof row !== 'object') return row;
    const id = String(row.id ?? row.channel_id ?? '').trim();
    return id && byId.has(id) ? byId.get(id) : row;
  });

  return { channels: nextChannels, changed: true, applied };
}

/**
 * @param {string} eventName
 * @param {unknown} payload
 * @returns {boolean}
 */
export function catalogRealtimeEventMayCarryChannelAccess(eventName, payload) {
  const ev = String(eventName ?? '').trim().toLowerCase();
  if (
    ev.includes('channel') ||
    ev.includes('catalog') ||
    ev === 'sync' ||
    ev === 'message' ||
    ev === 'snapshot'
  ) {
    return true;
  }
  return parseChannelAccessRealtimePatches(eventName, payload).length > 0;
}
