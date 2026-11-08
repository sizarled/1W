/**
 * videos.html — member videos.
 * ------------------------------------------------------------------
 * Two screens in one page:
 *
 *   #/                the feed — search, a field, a sort, and the cards
 *   #/h/ID=<code>     one horizontal video — the player, the publisher, the comments
 *   #/v/ID=<code>     one vertical one — the same page, a portrait stage
 *
 * The address grammar lives in media.js, one module for all four shapes;
 * this page only reads it.
 *
 * Everything comes from the posts layer the rest of the site already
 * uses, so likes, comments and reports stay in one place:
 *
 *   video_feed(token, field, sort, search, limit, offset)
 *   video_get(token, ref, key)          the player, or the locked door
 *   video_mine(token)                   the member's own videos
 *   post_react / post_comments / post_comment / post_reshare / post_report
 *   profile_follow_toggle(token, ref)   following the publisher
 *
 * A video the viewer may not see comes back `locked` — with its title and
 * its thumbnail, never its source. A password unlocks it for that visit.
 */
import { rpc } from "./data.js";
import { qs, qsa, esc, num, compact, timeAgo, debounce } from "./utils.js";
import { icon } from "./icons.js";
import { toast } from "./ui.js";
import { sessionToken, getMember } from "./session.js";
import { parseRoute, videoUrl, orientationOf, creatorUrl, ORIENTATIONS } from "./media.js";

const PAGE = 24;

const state = {
  token: "",
  field: "",
  sort: "popular",
  search: "",
  rows: [],
  fields: [],
  total: 0,
  loaded: 0,
  loading: false,
  seq: 0,
  mine: [],
  /* the watch screen */
  code: "",
  video: null,
  related: [],
  more: [],
  comments: null,
  canComment: false,
  reaction: null,
  key: "",
  orientation: "h",
  /* the studio the video was published into, when it has one */
  hub: null,
  view: "browse",
};

const $ = (sel) => qs(sel);
const browseEl = () => $("[data-v-browse]");
const watchEl = () => $("[data-v-watch]");
const gridEl = () => $("[data-v-grid]");

/* ================================================================== */
/* small helpers                                                      */
/* ================================================================== */
const AGE_LABEL = { none: "", "3": "3+", "6": "6+", "13": "13+", "16": "16+", "18": "18+" };

const VIS_LABEL = {
  general: "Public",
  limited: "Exclusive",
  private: "Private",
  followers: "Followers",
  following: "Following",
  excluded: "Excluded",
  others: "Invited",
};

const LANG_LABEL = {
  ar: "Arabic",
  en: "English",
  fr: "French",
  es: "Spanish",
  de: "German",
  it: "Italian",
  pt: "Portuguese",
  tr: "Turkish",
};

function initial(name = "?") {
  return esc(String(name).replace(/^@/, "").slice(0, 1) || "?");
}

function avatarTag(row, size = "vav") {
  const host = row || {};
  const url = host.avatar || "";
  if (url) {
    return `<img class="${size}" src="${esc(url)}" alt="" width="20" height="20" loading="lazy" decoding="async" />`;
  }
  return `<span class="${size}" aria-hidden="true">${initial(host.name || host.username || "?")}</span>`;
}

function signedIn() {
  return Boolean(state.token && getMember());
}

/** The host list lives in one place now: see assets/js/embed.js. */
import { embedUrl, autoThumb, isFile } from "./embed.js";

export { embedUrl, autoThumb, isFile, sourceKind } from "./embed.js";

function skeleton(count = 8) {
  return Array.from(
    { length: count },
    () => `<div class="vsk" aria-hidden="true"><div class="vsk__media"></div><div class="vsk__line"></div><div class="vsk__line vsk__line--sm"></div></div>`
  ).join("");
}

function emptyState({ title, text, action = "" }) {
  return `
    <div class="vempty">
      <span class="vempty__icon">${icon("video")}</span>
      <h2>${esc(title)}</h2>
      <p>${esc(text)}</p>
      ${action}
    </div>`;
}

/* ================================================================== */
/* cards                                                              */
/* ================================================================== */
function cardMarkup(row) {
  const v = row || {};
  const meta = (v.video && v.video.meta) || {};
  const host = (v.video && v.video.host) || v.publisher || {};
  const counters = v.counters || {};
  const age = AGE_LABEL[meta.age] || "";
  const state =
    v.status && v.status !== "published"
      ? `<span class="badge vcard__state">${v.status === "scheduled" ? "Scheduled" : "Draft"}</span>`
      : "";

  return `
    <a class="vcard" href="${esc(videoUrl(v.code || v.id, v.orientation))}" data-v-open="${esc(v.code || v.id)}" data-orientation="${esc(orientationOf(v.orientation))}">
      <div class="vcard__media">
        ${
          v.thumbnail
            ? `<img src="${esc(v.thumbnail)}" alt="" loading="lazy" decoding="async" />`
            : `<div class="vcard__ph">${icon("film")}</div>`
        }
        <span class="vcard__shade"></span>
        <span class="vcard__tags">
          ${age ? `<span class="badge badge--solid">${esc(age)}</span>` : ""}
          ${v.visibility && v.visibility !== "general" ? `<span class="badge">${esc(VIS_LABEL[v.visibility] || v.visibility)}</span>` : ""}
        </span>
        <span class="vcard__play"><span>${icon("play")}</span></span>
        ${state}
      </div>
      <div class="vcard__body">
        <p class="vcard__title">${esc(v.title || "Untitled")}</p>
        <p class="vcard__host">
          ${avatarTag({ avatar: host.avatar, name: host.name || host.username })}
          <b>${esc(host.name || host.username || "A member")}</b>
        </p>
        <p class="vcard__meta">
          <span>${esc(timeAgo(v.published_at) || "unpublished")}</span>
          <i></i>
          <span>${icon("thumbUp")}${esc(compact(counters.likes || 0))}</span>
          <span>${icon("comment")}${esc(compact(counters.comments || 0))}</span>
          <span>${icon("eye")}${esc(compact(counters.impressions || 0))}</span>
        </p>
      </div>
    </a>`;
}

function rowMarkup(row) {
  const v = row || {};
  return `
    <a class="vrow" href="${esc(videoUrl(v.code || v.id, v.orientation))}" data-v-open="${esc(v.code || v.id)}">
      <span class="vrow__media">
        ${
          v.thumbnail
            ? `<img src="${esc(v.thumbnail)}" alt="" loading="lazy" decoding="async" />`
            : `<span class="vcard__ph">${icon("film")}</span>`
        }
      </span>
      <span class="vrow__body">
        <span class="vrow__title">${esc(v.title || "Untitled")}</span>
        <span class="vrow__meta">${esc(compact((v.counters && v.counters.impressions) || 0))} views</span>
        <span class="vrow__meta">${esc(timeAgo(v.published_at) || "—")}</span>
      </span>
    </a>`;
}

