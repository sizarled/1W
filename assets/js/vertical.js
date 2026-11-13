/**
 * vertical.js — the 9:16 shelf and its viewer, inside `videos.html`.
 * ------------------------------------------------------------------
 * Two screens, one page, and the address says which one is on:
 *
 *   videos.html#/vertical     the shelf — every vertical video as a 9:16 card
 *   videos.html#/v/ID=…       one video, with the one before and the one after
 *                             standing beside it
 *
 * `#/h/…` and the bare page belong to `videos.js`; this file keeps out of them
 * (and hides its own screens) so the two formats never draw over each other.
 * `vertical.html` is only a door that forwards to this page.
 *
 * Nothing is invented here. The shelf asks the database for the videos whose
 * publisher ticked **vertical** (`video_vertical_feed`), and a video is opened
 * with the same call the videos page uses (`video_get`) — so the counters, the
 * reactions, the comments, the report and the follow are the site's own, not a
 * second copy of them.
 *
 * Three things this page has to get right, because they are what a vertical
 * viewer is:
 *
 *   • **One screen at a time.** Only the video on screen mounts a player; the
 *     one before and the one after are pictures. Moving on stops what was
 *     playing — no page ever runs two videos.
 *   • **Moving on is cheap.** Previous, next, the arrow keys, a swipe, a press
 *     on the neighbour: all of them rewrite the hash, and the address is the
 *     only state, so a link to a video can be shared and comes back to it.
 *   • **The gate still stands.** A vertical video is a video: a new one asks
 *     first, exactly as it does on the videos page (`gates.js`).
 */
import { icon } from "./icons.js";
import { toast } from "./ui.js";
import { esc, qs, qsa, compact, num, timeAgo, enableDragScrollAll } from "./utils.js";
import { getMember, sessionToken } from "./session.js";
import { rpc } from "./data.js";
import { creatorUrl } from "./media.js";
import { isFile, autoThumb, fullscreenSrc, tapeColour, FRAME_ALLOW } from "./embed.js";
import { currentTheme } from "./theme.js";
import { gateNeed, mountGate } from "./gates.js";

/* The vertical format lives on the videos page now — the page the whole site
   already calls `videos.html`. A video addressed `#/v/ID=…` is drawn here in 9:16,
   a landscape one `#/h/ID=…` is left to `videos.js`, and the shelf itself is
   `#/vertical`. `vertical.html` is only a door that forwards to this page. */
const HOST_PAGE = "videos.html";
const hosted = Boolean(document.querySelector("[data-v-browse]"));

const PAGE = 24;
const SAVED_KEY = "1w.videos.saved";
const BLOCKED_KEY = "1w.videos.blocked";

const state = {
  token: "",
  view: "grid",
  sort: "new",
  search: "",
  rows: [],
  total: 0,
  loaded: 0,
  loading: false,
  seq: 0,
  code: "",
  video: null,
  res: null,
  hub: null,
  queue: [],
  queueRows: [],
  qIndex: -1,
  comments: null,
  canComment: false,
  reaction: 0,
  key: "",
  stopGate: null,
  seqWatch: 0,
};

const $ = (sel, root = document) => qs(sel, root);
const pageEl = () => $("[data-vert-page]");
const browseEl = () => $("[data-vert-browse]");
const watchRoot = () => $("[data-vert-watch]");
const gridEl = () => $("[data-vert-grid]");

const signedIn = () => Boolean(state.token && getMember());

/* ================================================================== */
/* small helpers                                                      */
/* ================================================================== */
function initial(name = "?") {
  return String(name).trim().charAt(0).toUpperCase() || "?";
}

function avatarTag(host, size = "v9av") {
  const url = host && host.avatar;
  if (url) return `<img class="${size}" src="${esc(url)}" alt="" width="28" height="28" loading="lazy" decoding="async" />`;
  return `<span class="${size}" aria-hidden="true">${esc(initial((host && (host.name || host.username)) || "?"))}</span>`;
}

function stillOf(v) {
  const row = v || {};
  return String(row.thumbnail || autoThumb(row.video?.embed || row.embed || "") || "");
}

function hostOf(v) {
  return (v && v.video && v.video.host) || (v && v.publisher) || {};
}

function viewsOf(v) {
  return Number((v && v.counters && v.counters.impressions) || 0);
}

/** The length a video carries with it — and nothing when it carries none. */
function secondsOf(v) {
  const meta = (v && v.video && v.video.meta) || {};
  const raw = Number(meta.duration || meta.seconds || 0);
  if (Number.isFinite(raw) && raw > 0) return Math.round(raw);
  const minutes = Number(meta.minutes || (v && v.minutes) || 0);
  if (Number.isFinite(minutes) && minutes > 0) return Math.round(minutes * 60);
  return 0;
}

function stamp(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n) => String(n).padStart(2, "0");
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

function categoryOf(v) {
  const list = Array.isArray(v && v.keywords) ? v.keywords : [];
  const main = list.find((k) => k && k.role === "main" && k.keyword);
  return main ? String(main.keyword) : "";
}

/** The address of one video — the only state this page has. */
function hrefOf(code) {
  return `${HOST_PAGE}#/v/ID=${encodeURIComponent(String(code || ""))}`;
}

/** The shelf's own address — where "back to the shelf" goes. */
function shelfHref() {
  return hosted ? "#/vertical" : `${HOST_PAGE}#/vertical`;
}

