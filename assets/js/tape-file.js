/**
 * 1World Web — the file behind a Streamtape frame
 * ------------------------------------------------------------------
 * A chapter is a second, and a Streamtape frame cannot be told one.
 *
 * That is not a guess and not a missing integration: the embed's own page
 * (`https://streamtape.com/e/<id>`) is built on Plyr with a plain
 * `<video id="mainvideo">`, its script listens for no `message` event, and its
 * player reads no start word from the address — the only things it reads there
 * are subtitle files (`c1_file`, `subtitle_json`). player.js, which is the
 * usual way to command another page's player, is therefore never answered:
 * whatever we send, the frame starts at nought and stays there.
 *
 * What *does* have a second is the file itself. Streamtape hands out the
 * address of a file through its own API, in two steps:
 *
 *   1. `file/dlticket` — a ticket, and a `wait_time` to sit out. This half
 *      needs the account's API Login and Key, which live in the `studio-upload`
 *      function and nowhere else, so the browser asks that function
 *      (`?action=file/ticket`) and the function answers with the ticket alone.
 *
 *   2. `file/dl?ticket=…` — the address itself. This half **must** happen in
 *      the reader's browser: Streamtape ties the address to whoever asked for
 *      it, and one made on a server plays for nobody ("this download link is
 *      not for you"). The API answers `Access-Control-Allow-Origin: *`, so the
 *      page can make the call itself.
 *
 * The address that comes back is a plain file: `<video src=…>` plays it, seeks
 * in it, and reports its own time, so the chapter list, the playhead and the
 * second in the address all work again.
 *
 * Nothing here throws into the page: a failure is an empty string, and the
 * caller decides what to say about it.
 */

import { STREAMTAPE } from "./config.js";

/** How long one made address is trusted before it is made again. */
const LIFE = 20 * 60 * 1000;
/** Streamtape's own wait is a handful of seconds; this is the ceiling. */
const WAIT_CAP = 15;
/** One retry when the address is asked for a heartbeat too early. */
const RETRY_AFTER = 2000;

/** id → { url, until } — one address per file per page. */
const made = new Map();
/** id → Promise — two chapters pressed at once ask once. */
const busy = new Map();

const nap = (ms) => new Promise((done) => setTimeout(done, Math.max(0, ms)));

/** The address already in hand for this file, or an empty string. */
export function tapeReady(id) {
  const hit = made.get(String(id || ""));
  if (hit && hit.until > Date.now()) return hit.url;
  return "";
}

/** Forget an address — a link that has gone stale is made again. */
export function forgetTape(id) {
  made.delete(String(id || ""));
}

/**
 * Ask for the file's address before it is needed.
 *
 * A chapter is pressed with the reader watching, and the ticket has a wait;
 * asking while the page is still being read means the second arrives at once.
 */
export function prefetchTape(id) {
  if (!id || tapeReady(id)) return;
  tapeAddress(id).catch(() => "");
}

/**
 * The address of the file behind a Streamtape id.
 *
 * Resolves with the address, or with an empty string when the host will not
 * give one — never rejects, so a chapter never hangs on it.
 */
export async function tapeAddress(id) {
  const key = String(id || "").trim();
  if (!key) return "";
  const ready = tapeReady(key);
  if (ready) return ready;
  if (busy.has(key)) return busy.get(key);

  const job = ask(key)
    .then((url) => {
      if (url) made.set(key, { url, until: Date.now() + LIFE });
      return url;
    })
    .catch(() => "")
    .finally(() => busy.delete(key));

  busy.set(key, job);
  return job;
}

/* ------------------------------------------------------------------ */
/* the two halves                                                      */
/* ------------------------------------------------------------------ */

/** The ticket, from the function that holds the account's credentials. */
async function ticket(key) {
  /* a plain GET with no headers of its own: no preflight, no key in the page */
  const address = `${STREAMTAPE.proxy}?action=file/ticket&file=${encodeURIComponent(key)}`;
  let answer;
  try {
    answer = await fetch(address);
  } catch {
    return null;
  }
  const body = await answer.json().catch(() => null);
  if (!body || Number(body.status) !== 200 || !body.result || !body.result.ticket) return null;
  return body.result;
}

/** The address, made by this browser, for this browser. */
async function link(key, pass) {
  const address = `${STREAMTAPE.api}/file/dl?file=${encodeURIComponent(key)}&ticket=${encodeURIComponent(pass)}`;
  let answer;
  try {
    answer = await fetch(address);
  } catch {
    return "";
  }
  const body = await answer.json().catch(() => null);
  if (!body || Number(body.status) !== 200 || !body.result) return "";
  return String(body.result.url || "");
}

async function ask(key) {
  const pass = await ticket(key);
  if (!pass) return "";
  const wait = Math.min(WAIT_CAP, Math.max(0, Number(pass.wait_time) || 0));
  if (wait) await nap(wait * 1000);

  const first = await link(key, pass.ticket);
  if (first) return first;
  /* a ticket that was minted a moment ago is sometimes still ripening */
  await nap(RETRY_AFTER);
  return link(key, pass.ticket);
}
