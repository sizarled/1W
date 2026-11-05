/**
 * creator.html — the member's content editor.
 * ------------------------------------------------------------------
 * One editor for every kind of work a member can publish: a video, an
 * article, a podcast episode, an image set, a document or a community
 * post. Nothing is written to Supabase directly — the page calls three
 * functions and every one of them resolves the member from the session
 * token on the server:
 *
 *   member_content_list(token)   what the member has, without the bodies
 *   member_content_get(token,id) one item, body included
 *   member_content_save(token, … ) draft or publish, same call
 *   member_content_delete(token,id)
 *
 * Drafts are free and save themselves as the member types; publishing is
 * guarded on the server (an active membership, a title of 3 characters, a
 * media link for the media kinds, 12 words for the text kinds) and the
 * refusals are explained here in words the member can act on.
 *
 * Nothing of another member is reachable: an id that is not yours answers
 * `not_found`, exactly like an id that does not exist.
 */
import { rpc } from "./data.js";
import { qs, qsa, esc, num, timeAgo, debounce } from "./utils.js";
import { hydrateIcons } from "./icons.js";
import { toast } from "./ui.js";
import { sessionToken, getMember } from "./session.js";

/* ================================================================== */
/* what a member can write                                            */
/* ================================================================== */
const KINDS = [
  {
    key: "video",
    label: "Video",
    icon: "film",
    media: true,
    text: false,
    hint: "A film, an episode or a clip. Publishing needs the media link.",
  },
  {
    key: "article",
    label: "Article",
    icon: "article",
    media: false,
    text: true,
    hint: "A long read. Publishing needs at least 12 words in the body.",
  },
  {
    key: "podcast",
    label: "Podcast",
    icon: "mic",
    media: true,
    text: false,
    hint: "One episode. Publishing needs the audio link.",
  },
  {
    key: "image",
    label: "Image",
    icon: "image",
    media: true,
    text: false,
    hint: "A picture or a set. Publishing needs the image link.",
  },
  {
    key: "document",
    label: "Document",
    icon: "file",
    media: true,
    text: false,
    hint: "A PDF, a script or a study file. Publishing needs the file link.",
  },
  {
    key: "post",
    label: "Post",
    icon: "comment",
    media: false,
    text: true,
    hint: "A short community post. Publishing needs at least 12 words.",
  },
];

/* the editor keeps the same eight languages as the composer */
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

const AGES = [
  ["none", "Everyone"],
  ["13", "13+"],
  ["16", "16+"],
  ["18", "18+"],
];

const VISIBILITY = [
  ["public", "Public — anyone who finds it"],
  ["followers", "Followers only"],
  ["unlisted", "Unlisted — link only"],
];

const LIMIT = 200;
const MAX_TAGS = 8;
const AUTOSAVE_MS = 1400;

/* what each server refusal means to a member */
const ERRORS = {
  session: "Your session ended. Sign in again — the text stays in this tab.",
  kind: "That kind of content does not exist.",
  visibility: "Pick public, followers only or unlisted.",
  title: "A published title needs between 3 and 140 characters.",
  url: "Links must start with http:// or https://.",
  media: "This kind needs a media link before it can be published.",
  body: "An article or a post needs at least 12 words to publish.",
  inactive: "Publishing needs an active membership. Activate the account, then publish.",
  limit: `You have reached ${LIMIT} items. Delete one before writing another.`,
  not_found: "That item is gone — it may have been deleted on another device.",
};

/* ================================================================== */
/* state                                                              */
/* ================================================================== */
const state = {
  token: "",
  member: null,
  rows: [],
  counts: { all: 0, draft: 0, published: 0, views: 0, likes: 0 },
  filter: "all",
  search: "",
  current: null,
  dirty: false,
  version: 0,
  saving: false,
  savedAt: 0,
  saveError: "",
};

const el = (sel, root = document) => qs(sel, root);
const kindOf = (key) => KINDS.find((k) => k.key === key) || KINDS[1];
const words = (text = "") => {
  const list = String(text || "").trim();
  if (!list) return 0;
  return list.split(/\s+/).filter(Boolean).length;
};
const minutes = (text = "") => {
  const count = words(text);
  return count ? Math.ceil(count / 200) : 0;
};

const tagList = (raw = "") =>
  Array.from(
    new Set(
      String(raw || "")
        .split(/[,\n]/)
        .map((t) => t.trim().replace(/\s+/g, " ").slice(0, 24))
        .filter(Boolean)
    )
  ).slice(0, MAX_TAGS);