/* ================================================================== */
/* the feed                                                           */
/* ================================================================== */
function renderFields() {
  const host = $("[data-v-fields]");
  if (!host) return;
  const chips = [{ name: "", label: "All fields" }, ...state.fields.map((f) => ({ name: f.name, label: f.name }))];
  host.innerHTML = chips
    .map(
      (f) =>
        `<button class="chip ${state.field.toLowerCase() === f.name.toLowerCase() ? "is-active" : ""}" type="button" data-v-field="${esc(f.name)}">${esc(f.label)}</button>`
    )
    .join("");
}

function renderCount() {
  const host = $("[data-v-count]");
  if (!host) return;
  const total = state.total;
  if (!total) {
    host.textContent = "";
    return;
  }
  host.textContent = `${num(total)} ${total === 1 ? "video" : "videos"}`;
}

function renderGrid({ append = false } = {}) {
  const host = gridEl();
  if (!host) return;
  const html = state.rows.map(cardMarkup).join("");
  if (append) host.insertAdjacentHTML("beforeend", html);
  else host.innerHTML = html;

  const empty = $("[data-v-empty]");
  if (empty) {
    empty.hidden = state.rows.length > 0 || state.loading;
    if (!state.rows.length && !state.loading) {
      const searching = state.search.trim() || state.field;
      empty.innerHTML = searching
        ? emptyState({
            title: "Nothing matches that",
            text: "Try another word, or clear the field to see every video again.",
            action: `<button class="btn btn--ghost btn--sm" type="button" data-v-reset>${icon("refresh")} Clear the filters</button>`,
          })
        : emptyState({
            title: "No videos here yet",
            text: signedIn()
              ? "The feed is empty. Publish the first one — a link, a title and a thumbnail are enough to start."
              : "When members publish a video it lands here. Sign in to publish yours.",
            action: signedIn()
              ? `<a class="btn btn--primary btn--sm" href="video-editor.html">${icon("upload")} Publish a video</a>`
              : `<a class="btn btn--primary btn--sm" href="login.html?next=video-editor.html">${icon("login")} Sign in</a>`,
          });
    }
  }

  const more = $("[data-v-more]");
  if (more) {
    const left = state.total - state.loaded;
    more.innerHTML =
      left > 0 && state.rows.length
        ? `<div style="display:grid;justify-items:center;margin-top:1.2rem">
             <button class="btn btn--ghost" type="button" data-v-load>${icon("chevronDown")} Show more</button>
           </div>`
        : "";
  }
}

async function loadFeed({ append = false } = {}) {
  const seq = ++state.seq;
  state.loading = true;
  if (!append) {
    state.rows = [];
    state.loaded = 0;
    const host = gridEl();
    if (host) host.innerHTML = skeleton(8);
    const empty = $("[data-v-empty]");
    if (empty) empty.hidden = true;
  }
  const more = $("[data-v-more]");
  if (more && !append) more.innerHTML = "";

  let res = null;
  try {
    res = await rpc("video_feed", {
      p_token: state.token,
      p_field: state.field,
      p_sort: state.sort,
      p_search: state.search.trim(),
      p_limit: PAGE,
      p_offset: append ? state.loaded : 0,
    });
  } catch (error) {
    console.warn("[1World] video feed:", error.message);
  }
  if (seq !== state.seq) return;

  state.loading = false;
  if (!res || res.ok !== true) {
    const host = gridEl();
    if (host && !append) {
      host.innerHTML = "";
      const empty = $("[data-v-empty]");
      if (empty) {
        empty.hidden = false;
        empty.innerHTML = emptyState({
          title: "The feed did not answer",
          text: "The server is not reachable from here. Try again in a moment.",
          action: `<button class="btn btn--ghost btn--sm" type="button" data-v-retry>${icon("refresh")} Try again</button>`,
        });
      }
    }
    return;
  }

  const rows = Array.isArray(res.rows) ? res.rows : [];
  state.total = Number(res.total) || rows.length;
  state.rows = append ? state.rows.concat(rows) : rows;
  state.loaded = state.rows.length;
  if (Array.isArray(res.fields)) state.fields = res.fields;

  renderFields();
  renderCount();
  renderGrid({ append });
  return res;
}

async function loadMine() {
  const section = $("[data-v-yours]");
  if (!section) return;
  if (!signedIn()) {
    section.hidden = true;
    return;
  }
  let res = null;
  try {
    res = await rpc("video_mine", { p_token: state.token });
  } catch (error) {
    console.warn("[1World] my videos:", error.message);
  }
  const rows = res && res.ok && Array.isArray(res.rows) ? res.rows : [];
  state.mine = rows;
  if (!rows.length) {
    section.hidden = true;
    return;
  }
  section.hidden = false;
  const shelf = $("[data-v-shelf]", section);
  if (shelf) shelf.innerHTML = rows.slice(0, 12).map(cardMarkup).join("");
  const counts = $("[data-v-yours-count]", section);
  if (counts) counts.textContent = `${rows.length} in your name`;
}

/* ================================================================== */
/* one video                                                          */
/* ================================================================== */
function playerMarkup(v, meta) {
  const src = (v.video && v.video.embed) || v.embed || "";
  if (!src) {
    return `<div class="vplayer"><div class="vplayer__idle"><p class="vplayer__note">This video has no source yet.</p></div></div>`;
  }
  if (isFile(src)) {
    return `<div class="vplayer"><video controls playsinline preload="metadata" poster="${esc(v.thumbnail || "")}" src="${esc(src)}"></video></div>`;
  }
  const src2 = embedUrl(src);
  if (!src2) {
    return `<div class="vplayer"><div class="vplayer__idle"><p class="vplayer__note">This source cannot be shown here.</p></div></div>`;
  }
  return `<div class="vplayer"><iframe src="${esc(src2)}" title="${esc(v.title || "Video")}" loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe></div>`;
}

function lockedMarkup(v) {
  const asks = Boolean(v.asks_password);
  return `
    <div class="vplayer">
      <div class="vplayer__poster" style="${v.thumbnail ? `background-image:url('${esc(v.thumbnail)}')` : ""}"></div>
      <div class="vgate">
        <span class="vgate__icon">${icon(asks ? "key" : "lock")}</span>
        <h2>${asks ? "This one needs a password" : "This one is not for everyone"}</h2>
        <p>${
          asks
            ? "The publisher set a password for this video. Type it once and it opens for this visit."
            : "It belongs to a private or exclusive audience. Ask the publisher, or follow them and try again."
        }</p>
        ${
          asks
            ? `<form class="vgate__form" data-v-key-form>
                 <input class="input" type="password" data-v-key-input autocomplete="off" placeholder="Password" aria-label="Password" />
                 <button class="btn btn--primary" type="submit">${icon("unlock")} Open</button>
               </form>
               <p class="vgate__err" data-v-key-err role="status"></p>`
            : `<a class="btn btn--ghost btn--sm" href="#">${icon("arrowLeft")} Back to the feed</a>`
        }
      </div>
    </div>`;
}

