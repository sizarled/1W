/**
 * Messages smoke test (jsdom, no network).
 *
 *   node tools/messages-smoke.mjs
 *
 * Pass 1 — the owner opens Messages from the menu: the send form is there, the
 *          three filters carry their counts, the conversations are listed with
 *          preview / unread / suspended chips.
 * Pass 2 — opening a conversation: bubbles (mine on the right), attachments,
 *          and a reply that calls `msg_reply`.
 * Pass 3 — the filters: Active and Suspended ask the server for that filter,
 *          “online only” sends `p_online_only`, and the send form calls
 *          `msg_send` with the recipient, subject, body and files.
 * Pass 4 — a visitor profile: the “Message” button opens Messages with the
 *          username already in the To field.
 */
import { JSDOM } from "jsdom";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const html = readFileSync(join(root, "profile.html"), "utf8").replace(/<script[^>]*src="[^"]*"[^>]*><\/script>/g, "");
const css = readFileSync(join(root, "assets/css/profile.css"), "utf8");

const TOKEN = "d".repeat(64);
const OWNER = {
  id: "6a1c4b0e-3f2d-4a55-9a10-1f0e2d3c4b5a",
  member_id: "ID100003",
  username: "@ledsizar",
  name: "MOUAOUINE EL MEHDI",
  description: "Iam test",
  avatar: null,
  cover: null,
  city: null,
  country: "Morocco",
  language: "en",
  age: null,
  level: 3,
  wealth: 1250,
  membership: "gold",
  online: true,
  created_at: "2026-10-31T23:00:56Z",
};
const OTHER = {
  id: "9b2e5c1d-7a44-4c3b-8f01-2d3e4c5b6a70",
  member_id: null,
  username: "@sara",
  name: "Sara Bennani",
  description: "Writes about cinema.",
  avatar: null,
  cover: null,
  city: "Casablanca",
  country: "Morocco",
  language: "ar",
  age: null,
  level: 2,
  wealth: 90,
  membership: "free",
  online: null,
  created_at: "2026-09-12T10:00:00Z",
};

const SETTINGS = {
  show_country: true,
  show_language: true,
  show_age: false,
  show_level: true,
  show_wealth: false,
  show_connection: true,
  auto_accept_follow: false,
  auto_accept_message: false,
  auto_accept_publish: false,
  auto_accept_participate: false,
  allow_keyword_follows: true,
};

const CONVERSATIONS = [
  {
    id: "c-1",
    code: "CNV-001003",
    subject: "First contact",
    state: "pending",
    last_message_at: new Date(Date.now() - 120000).toISOString(),
    unread: 2,
    preview: "Hello from the studio",
    other: { id: OTHER.id, username: "@sara", name: "Sara Bennani", avatar: null, online: true },
  },
  {
    id: "c-2",
    code: "CNV-001004",
    subject: null,
    state: "active",
    last_message_at: new Date(Date.now() - 86400000).toISOString(),
    unread: 0,
    preview: "See you tomorrow",
    other: { id: "p-2", username: "@amine", name: "Amine", avatar: null, online: false },
  },
];

const THREAD = {
  ok: true,
  conversation: { id: "c-1", code: "CNV-001003", subject: "First contact", state: "active", other: CONVERSATIONS[0].other },
  count: 2,
  messages: [
    {
      id: 1,
      body: "Hello from the studio",
      attachments: [{ name: "brief.pdf", path: "users/messages/brief.pdf", mime: "application/pdf", bytes: 2048, url: null }],
      created_at: new Date(Date.now() - 300000).toISOString(),
      mine: false,
      sender: { username: "@sara", name: "Sara Bennani", avatar: null },
    },
    {
      id: 2,
      body: "Glad to hear it",
      attachments: [],
      created_at: new Date(Date.now() - 120000).toISOString(),
      mine: true,
      sender: { username: "@ledsizar", name: "MOUAOUINE EL MEHDI", avatar: null },
    },
  ],
};

const calls = [];
let scenario = {};

const reply = (data) =>
  Promise.resolve({ ok: true, status: 200, json: async () => data, text: async () => JSON.stringify(data) });

