/**
 * blog.html — one blog, as a reader meets it.
 * ------------------------------------------------------------------
 *   blog.html?studio=IDBL100003[&key=<password>][&section=<name>&by=category|field][&q=<text>]
 *
 * Two calls do the whole page:
 *
 *   blog_page(token, ref, password)
 *     → { ok, locked, hub{ name, description, cover_url, logo_url, code, owner … },
 *         sections[{ name, by, count }], stats{ articles, writers, reads, comments } }
 *   blog_feed(token, ref, section, by, search, sort, limit, offset)
 *     → { rows[ cards ], total }
 *
 * The shape is the blog mock's: a cover that carries the mark and the name, one
 * search over everything in the blog, what its readers open most, one row per
 * section, and the sections themselves to walk into. The clothes are the site's
 * own — the same tokens, the same cards as articles.html.
 *
 * The sections are the blog's categories when its pieces carry them, and the
 * pieces' fields when they do not; the server decides and says which it used
 * (`by`), and every link the page builds carries that back with it.
 */
import { rpc } from "./data.js";
import { qs, qsa, esc, num, compact, timeAgo, debounce, scrollRail } from "./utils.js";
import { icon } from "./icons.js";
import { toast } from "./ui.js";
import { sessionToken } from "./session.js";

const LIMIT = 12;

const state = {
  ref: "",
  key: "",
  token: "",
  hub: null,
  sections: [],
  section: "",
  by: "category",
  q: "",
  sort: "popular",
  rows: [],
  total: 0,
  offset: 0,
  loading: false,
  seq: 0,
};

const $ = (sel) => qs(sel);

