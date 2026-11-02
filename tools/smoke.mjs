// Headless smoke test: boots index.html's JS inside jsdom and asserts the
// homepage rendered its sections. Run: NODE_PATH=/tmp/tools/node_modules node tools/smoke.mjs
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const dom = new JSDOM(html, { url: "http://localhost:8000/index.html", pretendToBeVisual: true, runScripts: "outside-only" });

const { window } = dom;
globalThis.window = window;
globalThis.document = window.document;
Object.defineProperty(globalThis, "navigator", { value: window.navigator, configurable: true });
globalThis.location = window.location;
globalThis.HTMLElement = window.HTMLElement;
globalThis.Element = window.Element;
globalThis.Node = window.Node;
globalThis.CustomEvent = window.CustomEvent;
globalThis.Event = window.Event;
globalThis.MouseEvent = window.MouseEvent;
globalThis.localStorage = window.localStorage;
globalThis.getComputedStyle = window.getComputedStyle;
globalThis.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 16);
globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
globalThis.matchMedia = window.matchMedia = (q) => ({
  matches: false,
  media: q,
  addEventListener() {},
  removeEventListener() {},
  addListener() {},
  removeListener() {},
});
window.requestAnimationFrame = globalThis.requestAnimationFrame;
window.cancelAnimationFrame = globalThis.cancelAnimationFrame;
window.HTMLMediaElement.prototype.play = function () { return Promise.resolve(); };
window.HTMLMediaElement.prototype.pause = function () {};

// simulate "no network" so the fallback catalogue is exercised
globalThis.fetch = async () => { throw new Error("offline (smoke test)"); };
window.fetch = globalThis.fetch;
globalThis.Audio = window.Audio = class { play() { return Promise.resolve(); } pause() {} };

const errors = [];
window.addEventListener("error", (e) => errors.push(e.message));
window.addEventListener("unhandledrejection", (e) => errors.push(String(e.reason)));

console.error("importing app…");
await import("../assets/js/app.js");
console.error("imported");
await new Promise((r) => setTimeout(r, 900));

const q = (sel) => document.querySelectorAll(sel);
const report = {
  header: q(".site-header").length,
  sidebar: q(".sidebar").length,
  footer: q(".site-footer").length,
  wallet: q("[data-wallet-value]")[0]?.textContent,
  notif: q(".notif__panel").length,
  heroTitle: q(".hero__title")[0]?.textContent?.slice(0, 60),
  heroThumbs: q(".hero__thumb").length,
  heroBg: q("[data-hero-layer]")[0]?.style.backgroundImage?.slice(0, 40),
  features: q(".feature").length,
  movieCards: q("#movies .pcard").length,
  seriesCards: q("#series .pcard").length,
  channels: q("#iptv .chcard").length,
  plans: q(".plan").length,
  planPrices: Array.from(q(".plan__amount")).map((n) => n.textContent).join(" | "),
  apps: q(".app-card").length,
  platforms: q(".platform-card").length,
  sideLinks: q(".snav__link").length,
  visitor: q("[data-account-id]")[0]?.textContent,
};
// ---- interactions -------------------------------------------------
const click = (el) => el && el.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
const wait = (ms = 120) => new Promise((r) => setTimeout(r, ms));

const heroTitles = [];
click(document.querySelector("[data-hero-next]"));
await wait(60);
heroTitles.push(document.querySelector(".hero__title")?.textContent);
click(document.querySelector('[data-hero-mode="series"]'));
await wait(60);
heroTitles.push(document.querySelector(".hero__title")?.textContent);

click(document.querySelector('[data-iptv-tab="premium"]'));
await wait(60);
const premiumChannels = document.querySelectorAll("#iptv .chcard").length;
const lockedCount = document.querySelectorAll("#iptv .chcard[data-locked]").length;
click(document.querySelector("#iptv .chcard[data-locked]"));
await wait(60);
const lockedToast = document.querySelectorAll(".toast").length;

const plan = document.querySelector('[data-plan="gold"]');
click(plan.querySelector('[data-duration="6"]'));
await wait(40);

