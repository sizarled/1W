/**
 * article-editor.html — write, and publish.
 * ------------------------------------------------------------------
 * One page, one call:
 *
 *   article_save(token, {
 *     id?, title, description, body (HTML),
 *     thumbnail, language,
 *     visibility,   general · limited · private · followers
 *     status,       draft · published · scheduled · pending
 *     scheduled_at,
 *     tags[],       the site's own keywords, twelve at most
 *     audience[],   { kind: country|language|level|entity, value, mode: include }
 *     profiles[],   the members a private piece opens to
 *     passwords[],  hashed by the server, never readable again
 *     meta{ place: content|help, field, category, main_keyword, sub_keywords, help }
 *   })
 *
 * ?id=PST-001015 edits an existing piece: the form is filled from
 * article_get and the code rides back in the payload.
 *
 * A piece that goes to a Help section is sent for review: the server
 * keeps it `pending`, the moderators decide, and it is always public —
 * a help page nobody can read is not a help page.
 *
 * ------------------------------------------------------------------
 * Two kinds, one engine
 * ------------------------------------------------------------------
 * The same page asks a question and writes a piece. `question-editor.html`
 * says `<body data-ae-kind="question">` and the engine changes its clothes:
 *
 *   the title is *the question*, the body needs six words instead of twelve,
 *   the button asks instead of publishing, an **Attachments** panel appears
 *   (pictures, video, documents and archives, up to five), the draft lives
 *   under another key, and the save goes to `question_save` instead of
 *   `article_save` — a question is a row of `posts` with
 *   `content_type = 'question'`, so it gets the same audience, the same
 *   private list, the same passwords and the same schedule a piece gets.
 *
 * Everything else — the toolbar, Import HTML, the contents rail, the
 * keywords, the doors, the reader preview — is the code below, unchanged.
 *
 * Embedded in the studio
 * ------------------------------------------------------------------
 * creator.html does not keep a second, thinner article form: the blog's
 * *Article · new* is **this** editor, in the page. `<body data-ae-embed="1">`
 * says so, and the studio opens it with an event:
 *
 *   document.dispatchEvent(new CustomEvent("ae:open",
 *     { detail: { hub: "IDBL100003", hubName, field, id? } }))
 *
 * In that mode the piece goes into that blog (`hub` rides in the payload, and
 * `article_save` checks the member may write there), the Content/Help choice is
 * gone — a blog is not the site's Help — and nothing navigates: the editor
 * answers `ae:published` / `ae:drafted` and the studio takes it from there.
 */
import { rpc } from "./data.js";
import { qs, qsa, esc, compact, timeAgo } from "./utils.js";
import { icon } from "./icons.js";
import { toast } from "./ui.js";
import { sessionToken } from "./session.js";
import { COUNTRIES } from "./countries.js";
import { wordsIn, readingTime, sanitizeHtml, firstImage } from "./article-text.js";
import { SUPABASE, storageUrl } from "./config.js";
import { createRte } from "./rte.js";
import { createContents, rowLabel } from "./contents.js";

/* the studio embeds this editor: the flag is on <body data-ae-embed="1"> */
const EMBED = document.body.dataset.aeEmbed === "1";

/* article, or question — the page says which, and the studio can change it */
let docKind = document.body.dataset.aeKind === "question" ? "question" : "article";
const isQuestion = () => docKind === "question";

const S = {
  hub: "",
  hubName: "",
  hubField: "",
  token: "",
  code: "",
  title: "",
  desc: "",
  html: "",
  field: "",
  category: "",
  keyword: "",
  subs: [],
  otherMeta: {},
  attachments: [],
  place: "content",
  help: "",
  tags: [],
  language: "en",
  thumb: "",
  vis: "general",
  countries: [],
  langs: [],
  lvMin: 1,
  lvMax: 10,
  people: [],
  passes: [],
  hasPassword: false,
  when: "now",
  whenAt: "",
  status: "draft",
  /* an owner's publisher writes here, and the owner publishes: nothing this
     room saves goes out by itself */
  draftOnly: false,
  busy: false,
  mine: [],
  fields: [],
};

const LANGUAGES = [
  ["en", "English"],
  ["ar", "Arabic"],
  ["fr", "French"],
  ["es", "Spanish"],
  ["de", "German"],
  ["it", "Italian"],
  ["pt", "Portuguese"],
  ["tr", "Turkish"],
];

const HELP_TREE = {
  Account: ["Signing in", "Recovery and codes", "Linking an account", "Leaving"],
  Playback: ["The player", "Subtitles and languages", "Quality and data", "Devices"],
  Publishing: ["Articles", "Videos", "Who may read it", "Moderation"],
  Points: ["Earning", "Spending", "Levels", "Withdrawals"],
  Membership: ["Activation", "Premium months", "Codes", "Refunds"],
};

const VIS_HINT = {
  general: "Everyone, except the members you exclude. No account, no condition.",
  limited: "Only the audience below — a country, a language, a level, or a member you name. Any one of them is enough.",
  private: "Only the members you nominate, and whoever holds one of your passwords.",
  followers: "Only the people who follow you. Nobody else, whatever their level.",
};

const ERRORS = {
  session: "Your session ended — sign in again.",
  title: "A title is needed.",
  title_long: "The title is longer than 200 characters.",
  body: "A published article needs a body.",
  visibility: "Pick everyone, an audience, private or followers.",
  status: "That status is not one we know.",
  schedule: "A scheduled piece needs a moment in the future.",
  embed: "That link is not a link we can open.",
  profile: "Your member profile is missing — open your profile once, then come back.",
  role: "That article belongs to someone else.",
  not_found: "That article is gone.",
};

const $ = (sel) => qs(sel);
let rte = null;
let contents = null;

