/**
 * Verifies that a normal page boot (app.js) writes a visitor row.
 *   node tools/visit-smoke.mjs
 */
import { JSDOM } from "jsdom";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const html = readFileSync(join(root, "index.html"), "utf8").replace(/<script[^>]*src="[^"]*"[^>]*><\/script>/g, "");
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
const mediaStub = (q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
window.matchMedia = mediaStub;
globalThis.matchMedia = mediaStub;
Object.defineProperty(globalThis, "navigator", { value: window.navigator, configurable: true });

const calls = [];
globalThis.fetch = (url) => {
  calls.push(String(url));
  const data = String(url).includes("/rpc/log_visit")
    ? { visit_id: "visit000042", member_visit_id: null, frequency: 3 }
    : [];
  return Promise.resolve({ ok: true, status: 200, json: async () => data, text: async () => JSON.stringify(data) });
};

await import(`file://${join(root, "assets/js/app.js")}`);
await new Promise((r) => setTimeout(r, 600));

const saved = JSON.parse(window.sessionStorage.getItem("1w.visit") || "null");
const report = {
  logVisitCalled: calls.some((c) => c.includes("/rpc/log_visit")),
  visitIdStored: saved?.visitId || null,
  purpose: calls.some((c) => c.includes("/rpc/log_visit")),
  errors,
};
console.log(report);
console.log("errors:", errors.length ? errors : "none");
process.exit(errors.length || !report.logVisitCalled ? 1 : 0);
