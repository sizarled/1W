/**
 * Verifies that a normal page boot (app.js) writes a visitor row.
 *   node tools/visit-smoke.mjs
 *
 * Two scenarios run in separate processes:
 *   1. the `log_visit` function answers  → visit id stored in sessionStorage
 *   2. the function is down (404)        → the client inserts into `visitor_visits` itself
 */
import { JSDOM } from "jsdom";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const MODE = process.env.VISIT_MODE || "rpc"; // "rpc" | "fallback"

const html = readFileSync(join(root, "index.html"), "utf8").replace(
  /<script[^>]*src="[^"]*"[^>]*><\/script>/g,
  ""
);
const dom = new JSDOM(html, { url: "http://localhost/index.html", pretendToBeVisual: true });
const { window } = dom;

const errors = [];
window.addEventListener("error", (e) => errors.push(String(e.error || e.message)));

globalThis.window = window;
globalThis.document = window.document;
globalThis.location = window.location;
globalThis.HTMLElement = window.HTMLElement;
globalThis.Element = window.Element;
globalThis.Node = window.Node;
globalThis.Event = window.Event;
globalThis.localStorage = window.localStorage;
globalThis.sessionStorage = window.sessionStorage;
globalThis.getComputedStyle = window.getComputedStyle.bind(window);
globalThis.requestAnimationFrame = window.requestAnimationFrame.bind(window);
globalThis.cancelAnimationFrame = window.cancelAnimationFrame.bind(window);
const mediaStub = (q) => ({
  matches: false,
  media: q,
  addEventListener() {},
  removeEventListener() {},
  addListener() {},
  removeListener() {},
});
window.matchMedia = mediaStub;
globalThis.matchMedia = mediaStub;
Object.defineProperty(globalThis, "navigator", { value: window.navigator, configurable: true });

const calls = [];
let directInsert = null;

globalThis.fetch = (url, options = {}) => {
  const target = String(url);
  calls.push(target);

  if (target.includes("/rpc/log_visit")) {
    if (MODE === "fallback") {
      const body = JSON.stringify({ message: "Could not find the function public.log_visit" });
      return Promise.resolve({ ok: false, status: 404, json: async () => JSON.parse(body), text: async () => body });
    }
    const data = { visit_id: "visit000042", member_visit_id: null, frequency: 3 };
    return Promise.resolve({ ok: true, status: 200, json: async () => data, text: async () => JSON.stringify(data) });
  }

  if (target.includes("/visitor_visits")) {
    directInsert = { method: options.method, prefer: options.headers?.Prefer, body: options.body };
    return Promise.resolve({ ok: true, status: 201, json: async () => null, text: async () => "" });
  }

  return Promise.resolve({ ok: true, status: 200, json: async () => [], text: async () => "[]" });
};

await import(`file://${join(root, "assets/js/app.js")}`);
await new Promise((r) => setTimeout(r, 700));

const saved = JSON.parse(window.sessionStorage.getItem("1w.visit") || "null");
const report = {
  mode: MODE,
  logVisitCalled: calls.some((c) => c.includes("/rpc/log_visit")),
  visitIdStored: saved?.visitId || null,
  htmlMarker: window.document.documentElement.dataset.visit || null,
  storedError: JSON.parse(window.localStorage.getItem("1w.visit.error") || "null")?.message || null,
  errors,
};

if (MODE === "fallback") {
  report.directInsertCalled = Boolean(directInsert);
  report.directInsertPrefer = directInsert?.prefer || null;
  report.directInsertRow = directInsert?.body ? JSON.parse(directInsert.body)[0] : null;
}

console.log(JSON.stringify(report, null, 2));

const failed =
  errors.length > 0 ||
  !report.logVisitCalled ||
  (MODE === "fallback"
    ? !(report.directInsertCalled && report.directInsertPrefer === "return=minimal" && report.directInsertRow?.visitor_id)
    : report.visitIdStored !== "visit000042");

if (MODE === "fallback") {
  console.log("errors:", errors.length ? errors : "none");
  process.exit(failed ? 1 : 0);
}

// main process: run the fallback scenario in its own module registry
const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], {
  env: { ...process.env, VISIT_MODE: "fallback" },
  encoding: "utf8",
});
process.stdout.write(child.stdout);
if (child.stderr) process.stderr.write(child.stderr);
console.log("fallback scenario:", child.status === 0 ? "pass" : "FAIL");
console.log("errors:", errors.length ? errors : "none");
process.exit(failed || child.status !== 0 ? 1 : 0);
