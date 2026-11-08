/**
 * video-editor.html — publish a video.
 * ------------------------------------------------------------------
 * One page, one server call:
 *
 *   video_save(token, {
 *     id?, title, description, thumbnail, embed, language,
 *     visibility,       general · limited · private · followers
 *     status,           draft · published · scheduled
 *     scheduled_at,     only when scheduled
 *     platform,         youtube | vimeo | facebook | instagram | pinterest | tiktok | reddit | x
 *     keywords[],       { word, subs[] } — three mains at most, five subs under each, fifteen in all
 *     audience[],       { kind: country|language|level|entity, value, mode: include }
 *     profiles[],       the nominated list a private video opens to
 *     passwords[],      hashed by the server; never readable again
 *     meta{ age, download, vertical, source, platform, keywords, host_file }
 *   })
 *
 * The same call edits: `?id=PST-001005` pre-fills the form from
 * video_get, and the payload carries the code back.
 *
 * A file uploaded while a **studio** is chosen does not go to the site's
 * storage: it goes to Streamtape, into `Home / Users / Studio / <studio code>`,
 * and takes the video's own code as its name (see `streamtape.js`). Without a
 * studio, a small file still goes to storage and its link is filled in.
 */
import { rpc } from "./data.js";
import { videoUrl } from "./media.js";
import { qs, qsa, esc } from "./utils.js";
import { icon } from "./icons.js";
import { toast } from "./ui.js";
import { sessionToken, getMember } from "./session.js";
import { COUNTRIES } from "./countries.js";
import { SUPABASE, storageUrl } from "./config.js";
import { embedUrl, autoThumb, isFile, sourceKind, sourceLabel, HOSTS, pinterestId, redditPath } from "./embed.js";
import { createContents } from "./contents.js";
import { studioReady, uploadToStudio, renameFile, NOT_CONNECTED } from "./streamtape.js";

const S = {
  token: "",
  code: "",
  embed: "",
  title: "",
  desc: "",
  /* three main keywords at most, five sub-keywords under each */
  keywords: [],
  platform: "",
  /* the index: `00:38 · Overview` — written here, read by the watch page */
  chapters: [],
  thumb: "",
  thumbChosen: false,
  thumbAuto: false,
  vis: "general",
  when: "now",
  whenAt: "",
  countries: [],
  langs: [],
  lvMin: 1,
  lvMax: 10,
  followers: false,
  people: [],
  passes: [],
  hasPassword: false,
  language: "en",
  age: "none",
  download: false,
  vertical: false,
  status: "draft",
  hub: "",
  hubName: "",
  hubs: [],
  /* the file on the studio's host: { id, name, ext, studio, folder, named } */
  host: null,
  busy: false,
  ready: false,
};

const LANGUAGES = [
  ["ar", "Arabic"],
  ["en", "English"],
  ["fr", "French"],
  ["es", "Spanish"],
  ["de", "German"],
  ["it", "Italian"],
  ["pt", "Portuguese"],
  ["tr", "Turkish"],
];

/* which hubs can hold a member video — the server's own rule
   (creator_kind_allowed): a studio, a server, a cinema. */
const HUB_KINDS = ["channel", "server", "cinema"];
const HUB_KIND_LABEL = { channel: "studio", server: "server", cinema: "cinema" };

const VIS_HINT = {
  general: "Everyone, except the people you exclude. No account, no condition.",
  limited: "Only the audience below — a country, a language, a level, or people you name.",
  private: "Only the members you nominate, and whoever holds one of your passwords.",
  followers: "Only the people who follow you. Nobody else, whatever their level.",
};

const ERRORS = {
  session: "Your session ended — sign in again.",
  title: "A title is needed.",
  title_long: "The title is longer than 200 characters.",
  visibility: "Pick public, exclusive or private.",
  status: "That status is not one we know.",
  embed: "That link is not a link we can open.",
  schedule: "A scheduled video needs a moment in the future.",
  profile: "Your member profile is missing — open your profile once, then come back.",
  role: "That video belongs to someone else.",
  not_found: "That video is gone.",
  hub: "That studio is not one we know.",
  hub_role: "That studio belongs to someone else — you are not its owner or staff.",
  hub_kind: "That hub cannot hold a video.",
};

const $ = (sel) => qs(sel);
const el = {};
let contents = null;

/* The form can also be embedded, so a page can lend it a hub instead of
   keeping a second, thinner editor of its own: the host says so on
   <body data-ved-embed="1"> and names the hub it picked on
   <body data-ved-hub="IDCN100006">. In that mode the list of hubs comes from
   `publisher_hubs` (the hubs an owner approved this member into, or their own
   and the ones they staff), and a publish never carries the member off the
   page. No page embeds it today — `publisher.html` is the program alone and a
   publisher writes in `creator.html` — but the mode is part of the editor. */
const EMBED = document.body.dataset.vedEmbed === "1";

