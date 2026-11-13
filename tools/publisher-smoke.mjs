/**
 * Publisher smoke test — publisher.html, the program and its links.
 *
 *   node tools/publisher-smoke.mjs
 *
 * The page is the program for creators **outside** the site: the seat, the
 * links, the conversions, the pay table. The desk is gone from it — an owner's
 * publisher writes in creator.html, which is where the content of a hub is
 * made — and this test holds the page to that.
 *
 * Pass 1 — signed out: the program is readable, the seat asks for a session.
 * Pass 2 — the link builder knows the hubs this member writes in.
 * Pass 3 — joining, and the seat that comes back with a code.
 * Pass 4 — the links: built, sent upper-cased, and removed.
 * Pass 5 — a guest reads the program and is offered both ways in.
 * Pass 6 — an old ?studio= link is handed to the creator page.
 * Pass 7 — what the files must carry, and what they must not.
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

/* the program: a guest, then a seat, then its links */
const PROGRAM_VALUES = { signup: 50, activation: 250, membership: 1000 };
let programSeat = null;
let programLinks = [];

function programMe() {
  const totals = programLinks.reduce(
    (sum, link) => ({
      clicks: sum.clicks + link.clicks,
      signups: sum.signups + link.signups,
      points: sum.points + link.points,
    }),
    { clicks: 0, signups: 0, points: 0 }
  );
  return {
    ok: true,
    member: { code: "ID100042", name: "Youssef El Amrani", username: "@youssef.amrani", avatar: "", points: 1250 },
    publisher: programSeat
      ? {
          ...programSeat,
          links: programLinks.length,
          clicks: totals.clicks,
          signups: totals.signups,
          points: totals.points,
        }
      : null,
    links: programLinks,
    conversions: programLinks.filter((link) => link.signups).length
      ? [{ kind: "activation", points: 250, at: new Date(Date.now() - 3600_000).toISOString(), who: "Sara Bennani", link: programLinks[0].label }]
      : [],
    totals: { ...totals, conversions: 0 },
    values: PROGRAM_VALUES,
  };
}

function programFetch(href, opts = {}) {
  const fn = fnName(href);
  const body = opts.body ? JSON.parse(opts.body) : {};
  if (fn === "publisher_me") return reply(programMe());
  if (fn === "publisher_join") {
    programSeat = {
      code: "IDPB100042",
      status: "active",
      channel: body.p_channel,
      place: body.p_place || "",
      audience: Number(body.p_audience) || 0,
      note: "",
      created_at: new Date().toISOString(),
    };
    return reply({ ok: true, publisher: programSeat });
  }
  if (fn === "publisher_link_save") {
    const link = {
      id: `lnk-${programLinks.length + 1}`,
      code: "K7M2QP4X",
      label: body.p_label || "",
      hub: null,
      hub_code: body.p_hub || null,
      hub_kind: body.p_hub ? "blog" : null,
      hub_name: body.p_hub ? "My blog" : null,
      clicks: 0,
      signups: 0,
      points: 0,
      created_at: new Date().toISOString(),
      url: body.p_hub ? `creator.html?studio=${body.p_hub}&ref=K7M2QP4X` : "register.html?ref=K7M2QP4X",
    };
    programLinks = [link, ...programLinks];
    return reply({ ok: true, link });
  }
  if (fn === "publisher_link_delete") {
    const id = body.p_id;
    programLinks = programLinks.filter((link) => link.id !== id);
    return reply({ ok: true });
  }
  if (fn === "publisher_hubs") return reply({ ok: true, hubs: [] });
  return reply([]);
}


