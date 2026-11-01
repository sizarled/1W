/**
 * profile.html — one profile, two views.
 * ------------------------------------------------------------------
 * Everything on this page comes from the `profile_*` RPCs of M1
 * (`profile_core`): the browser never reads a table directly and never
 * sees another member's member ID, email or points balance.
 *
 *   profile_public(token, ref)      header, stats, relationship, settings
 *   profile_settings_save(token,j)  the show/hide and auto-accept switches
 *   profile_follow_toggle/respond   follow requests and their answers
 *   profile_follow_lists(token)     actual and pending, both directions
 *   profile_block_set/remove/list   the seven action flags
 *   profile_links_list/save         social accounts (no token is ever stored)
 *
 * `ref` is accepted as `?u=@username`, `?id=ID100003` or a profile uuid;
 * without a parameter the page shows the signed-in member's own profile.
 *
 * Posts: `profile_feed` fills the three tabs, `post_create` publishes from
 * the composer (content → visibility → schedule), and `post_react`,
 * `post_comment`, `post_comments`, `post_reshare`, `post_report`,
 * `post_reactors` and `post_delete` drive the card's action bar.
 */

import { rpc, rest } from "./data.js";
import { qs, qsa, esc, num, formatDate, timeAgo, avatarPlaceholder, debounce } from "./utils.js";
import { SUPABASE, storageUrl } from "./config.js";
import { hydrateIcons } from "./icons.js";
import { brand } from "./brands.js";
import { toast } from "./ui.js";
import { sessionToken, getMember } from "./session.js";

import { levelInfo } from "./levels.js";

const PLATFORMS = [
  ["facebook", "Facebook"],
  ["instagram", "Instagram"],
  ["tiktok", "TikTok"],
  ["youtube", "YouTube"],
  ["x", "X"],
  ["pinterest", "Pinterest"],
  ["reddit", "Reddit"],
  ["threads", "Threads"],
  ["telegram", "Telegram"],
];

const SHOW_SWITCHES = [
  ["show_country", "Country", "Show the country on the profile."],
  ["show_language", "Language", "Show the profile language."],
  ["show_age", "Age", "Show the age computed from the birth date."],
  ["show_level", "Account level", "Show the level badge next to the name."],
  ["show_wealth", "Wealth level", "Show the points balance as a wealth badge."],
  ["show_connection", "Connection status", "Show the online / offline cylinder to visitors."],
];

const AUTO_SWITCHES = [
  ["auto_accept_follow", "Follow requests", "Accept new followers without asking."],
  ["auto_accept_message", "Messages", "Accept messages from people you do not follow."],
  ["auto_accept_publish", "Publishing", "Accept posts other members want to publish here."],
  ["auto_accept_participate", "Participation", "Accept requests to publish on someone else's profile."],
];

const state = {
  token: "",
  ref: "",
  data: null,
  view: "updates",
  lists: null,
  blocks: null,
  links: null,
  search: "",
  results: null,
  posts: [],
  feedKind: "updates",
  comments: new Map(),
  openComments: new Set(),
  draft: null,
  messages: {
    filter: "all",
    online: false,
    list: [],
    counts: {},
    unread: 0,
    selected: null,
    thread: null,
    people: [],
    to: "",
    subject: "",
    body: "",
    files: [],
    busy: false,
  },
};

/* ================================================================== */
/* helpers                                                             */
/* ================================================================== */
const el = (sel) => qs(sel);

/**
 * The `hidden` attribute alone is not enough on this page: .pf__state,
 * .pf__grid and .pf-conn all declare `display`, and an author `display` rule
 * beats the browser's `[hidden] { display: none }`. Setting the inline
 * display as well keeps the loading skeleton out of the page for good.
 */
function setHidden(node, flag) {
  if (!node) return;
  node.hidden = Boolean(flag);
  node.style.display = flag ? "none" : "";
}
const avatarOf = (url, name) => url || avatarPlaceholder(name || "1W", 96);
const initial = (name = "") => (name.trim()[0] || "1").toUpperCase();

function profileUrl(username) {
  return `profile.html?u=${encodeURIComponent(username || "")}`;
}

function personRow(person, actions = "", sub = "") {
  const on = person.online === true;
  const subtitle =
    sub ||
    `<span class="pf-dot ${on ? "is-on" : ""}" aria-hidden="true"></span>
     ${on ? "Online" : "Offline"}
     <span aria-hidden="true">·</span>
     ${esc(person.username || "")}`;
  return `
    <div class="pf-person">
      <a class="pf-person__avatar" href="${esc(profileUrl(person.username))}" aria-hidden="true" tabindex="-1">
        <img src="${esc(avatarOf(person.avatar, person.name))}" alt="" width="42" height="42" loading="lazy" />
      </a>
      <div class="pf-person__body">
        <a class="pf-person__name" href="${esc(profileUrl(person.username))}">${esc(person.name || person.username || "Member")}</a>
        <span class="pf-person__sub">${subtitle}</span>
      </div>
      <div class="pf-person__actions">${actions}</div>
    </div>`;
}

function emptyBlock(icon, title, text, action = "") {
  return `
    <div class="pf-empty">
      <i data-icon="${icon}"></i>
      <h3>${esc(title)}</h3>
      <p>${esc(text)}</p>
      ${action}
    </div>`;
}

/* ================================================================== */
/* load + render                                                       */
/* ================================================================== */
function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), ms)),
  ]);
}

async function load() {
  try {
    const data = await withTimeout(rpc("profile_public", { p_token: state.token, p_ref: state.ref || "" }), 15000);
    if (!data || data.ok === false) {
      return showState("user", "Profile not found", "The link may be wrong, or the member changed their username.");
    }
    state.data = data;
    if (data.hidden) {
      return showState(
        "lock",
        "This profile is not available",
        `${data.profile?.name || "This member"} restricted who can open their profile.`
      );
    }
    if (!data.relationship?.is_owner && state.view === "activity") state.view = "updates";
    renderAll();
    document.body.dataset.view = data.relationship?.is_owner ? "owner" : "visitor";
    if (data.relationship?.is_owner) refreshUnread();
  } catch (error) {
    showState(
      "info",
      "The profile could not be loaded",
      error?.message === "timeout"
        ? "The server did not answer in time. Check the connection and try again."
        : error?.message || "Check the connection and try again."
    );
  }
}

function showState(icon, title, text, action = "") {
  setHidden(el("[data-pf-root]"), true);
  const host = el("[data-pf-state]");
  setHidden(host, false);
  host.innerHTML = `
    <div class="pf__state-inner">
      <i data-icon="${icon}"></i>
      <h1>${esc(title)}</h1>
      <p>${esc(text)}</p>
      ${action || '<a class="btn btn--ghost btn--sm" href="index.html"><i data-icon="arrowLeft"></i> Back to the homepage</a>'}
    </div>`;
  hydrateIcons(host);
}

function renderAll() {
  setHidden(el("[data-pf-state]"), true);
  setHidden(el("[data-pf-root]"), false);
  renderSide();
  renderHead();
  renderSideActions();
  renderMenu();
  renderTabs();
  renderPanel();
  hydrateIcons(el("[data-pf-root]"));
}

function renderSide() {
  const p = state.data.profile;
  const s = state.data.stats;
  const img = el("[data-pf-side-img]");
  const src = avatarOf(p.avatar, p.name);
  img.src = src;
  setHidden(img, false);
  setHidden(el("[data-pf-side-initial]"), Boolean(p.avatar));
  img.addEventListener("error", () => {
    setHidden(img, true);
    setHidden(el("[data-pf-side-initial]"), false);
  });
  el("[data-pf-side-name]").textContent = p.name || p.username || "Member";
  el("[data-pf-side-username]").textContent = p.username || "";
  const idEl = el("[data-pf-side-id]");
  setHidden(idEl, !p.member_id);
  idEl.textContent = p.member_id ? `Member ID ${p.member_id}` : "";
  el("[data-pf-stat-followers]").textContent = num(s.followers);
  el("[data-pf-stat-following]").textContent = num(s.following);
  el("[data-pf-stat-reach]").textContent = num(s.reach);
}

function renderHead() {
  const p = state.data.profile;
  const cover = el("[data-pf-cover]");
  cover.innerHTML = p.cover ? `<img src="${esc(p.cover)}" alt="" loading="lazy" />` : "";

  const avatar = el("[data-pf-avatar]");
  const img = el("[data-pf-avatar-img]");
  const name = p.name || p.username || "Member";
  if (p.avatar) {
    img.src = p.avatar;
    setHidden(img, false);
    setHidden(el("[data-pf-avatar-initial]"), true);
  } else {
    el("[data-pf-avatar-initial]").textContent = initial(name);
    setHidden(img, true);
    setHidden(el("[data-pf-avatar-initial]"), false);
  }
  img.addEventListener("error", () => {
    setHidden(img, true);
    setHidden(el("[data-pf-avatar-initial]"), false);
  });
  void avatar;

  el("[data-pf-name]").textContent = name;
  el("[data-pf-username]").textContent = p.username || "";

  const flags = [];
  {
    const info = levelInfo({ points: p.wealth || 0, membership: p.membership || "free", unlocked: p.level_unlocked ?? p.level });
    flags.push(`<span class="badge badge--solid" title="${esc(info.row.summary)}">${esc(info.badge)} · ${esc(info.row.name)}</span>`);
  }
  if (p.wealth !== null && p.wealth !== undefined) flags.push(`<span class="badge"><i data-icon="gem"></i> ${num(p.wealth)} pts</span>`);
  if (p.membership && p.membership !== "free") flags.push(`<span class="badge badge--outline"><i data-icon="crown"></i> ${esc(p.membership)}</span>`);
  el("[data-pf-flags]").innerHTML = flags.join("");

  const conn = el("[data-pf-conn]");
  const owner = state.data.relationship?.is_owner;
  if (p.online === null || p.online === undefined) {
    setHidden(conn, true);
  } else {
    setHidden(conn, false);
    conn.classList.toggle("is-on", p.online === true);
    el("[data-pf-conn-label]").textContent = p.online ? "Online" : "Offline";
    conn.title = owner && p.online !== null ? "Visitors see this only while “Connection status” is on." : "";
  }

  const desc = el("[data-pf-desc]");
  setHidden(desc, !p.description);
  desc.textContent = p.description || "";

  const meta = [];
  if (p.country) meta.push(`<li><i data-icon="globe"></i> ${esc(p.country)}</li>`);
  if (p.city) meta.push(`<li><i data-icon="target"></i> ${esc(p.city)}</li>`);
  if (p.language) meta.push(`<li><i data-icon="mail"></i> ${esc(String(p.language).toUpperCase())}</li>`);
  if (p.age) meta.push(`<li><i data-icon="user"></i> ${num(p.age)} years</li>`);
  if (p.created_at) meta.push(`<li><i data-icon="calendar"></i> Joined ${esc(formatDate(p.created_at, { month: "short", year: "numeric" }))}</li>`);
  el("[data-pf-meta]").innerHTML = meta.join("");

  const actions = el("[data-pf-actions]");
  const rel = state.data.relationship || {};
  if (owner) {
    actions.innerHTML = `
      <button class="btn btn--primary btn--sm" type="button" data-pf-act="publish"><i data-icon="plus"></i> Publish</button>
      <button class="btn btn--ghost btn--sm" type="button" data-pf-act="settings"><i data-icon="settings"></i> Edit profile</button>
      <button class="btn btn--ghost btn--sm" type="button" data-pf-act="share"><i data-icon="link"></i> Copy link</button>`;
  } else {
    actions.innerHTML = `
      <button class="btn btn--ghost btn--sm" type="button" data-pf-act="message" ${rel.can_message ? "" : "disabled"}>
        <i data-icon="send"></i> Message
      </button>
      <button class="btn btn--ghost btn--sm" type="button" data-pf-act="publish-here" ${rel.can_follow ? "" : "disabled"}>
        <i data-icon="upload"></i> Publish
      </button>
      <button class="btn btn--ghost btn--sm" type="button" data-pf-act="block"><i data-icon="shield"></i> Block</button>
      <button class="icon-btn icon-btn--bordered" type="button" data-pf-act="share" aria-label="Share this profile">
        <i data-icon="share"></i>
      </button>`;
  }
}

function renderSideActions() {
  const host = el("[data-pf-side-actions]");
  const rel = state.data.relationship || {};
  if (rel.is_owner) {
    host.innerHTML = `
      <a class="btn btn--primary" href="dashboard.html" style="width: 100%"><i data-icon="dashboard"></i> Dashboard</a>`;
    return;
  }
  const label = rel.following === "active" ? "Following" : rel.following === "pending" ? "Requested" : "Follow";
  host.innerHTML = `
    <button class="btn ${rel.following === "active" ? "btn--ghost" : "btn--primary"}" type="button" data-pf-act="follow" ${
      rel.signed_in ? "" : "disabled"
    }>
      <i data-icon="${rel.following === "none" ? "plus" : "check"}"></i> ${label}
    </button>
    <button class="icon-btn icon-btn--bordered" type="button" data-pf-act="share" aria-label="Share this profile">
      <i data-icon="share"></i>
    </button>`;
}