function actionsMarkup(v) {
  const counters = v.counters || {};
  const mine = v.mine || {};
  const meta = (v.video && v.video.meta) || {};
  const reaction = Number(mine.reaction) || 0;
  const canDownload = meta.download && isFile((v.video && v.video.embed) || "");
  return `
    <div class="vacts" data-v-actions>
      <button class="vact" type="button" data-v-react="1" aria-pressed="${reaction === 1}">
        ${icon("thumbUp")} <span>Like</span>
        <span data-v-like>${esc(compact(counters.likes || 0))}</span>
      </button>
      <button class="vact" type="button" data-v-react="-1" aria-pressed="${reaction === -1}">
        ${icon("thumbDown")} <span>Dislike</span>
        <span data-v-dislike>${esc(compact(counters.dislikes || 0))}</span>
      </button>
      <button class="vact" type="button" data-v-goto-comments>
        ${icon("comment")} <span>Comments</span>
        <span data-v-total-comments>${esc(compact(counters.comments || 0))}</span>
      </button>
      <button class="vact" type="button" data-v-share>
        ${icon("share")} <span>${v.mine && v.mine.reshared ? "Reshared" : "Reshare"}</span>
      </button>
      <button class="vact vact--quiet" type="button" data-v-save aria-pressed="false">
        ${icon("bookmark")} <span>Save</span>
      </button>
      ${canDownload ? `<a class="vact vact--quiet" href="${esc((v.video && v.video.embed) || "")}" download>${icon("download")} <span>Download</span></a>` : ""}
      <button class="vact vact--quiet" type="button" data-v-report>${icon("flag")} <span>Report</span></button>
      ${
        v.mine && v.mine.can_manage
          ? `<a class="vact vact--end" href="video-editor.html?id=${esc(v.code || v.id)}">${icon("settings")} <span>Edit</span></a>`
          : ""
      }
    </div>
    <div class="vcard-box" data-v-report-box hidden>
      <div class="vcard-box__head">
        <span class="vcard-box__title">Report this video</span>
        <button class="vact vact--quiet" type="button" data-v-report-cancel>${icon("close")}</button>
      </div>
      <label class="field">
        <span>Why</span>
        <select class="select" data-v-report-reason>
          <option value="copyright">It uses work that is not theirs</option>
          <option value="abuse">It is abusive or violent</option>
          <option value="spam">It is spam</option>
          <option value="misleading">It misleads the viewer</option>
          <option value="other">Something else</option>
        </select>
      </label>
      <textarea class="textarea" rows="3" data-v-report-note maxlength="400" placeholder="What should we know? (optional)"></textarea>
      <div><button class="btn btn--primary btn--sm" type="button" data-v-report-send>${icon("send")} Send the report</button></div>
    </div>`;
}

function commentsMarkup() {
  const data = state.comments || { comments: [], count: 0 };
  const rows = Array.isArray(data.comments) ? data.comments : [];
  const me = getMember();
  const canComment = Boolean(state.canComment);
  const reaction = Number(state.reaction) || 0;

  const composer = !signedIn()
    ? `<div class="vcomposer">
         <p class="vcomposer__note">${icon("user")} <span><a href="login.html?next=${encodeURIComponent(videoUrl(state.code, state.orientation))}">Sign in</a> to join the conversation.</span></p>
       </div>`
    : !canComment
      ? `<div class="vcomposer">
           <p class="vcomposer__note">${icon("info")} <span>Like or dislike the video first — then you can comment. That is the rule everywhere on 1World.</span></p>
         </div>`
      : `<div class="vcomposer">
           <textarea class="textarea" rows="3" data-v-comment-input maxlength="4000" placeholder="Add a comment"></textarea>
           <div class="vcomposer__row">
             <span class="vcomposer__note" data-v-comment-state>${icon("user")} <span>${esc((me && (me.name || me.username)) || "You")}${reaction ? " · you reacted" : ""}</span></span>
             <button class="btn btn--primary btn--sm" type="button" data-v-comment-send>${icon("send")} Post</button>
           </div>
         </div>`;

  return `
    <section class="vsect" id="comments">
      <div class="vcom__head">
        <h2 class="vcom__title">Comments <span class="vcount" data-v-comment-count>${esc(num(data.count || rows.length))}</span></h2>
        <span class="vcom__hint">${canComment ? "You can comment on this one." : "Reactions unlock commenting."}</span>
      </div>
      ${composer}
      <div class="vcom__list" data-v-comment-list>
        ${
          rows.length
            ? rows
                .map(
                  (c) => `
          <article class="vcom">
            ${
              c.author && c.author.avatar
                ? `<img class="vcom__av" src="${esc(c.author.avatar)}" alt="" width="34" height="34" loading="lazy" />`
                : `<span class="vcom__av vav" aria-hidden="true">${initial((c.author && (c.author.name || c.author.username)) || "?")}</span>`
            }
            <div class="vcom__body">
              <div class="vcom__top">
                <span class="vcom__name">${esc((c.author && (c.author.name || c.author.username)) || "A member")}</span>
                <span class="vcom__time">${esc(timeAgo(c.created_at))}${c.edited ? " · edited" : ""}</span>
              </div>
              <p class="vcom__text">${esc(c.body || "")}</p>
            </div>
          </article>`
                )
                .join("")
            : `<p class="vcom__hint" style="padding:1rem .35rem">No comments yet${canComment ? " — say the first thing." : "."}</p>`
        }
      </div>
    </section>`;
}

