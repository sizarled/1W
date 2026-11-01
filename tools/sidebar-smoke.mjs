/**
 * Sidebar rail smoke test (jsdom, no network).
 *
 *   node tools/sidebar-smoke.mjs
 *
 * The panel is pinned or it waits on the screen edge:
 *
 *   1. watch.html on a desktop — unpinned by default, the pointer at the left
 *      edge slides it in, moving away slides it out, the tab toggles it and
 *      Escape closes a floating panel.
 *   2. the pin — it persists in `1w.sidebar.pin`, keeps the panel out, and
 *      survives a pointer far from the edge and an Escape press.
 *   3. profile.html keeps its own menu, pinned by default, and unpinning it puts
 *      that menu on the edge; the same preference is read back on the player
 *      and on the homepage.
 *   4. dashboard.html — its own menu follows the same preference: unpinned it
 *      leaves the grid and floats back over the content.
 *   5. the stylesheets — the floating panel never takes room from the page.
 */
import { JSDOM } from "jsdom";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const baseCss = readFileSync(join(root, "assets/css/base.css"), "utf8");
const layoutCss = readFileSync(join(root, "assets/css/layout.css"), "utf8");
const dashCss = readFileSync(join(root, "assets/css/dashboard.css"), "utf8");

const checks = [];
const expect = (name, ok, detail = "") => checks.push({ name, ok: Boolean(ok), detail });

const page = (file) =>
  readFileSync(join(root, file), "utf8").replace(/<script[^>]*src="[^"]*"[^>]*><\/script>/g, "");

const reply = (data) =>
  Promise.resolve({ ok: true, status: 200, json: async () => data, text: async () => JSON.stringify(data) });

const MEMBER = {
  id: "5d9e05a4-be29-4832-9a8c-03d595f4f50b",
  member_id: "ID100042",
  member_code: "000042",
  username: "@youssef.amrani",
  full_name: "Youssef El Amrani",
  email: "youssef@example.com",
  avatar_url: "",
  level: 0,
  level_unlocked: 0,
  points: 0,
  membership: "free",
  status: "active",
  account_status: "active",
  account_activated_at: "2026-10-21T10:00:00Z",
  created_at: "2026-10-20T20:00:00Z",
};

function dashboardPayload() {
  return {
    ok: true,
    member_id: MEMBER.member_id,
    member: MEMBER,
    restricted: false,
    ban: { reason: null, at: null, by: null, permanent: false },
    overview: {
      points_total: 0,
      points_available: 0,
      codes_active: 0,
      watch_minutes: 0,
      joined_at: MEMBER.created_at,
    },
    notifications: [],
    codes: [],
    devices: [],
    settings: [],
    court: { active: null, history: [] },
    prizes: [],
    points_ledger: [],
    history: [],
  };
}

