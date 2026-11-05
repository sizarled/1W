/**
 * creator.html — the studio.
 * ------------------------------------------------------------------
 * Five things a member runs, one working area:
 *
 *   studio    videos · podcasts · playlists · studio management · subscribers
 *   blog      articles · drafts · categories · blog management · subscribers
 *   space     questions · answers · categories · space management · subscribers
 *   library   books · documents · categories · library management · subscribers
 *   gallery   images · categories · gallery management · subscribers
 *
 * The studio / blog / space / library / gallery is a *hub* on the server
 * (`creator_hubs`); the rows under every tab are items (`member_content`)
 * that hang from a hub. Every call is token-scoped and the server checks
 * that the caller owns the hub or sits in its staff list — the studio never
 * decides access on its own.
 *
 *   creator_hubs_list(token)          every hub the member owns or staffs
 *   creator_hub_save / _delete        the settings form
 *   creator_hub_staff / _vip          the two lists by member code
 *   creator_hub_unlock(hub, password) the private hub's door
 *   creator_subscribers(token, hub)   who follows it
 *   creator_categories / _save / _del the three-level tree
 *   creator_items(token, hub, kind)   every tab's table
 *   creator_item_save / _status / _del  the editor
 */
import { rpc } from "./data.js";
import { qs, qsa, esc, num, timeAgo } from "./utils.js";
import { hydrateIcons } from "./icons.js";
import { toast } from "./ui.js";
import { sessionToken, getMember, avatarFor } from "./session.js";

/* ================================================================== */
/* what hangs under each section                                      */
/* ================================================================== */
const COLS = {
  item: "Title",
  title: "Title",
  vis: "Visibility",
  cat: "Category",
  minutes: "Minutes",
  likes: "Likes",
  dislikes: "Dislikes",
  comments: "Comments",
  shares: "Shares",
  reports: "Reports",
  downloads: "Downloads",
  answers: "Answers",
  followers: "Followers",
  refollows: "Re-asks",
  replies: "Replies",
  lines: "Lines",
  words: "Words",
  chars: "Chars",
  space: "Space",
  parent: "Question",
  act: "",
};

const SECTIONS = [
  {
    key: "channel",
    slug: "studio",
    kind: "channel",
    label: "Studio",
    icon: "tv",
    noun: "studio",
    tabs: [
      { key: "videos", label: "Videos", type: "list", kind: "video", cols: ["item", "vis", "minutes", "likes", "dislikes", "comments", "shares", "reports", "act"], actions: ["edit", "link", "delete"] },
      { key: "podcasts", label: "Podcasts", type: "list", kind: "podcast", cols: ["item", "vis", "minutes", "likes", "dislikes", "comments", "shares", "reports", "act"], actions: ["edit", "link", "delete"] },
      { key: "playlists", label: "Playlists", type: "list", kind: "playlist", cols: ["item", "vis", "minutes", "likes", "dislikes", "comments", "shares", "reports", "act"], actions: ["edit", "link", "delete"] },
      { key: "settings", label: "Studio management", type: "settings" },
      { key: "subscribers", label: "Subscribers", type: "subscribers" },
    ],
    add: [
      { kind: "video", label: "Video" },
      { kind: "podcast", label: "Podcast" },
      { kind: "playlist", label: "Playlist" },
    ],
  },
  {
    key: "blog",
    slug: "blog",
    kind: "blog",
    label: "Blog",
    icon: "article",
    noun: "blog",
    tabs: [
      { key: "articles", label: "Articles", type: "list", kind: "article", status: "published", cols: ["item", "vis", "minutes", "likes", "dislikes", "comments", "reports", "act"], actions: ["preview", "edit", "link", "delete"] },
      { key: "drafts", label: "Drafts", type: "list", kind: "article", status: "draft", cols: ["item", "vis", "cat", "lines", "words", "chars", "act"], actions: ["publish", "preview", "delete"] },
      { key: "categories", label: "Categories", type: "categories" },
      { key: "settings", label: "Blog management", type: "settings" },
      { key: "subscribers", label: "Subscribers", type: "subscribers" },
    ],
    add: [
      { kind: "article", label: "Article" },
      { kind: "article", label: "Draft", draft: true },
      { category: true, label: "Category" },
    ],
  },
  {
    key: "space",
    slug: "space",
    kind: "space",
    label: "Space",
    icon: "help",
    noun: "space",
    tabs: [
      { key: "questions", label: "Questions", type: "list", kind: "question", cols: ["item", "space", "vis", "answers", "followers", "refollows", "act"], actions: ["edit", "close", "delete"] },
      { key: "answers", label: "Answers", type: "list", kind: "answer", cols: ["item", "parent", "vis", "likes", "dislikes", "replies", "reports", "act"], actions: ["open", "edit", "share", "delete"] },
      { key: "categories", label: "Categories", type: "categories" },
      { key: "settings", label: "Space management", type: "settings" },
      { key: "subscribers", label: "Subscribers", type: "subscribers" },
    ],
    add: [
      { kind: "question", label: "Question" },
      { category: true, label: "Category" },
    ],
  },
  {
    key: "library",
    slug: "library",
    kind: "library",
    label: "Library",
    icon: "database",
    noun: "library",
    tabs: [
      { key: "books", label: "Books", type: "list", kind: "book", cols: ["item", "vis", "minutes", "downloads", "likes", "dislikes", "comments", "shares", "reports", "act"], actions: ["open", "edit", "link", "delete"] },
      { key: "documents", label: "Documents", type: "list", kind: "document", cols: ["item", "vis", "minutes", "downloads", "likes", "dislikes", "comments", "shares", "reports", "act"], actions: ["open", "edit", "link", "delete"] },
      { key: "categories", label: "Categories", type: "categories" },
      { key: "settings", label: "Library management", type: "settings" },
      { key: "subscribers", label: "Subscribers", type: "subscribers" },
    ],
    add: [
      { kind: "book", label: "Book" },
      { kind: "document", label: "Document" },
      { category: true, label: "Category" },
    ],
  },
  {
    key: "gallery",
    slug: "gallery",
    kind: "gallery",
    label: "Gallery",
    icon: "image",
    noun: "gallery",
    tabs: [
      { key: "images", label: "Images", type: "list", kind: "image", cols: ["item", "vis", "minutes", "likes", "dislikes", "comments", "shares", "reports", "act"], actions: ["open", "edit", "link", "delete"] },
      { key: "categories", label: "Categories", type: "categories" },
      { key: "settings", label: "Gallery management", type: "settings" },
      { key: "subscribers", label: "Subscribers", type: "subscribers" },
    ],
    add: [
      { kind: "image", label: "Image" },
      { category: true, label: "Category" },
    ],
  },
];

const KIND_LABEL = {
  video: "Video",
  podcast: "Podcast",
  playlist: "Playlist",
  article: "Article",
  question: "Question",
  answer: "Answer",
  book: "Book",
  document: "Document",
  image: "Image",
};

const KIND_ICON = {
  video: "film",
  podcast: "mic",
  playlist: "bookmark",
  article: "article",
  question: "help",
  answer: "comment",
  book: "bookmark",
  document: "file",
  image: "image",
};

/* which fields an item of each kind asks for */
const KIND_FIELDS = {
  video: { media: "Media link (mp4 / stream)", body: "Description", words: false },
  podcast: { media: "Audio link", body: "Show notes", words: false },
  playlist: { media: "First item link", body: "Description", words: false },
  article: { media: "", body: "Body", words: true },
  question: { media: "", body: "Details", words: true },
  answer: { media: "", body: "Your answer", words: true },
  book: { media: "Ebook link (PDF / EPUB)", body: "Description", words: false },
  document: { media: "File link", body: "Description", words: false },
  image: { media: "Image link", body: "Description", words: false },
};

const AGES = [
  ["none", "Everyone"],
  ["13", "13+"],
  ["16", "16+"],
  ["18", "18+"],
];

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

const VISIBILITY = [
  ["public", "Public"],
  ["exclusive", "Exclusive"],
  ["private", "Private"],
];