/* ================================================================== */
/* small helpers                                                      */
/* ================================================================== */
function initials(name) {
  const words = String(name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return "B";
  return words
    .slice(0, 2)
    .map((word) => word[0])
    .join("")
    .toUpperCase();
}

function authorOf(row) {
  const who = row.publisher || row.author || (row.article && row.article.host) || {};
  return who.name || who.username || "A member";
}

function fieldOf(row) {
  return (row.article && row.article.field) || "";
}

function categoryOf(row) {
  return (row.article && row.article.category) || "";
}

/**
 * What a card says about its door. Only a door that is not open to everyone,
 * or a piece that is not out yet, is worth a label.
 */
function badge(row) {
  if (row.status === "draft") return { text: "Draft", kind: "draft", icon: "pen" };
  if (row.status === "scheduled") return { text: "Scheduled", kind: "draft", icon: "clock" };
  if (row.status === "pending") return { text: "In review", kind: "draft", icon: "clock" };
  if (row.visibility === "private") return { text: "Private", kind: "private", icon: "lock" };
  if (row.visibility === "followers") return { text: "Followers", kind: "exclusive", icon: "users" };
  if (row.visibility === "limited" || row.visibility === "excluded") return { text: "Exclusive", kind: "exclusive", icon: "sparkle" };
  return null;
}

function cardMarkup(row) {
  const mark = badge(row);
  const field = fieldOf(row);
  const category = categoryOf(row);
  const img = row.thumbnail || "";
  const reads = compact((row.counters || {}).impressions || 0);
  const minutes = Number((row.article || {}).reading || row.read_minutes || 1);
  return `
    <a class="acard" href="article.html?id=${encodeURIComponent(row.code || row.id || "")}" data-b-open="${esc(row.code || "")}">
      <span class="acard__media">
        ${img ? `<img class="acard__img" src="${esc(img)}" alt="" loading="lazy" />` : ""}
        ${mark ? `<span class="acard__badge ${mark.kind ? `acard__badge--${mark.kind}` : ""}">${icon(mark.icon)}${esc(mark.text)}</span>` : ""}
      </span>
      <span class="acard__body">
        <span class="acard__field">
          ${field ? `<b>${esc(field)}</b>` : ""}
          ${field && category ? `<span class="acard__dot"></span>` : ""}
          ${category && category !== field ? esc(category) : ""}
        </span>
        <span class="acard__title">${esc(row.title || "Untitled")}</span>
        ${row.description ? `<span class="acard__desc">${esc(row.description)}</span>` : ""}
        <span class="acard__meta">
          <span>${esc(authorOf(row))}</span>
          <span class="acard__dot"></span>
          <span>${esc(minutes)} min</span>
          <span class="acard__dot"></span>
          <span>${esc(reads)} reads</span>
          <span class="acard__dot"></span>
          <span>${esc(timeAgo(row.published_at || row.created_at))}</span>
        </span>
      </span>
    </a>`;
}

function gridMarkup(rows) {
  return rows.map(cardMarkup).join("");
}

/* ================================================================== */
/* the address                                                        */
/* ================================================================== */
function params() {
  return new URLSearchParams(location.search || "");
}

function readAddress() {
  const p = params();
  state.ref = String(p.get("studio") || p.get("id") || "").trim().toUpperCase();
  state.key = String(p.get("key") || "").trim();
  state.section = String(p.get("section") || "").trim();
  state.by = String(p.get("by") || "").trim() === "field" ? "field" : "category";
  state.q = String(p.get("q") || "").trim();
  state.sort = ["popular", "new", "liked", "discussed", "long"].includes(String(p.get("sort") || ""))
    ? String(p.get("sort"))
    : "popular";
}

function writeAddress(extra = {}) {
  const next = new URLSearchParams();
  if (state.ref) next.set("studio", state.ref);
  if (state.key) next.set("key", state.key);
  const section = "section" in extra ? extra.section : state.section;
  const by = "by" in extra ? extra.by : state.by;
  const q = "q" in extra ? extra.q : state.q;
  const sort = "sort" in extra ? extra.sort : state.sort;
  if (section) {
    next.set("section", section);
    next.set("by", by);
  }
  if (q) next.set("q", q);
  if (sort && sort !== "popular") next.set("sort", sort);
  const query = next.toString();
  history.replaceState(null, "", `${location.pathname.split("/").pop() || "blog.html"}${query ? `?${query}` : ""}`);
}

/* ================================================================== */
/* the page's states — loading, the unknown blog, the closed door      */
/* ================================================================== */
function showState({ iconName = "info", title = "", text = "", form = "" } = {}) {
  const host = $("[data-b-state]");
  const shell = $("[data-b-shell]");
  if (shell) shell.hidden = true;
  if (!host) return;
  host.hidden = false;
  host.innerHTML = `
    <div class="bstate">
      <span class="bstate__ic">${icon(iconName)}</span>
      <p class="bstate__title">${esc(title)}</p>
      <p class="bstate__text">${esc(text)}</p>
      ${form}
    </div>`;
}

function skeleton() {
  const host = $("[data-b-state]");
  if (!host) return;
  host.hidden = false;
  host.innerHTML = `<div class="bsk" aria-hidden="true"><div class="bsk__hero"></div><div class="bsk__row"></div><div class="bsk__row"></div></div>`;
}

function hideState() {
  const host = $("[data-b-state]");
  if (host) {
    host.hidden = true;
    host.innerHTML = "";
  }
  const shell = $("[data-b-shell]");
  if (shell) shell.hidden = false;
}

/* ================================================================== */
/* the blog itself                                                    */
/* ================================================================== */
function renderHero(page) {
  const hub = page.hub || {};
  const stats = page.stats || {};

  const hero = $(".bhero");
  if (hero) hero.classList.toggle("is-plain", !hub.cover_url);

  const cover = $("[data-b-cover]");
  if (cover) {
    cover.src = hub.cover_url || "";
    cover.alt = hub.cover_url ? `${hub.name || "The blog"} cover` : "";
  }

  const logo = $("[data-b-logo]");
  if (logo) {
    logo.innerHTML = hub.logo_url
      ? `<img src="${esc(hub.logo_url)}" alt="" />`
      : `<span>${esc(initials(hub.name))}</span>`;
  }

  const kind = $("[data-b-kind]");
  if (kind) {
    kind.innerHTML = `${icon("file")}<span>Blog · ${esc(hub.code || state.ref)}</span>`;
  }

  const name = $("[data-b-name]");
  if (name) name.textContent = hub.name || "This blog";

  const desc = $("[data-b-desc]");
  if (desc) desc.textContent = hub.description || "";

  const tags = $("[data-b-tags]");
  if (tags) {
    tags.innerHTML = (state.sections || [])
      .filter((row) => row.name)
      .map(
        (row) =>
          `<a class="btag" href="?studio=${encodeURIComponent(state.ref)}&section=${encodeURIComponent(row.name)}&by=${encodeURIComponent(row.by || "category")}" data-b-tag="${esc(row.name)}">${esc(row.name)}</a>`
      )
      .join("");
  }

  const owner = $("[data-b-owner]");
  if (owner) {
    const who = hub.owner || "";
    const label = hub.owner_name || hub.owner_username || who;
    owner.innerHTML = who
      ? `Kept by <a href="creator.html?creator=${encodeURIComponent(who)}" data-b-creator>${esc(label)}</a>`
      : "";
  }

  const studio = $("[data-b-studio]");
  if (studio) studio.href = `creator.html?studio=${encodeURIComponent(state.ref)}`;

  const all = $("[data-b-all]");
  if (all) all.href = "articles.html";

  const boxes = $("[data-b-stats]");
  if (boxes) {
    const items = [
      [num(stats.articles || 0), "Articles"],
      [num(stats.writers || 0), "Writers"],
      [compact(stats.reads || 0), "Reads"],
      [compact(stats.comments || 0), "Comments"],
    ];
    boxes.innerHTML = items
      .map(([value, label]) => `<span class="bstat"><b>${esc(value)}</b><span>${esc(label)}</span></span>`)
      .join("");
  }

  document.title = `${hub.name || "Blog"} — 1World Web`;
}

/* ================================================================== */
/* the feed                                                           */
/* ================================================================== */
async function feed({ section = "", by = "category", q = "", sort = "popular", limit = LIMIT, offset = 0 } = {}) {
  try {
    const res = await rpc("blog_feed", {
      p_token: state.token,
      p_ref: state.ref,
      p_section: section || null,
      p_by: by,
      p_search: q,
      p_sort: sort,
      p_limit: limit,
      p_offset: offset,
    });
    if (!res || res.ok !== true) {
      return { rows: [], total: 0, error: (res && res.error) || "feed" };
    }
    return { rows: Array.isArray(res.rows) ? res.rows : [], total: Number(res.total || 0) };
  } catch (error) {
    return { rows: [], total: 0, error: error?.message || "network" };
  }
}

/* ================================================================== */
/* the blog's home — most read, a row per section, the sections        */
/* ================================================================== */
async function paintHome() {
  const popular = $("[data-b-popular]");
  const rail = $("[data-b-popular-rail]");
  const rows = $("[data-b-rows]");
  const secs = $("[data-b-secs]");
  const grid = $("[data-b-sec-grid]");

  const top = await feed({ sort: "popular", limit: 10 });
  if (rail && top) {
    rail.innerHTML = gridMarkup(top.rows);
    if (popular) popular.hidden = top.rows.length < 1;
  }

  if (rows) rows.innerHTML = "";
  const sections = (state.sections || []).filter((row) => row.name);
  if (rows && sections.length) {
    const shelves = await Promise.all(
      sections.slice(0, 6).map(async (section) => {
        const res = await feed({ section: section.name, by: section.by || state.by, sort: "popular", limit: 8 });
        return { section, rows: (res && res.rows) || [] };
      })
    );
    rows.innerHTML = shelves
      .filter((shelf) => shelf.rows.length)
      .map(
        (shelf) => `
        <section class="brow" data-b-row="${esc(shelf.section.name)}">
          <div class="brow__head">
            <div class="brow__id">
              <h2 class="brow__title">${esc(shelf.section.name)}</h2>
              <p class="brow__sub">${esc(num(shelf.section.count || shelf.rows.length))} in this section</p>
            </div>
            <div class="brow__arrows">
              <a class="bbutton" href="?studio=${encodeURIComponent(state.ref)}&section=${encodeURIComponent(shelf.section.name)}&by=${encodeURIComponent(shelf.section.by || "category")}" data-b-into="${esc(shelf.section.name)}">All of ${esc(shelf.section.name)}</a>
            </div>
          </div>
          <div class="brow__rail">${gridMarkup(shelf.rows)}</div>
        </section>`
      )
      .join("");
  }

  const nothing = $("[data-b-nothing]");
  if (nothing) {
    const any = Boolean(top && top.rows.length) || sections.length > 0;
    nothing.hidden = any;
  }

  if (grid && sections.length) {
    grid.innerHTML = sections
      .map(
        (section) => `
        <a class="bsection" href="?studio=${encodeURIComponent(state.ref)}&section=${encodeURIComponent(section.name)}&by=${encodeURIComponent(section.by || "category")}" data-b-sec="${esc(section.name)}">
          <span class="bsection__id">
            <b>${esc(section.name)}</b>
            <span>${esc(num(section.count || 0))} ${Number(section.count || 0) === 1 ? "piece" : "pieces"}</span>
          </span>
          <span class="bsection__go" aria-hidden="true">${icon("arrowRight")}</span>
        </a>`
      )
      .join("");
    if (secs) secs.hidden = false;
  } else if (secs) {
    secs.hidden = true;
  }

}

/* ================================================================== */
/* one section, opened                                                */
/* ================================================================== */
function paintSectionHead(count) {
  const name = $("[data-b-section-name]");
  if (name) name.textContent = state.section;
  const tally = $("[data-b-section-count]");
  if (tally) {
    tally.textContent = `${num(count)} ${count === 1 ? "piece" : "pieces"} in this section`;
  }
  qsa("[data-b-sort] [data-sort]").forEach((button) => {
    const on = button.getAttribute("data-sort") === state.sort;
    button.classList.toggle("is-active", on);
    button.setAttribute("aria-selected", String(on));
  });
}

async function paintSection() {
  const shell = $("[data-b-section]");
  const grid = $("[data-b-grid]");
  const more = $("[data-b-more]");
  if (!shell || !grid) return;

  const mine = ++state.seq;
  const res = await feed({ section: state.section, by: state.by, sort: state.sort, limit: LIMIT, offset: 0 });
  if (mine !== state.seq) return;
  state.rows = (res && res.rows) || [];
  state.total = (res && res.total) || 0;
  state.offset = state.rows.length;

  paintSectionHead(state.total);
  grid.innerHTML = state.rows.length
    ? gridMarkup(state.rows)
    : `<div class="bempty"><p class="bempty__title">Nothing in this section yet</p><p class="bempty__text">Its writer has not put a piece here. The rest of the blog is below.</p></div>`;
  if (more) more.hidden = state.rows.length >= state.total || !state.rows.length;
}

/* ================================================================== */
/* the search                                                         */
/* ================================================================== */
async function paintFound() {
  const shell = $("[data-b-found]");
  const grid = $("[data-b-found-grid]");
  const empty = $("[data-b-found-empty]");
  const title = $("[data-b-found-title]");
  const count = $("[data-b-found-count]");
  if (!shell || !grid) return;

  const mine = ++state.seq;
  const res = await feed({ q: state.q, sort: "popular", limit: 24, offset: 0 });
  if (mine !== state.seq) return;
  const rows = (res && res.rows) || [];
  if (title) title.textContent = `“${state.q}”`;
  if (count) count.textContent = `${num((res && res.total) || rows.length)} ${rows.length === 1 ? "match" : "matches"}`;
  grid.innerHTML = rows.length ? gridMarkup(rows) : "";
  if (empty) empty.hidden = rows.length > 0;
}

/* ================================================================== */
/* which of the three the page is showing                             */
/* ================================================================== */
function paintMode() {
  const section = $("[data-b-section]");
  const home = $("[data-b-home]");
  const found = $("[data-b-found]");
  const clear = $("[data-b-clear]");
  const searching = Boolean(state.q);
  const inSection = Boolean(state.section) && !searching;

  if (section) section.hidden = !inSection;
  if (home) home.hidden = searching || inSection;
  if (found) found.hidden = !searching;
  if (clear) clear.hidden = !searching;

  const input = $("[data-b-q]");
  if (input && input.value !== state.q) input.value = state.q;
}

async function repaint() {
  paintMode();
  if (state.q) await paintFound();
  else if (state.section) await paintSection();
  else await paintHome();
}

/* ================================================================== */
/* the doors                                                          */
/* ================================================================== */
function lockBox(page) {
  const hub = page.hub || {};
  const hasPassword = Boolean(page.has_password);
  showState({
    iconName: "lock",
    title: "This blog is private",
    text: hasPassword
      ? `Ask ${hub.owner_username || hub.owner_name || "the writer"} for the password to walk in.`
      : "The writer keeps it to the members they named.",
    form: hasPassword
      ? `<form class="bstate__form" data-b-key-form>
           <input class="input" type="password" name="key" placeholder="The password" aria-label="Blog password" data-b-key autocomplete="off" />
           <button class="btn btn--primary btn--sm" type="submit">${icon("unlock")} Unlock</button>
           <p class="bstate__state" data-b-key-state role="status"></p>
         </form>`
      : "",
  });
}

function wireLock() {
  const form = $("[data-b-key-form]");
  if (!form || form.dataset.wired) return;
  form.dataset.wired = "1";
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const field = $("[data-b-key]");
    const key = field ? field.value.trim() : "";
    if (!key) {
      const line = $("[data-b-key-state]");
      if (line) line.textContent = "Type the password first.";
      return;
    }
    state.key = key;
    const page = await load(true);
    if (page && page.locked) {
      const line = $("[data-b-key-state]");
      if (line && line.isConnected) line.textContent = "That is not the password.";
      state.key = "";
      toast({ title: "Not that one", message: "The password did not open this blog.", tone: "error", iconName: "lock" });
      return;
    }
    writeAddress();
    toast({ title: "Open", message: "The blog is yours for this visit.", tone: "success", iconName: "unlock" });
  });
}