function publicPayload() {
  if (scenario.owner) {
    return {
      ok: true,
      hidden: false,
      profile: OWNER,
      stats: { followers: 12, following: 5, posts: 0, reach: 240, rank_avg: 0 },
      settings: SETTINGS,
      relationship: { is_owner: true, following: "none", follows_you: false, blocked_by_me: false, blocked_me: false, can_follow: false, can_message: false, signed_in: true },
    };
  }
  return {
    ok: true,
    hidden: false,
    profile: OTHER,
    stats: { followers: 3, following: 1, posts: 0, reach: 90, rank_avg: 0 },
    settings: null,
    relationship: { is_owner: false, following: "none", follows_you: false, blocked_by_me: false, blocked_me: false, can_follow: true, can_message: true, signed_in: true },
  };
}

function stubFetch(url, opts = {}) {
  const href = String(url);
  let body = {};
  try {
    body = opts.body ? JSON.parse(opts.body) : {};
  } catch {
    body = {};
  }
  calls.push({ href, body });

  if (href.includes("/rpc/profile_public")) return reply(publicPayload());
  if (href.includes("/rpc/profile_settings_get")) return reply({ ok: true, settings: { ...SETTINGS } });
  if (href.includes("/rpc/profile_follow_lists")) return reply({ ok: true, followers: [], following: [], counts: {} });
  if (href.includes("/rpc/profile_links_list")) return reply({ ok: true, owner: true, links: [] });
  if (href.includes("/rpc/profile_blocks_list")) return reply({ ok: true, blocks: [] });
  if (href.includes("/rpc/profile_feed")) return reply({ ok: true, kind: body.p_kind, count: 0, posts: [] });
  if (href.includes("/rpc/msg_unread")) return reply({ ok: true, unread: 2, suspended: 1 });
  if (href.includes("/rpc/msg_people")) {
    return reply({
      ok: true,
      count: 1,
      people: [{ id: OTHER.id, username: "@sara", name: "Sara Bennani", avatar: null, member_id: null, online: true }],
    });
  }
  if (href.includes("/rpc/msg_list")) {
    const list = body.p_filter === "active" ? CONVERSATIONS.filter((c) => c.state === "active") : body.p_filter === "suspended" ? CONVERSATIONS.filter((c) => c.state !== "active") : CONVERSATIONS;
    return reply({ ok: true, filter: body.p_filter, count: list.length, conversations: list, counts: { all: 2, active: 1, suspended: 1, unread: 2 } });
  }
  if (href.includes("/rpc/msg_thread")) return reply(THREAD);
  if (href.includes("/rpc/msg_send")) {
    return reply({ ok: true, created: true, conversation: { id: "c-9", code: "CNV-001009", subject: body.p_subject, state: "pending" }, message: { id: 9, body: body.p_body, mine: true } });
  }
  if (href.includes("/rpc/msg_reply")) {
    return reply({ ok: true, conversation: { id: body.p_conversation, state: "active" }, message: { id: 10, body: body.p_body, mine: true } });
  }
  if (href.includes("/storage/v1/object/")) return Promise.resolve({ ok: true, status: 200, text: async () => "" });
  if (href.includes("/profiles?")) return reply([]);
  return reply({ ok: true });
}

let runId = 0;