function renderMenu() {
  const host = el("[data-pf-menu]");
  const owner = state.data.relationship?.is_owner;
  const counts = state.lists?.counts || {};
  const pending = Number(counts.followers_pending || 0);

  if (!owner) {
    host.innerHTML = "";
    return;
  }

  const item = (view, icon, label, extra = "") => `
    <button class="pf-menu__item ${state.view === view ? "is-active" : ""}" type="button" data-pf-view="${view}">
      <i data-icon="${icon}"></i><span>${esc(label)}</span>${extra}
    </button>`;

  host.innerHTML = `
    <p class="pf-menu__title">Profile</p>
    ${item("updates", "article", "Updates")}
    ${item("activity", "chart", "Activity")}
    ${item("suggestions", "sparkle", "Suggestions")}
    <p class="pf-menu__title">Network</p>
    ${item("followers", "users", "Followers", pending ? `<em>${pending} new</em>` : "")}
    ${item("following", "user", "Following")}
    ${item("blocks", "shield", "Blocks")}
    ${item("search", "search", "Search")}
    <p class="pf-menu__title">Account</p>
    ${item("messages", "mail", "Messages", state.messages?.unread ? `<em>${state.messages.unread} new</em>` : "")}
    ${item("settings", "settings", "Settings")}
    <p class="pf-menu__title">In build</p>
    ${item("manage", "target", "Manage posts")}
    ${item("publishers", "broadcast", "Publisher list")}
    ${item("participants", "users", "Participant list")}`;
  hydrateIcons(host);
}

function renderTabs() {
  const host = el("[data-pf-tabs]");
  const owner = state.data.relationship?.is_owner;
  const tabs = [
    ["updates", "Updates", "article"],
    ...(owner ? [["activity", "Activity", "chart"]] : []),
    ["suggestions", "Suggestions", "sparkle"],
  ];
  host.innerHTML = tabs
    .map(
      ([key, label, iconName]) => `
      <button class="pf-tab ${state.view === key ? "is-active" : ""}" type="button" role="tab"
        aria-selected="${state.view === key}" data-pf-view="${key}">
        <i data-icon="${iconName}"></i>${esc(label)}
      </button>`
    )
    .join("");
  hydrateIcons(host);
}

async function renderPanel() {
  const host = el("[data-pf-panel]");
  const owner = state.data.relationship?.is_owner;

  if (state.view === "followers" || state.view === "following") {
    host.innerHTML = `<div class="pf-block"><div class="pf-block__note">Loading…</div></div>`;
    await ensureLists();
    host.innerHTML = renderFollowPanels();
    hydrateIcons(host);
    return;
  }

  if (state.view === "blocks") {
    host.innerHTML = `<div class="pf-block"><div class="pf-block__note">Loading…</div></div>`;
    await ensureBlocks();
    host.innerHTML = renderBlockPanel();
    hydrateIcons(host);
    return;
  }

  if (state.view === "settings") {
    await ensureSettings();
    host.innerHTML = renderSettingsPanel();
    hydrateIcons(host);
    return;
  }

  if (state.view === "search") {
    host.innerHTML = renderSearchPanel();
    hydrateIcons(host);
    return;
  }

  if (state.view === "messages") {
    await renderMessagesPanel();
    return;
  }

  if (state.view === "manage" || state.view === "publishers" || state.view === "participants") {
    host.innerHTML = renderSoon(state.view);
    hydrateIcons(host);
    return;
  }

  await renderFeed(state.view, owner);
}

/* ================================================================== */
/* panels                                                              */
/* ================================================================== */
async function renderFeed(kind, owner) {
  const host = el("[data-pf-panel]");
  host.innerHTML = `<div class="pf-block"><div class="pf-block__note">Loading posts…</div></div>`;

  let payload = null;
  try {
    payload = await rpc("profile_feed", {
      p_token: state.token,
      // own profile has no ?u=, so the feed resolves by the profile's username
      p_ref: state.ref || state.data?.profile?.username || "",
      p_kind: kind,
      p_limit: 20,
      p_offset: 0,
    });
  } catch {
    payload = null;
  }
  const posts = payload && payload.ok !== false ? payload.posts || [] : [];
  state.posts = posts;
  state.feedKind = kind;

  const label = { updates: "Updates", activity: "Activity", suggestions: "Suggestions" }[kind] || "Updates";
  const copy =
    {
      updates:
        "Everything this profile follows lands here: profiles, keywords, blogs, community spaces, servers, studios and banks — translated posts included.",
      activity: "What this profile published, reshared, reacted to and commented on.",
      suggestions:
        "Posts suggested from the keywords this profile follows and from the interactions it had, ordered by ranking points.",
    }[kind] || "";

  const body = posts.length
    ? posts.map((post) => postCard(post)).join("")
    : emptyBlock(
        kind === "suggestions" ? "sparkle" : "article",
        payload && payload.ok === false ? "The posts could not be loaded" : "No posts yet",
        payload && payload.ok === false ? "Check the connection and open the tab again." : copy,
        owner
          ? `<button class="btn btn--primary btn--sm" type="button" data-pf-act="publish"><i data-icon="plus"></i> Publish the first post</button>`
          : ""
      );

  host.innerHTML = `
    <div class="pf-block">
      <div class="pf-block__head">
        <span class="pf-block__title"><i data-icon="${kind === "suggestions" ? "sparkle" : "article"}"></i> ${esc(label)}</span>
        <span class="pf-block__note">${posts.length} ${posts.length === 1 ? "post" : "posts"}</span>
      </div>
      ${body}
    </div>`;
  hydrateIcons(host);
}