function watchMarkup(v, res) {
  const meta = (v.video && v.video.meta) || {};
  const host = (v.video && v.video.host) || v.publisher || {};
  const counters = v.counters || {};
  const tags = Array.isArray(v.keywords) ? v.keywords.filter((k) => k.role === "main") : [];
  const age = AGE_LABEL[meta.age] || "";
  const lang = LANG_LABEL[v.language] || (v.language ? String(v.language).toUpperCase() : "");
  const desc = String(v.description || "").trim();
  const chapters = chaptersOf(desc, meta);
  /* the studio's own links, under the video that studio published */
  const links = (state.hub && Array.isArray(state.hub.links) ? state.hub.links : [])
    .map((link) => ({
      label: String(link.label || link.name || "Link").trim(),
      url: String(link.url || "").trim(),
      icon: iconForLink(link.url),
    }))
    .filter((link) => link.url && link.label);

  return `
    <div class="vwatch" data-orientation="${state.orientation}">
      <div class="vwatch__main">
        <div class="vback-row">
          <a class="vback" href="${esc(state.hub && state.hub.name ? creatorUrl(state.hub.code || state.hub.id, state.hub.creator || host.id) : "#")}" data-v-studio-back ${state.hub && state.hub.name ? "" : "hidden"}>${icon("arrowLeft")} Back to the ${esc(hubKindWord(state.hub && state.hub.kind).toLowerCase())}</a>
          <a class="vback" href="#" data-v-back>${icon("film")} All videos</a>
        </div>

        ${res.locked ? lockedMarkup(res.video) : playerMarkup(v, meta)}

        <div>
          <h1 class="vtitle">${esc(v.title || "Untitled")}</h1>
          <p class="vmeta" style="margin-top:.5rem">
            <span>${esc(compact(counters.impressions || 0))} views</span>
            <i></i>
            <span>${esc(timeAgo(v.published_at) || "unpublished")}</span>
            ${lang ? `<i></i><span>${esc(lang)}</span>` : ""}
            ${age ? `<i></i><span>${esc(age)}</span>` : ""}
            ${v.minutes ? `<i></i><span>${esc(num(Number(v.minutes) || 0))} minutes</span>` : ""}
            <i></i>
            <span>${esc(VIS_LABEL[v.visibility] || "Public")}</span>
            ${v.status && v.status !== "published" ? `<i></i><span>${esc(v.status === "scheduled" ? `scheduled for ${new Date(v.scheduled_at).toLocaleString()}` : v.status)}</span>` : ""}
          </p>
        </div>

        ${res.locked ? "" : actionsMarkup(v)}

        ${
          chapters.length
            ? `<ol class="vchaps" data-v-chapters>
                 ${chapters
                   .map(
                     (row) => `<li class="vchaps__row">
                       <button class="vchaps__btn" type="button" data-v-chapter="${row.start}" title="Jump to ${esc(stamp(row.start))}">
                         <span class="vchaps__n">${esc(String(row.n).padStart(2, "0"))}</span>
                         <span class="vchaps__label">${esc(row.label)}</span>
                         <span class="vchaps__time">${esc(stamp(row.start))}</span>
                       </button>
                     </li>`
                   )
                   .join("")}
               </ol>`
            : ""
        }

        <div class="vhost"${state.hub && state.hub.name ? ' data-v-host="studio"' : ' data-v-host="member"'}>
          ${
            /* a video published into a studio is published by the studio: its
               logo, its name and its code lead, and the member is the line
               under it — the profile is still one click away */
            state.hub && state.hub.name
              ? `<a class="vhost__logo" href="${esc(creatorUrl(state.hub.code || state.hub.id, state.hub.creator || host.id))}" data-v-studio="${esc(state.hub.code || "")}" aria-label="${esc(state.hub.name)}">
                   ${state.hub.logo_url ? `<img src="${esc(state.hub.logo_url)}" alt="" width="48" height="48" />` : `<span aria-hidden="true">${esc(initialsOf(state.hub.name))}</span>`}
                 </a>`
              : avatarTag({ avatar: host.avatar, name: host.name || host.username }, "vav vav--lg")
          }
          <div class="vhost__id">
            ${
              state.hub && state.hub.name
                ? `<p class="vhost__name"><a href="${esc(creatorUrl(state.hub.code || state.hub.id, state.hub.creator || host.id))}">${esc(state.hub.name)}</a></p>
                   <p class="vhost__meta"><span class="vhost__kind">${esc(hubKindWord(state.hub.kind))}</span>${state.hub.code ? ` · ${esc(state.hub.code)}` : ""} · by <a href="${esc(creatorUrl("", host.id))}">${esc(host.name || host.username || "a member")}</a></p>
                   <p class="vhost__stats">
                     ${state.hub.subscribers != null ? `<span><b>${esc(compact(Number(state.hub.subscribers) || 0))}</b> subscribers</span>` : ""}
                     ${state.hub.published != null ? `<span><b>${esc(num(Number(state.hub.published) || 0))}</b> releases</span>` : ""}
                   </p>`
                : `<p class="vhost__name">${esc(host.name || host.username || "A member")}</p>
                   <p class="vhost__meta">${host.username ? esc(host.username) + " · " : ""}${esc(num(host.followers || 0))} followers</p>`
            }
          </div>
          <div class="vhost__acts">
            ${
              signedIn() && host.id === (getMember() || {}).id
                ? ""
                : state.hub && state.hub.name
                  ? `<button class="btn btn--primary btn--sm" type="button" data-v-subscribe="${esc(state.hub.id || "")}" aria-pressed="${state.hub.subscribed ? "true" : "false"}">${icon(state.hub.subscribed ? "check" : "plus")} ${state.hub.subscribed ? "Subscribed" : "Subscribe"}</button>`
                  : `<button class="btn btn--ghost btn--sm" type="button" data-v-follow>${icon("plus")} Follow</button>`
            }
            ${
              state.hub && state.hub.name
                ? `<details class="vmenu" data-v-actions>
                     <summary class="btn btn--ghost btn--sm">${icon("dots")} Take action</summary>
                     <div class="vmenu__panel">
                       <button class="vmenu__item" type="button" data-v-follow>${icon("user")} Follow the creator</button>
                       <button class="vmenu__item" type="button" data-v-join>${icon("users")} Join the ${esc(hubKindWord(state.hub.kind).toLowerCase())}</button>
                       <button class="vmenu__item" type="button" data-v-message>${icon("mail")} Message</button>
                       <button class="vmenu__item" type="button" data-v-share>${icon("share")} Share</button>
                       <button class="vmenu__item" type="button" data-v-copy>${icon("link")} Copy the link</button>
                       <button class="vmenu__item" type="button" data-v-report>${icon("flag")} Report</button>
                       <button class="vmenu__item vmenu__item--danger" type="button" data-v-block>${icon("close")} Block</button>
                     </div>
                   </details>`
                : ""
            }
          </div>
        </div>

        ${state.hub && state.hub.description ? `<p class="vhost__bio">${esc(state.hub.description)}</p>` : ""}

        ${
          links.length
            ? `<div class="vlinks" data-v-links>
                 <span class="vlinks__head">Related links</span>
                 <div class="vlinks__row">
                   ${links.map((link) => `<a class="chip" href="${esc(link.url)}" target="_blank" rel="noopener noreferrer">${icon(link.icon || "link")}${esc(link.label)}</a>`).join("")}
                   ${state.hub && state.hub.name ? `<a class="chip" href="${esc(creatorUrl(state.hub.code || state.hub.id, state.hub.creator || host.id))}" data-v-studio-link>${icon("bookmark")}Playlists</a>` : ""}
                 </div>
               </div>`
            : ""
        }

        ${
          desc
            ? `<div class="vdesc">
                 <p class="vdesc__body is-clamped" data-v-desc>${esc(desc)}</p>
                 <button class="vdesc__more" type="button" data-v-desc-toggle>Show more</button>
               </div>`
            : ""
        }

        ${
          tags.length
            ? `<div class="vtags">
                 ${tags.map((k) => `<button class="chip" type="button" data-v-tag="${esc(k.keyword)}">${esc(k.keyword)}</button>`).join("")}
               </div>`
            : ""
        }

        <div data-v-msg-box hidden></div>

        ${res.locked ? "" : commentsMarkup()}
      </div>

      <aside class="vwatch__side">
        ${
          state.related.length
            ? `<div class="vcard-box">
                 <div class="vcard-box__head"><span class="vcard-box__title">Related</span></div>
                 <div style="display:grid;gap:.15rem">${state.related.slice(0, 8).map(rowMarkup).join("")}</div>
               </div>`
            : ""
        }
        ${
          state.more.length
            ? `<div class="vcard-box">
                 <div class="vcard-box__head">
                   <span class="vcard-box__title">More from ${esc(host.name || host.username || "this member")}</span>
                 </div>
                 <div style="display:grid;gap:.15rem">${state.more.slice(0, 8).map(rowMarkup).join("")}</div>
               </div>`
            : ""
        }
      </aside>
    </div>`;
}

