/**
 * Publisher desk smoke test — publisher.html and the editor embedded in it.
 *
 *   node tools/publisher-smoke.mjs
 *
 * Pass 1 — signed out: the desk asks for a session, and so does the editor.
 * Pass 2 — signed in, approved nowhere: the desk says how a publisher is made.
 * Pass 3 — a publisher: the rail, the hub in the URL, and the real editor
 *          (the whole form) standing inside the page, pointed at that hub.
 * Pass 4 — publishing stays on the desk: the payload names the hub, the video
 *          goes out live, the form comes back clean and the list shows it.
 * Pass 5 — the two tabs, the rail switching the editor, and the URL following.
 * Pass 6 — deep links: ?studio= picks the hub, ?id= opens one to edit.
 * Pass 7 — what the files must carry (the editor's markup, the flag, the CSS).
 */
import { JSDOM } from "jsdom";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const checks = [];
const expect = (name, ok, detail = "") => checks.push({ name, ok: Boolean(ok), detail: String(detail) });
const strip = (file) =>
  readFileSync(join(root, file), "utf8").replace(/<script[^>]*src="[^"]*"[^>]*><\/script>/g, "");
const wait = (ms = 60) => new Promise((r) => setTimeout(r, ms));
const reply = (data, ok = true) =>
  Promise.resolve({ ok, status: ok ? 200 : 400, json: async () => data, text: async () => JSON.stringify(data) });

const TOKEN = "e".repeat(64);
const MEMBER = {
  id: "5d9e05a4-be29-4832-9a8c-03d595f4f50b",
  member_id: "ID100042",
  username: "@youssef.amrani",
  full_name: "Youssef El Amrani",
  avatar_url: "",
  level: 1,
  status: "active",
};

const CINEMA = { id: "hub-1", code: "IDCN100006", kind: "cinema", name: "Cinema Seven", logo_url: "", cover_url: "", visibility: "public", role: "publisher", published: 1, drafts: 0, mine: 1 };
const STUDIO = { id: "hub-2", code: "IDST100001", kind: "channel", name: "Hello Studio", logo_url: "", cover_url: "", visibility: "public", role: "staff", published: 0, drafts: 0, mine: 0 };

function videoRow(over = {}) {
  return {
    id: "post-1",
    code: "PST-001010",
    type: "video",
    title: "The port at night",
    description: "Two nights of filming.",
    thumbnail: "https://example.com/thumb.jpg",
    language: "en",
    visibility: "general",
    status: "published",
    published_at: new Date(Date.now() - 7200_000).toISOString(),
    counters: { impressions: 120, likes: 3 },
    video: { meta: { age: "none" }, embed: "https://example.com/film.mp4", hub: { id: "hub-1", code: "IDCN100006", kind: "cinema", name: "Cinema Seven" } },
    ...over,
  };
}

const fnName = (href) => String(href).split("/rpc/")[1] || "";
const lastCall = (calls, fn) => [...calls].reverse().find((c) => fnName(c.href) === fn);

