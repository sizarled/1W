/**
 * iptv smoke test (jsdom, no network).
 *
 *   node tools/iptv-smoke.mjs
 *
 * Covers the two rules the brief is explicit about:
 *   • free channels come from `IPTV/IPTV-Free.m3u`, premium from
 *     `IPTV/IPTV Premuim.m3u` (the storage object keeps that spelling)
 *   • `group-title="General;News"` puts the channel in **both** groups, and no
 *     group ever carries a semicolon in its name
 * …plus the page itself: group chips, the premium lock, search and the
 * `?M3U=` deep link.
 */
import { JSDOM } from "jsdom";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const html = readFileSync(join(root, "iptv.html"), "utf8").replace(/<script[^>]*src="[^"]*"[^>]*><\/script>/g, "");

const FREE_M3U = `#EXTM3U
#EXTINF:-1 tvg-id="al.one" tvg-logo="https://logo.example/one.png" group-title="General;News",Al Aoula
https://stream.example/one.m3u8
#EXTINF:-1 tvg-id="al.two" group-title="News",2M Monde
https://stream.example/two.m3u8
#EXTINF:-1 tvg-id="al.three" group-title="Sport ; General",Arryadia
https://stream.example/three.m3u8
#EXTINF:-1 tvg-id="al.four",No Group Channel
https://stream.example/four.m3u8
`;

const PREMIUM_M3U = `#EXTM3U
#EXTINF:-1 tvg-id="pr.one" group-title="Movies;General",Cine Premiere
https://stream.example/premium-one.m3u8
#EXTINF:-1 tvg-id="pr.two" group-title="Sport",Sport Ultra
https://stream.example/premium-two.m3u8
`;

const STORAGE = "https://vtbqbhuywdhnvitbcsfy.supabase.co/storage/v1/object/public/source/IPTV/";
const calls = [];
const errors = [];

function replyText(text) {
  return Promise.resolve({ ok: true, status: 200, text: async () => text, json: async () => ({}) });
}

const checks = [];
function expect(name, condition, detail = "") {
  checks.push({ name, ok: Boolean(condition), detail });
}

/* ------------------------------------------------------------------ */
/* pass 1 — the parser                                                 */
/* ------------------------------------------------------------------ */
{
  const { parseM3U, splitGroups, groupChannels, playlistUrl, PLAYLISTS } = await import(
    `file://${join(root, "assets/js/playlists.js")}?pass=1`
  );

  expect("url: free object", playlistUrl("free") === `${STORAGE}IPTV-Free.m3u`, playlistUrl("free"));
  expect("url: premium object keeps the spelling", playlistUrl("premium") === `${STORAGE}IPTV%20Premuim.m3u`, playlistUrl("premium"));
  expect("playlist labels", PLAYLISTS.premium.premium === true && PLAYLISTS.free.premium === false);

  expect("split: two groups", JSON.stringify(splitGroups("General;News")) === '["General","News"]');
  expect("split: trims and drops blanks", JSON.stringify(splitGroups(" Sport ; ; General ")) === '["Sport","General"]');
  expect("split: de-duplicates", JSON.stringify(splitGroups("News;news")) === '["News"]');

  const rows = parseM3U(FREE_M3U, { kind: "free" });
  expect("parse: four channels", rows.length === 4, `${rows.length}`);
  const one = rows.find((row) => row.name === "Al Aoula");
  expect("parse: name", Boolean(one));
  expect("parse: groups split", JSON.stringify(one?.groups) === '["General","News"]', JSON.stringify(one?.groups));
  expect("parse: first group is the label", one?.group === "General");
  expect("parse: logo kept", one?.logo === "https://logo.example/one.png");
  expect("parse: url", one?.link === "https://stream.example/one.m3u8");
  expect("parse: href deep link", one?.href === `iptv.html?M3U=${encodeURIComponent("al.one")}`, one?.href);
  expect("parse: missing group falls back", rows.find((row) => row.name === "No Group Channel")?.group === "Ungrouped");
  expect("parse: no logo gets a tile", /^data:image\/svg/.test(rows.find((row) => row.name === "2M Monde")?.logo || ""));

  const groups = groupChannels(rows);
  const names = groups.map((group) => group.name);
  expect("groups: no semicolon in a name", names.every((name) => !name.includes(";")), names.join(" | "));
  expect("groups: four names", names.length === 4, names.join(" | "));
  const news = groups.find((group) => group.name === "News");
  const general = groups.find((group) => group.name === "General");
  expect("groups: the channel is in News", news?.channels.some((row) => row.id === "al.one"));
  expect("groups: the channel is in General too", general?.channels.some((row) => row.id === "al.one"));
  expect("groups: sport keeps its trimmed name", names.includes("Sport"), names.join(" | "));
  expect("groups: a channel listed once per group", news.channels.filter((row) => row.id === "al.one").length === 1);
}

