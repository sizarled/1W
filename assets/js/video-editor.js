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
 *     tags[],           main keywords, twelve at most
 *     audience[],       { kind: country|language|level|entity, value, mode: include }
 *     profiles[],       the nominated list a private video opens to
 *     passwords[],      hashed by the server; never readable again
 *     meta{ age, download, vertical, source }
 *   })
 *
 * The same call edits: `?id=PST-001005` pre-fills the form from
 * video_get, and the payload carries the code back.
 */
import { rpc } from "./data.js";
import { qs, qsa, esc } from "./utils.js";
import { icon } from "./icons.js";
import { toast } from "./ui.js";
import { sessionToken, getMember } from "./session.js";
import { COUNTRIES } from "./countries.js";

const S = {
  token: "",
  code: "",
  embed: "",
  title: "",
  desc: "",
  tags: [],
  thumb: "",
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
};

const $ = (sel) => qs(sel);
const el = {};

/* ================================================================== */
/* helpers                                                            */
/* ================================================================== */
function isFile(raw = "") {
  return /\.(mp4|webm|ogv|ogg|mov|m4v)(\?|#|$)/i.test(String(raw));
}

function findYouTube(raw = "") {
  const value = String(raw).trim();
  if (!value) return "";
  try {
    const u = new URL(value, location.href);
    const host = u.hostname.replace(/^www\./, "");
    if (host === "youtu.be") return u.pathname.slice(1);
    if (host.endsWith("youtube.com")) {
      const v = u.searchParams.get("v");
      if (v) return v;
      const parts = u.pathname.split("/").filter(Boolean);
      if (["embed", "shorts", "live"].includes(parts[0])) return parts[1] || "";
    }
  } catch {
    return "";
  }
  return "";
}

function autoThumb(raw = "") {
  const id = findYouTube(raw);
  return id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : "";
}

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
    tagCount.textContent = `${S.tags.length} / 12`;
    tagCount.classList.toggle("is-over", S.tags.length > 12);
  }
}