async function openWatch(code, orientation) {
  const host = watchEl();
  if (!host) return;
  if (!code) {
    showBrowse();
    return;
  }
  state.view = "watch";
  state.code = code;
  state.orientation = orientationOf(orientation);
  state.hub = null;
  state.comments = null;
  state.canComment = false;
  state.reaction = null;
  if (browseEl()) browseEl().hidden = true;
  host.hidden = false;
  host.innerHTML = `<div class="vwatch" data-orientation="${state.orientation}"><div class="vwatch__main">
      <div class="vsk" style="aspect-ratio:16/9"></div>
      <div class="vsk" style="height:120px"></div>
    </div></div>`;
  window.scrollTo({ top: 0, behavior: "auto" });

  /* the studio travels beside the video: one call each, neither waits */
  const hubPromise = rpc("video_hub", { p_ref: code }).catch(() => null);

  let res = null;
  try {
    res = await rpc("video_get", { p_token: state.token, p_ref: code, p_key: state.key });
  } catch (error) {
    console.warn("[1World] video:", error.message);
  }

  if (!res || res.ok !== true) {
    host.innerHTML = `<div class="vwatch" data-orientation="${state.orientation}"><div class="vwatch__main">
        <a class="vback" href="#" data-v-back>${icon("arrowLeft")} All videos</a>
        ${emptyState({
          title: res && res.error === "not_found" ? "That video is gone" : "The video did not load",
          text:
            res && res.error === "not_found"
              ? "The link may be old, or the publisher deleted it."
              : "The server is not reachable from here. Try again in a moment.",
        })}
      </div></div>`;
    bindWatch();
    return;
  }

  /* the studio that published it — from the reply when it carries one, from
     the call beside it otherwise, and from the member's own studio when the
     video was saved before `posts.hub_id` existed */
  const hubReply = await hubPromise;
  const inline = (res && (res.hub || (res.video && res.video.hub))) || null;
  state.hub = inline && inline.name ? inline : hubReply && hubReply.ok && hubReply.hub && hubReply.hub.name ? hubReply.hub : null;
  if (!state.hub) state.hub = await studioOfMember(res.video || {});
  state.video = res.video || null;
  state.related = Array.isArray(res.related) ? res.related : [];
  state.more = Array.isArray(res.more) ? res.more : [];
  state.key = "";

  host.innerHTML = `<div class="vwatch" data-orientation="${state.orientation}"><div class="vwatch__main">
      <div class="vsk" style="aspect-ratio:16/9"></div>
    </div></div>`;

  if (res.locked) {
    state.comments = { comments: [], count: 0 };
    host.innerHTML = watchMarkup(res.video, res);
    document.title = `${(res.video && res.video.title) || "Video"} — 1World Web`;
    bindWatch();
    return;
  }

  const v = res.video || {};
  state.reaction = (v.mine && Number(v.mine.reaction)) || 0;
  state.canComment = state.reaction !== 0;
  host.innerHTML = watchMarkup(v, res);
  document.title = `${v.title || "Video"} — 1World Web`;
  const descEl = $("[data-v-desc]");
  if (descEl && descEl.scrollHeight <= descEl.clientHeight + 4) {
    const toggle = $("[data-v-desc-toggle]");
    if (toggle) toggle.hidden = true;
    descEl.classList.remove("is-clamped");
  }
  paintBlockState();
  const saveBtn = $("[data-v-save]");
  if (saveBtn) {
    const saved = savedSet().has(v.code || v.id);
    saveBtn.setAttribute("aria-pressed", String(saved));
  }
  bindWatch();
  loadComments(v.code || v.id);
}

function showBrowse() {
  state.view = "browse";
  state.code = "";
  const host = watchEl();
  if (host) {
    host.hidden = true;
    host.innerHTML = "";
  }
  if (browseEl()) browseEl().hidden = false;
  document.title = "Videos — 1World Web";
}

/**
 * The studio a member publishes into, when the video carries none.
 *
 * A video saved before `posts.hub_id` existed has no studio on its row, and
 * the publisher line must still name the studio rather than a bare profile:
 * one call asks which studio this member runs. If they run none, the page
 * keeps the member's face and follower count, which is the honest answer.
 */
async function studioOfMember(video) {
  /* the same two places watchMarkup reads the publisher from */
  const host = (video && video.video && video.video.host) || (video && video.host) || (video && video.publisher) || {};
  const ref = host.username || host.id || "";
  if (!ref) return null;
  try {
    const res = await rpc("creator_studio", { p_ref: String(ref) });
    if (res && res.ok && res.hub && res.hub.name) return res.hub;
  } catch {
    /* the call is not there yet — the second door below still answers */
  }
  /* the same answer from the call the creator page already makes: the
     member's public page carries the hubs they run */
  try {
    const res = await rpc("creator_public", { p_token: state.token, p_ref: String(ref) });
    const hubs = res && res.ok && Array.isArray(res.hubs) ? res.hubs : [];
    const pick =
      hubs.find((hub) => hub.kind === "channel" && hub.visibility !== "private") ||
      hubs.find((hub) => (hub.kind === "server" || hub.kind === "cinema") && hub.visibility !== "private") ||
      null;
    if (pick) return { ...pick, creator: (res.creator && res.creator.code) || "" };
  } catch {
    /* no studio to name — the member stays the publisher */
  }
  return null;
}

/** The watch page's own address, on the clipboard. */
async function copyVideoLink(url) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(url);
      return toast({ title: "Link copied", message: url, iconName: "link" });
    }
  } catch {
    /* the clipboard is closed — the link is still shown below */
  }
  return toast({ title: "The link", message: url, iconName: "link" });
}

/** A link's own mark, from where it points. */
function iconForLink(url) {
  const href = String(url || "").toLowerCase();
  if (href.includes("youtube") || href.includes("youtu.be")) return "play";
  if (href.includes("instagram")) return "image";
  if (href.includes("twitter") || href.includes("//x.com")) return "send";
  if (href.includes("playlist")) return "bookmark";
  if (href.includes("t.me") || href.includes("telegram")) return "send";
  return "globe";
}

