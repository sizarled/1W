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
import { flagMarkup, countryByName } from "./countries.js";

/* ================================================================== */
/* what hangs under each section                                      */
/* ================================================================== */
const COLS = {
  item: "Title",
  title: "Title",
  vis: "Visibility",
  seats: "Seats",
  quality: "Quality",
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
      { key: "participants", label: "Participants", type: "participants" },
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
      { key: "participants", label: "Participants", type: "participants" },
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
      { key: "participants", label: "Participants", type: "participants" },
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
      { key: "participants", label: "Participants", type: "participants" },
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
      { key: "participants", label: "Participants", type: "participants" },
      { key: "settings", label: "Gallery management", type: "settings" },
      { key: "subscribers", label: "Subscribers", type: "subscribers" },
    ],
    add: [
      { kind: "image", label: "Image" },
      { category: true, label: "Category" },
    ],
  },
  {
    key: "server",
    slug: "server",
    kind: "server",
    label: "Server",
    icon: "monitor",
    noun: "server",
    caps: true,
    tabs: [
      { key: "channels", label: "Channels", type: "list", kind: "channel", cols: ["item", "vis", "seats", "minutes", "likes", "comments", "act"], actions: ["edit", "link", "delete"] },
      { key: "lists", label: "Channel lists", type: "list", kind: "channel_list", cols: ["item", "vis", "seats", "minutes", "act"], actions: ["edit", "delete"] },
      { key: "xtream", label: "Xtream accounts", type: "list", kind: "xtream", cols: ["item", "vis", "act"], actions: ["edit", "delete"] },
      { key: "playlists", label: "Playlists", type: "list", kind: "playlist", cols: ["item", "vis", "minutes", "likes", "act"], actions: ["edit", "link", "delete"] },
      { key: "participants", label: "Participants", type: "participants" },
      { key: "settings", label: "Server management", type: "settings" },
      { key: "subscribers", label: "Subscribers", type: "subscribers" },
    ],
    add: [
      { kind: "channel", label: "Channel" },
      { kind: "channel_list", label: "Channel list" },
      { kind: "xtream", label: "Xtream account" },
      { kind: "playlist", label: "Playlist" },
    ],
  },
  {
    key: "cinema",
    slug: "cinema",
    kind: "cinema",
    label: "Cinema",
    icon: "film",
    noun: "cinema",
    caps: true,
    tabs: [
      { key: "films", label: "Films", type: "list", kind: "film", cols: ["item", "vis", "seats", "minutes", "likes", "comments", "act"], actions: ["edit", "link", "delete"] },
      { key: "episodes", label: "Episodes", type: "list", kind: "episode", cols: ["item", "vis", "seats", "minutes", "likes", "act"], actions: ["edit", "link", "delete"] },
      { key: "playlists", label: "Playlists", type: "list", kind: "playlist", cols: ["item", "vis", "minutes", "likes", "act"], actions: ["edit", "link", "delete"] },
      { key: "participants", label: "Participants", type: "participants" },
      { key: "settings", label: "Cinema management", type: "settings" },
      { key: "subscribers", label: "Subscribers", type: "subscribers" },
    ],
    add: [
      { kind: "film", label: "Film" },
      { kind: "episode", label: "Episode" },
      { kind: "playlist", label: "Playlist" },
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
  channel: "Channel",
  channel_list: "Channel list",
  xtream: "Xtream account",
  film: "Film",
  episode: "Episode",
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
  channel: "tv",
  channel_list: "broadcast",
  xtream: "key",
  film: "film",
  episode: "play",
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
  channel: { media: "Channel link (m3u8 / stream)", body: "Description", words: false },
  channel_list: { media: "List URL — or paste it below", body: "Notes", words: false },
  xtream: { media: "", body: "Notes", words: false },
  film: { media: "", body: "Description", words: false },
  episode: { media: "Episode link", body: "Description", words: false },
};

/* the qualities a film or an episode may carry */
const QUALITIES = ["SD", "HD", "FHD", "2K", "4K", "8K"];

/* what a channel list may be fed with */
const LIST_SOURCES = [
  ["paste", "Paste the list"],
  ["url", "A list URL"],
  ["file", "An M3U / TXT file"],
];

/* how an exclusive item lets people in */
const REQUIRES = [
  ["", "Anybody inside the criteria"],
  ["subscribe", "Subscribers only"],
  ["follow", "Followers only"],
];

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

const ACCESS_MESSAGES = {
  code: "One of those member codes is unknown.",
  audience: "That exclusive rule is not one we know.",
  viewers: "More viewers than this level allows.",
  not_found: "That hub is not yours.",
  seats: "More seats than this level allows.",
};

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
  closed: "This hub has closed its door — subscriptions and follows are off.",
  viewers: "That many viewers is above this level's ceiling.",
  seats: "That many seats is above this level's ceiling.",
  code: "One of those member codes is unknown.",
  audience: "That exclusive rule is not one we know.",
  own: "This hub is yours already.",
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
  /* the public side */
  creatorRef: null,
  page: null,
  pageError: "",
  hubView: null,
  hubViewId: null,
  hubRef: null,
  hubError: "",
  participants: null,
  ads: null,
  directory: { q: "", kind: "", country: "", sort: "subscribers", rows: [], countries: [], count: 0, loading: false, error: "" },
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

/* ------------------------------------------------------------------ */
/* the three doors, shared by every hub and every item                */
/* ------------------------------------------------------------------ */
/* public   — everybody except the excluded list                      */
/* exclusive — a subscription or follow, plus country, language,      */
/*             account level and wealth                               */
/* private  — the VIP list, or the password its publisher set          */

const splitCodes = (value) =>
  String(value || "")
    .split(",")
    .map((code) => code.trim().toUpperCase())
    .filter(Boolean);

const splitList = (value) =>
  String(value || "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

function excludedField(codes, prefix) {
  const list = Array.isArray(codes) ? codes : [];
  return `
    <div class="cr-excluded" data-aud-excluded="${prefix}">
      <span class="dsh-field__label">Excluded members — comma separated codes</span>
      <div class="cr-chips" data-excluded-chips>
        ${
          list
            .map(
              (code) => `<span class="cr-chip-x">${esc(code)}<button type="button" data-cr-excl-remove="${esc(code)}" data-excl-prefix="${prefix}" aria-label="Stop excluding ${esc(code)}"><i data-icon="close"></i></button></span>`
            )
            .join("") || '<span class="cr-card__hint">Nobody is excluded.</span>'
        }
      </div>
      <input class="dsh-input" type="text" placeholder="ID100016, ID100015" data-excluded-input="${prefix}" />
    </div>`;
}

function audienceFields(audience, prefix, open = false) {
  const aud = audience && typeof audience === "object" ? audience : {};
  const requires = String(aud.requires || "");
  const countries = Array.isArray(aud.countries) ? aud.countries.join(", ") : "";
  const langs = Array.isArray(aud.languages) ? aud.languages.join(", ") : "";
  return `
    <div class="cr-aud" data-aud="${prefix}" ${open ? "" : "hidden"}>
      <div class="cr-grid3">
        <label class="dsh-field">
          <span class="dsh-field__label">Who gets in</span>
          <select class="dsh-select" data-aud-requires="${prefix}">
            ${REQUIRES.map(([value, label]) => `<option value="${value}" ${requires === value ? "selected" : ""}>${label}</option>`).join("")}
          </select>
        </label>
        <label class="dsh-field">
          <span class="dsh-field__label">Countries — comma separated, empty is any</span>
          <input class="dsh-input" type="text" value="${esc(countries)}" placeholder="Morocco, Egypt" data-aud-countries="${prefix}" />
        </label>
        <label class="dsh-field">
          <span class="dsh-field__label">Languages — comma separated, empty is any</span>
          <input class="dsh-input" type="text" value="${esc(langs)}" placeholder="ar, fr" data-aud-languages="${prefix}" />
        </label>
      </div>
      <div class="cr-grid2">
        <label class="dsh-field">
          <span class="dsh-field__label">Account level at least</span>
          <input class="dsh-input" type="number" min="0" max="10" value="${esc(String(aud.level_min || 0))}" data-aud-level="${prefix}" />
        </label>
        <label class="dsh-field">
          <span class="dsh-field__label">Wealth — points at least</span>
          <input class="dsh-input" type="number" min="0" value="${esc(String(aud.wealth_min || 0))}" data-aud-wealth="${prefix}" />
        </label>
      </div>
    </div>`;
}

function audienceOf(prefix) {
  const val = (name) => el(`[data-${name}="${prefix}"]`)?.value ?? "";
  return {
    requires: val("aud-requires"),
    countries: splitList(val("aud-countries")),
    languages: splitList(val("aud-languages")),
    level_min: Number(val("aud-level") || 0),
    wealth_min: Number(val("aud-wealth") || 0),
  };
}

const audienceIsEmpty = (aud) =>
  !aud.requires && !aud.countries.length && !aud.languages.length && !aud.level_min && !aud.wealth_min;

function audienceFor(visibility, prefix) {
  if (visibility !== "exclusive") return {};
  const aud = audienceOf(prefix);
  return audienceIsEmpty(aud) ? {} : aud;
}

function excludedOf(prefix) {
  const node = el(`[data-excluded-input="${prefix}"]`);
  const typed = splitCodes(node ? node.value : "");
  const chips = qsa(`[data-aud-excluded="${prefix}"] [data-cr-excl-remove]`).map((btn) =>
    String(btn.dataset.crExclRemove || "").toUpperCase()
  );
  return [...new Set([...chips, ...typed])].slice(0, 200);
}

/* how many may watch at the same time */
const capText = (value) => (value === null || value === undefined || value === "" ? "no limit" : `${num(Number(value))} at once`);
const hubCeiling = (hub) => (hub && hub.viewer_limit != null ? Number(hub.viewer_limit) : null);

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
  const signedIn = Boolean(state.token);
  const nameNode = el("[data-cr-name]");
  if (nameNode) nameNode.textContent = signedIn ? name : "Guest";
  const handle = el("[data-cr-username]");
  if (handle) {
    handle.textContent = signedIn
      ? member.username
        ? String(member.username).startsWith("@")
          ? member.username
          : `@${member.username}`
        : `@${member.member_id || "member"}`
      : "not signed in";
  }
  const code = el("[data-cr-code]");
  if (code) {
    code.textContent = member.member_id || "";
    code.hidden = !signedIn || !member.member_id;
  }

  const discover = el("[data-cr-discover]");
  if (discover) {
    const on = isPublic();
    discover.innerHTML = `
      <button class="cr-section cr-section--discover ${on ? "is-on" : ""}" type="button" data-cr-nav-creators aria-current="${on ? "page" : "false"}">
        <i data-icon="search"></i>
        <span class="cr-section__name">Creators</span>
        <span class="cr-section__count">find</span>
      </button>`;
    hydrateIcons(discover);
  }

  const foot = el("[data-cr-side-foot]");
  if (foot) {
    foot.innerHTML = signedIn
      ? `<a class="cr-side__link" href="profile.html"><i data-icon="user"></i> Your profile</a>
         <a class="cr-side__link" href="dashboard.html"><i data-icon="dashboard"></i> Dashboard</a>`
      : `<a class="cr-side__link" href="login.html"><i data-icon="login"></i> Sign in</a>
         <a class="cr-side__link" href="register.html"><i data-icon="user"></i> Create an account</a>`;
    hydrateIcons(foot);
  }

  const nav = el("[data-cr-sections]");
  if (!nav) return;
  if (!signedIn) {
    nav.innerHTML = `
      <p class="cr-side__hint">Sign in to manage the studios, blogs, spaces, libraries, galleries, servers and cinemas you run.</p>`;
    return;
  }
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
  if (state.view === "creators") return renderDirectory(host);
  if (state.view === "creator") return renderCreatorPage(host);
  if (state.view === "hubview") return renderHubPage(host);
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

  if (tab.type === "participants") return renderParticipants(host, hub);
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
    case "seats":
      return `<td><span class="cr-seats" data-cap="${row.cap != null ? esc(String(row.cap)) : ""}">${esc(row.seats != null ? num(row.seats) : "—")}</span> <span class="cr-code">${esc(row.cap != null ? `of ${num(row.cap)}` : "no cap")}</span></td>`;
    case "quality":
      return `<td>${esc((row.meta?.quality || []).join(" · ") || "—")}</td>`;
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

        ${excludedField(hub.excluded, "hub")}

        <p class="cr-card__hint">Public is everyone except the excluded list. Exclusive asks for a subscription or a follow, and optionally a country, a language, an account level and a wealth of points.</p>
        ${audienceFields(hub.audience, "hub", hub.visibility === "exclusive")}

        <label class="cr-switch">
          <input type="checkbox" data-hub-auto ${hub.auto_accept === false ? "" : "checked"} />
          <span><strong>Take subscriptions and follows</strong> — with this off, nobody can subscribe to or follow this ${esc(section.noun)}.</span>
        </label>
      </div>

      <div class="cr-card">
        <div class="cr-card__head">
          <h2 class="cr-card__title">${section.caps ? "Available devices" : "Viewers"}</h2>
          <span class="cr-bar__count">${esc(section.caps ? "how many may watch at once" : "level based")}</span>
        </div>
        <div class="cr-grid2">
          <label class="dsh-field">
            <span class="dsh-field__label">Simultaneous viewers — empty means the level's ceiling</span>
            <input class="dsh-input" type="number" min="0" value="${hub.max_viewers != null ? esc(String(hub.max_viewers)) : ""}" placeholder="${esc(String(hubCeiling(hub) ?? ""))}" data-hub-viewers />
          </label>
          <div class="cr-pill-wrap">
            <span class="cr-pill" data-hub-cap><i data-icon="users"></i>${esc(capText(hubCeiling(hub)))}</span>
          </div>
        </div>
        <p class="cr-card__hint">${
          section.kind === "cinema"
            ? "A cinema's films take 100 viewers per level and its series and episodes 1000; the top level has no ceiling. A film or an episode may carry a smaller number of its own."
            : section.kind === "server"
              ? "A server takes 100 simultaneous viewers per level, and the top level has no ceiling. A channel or a list may carry a smaller number of its own."
              : "Simultaneous viewers stay open for this kind of hub."
        }</p>
      </div>

      <div class="cr-card">
        <div class="cr-card__head">
          <h2 class="cr-card__title">Staff</h2>
          <span class="cr-bar__count">they see this ${esc(section.noun)} in their own studio</span>
        </div>
        <p class="cr-card__hint">Staff are the publishers whose requests you approved — the Participants tab lists them. A member code added here works too.</p>
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
    meta: {},
    excluded: [],
    audience: {},
    seats: null,
  };
}


