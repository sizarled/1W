/**
 * Media pages smoke test — the address book, and the two pages that read it.
 *
 *   node tools/media-smoke.mjs
 *
 * Pass 0 — the grammar: the four shapes media.js writes, and the six it reads.
 * Pass 1 — videos.html: `#/h/ID=…` is a landscape stage, `#/v/ID=…` a
 *          portrait one, and the legacy `#/v/<code>` still opens a video.
 * Pass 2 — audio.html: a podcast, a song, the queue, the byline that carries
 *          `?studio=&creator=`, a locked item, and an id that is not there.
 * Pass 3 — playlist.html: the three shelves, the address that picks one, and
 *          the row links that carry each item's own shape.
 * Pass 4 — the words: every class the two pages dress in is defined.
 */
import { JSDOM } from "jsdom";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const checks = [];
const expect = (name, ok, detail = "") => checks.push({ name, ok: Boolean(ok), detail: String(detail) });
const read = (file) => readFileSync(join(root, file), "utf8");
const strip = (file) => read(file).replace(/<script[^>]*src="[^"]*"[^>]*><\/script>/g, "");
const wait = (ms = 60) => new Promise((r) => setTimeout(r, ms));

const reply = (data, ok = true) =>
  Promise.resolve({ ok, status: ok ? 200 : 400, json: async () => data, text: async () => JSON.stringify(data) });

/* ================================================================== */
/* pass 0 — the grammar                                               */
/* ================================================================== */
const media = await import(`file://${join(root, "assets/js/media.js")}?p=0`);

expect("grammar: a horizontal video", media.videoUrl("video001032", "h") === "videos.html#/h/ID=video001032", media.videoUrl("video001032", "h"));
expect("grammar: a vertical one", media.videoUrl("video001032", "v") === "videos.html#/v/ID=video001032", media.videoUrl("video001032", "v"));
expect("grammar: vertical is what 'vertical' means", media.videoUrl("x", "portrait") === "videos.html#/v/ID=x", media.videoUrl("x", "portrait"));
expect("grammar: a podcast", media.audioUrl("podcast001032", "p") === "audio.html#/p/ID=podcast001032", media.audioUrl("podcast001032", "p"));
expect("grammar: a song", media.audioUrl("song001032", "m") === "audio.html#/m/ID=song001032", media.audioUrl("song001032", "m"));
expect("grammar: a song by name", media.audioUrl("song001032", "song") === "audio.html#/m/ID=song001032", media.audioUrl("song001032", "song"));
expect(
  "grammar: the three shelves",
  media.playlistUrl("playlist001032", "videos") === "playlist.html#/videos/ID=playlist001032" &&
    media.playlistUrl("playlist001032", "podcasts") === "playlist.html#/podcasts/ID=playlist001032" &&
    media.playlistUrl("playlist001032", "songs") === "playlist.html#/songs/ID=playlist001032",
  [media.playlistUrl("p1", "videos"), media.playlistUrl("p1", "podcasts"), media.playlistUrl("p1", "songs")].join(" ")
);
expect(
  "grammar: the studio carries both ids",
  media.creatorUrl("IDST100001", "ID100019") === "creator.html?studio=IDST100001&creator=ID100019",
  media.creatorUrl("IDST100001", "ID100019")
);
expect("grammar: a studio alone is enough", media.creatorUrl("IDST100001") === "creator.html?studio=IDST100001", media.creatorUrl("IDST100001"));
expect("grammar: so is a creator alone", media.creatorUrl("", "ID100019") === "creator.html?creator=ID100019", media.creatorUrl("", "ID100019"));
expect("grammar: no ids, no query", media.creatorUrl() === "creator.html", media.creatorUrl());