/* ================================================================== */
/* pass 1 — signed out                                                */
/* ================================================================== */
{
  const { document, errors, calls, window } = boot("publisher.html", { fetchImpl: () => reply([]) });
  await import(`file://${join(root, "assets/js/publisher.js")}?p1`);
  await wait(160);

  expect("out: the program is the first room", document.querySelector('[data-pub-viewpanel="program"]').hidden === false);
  expect("out: the seat asks for a session", Boolean(document.querySelector('[data-pub-seat] a[href="login.html?next=publisher.html"]')), document.querySelector("[data-pub-seat]").innerHTML.slice(0, 120));
  expect("out: and offers the way in from the register too", Boolean(document.querySelector('[data-pub-seat] a[href="register.html?next=publisher.html"]')));
  expect("out: the guest is asked for the program, not for hubs", calls.some((c) => fnName(c.href) === "publisher_me") && !calls.some((c) => fnName(c.href) === "publisher_hubs"), calls.map((c) => fnName(c.href)).join(","));
  expect("out: there is no desk to open", !document.querySelector("[data-pub-shell]") && !document.querySelector('[data-pub-viewpanel="desk"]'));
  expect("out: the page says where a hub is written", Boolean(document.querySelector(".pub__elsewhere a[href=\"creator.html\"]")), document.querySelector(".pub__elsewhere")?.innerHTML.slice(0, 100));
  expect("out: no errors", errors.length === 0, errors.join(" | "));
  window.close();
}

/* ================================================================== */
/* pass 2 — the link builder and the hubs it offers                   */
/* ================================================================== */
{
  programSeat = { code: "IDPB100042", status: "active", channel: "The Casablanca Letter", place: "Casablanca", audience: 4200, note: "", created_at: new Date().toISOString() };
  programLinks = [];
  const { document, calls, errors, window } = boot("publisher.html", {
    storage: signedIn,
    fetchImpl: (href) => {
      if (fnName(href) === "publisher_hubs") {
        return reply({ ok: true, hubs: [
          { id: "hub-1", code: "IDCN100006", kind: "cinema", name: "Cinema Seven", role: "publisher" },
          { id: "hub-2", code: "IDST100001", kind: "channel", name: "Hello Studio", role: "staff" },
        ] });
      }
      return programFetch(href);
    },
  });
  await import(`file://${join(root, "assets/js/publisher.js")}?p2`);
  await wait(200);

  expect("hubs: the member's hubs are asked for", calls.some((c) => fnName(c.href) === "publisher_hubs"), calls.map((c) => fnName(c.href)).join(","));
  const select = document.querySelector('[data-pub-link-form-el] [name="hub"]');
  expect("hubs: the builder offers them", Boolean(select) && select.options.length === 3, select ? String(select.options.length) : "no select");
  expect("hubs: the whole site first", /register\.html/.test(select?.options[0]?.textContent || ""), select?.options[0]?.textContent);
  expect("hubs: then a hub by its name and code", /Cinema Seven · IDCN100006/.test(select?.options[1]?.textContent || ""), select?.options[1]?.textContent);
  expect("hubs: no errors", errors.length === 0, errors.join(" | "));
  window.close();
}

/* ================================================================== */
/* pass 3 — joining the program                                       */
/* ================================================================== */
{
  programSeat = null;
  programLinks = [];
  const { document, calls, errors, window } = boot("publisher.html", { storage: signedIn, fetchImpl: programFetch });
  await import(`file://${join(root, "assets/js/publisher.js")}?p3`);
  await wait(200);

  expect("program: the seat is asked on boot", calls.some((c) => fnName(c.href) === "publisher_me"), calls.map((c) => fnName(c.href)).join(","));
  expect("program: four numbers", document.querySelectorAll("[data-pub-stats] .pstat").length === 4, String(document.querySelectorAll("[data-pub-stats] .pstat").length));
  expect("program: no code before joining", /Join to get one/.test(document.querySelector("[data-pub-stats]").textContent), document.querySelector("[data-pub-stats]").textContent.trim().slice(0, 60));
  expect("program: the pay table is drawn from the server", /50[\s\S]*250[\s\S]*1,000/.test(document.querySelector('[data-pub-viewpanel="program"]').textContent), "values");
  expect("program: the join form is offered", Boolean(document.querySelector("[data-pub-join]")));

  calls.length = 0;
  const form = document.querySelector("[data-pub-join]");
  form.querySelector('[name="channel"]').value = "The Casablanca Letter";
  form.querySelector('[name="place"]').value = "Casablanca";
  form.querySelector('[name="audience"]').value = "4200";
  form.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
  await wait(260);
  const joined = lastCall(calls, "publisher_join");
  expect("join: the call goes out", Boolean(joined), calls.map((c) => fnName(c.href)).join(","));
  expect("join: it carries where they publish", joined && joined.body.p_channel === "The Casablanca Letter", JSON.stringify(joined && joined.body));
  expect("join: and the audience as a number", joined && joined.body.p_audience === 4200, JSON.stringify(joined && joined.body.p_audience));
  expect("join: the seat comes back with a code", /IDPB100042/.test(document.querySelector("[data-pub-seat]").textContent), document.querySelector("[data-pub-seat]").textContent.trim().slice(0, 80));
  expect("join: the numbers follow the seat", /IDPB100042/.test(document.querySelector("[data-pub-stats]").textContent), document.querySelector("[data-pub-stats]").textContent.trim().slice(0, 60));
  expect("join: the page moves to the links", document.querySelector('[data-pub-viewpanel="links"]').hidden === false);
  expect("join: no errors", errors.length === 0, errors.join(" | "));
  window.close();
}

