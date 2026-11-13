/**
 * Session smoke test — one sign-in, every page.
 *
 *   node tools/session-smoke.mjs
 *
 * The bug this gate exists for: a token kept in `sessionStorage` is invisible
 * to every other tab, so a signed-in member was asked to sign in again on the
 * next page they opened. There is one store now, and this file proves it.
 *
 * Pass 1 — writing: "stay signed in" or not, the token lands in `localStorage`,
 *          with an expiry, and never in `sessionStorage`.
 * Pass 2 — reading: a second page — a fresh import of the same module, the way
 *          a new tab loads it — sees the token the first page wrote.
 * Pass 3 — the end: an expired token is dropped and cleared; a sign-out clears
 *          both the token and its expiry.
 */
import { JSDOM } from "jsdom";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const checks = [];
const expect = (name, ok, detail = "") => checks.push({ name, ok: Boolean(ok), detail: String(detail) });

const dom = new JSDOM("<p></p>", { url: "http://localhost/session.html" });
const { window } = dom;
globalThis.window = window;
globalThis.document = window.document;
globalThis.localStorage = window.localStorage;
globalThis.sessionStorage = window.sessionStorage;
globalThis.location = window.location;
Object.defineProperty(globalThis, "navigator", { value: window.navigator, configurable: true });

let pass = 0;
const load = () => import(`file://${join(root, "assets/js/session.js")}?p=${++pass}`);

/* ------------------------------------------------------------------ */
/* 1 — writing                                                        */
/* ------------------------------------------------------------------ */
{
  const session = await load();
  session.setSessionToken("tok-remembered", true);
  expect("write: a remembered token is in localStorage", window.localStorage.getItem("1w.session") === "tok-remembered", window.localStorage.getItem("1w.session"));
  expect("write: and not in sessionStorage", window.sessionStorage.getItem("1w.session") === null, window.sessionStorage.getItem("1w.session"));
  const until = Number(window.localStorage.getItem("1w.session.until") || 0);
  expect("write: it carries an expiry", until > Date.now(), String(until));
  expect("write: thirty days of it", until - Date.now() > 29 * 24 * 3600 * 1000, String(Math.round((until - Date.now()) / 864e5)));

  session.setSessionToken("tok-this-tab", false);
  expect("write: a session with no box is stored the same way", window.localStorage.getItem("1w.session") === "tok-this-tab", window.localStorage.getItem("1w.session"));
  expect("write: still not in the tab store", window.sessionStorage.getItem("1w.session") === null);
  const until2 = Number(window.localStorage.getItem("1w.session.until") || 0);
  expect("write: with the server's twelve hours", until2 - Date.now() <= 12 * 3600 * 1000 + 5000, String(Math.round((until2 - Date.now()) / 3600e3)));
}

/* ------------------------------------------------------------------ */
/* 2 — reading, from another page                                     */
/* ------------------------------------------------------------------ */
{
  /* a new tab: a fresh module, no memory of the write above */
  const other = await load();
  expect("read: the next page finds the session", other.sessionToken() === "tok-this-tab", other.sessionToken());
  expect("read: and says it is signed in", other.signedIn() === true);

  /* the same page after a reload, with storage wiped clean */
  window.localStorage.clear();
  const fresh = await load();
  expect("read: with nothing stored, nothing is signed in", fresh.sessionToken() === "" && fresh.signedIn() === false, fresh.sessionToken());
}

/* ------------------------------------------------------------------ */
/* 3 — the end of a session                                           */
/* ------------------------------------------------------------------ */
{
  const session = await load();
  session.setSessionToken("tok-old", true);
  window.localStorage.setItem("1w.session.until", String(Date.now() - 1000));
  expect("end: an expired token is not handed out", session.sessionToken() === "", session.sessionToken());
  expect("end: and it is cleared, not left behind", window.localStorage.getItem("1w.session") === null && window.localStorage.getItem("1w.session.until") === null);

  session.setSessionToken("tok-live", true);
  session.clearSessionToken();
  expect("end: a sign-out clears the token", window.localStorage.getItem("1w.session") === null);
  expect("end: and its expiry", window.localStorage.getItem("1w.session.until") === null);
  expect("end: and nothing is signed in afterwards", session.signedIn() === false);
}

/* ------------------------------------------------------------------ */
const failed = checks.filter((c) => !c.ok);
failed.forEach((c) => console.log(`FAIL  ${c.name}${c.detail ? ` — ${c.detail}` : ""}`));
console.log(`\nsession: ${checks.length - failed.length}/${checks.length} pass`);
if (failed.length) process.exit(1);