function routeOf() {
  const raw = String(location.hash || "").replace(/^#\/?/, "");
  const byId = raw.match(/^v\/ID=([^&]+)/i);
  if (byId) return { view: "watch", code: decodeURIComponent(byId[1]) };
  const plain = raw.match(/^v\/([A-Za-z0-9-]+)$/);
  if (plain) return { view: "watch", code: plain[1] };
  if (/^vertical(\/|$)/i.test(raw)) return { view: "shelf", code: "" };
  /* on a page of its own (the old `vertical.html`) no address is the shelf;
     hosted, no address belongs to `videos.js`, so this format stays out of it */
  return hosted ? { view: "none", code: "" } : { view: "shelf", code: "" };
}

function savedSet() {
  try {
    const raw = JSON.parse(localStorage.getItem(SAVED_KEY) || "[]");
    return new Set(Array.isArray(raw) ? raw : []);
  } catch {
    return new Set();
  }
}

function toggleSaved(code) {
  const set = savedSet();
  if (set.has(code)) set.delete(code);
  else set.add(code);
  try {
    localStorage.setItem(SAVED_KEY, JSON.stringify([...set]));
  } catch {
    /* storage blocked — the button still flips for the visit */
  }
  return set.has(code);
}

function blockedSet() {
  try {
    const raw = JSON.parse(localStorage.getItem(BLOCKED_KEY) || "[]");
    return new Set(Array.isArray(raw) ? raw : []);
  } catch {
    return new Set();
  }
}

function blockRef() {
  const host = hostOf(state.video);
  return String((state.hub && state.hub.creator) || host.id || host.username || "");
}

/* ================================================================== */
/* the shelf                                                          */
/* ================================================================== */
function skeleton(count = 8) {
  return Array.from(
    { length: count },
    () => `<div class="v9sk" aria-hidden="true"><div class="v9sk__media"></div><div class="v9sk__line"></div><div class="v9sk__line v9sk__line--sm"></div></div>`
  ).join("");
}

function emptyState({ title, text, action = "" }) {
  return `
    <div class="v9empty">
      <span class="v9empty__icon">${icon("video")}</span>
      <h2>${esc(title)}</h2>
      <p>${esc(text)}</p>
      ${action}
    </div>`;
}

function cardMarkup(row) {
  const v = row || {};
  const host = hostOf(v);
  const length = secondsOf(v);
  const still = stillOf(v);
  return `
    <a class="v9card" href="${esc(hrefOf(v.code || v.id))}" data-v9-open="${esc(v.code || v.id || "")}">
      <span class="v9card__media">
        ${
          still
            ? `<img src="${esc(still)}" alt="" loading="lazy" decoding="async" />`
            : `<span class="v9card__ph">${icon("video")}</span>`
        }
        <span class="v9card__shade"></span>
        <span class="v9card__badge">${icon("video")} Vertical</span>
        ${length ? `<span class="v9card__dur">${esc(stamp(length))}</span>` : ""}
        <span class="v9card__play"><span>${icon("play")}</span></span>
      </span>
      <span class="v9card__body">
        <span class="v9card__title">${esc(v.title || "Untitled")}</span>
        <span class="v9card__host">${avatarTag(host)}<b>${esc(host.name || host.username || "A member")}</b></span>
        <span class="v9card__meta">
          <span>${esc(timeAgo(v.published_at) || "unpublished")}</span>
          <i></i>
          <span>${icon("eye")}${esc(compact(viewsOf(v)))}</span>
        </span>
      </span>
    </a>`;
}

/**
 * One suggestion in the rail above the player.
 *
 * The shelf's own card carries a host, a date and a counter under its poster;
 * in a strip that sits above a video, the poster and the name are the whole
 * point, so the card is the picture and one line.
 */
function railCard(row) {
  const v = row || {};
  const code = String(v.code || v.id || "");
  const still = stillOf(v);
  return `
    <a class="vrail__card" href="${esc(hrefOf(code))}" data-v9-rail-open="${esc(code)}" data-orientation="v">
      <span class="vrail__media">
        ${still ? `<img src="${esc(still)}" alt="" loading="lazy" decoding="async" />` : `<span class="vrail__ph">${icon("video")}</span>`}
        <span class="vrail__play">${icon("play")}</span>
      </span>
      <span class="vrail__name">${esc(v.title || "Untitled")}</span>
      <span class="vrail__meta">${esc(compact(viewsOf(v)))} views · ${esc(timeAgo(v.published_at) || "—")}</span>
    </a>`;
}

/**
 * What else is on the shelf, as a strip above the player.
 *
 * The vertical viewer is the one screen where the suggestions cannot sit beside
 * the video — the 9:16 frame already has the one before and the one after
 * standing there — so they ride above it and scroll sideways. The order starts
 * with the videos that come after this one in the shelf, because that is where
 * a viewer is going next.
 */
function railMarkup(v) {
  const at = String((v && (v.code || v.id)) || "");
  const rows = (state.queueRows || []).filter((row) => String((row && (row.code || row.id)) || "") !== at);
  if (!rows.length) return "";
  const from = Math.max(0, Number(state.qIndex) || 0);
  const ordered = [...rows.slice(from), ...rows.slice(0, from)].slice(0, 12);
  return `
    <section class="vwatch__rail v9rail" data-v9-rail aria-label="More vertical videos">
      <div class="vrail__head">
        <span class="vrail__title">${icon("video")} More vertical videos</span>
        <span class="vrail__hint">${esc(String(ordered.length))}</span>
      </div>
      <div class="vrail__track" data-drag-scroll>
        ${ordered.map(railCard).join("")}
      </div>
    </section>`;
}

function renderGrid({ from = 0 } = {}) {
  const host = gridEl();
  if (!host) return;
  if (!from) host.innerHTML = state.rows.map(cardMarkup).join("");
  else host.insertAdjacentHTML("beforeend", state.rows.slice(from).map(cardMarkup).join(""));
  const more = $("[data-vert-more]");
  if (more) {
    more.innerHTML =
      state.rows.length < state.total
        ? `<button class="btn btn--ghost" type="button" data-v9-more>${icon("chevronDown")} More vertical videos</button>`
        : "";
  }
  const count = $("[data-vert-count]");
  if (count) {
    count.textContent = state.total
      ? `${num(state.rows.length)} of ${num(state.total)}`
      : "";
  }
  const empty = $("[data-vert-empty]");
  if (empty) {
    const none = !state.loading && state.rows.length === 0;
    empty.hidden = !none;
    if (none) {
      empty.innerHTML = emptyState({
        title: state.search ? "Nothing matches that search" : "Nothing vertical yet",
        text: state.search
          ? "No vertical video carries that title or description. Try another word."
          : "This shelf holds only the videos their publisher marked vertical — the 9:16 ones. Publish one and it lands here.",
        action: state.search
          ? `<button class="btn btn--ghost btn--sm" type="button" data-v9-clear>${icon("refresh")} Clear the search</button>`
          : `<a class="btn btn--primary btn--sm" href="video-editor.html">${icon("upload")} Publish a vertical video</a>`,
      });
    }
  }
}

async function loadFeed({ append = false } = {}) {
  const seq = ++state.seq;
  const wasLoaded = state.loaded;
  state.loading = true;
  if (!append) {
    state.rows = [];
    state.loaded = 0;
    const host = gridEl();
    if (host) host.innerHTML = skeleton(8);
    const empty = $("[data-vert-empty]");
    if (empty) empty.hidden = true;
  }
  let res = null;
  try {
    res = await rpc("video_vertical_feed", {
      p_token: state.token,
      p_sort: state.sort,
      p_search: state.search.trim(),
      p_limit: PAGE,
      p_offset: append ? state.loaded : 0,
    });
  } catch (error) {
    console.warn("[1World] vertical feed:", error.message);
  }
  if (seq !== state.seq) return null;
  state.loading = false;

  if (!res || res.ok !== true) {
    const host = gridEl();
    if (host) host.innerHTML = "";
    const empty = $("[data-vert-empty]");
    if (empty) {
      empty.hidden = false;
      empty.innerHTML = emptyState({
        title: "The shelf did not answer",
        text: "The server is not reachable from here. Try again in a moment.",
        action: `<button class="btn btn--ghost btn--sm" type="button" data-v9-retry>${icon("refresh")} Try again</button>`,
      });
    }
    return null;
  }

  const rows = Array.isArray(res.rows) ? res.rows : [];
  state.total = Number(res.total) || (append ? state.total : rows.length);
  state.rows = append ? state.rows.concat(rows) : rows;
  state.loaded = state.rows.length;
  state.queue = state.rows.map((row) => String(row.code || row.id || "")).filter(Boolean);
  state.queueRows = state.rows.slice();
  renderGrid({ from: append ? wasLoaded : 0 });
  return res;
}

/* ================================================================== */
/* the viewer                                                         */
/* ================================================================== */
function mediaMarkup(v) {
  const src = (v && ((v.video && v.video.embed) || v.embed)) || "";
  if (!src) {
    return `<div class="v9idle">${icon("video")}<p>This video has no source yet.</p></div>`;
  }
  if (isFile(src)) {
    return `<video class="v9media" controls playsinline preload="metadata" poster="${esc(stillOf(v))}" src="${esc(src)}"></video>`;
  }
  return `<iframe class="v9media" src="${esc(tapeColour(fullscreenSrc(src), currentTheme()))}" title="${esc(v.title || "Vertical video")}" allow="${esc(FRAME_ALLOW)}" allowfullscreen webkitallowfullscreen mozallowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>`;
}

function sideMarkup(row, dir) {
  if (!row) return `<span class="v9side v9side--empty" aria-hidden="true"></span>`;
  const still = stillOf(row);
  return `
    <a class="v9side" href="${esc(hrefOf(row.code || row.id))}" data-v9-side="${dir}" aria-label="${dir === "prev" ? "Previous" : "Next"} video: ${esc(row.title || "")}">
      ${still ? `<img src="${esc(still)}" alt="" loading="lazy" decoding="async" />` : `<span class="v9side__ph">${icon("video")}</span>`}
      <span class="v9side__shade"></span>
      <span class="v9side__label">${dir === "prev" ? "Previous" : "Next"}</span>
      <span class="v9side__title">${esc(row.title || "")}</span>
    </a>`;
}

function actionsMarkup(v) {
  const counters = (v && v.counters) || {};
  const mine = (v && v.mine) || {};
  const reaction = Number(mine.reaction) || 0;
  const saved = savedSet().has(String(v.code || ""));
  return `
    <div class="v9acts" data-v9-actions>
      <button class="v9act" type="button" data-v9-desc aria-pressed="false">
        <span class="v9act__ico">${icon("article")}</span><span class="v9act__label">Description</span>
      </button>
      <button class="v9act" type="button" data-v9-react="1" aria-pressed="${reaction === 1}">
        <span class="v9act__ico">${icon("thumbUp")}</span><span class="v9act__label">Like</span>
        <span class="v9act__n" data-v9-like>${esc(compact(counters.likes || 0))}</span>
      </button>
      <button class="v9act" type="button" data-v9-react="-1" aria-pressed="${reaction === -1}">
        <span class="v9act__ico">${icon("thumbDown")}</span><span class="v9act__label">Dislike</span>
        <span class="v9act__n" data-v9-dislike>${esc(compact(counters.dislikes || 0))}</span>
      </button>
      <button class="v9act" type="button" data-v9-goto-comments>
        <span class="v9act__ico">${icon("comment")}</span><span class="v9act__label">Comments</span>
        <span class="v9act__n" data-v9-comment-count>${esc(compact(counters.comments || 0))}</span>
      </button>
      <button class="v9act" type="button" data-v9-save aria-pressed="${saved}">
        <span class="v9act__ico">${icon("bookmark")}</span><span class="v9act__label">Watch later</span>
      </button>
      <button class="v9act" type="button" data-v9-share>
        <span class="v9act__ico">${icon("share")}</span><span class="v9act__label">Share</span>
      </button>
      <button class="v9act v9act--danger" type="button" data-v9-report>
        <span class="v9act__ico">${icon("flag")}</span><span class="v9act__label">Report</span>
      </button>
    </div>`;
}

function hostMarkup(v) {
  const host = hostOf(v);
  const hub = state.hub && state.hub.name ? state.hub : null;
  const studioHref = creatorUrl((hub && (hub.code || hub.id)) || "", (hub && hub.creator) || host.id || "");
  const name = (hub && hub.name) || host.name || host.username || "A member";
  const who = blockRef();
  const blocked = who && blockedSet().has(who);
  return `
    <section class="v9host${blocked ? " is-blocked" : ""}" data-v9-host>
      <a class="v9host__face" href="${esc(studioHref || creatorUrl("", host.id || ""))}" aria-label="${esc(name)}">
        ${
          hub && hub.logo_url
            ? `<img src="${esc(hub.logo_url)}" alt="" width="56" height="56" loading="lazy" />`
            : avatarTag({ avatar: host.avatar, name }, "v9av v9av--lg")
        }
      </a>
      <div class="v9host__id">
        <p class="v9host__name">
          <a href="${esc(studioHref || creatorUrl("", host.id || ""))}">${esc(name)}</a>
          ${hub ? `<span class="v9host__seal" title="Verified studio" aria-label="Verified studio">${icon("verified")}</span>` : ""}
        </p>
        <p class="v9host__meta">
          ${host.username ? `<span>${esc(host.username)}</span>` : ""}
          <span><b>${esc(num(Number((hub && hub.subscribers) ?? host.followers ?? 0)))}</b> followers</span>
          <span><b>${esc(num(Number((hub && hub.published) ?? host.posts ?? 0)))}</b> videos</span>
        </p>
      </div>
      <div class="v9host__acts">
        ${
          signedIn() && String(host.id || "") === String((getMember() || {}).id || "")
            ? ""
            : `<button class="btn btn--primary btn--sm" type="button" data-v9-follow>${icon("plus")} Follow</button>`
        }
        <details class="v9menu">
          <summary class="btn btn--ghost btn--sm" aria-label="More options">${icon("dots")}</summary>
          <div class="v9menu__panel">
            <button class="v9menu__item" type="button" data-v9-follow>${icon("user")} Follow</button>
            <button class="v9menu__item" type="button" data-v9-message>${icon("mail")} Message</button>
            <button class="v9menu__item" type="button" data-v9-report>${icon("flag")} Report</button>
            <button class="v9menu__item v9menu__item--danger" type="button" data-v9-block>
              ${icon(blocked ? "check" : "close")} ${blocked ? "Unblock" : "Block"}
            </button>
          </div>
        </details>
      </div>
    </section>`;
}

function linksMarkup(v) {
  const hub = state.hub && state.hub.name ? state.hub : null;
  const rows = hub && Array.isArray(hub.links) ? hub.links : [];
  const links = rows
    .map((link) => ({
      label: String(link.label || link.name || "Link").trim(),
      url: String(link.url || "").trim(),
    }))
    .filter((link) => link.url && link.label);
  if (!links.length) return "";
  return `
    <section class="v9links" data-v9-links>
      <h2 class="v9sect__title">${icon("link")} Related links</h2>
      <div class="v9links__row">
        ${links.map((link) => `<a class="chip" href="${esc(link.url)}" target="_blank" rel="noopener noreferrer">${icon("link")}${esc(link.label)}</a>`).join("")}
      </div>
    </section>`;
}

function descMarkup(v) {
  const text = String((v && v.description) || "").trim();
  return `
    <section class="v9desc" data-v9-desc-box hidden>
      <h2 class="v9sect__title">${icon("article")} Description</h2>
      <p class="v9desc__body is-clamped" data-v9-desc-body>${esc(text || "The publisher wrote no description for this one.")}</p>
      ${text.length > 220 ? `<button class="v9desc__more" type="button" data-v9-desc-toggle>Show more ${icon("chevronDown")}</button>` : ""}
    </section>`;
}

function commentMarkup(c, { nested = false } = {}) {
  const author = c.author || {};
  const id = esc(String(c.id ?? ""));
  const mine = String(c.mine_reaction || c.mine || "");
  return `
    <article class="v9com${nested ? " v9com--reply" : ""}" data-v9-comment="${id}">
      ${author.avatar ? `<img class="v9com__av" src="${esc(author.avatar)}" alt="" width="34" height="34" loading="lazy" />` : `<span class="v9com__av v9av" aria-hidden="true">${esc(initial(author.name || author.username || "?"))}</span>`}
      <div class="v9com__body">
        <p class="v9com__top">
          <span class="v9com__name">${esc(author.name || author.username || "A member")}</span>
          <span class="v9com__time">${esc(timeAgo(c.created_at) || "")}${c.edited ? " · edited" : ""}</span>
        </p>
        <p class="v9com__text">${esc(c.body || "")}</p>
        <div class="v9com__acts">
          <button class="v9com__act" type="button" data-v9-vote="1" data-v9-vote-id="${id}" aria-pressed="${mine === "agree"}">${icon("thumbUp")}<span data-v9-agree>${esc(num(Number(c.likes ?? c.agree_count ?? 0)))}</span></button>
          <button class="v9com__act" type="button" data-v9-vote="0" data-v9-vote-id="${id}" aria-pressed="${mine === "disagree"}">${icon("thumbDown")}<span data-v9-disagree>${esc(num(Number(c.dislikes ?? c.disagree_count ?? 0)))}</span></button>
          <button class="v9com__act" type="button" data-v9-creport="${id}">${icon("flag")} Report</button>
        </div>
      </div>
    </article>`;
}

function commentsMarkup() {
  const data = state.comments || { comments: [], count: 0 };
  const rows = Array.isArray(data.comments) ? data.comments : [];
  const me = getMember();
  const canComment = Boolean(state.canComment);
  const reaction = Number(state.reaction) || 0;

  const composer = !signedIn()
    ? `<div class="v9composer">
         <p class="v9composer__note">${icon("user")} <span><a href="login.html?next=${encodeURIComponent(hrefOf(state.code))}">Sign in</a> to join the conversation.</span></p>
       </div>`
    : !canComment
      ? `<div class="v9composer">
           <p class="v9composer__note">${icon("info")} <span>Like or dislike the video first — then you can comment. That is the rule everywhere on 1World.</span></p>
         </div>`
      : `<div class="v9composer">
           <textarea class="textarea" rows="3" data-v9-comment-input maxlength="4000" placeholder="Add a comment"></textarea>
           <div class="v9composer__row">
             <span class="v9composer__note">${icon("user")} <span>${esc((me && (me.name || me.username)) || "You")}${reaction ? " · you reacted" : ""}</span></span>
             <button class="btn btn--primary btn--sm" type="button" data-v9-comment-send>${icon("send")} Post</button>
           </div>
         </div>`;

  const repliesOf = (id) => rows.filter((c) => Number(c.parent_id) === Number(id));
  const tops = rows.filter((c) => !c.parent_id || !rows.some((p) => Number(p.id) === Number(c.parent_id)));

  return `
    <section class="v9comments" id="comments" data-v9-comments>
      <h2 class="v9sect__title">${icon("comment")} Comments <span class="v9count" data-v9-total>${esc(num(data.count || rows.length))}</span></h2>
      ${composer}
      <div class="v9com__list" data-v9-comment-list>
        ${
          tops.length
            ? tops
                .map((c) => {
                  const kids = repliesOf(c.id).sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
                  return kids.length
                    ? `${commentMarkup(c)}<div class="v9com__replies">${kids.map((kid) => commentMarkup(kid, { nested: true })).join("")}</div>`
                    : commentMarkup(c);
                })
                .join("")
            : `<p class="v9com__empty">No comments yet${canComment ? " — say the first thing." : "."}</p>`
        }
      </div>
    </section>`;
}

function viewerMarkup(v, res) {
  const prev = state.qIndex > 0 ? rowAt(state.qIndex - 1) : null;
  const next = state.qIndex >= 0 && state.qIndex < state.queue.length - 1 ? rowAt(state.qIndex + 1) : null;
  const host = hostOf(v);
  const category = categoryOf(v);
  const length = secondsOf(v);
  const position = state.qIndex >= 0 ? `${num(state.qIndex + 1)} of ${num(state.queue.length || state.total)}` : "";

  return `
    <div class="v9view" data-v9-view>
      <div class="v9view__bar">
        <a class="v9back" href="${esc(shelfHref())}" data-v9-back>${icon("arrowLeft")} The vertical shelf</a>
        ${position ? `<span class="v9pos" data-v9-pos>${esc(position)}</span>` : ""}
      </div>

      ${railMarkup(v)}

      <div class="v9stage" data-v9-stage>
        ${sideMarkup(prev, "prev")}
        <div class="v9player" data-v9-player-wrap>
          <div class="v9player__box" data-v9-player>
            ${
              res.locked
                ? `<div class="v9locked">${icon("lock")}<h2>This one is not for everyone</h2><p>Its publisher set a door on it. Ask them, or follow them and try again.</p></div>`
                : `<div class="v9player__wait" data-v9-wait>${icon("play")}</div>`
            }
          </div>
          <div class="v9player__load" data-v9-loading hidden><span class="v9spin" aria-hidden="true"></span><span>Preparing the video…</span></div>
        </div>
        ${sideMarkup(next, "next")}
        <button class="v9nav v9nav--prev" type="button" data-v9-prev aria-label="Previous vertical video" ${prev ? "" : "disabled"}>${icon("chevronUp")}</button>
        <button class="v9nav v9nav--next" type="button" data-v9-next aria-label="Next vertical video" ${next ? "" : "disabled"}>${icon("chevronDown")}</button>
      </div>

      <section class="v9info">
        <p class="v9info__badges">
          <span class="v9badge">${icon("video")} Vertical video</span>
          ${category ? `<span class="v9badge v9badge--quiet">${esc(category)}</span>` : ""}
          ${v.visibility && v.visibility !== "general" ? `<span class="v9badge v9badge--quiet">${esc(v.visibility)}</span>` : ""}
        </p>
        <h1 class="v9info__title" data-v9-title>${esc(v.title || "Untitled")}</h1>
        <p class="v9info__meta">
          ${host.name || host.username ? `<a class="v9info__who" href="${esc(creatorUrl("", host.id || ""))}">${esc(host.name || host.username)}</a><i></i>` : ""}
          <span>${icon("eye")}<b data-v9-views>${esc(compact(viewsOf(v)))}</b> views</span>
          <i></i>
          <span>${esc(timeAgo(v.published_at) || "unpublished")}</span>
          ${length ? `<i></i><span>${icon("clock")}${esc(stamp(length))}</span>` : ""}
        </p>
      </section>

      ${res.locked ? "" : actionsMarkup(v)}
      ${res.locked ? "" : hostMarkup(v)}
      ${res.locked ? "" : linksMarkup(v)}
      ${res.locked ? "" : descMarkup(v)}
      ${res.locked ? "" : commentsMarkup()}

      <section class="v9report" data-v9-report-box hidden>
        <h2 class="v9sect__title">${icon("flag")} Report this video</h2>
        <label class="field">
          <span>Why</span>
          <select class="select" data-v9-report-reason>
            <option value="copyright">It uses work that is not theirs</option>
            <option value="abuse">It is abusive or violent</option>
            <option value="spam">It is spam</option>
            <option value="misleading">It misleads the viewer</option>
            <option value="other">Something else</option>
          </select>
        </label>
        <textarea class="textarea" rows="3" data-v9-report-note maxlength="400" placeholder="What should we know? (optional)"></textarea>
        <div class="v9report__acts">
          <button class="btn btn--ghost btn--sm" type="button" data-v9-report-cancel>Cancel</button>
          <button class="btn btn--primary btn--sm" type="button" data-v9-report-send>${icon("send")} Send the report</button>
        </div>
      </section>

      <div class="v9msg" data-v9-msg-box hidden></div>
    </div>`;
}

/** Stop whatever is playing: one screen, one video. */
function stopMedia() {
  const player = $("[data-v9-player]");
  if (!player) return;
  const media = player.querySelector("video");
  if (media) {
    try {
      media.pause();
      media.removeAttribute("src");
      media.load();
    } catch {
      /* a media element that is already gone needs no pause */
    }
  }
  player.innerHTML = "";
}

function closeGate() {
  if (typeof state.stopGate === "function") state.stopGate();
  state.stopGate = null;
}

/** Mount the player — behind the gate when this video is new to the member. */
function mountMedia(v) {
  const player = $("[data-v9-player]");
  if (!player) return;
  closeGate();
  const need = gateNeed("videos", v.code || v.id);
  if (!need) {
    player.innerHTML = mediaMarkup(v);
    autoplay();
    return;
  }
  player.innerHTML = `
    <div class="v9player__poster" style="${stillOf(v) ? `background-image:url('${esc(stillOf(v))}')` : ""}"></div>
    <div class="v9gate" data-v9-gate></div>`;
  state.stopGate = mountGate($("[data-v9-gate]", player), {
    kind: "videos",
    id: v.code || v.id,
    onPaid: () => {
      player.innerHTML = mediaMarkup(v);
      autoplay();
    },
  });
}

function autoplay() {
  const media = $("[data-v9-player] video");
  if (!media) return;
  try {
    const started = media.play();
    if (started && started.catch) started.catch(() => {});
  } catch {
    /* the browser wants a press; the player's own controls are there */
  }
}

async function loadComments(code) {
  let res = null;
  try {
    res = await rpc("post_comments", { p_token: state.token, p_ref: code, p_limit: 60 });
  } catch (error) {
    console.warn("[1World] comments:", error.message);
  }
  if (!res || res.ok !== true) return;
  state.comments = res;
  state.canComment = Boolean(res.can_comment);
  state.reaction = Number(res.reaction) || 0;
  paintComments();
}

function paintComments() {
  const section = $("[data-v9-comments]");
  if (!section) return;
  const wrap = document.createElement("div");
  wrap.innerHTML = commentsMarkup();
  section.replaceWith(wrap.firstElementChild);
  const counter = $("[data-v9-total]");
  if (counter && state.comments) counter.textContent = num(Number(state.comments.count) || 0);
}

/**
 * Where this video sits among the vertical ones.
 *
 * The shelf already knows its own order; a link opened directly does not, so
 * one page of the feed is asked for to place it — the same page the grid would
 * have drawn, so "next" is the video that really follows.
 */
async function placeInQueue(code) {
  const index = state.queue.indexOf(String(code));
  if (index >= 0) {
    state.qIndex = index;
    return;
  }
  if (!state.rows.length || state.search.trim()) {
    let res = null;
    try {
      res = await rpc("video_vertical_feed", {
        p_token: state.token,
        p_sort: state.sort,
        p_search: "",
        p_limit: 60,
        p_offset: 0,
      });
    } catch (error) {
      console.warn("[1World] vertical queue:", error.message);
    }
    if (res && res.ok && Array.isArray(res.rows) && res.rows.length) {
      state.queueRows = res.rows;
      state.queue = res.rows.map((row) => String(row.code || row.id || "")).filter(Boolean);
    }
  }
  const at = state.queue.indexOf(String(code));
  state.qIndex = at;
}

/** The rows the neighbours are read from — the grid's, or the page fetched
    to place a link that arrived on its own. */
function rowAt(index) {
  if (index < 0) return null;
  return state.queueRows[index] || null;
}

async function openWatch(code) {
  const host = watchRoot();
  if (!host) return;
  state.view = "watch";
  state.code = code;
  state.video = null;
  state.res = null;
  state.hub = null;
  state.comments = null;
  state.canComment = false;
  state.reaction = 0;
  delete document.documentElement.dataset.vertMoved;
  const seq = ++state.seqWatch;

  if (pageEl()) pageEl().hidden = false;
  if (browseEl()) browseEl().hidden = true;
  host.hidden = false;
  stopMedia();
  host.innerHTML = `
    <div class="v9view">
      <div class="v9view__bar"><a class="v9back" href="${esc(shelfHref())}" data-v9-back>${icon("arrowLeft")} The vertical shelf</a></div>
      <div class="v9stage">
        <span class="v9side v9side--empty" aria-hidden="true"></span>
        <div class="v9player"><div class="v9player__box"><div class="v9player__load"><span class="v9spin" aria-hidden="true"></span><span>Preparing the video…</span></div></div></div>
        <span class="v9side v9side--empty" aria-hidden="true"></span>
      </div>
    </div>`;
  window.scrollTo({ top: 0, behavior: "auto" });

  const hubPromise = rpc("video_hub", { p_ref: code }).catch(() => null);
  let res = null;
  try {
    res = await rpc("video_get", { p_token: state.token, p_ref: code, p_key: state.key });
  } catch (error) {
    console.warn("[1World] vertical video:", error.message);
  }
  if (seq !== state.seqWatch) return;

  if (!res || res.ok !== true) {
    host.innerHTML = `
      <div class="v9view">
        <div class="v9view__bar"><a class="v9back" href="${esc(shelfHref())}" data-v9-back>${icon("arrowLeft")} The vertical shelf</a></div>
        ${emptyState({
          title: res && res.error === "not_found" ? "That video is gone" : "The video did not load",
          text:
            res && res.error === "not_found"
              ? "The link may be old, or the publisher deleted it."
              : "The server is not reachable from here. Try again in a moment.",
          action: `<a class="btn btn--ghost btn--sm" href="${esc(shelfHref())}">${icon("arrowLeft")} Back to the shelf</a>`,
        })}
      </div>`;
    return;
  }

  const hubReply = await hubPromise;
  if (seq !== state.seqWatch) return;
  const inline = res.hub || (res.video && res.video.hub) || null;
  state.hub = inline && inline.name ? inline : hubReply && hubReply.ok && hubReply.hub && hubReply.hub.name ? hubReply.hub : null;
  state.video = res.video || {};
  state.res = res;
  state.key = "";

  /* a landscape row is not this shelf's: it goes to the page it belongs to
     rather than sitting in a 9:16 box with two black bands */
  if (String(state.video.orientation || "").toLowerCase() === "h") {
    if (hosted) {
      /* on the videos page the format simply hands the address back */
      const hash = `#/h/ID=${encodeURIComponent(String(state.video.code || code))}`;
      document.documentElement.dataset.vertMoved = hash;
      location.hash = hash;
      return;
    }
    const away = `${HOST_PAGE}#/h/ID=${encodeURIComponent(String(state.video.code || code))}`;
    /* a note for whoever is looking at the page in a harness that cannot
       navigate — the browser itself only needs the line below */
    document.documentElement.dataset.vertMoved = away;
    location.replace(away);
    return;
  }

  /* a link that names an old code still lands on the video it means */
  const liveCode = String(state.video.code || code);
  if (liveCode && liveCode !== code) {
    state.code = liveCode;
    history.replaceState(null, "", hrefOf(liveCode));
  }

  await placeInQueue(state.code);
  if (seq !== state.seqWatch) return;

  host.innerHTML = viewerMarkup(state.video, res);
  enableDragScrollAll(host);
  document.title = `${state.video.title || "Vertical video"} — 1World Web`;
  document.documentElement.dataset.vertView = "watch";
  /* a locked video is a door, not a player: nothing mounts behind it */
  if (res.locked) return;
  mountMedia(state.video);
  loadComments(state.code);
}

/** Step out of the page: the horizontal feed owns the address now. */
function hideVertical() {
  closeGate();
  stopMedia();
  state.view = "none";
  state.code = "";
  const host = watchRoot();
  if (host) {
    host.hidden = true;
    host.innerHTML = "";
  }
  if (pageEl()) pageEl().hidden = true;
  if (browseEl()) browseEl().hidden = true;
  delete document.documentElement.dataset.vertView;
}

function showShelf({ scroll = true } = {}) {
  state.view = "grid";
  state.code = "";
  closeGate();
  stopMedia();
  const host = watchRoot();
  if (host) {
    host.hidden = true;
    host.innerHTML = "";
  }
  if (pageEl()) pageEl().hidden = false;
  if (browseEl()) browseEl().hidden = false;
  document.documentElement.dataset.vertView = "shelf";
  document.title = "Vertical Videos — 1World Web";
  if (scroll) window.scrollTo({ top: 0, behavior: "auto" });
}

/** Move one video along the shelf; refuse when there is nothing there. */
function step(delta) {
  if (state.view !== "watch") return;
  const at = state.qIndex;
  if (at < 0) return;
  const nextIndex = at + delta;
  const row = rowAt(nextIndex);
  if (!row) {
    toast({ title: delta > 0 ? "That is the last one" : "That is the first one", message: "The vertical shelf ends here.", tone: "info", iconName: "info", duration: 2400 });
    return;
  }
  const code = String(row.code || row.id || "");
  if (!code) return;
  location.hash = `#/v/ID=${encodeURIComponent(code)}`;
}

/* ================================================================== */
/* events                                                             */
/* ================================================================== */
function bindShelf() {
  const search = $("[data-vert-search]");
  if (search) {
    search.value = state.search;
    let timer = null;
    search.addEventListener("input", () => {
      state.search = search.value;
      clearTimeout(timer);
      timer = setTimeout(() => loadFeed(), 320);
    });
  }
  qsa("[data-vert-sort] [data-sort]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.sort = btn.getAttribute("data-sort") || "new";
      qsa("[data-vert-sort] [data-sort]").forEach((other) => {
        const on = other === btn;
        other.classList.toggle("is-active", on);
        other.setAttribute("aria-selected", String(on));
      });
      loadFeed();
    });
  });
  document.addEventListener("click", (event) => {
    if (event.target.closest("[data-v9-more]")) {
      event.preventDefault();
      loadFeed({ append: true });
      return;
    }
    if (event.target.closest("[data-v9-retry]")) {
      event.preventDefault();
      loadFeed();
      return;
    }
    if (event.target.closest("[data-v9-clear]")) {
      event.preventDefault();
      state.search = "";
      if (search) search.value = "";
      loadFeed();
    }
  });
}