/* ================================================================== */
/* pass 4 — the links                                                 */
/* ================================================================== */
{
  programSeat = { code: "IDPB100042", status: "active", channel: "The Casablanca Letter", place: "Casablanca", audience: 4200, note: "", created_at: new Date(Date.now() - 30 * 864e5).toISOString() };
  programLinks = [];
  const { document, calls, window, errors } = boot("publisher.html", { url: "publisher.html?tab=links", storage: signedIn, fetchImpl: programFetch });
  await import(`file://${join(root, "assets/js/publisher.js")}?p4`);
  await wait(240);

  expect("links: ?tab=links opens the links", document.querySelector('[data-pub-viewpanel="links"]').hidden === false);
  expect("links: the seat card shows the code", /IDPB100042/.test(document.querySelector("[data-pub-seat]").textContent));
  expect("links: an empty list explains itself", /No link yet/.test(document.querySelector("[data-pub-links]").textContent), document.querySelector("[data-pub-links]").textContent.trim().slice(0, 60));

  calls.length = 0;
  const form = document.querySelector("[data-pub-link-form-el]");
  form.querySelector('[name="label"]').value = "Instagram bio";
  form.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
  await wait(260);
  const savedLink = lastCall(calls, "publisher_link_save");
  expect("links: the save goes out", Boolean(savedLink), calls.map((c) => fnName(c.href)).join(","));
  expect("links: a blank hub is the whole site", savedLink && String(savedLink.body.p_hub) === "", JSON.stringify(savedLink && savedLink.body));
  expect("links: the row is drawn", /Instagram bio/.test(document.querySelector("[data-pub-links]").textContent), document.querySelector("[data-pub-links]").textContent.trim().slice(0, 80));
  expect("links: with its URL", /register\.html\?ref=K7M2QP4X/.test(document.querySelector("[data-pub-links]").textContent), "url");
  expect("links: and its counters", /clicks[\s\S]*sign-ups[\s\S]*points/.test(document.querySelector("[data-pub-links]").textContent), "counters");
  expect("links: the count badge follows", document.querySelector("[data-pub-link-count]").textContent === "1", document.querySelector("[data-pub-link-count]").textContent);

  calls.length = 0;
  const form2 = document.querySelector("[data-pub-link-form-el]");
  form2.querySelector('[name="hubcode"]').value = "idbl100003";
  form2.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
  await wait(260);
  const saved2 = lastCall(calls, "publisher_link_save");
  expect("links: a typed code is sent upper-cased", saved2 && saved2.body.p_hub === "IDBL100003", JSON.stringify(saved2 && saved2.body));

  calls.length = 0;
  document.querySelector("[data-pub-link-del]").dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
  await wait(240);
  expect("links: the remove goes out", calls.some((c) => fnName(c.href) === "publisher_link_delete"), calls.map((c) => fnName(c.href)).join(","));
  expect("links: no errors", errors.length === 0, errors.join(" | "));
  window.close();
}