const MESSAGES = {
  session: "Your session ended — sign in again.",
  hub: "That hub is not yours, or it is gone.",
  kind: "That kind of content does not belong in this hub.",
  visibility: "Pick public, exclusive or private.",
  title: "A published title needs between 3 and 200 characters.",
  name: "A name needs between 2 and 80 characters.",
  url: "Links must start with http:// or https://.",
  media: "This kind needs its link before it can be published.",
  body: "Not enough text to publish.",
  inactive: "Publishing needs an active membership.",
  limit: "This hub kind is at its limit for your level.",
  not_found: "That item is gone.",
  member: "No member with that code.",
  duplicate: "That name already exists here.",
  deep: "Categories stop at the third level.",
  status: "That status is not allowed.",
  parent: "Pick the question first.",
  staff: "One of those staff codes is not a member.",
  vip: "One of those VIP codes is not a member.",
  links: "Ten related links is the maximum.",
  password: "This hub has no password yet.",
  expired: "The password window has closed.",
  denied: "Wrong password.",
};

/* ================================================================== */
/* state                                                              */
/* ================================================================== */
const state = {
  token: "",
  member: null,
  hubs: [],
  limits: {},
  level: 1,
  section: "channel",
  hub: null,
  tab: null,
  view: "list",
  rows: [],
  counts: {},
  categories: [],
  subscribers: [],
  search: "",
  busy: false,
  editor: null,
  confirm: null,
  saveState: { tone: "", text: "" },
};

const el = (sel, root = document) => qs(sel, root);
const sectionOf = (key) => SECTIONS.find((s) => s.key === key) || SECTIONS[0];
const sectionFromUrl = (value) =>
  SECTIONS.find((s) => s.key === value || s.slug === value) || null;
const slugOf = (section) => section.slug || section.key;
const hubKind = () => sectionOf(state.section).kind;

function hubsOf(kind) {
  return state.hubs.filter((h) => h.kind === kind);
}

function currentHub() {
  return state.hubs.find((h) => h.id === state.hub) || null;
}

const visLabel = (v) => ({ public: "Public", exclusive: "Exclusive", private: "Private" }[v] || "Public");
const numCell = (value) =>
  `<td class="cr-num ${Number(value) ? "" : "is-zero"}">${esc(num(Number(value) || 0))}</td>`;

/* ================================================================== */
/* page states                                                        */
/* ================================================================== */
function showGate(iconName, title, text, actions = "") {
  const host = el("[data-cr-state]");
  const shell = el("[data-cr-shell]");
  if (shell) {
    shell.hidden = true;
    shell.style.display = "none";
  }
  if (!host) return;
  host.hidden = false;
  host.style.display = "";
  host.innerHTML = `
    <div class="cr-gate">
      <span class="cr-gate__icon"><i data-icon="${esc(iconName)}"></i></span>
      <h1 class="cr-gate__title">${esc(title)}</h1>
      <p class="cr-gate__text">${esc(text)}</p>
      ${actions ? `<div class="cr-gate__actions">${actions}</div>` : ""}
    </div>`;
  hydrateIcons(host);
}

function showShell() {
  const host = el("[data-cr-state]");
  const shell = el("[data-cr-shell]");
  if (host) {
    host.hidden = true;
    host.style.display = "none";
  }
  if (shell) {
    shell.hidden = false;
    shell.style.display = "";
  }
}

/* ================================================================== */
/* rail                                                               */
/* ================================================================== */
function renderRail() {
  const member = state.member || {};
  const name = member.full_name || member.username || "Member";
  const img = el("[data-cr-avatar-img]");
  const initial = el("[data-cr-avatar-initial]");
  const url = member.avatar_url || avatarFor(member, name);
  if (img) {
    if (url) {
      img.src = url;
      img.hidden = false;
      img.style.display = "";
    } else {
      img.hidden = true;
      img.style.display = "none";
    }
  }
  if (initial) {
    initial.textContent = (String(name).trim()[0] || "1").toUpperCase();
    if (url) {
      initial.hidden = true;
      initial.style.display = "none";
    }
  }
  const nameNode = el("[data-cr-name]");
  if (nameNode) nameNode.textContent = name;
  const handle = el("[data-cr-username]");
  if (handle) handle.textContent = member.username ? (String(member.username).startsWith("@") ? member.username : `@${member.username}`) : `@${member.member_id || "member"}`;
  const code = el("[data-cr-code]");
  if (code) {
    code.textContent = member.member_id || "";
    code.hidden = !member.member_id;
  }

  const nav = el("[data-cr-sections]");
  if (!nav) return;
  nav.innerHTML = SECTIONS.map((section) => {
    const used = hubsOf(section.kind).length;
    const limit = Number(state.limits?.[section.kind]?.limit || 0);
    const on = state.section === section.key;
    return `
      <button class="cr-section ${on ? "is-on" : ""}" type="button" data-cr-section="${esc(section.key)}" aria-current="${on ? "page" : "false"}">
        <i data-icon="${esc(section.icon)}"></i>
        <span class="cr-section__name">${esc(section.label)}</span>
        <span class="cr-section__count ${limit && used >= limit ? "is-full" : ""}" title="${used} of ${limit} ${esc(section.label.toLowerCase())}">${used}/${limit || "—"}</span>
      </button>`;
  }).join("");
  hydrateIcons(nav);
}

/* ================================================================== */
/* the top bar                                                        */
/* ================================================================== */
function renderTop() {
  const section = sectionOf(state.section);
  const hubs = hubsOf(section.kind);
  const select = el("[data-cr-hub]");
  if (select) {
    select.innerHTML = hubs.length
      ? hubs
          .map(
            (hub) =>
              `<option value="${esc(hub.id)}" ${hub.id === state.hub ? "selected" : ""}>${esc(hub.name)} — ${esc(num(hub.subscribers || 0))} subscribers</option>`
          )
          .join("") + `<option value="__new">＋ Add a ${esc(section.noun)}</option>`
      : `<option value="">No ${esc(section.noun)} yet</option><option value="__new">＋ Add a ${esc(section.noun)}</option>`;
    select.value = state.hub || (hubs.length ? hubs[0].id : "__new");
  }

  const limit = state.limits?.[section.kind] || { used: hubs.length, limit: 0 };
  const hint = el("[data-cr-hub-hint]");
  if (hint) {
    const full = Number(limit.limit) && Number(limit.used) >= Number(limit.limit);
    hint.classList.toggle("is-full", Boolean(full));
    hint.textContent = `${limit.used || hubs.length} of ${limit.limit || "—"} ${section.noun}s on your level · level ${state.level}`;
  }

  const menu = el("[data-cr-add-menu]");
  if (menu) {
    menu.innerHTML = [
      ...section.add.map(
        (entry) =>
          entry.category
            ? `<button class="cr-drop__item" type="button" data-cr-add="category"><i data-icon="filter"></i> Category</button>`
            : `<button class="cr-drop__item" type="button" data-cr-add="${esc(entry.kind)}" data-draft="${entry.draft ? "1" : "0"}"><i data-icon="${esc(KIND_ICON[entry.kind] || "plus")}"></i> ${esc(entry.label)}</button>`
      ),
      `<span class="cr-drop__sep"></span>`,
      `<button class="cr-drop__item" type="button" data-cr-add="hub"><i data-icon="plus"></i> New ${esc(section.noun)}</button>`,
    ].join("");
    hydrateIcons(menu);
  }
}

function renderHubHead() {
  const host = el("[data-cr-hubhead]");
  if (!host) return;
  const hub = currentHub();
  if (!hub) {
    host.hidden = true;
    host.style.display = "none";
    host.innerHTML = "";
    return;
  }
  host.hidden = false;
  host.style.display = "";
  const logo = hub.logo_url
    ? `<img src="${esc(hub.logo_url)}" alt="" width="40" height="40" />`
    : esc(String(hub.name || "?").trim().slice(0, 2).toUpperCase());
  host.innerHTML = `
    <span class="cr-hubhead__logo">${logo}</span>
    <div class="cr-hubhead__id">
      <span class="cr-hubhead__name">${esc(hub.name)}</span>
      <span class="cr-hubhead__sub">${esc(hub.field || "No field yet")}${hub.niches?.length ? ` · ${esc(hub.niches.join(", "))}` : ""}${hub.owned === false ? " · staff access" : ""}</span>
    </div>
    <div class="cr-hubhead__stats">
      <span class="cr-pill" data-tone="${esc(hub.visibility)}"><i data-icon="shield"></i>${esc(visLabel(hub.visibility))}</span>
      <span class="cr-pill"><i data-icon="users"></i>${esc(num(hub.subscribers || 0))}</span>
      <span class="cr-pill"><i data-icon="file"></i>${esc(num(hub.items || 0))}</span>
      <span class="cr-pill"><i data-icon="clock"></i>${esc(num(hub.minutes || 0))} min</span>
      <span class="cr-pill"><i data-icon="thumbUp"></i>${esc(num(hub.likes || 0))}</span>
      <span class="cr-pill"><i data-icon="flag"></i>${esc(num(hub.reports || 0))}</span>
    </div>`;
  hydrateIcons(host);
}