const ROUTES = [
  ["#/h/ID=video001032", { surface: "videos", orientation: "h", id: "video001032" }],
  ["#/v/ID=video001032", { surface: "videos", orientation: "v", id: "video001032" }],
  ["#/p/ID=podcast001032", { surface: "audio", kind: "podcast", id: "podcast001032", key: "p" }],
  ["#/m/ID=song001032", { surface: "audio", kind: "song", id: "song001032", key: "m" }],
  ["#/videos/ID=playlist001032", { surface: "playlist", shelf: "videos", kind: "video", id: "playlist001032" }],
  ["#/podcasts/ID=playlist001032", { surface: "playlist", shelf: "podcasts", kind: "podcast", id: "playlist001032" }],
  ["#/songs/ID=playlist001032", { surface: "playlist", shelf: "songs", kind: "song", id: "playlist001032" }],
];
ROUTES.forEach(([hash, want]) => {
  const got = media.parseRoute(hash);
  const ok = Object.entries(want).every(([key, value]) => got[key] === value) && !got.empty;
  expect(`grammar: ${hash} reads back`, ok, JSON.stringify(got));
});

const legacy = media.parseRoute("#/v/CA4728CD");
expect("grammar: the older #/v/<code> is still a video", legacy.surface === "videos" && legacy.id === "CA4728CD" && legacy.orientation === "h", JSON.stringify(legacy));
const bare = media.parseRoute("#/video001032");
expect("grammar: a bare id opens the video page", bare.surface === "videos" && bare.id === "video001032", JSON.stringify(bare));
expect("grammar: nothing is nothing", media.parseRoute("").empty === true && media.parseRoute("#").empty === true);

const params = media.readParams("?studio=IDST100001&creator=ID100019");
expect("grammar: the two ids are read", params.studio === "IDST100001" && params.creator === "ID100019" && params.hasStudio && params.hasCreator, JSON.stringify(params));
expect("grammar: a missing creator is empty, not undefined", media.readParams("?studio=IDST100001").creator === "");

expect("grammar: a video row knows its page", media.mediaUrl({ code: "v1", kind: "video", orientation: "v" }) === "videos.html#/v/ID=v1", media.mediaUrl({ code: "v1", kind: "video", orientation: "v" }));
expect("grammar: a podcast row too", media.mediaUrl({ code: "p1", kind: "podcast" }) === "audio.html#/p/ID=p1", media.mediaUrl({ code: "p1", kind: "podcast" }));
expect("grammar: and a song", media.mediaUrl({ code: "s1", kind: "song" }) === "audio.html#/m/ID=s1", media.mediaUrl({ code: "s1", kind: "song" }));
expect("grammar: a playlist row keeps its shelf", media.mediaUrl({ code: "l1", kind: "playlist", shelf: "songs" }) === "playlist.html#/songs/ID=l1", media.mediaUrl({ code: "l1", kind: "playlist", shelf: "songs" }));
expect("grammar: an article keeps its own page", media.mediaUrl({ code: "a1", kind: "article" }) === "article.html?id=a1", media.mediaUrl({ code: "a1", kind: "article" }));