/** The one handler for the whole viewer — events bubble from its markup. */
function bindViewer() {
  const root = watchRoot();
  if (!root || root.dataset.bound === "1") return;
  root.dataset.bound = "1";

  root.addEventListener("click", async (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;

    if (target.closest("[data-v9-back]")) {
      event.preventDefault();
      location.hash = "";
      return;
    }
    if (target.closest("[data-v9-prev]")) {
      event.preventDefault();
      step(-1);
      return;
    }
    if (target.closest("[data-v9-next]")) {
      event.preventDefault();
      step(1);
      return;
    }
    if (target.closest("[data-v9-goto-comments]")) {
      event.preventDefault();
      $("[data-v9-comments]")?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    if (target.closest("[data-v9-desc]")) {
      event.preventDefault();
      const box = $("[data-v9-desc-box]");
      const btn = target.closest("[data-v9-desc]");
      if (!box) return;
      box.hidden = !box.hidden;
      if (!box.hidden) box.scrollIntoView({ behavior: "smooth", block: "nearest" });
      btn?.setAttribute("aria-pressed", String(!box.hidden));
      return;
    }
    if (target.closest("[data-v9-desc-toggle]")) {
      event.preventDefault();
      const body = $("[data-v9-desc-body]");
      const btn = target.closest("[data-v9-desc-toggle]");
      if (!body) return;
      const clamped = body.classList.toggle("is-clamped");
      btn.innerHTML = clamped ? `Show more ${icon("chevronDown")}` : `Show less ${icon("chevronUp")}`;
      return;
    }

    const reactBtn = target.closest("[data-v9-react]");
    if (reactBtn) {
      event.preventDefault();
      if (!signedIn()) {
        return toast({ title: "Sign in first", message: "Reactions need a member account.", tone: "error", iconName: "user" });
      }
      const want = Number(reactBtn.getAttribute("data-v9-react"));
      const now = Number(state.reaction) || 0;
      const value = now === want ? 0 : want;
      reactBtn.disabled = true;
      let res = null;
      try {
        res = await rpc("post_react_from", {
          p_token: state.token,
          p_ref: state.code,
          p_value: value,
          p_source: "vertical",
          p_was: now,
        });
      } catch (error) {
        toast({ title: "That did not go through", message: error.message, tone: "error" });
      }
      reactBtn.disabled = false;
      if (res && res.ok) {
        const wasNone = !Number(state.reaction);
        state.reaction = Number(res.reaction) || 0;
        state.canComment = state.canComment || state.reaction !== 0;
        const like = $("[data-v9-like]");
        const dislike = $("[data-v9-dislike]");
        if (like) like.textContent = compact(res.likes || 0);
        if (dislike) dislike.textContent = compact(res.dislikes || 0);
        qsa("[data-v9-react]", root).forEach((b) => {
          b.setAttribute("aria-pressed", String(Number(b.getAttribute("data-v9-react")) === state.reaction));
        });
        if (state.reaction !== 0 && wasNone) paintComments();
      }
      return;
    }

    if (target.closest("[data-v9-save]")) {
      event.preventDefault();
      const btn = target.closest("[data-v9-save]");
      const on = toggleSaved(String(state.code));
      btn.setAttribute("aria-pressed", String(on));
      toast({
        title: on ? "Saved for later" : "Removed from your list",
        message: "Saved on this device, next to the rest of your list.",
        tone: "info",
        iconName: "bookmark",
        duration: 2800,
      });
      return;
    }

    if (target.closest("[data-v9-share]")) {
      event.preventDefault();
      const url = `${location.origin}${location.pathname}#/v/ID=${encodeURIComponent(state.code)}`;
      if (signedIn()) {
        rpc("post_reshare_from", { p_token: state.token, p_ref: state.code, p_source: "vertical" })
          .then((res) => {
            if (res && res.ok) toast({ title: res.reshared ? "Reshared to your feed" : "Reshare taken back", tone: "success", iconName: "share" });
          })
          .catch(() => {});
      }
      try {
        if (navigator.share) await navigator.share({ title: (state.video && state.video.title) || "Vertical video", url });
        else {
          await navigator.clipboard.writeText(url);
          rpc("reach_share_link", { p_token: state.token, p_code: state.code, p_source: "vertical" }).catch(() => {});
          toast({ title: "Link copied", message: url, tone: "success", iconName: "link" });
        }
      } catch {
        /* the member closed the sheet */
      }
      return;
    }

    if (target.closest("[data-v9-report]")) {
      event.preventDefault();
      const box = $("[data-v9-report-box]");
      if (box) {
        box.hidden = false;
        box.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
      return;
    }
    if (target.closest("[data-v9-report-cancel]")) {
      event.preventDefault();
      const box = $("[data-v9-report-box]");
      if (box) box.hidden = true;
      return;
    }
    if (target.closest("[data-v9-report-send]")) {
      event.preventDefault();
      if (!signedIn()) {
        return toast({ title: "Sign in first", message: "Reports need a member account.", tone: "error", iconName: "user" });
      }
      const reason = ($("[data-v9-report-reason]") || {}).value || "other";
      const note = ($("[data-v9-report-note]") || {}).value || "";
      try {
        const res = await rpc("post_report_from", {
          p_token: state.token,
          p_ref: state.code,
          p_reason: reason,
          p_note: note,
          p_source: "vertical",
        });
        if (res && res.ok) {
          const box = $("[data-v9-report-box]");
          if (box) box.hidden = true;
          toast({ title: "Report sent", message: "A moderator will look at it.", tone: "success", iconName: "flag" });
        } else {
          toast({ title: "Not sent", message: "The server refused the report.", tone: "error" });
        }
      } catch (error) {
        toast({ title: "Not sent", message: error.message, tone: "error" });
      }
      return;
    }

    if (target.closest("[data-v9-follow]")) {
      event.preventDefault();
      const btn = target.closest("[data-v9-follow]");
      const host = hostOf(state.video);
      if (!signedIn()) return toast({ title: "Sign in first", message: "Following hangs from a member.", iconName: "login" });
      btn.disabled = true;
      try {
        const res = await rpc("profile_follow_toggle", { p_token: state.token, p_ref: host.id || host.username || "" });
        if (res && res.ok) {
          qsa("[data-v9-follow]", root).forEach((b) => {
            b.innerHTML = `${icon(res.following ? "check" : "plus")} ${res.following ? (res.status === "pending" ? "Requested" : "Following") : "Follow"}`;
          });
          toast({
            title: res.status === "pending" ? "Follow request sent" : res.following ? "You follow them now" : "You stopped following",
            message: res.status === "pending" ? "This member approves follows by hand." : "",
            tone: "success",
            iconName: "users",
          });
        }
      } catch (error) {
        toast({ title: "That did not go through", message: error.message, tone: "error" });
      }
      btn.disabled = false;
      return;
    }

    if (target.closest("[data-v9-block]")) {
      event.preventDefault();
      const who = blockRef();
      if (!who) return;
      const set = blockedSet();
      const on = set.has(who);
      if (on) set.delete(who);
      else set.add(who);
      try {
        localStorage.setItem(BLOCKED_KEY, JSON.stringify([...set]));
      } catch {
        /* storage blocked — the menu still answers for this visit */
      }
      qsa("[data-v9-block]", root).forEach((b) => {
        b.innerHTML = `${icon(!on ? "check" : "close")} ${!on ? "Unblock" : "Block"}`;
      });
      $("[data-v9-host]")?.classList.toggle("is-blocked", !on);
      toast({
        title: !on ? "Blocked on this device" : "Unblocked",
        message: !on ? "Their videos stay where they are; the menu remembers." : "",
        tone: "info",
        iconName: "close",
        duration: 2600,
      });
      return;
    }

    if (target.closest("[data-v9-message]")) {
      event.preventDefault();
      return openMessage();
    }

    const vote = target.closest("[data-v9-vote]");
    if (vote) {
      event.preventDefault();
      if (!signedIn()) return toast({ title: "Sign in first", message: "Votes hang from a member account.", iconName: "login" });
      const id = vote.getAttribute("data-v9-vote-id");
      const agree = vote.getAttribute("data-v9-vote") === "1";
      vote.disabled = true;
      try {
        const res = await rpc("post_comment_vote", { p_token: state.token, p_comment_id: Number(id), p_agree: agree });
        if (res && res.ok) {
          const node = root.querySelector(`[data-v9-comment="${id}"]`);
          if (node) {
            const like = node.querySelector("[data-v9-agree]");
            const dislike = node.querySelector("[data-v9-disagree]");
            if (like) like.textContent = num(Number(res.agree) || 0);
            if (dislike) dislike.textContent = num(Number(res.disagree) || 0);
            const mine = res.mine === "agree" ? "1" : res.mine === "disagree" ? "0" : "";
            node.querySelectorAll("[data-v9-vote]").forEach((button) => {
              button.setAttribute("aria-pressed", String(button.getAttribute("data-v9-vote") === mine));
            });
          }
        } else {
          toast({ title: "Not counted", message: res && res.error === "session" ? "Sign in again." : "The server refused that vote.", tone: "error", iconName: "info" });
        }
      } catch (error) {
        toast({ title: "Not counted", message: "This comment cannot be voted on yet.", tone: "error", iconName: "info" });
      } finally {
        vote.disabled = false;
      }
      return;
    }

    const creport = target.closest("[data-v9-creport]");
    if (creport) {
      event.preventDefault();
      if (!signedIn()) return toast({ title: "Sign in first", message: "Reports need a member account.", iconName: "login" });
      const id = creport.getAttribute("data-v9-creport");
      const node = root.querySelector(`[data-v9-comment="${id}"]`);
      const who = (node && node.querySelector(".v9com__name")?.textContent) || "a member";
      const said = (node && node.querySelector(".v9com__text")?.textContent) || "";
      try {
        const res = await rpc("post_report_from", {
          p_token: state.token,
          p_ref: state.code,
          p_reason: "other",
          p_note: `Comment #${id} by ${who}: “${said.slice(0, 160)}”`,
          p_source: "vertical",
        });
        if (res && res.ok) toast({ title: "Report sent", message: "A moderator will look at the comment.", tone: "success", iconName: "flag" });
        else toast({ title: "Not sent", message: "The server refused the report.", tone: "error", iconName: "flag" });
      } catch (error) {
        toast({ title: "Not sent", message: "Reporting is not open on this server yet.", tone: "error", iconName: "flag" });
      }
      return;
    }

    if (target.closest("[data-v9-comment-send]")) {
      event.preventDefault();
      const input = $("[data-v9-comment-input]");
      const body = String((input && input.value) || "").trim();
      if (!body) {
        if (input) input.focus();
        return;
      }
      const btn = target.closest("[data-v9-comment-send]");
      btn.disabled = true;
      try {
        const res = await rpc("post_comment_from", {
          p_token: state.token,
          p_ref: state.code,
          p_body: body,
          p_parent_id: null,
          p_source: "vertical",
        });
        if (res && res.ok) {
          if (input) input.value = "";
          toast({ title: "Comment posted", tone: "success", iconName: "comment", duration: 2400 });
          await loadComments(state.code);
        } else {
          toast({ title: "Not posted", message: res && res.error === "reaction" ? "Like or dislike the video first." : "The server refused the comment.", tone: "error" });
        }
      } catch (error) {
        toast({ title: "Not posted", message: error.message, tone: "error" });
      }
      btn.disabled = false;
    }
  });

  /* the swipe: up for the next one, down for the one before — and the same
     words side to side, because a thumb that moves left means "on". The
     listener sits on the panel, so it survives every redraw; a press that
     starts on a neighbour card is that card's, not a swipe. */
  let start = null;
  root.addEventListener(
    "touchstart",
    (event) => {
      const origin = event.target instanceof Element ? event.target : null;
      if (!origin || !origin.closest("[data-v9-stage]") || origin.closest("[data-v9-side]")) return;
      const touch = event.changedTouches[0];
      start = { x: touch.clientX, y: touch.clientY };
    },
    { passive: true }
  );
  root.addEventListener(
    "touchend",
    (event) => {
      if (!start) return;
      const touch = event.changedTouches[0];
      const dx = touch.clientX - start.x;
      const dy = touch.clientY - start.y;
      start = null;
      if (!(Math.abs(dy) > 60 || Math.abs(dx) > 70)) return;
      if (Math.abs(dy) >= Math.abs(dx)) step(dy < 0 ? 1 : -1);
      else step(dx < 0 ? 1 : -1);
    },
    { passive: true }
  );

  /* the same gesture with a mouse: press the picture, drag it sideways. A
     press that starts on a button, a link or the frame itself is that
     control's — the frame keeps its own pointer, so a drag over it is not
     ours to read. */
  let drag = null;
  root.addEventListener("pointerdown", (event) => {
    if (event.pointerType === "touch" || event.button !== 0) return;
    const origin = event.target instanceof Element ? event.target : null;
    if (!origin || !origin.closest("[data-v9-stage]")) return;
    if (origin.closest("a, button, summary, input, textarea, iframe, video")) return;
    drag = { x: event.clientX, y: event.clientY };
  });
  root.addEventListener("pointerup", (event) => {
    if (!drag) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    drag = null;
    if (Math.abs(dx) < 90 || Math.abs(dx) < Math.abs(dy)) return;
    step(dx < 0 ? 1 : -1);
  });
  root.addEventListener("pointercancel", () => {
    drag = null;
  });
}

function openMessage() {
  if (!signedIn()) return toast({ title: "Sign in first", message: "A message needs a member behind it.", iconName: "login" });
  const box = $("[data-v9-msg-box]");
  if (!box) return;
  const who = blockRef();
  const host = hostOf(state.video);
  const name = (state.hub && state.hub.name) || host.name || host.username || "the publisher";
  box.hidden = false;
  box.innerHTML = `
    <form class="v9msg__form" data-v9-msg-form>
      <p class="v9msg__head">${icon("mail")} A message to ${esc(name)}</p>
      <input class="input" type="text" name="subject" placeholder="The subject" aria-label="Subject" maxlength="120" />
      <textarea class="textarea" rows="4" name="body" placeholder="What would you like to say?" aria-label="The message" maxlength="2000"></textarea>
      <div class="v9msg__acts">
        <button class="btn btn--ghost btn--sm" type="button" data-v9-msg-cancel>Cancel</button>
        <button class="btn btn--primary btn--sm" type="submit">${icon("send")} Send</button>
      </div>
    </form>`;
  const form = $("[data-v9-msg-form]", box);
  box.querySelector("textarea")?.focus();
  box.querySelector("[data-v9-msg-cancel]")?.addEventListener("click", () => {
    box.hidden = true;
    box.innerHTML = "";
  });
  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new window.FormData(form);
    const body = String(data.get("body") || "").trim();
    if (!body) return toast({ title: "Nothing to send", message: "Write a line first.", tone: "error", iconName: "info" });
    if (!who) return toast({ title: "No one to write to", message: "This video named no publisher.", tone: "error", iconName: "info" });
    const submit = form.querySelector('button[type="submit"]');
    if (submit) submit.disabled = true;
    let res = null;
    try {
      res = await rpc("msg_send", {
        p_token: state.token,
        p_ref: who,
        p_subject: String(data.get("subject") || "").trim(),
        p_body: body,
        p_attachments: [],
      });
    } catch (error) {
      toast({ title: "Not sent", message: error.message, tone: "error", iconName: "info" });
    }
    if (submit) submit.disabled = false;
    if (res && res.ok !== false) {
      box.hidden = true;
      box.innerHTML = "";
      toast({ title: "Message sent", message: "It is in their inbox.", tone: "success", iconName: "mail" });
    } else if (res) {
      toast({ title: "Not sent", message: res.error === "session" ? "Sign in again." : "The inbox did not take it.", tone: "error", iconName: "info" });
    }
  });
}