/* ------------------------------------------------------------------ */
/* pass 2 — the page                                                   */
/* ------------------------------------------------------------------ */
async function boot(pass, search = "") {
  const dom = new JSDOM(html, { url: `http://localhost/iptv.html${search}`, pretendToBeVisual: true });
  const { window } = dom;
  window.addEventListener("error", (e) => errors.push(String(e.error || e.message)));
  window.addEventListener("unhandledrejection", (e) => errors.push(String(e.reason)));

  globalThis.window = window;
  globalThis.document = window.document;
  globalThis.HTMLElement = window.HTMLElement;
  globalThis.Element = window.Element;
  globalThis.Node = window.Node;
  globalThis.CustomEvent = window.CustomEvent;
  globalThis.Event = window.Event;
  globalThis.localStorage = window.localStorage;
  globalThis.sessionStorage = window.sessionStorage;
  globalThis.getComputedStyle = window.getComputedStyle.bind(window);
  globalThis.requestAnimationFrame = window.requestAnimationFrame.bind(window);
  globalThis.matchMedia = (q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  globalThis.location = {
    search,
    hash: "",
    href: `http://localhost/iptv.html${search}`,
    protocol: "http:",
    pathname: "/iptv.html",
  };
  window.scrollTo = () => {};

  globalThis.fetch = (url) => {
    const href = String(url);
    calls.push(href);
    if (href.startsWith(STORAGE) && href.endsWith("IPTV-Free.m3u")) return replyText(FREE_M3U);
    if (href.startsWith(STORAGE) && href.endsWith("IPTV%20Premuim.m3u")) return replyText(PREMIUM_M3U);
    return Promise.resolve({ ok: false, status: 404, text: async () => "", json: async () => [] });
  };

  window.sessionStorage.clear();
  await import(`file://${join(root, "assets/js/iptv.js")}?pass=${pass}`);
  const { initIptv } = await import(`file://${join(root, "assets/js/iptv.js")}?pass=${pass}`);
  initIptv();
  await new Promise((r) => setTimeout(r, 260));

  const qs = (sel) => window.document.querySelector(sel);
  const qsa = (sel) => [...window.document.querySelectorAll(sel)];
  const text = (sel) => qs(sel)?.textContent.replace(/\s+/g, " ").trim() || "";
  const click = (el) => el && el.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
  const wait = (ms = 120) => new Promise((r) => setTimeout(r, ms));
  return { window, document: window.document, qs, qsa, text, click, wait };
}

{
  calls.length = 0;
  const p = await boot(2);
  expect("page: both playlists fetched", calls.some((c) => c.endsWith("IPTV-Free.m3u")) && calls.some((c) => c.endsWith("IPTV%20Premuim.m3u")), calls.join(" | "));
  expect("page: status line hidden after load", p.qs("[data-iptv-status]")?.hidden === true);

  const chips = p.qsa("[data-group]").map((chip) => chip.dataset.group);
  expect("page: all-group chip", chips[0] === "all", chips.join(" | "));
  expect("page: group chips rendered", chips.includes("General") && chips.includes("News") && chips.includes("Sport"), chips.join(" | "));
  expect("page: no joined group chip", chips.every((name) => !name.includes(";")), chips.join(" | "));

  const freeCards = p.qsa("[data-iptv-grid] .chcard").map((card) => card.dataset.channel);
  expect("page: free cards from the free playlist", freeCards.includes("Al Aoula") && freeCards.includes("Arryadia"), freeCards.join(" | "));
  expect("page: premium channel not in the free list", !freeCards.includes("Cine Premiere"));
  expect("page: title counts the free channels", /4 channels/.test(p.text("[data-iptv-meta]")), p.text("[data-iptv-meta]"));
  expect("page: meta shows the group count", /4 groups/.test(p.text("[data-iptv-meta]")), p.text("[data-iptv-meta]"));

  /* the General chip holds the two multi-group channels and the plain one */
  p.click(p.qsa("[data-group]").find((chip) => chip.dataset.group === "General"));
  await p.wait(40);
  const general = p.qsa("[data-iptv-grid] .chcard").map((card) => card.dataset.channel);
  expect("page: General holds Al Aoula", general.includes("Al Aoula"), general.join(" | "));
  expect("page: General holds Arryadia", general.includes("Arryadia"), general.join(" | "));
  expect("page: News chip name is exact", p.text("[data-iptv-title]") === "General", p.text("[data-iptv-title]"));

  p.click(p.qsa("[data-group]").find((chip) => chip.dataset.group === "News"));
  await p.wait(40);
  const news = p.qsa("[data-iptv-grid] .chcard").map((card) => card.dataset.channel);
  expect("page: News holds the same channel", news.includes("Al Aoula") && news.includes("2M Monde"), news.join(" | "));
  expect("page: News does not hold the sport channel", !news.includes("Arryadia"));

  /* premium tab */
  p.click(p.qsa("[data-list]").find((tab) => tab.dataset.list === "premium"));
  await p.wait(60);
  const premium = p.qsa("[data-iptv-grid] .chcard").map((card) => card.dataset.channel);
  expect("page: premium cards", premium.includes("Cine Premiere") && premium.includes("Sport Ultra"), premium.join(" | "));
  expect("page: premium is locked for a free visitor", p.qsa("[data-iptv-grid] .chcard[data-locked]").length === premium.length);

  /* search */
  const search = p.qs("[data-iptv-search]");
  search.value = "cinema";
  search.dispatchEvent(new p.window.Event("input", { bubbles: true }));
  await p.wait(40);
  expect("page: empty search state", p.qs("[data-iptv-empty]")?.hidden === false);

  p.click(p.qs("[data-iptv-clear]"));
  await p.wait(40);
  expect("page: clear restores the list", p.qsa("[data-iptv-grid] .chcard").length === premium.length);
}

/* deep link */
{
  const p = await boot(3, "?M3U=pr.one");
  expect("deep link: prefilled search", p.qs("[data-iptv-search]")?.value === "pr.one");
  expect("deep link: one result", p.qsa("[data-iptv-grid] .chcard").length === 1, p.text("[data-iptv-meta]"));
}

{
  const p = await boot(4, "?list=premium");
  expect("deep link: premium list", p.qs("[data-list][data-list='premium']")?.classList.contains("is-active"));
}

/* ------------------------------------------------------------------ */
expect("no runtime errors", errors.length === 0, errors.join(" | "));

const failed = checks.filter((check) => !check.ok);
for (const check of checks) {
  console.log(`${check.ok ? "ok  " : "FAIL"}  ${check.name}${check.ok || !check.detail ? "" : `  → ${check.detail}`}`);
}
console.log(`\nchecks: ${checks.length - failed.length}/${checks.length} pass`);
process.exit(failed.length ? 1 : 0);
