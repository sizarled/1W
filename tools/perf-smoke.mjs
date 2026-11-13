/**
 * Performance smoke test — what a page costs before it can be looked at, and
 * what it stops doing once it has been drawn.
 *
 *   node tools/perf-smoke.mjs
 *
 * jsdom draws nothing, so this suite does not pretend to measure paint. It
 * measures the things that decide how fast a page feels and can be counted
 * exactly, on every run:
 *
 *   pass 0 — the graph: the modules a page pulls before its first line of its
 *            own code runs, summed and gzipped (the number a browser fetches)
 *   pass 1 — the head: fonts that do not block the first paint, hints that are
 *            actually usable by the call that follows them
 *   pass 2 — the first frame: a landscape visit to videos.html does not pay for
 *            the portrait controller or for a feed it will not show
 *   pass 3 — the idle: bookkeeping (the visit row) is not on the critical path
 *   pass 4 — the calls: two readers asking the same question cost one round trip
 *   pass 5 — the pool: no sound is downloaded before one is played
 *   pass 6 — the paint: the CSS keeps the rendering budget rules that let a long
 *            grid be drawn only as far as it is looked at
 */
import { JSDOM } from "jsdom";
import { readFileSync, readdirSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const checks = [];
const expect = (name, ok, detail = "") => checks.push({ name, ok: Boolean(ok), detail: String(detail) });
const read = (file) => readFileSync(join(root, file), "utf8");
const strip = (file) => read(file).replace(/<script[^>]*src="[^"]*"[^>]*><\/script>/g, "");
const wait = (ms = 60) => new Promise((r) => setTimeout(r, ms));
const reply = (data, ok = true) =>
  Promise.resolve({ ok, status: ok ? 200 : 400, json: async () => data, text: async () => JSON.stringify(data) });

const files = readdirSync(root).filter((f) => f.endsWith(".html"));
const kb = (bytes) => `${(bytes / 1024).toFixed(1)}K`;

/* ================================================================== */
/* pass 0 — the graph                                                 */
/* ================================================================== */
/* Two different edges: `import … from` is on the critical path (the browser
   must have the module to evaluate the one that asked for it), `import(…)` is
   not (it is a promise the page may never keep). Only the first kind is
   measured here — the second is the whole point of the exercise. */
const STATIC_EDGE = /(?:^|[\s;])(?:import|export)\s+(?:[^"'()]*?\sfrom\s*)?["']([^"']+)["']/g;
const DYNAMIC_EDGE = /import\(\s*["']([^"']+)["']\s*\)/g;

function graph(entries, { dynamic = false } = {}) {
  const seen = new Set();
  const stack = entries.map((e) => join(root, e));
  while (stack.length) {
    const file = stack.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    let src = "";
    try {
      src = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    const edges = dynamic ? [STATIC_EDGE, DYNAMIC_EDGE] : [STATIC_EDGE];
    for (const edge of edges) {
      for (const match of src.matchAll(edge)) {
        const spec = match[1];
        if (!spec || !spec.startsWith(".")) continue;
        stack.push(resolve(dirname(file), spec.split("?")[0]));
      }
    }
  }
  return seen;
}

function weigh(entries, opts) {
  let raw = 0;
  let gzip = 0;
  const modules = graph(entries, opts);
  for (const file of modules) {
    const buf = readFileSync(file);
    raw += buf.length;
    gzip += gzipSync(buf, { level: 9 }).length;
  }
  return { modules: modules.size, raw, gzip };
}

const WALLET = weigh(["assets/js/app.js"]); // every page
const LANDSCAPE = weigh(["assets/js/app.js", "assets/js/videos.js"]); // videos.html, 16:9
const PORTRAIT = weigh(["assets/js/app.js", "assets/js/vertical.js"]); // videos.html#/vertical

console.info(`graph: every page ${kb(WALLET.gzip)} gz · videos 16:9 ${kb(LANDSCAPE.gzip)} gz · videos 9:16 ${kb(PORTRAIT.gzip)} gz`);

/* The numbers below are budgets, not wishes: they sit a little above what the
   page measures today, so a change that adds a heavy static import fails here
   before it reaches a phone on a slow connection. */
expect(`graph: every page stays under 80K gz of JavaScript (${kb(WALLET.gzip)})`, WALLET.gzip < 80 * 1024, WALLET.gzip);
expect(`graph: videos.html 16:9 stays under 122K gz (${kb(LANDSCAPE.gzip)})`, LANDSCAPE.gzip < 122 * 1024, LANDSCAPE.gzip);
expect(`graph: videos.html 9:16 stays under 110K gz (${kb(PORTRAIT.gzip)})`, PORTRAIT.gzip < 110 * 1024, PORTRAIT.gzip);
expect(
  "graph: the portrait controller is a promise, not a dependency",
  !graph(["assets/js/videos.js"]).has(join(root, "assets/js/vertical.js")) &&
    graph(["assets/js/videos.js"], { dynamic: true }).has(join(root, "assets/js/vertical.js")),
  "vertical.js is imported statically"
);
expect(
  "graph: the landscape visit is cheaper than a page that draws both",
  LANDSCAPE.gzip < weigh(["assets/js/app.js", "assets/js/videos.js", "assets/js/vertical.js"]).gzip,
  "no saving"
);

/* ================================================================== */
/* pass 1 — the head                                                  */
/* ================================================================== */
{
  const blockingFont = files.filter((f) => /<link[^>]+fonts\.googleapis\.com[^>]+rel="stylesheet"[^>]*>/.test(read(f)));
  expect("head: no page waits for a font stylesheet to paint", blockingFont.length === 0, blockingFont.join(", "));

  const asyncFont = files.filter((f) => /rel="preload"\s+as="style"[\s\S]{0,220}?onload="this\.onload=null;this\.rel='stylesheet'"/.test(read(f)));
  const fontPages = files.filter((f) => /fonts\.googleapis\.com/.test(read(f)));
  expect("head: every page swaps the font sheet in instead", asyncFont.length >= fontPages.length - 1, `${asyncFont.length}/${fontPages.length}`);

  const noscript = files.filter((f) => /fatface|Instrument\+Serif/.test(read(f)) && /<noscript>[\s\S]*?fonts\.googleapis\.com[\s\S]*?<\/noscript>/.test(read(f)));
  expect("head: and still sets the type with scripts off", noscript.length >= fontPages.length - 1, `${noscript.length}/${fontPages.length}`);

  const lightFont = files.filter((f) => /wght@300;400;500;600;700;800/.test(read(f)));
  expect("head: six static weights are gone", lightFont.length === 0, lightFont.join(", "));
  const variable = files.filter((f) => /Inter:wght@400\.\.800/.test(read(f)));
  expect("head: one variable Inter carries them all", variable.length >= fontPages.length - 1, `${variable.length}/${fontPages.length}`);

  const deadPreconnect = files.filter((f) => /preconnect" href="https:\/\/[a-z0-9]+\.supabase\.co"\s*\/?>/.test(read(f)));
  expect("head: the API socket is opened for a CORS fetch", deadPreconnect.length === 0, deadPreconnect.join(", "));
  const corsPreconnect = files.filter((f) => /preconnect" href="https:\/\/[a-z0-9]+\.supabase\.co" crossorigin/.test(read(f)));
  expect("head: … and it is opened with crossorigin", corsPreconnect.length >= files.length - 2, `${corsPreconnect.length}/${files.length}`);

  const dns = files.filter((f) => /dns-prefetch" href="https:\/\/thumb\.tapecontent\.net"/.test(read(f)));
  expect("head: thumbnails resolve before they are asked for", dns.length >= files.length - 2, `${dns.length}/${files.length}`);
}

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
  globalThis.cancelAnimationFrame = window.cancelAnimationFrame.bind(window);
  const matchMedia = (q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  globalThis.matchMedia = matchMedia;
  window.matchMedia = matchMedia;
  window.HTMLMediaElement.prototype.play = function () {
    return Promise.resolve();
  };
  window.HTMLMediaElement.prototype.pause = function () {};
  Object.defineProperty(globalThis, "navigator", { value: window.navigator, configurable: true });

  const calls = [];
  globalThis.fetch = (input, opts = {}) => {
    const href = String(input);
    calls.push({ href, method: opts.method || "GET" });
    if (fetchImpl) return fetchImpl(href, opts, calls);
    return reply([]);
  };
  return { window, document: window.document, calls, errors };
}

const fnName = (href) => String(href).split("/rpc/")[1]?.split("?")[0] || "";
let pass = 0;
const importPage = async (name) => import(`file://${join(root, `assets/js/${name}.js`)}?p=${++pass}`);

/* ================================================================== */
/* pass 2 — the first frame                                           */
/* ================================================================== */
{
  const rows = [
    { code: "VID-001039", kind: "video", orientation: "h", title: "A wide shot", counters: {}, video: { embed: "https://streamtape.com/e/abc/", meta: {} } },
  ];
  const stub = (href) => {
    const fn = fnName(href);
    if (fn === "video_get") return reply({ ok: true, locked: false, video: rows[0], related: [], more: [] });
    if (fn === "video_feed") return reply({ ok: true, rows, total: 1 });
    if (fn === "video_mine") return reply({ ok: true, rows: [] });
    return reply({ ok: true, rows: [], total: 0 });
  };

  const wide = boot("videos.html", { hash: "#/h/ID=VID-001039", fetchImpl: stub });
  await importPage("videos");
  await wait(160);
  const wideNames = wide.calls.map((c) => fnName(c.href)).filter(Boolean);
  expect("frame: the landscape address never loads the portrait controller", !wide.document.documentElement.dataset.vertView, wide.document.documentElement.dataset.vertView);
  expect(
    "frame: and it does not ask for the same video twice",
    wideNames.filter((n) => n === "video_get").length <= 1,
    wideNames.join(", ")
  );
  /* one `video_feed` is the suggestion rail the stage draws; a second one would
     be the covered grid, fetched to be looked at by nobody */
  expect(
    "frame: a stage address does not fetch the grid it is covering",
    wideNames.filter((n) => n === "video_feed").length === 1,
    wideNames.join(", ")
  );
  expect(
    "frame: the stage, its studio, its suggestions and its comments cost four calls",
    wideNames.length <= 4,
    wideNames.join(", ")
  );

  const shelf = boot("videos.html", { hash: "#/vertical", fetchImpl: stub });
  await importPage("videos");
  await wait(160);
  const shelfNames = shelf.calls.map((c) => fnName(c.href)).filter(Boolean);
  expect("frame: the portrait shelf is up", shelf.document.documentElement.dataset.vertView === "shelf", shelf.document.documentElement.dataset.vertView);
  expect("frame: and the hidden grid never fetched its feed", !shelfNames.includes("video_feed"), shelfNames.join(", "));
}

/* ================================================================== */
/* pass 3 — the idle                                                  */
/* ================================================================== */
{
  const page = boot("index.html");
  const started = [];
  globalThis.fetch = (input, opts = {}) => {
    const href = String(input);
    started.push({ at: Date.now(), fn: fnName(href) });
    return reply({ ok: true, rows: [], total: 0 });
  };

  const t0 = Date.now();
  await import(`file://${join(root, "assets/js/app.js")}?p=idle`);
  const immediately = started.filter((c) => c.fn === "log_visit").length;
  expect("idle: the visit row is not on the critical path", immediately === 0, `${immediately} log_visit at import`);
  expect("idle: the shell is mounted all the same", Boolean(page.document.querySelector(".site-header")), "no header");

  let logged = 0;
  for (let i = 0; i < 20 && !logged; i += 1) {
    await wait(100);
    logged = started.filter((c) => c.fn === "log_visit").length;
  }
  const late = started.find((c) => c.fn === "log_visit");
  expect("idle: … and it lands once the page is up", logged >= 1, "never logged");
  if (late) expect("idle: within two seconds of the import", late.at - t0 < 2600, `${late.at - t0} ms`);
  expect("idle: the page never threw", page.errors.length === 0, page.errors.join(" | "));
}

/* ================================================================== */
/* pass 4 — the calls                                                 */
/* ================================================================== */
{
  boot("index.html");
  const data = await import(`file://${join(root, "assets/js/data.js")}?p=calls`);
  let served = 0;
  globalThis.fetch = () => {
    served += 1;
    return wait(40).then(() => reply({ ok: true, rows: [] }));
  };

  const both = await Promise.all([
    data.rpc("video_feed", { p_sort: "popular", p_limit: 12 }),
    data.rpc("video_feed", { p_sort: "popular", p_limit: 12 }),
  ]);
  expect("calls: two readers, one round trip", served === 1, `${served} requests`);
  expect("calls: and both get the answer", both[0] === both[1] && both[0]?.ok === true, "answers differ");

  await data.rpc("video_feed", { p_sort: "popular", p_limit: 12 });
  expect("calls: a new question is asked again", served === 2, `${served} requests`);

  await Promise.all([
    data.rpc("video_feed", { p_sort: "popular", p_limit: 24 }),
    data.rpc("video_feed", { p_sort: "recent", p_limit: 12 }),
  ]);
  expect("calls: and a different question is a different call", served === 4, `${served} requests`);
}

/* ================================================================== */
/* pass 5 — the pool                                                  */
/* ================================================================== */
{
  const made = [];
  const sources = [];
  globalThis.window = { addEventListener() {} };
  globalThis.document = { hidden: false };
  globalThis.localStorage = { getItem: (key) => (key === "1w.sound" ? "true" : null), setItem() {}, removeItem() {} };
  globalThis.Audio = class {
    constructor(src) {
      made.push(String(src || ""));
      if (src) sources.push(String(src));
      this.volume = 1;
    }
    set src(value) {
      this._src = value;
      sources.push(String(value));
    }
    get src() {
      return this._src || "";
    }
    play() {
      return Promise.resolve();
    }
    pause() {}
  };
  const sounds = await import(`file://${join(root, "assets/js/sound.js")}?p=pool`);
  expect("pool: nothing is built before a sound is played", made.length === 0, made.join(", "));
  sounds.playSound("success", 0.4);
  expect("pool: the first sound builds one player", made.length === 1, `${made.length} players`);
  expect("pool: and it fetches the sound's own file", /\.(mp3|wav|ogg)(\?|$)/.test(sources[0] || ""), sources.join(", "));
  sounds.playSound("success", 0.4);
  expect("pool: the second play reuses it", made.length === 1, `${made.length} players`);

  const source = read("assets/js/sound.js");
  expect("pool: the gesture spends one silent note, not seven files", /data:audio\/wav;base64/.test(source) && !/Object\.keys\(SOUNDS\)\.forEach/.test(source), "eager unlock still present");
}

/* ================================================================== */
/* pass 6 — the paint                                                 */
/* ================================================================== */
{
  const css = read("assets/css/components.css");
  expect("paint: a long grid is drawn only as far as it is looked at", /content-visibility:\s*auto/.test(css) && /\.vgrid\s*>\s*\*/.test(css), "no rule for the grid");
  expect("paint: and the reserve keeps the scrollbar honest", /contain-intrinsic-size:\s*auto\s+\d+px/.test(css), "no intrinsic size");
  expect(
    "paint: the blurred header steps off the phone",
    /@media[^{]*max-width:\s*780px[\s\S]{0,400}?backdrop-filter:\s*none/.test(css),
    "no mobile rule"
  );
  const shell = read("assets/js/shell.js");
  expect("paint: the scroll listener writes only when the answer changes", /if\s*\(next === stuck\)\s*return;/.test(shell), "writes every frame");
}

/* ================================================================== */
/* report                                                             */
/* ================================================================== */
const failed = checks.filter((c) => !c.ok);
for (const check of checks) {
  if (check.ok) continue;
  console.log(`FAIL  ${check.name}  ${check.detail}`);
}
console.log(`\nperf smoke: ${checks.length - failed.length}/${checks.length} pass`);
/* the homepage keeps timers of its own alive (the hero rotates); the report is
   written, so the process stops here rather than waiting for them */
process.exit(failed.length ? 1 : 0);