async function boot(file, { desktop = true, stored = {}, dashboard = false } = {}) {
  const [name, query] = [file.split("?")[0], file.includes("?") ? `?${file.split("?")[1]}` : ""];
  const dom = new JSDOM(page(name), { url: `http://localhost/${name}${query}`, pretendToBeVisual: true });
  const { window } = dom;
  const errors = [];
  window.addEventListener("error", (e) => errors.push(String(e.error || e.message)));
  window.addEventListener("unhandledrejection", (e) => errors.push(String(e.reason)));

  for (const sheet of [baseCss, layoutCss]) {
    const style = window.document.createElement("style");
    style.textContent = sheet;
    window.document.head.appendChild(style);
  }

  globalThis.window = window;
  globalThis.document = window.document;
  globalThis.HTMLElement = window.HTMLElement;
  globalThis.Element = window.Element;
  globalThis.Node = window.Node;
  globalThis.Event = window.Event;
  globalThis.CustomEvent = window.CustomEvent;
  globalThis.AbortController = window.AbortController || AbortController;
  globalThis.FormData = window.FormData;
  globalThis.localStorage = window.localStorage;
  globalThis.sessionStorage = window.sessionStorage;
  globalThis.getComputedStyle = window.getComputedStyle.bind(window);
  globalThis.requestAnimationFrame = window.requestAnimationFrame.bind(window);
  globalThis.cancelAnimationFrame = window.cancelAnimationFrame.bind(window);

  const mm = (query) => ({
    matches: desktop && /min-width:\s*1024px/.test(query),
    media: query,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
  });
  globalThis.matchMedia = mm;
  window.matchMedia = mm;
  globalThis.Audio = window.Audio = class {
    constructor() {
      this.volume = 1;
    }
    play() {
      return Promise.resolve();
    }
    pause() {}
    addEventListener() {}
  };
  Object.defineProperty(globalThis, "navigator", { value: window.navigator, configurable: true });
  globalThis.location = window.location;
  globalThis.fetch = dashboard ? (url) => reply(dashboardPayload()) : () => reply({ ok: true });
  window.fetch = globalThis.fetch;
  window.scrollTo = () => {};

  window.localStorage.clear();
  for (const [key, value] of Object.entries(stored)) window.localStorage.setItem(key, JSON.stringify(value));
  // a saved pin is only trusted with the current version stamp (edge.js)
  if ("1w.sidebar.pin" in stored) window.localStorage.setItem("1w.sidebar.pin.v", JSON.stringify("2"));
  // a legacy `1w.sidebar` must never decide the pin
  if ("1w.sidebar" in stored && !("1w.sidebar.pin" in stored)) window.localStorage.setItem("1w.sidebar.pin.v", JSON.stringify("2"));
  if (dashboard) window.localStorage.setItem("1w.session", "b".repeat(64));

  const entry = dashboard ? "assets/js/dashboard.js" : "assets/js/shell.js";
  const mod = await import(`file://${join(root, entry)}?page=${name}&v=${Math.random()}`);
  if (dashboard) await new Promise((resolve) => setTimeout(resolve, 220));
  else mod.mountShell();

  // the profile owns its menu: profile.js wires that rail, not the shell
  if (name === "profile.html") {
    await import(`file://${join(root, "assets/js/profile.js")}?page=${name}&v=${Math.random()}`);
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  await new Promise((resolve) => setTimeout(resolve, 120));

  const qs = (sel) => window.document.querySelector(sel);
  const qsa = (sel) => [...window.document.querySelectorAll(sel)];
  const click = (el) => el && el.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
  const move = (clientX, clientY = 400) =>
    window.document.dispatchEvent(new window.MouseEvent("mousemove", { bubbles: true, clientX, clientY }));
  const key = (k) => window.document.dispatchEvent(new window.KeyboardEvent("keydown", { key: k, bubbles: true }));
  const wait = (ms = 120) => new Promise((resolve) => setTimeout(resolve, ms));
  const stored_ = (k) => window.localStorage.getItem(k);

  return { window, document: window.document, body: window.document.body, qs, qsa, click, move, key, wait, stored: stored_, errors };
}

/* ------------------------------------------------------------------ */
/* 1 — the edge brings the panel in                                    */
/* ------------------------------------------------------------------ */
{
  const p = await boot("watch.html");

  expect("watch: the panel is mounted", Boolean(p.qs(".sidebar#siteSidebar")));
  expect("watch: it starts on the edge", !p.body.classList.contains("sb-open"));
  expect("watch: the page says the menu is a rail", p.body.classList.contains("sb-rail"));
  expect("watch: it is not pinned", !p.body.classList.contains("sb-pinned"));
  expect("watch: the panel is hidden from assistive tech", p.qs(".sidebar")?.getAttribute("aria-hidden") === "true");
  expect(
    "watch: the stylesheet actually hides it",
    p.window.getComputedStyle(p.qs(".sidebar")).visibility === "hidden",
    p.window.getComputedStyle(p.qs(".sidebar")).visibility
  );

  p.move(2);
  await p.wait(40);
  expect("watch: the pointer at the edge slides it in", p.body.classList.contains("sb-open"));
  expect("watch: the panel is marked open", p.qs(".sidebar")?.classList.contains("is-open") === true);
  expect("watch: it is announced again", p.qs(".sidebar")?.getAttribute("aria-hidden") === "false");
  expect(
    "watch: the stylesheet shows it at the edge",
    p.window.getComputedStyle(p.qs(".sidebar")).visibility === "visible",
    p.window.getComputedStyle(p.qs(".sidebar")).visibility
  );
  expect(
    "watch: it sits under the header, not over it",
    p.window.getComputedStyle(p.qs(".sidebar")).top === p.window.getComputedStyle(p.qs(".site-header")).height,
    `${p.window.getComputedStyle(p.qs(".sidebar")).top} vs ${p.window.getComputedStyle(p.qs(".site-header")).height}`
  );

  p.move(900);
  await p.wait(500);
  expect("watch: leaving it slides it out", !p.body.classList.contains("sb-open"));

  p.move(20);
  await p.wait(40);
  expect("watch: the edge zone is a band, not a line", p.body.classList.contains("sb-open"));

  p.move(400);
  await p.wait(500);
  expect("watch: the middle of the page closes it again", !p.body.classList.contains("sb-open"));

  p.click(p.qs("[data-sidebar-edge]"));
  await p.wait(40);
  expect("watch: the edge tab opens it without a mouse move", p.body.classList.contains("sb-open"));
  expect("watch: the tab reports the state", p.qs("[data-sidebar-edge]")?.getAttribute("aria-expanded") === "true");

  p.key("Escape");
  await p.wait(40);
  expect("watch: Escape closes a floating panel", !p.body.classList.contains("sb-open"));
  expect("watch: no page errors", p.errors.length === 0, p.errors.join(" | "));
}

/* ------------------------------------------------------------------ */
/* 2 — the pin keeps it out                                            */
/* ------------------------------------------------------------------ */
{
  const p = await boot("watch.html");
  const pin = p.qs("[data-sidebar-pin]");

  expect("pin: the control is in the panel", Boolean(pin));
  expect("pin: it starts unpressed", pin?.getAttribute("aria-pressed") === "false");

  p.click(pin);
  await p.wait(40);
  expect("pin: the panel stays out", p.body.classList.contains("sb-open"));
  expect("pin: the page marks it pinned", p.body.classList.contains("sb-pinned"));
  expect("pin: the rail marker is gone", !p.body.classList.contains("sb-rail"));
  expect("pin: the control is pressed", p.qs("[data-sidebar-pin]")?.getAttribute("aria-pressed") === "true");
  expect("pin: the choice is remembered", p.stored("1w.sidebar.pin") === '"1"');
  expect("pin: the label follows", /Pinned/.test(p.qs("[data-sidebar-pin]")?.textContent || ""), p.qs("[data-sidebar-pin]")?.textContent);

  p.move(900);
  await p.wait(500);
  expect("pin: a pointer far from the edge changes nothing", p.body.classList.contains("sb-open"));

  p.key("Escape");
  await p.wait(40);
  expect("pin: Escape leaves it alone", p.body.classList.contains("sb-open"));

  p.click(p.qs("[data-sidebar-pin]"));
  await p.wait(40);
  expect("unpin: the panel leaves", !p.body.classList.contains("sb-open"));
  expect("unpin: the rail marker is back", p.body.classList.contains("sb-rail"));
  expect("unpin: the choice is remembered", p.stored("1w.sidebar.pin") === '"0"');
  expect("unpin: no page errors", p.errors.length === 0, p.errors.join(" | "));
}

/* ------------------------------------------------------------------ */
/* 3 — the profile keeps its own menu, pinned like the others          */
/* ------------------------------------------------------------------ */
{
  const profile = await boot("profile.html?u=%40youssef.amrani");
  const pin = () => profile.qs("[data-pf-pin]");

  expect("profile: no site panel is mounted", !profile.qs(".sidebar"));
  expect("profile: the profile menu is there", Boolean(profile.qs(".pf-side")));
  expect("profile: the menu starts pinned", profile.body.classList.contains("pf-side-pinned"));
  expect("profile: so it is out", profile.body.classList.contains("pf-side-open"));
  expect("profile: it is announced", profile.qs(".pf-side")?.getAttribute("aria-hidden") === "false");
  expect("profile: the site rail classes are untouched", !profile.body.classList.contains("sb-open"));
  expect("profile: the menu carries a pin", Boolean(pin()));

  profile.click(pin());
  await profile.wait(40);
  expect("profile: unpinning leaves it on the edge", profile.body.classList.contains("pf-side-rail"));
  expect("profile: unpinned it closes", !profile.body.classList.contains("pf-side-open"));
  expect("profile: the choice is remembered", profile.stored("1w.sidebar.pin") === '"0"');

  profile.move(3);
  await profile.wait(40);
  expect("profile: the edge brings the menu in", profile.body.classList.contains("pf-side-open"));

  profile.move(900);
  await profile.wait(500);
  expect("profile: leaving hides it again", !profile.body.classList.contains("pf-side-open"));

  profile.click(pin());
  await profile.wait(40);
  expect("profile: the pin keeps the menu out", profile.body.classList.contains("pf-side-open"));
  expect("profile: it is marked pinned", profile.body.classList.contains("pf-side-pinned"));
  expect("profile: the pin reads pressed", profile.qs("[data-pf-pin]")?.getAttribute("aria-pressed") === "true");

  profile.move(900);
  await profile.wait(500);
  expect("profile: pinned, the pointer does not matter", profile.body.classList.contains("pf-side-open"));

  profile.key("Escape");
  await profile.wait(40);
  expect("profile: Escape leaves a pinned menu alone", profile.body.classList.contains("pf-side-open"));
  expect("profile: no page errors", profile.errors.length === 0, profile.errors.join(" | "));
}

{
  // the same preference read on the player and on the homepage
  const watch = await boot("watch.html", { stored: { "1w.sidebar.pin": "1" } });
  expect("watch: a pinned preference opens the site panel", watch.body.classList.contains("sb-open"));

  const stale = await boot("watch.html", { stored: { "1w.sidebar": false } });
  expect("watch: an old 1w.sidebar flag cannot hide the menu", stale.body.classList.contains("sb-rail"));

  const home = await boot("index.html");
  expect("home: the homepage starts pinned", home.body.classList.contains("sb-pinned"));
  expect("home: so its panel is out", home.body.classList.contains("sb-open"));

  const homeRail = await boot("index.html", { stored: { "1w.sidebar.pin": "2" } });
  expect("home: a stale value falls back to the homepage default", homeRail.body.classList.contains("sb-pinned"));

  const unpinnedHome = await boot("index.html", { stored: { "1w.sidebar.pin": "0" } });
  expect("home: unpinned it waits on the edge", unpinnedHome.body.classList.contains("sb-rail"));
  expect("home: unpinned it starts closed", !unpinnedHome.body.classList.contains("sb-open"));
  unpinnedHome.move(3);
  await unpinnedHome.wait(40);
  expect("home: the edge still brings it in", unpinnedHome.body.classList.contains("sb-open"));
  expect("home: no page errors", unpinnedHome.errors.length === 0, unpinnedHome.errors.join(" | "));
}

/* ------------------------------------------------------------------ */
/* 4 — the mobile drawer is untouched                                  */
/* ------------------------------------------------------------------ */
{
  const p = await boot("index.html", { desktop: false });
  expect("mobile: the homepage starts closed", !p.body.classList.contains("sb-open"));
  p.click(p.qs('[data-action="toggle-sidebar"]'));
  await p.wait(40);
  expect("mobile: the header button opens the drawer", p.body.classList.contains("sb-open"));
  expect("mobile: the scrim is on", p.qs("[data-scrim]")?.classList.contains("is-on") === true);
  p.click(p.qs("[data-scrim]"));
  await p.wait(40);
  expect("mobile: the scrim closes it", !p.body.classList.contains("sb-open"));

  const profile = await boot("profile.html?u=%40youssef.amrani", { desktop: false });
  expect("mobile: the profile has no site drawer", !profile.qs('[data-action="toggle-sidebar"]'));
  expect("mobile: its own menu stays in the flow", !profile.body.classList.contains("pf-side-open"));
  expect("mobile: the pin is there for CSS to hide", Boolean(profile.qs("[data-pf-pin]")));
  expect("mobile: no page errors", profile.errors.length === 0, profile.errors.join(" | "));
}

/* ------------------------------------------------------------------ */
/* 5 — the dashboard menu follows the same preference                  */
/* ------------------------------------------------------------------ */
{
  const p = await boot("dashboard.html", { dashboard: true });
  const dsh = p.qs("[data-dsh]");

  expect("dashboard: the menu is there", p.qs("[data-dsh-side]")?.hidden === false);
  expect("dashboard: it starts pinned", dsh?.dataset.pin === "on", dsh?.dataset.pin);
  expect("dashboard: so it is out", dsh?.dataset.sideReveal === "on");
  expect("dashboard: the panel carries a pin", Boolean(p.qs("[data-side-pin]")));
  expect("dashboard: the page itself is never hidden from assistive tech", dsh?.getAttribute("aria-hidden") === null, dsh?.getAttribute("aria-hidden"));

  p.click(p.qs("[data-side-pin]"));
  await p.wait(40);
  expect("dashboard: unpinning takes it off the grid", dsh?.dataset.pin === "off");
  expect("dashboard: unpinned it is away", dsh?.dataset.sideReveal === "off");
  expect("dashboard: the choice is shared", p.stored("1w.sidebar.pin") === '"0"');

  p.move(2);
  await p.wait(40);
  expect("dashboard: the edge reveals the menu", dsh?.dataset.sideReveal === "on");

  p.move(900);
  await p.wait(500);
  expect("dashboard: leaving hides it again", dsh?.dataset.sideReveal === "off");

  p.click(p.qs("[data-side-edge]"));
  await p.wait(40);
  expect("dashboard: the edge tab reveals it", dsh?.dataset.sideReveal === "on");

  p.click(p.qs("[data-side-pin]"));
  await p.wait(40);
  expect("dashboard: the pin keeps it out", dsh?.dataset.pin === "on");
  expect("dashboard: the pin reads pressed", p.qs("[data-side-pin]")?.getAttribute("aria-pressed") === "true");
  expect("dashboard: the choice is shared again", p.stored("1w.sidebar.pin") === '"1"');

  p.move(900);
  await p.wait(500);
  expect("dashboard: pinned, the pointer does not matter", dsh?.dataset.sideReveal === "on");
  expect("dashboard: no page errors", p.errors.length === 0, p.errors.join(" | "));
}

/* ------------------------------------------------------------------ */
/* 6 — the stylesheets                                                 */
/* ------------------------------------------------------------------ */
{
  expect("css: a floating panel never pads the content", /body\.sb-rail[^{}]*\.site-main[^{}]*\{[^}]*padding-left:\s*0/.test(layoutCss));
  expect("css: the rail tab only shows while the panel is away", /body\.sb-rail:not\(\.sb-open\)\s+\.edge-tab\s*\{[^}]*display:\s*inline-flex/.test(layoutCss));
  expect("css: the panel still slides under the header", /\.sidebar\s*\{[^}]*top:\s*var\(--header-h\)/.test(layoutCss));
  expect("css: unpinned the dashboard menu leaves the grid", /\.dsh\[data-pin="off"\]\s+\.dsh-shell\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/.test(dashCss));
  expect("css: unpinned it floats over the content", /\.dsh\[data-pin="off"\]\s+\.dsh-side\s*\{[^}]*position:\s*fixed/.test(dashCss));
  expect("css: revealed it sits at the edge", /\.dsh\[data-pin="off"\]\[data-side-reveal="on"\]\s+\.dsh-side\s*\{[^}]*transform:\s*none/.test(dashCss));
  expect("css: the state never reuses the pin's own attribute", !/data-side-pin="(on|off)"/.test(dashCss + layoutCss));
}

const failed = checks.filter((c) => !c.ok);
console.log(`sidebar smoke: ${checks.length - failed.length}/${checks.length}`);
failed.forEach((c) => console.log(`  ✗ ${c.name}${c.detail ? ` — ${c.detail}` : ""}`));
if (failed.length) process.exit(1);
process.exit(0);