/* ================================================================== */
/* boot                                                               */
/* ================================================================== */
async function load(silent = false) {
  if (!silent) skeleton();
  let page = null;
  try {
    page = await rpc("blog_page", { p_token: state.token, p_ref: state.ref, p_password: state.key });
  } catch (error) {
    showState({ iconName: "info", title: "The blog did not load", text: "The server did not answer. Try again in a moment." });
    return null;
  }

  if (!page || page.ok !== true) {
    const notBlog = page && page.error === "hub_kind";
    showState({
      iconName: notBlog ? "info" : "file",
      title: notBlog ? "That is not a blog" : "No blog at this address",
      text: notBlog
        ? "This address belongs to another kind of hub. Its own page is in the studio's directory."
        : "The link may be old, or the blog was closed by its owner.",
      form: `<a class="btn btn--ghost btn--sm" href="creator.html?section=creators">${icon("globe")} All creators</a>`,
    });
    return null;
  }

  state.hub = page.hub || {};
  state.sections = Array.isArray(page.sections) ? page.sections : [];
  if (state.sections.length && !state.by) state.by = state.sections[0].by || "category";

  /* the section in the address decides how its pieces are filtered */
  if (state.section) {
    const known = state.sections.find((row) => String(row.name).toLowerCase() === state.section.toLowerCase());
    if (known) {
      state.section = known.name;
      state.by = known.by || state.by;
    }
  }

  if (page.locked) {
    lockBox(page);
    wireLock();
    return page;
  }

  hideState();
  renderHero(page);
  await repaint();
  return page;
}