function blank(kind = "article") {
  return {
    id: null,
    kind: kindOf(kind).key,
    title: "",
    summary: "",
    body: "",
    media_url: "",
    cover_url: "",
    tags: [],
    tagText: "",
    language: "en",
    age_rating: "none",
    visibility: "public",
    status: "draft",
    word_count: 0,
    minutes: 0,
    updated_at: null,
    published_at: null,
  };
}

/* ================================================================== */
/* the page states                                                    */
/* ================================================================== */
function showState(ico, title, text, actions = "") {
  const box = el("[data-cr-state]");
  const root = el("[data-cr-root]");
  if (root) {
    root.hidden = true;
    root.style.display = "none";
  }
  if (!box) return;
  box.hidden = false;
  box.style.display = "";
  box.innerHTML = `
    <div class="cr-state">
      <span class="cr-state__icon"><i data-icon="${esc(ico)}"></i></span>
      <h2 class="cr-state__title">${esc(title)}</h2>
      <p class="cr-state__text">${esc(text)}</p>
      ${actions ? `<div class="cr-state__actions">${actions}</div>` : ""}
    </div>`;
  hydrateIcons(box);
}

function showRoot() {
  const box = el("[data-cr-state]");
  const root = el("[data-cr-root]");
  if (box) {
    box.hidden = true;
    box.style.display = "none";
  }
  if (root) {
    root.hidden = false;
    root.style.display = "";
  }
}

/* ================================================================== */
/* the numbers                                                        */
/* ================================================================== */
function recount() {
  const rows = state.rows;
  state.counts = {
    all: rows.length,
    draft: rows.filter((r) => r.status === "draft").length,
    published: rows.filter((r) => r.status === "published").length,
    views: Number(state.counts.views || 0),
    likes: Number(state.counts.likes || 0),
  };
  renderStats();
}

function renderStats() {
  const c = state.counts || {};
  qsa("[data-cr-count]").forEach((node) => {
    const key = node.dataset.crCount;
    node.textContent = key === "views" || key === "likes" ? num(c[key] || 0) : String(Number(c[key] || 0));
  });
  const foot = el("[data-cr-limits]");
  if (foot) {
    foot.textContent = `${state.rows.length} of ${LIMIT} items · drafts are private to you`;
  }
}

/* ================================================================== */
/* the list                                                           */
/* ================================================================== */
function visibleRows() {
  const q = state.search.trim().toLowerCase();
  return state.rows.filter((row) => {
    if (state.filter !== "all" && row.status !== state.filter) return false;
    if (!q) return true;
    return [row.title, row.summary, (row.tags || []).join(" "), row.kind]
      .join(" ")
      .toLowerCase()
      .includes(q);
  });
}

function rowMeta(row) {
  const kind = kindOf(row.kind);
  const bits = [esc(kind.label)];
  if (row.minutes) bits.push(`${num(row.minutes)} min`);
  else if (row.words) bits.push(`${num(row.words)} words`);
  if (row.status === "published" && Number(row.views)) bits.push(`${num(row.views)} views`);
  bits.push(esc(timeAgo(row.updated_at || row.created_at) || "just now"));
  return bits.join('<span class="sep">·</span>');
}

function renderList() {
  const host = el("[data-cr-list]");
  if (!host) return;
  const rows = visibleRows();

  if (!state.rows.length) {
    host.innerHTML = `
      <div class="cr-empty">
        <i data-icon="sparkle"></i>
        <p>Nothing written yet.</p>
        <p>Pick a kind on the right and start — the first draft saves itself.</p>
      </div>`;
    hydrateIcons(host);
    return;
  }

  if (!rows.length) {
    host.innerHTML = `
      <div class="cr-empty">
        <i data-icon="search"></i>
        <p>Nothing matches this filter.</p>
      </div>`;
    hydrateIcons(host);
    return;
  }

  host.innerHTML = rows
    .map((row) => {
      const kind = kindOf(row.kind);
      const on = state.current && state.current.id === row.id;
      const title = row.title || "Untitled draft";
      return `
        <button class="cr-item ${on ? "is-on" : ""}" type="button" data-cr-select="${esc(row.id)}" aria-current="${on ? "true" : "false"}">
          <span class="cr-item__icon"><i data-icon="${esc(kind.icon)}"></i></span>
          <span class="cr-item__body">
            <span class="cr-item__title">${esc(title)}</span>
            <span class="cr-item__meta">
              <span class="cr-chip ${row.status === "published" ? "is-published" : ""}">${esc(row.status === "published" ? "Published" : "Draft")}</span>
              ${rowMeta(row)}
            </span>
          </span>
        </button>`;
    })
    .join("");

  qsa("[data-cr-filter]").forEach((btn) => {
    const on = btn.dataset.crFilter === state.filter;
    btn.classList.toggle("is-on", on);
    btn.setAttribute("aria-selected", on ? "true" : "false");
  });
  hydrateIcons(host);
}