window.OneW.demoSignIn();
await wait(120);
const signedIn = {
  wallet: document.querySelector("[data-wallet-value]")?.textContent,
  level: document.querySelector("[data-wallet-level]")?.textContent,
  account: document.querySelector("[data-account-id]")?.textContent,
  auth: document.querySelector("[data-auth-actions]")?.textContent.replace(/\s+/g, " ").trim(),
  membershipLock: document.querySelectorAll("#iptv .chcard[data-locked]").length,
  hasLogout: Boolean(document.querySelector('[data-action="logout"]')),
};

click(document.querySelector("[data-notif-trigger]"));
await wait(60);
const notifOpen = !document.querySelector("[data-notif-panel]").hidden;

// ---- appearance ---------------------------------------------------
const themeState = () => ({
  theme: document.documentElement.getAttribute("data-theme"),
  stored: localStorage.getItem("1w.theme"),
  meta: document.querySelector('meta[name="theme-color"]')?.getAttribute("content"),
  headerIcon: document.querySelector(".header__actions [data-theme-toggle] svg path") ? "svg" : "none",
  headerLabel: document.querySelector(".header__actions [data-theme-toggle]")?.getAttribute("aria-label"),
  sidebarLabel: document.querySelector('.tool-btn[data-theme-toggle]')?.textContent.trim(),
});

const appearance = { initial: themeState() };
click(document.querySelector('.header__actions [data-theme-toggle]'));
await wait(80);
appearance.afterHeaderClick = themeState();
click(document.querySelector('.tool-btn[data-theme-toggle]'));
await wait(80);
appearance.afterSidebarClick = themeState();

// ---- drag to scroll -----------------------------------------------
const fire = (el, type, props) => {
  const ev = new window.Event(type, { bubbles: true, cancelable: true });
  Object.assign(ev, props);
  el.dispatchEvent(ev);
};
const dragTrack = document.querySelector("#movies [data-rail-track]");
const drag = {
  wired: document.querySelectorAll('[data-drag-ready="1"]').length,
  tracks: document.querySelectorAll(".rail__track, .plans").length,
};

// the twelve header sections must be draggable too (watch.html included)
const nav = document.querySelector("[data-primary-nav]");
drag.navReady = nav?.dataset.dragReady === "1";
drag.navLinks = nav ? nav.querySelectorAll(".primary-nav__item").length : 0;
if (nav) {
  fire(nav, "pointerdown", { pointerType: "mouse", button: 0, pointerId: 7, clientX: 300, clientY: 24 });
  fire(nav, "pointermove", { pointerType: "mouse", button: 0, pointerId: 7, clientX: 200, clientY: 26 });
  drag.navDragging = nav.classList.contains("is-dragging");
  fire(nav, "pointerup", { pointerType: "mouse", button: 0, pointerId: 7, clientX: 200, clientY: 26 });
  drag.navReleased = !nav.classList.contains("is-dragging");
}
fire(dragTrack, "pointerdown", { pointerType: "mouse", button: 0, pointerId: 1, clientX: 240, clientY: 320 });
drag.downClass = dragTrack.classList.contains("is-dragging");
fire(dragTrack, "pointermove", { pointerType: "mouse", button: 0, pointerId: 1, clientX: 320, clientY: 322 });
drag.grabCursor = document.documentElement.classList.contains("is-grabbing");
fire(dragTrack, "pointerup", { pointerType: "mouse", button: 0, pointerId: 1, clientX: 320, clientY: 322 });
drag.upClass = dragTrack.classList.contains("is-dragging");
drag.grabReleased = document.documentElement.classList.contains("is-grabbing");

Object.assign(report, { heroTitles, premiumChannels, lockedCount, lockedToast, goldPrice6: plan.querySelector("[data-price]").textContent, signedIn, notifOpen, appearance, drag });

const checks = {
  headerNavDraggable: Boolean(drag.navReady && drag.navDragging && drag.navReleased),
  headerNavHasSections: drag.navLinks >= 12,
  railsDraggable: drag.wired >= 3 && drag.downClass === true && drag.grabCursor === true,
};
const failed = Object.entries(checks).filter(([, ok]) => !ok).map(([name]) => name);
console.log(report);
console.log("checks:", failed.length ? `FAILED ${failed.join(", ")}` : "all pass");
console.log("errors:", errors.length ? errors : "none");
process.exit(errors.length || failed.length ? 1 : 0);
