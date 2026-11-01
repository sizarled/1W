/**
 * The IPTV playlists.
 * ------------------------------------------------------------------
 * Two M3U files live in the public storage bucket:
 *
 *   IPTV/IPTV-Free.m3u      → the free channels
 *   IPTV/IPTV Premuim.m3u   → the premium channels
 *
 * (the spelling of the second object is the one on the server — keep it)
 *
 * One rule decides everything here: a `group-title` of
 * `General;News` puts the same channel in **both** groups. The
 * semicolon is a separator, never part of a name — no `General;News`
 * group is ever created.
 *
 * Nothing about a channel is invented: a line without `group-title`
 * falls back to `Ungrouped`, a missing logo falls back to the tile
 * placeholder the rest of the site uses.
 */

import { storageUrl } from "./config.js";
import { tilePlaceholder } from "./utils.js";

/** The two playlists, as they sit in the `source` bucket. */
export const PLAYLISTS = {
  free: { kind: "free", path: "IPTV/IPTV-Free.m3u", label: "Free channels", premium: false },
  premium: { kind: "premium", path: "IPTV/IPTV Premuim.m3u", label: "Premium channels", premium: true },
};

const CACHE_PREFIX = "1w.m3u.";
const CACHE_TTL = 6 * 60 * 60 * 1000;

export function playlistUrl(kind) {
  const entry = PLAYLISTS[kind];
  if (!entry) return "";
  /* encode each segment, the premium object name holds a space */
  return storageUrl(entry.path.split("/").map(encodeURIComponent).join("/"));
}

/* ------------------------------------------------------------------ */
/* parsing                                                             */
/* ------------------------------------------------------------------ */
function attributesOf(line) {
  const attrs = {};
  const pattern = /([\w-]+)\s*=\s*"([^"]*)"/g;
  let match = pattern.exec(line);
  while (match) {
    attrs[match[1].toLowerCase()] = match[2].trim();
    match = pattern.exec(line);
  }
  return attrs;
}

function titleOf(line) {
  const comma = line.indexOf(",");
  return comma === -1 ? "" : line.slice(comma + 1).trim();
}

/** `General;News` → `["General", "News"]` — trimmed, de-duplicated, order kept. */
export function splitGroups(value) {
  const raw = String(value || "").split(";");
  const seen = new Set();
  const out = [];
  for (const part of raw) {
    const name = part.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

/**
 * Read an M3U into channel rows.
 *
 * @param {string} text
 * @param {{premium?: boolean, kind?: string}} options
 * @returns {Array<object>}
 */
export function parseM3U(text, { premium = false, kind = "free" } = {}) {
  const rows = [];
  const lines = String(text || "").split(/\r?\n/);
  let pending = null;

  const push = (url) => {
    if (!pending) return;
    const groups = splitGroups(pending.attrs["group-title"]);
    const name = pending.title || pending.attrs["tvg-name"] || `Channel ${rows.length + 1}`;
    const id = pending.attrs["tvg-id"] || `${kind}-${String(rows.length + 1).padStart(6, "0")}`;
    rows.push({
      id,
      m3u: id,
      name,
      /* the first group is the label on a card, `groups` is where the channel lives */
      group: groups[0] || "Ungrouped",
      groups: groups.length ? groups : ["Ungrouped"],
      category: groups[0] || "Ungrouped",
      country: (pending.attrs["tvg-country"] || "").trim(),
      language: (pending.attrs["tvg-language"] || "").trim(),
      logo: (pending.attrs["tvg-logo"] || "").trim(),
      link: url,
      url,
      views: 0,
      premium: Boolean(premium),
      href: `iptv.html?M3U=${encodeURIComponent(id)}`,
      type: kind,
    });
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (/^#EXTINF/i.test(line)) {
      pending = { attrs: attributesOf(line), title: titleOf(line) };
      continue;
    }
    if (line.startsWith("#")) continue;
    if (pending) {
      push(line);
      pending = null;
    }
  }

  return rows.map((row, index) => (row.logo ? row : { ...row, logo: tilePlaceholder(row.name, index) }));
}

/* ------------------------------------------------------------------ */
/* loading                                                             */
/* ------------------------------------------------------------------ */
function readCache(kind) {
  try {
    const raw = sessionStorage.getItem(CACHE_PREFIX + kind);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || Date.now() - Number(parsed.at || 0) > CACHE_TTL) return null;
    return Array.isArray(parsed.rows) ? parsed.rows : null;
  } catch {
    return null;
  }
}

function writeCache(kind, rows) {
  try {
    sessionStorage.setItem(CACHE_PREFIX + kind, JSON.stringify({ at: Date.now(), rows }));
  } catch {
    /* quota or private mode — the playlist is simply fetched again */
  }
}

const inflight = new Map();

/**
 * The channels of one playlist. Never throws: an unreachable file gives `[]`
 * so the page can fall back to whatever the tables hold.
 *
 * @param {"free"|"premium"} kind
 * @returns {Promise<Array<object>>}
 */
export async function loadPlaylist(kind) {
  const entry = PLAYLISTS[kind];
  if (!entry) return [];
  const cached = readCache(kind);
  if (cached && cached.length) return cached;
  if (inflight.has(kind)) return inflight.get(kind);

  const run = (async () => {
    try {
      const res = await fetch(playlistUrl(kind), { cache: "no-store", credentials: "omit" });
      if (!res.ok) return [];
      const text = await res.text();
      const rows = parseM3U(text, { premium: entry.premium, kind });
      if (rows.length) writeCache(kind, rows);
      return rows;
    } catch {
      return [];
    } finally {
      inflight.delete(kind);
    }
  })();

  inflight.set(kind, run);
  return run;
}

/* ------------------------------------------------------------------ */
/* reading a list                                                      */
/* ------------------------------------------------------------------ */
/**
 * Every group of a playlist, with the channels that belong to it.
 * A channel with two groups appears once under each of them.
 *
 * @param {Array<object>} rows
 * @returns {Array<{name: string, channels: Array<object>}>}
 */
export function groupChannels(rows) {
  const groups = new Map();
  for (const row of rows || []) {
    const names = row.groups && row.groups.length ? row.groups : splitGroups(row.group || row.category);
    for (const name of names.length ? names : ["Ungrouped"]) {
      if (!groups.has(name)) groups.set(name, []);
      const bucket = groups.get(name);
      /* the same channel twice in one group would be a bug, not a feature */
      if (!bucket.some((entry) => entry.id === row.id)) bucket.push(row);
    }
  }
  return [...groups.entries()]
    .map(([name, channels]) => ({ name, channels }))
    .sort((a, b) => b.channels.length - a.channels.length || a.name.localeCompare(b.name, "en"));
}

/** Case-insensitive search over the name, the groups and the country. */
export function searchChannels(rows, query, limit = 60) {
  const key = String(query || "").trim().toLowerCase();
  const list = rows || [];
  if (!key) return list.slice(0, limit);
  return list
    .filter(
      (row) =>
        row.name.toLowerCase().includes(key) ||
        String(row.id || "").toLowerCase().includes(key) ||
        (row.groups || []).some((group) => group.toLowerCase().includes(key)) ||
        String(row.country || "").toLowerCase().includes(key)
    )
    .slice(0, limit);
}