/* ================================================================== */
/* the editor — one render per selection                              */
/* ================================================================== */
function renderStart() {
  const host = el("[data-cr-editor]");
  if (!host) return;
  host.innerHTML = `
    <div class="cr-start">
      <span class="cr-state__icon"><i data-icon="sparkle"></i></span>
      <h2 class="cr-start__title">Start something new</h2>
      <p class="cr-start__text">
        Choose what you are writing. The editor keeps a draft as you type, and you can publish when
        it is ready — or open an item from the list to continue it.
      </p>
      <div class="cr-start__kinds">
        ${KINDS.map(
          (kind) => `
          <button class="cr-kind" type="button" data-cr-start-kind="${esc(kind.key)}">
            <i data-icon="${esc(kind.icon)}"></i> ${esc(kind.label)}
          </button>`
        ).join("")}
      </div>
    </div>`;
  hydrateIcons(host);
}

function field(label, control, hint = "") {
  return `
    <div class="cr-field">
      <label>${esc(label)}${hint ? `<span class="cr-field__hint">${esc(hint)}</span>` : ""}</label>
      ${control}
    </div>`;
}

function renderEditor() {
  const host = el("[data-cr-editor]");
  if (!host) return;
  const c = state.current;
  if (!c) return renderStart();

  const kind = kindOf(c.kind);
  const mediaField = kind.media
    ? field(
        kind.key === "video" ? "Media link" : kind.key === "podcast" ? "Audio link" : kind.key === "image" ? "Image link" : "File link",
        `<input class="input" type="url" inputmode="url" value="${esc(c.media_url || "")}" placeholder="https://…" data-cr-media />`,
        "required to publish"
      )
    : "";

  host.innerHTML = `
    <div class="cr-editor__bar">
      <span class="cr-editor__state" data-cr-save-state data-tone="idle"><span class="dot"></span><span data-cr-save-text>Not saved yet</span></span>
      <span class="cr-editor__counts">
        <span data-cr-words>${num(words(c.body))} words</span>
        <span data-cr-minutes>${num(minutes(c.body))} min</span>
        <span>${c.status === "published" ? "Published" : c.id ? "Draft" : "New"}</span>
      </span>
    </div>

    <div class="cr-body">
      <div class="cr-kinds" role="group" aria-label="Kind of content">
        ${KINDS.map(
          (k) => `
          <button class="cr-kind ${k.key === c.kind ? "is-on" : ""}" type="button" data-cr-kind="${esc(k.key)}" aria-pressed="${k.key === c.kind}">
            <i data-icon="${esc(k.icon)}"></i> ${esc(k.label)}
          </button>`
        ).join("")}
      </div>
      <p class="cr-kind__hint">${esc(kind.hint)}</p>

      ${field(
        "Title",
        `<input class="input" type="text" maxlength="140" value="${esc(c.title || "")}" placeholder="What is it called?" data-cr-title />`,
        `${String(c.title || "").length}/140`
      )}

      ${field(
        "Summary",
        `<textarea class="textarea" rows="2" maxlength="320" placeholder="One or two lines that read like the door to it" data-cr-summary>${esc(c.summary || "")}</textarea>`,
        "320 characters"
      )}

      ${field(
        kind.text ? "Body" : "Notes / description",
        `<textarea class="textarea cr-body-text" placeholder="${kind.text ? "Write it here — 12 words unlock publishing" : "Credits, chapters, sources…"}" data-cr-body>${esc(c.body || "")}</textarea>`,
        "the word count follows you"
      )}

      ${mediaField}

      ${field(
        "Cover link",
        `<div class="cr-cover">
           <span class="cr-cover__idle" data-cr-cover-idle><i data-icon="image"></i></span>
           <input class="input" type="url" inputmode="url" value="${esc(c.cover_url || "")}" placeholder="https://… (optional)" data-cr-cover />
         </div>`,
        "optional"
      )}

      <div class="cr-grid-2">
        ${field("Tags", `<input class="input" type="text" maxlength="220" value="${esc(c.tagText || (c.tags || []).join(", "))}" placeholder="cinema, marrakesh, essay" data-cr-tags />`, `up to ${MAX_TAGS}, comma separated`)}
        ${field(
          "Language",
          `<select class="select" data-cr-language>
             ${LANGUAGES.map(([code, name]) => `<option value="${esc(code)}" ${c.language === code ? "selected" : ""}>${esc(name)}</option>`).join("")}
           </select>`
        )}
      </div>

      <div class="cr-grid-2">
        ${field(
          "Age",
          `<select class="select" data-cr-age>
             ${AGES.map(([value, name]) => `<option value="${esc(value)}" ${String(c.age_rating) === value ? "selected" : ""}>${esc(name)}</option>`).join("")}
           </select>`
        )}
        ${field(
          "Who sees it",
          `<select class="select" data-cr-visibility>
             ${VISIBILITY.map(([value, name]) => `<option value="${esc(value)}" ${c.visibility === value ? "selected" : ""}>${esc(name)}</option>`).join("")}
           </select>`
        )}
      </div>

      <p class="cr-note" data-cr-gate>
        <i data-icon="info"></i>
        <span data-cr-gate-text></span>
      </p>
    </div>

    <div class="cr-editor__foot">
      <button class="btn btn--quiet btn--sm" type="button" data-cr-delete ${c.id ? "" : "disabled"}>
        <i data-icon="trash"></i> Delete
      </button>
      <div class="cr-editor__right">
        <button class="btn btn--ghost btn--sm" type="button" data-cr-save><i data-icon="check"></i> Save draft</button>
        <button class="btn btn--primary btn--sm" type="button" data-cr-publish><i data-icon="upload"></i> Publish</button>
      </div>
    </div>`;

  hydrateIcons(host);
  paintGate();
  paintSaveState(
    c.id ? "saved" : "idle",
    c.id ? `Last saved ${timeAgo(c.updated_at) || "just now"}` : ""
  );
  if (/^https?:\/\//i.test(c.cover_url || "")) paintCover(c.cover_url);
}

function paintGate() {
  const c = state.current;
  const text = el("[data-cr-gate-text]");
  const gate = el("[data-cr-gate]");
  if (!c || !text) return;
  const kind = kindOf(c.kind);
  const needs = [];
  if (kind.media && !String(c.media_url || "").trim()) needs.push(`a ${kind.key === "podcast" ? "audio" : kind.key === "image" ? "image" : kind.key === "document" ? "file" : "media"} link`);
  if (kind.text && words(c.body) < 12) needs.push(`${12 - words(c.body)} more word${12 - words(c.body) === 1 ? "" : "s"}`);
  if (String(c.title || "").trim().length < 3) needs.push("a title of 3 characters");

  const active = String(state.member?.status || "active").toLowerCase() === "active";
  if (!active) {
    if (gate) gate.dataset.tone = "warn";
    text.innerHTML = `Your account is <b>not active</b>, so this saves as a draft only. <a href="actevite.html">Activate the membership</a> to publish.`;
    return;
  }
  if (gate) gate.dataset.tone = "";
  text.innerHTML = needs.length
    ? `Before it can publish it still needs ${esc(needs.join(", "))}. The draft saves anyway.`
    : `Ready to publish: ${esc(kind.label.toLowerCase())} · ${esc(VISIBILITY.find(([v]) => v === c.visibility)?.[1] || "Public")}.`;
}

function paintCover(url) {
  const idle = el("[data-cr-cover-idle]");
  if (!idle) return;
  const img = document.createElement("img");
  img.src = url;
  img.alt = "";
  img.loading = "lazy";
  img.addEventListener("error", () => {
    img.remove();
    idle.hidden = false;
    idle.style.display = "";
  });
  img.addEventListener("load", () => {
    idle.hidden = true;
    idle.style.display = "none";
  });
  idle.hidden = true;
  idle.style.display = "none";
  idle.replaceWith(img);
}

function paintSaveState(tone, text = "") {
  const box = el("[data-cr-save-state]");
  const label = el("[data-cr-save-text]");
  if (!box || !label) return;
  box.dataset.tone = tone;
  if (text) return (label.textContent = text);
  if (tone === "dirty") return (label.textContent = "Unsaved changes");
  if (tone === "saving") return (label.textContent = "Saving…");
  if (tone === "error") return (label.textContent = state.saveError || "Could not save");
  if (tone === "idle") return (label.textContent = "Not saved yet");
  label.textContent = state.savedAt ? `Saved ${timeAgo(new Date(state.savedAt))}` : "Saved";
}

function paintCounters() {
  const c = state.current;
  if (!c) return;
  const w = el("[data-cr-words]");
  const m = el("[data-cr-minutes]");
  if (w) w.textContent = `${num(words(c.body))} words`;
  if (m) m.textContent = `${num(minutes(c.body))} min`;
  const titleInput = el("[data-cr-title]");
  const titleHint = titleInput?.closest(".cr-field")?.querySelector(".cr-field__hint");
  if (titleHint) titleHint.textContent = `${String(c.title || "").length}/140`;
  paintGate();
}

/* ================================================================== */
/* reading and writing                                                */
/* ================================================================== */
async function load() {
  let res;
  try {
    res = await rpc("member_content_list", { p_token: state.token });
  } catch (err) {
    return showState(
      "close",
      "The editor could not load",
      "The server did not answer. Check the connection and try again.",
      `<button class="btn btn--primary btn--sm" type="button" data-cr-retry><i data-icon="refresh"></i> Try again</button>`
    );
  }

  if (!res || res.ok !== true) {
    return showState(
      "lock",
      "Sign in to write",
      "The creator editor needs a member session. Sign in and come back — everything you write is tied to your member.",
      `<a class="btn btn--primary btn--sm" href="login.html"><i data-icon="login"></i> Sign in</a>
       <a class="btn btn--ghost btn--sm" href="register.html"><i data-icon="user"></i> Create an account</a>`
    );
  }

  state.rows = Array.isArray(res.rows) ? res.rows : [];
  state.counts = { ...state.counts, ...(res.counts || {}) };
  showRoot();
  renderStats();
  renderList();

  const params = new URLSearchParams(location.search);
  const wanted = (params.get("id") || "").trim();
  const kind = (params.get("kind") || "").trim();

  if (wanted) return open(wanted);
  if (kind) return startNew(kind);
  if (state.rows.length) return open(state.rows[0].id);
  renderStart();
  renderList();
}

async function open(id) {
  state.saveError = "";
  let res = null;
  try {
    res = await rpc("member_content_get", { p_token: state.token, p_id: id });
  } catch (err) {
    res = null;
  }
  if (!res || res.ok !== true) {
    const reason = ERRORS[res?.error] || "That item could not be opened.";
    toast({ title: "Not opened", message: reason, tone: "error" });
    state.current = null;
    renderStart();
    renderList();
    return;
  }
  const row = res.row || {};
  state.current = {
    ...blank(row.kind),
    ...row,
    tagText: (row.tags || []).join(", "),
    tags: row.tags || [],
    word_count: Number(row.word_count || words(row.body)),
    minutes: Number(row.minutes || minutes(row.body)),
  };
  state.dirty = false;
  state.version = 0;
  renderEditor();
  renderList();
  window.scrollTo?.({ top: 0, behavior: "smooth" });
}

function startNew(kind = "article") {
  state.current = blank(kind);
  state.dirty = false;
  state.version = 0;
  state.savedAt = 0;
  state.saveError = "";
  renderEditor();
  renderList();
  const title = el("[data-cr-title]");
  title?.focus?.();
}

function snapshot() {
  const c = state.current;
  return {
    p_token: state.token,
    p_id: c.id || null,
    p_kind: c.kind,
    p_title: String(c.title || "").trim(),
    p_summary: String(c.summary || "").trim(),
    p_body: c.body || "",
    p_media_url: String(c.media_url || "").trim(),
    p_cover_url: String(c.cover_url || "").trim(),
    p_tags: tagList(c.tagText || (c.tags || []).join(",")),
    p_language: c.language || "en",
    p_age: String(c.age_rating || "none"),
    p_visibility: c.visibility || "public",
  };
}

const hasSomething = () => {
  const c = state.current;
  if (!c) return false;
  return Boolean(c.id || String(c.title || "").trim() || String(c.body || "").trim() || String(c.media_url || "").trim());
};

async function save({ publish = false, silent = false } = {}) {
  const c = state.current;
  if (!c) return false;
  if (state.saving) return false;
  if (!publish && !state.dirty) {
    if (!silent) toast({ title: "Nothing to save", message: "Every change is already on the server." });
    return false;
  }
  if (!hasSomething()) {
    if (!silent) toast({ title: "Write something first", message: "A title, a body or a link — then it can be kept." });
    return false;
  }

  const version = state.version;
  state.saving = true;
  state.saveError = "";
  paintSaveState("saving");

  let res = null;
  let failure = "";
  try {
    res = await rpc("member_content_save", { ...snapshot(), p_publish: Boolean(publish) });
    if (!res || res.ok !== true) failure = res?.error || "unknown";
  } catch (err) {
    failure = "network";
  } finally {
    state.saving = false;
  }

  if (failure) {
    state.saveError = ERRORS[failure] || "The save did not go through. Try again.";
    if (state.current === c) paintSaveState("error");
    if (!silent) toast({ title: publish ? "Not published" : "Not saved", message: state.saveError, tone: "error" });
    return false;
  }

  const row = res.row || {};
  c.id = row.id || c.id;
  c.kind = row.kind || c.kind;
  c.title = row.title !== undefined ? row.title : c.title;
  c.summary = row.summary !== undefined ? row.summary : c.summary;
  c.status = row.status || c.status;
  c.visibility = row.visibility || c.visibility;
  c.word_count = Number(row.words ?? words(c.body));
  c.minutes = Number(row.minutes ?? minutes(c.body));
  c.updated_at = row.updated_at || new Date().toISOString();
  c.published_at = row.published_at || c.published_at;
  c.tags = tagList(c.tagText || (c.tags || []).join(","));

  if (state.current === c) {
    if (state.version === version) {
      state.dirty = false;
      state.savedAt = Date.now();
    }
    paintSaveState(state.dirty ? "dirty" : "saved");
  }

  /* the list and the numbers follow the row that just came back */
  const brief = {
    id: c.id,
    kind: c.kind,
    title: c.title,
    summary: c.summary,
    status: c.status,
    visibility: c.visibility,
    tags: c.tags,
    words: c.word_count,
    minutes: c.minutes,
    published_at: c.published_at,
    updated_at: c.updated_at,
  };
  const index = state.rows.findIndex((entry) => entry.id === c.id);
  if (index === -1) state.rows.unshift(brief);
  else state.rows[index] = { ...state.rows[index], ...brief };
  state.rows.sort((a, b) => String(b.updated_at || "").localeCompare(String(a.updated_at || "")));
  recount();
  renderList();

  if (publish) {
    toast({
      title: c.status === "published" ? "Published" : "Saved",
      message:
        c.status === "published"
          ? `“${c.title || "Untitled"}” is live for ${c.visibility === "public" ? "everyone" : c.visibility === "followers" ? "your followers" : "anyone with the link"}.`
          : "The draft is kept. The publish was not applied.",
      tone: "success",
      iconName: "check",
    });
  } else if (!silent) {
    toast({ title: "Draft saved", message: "Only you can see it until it is published.", iconName: "check" });
  }

  /* keep the URL pointing at the item so a reload reopens it */
  if (!new URLSearchParams(location.search).get("id") && c.id) {
    try {
      history.replaceState(null, "", `creator.html?id=${encodeURIComponent(c.id)}`);
    } catch {
      /* the address bar is not writable here */
    }
  }
  return true;
}

const autosave = debounce(() => {
  if (!state.dirty || !state.current || state.saving) return;
  if (!hasSomething()) return;
  save({ publish: false, silent: true });
}, AUTOSAVE_MS);

async function remove() {
  const c = state.current;
  if (!c || !c.id) return;
  const yes = window.confirm(`Delete “${c.title || "this draft"}”? This cannot be undone.`);
  if (!yes) return;
  let res = null;
  try {
    res = await rpc("member_content_delete", { p_token: state.token, p_id: c.id });
  } catch (err) {
    res = null;
  }
  if (!res || res.ok !== true) {
    toast({ title: "Not deleted", message: ERRORS[res?.error] || "The server did not confirm the delete.", tone: "error" });
    return;
  }
  state.rows = state.rows.filter((row) => row.id !== c.id);
  recount();
  state.current = null;
  state.dirty = false;
  renderStart();
  renderList();
  toast({ title: "Deleted", message: `“${c.title || "Untitled draft"}” is gone.`, iconName: "trash" });
  try {
    history.replaceState(null, "", "creator.html");
  } catch {
    /* nothing to clean up */
  }
}

/* ================================================================== */
/* input                                                              */
/* ================================================================== */
function markDirty() {
  state.dirty = true;
  state.version += 1;
  paintSaveState("dirty");
  autosave();
}

document.addEventListener("input", (event) => {
  const target = event.target;
  if (!state.current) return;
  if (target.matches("[data-cr-search]")) {
    state.search = target.value || "";
    renderList();
    return;
  }
  if (target.matches("[data-cr-title]")) {
    state.current.title = target.value;
    markDirty();
    paintCounters();
    return;
  }
  if (target.matches("[data-cr-summary]")) {
    state.current.summary = target.value;
    markDirty();
    return;
  }
  if (target.matches("[data-cr-body]")) {
    state.current.body = target.value;
    markDirty();
    paintCounters();
    return;
  }
  if (target.matches("[data-cr-media]")) {
    state.current.media_url = target.value;
    markDirty();
    paintGate();
    return;
  }
  if (target.matches("[data-cr-cover]")) {
    state.current.cover_url = target.value;
    markDirty();
    return;
  }
  if (target.matches("[data-cr-tags]")) {
    state.current.tagText = target.value;
    markDirty();
  }
});

document.addEventListener("change", (event) => {
  const target = event.target;
  if (!state.current) return;
  if (target.matches("[data-cr-language]")) {
    state.current.language = target.value;
    markDirty();
    return;
  }
  if (target.matches("[data-cr-age]")) {
    state.current.age_rating = target.value;
    markDirty();
    return;
  }
  if (target.matches("[data-cr-visibility]")) {
    state.current.visibility = target.value;
    markDirty();
    paintGate();
    return;
  }
  if (target.matches("[data-cr-cover]") && /^https?:\/\//i.test(target.value || "")) {
    paintCover(target.value);
  }
});

/* ================================================================== */
/* clicks                                                             */
/* ================================================================== */
document.addEventListener("click", (event) => {
  const target = event.target;

  if (target.closest("[data-cr-retry]")) return location.reload();

  if (target.closest("[data-cr-new]")) {
    event.preventDefault();
    if (state.dirty) save({ silent: true });
    return startNew(state.current?.kind || "article");
  }

  const start = target.closest("[data-cr-start-kind]");
  if (start) {
    event.preventDefault();
    return startNew(start.dataset.crStartKind);
  }

  const filter = target.closest("[data-cr-filter]");
  if (filter) {
    event.preventDefault();
    state.filter = filter.dataset.crFilter;
    renderList();
    return;
  }

  const pick = target.closest("[data-cr-select]");
  if (pick) {
    event.preventDefault();
    if (state.dirty) save({ silent: true });
    return open(pick.dataset.crSelect);
  }

  const kind = target.closest("[data-cr-kind]");
  if (kind) {
    event.preventDefault();
    if (!state.current) return startNew(kind.dataset.crKind);
    if (state.current.kind === kind.dataset.crKind) return;
    state.current.kind = kind.dataset.crKind;
    markDirty();
    renderEditor();
    return;
  }

  if (target.closest("[data-cr-save]")) {
    event.preventDefault();
    return save({ publish: false });
  }

  if (target.closest("[data-cr-publish]")) {
    event.preventDefault();
    return save({ publish: true });
  }

  if (target.closest("[data-cr-delete]")) {
    event.preventDefault();
    return remove();
  }
});

/* a member who closes the tab mid-sentence is warned once */
window.addEventListener("beforeunload", (event) => {
  if (!state.dirty) return;
  event.preventDefault();
  event.returnValue = "";
});

/* ================================================================== */
/* boot                                                               */
/* ================================================================== */
function boot() {
  state.token = sessionToken() || "";
  state.member = getMember();

  if (!state.token) {
    return showState(
      "lock",
      "Sign in to write",
      "The creator editor needs a member session. Sign in and come back — everything you write stays tied to your member.",
      `<a class="btn btn--primary btn--sm" href="login.html"><i data-icon="login"></i> Sign in</a>
       <a class="btn btn--ghost btn--sm" href="register.html"><i data-icon="user"></i> Create an account</a>`
    );
  }

  hydrateIcons();
  load();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot, { once: true });
} else {
  boot();
}