/* ================================================================== */
/* tabs                                                               */
/* ================================================================== */
function renderTabs() {
  const section = sectionOf(state.section);
  const host = el("[data-cr-tabs]");
  if (!host) return;
  host.innerHTML = section.tabs
    .map(
      (tab) =>
        `<button class="cr-tab ${state.tab === tab.key ? "is-on" : ""}" type="button" role="tab" aria-selected="${state.tab === tab.key}" data-cr-tab="${esc(tab.key)}">${esc(tab.label)}</button>`
    )
    .join("");
}

/* ================================================================== */
/* the view                                                           */
/* ================================================================== */
function renderView() {
  const host = el("[data-cr-view]");
  if (!host) return;
  const section = sectionOf(state.section);
  const tab = section.tabs.find((t) => t.key === state.tab) || section.tabs[0];

  if (state.view === "editor" && state.editor) return renderEditor(host);

  const hub = currentHub();
  if (!hub) {
    host.innerHTML = emptyBlock(
      section.icon,
      `No ${section.noun} yet`,
      `Create your first ${section.noun}: a name, a logo, a description, one field and up to five niches. You can run ${state.limits?.[section.kind]?.limit || 0} at level ${state.level}.`,
      `<button class="dsh-btn dsh-btn--primary dsh-btn--sm" type="button" data-cr-new-hub><i data-icon="plus"></i> Add a ${esc(section.noun)}</button>`
    );
    hydrateIcons(host);
    return;
  }

  if (tab.type === "settings") return renderSettings(host, hub);
  if (tab.type === "subscribers") return renderSubscribers(host, hub);
  if (tab.type === "categories") return renderCategories(host, hub);
  return renderList(host, hub, tab);
}

function emptyBlock(iconName, title, text, action = "") {
  return `
    <div class="cr-empty">
      <i data-icon="${esc(iconName)}"></i>
      <p class="cr-empty__title">${esc(title)}</p>
      <p class="cr-empty__text">${esc(text)}</p>
      ${action}
    </div>`;
}

/* ------------------------------------------------------------------ */
/* a table                                                            */
/* ------------------------------------------------------------------ */
function titleCell(row) {
  const thumb = row.thumbnail
    ? `<img class="cr-thumb" src="${esc(row.thumbnail)}" alt="" width="46" height="30" loading="lazy" />`
    : `<span class="cr-thumb cr-thumb--empty"><i data-icon="${esc(KIND_ICON[row.kind] || "file")}"></i></span>`;
  return `
    <div style="display:flex;align-items:center;gap:0.55rem;min-width:0">
      ${thumb}
      <span class="cr-title">
        <strong>${esc(row.title || "Untitled")}</strong>
        <span class="cr-code">${esc(row.code || "")}</span>
      </span>
    </div>`;
}

function cellFor(key, row, tab) {
  switch (key) {
    case "item":
      return `<td>${titleCell(row)}</td>`;
    case "vis":
      return `<td><span class="cr-vis" data-vis="${esc(row.visibility)}">${esc(visLabel(row.visibility))}</span></td>`;
    case "cat":
      return `<td>${esc(row.category_name || "—")}</td>`;
    case "minutes":
    case "likes":
    case "dislikes":
    case "comments":
    case "shares":
    case "reports":
    case "downloads":
    case "answers":
    case "followers":
    case "refollows":
    case "replies":
    case "lines":
    case "words":
    case "chars":
      return numCell(row[key]);
    case "space":
      return `<td>${esc(currentHub()?.name || "—")}</td>`;
    case "parent":
      return `<td>${esc(row.parent_title || "—")}</td>`;
    case "act":
      return `<td><div class="dsh-table__actions">${actionMenu(row, tab)}</div></td>`;
    default:
      return "<td>—</td>";
  }
}

const ACTION_LABEL = {
  open: ["Open", "eye"],
  edit: ["Edit", "settings"],
  preview: ["Preview", "eye"],
  link: ["Copy link", "link"],
  publish: ["Publish", "upload"],
  close: ["Close", "lock"],
  share: ["Share", "share"],
  delete: ["Delete", "trash"],
};

function actionMenu(row, tab) {
  const items = (tab.actions || [])
    .map((action) => {
      const [label, ico] = ACTION_LABEL[action] || [action, "dots"];
      return `<button class="cr-act__item" type="button" data-cr-act="${esc(action)}" data-id="${esc(row.id)}" data-tone="${action === "delete" ? "danger" : ""}"><i data-icon="${esc(ico)}"></i> ${esc(label)}</button>`;
    })
    .join("");
  return `
    <details class="cr-act">
      <summary aria-label="Actions for ${esc(row.title || "item")}"><i data-icon="dots"></i></summary>
      <div class="cr-act__menu">${items}</div>
    </details>`;
}

function rowsFiltered(rows) {
  const q = state.search.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter((row) =>
    [row.title, row.summary, row.code, row.category_name, row.parent_title, row.visibility]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
      .includes(q)
  );
}

function renderList(host, hub, tab) {
  const rows = rowsFiltered(state.rows);
  const counts = state.counts || {};
  const head = `
    <div class="cr-bar">
      <div class="cr-bar__left">
        <span class="cr-bar__title">${esc(tab.label)}</span>
        <span class="cr-bar__count">${rows.length} shown · ${esc(num(counts.all || 0))} in this ${esc(sectionOf(state.section).noun)}</span>
      </div>
      <label class="cr-search">
        <i data-icon="search" aria-hidden="true"></i>
        <input class="dsh-input" type="search" placeholder="Search ${esc(tab.label.toLowerCase())}" aria-label="Search this table" data-cr-search value="${esc(state.search)}" />
      </label>
    </div>`;

  const table = rows.length
    ? `<div class="dsh-table-wrap cr-table"><table class="dsh-table">
        <thead><tr>${tab.cols.map((key) => `<th>${esc(COLS[key] || key)}</th>`).join("")}</tr></thead>
        <tbody>${rows
          .map((row) => `<tr data-row="${esc(row.id)}">${tab.cols.map((key) => cellFor(key, row, tab)).join("")}</tr>`)
          .join("")}</tbody>
      </table></div>`
    : emptyBlock(
        tab.kind ? KIND_ICON[tab.kind] : "file",
        state.search ? "Nothing matches this search" : `No ${tab.label.toLowerCase()} yet`,
        state.search
          ? "Clear the search, or add something new."
          : `Add the first one from “Add content” — it appears here with its numbers as soon as it is saved.`
      );

  host.innerHTML = head + table;
  hydrateIcons(host);
}