function paintPreview() {
  const media = $("[data-ved-preview-media]");
  if (media) {
    const src = S.thumb || autoThumb(S.embed);
    media.innerHTML = src
      ? `<img src="${esc(src)}" alt="" loading="lazy" />`
      : `<div class="vprev__ph">${icon("film")}</div>`;
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
  const badge = $("[data-ved-preview-badge]");
  if (badge) badge.textContent = S.status === "published" && S.code ? "Published" : S.status === "scheduled" ? "Scheduled" : "Draft";

  const badge2 = $("[data-ved-source-badge]");
  if (badge2) {
    badge2.textContent = !S.embed ? "" : isFile(S.embed) ? "File" : findYouTube(S.embed) ? "YouTube" : "Embed";
  }
}

function paintThumb() {
  const box = $("[data-ved-thumb-box]");
  if (!box) return;
  const src = S.thumb || autoThumb(S.embed);
  box.innerHTML = src ? `<img src="${esc(src)}" alt="" loading="lazy" />` : "No picture yet";
  const input = $("[data-ved-thumb]");
  if (input && input.value !== S.thumb) input.value = S.thumb;
}

function paintTags() {
  const host = $("[data-ved-tags]");
  if (!host) return;
  host.innerHTML = S.tags
    .map(
      (tag, index) => `<span class="tag">${esc(tag)}<button type="button" data-ved-tag-remove="${index}" aria-label="Remove ${esc(tag)}">${icon("close")}</button></span>`
    )
    .join("");
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

function paintAll() {
  paintCounters();
  paintPreview();
  paintThumb();
  paintTags();
  paintPeople();
  paintPasses();
  paintCountries();
  paintVisibility();
  paintWhen();
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
  if (S.tags.length > 12) return { ok: false, message: "Twelve tags at most" };
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
  return {
    id: S.code || null,
    title: S.title.trim(),
    description: S.desc.trim() || null,
    thumbnail: (S.thumb || autoThumb(S.embed) || "").trim() || null,
    embed: S.embed.trim() || null,
    language: S.language,
    visibility: S.vis,
    status,
    scheduled_at: status === "scheduled" && date ? date.toISOString() : null,
    tags: S.tags.slice(0, 12),
    audience: rules,
    profiles: people,
    passwords: S.passes,
    meta: {
      age: S.age,
      download: Boolean(S.download),
      vertical: Boolean(S.vertical),
      source: isFile(S.embed) ? "file" : findYouTube(S.embed) ? "youtube" : "embed",
    },
  };
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
  paintAll();

  if (status === "draft") {
    toast({ title: "Draft saved", message: "Find it again under your videos.", tone: "success", iconName: "check" });
    if (!location.search.includes("id=")) window.history.replaceState(null, "", `?id=${encodeURIComponent(S.code)}`);
    const heading = $("[data-ved-heading]");
    if (heading) heading.textContent = "Edit a video";
    return;
  }

  toast({
    title: status === "scheduled" ? "Scheduled" : "Published",
    message: status === "scheduled" ? "It opens by itself at the moment you picked." : "It is in the feed now.",
    tone: "success",
    iconName: "check",
  });
  setTimeout(() => {
    location.href = `videos.html#/v/${encodeURIComponent(S.code)}`;
  }, 650);
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
  if (S.tags.length >= 12) {
    toast({ title: "Twelve tags is the ceiling", message: "Remove one to add another.", tone: "error", iconName: "info", duration: 3200 });
    return;
  }
  if (S.tags.some((t) => t.toLowerCase() === tag.toLowerCase())) return;
  S.tags.push(tag);
  paintTags();
  paintCounters();
  paintStatus();
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
  S.tags = Array.isArray(v.keywords) ? v.keywords.filter((k) => k.role === "main").map((k) => k.keyword) : [];
  S.age = meta.age || "none";
  S.download = Boolean(meta.download);
  S.vertical = Boolean(meta.vertical);
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
function bind() {
  /* the source */
  el.embed.addEventListener("input", () => {
    S.embed = el.embed.value;
    const note = $("[data-ved-source-note]");
    if (note) {
      const value = S.embed.trim();
      if (!value) {
        note.hidden = true;
      } else if (!/^https?:\/\//i.test(value)) {
        note.hidden = false;
        note.innerHTML = `${icon("info")} <span>A link starts with http:// or https://</span>`;
      } else if (isFile(value)) {
        note.hidden = false;
        note.innerHTML = `${icon("check")} <span>A file we can play directly${S.download ? " — and download" : ""}</span>`;
      } else if (findYouTube(value)) {
        note.hidden = false;
        note.innerHTML = `${icon("check")} <span>A YouTube link — the thumbnail comes with it</span>`;
      } else {
        note.hidden = false;
        note.innerHTML = `${icon("check")} <span>An embed link — it plays inside the frame</span>`;
      }
    }
    if (!S.thumb) paintThumb();
    paintPreview();
    paintStatus();
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
    const auto = autoThumb(value);
    if (auto) {
      S.thumb = auto;
      toast({ title: "Link read", message: "The thumbnail came from the video itself.", tone: "success", iconName: "image" });
    } else {
      toast({ title: "Link read", message: isFile(value) ? "A file we can play here." : "An embed we can frame.", tone: "success", iconName: "link" });
    }
    paintAll();
  });

  /* dropping a link on the page */
  const drop = $("[data-ved-drop]");
  if (drop) {
    ["dragenter", "dragover"].forEach((name) =>
      drop.addEventListener(name, (event) => {
        event.preventDefault();
        drop.classList.add("is-over");
      })
    );
    ["dragleave", "drop"].forEach((name) =>
      drop.addEventListener(name, () => drop.classList.remove("is-over"))
    );
    drop.addEventListener("drop", (event) => {
      event.preventDefault();
      const uri = event.dataTransfer.getData("text/uri-list") || event.dataTransfer.getData("text/plain");
      if (uri && /^https?:\/\//i.test(uri.trim())) {
        el.embed.value = uri.trim();
        el.embed.dispatchEvent(new Event("input"));
        const auto = autoThumb(uri);
        if (auto) {
          S.thumb = auto;
          paintThumb();
          paintPreview();
        }
        toast({ title: "Link dropped", message: "Check the title and the thumbnail below.", tone: "success", iconName: "check" });
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
    paintThumb();
    paintPreview();
  });
  $("[data-ved-thumb-auto]")?.addEventListener("click", () => {
    const auto = autoThumb(S.embed);
    if (!auto) {
      toast({ title: "No frame to take", message: "Only YouTube links carry their own picture.", tone: "error", iconName: "info" });
      return;
    }
    S.thumb = auto;
    paintThumb();
    paintPreview();
  });
  $("[data-ved-thumb-clear]")?.addEventListener("click", () => {
    S.thumb = "";
    paintThumb();
    paintPreview();
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
      S.tags.splice(Number(tagRemove.getAttribute("data-ved-tag-remove")), 1);
      paintTags();
      paintCounters();
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

  const code = new URLSearchParams(location.search).get("id");
  if (code) {
    const heading = $("[data-ved-heading]");
    if (heading) heading.textContent = "Edit a video";
    const ok = await loadExisting(code);
    if (!ok) return;
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

  if (!S.code) {
    el.title.focus();
  }
}

boot();
