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
 *     meta{ place: content|help, field, category, niche, help }
 *   })
 *
 * ?id=PST-001015 edits an existing piece: the form is filled from
 * article_get and the code rides back in the payload.
 *
 * A piece that goes to a Help section is sent for review: the server
 * keeps it `pending`, the moderators decide, and it is always public —
 * a help page nobody can read is not a help page.
 */
import { rpc } from "./data.js";
import { qs, qsa, esc, compact, timeAgo } from "./utils.js";
import { icon } from "./icons.js";
import { toast } from "./ui.js";
import { sessionToken } from "./session.js";
import { COUNTRIES } from "./countries.js";
import { wordsIn, readingTime, sanitizeHtml, firstImage } from "./article-text.js";
import { SUPABASE, storageUrl } from "./config.js";

const S = {
  token: "",
  code: "",
  title: "",
  desc: "",
  html: "",
  field: "",
  category: "",
  niche: "",
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
  return body ? body.innerHTML : S.html;
}

function sync() {
  const title = $("[data-e-title]");
  const desc = $("[data-e-desc]");
  const field = $("[data-e-field]");
  const category = $("[data-e-category]");
  const lang = $("[data-e-lang]");
  if (title) S.title = title.value;
  if (desc) S.desc = desc.value;
  if (field) S.field = field.value;
  if (category) S.category = category.value;
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
  if (seg) {
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
    hint.textContent =
      S.place === "help"
        ? "Help pages go to the moderators for review, and they are always public — a help page nobody can read helps nobody."
        : "Content goes straight to the index, in the field you named, open to whoever your door allows.";
  }
  const label = $("[data-e-place-label]");
  if (label) label.textContent = S.place === "help" ? "Help · review" : "Content";
}