/* ------------------------------------------------------------------ */
/* settings                                                           */
/* ------------------------------------------------------------------ */
function renderSettings(host, hub) {
  const section = sectionOf(state.section);
  const links = Array.isArray(hub.links) ? hub.links : [];
  const linkRows = (links.length ? links : [{ label: "", url: "" }])
    .map(
      (link, index) => `
      <div class="cr-link-row" data-link-row data-index="${index}">
        <input class="dsh-input" type="text" maxlength="40" value="${esc(link.label || "")}" placeholder="Label" data-link-label />
        <input class="dsh-input" type="url" value="${esc(link.url || "")}" placeholder="https://…" data-link-url />
        <button class="dsh-btn dsh-btn--sm" type="button" data-cr-link-remove aria-label="Remove link"><i data-icon="trash"></i></button>
      </div>`
    )
    .join("");

  host.innerHTML = `
    <div class="cr-settings" data-settings="${esc(hub.id)}">
      <div class="cr-card">
        <div class="cr-card__head">
          <h2 class="cr-card__title">${esc(section.label)} identity</h2>
          <span class="cr-bar__count">${hub.owned === false ? "You are staff on this one" : "You own this one"}</span>
        </div>

        <div class="cr-logo-row">
          <span class="cr-logo-row__mark" data-logo-mark>
            ${hub.logo_url ? `<img src="${esc(hub.logo_url)}" alt="" width="64" height="64" />` : '<i data-icon="image"></i>'}
          </span>
          <label class="dsh-field">
            <span class="dsh-field__label">Logo link</span>
            <input class="dsh-input" type="url" value="${esc(hub.logo_url || "")}" placeholder="https://…/logo.png" data-hub-logo />
          </label>
        </div>

        <div class="cr-cover-row">
          <span class="cr-cover-row__mark" data-cover-mark>
            ${hub.cover_url ? `<img src="${esc(hub.cover_url)}" alt="" width="108" height="62" />` : '<i data-icon="image"></i>'}
          </span>
          <label class="dsh-field">
            <span class="dsh-field__label">Cover link</span>
            <input class="dsh-input" type="url" value="${esc(hub.cover_url || "")}" placeholder="https://…/cover.jpg" data-hub-cover />
          </label>
        </div>

        <label class="dsh-field">
          <span class="dsh-field__label">Name</span>
          <input class="dsh-input" type="text" maxlength="80" value="${esc(hub.name || "")}" data-hub-name />
        </label>

        <label class="dsh-field">
          <span class="dsh-field__label">Description</span>
          <textarea class="dsh-textarea" rows="3" maxlength="600" data-hub-description>${esc(hub.description || "")}</textarea>
        </label>

        <div class="cr-grid2">
          <label class="dsh-field">
            <span class="dsh-field__label">Field — one only</span>
            <input class="dsh-input" type="text" maxlength="40" value="${esc(hub.field || "")}" placeholder="Cinema" data-hub-field />
          </label>
          <label class="dsh-field">
            <span class="dsh-field__label">Niches — up to five, comma separated</span>
            <input class="dsh-input" type="text" maxlength="200" value="${esc((hub.niches || []).join(", "))}" placeholder="Documentary, Essay" data-hub-niches />
          </label>
        </div>
      </div>

      <div class="cr-card">
        <div class="cr-card__head"><h2 class="cr-card__title">Related links</h2><span class="cr-bar__count">up to ten</span></div>
        <div class="cr-chips" data-links>${linkRows}</div>
        <div><button class="dsh-btn dsh-btn--sm" type="button" data-cr-link-add><i data-icon="plus"></i> Add a link</button></div>
      </div>

      <div class="cr-card">
        <div class="cr-card__head"><h2 class="cr-card__title">Who sees it</h2></div>
        <div class="cr-grid3">
          <label class="dsh-field">
            <span class="dsh-field__label">Visibility</span>
            <select class="dsh-select" data-hub-visibility>
              ${VISIBILITY.map(([value, label]) => `<option value="${value}" ${hub.visibility === value ? "selected" : ""}>${label}${value === "public" ? " — anyone" : value === "exclusive" ? " — subscribers" : " — password / VIP"}</option>`).join("")}
            </select>
          </label>
          <label class="dsh-field cr-hidden-field" data-hub-pass-wrap ${hub.visibility === "private" ? "" : "hidden"}>
            <span class="dsh-field__label">Password</span>
            <input class="dsh-input" type="text" maxlength="60" value="" placeholder="${hub.locked ? "•••• (unchanged)" : "set a password"}" data-hub-password autocomplete="new-password" />
          </label>
          <label class="dsh-field cr-hidden-field" data-hub-hours-wrap ${hub.visibility === "private" ? "" : "hidden"}>
            <span class="dsh-field__label">Valid for</span>
            <select class="dsh-select" data-hub-hours>
              ${[[1, "1 hour"], [6, "6 hours"], [24, "1 day"], [72, "3 days"], [168, "1 week"], [336, "2 weeks"], [720, "1 month"]]
                .map(([hours, label]) => `<option value="${hours}" ${hours === 24 ? "selected" : ""}>${label}</option>`)
                .join("")}
            </select>
          </label>
        </div>
        <p class="cr-card__hint">${hub.password_until ? `The current password closes on ${esc(new Date(hub.password_until).toLocaleString())}.` : "A private hub asks for its password before anything opens; the window runs from one hour to one month."}</p>
      </div>

      <div class="cr-card">
        <div class="cr-card__head">
          <h2 class="cr-card__title">Staff</h2>
          <span class="cr-bar__count">they see this ${esc(section.noun)} in their own studio</span>
        </div>
        <div class="cr-chips" data-staff>
          ${(hub.staff || []).map((code) => `<span class="cr-chip-x">${esc(code)}<button type="button" data-cr-chip-remove="staff" data-code="${esc(code)}" aria-label="Remove ${esc(code)} from staff"><i data-icon="close"></i></button></span>`).join("") || '<span class="cr-card__hint">Nobody yet.</span>'}
        </div>
        <label class="dsh-field">
          <span class="dsh-field__label">Member codes — comma separated</span>
          <input class="dsh-input" type="text" placeholder="ID100003, ID100015" data-hub-staff />
        </label>
      </div>

      <div class="cr-card">
        <div class="cr-card__head">
          <h2 class="cr-card__title">VIP list</h2>
          <span class="cr-bar__count">${(hub.vip || []).length} member${(hub.vip || []).length === 1 ? "" : "s"}</span>
        </div>
        <div class="cr-chips" data-vip>
          ${(hub.vip || []).map((code) => `<span class="cr-chip-x">${esc(code)}<button type="button" data-cr-chip-remove="vip" data-code="${esc(code)}" aria-label="Remove ${esc(code)} from VIP"><i data-icon="close"></i></button></span>`).join("") || '<span class="cr-card__hint">Nobody yet — add a member code to let them in even when the hub is private.</span>'}
        </div>
        <label class="dsh-field">
          <span class="dsh-field__label">Member codes — comma separated</span>
          <input class="dsh-input" type="text" placeholder="ID100015" data-hub-vip />
        </label>
      </div>

      <div class="cr-save">
        <span class="cr-save__state" data-hub-state></span>
        <button class="dsh-btn dsh-btn--primary dsh-btn--sm" type="button" data-cr-save-hub><i data-icon="check"></i> Save ${esc(section.noun)}</button>
      </div>

      ${
        hub.owned === false
          ? ""
          : `<div class="cr-danger">
              <p class="cr-danger__text">Deleting the ${esc(section.noun)} removes everything under it — its items, categories and subscribers. This cannot be undone.</p>
              <button class="dsh-btn dsh-btn--sm dsh-btn--danger" type="button" data-cr-delete-hub><i data-icon="trash"></i> Delete ${esc(section.noun)}</button>
            </div>`
      }
    </div>`;
  hydrateIcons(host);
}

/* ------------------------------------------------------------------ */
/* subscribers                                                        */
/* ------------------------------------------------------------------ */
function renderSubscribers(host, hub) {
  const rows = state.subscribers || [];
  host.innerHTML = `
    <div class="cr-bar">
      <div class="cr-bar__left">
        <span class="cr-bar__title">Subscribers</span>
        <span class="cr-bar__count">${esc(num(rows.length))} member${rows.length === 1 ? "" : "s"} · ${esc(num(hub.subscribers || 0))} counted</span>
      </div>
      <span class="cr-pill"><i data-icon="users"></i>${esc(num(hub.vip?.length || 0))} VIP · ${esc(num(hub.staff?.length || 0))} staff</span>
    </div>
    ${
      rows.length
        ? `<div class="dsh-table-wrap cr-table"><table class="dsh-table">
            <thead><tr><th>Member</th><th>Code</th><th>Country</th><th>Subscribed</th></tr></thead>
            <tbody>${rows
              .map(
                (row) => `<tr>
                  <td><strong>${esc(row.name || "Member")}</strong> <span class="cr-code">${esc(row.username || "")}</span></td>
                  <td class="cr-code">${esc(row.code || "—")}</td>
                  <td>${esc(row.country || "—")}</td>
                  <td>${esc(timeAgo(row.since) || "—")}</td>
                </tr>`
              )
              .join("")}</tbody>
          </table></div>`
        : emptyBlock("users", "No subscriber yet", `When a member subscribes to your ${sectionOf(state.section).noun}, they appear here with their code, country and date.`)
    }`;
  hydrateIcons(host);
}