function boot(file, { url = "", storage = {}, fetchImpl } = {}) {
  const dom = new JSDOM(strip(file), { url: `http://localhost/${url || file}`, pretendToBeVisual: true });
  const { window } = dom;
  window.scrollTo = () => {};
  window.HTMLElement.prototype.scrollIntoView = () => {};
  const errors = [];
  window.addEventListener("error", (e) => errors.push(String(e.error || e.message)));
  window.addEventListener("unhandledrejection", (e) => errors.push(String(e.reason)));
  Object.keys(storage).forEach((key) => window.localStorage.setItem(key, storage[key]));

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
  globalThis.AbortController = window.AbortController || AbortController;
  globalThis.localStorage = window.localStorage;
  globalThis.sessionStorage = window.sessionStorage;
  globalThis.getComputedStyle = window.getComputedStyle.bind(window);
  globalThis.requestAnimationFrame = window.requestAnimationFrame.bind(window);
  globalThis.cancelAnimationFrame = window.cancelAnimationFrame.bind(window);
  globalThis.matchMedia = (q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  Object.defineProperty(globalThis, "navigator", { value: window.navigator, configurable: true });
  if (!globalThis.crypto || typeof globalThis.crypto.getRandomValues !== "function") {
    Object.defineProperty(globalThis, "crypto", { value: window.crypto, configurable: true });
  }
  const calls = [];
  globalThis.fetch = (input, opts = {}) => {
    const href = String(input);
    calls.push({ href, body: opts.body ? JSON.parse(opts.body) : null });
    if (fetchImpl) return fetchImpl(href, opts, calls);
    return reply([]);
  };
  return { dom, window, document: window.document, calls, errors };
}

const signedIn = { "1w.session": TOKEN, "1w.member": JSON.stringify(MEMBER) };

/* ================================================================== */
/* pass 1 — signed out                                                */
/* ================================================================== */
{
  const { document, errors, window } = boot("publisher.html", {
    fetchImpl: () => reply({ ok: false, error: "session" }),
  });
  await import(`file://${join(root, "assets/js/video-editor.js")}?p1`);
  await import(`file://${join(root, "assets/js/publisher.js")}?p1`);
  await wait(140);

  const state = document.querySelector("[data-pub-state]");
  expect("out: the desk is hidden", document.querySelector("[data-pub-shell]").hidden === true);
  expect("out: the desk asks for a session", /Sign in to publish/i.test(state.textContent), state.textContent.trim().slice(0, 60));
  expect("out: and offers the way in", Boolean(state.querySelector('a[href="login.html?next=publisher.html"]')), state.innerHTML.slice(0, 120));
  expect("out: no errors", errors.length === 0, errors.join(" | "));
  window.close();
}

/* ================================================================== */
/* pass 2 — signed in, approved nowhere                               */
/* ================================================================== */
{
  const { document, errors, calls, window } = boot("publisher.html", {
    storage: signedIn,
    fetchImpl: (href) => {
      const fn = fnName(href);
      if (fn === "publisher_hubs") return reply({ ok: true, hubs: [] });
      return reply([]);
    },
  });
  await import(`file://${join(root, "assets/js/video-editor.js")}?p2`);
  await import(`file://${join(root, "assets/js/publisher.js")}?p2`);
  await wait(140);

  const state = document.querySelector("[data-pub-state]");
  expect("none: the server was asked for the hubs", calls.some((c) => fnName(c.href) === "publisher_hubs"), calls.map((c) => fnName(c.href)).join(","));
  expect("none: the desk stays closed", document.querySelector("[data-pub-shell]").hidden === true);
  expect("none: it says no hub has approved the member", /No hub has approved you yet/i.test(state.textContent), state.textContent.trim().slice(0, 70));
  expect("none: and where a hub is found", Boolean(state.querySelector('a[href="creator.html"]')), state.innerHTML.slice(0, 140));
  expect("none: no errors", errors.length === 0, errors.join(" | "));
  window.close();
}

/* ================================================================== */
/* pass 3 — the publisher's desk, editor included                     */
/* ================================================================== */
let deskCalls = null;
let savedPayload = null;
let saved = false;

function deskFetch(href) {
  const fn = fnName(href);
  if (fn === "publisher_hubs") return reply({ ok: true, hubs: [CINEMA, STUDIO] });
  if (fn === "video_mine") {
    const rows = [videoRow()];
    if (saved) rows.unshift(videoRow({ code: "PST-001050", title: "A new film", counters: { impressions: 0 } }));
    return reply({ ok: true, rows });
  }
  if (fn === "video_save") {
    saved = true;
    savedPayload = null;
    return reply({
      ok: true,
      status: "published",
      code: "PST-001050",
      video: videoRow({ code: "PST-001050", title: "A new film", video: { meta: { age: "none" }, embed: "https://example.com/new.mp4", hub: { code: "IDCN100006", kind: "cinema", name: "Cinema Seven" } } }),
    });
  }
  if (fn === "video_get") return reply({ ok: true, video: videoRow({ title: "The port at night" }) });
  return reply([]);
}

{
  const { document, errors, calls, window } = boot("publisher.html", { storage: signedIn, fetchImpl: deskFetch });
  deskCalls = calls;
  await import(`file://${join(root, "assets/js/video-editor.js")}?p3`);
  await import(`file://${join(root, "assets/js/publisher.js")}?p3`);
  await wait(220);

  const shell = document.querySelector("[data-pub-shell]");
  expect("desk: it opens", shell.hidden === false);
  const hubs = document.querySelectorAll("[data-pub-hub]");
  expect("desk: the rail holds both hubs", hubs.length === 2, String(hubs.length));
  expect("desk: the first is the selected one", hubs[0].getAttribute("aria-pressed") === "true", hubs[0].getAttribute("aria-pressed"));
  expect("desk: the rail names the role", /Publisher/.test(hubs[0].textContent), hubs[0].textContent.replace(/\s+/g, " ").trim());
  expect("desk: the second says staff", /Staff/.test(hubs[1].textContent), hubs[1].textContent.replace(/\s+/g, " ").trim());
  expect("desk: the hub rides on the body", document.body.dataset.vedHubcode === "IDCN100006", document.body.dataset.vedHubcode);
  expect("desk: the URL says where", /studio=IDCN100006/.test(window.location.search), window.location.search);

  /* the editor is the real thing, not a thinner copy */
  expect("editor: the form stands in the page", Boolean(document.querySelector("[data-ved-shell]")) && document.querySelector("[data-ved-shell]").hidden === false);
  ["[data-ved-embed]", "[data-ved-title]", "[data-ved-desc]", "[data-ved-tag-input]", "[data-ved-thumb]", "[data-ved-vis]", '[data-vis="private"]', "[data-ved-when]", '[data-when="later"]', "[data-ved-lang]", "[data-age]", "[data-ved-pass-add]", "[data-ved-person-add]", "[data-ved-publish]", "[data-ved-save]"].forEach((sel) => {
    expect(`editor: ${sel} is here`, Boolean(document.querySelector(sel)));
  });
  expect("editor: the file input is here", Boolean(document.querySelector("[data-ved-file]")));
  const deskRows = [...document.querySelectorAll("[data-ved-toc] [data-toc]")];
  expect("editor: the desk carries the contents rail too", deskRows.length === 9, String(deskRows.length));
  expect(
    "editor: listing the same sections",
    /The video/.test(deskRows[0]?.textContent || "") && deskRows.some((row) => /Who sees it/.test(row.textContent)),
    deskRows.map((row) => row.textContent.trim()).join(" | ")
  );
  const hubSelect = document.querySelector("[data-ved-hub]");
  expect("editor: the picker points at the desk's hub", hubSelect.value === "IDCN100006", hubSelect.value);
  expect("editor: and offers no stray own-feed", !/My own feed/.test(hubSelect.textContent), hubSelect.textContent.trim().slice(0, 80));
  expect("editor: the preview says where it goes", /Cinema Seven/.test(document.querySelector("[data-ved-preview-studio]")?.textContent || ""), document.querySelector("[data-ved-preview-studio]")?.textContent);
  expect("editor: no errors", errors.length === 0, errors.join(" | "));
  window.close();
}

/* ================================================================== */
/* pass 4 — publishing stays on the desk                              */
/* ================================================================== */
{
  saved = false;
  const { document, errors, calls, window } = boot("publisher.html", { storage: signedIn, fetchImpl: deskFetch });
  await import(`file://${join(root, "assets/js/video-editor.js")}?p4`);
  await import(`file://${join(root, "assets/js/publisher.js")}?p4`);
  await wait(220);

  const embed = document.querySelector("[data-ved-embed]");
  const title = document.querySelector("[data-ved-title]");
  embed.value = "https://www.youtube.com/watch?v=abc12345678";
  embed.dispatchEvent(new window.Event("input", { bubbles: true }));
  title.value = "A new film";
  title.dispatchEvent(new window.Event("input", { bubbles: true }));
  await wait(40);

  const publish = document.querySelector("[data-ved-publish]");
  expect("publish: the bar is ready", publish.disabled === false, publish.disabled);
  const before = window.location.href;
  publish.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await wait(220);

  const call = lastCall(calls, "video_save");
  const payload = (call && call.body && call.body.p_payload) || {};
  expect("publish: video_save was called", Boolean(call), calls.map((c) => fnName(c.href)).join(","));
  expect("publish: it names the hub", payload.hub === "IDCN100006", JSON.stringify(payload.hub));
  expect("publish: it goes out live", payload.status === "published", JSON.stringify(payload.status));
  expect("publish: with the link and the title", payload.embed === "https://www.youtube.com/watch?v=abc12345678" && payload.title === "A new film", JSON.stringify({ embed: payload.embed, title: payload.title }));
  expect("publish: the page did not navigate", window.location.href === before, window.location.href);

  const flash = document.querySelector("[data-pub-flash]");
  expect("publish: the desk says what landed", flash.hidden === false && /A new film/.test(flash.textContent), flash.textContent.trim().slice(0, 80));
  expect("publish: with a way to open it", Boolean(flash.querySelector('a[href="video.html?id=PST-001050"]')), flash.innerHTML.slice(0, 140));
  expect("publish: the form came back clean", document.querySelector("[data-ved-title]").value === "", document.querySelector("[data-ved-title]").value);
  expect("publish: and the hub stayed", document.querySelector("[data-ved-hub]").value === "IDCN100006", document.querySelector("[data-ved-hub]").value);
  expect("publish: the list was re-read", calls.filter((c) => fnName(c.href) === "video_mine").length >= 2, String(calls.filter((c) => fnName(c.href) === "video_mine").length));
  expect("publish: no errors", errors.length === 0, errors.join(" | "));
  window.close();
}

/* ================================================================== */
/* pass 5 — the tabs and the rail                                     */
/* ================================================================== */
{
  saved = false;
  const { document, errors, window } = boot("publisher.html", { storage: signedIn, fetchImpl: deskFetch });
  await import(`file://${join(root, "assets/js/video-editor.js")}?p5`);
  await import(`file://${join(root, "assets/js/publisher.js")}?p5`);
  await wait(220);

  const mineTab = document.querySelector('[data-pub-tab="mine"]');
  mineTab.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await wait(60);
  expect("tabs: the list is shown", document.querySelector('[data-pub-panel="mine"]').hidden === false);
  expect("tabs: the editor is put away", document.querySelector('[data-pub-panel="new"]').hidden === true);
  expect("tabs: the body records it", document.body.dataset.pubTab === "mine", document.body.dataset.pubTab);
  expect("tabs: only this hub's videos", document.querySelectorAll("[data-pub-list] .pubrow").length === 1, String(document.querySelectorAll("[data-pub-list] .pubrow").length));
  const row = document.querySelector("[data-pub-list] .pubrow");
  expect("tabs: a row names its video", /The port at night/.test(row.textContent), row.textContent.replace(/\s+/g, " ").trim().slice(0, 80));
  expect("tabs: it offers open and edit", Boolean(row.querySelector('a[href="video.html?id=PST-001010"]')) && Boolean(row.querySelector('a[href^="publisher.html?studio=IDCN100006&id=PST-001010"]')), row.innerHTML.slice(0, 160));

  /* the rail moves the editor */
  document.querySelectorAll("[data-pub-hub]")[1].dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await wait(80);
  expect("rail: the editor follows the rail", document.querySelector("[data-ved-hub]").value === "IDST100001", document.querySelector("[data-ved-hub]").value);
  expect("rail: the URL follows too", /studio=IDST100001/.test(window.location.search), window.location.search);
  expect("rail: the list empties with the hub", Boolean(document.querySelector("[data-pub-list] .pub__none")), document.querySelector("[data-pub-list]").textContent.replace(/\s+/g, " ").trim().slice(0, 80));
  expect("rail: no errors", errors.length === 0, errors.join(" | "));
  window.close();
}

/* ================================================================== */
/* pass 6 — deep links                                                */
/* ================================================================== */
{
  const { document, calls, errors, window } = boot("publisher.html", {
    url: "publisher.html?studio=IDST100001",
    storage: signedIn,
    fetchImpl: deskFetch,
  });
  await import(`file://${join(root, "assets/js/video-editor.js")}?p6`);
  await import(`file://${join(root, "assets/js/publisher.js")}?p6`);
  await wait(240);
  expect("link: ?studio= picks a hub that is not the first", document.querySelector("[data-ved-hub]").value === "IDST100001", document.querySelector("[data-ved-hub]").value);
  expect("link: the rail agrees", document.querySelectorAll("[data-pub-hub]")[1].getAttribute("aria-pressed") === "true");
  expect("link: no errors on a linked hub", errors.length === 0, errors.join(" | "));
  window.close();
}

{
  const { document, calls, errors, window } = boot("publisher.html", {
    url: "publisher.html?studio=IDCN100006&id=PST-001010",
    storage: signedIn,
    fetchImpl: deskFetch,
  });
  await import(`file://${join(root, "assets/js/video-editor.js")}?p6b`);
  await import(`file://${join(root, "assets/js/publisher.js")}?p6b`);
  await wait(260);
  expect("edit: the video is fetched", calls.some((c) => fnName(c.href) === "video_get"), calls.map((c) => fnName(c.href)).join(","));
  expect("edit: the heading says edit", /Edit a video/.test(document.querySelector("[data-ved-heading]").textContent), document.querySelector("[data-ved-heading]").textContent);
  expect("edit: the fields are filled", document.querySelector("[data-ved-title]").value === "The port at night", document.querySelector("[data-ved-title]").value);
  expect("edit: the hub is still the desk's", document.querySelector("[data-ved-hub]").value === "IDCN100006", document.querySelector("[data-ved-hub]").value);
  expect("edit: no errors", errors.length === 0, errors.join(" | "));
  window.close();
}

/* ================================================================== */
/* pass 7 — the files themselves                                      */
/* ================================================================== */
{
  const html = readFileSync(join(root, "publisher.html"), "utf8");
  const editor = readFileSync(join(root, "assets/js/video-editor.js"), "utf8");
  const page = readFileSync(join(root, "assets/js/publisher.js"), "utf8");
  const css = readFileSync(join(root, "assets/css/publisher.css"), "utf8");

  expect("files: the page embeds the flag", /data-ved-embed="1"/.test(html), "body");
  expect("files: it carries the editor's own markup", /data-ved-shell/.test(html) && /data-ved-publish/.test(html) && /data-ved-thumb-file/.test(html));
  expect("files: it loads the editor module", /assets\/js\/video-editor\.js\?v=/.test(html));
  expect("files: and its own", /assets\/js\/publisher\.js\?v=/.test(html) && /assets\/css\/publisher\.css\?v=/.test(html));
  expect("files: the editor knows the desk", /vedEmbed === "1"/.test(editor) && /publisher_hubs/.test(editor));
  expect("files: and never carries a publish away from it", /ved:published/.test(editor));
  expect("files: the desk asks the publisher's door", /rpc\("publisher_hubs"/.test(page), "publisher_hubs");
  expect("files: the CSS dresses the rail and the rows", /\.pub__rail/.test(css) && /\.pubrow/.test(css) && /\.pub__tabs/.test(css));
  const creator = readFileSync(join(root, "assets/js/creator.js"), "utf8");
  expect("files: the hub page hands a publisher their desk", /data-crp-desk/.test(creator) && /publisher\.html\?studio=/.test(creator));
}

/* ------------------------------------------------------------------ */
const failed = checks.filter((c) => !c.ok);
checks.forEach((c) => {
  if (!c.ok) console.log(`FAIL  ${c.name}${c.detail ? ` → ${c.detail}` : ""}`);
});
console.log(`\npublisher: ${checks.length - failed.length}/${checks.length}${failed.length ? ` — ${failed.length} failed` : " pass"}`);
process.exit(failed.length ? 1 : 0);