/** seconds → 0:00 / 1:02:03 */
function stamp(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = String(total % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

/** "0:37" / "1:02:03" → seconds */
function secondsOf(text) {
  const parts = String(text || "").split(":").map((part) => Number(part));
  if (parts.some((part) => Number.isNaN(part))) return 0;
  return parts.reduce((total, part) => total * 60 + part, 0);
}

/**
 * The chapters a description already carries.
 *
 * A member writes `(0:37 - 14:00)` after the name of the passage, or a
 * plain `00:00 Introduction`; both are read here, in the order they
 * appear, and never invented: a line without a time is prose, not a
 * chapter, and a description with no time in it produces no chapter list.
 */
function chaptersOf(desc, meta) {
  const declared = Array.isArray(meta && meta.chapters) ? meta.chapters : [];
  if (declared.length) {
    return declared
      .map((row, index) => ({
        n: index + 1,
        label: String(row.label || row.title || "").trim(),
        start: secondsOf(row.start || row.time),
      }))
      .filter((row) => row.label && row.start >= 0);
  }
  const lines = String(desc || "").split(/\r?\n/);
  const out = [];
  const range = /(\d{1,2}:\d{2}(?::\d{2})?)\s*(?:[-–—]|to)\s*(\d{1,2}:\d{2}(?::\d{2})?)/;
  const lead = /^\s*(\d{1,2}:\d{2}(?::\d{2})?)\s*[-–—:·]?\s*(.+)$/;
  lines.forEach((line) => {
    const text = line.trim();
    if (!text) return;
    const span = text.match(range);
    if (span) {
      /* the passage is named before its time: "… comedies: (0:37 - 14:00) …" */
      const label = text.split(/[:：]/)[0].replace(/\(.*$/, "").trim();
      if (label && label.length < 90) out.push({ label, start: secondsOf(span[1]) });
      return;
    }
    const head = text.match(lead);
    if (head && /[a-z\u0600-\u06ff]/i.test(head[2])) out.push({ label: head[2].trim(), start: secondsOf(head[1]) });
  });
  return out
    .sort((a, b) => a.start - b.start)
    .map((row, index) => ({ ...row, n: index + 1 }));
}

/** "Studio One" → "SO" — the letters a logo-less studio stands on. */
function initialsOf(name) {
  return String(name || "")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0] || "")
    .join("")
    .toUpperCase();
}

/** The word a hub kind is called by, on the page. */
function hubKindWord(kind) {
  return (
    {
      channel: "Studio",
      server: "Server",
      cinema: "Cinema",
      blog: "Blog",
      space: "Space",
      library: "Library",
      gallery: "Gallery",
    }[String(kind || "").toLowerCase()] || "Studio"
  );
}

function route() {
  const next = parseRoute(location.hash);
  if (next.surface === "videos" && next.id) openWatch(next.id, next.orientation || "h");
  else showBrowse();
}

/* ================================================================== */
/* the member's own saved list (device only)                          */
/* ================================================================== */
const SAVED_KEY = "1w.videos.saved";

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

/* ================================================================== */
/* blocked on this device                                             */
/* ================================================================== */
const BLOCKED_KEY = "1w.videos.blocked";

function blockedSet() {
  try {
    const raw = JSON.parse(localStorage.getItem(BLOCKED_KEY) || "[]");
    return new Set(Array.isArray(raw) ? raw : []);
  } catch {
    return new Set();
  }
}

/** The member who publishes this video — the studio's owner, or the host. */
function blockRef() {
  const host = (state.video && state.video.video && state.video.video.host) || state.video?.publisher || {};
  return String((state.hub && state.hub.creator) || host.id || host.username || "");
}

/** The card says when it is blocked, and the menu offers the way back. */
function paintBlockState() {
  const btn = qs("[data-v-block]");
  const who = blockRef();
  if (!btn || !who) return;
  const on = blockedSet().has(who);
  btn.innerHTML = `${icon(on ? "check" : "close")} ${on ? "Unblock" : "Block"}`;
  btn.classList.toggle("is-on", on);
  const card = qs(".vhost");
  if (card) card.classList.toggle("is-blocked", on);
}

/* ================================================================== */
/* a message to the publisher                                         */
/* ================================================================== */
function openMessageDialog() {
  if (!signedIn()) {
    return toast({ title: "Sign in first", message: "A message needs a member behind it.", iconName: "login" });
  }
  const who = blockRef();
  const name = (state.hub && state.hub.name) || (state.video?.video?.host || {}).name || "the publisher";
  const box = qs("[data-v-msg-box]");
  if (box === null) return;
  box.hidden = false;
  box.innerHTML = `
    <dialog class="vmsg" data-v-msg-dialog open>
      <form class="vmsg__form" data-v-msg-form>
        <p class="vmsg__head">${icon("mail")} A message to ${esc(name)}</p>
        <input class="input" type="text" name="subject" placeholder="The subject" aria-label="Subject" maxlength="120" />
        <textarea class="textarea" rows="4" name="body" placeholder="What would you like to say?" aria-label="The message" maxlength="2000"></textarea>
        <p class="vmsg__note" data-v-msg-note>It lands in their inbox${who ? ` (${esc(who)})` : ""}.</p>
        <div class="vmsg__acts">
          <button class="btn btn--ghost btn--sm" type="button" data-v-msg-cancel>Cancel</button>
          <button class="btn btn--primary btn--sm" type="submit">${icon("send")} Send</button>
        </div>
      </form>
    </dialog>`;
  box.querySelector("textarea")?.focus();
}

async function sendMessage(form) {
  const who = blockRef();
  const data = new window.FormData(form);
  const body = String(data.get("body") || "").trim();
  if (!who) return toast({ title: "No one to write to", message: "This video named no publisher.", tone: "error", iconName: "info" });
  if (!body) return toast({ title: "Nothing to send", message: "Write a line first.", tone: "error", iconName: "info" });
  const button = form.querySelector('button[type="submit"]');
  if (button) button.disabled = true;
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
  if (button) button.disabled = false;
  if (res && res.ok !== false) {
    const box = qs("[data-v-msg-box]");
    if (box) {
      box.hidden = true;
      box.innerHTML = "";
    }
    return toast({ title: "Message sent", message: "It is in their inbox.", tone: "success", iconName: "mail" });
  }
  if (res) toast({ title: "Not sent", message: res.error === "session" ? "Sign in again." : "The inbox did not take it.", tone: "error", iconName: "info" });
}

/* ================================================================== */
/* comments                                                           */
/* ================================================================== */
function paintComments() {
  const section = $(".vwatch__main #comments");
  if (!section) return;
  const wrap = document.createElement("div");
  wrap.innerHTML = commentsMarkup();
  section.replaceWith(wrap.firstElementChild);
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
  state.reaction = res.reaction;
  paintComments();
}

/* ================================================================== */
/* events                                                             */
/* ================================================================== */
function bindFeed() {
  const search = $("[data-v-search]");
  if (search) {
    search.value = state.search;
    search.addEventListener(
      "input",
      debounce((event) => {
        state.search = event.target.value || "";
        loadFeed();
      }, 260)
    );
  }

  const sort = $("[data-v-sort]");
  if (sort) {
    sort.addEventListener("click", (event) => {
      const btn = event.target.closest("[data-sort]");
      if (!btn) return;
      state.sort = btn.getAttribute("data-sort");
      qsa("[data-sort]", sort).forEach((b) => {
        const on = b === btn;
        b.classList.toggle("is-active", on);
        b.setAttribute("aria-selected", String(on));
      });
      loadFeed();
    });
  }

  document.addEventListener("click", (event) => {
    const field = event.target.closest("[data-v-field]");
    if (field) {
      state.field = field.getAttribute("data-v-field") || "";
      renderFields();
      loadFeed();
      return;
    }
    if (event.target.closest("[data-v-load]")) {
      loadFeed({ append: true });
      return;
    }
    if (event.target.closest("[data-v-reset]")) {
      state.search = "";
      state.field = "";
      const input = $("[data-v-search]");
      if (input) input.value = "";
      renderFields();
      loadFeed();
      return;
    }
    if (event.target.closest("[data-v-retry]")) {
      loadFeed();
    }
  });

  window.addEventListener("hashchange", route);
}

function bindWatch() {
  const root = watchEl();
  if (!root) return;

  root.onsubmit = (event) => {
    const form = event.target.closest("[data-v-msg-form]");
    if (!form) return;
    event.preventDefault();
    sendMessage(form);
  };
  root.onclick = async (event) => {
    /* join the studio — the menu item and the card's button are the same door */
    const join = event.target.closest("[data-v-join]");
    if (join) {
      event.preventDefault();
      const cardBtn = $("[data-v-subscribe]");
      if (cardBtn) return cardBtn.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
      return;
    }

    /* a message to the person behind the studio */
    const messageBtn = event.target.closest("[data-v-message]");
    if (messageBtn) {
      event.preventDefault();
      return openMessageDialog();
    }
    const messageCancel = event.target.closest("[data-v-msg-cancel]");
    if (messageCancel) {
      event.preventDefault();
      const box = qs("[data-v-msg-box]");
      if (box) {
        box.hidden = true;
        box.innerHTML = "";
      }
      return;
    }

    /* block: this device stops showing what they publish */
    const blockBtn = event.target.closest("[data-v-block]");
    if (blockBtn) {
      event.preventDefault();
      const who = blockRef();
      if (!who) return;
      const set = blockedSet();
      if (set.has(who)) set.delete(who);
      else set.add(who);
      try {
        localStorage.setItem(BLOCKED_KEY, JSON.stringify([...set]));
      } catch {
        /* storage blocked — the card still says what happened for this visit */
      }
      paintBlockState();
      return toast({
        title: set.has(who) ? "Blocked on this device" : "Unblocked",
        message: set.has(who) ? "Their videos are hidden from you here. Nothing was reported." : "Their videos are back in your lists.",
        iconName: set.has(who) ? "close" : "check",
      });
    }

    /* subscribing to the studio, from the card that published the video */
    const subscribe = event.target.closest("[data-v-subscribe]");
    if (subscribe) {
      event.preventDefault();
      if (!signedIn()) {
        return toast({ title: "Sign in first", message: "A subscription hangs from a member.", iconName: "login" });
      }
      const hubId = subscribe.getAttribute("data-v-subscribe") || "";
      if (!hubId) return toast({ title: "This studio cannot be reached", message: "Its code did not come back with the video.", tone: "error", iconName: "info" });
      subscribe.disabled = true;
      try {
        const res = await rpc("creator_subscribe", { p_token: state.token, p_hub: hubId });
        if (res && res.ok) {
          const on = Boolean(res.subscribed);
          if (state.hub) {
            state.hub.subscribed = on;
            if (res.subscribers != null) state.hub.subscribers = res.subscribers;
          }
          subscribe.innerHTML = `${icon(on ? "check" : "plus")} ${on ? "Subscribed" : "Subscribe"}`;
          subscribe.setAttribute("aria-pressed", String(on));
          /* the count on the card moves with it */
          const count = $(".vhost__stats b");
          if (count && res.subscribers != null) count.textContent = compact(Number(res.subscribers) || 0);
          toast({
            title: on ? "You follow this studio" : "You left this studio",
            message: res.subscribers != null ? `${num(Number(res.subscribers) || 0)} subscribers` : "",
            tone: "success",
            iconName: "users",
          });
        } else {
          const reason = (res && res.error) || "server";
          toast({
            title: reason === "own" ? "This is your studio" : "It did not take",
            message: reason === "own" ? "You publish here already." : reason === "session" ? "Sign in again to subscribe." : "The server did not answer.",
            tone: "error",
            iconName: "info",
          });
        }
      } catch (error) {
        toast({ title: "The server refused it", message: error.message, tone: "error", iconName: "info" });
      }
      subscribe.disabled = false;
      return;
    }

    /* share and copy, from the same menu */
    const shareBtn = event.target.closest("[data-v-share]");
    if (shareBtn) {
      event.preventDefault();
      const url = `${location.origin || ""}${location.pathname}${videoUrl(state.code, state.orientation).replace(/^videos\.html/, "")}`;
      if (navigator.share) {
        try {
          await navigator.share({ title: (state.video && state.video.title) || "A video", url });
          return;
        } catch {
          /* the sheet was closed — the copy below is the fallback */
        }
      }
      return copyVideoLink(url);
    }
    const copyBtn = event.target.closest("[data-v-copy]");
    if (copyBtn) {
      event.preventDefault();
      const url = `${location.origin || ""}${location.pathname}${videoUrl(state.code, state.orientation).replace(/^videos\.html/, "")}`;
      return copyVideoLink(url);
    }

    /* a chapter is a place in the file: jump, or say the frame is not ours */
    const chapter = event.target.closest("[data-v-chapter]");
    if (chapter) {
      event.preventDefault();
      const seconds = Number(chapter.getAttribute("data-v-chapter")) || 0;
      const media = root.querySelector("video");
      if (media) {
        try {
          media.currentTime = seconds;
          const played = media.play();
          if (played && played.catch) played.catch(() => {});
        } catch {
          /* the browser refused the seek; the label below still says where */
        }
        return;
      }
      return toast({
        title: stamp(seconds),
        message: "This source plays in its own frame, so the track changes inside it.",
        iconName: "clock",
      });
    }

    const open = event.target.closest("[data-v-open]");
    if (open) {
      /* let the hash change do the work, but keep it snappy */
      return;
    }

    if (event.target.closest("[data-v-back]")) {
      event.preventDefault();
      location.hash = "";
      return;
    }

    const reactBtn = event.target.closest("[data-v-react]");
    if (reactBtn) {
      const want = Number(reactBtn.getAttribute("data-v-react"));
      const now = Number(state.reaction) || 0;
      const value = now === want ? 0 : want;
      if (!signedIn()) {
        toast({ title: "Sign in first", message: "Reactions need a member account.", tone: "error", iconName: "user" });
        return;
      }
      reactBtn.disabled = true;
      let res = null;
      try {
        res = await rpc("post_react", { p_token: state.token, p_ref: state.code, p_value: value });
      } catch (error) {
        toast({ title: "That did not go through", message: error.message, tone: "error" });
      }
      reactBtn.disabled = false;
      if (res && res.ok) {
        const wasNone = !Number(state.reaction);
        state.reaction = Number(res.reaction) || 0;
        state.canComment = state.canComment || state.reaction !== 0;
        const like = $("[data-v-like]");
        const dislike = $("[data-v-dislike]");
        if (like) like.textContent = compact(res.likes || 0);
        if (dislike) dislike.textContent = compact(res.dislikes || 0);
        qsa("[data-v-react]", root).forEach((b) => {
          b.setAttribute("aria-pressed", String(Number(b.getAttribute("data-v-react")) === state.reaction));
        });
        if (state.reaction !== 0 && wasNone) paintComments();
      }
      return;
    }

    if (event.target.closest("[data-v-goto-comments]")) {
      const target = $("#comments");
      if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }

    if (event.target.closest("[data-v-share]")) {
      const url = `${location.origin}${location.pathname}${videoUrl(state.code, state.orientation).replace(/^videos\.html/, "")}`;
      if (signedIn()) {
        rpc("post_reshare", { p_token: state.token, p_ref: state.code }).then((res) => {
          if (res && res.ok) toast({ title: res.reshared ? "Reshared to your feed" : "Reshare taken back", tone: "success", iconName: "share" });
        }).catch(() => {});
      }
      try {
        if (navigator.share) await navigator.share({ title: (state.video && state.video.title) || "Video", url });
        else {
          await navigator.clipboard.writeText(url);
          toast({ title: "Link copied", message: url, tone: "success", iconName: "link" });
        }
      } catch {
        /* the member closed the sheet */
      }
      return;
    }

    if (event.target.closest("[data-v-save]")) {
      const btn = event.target.closest("[data-v-save]");
      const on = toggleSaved(state.code);
      btn.setAttribute("aria-pressed", String(on));
      toast({
        title: on ? "Saved for later" : "Removed from your list",
        message: "Saved on this device, next to the rest of your reading list.",
        tone: "info",
        iconName: "bookmark",
        duration: 3200,
      });
      return;
    }

    if (event.target.closest("[data-v-desc-toggle]")) {
      const body = $("[data-v-desc]");
      const btn = event.target.closest("[data-v-desc-toggle]");
      if (!body) return;
      const clamped = body.classList.toggle("is-clamped");
      btn.textContent = clamped ? "Show more" : "Show less";
      return;
    }

    if (event.target.closest("[data-v-report]")) {
      const box = $("[data-v-report-box]");
      if (box) box.hidden = false;
      return;
    }
    if (event.target.closest("[data-v-report-cancel]")) {
      const box = $("[data-v-report-box]");
      if (box) box.hidden = true;
      return;
    }
    if (event.target.closest("[data-v-report-send]")) {
      if (!signedIn()) {
        toast({ title: "Sign in first", message: "Reports need a member account.", tone: "error", iconName: "user" });
        return;
      }
      const reason = ($("[data-v-report-reason]") || {}).value || "other";
      const note = ($("[data-v-report-note]") || {}).value || "";
      try {
        const res = await rpc("post_report", { p_token: state.token, p_ref: state.code, p_reason: reason, p_note: note });
        if (res && res.ok) {
          toast({ title: "Report sent", message: "A moderator will look at it.", tone: "success", iconName: "flag" });
          const box = $("[data-v-report-box]");
          if (box) box.hidden = true;
        } else {
          toast({ title: "Not sent", message: "The server refused the report.", tone: "error" });
        }
      } catch (error) {
        toast({ title: "Not sent", message: error.message, tone: "error" });
      }
      return;
    }

    if (event.target.closest("[data-v-follow]")) {
      const btn = event.target.closest("[data-v-follow]");
      const host = (state.video && state.video.video && state.video.video.host) || {};
      if (!signedIn()) {
        return toast({ title: "Sign in first", message: "Following hangs from a member.", iconName: "login" });
      }
      btn.disabled = true;
      try {
        const res = await rpc("profile_follow_toggle", { p_token: state.token, p_ref: host.id || host.username || "" });
        if (res && res.ok) {
          btn.innerHTML = `${icon(res.following ? "check" : "plus")} ${res.following ? (res.status === "pending" ? "Requested" : "Following") : "Follow"}`;
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

    if (event.target.closest("[data-v-comment-send]")) {
      const input = $("[data-v-comment-input]");
      const body = String((input && input.value) || "").trim();
      if (!body) {
        if (input) input.focus();
        return;
      }
      const btn = event.target.closest("[data-v-comment-send]");
      btn.disabled = true;
      try {
        const res = await rpc("post_comment", { p_token: state.token, p_ref: state.code, p_body: body, p_parent_id: null });
        if (res && res.ok) {
          if (input) input.value = "";
          toast({ title: "Comment posted", tone: "success", iconName: "comment", duration: 2600 });
          await loadComments(state.code);
        } else {
          toast({ title: "Not posted", message: res && res.error === "reaction" ? "Like or dislike the video first." : "The server refused the comment.", tone: "error" });
        }
      } catch (error) {
        toast({ title: "Not posted", message: error.message, tone: "error" });
      }
      btn.disabled = false;
    }
  };

  const keyForm = root.querySelector("[data-v-key-form]");
  if (keyForm) {
    keyForm.addEventListener("submit", (event) => {
      event.preventDefault();
      const input = root.querySelector("[data-v-key-input]");
      const err = root.querySelector("[data-v-key-err]");
      const value = String((input && input.value) || "").trim();
      if (!value) {
        if (err) err.textContent = "Type the password first.";
        return;
      }
      state.key = value;
      openWatch(state.code);
    });
  }
}

/* ================================================================== */
/* boot                                                               */
/* ================================================================== */
function boot() {
  state.token = sessionToken();
  bindFeed();
  route();
  loadFeed();
  loadMine();

  const publish = $("[data-v-publish]");
  if (publish && !signedIn()) {
    publish.setAttribute("href", "login.html?next=video-editor.html");
  }
  window.addEventListener("1w:session", () => {
    state.token = sessionToken();
    loadFeed();
    loadMine();
  });
}

boot();