function wire() {
  const form = $("[data-b-search]");
  if (form) {
    form.addEventListener("submit", (event) => event.preventDefault());
  }

  const input = $("[data-b-q]");
  if (input) {
    const run = debounce(async () => {
      state.q = input.value.trim();
      writeAddress({ q: state.q });
      paintMode();
      if (state.q) await paintFound();
      else await repaint();
      const clear = $("[data-b-clear]");
      if (clear) clear.hidden = !state.q;
    }, 260);
    input.addEventListener("input", run);
    input.addEventListener("search", run);
  }

  const clear = $("[data-b-clear]");
  if (clear) {
    clear.addEventListener("click", async () => {
      state.q = "";
      if (input) input.value = "";
      writeAddress({ q: "" });
      clear.hidden = true;
      await repaint();
      input?.focus();
    });
  }

  const back = $("[data-b-back]");
  if (back) {
    back.addEventListener("click", async () => {
      state.section = "";
      writeAddress({ section: "" });
      await repaint();
    });
  }

  const close = $("[data-b-found-close]");
  if (close) {
    close.addEventListener("click", async () => {
      state.q = "";
      if (input) input.value = "";
      writeAddress({ q: "" });
      await repaint();
    });
  }

  qsa("[data-b-sort] [data-sort]").forEach((button) => {
    button.addEventListener("click", async () => {
      state.sort = button.getAttribute("data-sort") || "popular";
      writeAddress();
      await paintSection();
    });
  });

  const more = $("[data-b-more]");
  if (more) {
    more.addEventListener("click", async () => {
      const res = await feed({ section: state.section, by: state.by, sort: state.sort, limit: LIMIT, offset: state.offset });
      const rows = (res && res.rows) || [];
      state.offset += rows.length;
      const grid = $("[data-b-grid]");
      if (grid) grid.insertAdjacentHTML("beforeend", gridMarkup(rows));
      more.hidden = state.offset >= state.total || !rows.length;
    });
  }

  qsa("[data-b-arrow]").forEach((button) => {
    button.addEventListener("click", () => {
      const rail = $("[data-b-popular-rail]");
      if (rail) scrollRail(rail, Number(button.getAttribute("data-b-arrow")) || 1);
    });
  });

  /* the whole page navigates by address, so the browser's own back works */
  document.addEventListener("click", (event) => {
    const into = event.target.closest("[data-b-into], [data-b-sec], [data-b-tag]");
    if (!into) return;
    const href = into.getAttribute("href");
    if (!href) return;
    event.preventDefault();
    const next = new URLSearchParams(href.replace(/^\?/, ""));
    state.section = next.get("section") || "";
    state.by = next.get("by") === "field" ? "field" : "category";
    state.q = "";
    const field = $("[data-b-q]");
    if (field) field.value = "";
    writeAddress();
    repaint();
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
}

async function boot() {
  readAddress();
  state.token = sessionToken() || "";
  wire();

  if (!state.ref) {
    showState({
      iconName: "file",
      title: "No blog named",
      text: "A blog is read by its address — blog.html?studio=IDBL100003, the code the studio shows.",
      form: `<a class="btn btn--primary btn--sm" href="creator.html?section=creators">${icon("globe")} Find a blog</a>`,
    });
    return;
  }

  await load();
}

boot();