/* ------------------------------------------------------------------ */
/* one post                                                            */
/* ------------------------------------------------------------------ */
function postCard(post) {
  const pub = post.publisher || {};
  const counters = post.counters || {};
  const mine = post.mine || {};
  const keywords = post.keywords || [];
  const translations = post.translations || [];
  const related = post.related || [];
  const badges = [];
  if (post.type && post.type !== "article") badges.push(`<span class="badge">${esc(post.type)}</span>`);
  if (translations.length) badges.push(`<span class="badge badge--outline"><i data-icon="globe"></i> Translated</span>`);
  if (mine.can_manage) badges.push(`<span class="badge">${esc(post.status === "scheduled" ? "Scheduled" : "Published")}</span>`);
  if (post.visibility && post.visibility !== "general") badges.push(`<span class="badge">${esc(post.visibility)}</span>`);

  const kwChips = keywords.length
    ? `<div class="pc__kws">${keywords
        .map(
          (k) =>
            `<span class="chip" title="${k.role === "main" ? "Main keyword" : "Sub-keyword"}">${k.role === "sub" ? "— " : ""}${esc(k.keyword)}</span>`
        )
        .join("")}</div>`
    : "";

  const contentPane = `
    ${post.thumbnail ? `<div class="pc__thumb"><img src="${esc(post.thumbnail)}" alt="" loading="lazy" /></div>` : ""}
    <h3 class="pc__title">${esc(post.title)}</h3>
    ${post.description ? `<p class="pc__desc">${esc(post.description)}</p>` : ""}
    ${post.embed ? `<a class="pc__embed" href="${esc(post.embed)}" target="_blank" rel="noopener noreferrer"><i data-icon="external"></i> ${esc(post.embed.replace(/^https?:\/\//, ""))}</a>` : ""}
    ${kwChips}`;

  const translationRows = translations.length
    ? `<div><dt>Translations</dt><dd>${translations.map((t) => esc(t.language.toUpperCase())).join(" · ")}</dd></div>`
    : "";

  const infoPane = `
    <dl class="pc__info">
      <div><dt>Language</dt><dd>${esc(String(post.language || "en").toUpperCase())}</dd></div>
      <div><dt>Reading time</dt><dd>${num(post.read_minutes)} min${post.word_count ? ` · ${num(post.word_count)} words` : ""}</dd></div>
      <div><dt>Visibility</dt><dd>${esc(post.visibility)}</dd></div>
      <div><dt>Ranking points</dt><dd>${num(post.rank_points)}</dd></div>
      <div><dt>Reach points</dt><dd>${num(post.reach_points)}</dd></div>
      <div><dt>Post code</dt><dd>${esc(post.code)}</dd></div>
      ${translationRows}
    </dl>
    ${related.length ? `<div class="pc__kws">${related.map((r) => `<a class="chip" href="${esc(r.url || "#")}" target="_blank" rel="noopener noreferrer"><i data-icon="link"></i> ${esc(r.label)}</a>`).join("")}</div>` : ""}
    ${keywords.length ? `<div class="pf-row"><span class="pf-row__label">Keywords</span>${kwChips}</div>` : ""}`;

  const likeOn = mine.reaction === 1 ? "is-on" : "";
  const dislikeOn = mine.reaction === -1 ? "is-on" : "";
  const repostOn = mine.reshared ? "is-on" : "";
  const disabled = mine.can_interact ? "" : "disabled";

  return `
  <article class="pc" data-post="${esc(post.id)}" data-code="${esc(post.code)}">
    <header class="pc__head">
      <a class="pc__avatar" href="${esc(profileUrl(pub.username))}" aria-hidden="true" tabindex="-1">
        <img src="${esc(pub.avatar || avatarPlaceholder(pub.name))}" alt="" width="42" height="42" loading="lazy" />
      </a>
      <div class="pc__who">
        <a class="pc__name" href="${esc(profileUrl(pub.username))}">${esc(pub.name || pub.username || "Member")}</a>
        <span class="pc__sub">
          <span class="pf-dot ${pub.online ? "is-on" : ""}" aria-hidden="true"></span>
          ${esc(pub.username || "")} · ${esc(timeAgo(post.published_at) || "just now")}
        </span>
      </div>
      <div class="pc__badges">${badges.join("")}</div>
    </header>

    <div class="pc__tabs">
      <button class="pc__tab is-active" type="button" data-pc-tab="content">Content</button>
      <button class="pc__tab" type="button" data-pc-tab="info">Content info</button>
    </div>

    <div class="pc__pane" data-pc-pane="content">${contentPane}</div>
    <div class="pc__pane" data-pc-pane="info" hidden>${infoPane}</div>

    <div class="pc__actions">
      <button class="pc__act ${likeOn}" type="button" data-pc-act="like" ${disabled} aria-pressed="${mine.reaction === 1}">
        <i data-icon="thumbUp"></i><span>Like</span><b data-pc-count="likes">${num(counters.likes)}</b>
      </button>
      <button class="pc__act ${dislikeOn}" type="button" data-pc-act="dislike" ${disabled} aria-pressed="${mine.reaction === -1}">
        <i data-icon="thumbDown"></i><span>Dislike</span><b data-pc-count="dislikes">${num(counters.dislikes)}</b>
      </button>
      <button class="pc__act" type="button" data-pc-act="comments">
        <i data-icon="comment"></i><span>Comment</span><b data-pc-count="comments">${num(counters.comments)}</b>
      </button>
      <button class="pc__act ${repostOn}" type="button" data-pc-act="repost" ${disabled} aria-pressed="${Boolean(mine.reshared)}">
        <i data-icon="refresh"></i><span>Repost</span><b data-pc-count="reshares">${num(counters.reshares)}</b>
      </button>
      <button class="pc__act" type="button" data-pc-act="share">
        <i data-icon="share"></i><span>Share</span><b data-pc-count="shares">${num(counters.shares)}</b>
      </button>
      <button class="pc__act ${mine.reported ? "is-on" : ""} pc__act--danger" type="button" data-pc-act="report" ${disabled}>
        <i data-icon="flag"></i><span>Report</span>
      </button>
      ${mine.can_manage ? `<button class="pc__act pc__act--danger" type="button" data-pc-act="delete"><i data-icon="trash"></i><span>Delete</span></button>` : ""}
    </div>

    <div class="pc__comments" data-pc-comments hidden>
      <p class="pc__hint" data-pc-hint>Like or dislike the post before commenting — the comment takes that reaction.</p>
      <div data-pc-comment-form>
        <div class="pf-searchbar">
          <input class="input" type="text" maxlength="4000" placeholder="Write a comment…" data-pc-input aria-label="Write a comment" />
          <button class="btn btn--primary" type="button" data-pc-act="send-comment"><i data-icon="send"></i> Send</button>
        </div>
      </div>
      <div data-pc-comment-list><div class="pf-block__note">Loading comments…</div></div>
    </div>
  </article>`;
}

/* ------------------------------------------------------------------ */
/* posts: interactions                                                 */
/* ------------------------------------------------------------------ */
function findPost(id) {
  return state.posts.find((post) => post.id === id) || null;
}

function updatePostCounters(id, patch) {
  const post = findPost(id);
  if (!post) return;
  post.counters = Object.assign({}, post.counters, patch);
}

function refreshCard(id) {
  const node = qs(`[data-post="${id}"]`);
  const post = findPost(id);
  if (!node || !post) return;
  const fresh = document.createElement("div");
  fresh.innerHTML = postCard(post);
  const replacement = fresh.firstElementChild;
  node.replaceWith(replacement);
  hydrateIcons(replacement);
  if (state.openComments.has(id)) {
    const pane = replacement.querySelector("[data-pc-comments]");
    if (pane) {
      pane.hidden = false;
      renderCommentList(id, pane);
    }
  }
}

async function reactToPost(id, value) {
  const post = findPost(id);
  if (!post) return;
  const current = post.mine?.reaction ?? null;
  const next = current === value ? 0 : value;
  try {
    const res = await rpc("post_react", { p_token: state.token, p_ref: id, p_value: next });
    if (!res || res.ok === false) {
      return toast({ title: "Not saved", message: hintFor(res?.error), tone: "error" });
    }
    post.mine = Object.assign({}, post.mine, { reaction: res.reaction ?? null });
    updatePostCounters(id, { likes: res.likes, dislikes: res.dislikes });
    refreshCard(id);
  } catch (error) {
    toast({ title: "Not saved", message: error?.message || "Network error.", tone: "error" });
  }
}

async function toggleRepost(id) {
  try {
    const res = await rpc("post_reshare", { p_token: state.token, p_ref: id });
    if (!res || res.ok === false) {
      return toast({ title: "Not saved", message: hintFor(res?.error), tone: "error" });
    }
    const post = findPost(id);
    post.mine = Object.assign({}, post.mine, { reshared: res.reshared });
    updatePostCounters(id, { reshares: res.reshares });
    refreshCard(id);
    toast({ title: res.reshared ? "Reposted" : "Repost removed", message: res.reshared ? "It now appears on your profile." : "", tone: "success" });
  } catch (error) {
    toast({ title: "Not saved", message: error?.message || "Network error.", tone: "error" });
  }
}

async function toggleComments(id) {
  const node = qs(`[data-post="${id}"]`);
  const pane = node?.querySelector("[data-pc-comments]");
  if (!pane) return;
  const open = pane.hidden;
  pane.hidden = !open;
  if (open) {
    state.openComments.add(id);
    await renderCommentList(id, pane);
  } else {
    state.openComments.delete(id);
  }
}

async function renderCommentList(id, pane) {
  const list = pane.querySelector("[data-pc-comment-list]");
  const input = pane.querySelector("[data-pc-input]");
  const send = pane.querySelector('[data-pc-act="send-comment"]');
  const hint = pane.querySelector("[data-pc-hint]");
  const signedIn = Boolean(state.token);

  let res = null;
  try {
    res = await rpc("post_comments", { p_token: state.token, p_ref: id, p_limit: 50 });
  } catch {
    res = null;
  }

  /* the server owns the rule: a comment needs a reaction, and the reaction it
     takes belongs to the moment it was written — not to a later change */
  const post = findPost(id);
  const reaction = res?.reaction ?? post?.mine?.reaction ?? null;
  const canComment = Boolean(signedIn && (res ? res.can_comment !== false : Boolean(reaction)));
  if (post && res?.reaction !== undefined) {
    post.mine = Object.assign({}, post.mine, { reaction: res.reaction ?? null });
  }

  if (input) {
    input.disabled = !canComment;
    input.placeholder = !signedIn ? "Sign in to comment" : !reaction ? "Like or dislike the post first" : "Write a comment…";
  }
  if (send) send.disabled = !canComment;
  if (hint) {
    hint.textContent = !signedIn
      ? "Sign in to comment."
      : !reaction
        ? "Like or dislike the post before commenting — the comment takes that reaction."
        : `New comments are counted ${reaction === 1 ? "positive" : "negative"} (your ${reaction === 1 ? "like" : "dislike"}). Changing your reaction later leaves the comments you already wrote as they are.`;
  }

  const comments = res?.comments || [];
  state.comments.set(id, comments);
  if (!list) return;
  list.innerHTML = comments.length
    ? comments
        .map((comment) => {
          const author = comment.author || {};
          return `
        <div class="pc__comment ${comment.parent_id ? "pc__comment--reply" : ""}">
          <span class="pf-person__avatar"><img src="${esc(author.avatar || avatarPlaceholder(author.name))}" alt="" width="32" height="32" loading="lazy" /></span>
          <div class="pc__comment-body">
            <span class="pc__comment-head">
              <b>${esc(author.name || author.username || "Member")}</b>
              ${esc(author.username || "")}
              <span aria-hidden="true">·</span>${esc(timeAgo(comment.created_at))}
              ${comment.sentiment === 1 ? '<span class="badge badge--outline">positive</span>' : comment.sentiment === -1 ? '<span class="badge badge--outline">negative</span>' : ""}
              ${comment.edited ? '<span class="badge badge--outline">edited</span>' : ""}
            </span>
            <span class="pc__comment-text">${esc(comment.body)}</span>
            <span class="pc__comment-foot">
              <span><i data-icon="thumbUp"></i> ${num(comment.likes)}</span>
              <span><i data-icon="thumbDown"></i> ${num(comment.dislikes)}</span>
              ${comment.mine ? '<span class="badge badge--outline">you</span>' : ""}
            </span>
          </div>
        </div>`;
        })
        .join("")
    : `<div class="pf-block__note">No comments yet.</div>`;
  hydrateIcons(list);
}

async function sendComment(id) {
  const node = qs(`[data-post="${id}"]`);
  const input = node?.querySelector("[data-pc-input]");
  const value = (input?.value || "").trim();
  if (!value) return;
  try {
    const res = await rpc("post_comment", { p_token: state.token, p_ref: id, p_body: value, p_parent_id: null });
    if (!res || res.ok === false) {
      const messages = {
        reaction: "Like or dislike the post before commenting.",
        blocked: "This profile blocked you from commenting.",
        session: "Sign in to comment.",
      };
      return toast({ title: "Comment refused", message: messages[res?.error] || "Please try again.", tone: "error" });
    }
    input.value = "";
    updatePostCounters(id, { comments: res.comments });
    const post = findPost(id);
    const pane = node?.querySelector("[data-pc-comments]");
    if (post) {
      post.mine = Object.assign({}, post.mine, { commented: true });
      refreshCard(id);
    }
    if (state.openComments.has(id) && pane) {
      await renderCommentList(id, qs(`[data-post="${id}"]`)?.querySelector("[data-pc-comments]"));
    }
    toast({ title: "Comment added", message: "", tone: "success" });
  } catch (error) {
    toast({ title: "Comment refused", message: error?.message || "Network error.", tone: "error" });
  }
}

async function reportPost(id) {
  const reasons = ["spam", "abuse", "copyright", "misleading", "other"];
  openModal({
    title: "Report this post",
    body: `
      <p class="pf-row__hint">Reports are reviewed by moderators and cost the post 60 ranking points.</p>
      <div class="pf-choices" data-report-reasons>
        ${reasons.map((r, i) => `<button class="pf-choice ${i === 0 ? "is-active" : ""}" type="button" data-reason="${r}">${r}</button>`).join("")}
      </div>
      <div class="pf-row"><span class="pf-row__label">Note (optional)</span><textarea class="textarea" rows="3" data-report-note></textarea></div>`,
    foot: `
      <span class="pf-block__note" data-modal-note></span>
      <span class="pf-modal__right">
        <button class="btn btn--ghost btn--sm" type="button" data-modal-close>Cancel</button>
        <button class="btn btn--primary btn--sm" type="button" data-report-send><i data-icon="flag"></i> Send report</button>
      </span>`,
  });

  let reason = "spam";
  qsa("[data-report-reasons] .pf-choice").forEach((button) => {
    button.addEventListener("click", () => {
      qsa("[data-report-reasons] .pf-choice").forEach((b) => b.classList.remove("is-active"));
      button.classList.add("is-active");
      reason = button.dataset.reason;
    });
  });

  qs("[data-report-send]")?.addEventListener("click", async () => {
    const note = qs("[data-report-note]")?.value?.trim() || "";
    try {
      const res = await rpc("post_report", { p_token: state.token, p_ref: id, p_reason: reason, p_note: note });
      if (!res || res.ok === false) {
        return toast({ title: "Report failed", message: "Please try again.", tone: "error" });
      }
      const post = findPost(id);
      if (post) post.mine = Object.assign({}, post.mine, { reported: true });
      closeModal();
      refreshCard(id);
      toast({ title: "Report sent", message: "Moderators will review the post.", tone: "success" });
    } catch (error) {
      toast({ title: "Report failed", message: error?.message || "Network error.", tone: "error" });
    }
  });
}

async function deletePost(id) {
  const post = findPost(id);
  if (!post) return;
  if (!window.confirm(`Delete “${post.title}”? It is archived for 30 days.`)) return;
  try {
    const res = await rpc("post_delete", { p_token: state.token, p_ref: id });
    if (!res || res.ok === false) {
      return toast({ title: "Not deleted", message: res?.error === "forbidden" ? "Only the author or the host may delete it." : "Please try again.", tone: "error" });
    }
    state.posts = state.posts.filter((item) => item.id !== id);
    toast({ title: "Post deleted", message: "Archived for 30 days.", tone: "success" });
    await load();
  } catch (error) {
    toast({ title: "Not deleted", message: error?.message || "Network error.", tone: "error" });
  }
}

function hintFor(error) {
  return (
    {
      session: "Sign in first.",
      hidden: "This post is not visible to you.",
      blocked: "A block is in place.",
      reaction: "Like or dislike the post first.",
      value: "Unsupported reaction.",
    }[error] || "Please try again."
  );
}

/* ------------------------------------------------------------------ */
/* members behind a counter                                            */
/* ------------------------------------------------------------------ */
async function openMembers(postId, kind) {
  openModal({ title: "Members", body: `<div class="pf-block__note">Loading…</div>`, foot: `<span></span><button class="btn btn--ghost btn--sm" type="button" data-modal-close>Close</button>` });
  let res = null;
  try {
    res = await rpc("post_reactors", { p_token: state.token, p_ref: postId, p_kind: kind });
  } catch {
    res = null;
  }
  const members = res?.members || [];
  const groups = [
    ["follow_you", "Follow you"],
    ["you_follow", "You follow"],
    ["others", "Others"],
  ];
  const body = members.length
    ? groups
        .map(([key, label]) => {
          const rows = members.filter((member) => member.relation === key);
          if (!rows.length) return "";
          return `<p class="pf-people__group">${esc(label)}</p><div class="pf-people pf-people--modal">${rows
            .map((member) =>
              personRow(
                { username: member.username, name: member.name, avatar: member.avatar, online: member.online },
                `<span class="badge">${member.online ? "online" : "offline"}</span>`
              )
            )
            .join("")}</div>`;
        })
        .join("")
    : `<div class="pf-block__note">Nobody yet.</div>`;
  const panel = qs(".pf-modal__body");
  if (panel) {
    panel.innerHTML = body;
    hydrateIcons(panel);
  }
}


function renderSoon(view) {
  const meta = {
    manage: ["Manage posts", "Creator, Participant and Publisher tabs with open, edit, statistics, copy link and delete.", "next round"],
    messages: ["Messages", "Send a message by username or member ID, and direct conversations with attachments.", "M7 messaging"],
    publishers: ["Publisher list", "The profiles you allow to publish on your profile, with approval.", "M6 publish_links"],
    participants: ["Participant list", "The profiles where you may publish, and the state of each request.", "M6 publish_links"],
  }[view] || ["—", "", ""];

  return `
    <div class="pf-block">
      ${emptyBlock(
        "sparkle",
        meta[0],
        meta[1],
        `<span class="badge badge--outline">${esc(meta[2])}</span>`
      )}
    </div>`;
}

function renderFollowPanels() {
  const counts = state.lists?.counts || {};
  const followers = state.lists?.followers || [];
  const following = state.lists?.following || [];
  const owner = state.data.relationship?.is_owner;

  const followerRows = followers.length
    ? followers
        .map((person) => {
          const actions =
            owner && person.status === "pending"
              ? `<button class="btn btn--primary" type="button" data-pf-act="accept" data-ref="${esc(person.username)}">Accept</button>
                 <button class="btn btn--ghost" type="button" data-pf-act="decline" data-ref="${esc(person.username)}">Decline</button>`
              : person.status === "pending"
                ? `<span class="badge badge--outline">Pending</span>`
                : `<span class="badge"><i data-icon="check"></i> Following you</span>`;
          return personRow(person, actions);
        })
        .join("")
    : `<div class="pf-block__note">No followers yet.</div>`;

  const followingRows = following.length
    ? following
        .map((person) => {
          const actions =
            !owner
              ? person.status === "pending"
                ? `<span class="badge badge--outline">Pending</span>`
                : ``
              : person.status === "pending"
                ? `<button class="btn btn--ghost" type="button" data-pf-act="cancel" data-ref="${esc(person.username)}">Cancel</button>`
                : `<button class="btn btn--ghost" type="button" data-pf-act="unfollow" data-ref="${esc(person.username)}">Unfollow</button>`;
          return personRow(person, actions);
        })
        .join("")
    : `<div class="pf-block__note">Not following anyone yet.</div>`;

  return `
    <div class="pf-block">
      <div class="pf-block__head">
        <span class="pf-block__title"><i data-icon="users"></i> Followers</span>
        <span class="pf-block__note">
          ${num(counts.followers_active)} actual · ${num(counts.followers_pending)} pending
        </span>
      </div>
      <div class="pf-people">${followerRows}</div>
    </div>
    <div class="pf-block">
      <div class="pf-block__head">
        <span class="pf-block__title"><i data-icon="user"></i> Following</span>
        <span class="pf-block__note">
          ${num(counts.following_active)} actual · ${num(counts.following_pending)} pending
        </span>
      </div>
      <div class="pf-people">${followingRows}</div>
    </div>`;
}

function renderBlockPanel() {
  const blocks = state.blocks?.blocks || [];
  const rows = blocks.length
    ? blocks
        .map((block) => {
          const flags = [
            ["view_profile", "profile"],
            ["view_posts", "posts"],
            ["message", "message"],
            ["publish", "publish"],
            ["participate", "participate"],
            ["react", "react"],
            ["comment", "comment"],
          ]
            .filter(([key]) => block[key])
            .map(([, label]) => label)
            .join(", ");
          return personRow(
            { username: block.username, name: block.name, avatar: block.avatar, online: false },
            `<button class="btn btn--ghost" type="button" data-pf-act="unblock" data-ref="${esc(block.username)}">Unblock</button>`,
            `${esc(block.username || "")} <span aria-hidden="true">·</span> ${esc(flags || "all actions")}`
          );
        })
        .join("")
    : `<div class="pf-block__note">You have not blocked anyone.</div>`;

  return `
    <div class="pf-block">
      <div class="pf-block__head">
        <span class="pf-block__title"><i data-icon="shield"></i> Blocked profiles</span>
        <span class="pf-block__note">A block removes the follows of both directions.</span>
      </div>
      <div class="pf-people">${rows}</div>
    </div>
    <div class="pf-block">
      <div class="pf-block__head">
        <span class="pf-block__title"><i data-icon="lock"></i> Block a profile</span>
        <span class="pf-block__note">Username, @username or member ID.</span>
      </div>
      <div class="pf-searchbar">
        <input class="input" type="text" placeholder="@username or ID100003" data-pf-block-input aria-label="Profile to block" />
        <button class="btn btn--primary" type="button" data-pf-act="block-ref"><i data-icon="shield"></i> Block</button>
      </div>
      <p class="pf-block__note" style="margin-top: 0.6rem">
        All seven actions are blocked by default: view profile, view posts, message, publish, participate, react and comment.
      </p>
    </div>`;
}

function renderSettingsPanel() {
  const settings = state.settings || {};
  const toggle = ([key, label, text]) => `
    <div class="pf-switch-row">
      <span class="pf-switch-row__label"><b>${esc(label)}</b><span>${esc(text)}</span></span>
      <button class="pf-switch" type="button" role="switch" aria-checked="${settings[key] === true}"
        aria-label="${esc(label)}" data-pf-toggle="${key}"></button>
    </div>`;

  const links = state.links?.links || [];
  const byPlatform = new Map(links.map((link) => [link.platform, link]));
  const linkRows = PLATFORMS.map(([key, label]) => {
    const link = byPlatform.get(key) || {};
    return `
      <div class="pf-link-row">
        <span class="pf-link-row__name">${brand(key)}${esc(label)}</span>
        <input class="input" type="url" inputmode="url" placeholder="https://…" value="${esc(link.url || "")}"
          data-pf-link-url="${key}" aria-label="${esc(label)} profile URL" />
        <select class="select" data-pf-link-sync="${key}" aria-label="${esc(label)} sync direction">
          ${["out", "in", "both"]
            .map((dir) => `<option value="${dir}" ${(link.sync_direction || "out") === dir ? "selected" : ""}>${dir}</option>`)
            .join("")}
        </select>
        <span class="pf-person__actions">
          <button class="btn btn--ghost" type="button" data-pf-act="link-save" data-platform="${key}">Save</button>
          ${link.url ? `<button class="btn btn--quiet" type="button" data-pf-act="link-remove" data-platform="${key}" aria-label="Remove ${esc(label)}"><i data-icon="trash"></i></button>` : ""}
        </span>
      </div>`;
  }).join("");

  return `
    <div class="pf-block">
      <div class="pf-block__head">
        <span class="pf-block__title"><i data-icon="eye"></i> What visitors see</span>
        <span class="pf-block__note">Each switch hides one field from everyone but you.</span>
      </div>
      ${SHOW_SWITCHES.map(toggle).join("")}
    </div>
    <div class="pf-block">
      <div class="pf-block__head">
        <span class="pf-block__title"><i data-icon="check"></i> Auto-accept</span>
        <span class="pf-block__note">Off means every request waits for you.</span>
      </div>
      ${AUTO_SWITCHES.map(toggle).join("")}
      ${toggle(["allow_keyword_follows", "Keyword follows", "Let people follow the keywords this profile follows."])}
    </div>
    <div class="pf-block">
      <div class="pf-block__head">
        <span class="pf-block__title"><i data-icon="link"></i> Related links</span>
        <span class="pf-block__note">Sync direction: out, in or both. Tokens are never stored here.</span>
      </div>
      ${linkRows}
    </div>`;
}

function renderSearchPanel() {
  const results = state.results;
  let body = `<div class="pf-block__note">Search by username, display name or member ID. People are ordered by reach points.</div>`;
  if (results) {
    body = results.length
      ? `<div class="pf-people">${results
          .map((person) =>
            personRow(
              {
                username: person.profile_username,
                name: person.profile_name,
                avatar: person.avatar_url,
                online: false,
              },
              `<span class="badge">${num(person.reach_count)} reach</span>`
            )
          )
          .join("")}</div>`
      : `<div class="pf-block__note">No profile matches that search.</div>`;
  }

  return `
    <div class="pf-block">
      <div class="pf-block__head">
        <span class="pf-block__title"><i data-icon="search"></i> Search</span>
        <span class="pf-block__note">Profiles only for now — post search and the filters follow with the keyword page.</span>
      </div>
      <div class="pf-searchbar">
        <input class="input" type="search" placeholder="Search profiles…" value="${esc(state.search)}"
          data-pf-search-input aria-label="Search profiles" />
        <button class="btn btn--ghost" type="button" data-pf-act="search"><i data-icon="search"></i> Search</button>
      </div>
      <div style="margin-top: 0.9rem">${body}</div>
    </div>`;
}

/* ================================================================== */
/* data helpers                                                        */
/* ================================================================== */
async function ensureLists(force = false) {
  if (state.lists && !force) return state.lists;
  try {
    state.lists = await rpc("profile_follow_lists", { p_token: state.token, p_ref: state.ref || "" });
  } catch {
    state.lists = { ok: false, followers: [], following: [], counts: {} };
  }
  return state.lists;
}

async function ensureBlocks(force = false) {
  if (state.blocks && !force) return state.blocks;
  try {
    state.blocks = await rpc("profile_blocks_list", { p_token: state.token });
  } catch {
    state.blocks = { ok: false, blocks: [] };
  }
  return state.blocks;
}

async function ensureSettings(force = false) {
  if ((state.settings && state.links) && !force) return;
  try {
    const [settings, links] = await Promise.all([
      rpc("profile_settings_get", { p_token: state.token }),
      rpc("profile_links_list", { p_token: state.token }),
    ]);
    state.settings = settings?.settings || {};
    state.links = links || { links: [] };
  } catch {
    state.settings = state.settings || {};
    state.links = state.links || { links: [] };
  }
}

async function refreshHeader() {
  await load();
}

/* ================================================================== */
/* actions                                                             */
/* ================================================================== */
async function doFollow() {
  const rel = state.data.relationship || {};
  if (rel.following !== "none") {
    const sure = window.confirm(rel.following === "active" ? "Stop following this profile?" : "Cancel the follow request?");
    if (!sure) return;
  }
  try {
    const res = await rpc("profile_follow_toggle", { p_token: state.token, p_ref: state.ref });
    if (!res || res.ok === false) {
      const map = {
        session: "Sign in to follow a profile.",
        blocked: "A block is in place between you and this profile.",
        self: "You cannot follow yourself.",
      };
      return toast({ title: "Follow failed", message: map[res?.error] || "Please try again.", tone: "error" });
    }
    toast({
      title: res.following ? (res.status === "pending" ? "Request sent" : "Following") : "Unfollowed",
      message: res.following
        ? res.status === "pending"
          ? "The profile decides whether to accept."
          : "You now follow this profile."
        : "The follow was removed.",
      tone: "success",
    });
    state.lists = null;
    await refreshHeader();
  } catch (error) {
    toast({ title: "Follow failed", message: error?.message || "Network error.", tone: "error" });
  }
}

async function respondFollow(ref, accept) {
  try {
    const res = await rpc("profile_follow_respond", { p_token: state.token, p_ref: ref, p_accept: accept });
    if (!res || res.ok === false) {
      return toast({ title: "Not possible", message: res?.error === "no_request" ? "That request is gone." : "Please try again.", tone: "error" });
    }
    toast({ title: accept ? "Request accepted" : "Request declined", message: accept ? "You have a new follower." : "The request was removed.", tone: "success" });
    state.lists = null;
    await refreshHeader();
    state.view = "followers";
    renderMenu();
    renderTabs();
    await renderPanel();
  } catch (error) {
    toast({ title: "Not possible", message: error?.message || "Network error.", tone: "error" });
  }
}

async function toggleFollowRef(ref, active) {
  try {
    const res = await rpc("profile_follow_toggle", { p_token: state.token, p_ref: ref });
    if (!res || res.ok === false) {
      return toast({ title: "Not possible", message: "Please try again.", tone: "error" });
    }
    toast({ title: res.following ? "Request sent" : "Updated", message: res.status === "pending" ? "Waiting for the profile." : "Done.", tone: "success" });
    state.lists = null;
    void active;
    await refreshHeader();
    await renderPanel();
  } catch (error) {
    toast({ title: "Not possible", message: error?.message || "Network error.", tone: "error" });
  }
}

async function blockRef(ref) {
  if (!ref) return toast({ title: "Missing profile", message: "Type a username or a member ID.", tone: "error" });
  try {
    const res = await rpc("profile_block_set", { p_token: state.token, p_ref: ref, p_flags: {} });
    if (!res || res.ok === false) {
      return toast({ title: "Block failed", message: res?.error === "self" ? "You cannot block yourself." : "Please try again.", tone: "error" });
    }
    toast({ title: "Profile blocked", message: "The follows of both directions were removed.", tone: "success" });
    state.blocks = null;
    state.lists = null;
    await refreshHeader();
    state.view = "blocks";
    renderMenu();
    renderTabs();
    await renderPanel();
  } catch (error) {
    toast({ title: "Block failed", message: error?.message || "Network error.", tone: "error" });
  }
}

async function unblockRef(ref) {
  try {
    const res = await rpc("profile_block_remove", { p_token: state.token, p_ref: ref });
    if (!res || res.ok === false) return toast({ title: "Unblock failed", message: "Please try again.", tone: "error" });
    toast({ title: "Profile unblocked", message: "They can see the profile again.", tone: "success" });
    state.blocks = null;
    await renderPanel();
  } catch (error) {
    toast({ title: "Unblock failed", message: error?.message || "Network error.", tone: "error" });
  }
}

async function saveSetting(key, button, value) {
  button.setAttribute("aria-busy", "true");
  try {
    const res = await rpc("profile_settings_save", { p_token: state.token, p_settings: { [key]: value } });
    if (!res || res.ok === false) throw new Error(res?.error || "save");
    state.settings = res.settings || state.settings;
    button.setAttribute("aria-checked", String(state.settings[key] === true));
    toast({ title: "Saved", message: "The profile settings were updated.", tone: "success" });
    if (key === "show_connection") await refreshHeader();
  } catch (error) {
    button.setAttribute("aria-checked", String(!value));
    toast({ title: "Not saved", message: error?.message || "Please try again.", tone: "error" });
  } finally {
    button.removeAttribute("aria-busy");
  }
}

async function saveLink(platform) {
  const url = qs(`[data-pf-link-url="${platform}"]`)?.value?.trim() || "";
  const sync = qs(`[data-pf-link-sync="${platform}"]`)?.value || "out";
  try {
    const res = await rpc("profile_links_save", { p_token: state.token, p_platform: platform, p_url: url, p_sync: sync });
    if (!res || res.ok === false) {
      const text = res?.error === "url" ? "The link must start with http:// or https://." : "Please try again.";
      return toast({ title: "Not saved", text, tone: "error" });
    }
    state.links = null;
    toast({ title: "Link saved", message: "Only connected links are shown to visitors.", tone: "success" });
    await ensureSettings(true);
    await renderPanel();
  } catch (error) {
    toast({ title: "Not saved", message: error?.message || "Network error.", tone: "error" });
  }
}

async function removeLink(platform) {
  try {
    const res = await rpc("profile_links_save", { p_token: state.token, p_platform: platform, p_remove: true });
    if (!res || res.ok === false) return toast({ title: "Not removed", message: "Please try again.", tone: "error" });
    state.links = null;
    await ensureSettings(true);
    await renderPanel();
    toast({ title: "Link removed", message: "", tone: "success" });
  } catch (error) {
    toast({ title: "Not removed", message: error?.message || "Network error.", tone: "error" });
  }
}

async function runSearch() {
  const input = qs("[data-pf-search-input]");
  const query = (input?.value || "").trim().replace(/^@/, "");
  state.search = query;
  if (!query) {
    state.results = null;
    return renderPanel();
  }
  try {
    const pattern = `*${query}*`;
    const rows = await rest("profiles", {
      select: "profile_username,profile_name,avatar_url,reach_count,followers_count",
      filters: { or: `(profile_username.ilike.${pattern},profile_name.ilike.${pattern})` },
      order: "reach_count.desc",
      limit: 20,
    });
    state.results = Array.isArray(rows) ? rows : [];
  } catch {
    state.results = [];
  }
  await renderPanel();
}

function shareLink() {
  const p = state.data?.profile || {};
  const url = new URL(profileUrl(p.username || state.ref), location.href).toString();
  const title = p.name || p.username || "1World profile";
  if (navigator.share) {
    navigator.share({ title, url }).catch(() => {});
    return;
  }
  navigator.clipboard
    ?.writeText(url)
    .then(() => toast({ title: "Link copied", message: url, tone: "success" }))
    .catch(() => toast({ title: "Copy failed", message: url, tone: "error" }));
}

/* ================================================================== */
/* modal                                                               */
/* ================================================================== */
function openModal({ title, body, foot, width }) {
  closeModal();
  const node = document.createElement("div");
  node.className = "pf-modal";
  node.setAttribute("data-pf-modal", "");
  node.innerHTML = `
    <div class="pf-modal__panel" role="dialog" aria-modal="true" aria-label="${esc(title)}" ${width ? `style="width:min(${width},100%)"` : ""}>
      <div class="pf-modal__head">
        <span class="pf-modal__title">${esc(title)}</span>
        <button class="icon-btn" type="button" data-modal-close aria-label="Close"><i data-icon="close"></i></button>
      </div>
      <div class="pf-modal__body">${body}</div>
      <div class="pf-modal__foot">${foot || '<span></span><button class="btn btn--ghost btn--sm" type="button" data-modal-close>Close</button>'}</div>
    </div>`;
  document.body.appendChild(node);
  hydrateIcons(node);
  node.addEventListener("click", (event) => {
    if (event.target === node) closeModal();
  });
  document.addEventListener("keydown", escapeModal);
  return node;
}

function closeModal() {
  qsa("[data-pf-modal]").forEach((node) => node.remove());
  document.removeEventListener("keydown", escapeModal);
}

function escapeModal(event) {
  if (event.key === "Escape") closeModal();
}

/* ================================================================== */
/* composer — content → visibility → schedule                          */
/* ================================================================== */
const STEP_LABELS = [
  ["content", "Content"],
  ["visibility", "Visibility"],
  ["schedule", "Schedule"],
];

function emptyDraft() {
  return {
    step: "content",
    title: "",
    description: "",
    body: "",
    embed: "",
    thumb: "",
    type: "article",
    language: "en",
    visibility: "general",
    related: [{ label: "", url: "" }],
    mains: [{ keyword: "", subs: [""] }],
    translations: [],
    audience: "",
    profiles: "",
    schedule: "now",
    custom: "",
    host: "",
  };
}

function openComposer(hostRef = "") {
  if (!state.token) {
    return toast({ title: "Sign in to publish", message: "The composer needs a member session.", tone: "error" });
  }
  state.draft = emptyDraft();
  state.draft.host = hostRef || "";
  openModal({ title: "Publish", body: "", foot: "" });
  renderComposer();
}

function draftFromDom() {
  const draft = state.draft;
  if (!draft) return draft;
  const read = (sel) => qs(sel)?.value ?? "";
  if (draft.step === "content") {
    draft.title = read("[data-draft-title]");
    draft.description = read("[data-draft-description]");
    draft.body = read("[data-draft-body]");
    draft.embed = read("[data-draft-embed]");
    draft.thumb = read("[data-draft-thumb]");
    draft.type = read("[data-draft-type]") || "article";
    draft.language = read("[data-draft-language]") || "en";
    draft.related = qsa("[data-draft-related]").map((row) => ({
      label: row.querySelector("[data-related-label]")?.value?.trim() || "",
      url: row.querySelector("[data-related-url]")?.value?.trim() || "",
    }));
    draft.mains = qsa("[data-draft-main]").map((row) => ({
      keyword: row.querySelector("[data-main-keyword]")?.value?.trim() || "",
      subs: Array.from(row.querySelectorAll("[data-sub-keyword]")).map((input) => input.value.trim()).filter(Boolean),
    }));
    draft.translations = qsa("[data-draft-translation]").map((row) => ({
      language: row.querySelector("[data-tr-language]")?.value?.trim() || "",
      title: row.querySelector("[data-tr-title]")?.value?.trim() || "",
      body: row.querySelector("[data-tr-body]")?.value?.trim() || "",
    }));
  }
  if (draft.step === "visibility") {
    draft.audience = read("[data-draft-audience]");
    draft.profiles = read("[data-draft-profiles]");
  }
  if (draft.step === "schedule") {
    draft.schedule = qs("[data-schedule].is-active")?.dataset.schedule || "now";
    draft.custom = read("[data-draft-custom]");
  }
  return draft;
}

function renderComposer() {
  const draft = state.draft;
  const panel = qs("[data-pf-modal] .pf-modal__body");
  const foot = qs("[data-pf-modal] .pf-modal__foot");
  const titleNode = qs("[data-pf-modal] .pf-modal__title");
  if (!panel || !foot) return;
  if (titleNode) titleNode.textContent = draft.host ? `Publish on ${draft.host}` : "Publish";

  const steps = STEP_LABELS.map(
    ([key, label], index) =>
      `<button class="pf-step ${draft.step === key ? "is-active" : ""}" type="button" data-step="${key}">${index + 1}. ${label}</button>`
  ).join("");

  panel.innerHTML = (draft.step === "content" ? contentStep(draft) : draft.step === "visibility" ? visibilityStep(draft) : scheduleStep(draft));

  const isLast = draft.step === "schedule";
  foot.innerHTML = `
    <div class="pf-steps">${steps}</div>
    <div class="pf-modal__right">
      <button class="btn btn--ghost btn--sm" type="button" data-modal-close>Cancel</button>
      ${draft.step !== "content" ? '<button class="btn btn--ghost btn--sm" type="button" data-step-back><i data-icon="chevronLeft"></i> Back</button>' : ""}
      ${isLast
        ? '<button class="btn btn--primary btn--sm" type="button" data-publish><i data-icon="upload"></i> Publish</button>'
        : '<button class="btn btn--primary btn--sm" type="button" data-step-next>Next <i data-icon="chevronRight"></i></button>'}
    </div>`;
  hydrateIcons(qs("[data-pf-modal]"));
}

function contentStep(draft) {
  const languages = [
    ["ar", "Arabic"], ["en", "English"], ["fr", "French"], ["es", "Spanish"],
    ["de", "German"], ["it", "Italian"], ["pt", "Portuguese"], ["tr", "Turkish"],
  ];
  const relatedRows = draft.related
    .map(
      (row, index) => `
      <div class="pf-kw" data-draft-related data-index="${index}">
        <input class="input" type="text" value="${esc(row.label)}" placeholder="Label" data-related-label />
        <input class="input" type="url" value="${esc(row.url)}" placeholder="https://…" data-related-url />
        <button class="icon-btn" type="button" data-related-remove aria-label="Remove link"><i data-icon="trash"></i></button>
      </div>`
    )
    .join("");

  const mainRows = draft.mains
    .map(
      (main, index) => `
      <div class="pf-mini" data-draft-main data-index="${index}">
        <div class="pf-kw">
          <input class="input" type="text" value="${esc(main.keyword)}" placeholder="Main keyword" data-main-keyword maxlength="80" />
          <span class="pf-row__hint">main ${index + 1} of 3</span>
          <button class="icon-btn" type="button" data-main-remove aria-label="Remove keyword"><i data-icon="trash"></i></button>
        </div>
        ${main.subs
          .map(
            (sub, subIndex) => `
          <div class="pf-kw">
            <input class="input" type="text" value="${esc(sub)}" placeholder="Sub-keyword (max 5)" data-sub-keyword maxlength="80" />
            <span class="pf-row__hint">sub ${subIndex + 1} of 5</span>
            <button class="icon-btn" type="button" data-sub-remove data-main-index="${index}" data-sub-index="${subIndex}" aria-label="Remove sub-keyword"><i data-icon="minus"></i></button>
          </div>`
          )
          .join("")}
        <button class="btn btn--quiet btn--sm" type="button" data-sub-add data-main-index="${index}"><i data-icon="plus"></i> Sub-keyword</button>
      </div>`
    )
    .join("");

  const translationRows = draft.translations
    .map(
      (row, index) => `
      <div class="pf-mini" data-draft-translation data-index="${index}">
        <div class="pf-kw">
          <input class="input" type="text" value="${esc(row.language)}" placeholder="Language (en)" data-tr-language maxlength="8" />
          <input class="input" type="text" value="${esc(row.title)}" placeholder="Translated title" data-tr-title maxlength="200" />
          <button class="icon-btn" type="button" data-tr-remove aria-label="Remove translation"><i data-icon="trash"></i></button>
        </div>
        <textarea class="textarea" rows="2" placeholder="Translated text (optional)" data-tr-body>${esc(row.body)}</textarea>
      </div>`
    )
    .join("");

  return `
    <div class="pf-row">
      <span class="pf-row__label">Title <span class="pf-row__hint">required, 200 characters</span></span>
      <input class="input" type="text" maxlength="200" value="${esc(draft.title)}" placeholder="What are you publishing?" data-draft-title />
    </div>
    <div class="pf-row">
      <span class="pf-row__label">Description</span>
      <textarea class="textarea" rows="2" maxlength="600" placeholder="One or two lines" data-draft-description>${esc(draft.description)}</textarea>
    </div>
    <div class="pf-row">
      <span class="pf-row__label">Text <span class="pf-row__hint">the reading time is computed from it</span></span>
      <textarea class="textarea" rows="4" placeholder="The body of the post" data-draft-body>${esc(draft.body)}</textarea>
    </div>

    <div class="pf-grid-2">
      <div class="pf-row">
        <span class="pf-row__label">Embedded link</span>
        <input class="input" type="url" value="${esc(draft.embed)}" placeholder="https://…" data-draft-embed />
      </div>
      <div class="pf-row">
        <span class="pf-row__label">Type</span>
        <select class="select" data-draft-type>
          ${["article", "video", "recommendation", "link"].map((type) => `<option value="${type}" ${draft.type === type ? "selected" : ""}>${type}</option>`).join("")}
        </select>
      </div>
    </div>

    <div class="pf-row">
      <span class="pf-row__label">Thumbnail <span class="pf-row__hint">a URL, or upload an image</span></span>
      <div class="pf-thumbs">
        <div class="pf-thumb-preview">${draft.thumb ? `<img src="${esc(draft.thumb)}" alt="" />` : ""}</div>
        <input class="input" type="url" value="${esc(draft.thumb)}" placeholder="https://…" data-draft-thumb />
        <label class="btn btn--ghost btn--sm" style="cursor: pointer">
          <i data-icon="upload"></i> Upload
          <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden data-draft-thumbfile />
        </label>
      </div>
    </div>

    <div class="pf-grid-2">
      <div class="pf-row">
        <span class="pf-row__label">Language</span>
        <select class="select" data-draft-language>
          ${languages.map(([code, name]) => `<option value="${code}" ${draft.language === code ? "selected" : ""}>${name}</option>`).join("")}
        </select>
      </div>
      <div class="pf-row">
        <span class="pf-row__label">Related links</span>
        <div class="pf-mini">
          ${relatedRows}
          <button class="btn btn--quiet btn--sm" type="button" data-related-add><i data-icon="plus"></i> Add a link</button>
        </div>
      </div>
    </div>

    <div class="pf-row">
      <span class="pf-row__label">Keywords <span class="pf-row__hint">3 mains, 5 subs each</span></span>
      <div class="pf-mini">
        ${mainRows}
        <button class="btn btn--quiet btn--sm" type="button" data-main-add><i data-icon="plus"></i> Main keyword</button>
      </div>
    </div>

    <div class="pf-row">
      <span class="pf-row__label">Translations <span class="pf-row__hint">manual, shown in Updates and Suggestions</span></span>
      <div class="pf-mini">
        ${translationRows || '<span class="pf-row__hint">No translation yet.</span>'}
        <button class="btn btn--quiet btn--sm" type="button" data-tr-add><i data-icon="plus"></i> Add a translation</button>
      </div>
    </div>`;
}

function visibilityStep(draft) {
  const choices = [
    ["general", "Public"],
    ["excluded", "Public, excluded by rules"],
    ["limited", "Only the listed audience"],
    ["private", "Private list"],
    ["followers", "My followers"],
    ["following", "Profiles I follow"],
    ["others", "Chosen profiles"],
  ];
  const needsAudience = draft.visibility === "excluded" || draft.visibility === "limited";
  const needsProfiles = draft.visibility === "private" || draft.visibility === "others";

  return `
    <div class="pf-row">
      <span class="pf-row__label">Who can see it</span>
      <div class="pf-choices" data-visibility-choices>
        ${choices
          .map(
            ([value, label]) =>
              `<button class="pf-choice ${draft.visibility === value ? "is-active" : ""}" type="button" data-visibility="${value}">${label}</button>`
          )
          .join("")}
      </div>
    </div>
    ${
      needsAudience
        ? `<div class="pf-row">
             <span class="pf-row__label">Rules <span class="pf-row__hint">one per line, kind:value</span></span>
             <textarea class="textarea" rows="4" placeholder="country:MA&#10;language:ar&#10;level:3" data-draft-audience>${esc(draft.audience)}</textarea>
             <span class="pf-row__hint">kinds: country, language, level, wealth, entity</span>
           </div>`
        : ""
    }
    ${
      needsProfiles
        ? `<div class="pf-row">
             <span class="pf-row__label">Profiles <span class="pf-row__hint">usernames or member IDs, comma separated</span></span>
             <input class="input" type="text" value="${esc(draft.profiles)}" placeholder="@sara, ID100003" data-draft-profiles />
           </div>`
        : ""
    }
    <p class="pf-row__hint">A post published on another profile is always public and uses the host's reach.</p>`;
}

function scheduleStep(draft) {
  const options = [
    ["now", "Now"],
    ["1h", "In one hour"],
    ["1d", "Tomorrow"],
    ["1w", "In one week"],
    ["custom", "Pick a date"],
  ];
  return `
    <div class="pf-row">
      <span class="pf-row__label">When</span>
      <div class="pf-choices">
        ${options
          .map(
            ([value, label]) =>
              `<button class="pf-choice ${draft.schedule === value ? "is-active" : ""}" type="button" data-schedule="${value}">${label}</button>`
          )
          .join("")}
      </div>
    </div>
    ${
      draft.schedule === "custom"
        ? `<div class="pf-row">
             <span class="pf-row__label">Date and time</span>
             <input class="input" type="datetime-local" value="${esc(draft.custom)}" data-draft-custom />
           </div>`
        : ""
    }
    <p class="pf-row__hint">A scheduled post stays a draft until its time; the profile's posts count only counts published posts.</p>`;
}

function scheduledIso(draft) {
  const now = Date.now();
  const map = { "1h": 3600e3, "1d": 864e5, "1w": 6048e5 };
  if (draft.schedule === "now" || !draft.schedule) return null;
  if (draft.schedule === "custom") {
    if (!draft.custom) return null;
    const date = new Date(draft.custom);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  return new Date(now + (map[draft.schedule] || 0)).toISOString();
}

async function publishDraft() {
  const draft = draftFromDom() || state.draft;
  if (!draft.title.trim()) {
    return toast({ title: "A title is required", message: "Write a title before publishing.", tone: "error" });
  }

  const keywords = [];
  draft.mains.forEach((main) => {
    if (!main.keyword) return;
    keywords.push({ keyword: main.keyword, role: "main" });
    main.subs.slice(0, 5).forEach((sub) => {
      if (sub) keywords.push({ keyword: sub, role: "sub", parent: main.keyword });
    });
  });

  const audience = (draft.audience || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [kind, ...rest] = line.split(":");
      return { kind: (kind || "").trim(), value: rest.join(":").trim(), mode: draft.visibility === "limited" ? "include" : "exclude" };
    })
    .filter((rule) => ["country", "language", "level", "wealth", "entity"].includes(rule.kind) && rule.value);

  const payload = {
    title: draft.title.trim(),
    description: draft.description.trim(),
    body: draft.body.trim(),
    embed_url: draft.embed.trim(),
    thumbnail_url: draft.thumb.trim(),
    content_type: draft.type,
    language: draft.language,
    visibility: draft.visibility,
    keywords,
    audience,
    profiles: (draft.profiles || "").split(",").map((ref) => ref.trim()).filter(Boolean),
    related_links: draft.related.filter((row) => row.label),
    translations: draft.translations.filter((row) => row.language && row.title),
    scheduled_at: scheduledIso(draft),
  };
  if (draft.host) payload.host = draft.host;

  const button = qs("[data-publish]");
  if (button) {
    button.disabled = true;
    button.textContent = "Publishing…";
  }

  try {
    const res = await rpc("post_create", { p_token: state.token, p_payload: payload });
    if (!res || res.ok === false) {
      const messages = {
        session: "Sign in to publish.",
        title: "A title is required.",
        title_long: "The title is too long.",
        visibility: "That visibility is not supported.",
        host: "The chosen profile was not found.",
        host_link: "You need an approved publisher link on that profile.",
        schedule: "The date is not valid.",
      };
      if (button) {
        button.disabled = false;
        button.textContent = "Publish";
      }
      return toast({ title: "Not published", message: messages[res?.error] || "Please try again.", tone: "error" });
    }
    closeModal();
    state.comments.clear();
    state.openComments.clear();
    toast({
      title: res.status === "scheduled" ? "Post scheduled" : "Post published",
      message:
        res.status === "scheduled"
          ? `It goes live ${new Date(res.scheduled_at).toLocaleString()}.`
          : "It is now on your profile.",
      tone: "success",
    });
    state.view = "updates";
    await load();
  } catch (error) {
    if (button) {
      button.disabled = false;
      button.textContent = "Publish";
    }
    toast({ title: "Not published", message: error?.message || "Network error.", tone: "error" });
  }
}

async function uploadThumb(file) {
  if (!file) return;
  if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) {
    return toast({ title: "Unsupported image", message: "PNG, JPEG, WEBP or GIF.", tone: "error" });
  }
  if (file.size > 4 * 1024 * 1024) {
    return toast({ title: "Image too large", message: "4 MB at most.", tone: "error" });
  }
  const ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z]/g, "");
  const name = `post_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
  try {
    const res = await fetch(`${SUPABASE.url}/storage/v1/object/source/users/posts/${name}`, {
      method: "POST",
      headers: {
        apikey: SUPABASE.publishableKey,
        "Content-Type": file.type,
        "x-upsert": "true",
      },
      body: file,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(body.slice(0, 120) || `HTTP ${res.status}`);
    }
    state.draft.thumb = storageUrl(`users/posts/${name}`);
    draftFromDom();
    state.draft.thumb = storageUrl(`users/posts/${name}`);
    renderComposer();
    toast({ title: "Image uploaded", message: "", tone: "success" });
  } catch (error) {
    toast({ title: "Upload failed", message: error?.message || "Please try again.", tone: "error" });
  }
}

/* ================================================================== */
/* wiring                                                              */
/* ================================================================== */
function switchView(view) {
  state.view = view;
  renderMenu();
  renderTabs();
  renderPanel();
  el("[data-pf-panel]")?.scrollIntoView?.({ block: "start", behavior: "smooth" });
}

document.addEventListener("click", (event) => {
  const viewBtn = event.target.closest("[data-pf-view]");
  if (viewBtn) {
    switchView(viewBtn.dataset.pfView);
    return;
  }

  const toggle = event.target.closest("[data-pf-toggle]");
  if (toggle) {
    const key = toggle.dataset.pfToggle;
    const next = toggle.getAttribute("aria-checked") !== "true";
    return saveSetting(key, toggle, next);
  }

  const action = event.target.closest("[data-pf-act]")?.dataset.pfAct;
  if (!action) return;
  const target = event.target.closest("[data-pf-act]");

  switch (action) {
    case "follow":
      return doFollow();
    case "accept":
      return respondFollow(target.dataset.ref, true);
    case "decline":
      return respondFollow(target.dataset.ref, false);
    case "unfollow":
    case "cancel":
      return toggleFollowRef(target.dataset.ref, action === "unfollow");
    case "block":
      return blockRef(state.data?.profile?.username || state.ref);
    case "block-ref":
      return blockRef(qs("[data-pf-block-input]")?.value || "");
    case "unblock":
      return unblockRef(target.dataset.ref);
    case "settings":
      return switchView("settings");
    case "share":
      return shareLink();
    case "publish":
      return openComposer();
    case "publish-here":
      return openComposer(state.ref || "");
    case "message":
      return startMessage(state.data?.profile?.username || "");
    case "link-save":
      return saveLink(target.dataset.platform);
    case "link-remove":
      return removeLink(target.dataset.platform);
    case "search":
      return runSearch();
    default:
      return undefined;
  }
});


/* ------------------------------------------------------------------ */
/* messages — events                                                   */
/* ------------------------------------------------------------------ */
document.addEventListener("click", (event) => {
  const filter = event.target.closest("[data-msg-filter]");
  if (filter) {
    state.messages.filter = filter.dataset.msgFilter;
    qsa("[data-msg-filter]").forEach((node) => node.classList.toggle("is-active", node === filter));
    loadMessageList();
    return;
  }

  const online = event.target.closest("[data-msg-online]");
  if (online) {
    state.messages.online = !state.messages.online;
    online.classList.toggle("is-active", state.messages.online);
    online.setAttribute("aria-pressed", String(state.messages.online));
    loadMessageList();
    return;
  }

  const open = event.target.closest("[data-msg-open]");
  if (open) {
    openThread(open.dataset.msgOpen);
    return;
  }

  if (event.target.closest("[data-msg-send]")) return sendMessage();
  if (event.target.closest("[data-msg-reply]")) return replyMessage();

  const refresh = event.target.closest("[data-msg-refresh]");
  if (refresh && state.messages.selected) return openThread(state.messages.selected);

  const removeCompose = event.target.closest("[data-msg-file-remove]");
  if (removeCompose) {
    state.messages.files.splice(Number(removeCompose.dataset.msgFileRemove), 1);
    const host = el("[data-msg-file-list]");
    if (host) {
      host.innerHTML = state.messages.files.length
        ? state.messages.files
            .map(
              (file, index) => `<span class="pf-file"><i data-icon="file"></i>
                <span class="pf-file__name">${esc(file.name)}</span>
                <span class="pf-file__size">${sizeLabel(file.bytes)}</span>
                <button class="icon-btn" type="button" data-msg-file-remove="${index}" aria-label="Remove"><i data-icon="close"></i></button></span>`
            )
            .join("")
        : '<span class="pf-row__hint">No attachment.</span>';
      hydrateIcons(host);
    }
    return;
  }

  const removeReply = event.target.closest("[data-msg-reply-file-remove]");
  if (removeReply) {
    state.messages.replyFiles.splice(Number(removeReply.dataset.msgReplyFileRemove), 1);
    paintReplyFiles();
  }
});

document.addEventListener("change", (event) => {
  const files = event.target.closest("[data-msg-files]");
  if (files) {
    addMessageFiles(files.files, "compose");
    files.value = "";
    return;
  }
  const replyFiles = event.target.closest("[data-msg-reply-input-file]");
  if (replyFiles) {
    addMessageFiles(replyFiles.files, "reply");
    replyFiles.value = "";
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  if (event.target.matches("[data-msg-reply-input]") && !event.shiftKey) {
    event.preventDefault();
    replyMessage();
  }
  if (event.target.matches("[data-msg-body]") && (event.metaKey || event.ctrlKey)) {
    event.preventDefault();
    sendMessage();
  }
});

/* ------------------------------------------------------------------ */
/* post cards                                                          */
/* ------------------------------------------------------------------ */
document.addEventListener("click", (event) => {
  const modalClose = event.target.closest("[data-modal-close]");
  if (modalClose) {
    closeModal();
    return;
  }

  const tab = event.target.closest("[data-pc-tab]");
  if (tab) {
    const card = tab.closest("[data-post]");
    if (!card) return;
    card.querySelectorAll("[data-pc-tab]").forEach((node) => node.classList.toggle("is-active", node === tab));
    card.querySelectorAll("[data-pc-pane]").forEach((pane) => {
      pane.hidden = pane.dataset.pcPane !== tab.dataset.pcTab;
    });
    return;
  }

  const stepTab = event.target.closest("[data-step]");
  if (stepTab) {
    draftFromDom();
    state.draft.step = stepTab.dataset.step;
    return renderComposer();
  }

  if (event.target.closest("[data-step-next]")) {
    draftFromDom();
    if (state.draft.step === "content" && !state.draft.title.trim()) {
      return toast({ title: "A title is required", message: "Write a title before going on.", tone: "error" });
    }
    const index = STEP_LABELS.findIndex(([key]) => key === state.draft.step);
    state.draft.step = STEP_LABELS[Math.min(index + 1, STEP_LABELS.length - 1)][0];
    return renderComposer();
  }

  if (event.target.closest("[data-step-back]")) {
    draftFromDom();
    const index = STEP_LABELS.findIndex(([key]) => key === state.draft.step);
    state.draft.step = STEP_LABELS[Math.max(index - 1, 0)][0];
    return renderComposer();
  }

  if (event.target.closest("[data-publish]")) return publishDraft();

  const choice = event.target.closest("[data-visibility]");
  if (choice) {
    draftFromDom();
    state.draft.visibility = choice.dataset.visibility;
    return renderComposer();
  }

  const schedule = event.target.closest("[data-schedule]");
  if (schedule) {
    draftFromDom();
    state.draft.schedule = schedule.dataset.schedule;
    return renderComposer();
  }

  const relatedAdd = event.target.closest("[data-related-add]");
  if (relatedAdd) {
    draftFromDom();
    if (state.draft.related.length < 6) state.draft.related.push({ label: "", url: "" });
    return renderComposer();
  }

  const relatedRemove = event.target.closest("[data-related-remove]");
  if (relatedRemove) {
    draftFromDom();
    const row = relatedRemove.closest("[data-draft-related]");
    state.draft.related.splice(Number(row?.dataset.index || 0), 1);
    if (!state.draft.related.length) state.draft.related.push({ label: "", url: "" });
    return renderComposer();
  }

  const mainAdd = event.target.closest("[data-main-add]");
  if (mainAdd) {
    draftFromDom();
    if (state.draft.mains.length >= 3) {
      return toast({ title: "Three main keywords at most", message: "Remove one before adding another.", tone: "error" });
    }
    state.draft.mains.push({ keyword: "", subs: [""] });
    return renderComposer();
  }

  const mainRemove = event.target.closest("[data-main-remove]");
  if (mainRemove) {
    draftFromDom();
    const row = mainRemove.closest("[data-draft-main]");
    state.draft.mains.splice(Number(row?.dataset.index || 0), 1);
    if (!state.draft.mains.length) state.draft.mains.push({ keyword: "", subs: [""] });
    return renderComposer();
  }

  const subAdd = event.target.closest("[data-sub-add]");
  if (subAdd) {
    draftFromDom();
    const main = state.draft.mains[Number(subAdd.dataset.mainIndex || 0)];
    if (main && main.subs.length >= 5) {
      return toast({ title: "Five sub-keywords at most", message: "Remove one before adding another.", tone: "error" });
    }
    if (main) main.subs.push("");
    return renderComposer();
  }

  const subRemove = event.target.closest("[data-sub-remove]");
  if (subRemove) {
    draftFromDom();
    const main = state.draft.mains[Number(subRemove.dataset.mainIndex || 0)];
    if (main) {
      main.subs.splice(Number(subRemove.dataset.subIndex || 0), 1);
      if (!main.subs.length) main.subs.push("");
    }
    return renderComposer();
  }

  const trAdd = event.target.closest("[data-tr-add]");
  if (trAdd) {
    draftFromDom();
    if (state.draft.translations.length >= 3) {
      return toast({ title: "Three translations at most", message: "", tone: "error" });
    }
    state.draft.translations.push({ language: "", title: "", body: "" });
    return renderComposer();
  }

  const trRemove = event.target.closest("[data-tr-remove]");
  if (trRemove) {
    draftFromDom();
    const row = trRemove.closest("[data-draft-translation]");
    state.draft.translations.splice(Number(row?.dataset.index || 0), 1);
    return renderComposer();
  }

  const act = event.target.closest("[data-pc-act]");
  if (!act) return;
  const card = act.closest("[data-post]");
  if (!card) return;
  const id = card.dataset.post;

  switch (act.dataset.pcAct) {
    case "like":
      return reactToPost(id, 1);
    case "dislike":
      return reactToPost(id, -1);
    case "comments":
      return toggleComments(id);
    case "send-comment":
      return sendComment(id);
    case "repost":
      return toggleRepost(id);
    case "share":
      return sharePost(id);
    case "report":
      return reportPost(id);
    case "delete":
      return deletePost(id);
    default:
      return undefined;
  }
});

document.addEventListener("click", (event) => {
  const count = event.target.closest("[data-pc-count]");
  if (!count) return;
  const group = count.closest("[data-pc-act]");
  const card = count.closest("[data-post]");
  if (!group || !card) return;
  const map = { like: "likes", dislike: "dislikes", comments: "comments", repost: "reshares" };
  const kind = map[group.dataset.pcAct];
  if (!kind) return;
  event.stopPropagation();
  openMembers(card.dataset.post, kind);
}, true);

document.addEventListener("change", (event) => {
  const file = event.target.closest("[data-draft-thumbfile]");
  if (file) uploadThumb(file.files?.[0]);
});

async function sharePost(id) {
  const post = findPost(id);
  if (!post) return;
  const url = `${location.origin}${location.pathname}?post=${encodeURIComponent(post.code)}`;
  try {
    if (navigator.share) {
      await navigator.share({ title: post.title, url });
    } else {
      await navigator.clipboard.writeText(url);
    }
    toast({ title: "Link copied", message: "Sharing outside the site counts one reach point, once per profile.", tone: "success" });
  } catch {
    toast({ title: "Share cancelled", message: "", tone: "info" });
  }
}

document.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && event.target.matches("[data-pf-search-input]")) {
    event.preventDefault();
    runSearch();
  }
  if (event.key === "Enter" && event.target.matches("[data-pf-block-input]")) {
    event.preventDefault();
    blockRef(event.target.value);
  }
});

const onSearchType = debounce((value) => {
  state.search = value;
  if (value.trim().length >= 2) runSearch();
}, 420);

document.addEventListener("input", (event) => {
  if (event.target.matches("[data-pf-search-input]")) onSearchType(event.target.value.trim());
});

/* ================================================================== */
/* boot                                                                */
/* ================================================================== */
function boot() {
  state.token = sessionToken() || "";
  const params = new URLSearchParams(location.search);
  state.ref = (params.get("u") || params.get("id") || params.get("username") || "").trim();
  if (!state.ref) {
    const member = getMember();
    state.ref = member?.memberId || member?.username || member?.id || "";
  }
  if (!state.ref) {
    return showState(
      "user",
      "No profile selected",
      "Open your own profile from the dashboard, or pick a member in the search.",
      `<a class="btn btn--primary btn--sm" href="login.html"><i data-icon="login"></i> Sign in</a>`
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

/* ================================================================== */
/* messages — send a message, then the direct conversations            */
/* ================================================================== */
const MSG_FILTERS = [
  ["all", "All"],
  ["active", "Active"],
  ["suspended", "Suspended"],
];

const MSG_ACCEPT = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".pdf": "application/pdf",
  ".txt": "text/plain",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".zip": "application/zip",
  ".mp3": "audio/mpeg",
  ".mp4": "video/mp4",
};

async function refreshUnread() {
  if (!state.token) return;
  try {
    const res = await rpc("msg_unread", { p_token: state.token });
    state.messages.unread = Number(res?.unread || 0);
  } catch {
    state.messages.unread = 0;
  }
  renderMenu();
}

async function startMessage(ref = "") {
  if (!state.token) {
    return toast({ title: "Sign in to send a message", message: "Messages need a member session.", tone: "error" });
  }
  state.messages.to = ref;
  await switchView("messages");
  const input = el("[data-msg-to]");
  if (input) {
    input.focus?.();
    input.scrollIntoView?.({ block: "center", behavior: "smooth" });
  }
}

async function renderMessagesPanel() {
  const host = el("[data-pf-panel]");
  if (!state.token) {
    host.innerHTML = `<div class="pf-block">${emptyBlock("lock", "Sign in first", "Messages belong to a member account.")}</div>`;
    hydrateIcons(host);
    return;
  }
  host.innerHTML = messagesShell();
  hydrateIcons(host);
  await Promise.all([loadMessageList(), loadMessagePeople()]);
  if (state.messages.selected) await openThread(state.messages.selected);
}

function messagesShell() {
  const draft = state.messages;
  const files = draft.files
    .map(
      (file, index) => `
      <span class="pf-file">
        <i data-icon="file"></i>
        <span class="pf-file__name">${esc(file.name)}</span>
        <span class="pf-file__size">${sizeLabel(file.bytes)}</span>
        <button class="icon-btn" type="button" data-msg-file-remove="${index}" aria-label="Remove ${esc(file.name)}"><i data-icon="close"></i></button>
      </span>`
    )
    .join("");

  return `
    <div class="pf-block">
      <div class="pf-block__head">
        <span class="pf-block__title"><i data-icon="send"></i> Send a message</span>
        <span class="pf-block__note">By username or member ID.</span>
      </div>
      <div class="pf-grid-2">
        <div class="pf-row">
          <span class="pf-row__label">To</span>
          <input class="input" type="text" data-msg-to list="pf-msg-people" autocomplete="off"
            placeholder="@username or ID100003" value="${esc(draft.to)}" aria-label="Recipient" />
          <datalist id="pf-msg-people"></datalist>
        </div>
        <div class="pf-row">
          <span class="pf-row__label">Subject <span class="pf-row__hint">optional</span></span>
          <input class="input" type="text" maxlength="160" data-msg-subject value="${esc(draft.subject)}" aria-label="Subject" />
        </div>
      </div>
      <div class="pf-row">
        <span class="pf-row__label">Message</span>
        <textarea class="textarea" rows="4" maxlength="8000" data-msg-body placeholder="Write your message…" aria-label="Message">${esc(draft.body)}</textarea>
      </div>
      <div class="pf-row">
        <span class="pf-row__label">Attachments <span class="pf-row__hint">5 files, 5 MB each</span></span>
        <div class="pf-attach">
          <label class="btn btn--ghost btn--sm" style="cursor: pointer">
            <i data-icon="upload"></i> Add a file
            <input type="file" hidden multiple data-msg-files />
          </label>
          <div class="pf-attach__list" data-msg-file-list>${files || '<span class="pf-row__hint">No attachment.</span>'}</div>
        </div>
      </div>
      <div class="pf-msg-actions">
        <span class="pf-block__note" data-msg-note></span>
        <button class="btn btn--primary" type="button" data-msg-send><i data-icon="send"></i> Send</button>
      </div>
    </div>

    <div class="pf-block">
      <div class="pf-block__head">
        <span class="pf-block__title"><i data-icon="mail"></i> Direct messages</span>
        <div class="msg-tools">
          ${MSG_FILTERS.map(
            ([key, label]) =>
              `<button class="pf-choice ${state.messages.filter === key ? "is-active" : ""}" type="button" data-msg-filter="${key}">
                 ${label}<b data-msg-count="${key}">0</b>
               </button>`
          ).join("")}
          <button class="pf-choice ${state.messages.online ? "is-active" : ""}" type="button" data-msg-online aria-pressed="${state.messages.online}">
            <i data-icon="zap"></i> Online only
          </button>
        </div>
      </div>
      <div class="msg-split">
        <div class="msg-list" data-msg-list aria-live="polite"><div class="pf-block__note">Loading conversations…</div></div>
        <div class="msg-pane" data-msg-pane></div>
      </div>
    </div>`;
}

async function loadMessageList() {
  const list = el("[data-msg-list]");
  if (list) list.innerHTML = `<div class="pf-block__note">Loading conversations…</div>`;
  try {
    const res = await rpc("msg_list", {
      p_token: state.token,
      p_filter: state.messages.filter,
      p_online_only: state.messages.online,
      p_limit: 30,
      p_offset: 0,
    });
    state.messages.list = res?.conversations || [];
    state.messages.counts = res?.counts || {};
    state.messages.unread = Number(res?.counts?.unread || 0);
  } catch {
    state.messages.list = [];
  }
  paintMessageList();
  paintMessageCounts();
}

function paintMessageCounts() {
  const counts = state.messages.counts || {};
  qsa("[data-msg-count]").forEach((node) => {
    const key = node.dataset.msgCount;
    node.textContent = String(Number(counts[key] || 0));
  });
}

function paintMessageList() {
  const list = el("[data-msg-list]");
  if (!list) return;
  const rows = state.messages.list;
  if (!rows.length) {
    list.innerHTML = `<div class="pf-block__note">${
      state.messages.filter === "suspended"
        ? "No suspended conversation — everyone you write to accepts you."
        : state.messages.online
          ? "Nobody online right now."
          : "No conversation yet. Send the first message above."
    }</div>`;
    return;
  }
  list.innerHTML = rows
    .map(
      (row) => `
    <button class="msg-row ${state.messages.selected === row.id ? "is-active" : ""}" type="button" data-msg-open="${esc(row.id)}">
      <span class="pf-person__avatar">
        <img src="${esc(row.other?.avatar || avatarPlaceholder(row.other?.name || "?"))}" alt="" width="38" height="38" loading="lazy" />
        <i class="msg-row__dot ${row.other?.online ? "is-on" : ""}" aria-hidden="true"></i>
      </span>
      <span class="msg-row__body">
        <span class="msg-row__top">
          <b>${esc(row.other?.name || "Member")}</b>
          <time>${esc(timeAgo(row.last_message_at) || "")}</time>
        </span>
        <span class="msg-row__bottom">
          <span class="msg-row__preview">${esc(row.preview || "…")}</span>
          ${Number(row.unread) > 0 ? `<span class="msg-row__unread">${num(row.unread)}</span>` : ""}
        </span>
        <span class="msg-row__meta">
          ${esc(row.other?.username || "")}
          ${row.state !== "active" ? '<span class="badge badge--outline">suspended</span>' : ""}
          ${row.subject ? `<span class="badge">${esc(row.subject)}</span>` : ""}
        </span>
      </span>
    </button>`
    )
    .join("");
  hydrateIcons(list);
}

async function openThread(id) {
  state.messages.selected = id;
  const pane = el("[data-msg-pane]");
  if (pane) pane.innerHTML = `<div class="pf-block__note">Loading the conversation…</div>`;
  try {
    const res = await rpc("msg_thread", { p_token: state.token, p_conversation: id, p_limit: 50 });
    if (!res || res.ok === false) {
      state.messages.thread = null;
      if (pane) pane.innerHTML = `<div class="pf-block__note">${esc(msgError(res?.error))}</div>`;
      return;
    }
    state.messages.thread = res;
  } catch {
    state.messages.thread = null;
  }
  paintMessageList();
  paintThread();
  await refreshUnread();
}

function paintThread() {
  const pane = el("[data-msg-pane]");
  if (!pane) return;
  const thread = state.messages.thread;
  if (!thread) {
    pane.innerHTML = `<div class="msg-pane__empty">
        <i data-icon="mail"></i>
        <p>Pick a conversation on the left, or send the first message above.</p>
      </div>`;
    hydrateIcons(pane);
    return;
  }
  const other = thread.conversation?.other || {};
  const messages = thread.messages || [];

  pane.innerHTML = `
    <div class="msg-pane__head">
      <span class="pf-person__avatar">
        <img src="${esc(other.avatar || avatarPlaceholder(other.name || "?"))}" alt="" width="36" height="36" loading="lazy" />
      </span>
      <span class="msg-pane__who">
        <a href="${esc(profileUrl(other.username))}"><b>${esc(other.name || "Member")}</b></a>
        <span>${esc(other.username || "")} · ${esc(thread.conversation?.code || "")}
          ${other.online ? '<span class="badge badge--outline">online</span>' : ""}
          ${thread.conversation?.state !== "active" ? '<span class="badge">suspended</span>' : ""}
        </span>
      </span>
      <button class="icon-btn" type="button" data-msg-refresh aria-label="Refresh"><i data-icon="refresh"></i></button>
    </div>

    <div class="msg-thread" data-msg-thread>
      ${messages
        .map(
          (message) => `
        <div class="msg-bubble ${message.mine ? "is-mine" : ""}">
          ${message.body ? `<p>${esc(message.body)}</p>` : ""}
          ${
            (message.attachments || []).length
              ? `<div class="msg-bubble__files">${message.attachments
                  .map(
                    (file) => `<a class="pf-file" href="${esc(file.url || storageUrl(file.path || ""))}" target="_blank" rel="noopener noreferrer">
                      <i data-icon="file"></i>
                      <span class="pf-file__name">${esc(file.name || "file")}</span>
                      <span class="pf-file__size">${sizeLabel(file.bytes)}</span>
                    </a>`
                  )
                  .join("")}</div>`
              : ""
          }
          <time>${esc(timeAgo(message.created_at) || "")}</time>
        </div>`
        )
        .join("")}
    </div>

    <div class="msg-reply">
      <div class="pf-attach__list" data-msg-reply-files></div>
      <div class="pf-searchbar">
        <label class="icon-btn" aria-label="Attach a file" style="cursor: pointer">
          <i data-icon="upload"></i>
          <input type="file" hidden multiple data-msg-reply-input-file />
        </label>
        <input class="input" type="text" maxlength="8000" placeholder="Write a direct message…" data-msg-reply-input aria-label="Reply" />
        <button class="btn btn--primary" type="button" data-msg-reply><i data-icon="send"></i> Send</button>
      </div>
    </div>`;
  hydrateIcons(pane);
  const scroller = pane.querySelector("[data-msg-thread]");
  if (scroller) scroller.scrollTop = scroller.scrollHeight;
  paintReplyFiles();
}

function paintReplyFiles() {
  const host = el("[data-msg-reply-files]");
  if (!host) return;
  const files = state.messages.replyFiles || [];
  host.innerHTML = files
    .map(
      (file, index) => `
      <span class="pf-file">
        <i data-icon="file"></i>
        <span class="pf-file__name">${esc(file.name)}</span>
        <span class="pf-file__size">${sizeLabel(file.bytes)}</span>
        <button class="icon-btn" type="button" data-msg-reply-file-remove="${index}" aria-label="Remove"><i data-icon="close"></i></button>
      </span>`
    )
    .join("");
  hydrateIcons(host);
}

function msgError(error) {
  return (
    {
      session: "Sign in to read your messages.",
      not_found: "That member or conversation does not exist.",
      self: "You cannot send a message to yourself.",
      blocked: "A block is in place between you.",
      empty: "Write something or attach a file.",
      long: "The message is too long.",
      subject_long: "The subject is too long (160 characters).",
      attachments: "Five files at most.",
      forbidden: "This conversation is not yours.",
    }[error] || "Please try again."
  );
}

function sizeLabel(bytes) {
  const size = Number(bytes) || 0;
  if (!size) return "";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function readDraftFields() {
  const draft = state.messages;
  draft.to = el("[data-msg-to]")?.value?.trim() || draft.to;
  draft.subject = el("[data-msg-subject]")?.value || "";
  draft.body = el("[data-msg-body]")?.value || "";
  return draft;
}

async function loadMessagePeople() {
  const list = el("#pf-msg-people");
  if (!list) return;
  try {
    const res = await rpc("msg_people", { p_token: state.token, p_query: "", p_limit: 20 });
    state.messages.people = res?.people || [];
  } catch {
    state.messages.people = [];
  }
  list.innerHTML = state.messages.people
    .map(
      (person) =>
        `<option value="${esc(person.username)}">${esc(person.name)}${person.member_id ? ` · ${esc(person.member_id)}` : ""}</option>`
    )
    .join("");
}

async function uploadMessageFile(file) {
  const raw = file.name || "file";
  const ext = (raw.split(".").pop() || "").toLowerCase();
  if (!MSG_ACCEPT[`.${ext}`]) {
    throw new Error("That file type is not allowed (image, PDF, text, Word, ZIP, MP3 or MP4).");
  }
  if (file.size > 5 * 1024 * 1024) throw new Error("5 MB at most per file.");
  const safe = raw.replace(/[^A-Za-z0-9._-]/g, "_").slice(-40);
  const path = `users/messages/${Date.now()}_${Math.random().toString(36).slice(2, 7)}_${safe}`;
  const res = await fetch(`${SUPABASE.url}/storage/v1/object/source/${path}`, {
    method: "POST",
    headers: {
      apikey: SUPABASE.publishableKey,
      "Content-Type": file.type || MSG_ACCEPT[`.${ext}`],
      "x-upsert": "true",
    },
    body: file,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text.slice(0, 120) || `Upload failed (HTTP ${res.status}).`);
  }
  return { name: raw, path, mime: file.type || MSG_ACCEPT[`.${ext}`], bytes: file.size, url: storageUrl(path) };
}

async function addMessageFiles(files, target) {
  const bucket = target === "reply" ? (state.messages.replyFiles = state.messages.replyFiles || []) : state.messages.files;
  const note = el("[data-msg-note]");
  for (const file of Array.from(files || [])) {
    if (bucket.length >= 5) {
      if (note) note.textContent = "Five files at most.";
      break;
    }
    try {
      bucket.push(await uploadMessageFile(file));
    } catch (error) {
      if (note) note.textContent = error?.message || "Upload failed.";
      toast({ title: "Upload failed", message: error?.message || "Please try again.", tone: "error" });
    }
  }
  if (target === "reply") paintReplyFiles();
  else {
    const host = el("[data-msg-file-list]");
    if (host) {
      host.innerHTML = bucket.length
        ? bucket
            .map(
              (file, index) => `
            <span class="pf-file">
              <i data-icon="file"></i>
              <span class="pf-file__name">${esc(file.name)}</span>
              <span class="pf-file__size">${sizeLabel(file.bytes)}</span>
              <button class="icon-btn" type="button" data-msg-file-remove="${index}" aria-label="Remove"><i data-icon="close"></i></button>
            </span>`
            )
            .join("")
        : '<span class="pf-row__hint">No attachment.</span>';
      hydrateIcons(host);
    }
  }
}

async function sendMessage() {
  const draft = readDraftFields();
  if (!draft.to) {
    return toast({ title: "Who is it for?", message: "A username or a member ID is required.", tone: "error" });
  }
  if (!draft.body.trim() && !draft.files.length) {
    return toast({ title: "Nothing to send", message: "Write a message or attach a file.", tone: "error" });
  }
  const button = el("[data-msg-send]");
  if (button) button.disabled = true;
  try {
    const res = await rpc("msg_send", {
      p_token: state.token,
      p_ref: draft.to,
      p_subject: draft.subject,
      p_body: draft.body,
      p_attachments: draft.files.map(({ name, path, mime, bytes, url }) => ({ name, path, mime, bytes, url })),
    });
    if (!res || res.ok === false) {
      return toast({ title: "Not sent", message: msgError(res?.error), tone: "error" });
    }
    state.messages.body = "";
    state.messages.subject = "";
    state.messages.files = [];
    state.messages.selected = res.conversation?.id || null;
    const bodyInput = el("[data-msg-body]");
    if (bodyInput) bodyInput.value = "";
    const subjectInput = el("[data-msg-subject]");
    if (subjectInput) subjectInput.value = "";
    const fileList = el("[data-msg-file-list]");
    if (fileList) fileList.innerHTML = '<span class="pf-row__hint">No attachment.</span>';
    toast({
      title: res.created ? "Message sent" : "Message added",
      message: res.created ? "It is in their inbox — suspended until they answer unless they accept you." : "The conversation continues.",
      tone: "success",
    });
    await loadMessageList();
    if (state.messages.selected) await openThread(state.messages.selected);
  } catch (error) {
    toast({ title: "Not sent", message: error?.message || "Network error.", tone: "error" });
  } finally {
    if (button) button.disabled = false;
  }
}

async function replyMessage() {
  const input = el("[data-msg-reply-input]");
  const body = input?.value || "";
  const files = state.messages.replyFiles || [];
  if (!body.trim() && !files.length) return;
  const id = state.messages.selected;
  if (!id) return;
  const button = el("[data-msg-reply]");
  if (button) button.disabled = true;
  try {
    const res = await rpc("msg_reply", {
      p_token: state.token,
      p_conversation: id,
      p_body: body,
      p_attachments: files.map(({ name, path, mime, bytes, url }) => ({ name, path, mime, bytes, url })),
    });
    if (!res || res.ok === false) {
      return toast({ title: "Not sent", message: msgError(res?.error), tone: "error" });
    }
    state.messages.replyFiles = [];
    await openThread(id);
    await loadMessageList();
  } catch (error) {
    toast({ title: "Not sent", message: error?.message || "Network error.", tone: "error" });
  } finally {
    if (button) button.disabled = false;
  }
}
