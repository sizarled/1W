/**
 * Person blocks — "Block" on cast.html must not be a page-only switch.
 * ------------------------------------------------------------------
 * One member may block a person; from then on every film or series that
 * person acted in or directed disappears from that member's world:
 * rails on the homepage, related titles on watch.html, search results,
 * recommendations, Updates and the share sheet.
 *
 * The source of truth is the `person_block_map` RPC:
 *   { people: [tmdbPersonId, …],
 *     media:  [{ media_type: "movie"|"tv", tmdb_media_id }] }
 * It is cached in localStorage so the first paint can already filter,
 * then refreshed after sign-in / after the block dial changes.
 */
import { store } from "./utils.js";
import { getMember } from "./session.js";
import { rpc } from "./data.js";

const KEY = "1w.blocks";
const EMPTY = { people: [], media: [] };

function normalise(raw) {
  const people = Array.isArray(raw?.people) ? raw.people.map(Number).filter(Number.isFinite) : [];
  const media = Array.isArray(raw?.media)
    ? raw.media
        .map((row) => ({
          media_type: row?.media_type === "tv" ? "tv" : "movie",
          tmdb_media_id: Number(row?.tmdb_media_id),
        }))
        .filter((row) => Number.isFinite(row.tmdb_media_id))
    : [];
  return { people, media };
}

let map = normalise(store.get(KEY, null));

export function blockMap() {
  return map;
}

export function setBlockMap(raw) {
  map = normalise(raw);
  store.set(KEY, map);
  return map;
}

/** Pull the authoritative map for the signed-in member. */
export async function refreshBlockMap(member = getMember()) {
  if (!member?.id) {
    setBlockMap(EMPTY);
    return map;
  }
  const json = await rpc("person_block_map", { p_member: member.id }).catch(() => null);
  if (json && typeof json === "object") setBlockMap(json);
  return map;
}

export const blockedPeople = () => map.people.slice();

export function isPersonBlocked(tmdbPersonId) {
  return map.people.includes(Number(tmdbPersonId));
}

export function isMediaBlocked(kind, tmdbId) {
  const type = kind === "tv" ? "tv" : "movie";
  const id = Number(tmdbId);
  return map.media.some((row) => row.media_type === type && row.tmdb_media_id === id);
}

/** True when nothing is blocked — lets callers skip the work entirely. */
export const noBlocks = () => map.people.length === 0 && map.media.length === 0;

/**
 * Drop blocked titles from a list of TMDB items.
 * Accepts `{ id }` plus any of `media_type` / `mediaType` / `kind`.
 */
export function filterBlocked(items = [], kind) {
  if (noBlocks()) return items;
  return items.filter((item) => {
    const type = kind || item.mediaType || item.media_type || item.kind || "movie";
    return !isMediaBlocked(type, item.id ?? item.tmdb_media_id ?? item.tmdbId);
  });
}

/** Names of every blocked person, for keyword search filters. */
export const blockedNamesKey = "1w.blocks.names";
