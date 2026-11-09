/**
 * 1World Web — the file behind a Streamtape frame
 * ------------------------------------------------------------------
 * A chapter is a second, and a Streamtape frame cannot be told one.
 *
 * That is not a guess and not a missing integration: the embed's own page
 * (`https://streamtape.com/e/<id>`) is a Plyr over a plain `<video>`, its script
 * listens for no `message` event, and its player reads no start word from the
 * address — the only things it reads there are subtitle files (`c1_file`,
 * `subtitle_json`). player.js, the usual way to command another page's player,
 * is never answered: whatever is sent, the frame starts at nought.
 *
 * What *does* have a second is the file itself, but it is not reachable from a
 * page: Streamtape hands an address only to a request that holds the account's
 * ticket, the endpoint that turns a ticket into an address (`file/dl`) sends no
 * `Access-Control-Allow-Origin`, and an address made on a server is bound to
 * that server and refused for anyone else.
 *
 * So the project relays it. `studio-upload?action=file/stream&file=<id>` mints
 * the ticket, asks for the address, and passes the bytes (Range and all)
 * through to the reader — nothing more than the watch page needs, and only for
 * a file that is one of the site's published videos. The `<video>` here points
 * straight at that address, which is why a chapter is a seek again: the file
 * reports its own time, the chapter list follows it, and a link that carries
 * `&t=90s` opens there.
 *
 * The relay costs the project's bandwidth, so it is used **only when a chapter
 * is pressed** — ordinary watching stays inside the host's own player. Set
 * `RELAY` below to `false` to spend nothing: a chapter then only writes the
 * second into the address, and says so.
 */

import { STREAMTAPE } from "./config.js";

/** The relay is on. `false` keeps the host's player and stops paying for it. */
const RELAY = true;

/**
 * The address a `<video>` should play for this Streamtape file — the project's
 * relay — or an empty string when the relay is off.
 */
export function tapeSource(id) {
  if (!RELAY) return "";
  const key = String(id || "").trim();
  if (!key) return "";
  return `${STREAMTAPE.proxy}?action=file/stream&file=${encodeURIComponent(key)}`;
}

/**
 * Warm the relay before a chapter is pressed.
 *
 * The first byte of a cold file costs the host's ticket and its few seconds of
 * wait; asking while the page is still being read means the press arrives at a
 * running stream. The answer is dropped as soon as its headers are in — the
 * connection is closed, so nothing is downloaded twice.
 */
export function prefetchTape(id) {
  const address = tapeSource(id);
  if (!address || typeof fetch !== "function") return;
  const stop = typeof AbortController === "function" ? new AbortController() : null;
  fetch(address, stop ? { signal: stop.signal } : {})
    .then((answer) => {
      stop?.abort();
      const body = answer.body;
      if (body && typeof body.cancel === "function") body.cancel().catch(() => {});
    })
    .catch(() => "");
}