function paintWhen() {
  const seg = $("[data-e-when]");
  if (seg) {
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
/* readiness                                                          */
/* ================================================================== */
function checks() {
  sync();
  const list = [];
  const words = wordsIn(S.html);
  list.push({ label: "A title", ok: S.title.trim().length > 0 && S.title.trim().length <= 200 });
  list.push({ label: "A body", ok: words > 0 });
  list.push({ label: "A field", ok: S.place === "help" ? Boolean(S.help) : Boolean(S.field.trim()) });
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
  line.innerHTML = `${icon(iconName)} <span>${esc(text)}</span>`;

  const publish = $("[data-e-publish]");
  if (publish) {
    publish.disabled = S.busy;
    publish.innerHTML = S.place === "help" ? `${icon("send")} Send for review` : `${icon("upload")} ${S.code ? "Save and publish" : "Publish"}`;
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
      <a href="article.html?id=${encodeURIComponent(row.code || row.id)}">
        <span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(row.title || "Untitled")}</span>
        <span>${esc(row.status === "published" ? timeAgo(row.published_at) : row.status)}</span>
      </a>`
    )
    .join("");
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
  const meta = {
    place: S.place,
    field: S.place === "help" ? "" : S.field.trim(),
    category: S.category.trim(),
    niche: S.niche.trim(),
    help: S.place === "help" ? S.help : "",
  };
  const body = {
    id: S.code || null,
    title: S.title.trim(),
    description: S.desc.trim() || null,
    body: S.html,
    thumbnail: (S.thumb || firstImage(S.html) || "").trim() || null,
    language: S.language,
    visibility: S.place === "help" ? "general" : S.vis,
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
    res = await rpc("article_save", { p_token: S.token, p_payload: payload(finalStatus) });
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
    toast({ title: "Draft saved", message: "It is under “In your name”, on this page and on the index.", tone: "success", iconName: "check" });
    if (!location.search.includes("id=")) {
      history.replaceState(null, "", `?id=${encodeURIComponent(S.code)}`);
    }
    const heading = $("[data-e-heading]");
    if (heading) heading.textContent = "Edit an article";
    return;
  }

  if (S.status === "pending") {
    toast({
      title: "Sent for review",
      message: "The moderators have it. It stays private until they publish it in Help.",
      tone: "success",
      iconName: "send",
    });
    return;
  }

  toast({
    title: S.status === "scheduled" ? "Scheduled" : "Published",
    message: S.status === "scheduled" ? "It opens by itself at the moment you picked." : "It is on the index now.",
    tone: "success",
    iconName: "check",
  });
  setTimeout(() => {
    location.href = `article.html?id=${encodeURIComponent(S.code)}`;
  }, 700);
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
  body.querySelector("input")?.focus();
}

function closeDialog() {
  const dlg = $("[data-e-dlg]");
  dlg?.close?.();
  dialogMode = "";
}

function insertHtml(html) {
  const body = $("[data-e-body]");
  if (!body) return;
  body.focus();
  if (document.execCommand) {
    try {
      document.execCommand("insertHTML", false, html);
      return;
    } catch {
      /* fall through */
    }
  }
  body.insertAdjacentHTML("beforeend", html);
}

async function confirmDialog() {
  const body = $("[data-e-dlg-body]");
  const err = $("[data-e-dlg-err]");
  if (!body) return;
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
    const text = String((body.querySelector("[data-dlg-text]") || {}).value || "").trim() || url;
    const blank = Boolean((body.querySelector("[data-dlg-blank]") || {}).checked);
    insertHtml(
      `<a href="${esc(url)}"${blank ? ' target="_blank" rel="noopener noreferrer"' : ""}>${esc(text)}</a>&nbsp;`
    );
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
  sync();
  paintCounts();
}

/* ================================================================== */
/* the reader preview                                                 */
/* ================================================================== */
function previewVerdict(country, language, level) {
  if (S.vis === "followers") return { ok: false, text: "This reader does not follow the writer: they see the door." };
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
  const verdict = previewVerdict(country, language, level);
  host.innerHTML = `
    <span><strong>${verdict.ok ? "Opens" : "Blocked"}</strong> · ${esc(verdict.text)}</span>
    <span style="opacity:.75">A simulated reader: ${esc(country)} · ${esc(language)} · LV${level}</span>`;
}

/* ================================================================== */
/* toolbar                                                            */
/* ================================================================== */
function command(name, value = null) {
  const body = $("[data-e-body]");
  if (!body) return;
  body.focus();
  if (!document.execCommand) return;
  try {
    document.execCommand("styleWithCSS", false, false);
    document.execCommand(name, false, value);
  } catch {
    /* the browser refused — nothing changes */
  }
  sync();
  paintCounts();
  paintChecks();
  paintToolState();
}

function paintToolState() {
  if (!document.queryCommandState) return;
  const map = { bold: "bold", italic: "italic", underline: "underline", strikeThrough: "strike" };
  Object.entries(map).forEach(([cmd, key]) => {
    const btn = qs(`[data-cmd="${cmd}"]`);
    if (!btn) return;
    try {
      btn.classList.toggle("is-on", document.queryCommandState(cmd));
    } catch {
      /* ignore */
    }
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
    });
  }
  const desc = $("[data-e-desc]");
  if (desc) {
    desc.addEventListener("input", () => {
      S.desc = desc.value;
    });
  }
  const body = $("[data-e-body]");
  if (body) {
    body.addEventListener("input", () => {
      S.html = body.innerHTML;
      paintCounts();
      paintChecks();
    });
    body.addEventListener("keyup", paintToolState);
    body.addEventListener("mouseup", paintToolState);
    body.addEventListener("click", (event) => {
      if (event.target.tagName === "IMG") selectImage(event.target);
      else selectImage(null);
    });
    body.addEventListener("blur", () => {
      /* keep the bar reachable: it acts on the image we selected */
    });
    body.addEventListener("paste", (event) => {
      const text = event.clipboardData?.getData("text/plain");
      if (!text) return;
      event.preventDefault();
      insertHtml(esc(text).replace(/\n{2,}/g, "</p><p>").replace(/\n/g, "<br />"));
      sync();
      paintCounts();
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
          openDialog("link");
          return;
        }
        if (cmd === "insertImage") {
          openDialog("image");
          return;
        }
        if (cmd === "insertVideo") {
          openDialog("video");
          return;
        }
        command(cmd);
      }
    });
    tools.addEventListener("change", (event) => {
      const block = event.target.closest("[data-e-block]");
      if (block) command("formatBlock", `<${block.value}>`);
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
  qsa("[data-prev-country], [data-prev-lang], [data-prev-level]").forEach((el) =>
    el.addEventListener("change", paintVerdict)
  );
  const prev = $("[data-e-prev]");
  if (prev) {
    prev.addEventListener("click", (event) => {
      if (event.target === prev) prev.close?.();
    });
  }

  /* save */
  $("[data-e-publish]")?.addEventListener("click", () => save(S.place === "help" ? "pending" : S.when === "later" ? "scheduled" : "published"));
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
    paintChecks();
    paintStatus();
  });
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
    const res = await rpc("article_mine", { p_token: S.token });
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
    toast({ title: "That article did not load", message: error.message, tone: "error" });
    return false;
  }
  if (!res || res.ok !== true || res.locked) {
    toast({
      title: res && res.locked ? "That piece is not yours to edit" : "That article is gone",
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
  S.niche = meta.niche || "";
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
  if (body) body.innerHTML = S.html;
  if (field) field.value = S.field;
  if (category) category.value = S.category;
  if (lang) lang.value = S.language;

  const heading = $("[data-e-heading]");
  if (heading) heading.textContent = "Edit an article";
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
  bind();

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
  loadMine();
  loadFields();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot, { once: true });
} else {
  boot();
}