/* ------------------------------------------------------------------ */
/* categories                                                         */
/* ------------------------------------------------------------------ */
function renderCategories(host, hub) {
  const rows = state.categories || [];
  const byParent = new Map();
  rows.forEach((row) => {
    const key = row.parent || "root";
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key).push(row);
  });

  const ordered = [];
  const walk = (parent, depth) => {
    (byParent.get(parent) || []).forEach((row) => {
      ordered.push({ ...row, depth });
      walk(row.id, depth + 1);
    });
  };
  walk("root", 1);

  const options = ordered
    .filter((row) => row.level < 3)
    .map((row) => `<option value="${esc(row.id)}">${"— ".repeat(row.level - 1)}${esc(row.name)}</option>`)
    .join("");

  host.innerHTML = `
    <div class="cr-card">
      <div class="cr-card__head">
        <h2 class="cr-card__title">Categories</h2>
        <span class="cr-bar__count">main → second → last · three levels</span>
      </div>
      ${
        ordered.length
          ? `<div class="dsh-table-wrap cr-table"><table class="dsh-table">
              <thead><tr><th>Name</th><th>Level</th><th>Items</th><th></th></tr></thead>
              <tbody>${ordered
                .map(
                  (row) => `<tr>
                    <td><div class="cr-cat cr-cat--l${row.level}"><span class="cr-cat__lvl">${row.level}</span><span class="cr-cat__name">${esc(row.name)}</span></div></td>
                    <td>${row.level === 1 ? "Main" : row.level === 2 ? "Second" : "Last"}</td>
                    <td class="cr-num">${esc(num(row.items || 0))}</td>
                    <td><div class="dsh-table__actions">
                      <button class="dsh-btn dsh-btn--sm" type="button" data-cr-cat-del="${esc(row.id)}"><i data-icon="trash"></i> Delete</button>
                    </div></td>
                  </tr>`
                )
                .join("")}</tbody>
            </table></div>`
          : emptyBlock("filter", "No category yet", "Categories organise what sits in this hub. The first one is the main category; a second and a third can sit under it.")
      }
      <div class="cr-grid3">
        <label class="dsh-field">
          <span class="dsh-field__label">Name</span>
          <input class="dsh-input" type="text" maxlength="60" placeholder="Documentary" data-cat-name />
        </label>
        <label class="dsh-field">
          <span class="dsh-field__label">Under</span>
          <select class="dsh-select" data-cat-parent><option value="">Nothing — a main category</option>${options}</select>
        </label>
        <div style="display:flex;align-items:flex-end">
          <button class="dsh-btn dsh-btn--primary dsh-btn--sm" type="button" data-cr-cat-add><i data-icon="plus"></i> Add category</button>
        </div>
      </div>
    </div>`;
  hydrateIcons(host);
}

/* ------------------------------------------------------------------ */
/* the item editor                                                    */
/* ------------------------------------------------------------------ */
function blankItem(kind, hubId, status = "draft") {
  return {
    id: null,
    hub: hubId,
    kind,
    title: "",
    summary: "",
    body: "",
    media_url: "",
    thumbnail_url: "",
    cover_url: "",
    tags: [],
    language: "en",
    age_rating: "none",
    visibility: "public",
    category: null,
    parent: null,
    micro_niche: "",
    nano_niche: "",
    status,
  };
}

function renderEditor(host) {
  const draft = state.editor;
  const fields = KIND_FIELDS[draft.kind] || {};
  const hub = currentHub();
  const categories = state.categories || [];
  const questions = (state.questions || []).filter((row) => row.id !== draft.id);
  const catOptions = categories
    .map((row) => `<option value="${esc(row.id)}" ${draft.category === row.id ? "selected" : ""}>${"— ".repeat(row.level - 1)}${esc(row.name)}</option>`)
    .join("");

  host.innerHTML = `
    <div class="cr-editor">
      <div class="cr-editor__head">
        <button class="cr-editor__back" type="button" data-cr-editor-back><i data-icon="arrowLeft"></i> Back to ${esc(sectionOf(state.section).noun)}</button>
        <span class="cr-editor__kind"><i data-icon="${esc(KIND_ICON[draft.kind] || "file")}"></i> ${esc(KIND_LABEL[draft.kind] || draft.kind)} · ${draft.id ? esc(draft.status) : "new"}</span>
      </div>

      <div class="cr-card">
        <label class="dsh-field">
          <span class="dsh-field__label">${draft.kind === "question" ? "The question" : "Title"}</span>
          <input class="dsh-input" type="text" maxlength="200" value="${esc(draft.title || "")}" placeholder="Give it a name" data-item-title />
        </label>
        <div class="cr-grid2">
          <label class="dsh-field">
            <span class="dsh-field__label">Thumbnail link</span>
            <input class="dsh-input" type="url" value="${esc(draft.thumbnail_url || "")}" placeholder="https://…" data-item-thumb />
          </label>
          <label class="dsh-field">
            <span class="dsh-field__label">Summary</span>
            <input class="dsh-input" type="text" maxlength="320" value="${esc(draft.summary || "")}" placeholder="One line" data-item-summary />
          </label>
        </div>
        ${
          fields.media
            ? `<label class="dsh-field">
                 <span class="dsh-field__label">${esc(fields.media)}</span>
                 <input class="dsh-input" type="url" value="${esc(draft.media_url || "")}" placeholder="https://…" data-item-media />
               </label>`
            : ""
        }
      </div>

      <div class="cr-card">
        <label class="dsh-field">
          <span class="dsh-field__label">${esc(draft.kind === "question" ? "Details" : fields.body || "Body")}</span>
          <textarea class="dsh-textarea cr-editor__body ${draft.kind === "article" ? "dsh-textarea--tall" : ""}" rows="10" data-item-body>${esc(draft.body || "")}</textarea>
        </label>
        <p class="cr-card__hint" data-item-count>${esc(num(String(draft.body || "").trim() ? String(draft.body).trim().split(/\s+/).filter(Boolean).length : 0))} words</p>
      </div>

      <div class="cr-card">
        <div class="cr-grid3">
          <label class="dsh-field">
            <span class="dsh-field__label">Visibility</span>
            <select class="dsh-select" data-item-visibility>
              ${VISIBILITY.map(([value, label]) => `<option value="${value}" ${draft.visibility === value ? "selected" : ""}>${label}</option>`).join("")}
            </select>
          </label>
          ${
            categories.length
              ? `<label class="dsh-field">
                   <span class="dsh-field__label">Category</span>
                   <select class="dsh-select" data-item-category><option value="">None</option>${catOptions}</select>
                 </label>`
              : ""
          }
          ${
            draft.kind === "answer"
              ? `<label class="dsh-field">
                   <span class="dsh-field__label">Answers the question</span>
                   <select class="dsh-select" data-item-parent>
                     <option value="">Pick one</option>
                     ${questions.map((row) => `<option value="${esc(row.id)}" ${draft.parent === row.id ? "selected" : ""}>${esc(row.title)}</option>`).join("")}
                   </select>
                 </label>`
              : ""
          }
        </div>

        <div class="cr-grid2">
          <label class="dsh-field">
            <span class="dsh-field__label">Micro niche</span>
            <input class="dsh-input" type="text" maxlength="30" value="${esc(draft.micro_niche || "")}" placeholder="silent cinema" data-item-micro />
          </label>
          <label class="dsh-field">
            <span class="dsh-field__label">Nano niche</span>
            <input class="dsh-input" type="text" maxlength="30" value="${esc(draft.nano_niche || "")}" placeholder="1920s Berlin" data-item-nano />
          </label>
        </div>

        <div class="cr-grid3">
          <label class="dsh-field">
            <span class="dsh-field__label">Age</span>
            <select class="dsh-select" data-item-age>
              ${AGES.map(([value, label]) => `<option value="${value}" ${String(draft.age_rating) === value ? "selected" : ""}>${label}</option>`).join("")}
            </select>
          </label>
          <label class="dsh-field">
            <span class="dsh-field__label">Language</span>
            <select class="dsh-select" data-item-language>
              ${LANGUAGES.map(([value, label]) => `<option value="${value}" ${draft.language === value ? "selected" : ""}>${label}</option>`).join("")}
            </select>
          </label>
          <label class="dsh-field">
            <span class="dsh-field__label">Tags — comma separated</span>
            <input class="dsh-input" type="text" maxlength="220" value="${esc((draft.tags || []).join(", "))}" data-item-tags />
          </label>
        </div>

        <p class="cr-note">
          <i data-icon="info"></i>
          <span>${esc(
            draft.kind === "article"
              ? "An article publishes with at least 12 words in the body."
              : ["question", "answer"].includes(draft.kind)
                ? "A question or an answer publishes with at least 6 words."
                : "This kind publishes with its link and a title of 3 characters."
          )} ${esc(currentHub()?.visibility === "private" ? "This hub is private, so its items inherit the password." : "")}</span>
        </p>
      </div>

      <div class="cr-editor__foot">
        <span class="cr-save__state" data-item-state></span>
        <div class="cr-editor__actions">
          ${draft.id ? `<button class="dsh-btn dsh-btn--sm dsh-btn--danger" type="button" data-cr-item-delete="${esc(draft.id)}"><i data-icon="trash"></i> Delete</button>` : ""}
          <button class="dsh-btn dsh-btn--sm" type="button" data-cr-item-save><i data-icon="check"></i> Save draft</button>
          <button class="dsh-btn dsh-btn--primary dsh-btn--sm" type="button" data-cr-item-publish><i data-icon="upload"></i> Publish</button>
        </div>
      </div>
    </div>`;
  hydrateIcons(host);
}

