/**
 * Control panel smoke test — panel.html and the Platform table.
 *
 *   node tools/panel-smoke.mjs
 *
 * Pass 1 — signed out: the desk asks for a session before it asks the table.
 * Pass 2 — a session that is not staff: the desk stays shut, and says why.
 * Pass 3 — staff: the rows, the counts, the search, the filter.
 * Pass 4 — writing: the status switch, the dialog, a validation, a delete.
 * Pass 5 — the shelf the homepage reads: the loader, the card, the heading,
 *          and the fallback when the table cannot be reached.
 * Pass 6 — the files: the page's hooks, the module's calls, the SQL's table,
 *          the CSS, and every class the page wears existing somewhere.
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
const wait = (ms = 80) => new Promise((r) => setTimeout(r, ms));
const reply = (data, ok = true) =>
  Promise.resolve({ ok, status: ok ? 200 : 400, json: async () => data, text: async () => JSON.stringify(data) });

const TOKEN = "c".repeat(64);
const MEMBER = { id: "5d9e05a4-be29-4832-9a8c-03d595f4f50b", member_id: "ID100019", username: "@ledsizar7", level: 1, status: "active" };

const ROWS = [
  {
    id: "p-1",
    code: "PLT100001",
    name: "YouTube",
    username: "@CineauraV2",
    url: "https://www.youtube.com/@CineauraV2",
    logo_url: "",
    icon: "youtube",
    status: "available",
    sort_order: 10,
  },
  {
    id: "p-2",
    code: "PLT100002",
    name: "Telegram",
    username: "@CineauraV2",
    url: "https://t.me/CineauraV2",
    logo_url: "https://example.com/tg.png",
    icon: "telegram",
    status: "available",
    sort_order: 20,
  },
  {
    id: "p-3",
    code: "PLT100003",
    name: "Old channel",
    username: "retired",
    url: "https://example.com/old",
    logo_url: "",
    icon: "",
    status: "unavailable",
    sort_order: 30,
  },
];

const fnName = (href) => String(href).split("/rpc/")[1] || "";

function boot(file, { storage = {}, fetchImpl } = {}) {
  const dom = new JSDOM(strip(file), { url: `http://localhost/${file}`, pretendToBeVisual: true });
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

  return { window, document: window.document, calls, errors };
}

const signedIn = { "1w.session": TOKEN, "1w.member": JSON.stringify(MEMBER) };

/* ================================================================== */
/* pass 1 — signed out                                                */
/* ================================================================== */
{
  const { document, errors, calls, window } = boot("panel.html", { fetchImpl: () => reply({ ok: false }) });
  const { initPanel } = await import(`file://${join(root, "assets/js/panel.js")}?p1`);
  await initPanel();
  await wait();

  expect("out: the panel says it needs a session", document.querySelector('[data-p-state="signedout"]').hidden === false);
  expect("out: the table stays away", document.querySelector("[data-p-table]").hidden === true);
  expect("out: the toolbar stays away", document.querySelector("[data-p-bar]").hidden === true);
  expect(
    "out: the door to the login page, and back to this one",
    Boolean(document.querySelector('[data-p-state="signedout"] a[href="login.html?next=panel.html"]'))
  );
  expect("out: the table was never asked", !calls.some((c) => fnName(c.href) === "platform_admin_list"), calls.map((c) => fnName(c.href)).join(","));
  expect("out: no errors", errors.length === 0, errors.join(" | "));
  window.close();
}

