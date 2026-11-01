/**
 * Shell smoke test — the sidebar belongs to the homepage only, and showing it
 * must not move the header.
 *
 *   node tools/shell-smoke.mjs
 *
 * Pass 1 — index.html: the sidebar is mounted, the header carries the menu
 *          button, a stored preference opens it, the toggle flips the body
 *          class, Escape closes it.
 * Pass 2 — an inner page (profile.html) with `1w.sidebar = true` in storage:
 *          no <aside>, no menu button, the body never gets `sb-open`, and the
 *          main column keeps its full width.
 * Pass 3 — the stylesheet: no rule widens the header bar when the sidebar is
 *          open (jsdom ignores @media, so the cascade is asserted at source).
 */
import { JSDOM } from "jsdom";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const css = readFileSync(join(root, "assets/css/layout.css"), "utf8");

const checks = [];
const expect = (name, ok, detail = "") => checks.push({ name, ok: Boolean(ok), detail });

const reply = (data) =>
  Promise.resolve({ ok: true, status: 200, json: async () => data, text: async () => JSON.stringify(data) });

function page(file) {
  return readFileSync(join(root, file), "utf8").replace(/<script[^>]*src="[^"]*"[^>]*><\/script>/g, "");
}

async function boot(file, { stored = null, member = null } = {}) {
  const dom = new JSDOM(page(file), { url: `http://localhost/${file}`, pretendToBeVisual: true });
  const { window } = dom;
  const errors = [];
  window.addEventListener("error", (e) => errors.push(String(e.error || e.message)));
  window.addEventListener("unhandledrejection", (e) => errors.push(String(e.reason)));

  const style = window.document.createElement("style");
  style.textContent = css;
  window.document.head.appendChild(style);

  globalThis.window = window;
  globalThis.document = window.document;
  globalThis.HTMLElement = window.HTMLElement;
  globalThis.Element = window.Element;
  globalThis.Node = window.Node;
  globalThis.Event = window.Event;
  globalThis.CustomEvent = window.CustomEvent;
  globalThis.localStorage = window.localStorage;
  globalThis.sessionStorage = window.sessionStorage;
  globalThis.getComputedStyle = window.getComputedStyle.bind(window);
  globalThis.requestAnimationFrame = window.requestAnimationFrame.bind(window);
  globalThis.cancelAnimationFrame = window.cancelAnimationFrame.bind(window);
  globalThis.matchMedia = (q) => ({
    matches: false,
    media: q,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
  });
  window.matchMedia = globalThis.matchMedia;
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
  globalThis.fetch = () => reply({ ok: true });
  window.fetch = globalThis.fetch;
  window.scrollTo = () => {};

  window.localStorage.clear();
  if (stored !== null) window.localStorage.setItem("1w.sidebar", String(stored));
  if (member) window.localStorage.setItem("1w.member", JSON.stringify(member));

  const { mountShell } = await import(`file://${join(root, "assets/js/shell.js")}?page=${file}`);
  mountShell();
  await new Promise((r) => setTimeout(r, 120));

  const qs = (sel) => window.document.querySelector(sel);
  const qsa = (sel) => [...window.document.querySelectorAll(sel)];
  const click = (el) => el && el.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
  const wait = (ms = 120) => new Promise((r) => setTimeout(r, ms));
  return { window, document: window.document, qs, qsa, click, wait, errors };
}

