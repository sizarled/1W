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
 * Posts (updates / activity / suggestions) are drawn as an empty state
 * until M2 `posts_core` lands — the tabs, counters and panels around them
 * are already in their final place.
 */

import { rpc, rest } from "./data.js";
import { qs, esc, num, formatDate, avatarPlaceholder, debounce } from "./utils.js";
import { hydrateIcons } from "./icons.js";
import { brand } from "./brands.js";
import { toast } from "./ui.js";
import { sessionToken, getMember } from "./session.js";

const LEVELS = {
  1: "Newcomer",
  2: "Viewer",
  3: "Regular",
  4: "Contributor",
  5: "Creator",
  6: "Publisher",
  7: "Merchant",
  8: "Partner",
};

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
};

/* ================================================================== */
/* helpers                                                             */
/* ================================================================== */
const el = (sel) => qs(sel);
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
async function load() {
  try {
    const data = await rpc("profile_public", { p_token: state.token, p_ref: state.ref || "" });
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
  } catch (error) {
    showState("info", "The profile could not be loaded", error?.message || "Check the connection and try again.");
  }
}

function showState(icon, title, text, action = "") {
  el("[data-pf-root]").hidden = true;
  const host = el("[data-pf-state]");
  host.hidden = false;
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
  el("[data-pf-state]").hidden = true;
  el("[data-pf-root]").hidden = false;
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
  img.hidden = false;
  el("[data-pf-side-initial]").hidden = Boolean(p.avatar);
  img.addEventListener("error", () => {
    img.hidden = true;
    el("[data-pf-side-initial]").hidden = false;
  });
  el("[data-pf-side-name]").textContent = p.name || p.username || "Member";
  el("[data-pf-side-username]").textContent = p.username || "";
  const idEl = el("[data-pf-side-id]");
  idEl.hidden = !p.member_id;
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
    img.hidden = false;
    el("[data-pf-avatar-initial]").hidden = true;
  } else {
    el("[data-pf-avatar-initial]").textContent = initial(name);
    img.hidden = true;
    el("[data-pf-avatar-initial]").hidden = false;
  }
  img.addEventListener("error", () => {
    img.hidden = true;
    el("[data-pf-avatar-initial]").hidden = false;
  });
  void avatar;

  el("[data-pf-name]").textContent = name;
  el("[data-pf-username]").textContent = p.username || "";

  const flags = [];
  if (p.level) flags.push(`<span class="badge badge--solid">L${p.level} · ${esc(LEVELS[p.level] || "Member")}</span>`);
  if (p.wealth !== null && p.wealth !== undefined) flags.push(`<span class="badge"><i data-icon="gem"></i> ${num(p.wealth)} pts</span>`);
  if (p.membership && p.membership !== "free") flags.push(`<span class="badge badge--outline"><i data-icon="crown"></i> ${esc(p.membership)}</span>`);
  el("[data-pf-flags]").innerHTML = flags.join("");

  const conn = el("[data-pf-conn]");
  const owner = state.data.relationship?.is_owner;
  if (p.online === null || p.online === undefined) {
    conn.hidden = true;
  } else {
    conn.hidden = false;
    conn.classList.toggle("is-on", p.online === true);
    el("[data-pf-conn-label]").textContent = p.online ? "Online" : "Offline";
    conn.title = owner && p.online !== null ? "Visitors see this only while “Connection status” is on." : "";
  }

  const desc = el("[data-pf-desc]");
  desc.hidden = !p.description;
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
    ${item("settings", "settings", "Settings")}
    <p class="pf-menu__title">In build</p>
    ${item("manage", "target", "Manage posts")}
    ${item("messages", "send", "Messages")}
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

  if (state.view === "manage" || state.view === "messages" || state.view === "publishers" || state.view === "participants") {
    host.innerHTML = renderSoon(state.view);
    hydrateIcons(host);
    return;
  }

  host.innerHTML = renderFeed(state.view, owner);
  hydrateIcons(host);
}

/* ================================================================== */
/* panels                                                              */
/* ================================================================== */
function renderFeed(kind, owner) {
  const s = state.data.stats;
  const copy = {
    updates:
      "Everything this profile follows lands here: profiles, keywords, blogs, community spaces, servers, studios and banks — translated posts included.",
    activity: "What this profile published, reshared, reacted to and commented on.",
    suggestions:
      "Posts suggested from the keywords this profile follows and from the interactions it had, ordered by ranking points.",
  }[kind];

  const feed = emptyBlock(
    kind === "suggestions" ? "sparkle" : "article",
    "No posts yet",
    copy,
    owner
      ? `<button class="btn btn--ghost btn--sm" type="button" data-pf-act="publish"><i data-icon="plus"></i> Publish the first post</button>`
      : ""
  );

  const stats = `
    <div class="pf-block">
      <div class="pf-block__head">
        <span class="pf-block__title"><i data-icon="chart"></i> Counters</span>
        <span class="pf-block__note">Posts are counted when they are published.</span>
      </div>
      <dl class="pf-stats" style="border: 0; margin: 0; padding: 0">
        <div><dt>Published</dt><dd>${num(s.posts)}</dd></div>
        <div><dt>Rank avg</dt><dd>${num(s.rank_avg)}</dd></div>
        <div><dt>Reach</dt><dd>${num(s.reach)}</dd></div>
      </dl>
    </div>`;

  return `<div class="pf-block">${feed}</div>${stats}`;
}

function renderSoon(view) {
  const meta = {
    manage: ["Manage posts", "Creator, Participant and Publisher tabs with open, edit, statistics, copy link and delete.", "M2 posts_core"],
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
        <span class="pf-block__note">Posts, filters and the ranking order arrive with M2.</span>
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

function publishSoon() {
  toast({
    title: "Publishing lands with M2",
    message: "The composer, visibility rules and scheduling are the next migration (posts_core).",
    tone: "info",
  });
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
    case "publish-here":
      return publishSoon();
    case "message":
      return toast({ title: "Messages land with M7", message: "The direct-message tables are the next step after publishing.", tone: "info" });
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