async function boot(pass) {
  scenario = { ...scenario, owner: pass === 1 };
  const dom = new JSDOM(html, { url: "http://localhost/profile.html", pretendToBeVisual: true });
  const { window } = dom;
  const style = window.document.createElement("style");
  style.textContent = css;
  window.document.head.appendChild(style);
  const errors = [];
  window.addEventListener("error", (e) => errors.push(String(e.error || e.message)));
  window.addEventListener("unhandledrejection", (e) => errors.push(String(e.reason)));

  globalThis.window = window;
  globalThis.document = window.document;
  globalThis.HTMLElement = window.HTMLElement;
  globalThis.Element = window.Element;
  globalThis.Node = window.Node;
  globalThis.CustomEvent = window.CustomEvent;
  globalThis.Event = window.Event;
  globalThis.AbortController = window.AbortController || AbortController;
  globalThis.FormData = window.FormData;
  globalThis.localStorage = window.localStorage;
  globalThis.sessionStorage = window.sessionStorage;
  globalThis.getComputedStyle = window.getComputedStyle.bind(window);
  globalThis.requestAnimationFrame = window.requestAnimationFrame.bind(window);
  globalThis.cancelAnimationFrame = window.cancelAnimationFrame.bind(window);
  globalThis.matchMedia = (q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
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
  globalThis.location = {
    search: "",
    hash: "",
    href: "http://localhost/profile.html",
    protocol: "http:",
    pathname: "/profile.html",
    origin: "http://localhost",
    replace(target) {
      this.href = String(target);
    },
  };
  globalThis.fetch = stubFetch;
  window.scrollTo = () => {};

  window.localStorage.clear();
  window.localStorage.setItem("1w.session", TOKEN);
  window.localStorage.setItem("1w.member", JSON.stringify({ id: OWNER.id, memberId: OWNER.member_id, username: OWNER.username, name: OWNER.name, level: 3, points: 1250 }));

  /* every boot needs its own module instance: the listeners bind to that document */
  await import(`file://${join(root, "assets/js/profile.js")}?msg=${pass}&run=${++runId}`);
  await new Promise((r) => setTimeout(r, 220));

  const qs = (sel) => window.document.querySelector(sel);
  const qsa = (sel) => [...window.document.querySelectorAll(sel)];
  const text = (sel) => qs(sel)?.textContent.replace(/\s+/g, " ").trim() || "";
  const click = (el) => el && el.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
  const wait = (ms = 160) => new Promise((r) => setTimeout(r, ms));
  const type = (sel, value) => {
    const node = qs(sel);
    if (!node) throw new Error(`no ${sel}`);
    node.value = value;
    node.dispatchEvent(new window.Event("input", { bubbles: true }));
    return node;
  };
  return { window, document: window.document, qs, qsa, text, click, wait, type, errors };
}

const checks = [];
const expect = (name, ok, detail = "") => checks.push({ name, ok: Boolean(ok), detail });

/* ------------------------------------------------------------------ */
/* pass 1 — the panel                                                  */
/* ------------------------------------------------------------------ */
{
  calls.length = 0;
  const p = await boot(1);

  p.click(p.qs('[data-pf-view="messages"]'));
  await p.wait(400);


  expect("panel: the send form is there", Boolean(p.qs("[data-msg-to]")) && Boolean(p.qs("[data-msg-body]")));
  expect("panel: subject field", Boolean(p.qs("[data-msg-subject]")));
  expect("panel: attachment control", Boolean(p.qs("[data-msg-files]")));
  expect("panel: three filters", p.qsa("[data-msg-filter]").length === 3, String(p.qsa("[data-msg-filter]").length));
  expect("panel: filter counts from the server", p.text('[data-msg-count="all"]') === "2" && p.text('[data-msg-count="suspended"]') === "1", `${p.text('[data-msg-count="all"]')}/${p.text('[data-msg-count="suspended"]')}`);
  expect("panel: conversations listed", p.qsa("[data-msg-open]").length === 2, String(p.qsa("[data-msg-open]").length));
  expect("panel: names and previews", /Sara Bennani/.test(p.text("[data-msg-list]")) && /Hello from the studio/.test(p.text("[data-msg-list]")), p.text("[data-msg-list]").slice(0, 80));
  expect("panel: unread chip", p.qs(".msg-row__unread")?.textContent === "2", p.qs(".msg-row__unread")?.textContent);
  expect("panel: suspended chip", /suspended/.test(p.text("[data-msg-list]")), p.text("[data-msg-list]").slice(0, 120));
  expect("panel: people datalist filled", p.qsa("#pf-msg-people option").length === 1, String(p.qsa("#pf-msg-people option").length));
  expect("panel: the menu shows the unread badge", /2 new/.test(p.text('[data-pf-view="messages"]')), p.text('[data-pf-view="messages"]'));
  expect("panel: no page errors", p.errors.length === 0, p.errors.join(" | "));
}

/* ------------------------------------------------------------------ */
/* pass 2 — a conversation                                             */
/* ------------------------------------------------------------------ */
{
  const p = await boot(1);
  p.click(p.qs('[data-pf-view="messages"]'));
  await p.wait(400);
  p.click(p.qs('[data-msg-open="c-1"]'));
  await p.wait(400);

  expect("thread: bubbles rendered", p.qsa(".msg-bubble").length === 2, String(p.qsa(".msg-bubble").length));
  expect("thread: mine is marked", p.qsa(".msg-bubble.is-mine").length === 1, String(p.qsa(".msg-bubble.is-mine").length));
  expect("thread: attachment listed", /brief.pdf/.test(p.text(".msg-bubble__files")), p.text(".msg-bubble__files"));
  expect("thread: head names the member", /Sara Bennani/.test(p.text(".msg-pane__head")), p.text(".msg-pane__head"));
  expect("thread: the code is shown", /CNV-001003/.test(p.text(".msg-pane__head")), p.text(".msg-pane__head"));

  p.type("[data-msg-reply-input]", "Perfect, thanks");
  p.click(p.qs("[data-msg-reply]"));
  await p.wait(400);
  const replyCall = calls.find((c) => c.href.includes("/rpc/msg_reply"));
  expect("thread: reply calls msg_reply", Boolean(replyCall));
  expect("thread: reply carries the body", replyCall?.body?.p_body === "Perfect, thanks", JSON.stringify(replyCall?.body));
  expect("thread: reply carries the conversation", replyCall?.body?.p_conversation === "c-1", String(replyCall?.body?.p_conversation));
}

/* ------------------------------------------------------------------ */
/* pass 3 — filters, online-only and the send form                     */
/* ------------------------------------------------------------------ */
{
  calls.length = 0;
  const p = await boot(1);
  p.click(p.qs('[data-pf-view="messages"]'));
  await p.wait(400);

  p.click(p.qs('[data-msg-filter="suspended"]'));
  await p.wait(300);
  const suspended = calls.filter((c) => c.href.includes("/rpc/msg_list")).pop();
  expect("filter: suspended asks the server", suspended?.body?.p_filter === "suspended", JSON.stringify(suspended?.body?.p_filter));
  expect("filter: only the suspended row stays", p.qsa("[data-msg-open]").length === 1, String(p.qsa("[data-msg-open]").length));

  p.click(p.qs('[data-msg-filter="active"]'));
  await p.wait(300);
  expect("filter: active asks the server", calls.filter((c) => c.href.includes("/rpc/msg_list")).pop()?.body?.p_filter === "active");

  p.click(p.qs("[data-msg-online]"));
  await p.wait(300);
  expect("filter: online only is sent", calls.filter((c) => c.href.includes("/rpc/msg_list")).pop()?.body?.p_online_only === true);
  expect("filter: the button stays pressed", p.qs("[data-msg-online]")?.getAttribute("aria-pressed") === "true");

  p.click(p.qs('[data-msg-filter="all"]'));
  await p.wait(300);

  calls.length = 0;
  p.type("[data-msg-to]", "@sara");
  p.type("[data-msg-subject]", "About the piece");
  p.type("[data-msg-body]", "Loved the article.");
  p.click(p.qs("[data-msg-send]"));
  await p.wait(500);

  const sendCall = calls.find((c) => c.href.includes("/rpc/msg_send"));
  expect("send: msg_send called", Boolean(sendCall));
  expect("send: recipient by username", sendCall?.body?.p_ref === "@sara", JSON.stringify(sendCall?.body?.p_ref));
  expect("send: subject", sendCall?.body?.p_subject === "About the piece", String(sendCall?.body?.p_subject));
  expect("send: body", sendCall?.body?.p_body === "Loved the article.", String(sendCall?.body?.p_body));
  expect("send: attachments array", Array.isArray(sendCall?.body?.p_attachments) && sendCall.body.p_attachments.length === 0);
  expect("send: the form is cleared", p.qs("[data-msg-body]")?.value === "", p.qs("[data-msg-body]")?.value);
  expect("send: no page errors", p.errors.length === 0, p.errors.join(" | "));
}

/* ------------------------------------------------------------------ */
/* pass 4 — the Message button on a profile                            */
/* ------------------------------------------------------------------ */
{
  const p = await boot(4);
  expect("visitor: message button present", Boolean(p.qs('[data-pf-act="message"]')));
  p.click(p.qs('[data-pf-act="message"]'));
  await p.wait(450);
  expect("visitor: messages open", Boolean(p.qs("[data-msg-to]")));
  expect("visitor: the username is prefilled", p.qs("[data-msg-to]")?.value === "@sara", p.qs("[data-msg-to]")?.value);
  expect("visitor: no page errors", p.errors.length === 0, p.errors.join(" | "));
}

const failed = checks.filter((c) => !c.ok);
console.log(`messages smoke: ${checks.length - failed.length}/${checks.length}`);
failed.forEach((c) => console.log(`  ✗ ${c.name}${c.detail ? ` — ${c.detail}` : ""}`));
if (failed.length) process.exit(1);
process.exit(0);