/* ================================================================== */
/* data                                                               */
/* ================================================================== */
async function loadHubs({ keepSelection = false } = {}) {
  const res = await rpc("creator_hubs_list", { p_token: state.token });
  if (!res || res.ok !== true) return false;
  state.hubs = Array.isArray(res.hubs) ? res.hubs : [];
  state.limits = res.limits || {};
  state.level = Number(res.level || 1);
  if (!keepSelection || !state.hubs.some((hub) => hub.id === state.hub)) {
    const first = hubsOf(hubKind())[0];
    state.hub = first ? first.id : null;
  }
  return true;
}

async function loadTab() {
  const section = sectionOf(state.section);
  const tab = section.tabs.find((t) => t.key === state.tab) || section.tabs[0];
  const hub = currentHub();
  state.search = "";
  if (!hub) return;

  if (tab.type === "list") {
    const res = await rpc("creator_items", {
      p_token: state.token,
      p_hub: hub.id,
      p_kind: tab.kind,
      p_status: tab.status || null,
      p_search: "",
    });
    state.rows = res && res.ok ? res.rows || [] : [];
    state.counts = res && res.ok ? res.counts || {} : {};
    if (tab.kind === "question") state.questions = state.rows;
    if (tab.kind === "answer") {
      const q = await rpc("creator_items", { p_token: state.token, p_hub: hub.id, p_kind: "question", p_status: null, p_search: "" });
      state.questions = q && q.ok ? q.rows || [] : [];
    }
    return;
  }
  if (tab.type === "categories" || state.view === "editor") {
    const res = await rpc("creator_categories", { p_token: state.token, p_hub: hub.id });
    state.categories = res && res.ok ? res.rows || [] : [];
  }
  if (tab.type === "subscribers") {
    const res = await rpc("creator_subscribers", { p_token: state.token, p_hub: hub.id });
    state.subscribers = res && res.ok ? res.rows || [] : [];
  }
}

async function refresh() {
  renderRail();
  renderTop();
  renderHubHead();
  renderTabs();
  renderView();
}

async function switchSection(key) {
  if (!SECTIONS.some((section) => section.key === key)) return;
  state.section = key;
  state.view = "list";
  state.editor = null;
  const section = sectionOf(key);
  state.tab = section.tabs[0].key;
  const hub = hubsOf(section.kind)[0];
  state.hub = hub ? hub.id : null;
  state.rows = [];
  state.subscribers = [];
  state.categories = [];
  await loadTab();
  await refresh();
  syncUrl();
}

async function switchHub(id) {
  state.hub = id;
  state.view = "list";
  state.editor = null;
  state.categories = [];
  state.subscribers = [];
  await loadTab();
  await refresh();
  syncUrl();
}

async function switchTab(key) {
  state.tab = key;
  state.view = "list";
  state.editor = null;
  await loadTab();
  await refresh();
  syncUrl();
}

function syncUrl() {
  try {
    const params = new URLSearchParams(location.search);
    params.set("section", slugOf(sectionOf(state.section)));
    if (state.hub) params.set("hub", state.hub);
    else params.delete("hub");
    params.set("tab", state.tab);
    history.replaceState(null, "", `creator.html?${params.toString()}`);
  } catch {
    /* the address bar is not writable here */
  }
}

/* ================================================================== */
/* the hub modal                                                      */
/* ================================================================== */
function openModal(html) {
  let host = el("[data-cr-modal]");
  if (!host) {
    host = document.createElement("div");
    host.className = "cr-modal";
    host.setAttribute("data-cr-modal", "");
    document.body.appendChild(host);
  }
  host.hidden = false;
  host.innerHTML = `<div class="cr-modal__card" role="dialog" aria-modal="true">${html}</div>`;
  hydrateIcons(host);
  return host;
}

function closeModal() {
  const host = el("[data-cr-modal]");
  if (host) {
    host.hidden = true;
    host.innerHTML = "";
  }
  renderTop();
}

function openNewHub() {
  const section = sectionOf(state.section);
  const limit = state.limits?.[section.kind] || {};
  const used = hubsOf(section.kind).length;
  const full = Number(limit.limit) && used >= Number(limit.limit);
  openModal(`
    <h2 class="cr-modal__title">New ${esc(section.noun)}</h2>
    <p class="cr-modal__text">
      ${full
        ? `You run ${used} of ${limit.limit} ${esc(section.noun)}s at level ${state.level}. The next level opens another one.`
        : `A name now; the logo, cover, description, field, niches, staff and access are in ${esc(section.label)} management once it exists.`}
    </p>
    ${
      full
        ? ""
        : `<label class="dsh-field">
             <span class="dsh-field__label">Name</span>
             <input class="dsh-input" type="text" maxlength="80" placeholder="My ${esc(section.noun)}" data-new-hub-name />
           </label>`
    }
    <div class="cr-modal__actions">
      <button class="dsh-btn dsh-btn--sm" type="button" data-cr-modal-close>Cancel</button>
      ${full ? "" : `<button class="dsh-btn dsh-btn--primary dsh-btn--sm" type="button" data-cr-create-hub><i data-icon="plus"></i> Create</button>`}
    </div>`);
}

function openConfirm(title, text, action, id) {
  state.confirm = { action, id };
  openModal(`
    <h2 class="cr-modal__title">${esc(title)}</h2>
    <p class="cr-modal__text">${esc(text)}</p>
    <div class="cr-modal__actions">
      <button class="dsh-btn dsh-btn--sm" type="button" data-cr-modal-close>Cancel</button>
      <button class="dsh-btn dsh-btn--danger dsh-btn--sm" type="button" data-cr-confirm><i data-icon="trash"></i> Delete</button>
    </div>`);
}

/* ================================================================== */
/* actions                                                            */
/* ================================================================== */
function hubPayload(hub) {
  const root = el("[data-settings]");
  if (!root) return null;
  const value = (sel) => el(sel, root)?.value ?? "";
  const links = qsa("[data-link-row]", root)
    .map((row) => ({
      label: (qs("[data-link-label]", row)?.value || "").trim(),
      url: (qs("[data-link-url]", row)?.value || "").trim(),
    }))
    .filter((link) => link.url || link.label);

  return {
    p_token: state.token,
    p_id: hub.id,
    p_kind: hub.kind,
    p_name: value("[data-hub-name]").trim(),
    p_description: value("[data-hub-description]"),
    p_logo_url: value("[data-hub-logo]").trim(),
    p_cover_url: value("[data-hub-cover]").trim(),
    p_links: links,
    p_field: value("[data-hub-field]").trim(),
    p_niches: value("[data-hub-niches]")
      .split(",")
      .map((n) => n.trim())
      .filter(Boolean),
    p_visibility: value("[data-hub-visibility]"),
    p_password: value("[data-hub-password]"),
    p_hours: Number(value("[data-hub-hours]") || 24),
    p_staff: [
      ...(hub.staff || []),
      ...value("[data-hub-staff]")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    ],
    p_vip: [
      ...(hub.vip || []),
      ...value("[data-hub-vip]")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    ],
  };
}

function saveStateText(text, tone = "") {
  const node = el("[data-hub-state]");
  if (!node) return;
  node.textContent = text;
  node.dataset.tone = tone;
}

async function saveHub() {
  const hub = currentHub();
  if (!hub || state.busy) return;
  const payload = hubPayload(hub);
  if (!payload) return;
  state.busy = true;
  saveStateText("Saving…");
  let res = null;
  try {
    res = await rpc("creator_hub_save", payload);
  } catch {
    res = null;
  }
  state.busy = false;
  if (!res || res.ok !== true) {
    const message = MESSAGES[res?.error] || "The save did not go through.";
    saveStateText(message, "error");
    toast({ title: "Not saved", message, tone: "error" });
    return;
  }
  const saved = res.hub;
  state.hubs = state.hubs.map((entry) => (entry.id === saved.id ? saved : entry));
  const pass = el("[data-hub-password]");
  if (pass) {
    pass.value = "";
    pass.placeholder = saved.locked ? "•••• (unchanged)" : "set a password";
  }
  const staffInput = el("[data-hub-staff]");
  if (staffInput) staffInput.value = "";
  const vipInput = el("[data-hub-vip]");
  if (vipInput) vipInput.value = "";
  const view = el("[data-cr-view]");
  if (view && state.view === "list" && sectionOf(state.section).tabs.find((t) => t.key === state.tab)?.type === "settings") {
    renderSettings(view, saved);
  }
  saveStateText(`Saved ${timeAgo(saved.updated_at) || "just now"}`, "ok");
  renderHubHead();
  toast({ title: "Saved", message: `${saved.name} is up to date.`, iconName: "check" });
}