/* ------------------------------------------------------------------ */
/* what each new kind needs beyond a title and a link                 */
/* ------------------------------------------------------------------ */
const countChannels = (text) =>
  String(text || "")
    .split(/\r?\n/)
    .filter((line) => /^#extinf/i.test(line.trim())).length;

function qualityChips(meta) {
  const picked = Array.isArray(meta.quality) ? meta.quality.map((q) => String(q).toUpperCase()) : [];
  return `
    <div class="cr-qchips" data-quality>
      ${QUALITIES.map(
        (q) => `<button class="cr-qchip ${picked.includes(q) ? "is-on" : ""}" type="button" data-cr-quality="${q}" aria-pressed="${picked.includes(q)}">${q}</button>`
      ).join("")}
    </div>`;
}

function pickedQuality() {
  return qsa("[data-cr-quality]")
    .filter((btn) => btn.classList.contains("is-on"))
    .map((btn) => String(btn.dataset.crQuality || ""));
}

function metaCard(draft) {
  const meta = draft.meta && typeof draft.meta === "object" ? draft.meta : {};
  const kind = draft.kind;
  let body = "";

  if (kind === "channel") {
    body = `
      <div class="cr-grid2">
        <label class="dsh-field">
          <span class="dsh-field__label">Group</span>
          <input class="dsh-input" type="text" maxlength="40" value="${esc(meta.group || "")}" placeholder="News" data-meta-group />
        </label>
        <label class="dsh-field">
          <span class="dsh-field__label">EPG link</span>
          <input class="dsh-input" type="url" value="${esc(meta.epg_url || "")}" placeholder="https://…/epg.xml" data-meta-epg />
        </label>
      </div>`;
  } else if (kind === "channel_list") {
    const source = String(meta.source || "paste");
    const text = String(meta.content || "");
    body = `
      <div class="cr-grid2">
        <label class="dsh-field">
          <span class="dsh-field__label">List name</span>
          <input class="dsh-input" type="text" maxlength="80" value="${esc(meta.list_name || draft.title || "")}" placeholder="Free channels" data-meta-listname />
        </label>
        <label class="dsh-field">
          <span class="dsh-field__label">Where it comes from</span>
          <select class="dsh-select" data-meta-source>
            ${LIST_SOURCES.map(([value, label]) => `<option value="${value}" ${source === value ? "selected" : ""}>${label}</option>`).join("")}
          </select>
        </label>
      </div>
      <label class="dsh-field">
        <span class="dsh-field__label">Paste the list — one #EXTINF line per channel</span>
        <textarea class="dsh-textarea" rows="6" maxlength="20000" data-meta-content placeholder="#EXTM3U&#10;#EXTINF:-1,BBC One&#10;https://…/bbc.m3u8">${esc(text)}</textarea>
      </label>
      <div class="cr-grid2">
        <label class="dsh-field">
          <span class="dsh-field__label">List URL</span>
          <input class="dsh-input" type="url" value="${esc(meta.url || "")}" placeholder="https://…/IPTV-Free.m3u" data-meta-url />
        </label>
        <label class="dsh-field">
          <span class="dsh-field__label">Or import an M3U / TXT file</span>
          <input class="dsh-input" type="file" accept=".m3u,.m3u8,.txt" data-meta-file />
        </label>
      </div>
      <div class="cr-grid2">
        <label class="dsh-field">
          <span class="dsh-field__label">List EPG link</span>
          <input class="dsh-input" type="url" value="${esc(meta.epg_url || "")}" placeholder="https://…/epg.xml" data-meta-epg />
        </label>
        <div class="cr-pill-wrap">
          <span class="cr-pill" data-meta-count><i data-icon="broadcast"></i>${esc(num(countChannels(text)))} channel${countChannels(text) === 1 ? "" : "s"}</span>
        </div>
      </div>`;
  } else if (kind === "xtream") {
    body = `
      <div class="cr-grid2">
        <label class="dsh-field">
          <span class="dsh-field__label">Server address</span>
          <input class="dsh-input" type="text" value="${esc(meta.host || "")}" placeholder="http://panel.example.com" data-meta-host />
        </label>
        <label class="dsh-field">
          <span class="dsh-field__label">Port</span>
          <input class="dsh-input" type="number" min="1" max="65535" value="${esc(meta.port != null ? String(meta.port) : "")}" placeholder="8080" data-meta-port />
        </label>
      </div>
      <div class="cr-grid2">
        <label class="dsh-field">
          <span class="dsh-field__label">Username</span>
          <input class="dsh-input" type="text" value="${esc(meta.username || "")}" autocomplete="off" data-meta-username />
        </label>
        <label class="dsh-field">
          <span class="dsh-field__label">Password</span>
          <input class="dsh-input" type="password" value="${esc(meta.password || "")}" autocomplete="new-password" data-meta-password />
        </label>
      </div>`;
  } else if (kind === "film" || kind === "episode") {
    body = `
      <div class="cr-grid2">
        <label class="dsh-field">
          <span class="dsh-field__label">TMDB link or id</span>
          <input class="dsh-input" type="text" value="${esc(meta.tmdb || "")}" placeholder="603692 — or the themoviedb.org link" data-meta-tmdb />
        </label>
        ${
          kind === "episode"
            ? `<div class="cr-grid2">
                 <label class="dsh-field">
                   <span class="dsh-field__label">Season number</span>
                   <input class="dsh-input" type="number" min="0" max="99" value="${esc(meta.season != null ? String(meta.season) : "1")}" data-meta-season />
                 </label>
                 <label class="dsh-field">
                   <span class="dsh-field__label">Episode number</span>
                   <input class="dsh-input" type="number" min="0" max="999" value="${esc(meta.episode != null ? String(meta.episode) : "1")}" data-meta-episode />
                 </label>
               </div>`
            : `<label class="dsh-field">
                 <span class="dsh-field__label">Film link</span>
                 <input class="dsh-input" type="url" value="${esc(draft.media_url || "")}" placeholder="https://…/film.mp4" data-item-media />
               </label>`
        }
      </div>
      <div class="dsh-field">
        <span class="dsh-field__label">Quality — pick every one the source offers</span>
        ${qualityChips(meta)}
      </div>
      <div class="cr-grid3">
        <label class="cr-switch">
          <input type="checkbox" data-meta-subs ${meta.subtitles ? "checked" : ""} />
          <span><strong>Subtitles</strong> — the source carries them</span>
        </label>
        <label class="dsh-field">
          <span class="dsh-field__label">Subtitle languages — comma separated</span>
          <input class="dsh-input" type="text" value="${esc((meta.subtitle_langs || []).join(", "))}" placeholder="ar, en" data-meta-sub-langs />
        </label>
        <label class="cr-switch">
          <input type="checkbox" data-meta-ads ${meta.ads ? "checked" : ""} />
          <span><strong>Ads in the source</strong> — it plays with advertising</span>
        </label>
      </div>`;
  } else if (kind === "playlist") {
    const picked = Array.isArray(meta.items) ? meta.items.map((row) => row.id) : [];
    const options = (state.pickables || [])
      .filter((row) => row.kind !== "playlist")
      .map(
        (row) => `<option value="${esc(row.id)}" ${picked.includes(row.id) ? "selected" : ""}>${esc(KIND_LABEL[row.kind] || row.kind)} · ${esc(row.title)}</option>`
      )
      .join("");
    body = `
      <div class="cr-grid2">
        <label class="dsh-field">
          <span class="dsh-field__label">Backdrop link</span>
          <input class="dsh-input" type="url" value="${esc(draft.cover_url || "")}" placeholder="https://…/backdrop.jpg" data-item-cover />
        </label>
        <div class="cr-pill-wrap">
          <span class="cr-pill" data-playlist-count><i data-icon="bookmark"></i>${esc(num(picked.length))} picked</span>
        </div>
      </div>
      <label class="dsh-field">
        <span class="dsh-field__label">Films or series in this playlist — pick one or more</span>
        <select class="dsh-select" multiple size="8" data-meta-picks>
          ${options || '<option value="" disabled>Nothing to pick yet — add a film or an episode first.</option>'}
        </select>
      </label>`;
  }

  if (!body) return "";
  return `
    <div class="cr-card" data-meta-card="${esc(kind)}">
      <div class="cr-card__head">
        <h2 class="cr-card__title">${esc(KIND_LABEL[kind] || kind)} details</h2>
        <span class="cr-bar__count">${esc(kind === "film" || kind === "episode" ? "TMDB, quality, subtitles, ads" : kind === "channel_list" ? "paste, file or URL" : kind === "xtream" ? "kept for you only" : "where it sits")}</span>
      </div>
      ${body}
    </div>`;
}

function metaOf(draft) {
  const value = (name) => el(`[data-meta-${name}]`)?.value ?? "";
  const checked = (name) => Boolean(el(`[data-meta-${name}]`)?.checked);
  const kind = draft.kind;
  if (kind === "channel") {
    return { group: value("group").trim(), epg_url: value("epg").trim() };
  }
  if (kind === "channel_list") {
    const content = value("content");
    return {
      list_name: value("listname").trim() || draft.title || "",
      source: value("source") || "paste",
      content,
      url: value("url").trim(),
      epg_url: value("epg").trim(),
      count: countChannels(content),
    };
  }
  if (kind === "xtream") {
    const port = Number(value("port"));
    return {
      host: value("host").trim(),
      port: Number.isFinite(port) && port > 0 ? port : null,
      username: value("username").trim(),
      password: value("password"),
    };
  }
  if (kind === "film" || kind === "episode") {
    const meta = {
      tmdb: value("tmdb").trim(),
      quality: pickedQuality(),
      subtitles: checked("subs"),
      subtitle_langs: splitList(value("sub-langs")),
      ads: checked("ads"),
    };
    if (kind === "episode") {
      meta.season = Number(value("season") || 0);
      meta.episode = Number(value("episode") || 0);
    }
    return meta;
  }
  if (kind === "playlist") {
    const picks = Array.from(el("[data-meta-picks]")?.selectedOptions || []).map((option) => option.value).filter(Boolean);
    const pool = state.pickables || [];
    return {
      items: picks.map((id) => {
        const row = pool.find((entry) => entry.id === id);
        return { id, kind: row ? row.kind : "", title: row ? row.title : "" };
      }),
    };
  }
  return {};
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

      ${metaCard(draft)}

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

      <div class="cr-card" data-item-door>
        <div class="cr-card__head">
          <h2 class="cr-card__title">Who sees it</h2>
          <span class="cr-bar__count">public, exclusive or private — this one only</span>
        </div>
        <p class="cr-card__hint">Public reaches everyone except the excluded list. Exclusive needs a subscription or a follow, and can ask for a country, a language, an account level and a wealth of points. Private opens only to the hub's VIP list or its password.</p>
        ${excludedField(draft.excluded, "item")}
        ${audienceFields(draft.audience, "item", draft.visibility === "exclusive")}
        <div class="cr-grid2">
          <label class="dsh-field">
            <span class="dsh-field__label">Seats — how many may watch this one at once, empty for the hub's number</span>
            <input class="dsh-input" type="number" min="0" value="${draft.seats != null ? esc(String(draft.seats)) : ""}" placeholder="${esc(String(hubCeiling(currentHub()) ?? ""))}" data-item-seats />
          </label>
          <div class="cr-pill-wrap">
            <span class="cr-pill" data-item-cap><i data-icon="users"></i>${esc(capText(hubCeiling(currentHub())))}</span>
          </div>
        </div>
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
  if (tab.type === "participants") {
    const who = await rpc("creator_participants", { p_token: state.token, p_hub: hub.id });
    state.participants = who && who.ok ? who : null;
    const ads = await rpc("creator_ads", { p_token: state.token, p_hub: hub.id });
    state.ads = ads && ads.ok ? ads.rows || [] : [];
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
  const pub = isPublic();
  hideAdminChrome(pub);
  renderRail();
  if (!pub) {
    renderTop();
    renderHubHead();
    renderTabs();
  }
  renderView();
}

async function switchSection(key) {
  if (!SECTIONS.some((section) => section.key === key)) return;
  state.section = key;
  state.view = "list";
  state.page = null;
  state.hubView = null;
  hideAdminChrome(false);
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
    const params = new URLSearchParams();
    if (state.view === "creators") {
      params.set("section", "creators");
    } else if (state.view === "creator") {
      params.set("creator", state.creatorRef || "");
    } else if (state.view === "hubview") {
      params.set("studio", state.hubView?.hub?.code || state.hubRef || "");
      if (state.creatorRef) params.set("creator", state.creatorRef);
    } else {
      params.set("section", slugOf(sectionOf(state.section)));
      if (state.hub) params.set("hub", state.hub);
      params.set("tab", state.tab);
    }
    history.replaceState(null, "", `creator.html?${params.toString()}`);
  } catch {
    /* the address bar is not writable here */
  }
}

/* ================================================================== */
/* the public side: creators, one creator, one hub                    */
/* ================================================================== */
/*
 * Three views that need no token:
 *
 *   creators  ?section=creators        the directory — search + filters
 *   creator   ?creator=ID100015        one creator and every hub they run
 *   hubview   ?hub=<uuid>              a hub as a visitor: header, items,
 *                                      subscribe, and the password door
 *
 * All three read the security-definer RPCs in tools/sql/creator-public.sql
 * (`creators_search`, `creator_public`, `creator_hub_view`); the browser
 * never sees a private hub it is not allowed to see.
 */

const PLURALS = {
  channel: "Studios",
  blog: "Blogs",
  space: "Spaces",
  library: "Libraries",
  gallery: "Galleries",
  server: "Servers",
  cinema: "Cinemas",
};

const HUBS = SECTIONS.map((section) => ({
  kind: section.kind,
  label: section.label,
  icon: section.icon,
  slug: section.slug,
  noun: section.noun,
  plural: PLURALS[section.kind],
}));

const hubInfo = (kind) =>
  HUBS.find((row) => row.kind === kind) || {
    kind,
    label: String(kind || "Hub"),
    icon: "file",
    slug: "",
    noun: kind,
    plural: `${String(kind || "hub")}s`,
  };

const SORTS = [
  ["subscribers", "Most subscribers"],
  ["items", "Most items"],
  ["new", "Newest"],
];

const PUB_VIEWS = ["creators", "creator", "hubview"];
const isPublic = () => PUB_VIEWS.includes(state.view);

const initials = (name) =>
  String(name || "?")
    .trim()
    .slice(0, 2)
    .toUpperCase() || "?";

const handleOf = (row) => {
  const name = String(row?.username || "").trim();
  if (!name) return row?.code ? `@${String(row.code).toLowerCase()}` : "";
  return name.startsWith("@") ? name : `@${name}`;
};

function flagOf(country) {
  const row = countryByName(country);
  return row ? flagMarkup(row.code, { size: 18, label: row.name }) : "";
}

function dateOf(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return "—";
  try {
    return date.toLocaleDateString("en-GB", { month: "short", year: "numeric" });
  } catch {
    return date.toISOString().slice(0, 7);
  }
}

function avatarBlock(url, name, cls = "crp-avatar") {
  const src = String(url || "").trim();
  if (src) return `<span class="${cls}"><img src="${esc(src)}" alt="" width="64" height="64" loading="lazy" /></span>`;
  return `<span class="${cls} is-initial" aria-hidden="true">${esc(initials(name))}</span>`;
}

function statPill(icon, value, label) {
  return `<span class="cr-pill" title="${esc(label)}"><i data-icon="${esc(icon)}"></i>${esc(num(Number(value) || 0))}${label ? ` <span class="crp-pill__word">${esc(label)}</span>` : ""}</span>`;
}

/* ------------------------------------------------------------------ */
/* the directory                                                      */
/* ------------------------------------------------------------------ */
function renderDirectory(host) {
  const d = state.directory;
  const countryOptions = [`<option value="">Every country</option>`]
    .concat(
      (d.countries || []).map(
        (name) => `<option value="${esc(name)}" ${String(d.country).toLowerCase() === String(name).toLowerCase() ? "selected" : ""}>${esc(name)}</option>`
      )
    )
    .join("");
  const kindOptions = [`<option value="">Every kind</option>`]
    .concat(
      HUBS.map(
        (row) => `<option value="${esc(row.kind)}" ${d.kind === row.kind ? "selected" : ""}>${esc(row.label)}</option>`
      )
    )
    .join("");
  const sortOptions = SORTS.map(
    ([value, label]) => `<option value="${value}" ${d.sort === value ? "selected" : ""}>${esc(label)}</option>`
  ).join("");

  host.innerHTML = `
    <div class="crp">
      <header class="crp-hero">
        <p class="crp-hero__eyebrow"><i data-icon="sparkle"></i> The directory</p>
        <h1 class="crp-hero__title">Find a creator</h1>
        <p class="crp-hero__text">Search by name, handle or member code, then walk into the studios, blogs, spaces, libraries, galleries, servers and cinemas they run.</p>
        <form class="crp-search" data-crp-form role="search">
          <label class="crp-search__box">
            <i data-icon="search"></i>
            <input class="crp-search__input" type="search" name="q" value="${esc(d.q)}" placeholder="Name, @handle or ID100015" aria-label="Search creators" data-crp-q autocomplete="off" />
          </label>
          <div class="crp-search__filters">
            <select class="dsh-select" data-crp-kind aria-label="Filter by kind of hub">${kindOptions}</select>
            <select class="dsh-select" data-crp-country aria-label="Filter by country">${countryOptions}</select>
            <select class="dsh-select" data-crp-sort aria-label="Sort creators">${sortOptions}</select>
            <button class="dsh-btn dsh-btn--primary" type="submit"><i data-icon="search"></i> Search</button>
          </div>
        </form>
        <p class="crp-count" data-crp-count>${directoryLine()}</p>
      </header>
      <div class="crp-grid" data-crp-grid>${directoryCards()}</div>
    </div>`;
  hydrateIcons(host);
}

function directoryLine() {
  const d = state.directory;
  if (d.loading) return "Looking for creators…";
  if (d.error) return d.error;
  const count = Number(d.count || 0);
  if (!count) return d.q || d.kind || d.country ? "No creator matches these filters." : "No creator has opened a hub yet.";
  return `${num(count)} creator${count === 1 ? "" : "s"}${d.q ? ` for “${d.q}”` : ""}${d.kind ? ` with a ${hubInfo(d.kind).noun}` : ""}`;
}

function directoryCards() {
  const d = state.directory;
  if (d.loading && !d.rows.length) return `<div class="crp-skeleton" aria-hidden="true"></div>`;
  if (!d.rows.length) {
    return `
      <div class="cr-empty">
        <i data-icon="search"></i>
        <p class="cr-empty__title">${d.error ? "The directory did not answer" : "Nothing here yet"}</p>
        <p class="cr-empty__text">${d.error ? "Check the connection and try again." : "Try a shorter name, another country, or no filter at all."}</p>
        ${d.q || d.kind || d.country ? `<button class="dsh-btn dsh-btn--sm" type="button" data-crp-clear><i data-icon="refresh"></i> Clear the filters</button>` : ""}
      </div>`;
  }
  return d.rows
    .map((row) => {
      const counts = row.counts || {};
      const kinds = HUBS.filter((hub) => Number(counts[hub.kind] || 0) > 0)
        .map(
          (hub) =>
            `<span class="crp-kind"><i data-icon="${esc(hub.icon)}"></i>${esc(hub.label)}${Number(counts[hub.kind]) > 1 ? ` <b>${Number(counts[hub.kind])}</b>` : ""}</span>`
        )
        .join("");
      const fields = (row.fields || [])
        .filter(Boolean)
        .slice(0, 3)
        .map((field) => `<span class="crp-tag">${esc(field)}</span>`)
        .join("");
      return `
        <article class="crp-card">
          ${avatarBlock(row.avatar, row.name)}
          <div class="crp-card__body">
            <a class="crp-card__name" href="creator.html?creator=${encodeURIComponent(row.ref || row.code || "")}" data-crp-open="${esc(row.ref || row.code || "")}">${esc(row.name || "Member")}</a>
            <p class="crp-card__handle">${esc(handleOf(row))} · ${esc(row.code || "")}</p>
            <p class="crp-card__where">${flagOf(row.country)}<span>${esc(row.country || "No country")}</span></p>
            ${kinds ? `<p class="crp-kinds">${kinds}</p>` : ""}
            ${fields ? `<p class="crp-tags">${fields}</p>` : ""}
            <p class="crp-card__stats">
              <span><b>${esc(num(Number(row.hubs) || 0))}</b> hub${Number(row.hubs) === 1 ? "" : "s"}</span>
              <span><b>${esc(num(Number(row.subscribers) || 0))}</b> subscribers</span>
              <span><b>${esc(num(Number(row.items) || 0))}</b> items</span>
            </p>
          </div>
          <a class="dsh-btn dsh-btn--sm crp-card__open" href="creator.html?creator=${encodeURIComponent(row.ref || row.code || "")}" data-crp-open="${esc(row.ref || row.code || "")}">Open<i data-icon="arrowRight"></i></a>
        </article>`;
    })
    .join("");
}

function renderDirectoryResults() {
  const count = el("[data-crp-count]");
  if (count) count.textContent = directoryLine();
  const grid = el("[data-crp-grid]");
  if (grid) {
    grid.innerHTML = directoryCards();
    hydrateIcons(grid);
  }
  const selected = el("[data-crp-country]");
  if (selected && (state.directory.countries || []).length) {
    const current = state.directory.country;
    selected.innerHTML =
      `<option value="">Every country</option>` +
      state.directory.countries
        .map((name) => `<option value="${esc(name)}" ${String(current).toLowerCase() === String(name).toLowerCase() ? "selected" : ""}>${esc(name)}</option>`)
        .join("");
    selected.value = current;
  }
}

async function loadDirectory({ focus = false } = {}) {
  const d = state.directory;
  d.loading = true;
  renderDirectoryResults();
  try {
    const res = await rpc("creators_search", {
      p_token: state.token || "",
      p_query: d.q,
      p_kind: d.kind,
      p_country: d.country,
      p_sort: d.sort,
    });
    if (res && res.ok) {
      d.rows = Array.isArray(res.rows) ? res.rows : [];
      d.countries = Array.isArray(res.countries) ? res.countries : d.countries;
      d.count = Number(res.count || d.rows.length);
      d.error = "";
    } else {
      d.rows = [];
      d.error = "The directory did not answer.";
    }
  } catch {
    d.rows = [];
    d.error = "The directory did not answer. Check the connection.";
  }
  d.loading = false;
  if (state.view !== "creators") return;
  // the first answer also brings the country list, so a whole repaint is cheaper
  if (!el("[data-crp-count]")) return renderView();
  renderDirectoryResults();
  if (focus) {
    const box = el("[data-crp-q]");
    if (box) {
      box.focus?.();
      const end = box.value.length;
      box.setSelectionRange?.(end, end);
    }
  }
}

let directoryTimer = null;
function queueDirectorySearch() {
  clearTimeout(directoryTimer);
  directoryTimer = setTimeout(() => {
    if (state.view === "creators") loadDirectory({ focus: true });
  }, 320);
}

/* ------------------------------------------------------------------ */
/* one creator                                                        */
/* ------------------------------------------------------------------ */
function renderCreatorPage(host) {
  const page = state.page;
  if (!page) {
    host.innerHTML = state.pageError
      ? emptyBlock("user", "This creator was not found", "The code, handle or link does not belong to a member with a hub.")
      : `<div class="crp"><div class="crp-skeleton" aria-hidden="true"></div></div>`;
    hydrateIcons(host);
    return;
  }
  const creator = page.creator || {};
  const totals = page.totals || {};
  const hubs = Array.isArray(page.hubs) ? page.hubs : [];
  const groups = HUBS.map((info) => ({
    info,
    rows: hubs.filter((hub) => hub.kind === info.kind),
  })).filter((group) => group.rows.length);

  const fields = (creator.fields || [])
    .filter(Boolean)
    .map((field) => `<span class="crp-tag">${esc(field)}</span>`)
    .join("");

  host.innerHTML = `
    <div class="crp">
      <nav class="crp-back">
        <a href="creator.html?section=creators" data-crp-back><i data-icon="arrowLeft"></i> All creators</a>
      </nav>

      <header class="crp-profile">
        ${avatarBlock(creator.avatar, creator.name, "crp-avatar crp-avatar--lg")}
        <div class="crp-profile__id">
          <h1 class="crp-profile__name">${esc(creator.name || "Member")}</h1>
          <p class="crp-profile__handle">${esc(handleOf(creator))} <span class="crp-code">${esc(creator.code || "")}</span></p>
          <p class="crp-profile__where">${flagOf(creator.country)}<span>${esc(creator.country || "No country")}</span> · joined ${esc(dateOf(creator.joined))}</p>
          ${fields ? `<p class="crp-tags">${fields}</p>` : ""}
          ${creator.bio ? `<p class="crp-profile__bio">${esc(creator.bio)}</p>` : ""}
          <div class="crp-profile__acts">
            ${page.is_self ? `<a class="dsh-btn dsh-btn--primary dsh-btn--sm" href="creator.html?section=studio"><i data-icon="settings"></i> Manage your hubs</a>` : ""}
            <button class="dsh-btn dsh-btn--sm" type="button" data-crp-copy="${esc(creator.code || "")}"><i data-icon="link"></i> Copy the code</button>
          </div>
        </div>
        <div class="crp-stats">
          <span class="crp-stat"><b>${esc(num(Number(totals.hubs) || 0))}</b><small>hubs</small></span>
          <span class="crp-stat"><b>${esc(num(Number(totals.subscribers) || 0))}</b><small>subscribers</small></span>
          <span class="crp-stat"><b>${esc(num(Number(totals.items) || 0))}</b><small>items</small></span>
          <span class="crp-stat"><b>${esc(num(Number(totals.minutes) || 0))}</b><small>minutes</small></span>
          <span class="crp-stat"><b>${esc(num(Number(totals.likes) || 0))}</b><small>likes</small></span>
        </div>
      </header>

      <section class="crp-hubs" aria-label="The hubs of this creator">
        <h2 class="crp-hubs__title">Everything ${esc((creator.name || "this creator").split(" ")[0])} runs</h2>
        ${
          groups.length
            ? groups
                .map(
                  (group) => `
          <div class="crp-group" data-crp-group="${esc(group.info.kind)}">
            <h3 class="crp-group__head"><i data-icon="${esc(group.info.icon)}"></i>${esc(group.info.plural)} <span>${group.rows.length}</span></h3>
            <div class="crp-hubgrid">
              ${group.rows.map(hubCard).join("")}
            </div>
          </div>`
                )
                .join("")
            : emptyBlock("info", "No hub in the open", "This creator has not opened a public studio, blog, space, library, gallery, server or cinema yet.")
        }
      </section>
    </div>`;
  hydrateIcons(host);
}

function hubCard(hub) {
  const info = hubInfo(hub.kind);
  const logo = hub.logo_url
    ? `<img src="${esc(hub.logo_url)}" alt="" width="44" height="44" loading="lazy" />`
    : `<span aria-hidden="true">${esc(initials(hub.name))}</span>`;
  const privateHub = hub.visibility === "private";
  return `
    <a class="crp-hubcard" href="${esc(studioLink(hub.code || hub.id))}" data-crp-hub="${esc(hub.code || hub.id)}">
      <span class="crp-hubcard__logo">${logo}</span>
      <span class="crp-hubcard__body">
        <span class="crp-hubcard__kind"><i data-icon="${esc(info.icon)}"></i>${esc(info.label)}</span>
        <span class="crp-hubcard__name">${esc(hub.name)}</span>
        <span class="crp-hubcard__desc">${esc(hub.description || hub.field || "No description yet")}</span>
        <span class="crp-hubcard__stats">
          <span class="cr-pill" data-tone="${esc(hub.visibility || "public")}"><i data-icon="${privateHub ? "lock" : "shield"}"></i>${esc(visLabel(hub.visibility))}</span>
          ${statPill("users", hub.subscribers, "")}
          ${statPill("file", hub.items, "")}
          ${statPill("clock", hub.minutes, "min")}
        </span>
      </span>
      <span class="crp-hubcard__go"><i data-icon="arrowRight"></i></span>
    </a>`;
}

async function loadCreatorPage(ref) {
  state.page = null;
  state.pageError = "";
  renderView();
  try {
    const res = await rpc("creator_public", { p_token: state.token || "", p_ref: ref });
    if (res && res.ok) state.page = res;
    else state.pageError = (res && res.error) || "not_found";
  } catch {
    state.pageError = "network";
  }
  if (state.view !== "creator") return;
  renderView();
}

/* ------------------------------------------------------------------ */
/* one hub, as a visitor                                              */
/* ------------------------------------------------------------------ */
function renderHubPage(host) {
  const view = state.hubView;
  if (!view) {
    host.innerHTML = state.hubError
      ? emptyBlock("info", "This hub is not here", "The link may be old, or the hub was closed by its owner.")
      : `<div class="crp"><div class="crp-skeleton" aria-hidden="true"></div></div>`;
    hydrateIcons(host);
    return;
  }
  const hub = view.hub || {};
  const info = hubInfo(hub.kind);
  const items = Array.isArray(view.items) ? view.items : [];
  const owner = state.page && state.page.creator && state.page.creator.code === hub.owner ? state.page.creator : null;
  const ownerLabel = owner ? owner.name : hub.owner || "the owner";
  const cover = hub.cover_url
    ? `<img class="crp-hubhero__cover" src="${esc(hub.cover_url)}" alt="" loading="lazy" />`
    : `<span class="crp-hubhero__cover is-plain" aria-hidden="true"></span>`;
  const logo = hub.logo_url
    ? `<img src="${esc(hub.logo_url)}" alt="" width="72" height="72" />`
    : `<span aria-hidden="true">${esc(initials(hub.name))}</span>`;
  const role = hub.role || "visitor";
  const manageSection = hubInfo(hub.kind).slug;

  const body = view.locked
    ? `
      <div class="crp-lock" data-crp-lock>
        <span class="crp-lock__icon"><i data-icon="lock"></i></span>
        <h2 class="crp-lock__title">This hub is private</h2>
        <p class="crp-lock__text">${
          hub.has_password
            ? hub.password_until
              ? `Ask ${esc(ownerLabel)} for the password. The last one closed on ${esc(dateOf(hub.password_until))}.`
              : `Ask ${esc(ownerLabel)} for the password to walk in.`
            : `Ask ${esc(ownerLabel)} to add your member code to the VIP list.`
        }</p>
        ${
          hub.has_password
            ? `<form class="crp-lock__form" data-crp-unlock-form>
                 <input class="dsh-input" type="password" name="password" placeholder="The password" aria-label="Hub password" data-crp-password autocomplete="off" />
                 <button class="dsh-btn dsh-btn--primary" type="submit"><i data-icon="unlock"></i> Unlock</button>
               </form>
               <p class="crp-lock__state" data-crp-lock-state role="status"></p>`
            : `<p class="crp-lock__state" data-crp-lock-state role="status">No password — the VIP list only.</p>`
        }
      </div>`
    : `
      ${
        items.length
          ? `<div class="crp-items">${items.map(itemCard).join("")}</div>`
          : emptyBlock(info.icon, "Nothing published yet", `This ${esc(info.noun)} has no item in the open. Subscribe and come back.`)
      }`;

  host.innerHTML = `
    <div class="crp">
      <nav class="crp-back">
        <a href="creator.html?creator=${encodeURIComponent(hub.owner || "")}" data-crp-owner="${esc(hub.owner || "")}"><i data-icon="arrowLeft"></i> ${esc(ownerLabel)}</a>
        <a href="creator.html?section=creators" data-crp-back>All creators</a>
      </nav>

      <header class="crp-hubhero">
        ${cover}
        <div class="crp-hubhero__bar">
          <span class="crp-hubhero__logo">${logo}</span>
          <div class="crp-hubhero__id">
            <p class="crp-hubhero__kind"><i data-icon="${esc(info.icon)}"></i>${esc(info.label)}<span class="crp-hubhero__code">${esc(hub.code || "")}</span></p>
            <h1 class="crp-hubhero__name">${esc(hub.name || "Hub")}</h1>
            <p class="crp-hubhero__owner">by <a href="creator.html?creator=${encodeURIComponent(hub.owner || "")}" data-crp-owner="${esc(hub.owner || "")}">${esc(ownerLabel)}</a>${hub.field ? ` · ${esc(hub.field)}` : ""}</p>
          </div>
          <div class="crp-hubhero__acts">
            ${
              role === "owner" || role === "staff"
                ? `<a class="dsh-btn dsh-btn--sm" href="creator.html?section=${encodeURIComponent(manageSection)}&hub=${encodeURIComponent(hub.id)}"><i data-icon="settings"></i> Manage</a>
                   <a class="dsh-btn dsh-btn--sm" href="creator.html?section=${encodeURIComponent(manageSection)}&hub=${encodeURIComponent(hub.id)}&tab=participants"><i data-icon="users"></i> Requests</a>`
                : ""
            }
            <button class="dsh-btn dsh-btn--primary dsh-btn--sm" type="button" data-crp-sub="${esc(hub.id)}" data-on="${hub.subscribed ? "1" : "0"}" ${hub.can_subscribe === false && !hub.subscribed ? "disabled aria-disabled=\"true\"" : ""}>
              <i data-icon="${hub.subscribed ? "check" : hub.can_subscribe === false ? "lock" : "users"}"></i> ${hub.subscribed ? "Subscribed" : hub.can_subscribe === false ? "Closed" : "Subscribe"}
            </button>
          </div>
        </div>
        <div class="crp-hubhero__meta">
          <span class="cr-pill" data-tone="${esc(hub.visibility || "public")}"><i data-icon="${hub.visibility === "private" ? "lock" : "shield"}"></i>${esc(visLabel(hub.visibility))}</span>
          ${hub.viewers != null ? `<span class="cr-pill" data-crp-devices><i data-icon="users"></i>${esc(num(Number(hub.viewers)))} at once</span>` : ""}
          ${hub.auto_accept === false ? '<span class="cr-pill" data-crp-closed><i data-icon="lock"></i>Subscriptions closed</span>' : ""}
          ${statPill("users", hub.subscribers, "subscribers")}
          ${statPill("file", hub.items, "items")}
          ${statPill("clock", hub.minutes, "min")}
          ${statPill("thumbUp", hub.likes, "likes")}
          ${hub.niches?.length ? `<span class="crp-tag">${esc(hub.niches.join(" · "))}</span>` : ""}
        </div>
        ${hub.description ? `<p class="crp-hubhero__desc">${esc(hub.description)}</p>` : ""}
      </header>

      ${view.locked ? "" : participationBlock(hub, view)}
      ${view.locked ? "" : adsBlock(hub)}

      ${body}
    </div>`;
  hydrateIcons(host);
}

function itemCard(row) {
  const info = hubInfo(row.kind);
  const thumb = row.thumbnail
    ? `<img class="crp-item__thumb" src="${esc(row.thumbnail)}" alt="" loading="lazy" />`
    : `<span class="crp-item__thumb is-plain" aria-hidden="true"><i data-icon="${esc(KIND_ICON[row.kind] || "file")}"></i></span>`;
  const date = row.published_at ? dateOf(row.published_at) : "";
  return `
    <article class="crp-item" data-crp-item="${esc(row.id || "")}">
      ${thumb}
      <div class="crp-item__body">
        <p class="crp-item__kind"><i data-icon="${esc(info.icon)}"></i>${esc(KIND_LABEL[row.kind] || info.label)}${row.visibility && row.visibility !== "public" ? ` · ${esc(visLabel(row.visibility))}` : ""}</p>
        <h3 class="crp-item__title">${esc(row.title || "Untitled")}</h3>
        ${row.summary ? `<p class="crp-item__summary">${esc(row.summary)}</p>` : ""}
        ${
          (row.meta?.quality || []).length
            ? `<p class="crp-item__quality">${(row.meta.quality || []).map((q) => `<span class="cr-qchip is-on">${esc(String(q))}</span>`).join("")}</p>`
            : ""
        }
        <p class="crp-item__meta">
          <span><i data-icon="clock"></i>${esc(num(Number(row.minutes) || 0))} min</span>
          ${
            row.meta?.subtitles
              ? `<span><i data-icon="article"></i>subtitles${(row.meta.subtitle_langs || []).length ? ` · ${esc(row.meta.subtitle_langs.join(", "))}` : ""}</span>`
              : ""
          }
          ${row.meta?.ads ? `<span><i data-icon="flag"></i>carries ads</span>` : ""}
          ${row.cap != null ? `<span><i data-icon="users"></i>${esc(num(Number(row.cap)))} at once</span>` : ""}
          <span><i data-icon="thumbUp"></i>${esc(num(Number(row.likes) || 0))}</span>
          <span><i data-icon="comment"></i>${esc(num(Number(row.comments) || 0))}</span>
          ${date ? `<span>${esc(date)}</span>` : ""}
        </p>
      </div>
      ${
        row.media_url
          ? `<a class="dsh-btn dsh-btn--sm crp-item__open" href="${esc(row.media_url)}" target="_blank" rel="noopener noreferrer"><i data-icon="play"></i> Open</a>`
          : ""
      }
    </article>`;
}

async function loadHubPage(ref, password = "") {
  state.hubView = null;
  state.hubError = "";
  state.hubRef = ref;
  renderView();
  try {
    const res = await rpc("creator_hub_view", { p_token: state.token || "", p_hub: ref, p_password: password });
    if (res && res.ok) {
      state.hubView = res;
      state.hubViewId = res.hub?.id || ref;
      state.hubError = "";
    } else {
      state.hubView = null;
      state.hubError = (res && res.error) || "not_found";
    }
  } catch {
    state.hubView = null;
    state.hubError = "network";
  }
  if (state.view !== "hubview") return;
  renderView();
  // the owner line needs the creator page; one extra call, once
  if (state.hubView && !state.page && state.hubView.hub?.owner) {
    const ref = state.hubView.hub.owner;
    try {
      const page = await rpc("creator_public", { p_token: state.token || "", p_ref: ref });
      if (page && page.ok) {
        state.page = page;
        if (state.view === "hubview") renderView();
      }
    } catch {
      /* the hub still reads without the owner's name */
    }
  }
}

async function subscribeToHub(id) {
  if (!state.token) {
    toast({ title: "Sign in first", message: "Subscribing to a hub needs a member session.", tone: "error", iconName: "lock" });
    return;
  }
  try {
    const res = await rpc("creator_subscribe", { p_token: state.token, p_hub: id });
    if (!res || !res.ok) {
      const error = (res && res.error) || "";
      toast({ title: "Not subscribed", message: MESSAGES[error] || "The subscription did not go through.", tone: "error" });
      return;
    }
    toast({ title: res.subscribed ? "Subscribed" : "Unsubscribed", message: res.subscribed ? "The exclusive items of this hub are open to you now." : "You can subscribe again at any time.", iconName: res.subscribed ? "check" : "info" });
    await loadHubPage(id);
  } catch {
    toast({ title: "Not subscribed", message: "The connection dropped before the server answered.", tone: "error" });
  }
}

/* ------------------------------------------------------------------ */
/* moving between the three views                                     */
/* ------------------------------------------------------------------ */
function hideAdminChrome(hidden) {
  ["[data-cr-top]", "[data-cr-hubhead]", "[data-cr-tabs]"].forEach((sel) => {
    const node = el(sel);
    if (!node) return;
    node.hidden = hidden;
    node.style.display = hidden ? "none" : "";
  });
}

async function openDirectory() {
  state.view = "creators";
  state.page = null;
  state.hubView = null;
  state.rows = [];
  hideAdminChrome(true);
  renderRail();
  renderView();
  syncUrl();
  await loadDirectory();
}

async function openCreator(ref) {
  const wanted = String(ref || "").trim().replace(/^@/, "@");
  if (!wanted) return;
  state.view = "creator";
  state.creatorRef = wanted;
  state.page = null;
  state.pageError = "";
  state.hubView = null;
  hideAdminChrome(true);
  renderRail();
  renderView();
  syncUrl();
  await loadCreatorPage(wanted);
}

async function openHub(id) {
  if (!id) return;
  state.view = "hubview";
  state.hubView = null;
  state.hubError = "";
  state.hubViewId = id;
  hideAdminChrome(true);
  renderRail();
  renderView();
  syncUrl();
  await loadHubPage(id);
  syncUrl();
}

/* ================================================================== */
/* who works in this hub — publishers, advertisers, requests          */
/* ================================================================== */
/*
 * A hub is somebody's place. Two other people can be let in:
 *
 *   a publisher  writes content there (what they submit lands as a draft
 *                the owner publishes from the tables)
 *   an advertiser runs an ad there — a banner, a video, an image or a
 *                paragraph of text, with an optional link
 *
 * They ask from the hub's public page (`creator_request_send`); the owner
 * or the staff approve here (`creator_request_decide`). Approving writes
 * the member's code into `creator_hubs.publishers` / `.advertisers`, which
 * is what the server checks before it accepts an item or an ad.
 */

const ROLES = { publisher: "Publisher", advertiser: "Advertiser" };

const AD_FORMATS = [
  ["banner", "Banner"],
  ["video", "Video"],
  ["image", "Image"],
  ["paragraph", "Paragraph"],
];

const AD_FORMAT_LABEL = Object.fromEntries(AD_FORMATS);

const AD_FORMAT_ICON = { banner: "image", video: "film", image: "crop", paragraph: "article" };

const requestStatusLabel = (status) =>
  ({
    pending: "Waiting",
    approved: "Approved",
    rejected: "Refused",
    withdrawn: "Withdrawn",
  })[status] || "Waiting";

/** `creator.html?studio=IDST100001` — the link a place is known by. */
const studioLink = (code) => `creator.html?studio=${encodeURIComponent(code || "")}`;

function copyText(value, label = "Link") {
  const text = String(value || "");
  if (!text) return;
  navigator.clipboard?.writeText?.(text).then(
    () => toast({ title: `${label} copied`, message: text, iconName: "check" }),
    () => toast({ title: `The ${label.toLowerCase()}`, message: text, tone: "error" })
  );
}

/* ------------------------------------------------------------------ */
/* the studio's Participants tab                                      */
/* ------------------------------------------------------------------ */
function renderParticipants(host, hub) {
  const data = state.participants || {};
  const rows = Array.isArray(data.rows) ? data.rows : [];
  const pubs = Array.isArray(data.publishers) ? data.publishers : [];
  const advs = Array.isArray(data.advertisers) ? data.advertisers : [];
  const ads = Array.isArray(state.ads) ? state.ads : [];
  const counts = data.counts || {};
  const pending = rows.filter((row) => row.status === "pending");
  const decided = rows.filter((row) => row.status !== "pending");

  const requestCard = (row) => {
    const member = row.member || {};
    const role = ROLES[row.role] || row.role;
    return `
      <article class="cr-req ${row.status === "pending" ? "is-pending" : ""}" data-req="${esc(row.id)}">
        <span class="cr-req__avatar">${avatarBlock(member.avatar, member.name, "crp-avatar crp-avatar--sm")}</span>
        <div class="cr-req__body">
          <p class="cr-req__head">
            <span class="cr-req__name">${esc(member.name || "Member")}</span>
            <span class="cr-req__code">${esc(member.code || "")}</span>
            <span class="cr-chip" data-tone="${esc(row.role)}">${esc(role)}</span>
            ${row.format ? `<span class="cr-chip" data-tone="format">${esc(AD_FORMAT_LABEL[row.format] || row.format)}</span>` : ""}
            <span class="cr-chip" data-tone="${esc(row.status)}">${esc(requestStatusLabel(row.status))}</span>
          </p>
          <p class="cr-req__text">${esc(row.message || "")}</p>
          <p class="cr-req__meta">
            <span>${esc(member.username || "")}</span>
            ${member.country ? `<span>${esc(member.country)}</span>` : ""}
            ${row.budget ? `<span>${esc(num(Number(row.budget) || 0))} pts</span>` : ""}
            ${row.link ? `<a href="${esc(row.link)}" target="_blank" rel="noopener noreferrer">The sample</a>` : ""}
            <span>${esc(timeAgo(row.created_at))}</span>
          </p>
        </div>
        <div class="cr-req__acts">
          ${row.status === "pending"
            ? `<button class="dsh-btn dsh-btn--primary dsh-btn--sm" type="button" data-cr-req="approve" data-id="${esc(row.id)}"><i data-icon="check"></i> Approve</button>
               <button class="dsh-btn dsh-btn--sm" type="button" data-cr-req="reject" data-id="${esc(row.id)}"><i data-icon="close"></i> Refuse</button>`
            : `<span class="cr-req__since">${row.decided_at ? esc(timeAgo(row.decided_at)) : ""}</span>`}
        </div>
      </article>`;
  };

  const listRow = (member, extra = "") => `
    <li class="cr-who">
      ${avatarBlock(member.avatar, member.name, "crp-avatar crp-avatar--sm")}
      <span class="cr-who__name">${esc(member.name || "Member")}</span>
      <span class="cr-who__code">${esc(member.code || "")}</span>
      <span class="cr-who__handle">${esc(member.username || "")}</span>
      ${extra}
    </li>`;

  const adRows = ads.length
    ? ads
        .map(
          (ad) => `
      <li class="cr-adrow">
        <span class="cr-adrow__format"><i data-icon="${esc(AD_FORMAT_ICON[ad.format] || "image")}"></i>${esc(AD_FORMAT_LABEL[ad.format] || ad.format)}</span>
        <span class="cr-adrow__title">${esc(ad.title)}</span>
        <span class="cr-adrow__who">${esc(ad.member?.name || "")}</span>
        <span class="cr-chip" data-tone="${ad.status === "live" ? "public" : "private"}">${esc(ad.status === "live" ? "Live" : "Paused")}</span>
        <span class="cr-adrow__num">${esc(num(Number(ad.impressions) || 0))}</span>
        <span class="cr-adrow__num">${esc(num(Number(ad.clicks) || 0))}</span>
        <button class="dsh-btn dsh-btn--sm" type="button" data-cr-ad-del="${esc(ad.id)}" aria-label="Remove the ad"><i data-icon="trash"></i></button>
      </li>`
        )
        .join("")
    : `<li class="cr-empty__line">No ad yet.</li>`;

  host.innerHTML = `
    <div class="cr-part">
      <div class="cr-bar">
        <span class="cr-bar__count">${esc(num(Number(counts.pending) || 0))} waiting · ${esc(num(pubs.length))} publisher${pubs.length === 1 ? "" : "s"} · ${esc(num(advs.length))} advertiser${advs.length === 1 ? "" : "s"}</span>
        <span class="cr-part__link">
          <i data-icon="link"></i><code>${esc(studioLink(hub.code || hub.id))}</code>
          <button class="dsh-btn dsh-btn--sm" type="button" data-cr-copy="${esc(studioLink(hub.code || hub.id))}">Copy</button>
        </span>
      </div>

      <section class="cr-panel">
        <h2 class="cr-panel__title"><i data-icon="users"></i> Waiting for an answer</h2>
        ${pending.length ? pending.map(requestCard).join("") : `<p class="cr-empty__line">Nobody is waiting. Publishers and advertisers ask from the hub's own page.</p>`}
      </section>

      <section class="cr-panel">
        <h2 class="cr-panel__title"><i data-icon="article"></i> Publishers <span class="cr-panel__n">${pubs.length}</span></h2>
        ${pubs.length ? `<ul class="cr-who-list">${pubs.map((member) => listRow(member)).join("")}</ul>` : `<p class="cr-empty__line">No publisher yet — their drafts would arrive as drafts in this hub's tables.</p>`}
      </section>

      <section class="cr-panel">
        <h2 class="cr-panel__title"><i data-icon="target"></i> Advertisers <span class="cr-panel__n">${advs.length}</span></h2>
        ${advs.length ? `<ul class="cr-who-list">${advs.map((member) => listRow(member, `<span class="cr-who__extra">${esc(num(Number(member.ads) || 0))} ad${Number(member.ads) === 1 ? "" : "s"}</span>`)).join("")}</ul>` : `<p class="cr-empty__line">No advertiser yet — a banner, a video, an image or a paragraph, chosen by them.</p>`}
      </section>

      <section class="cr-panel">
        <h2 class="cr-panel__title"><i data-icon="fire"></i> The ads in this hub <span class="cr-panel__n">${ads.length}</span></h2>
        ${
          ads.length
            ? `<div class="cr-adtable">
                 <div class="cr-adtable__head"><span>Format</span><span>Title</span><span>Advertiser</span><span>State</span><span>Views</span><span>Clicks</span><span></span></div>
                 <ul class="cr-adlist">${adRows}</ul>
               </div>`
            : `<p class="cr-empty__line">No ad in this hub yet.</p>`
        }
      </section>

      ${decided.length
        ? `<section class="cr-panel">
             <h2 class="cr-panel__title"><i data-icon="clock"></i> Already answered</h2>
             ${decided.map(requestCard).join("")}
           </section>`
        : ""}
    </div>`;
  hydrateIcons(host);
}

async function decideRequest(id, decision) {
  const stateNode = el(`[data-req="${id}"] .cr-req__acts`);
  if (stateNode) stateNode.innerHTML = `<span class="cr-req__since">Working…</span>`;
  try {
    const res = await rpc("creator_request_decide", { p_token: state.token, p_id: id, p_decision: decision });
    if (!res || !res.ok) {
      toast({
        title: "Not decided",
        message:
          { session: "The session ended.", decided: "Somebody already answered this one.", not_found: "That request is gone.", decision: "Unknown answer." }[
            res?.error
          ] || "The server refused the answer.",
        tone: "error",
      });
      return loadTab().then(refresh);
    }
    toast({
      title: decision === "approve" ? "Approved" : "Refused",
      message:
        decision === "approve"
          ? "They can work in this hub now."
          : "The request is closed; nothing was shared.",
      iconName: decision === "approve" ? "check" : "close",
    });
    await loadHubs();
    await loadTab();
    await refresh();
  } catch {
    toast({ title: "Not decided", message: "The connection dropped.", tone: "error" });
  }
}

async function removeAd(id) {
  try {
    const res = await rpc("creator_ad_delete", { p_token: state.token, p_id: id });
    if (!res || !res.ok) {
      toast({ title: "Not removed", message: "The server refused it.", tone: "error" });
      return;
    }
    toast({ title: "Ad removed", message: "It is gone from the hub.", iconName: "trash" });
    await loadTab();
    await refresh();
  } catch {
    toast({ title: "Not removed", message: "The connection dropped.", tone: "error" });
  }
}

/* ------------------------------------------------------------------ */
/* the hub's page: asking to join, writing, advertising               */
/* ------------------------------------------------------------------ */
function participationBlock(hub, view) {
  const request = hub.request || view.request || null;
  const can = hub.can || {};
  const role = hub.role || "visitor";
  const manageLink = `<a class="dsh-btn dsh-btn--sm" href="creator.html?section=${encodeURIComponent(hubInfo(hub.kind).slug)}&hub=${encodeURIComponent(hub.id)}&tab=participants"><i data-icon="users"></i> Requests</a>`;

  if (role === "owner" || role === "staff") {
    return `
      <section class="crp-join">
        <div class="crp-join__text">
          <p class="crp-join__title"><i data-icon="users"></i> Who works here</p>
          <p class="crp-join__note">Publishers write content in this place, advertisers run a banner, a video, an image or a paragraph. Approve or refuse them in the studio.</p>
        </div>
        <div class="crp-join__acts">${manageLink}</div>
      </section>`;
  }

  const chips = [];
  if (can.publish) chips.push(`<span class="cr-chip" data-tone="approved"><i data-icon="article"></i>You publish here</span>`);
  if (can.advertise) chips.push(`<span class="cr-chip" data-tone="approved"><i data-icon="target"></i>You advertise here</span>`);
  if (request) {
    chips.push(
      `<span class="cr-chip" data-tone="${esc(request.status)}">${esc(ROLES[request.role] || request.role)} · ${esc(requestStatusLabel(request.status))}</span>`
    );
  }

  const acts = [];
  if (can.publish) {
    acts.push(`<button class="dsh-btn dsh-btn--sm" type="button" data-crp-write="${esc(hub.id)}"><i data-icon="plus"></i> Write in this hub</button>`);
  } else if (!request || request.status !== "pending") {
    acts.push(`<button class="dsh-btn dsh-btn--sm" type="button" data-crp-join="publisher"><i data-icon="article"></i> Request to publish</button>`);
  }
  if (can.advertise) {
    acts.push(`<button class="dsh-btn dsh-btn--sm" type="button" data-crp-ad="${esc(hub.id)}"><i data-icon="target"></i> Place an ad</button>`);
  } else if (!request || request.status !== "pending") {
    acts.push(`<button class="dsh-btn dsh-btn--sm" type="button" data-crp-join="advertiser"><i data-icon="target"></i> Request to advertise</button>`);
  }

  return `
    <section class="crp-join">
      <div class="crp-join__text">
        <p class="crp-join__title"><i data-icon="users"></i> Work in this place</p>
        <p class="crp-join__note">Ask the owner to publish your content here, or to run your ad — a banner, a video, an image or a paragraph.</p>
        ${chips.length ? `<p class="crp-join__chips">${chips.join("")}</p>` : ""}
      </div>
      <div class="crp-join__acts">${acts.join("")}</div>
    </section>`;
}

function adsBlock(hub) {
  const ads = Array.isArray(hub.ads) ? hub.ads : [];
  if (!ads.length) return "";
  return `
    <section class="crp-ads" aria-label="Advertising in this hub">
      <h2 class="crp-ads__title">Advertising in this hub</h2>
      <div class="crp-ads__list">
        ${ads
          .map((ad) => {
            const inner = `
              ${ad.format === "banner" ? `<img class="crp-ad__media is-banner" src="${esc(ad.media_url)}" alt="" loading="lazy" />` : ""}
              ${ad.format === "image" ? `<img class="crp-ad__media" src="${esc(ad.media_url)}" alt="" loading="lazy" />` : ""}
              ${ad.format === "video" ? `<video class="crp-ad__media" src="${esc(ad.media_url)}" controls preload="none"></video>` : ""}
              <span class="crp-ad__body">
                <span class="crp-ad__tag"><i data-icon="${esc(AD_FORMAT_ICON[ad.format] || "target")}"></i>${esc(AD_FORMAT_LABEL[ad.format] || ad.format)} · ${esc(ad.member || "")}</span>
                <span class="crp-ad__title">${esc(ad.title || "")}</span>
                ${ad.body ? `<span class="crp-ad__text">${esc(ad.body)}</span>` : ""}
                ${ad.link_url ? `<span class="crp-ad__link">${esc(ad.link_url.replace(/^https?:\/\//, "").slice(0, 40))}</span>` : ""}
              </span>`;
            return ad.link_url
              ? `<a class="crp-ad" data-format="${esc(ad.format)}" href="${esc(ad.link_url)}" target="_blank" rel="noopener noreferrer sponsored">${inner}</a>`
              : `<article class="crp-ad" data-format="${esc(ad.format)}">${inner}</article>`;
          })
          .join("")}
      </div>
    </section>`;
}

function openJoinRequest(role) {
  const view = state.hubView || {};
  const hub = view.hub || {};
  if (!state.token) {
    toast({ title: "Sign in first", message: "Asking to work in a place needs a member session.", tone: "error", iconName: "lock" });
    return;
  }
  const isAd = role === "advertiser";
  openModal(`
    <h2 class="cr-modal__title">${isAd ? "Advertise in this hub" : "Publish in this hub"}</h2>
    <p class="cr-modal__text">${
      isAd
        ? `${esc(hub.name || "This hub")} takes a banner, a video, an image or a paragraph. Tell the owner what you would show.`
        : `${esc(hub.name || "This hub")} would carry your content. Tell the owner what you write, and where they can see it.`
    }</p>
    <form class="cr-form" data-crp-join-form data-role="${esc(role)}">
      ${
        isAd
          ? `<label class="dsh-field">
               <span class="dsh-field__label">The format</span>
               <select class="dsh-select" data-join-format>
                 ${AD_FORMATS.map(([value, label]) => `<option value="${value}">${label}</option>`).join("")}
               </select>
             </label>`
          : ""
      }
      <label class="dsh-field">
        <span class="dsh-field__label">Your message</span>
        <textarea class="dsh-input cr-textarea" rows="4" maxlength="600" placeholder="${isAd ? "What the ad says, and to whom." : "What you would publish, and how often."}" data-join-message></textarea>
      </label>
      <label class="dsh-field">
        <span class="dsh-field__label">A sample or a portfolio (optional)</span>
        <input class="dsh-input" type="url" placeholder="https://" data-join-link />
      </label>
      ${
        isAd
          ? `<label class="dsh-field">
               <span class="dsh-field__label">A budget in points (optional)</span>
               <input class="dsh-input" type="number" min="0" max="1000000" step="10" placeholder="0" data-join-budget />
             </label>`
          : ""
      }
      <p class="cr-form__state" data-join-state role="status"></p>
      <div class="cr-modal__actions">
        <button class="dsh-btn dsh-btn--sm" type="button" data-cr-modal-close>Cancel</button>
        <button class="dsh-btn dsh-btn--primary dsh-btn--sm" type="submit"><i data-icon="send"></i> Send the request</button>
      </div>
    </form>`);
}

function openAdForm() {
  const hub = (state.hubView || {}).hub || {};
  openModal(`
    <h2 class="cr-modal__title">A new ad</h2>
    <p class="cr-modal__text">In ${esc(hub.name || "this hub")}. A banner and an image need a picture, a video needs its file, a paragraph needs its words.</p>
    <form class="cr-form" data-crp-ad-form>
      <label class="dsh-field">
        <span class="dsh-field__label">The format</span>
        <select class="dsh-select" data-ad-format>
          ${AD_FORMATS.map(([value, label]) => `<option value="${value}">${label}</option>`).join("")}
        </select>
      </label>
      <label class="dsh-field">
        <span class="dsh-field__label">The title</span>
        <input class="dsh-input" type="text" maxlength="80" placeholder="Cameras for every night shoot" data-ad-title />
      </label>
      <label class="dsh-field">
        <span class="dsh-field__label">The picture or the video link</span>
        <input class="dsh-input" type="url" placeholder="https://" data-ad-media />
      </label>
      <label class="dsh-field">
        <span class="dsh-field__label">The words (a paragraph needs 40 characters, the others may use it as a caption)</span>
        <textarea class="dsh-input cr-textarea" rows="3" maxlength="2000" data-ad-body></textarea>
      </label>
      <label class="dsh-field">
        <span class="dsh-field__label">Where a click goes (optional)</span>
        <input class="dsh-input" type="url" placeholder="https://" data-ad-link />
      </label>
      <p class="cr-form__state" data-ad-state role="status"></p>
      <div class="cr-modal__actions">
        <button class="dsh-btn dsh-btn--sm" type="button" data-cr-modal-close>Cancel</button>
        <button class="dsh-btn dsh-btn--primary dsh-btn--sm" type="submit"><i data-icon="check"></i> Put it live</button>
      </div>
    </form>`);
}

const SUBMIT_KINDS = {
  channel: [["video", "Video"], ["podcast", "Podcast"], ["playlist", "Playlist"]],
  server: [["video", "Video"], ["podcast", "Podcast"], ["playlist", "Playlist"]],
  cinema: [["video", "Video"]],
  blog: [["article", "Article"]],
  space: [["question", "Question"], ["answer", "Answer"]],
  library: [["book", "Book"], ["document", "Document"]],
  gallery: [["image", "Image"]],
};

function openWriteForm() {
  const hub = (state.hubView || {}).hub || {};
  const kinds = SUBMIT_KINDS[hub.kind] || [["article", "Article"]];
  openModal(`
    <h2 class="cr-modal__title">Write in ${esc(hub.name || "this hub")}</h2>
    <p class="cr-modal__text">It arrives as a draft: the owner reads it and publishes it from the studio.</p>
    <form class="cr-form" data-crp-write-form>
      <label class="dsh-field">
        <span class="dsh-field__label">The kind</span>
        <select class="dsh-select" data-write-kind>
          ${kinds.map(([value, label]) => `<option value="${value}">${label}</option>`).join("")}
        </select>
      </label>
      <label class="dsh-field">
        <span class="dsh-field__label">The title</span>
        <input class="dsh-input" type="text" maxlength="140" placeholder="A title" data-write-title />
      </label>
      <label class="dsh-field">
        <span class="dsh-field__label">A summary</span>
        <input class="dsh-input" type="text" maxlength="320" placeholder="One line" data-write-summary />
      </label>
      <label class="dsh-field">
        <span class="dsh-field__label">The body</span>
        <textarea class="dsh-input cr-textarea" rows="4" data-write-body></textarea>
      </label>
      <label class="dsh-field">
        <span class="dsh-field__label">The media link (a video, a podcast, a picture…)</span>
        <input class="dsh-input" type="url" placeholder="https://" data-write-media />
      </label>
      <label class="dsh-field">
        <span class="dsh-field__label">Visibility</span>
        <select class="dsh-select" data-write-vis>
          <option value="public">Public</option>
          <option value="exclusive">Exclusive — subscribers</option>
        </select>
      </label>
      <p class="cr-form__state" data-write-state role="status"></p>
      <div class="cr-modal__actions">
        <button class="dsh-btn dsh-btn--sm" type="button" data-cr-modal-close>Cancel</button>
        <button class="dsh-btn dsh-btn--primary dsh-btn--sm" type="submit"><i data-icon="send"></i> Send the draft</button>
      </div>
    </form>`);
}

async function sendJoinRequest(form) {
  const hub = (state.hubView || {}).hub || {};
  const role = form.dataset.role || "publisher";
  const stateNode = el("[data-join-state]", form);
  const message = String(el("[data-join-message]", form)?.value || "").trim();
  const link = String(el("[data-join-link]", form)?.value || "").trim();
  const format = String(el("[data-join-format]", form)?.value || "");
  const budget = Number(el("[data-join-budget]", form)?.value || 0);

  if (message.length < 10) {
    if (stateNode) stateNode.textContent = "Ten characters at least, so the owner knows what this is.";
    return;
  }
  if (stateNode) stateNode.textContent = "Sending…";

  try {
    const res = await rpc("creator_request_send", {
      p_token: state.token,
      p_hub: hub.code || hub.id,
      p_role: role,
      p_format: role === "advertiser" ? format : null,
      p_message: message,
      p_link: link,
      p_budget: role === "advertiser" ? budget : 0,
    });
    if (!res || !res.ok) {
      const words = {
        session: "The session ended — sign in again.",
        self: "This hub is yours.",
        role: "Unknown role.",
        format: "Choose a format first.",
        message: "Ten characters at least.",
        link: "The link must start with http:// or https://.",
        budget: "That budget is too large.",
        member: "You already work here.",
        exists: "Your request is already waiting for an answer.",
      };
      if (stateNode) stateNode.textContent = words[res?.error] || "The server refused the request.";
      return;
    }
    closeModal();
    toast({ title: "Request sent", message: "The owner has it; you will see the answer on this page.", iconName: "send" });
    await loadHubPage(state.hubViewId);
  } catch {
    if (stateNode) stateNode.textContent = "The connection dropped. Try again.";
  }
}

async function sendAd(form) {
  const hub = (state.hubView || {}).hub || {};
  const stateNode = el("[data-ad-state]", form);
  const payload = {
    p_token: state.token,
    p_hub: hub.code || hub.id,
    p_id: null,
    p_format: String(el("[data-ad-format]", form)?.value || "banner"),
    p_title: String(el("[data-ad-title]", form)?.value || "").trim(),
    p_body: String(el("[data-ad-body]", form)?.value || "").trim(),
    p_media_url: String(el("[data-ad-media]", form)?.value || "").trim(),
    p_link_url: String(el("[data-ad-link]", form)?.value || "").trim(),
    p_status: "live",
  };
  if (payload.p_title.length < 3) {
    if (stateNode) stateNode.textContent = "A title of three characters at least.";
    return;
  }
  if (payload.p_format === "paragraph" && payload.p_body.length < 40) {
    if (stateNode) stateNode.textContent = "A paragraph needs forty characters of its own.";
    return;
  }
  if (payload.p_format !== "paragraph" && !/^https?:\/\//i.test(payload.p_media_url)) {
    if (stateNode) stateNode.textContent = "A banner, an image and a video need their link (https://…).";
    return;
  }
  if (stateNode) stateNode.textContent = "Saving…";
  try {
    const res = await rpc("creator_ad_save", payload);
    if (!res || !res.ok) {
      const words = {
        format: "Choose banner, video, image or paragraph.",
        title: "A title of three characters at least.",
        media: "A banner, an image and a video need a link.",
        body: "A paragraph needs forty characters.",
        link: "The link must start with http:// or https://.",
        role: "You are not an advertiser here (yet).",
      };
      if (stateNode) stateNode.textContent = words[res?.error] || "The server refused the ad.";
      return;
    }
    closeModal();
    toast({ title: "Your ad is live", message: "It shows on the hub's page now.", iconName: "target" });
    await loadHubPage(state.hubViewId);
  } catch {
    if (stateNode) stateNode.textContent = "The connection dropped. Try again.";
  }
}

async function sendDraft(form) {
  const hub = (state.hubView || {}).hub || {};
  const stateNode = el("[data-write-state]", form);
  const payload = {
    p_token: state.token,
    p_hub: hub.code || hub.id,
    p_kind: String(el("[data-write-kind]", form)?.value || ""),
    p_title: String(el("[data-write-title]", form)?.value || "").trim(),
    p_summary: String(el("[data-write-summary]", form)?.value || "").trim(),
    p_body: String(el("[data-write-body]", form)?.value || "").trim(),
    p_media: String(el("[data-write-media]", form)?.value || "").trim(),
    p_visibility: String(el("[data-write-vis]", form)?.value || "public"),
  };
  if (payload.p_title.length < 3) {
    if (stateNode) stateNode.textContent = "A title of three characters at least.";
    return;
  }
  if (stateNode) stateNode.textContent = "Sending…";
  try {
    const res = await rpc("creator_submit_item", payload);
    if (!res || !res.ok) {
      const words = {
        kind: "That kind does not belong in this hub.",
        title: "A title of three characters at least.",
        media: "This kind needs its media link.",
        role: "You are not a publisher here (yet).",
      };
      if (stateNode) stateNode.textContent = words[res?.error] || "The server refused the draft.";
      return;
    }
    closeModal();
    toast({ title: "Draft sent", message: "The owner publishes it from the studio.", iconName: "check" });
  } catch {
    if (stateNode) stateNode.textContent = "The connection dropped. Try again.";
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

function accessPayload(hub) {
  const vis = el("[data-hub-visibility]")?.value || hub.visibility || "public";
  const viewers = el("[data-hub-viewers]")?.value ?? "";
  return {
    p_token: state.token,
    p_hub: hub.id,
    p_excluded: excludedOf("hub"),
    p_audience: audienceFor(vis, "hub"),
    p_auto_accept: Boolean(el("[data-hub-auto]")?.checked),
    p_viewers: viewers === "" ? 0 : Number(viewers),
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
  let access = null;
  try {
    access = await rpc("creator_hub_access", accessPayload(res.hub));
  } catch {
    access = null;
  }
  if (access && access.ok === false && access.error) {
    const message = ACCESS_MESSAGES[access.error] || MESSAGES[access.error] || "The access rules were refused.";
    saveStateText(message, "error");
    toast({ title: "Access not saved", message, tone: "error" });
  }
  const saved = access && access.ok ? access.hub : res.hub;
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
  if (state.editor.kind === "playlist" && !(state.pickables || []).length) {
    rpc("creator_items", { p_token: state.token, p_hub: hub.id, p_kind: null, p_status: null, p_search: "" })
      .then((res) => {
        if (!res || !res.ok) return;
        state.pickables = (res.rows || []).filter((row) => row.kind !== "playlist");
        if (state.view === "editor" && state.editor?.kind === "playlist") renderView();
      })
      .catch(() => {});
  }
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
    p_cover_url: value("[data-item-cover]").trim(),
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

  const seats = Number(el("[data-item-seats]")?.value || 0);
  let detail = null;
  try {
    detail = await rpc("creator_item_meta", {
      p_token: state.token,
      p_item: row.id || state.editor.id,
      p_meta: metaOf(draft),
      p_excluded: excludedOf("item"),
      p_audience: audienceFor(row.visibility || draft.visibility, "item"),
      p_seats: Number.isFinite(seats) && seats > 0 ? seats : 0,
    });
  } catch {
    detail = null;
  }
  if (detail && detail.ok === false) {
    const message = ACCESS_MESSAGES[detail.error] || MESSAGES[detail.error] || "The details were not saved.";
    say(message, "error");
    toast({ title: "Details not saved", message, tone: "error" });
    return;
  }

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

  if (target.closest("[data-cr-nav-creators]")) {
    event.preventDefault();
    return openDirectory();
  }

  const openCr = target.closest("[data-crp-open]");
  if (openCr) {
    event.preventDefault();
    return openCreator(openCr.dataset.crpOpen);
  }

  if (target.closest("[data-crp-back]")) {
    event.preventDefault();
    return openDirectory();
  }

  const ownerLink = target.closest("[data-crp-owner]");
  if (ownerLink) {
    event.preventDefault();
    return openCreator(ownerLink.dataset.crpOwner);
  }

  const hubLink = target.closest("[data-crp-hub]");
  if (hubLink) {
    event.preventDefault();
    return openHub(hubLink.dataset.crpHub);
  }

  const subButton = target.closest("[data-crp-sub]");
  if (subButton) {
    event.preventDefault();
    return subscribeToHub(subButton.dataset.crpSub);
  }

  if (target.closest("[data-crp-clear]")) {
    event.preventDefault();
    state.directory = { ...state.directory, q: "", kind: "", country: "", sort: "subscribers" };
    renderView();
    return loadDirectory();
  }

  const joinButton = target.closest("[data-crp-join]");
  if (joinButton) {
    event.preventDefault();
    return openJoinRequest(joinButton.dataset.crpJoin);
  }

  if (target.closest("[data-crp-write]")) {
    event.preventDefault();
    return openWriteForm();
  }

  if (target.closest("[data-crp-ad]")) {
    event.preventDefault();
    return openAdForm();
  }

  const decide = target.closest("[data-cr-req]");
  if (decide) {
    event.preventDefault();
    return decideRequest(decide.dataset.id, decide.dataset.crReq);
  }

  const dropAd = target.closest("[data-cr-ad-del]");
  if (dropAd) {
    event.preventDefault();
    return removeAd(dropAd.dataset.crAdDel);
  }

  const copyAny = target.closest("[data-cr-copy]");
  if (copyAny) {
    event.preventDefault();
    return copyText(copyAny.dataset.crCopy, "Link");
  }

  const copyButton = target.closest("[data-crp-copy]");
  if (copyButton) {
    event.preventDefault();
    const code = copyButton.dataset.crpCopy;
    if (!code) return;
    navigator.clipboard?.writeText?.(code).then(
      () => toast({ title: "Copied", message: `${code} is on your clipboard.`, iconName: "check" }),
      () => toast({ title: "Not copied", message: code, tone: "error" })
    );
    return;
  }

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

  const quality = target.closest("[data-cr-quality]");
  if (quality) {
    event.preventDefault();
    const on = quality.classList.toggle("is-on");
    quality.setAttribute("aria-pressed", on ? "true" : "false");
    return;
  }

  const excl = target.closest("[data-cr-excl-remove]");
  if (excl) {
    event.preventDefault();
    const chip = excl.closest(".cr-chip-x");
    const box = excl.closest("[data-excluded-chips]");
    if (chip) chip.remove();
    if (box && !box.querySelector(".cr-chip-x")) {
      box.innerHTML = '<span class="cr-card__hint">Nobody is excluded.</span>';
    }
    return;
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
  if (select.matches("[data-crp-kind]")) {
    state.directory.kind = select.value || "";
    return loadDirectory();
  }
  if (select.matches("[data-crp-country]")) {
    state.directory.country = select.value || "";
    return loadDirectory();
  }
  if (select.matches("[data-crp-sort]")) {
    state.directory.sort = select.value || "subscribers";
    return loadDirectory();
  }
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
    const aud = el('[data-aud="hub"]');
    if (aud) {
      const open = select.value === "exclusive";
      aud.hidden = !open;
      aud.style.display = open ? "" : "none";
    }
    return;
  }

  if (select.matches("[data-item-visibility]")) {
    const aud = el('[data-aud="item"]');
    if (aud) {
      const open = select.value === "exclusive";
      aud.hidden = !open;
      aud.style.display = open ? "" : "none";
    }
    return;
  }

  if (select.matches("[data-meta-file]")) {
    const file = select.files && select.files[0];
    if (!file) return;
    const box = el("[data-meta-content]");
    const count = el("[data-meta-count]");
    const swallow = (text) => {
      if (box) box.value = text;
      if (count) count.innerHTML = `<i data-icon="broadcast"></i>${num(countChannels(text))} channel${countChannels(text) === 1 ? "" : "s"}`;
      const source = el("[data-meta-source]");
      if (source && !source.value) source.value = "file";
      hydrateIcons(count || document.body);
    };
    if (file.text) {
      file.text().then(swallow).catch(() => {});
    } else if (typeof FileReader !== "undefined") {
      const reader = new FileReader();
      reader.onload = () => swallow(String(reader.result || ""));
      reader.readAsText(file);
    }
    return;
  }

  if (select.matches("[data-meta-picks]")) {
    const count = el("[data-playlist-count]");
    const picked = Array.from(select.selectedOptions || []).filter((option) => option.value).length;
    if (count) count.innerHTML = `<i data-icon="bookmark"></i>${num(picked)} picked`;
    hydrateIcons(count || document.body);
    return;
  }
});

document.addEventListener("input", (event) => {
  const target = event.target;
  if (target.matches("[data-crp-q]")) {
    state.directory.q = target.value || "";
    queueDirectorySearch();
    return;
  }
  if (target.matches("[data-cr-search]")) {
    state.search = target.value || "";
    renderView();
    const box = el("[data-cr-search]");
    if (box) box.focus?.();
    return;
  }
  if (target.matches("[data-meta-content]")) {
    const count = el("[data-meta-count]");
    if (count) {
      const lines = countChannels(target.value);
      count.innerHTML = `<i data-icon="broadcast"></i>${num(lines)} channel${lines === 1 ? "" : "s"}`;
      hydrateIcons(count);
    }
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

document.addEventListener("submit", async (event) => {
  const form = event.target;
  if (!(form instanceof HTMLElement)) return;

  if (form.matches("[data-crp-form]")) {
    event.preventDefault();
    const box = el("[data-crp-q]", form);
    state.directory.q = String(box ? box.value : "").trim();
    return loadDirectory({ focus: true });
  }

  if (form.matches("[data-crp-join-form]")) {
    event.preventDefault();
    return sendJoinRequest(form);
  }

  if (form.matches("[data-crp-ad-form]")) {
    event.preventDefault();
    return sendAd(form);
  }

  if (form.matches("[data-crp-write-form]")) {
    event.preventDefault();
    return sendDraft(form);
  }

  if (form.matches("[data-crp-unlock-form]")) {
    event.preventDefault();
    const input = el("[data-crp-password]", form);
    const stateNode = el("[data-crp-lock-state]");
    const password = String(input ? input.value : "");
    if (!password) {
      if (stateNode) stateNode.textContent = "Type the password first.";
      return;
    }
    if (stateNode) stateNode.textContent = "Knocking…";
    try {
      const res = await rpc("creator_hub_view", {
        p_token: state.token || "",
        p_hub: state.hubViewId || state.hubRef,
        p_password: password,
      });
      if (res && res.ok && !res.locked) {
        state.hubView = res;
        renderView();
        toast({ title: "Unlocked", message: "The door is open for this visit.", iconName: "unlock" });
        return;
      }
      if (stateNode) {
        stateNode.textContent =
          res && res.ok && res.locked
            ? res.hub && res.hub.has_password
              ? "Wrong password. Ask the owner again."
              : "This hub has no password — the VIP list only."
            : "Wrong password. Ask the owner again.";
      }
    } catch {
      if (stateNode) stateNode.textContent = "The server did not answer. Try again.";
    }
  }
});

/* ================================================================== */
/* boot                                                               */
/* ================================================================== */
async function boot() {
  state.token = sessionToken() || "";
  state.member = getMember();

  const params = new URLSearchParams(location.search);
  const creatorParam = params.get("creator");
  const hubParam = params.get("hub");
  const studioParam = params.get("studio");
  const wantedSection = sectionFromUrl(params.get("section"));

  /* the public side needs no session: a directory, a creator, a hub */
  if (!wantedSection || creatorParam) {
    showShell();
    hideAdminChrome(true);
    /* the rail still lists a member's own hubs — one call, the view does not wait */
    if (state.token) {
      loadHubs()
        .then(() => renderRail())
        .catch(() => {});
    }
    if (creatorParam) {
      state.creatorRef = creatorParam;
      if (studioParam || hubParam) return openHub(studioParam || hubParam);
      return openCreator(creatorParam);
    }
    if (studioParam || hubParam) return openHub(studioParam || hubParam);
    return openDirectory();
  }

  if (!state.token) {
    return showGate(
      "lock",
      "Sign in to the studio",
      "The creator studio needs a member session — your studios, blogs, spaces, libraries and galleries hang from your member.",
      `<a class="btn btn--primary btn--sm" href="login.html"><i data-icon="login"></i> Sign in</a>
       <a class="btn btn--ghost btn--sm" href="register.html"><i data-icon="user"></i> Create an account</a>
       <a class="btn btn--ghost btn--sm" href="creator.html?section=creators"><i data-icon="search"></i> Browse the creators</a>`
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

  state.view = "list";
  state.page = null;
  state.hubView = null;
  state.section = wantedSection.key;
  if (hubParam && state.hubs.some((hub) => hub.id === hubParam)) state.hub = hubParam;

  const section = sectionOf(state.section);
  const current = currentHub();
  if (!current || current.kind !== section.kind) {
    const first = hubsOf(section.kind)[0];
    state.hub = first ? first.id : null;
  }
  const wantedTab = params.get("tab");
  state.tab = section.tabs.some((tab) => tab.key === wantedTab) ? wantedTab : section.tabs[0].key;

  showShell();
  hideAdminChrome(false);
  await loadTab();
  await refresh();
  syncUrl();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot, { once: true });
} else {
  boot();
}