/* ================================================================== */
/* pass 2 — a session that is not staff                               */
/* ================================================================== */
{
  const { document, errors, calls, window } = boot("panel.html", {
    storage: signedIn,
    fetchImpl: (href) =>
      fnName(href) === "platform_admin_list" ? reply({ ok: false, error: "staff", admin: false, rows: [] }) : reply([]),
  });
  const { initPanel } = await import(`file://${join(root, "assets/js/panel.js")}?p2`);
  await initPanel();
  await wait();

  expect("staff: the token was sent", calls.some((c) => fnName(c.href) === "platform_admin_list" && c.body?.p_token === TOKEN));
  expect("staff: the desk is shut", document.querySelector('[data-p-state="locked"]').hidden === false);
  expect("staff: and says why", /site's staff/i.test(document.querySelector('[data-p-state="locked"]').textContent));
  expect("staff: the rows are not drawn", document.querySelector("[data-p-table]").hidden === true);
  expect("staff: no errors", errors.length === 0, errors.join(" | "));
  window.close();
}

/* ================================================================== */
/* pass 3 — staff: the rows, the counts, the search, the filter        */
/* ================================================================== */
let desk = null;

function deskFetch(href) {
  const fn = fnName(href);
  if (fn === "platform_admin_list") return reply({ ok: true, admin: true, rows: ROWS });
  return reply([]);
}

{
  desk = boot("panel.html", { storage: signedIn, fetchImpl: deskFetch });
  const { document, window } = desk;
  const { initPanel } = await import(`file://${join(root, "assets/js/panel.js")}?p3`);
  await initPanel();
  await wait();

  const rows = document.querySelectorAll("[data-p-row]");
  expect("rows: three rows drawn", rows.length === 3, String(rows.length));
  expect("rows: the table is out", document.querySelector("[data-p-table]").hidden === false);
  expect("rows: the toolbar is out", document.querySelector("[data-p-bar]").hidden === false);
  expect("rows: the counts follow", document.querySelector('[data-p-count="all"]').textContent === "3");
  expect("rows: two available", document.querySelector('[data-p-count="available"]').textContent === "2");
  expect("rows: one unavailable", document.querySelector('[data-p-count="unavailable"]').textContent === "1");
  expect("rows: the code is on the row", /PLT100001/.test(rows[0].textContent), rows[0].textContent.trim().slice(0, 60));
  expect("rows: an uploaded logo is a picture", Boolean(rows[1].querySelector("img")), rows[1].innerHTML.slice(0, 80));
  expect("rows: without one, the brand glyph", Boolean(rows[0].querySelector("svg")), rows[0].innerHTML.slice(0, 80));
  expect("rows: the link points at the platform", rows[0].querySelector("a[href]")?.getAttribute("href") === "https://www.youtube.com/@CineauraV2");
  expect("rows: the status is written", /Available/.test(rows[0].textContent) && /Unavailable/.test(rows[2].textContent));

  // the filter
  document.querySelector('[data-p-status="unavailable"]').dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await wait(30);
  expect("filter: unavailable narrows to one", document.querySelectorAll("[data-p-row]").length === 1);
  expect("filter: the button is marked", document.querySelector('[data-p-status="unavailable"]').classList.contains("is-active"));
  document.querySelector('[data-p-status="all"]').dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await wait(30);
  expect("filter: all brings the three back", document.querySelectorAll("[data-p-row]").length === 3);

  // the search
  const search = document.querySelector("[data-p-search]");
  search.value = "tele";
  search.dispatchEvent(new window.Event("input", { bubbles: true }));
  await wait(30);
  expect("search: one row answers", document.querySelectorAll("[data-p-row]").length === 1, String(document.querySelectorAll("[data-p-row]").length));
  search.value = "nothing at all";
  search.dispatchEvent(new window.Event("input", { bubbles: true }));
  await wait(30);
  expect("search: nothing matches says so", document.querySelector("[data-p-empty]").hidden === false);
  expect("search: and names the reason", /Nothing matches that/.test(document.querySelector("[data-p-empty-title]").textContent));
  search.value = "";
  search.dispatchEvent(new window.Event("input", { bubbles: true }));
  await wait(30);
  expect("search: clearing brings them back", document.querySelectorAll("[data-p-row]").length === 3);

  expect("rows: no errors", desk.errors.length === 0, desk.errors.join(" | "));
}

/* ================================================================== */
/* pass 4 — writing                                                   */
/* ================================================================== */
{
  const { document, window, calls, errors } = desk;
  const fnCalls = (fn) => calls.filter((c) => fnName(c.href) === fn);

  let saveAnswer = null;
  globalThis.fetch = (input, opts = {}) => {
    const href = String(input);
    calls.push({ href, body: opts.body ? JSON.parse(opts.body) : null });
    const fn = fnName(href);
    if (fn === "platform_save") return reply(saveAnswer || { ok: true, row: { ...ROWS[0], status: "unavailable" } });
    if (fn === "platform_delete") return reply({ ok: true });
    return reply([]);
  };

  // --- the status switch
  const before = fnCalls("platform_save").length;
  document.querySelectorAll("[data-p-row]")[0].querySelector("[data-p-toggle]").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await wait(120);
  const flip = fnCalls("platform_save")[before];
  expect("switch: one save was sent", fnCalls("platform_save").length === before + 1);
  expect("switch: it flips the status", flip?.body?.p_status === "unavailable", JSON.stringify(flip?.body || {}));
  expect("switch: it names the row", flip?.body?.p_id === "p-1", flip?.body?.p_id);
  expect("switch: it carries the token", flip?.body?.p_token === TOKEN);
  expect(
    "switch: the counts follow",
    document.querySelector('[data-p-count="available"]').textContent === "1" &&
      document.querySelector('[data-p-count="unavailable"]').textContent === "2",
    `${document.querySelector('[data-p-count="available"]').textContent}/${document.querySelector('[data-p-count="unavailable"]').textContent}`
  );

  // --- the dialog: a validation first
  saveAnswer = null;
  document.querySelector("[data-p-add]").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await wait(40);
  const dialog = document.querySelector("[data-p-dialog]");
  expect("add: the sheet opens", dialog.hasAttribute("open") || dialog.open === true);
  expect("add: it reads as an addition", /Add a platform/.test(document.querySelector("[data-p-form-title]").textContent));

  const form = document.querySelector("[data-p-form]");
  const beforeBad = fnCalls("platform_save").length;
  form.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
  await wait(60);
  expect("add: an empty name is refused before the server", fnCalls("platform_save").length === beforeBad);
  expect("add: and the sheet says so", document.querySelector("[data-p-form-error]").hidden === false);

  // --- the dialog: a real save
  document.querySelector("[data-p-name]").value = "Threads";
  document.querySelector("[data-p-user]").value = "@cineaura";
  document.querySelector("[data-p-url]").value = "https://www.threads.net/@cineaura";
  document.querySelector("[data-p-logo]").value = "https://example.com/threads.png";
  document.querySelector('[data-p-form-status="unavailable"]').dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  saveAnswer = {
    ok: true,
    row: {
      id: "p-9",
      code: "PLT100015",
      name: "Threads",
      username: "@cineaura",
      url: "https://www.threads.net/@cineaura",
      logo_url: "https://example.com/threads.png",
      icon: "",
      status: "unavailable",
      sort_order: 100,
    },
  };
  form.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
  await wait(160);

  const sent = fnCalls("platform_save").at(-1);
  expect("save: the payload names the platform", sent?.body?.p_name === "Threads", JSON.stringify(sent?.body || {}));
  expect("save: the handle travels", sent?.body?.p_username === "@cineaura");
  expect("save: the link travels", sent?.body?.p_url === "https://www.threads.net/@cineaura");
  expect("save: the logo travels", sent?.body?.p_logo_url === "https://example.com/threads.png");
  expect("save: the status travels", sent?.body?.p_status === "unavailable");
  expect("save: an addition sends no id", sent?.body?.p_id === null, String(sent?.body?.p_id));
  expect("save: the sheet closes", !dialog.hasAttribute("open"));
  expect("save: the row is on the page", document.querySelectorAll("[data-p-row]").length === 4, String(document.querySelectorAll("[data-p-row]").length));
  expect("save: the counts follow", document.querySelector('[data-p-count="all"]').textContent === "4");

  // --- delete: the second click is the one that writes
  const row = [...document.querySelectorAll("[data-p-row]")].find((el) => el.dataset.id === "p-9");
  const danger = row.querySelector("[data-p-remove]");
  const beforeDel = fnCalls("platform_delete").length;
  danger.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await wait(30);
  expect("delete: the first click only asks", fnCalls("platform_delete").length === beforeDel);
  expect("delete: and the button says Remove?", /Remove\?/.test(danger.textContent), danger.textContent.trim());
  danger.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await wait(140);
  expect("delete: the second click writes", fnCalls("platform_delete").length === beforeDel + 1);
  expect("delete: it names the row", fnCalls("platform_delete").at(-1)?.body?.p_id === "p-9");
  expect("delete: the row is gone", ![...document.querySelectorAll("[data-p-row]")].some((el) => el.dataset.id === "p-9"));
  expect("write: no errors", errors.length === 0, errors.join(" | "));
}

/* ================================================================== */
/* pass 5 — the shelf the homepage reads                              */
/* ================================================================== */
{
  const prev = globalThis.fetch;
  globalThis.fetch = (input) => {
    const href = String(input);
    if (fnName(href) === "platform_public") return reply({ ok: true, rows: ROWS.filter((r) => r.status === "available") });
    return reply([]);
  };
  const { loadPlatforms, platformCard, platformHeading, fallbackPlatforms, forgetPlatforms } =
    await import(`file://${join(root, "assets/js/platforms.js")}?p5`);

  const shelf = await loadPlatforms();
  expect("shelf: the table is the source", shelf.source === "db", shelf.source);
  expect("shelf: only what the server sent", shelf.rows.length === 2, String(shelf.rows.length));
  const card = platformCard(shelf.rows[1]);
  expect("shelf: the card carries the name", /Telegram/.test(card));
  expect("shelf: the card carries the handle", /@CineauraV2/.test(card));
  expect("shelf: the card opens the platform", /href="https:\/\/t\.me\/CineauraV2"/.test(card));
  expect("shelf: a logo becomes a picture", /platform-card__logo/.test(card));
  expect("shelf: without a logo, the glyph", /brand-svg/.test(platformCard(shelf.rows[0])) || /svg/.test(platformCard(shelf.rows[0])));
  expect("shelf: the heading counts", platformHeading(14) === "Fourteen places to follow the project", platformHeading(14));
  expect("shelf: one is singular", platformHeading(1) === "One place to follow the project", platformHeading(1));
  expect("shelf: nothing says so", /yet/.test(platformHeading(0)));

  forgetPlatforms();
  globalThis.fetch = () => Promise.reject(new Error("offline"));
  const offline = await loadPlatforms({ fresh: true });
  expect("shelf: offline it falls back to the build's list", offline.source === "fallback", offline.source);
  expect("shelf: and that list is not empty", offline.rows.length === fallbackPlatforms().length && offline.rows.length > 0);
  globalThis.fetch = prev;
}

/* ================================================================== */
/* pass 6 — the files                                                 */
/* ================================================================== */
{
  const html = readFileSync(join(root, "panel.html"), "utf8");
  const page = readFileSync(join(root, "assets/js/panel.js"), "utf8");
  const shelf = readFileSync(join(root, "assets/js/platforms.js"), "utf8");
  const home = readFileSync(join(root, "assets/js/home.js"), "utf8");
  const shell = readFileSync(join(root, "assets/js/shell.js"), "utf8");
  const index = readFileSync(join(root, "index.html"), "utf8");
  const css = readFileSync(join(root, "assets/css/panel.css"), "utf8");
  const sql = readFileSync(join(root, "tools/sql/platforms-page.sql"), "utf8");
  const build = readFileSync(join(root, "tools/build-pages.mjs"), "utf8");

  expect("files: the page loads its own sheet and module", /assets\/css\/panel\.css\?v=/.test(html) && /assets\/js\/app\.js\?v=/.test(html));
  expect("files: the page is the panel", /data-page="panel"/.test(html) && /data-panel/.test(html));
  expect("files: the app boots it", /dataset\.page === "panel"/.test(readFileSync(join(root, "assets/js/app.js"), "utf8")));
  expect("files: the dialog holds every field", ["name", "user", "url", "logo", "icon", "sort"].every((f) => html.includes(`data-p-${f}`)));
  expect("files: the status is a command, not a free field", /data-p-form-status="available"/.test(html) && /data-p-form-status="unavailable"/.test(html));
  expect("files: the logo can be dropped", /data-p-drop/.test(html) && /data-p-file/.test(html));
  expect("files: the page reads the staff list", /rpc\("platform_admin_list"/.test(page));
  expect("files: it writes with save and delete", /rpc\("platform_save"/.test(page) && /rpc\("platform_delete"/.test(page));
  expect("files: an upload lands in the source bucket", /storage\/v1\/object\/source\/\$\{path\}/.test(page) && /users\/platform\//.test(page));
  expect("files: the shelf reads the public door", /rpc\("platform_public"\)/.test(shelf));
  expect("files: the homepage draws it", /loadPlatforms/.test(home) && /paintPlatforms/.test(home));
  expect("files: the homepage heading follows", /data-platform-title/.test(index) && /platformHeading/.test(home));
  expect("files: the footer follows too", /paintFooterDots/.test(shell) && /data-footer-social/.test(shell));
  expect("files: the homepage sidebar starts hidden", /defaultPinned: false/.test(shell), "shell.js");
  expect("files: the SQL creates the table", /create table if not exists public\.platform/i.test(sql));
  expect("files: it carries every column the page writes", ["code", "name", "username", "url", "logo_url", "icon", "status", "sort_order"].every((c) => new RegExp(`^\\s+${c}\\s`, "m").test(sql)));
  expect("files: the status is a closed set", /check \(status in \('available', 'unavailable'\)\)/.test(sql));
  expect("files: the public door grants only the shelf", /grant execute on function public\.platform_public\(\) to anon, authenticated, service_role/.test(sql));
  expect("files: writes ask for staff", /if not public\.site_admin\(p_token\) then/.test(sql));
  expect("files: the logo folder has storage policies", /source_platform_insert/.test(sql) && /users\/platform/.test(sql));
  expect("files: the build no longer generates the page", !/\["panel\.html"/.test(build));
  expect("files: the CSS dresses the head, the rows and the sheet", /\.pnl__head/.test(css) && /\.pfrow/.test(css) && /\.pfedit/.test(css));

  // every class the page wears exists in a stylesheet
  const sheets = ["assets/css/base.css", "assets/css/layout.css", "assets/css/components.css", "assets/css/panel.css"]
    .map((f) => readFileSync(join(root, f), "utf8"))
    .join("\n");
  const worn = new Set();
  const grab = (text) => {
    for (const match of text.matchAll(/class="([^"]+)"/g)) {
      match[1]
        .split(/\s+/)
        .filter((name) => name && !name.includes("${"))
        .forEach((name) => worn.add(name));
    }
  };
  grab(html);
  grab(page);
  const missing = [...worn].filter((name) => !new RegExp(`\\.${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w-])`).test(sheets));
  expect("files: every class the page wears is dressed", missing.length === 0, missing.join(", "));
}

/* ------------------------------------------------------------------ */
const failed = checks.filter((c) => !c.ok);
checks.forEach((c) => {
  if (!c.ok) console.log(`FAIL  ${c.name}${c.detail ? ` → ${c.detail}` : ""}`);
});
console.log(`\npanel: ${checks.length - failed.length}/${checks.length}${failed.length ? ` — ${failed.length} failed` : " pass"}`);
process.exit(failed.length ? 1 : 0);