/* ================================================================== */
/* pass 5 — a guest                                                   */
/* ================================================================== */
{
  programSeat = null;
  programLinks = [];
  const { document, window } = boot("publisher.html", {
    fetchImpl: (href) => {
      if (fnName(href) === "publisher_me") return reply({ ok: true, member: null, publisher: null, links: [], conversions: [], totals: { clicks: 0, signups: 0, points: 0 }, values: PROGRAM_VALUES });
      return reply([]);
    },
  });
  await import(`file://${join(root, "assets/js/publisher.js")}?p5`);
  await wait(200);
  expect("guest: the program is readable", document.querySelector('[data-pub-viewpanel="program"]').hidden === false);
  expect("guest: the seat asks them to sign in", Boolean(document.querySelector('[data-pub-seat] a[href="login.html?next=publisher.html"]')), document.querySelector("[data-pub-seat]").innerHTML.slice(0, 100));
  expect("guest: the ways in are both there", Boolean(document.querySelector('[data-pub-seat] a[href="register.html?next=publisher.html"]')));
  window.close();
}

/* ================================================================== */
/* pass 6 — an old ?studio= link belongs to the creator page          */
/* ================================================================== */
{
  const { document, window } = boot("publisher.html", {
    url: "publisher.html?studio=IDCN100006",
    storage: signedIn,
    fetchImpl: () => reply([]),
  });
  /* jsdom refuses real navigation: a writable stand-in records it instead */
  const sent = [];
  globalThis.location = {
    search: "?studio=IDCN100006",
    href: "http://localhost/publisher.html?studio=IDCN100006",
    pathname: "/publisher.html",
    replace: (url) => sent.push(String(url)),
  };
  await import(`file://${join(root, "assets/js/publisher.js")}?p6`);
  await wait(160);

  expect("handoff: the link is handed over", sent.length === 1, sent.join(","));
  expect("handoff: to the creator page, with the hub", sent[0] === "creator.html?studio=IDCN100006", sent[0]);
  expect("handoff: and nothing is drawn under it", document.querySelector("[data-pub-stats]").innerHTML === "", document.querySelector("[data-pub-stats]").innerHTML.slice(0, 80));
  window.close();
}

/* ================================================================== */
/* pass 7 — the files themselves                                      */
/* ================================================================== */
{
  const html = readFileSync(join(root, "publisher.html"), "utf8");
  const page = readFileSync(join(root, "assets/js/publisher.js"), "utf8");
  const css = readFileSync(join(root, "assets/css/publisher.css"), "utf8");
  const creator = readFileSync(join(root, "assets/js/creator.js"), "utf8");

  expect("files: the page does not load the video editor", !/assets\/js\/video-editor\.js/.test(html));
  expect("files: and carries none of its markup", !/data-ved-shell/.test(html) && !/data-ved-publish/.test(html) && !/data-ved-thumb-file/.test(html));
  expect("files: no desk flag on the body", !/data-ved-embed/.test(html) && !/data-pub-tab/.test(html));
  expect("files: the two rooms are the program and the links", /data-pub-viewpanel="program"/.test(html) && /data-pub-viewpanel="links"/.test(html) && !/data-pub-viewpanel="desk"/.test(html));
  expect("files: it loads its own module", /assets\/js\/publisher\.js\?v=/.test(html) && /assets\/css\/publisher\.css\?v=/.test(html));
  expect("files: the page asks for the publisher's door only", /rpc\("publisher_me"/.test(page) && /rpc\("publisher_hubs"/.test(page) && !/video_/.test(page), "publisher_hubs");
  expect("files: no desk is left in the module", !/data-pub-shell/.test(page) && !/\[data-pub-hub\]/.test(page) && !/ved:published/.test(page));
  expect("files: the CSS dresses no rail", !/\.pub__rail/.test(css) && !/\.pubrow/.test(css) && !/\.pub__tabs/.test(css) && /\.pub__elsewhere/.test(css));
  expect("files: the hub page hands a publisher the writing room", /data-crp-room/.test(creator) && /creator\.html\?section=/.test(creator));
  expect("files: and no longer sends them to the desk", !/publisher\.html\?studio=/.test(creator));
}

/* ------------------------------------------------------------------ */
const failed = checks.filter((c) => !c.ok);
checks.forEach((c) => {
  if (!c.ok) console.log(`FAIL  ${c.name}${c.detail ? ` → ${c.detail}` : ""}`);
});
console.log(`\npublisher: ${checks.length - failed.length}/${checks.length}${failed.length ? ` — ${failed.length} failed` : " pass"}`);
process.exit(failed.length ? 1 : 0);