/* ================================================================== */
/* helpers                                                            */
/* ================================================================== */
function randomPassword() {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  let out = "";
  const bytes = new Uint32Array(12);
  try {
    crypto.getRandomValues(bytes);
  } catch {
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.random() * 4294967296;
  }
  for (let i = 0; i < 12; i += 1) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

function isoLocal(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function whenDate() {
  if (S.when === "now") return null;
  if (S.when === "later") {
    const value = S.whenAt;
    if (!value) return null;
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const minutes = { "1h": 60, "1d": 1440, "1w": 10080 }[S.when] || 0;
  if (!minutes) return null;
  return new Date(Date.now() + minutes * 60000);
}

/* ================================================================== */
/* paint                                                              */
/* ================================================================== */
function paintCounters() {
  const titleCount = $("[data-ved-title-count]");
  if (titleCount) {
    titleCount.textContent = `${S.title.length} / 150`;
    titleCount.classList.toggle("is-over", S.title.length > 150);
  }
  const descCount = $("[data-ved-desc-count]");
  if (descCount) descCount.textContent = `${S.desc.length} / 5000`;
  const tagCount = $("[data-ved-tag-count]");
  if (tagCount) {
    tagCount.textContent = `${S.keywords.length} / ${MAIN_MAX} main · ${subCount()} / ${SUB_MAX_TOTAL} sub`;
    tagCount.classList.toggle("is-over", S.keywords.length > MAIN_MAX || subCount() > SUB_MAX_TOTAL);
  }
  const platformNote = $("[data-ved-platform-note]");
  if (platformNote) {
    const kind = S.platform || sourceKind(S.embed.trim());
    platformNote.textContent = kind ? HOSTS[kind] || "read from the link" : "read from the link";
  }
}

function paintPreview() {
  const media = $("[data-ved-preview-media]");
  if (media) {
    const src = S.thumb || autoThumb(S.embed);
    const kind = sourceKind(S.embed);
    if (src) {
      media.innerHTML = `<img src="${esc(src)}" alt="" loading="lazy" /><span class="vprev__play" aria-hidden="true">${icon("play")}</span>`;
    } else if (kind) {
      /* no still to read: name the host inside the card rather than a blank */
      media.innerHTML = `<div class="vprev__ph"><span>${esc(HOSTS[kind] || "Link")}</span>${icon("playCircle")}<span>${esc(S.embed ? "A picture would make the card" : "")}</span></div>`;
    } else {
      media.innerHTML = `<div class="vprev__ph">${icon("film")}</div>`;
    }
  }
  const title = $("[data-ved-preview-title]");
  if (title) title.textContent = S.title.trim() || "No title yet";
  const meta = $("[data-ved-preview-meta]");
  if (meta) {
    const lang = (LANGUAGES.find(([code]) => code === S.language) || ["", S.language])[1];
    const vis = { general: "Public", limited: "Exclusive", private: "Private", followers: "Followers" }[S.vis];
    meta.textContent = `${vis} · ${lang}`;
  }
  const time = $("[data-ved-preview-time]");
  if (time) {
    const date = whenDate();
    time.textContent = date
      ? `Goes out ${date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}`
      : "Goes out the moment you publish";
  }
  const studio = $("[data-ved-preview-studio]");
  if (studio) {
    const hub = S.hubs.find((h) => h.code === S.hub);
    const name = hub ? hub.name : S.hub ? S.hubName || S.hub : "";
    studio.hidden = !S.hub;
    studio.innerHTML = S.hub
      ? `${icon("tv")} <span>in ${esc(name)}</span>`
      : "";
  }

  /* the preview card is the door: a saved video opens its own page, and the
     shape it was saved with is the address it gets — `#/v/` for a vertical */
  const open = $("[data-ved-preview-open]");
  if (open) {
    const canOpen = Boolean(S.code) && S.status !== "draft";
    if (canOpen) {
      open.setAttribute("href", videoUrl(S.code, S.vertical ? "v" : "h"));
      open.setAttribute("aria-disabled", "false");
      open.removeAttribute("hidden");
    } else {
      open.removeAttribute("href");
      open.setAttribute("aria-disabled", "true");
    }
    const hint = $("[data-ved-preview-hint]");
    if (hint) {
      hint.hidden = canOpen;
      hint.textContent = S.code
        ? "Publish it to watch it — a draft has no page yet."
        : "Save it once: the card then opens the video's page.";
    }
  }

  const badge = $("[data-ved-preview-badge]");
  if (badge) badge.textContent = S.status === "published" && S.code ? "Published" : S.status === "scheduled" ? "Scheduled" : "Draft";

  const badge2 = $("[data-ved-source-badge]");
  if (badge2) {
    badge2.textContent = S.embed ? HOSTS[sourceKind(S.embed)] || "Link" : "";
  }
}

function paintThumb() {
  const box = $("[data-ved-thumb-box]");
  if (!box) return;
  const src = S.thumb || autoThumb(S.embed);
  box.innerHTML = src ? `<img src="${esc(src)}" alt="" loading="lazy" />` : "No picture yet";
  const input = $("[data-ved-thumb]");
  if (input && input.value !== S.thumb) input.value = S.thumb;

  /* the honest part: only YouTube hands us a still by itself */
  const hint = $("[data-ved-thumb-hint]");
  if (hint) {
    const kind = sourceKind(S.embed);
    if (src && S.thumbAuto) {
      hint.textContent = "Taken from the video. Upload one to replace it.";
    } else if (src) {
      hint.textContent = "";
    } else if (!S.embed.trim()) {
      hint.textContent = "Add the video first, then upload a picture for the card.";
    } else if (kind === "youtube") {
      hint.textContent = "The still from the video is on its way.";
    } else if (kind === "file") {
      hint.textContent = "A file has no still we can read — upload a picture, or the card goes grey.";
    } else {
      hint.textContent = `${HOSTS[kind] || "This host"} does not hand us a picture — upload one so the card is not blank.`;
    }
  }
}

const MAIN_MAX = 3;
const SUB_MAX = 5;
const SUB_MAX_TOTAL = 15;

const subCount = () => S.keywords.reduce((sum, row) => sum + row.subs.length, 0);

/* one main keyword, and its sub-keywords hanging under it */
function paintTags() {
  const host = $("[data-ved-tags]");
  if (!host) return;
  host.innerHTML = S.keywords
    .map(
      (row, index) => `
      <div class="vkw" data-ved-kw="${index}">
        <div class="vkw__head">
          <span class="tag">${esc(row.word)}${index === 0 ? ' <b class="vkw__field">field</b>' : ""}
            <button type="button" data-ved-tag-remove="${index}" aria-label="Remove ${esc(row.word)}">${icon("close")}</button>
          </span>
          <span class="vkw__count">${row.subs.length} / ${SUB_MAX} sub</span>
        </div>
        ${
          row.subs.length
            ? `<div class="vkw__subs">${row.subs
                .map(
                  (sub, at) =>
                    `<span class="tag tag--sub">${esc(sub)}<button type="button" data-ved-sub-remove="${index}:${at}" aria-label="Remove ${esc(sub)}">${icon("close")}</button></span>`
                )
                .join("")}</div>`
            : ""
        }
        <div class="vkw__add">
          <input class="input" type="text" maxlength="40" data-ved-sub-input="${index}"
                 placeholder="${row.subs.length >= SUB_MAX ? "Five is the ceiling" : `A sub-keyword under “${esc(row.word)}”`}"
                 autocomplete="off" ${row.subs.length >= SUB_MAX ? "disabled" : ""} />
          <button class="btn btn--ghost btn--sm" type="button" data-ved-sub-add="${index}" ${row.subs.length >= SUB_MAX ? "disabled" : ""}>${icon("plus")} Sub</button>
        </div>
      </div>`
    )
    .join("");
}

/* ------------------------------------------------------------------ */
/* the index                                                          */
/* ------------------------------------------------------------------ */
/* A chapter is a time and a name. The time is written the way a member
   says it (`0:38`, `00:38`, `1:02:03`) and stored the way a player reads
   it (`m:ss`); a row without both halves is dropped on save, never saved
   half-written. */
function chapterTime(value) {
  const text = String(value || "").trim().replace(/[^0-9:]/g, "");
  if (!text) return "";
  const parts = text.split(":").filter((part) => part !== "");
  if (!parts.length) return "";
  const nums = parts.map((part) => Number(part));
  if (nums.some((num) => Number.isNaN(num))) return "";
  if (nums.length === 1) return `0:${String(nums[0]).padStart(2, "0")}`;
  if (nums.length === 2) return `${nums[0]}:${String(nums[1]).padStart(2, "0")}`;
  return `${nums[0]}:${String(nums[1]).padStart(2, "0")}:${String(nums[2]).padStart(2, "0")}`;
}

function chapterSeconds(value) {
  const parts = String(chapterTime(value) || "0:00").split(":").map((part) => Number(part));
  return parts.reduce((total, part) => total * 60 + part, 0);
}

function paintChapters() {
  const host = $("[data-ved-chapters]");
  if (!host) return;
  const rows = S.chapters;
  host.innerHTML = rows.length
    ? rows
        .map(
          (row, index) => `
        <li class="vchp" data-ved-chapter="${index}">
          <span class="vchp__n">${esc(String(index + 1).padStart(2, "0"))}</span>
          <input class="input vchp__time" type="text" inputmode="numeric" value="${esc(row.time)}" placeholder="00:00"
                 aria-label="Chapter ${index + 1} time" data-ved-chapter-time="${index}" spellcheck="false" />
          <input class="input vchp__label" type="text" value="${esc(row.label)}" placeholder="What happens here"
                 aria-label="Chapter ${index + 1} name" data-ved-chapter-label="${index}" />
          <button class="vchp__del" type="button" data-ved-chapter-del="${index}" aria-label="Remove chapter ${index + 1}">${icon("trash")}</button>
        </li>`
        )
        .join("")
    : `<li class="vchp__none">No chapter yet. The first one is usually <b>00:00</b> and says what the video is.</li>`;
  const count = $("[data-ved-chapter-count]");
  if (count) count.textContent = `${rows.length} ${rows.length === 1 ? "chapter" : "chapters"}`;
}

function paintPeople() {
  const host = $("[data-ved-people]");
  if (!host) return;
  host.innerHTML = S.people.length
    ? S.people
        .map(
          (who, index) => `<span class="tag">${esc(who)}<button type="button" data-ved-person-remove="${index}" aria-label="Remove ${esc(who)}">${icon("close")}</button></span>`
        )
        .join("")
    : `<p class="vhint">Nobody named yet.</p>`;
}

function paintPasses() {
  const host = $("[data-ved-passes]");
  if (!host) return;
  const note = S.hasPassword && !S.passes.length
    ? `<p class="vhint vhint--warn">This video already has a password on the server. Adding one here replaces the set.</p>`
    : "";
  host.innerHTML =
    (S.passes.length
      ? S.passes
          .map(
            (pass, index) => `<span class="tag">${esc(pass)}<button type="button" data-ved-pass-remove="${index}" aria-label="Remove the password">${icon("close")}</button></span>`
          )
          .join("")
      : `<p class="vhint">No password on this one.</p>`) + note;
}

function paintCountries() {
  const host = $("[data-ved-countries]");
  if (host) {
    host.innerHTML = S.countries.length
      ? S.countries
          .map(
            (name, index) => `<span class="tag">${esc(name)}<button type="button" data-ved-country-remove="${index}" aria-label="Remove ${esc(name)}">${icon("close")}</button></span>`
          )
          .join("")
      : `<p class="vhint">Every country.</p>`;
  }
  const langs = $("[data-ved-langs]");
  if (langs) {
    langs.innerHTML = S.langs.length
      ? S.langs
          .map(
            (code, index) =>
              `<span class="tag">${esc((LANGUAGES.find(([c]) => c === code) || ["", code])[1])}<button type="button" data-ved-lang-remove="${index}" aria-label="Remove">${icon("close")}</button></span>`
          )
          .join("")
      : `<p class="vhint">Every language.</p>`;
  }
}

function paintVisibility() {
  qsa("[data-vis]", el.shell).forEach((btn) => {
    btn.classList.toggle("is-on", btn.getAttribute("data-vis") === S.vis);
  });
  const hint = $("[data-ved-vis-hint]");
  if (hint) hint.textContent = VIS_HINT[S.vis] || VIS_HINT.general;
  const audience = $("[data-ved-audience]");
  if (audience) audience.hidden = !(S.vis === "limited" || S.vis === "followers");
  const priv = $("[data-ved-private]");
  if (priv) priv.hidden = S.vis !== "private";
  const passes = $("[data-ved-pass-wrap]");
  if (passes) {
    passes.hidden = S.vis === "general" || S.vis === "followers";
    if (passes.hidden) passes.open = false;
  }
  const followers = $("[data-ved-followers]");
  if (followers) followers.checked = S.vis === "followers";
}

function paintWhen() {
  qsa("[data-when]", el.shell).forEach((btn) => {
    btn.classList.toggle("is-on", btn.getAttribute("data-when") === S.when);
  });
  const field = $("[data-ved-when-date]");
  if (field) field.hidden = S.when !== "later";
  const input = $("[data-ved-when-input]");
  if (input && S.when === "later" && !input.value) {
    input.value = S.whenAt || isoLocal(new Date(Date.now() + 3600000));
    S.whenAt = input.value;
  }
  const hint = $("[data-ved-when-hint]");
  if (hint) {
    const date = whenDate();
    hint.textContent = date
      ? `It stays invisible until ${date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}.`
      : "It goes out the moment you publish.";
  }
}

/**
 * Which studio the video is published into. A member may run none, one or
 * several (a studio, a server, a cinema) — the list comes from the same call
 * the creator studio uses, and an empty answer is said plainly rather than
 * left as an empty box.
 */
function paintHub() {
  const select = $("[data-ved-hub]");
  const note = $("[data-ved-hub-note]");
  const link = $("[data-ved-hub-link]");
  const count = $("[data-ved-hub-count]");
  const list = S.hubs;
  const hub = list.find((h) => h.code === S.hub);

  if (select) {
    const known = Boolean(hub);
    select.innerHTML =
      (EMBED ? "" : `<option value="">My own feed — no studio</option>`) +
      list
        .map(
          (h) =>
            `<option value="${esc(h.code)}">${esc(h.name)} · ${esc(HUB_KIND_LABEL[h.kind] || "studio")}${h.code ? ` · ${esc(h.code)}` : ""}</option>`
        )
        .join("") +
      (!known && S.hub
        ? `<option value="${esc(S.hub)}">${esc(S.hubName || S.hub)}</option>`
        : "");
    select.value = S.hub || "";
    const label = select.closest("label");
    if (label) label.hidden = !list.length && !S.hub;
  }

  if (count) count.textContent = list.length ? `${list.length} studio${list.length === 1 ? "" : "s"}` : "";

  if (note) {
    if (hub) {
      note.textContent = EMBED
        ? `${hub.name} · ${hub.code} — published here, live, under your name.`
        : `${hub.name} · ${hub.code} — it appears in this studio's Videos tab, and in the feed.`;
    } else if (S.hub) {
      note.textContent = `${S.hubName || S.hub} · ${S.hub} — it appears in that studio's Videos tab, and in the feed.`;
    } else if (!list.length) {
      note.textContent = EMBED
        ? "No hub has approved you as a publisher yet. Ask its owner from the hub's own page."
        : "You run no studio yet. Create one, and it appears here.";
    } else {
      note.textContent = "It stays in your own feed. Pick a studio and it appears in that studio too.";
    }
  }

  if (link) {
    if (hub) {
      link.hidden = false;
      link.href = `creator.html?studio=${encodeURIComponent(hub.code)}`;
      link.innerHTML = `${icon("tv")} ${EMBED ? "Open the hub" : "Open this studio"}`;
    } else if (!list.length) {
      link.hidden = false;
      link.href = "creator.html?section=studio";
      link.innerHTML = `${icon("plus")} Create a studio`;
    } else {
      link.hidden = true;
    }
  }
}

function paintAge() {
  qsa("[data-age]", el.shell).forEach((btn) => {
    btn.classList.toggle("is-on", btn.getAttribute("data-age") === S.age);
  });
}

function paintStatus() {
  const state = $("[data-ved-status]");
  const dot = $("[data-ved-dot]");
  const save = $("[data-ved-save]");
  const publish = $("[data-ved-publish]");
  const check = readiness();
  if (state) state.textContent = check.message;
  if (dot) dot.classList.toggle("is-ready", check.ok);
  if (save) save.disabled = S.busy || !S.title.trim();
  if (publish) {
    publish.disabled = S.busy || !check.ok;
    const label = S.when === "now" ? (S.code ? "Save and publish" : "Publish") : "Schedule";
    publish.innerHTML = `${icon("upload")} ${label}`;
  }
}

/**
 * The contents of the form: every section of it, in the order it is read —
 * the source, the words, the extras, then the side column's own. One press
 * goes there; the box that lists them is not one of them.
 */
function contentsItems() {
  const shell = $("[data-ved-shell]");
  if (!shell) return [];
  return [...shell.querySelectorAll(".vcard-box")]
    .filter((box) => !box.hasAttribute("data-ved-toc-box") && !box.hidden)
    .map((box) => {
      const title = box.querySelector(".vcard-box__title");
      return title ? { node: box, label: (title.textContent || "").trim() } : null;
    })
    .filter(Boolean);
}

function paintContents() {
  if (!contents) return;
  const items = contentsItems();
  contents.paint(items);
  const count = $("[data-ved-toc-count]");
  if (count) count.textContent = `${items.length} section${items.length === 1 ? "" : "s"}`;
}

/** Go there: the page scrolls, the section lights, its first field takes the caret. */
function jumpToSection(item) {
  const node = item && item.node;
  if (!node || !node.isConnected) return;
  node.scrollIntoView?.({ behavior: "smooth", block: "start" });
  node.classList.add("is-jump");
  setTimeout(() => node.classList.remove("is-jump"), 1400);

  /* the section itself takes the focus — a radio is not a place to land in,
     and a form of switches would have nowhere to put a caret at all */
  node.setAttribute("tabindex", "-1");
  node.focus?.({ preventScroll: true });
  const first = node.querySelector(
    'input:not([type="hidden"]):not([type="radio"]):not([type="checkbox"]):not([disabled]):not([hidden]), textarea:not([disabled]):not([hidden]), select:not([disabled]):not([hidden])'
  );
  first?.focus?.({ preventScroll: true });
}

/* the platform select follows the state, so an edit of a saved video, a
   reset, and a picked host all show the same thing */
function paintPlatform() {
  const select = $("[data-ved-platform]");
  if (select && select.value !== (S.platform || "")) select.value = S.platform || "";
}

function paintAll() {
  paintContents();
  paintSourceNote();
  paintPlayer();
  paintCounters();
  paintPreview();
  paintThumb();
  paintChapters();
  paintTags();
  paintPlatform();
  paintDropNote();
  paintPeople();
  paintPasses();
  paintCountries();
  paintVisibility();
  paintWhen();
  paintHub();
  paintAge();
  paintStatus();
}

/* ================================================================== */
/* validation                                                         */
/* ================================================================== */
function audienceRules() {
  const rules = [];
  if (S.vis === "followers") return rules;
  S.countries.forEach((name) => rules.push({ kind: "country", value: name, mode: "include" }));
  S.langs.forEach((code) => rules.push({ kind: "language", value: code, mode: "include" }));
  const min = Math.max(0, Math.min(10, Number(S.lvMin) || 0));
  const max = Math.max(0, Math.min(10, Number(S.lvMax) || 10));
  if (!(min <= 1 && max >= 10)) {
    for (let level = Math.min(min, max); level <= Math.max(min, max); level += 1) {
      rules.push({ kind: "level", value: String(level), mode: "include" });
    }
  }
  return rules;
}

function readiness() {
  if (!S.embed.trim()) return { ok: false, message: "Add the video link to begin" };
  if (!S.title.trim()) return { ok: false, message: "The title is still empty" };
  if (S.title.trim().length > 200) return { ok: false, message: "The title is too long" };
  if (S.keywords.length > MAIN_MAX) return { ok: false, message: `${MAIN_MAX} main keywords at most` };
  if (S.keywords.some((row) => row.subs.length > SUB_MAX)) return { ok: false, message: `${SUB_MAX} sub-keywords under one keyword` };
  if (subCount() > SUB_MAX_TOTAL) return { ok: false, message: `${SUB_MAX_TOTAL} sub-keywords in all` };
  if (S.vis === "limited" && !S.followers) {
    const rules = audienceRules();
    const named = S.people.length > 0;
    if (!rules.length && !named) {
      return { ok: false, message: "An exclusive video needs an audience — add a rule or name someone" };
    }
  }
  if (S.vis === "private" && !S.people.length && !S.passes.length && !S.hasPassword) {
    return { ok: false, message: "A private video needs one nominated member or one password" };
  }
  if (S.when !== "now" && !whenDate()) {
    return { ok: false, message: "Pick the moment it goes out" };
  }
  if (S.when === "later" && whenDate() && whenDate().getTime() < Date.now() + 60000) {
    return { ok: false, message: "That moment has already passed" };
  }
  return { ok: true, message: S.code ? "Ready to save your changes" : "Ready to publish" };
}

/* ================================================================== */
/* the payload                                                        */
/* ================================================================== */
function payload(status) {
  const date = whenDate();
  const people = [...S.people];
  const rules = audienceRules();
  if (S.vis === "limited") {
    people.forEach((who) => rules.push({ kind: "entity", value: who.startsWith("@") ? who : `@${who}`, mode: "include" }));
  }
  const body = {
    id: S.code || null,
    hub: S.hub || null,
    title: S.title.trim(),
    description: S.desc.trim() || null,
    thumbnail: (S.thumb || autoThumb(S.embed) || "").trim() || null,
    embed: S.embed.trim() || null,
    language: S.language,
    visibility: S.vis,
    status,
    scheduled_at: status === "scheduled" && date ? date.toISOString() : null,
    tags: S.keywords.slice(0, MAIN_MAX).map((row) => row.word),
    audience: rules,
    profiles: people,
    meta: {
      age: S.age,
      download: Boolean(S.download),
      vertical: Boolean(S.vertical),
      source: S.platform || sourceKind(S.embed) || "embed",
      /* the platform the member picked, when they picked one */
      platform: S.platform || sourceKind(S.embed) || null,
      /* the file on the studio's host, when the video lives there. The name
         is not stored: it is the video's own code, so the record cannot go
         stale between the upload and the rename. */
      host_file: S.host
        ? { id: S.host.id, studio: S.host.studio, folder: S.host.folder || S.host.studio, ext: S.host.ext || "mp4" }
        : null,
      /* the two levels of keywords, beside the flat `tags` the site reads */
      keywords: S.keywords.slice(0, MAIN_MAX).map((row) => ({
        keyword: row.word,
        subs: row.subs.slice(0, SUB_MAX),
      })),
      /* the index travels with the video: `start` is m:ss, `label` the words */
      chapters: S.chapters
        .map((row) => ({ start: chapterTime(row.time), label: String(row.label || "").trim() }))
        .filter((row) => row.start && row.label)
        .sort((a, b) => chapterSeconds(a.start) - chapterSeconds(b.start)),
    },
  };
  /* the passwords we were never shown are the passwords we must not wipe:
     the key rides along only when the member added one in this visit. */
  if (S.passes.length) body.passwords = S.passes;
  return body;
}

async function save(status) {
  if (S.busy) return;
  if (status !== "draft") {
    const check = readiness();
    if (!check.ok) {
      toast({ title: "Not yet", message: check.message, tone: "error", iconName: "info" });
      return;
    }
  }
  if (!S.title.trim()) {
    toast({ title: "A title first", message: "Even a draft needs a name.", tone: "error" });
    document.querySelector("[data-ved-title]")?.focus();
    return;
  }

  S.busy = true;
  paintStatus();
  let res = null;
  try {
    res = await rpc("video_save", { p_token: S.token, p_payload: payload(status) });
  } catch (error) {
    toast({ title: "The server refused it", message: error.message, tone: "error" });
  }
  S.busy = false;

  if (!res || res.ok !== true) {
    const key = res && res.error;
    toast({
      title: "Not saved",
      message: ERRORS[key] || "The server did not take that. Try again in a moment.",
      tone: "error",
      iconName: "info",
    });
    paintStatus();
    return;
  }

  S.code = res.code || S.code;
  S.status = res.status || status;
  await nameHostFile();
  paintAll();

  if (status === "draft") {
    scheduleDraft();
    toast({ title: "Draft saved", message: "Find it again under your videos.", tone: "success", iconName: "check" });
    if (EMBED) {
      document.dispatchEvent(new CustomEvent("ved:drafted", { detail: { code: S.code, hub: S.hub } }));
      return;
    }
    if (!location.search.includes("id=")) window.history.replaceState(null, "", `?id=${encodeURIComponent(S.code)}`);
    const heading = $("[data-ved-heading]");
    if (heading) heading.textContent = "Edit a video";
    return;
  }

  clearDraft();
  toast({
    title: status === "scheduled" ? "Scheduled" : "Published",
    message: status === "scheduled" ? "It opens by itself at the moment you picked." : "It is in the feed now.",
    tone: "success",
    iconName: "check",
  });

  if (EMBED) {
    /* the desk stays where it is: it lists the new video and hands the member a
       clean form for the next one, instead of carrying them away from the hub */
    const done = { code: S.code, status: S.status, hub: S.hub, title: S.title };
    resetForm();
    document.dispatchEvent(new CustomEvent("ved:published", { detail: done }));
    return;
  }

  setTimeout(() => {
    location.href = `videos.html#/v/${encodeURIComponent(S.code)}`;
  }, 650);
}

/* ================================================================== */
/* a fresh form — the desk's, after a publish                         */
/* ================================================================== */
function resetForm() {
  S.code = "";
  S.title = "";
  S.desc = "";
  S.embed = "";
  S.thumb = "";
  S.thumbChosen = false;
  S.thumbAuto = false;
  S.keywords = [];
  S.platform = "";
  S.host = null;
  S.people = [];
  S.passes = [];
  S.hasPassword = false;
  S.countries = [];
  S.langs = [];
  S.lvMin = 1;
  S.lvMax = 10;
  S.followers = false;
  S.vis = "general";
  S.when = "now";
  S.whenAt = "";
  S.language = "en";
  S.age = "none";
  S.download = false;
  S.vertical = false;
  S.status = "draft";
  S.busy = false;
  /* the hub is the desk's, and it stays: the next video goes to the same place */
  if (el.title) el.title.value = "";
  if (el.desc) el.desc.value = "";
  if (el.embed) el.embed.value = "";
  if (el.thumb) el.thumb.value = "";
  if (el.tagInput) el.tagInput.value = "";
  if (el.lang) el.lang.value = "en";
  const vertical = $("[data-ved-vertical]");
  if (vertical) vertical.checked = false;
  const download = $("[data-ved-download]");
  if (download) download.checked = false;
  const followers = $("[data-ved-followers]");
  if (followers) followers.checked = false;
  const lvMin = $("[data-ved-lv-min]");
  if (lvMin) lvMin.value = "1";
  const lvMax = $("[data-ved-lv-max]");
  if (lvMax) lvMax.value = "10";
  paintAll();
  if (el.embed) el.embed.dispatchEvent(new Event("input"));
  if (el.title) el.title.focus();
}

/* ================================================================== */
/* filling the form                                                   */
/* ================================================================== */
function fillSelects() {
  const lang = $("[data-ved-lang]");
  if (lang) {
    lang.innerHTML = LANGUAGES.map(([code, label]) => `<option value="${code}">${label}</option>`).join("");
  }
  const country = $("[data-ved-country-sel]");
  if (country) {
    country.innerHTML =
      `<option value="">Add a country…</option>` +
      COUNTRIES.map((row) => `<option value="${esc(row.name)}">${esc(row.name)}</option>`).join("");
  }
  const langSel = $("[data-ved-lang-sel]");
  if (langSel) {
    langSel.innerHTML =
      `<option value="">Add a language…</option>` + LANGUAGES.map(([code, label]) => `<option value="${code}">${label}</option>`).join("");
  }
}

function setVisibility(vis) {
  S.vis = vis;
  paintVisibility();
  paintPreview();
  paintStatus();
}

function addTag(raw) {
  const tag = String(raw || "").replace(/\s+/g, " ").trim().slice(0, 40);
  if (!tag) return;
  if (S.keywords.length >= MAIN_MAX) {
    toast({
      title: `${MAIN_MAX} main keywords is the ceiling`,
      message: "Remove one to add another — or put this one under a keyword you already have.",
      tone: "error",
      iconName: "info",
      duration: 3200,
    });
    return;
  }
  if (S.keywords.some((row) => row.word.toLowerCase() === tag.toLowerCase())) return;
  S.keywords.push({ word: tag, subs: [] });
  paintTags();
  paintCounters();
  paintStatus();
}

function addSub(index, raw) {
  const row = S.keywords[Number(index)];
  if (!row) return;
  const sub = String(raw || "").replace(/\s+/g, " ").trim().slice(0, 40);
  if (!sub) return;
  if (row.subs.length >= SUB_MAX) {
    toast({ title: `${SUB_MAX} sub-keywords under one keyword`, message: "Remove one to add another.", tone: "error", iconName: "info", duration: 3000 });
    return;
  }
  if (subCount() >= SUB_MAX_TOTAL) {
    toast({ title: `${SUB_MAX_TOTAL} sub-keywords in all`, message: "Remove one to add another.", tone: "error", iconName: "info", duration: 3000 });
    return;
  }
  if (row.subs.some((one) => one.toLowerCase() === sub.toLowerCase())) return;
  row.subs.push(sub);
  paintTags();
  paintCounters();
  paintStatus();
}

/* the eight the picker names — a link to one of them chooses its own row */
const PLATFORM_VALUES = ["youtube", "vimeo", "facebook", "instagram", "pinterest", "tiktok", "reddit", "x"];
/* a platform picked by hand, and the link it was picked against: it stands
   while that link stands, and the link takes the row back when it moves on */
let manualPick = "";
let manualFor = "";

/**
 * The link says which platform it is, so the picker says it too — that is what
 * "choose the link's platform" means here: paste the address and the row is
 * filled in, and the member may still overrule it for that link.
 */
function syncPlatformFromLink() {
  const kind = sourceKind(S.embed.trim());
  if (manualPick && kind === manualFor) return;
  if (manualPick) {
    manualPick = "";
    manualFor = "";
  }
  const next = PLATFORM_VALUES.includes(kind) ? kind : "";
  if (S.platform === next) return;
  S.platform = next;
  const select = $("[data-ved-platform]");
  if (select && select.value !== next) select.value = next;
  paintCounters();
}

/** A dropped or pasted address lands in the field, and its platform follows. */
function applyLink(raw) {
  const value = String(raw || "").trim();
  if (!value || !/^https?:\/\//i.test(value)) return false;
  el.embed.value = value;
  manualPick = "";
  manualFor = "";
  el.embed.dispatchEvent(new Event("input"));
  const auto = autoThumb(value);
  if (auto) {
    S.thumb = auto;
    paintThumb();
    paintPreview();
  }
  return true;
}

/** The box says where the file it takes will land — the studio decides. */
function paintDropNote() {
  const note = $("[data-ved-drop-note]");
  if (!note) return;
  const studio = studioHub();
  note.textContent = studio
    ? `This studio's videos go to Streamtape — Home / Users / Studio / ${studio.code} — and take the video's own code as their name.`
    : "Without a studio, a small file stays in the site's storage. Choose a studio below and it goes to the studio's host instead.";
}

/** The studio this video belongs to, when it belongs to one. */
function studioHub() {
  const hub = S.hubs.find((row) => row.code === S.hub);
  return hub && hub.kind === "channel" ? hub : null;
}

/** The hubs this member may publish into — a studio, a server, a cinema. */
async function loadHubs() {
  let res = null;
  try {
    /* on the desk a hub is somewhere this member was approved to publish —
       owned, staffed, or a publisher's place — so it asks a different door */
    res = await rpc(EMBED ? "publisher_hubs" : "creator_hubs_list", { p_token: S.token });
  } catch (error) {
    console.warn("[1World] studios:", error.message);
  }
  if (!res || res.ok !== true) {
    S.hubs = [];
    return;
  }
  S.hubs = (Array.isArray(res.hubs) ? res.hubs : []).filter(
    (hub) => hub && hub.code && HUB_KINDS.includes(hub.kind)
  );
}

async function loadExisting(code) {
  let res = null;
  try {
    res = await rpc("video_get", { p_token: S.token, p_ref: code, p_key: "" });
  } catch (error) {
    console.warn("[1World] video:", error.message);
  }
  if (!res || res.ok !== true || res.locked || !res.video) {
    showState({
      title: "That video is not yours to edit",
      text: "It may be gone, or it belongs to another member.",
      action: `<a class="btn btn--primary btn--sm" href="videos.html">${icon("arrowLeft")} Back to the videos</a>`,
    });
    return false;
  }
  const v = res.video;
  const meta = (v.video && v.video.meta) || {};
  S.code = v.code || code;
  S.title = v.title || "";
  S.desc = v.description || "";
  S.thumb = v.thumbnail || "";
  S.embed = (v.video && v.video.embed) || v.embed || "";
  S.language = v.language || "en";
  S.vis = ["general", "limited", "private", "followers"].includes(v.visibility) ? v.visibility : "general";
  S.status = v.status || "draft";
  S.hasPassword = Boolean(res.asks_password);
  /* the mains come back as rows of their own, the subs under them by parent */
  const mains = Array.isArray(v.keywords) ? v.keywords.filter((k) => k.role === "main") : [];
  S.platform = String((v.video && v.video.meta && v.video.meta.platform) || v.meta?.platform || "") || "";
  const hostFile = (v.video && v.video.meta && v.video.meta.host_file) || v.meta?.host_file || null;
  /* a stored video's file already carries its code, so it is named */
  S.host = hostFile && hostFile.id ? { ...hostFile, ext: hostFile.ext || extensionOf({ name: hostFile.name || ".mp4" }), named: true } : null;
  S.keywords = mains.slice(0, MAIN_MAX).map((main) => ({
    word: String(main.keyword || ""),
    subs: Array.isArray(v.keywords)
      ? v.keywords
          .filter((k) => k.role !== "main" && (k.parent_id === main.id || k.parent === main.id || k.parent === main.keyword))
          .map((k) => String(k.keyword || ""))
          .filter(Boolean)
          .slice(0, SUB_MAX)
      : [],
  })).filter((row) => row.word);
  S.age = meta.age || "none";
  if (v.video && v.video.hub) {
    S.hub = v.video.hub.code || S.hub;
    S.hubName = v.video.hub.name || S.hubName;
  } else if (v.video) {
    S.hub = "";
    S.hubName = "";
  }
  S.download = Boolean(meta.download);
  S.vertical = Boolean(meta.vertical);
  S.chapters = Array.isArray(meta.chapters)
    ? meta.chapters.map((row) => ({ time: chapterTime(row.start || row.time || ""), label: String(row.label || row.title || "") }))
    : [];
  paintChapters();
  if (v.scheduled_at) {
    const d = new Date(v.scheduled_at);
    if (!Number.isNaN(d.getTime()) && d.getTime() > Date.now()) {
      S.when = "later";
      S.whenAt = isoLocal(d);
    }
  }
  const audience = Array.isArray(v.audience) ? v.audience : [];
  audience.forEach((rule) => {
    if (!rule || rule.mode === "exclude") return;
    if (rule.kind === "country") S.countries.push(rule.value);
    if (rule.kind === "language") S.langs.push(rule.value);
    if (rule.kind === "entity") S.people.push(rule.value);
  });
  const levels = audience.filter((r) => r && r.kind === "level").map((r) => Number(r.value)).filter((n) => !Number.isNaN(n));
  if (levels.length) {
    S.lvMin = Math.min(...levels);
    S.lvMax = Math.max(...levels);
  }
  return true;
}

function showState({ title, text, action = "" }) {
  const host = $("[data-ved-state]");
  if (!host) return;
  host.hidden = false;
  host.innerHTML = `
    <div class="vempty">
      <span class="vempty__icon">${icon("lock")}</span>
      <h2>${esc(title)}</h2>
      <p>${esc(text)}</p>
      ${action}
    </div>`;
  if (el.shell) el.shell.hidden = true;
  if (el.foot) el.foot.hidden = true;
}

/* ================================================================== */
/* events                                                             */
/* ================================================================== */
/**
 * The still that comes with a link. YouTube hands one over; every other host
 * does not, so an automatic picture is dropped when the source leaves YouTube
 * — but a picture the member chose or uploaded is never touched.
 */
function syncAutoThumb() {
  if (S.thumbChosen) return false;
  const auto = autoThumb(S.embed);
  if (auto) {
    if (S.thumb === auto) return false;
    S.thumb = auto;
    S.thumbAuto = true;
    return true;
  }
  if (S.thumbAuto) {
    S.thumb = "";
    S.thumbAuto = false;
    return true;
  }
  return false;
}

/** The oEmbed endpoints that answer a browser without a key. */
const OEMBED = {
  tiktok: (url) => `https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`,
  pinterest: (url) => `https://www.pinterest.com/oembed.json?url=${encodeURIComponent(url)}`,
  vimeo: (url) => `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(url)}`,
  dailymotion: (url) => `https://www.dailymotion.com/services/oembed?url=${encodeURIComponent(url)}&format=json`,
  reddit: (url) => `https://www.reddit.com/oembed?url=${encodeURIComponent(url)}`,
};

/**
 * Some hosts will hand a still to anyone who asks nicely (oEmbed). We ask
 * once per link, with a short leash, and say nothing when the answer is no —
 * Facebook and Drive insist on a token, and a network that blocks the call
 * must not break the page.
 */
async function stillFromHost(url) {
  const kind = sourceKind(url);
  const build = OEMBED[kind];
  if (!build) return "";
  let timer = null;
  try {
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    if (controller) timer = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(build(url), { signal: controller ? controller.signal : undefined });
    if (!res || !res.ok) return "";
    const data = await res.json();
    const still = String(data?.thumbnail_url || data?.thumbnail || data?.image || "");
    return /^https?:\/\//i.test(still) ? still : "";
  } catch {
    return "";
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function paintSourceNote() {
  const note = $("[data-ved-source-note]");
  if (!note) return;
  const value = S.embed.trim();
  if (!value) {
    note.hidden = true;
    return;
  }
  note.hidden = false;
  if (!/^https?:\/\//i.test(value)) {
    note.innerHTML = `${icon("info")} <span>A link starts with http:// or https://</span>`;
    return;
  }
  const linkKind = sourceKind(value);
  const kind = S.platform || linkKind;
  if (S.platform && linkKind && linkKind !== "embed" && S.platform !== linkKind) {
    note.innerHTML = `${icon("info")} <span>This link reads as ${esc(HOSTS[linkKind] || "another host")}, and you picked ${esc(HOSTS[S.platform] || S.platform)}. The platform is what gets saved.</span>`;
    return;
  }
  if (kind === "file") {
    note.innerHTML = `${icon("check")} <span>A file we can play here${S.download ? " — and download" : ""}</span>`;
    return;
  }
  if (kind === "pinterest" && !pinterestId(value)) {
    note.innerHTML = `${icon("info")} <span>A short Pinterest link — a full /pin/ address frames better</span>`;
    return;
  }
  if (kind === "reddit" && !redditPath(value)) {
    note.innerHTML = `${icon("info")} <span>A Reddit short link — the full thread address frames better</span>`;
    return;
  }
  const label = HOSTS[kind] || "Embed";
  note.innerHTML = `${icon("check")} <span>${esc(label)} — it plays inside the frame${kind === "youtube" ? ", and the thumbnail comes with it" : ""}</span>`;
}

/**
 * The player, in the editor. A member should see what they are publishing
 * before they publish it — a file plays in a <video>, everything else in the
 * frame the host allows, and the still we already have becomes the poster.
 */
function paintPlayer() {
  const host = $("[data-ved-player]");
  if (!host) return;
  const value = S.embed.trim();
  const usable = value && /^https?:\/\//i.test(value) && !/^\./.test(value);
  if (!usable) {
    host.hidden = true;
    host.innerHTML = "";
    return;
  }
  host.hidden = false;
  const poster = S.thumb || autoThumb(value);
  if (isFile(value)) {
    host.innerHTML = `<video controls playsinline preload="metadata"${poster ? ` poster="${esc(poster)}"` : ""} src="${esc(value)}"></video>`;
    return;
  }
  const src = embedUrl(value);
  host.innerHTML = `<iframe src="${esc(src)}" title="The video, before it is published" loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>`;
}

/* ================================================================== */
/* files: a picture or a video, from the machine                      */
/* ================================================================== */
const IMAGE_TYPES = /^image\/(png|jpeg|webp|gif)$/;
const VIDEO_TYPES = /^video\/(mp4|webm|ogg|quicktime)$/;

function fileNote(text, tone = "") {
  const note = $("[data-ved-file-note]");
  if (!note) return;
  note.hidden = !text;
  note.textContent = text || "";
  note.style.color = tone === "error" ? "var(--red, #e5484d)" : "";
}

/** A small file straight to storage, with the percentage on the page. */
function uploadFile(file, folder, note) {
  return new Promise((resolve, reject) => {
    const ext = (file.name.split(".").pop() || "bin").toLowerCase().replace(/[^a-z0-9]/g, "");
    const name = `${folder}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const path = `users/${folder}/${name}`;
    let request;
    try {
      request = new XMLHttpRequest();
    } catch {
      reject(new Error("This browser cannot upload."));
      return;
    }
    request.open("POST", `${SUPABASE.url}/storage/v1/object/source/${path}`);
    request.setRequestHeader("apikey", SUPABASE.publishableKey);
    request.setRequestHeader("Content-Type", file.type || "application/octet-stream");
    request.setRequestHeader("x-upsert", "true");
    if (request.upload && note) {
      request.upload.onprogress = (event) => {
        if (!event.lengthComputable) return;
        note(`Uploading… ${Math.round((event.loaded / event.total) * 100)}%`);
      };
    }
    request.onload = () => {
      if (request.status >= 200 && request.status < 300) {
        resolve(storageUrl(path));
        return;
      }
      reject(new Error(String(request.responseText || `HTTP ${request.status}`).slice(0, 120)));
    };
    request.onerror = () => reject(new Error("The upload did not reach the server."));
    request.send(file);
  });
}

async function uploadThumbnail(file) {
  if (!file) return;
  if (!IMAGE_TYPES.test(file.type)) {
    toast({ title: "That is not a picture", message: "PNG, JPEG, WEBP or GIF.", tone: "error" });
    return;
  }
  if (file.size > 4 * 1024 * 1024) {
    toast({ title: "Too large", message: "4 MB at most.", tone: "error" });
    return;
  }
  try {
    const url = await uploadFile(file, "posts");
    S.thumb = url;
    S.thumbChosen = true;
    S.thumbAuto = false;
    paintThumb();
    paintPreview();
    paintPlayer();
    paintStatus();
    scheduleDraft();
    toast({ title: "Picture uploaded", message: "", tone: "success", iconName: "image" });
  } catch (error) {
    toast({ title: "Upload failed", message: error?.message || "Try again.", tone: "error" });
  }
}

/** The extension without the dot — `.mp4`, `.mov`. */
function extensionOf(file) {
  const name = String(file?.name || "");
  const ext = (name.split(".").pop() || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (ext && ext !== name.toLowerCase()) return ext;
  const type = String(file?.type || "");
  return (type.split("/").pop() || "mp4").replace(/[^a-z0-9]/g, "") || "mp4";
}

/**
 * A video for a studio does not stay on the site — it goes to Streamtape,
 * into `Home / Users / Studio / <studio code>`, and is named after the video's
 * own code. A brand-new video has no code until it is saved, so it travels up
 * under a provisional name and is renamed the moment the server gives it one.
 */
async function uploadToStudioHost(file, studio) {
  const ext = extensionOf(file);
  const named = Boolean(S.code);
  const name = named ? `${S.code}.${ext}` : `${studio.code}-${Date.now().toString(36)}.${ext}`;
  const button = $("[data-ved-file-btn]");
  const box = $("[data-ved-drop]");
  if (button) button.disabled = true;
  box?.classList.add("is-busy");
  fileNote("Talking to the studio's host…");
  try {
    const out = await uploadToStudio(file, {
      studio: studio.code,
      name,
      onStage: (text) => fileNote(text),
    });
    S.host = { id: out.id, name: out.name || name, ext, studio: studio.code, folder: out.folder, named };
    el.embed.value = out.embed;
    el.embed.dispatchEvent(new Event("input"));
    fileNote(
      `${out.name || name} · ${(file.size / (1024 * 1024)).toFixed(1)} MB — Streamtape, Home / Users / Studio / ${studio.code}` +
        (named ? "" : " · it takes the video's own name when you save it")
    );
    toast({
      title: "Uploaded to the studio's host",
      message: `Home / Users / Studio / ${studio.code}`,
      tone: "success",
      iconName: "check",
    });
  } catch (error) {
    fileNote(error?.message || "The upload failed. Paste a link instead.", "error");
    toast({ title: "Upload failed", message: error?.message || "Paste a link instead.", tone: "error" });
  } finally {
    if (button) button.disabled = false;
    box?.classList.remove("is-busy");
    scheduleDraft();
    paintStatus();
  }
}

/** A file the host took under a provisional name gets the video's name now. */
async function nameHostFile() {
  if (!S.host || S.host.named || !S.code) return;
  const wanted = `${S.code}.${S.host.ext || "mp4"}`;
  try {
    await renameFile(S.host.id, wanted, S.host.studio);
    S.host.name = wanted;
    S.host.named = true;
    fileNote(`${wanted} — Streamtape, Home / Users / Studio / ${S.host.studio}`);
    scheduleDraft();
  } catch (error) {
    /* the video is saved and plays either way — the file keeps its working name */
    console.warn("[1World] studio file name:", error.message);
  }
}

async function uploadVideoFile(file) {
  if (!file) return;
  if (!VIDEO_TYPES.test(file.type)) {
    fileNote("MP4, WEBM, OGG or MOV — those are the files a browser can play.", "error");
    return;
  }
  /* a studio's videos live on the host, in the studio's own folder */
  const studio = studioHub();
  if (studio) {
    if (!studioReady()) {
      fileNote(`${NOT_CONNECTED} You can still paste a link above.`, "error");
      toast({ title: "The studio host is not connected", message: NOT_CONNECTED, tone: "error" });
      return;
    }
    if (file.size > 2 * 1024 * 1024 * 1024) {
      fileNote("2 GB at most, even on the host.", "error");
      return;
    }
    await uploadToStudioHost(file, studio);
    return;
  }
  if (file.size > 50 * 1024 * 1024) {
    fileNote("50 MB at most here. A longer film belongs on a host — choose a studio, or paste its link.", "error");
    return;
  }
  const button = $("[data-ved-file-btn]");
  const box = $("[data-ved-drop]");
  if (button) button.disabled = true;
  box?.classList.add("is-busy");
  fileNote("Uploading… 0%");
  try {
    const url = await uploadFile(file, "videos", (text) => fileNote(text));
    el.embed.value = url;
    el.embed.dispatchEvent(new Event("input"));
    fileNote(`${file.name} · ${(file.size / (1024 * 1024)).toFixed(1)} MB — in the site's storage`);
    toast({ title: "File uploaded", message: "The link is in the field above.", tone: "success", iconName: "check" });
  } catch (error) {
    fileNote(error?.message || "The upload failed. Paste a link instead.", "error");
    toast({ title: "Upload failed", message: error?.message || "Paste a link instead.", tone: "error" });
  } finally {
    if (button) button.disabled = false;
    box?.classList.remove("is-busy");
    scheduleDraft();
  }
}

/* ================================================================== */
/* the draft on this device                                           */
/* ================================================================== */
const DRAFT_KEY = "1w.videos.draft";
let draftTimer = null;

function draftFields() {
  return {
    code: S.code,
    savedAt: new Date().toISOString(),
    embed: S.embed,
    title: S.title,
    desc: S.desc,
    tags: S.keywords.map((row) => row.word),
    keywords: S.keywords,
    thumb: S.thumb,
    vis: S.vis,
    when: S.when,
    whenAt: S.whenAt,
    countries: S.countries,
    langs: S.langs,
    lvMin: S.lvMin,
    lvMax: S.lvMax,
    followers: S.followers,
    people: S.people,
    language: S.language,
    age: S.age,
    download: S.download,
    vertical: S.vertical,
    hub: S.hub,
    host: S.host,
  };
}

function writeDraft() {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draftFields()));
    paintDraftNote();
  } catch {
    /* storage blocked — the form still holds everything */
  }
}

function scheduleDraft() {
  clearTimeout(draftTimer);
  draftTimer = setTimeout(writeDraft, 900);
}

function readDraft() {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const draft = JSON.parse(raw);
    if (!draft) return null;
    if (!draft.title && !draft.embed) return null;
    if ((draft.code || "") !== (S.code || "")) return null;
    return draft;
  } catch {
    return null;
  }
}

function clearDraft() {
  clearTimeout(draftTimer);
  try {
    localStorage.removeItem(DRAFT_KEY);
  } catch {
    /* nothing to clear */
  }
  paintDraftNote();
}

function restoreDraft(draft) {
  S.embed = draft.embed || "";
  S.title = draft.title || "";
  S.desc = draft.desc || "";
  S.keywords = Array.isArray(draft.keywords)
    ? draft.keywords.slice(0, MAIN_MAX).map((row) => ({ word: String(row.word || ""), subs: Array.isArray(row.subs) ? row.subs.slice(0, SUB_MAX) : [] }))
    : Array.isArray(draft.tags)
      ? draft.tags.slice(0, MAIN_MAX).map((word) => ({ word: String(word), subs: [] }))
      : [];
  S.thumb = draft.thumb || "";
  S.vis = draft.vis || "general";
  S.when = draft.when || "now";
  S.whenAt = draft.whenAt || "";
  S.countries = Array.isArray(draft.countries) ? draft.countries : [];
  S.langs = Array.isArray(draft.langs) ? draft.langs : [];
  S.lvMin = Number(draft.lvMin) || 1;
  S.lvMax = Number(draft.lvMax) || 10;
  S.followers = Boolean(draft.followers);
  S.people = Array.isArray(draft.people) ? draft.people : [];
  S.language = draft.language || "en";
  S.age = draft.age || "none";
  S.download = Boolean(draft.download);
  S.vertical = Boolean(draft.vertical);
  S.hub = draft.hub || S.hub;
  S.host = draft.host && draft.host.id ? draft.host : null;
}

function paintDraftNote() {
  const host = $("[data-ved-draft-note]");
  if (!host) return;
  let at = "";
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    const kept = raw ? JSON.parse(raw) : null;
    if (kept && kept.savedAt) at = new Date(kept.savedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    at = "";
  }
  host.hidden = !at;
  host.textContent = at ? `kept on this device · ${at}` : "";
}

function bind() {
  contents = createContents($("[data-ved-toc]"), {
    empty: "This form has no sections yet.",
    onJump: jumpToSection,
  });

  /* the source */
  let stillTimer = null;
  el.embed.addEventListener("input", () => {
    S.embed = el.embed.value;
    /* the field was pointed somewhere else: the host file is no longer this
       video's, so it is not named after it either */
    if (S.host && !S.embed.includes(S.host.id)) S.host = null;
    syncPlatformFromLink();
    syncAutoThumb();
    paintSourceNote();
    paintPlayer();
    paintThumb();
    paintPreview();
    paintStatus();
    scheduleDraft();

    /* one look, half a second after the typing stops */
    clearTimeout(stillTimer);
    const asked = S.embed.trim();
    if (!asked || S.thumbChosen || S.thumb) return;
    stillTimer = setTimeout(async () => {
      const still = await stillFromHost(asked);
      if (!still || S.thumbChosen || S.thumb || S.embed.trim() !== asked) return;
      S.thumb = still;
      S.thumbAuto = true;
      paintThumb();
      paintPreview();
      paintPlayer();
      scheduleDraft();
    }, 500);
  });

  $("[data-ved-detect]")?.addEventListener("click", () => {
    const value = el.embed.value.trim();
    if (!value) {
      el.embed.focus();
      return;
    }
    if (!/^https?:\/\//i.test(value)) {
      toast({ title: "That is not a link", message: "Start it with http:// or https://", tone: "error" });
      return;
    }
    S.embed = value;
    manualPick = "";
    manualFor = "";
    syncPlatformFromLink();
    const auto = autoThumb(value);
    if (auto) {
      S.thumb = auto;
      toast({ title: "Link read", message: "The thumbnail came from the video itself.", tone: "success", iconName: "image" });
    } else {
      toast({ title: "Link read", message: isFile(value) ? "A file we can play here." : "An embed we can frame.", tone: "success", iconName: "link" });
    }
    paintAll();
  });

  /* the box takes a file from the machine or a link from another tab */
  const drop = $("[data-ved-drop]");
  if (drop) {
    ["dragenter", "dragover"].forEach((name) =>
      drop.addEventListener(name, (event) => {
        event.preventDefault();
        if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
        drop.classList.add("is-over");
      })
    );
    ["dragleave", "drop"].forEach((name) =>
      drop.addEventListener(name, () => drop.classList.remove("is-over"))
    );
    drop.addEventListener("drop", (event) => {
      event.preventDefault();
      const file = event.dataTransfer.files && event.dataTransfer.files[0];
      if (file) {
        uploadVideoFile(file);
        return;
      }
      const uri = event.dataTransfer.getData("text/uri-list") || event.dataTransfer.getData("text/plain");
      if (applyLink(uri)) {
        toast({ title: "Link dropped", message: "Its platform is chosen, and the thumbnail comes with it.", tone: "success", iconName: "check" });
      } else {
        toast({
          title: "A link, not a file",
          message: "Videos live on a host — paste the link to the file or the platform.",
          tone: "error",
          iconName: "info",
          duration: 5200,
        });
      }
    });
  }

  /* title / description / tags */
  el.title.addEventListener("input", () => {
    S.title = el.title.value;
    paintCounters();
    paintPreview();
    paintStatus();
  });
  el.desc.addEventListener("input", () => {
    S.desc = el.desc.value;
    paintCounters();
  });

  const platformEl = $("[data-ved-platform]");
  if (platformEl) {
    platformEl.value = S.platform || "";
    platformEl.addEventListener("change", () => {
      S.platform = platformEl.value;
      manualPick = platformEl.value;
      manualFor = sourceKind(S.embed.trim());
      paintCounters();
      paintSourceNote();
      paintPreview();
      paintStatus();
    });
  }

  document.addEventListener("click", (event) => {
    const target = event.target && typeof event.target.closest === "function" ? event.target : null;
    if (!target) return;
    const addMain = target.closest("[data-ved-tag-add]");
    if (addMain) {
      event.preventDefault();
      if (el.tagInput) {
        addTag(el.tagInput.value);
        el.tagInput.value = "";
        el.tagInput.focus();
      }
      return;
    }
    const subAdd = target.closest("[data-ved-sub-add]");
    if (subAdd) {
      event.preventDefault();
      const index = subAdd.getAttribute("data-ved-sub-add");
      const input = $(`[data-ved-sub-input="${index}"]`);
      if (input) {
        addSub(index, input.value);
        input.value = "";
        $(`[data-ved-sub-input="${index}"]`)?.focus();
      }
      return;
    }
    const subRemove = target.closest("[data-ved-sub-remove]");
    if (subRemove) {
      event.preventDefault();
      const [index, at] = String(subRemove.getAttribute("data-ved-sub-remove")).split(":").map(Number);
      const row = S.keywords[index];
      if (!row) return;
      row.subs.splice(at, 1);
      paintTags();
      paintCounters();
      paintStatus();
    }
  });

  document.addEventListener("keydown", (event) => {
    const subInput =
      event.target && typeof event.target.closest === "function" ? event.target.closest("[data-ved-sub-input]") : null;
    if (!subInput) return;
    if (event.key !== "Enter" && event.key !== ",") return;
    event.preventDefault();
    const index = subInput.getAttribute("data-ved-sub-input");
    addSub(index, subInput.value);
    subInput.value = "";
  });

  el.tagInput.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== ",") return;
    event.preventDefault();
    addTag(el.tagInput.value);
    el.tagInput.value = "";
  });
  el.tagInput.addEventListener("blur", () => {
    if (!el.tagInput.value.trim()) return;
    addTag(el.tagInput.value);
    el.tagInput.value = "";
  });

  /* thumbnail */
  el.thumb.addEventListener("input", () => {
    S.thumb = el.thumb.value.trim();
    S.thumbChosen = Boolean(S.thumb);
    S.thumbAuto = false;
    paintThumb();
    paintPreview();
    paintPlayer();
    scheduleDraft();
  });
  $("[data-ved-thumb-auto]")?.addEventListener("click", () => {
    const auto = autoThumb(S.embed);
    if (!auto) {
      toast({
        title: "No still to take",
        message: "Only YouTube hands over a picture. Upload one for the other hosts.",
        tone: "error",
        iconName: "info",
      });
      return;
    }
    S.thumb = auto;
    S.thumbAuto = true;
    S.thumbChosen = false;
    paintThumb();
    paintPreview();
    paintPlayer();
    scheduleDraft();
  });
  $("[data-ved-thumb-clear]")?.addEventListener("click", () => {
    S.thumb = "";
    S.thumbChosen = false;
    S.thumbAuto = false;
    paintThumb();
    paintPreview();
    paintPlayer();
    scheduleDraft();
  });

  /* a picture from the machine */
  const thumbButton = $("[data-ved-thumb-upload]");
  const thumbFile = $("[data-ved-thumb-file]");
  thumbButton?.addEventListener("click", () => thumbFile?.click());
  thumbFile?.addEventListener("change", () => {
    const file = thumbFile.files && thumbFile.files[0];
    if (file) uploadThumbnail(file);
    thumbFile.value = "";
  });

  /* a file from the machine, as the video itself */
  const fileButton = $("[data-ved-file-btn]");
  const videoFile = $("[data-ved-file]");
  fileButton?.addEventListener("click", () => videoFile?.click());
  /* the box itself opens the picker — the button is the label, not the only door */
  const dropBox = $("[data-ved-drop]");
  dropBox?.addEventListener("click", (event) => {
    if (event.target.closest("[data-ved-file-btn]")) return;
    videoFile?.click();
  });
  videoFile?.addEventListener("change", () => {
    const file = videoFile.files && videoFile.files[0];
    if (file) uploadVideoFile(file);
    videoFile.value = "";
  });

  /* anything typed is a draft within a second */
  [el.title, el.desc, el.thumb, el.embed].forEach((input) => input?.addEventListener("input", scheduleDraft));

  /* the index is typed in place: the row is not redrawn under the caret */
  el.shell.addEventListener("input", (event) => {
    const time = event.target.closest("[data-ved-chapter-time]");
    if (time) {
      const index = Number(time.getAttribute("data-ved-chapter-time"));
      if (S.chapters[index]) S.chapters[index].time = time.value;
      scheduleDraft();
      return;
    }
    const label = event.target.closest("[data-ved-chapter-label]");
    if (label) {
      const index = Number(label.getAttribute("data-ved-chapter-label"));
      if (S.chapters[index]) S.chapters[index].label = label.value;
      scheduleDraft();
    }
  });
  el.shell.addEventListener("change", scheduleDraft);
  el.shell.addEventListener("click", (event) => {
    if (event.target.closest("[data-vis], [data-when], [data-age]")) scheduleDraft();
  });

  /* a member may paste the link anywhere on the page */
  document.addEventListener("paste", (event) => {
    if (S.embed.trim()) return;
    const target = event.target;
    if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
    const data = event.clipboardData;
    const text = data ? String(data.getData("text/plain") || "").trim() : "";
    if (!text || !/^https?:\/\//i.test(text)) return;
    event.preventDefault();
    el.embed.value = text;
    el.embed.dispatchEvent(new Event("input"));
    const auto = autoThumb(text);
    if (auto && !S.thumbChosen && S.thumb !== auto) {
      S.thumb = auto;
      S.thumbAuto = true;
      paintThumb();
      paintPreview();
      paintPlayer();
    }
    toast({ title: "Link pasted", message: "The video is in the form.", tone: "success", iconName: "check" });
  });

  /* Ctrl/Cmd+Enter publishes, from anywhere on the page */
  document.addEventListener("keydown", (event) => {
    if (!(event.ctrlKey || event.metaKey) || event.key !== "Enter") return;
    event.preventDefault();
    save(S.when === "later" ? "scheduled" : "published");
  });

  /* extras */
  $("[data-ved-vertical]")?.addEventListener("change", (event) => {
    S.vertical = event.target.checked;
  });
  $("[data-ved-download]")?.addEventListener("change", (event) => {
    S.download = event.target.checked;
  });

  /* visibility + audience */
  el.shell.addEventListener("click", (event) => {
    const vis = event.target.closest("[data-vis]");
    if (vis) {
      setVisibility(vis.getAttribute("data-vis"));
      return;
    }
    const when = event.target.closest("[data-when]");
    if (when) {
      S.when = when.getAttribute("data-when");
      paintWhen();
      paintPreview();
      paintStatus();
      return;
    }
    const age = event.target.closest("[data-age]");
    if (age) {
      S.age = age.getAttribute("data-age");
      paintAge();
      return;
    }
    const tagRemove = event.target.closest("[data-ved-tag-remove]");
    if (tagRemove) {
      S.keywords.splice(Number(tagRemove.getAttribute("data-ved-tag-remove")), 1);
      paintTags();
      paintCounters();
      paintStatus();
      return;
    }
    const chapterAdd = event.target.closest("[data-ved-chapter-add]");
    if (chapterAdd) {
      /* a new row starts a minute after the last one, so a member typing one
         after another never restarts at 00:00 */
      const last = S.chapters[S.chapters.length - 1];
      const next = last && chapterTime(last.time) ? chapterSeconds(last.time) + 60 : 0;
      S.chapters.push({ time: `${Math.floor(next / 60)}:${String(next % 60).padStart(2, "0")}`, label: "" });
      paintChapters();
      document.querySelector(`[data-ved-chapter-label="${S.chapters.length - 1}"]`)?.focus();
      return;
    }
    const chapterDel = event.target.closest("[data-ved-chapter-del]");
    if (chapterDel) {
      S.chapters.splice(Number(chapterDel.getAttribute("data-ved-chapter-del")), 1);
      paintChapters();
      paintStatus();
      return;
    }
    const personRemove = event.target.closest("[data-ved-person-remove]");
    if (personRemove) {
      S.people.splice(Number(personRemove.getAttribute("data-ved-person-remove")), 1);
      paintPeople();
      paintStatus();
      return;
    }
    const passRemove = event.target.closest("[data-ved-pass-remove]");
    if (passRemove) {
      S.passes.splice(Number(passRemove.getAttribute("data-ved-pass-remove")), 1);
      paintPasses();
      return;
    }
    const countryRemove = event.target.closest("[data-ved-country-remove]");
    if (countryRemove) {
      S.countries.splice(Number(countryRemove.getAttribute("data-ved-country-remove")), 1);
      paintCountries();
      paintStatus();
      return;
    }
    const langRemove = event.target.closest("[data-ved-lang-remove]");
    if (langRemove) {
      S.langs.splice(Number(langRemove.getAttribute("data-ved-lang-remove")), 1);
      paintCountries();
      paintStatus();
      return;
    }
    if (event.target.closest("[data-ved-person-add]")) {
      const input = $("[data-ved-person-input]");
      const who = String((input && input.value) || "").trim().replace(/^@?/, "@");
      if (!who || who === "@") return;
      if (S.people.some((p) => p.toLowerCase() === who.toLowerCase())) return;
      S.people.push(who.startsWith("@") ? who : `@${who}`);
      if (input) input.value = "";
      paintPeople();
      paintStatus();
      return;
    }
    if (event.target.closest("[data-ved-pass-add]")) {
      const input = $("[data-ved-pass-input]");
      const pass = String((input && input.value) || "").trim();
      if (pass.length < 4) {
        toast({ title: "Too short", message: "A password needs four characters at least.", tone: "error", duration: 3200 });
        return;
      }
      if (!S.passes.includes(pass)) S.passes.push(pass.slice(0, 60));
      if (input) input.value = "";
      paintPasses();
      paintStatus();
      return;
    }
    if (event.target.closest("[data-ved-pass-gen]")) {
      const pass = randomPassword();
      S.passes.push(pass);
      paintPasses();
      paintStatus();
      toast({ title: "Password made", message: pass, tone: "info", iconName: "key", duration: 9000 });
      return;
    }
  });

  $("[data-ved-save]")?.addEventListener("click", () => save("draft"));
  $("[data-ved-publish]")?.addEventListener("click", () => save(S.when === "now" ? "published" : "scheduled"));

  $("[data-ved-followers]")?.addEventListener("change", (event) => {
    if (event.target.checked) {
      S.followers = true;
      S.vis = "followers";
      paintVisibility();
      paintPreview();
    } else {
      S.followers = false;
      S.vis = "limited";
      paintVisibility();
      paintPreview();
    }
    paintStatus();
  });

  $("[data-ved-country-sel]")?.addEventListener("change", (event) => {
    const name = event.target.value;
    event.target.value = "";
    if (!name) return;
    if (!S.countries.includes(name)) S.countries.push(name);
    paintCountries();
    paintStatus();
  });
  $("[data-ved-lang-sel]")?.addEventListener("change", (event) => {
    const code = event.target.value;
    event.target.value = "";
    if (!code) return;
    if (!S.langs.includes(code)) S.langs.push(code);
    paintCountries();
    paintStatus();
  });
  $("[data-ved-lv-min]")?.addEventListener("input", (event) => {
    S.lvMin = Number(event.target.value) || 0;
    paintStatus();
  });
  $("[data-ved-lv-max]")?.addEventListener("input", (event) => {
    S.lvMax = Number(event.target.value) || 0;
    paintStatus();
  });
  $("[data-ved-when-input]")?.addEventListener("change", (event) => {
    S.whenAt = event.target.value;
    paintWhen();
    paintPreview();
    paintStatus();
  });
  $("[data-ved-hub]")?.addEventListener("change", (event) => {
    S.hub = event.target.value || "";
    const hub = S.hubs.find((h) => h.code === S.hub);
    S.hubName = hub ? hub.name : "";
    paintHub();
    paintDropNote();
    paintPreview();
    paintStatus();
    scheduleDraft();
    /* the desk's own rail moves with this picker */
    if (EMBED) document.dispatchEvent(new CustomEvent("ved:hub", { detail: { code: S.hub, from: "editor" } }));
  });

  el.lang.addEventListener("change", () => {
    S.language = el.lang.value;
    paintPreview();
  });
}

/* ================================================================== */
/* boot                                                               */
/* ================================================================== */
async function boot() {
  S.token = sessionToken();
  el.shell = $("[data-ved-shell]");
  el.foot = $("[data-ved-foot]");
  el.embed = $("[data-ved-embed]");
  el.title = $("[data-ved-title]");
  el.desc = $("[data-ved-desc]");
  el.tagInput = $("[data-ved-tag-input]");
  el.thumb = $("[data-ved-thumb]");
  el.lang = $("[data-ved-lang]");

  if (!S.token || !getMember()) {
    showState({
      title: "Sign in to publish",
      text: "A video belongs to a member — sign in first, then come back to this page.",
      action: `<a class="btn btn--primary btn--sm" href="login.html?next=video-editor.html">${icon("login")} Sign in</a>`,
    });
    return;
  }

  fillSelects();
  el.shell.hidden = false;
  el.foot.hidden = false;

  /* a link from the studio (`video-editor.html?studio=IDST100001`) preselects it,
     and so does the desk, which names its hub on the body */
  const wantedHub = (new URLSearchParams(location.search).get("studio") || "").trim().toUpperCase();
  if (wantedHub) S.hub = wantedHub;
  if (EMBED) {
    const handed = (document.body.dataset.vedHubcode || "").trim().toUpperCase();
    if (handed) S.hub = handed;
    /* the rail on the left of the desk changes the hub without touching the picker */
    document.addEventListener("ved:hub", (event) => {
      const code = String((event.detail && event.detail.code) || "").trim().toUpperCase();
      if (code === S.hub) return;
      S.hub = code;
      const hub = S.hubs.find((h) => h.code === code);
      S.hubName = hub ? hub.name : "";
      paintHub();
      paintPreview();
      paintStatus();
      scheduleDraft();
    });
  }

  await loadHubs();

  const code = new URLSearchParams(location.search).get("id");
  if (code) {
    const heading = $("[data-ved-heading]");
    if (heading) heading.textContent = "Edit a video";
    const ok = await loadExisting(code);
    if (!ok) return;
  } else {
    const draft = readDraft();
    if (draft) {
      restoreDraft(draft);
      toast({ title: "Draft restored", message: "The last thing you wrote here is back.", tone: "info", iconName: "file" });
    }
  }

  /* write the loaded values into the form */
  el.title.value = S.title;
  el.desc.value = S.desc;
  el.embed.value = S.embed;
  el.thumb.value = S.thumb;
  el.lang.value = LANGUAGES.some(([c]) => c === S.language) ? S.language : "en";
  const vertical = $("[data-ved-vertical]");
  if (vertical) vertical.checked = S.vertical;
  const download = $("[data-ved-download]");
  if (download) download.checked = S.download;
  const lvMin = $("[data-ved-lv-min]");
  if (lvMin) lvMin.value = String(S.lvMin);
  const lvMax = $("[data-ved-lv-max]");
  if (lvMax) lvMax.value = String(S.lvMax);
  if (S.embed) el.embed.dispatchEvent(new Event("input"));

  bind();
  paintAll();
  paintDraftNote();

  if (!S.code) {
    el.title.focus();
  }
}

boot();