async function createHub() {
  const section = sectionOf(state.section);
  const name = (el("[data-new-hub-name]")?.value || "").trim();
  if (name.length < 2) {
    toast({ title: "A name first", message: "Two characters at least.", tone: "error" });
    return;
  }
  let res = null;
  try {
    res = await rpc("creator_hub_save", {
      p_token: state.token,
      p_id: null,
      p_kind: section.kind,
      p_name: name,
      p_description: "",
      p_logo_url: "",
      p_cover_url: "",
      p_links: [],
      p_field: "",
      p_niches: [],
      p_visibility: "public",
      p_password: "",
      p_hours: 24,
      p_staff: [],
      p_vip: [],
    });
  } catch {
    res = null;
  }
  if (!res || res.ok !== true) {
    toast({ title: "Not created", message: MESSAGES[res?.error] || "The server refused the new hub.", tone: "error" });
    return;
  }
  closeModal();
  state.hubs.push(res.hub);
  state.hub = res.hub.id;
  state.tab = "settings";
  state.view = "list";
  await loadTab();
  await refresh();
  toast({ title: `${section.label} created`, message: "Add the logo, description and access next.", iconName: "check" });
}

async function deleteHub() {
  const hub = currentHub();
  if (!hub) return;
  let res = null;
  try {
    res = await rpc("creator_hub_delete", { p_token: state.token, p_id: hub.id });
  } catch {
    res = null;
  }
  closeModal();
  if (!res || res.ok !== true) {
    toast({ title: "Not deleted", message: MESSAGES[res?.error] || "The server did not confirm.", tone: "error" });
    return;
  }
  state.hubs = state.hubs.filter((entry) => entry.id !== hub.id);
  const next = hubsOf(hubKind())[0];
  state.hub = next ? next.id : null;
  state.tab = sectionOf(state.section).tabs[0].key;
  await loadTab();
  await refresh();
  toast({ title: "Deleted", message: `${hub.name} is gone with everything under it.`, iconName: "trash" });
}

function openEditor(kind, row = null) {
  const hub = currentHub();
  if (!hub) return;
  state.editor = row ? { ...row } : blankItem(kind || "video", hub.id);
  state.view = "editor";
  if (row) state.editor.tags = row.tags || [];
  renderView();
  if (!state.categories.length) {
    rpc("creator_categories", { p_token: state.token, p_hub: hub.id })
      .then((res) => {
        if (!res || !res.ok) return;
        state.categories = res.rows || [];
        const typing = el("[data-item-title]")?.value || "";
        if (state.view === "editor" && !typing) renderView();
      })
      .catch(() => {});
  }
}

async function editItem(id) {
  const hub = currentHub();
  if (!hub) return;
  let res = null;
  try {
    res = await rpc("creator_item_get", { p_token: state.token, p_id: id });
  } catch {
    res = null;
  }
  if (!res || res.ok !== true) {
    toast({ title: "Not opened", message: MESSAGES[res?.error] || "That item could not be opened.", tone: "error" });
    return;
  }
  openEditor(res.row.kind, res.row);
}

function itemPayload(publish) {
  const draft = state.editor;
  const value = (sel) => el(sel)?.value ?? "";
  return {
    p_token: state.token,
    p_id: draft.id,
    p_hub: draft.hub || currentHub()?.id,
    p_kind: draft.kind,
    p_title: value("[data-item-title]").trim(),
    p_summary: value("[data-item-summary]"),
    p_body: value("[data-item-body]"),
    p_media_url: value("[data-item-media]").trim(),
    p_thumbnail: value("[data-item-thumb]").trim(),
    p_cover_url: "",
    p_tags: value("[data-item-tags]")
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean),
    p_language: value("[data-item-language]") || "en",
    p_age: value("[data-item-age]") || "none",
    p_visibility: value("[data-item-visibility]") || "public",
    p_category: value("[data-item-category]") || null,
    p_parent: value("[data-item-parent]") || null,
    p_field: currentHub()?.field || "",
    p_niche: (currentHub()?.niches || [])[0] || "",
    p_micro: value("[data-item-micro]"),
    p_nano: value("[data-item-nano]"),
    p_publish: Boolean(publish),
  };
}

async function saveItem(publish) {
  const draft = state.editor;
  if (!draft || state.busy) return;
  const node = el("[data-item-state]");
  const say = (text, tone = "") => {
    if (!node) return;
    node.textContent = text;
    node.dataset.tone = tone;
  };
  state.busy = true;
  say(publish ? "Publishing…" : "Saving…");
  let res = null;
  try {
    res = await rpc("creator_item_save", itemPayload(publish));
  } catch {
    res = null;
  }
  state.busy = false;
  if (!res || res.ok !== true) {
    const message = MESSAGES[res?.error] || "The save did not go through.";
    say(message, "error");
    toast({ title: publish ? "Not published" : "Not saved", message, tone: "error" });
    return;
  }
  const row = res.row || {};
  state.editor.id = row.id || state.editor.id;
  state.editor.status = row.status || state.editor.status;
  toast({
    title: row.status === "published" ? "Published" : "Draft saved",
    message: row.status === "published" ? `“${row.title}” is live.` : "Only you can see it until it is published.",
    iconName: "check",
  });
  state.view = "list";
  state.editor = null;
  await loadTab();
  await refresh();
}

async function setItemStatus(id, status) {
  let res = null;
  try {
    res = await rpc("creator_item_status", { p_token: state.token, p_id: id, p_status: status });
  } catch {
    res = null;
  }
  if (!res || res.ok !== true) {
    toast({ title: "Not changed", message: MESSAGES[res?.error] || "The server refused.", tone: "error" });
    return;
  }
  await loadTab();
  await refresh();
  toast({ title: status === "published" ? "Published" : "Closed", message: "The list is updated.", iconName: "check" });
}

async function deleteItem(id) {
  let res = null;
  try {
    res = await rpc("creator_item_delete", { p_token: state.token, p_id: id });
  } catch {
    res = null;
  }
  closeModal();
  if (!res || res.ok !== true) {
    toast({ title: "Not deleted", message: MESSAGES[res?.error] || "The server did not confirm.", tone: "error" });
    return;
  }
  state.editor = null;
  state.view = "list";
  await loadTab();
  await refresh();
  toast({ title: "Deleted", message: "The item and its numbers are gone.", iconName: "trash" });
}

async function copyLink(row) {
  const section = sectionOf(state.section);
  const page = { channel: "video", blog: "article", space: "question", library: "document", gallery: "picture" }[section.key] || "article";
  const url = `${location.origin || "https://1world.example"}/${page}.html?id=${encodeURIComponent(row.code || row.id)}`;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(url);
      return toast({ title: "Link copied", message: url, iconName: "link" });
    }
  } catch {
    /* the clipboard is closed — the link is still shown below */
  }
  toast({ title: "The link", message: url, iconName: "link" });
}

async function removeChip(list, code) {
  const hub = currentHub();
  if (!hub || !code) return;
  const fn = list === "vip" ? "creator_hub_vip" : "creator_hub_staff";
  let res = null;
  try {
    res = await rpc(fn, { p_token: state.token, p_id: hub.id, p_action: "remove", p_ref: code });
  } catch {
    res = null;
  }
  if (!res || res.ok !== true) {
    toast({ title: "Not removed", message: MESSAGES[res?.error] || "The server refused.", tone: "error" });
    return;
  }
  hub[list] = res[list] || [];
  renderHubHead();
  renderSettings(el("[data-cr-view]"), hub);
  toast({ title: "Removed", message: `${code} is off the ${list} list.`, iconName: "check" });
}

async function addCategory() {
  const hub = currentHub();
  const name = (el("[data-cat-name]")?.value || "").trim();
  const parent = el("[data-cat-parent]")?.value || null;
  if (!hub || !name) {
    toast({ title: "A category needs a name", tone: "error" });
    return;
  }
  let res = null;
  try {
    res = await rpc("creator_category_save", { p_token: state.token, p_id: null, p_hub: hub.id, p_parent: parent, p_name: name });
  } catch {
    res = null;
  }
  if (!res || res.ok !== true) {
    const message = MESSAGES[res?.error] || "The category was refused.";
    toast({ title: "Not added", message, tone: "error" });
    return;
  }
  state.categories = [...state.categories, res.row];
  renderCategories(el("[data-cr-view]"), hub);
  toast({ title: "Category added", message: name, iconName: "check" });
}