/* ================================================================== */
/* helpers                                                            */
/* ================================================================== */
function isoLocal(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function whenDate() {
  if (S.when === "now") return null;
  if (!S.whenAt) return null;
  const date = new Date(S.whenAt);
  return Number.isNaN(date.getTime()) ? null : date;
}

function randomPassword() {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  const bytes = new Uint32Array(12);
  try {
    crypto.getRandomValues(bytes);
  } catch {
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.random() * 4294967296;
  }
  let out = "";
  for (let i = 0; i < 12; i += 1) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

function bodyHtml() {
  const body = $("[data-e-body]");
  if (!body) return S.html;
  return body.innerHTML;
}

/* ================================================================== */
/* the draft on this device                                           */
/* ================================================================== */
/* a question and a piece are not the same draft */
const draftKey = () => (isQuestion() ? "1w.questions.draft" : "1w.articles.draft");
let draftTimer = null;

function draftFields() {
  return {
    code: S.code,
    savedAt: new Date().toISOString(),
    title: S.title,
    desc: S.desc,
    html: S.html,
    field: S.field,
    category: S.category,
    keyword: S.keyword,
    subs: S.subs,
    otherMeta: S.otherMeta,
    attachments: S.attachments,
    tags: S.tags,
    language: S.language,
    thumb: S.thumb,
    place: S.place,
    help: S.help,
    vis: S.vis,
    countries: S.countries,
    langs: S.langs,
    lvMin: S.lvMin,
    lvMax: S.lvMax,
  };
}

function writeDraft() {
  try {
    localStorage.setItem(draftKey(), JSON.stringify(draftFields()));
    paintStatus();
  } catch {
    /* storage full or blocked — the piece is still on screen */
  }
}

/** Two seconds after the last keystroke, the draft is on the device. */
function scheduleDraft() {
  clearTimeout(draftTimer);
  draftTimer = setTimeout(writeDraft, 900);
}

function readDraft() {
  try {
    const raw = localStorage.getItem(draftKey());
    if (!raw) return null;
    const draft = JSON.parse(raw);
    if (!draft) return null;
    if (!draft.title && !draft.html) return null;
    if ((draft.code || "") !== (S.code || "")) return null;
    return draft;
  } catch {
    return null;
  }
}

function clearDraft() {
  clearTimeout(draftTimer);
  try {
    localStorage.removeItem(draftKey());
  } catch {
    /* nothing to clear */
  }
}

function restoreDraft(draft) {
  S.title = draft.title || "";
  S.desc = draft.desc || "";
  S.html = draft.html || "";
  S.field = draft.field || "";
  S.category = draft.category || "";
  S.keyword = draft.keyword || "";
  S.subs = Array.isArray(draft.subs) ? draft.subs.slice(0, LONGTAIL_MAX) : [];
  S.otherMeta = draft.otherMeta && typeof draft.otherMeta === "object" ? draft.otherMeta : {};
  S.attachments = Array.isArray(draft.attachments) ? draft.attachments.filter((file) => file && file.url) : [];
  S.tags = Array.isArray(draft.tags) ? draft.tags.slice(0, 12) : [];
  S.language = draft.language || "en";
  S.thumb = draft.thumb || "";
  S.place = draft.place === "help" ? "help" : "content";
  S.help = draft.help || "";
  S.vis = draft.vis || "general";
  S.countries = Array.isArray(draft.countries) ? draft.countries : [];
  S.langs = Array.isArray(draft.langs) ? draft.langs : [];
  S.lvMin = Number(draft.lvMin) || 1;
  S.lvMax = Number(draft.lvMax) || 10;
}

function sync() {
  const title = $("[data-e-title]");
  const desc = $("[data-e-desc]");
  const field = $("[data-e-field]");
  const category = $("[data-e-category]");
  const keyword = $("[data-e-keyword]");
  const lang = $("[data-e-lang]");
  if (title) S.title = title.value;
  if (desc) S.desc = desc.value;
  if (field) S.field = field.value;
  if (category) S.category = category.value;
  if (keyword) S.keyword = keyword.value;
  S.subs = qsa("[data-e-sub-keyword]").map((input) => input.value);
  if (lang) S.language = lang.value || "en";
  S.html = bodyHtml();
}

/* ================================================================== */
/* the piece's own counters                                           */
/* ================================================================== */
function paintCounts() {
  const titleCount = $("[data-e-title-count]");
  if (titleCount) {
    const n = S.title.trim().length;
    titleCount.textContent = `${n} / 200`;
    titleCount.classList.toggle("is-over", n > 200);
  }
  const words = wordsIn(S.html);
  const wordEl = $("[data-e-words]");
  const readEl = $("[data-e-reading]");
  if (wordEl) wordEl.textContent = `${words} ${words === 1 ? "word" : "words"}`;
  if (readEl) readEl.textContent = `${readingTime(S.html)} min read`;
  const tagCount = $("[data-e-tag-count]");
  if (tagCount) tagCount.textContent = `${S.tags.length} / 12 tags`;
}

function paintChips() {
  const host = $("[data-e-chips]");
  if (!host) return;
  host.innerHTML = S.tags
    .map(
      (tag, index) =>
        `<span class="atag">${esc(tag)}<button class="atag__x" type="button" data-e-tag-rm="${index}" aria-label="Remove ${esc(tag)}">${icon("close")}</button></span>`
    )
    .join("");
}

function paintCover() {
  const frame = $("[data-e-cover-frame]");
  if (!frame) return;
  frame.innerHTML = S.thumb
    ? `<img src="${esc(S.thumb)}" alt="" /><button class="atool" type="button" data-e-cover-clear title="Remove the cover" style="position:absolute;top:.4rem;right:.4rem;background:var(--surface-2)">${icon("trash")}</button>`
    : `<span class="acover__empty">${icon("image")}<span>No cover yet</span><span style="opacity:.7">The first image in the piece works too</span></span>`;
}

function paintVis() {
  const seg = $("[data-e-vis]");
  if (seg) {
    qsa("[data-vis]", seg).forEach((btn) => {
      const on = btn.getAttribute("data-vis") === S.vis;
      btn.classList.toggle("is-active", on);
      btn.setAttribute("aria-pressed", String(on));
    });
  }
  const hint = $("[data-e-vis-hint]");
  if (hint) hint.textContent = VIS_HINT[S.vis] || "";
  const label = $("[data-e-vis-label]");
  if (label) {
    label.textContent =
      { general: "Everyone", limited: "An audience", private: "Private", followers: "Followers" }[S.vis] || "";
  }
  const audience = $("[data-e-audience]");
  const priv = $("[data-e-private]");
  if (audience) audience.hidden = S.vis !== "limited";
  if (priv) priv.hidden = S.vis !== "private";
}

function paintAudience() {
  const countrySel = $("[data-e-country-sel]");
  if (countrySel && !countrySel.options.length) {
    countrySel.innerHTML =
      `<option value="">Add a country…</option>` +
      COUNTRIES.map((row) => `<option value="${esc(row.name)}">${esc(row.name)}</option>`).join("");
  }
  const langSel = $("[data-e-lang-sel]");
  if (langSel && !langSel.options.length) {
    langSel.innerHTML =
      `<option value="">Add a language…</option>` +
      LANGUAGES.map(([code, label]) => `<option value="${code}">${esc(label)}</option>`).join("");
  }
  const countries = $("[data-e-countries]");
  if (countries) {
    countries.innerHTML = S.countries.length
      ? S.countries
          .map(
            (name) =>
              `<span class="atag">${esc(name)}<button class="atag__x" type="button" data-e-country-rm="${esc(name)}" aria-label="Remove ${esc(name)}">${icon("close")}</button></span>`
          )
          .join("")
      : `<span class="apanel__hint" style="margin:0">Any country</span>`;
  }
  const langs = $("[data-e-langs]");
  if (langs) {
    langs.innerHTML = S.langs.length
      ? S.langs
          .map((code) => {
            const label = (LANGUAGES.find((row) => row[0] === code) || [code, code])[1];
            return `<span class="atag">${esc(label)}<button class="atag__x" type="button" data-e-lang-rm="${esc(code)}" aria-label="Remove ${esc(label)}">${icon("close")}</button></span>`;
          })
          .join("")
      : `<span class="apanel__hint" style="margin:0">Any language</span>`;
  }
  const min = $("[data-e-lv-min]");
  const max = $("[data-e-lv-max]");
  if (min) min.value = String(S.lvMin);
  if (max) max.value = String(S.lvMax);
}

function paintPrivate() {
  qsa("[data-e-people]").forEach((people) => {
    people.innerHTML = S.people.length
      ? S.people
          .map(
            (who) =>
              `<div class="arow"><span>${esc(who)}</span><span class="arow__acts"><button class="atool" type="button" data-e-person-rm="${esc(who)}" aria-label="Remove ${esc(who)}">${icon("close")}</button></span></div>`
          )
          .join("")
      : `<p class="apanel__hint" style="margin:0">Nobody named yet.</p>`;
  });
  qsa("[data-e-passes]").forEach((passes) => {
    passes.innerHTML = S.passes.length
      ? S.passes
          .map(
            (pass, index) =>
              `<div class="arow"><code style="font-size:.78rem;color:var(--text)">${esc(pass)}</code><span class="arow__acts">
                 <button class="atool" type="button" data-e-pass-copy="${index}" aria-label="Copy">${icon("link")}</button>
                 <button class="atool" type="button" data-e-pass-rm="${index}" aria-label="Remove">${icon("close")}</button>
               </span></div>`
          )
          .join("")
      : `<p class="apanel__hint" style="margin:0">${
          S.hasPassword
            ? "This piece already has a password. It cannot be read back — add a new one to replace it."
            : "No password yet. Anyone on the list can still read it."
        }</p>`;
  });
}

function paintPlace() {
  const seg = $("[data-e-place]");
  if (isQuestion()) {
    /* a question has no Help section and no field ladder: it goes to the space
       it was asked in, open to whoever the door allows */
    if (seg) seg.hidden = true;
    const help = $("[data-e-help]");
    if (help) help.hidden = true;
    const hint = $("[data-e-place-hint]");
    if (hint) {
      hint.textContent = EMBED
        ? `It is asked in ${S.hubName || "this hub"} — open to whoever your door below allows.`
        : "It goes to the space you ask it in, open to whoever your door below allows.";
    }
    const label = $("[data-e-place-label]");
    if (label) label.textContent = EMBED ? S.hubName || "This space" : "Question";
    return;
  }
  if (seg && EMBED) {
    /* in a blog there is nothing to choose: it goes into this blog, and the
       site's Help is not the blog's business */
    seg.hidden = true;
  }
  if (seg && !EMBED) {
    qsa("[data-place]", seg).forEach((btn) => {
      const on = btn.getAttribute("data-place") === S.place;
      btn.classList.toggle("is-active", on);
      btn.setAttribute("aria-pressed", String(on));
    });
  }
  const help = $("[data-e-help]");
  if (help) help.hidden = S.place !== "help";
  const select = $("[data-e-help-sel]");
  if (select && !select.options.length) {
    select.innerHTML =
      `<option value="">Pick a section…</option>` +
      Object.entries(HELP_TREE)
        .map(
          ([parent, children]) =>
            `<optgroup label="${esc(parent)}">` +
            children.map((child) => `<option value="${esc(`${parent} › ${child}`)}">${esc(child)}</option>`).join("") +
            `</optgroup>`
        )
        .join("");
  }
  if (select) select.value = S.help;
  const hint = $("[data-e-place-hint]");
  if (hint) {
    hint.textContent = EMBED
      ? `It is published in ${S.hubName || "this hub"} — open to whoever your door below allows.`
      : S.place === "help"
        ? "Help pages go to the moderators for review, and they are always public — a help page nobody can read helps nobody."
        : "Content goes straight to the index, in the field you named, open to whoever your door allows.";
  }
  const label = $("[data-e-place-label]");
  if (label) label.textContent = EMBED ? S.hubName || "This hub" : S.place === "help" ? "Help · review" : "Content";
}

function paintWhen() {
  const seg = $("[data-e-when]");
  if (seg && S.draftOnly) {
    seg.hidden = true;
    const at = $("[data-e-when-at]");
    if (at) at.hidden = true;
    return;
  }
  if (seg) {
    seg.hidden = false;
    qsa("[data-when]", seg).forEach((btn) => {
      const on = btn.getAttribute("data-when") === S.when;
      btn.classList.toggle("is-active", on);
      btn.setAttribute("aria-pressed", String(on));
    });
  }
  const at = $("[data-e-when-at]");
  if (at) {
    at.hidden = S.when !== "later";
    if (S.whenAt && at.value !== S.whenAt) at.value = S.whenAt;
    if (!at.value && S.when === "later" && !S.whenAt) {
      const soon = new Date(Date.now() + 60 * 60000);
      at.value = isoLocal(soon);
      S.whenAt = at.value;
    }
  }
}

function paintFields() {
  const list = $("[data-e-fields]");
  if (!list) return;
  list.innerHTML = S.fields.map((row) => `<option value="${esc(row.name)}"></option>`).join("");
}

/* ================================================================== */
/* the contents                                                       */
/* ================================================================== */
/*
 * The index of the piece is the piece: every H2, H3 and H4 in the body, in
 * order, listed in the side column. Press one and the page goes there and
 * the caret lands inside the heading — so the writer carries on from that
 * line rather than from the top of a long article.
 */
function contentsItems() {
  const body = $("[data-e-body]");
  if (!body) return [];
  return [...body.querySelectorAll("h2, h3, h4")].map((node) => ({
    node,
    level: Number(node.tagName.slice(1)),
    label: rowLabel(node) || "An untitled heading",
  }));
}

function paintContents() {
  if (!contents) return;
  const items = contentsItems();
  contents.paint(items);
  const count = $("[data-e-toc-count]");
  if (count) count.textContent = items.length ? `${items.length} heading${items.length === 1 ? "" : "s"}` : "";
}

/** Go there: the page scrolls, the heading lights, the caret moves in. */
function jumpToHeading(item) {
  const node = item && item.node;
  if (!node || !node.isConnected) return;
  node.scrollIntoView?.({ behavior: "smooth", block: "center" });
  node.classList.add("is-jump");
  setTimeout(() => node.classList.remove("is-jump"), 1400);

  /* the body takes the focus first: focusing is what can drop a caret, so the
     range goes in after it, never before */
  $("[data-e-body]")?.focus({ preventScroll: true });
  const range = document.createRange();
  range.selectNodeContents(node);
  range.collapse(true);
  const selection = document.getSelection ? document.getSelection() : window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

/* ================================================================== */
/* the keywords                                                       */
/* ================================================================== */
/*
 * A piece is found by the words people type, so the old ladder — niche, then
 * micro, then nano — became two rungs that mean something:
 *
 *   main keyword   three words at most        الربح من الانترنت
 *   long tails     five words at least, each  الربح من الانترنت من خلال بيع الصور
 *                  carrying the main keyword
 *
 * Five long tails at most, and none can be named before there is a main
 * keyword to hang it on — the same "one cannot be named before the thing
 * above it exists" rule the old ladder had.
 */
const KEYWORD_WORDS = 3;
const LONGTAIL_WORDS = 5;
const LONGTAIL_MAX = 5;

const wordsOf = (text) => String(text || "").trim().split(/\s+/).filter(Boolean);

/** The words as words: punctuation on the edges taken off, case put down. */
const flatOf = (text) =>
  wordsOf(text)
    .map((word) => word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ""))
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

/** The head as a whole phrase inside the tail — not as a stray run of letters. */
const carries = (head, tail) => ` ${flatOf(tail)} `.includes(` ${flatOf(head)} `);

function mainKeywordState() {
  const words = wordsOf(S.keyword);
  if (!words.length) return { ok: false, empty: true, words: 0, why: "" };
  if (words.length > KEYWORD_WORDS) {
    return { ok: false, empty: false, words: words.length, why: `${words.length} words — three at most.` };
  }
  return { ok: true, empty: false, words: words.length, why: "" };
}

function subKeywordState(text) {
  const words = wordsOf(text);
  const head = mainKeywordState();
  const name = wordsOf(S.keyword).join(" ");
  if (!words.length) return { ok: false, empty: true, words: 0, why: "" };
  if (!head.ok) return { ok: false, empty: false, words: words.length, why: "A main keyword first." };
  if (!carries(S.keyword, text)) {
    return { ok: false, empty: false, words: words.length, why: `It has to carry “${name}”.` };
  }
  if (words.length < LONGTAIL_WORDS) {
    return { ok: false, empty: false, words: words.length, why: `${words.length} words — five at least.` };
  }
  return { ok: true, empty: false, words: words.length, why: `${words.length} words, with “${name}” in it.` };
}

/** Both rungs, counted and judged as they are typed. */
function paintKeywords() {
  const head = mainKeywordState();
  const count = $("[data-e-main-count]");
  if (count) {
    count.textContent = `${head.words} / ${KEYWORD_WORDS} words`;
    count.classList.toggle("is-over", head.words > KEYWORD_WORDS);
  }

  const main = $("[data-e-keyword]");
  if (main) main.classList.toggle("is-bad", !head.ok && !head.empty);

  let good = 0;
  qsa("[data-e-sub-keyword]").forEach((input) => {
    input.disabled = !head.ok;
    const state = subKeywordState(input.value);
    if (state.ok) good += 1;
    input.classList.toggle("is-bad", !state.ok && !state.empty);
    const say = input.parentElement?.querySelector("[data-e-sub-say]");
    if (say) {
      say.textContent = state.why;
      say.classList.toggle("is-ok", state.ok);
      say.classList.toggle("is-bad", !state.ok && !state.empty);
    }
  });

  const total = $("[data-e-sub-count]");
  if (total) total.textContent = `${good} / ${LONGTAIL_MAX}`;
}

/** The state, put back into the five boxes and the one above them. */
function fillKeywords() {
  const main = $("[data-e-keyword]");
  if (main) main.value = S.keyword;
  qsa("[data-e-sub-keyword]").forEach((input, index) => {
    input.value = S.subs[index] || "";
  });
  paintKeywords();
}

/** What the editor does not edit, it does not throw away. */
const MANAGED_META = ["place", "field", "category", "help", "main_keyword", "sub_keywords", "attachments"];

function otherMetaOf(meta) {
  const keep = {};
  Object.keys(meta || {}).forEach((key) => {
    const value = meta[key];
    if (!MANAGED_META.includes(key) && value !== null && value !== undefined && value !== "") keep[key] = value;
  });
  return keep;
}

/* ================================================================== */
/* readiness                                                          */
/* ================================================================== */
function checks() {
  sync();
  const list = [];
  const words = wordsIn(S.html);
  list.push({ label: "A title", ok: S.title.trim().length > 0 && S.title.trim().length <= 200 });
  list.push({
    label: isQuestion() ? "A question — six words at least" : "A body",
    ok: words >= (isQuestion() ? 6 : 1),
  });
  /* a question is asked in a space, so it has no shelf of its own to pick */
  if (!isQuestion()) {
    list.push({ label: "A field", ok: S.place === "help" ? Boolean(S.help) : Boolean(S.field.trim()) });
  }
  if (S.place === "help") list.push({ label: "A help section", ok: Boolean(S.help) });
  if (S.vis === "limited") {
    list.push({
      label: "An audience condition",
      ok: S.countries.length + S.langs.length + S.people.length > 0 || S.lvMin > 1 || S.lvMax < 10,
    });
  }
  if (S.vis === "private") {
    list.push({ label: "A member or a password", ok: S.people.length + S.passes.length + (S.hasPassword ? 1 : 0) > 0 });
  }
  if (S.when === "later") {
    const date = whenDate();
    list.push({ label: "A moment in the future", ok: Boolean(date) && date.getTime() > Date.now() + 30000 });
  }
  return list;
}

function readiness() {
  const list = checks();
  const missing = list.find((row) => !row.ok);
  if (missing) return { ok: false, message: missing.label };
  return { ok: true, message: S.code ? "Ready to save your changes" : "Ready to publish" };
}

function paintChecks() {
  const host = $("[data-e-checks]");
  if (!host) return;
  host.innerHTML = checks()
    .map(
      (row) =>
        `<div class="acheck-row ${row.ok ? "is-ok" : ""}">${icon(row.ok ? "check" : "minus")} <span>${esc(row.label)}</span></div>`
    )
    .join("");
}

function paintStatus() {
  const line = $("[data-e-status]");
  if (!line) return;
  const place = S.place === "help" ? `Help${S.help ? ` · ${S.help}` : ""}` : `Content${S.field ? ` · ${S.field}` : ""}`;
  let text = "";
  let iconName = "info";
  if (S.busy) {
    text = "Saving…";
    iconName = "refresh";
  } else if (S.status === "published" && S.code) {
    text = `Published in ${place}.`;
    iconName = "check";
  } else if (S.status === "scheduled" && S.code) {
    text = `Scheduled for ${new Date(S.whenAt || Date.now()).toLocaleString()}.`;
    iconName = "clock";
  } else if (S.status === "pending" && S.code) {
    text = `Waiting for the moderators in ${place}.`;
    iconName = "clock";
  } else if (S.code) {
    text = `Saved as a draft · ${place}`;
    iconName = "pen";
  } else {
    text = "Nothing saved yet.";
    iconName = "info";
  }
  let draftNote = "";
  try {
    const raw = localStorage.getItem(draftKey());
    const kept = raw ? JSON.parse(raw) : null;
    if (kept && kept.savedAt) {
      const at = new Date(kept.savedAt);
      draftNote = ` <span style="opacity:.65">· on this device ${esc(at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }))}</span>`;
    }
  } catch {
    /* no draft, or storage blocked */
  }
  line.innerHTML = `${icon(iconName)} <span>${esc(text)}</span>${draftNote}`;

  const publish = $("[data-e-publish]");
  if (publish) {
    publish.disabled = S.busy;
    const askLabel = isQuestion() ? (S.code ? "Save and publish" : "Ask the question") : S.code ? "Save and publish" : "Publish";
    publish.innerHTML = S.draftOnly
      ? `${icon("send")} Send to the owner`
      : S.place === "help"
        ? `${icon("send")} Send for review`
        : `${icon("upload")} ${askLabel}`;
  }
  const draft = $("[data-e-draft]");
  if (draft) draft.disabled = S.busy;
  const kind = $("[data-e-status-kind]");
  if (kind) kind.textContent = S.code || "";
}

function paintMine() {
  const host = $("[data-e-mine]");
  const count = $("[data-e-mine-count]");
  if (!host) return;
  if (!S.mine.length) {
    host.innerHTML = `<p class="apanel__hint" style="margin:0">Nothing yet.</p>`;
    if (count) count.textContent = "";
    return;
  }
  if (count) count.textContent = `${S.mine.length}`;
  host.innerHTML = S.mine
    .slice(0, 12)
    .map(
      (row) => `
      <a href="${isQuestion() ? "question-editor.html" : "article.html"}?id=${encodeURIComponent(row.code || row.id)}">
        <span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(row.title || "Untitled")}</span>
        <span>${esc(row.status === "published" ? timeAgo(row.published_at) : row.status)}</span>
      </a>`
    )
    .join("");
}

/**
 * The clothes the kind wears: the title's own name, the button's own verb, the
 * attachments panel (a question has one, a piece does not) and the draft note.
 */
function paintKind() {
  document.body.dataset.aeKind = docKind;
  const question = isQuestion();

  const attach = $("[data-e-attach]");
  if (attach) attach.hidden = !question;

  const title = $("[data-e-title]");
  if (title) title.placeholder = question ? "The question" : "The title";
  const desc = $("[data-e-desc]");
  if (desc) desc.placeholder = question ? "What you already know, and what you are asking" : "One or two lines under the title";

  /* a question has no shelf to pick: the field goes with the ladder */
  const field = $("[data-e-field]");
  if (field) {
    const box = field.closest("label");
    if (box) box.hidden = question;
  }

  const ready = $("[data-e-ready-title]");
  if (ready) ready.textContent = question ? "Ready to ask?" : "Ready?";
  const mine = $("[data-e-mine-title]");
  if (mine) mine.textContent = question ? "Your questions" : "In your name";

  paintAttachments();
  paintPlace();
  paintStatus();
  paintChecks();
}

function paintAll() {
  paintCounts();
  paintChips();
  paintCover();
  paintVis();
  paintAudience();
  paintPrivate();
  paintPlace();
  paintWhen();
  paintFields();
  paintKeywords();
  paintContents();
  paintAttachments();
  paintChecks();
  paintStatus();
  paintMine();
}

/* ================================================================== */
/* the payload                                                        */
/* ================================================================== */
function audienceRules() {
  const rules = [];
  if (S.vis !== "limited") return rules;
  S.countries.forEach((name) => rules.push({ kind: "country", value: name, mode: "include" }));
  S.langs.forEach((code) => rules.push({ kind: "language", value: code, mode: "include" }));
  const min = Math.max(1, Math.min(10, Number(S.lvMin) || 1));
  const max = Math.max(1, Math.min(10, Number(S.lvMax) || 10));
  if (!(min <= 1 && max >= 10)) {
    for (let level = Math.min(min, max); level <= Math.max(min, max); level += 1) {
      rules.push({ kind: "level", value: String(level), mode: "include" });
    }
  }
  S.people.forEach((who) => rules.push({ kind: "entity", value: who, mode: "include" }));
  return rules;
}

function payload(status) {
  sync();
  const place = EMBED ? "content" : S.place;
  const meta = {
    ...S.otherMeta,
    place,
    /* a question is asked in a space, and a space has no shelf to sort it into */
    field: place === "help" || isQuestion() ? "" : S.field.trim(),
    category: S.category.trim(),
    main_keyword: S.keyword.trim(),
    sub_keywords: S.subs
      .map((word) => String(word || "").trim())
      .filter(Boolean)
      .slice(0, LONGTAIL_MAX),
    help: place === "help" ? S.help : "",
  };
  if (isQuestion()) {
    meta.attachments = S.attachments.map((file) => ({ name: file.name, url: file.url, size: file.size, type: file.type }));
  }
  const body = {
    id: S.code || null,
    /* the blog it belongs to: only ever set by the studio's embedded form */
    hub: S.hub || null,
    title: S.title.trim(),
    description: S.desc.trim() || null,
    body: S.html,
    thumbnail: (S.thumb || firstImage(S.html) || "").trim() || null,
    language: S.language,
    visibility: place === "help" ? "general" : S.vis,
    status,
    scheduled_at: status === "scheduled" ? (whenDate() || new Date()).toISOString() : null,
    tags: S.tags.slice(0, 12),
    audience: audienceRules(),
    profiles: S.vis === "private" ? S.people : [],
    meta,
  };
  /* a password we were never shown is a password we must not wipe */
  if (S.passes.length) body.passwords = S.passes;
  return body;
}

/** What the publish button means, in one place: the keyboard gets the same. */
function publishStatus() {
  /* a publisher's seat hands the piece over; the owner publishes it */
  if (S.draftOnly) return "draft";
  if (S.place === "help") return "pending";
  return S.when === "later" ? "scheduled" : "published";
}

async function save(status) {
  if (S.busy) return;
  sync();

  if (!S.title.trim()) {
    toast({ title: "A title first", message: "Even a draft needs a name.", tone: "error" });
    $("[data-e-title]")?.focus();
    return;
  }

  let finalStatus = status;
  if (S.place === "help" && status !== "draft") finalStatus = "pending";

  if (status !== "draft") {
    const check = readiness();
    if (!check.ok) {
      toast({ title: "Not yet", message: `Still missing: ${check.message}.`, tone: "error", iconName: "info" });
      return;
    }
    if (S.place === "help" && !S.help) {
      toast({ title: "Pick a section", message: "A help page belongs to one section of Help.", tone: "error" });
      return;
    }
  }

  S.busy = true;
  paintStatus();

  let res = null;
  try {
    res = await rpc(isQuestion() ? "question_save" : "article_save", { p_token: S.token, p_payload: payload(finalStatus) });
  } catch (error) {
    toast({ title: "The server refused it", message: error.message, tone: "error" });
  }
  S.busy = false;

  if (!res || res.ok !== true) {
    toast({
      title: "Not saved",
      message: ERRORS[res && res.error] || "The server did not take that. Try again in a moment.",
      tone: "error",
      iconName: "info",
    });
    paintStatus();
    return;
  }

  S.code = res.code || S.code;
  S.status = res.status || finalStatus;
  S.hasPassword = S.hasPassword || S.passes.length > 0;
  S.passes = [];
  paintAll();
  loadMine();

  if (S.status === "draft") {
    toast({
      title: S.draftOnly ? "Sent to the owner" : "Draft saved",
      message: S.draftOnly
        ? `${S.hubName || "The owner"} has it — they publish it from their studio.`
        : "It is under “In your name”, on this page and on the index.",
      tone: "success",
      iconName: "check",
    });
    if (EMBED) {
      document.dispatchEvent(new CustomEvent("ae:drafted", { detail: { code: S.code, title: S.title, hub: S.hub, kind: docKind } }));
      return;
    }
    if (!location.search.includes("id=")) {
      history.replaceState(null, "", `?id=${encodeURIComponent(S.code)}`);
    }
    const heading = $("[data-e-heading]");
    if (heading) heading.textContent = isQuestion() ? "Edit a question" : "Edit an article";
    return;
  }

  if (S.status === "pending") {
    clearDraft();
    toast({
      title: "Sent for review",
      message: "The moderators have it. It stays private until they publish it in Help.",
      tone: "success",
      iconName: "send",
    });
    return;
  }

  clearDraft();
  const asked = isQuestion();
  toast({
    title: S.status === "scheduled" ? "Scheduled" : asked ? "Asked" : "Published",
    message:
      S.status === "scheduled"
        ? "It opens by itself at the moment you picked."
        : EMBED
          ? `It is in the ${asked ? "space" : "blog"}'s table now.`
          : asked
            ? "Your question is out."
            : "It is on the index now.",
    tone: "success",
    iconName: "check",
  });

  if (EMBED) {
    /* the studio takes over from here: it closes the writer and refreshes the
       blog's table, so the piece is where the member expects to see it */
    document.dispatchEvent(
      new CustomEvent("ae:published", { detail: { code: S.code, title: S.title, status: S.status, hub: S.hub, kind: docKind } })
    );
    return;
  }

  /* a question has no reader page of its own yet, so the page it is written
     on stays put; a piece goes to its reader */
  if (isQuestion()) return;
  setTimeout(() => {
    location.href = `article.html?id=${encodeURIComponent(S.code)}`;
  }, 700);
}

/* ================================================================== */
/* the studio's writing room                                          */
/* ================================================================== */
/** A blank page — the studio calls this before it opens a new piece. */
function resetForm() {
  S.code = "";
  S.title = "";
  S.desc = "";
  S.html = "";
  S.field = S.hubField || "";
  S.category = "";
  S.keyword = "";
  S.subs = [];
  S.otherMeta = {};
  S.attachments = [];
  S.place = "content";
  S.help = "";
  S.tags = [];
  S.thumb = "";
  S.vis = "general";
  S.countries = [];
  S.langs = [];
  S.lvMin = 1;
  S.lvMax = 10;
  S.people = [];
  S.passes = [];
  S.hasPassword = false;
  S.when = "now";
  S.whenAt = "";
  S.status = "draft";
  S.busy = false;

  const set = (sel, value) => {
    const node = $(sel);
    if (node) node.value = value;
  };
  set("[data-e-title]", "");
  set("[data-e-desc]", "");
  set("[data-e-field]", S.field);
  set("[data-e-category]", "");
  set("[data-e-keyword]", "");
  qsa("[data-e-sub-keyword]").forEach((input) => {
    input.value = "";
  });
  set("[data-e-cover-url]", "");
  if (rte) rte.setHtml("");
  paintAll();
}

/**
 * What the studio's `ae:open` carries: the blog, its field, and either nothing
 * (a new piece) or the code of one to edit.
 */
async function startEmbedded(detail = {}) {
  /* the room writes whatever the studio asked for: a blog's piece, or a
     space's question */
  docKind = detail.kind === "question" ? "question" : "article";
  S.token = sessionToken() || "";
  S.hub = String(detail.hub || "").trim().toUpperCase();
  S.hubName = String(detail.hubName || "").trim();
  S.hubField = String(detail.field || "").trim();
  S.draftOnly = detail.draft === true;

  const state = $("[data-e-state]");
  if (state) state.hidden = true;

  if (!S.token) {
    showState({
      title: "Sign in to write",
      text: "An article is published in your name, so it needs an account.",
      iconName: "pen",
      action: `<a class="btn btn--primary btn--sm" href="login.html?next=${encodeURIComponent("creator.html")}">${icon("login")} Sign in</a>`,
    });
    return;
  }

  resetForm();
  paintKind();
  const shell = $("[data-e-shell]");
  if (shell) shell.hidden = false;

  const id = String(detail.id || "").trim();
  if (id) {
    const ok = await loadExisting(id);
    if (!ok) return;
    if (!S.hub) S.hub = String(detail.hub || "").toUpperCase();
  }

  paintAll();
  fillKeywords();
  loadFields();
  loadMine();
  document.dispatchEvent(new CustomEvent("ae:ready", { detail: { hub: S.hub, code: S.code, kind: docKind } }));
  $("[data-e-title]")?.focus();
}

/* ================================================================== */
/* attachments                                                        */
/* ================================================================== */
/*
 * A question often needs the thing it is about: a still, a clip, a document,
 * an archive. Five files, 10 MB each, into `users/files` in the source bucket
 * — the same bucket, its own folder, its own policy. What the piece keeps is
 * the name, the address and the size; the file itself is not copied again.
 */
const ATTACH_MAX = 5;
const ATTACH_LIMIT = 10 * 1024 * 1024;
const ATTACH_EXT = /\.(jpg|jpeg|png|webp|gif|mp4|webm|ogg|mov|pdf|doc|docx|xls|xlsx|ppt|pptx|txt|md|csv|rtf|zip)$/i;

function sizeLabel(bytes) {
  const n = Number(bytes) || 0;
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return `${n} B`;
}

function paintAttachments() {
  const host = $("[data-e-attach-list]");
  const count = $("[data-e-attach-count]");
  if (count) count.textContent = `${S.attachments.length} / ${ATTACH_MAX}`;
  if (!host) return;
  if (!S.attachments.length) {
    host.innerHTML = `<p class="apanel__hint">Nothing attached yet.</p>`;
    return;
  }
  host.innerHTML = S.attachments
    .map(
      (file, index) => `
      <div class="aatt__row">
        <a class="aatt__name" href="${esc(file.url)}" target="_blank" rel="noopener noreferrer">${icon("file")} <span>${esc(file.name)}</span></a>
        <span class="aatt__size">${esc(sizeLabel(file.size))}</span>
        <button class="atool" type="button" data-attach-rm="${index}" aria-label="Remove ${esc(file.name)}">${icon("close")}</button>
      </div>`
    )
    .join("");
}

async function uploadAttachment(file) {
  if (!file) return;
  if (S.attachments.length >= ATTACH_MAX) {
    toast({ title: "Five files at most", message: "Take one out to add another.", tone: "error" });
    return;
  }
  if (!ATTACH_EXT.test(file.name || "")) {
    toast({ title: "Not that kind of file", message: "Pictures, video, documents and archives.", tone: "error" });
    return;
  }
  if (file.size > ATTACH_LIMIT) {
    toast({ title: "That file is too big", message: "10 MB at most.", tone: "error" });
    return;
  }
  const ext = (file.name.split(".").pop() || "bin").toLowerCase().replace(/[^a-z0-9]/g, "");
  const name = `question_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
  try {
    const res = await fetch(`${SUPABASE.url}/storage/v1/object/source/users/files/${name}`, {
      method: "POST",
      headers: { apikey: SUPABASE.publishableKey, "Content-Type": file.type || "application/octet-stream", "x-upsert": "true" },
      body: file,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(text.slice(0, 120) || `HTTP ${res.status}`);
    }
    S.attachments.push({ name: file.name, url: storageUrl(`users/files/${name}`), size: file.size, type: file.type || "" });
    paintAttachments();
    scheduleDraft();
    toast({ title: "Attached", message: file.name, tone: "success", iconName: "check" });
  } catch (error) {
    toast({ title: "Upload failed", message: error?.message || "Please try again.", tone: "error" });
  }
}

/** The drop zone, its picker, and the cross on a file — wired once. */
function wireAttachments() {
  const drop = $("[data-e-attach-drop]");
  const input = $("[data-e-attach-input]");
  const list = $("[data-e-attach-list]");
  if (!drop || !input) return;

  input.addEventListener("change", () => {
    [...(input.files || [])].forEach((file) => uploadAttachment(file));
    input.value = "";
  });
  ["dragenter", "dragover"].forEach((type) =>
    drop.addEventListener(type, (event) => {
      event.preventDefault();
      drop.classList.add("is-over");
    })
  );
  ["dragleave", "dragend"].forEach((type) => drop.addEventListener(type, () => drop.classList.remove("is-over")));
  drop.addEventListener("drop", (event) => {
    event.preventDefault();
    drop.classList.remove("is-over");
    const files = (event.dataTransfer && event.dataTransfer.files) || [];
    [...files].forEach((file) => uploadAttachment(file));
  });
  list?.addEventListener("click", (event) => {
    const remove = event.target.closest?.("[data-attach-rm]");
    if (!remove) return;
    S.attachments.splice(Number(remove.getAttribute("data-attach-rm")), 1);
    paintAttachments();
    scheduleDraft();
  });
}

/* ================================================================== */
/* importing HTML                                                     */
/* ================================================================== */
/*
 * A piece often exists somewhere else first: an export, a newsletter, a page
 * written by hand. Importing it should give an article, not a wall of tags.
 *
 * Two steps, and both are the page's own rules:
 *
 *   precleanHtml()  takes the outside world apart — the doctype, the head, the
 *                   scripts, the styles, the comments, the <h1> (mapped to an
 *                   <h2>, because that is the deepest heading an article has),
 *                   and keeps the first heading or <title> as a candidate title
 *   sanitizeHtml()  the allowlist the reader already trusts, unchanged
 *
 * The dialog offers both doors — paste it, or drop an .html file — and says
 * what will land before anything lands: words, headings, pictures, and what was
 * dropped. The first heading fills the title only when the title is empty and
 * the member leaves that box ticked.
 */
const IMPORT_LIMIT = 2 * 1024 * 1024; /* 2 MB of HTML is a long article */
let importClean = "";
let importTitle = "";
let importRaw = "";

/** The outside world, taken apart — before the allowlist sees it. */
function precleanHtml(raw) {
  let html = String(raw || "");
  const dropped = { scripts: 0, styles: 0, comments: 0, handlers: 0 };

  dropped.comments = (html.match(/<!--[\s\S]*?-->/g) || []).length;
  html = html.replace(/<!--[\s\S]*?-->/g, " ");

  /* the import boundary takes the handlers off itself, before the allowlist
     is even asked — belt, and braces */
  dropped.handlers = (html.match(/\son[a-z]+\s*=/gi) || []).length;
  html = html
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/\s(srcdoc|srcset)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/\s(href|src)\s*=\s*("|')?\s*(javascript|data|vbscript):[^"'\s>]*("|')?/gi, "");

  dropped.scripts = (html.match(/<script\b[\s\S]*?<\/script>/gi) || []).length;
  html = html.replace(/<script\b[\s\S]*?<\/script>/gi, " ");

  dropped.styles = (html.match(/<style\b[\s\S]*?<\/style>/gi) || []).length;
  html = html.replace(/<style\b[\s\S]*?<\/style>/gi, " ");

  html = html
    .replace(/<!doctype[^>]*>/gi, " ")
    .replace(/<\/?(noscript|template|iframe|object|embed|svg|canvas|form|input|button|select|textarea|link|meta)\b[^>]*>/gi, " ")
    .replace(/<\/?(html|body|head)\b[^>]*>/gi, " ");

  /* a page's <title> and its first <h1> are the only titles worth having */
  const pageTitle = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  const firstH1 = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
  const heading = String((firstH1 && firstH1[1]) || (pageTitle && pageTitle[1]) || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();

  html = html
    .replace(/<\/?title\b[^>]*>/gi, " ")
    .replace(/<h1\b[^>]*>/gi, "<h2>")
    .replace(/<\/h1>/gi, "</h2>")
    /* a table has no place in an article: its cells become lines */
    .replace(/<\/t[dh]>/gi, "</div> ")
    .replace(/<\/?t(able|body|head|foot|r)\b[^>]*>/gi, " ");

  return { html, title: heading.slice(0, 200), dropped };
}

/** What the import will actually do — said in the dialog, before it is done. */
function previewImport() {
  const body = $("[data-e-dlg-body]");
  const text = body && body.querySelector("[data-imp-text]");
  const say = body && body.querySelector("[data-imp-say]");
  const ok = $("[data-e-dlg-ok]");
  if (text) importRaw = text.value;

  const result = precleanHtml(importRaw);
  importClean = sanitizeHtml(result.html);
  importTitle = result.title;

  const words = wordsIn(importClean);
  const images = (importClean.match(/<img\b/gi) || []).length;
  const heads = (importClean.match(/<h[234]\b/gi) || []).length;
  const lost = [];
  if (result.dropped.scripts) lost.push(`${result.dropped.scripts} script${result.dropped.scripts === 1 ? "" : "s"}`);
  if (result.dropped.styles) lost.push(`${result.dropped.styles} style block${result.dropped.styles === 1 ? "" : "s"}`);
  if (result.dropped.comments) lost.push(`${result.dropped.comments} comment${result.dropped.comments === 1 ? "" : "s"}`);
  if (result.dropped.handlers) lost.push(`${result.dropped.handlers} handler${result.dropped.handlers === 1 ? "" : "s"}`);

  if (say) {
    if (!importRaw.trim()) say.textContent = "Paste the HTML, or drop a .html file — nothing is imported until you say so.";
    else if (!words) say.textContent = "That has no readable text in it. Try the page's body rather than its markup for scripts.";
    else {
      say.textContent =
        `${words} word${words === 1 ? "" : "s"} · ${heads} heading${heads === 1 ? "" : "s"} · ${images} picture${images === 1 ? "" : "s"}` +
        (lost.length ? ` — dropped ${lost.join(", ")}` : "") +
        (importTitle ? ` · the title would be “${importTitle}”` : "");
    }
  }
  if (ok) ok.disabled = !words;
  return words;
}

/** A file the member dropped or picked: text, and nothing else. */
function readHtmlFile(file) {
  return new Promise((resolve) => {
    if (!file) {
      resolve("");
      return;
    }
    if (file.size > IMPORT_LIMIT) {
      toast({ title: "That file is too big", message: "2 MB of HTML at most.", tone: "error" });
      resolve("");
      return;
    }
    if (!/\.html?$/i.test(file.name || "") && file.type && !/text\/html/i.test(file.type)) {
      toast({ title: "Not an HTML file", message: "A .html or .htm file, please.", tone: "error" });
      resolve("");
      return;
    }
    /* the browser has both; a test harness may only set one */
    const Reader = typeof FileReader !== "undefined" ? FileReader : window.FileReader;
    const reader = new Reader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => {
      toast({ title: "That file would not open", message: "Try the paste box instead.", tone: "error" });
      resolve("");
    };
    reader.readAsText(file);
  });
}

/** The dialog's own wiring — it is rebuilt on every open. */
function wireImport() {
  const body = $("[data-e-dlg-body]");
  if (!body) return;
  importRaw = "";
  importClean = "";
  importTitle = "";

  const text = body.querySelector("[data-imp-text]");
  const file = body.querySelector("[data-imp-file]");
  const pick = body.querySelector("[data-imp-pick]");
  const drop = body.querySelector("[data-imp-drop]");

  const takeFile = async (chosen) => {
    const raw = await readHtmlFile(chosen);
    if (!raw) return;
    if (text) text.value = raw;
    previewImport();
  };

  text?.addEventListener("input", () => previewImport());
  pick?.addEventListener("click", () => file?.click());
  file?.addEventListener("change", () => takeFile(file.files && file.files[0]));

  if (drop) {
    ["dragenter", "dragover"].forEach((type) =>
      drop.addEventListener(type, (event) => {
        event.preventDefault();
        drop.classList.add("is-over");
      })
    );
    ["dragleave", "dragend"].forEach((type) => drop.addEventListener(type, () => drop.classList.remove("is-over")));
    drop.addEventListener("drop", (event) => {
      event.preventDefault();
      drop.classList.remove("is-over");
      const files = event.dataTransfer && event.dataTransfer.files;
      takeFile(files && files[0]);
    });
  }

  previewImport();
  text?.focus();
}

/** The door: a button in the piece's head, put there by this module so both
 *  pages (article-editor.html and the studio's writing room) have it. */
function mountHtmlImport() {
  if ($("[data-e-import]")) return;
  const count = $("[data-e-title-count]");
  const head = count && count.parentElement;
  if (!head) return;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "btn btn--quiet btn--sm aimp__open";
  button.setAttribute("data-e-import", "");
  button.innerHTML = `${icon("file")} Import HTML`;
  button.addEventListener("click", () => openDialog("html"));
  head.insertBefore(button, count);
}

/* ================================================================== */
/* the dialogs                                                        */
/* ================================================================== */
let dialogMode = "";
let dialogFor = "body";

function openDialog(mode, target = "body") {
  const dlg = $("[data-e-dlg]");
  dialogFor = target;
  if (!dlg) return;
  dialogMode = mode;
  const title = $("[data-e-dlg-title]");
  const body = $("[data-e-dlg-body]");
  const ok = $("[data-e-dlg-ok]");
  if (!body || !ok) return;
  /* the import disables the button until there is something to import; every
     other mode starts enabled */
  ok.disabled = false;

  if (mode === "link") {
    if (title) title.textContent = "Add a link";
    if (ok) ok.textContent = "Insert the link";
    body.innerHTML = `
      <label class="adlg__row"><span class="alabel">Address</span>
        <input class="input" data-dlg-url type="url" placeholder="https://" /></label>
      <label class="adlg__row"><span class="alabel">Words to show (optional)</span>
        <input class="input" data-dlg-text placeholder="Leave empty to use the address" /></label>
      <label class="acheck"><input type="checkbox" data-dlg-blank checked /> <span>Open in a new tab</span></label>`;
  } else if (mode === "image") {
    if (title) title.textContent = "Add an image";
    if (ok) ok.textContent = "Insert the image";
    body.innerHTML = `
      <label class="adlg__row"><span class="alabel">Image address</span>
        <input class="input" data-dlg-url type="url" placeholder="https://…/picture.jpg" /></label>
      <label class="adlg__row"><span class="alabel">Or upload one</span>
        <input class="input" type="file" accept="image/png,image/jpeg,image/webp,image/gif" data-dlg-file /></label>
      <label class="adlg__row"><span class="alabel">Description (for screen readers)</span>
        <input class="input" data-dlg-alt placeholder="What is in the picture" /></label>
      <p class="adlg__note">PNG, JPEG, WEBP or GIF, up to 4 MB. An upload goes to the site's storage and the address is used here.</p>`;
  } else if (mode === "html") {
    if (title) title.textContent = "Import HTML";
    if (ok) ok.textContent = "Import it";
    body.innerHTML = `
      <div class="aimp">
        <p class="adlg__note">Paste the HTML of a page, or drop an <b>.html</b> file. Nothing lands as-is: the head,
          the scripts, the styles and the comments go, a headline becomes a heading, and only the tags this editor
          can write are kept — the same list the reader already trusts.</p>
        <div class="aimp__drop" data-imp-drop>
          <span class="aimp__mark">${icon("file")}</span>
          <span>Drop an .html file here, or <button class="aimp__pick" type="button" data-imp-pick>choose one</button>.</span>
          <input type="file" accept=".html,.htm,text/html" data-imp-file hidden />
        </div>
        <textarea class="input aimp__text" rows="9" data-imp-text spellcheck="false" aria-label="The HTML to import" placeholder="<h1>The title</h1><p>The first paragraph…</p>"></textarea>
        <div class="aimp__row">
          <label class="acheck"><input type="checkbox" data-imp-title checked /> <span>Take the first heading as the title, when it is still empty</span></label>
          <label class="acheck"><input type="checkbox" data-imp-replace /> <span>Replace the body instead of adding to it</span></label>
        </div>
        <p class="aimp__say" data-imp-say></p>
      </div>`;
  } else {
    if (title) title.textContent = "Add a video";
    if (ok) ok.textContent = "Insert the video";
    body.innerHTML = `
      <label class="adlg__row"><span class="alabel">Video address</span>
        <input class="input" data-dlg-url type="url" placeholder="https://www.youtube.com/watch?v=… or a .mp4" /></label>
      <label class="adlg__row"><span class="alabel">Caption</span>
        <input class="input" data-dlg-caption placeholder="What the video shows" /></label>
      <p class="adlg__note">A video is inserted as a captioned link: the reader opens it where it lives, so nothing is loaded until they ask for it.</p>`;
  }

  const err = $("[data-e-dlg-err]");
  if (err) err.hidden = true;
  dlg.showModal?.();
  if (mode === "html") {
    wireImport();
    return;
  }
  body.querySelector("input")?.focus();
}

function closeDialog() {
  const dlg = $("[data-e-dlg]");
  dlg?.close?.();
  dialogMode = "";
}

function insertHtml(html) {
  if (rte) {
    rte.insert(html);
    return;
  }
  const body = $("[data-e-body]");
  if (body) body.insertAdjacentHTML("beforeend", html);
}

async function confirmDialog() {
  const body = $("[data-e-dlg-body]");
  const err = $("[data-e-dlg-err]");
  if (!body) return;

  if (dialogMode === "html") {
    rte?.restore();
    const words = previewImport();
    if (!words) {
      if (err) {
        err.hidden = false;
        err.textContent = "There is no readable text in that. Paste the page's body, or drop an .html file.";
      }
      return;
    }
    const takeTitle = Boolean((body.querySelector("[data-imp-title]") || {}).checked);
    const replace = Boolean((body.querySelector("[data-imp-replace]") || {}).checked);
    const titleNode = $("[data-e-title]");
    let titled = false;
    if (takeTitle && titleNode && !titleNode.value.trim() && importTitle) {
      titleNode.value = importTitle.slice(0, 200);
      S.title = titleNode.value;
      titled = true;
    }

    if (replace) {
      if (rte) rte.setHtml(importClean);
      else {
        const host = $("[data-e-body]");
        if (host) host.innerHTML = importClean;
      }
    } else {
      insertHtml(importClean);
    }

    sync();
    paintCounts();
    paintChecks();
    scheduleDraft();
    const images = (importClean.match(/<img\b/gi) || []).length;
    toast({
      title: "Imported",
      message: `${words} word${words === 1 ? "" : "s"}${images ? ` and ${images} picture${images === 1 ? "" : "s"}` : ""}${titled ? " · the title came from the page" : ""}.`,
      tone: "success",
      iconName: "check",
    });
    closeDialog();
    return;
  }

  rte?.restore();
  const value = (body.querySelector("[data-dlg-url]") || {}).value || "";
  const url = String(value).trim();

  if (!/^https?:\/\//i.test(url)) {
    if (err) {
      err.hidden = false;
      err.textContent = "That is not an address we can open. It has to start with http:// or https://";
    }
    return;
  }

  if (dialogMode === "link") {
    const typed = String((body.querySelector("[data-dlg-text]") || {}).value || "").trim();
    const blank = Boolean((body.querySelector("[data-dlg-blank]") || {}).checked);
    if (rte) {
      /* the engine keeps the words that were selected and links them */
      rte.run("insertLink", { url, text: typed, blank });
    } else {
      insertHtml(
        `<a href="${esc(url)}"${blank ? ' target="_blank" rel="noopener noreferrer"' : ""}>${esc(typed || url)}</a>&nbsp;`
      );
    }
  } else if (dialogMode === "image" && dialogFor === "cover") {
    S.thumb = url;
    paintCover();
    dialogFor = "body";
    closeDialog();
    return;
  } else if (dialogMode === "image") {
    const alt = String((body.querySelector("[data-dlg-alt]") || {}).value || "").trim();
    insertHtml(`<figure><img src="${esc(url)}" alt="${esc(alt)}" /><figcaption>${esc(alt)}</figcaption></figure><p><br /></p>`);
    if (!S.thumb) {
      S.thumb = url;
      paintCover();
    }
  } else {
    const caption = String((body.querySelector("[data-dlg-caption]") || {}).value || "").trim();
    insertHtml(
      `<p><strong>Video</strong> · <a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(caption || "Watch the video")}</a></p>`
    );
  }

  sync();
  paintCounts();
  paintChecks();
  closeDialog();
}

/* ================================================================== */
/* images: upload, resize, align                                      */
/* ================================================================== */
async function uploadImage(file, onDone) {
  if (!file) return;
  if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) {
    toast({ title: "Unsupported image", message: "PNG, JPEG, WEBP or GIF.", tone: "error" });
    return;
  }
  if (file.size > 4 * 1024 * 1024) {
    toast({ title: "Image too large", message: "4 MB at most.", tone: "error" });
    return;
  }
  const ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z]/g, "");
  const name = `article_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
  try {
    const res = await fetch(`${SUPABASE.url}/storage/v1/object/source/users/articles/${name}`, {
      method: "POST",
      headers: { apikey: SUPABASE.publishableKey, "Content-Type": file.type, "x-upsert": "true" },
      body: file,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(text.slice(0, 120) || `HTTP ${res.status}`);
    }
    const url = storageUrl(`users/articles/${name}`);
    toast({ title: "Image uploaded", tone: "success", iconName: "check" });
    onDone(url);
  } catch (error) {
    toast({ title: "Upload failed", message: error?.message || "Please try again.", tone: "error" });
  }
}

let selectedImage = null;

function imageBar() {
  let bar = qs(".aimgbar");
  if (bar) return bar;
  bar = document.createElement("div");
  bar.className = "aimgbar";
  bar.innerHTML = `
    <button class="atool" type="button" data-img-w="35%" title="Small">S</button>
    <button class="atool" type="button" data-img-w="60%" title="Medium">M</button>
    <button class="atool" type="button" data-img-w="100%" title="Full width">L</button>
    <span class="atool-sep"></span>
    <button class="atool" type="button" data-img-align="left" title="Left">${icon("alignLeft")}</button>
    <button class="atool" type="button" data-img-align="center" title="Centre">${icon("alignCenter")}</button>
    <button class="atool" type="button" data-img-align="right" title="Right">${icon("alignRight")}</button>
    <span class="atool-sep"></span>
    <button class="atool" type="button" data-img-remove title="Delete">${icon("trash")}</button>`;
  document.body.appendChild(bar);
  return bar;
}

function selectImage(img) {
  qsa("[data-sel='1']").forEach((el) => el.removeAttribute("data-sel"));
  selectedImage = img || null;
  const bar = imageBar();
  if (!img) {
    bar.hidden = true;
    return;
  }
  img.setAttribute("data-sel", "1");
  const box = img.getBoundingClientRect();
  bar.hidden = false;
  const top = Math.max(8, box.top + window.scrollY - 46);
  const left = Math.max(8, Math.min(window.innerWidth - 260, box.left + window.scrollX));
  bar.style.top = `${top}px`;
  bar.style.left = `${left}px`;
}

function applyImage(action, value) {
  if (!selectedImage) return;
  if (action === "w") selectedImage.style.width = value;
  if (action === "align") {
    selectedImage.style.display = "block";
    selectedImage.style.margin =
      value === "left" ? "0 auto 0 0" : value === "right" ? "0 0 0 auto" : "0 auto";
  }
  if (action === "remove") {
    const parent = selectedImage.parentElement;
    selectedImage.remove();
    if (parent && parent.tagName === "FIGURE" && !parent.querySelector("img")) parent.remove();
    selectImage(null);
  }
  rte?.snapshot();
  sync();
  paintCounts();
  scheduleDraft();
}

/* ================================================================== */
/* the reader preview                                                 */
/* ================================================================== */
function previewVerdict(country, language, level, follows = false) {
  if (S.vis === "followers") {
    return follows
      ? { ok: true, text: "This reader follows you, so the piece opens." }
      : { ok: false, text: "This reader does not follow the writer: they see the door." };
  }
  if (S.vis === "general") return { ok: true, text: "Everyone can open this piece." };
  if (S.vis === "private") {
    if (S.people.length || S.passes.length || S.hasPassword) {
      return { ok: false, text: "Private: only the members on the list, or a reader holding a password, can open it." };
    }
    return { ok: false, text: "Private with nobody named — nobody but you can open it." };
  }
  const wanted = [];
  if (S.countries.length) wanted.push(S.countries.includes(country) ? `country ${country} ✓` : `country ${country} ✗`);
  if (S.langs.length) wanted.push(S.langs.includes(language) ? `language ${language} ✓` : `language ${language} ✗`);
  const inRange = Number(level) >= Math.min(S.lvMin, S.lvMax) && Number(level) <= Math.max(S.lvMin, S.lvMax);
  wanted.push(inRange ? `level LV${level} ✓` : `level LV${level} ✗`);
  const ok = (S.countries.length ? S.countries.includes(country) : false) ||
    (S.langs.length ? S.langs.includes(language) : false) ||
    inRange;
  return {
    ok,
    text: `${ok ? "This reader can open it" : "This reader sees the door"} — ${wanted.join(" · ")}`,
  };
}

function openPreview() {
  const dlg = $("[data-e-prev]");
  if (!dlg) return;
  sync();
  const countrySel = $("[data-prev-country]");
  const langSel = $("[data-prev-lang]");
  if (countrySel && !countrySel.options.length) {
    countrySel.innerHTML = COUNTRIES.map((row) => `<option value="${esc(row.name)}">${esc(row.name)}</option>`).join("");
  }
  if (langSel && !langSel.options.length) {
    langSel.innerHTML = LANGUAGES.map(([code, label]) => `<option value="${code}">${esc(label)}</option>`).join("");
  }
  const scroll = $("[data-prev-scroll]");
  if (scroll) {
    const words = wordsIn(S.html);
    scroll.innerHTML = `
      <div class="aprev__who" data-prev-verdict></div>
      <article>
        <nav class="reader__crumbs"><span>Articles</span> ${S.field ? `${icon("chevronRight")} <span>${esc(S.field)}</span>` : ""}</nav>
        <h1 class="reader__title" style="margin-top:.7rem">${esc(S.title || "Untitled")}</h1>
        ${S.desc ? `<p class="reader__desc">${esc(S.desc)}</p>` : ""}
        <p class="rby__meta" style="margin-top:.8rem">${words} words · ${readingTime(S.html)} min read · ${esc(
          S.place === "help" ? `Help · ${S.help || "no section"}` : S.field || "no field"
        )}</p>
        ${S.thumb ? `<figure class="reader__cover" style="margin-top:1rem"><img src="${esc(S.thumb)}" alt="" /></figure>` : ""}
        <div class="prose">${sanitizeHtml(S.html) || '<p style="color:var(--faint)">The body is still empty.</p>'}</div>
      </article>`;
  }
  paintVerdict();
  dlg.showModal?.();
}

function paintVerdict() {
  const host = $("[data-prev-verdict]");
  if (!host) return;
  const country = ($("[data-prev-country]") || {}).value || "Morocco";
  const language = ($("[data-prev-lang]") || {}).value || "en";
  const level = Number(($("[data-prev-level]") || {}).value || 1);
  const follows = Boolean(($("[data-prev-follow]") || {}).checked);
  const verdict = previewVerdict(country, language, level, follows);
  host.innerHTML = `
    <span><strong>${verdict.ok ? "Opens" : "Blocked"}</strong> · ${esc(verdict.text)}</span>
    <span style="opacity:.75">A simulated reader: ${esc(country)} · ${esc(language)} · LV${level}</span>`;
}

/* ================================================================== */
/* toolbar                                                            */
/* ================================================================== */
function command(name, value = null) {
  if (!rte) return;
  rte.run(name, value);
  sync();
  paintCounts();
  paintChecks();
  paintToolState();
  scheduleDraft();
}

/** The bar shows what the caret is standing in, not what was last pressed. */
function paintToolState() {
  if (!rte) return;
  const st = rte.state();
  ["bold", "italic", "underline", "strikeThrough"].forEach((cmd) => {
    const on = Boolean(st[cmd]);
    qsa(`[data-cmd="${cmd}"]`).forEach((btn) => btn.classList.toggle("is-on", on));
  });
  ["justifyLeft", "justifyCenter", "justifyRight"].forEach((cmd) => {
    qsa(`[data-cmd="${cmd}"]`).forEach((btn) => btn.classList.toggle("is-on", st.align === cmd));
  });
  qsa('[data-cmd="insertUnorderedList"]').forEach((btn) => btn.classList.toggle("is-on", st.list === "ul"));
  qsa('[data-cmd="insertOrderedList"]').forEach((btn) => btn.classList.toggle("is-on", st.list === "ol"));
  qsa("[data-e-block]").forEach((select) => {
    if (!select.options.length) return;
    const value = ["p", "h2", "h3", "blockquote"].includes(st.block) ? st.block : "p";
    if (select.value !== value) select.value = value;
  });
}

/* ================================================================== */
/* wiring                                                             */
/* ================================================================== */
function bind() {
  const title = $("[data-e-title]");
  if (title) {
    title.addEventListener("input", () => {
      S.title = title.value;
      paintCounts();
      paintChecks();
      scheduleDraft();
    });
  }
  const desc = $("[data-e-desc]");
  if (desc) {
    desc.addEventListener("input", () => {
      S.desc = desc.value;
      scheduleDraft();
    });
  }
  const body = $("[data-e-body]");
  if (body) {
    rte = createRte(body, {
      onChange: (html) => {
        S.html = html;
        paintCounts();
        paintContents();
        paintChecks();
        scheduleDraft();
      },
      onTool: paintToolState,
      onAsk: (kind) => openDialog(kind === "link" ? "link" : "image"),
      onSubmit: () => save(publishStatus()),
      onFile: (file) => {
        uploadImage(file, (url) => {
          rte.insert(`<figure><img src="${esc(url)}" alt="" /><figcaption></figcaption></figure><p><br /></p>`);
        });
      },
    });
    /* a click on the toolbar must not take the caret with it */
    rte.keepSelection($("[data-e-tools]"));
    body.addEventListener("click", (event) => {
      if (event.target.tagName === "IMG") selectImage(event.target);
      else selectImage(null);
    });
  }

  /* the toolbar */
  const tools = $("[data-e-tools]");
  if (tools) {
    tools.addEventListener("click", (event) => {
      const btn = event.target.closest("[data-cmd]");
      if (btn) {
        const cmd = btn.getAttribute("data-cmd");
        if (cmd === "insertLink") {
          rte?.save();
          openDialog("link");
          return;
        }
        if (cmd === "insertImage") {
          rte?.save();
          openDialog("image");
          return;
        }
        if (cmd === "insertVideo") {
          rte?.save();
          openDialog("video");
          return;
        }
        command(cmd);
      }
    });
    tools.addEventListener("change", (event) => {
      const block = event.target.closest("[data-e-block]");
      if (block) command("formatBlock", block.value);
    });
  }

  /* the floating image bar */
  document.addEventListener("click", (event) => {
    const bar = event.target.closest(".aimgbar");
    if (!bar) return;
    if (event.target.closest("[data-img-w]")) {
      applyImage("w", event.target.closest("[data-img-w]").getAttribute("data-img-w"));
      return;
    }
    if (event.target.closest("[data-img-align]")) {
      applyImage("align", event.target.closest("[data-img-align]").getAttribute("data-img-align"));
      return;
    }
    if (event.target.closest("[data-img-remove]")) applyImage("remove");
  });

  /* the cover */
  const coverFile = $("[data-e-cover-file]");
  if (coverFile) {
    coverFile.addEventListener("change", () => {
      const file = coverFile.files && coverFile.files[0];
      if (!file) return;
      uploadImage(file, (url) => {
        S.thumb = url;
        paintCover();
      });
      coverFile.value = "";
    });
  }

  /* the tags */
  const tagInput = $("[data-e-tag-input]");
  const addTag = () => {
    if (!tagInput) return;
    const value = String(tagInput.value || "").trim().replace(/^#/, "");
    if (!value) return;
    if (S.tags.length >= 12) {
      toast({ title: "Twelve tags at most", tone: "error" });
      return;
    }
    if (!S.tags.some((tag) => tag.toLowerCase() === value.toLowerCase())) S.tags.push(value.slice(0, 40));
    tagInput.value = "";
    paintChips();
    paintCounts();
  };
  if (tagInput) {
    tagInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === ",") {
        event.preventDefault();
        addTag();
      }
    });
  }

  /* the dialogs */
  $("[data-e-dlg-cancel]")?.addEventListener("click", closeDialog);
  $("[data-e-dlg-close]")?.addEventListener("click", closeDialog);
  $("[data-e-dlg-ok]")?.addEventListener("click", confirmDialog);
  const dlg = $("[data-e-dlg]");
  if (dlg) {
    dlg.addEventListener("click", (event) => {
      if (event.target === dlg) closeDialog();
    });
    dlg.addEventListener("change", async (event) => {
      const input = event.target.closest("[data-dlg-file]");
      if (!input) return;
      const file = input.files && input.files[0];
      if (!file) return;
      await uploadImage(file, (url) => {
        const urlInput = $("[data-dlg-url]");
        if (urlInput) urlInput.value = url;
        toast({ title: "Uploaded", message: "Press insert to place it.", tone: "success", iconName: "check" });
      });
    });
  }

  /* the preview */
  qsa("[data-e-preview-open]").forEach((btn) => btn.addEventListener("click", openPreview));
  $("[data-e-prev-close]")?.addEventListener("click", () => $("[data-e-prev]")?.close?.());
  qsa("[data-prev-country], [data-prev-lang], [data-prev-level], [data-prev-follow]").forEach((el) =>
    el.addEventListener("change", paintVerdict)
  );
  const prev = $("[data-e-prev]");
  if (prev) {
    prev.addEventListener("click", (event) => {
      if (event.target === prev) prev.close?.();
    });
  }

  /* save */
  $("[data-e-publish]")?.addEventListener("click", () => save(publishStatus()));
  $("[data-e-draft]")?.addEventListener("click", () => save("draft"));

  /* one delegated listener for everything painted after boot */
  document.addEventListener("click", (event) => {
    const vis = event.target.closest("[data-vis]");
    if (vis) {
      S.vis = vis.getAttribute("data-vis");
      paintVis();
      paintChecks();
      return;
    }
    const place = event.target.closest("[data-place]");
    if (place) {
      S.place = place.getAttribute("data-place");
      if (S.place === "help") S.vis = "general";
      paintPlace();
      paintVis();
      paintChecks();
      paintStatus();
      return;
    }
    const when = event.target.closest("[data-when]");
    if (when) {
      S.when = when.getAttribute("data-when");
      paintWhen();
      paintChecks();
      return;
    }
    const tagRm = event.target.closest("[data-e-tag-rm]");
    if (tagRm) {
      S.tags.splice(Number(tagRm.getAttribute("data-e-tag-rm")), 1);
      paintChips();
      paintCounts();
      return;
    }
    if (event.target.closest("[data-e-tag-add]")) {
      addTag();
      return;
    }
    const countryRm = event.target.closest("[data-e-country-rm]");
    if (countryRm) {
      const name = countryRm.getAttribute("data-e-country-rm");
      S.countries = S.countries.filter((row) => row !== name);
      paintAudience();
      paintChecks();
      return;
    }
    const langRm = event.target.closest("[data-e-lang-rm]");
    if (langRm) {
      const code = langRm.getAttribute("data-e-lang-rm");
      S.langs = S.langs.filter((row) => row !== code);
      paintAudience();
      paintChecks();
      return;
    }
    const personRm = event.target.closest("[data-e-person-rm]");
    if (personRm) {
      const who = personRm.getAttribute("data-e-person-rm");
      S.people = S.people.filter((row) => row !== who);
      paintPrivate();
      paintChecks();
      return;
    }
    const passRm = event.target.closest("[data-e-pass-rm]");
    if (passRm) {
      S.passes.splice(Number(passRm.getAttribute("data-e-pass-rm")), 1);
      paintPrivate();
      paintChecks();
      return;
    }
    const passCopy = event.target.closest("[data-e-pass-copy]");
    if (passCopy) {
      const value = S.passes[Number(passCopy.getAttribute("data-e-pass-copy"))] || "";
      navigator.clipboard?.writeText(value).then(
        () => toast({ title: "Password copied", tone: "success", iconName: "check", duration: 2200 }),
        () => toast({ title: "Copy it by hand", message: value, tone: "info", duration: 5000 })
      );
      return;
    }
    if (event.target.closest("[data-e-cover-clear]")) {
      S.thumb = "";
      paintCover();
      return;
    }
    if (event.target.closest("[data-e-cover-upload]")) {
      $("[data-e-cover-file]")?.click();
      return;
    }
    if (event.target.closest("[data-e-cover-url]")) {
      openDialog("image", "cover");
      return;
    }
    if (event.target.closest("[data-e-cover-first]")) {
      const url = firstImage(bodyHtml());
      if (!url) {
        toast({ title: "No image in the piece", message: "Add one to the body first.", tone: "info", iconName: "image" });
        return;
      }
      S.thumb = url;
      paintCover();
      toast({ title: "Cover taken from the piece", tone: "success", iconName: "check" });
      return;
    }
    if (event.target.closest("[data-e-person-add]")) {
      const panel = event.target.closest(".avis") || document;
      const input = panel.querySelector("[data-e-person-input]");
      const value = String((input && input.value) || "").trim();
      const handle = value.startsWith("@") ? value : `@${value}`;
      if (value.length < 2) {
        input?.focus();
        return;
      }
      if (!S.people.includes(handle)) S.people.push(handle.slice(0, 60));
      if (input) input.value = "";
      paintPrivate();
      paintChecks();
      return;
    }
    if (event.target.closest("[data-e-pass-add]")) {
      const input = $("[data-e-pass-input]");
      const value = String((input && input.value) || "").trim();
      if (value.length < 4) {
        toast({ title: "Four characters at least", tone: "error" });
        return;
      }
      if (S.passes.length >= 10) {
        toast({ title: "Ten passwords at most", tone: "error" });
        return;
      }
      S.passes.push(value.slice(0, 60));
      if (input) input.value = "";
      paintPrivate();
      paintChecks();
      return;
    }
    if (event.target.closest("[data-e-pass-gen]")) {
      if (S.passes.length >= 10) {
        toast({ title: "Ten passwords at most", tone: "error" });
        return;
      }
      S.passes.push(randomPassword());
      paintPrivate();
      paintChecks();
      return;
    }
  });

  /* the select-driven bits */
  $("[data-e-country-sel]")?.addEventListener("change", (event) => {
    const value = event.target.value;
    if (value && !S.countries.includes(value)) S.countries.push(value);
    event.target.value = "";
    paintAudience();
    paintChecks();
  });
  $("[data-e-lang-sel]")?.addEventListener("change", (event) => {
    const value = event.target.value;
    if (value && !S.langs.includes(value)) S.langs.push(value);
    event.target.value = "";
    paintAudience();
    paintChecks();
  });
  $("[data-e-lv-min]")?.addEventListener("change", (event) => {
    S.lvMin = Math.max(1, Math.min(10, Number(event.target.value) || 1));
    paintChecks();
  });
  $("[data-e-lv-max]")?.addEventListener("change", (event) => {
    S.lvMax = Math.max(1, Math.min(10, Number(event.target.value) || 10));
    paintChecks();
  });
  $("[data-e-help-sel]")?.addEventListener("change", (event) => {
    S.help = event.target.value;
    paintChecks();
    paintStatus();
  });
  $("[data-e-when-at]")?.addEventListener("change", (event) => {
    S.whenAt = event.target.value;
    paintChecks();
  });
  $("[data-e-field]")?.addEventListener("change", () => {
    sync();
    paintKeywords();
    paintChecks();
    paintStatus();
    scheduleDraft();
  });
  $("[data-e-keyword]")?.addEventListener("input", () => {
    sync();
    paintKeywords();
    scheduleDraft();
  });
  qsa("[data-e-sub-keyword]").forEach((input) =>
    input.addEventListener("input", () => {
      sync();
      paintKeywords();
      scheduleDraft();
    })
  );

  contents = createContents($("[data-e-toc]"), {
    empty: "No headings yet. Press H2 in the toolbar and the piece's contents appear here.",
    onJump: jumpToHeading,
  });

  wireAttachments();

  /* the import button is this module's own, so it exists on both pages */
  mountHtmlImport();
}

/* ================================================================== */
/* boot                                                               */
/* ================================================================== */
function showState({ title, text, action = "", iconName = "info" }) {
  const host = $("[data-e-state]");
  const shell = $("[data-e-shell]");
  if (shell) shell.hidden = true;
  if (!host) return;
  host.hidden = false;
  host.innerHTML = `
    <div class="astate">
      <span class="astate__icon">${icon(iconName)}</span>
      <p class="astate__title">${esc(title)}</p>
      <p class="astate__text">${esc(text)}</p>
      ${action}
    </div>`;
}

async function loadMine() {
  try {
    const res = await rpc(isQuestion() ? "question_mine" : "article_mine", { p_token: S.token });
    if (res && res.ok) {
      S.mine = Array.isArray(res.rows) ? res.rows : [];
      paintMine();
    }
  } catch {
    /* the list is a convenience, not a requirement */
  }
}

async function loadFields() {
  try {
    const res = await rpc("article_feed", {
      p_token: S.token,
      p_field: null,
      p_sort: "popular",
      p_search: "",
      p_limit: 1,
      p_offset: 0,
    });
    if (res && res.ok) {
      S.fields = Array.isArray(res.fields) ? res.fields : [];
      paintFields();
    }
  } catch {
    /* the datalist stays empty */
  }
}

async function loadExisting(code) {
  let res = null;
  try {
    res = await rpc("article_get", { p_token: S.token, p_ref: code, p_key: "" });
  } catch (error) {
    toast({ title: isQuestion() ? "That question did not load" : "That article did not load", message: error.message, tone: "error" });
    return false;
  }
  if (!res || res.ok !== true || res.locked) {
    toast({
      title: res && res.locked ? "That piece is not yours to edit" : isQuestion() ? "That question is gone" : "That article is gone",
      message: res && res.locked ? "Only the writer can edit it." : "",
      tone: "error",
    });
    return false;
  }
  const row = res.article || {};
  const info = row.article || {};
  const meta = info.meta || {};

  S.code = row.code || code;
  S.title = row.title || "";
  S.desc = row.description || "";
  S.html = res.body || "";
  S.thumb = row.thumbnail || "";
  S.language = row.language || "en";
  S.vis = ["general", "limited", "private", "followers"].includes(row.visibility) ? row.visibility : "general";
  S.status = row.status || "draft";
  S.place = meta.place === "help" ? "help" : "content";
  S.field = meta.field || "";
  S.category = meta.category || "";
  S.keyword = meta.main_keyword || "";
  S.subs = Array.isArray(meta.sub_keywords) ? meta.sub_keywords.slice(0, LONGTAIL_MAX) : [];
  S.otherMeta = otherMetaOf(meta);
  S.attachments = Array.isArray(meta.attachments) ? meta.attachments.filter((file) => file && file.url) : [];
  S.help = meta.help || "";
  S.tags = (Array.isArray(row.keywords) ? row.keywords : []).filter((tag) => tag.role === "main").map((tag) => tag.keyword);
  S.hasPassword = Boolean(row.asks_password);
  S.people = (Array.isArray(res.authorized) ? res.authorized : []).filter(Boolean);
  S.countries = (Array.isArray(row.audience) ? row.audience : [])
    .filter((rule) => rule.kind === "country" && rule.mode !== "exclude")
    .map((rule) => rule.value);
  S.langs = (Array.isArray(row.audience) ? row.audience : [])
    .filter((rule) => rule.kind === "language" && rule.mode !== "exclude")
    .map((rule) => rule.value);
  const levels = (Array.isArray(row.audience) ? row.audience : [])
    .filter((rule) => rule.kind === "level" && rule.mode !== "exclude")
    .map((rule) => Number(rule.value))
    .filter((n) => Number.isFinite(n));
  if (levels.length) {
    S.lvMin = Math.min(...levels);
    S.lvMax = Math.max(...levels);
  }
  if (row.scheduled_at) {
    S.when = "later";
    S.whenAt = isoLocal(new Date(row.scheduled_at));
  }

  const title = $("[data-e-title]");
  const desc = $("[data-e-desc]");
  const body = $("[data-e-body]");
  const field = $("[data-e-field]");
  const category = $("[data-e-category]");
  const lang = $("[data-e-lang]");
  if (title) title.value = S.title;
  if (desc) desc.value = S.desc;
  if (body) {
    if (rte) rte.setHtml(S.html);
    else body.innerHTML = S.html;
  }
  if (field) field.value = S.field;
  if (category) category.value = S.category;
  fillKeywords();
  if (lang) lang.value = S.language;

  const heading = $("[data-e-heading]");
  if (heading) heading.textContent = isQuestion() ? "Edit a question" : "Edit an article";
  const sub = $("[data-e-sub]");
  if (sub) sub.textContent = `${S.code} · ${S.status === "published" ? "published" : S.status}`;
  return true;
}

function fillLanguages() {
  const lang = $("[data-e-lang]");
  if (lang) lang.innerHTML = LANGUAGES.map(([code, label]) => `<option value="${code}">${esc(label)}</option>`).join("");
}

async function boot() {
  S.token = sessionToken() || "";
  fillLanguages();
  paintKind();
  bind();

  if (EMBED) {
    /* the studio owns the shell here: nothing is filled in until it says
       which blog, and which piece (if any) it wants written */
    document.addEventListener("ae:open", (event) => {
      startEmbedded((event && event.detail) || {}).catch((error) => {
        console.warn("[1World] writing room:", error && error.message);
      });
    });
    return;
  }

  if (!S.token) {
    showState({
      title: "Sign in to write",
      text: "An article is published in your name, so it needs an account. Sign in and come back — what you write here stays on this page.",
      iconName: "pen",
      action: `<a class="btn btn--primary btn--sm" href="login.html?next=${encodeURIComponent("article-editor.html")}">${icon("login")} Sign in</a>
               <a class="btn btn--ghost btn--sm" href="articles.html" style="margin-left:.5rem">${icon("arrowLeft")} All articles</a>`,
    });
    return;
  }

  const shell = $("[data-e-shell]");
  if (shell) shell.hidden = false;

  const params = new URLSearchParams(location.search);
  const code = params.get("id") || "";
  if (code) await loadExisting(code);

  paintAll();

  /* a draft left on this device comes back before anything else is typed */
  const draft = readDraft();
  if (draft) {
    restoreDraft(draft);
    const title = $("[data-e-title]");
    if (title) title.value = S.title;
    const desc = $("[data-e-desc]");
    if (desc) desc.value = S.desc;
    if (rte) rte.setHtml(S.html);
    fillKeywords();
    paintAll();
    toast({ title: "Draft restored", message: "The last thing you wrote here is back. Publish or discard it.", tone: "info", iconName: "file" });
  }

  loadMine();
  loadFields();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot, { once: true });
} else {
  boot();
}