/* ================================================================== */
/* the harness                                                        */
/* ================================================================== */
function boot(file, { hash = "", search = "", fetchImpl } = {}) {
  const dom = new JSDOM(strip(file), { url: `http://localhost/${file}${search}${hash}`, pretendToBeVisual: true });
  const { window } = dom;
  window.scrollTo = () => {};
  window.HTMLElement.prototype.scrollIntoView = () => {};
  const errors = [];
  window.addEventListener("error", (e) => errors.push(String(e.error || e.message)));
  window.addEventListener("unhandledrejection", (e) => errors.push(String(e.reason)));

  globalThis.window = window;
  globalThis.document = window.document;
  globalThis.location = window.location;
  globalThis.history = window.history;
  globalThis.HTMLElement = window.HTMLElement;
  globalThis.Element = window.Element;
  globalThis.Node = window.Node;
  globalThis.Event = window.Event;
  globalThis.CustomEvent = window.CustomEvent;
  globalThis.MouseEvent = window.MouseEvent;
  globalThis.KeyboardEvent = window.KeyboardEvent;
  globalThis.DOMParser = window.DOMParser;
  globalThis.localStorage = window.localStorage;
  globalThis.sessionStorage = window.sessionStorage;
  globalThis.AbortController = window.AbortController || AbortController;
  globalThis.getComputedStyle = window.getComputedStyle.bind(window);
  globalThis.requestAnimationFrame = window.requestAnimationFrame.bind(window);
  globalThis.matchMedia = (q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  Object.defineProperty(globalThis, "navigator", { value: window.navigator, configurable: true });

  const calls = [];
  globalThis.fetch = (input, opts = {}) => {
    const href = String(input);
    let body = null;
    try {
      body = opts.body ? JSON.parse(opts.body) : null;
    } catch {
      body = opts.body || null;
    }
    calls.push({ href, body, method: opts.method || "GET" });
    if (fetchImpl) return fetchImpl(href, opts, calls);
    return reply([]);
  };
  return { window, document: window.document, calls, errors };
}

const fnName = (href) => String(href).split("/rpc/")[1] || "";
const qs = (doc, sel) => doc.querySelector(sel);
const text = (doc, sel) => qs(doc, sel)?.textContent || "";
let pass = 0;
const importPage = async (name) => import(`file://${join(root, `assets/js/${name}.js`)}?p=${++pass}`);

/* fixtures */
const HUB = { id: "h1", code: "IDST100001", name: "Studio One", kind: "channel", owner: "ID100019" };
const audioItem = (over = {}) => ({
  id: "aaaa",
  code: "podcast001032",
  kind: "podcast",
  title: "The third act",
  summary: "A talk about endings.",
  media_url: "https://example.com/ep1.mp3",
  cover: "https://example.com/cover.jpg",
  minutes: 42,
  visibility: "public",
  creator: "ledsizar7",
  creator_id: "ID100019",
  locked: false,
  ...over,
});
const queue = [
  { code: "podcast001033", kind: "podcast", title: "The second act", minutes: 38 },
  { code: "podcast001034", kind: "podcast", title: "The first act", minutes: 51 },
];

/* ================================================================== */
/* pass 1 — videos.html                                               */
/* ================================================================== */
{
  const video = { code: "video001032", kind: "video", title: "A wide shot", media_url: "https://example.com/v.mp4", visibility: "public", counters: {} };
  const stub = (href) => {
    const fn = fnName(href);
    if (fn === "video_get") return reply({ ok: true, locked: false, video, related: [], more: [] });
    return reply({ ok: true, rows: [], total: 0, fields: [] });
  };

  const wide = boot("videos.html", { hash: "#/h/ID=video001032", fetchImpl: stub });
  await importPage("videos");
  await wait(150);
  const wideCall = wide.calls.find((c) => fnName(c.href) === "video_get");
  expect("videos: #/h/ asks for the video by its code", wideCall?.body?.p_ref === "video001032", JSON.stringify(wideCall?.body));
  expect("videos: the watch screen is up", qs(wide.document, "[data-v-watch]")?.hidden === false);
  expect("videos: and the stage is landscape", qs(wide.document, "[data-v-watch] [data-orientation]")?.getAttribute("data-orientation") === "h", qs(wide.document, "[data-v-watch] [data-orientation]")?.getAttribute("data-orientation"));

  const tall = boot("videos.html", { hash: "#/v/ID=video001032", fetchImpl: stub });
  await importPage("videos");
  await wait(150);
  /* `#/v/` is the vertical format's address now: it lives on the videos page
     too, but `videos.js` steps aside and leaves the screen to it — so the
     landscape stage and the landscape grid are out of the way */
  expect("videos: #/v/ leaves the portrait stage to the vertical format", !qs(tall.document, "[data-v-watch] .vwatch"), "the videos stage drew it");
  expect("videos: and the grid steps aside", qs(tall.document, "[data-v-browse]")?.hidden === true);
  expect("videos: this format does not spend the tall one's call", !tall.calls.find((c) => fnName(c.href) === "video_get"), "video_get was spent");

  const old = boot("videos.html", { hash: "#/v/CA4728CD", fetchImpl: stub });
  await importPage("videos");
  await wait(150);
  expect("videos: the older address still lands", old.calls.find((c) => fnName(c.href) === "video_get")?.body?.p_ref === "CA4728CD", JSON.stringify(old.calls.find((c) => fnName(c.href) === "video_get")?.body));
  expect("videos: and it is landscape", qs(old.document, "[data-v-watch] [data-orientation]")?.getAttribute("data-orientation") === "h");
}

/* ================================================================== */
/* pass 2 — audio.html                                                */
/* ================================================================== */
{
  const stub = (href) => {
    const fn = fnName(href);
    if (fn === "audio_get") return reply({ ok: true, locked: false, item: audioItem(), queue, hub: HUB });
    return reply({ ok: true, rows: [] });
  };

  const podcast = boot("audio.html", { hash: "#/p/ID=podcast001032", fetchImpl: stub });
  await importPage("audio");
  await wait(140);
  const call = podcast.calls.find((c) => fnName(c.href) === "audio_get");
  expect("audio: #/p/ asks for a podcast", call?.body?.p_ref === "podcast001032" && call?.body?.p_kind === "podcast", JSON.stringify(call?.body));
  expect("audio: the title is up", /The third act/.test(text(podcast.document, "[data-a-title]")), text(podcast.document, "[data-a-title]"));
  expect("audio: the kind is named", /Podcast/i.test(text(podcast.document, ".aud__kind")), text(podcast.document, ".aud__kind"));
  expect("audio: the player has a source", qs(podcast.document, "[data-a-media]")?.getAttribute("src") === "https://example.com/ep1.mp3");
  expect("audio: the queue is drawn", podcast.document.querySelectorAll("[data-a-open]").length === 2, podcast.document.querySelectorAll("[data-a-open]").length);
  expect("audio: a queue row links to its own address", qs(podcast.document, "[data-a-open]")?.getAttribute("href") === "audio.html#/p/ID=podcast001033", qs(podcast.document, "[data-a-open]")?.getAttribute("href"));
  expect("audio: the byline carries both ids", /creator\.html\?studio=IDST100001&(amp;)?creator=ID100019/.test(qs(podcast.document, ".aud__byline a")?.getAttribute("href") || ""), qs(podcast.document, ".aud__byline a")?.getAttribute("href"));
  expect("audio: the transport is there", Boolean(qs(podcast.document, "[data-a-play]")) && Boolean(qs(podcast.document, "[data-a-seek]")));
  expect("audio: the page title follows the item", /The third act/.test(podcast.window.document.title), podcast.window.document.title);

  const song = boot("audio.html", {
    hash: "#/m/ID=song001032",
    fetchImpl: (href) => (fnName(href) === "audio_get" ? reply({ ok: true, locked: false, item: audioItem({ code: "song001032", kind: "song", title: "Night bus" }), queue: [], hub: HUB }) : reply({ ok: true })),
  });
  await importPage("audio");
  await wait(140);
  expect("audio: #/m/ asks for a song", song.calls.find((c) => fnName(c.href) === "audio_get")?.body?.p_kind === "song");
  expect("audio: the song is named as music", /Music/i.test(text(song.document, ".aud__kind")), text(song.document, ".aud__kind"));
  expect("audio: a song with no queue draws no queue", song.document.querySelectorAll(".audq").length === 0);

  const locked = boot("audio.html", {
    hash: "#/p/ID=podcast001032",
    fetchImpl: () => reply({ ok: true, locked: true, item: { code: "podcast001032", kind: "podcast", title: "The third act", locked: true }, gate_note: "This one is for the hub's subscribers.", hub: HUB }),
  });
  await importPage("audio");
  await wait(140);
  expect("audio: a locked item keeps its name", /The third act/.test(text(locked.document, "[data-a-title]")), text(locked.document, "[data-a-title]"));
  expect("audio: and shows the gate, not a player", Boolean(qs(locked.document, ".aud__gate")) && !qs(locked.document, "[data-a-media]"));
  expect("audio: the gate says why", /subscribers/.test(text(locked.document, ".aud__gate")), text(locked.document, ".aud__gate"));

  const gone = boot("audio.html", { hash: "#/p/ID=nope", fetchImpl: () => reply({ ok: false, error: "not_found" }) });
  await importPage("audio");
  await wait(140);
  expect("audio: an unknown id says so", /gone/i.test(text(gone.document, ".aud__empty-title")), text(gone.document, ".aud__empty-title"));

  const empty = boot("audio.html", { fetchImpl: () => reply({ ok: true }) });
  await importPage("audio");
  await wait(80);
  expect("audio: no address, no call", !empty.calls.some((c) => fnName(c.href) === "audio_get"), empty.calls.length);
  expect("audio: and the page explains the address", /audio\.html#\/p\//.test(text(empty.document, "[data-a-root]")), text(empty.document, "[data-a-root]").slice(0, 90));
}

/* ================================================================== */
/* the gate: a new podcast asks first                                 */
/* ================================================================== */
{
  /* audio.js imports `./gates.js` bare, so this is the same instance */
  const gates = await import(`file://${join(root, "assets/js/gates.js")}`);
  gates.forgetGates();
  gates.RULES.audio.seconds = 1;

  const page = boot("audio.html", {
    hash: "#/p/ID=podcast001032",
    fetchImpl: (href) => {
      const fn = fnName(href);
      if (fn === "audio_get") return reply({ ok: true, locked: false, item: audioItem(), queue, hub: HUB });
      return reply({ ok: true, rows: [] });
    },
  });
  await importPage("audio");
  await wait(140);

  page.document.querySelector("[data-a-play]").dispatchEvent(new page.window.MouseEvent("click", { bubbles: true }));
  await wait(30);
  const gate = page.document.querySelector("[data-a-card] [data-v-ad]");
  expect("gate: pressing play on a new podcast is a gate, not a play", Boolean(gate));
  expect("gate: the count is the kind's own", gate?.querySelector("[data-v-ad-dial]")?.textContent === "1", gate?.querySelector("[data-v-ad-dial]")?.textContent || "");
  expect("gate: the gate names a podcast or song", /podcast or song/i.test(gate?.querySelector(".vad__tag")?.textContent || ""), gate?.querySelector(".vad__tag")?.textContent || "");

  page.window.open = () => ({ closed: false });
  gate.querySelector("[data-v-ad-open]").click();
  await wait(1300);
  expect("gate: the count opens the player", !page.document.querySelector("[data-a-card] [data-v-ad]"));
  expect("gate: the item is remembered", gates.hasSeen("audio", "podcast001032") === true);
  expect("gate: nothing threw", page.errors.length === 0, page.errors.join(" | "));
  gates.RULES.audio.seconds = 10;
}

/* ================================================================== */
/* pass 3 — playlist.html                                             */
/* ================================================================== */
{
  const rows = [
    { code: "song001032", kind: "song", title: "Night bus", minutes: 4 },
    { code: "song001033", kind: "song", title: "Cold morning", minutes: 5 },
  ];
  const stub = (href) => {
    const fn = fnName(href);
    if (fn === "playlist_get")
      return reply({ ok: true, playlist: { id: "l1", code: "playlist001032", title: "Winter", summary: "Five songs.", creator: "ledsizar7", creator_id: "ID100019", hub: HUB }, rows });
    return reply({ ok: true, rows: [] });
  };

  const songs = boot("playlist.html", { hash: "#/songs/ID=playlist001032", fetchImpl: stub });
  await importPage("media-playlist");
  await wait(140);
  const call = songs.calls.find((c) => fnName(c.href) === "playlist_get");
  expect("playlist: #/songs/ asks for the songs shelf", call?.body?.p_shelf === "songs" && call?.body?.p_ref === "playlist001032", JSON.stringify(call?.body));
  expect("playlist: the title is up", /Winter/.test(text(songs.document, "[data-p-title]")), text(songs.document, "[data-p-title]"));
  expect("playlist: the songs shelf is the one lit", qs(songs.document, ".plq__shelf.is-on")?.getAttribute("data-p-shelf") === "songs", qs(songs.document, ".plq__shelf.is-on")?.getAttribute("data-p-shelf"));
  expect("playlist: a song row opens the audio page", qs(songs.document, "[data-p-open]")?.getAttribute("href") === "audio.html#/m/ID=song001032", qs(songs.document, "[data-p-open]")?.getAttribute("href"));
  expect("playlist: every shelf keeps the playlist's id", [...songs.document.querySelectorAll("[data-p-shelf]")].every((a) => /ID=playlist001032$/.test(a.getAttribute("href") || "")));
  expect("playlist: the byline carries both ids", /creator\.html\?studio=IDST100001&(amp;)?creator=ID100019/.test(qs(songs.document, ".aud__byline a")?.getAttribute("href") || ""), qs(songs.document, ".aud__byline a")?.getAttribute("href"));

  const videos = boot("playlist.html", {
    hash: "#/videos/ID=playlist001032",
    fetchImpl: (href) =>
      fnName(href) === "playlist_get"
        ? reply({
            ok: true,
            playlist: { id: "l2", code: "playlist001032", title: "Cuts" },
            rows: [
              { code: "video001032", kind: "video", title: "Wide", minutes: 12, orientation: "h" },
              { code: "video001033", kind: "video", title: "Tall", minutes: 1, orientation: "v" },
            ],
          })
        : reply({ ok: true }),
  });
  await importPage("media-playlist");
  await wait(140);
  const links = [...videos.document.querySelectorAll("[data-p-open]")].map((a) => a.getAttribute("href"));
  expect("playlist: a landscape video row keeps 16:9", links[0] === "videos.html#/h/ID=video001032", links[0]);
  expect("playlist: a vertical one keeps 9:16", links[1] === "videos.html#/v/ID=video001033", links[1]);
  expect("playlist: the shape is written on the row", [...videos.document.querySelectorAll("[data-shape]")].map((s) => s.getAttribute("data-shape")).join(",") === "h,v");

  const emptyShelf = boot("playlist.html", {
    hash: "#/podcasts/ID=playlist001032",
    fetchImpl: () =>
      reply({ ok: true, playlist: { id: "l3", code: "playlist001032", title: "Cuts" }, rows: [] }),
  });
  await importPage("media-playlist");
  await wait(120);
  expect("playlist: an empty shelf says so", Boolean(qs(emptyShelf.document, ".plq__none")) && /Nothing on the podcasts shelf/.test(text(emptyShelf.document, ".plq__none")), text(emptyShelf.document, ".plq__none"));

  const gone = boot("playlist.html", { hash: "#/videos/ID=nope", fetchImpl: () => reply({ ok: false, error: "not_found" }) });
  await importPage("media-playlist");
  await wait(120);
  expect("playlist: an unknown id says so", /gone/i.test(text(gone.document, ".aud__empty-title")), text(gone.document, ".aud__empty-title"));
}

/* ================================================================== */
/* pass 4 — the clothes                                               */
/* ================================================================== */
{
  const mediaCss = read("assets/css/media.css");
  const classes = ["aud", "aud__card", "aud__cover", "aud__deck", "aud__transport", "aud__btn--play", "aud__timeline", "aud__range", "aud__gate", "audq", "audq__row", "plq__hero", "plq__shelves", "plq__shelf", "plq__row", "plq__thumb", "plq__shape", "plq__none", "aud__empty"];
  classes.forEach((name) => expect(`clothes: .${name} is defined`, mediaCss.includes(`.${name}`), name));
  expect("clothes: the pages load it", /media\.css/.test(read("audio.html")) && /media\.css/.test(read("playlist.html")));
  expect("clothes: no colour is invented", !/#[0-9a-f]{3,8}\b/i.test(mediaCss.replace(/rgba?\([^)]*\)/g, "")), mediaCss.match(/#[0-9a-f]{3,8}/gi)?.join(","));
  expect("clothes: the balance holds", (mediaCss.match(/{/g) || []).length === (mediaCss.match(/}/g) || []).length, `${(mediaCss.match(/{/g) || []).length}/${(mediaCss.match(/}/g) || []).length}`);
  expect("clothes: the video page got the portrait rule", /data-orientation="v"/.test(read("assets/css/video.css")) && /9 \/ 16/.test(read("assets/css/video.css")));
  expect("clothes: the audio page is a real page", /data-a-root/.test(read("audio.html")) && /data-page="audio"/.test(read("audio.html")));
  expect("clothes: so is the playlist page", /data-p-root/.test(read("playlist.html")) && !/Page in build/.test(read("playlist.html")));
}

/* ------------------------------------------------------------------ */
const failed = checks.filter((c) => !c.ok);
checks.forEach((c) => {
  if (!c.ok) console.log(`FAIL  ${c.name}${c.detail ? ` — ${c.detail}` : ""}`);
});
console.log(`\nchecks: ${checks.length - failed.length}/${checks.length} pass`);
if (failed.length) process.exit(1);