async function deleteCategory(id) {
  const hub = currentHub();
  let res = null;
  try {
    res = await rpc("creator_category_delete", { p_token: state.token, p_id: id });
  } catch {
    res = null;
  }
  if (!res || res.ok !== true) {
    toast({ title: "Not deleted", message: MESSAGES[res?.error] || "The server refused.", tone: "error" });
    return;
  }
  state.categories = state.categories.filter((row) => row.id !== id);
  if (hub) renderCategories(el("[data-cr-view]"), hub);
}

/* ================================================================== */
/* events                                                             */
/* ================================================================== */
document.addEventListener("click", (event) => {
  const target = event.target;

  const section = target.closest("[data-cr-section]");
  if (section) {
    event.preventDefault();
    switchSection(section.dataset.crSection);
    return;
  }

  const tab = target.closest("[data-cr-tab]");
  if (tab) {
    event.preventDefault();
    switchTab(tab.dataset.crTab);
    return;
  }

  const addToggle = target.closest("[data-cr-add-toggle]");
  if (addToggle) {
    event.preventDefault();
    const menu = el("[data-cr-add-menu]");
    if (!menu) return;
    const open = menu.hidden;
    menu.hidden = !open;
    menu.style.display = open ? "" : "none";
    addToggle.setAttribute("aria-expanded", open ? "true" : "false");
    return;
  }

  const add = target.closest("[data-cr-add]");
  if (add) {
    event.preventDefault();
    const menu = el("[data-cr-add-menu]");
    if (menu) {
      menu.hidden = true;
      menu.style.display = "none";
    }
    el("[data-cr-add-toggle]")?.setAttribute("aria-expanded", "false");
    const value = add.dataset.crAdd;
    if (value === "hub") return openNewHub();
    if (value === "category") return switchTab("categories");
    return openEditor(value, null);
  }

  if (target.closest("[data-cr-new-hub]")) {
    event.preventDefault();
    return openNewHub();
  }

  const act = target.closest("[data-cr-act]");
  if (act) {
    event.preventDefault();
    const id = act.dataset.id;
    const action = act.dataset.crAct;
    const row = [...state.rows, ...(state.questions || [])].find((entry) => entry.id === id);
    act.closest("details")?.removeAttribute("open");
    if (action === "delete") {
      return openConfirm("Delete this item?", "It disappears from the studio and from the public page. This cannot be undone.", "item", id);
    }
    if (action === "publish") return setItemStatus(id, "published");
    if (action === "close") return setItemStatus(id, "hidden");
    if (action === "link" || action === "share") return copyLink(row || { id });
    return editItem(id);
  }

  if (target.closest("[data-cr-editor-back]")) {
    event.preventDefault();
    state.view = "list";
    state.editor = null;
    return renderView();
  }

  if (target.closest("[data-cr-item-save]")) {
    event.preventDefault();
    return saveItem(false);
  }

  if (target.closest("[data-cr-item-publish]")) {
    event.preventDefault();
    return saveItem(true);
  }

  const itemDelete = target.closest("[data-cr-item-delete]");
  if (itemDelete) {
    event.preventDefault();
    return openConfirm("Delete this item?", "This cannot be undone.", "item", itemDelete.dataset.crItemDelete);
  }

  if (target.closest("[data-cr-save-hub]")) {
    event.preventDefault();
    return saveHub();
  }

  if (target.closest("[data-cr-delete-hub]")) {
    event.preventDefault();
    const hub = currentHub();
    return openConfirm(
      `Delete ${hub?.name || "this"}?`,
      "Everything under it goes too — items, categories and subscribers. This cannot be undone.",
      "hub",
      hub?.id
    );
  }

  if (target.closest("[data-cr-create-hub]")) {
    event.preventDefault();
    return createHub();
  }

  if (target.closest("[data-cr-link-add]")) {
    event.preventDefault();
    const host = el("[data-links]");
    if (!host) return;
    const row = document.createElement("div");
    row.className = "cr-link-row";
    row.setAttribute("data-link-row", "");
    row.innerHTML = `
      <input class="dsh-input" type="text" maxlength="40" placeholder="Label" data-link-label />
      <input class="dsh-input" type="url" placeholder="https://…" data-link-url />
      <button class="dsh-btn dsh-btn--sm" type="button" data-cr-link-remove aria-label="Remove link"><i data-icon="trash"></i></button>`;
    host.appendChild(row);
    hydrateIcons(row);
    return;
  }

  const linkRemove = target.closest("[data-cr-link-remove]");
  if (linkRemove) {
    event.preventDefault();
    linkRemove.closest("[data-link-row]")?.remove();
    return;
  }

  const chip = target.closest("[data-cr-chip-remove]");
  if (chip) {
    event.preventDefault();
    removeChip(chip.dataset.crChipRemove, chip.dataset.code);
    return;
  }

  if (target.closest("[data-cr-cat-add]")) {
    event.preventDefault();
    return addCategory();
  }

  const catDel = target.closest("[data-cr-cat-del]");
  if (catDel) {
    event.preventDefault();
    return deleteCategory(catDel.dataset.crCatDel);
  }

  if (target.closest("[data-cr-modal-close]")) {
    event.preventDefault();
    return closeModal();
  }

  if (target.closest("[data-cr-confirm]")) {
    event.preventDefault();
    const pending = state.confirm || {};
    state.confirm = null;
    if (pending.action === "hub") return deleteHub();
    if (pending.action === "item") return deleteItem(pending.id);
    return closeModal();
  }

  if (target.matches("[data-cr-modal]")) {
    closeModal();
  }
});

document.addEventListener("change", (event) => {
  const select = event.target;
  if (select.matches("[data-cr-hub]")) {
    if (select.value === "__new") return openNewHub();
    if (select.value) switchHub(select.value);
    return;
  }
  if (select.matches("[data-hub-visibility]")) {
    const priv = select.value === "private";
    const pass = el("[data-hub-pass-wrap]");
    const hours = el("[data-hub-hours-wrap]");
    if (pass) {
      pass.hidden = !priv;
      pass.style.display = priv ? "" : "none";
    }
    if (hours) {
      hours.hidden = !priv;
      hours.style.display = priv ? "" : "none";
    }
    return;
  }
});

document.addEventListener("input", (event) => {
  const target = event.target;
  if (target.matches("[data-cr-search]")) {
    state.search = target.value || "";
    renderView();
    const box = el("[data-cr-search]");
    if (box) box.focus?.();
    return;
  }
  if (target.matches("[data-item-body]")) {
    const count = el("[data-item-count]");
    if (count) {
      const text = String(target.value || "").trim();
      const words = text ? text.split(/\s+/).filter(Boolean).length : 0;
      count.textContent = `${num(words)} words`;
    }
  }
});

/* ================================================================== */
/* boot                                                               */
/* ================================================================== */
async function boot() {
  state.token = sessionToken() || "";
  state.member = getMember();

  if (!state.token) {
    return showGate(
      "lock",
      "Sign in to the studio",
      "The creator studio needs a member session — your studios, blogs, spaces, libraries and galleries hang from your member.",
      `<a class="btn btn--primary btn--sm" href="login.html"><i data-icon="login"></i> Sign in</a>
       <a class="btn btn--ghost btn--sm" href="register.html"><i data-icon="user"></i> Create an account</a>`
    );
  }

  const ok = await loadHubs();
  if (!ok) {
    return showGate(
      "lock",
      "The studio could not load",
      "The server did not answer, or the session has ended. Sign in again to continue.",
      `<a class="btn btn--primary btn--sm" href="login.html"><i data-icon="login"></i> Sign in</a>`
    );
  }

  const params = new URLSearchParams(location.search);
  const wantedSection = sectionFromUrl(params.get("section"));
  if (wantedSection) state.section = wantedSection.key;
  const wantedHub = params.get("hub");
  if (wantedHub && state.hubs.some((hub) => hub.id === wantedHub)) state.hub = wantedHub;

  const section = sectionOf(state.section);
  const current = currentHub();
  if (!current || current.kind !== section.kind) {
    const first = hubsOf(section.kind)[0];
    state.hub = first ? first.id : null;
  }
  const wantedTab = params.get("tab");
  state.tab = section.tabs.some((tab) => tab.key === wantedTab) ? wantedTab : section.tabs[0].key;

  showShell();
  await loadTab();
  await refresh();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot, { once: true });
} else {
  boot();
}