/* ------------------------------------------------------------------ */
/* pass 1 — homepage                                                   */
/* ------------------------------------------------------------------ */
{
  const p = await boot("index.html", { stored: true });

  expect("home: header mounted", Boolean(p.qs(".site-header")));
  expect("home: sidebar mounted", Boolean(p.qs(".sidebar#siteSidebar")));
  expect("home: menu button in the header", Boolean(p.qs('[data-action="toggle-sidebar"]')));
  expect("home: menu button points at the aside", p.qs('[data-action="toggle-sidebar"]')?.getAttribute("aria-controls") === "siteSidebar");
  expect("home: sidebar opens from the stored preference", p.document.body.classList.contains("sb-open"));
  expect("home: sidebar marked open", p.qs(".sidebar")?.classList.contains("is-open") === true);
  expect("home: no icons left unhydrated", p.qsa("[data-icon]").length === 0, `${p.qsa("[data-icon]").length} left`);

  p.click(p.qs('[data-action="toggle-sidebar"]'));
  await p.wait(80);
  expect("home: toggle closes it", !p.document.body.classList.contains("sb-open"));
  expect("home: aria-expanded follows", p.qs('[data-action="toggle-sidebar"]')?.getAttribute("aria-expanded") === "false");

  p.click(p.qs('[data-action="toggle-sidebar"]'));
  await p.wait(80);
  expect("home: toggle opens it again", p.document.body.classList.contains("sb-open"));

  p.document.dispatchEvent(new p.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  await p.wait(80);
  expect("home: Escape closes it", !p.document.body.classList.contains("sb-open"));

  expect("home: the header is fixed", p.window.getComputedStyle(p.qs(".site-header")).position === "fixed");
  expect("home: no page errors", p.errors.length === 0, p.errors.join(" | "));
}

/* ------------------------------------------------------------------ */
/* pass 2 — an inner page                                              */
/* ------------------------------------------------------------------ */
{
  const p = await boot("profile.html", { stored: true });

  expect("inner: header mounted", Boolean(p.qs(".site-header")));
  expect("inner: no sidebar rendered", !p.qs(".sidebar") && !p.qs("#siteSidebar"));
  expect("inner: no menu button", !p.qs('[data-action="toggle-sidebar"]'));
  expect("inner: stored preference is ignored", !p.document.body.classList.contains("sb-open"));
  expect("inner: the sidebar container stays empty", p.qs("[data-site-sidebar]")?.children.length === 0);
  expect("inner: header still fixed", p.window.getComputedStyle(p.qs(".site-header")).position === "fixed");
  expect("inner: no page errors", p.errors.length === 0, p.errors.join(" | "));
}

/* ------------------------------------------------------------------ */
/* pass 3 — the stylesheet                                             */
/* ------------------------------------------------------------------ */
{
  expect("css: the header bar is never padded by the sidebar", !/body\.sb-open\s+\.site-header__bar/.test(css));
  expect("css: the header itself is never shifted", !/body\.sb-open\s+\.site-header\s*\{/.test(css));
  expect("css: the sidebar still sits under the header", /\.sidebar\s*\{[^}]*top:\s*var\(--header-h\)/.test(css));
  expect("css: content still clears the rail", /body\.sb-open\s+\.site-main\s*\{[^}]*padding-left:\s*var\(--sidebar-w\)/.test(css));
}

/* ------------------------------------------------------------------ */
/* pass 4 — the level badge in the header                             */
/* ------------------------------------------------------------------ */
{
  const p = await boot("index.html", {
    stored: false,
    member: { id: "m1", username: "@sara", name: "Sara", points: 550000000, membership: "diamond", level: 8 },
  });
  expect(
    "wallet: the points chip opens dashboard.html#points",
    p.qs("[data-wallet]")?.getAttribute("href") === "dashboard.html#points",
    p.qs("[data-wallet]")?.getAttribute("href")
  );
  expect("badge: the wallet prints LV85", p.qs("[data-wallet-level]")?.textContent === "LV85", p.qs("[data-wallet-level]")?.textContent);
  expect("badge: the meter names the ceiling", /LV85 \/ LVMax/.test(p.qs("[data-level-cap]")?.textContent || ""), p.qs("[data-level-cap]")?.textContent);
  expect("badge: the bar reads 50 %", p.qs("[data-level-fill]")?.style.width === "50%", p.qs("[data-level-fill]")?.style.width);
  expect("badge: no page errors", p.errors.length === 0, p.errors.join(" | "));
}

{
  const p = await boot("index.html", {
    stored: false,
    member: { id: "m2", username: "@amine", name: "Amine", points: 1000000000, membership: "free", level: 9 },
  });
  expect("cap: a free member at a billion points shows LV39", p.qs("[data-wallet-level]")?.textContent === "LV39", p.qs("[data-wallet-level]")?.textContent);
  expect("cap: the meter says so", /LV39 \/ LV30 · cap/.test(p.qs("[data-level-cap]")?.textContent || ""), p.qs("[data-level-cap]")?.textContent);
  expect("cap: the bar is full", p.qs("[data-level-fill]")?.style.width === "100%", p.qs("[data-level-fill]")?.style.width);
  expect("cap: no page errors", p.errors.length === 0, p.errors.join(" | "));
}

const failed = checks.filter((c) => !c.ok);
console.log(`shell smoke: ${checks.length - failed.length}/${checks.length}`);
failed.forEach((c) => console.log(`  ✗ ${c.name}${c.detail ? ` — ${c.detail}` : ""}`));
if (failed.length) process.exit(1);
/* the wallet keeps a poll timer alive while a member is signed in */
process.exit(0);