/* the keyboard: the arrows move along the shelf, Escape gives it back */
document.addEventListener("keydown", (event) => {
  if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
  const tag = String(event.target?.tagName || "").toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select" || event.target?.isContentEditable) return;
  if (state.view !== "watch") return;
  const key = String(event.key || "");
  if (key === "ArrowDown" || key === "ArrowRight") {
    event.preventDefault();
    step(1);
  } else if (key === "ArrowUp" || key === "ArrowLeft") {
    event.preventDefault();
    step(-1);
  } else if (key === "Escape") {
    event.preventDefault();
    location.hash = "";
  }
});

/* a member who signs in after the page was read can like, comment and follow */
window.addEventListener("1w:session", () => {
  state.token = sessionToken() || "";
  if (state.view === "watch" && state.video) {
    const panel = $("[data-v9-host]");
    if (panel) panel.outerHTML = hostMarkup(state.video);
    paintComments();
  }
});

/* ================================================================== */
/* routing and boot                                                   */
/* ================================================================== */
async function render() {
  const route = routeOf();
  bindViewer();

  if (route.view === "none") {
    hideVertical();
    return;
  }

  if (route.view === "watch" && route.code) {
    await openWatch(route.code);
    return;
  }

  /* the shelf: the first visit fetches it, a return draws what is in hand */
  showShelf({ scroll: false });
  if (!state.loaded && !state.loading) await loadFeed();
}

async function boot() {
  state.token = sessionToken() || "";
  enableDragScrollAll();
  bindShelf();
  bindViewer();
  window.addEventListener("hashchange", render);
  await render();
}

boot();
