/**
 * articles.html — the index of everything members write.
 * ------------------------------------------------------------------
 * One screen, three ways into it:
 *
 *   a field chip     the shelf of one field (Film, Cinema, Series …)
 *   the search box   a title, a description, or a line from the body
 *   a sort           popular · newest · most liked · discussed · longest
 *
 * Everything comes from one call:
 *
 *   article_feed(token, field, sort, search, limit, offset)
 *     → { rows[], fields[{name, count}], rails[{field, count, rows[]}], total }
 *
 * A card opens article.html?id=<code>. Nothing that the viewer may not
 * open ever reaches this page: the server filters by the same three
 * doors the reader uses, so an exclusive piece is simply absent until
 * the viewer qualifies for it.
 */
import { rpc } from "./data.js";
import { qs, qsa, esc, compact, timeAgo, debounce } from "./utils.js";
import { icon } from "./icons.js";
import { toast } from "./ui.js";
import { sessionToken, getMember } from "./session.js";

const PAGE = 24;

const state = {
  token: "",
  field: "",
  sort: "popular",
  search: "",
  rows: [],
  fields: [],
  rails: [],
  total: 0,
  loaded: 0,
  loading: false,
  seq: 0,
  mine: [],
};

const $ = (sel) => qs(sel);

/* ================================================================== */
/* small helpers                                                      */
/* ================================================================== */
function signedIn() {
  return Boolean(state.token);
}

function views(row) {
  const counters = row.counters || {};
  return compact(counters.impressions || counters.views || 0);
}

function talk(row) {
  const counters = row.counters || {};
  return compact(counters.comments || 0);
}

function readMinutes(row) {
  const article = row.article || {};
  return Number(article.reading || row.read_minutes || 1);
}

function fieldOf(row) {
  const article = row.article || {};
  return article.field || (row.keywords && row.keywords[0] && row.keywords[0].keyword) || "";
}

function categoryOf(row) {
  return (row.article && row.article.category) || "";
}

function authorOf(row) {
  return (row.publisher || row.author || (row.article && row.article.host) || {}).name ||
    (row.publisher || row.author || {}).username || "A member";
}

/**
 * The badge a card carries. Only three states are worth a label:
 * a door that is not open to everyone, and a piece that is not out yet.
 */
function badge(row) {
  const article = row.article || {};
  if (row.status === "draft") return { text: "Draft", kind: "draft", icon: "pen" };
  if (row.status === "scheduled") return { text: "Scheduled", kind: "draft", icon: "clock" };
  if (row.status === "pending") return { text: "In review", kind: "draft", icon: "clock" };
  if (row.visibility === "private") return { text: "Private", kind: "private", icon: "lock" };
  if (row.visibility === "followers") return { text: "Followers", kind: "exclusive", icon: "users" };
  if (row.visibility === "limited" || row.visibility === "excluded") {
    return { text: "Exclusive", kind: "exclusive", icon: "sparkle" };
  }
  if (article.place === "help") return { text: "Help", kind: "", icon: "lifebuoy" };
  return null;
}

function cover(row) {
  return row.thumbnail || "";
}

function href(row) {
  return `article.html?id=${encodeURIComponent(row.code || row.id || "")}`;
}

/* ================================================================== */
/* markup                                                             */
/* ================================================================== */
function cardMarkup(row) {
  const mark = badge(row);
  const field = fieldOf(row);
  const category = categoryOf(row);
  const img = cover(row);
  return `
    <a class="acard" href="${esc(href(row))}" data-a-open="${esc(row.code || "")}">
      <span class="acard__media">
        ${img ? `<img class="acard__img" src="${esc(img)}" alt="" loading="lazy" />` : ""}
        ${
          mark
            ? `<span class="acard__badge ${mark.kind ? `acard__badge--${mark.kind}` : ""}">${icon(mark.icon)}${esc(mark.text)}</span>`
            : ""
        }
      </span>
      <span class="acard__body">
        <span class="acard__field">
          ${field ? `<b>${esc(field)}</b>` : ""}
          ${field && category ? `<span class="acard__dot"></span>` : ""}
          ${category ? esc(category) : ""}
        </span>
        <span class="acard__title">${esc(row.title || "Untitled")}</span>
        ${row.description ? `<span class="acard__desc">${esc(row.description)}</span>` : ""}
        <span class="acard__meta">
          <span>${esc(authorOf(row))}</span>
          <span class="acard__dot"></span>
          <span>${readMinutes(row)} min</span>
          <span class="acard__dot"></span>
          <span>${esc(views(row))} reads</span>
          ${
            Number((row.counters || {}).comments || 0) > 0
              ? `<span class="acard__dot"></span><span>${icon("comment")} ${esc(talk(row))}</span>`
              : ""
          }
          <span class="acard__dot"></span>
          <span>${esc(timeAgo(row.published_at || row.created_at))}</span>
        </span>
      </span>
    </a>`;
}

function featureMarkup(row) {
  const field = fieldOf(row);
  const category = categoryOf(row);
  const img = cover(row);
  return `
    <a class="afeat__cover" href="${esc(href(row))}" aria-hidden="true" tabindex="-1">
      ${img ? `<img src="${esc(img)}" alt="" />` : ""}
    </a>
    <div class="afeat__body">
      <p class="afeat__kicker">${icon("sparkle")} Leading this week${field ? ` · ${esc(field)}` : ""}</p>
      <h2 class="afeat__title"><a href="${esc(href(row))}" style="color:inherit;text-decoration:none">${esc(row.title || "Untitled")}</a></h2>
      ${row.description ? `<p class="afeat__desc">${esc(row.description)}</p>` : ""}
      <p class="afeat__meta">
        <span>${esc(authorOf(row))}</span>
        <span class="acard__dot"></span>
        <span>${readMinutes(row)} min read</span>
        ${category ? `<span class="acard__dot"></span><span>${esc(category)}</span>` : ""}
      </p>
      <span class="afeat__go">Read it ${icon("arrowRight")}</span>
    </div>`;
}

function railMarkup(rail) {
  const rows = Array.isArray(rail.rows) ? rail.rows : [];
  if (!rows.length) return "";
  return `
    <section class="arail" data-a-rail="${esc(rail.field)}">
      <div class="arail__head">
        <h2 class="arail__title">${esc(rail.field)} <span class="arail__count">${rows.length} ${rows.length === 1 ? "piece" : "pieces"}</span></h2>
        <div class="arail__nav">
          <button class="arail__btn" type="button" data-a-rail-prev aria-label="Scroll ${esc(rail.field)} back">${icon("chevronLeft")}</button>
          <button class="arail__btn" type="button" data-a-rail-next aria-label="Scroll ${esc(rail.field)} on">${icon("chevronRight")}</button>
        </div>
      </div>
      <div class="arail__track">${rows.map(cardMarkup).join("")}</div>
    </section>`;
}

function emptyMarkup() {
  if (state.search) {
    return `
      <div class="aempty">
        <span class="aempty__icon">${icon("search")}</span>
        <p class="aempty__title">Nothing matches “${esc(state.search)}”</p>
        <p class="aempty__text">Try one word from the title, or a field on the left — the search reads titles, descriptions and the body itself.</p>
        <div class="aempty__acts">
          <button class="btn btn--ghost btn--sm" type="button" data-a-reset">Clear the search</button>
        </div>
      </div>`;
  }
  if (state.field) {
    return `
      <div class="aempty">
        <span class="aempty__icon">${icon("bookOpen")}</span>
        <p class="aempty__title">No pieces in ${esc(state.field)} yet</p>
        <p class="aempty__text">This field is empty — be the first to publish in it, or read something from another shelf.</p>
        <div class="aempty__acts">
          <a class="btn btn--ghost btn--sm" href="article-editor.html">${icon("pen")} Write the first one</a>
          <button class="btn btn--quiet btn--sm" type="button" data-a-reset">All fields</button>
        </div>
      </div>`;
  }
  return `
    <div class="aempty">
      <span class="aempty__icon">${icon("bookOpen")}</span>
      <p class="aempty__title">No articles yet</p>
      <p class="aempty__text">The index fills up as members publish. A piece can be public, exclusive to an audience, or private to the people you name.</p>
      <div class="aempty__acts">
        <a class="btn btn--primary btn--sm" href="article-editor.html">${icon("pen")} Write the first article</a>
      </div>
    </div>`;
}

/* ================================================================== */
/* paint                                                              */
/* ================================================================== */
function renderFields() {
  const host = $("[data-a-fields]");
  if (!host) return;
  if (!state.fields.length) {
    host.innerHTML = "";
    host.hidden = true;
    return;
  }
  host.hidden = false;
  const all = `<button class="achip ${state.field ? "" : "is-active"}" type="button" data-a-field="">All <span class="achip__n">${state.total || ""}</span></button>`;
  host.innerHTML =
    all +
    state.fields
      .map(
        (row) =>
          `<button class="achip ${state.field && state.field.toLowerCase() === String(row.name).toLowerCase() ? "is-active" : ""}" type="button" data-a-field="${esc(row.name)}">${esc(row.name)} <span class="achip__n">${row.count}</span></button>`
      )
      .join("");
}

function renderRails() {
  const host = $("[data-a-rails]");
  if (!host) return;
  const show = !state.field && !state.search && state.rails.length > 1;
  host.innerHTML = show ? state.rails.map(railMarkup).join("") : "";
  host.hidden = !show;
}

function renderFeature() {
  const host = $("[data-a-feature]");
  if (!host) return;
  const first = state.rows[0];
  const show = !state.field && !state.search && Boolean(first);
  host.hidden = !show;
  host.innerHTML = show ? featureMarkup(first) : "";
}

function renderGrid() {
  const grid = $("[data-a-grid]");
  if (!grid) return;
  /* the feature already carries the first row, so the grid starts after it */
  const feature = $("[data-a-feature]");
  const featureCode = feature && !feature.hidden ? (state.rows[0] && (state.rows[0].code || state.rows[0].id)) : "";
  const rows = state.rows.filter((row) => {
    const code = row.code || row.id;
    if (featureCode && code === featureCode) return false;
    return true;
  });
  grid.innerHTML = rows.map(cardMarkup).join("");
  grid.hidden = rows.length === 0;
}

function renderCount() {
  const host = $("[data-a-count]");
  if (!host) return;
  if (!state.rows.length) {
    host.textContent = "";
    return;
  }
  const shown = state.loaded;
  host.textContent = `${shown} of ${state.total} ${state.total === 1 ? "article" : "articles"}`;
}

function renderMore() {
  const btn = $("[data-a-more]");
  if (!btn) return;
  const more = state.loaded < state.total;
  btn.hidden = !more;
  btn.disabled = state.loading;
  btn.textContent = state.loading ? "Loading…" : "More articles";
}

function renderEmpty() {
  const host = $("[data-a-empty]");
  if (!host) return;
  if (state.rows.length) {
    host.hidden = true;
    host.innerHTML = "";
    return;
  }
  host.hidden = false;
  host.innerHTML = emptyMarkup();
}

function renderMine() {
  const section = $("[data-a-yours]");
  const shelf = $("[data-a-shelf]");
  const count = $("[data-a-yours-count]");
  if (!section || !shelf) return;
  if (!signedIn() || !state.mine.length) {
    section.hidden = true;
    return;
  }
  section.hidden = false;
  shelf.innerHTML = state.mine.map(cardMarkup).join("");
  if (count) {
    const drafts = state.mine.filter((row) => row.status !== "published").length;
    count.textContent = `${state.mine.length} ${state.mine.length === 1 ? "piece" : "pieces"}${drafts ? ` · ${drafts} not published` : ""}`;
  }
}

function paintAll() {
  renderFields();
  renderFeature();
  renderRails();
  renderGrid();
  renderCount();
  renderMore();
  renderEmpty();
  renderMine();
}

/* ================================================================== */
/* loading                                                            */
/* ================================================================== */
function skeletons(count = 6) {
  const grid = $("[data-a-grid]");
  if (!grid) return;
  grid.hidden = false;
  grid.innerHTML = Array.from({ length: count })
    .map(
      () => `<div class="acard" aria-hidden="true">
        <span class="acard__media" style="background:var(--surface-2)"></span>
        <span class="acard__body">
          <span class="acard__field" style="height:.7rem;width:34%;background:var(--surface-3);border-radius:4px"></span>
          <span class="acard__title" style="height:1rem;width:88%;background:var(--surface-3);border-radius:4px"></span>
          <span class="acard__desc" style="height:.8rem;width:64%;background:var(--surface-3);border-radius:4px"></span>
        </span>
      </div>`
    )
    .join("");
}

async function loadFeed({ append = false } = {}) {
  if (state.loading) return;
  state.loading = true;
  const seq = ++state.seq;
  if (!append) skeletons();
  renderMore();

  let res = null;
  try {
    res = await rpc("article_feed", {
      p_token: state.token,
      p_field: state.field || null,
      p_sort: state.sort,
      p_search: state.search,
      p_limit: PAGE,
      p_offset: append ? state.loaded : 0,
    });
  } catch (error) {
    console.warn("[1World] articles:", error.message);
  }

  /* a slower answer must not overwrite a newer one */
  if (seq !== state.seq) return;

  state.loading = false;

  if (!res || res.ok !== true) {
    state.rows = [];
    state.loaded = 0;
    paintAll();
    toast({
      title: "The index did not load",
      message: "The server is not reachable from here. Try again in a moment.",
      tone: "error",
    });
    return;
  }

  const rows = Array.isArray(res.rows) ? res.rows : [];
  state.rows = append ? [...state.rows, ...rows] : rows;
  state.fields = Array.isArray(res.fields) ? res.fields : [];
  state.rails = Array.isArray(res.rails) ? res.rails : [];
  state.total = Number(res.total) || state.rows.length;
  state.loaded = state.rows.length;

  paintAll();
}

async function loadMine() {
  if (!signedIn()) return;
  let res = null;
  try {
    res = await rpc("article_mine", { p_token: state.token });
  } catch (error) {
    console.warn("[1World] my articles:", error.message);
  }
  if (!res || res.ok !== true) return;
  state.mine = Array.isArray(res.rows) ? res.rows : [];
  renderMine();
}

/* ================================================================== */
/* events                                                             */
/* ================================================================== */
function scrollRail(track, direction = 1) {
  if (!track) return;
  const step = Math.max(240, Math.round(track.clientWidth * 0.8));
  track.scrollBy({ left: step * direction, behavior: "smooth" });
}

function bind() {
  const search = $("[data-a-search]");
  if (search) {
    const params = new URLSearchParams(location.search);
    const q = params.get("q") || "";
    if (q) {
      state.search = q;
      search.value = q;
    }
    search.addEventListener(
      "input",
      debounce((event) => {
        state.search = String(event.target.value || "").trim();
        state.loaded = 0;
        loadFeed();
      }, 280)
    );
  }

  const sort = $("[data-a-sort]");
  if (sort) {
    sort.addEventListener("click", (event) => {
      const btn = event.target.closest("[data-sort]");
      if (!btn) return;
      state.sort = btn.getAttribute("data-sort") || "popular";
      qsa("[data-sort]", sort).forEach((node) => {
        const on = node === btn;
        node.classList.toggle("is-active", on);
        node.setAttribute("aria-selected", String(on));
      });
      state.loaded = 0;
      loadFeed();
    });
  }

  document.addEventListener("click", (event) => {
    const chip = event.target.closest("[data-a-field]");
    if (chip) {
      const next = chip.getAttribute("data-a-field") || "";
      state.field = state.field.toLowerCase() === next.toLowerCase() ? "" : next;
      state.loaded = 0;
      renderFields();
      loadFeed();
      return;
    }
    if (event.target.closest("[data-a-reset]")) {
      state.search = "";
      state.field = "";
      state.loaded = 0;
      const input = $("[data-a-search]");
      if (input) input.value = "";
      renderFields();
      loadFeed();
      return;
    }
    if (event.target.closest("[data-a-more]")) {
      loadFeed({ append: true });
      return;
    }
    const prev = event.target.closest("[data-a-rail-prev], [data-a-rail-next]");
    if (prev) {
      const rail = prev.closest("[data-a-rail]");
      const track = rail && rail.querySelector(".arail__track");
      scrollRail(track, prev.hasAttribute("data-a-rail-prev") ? -1 : 1);
    }
  });
}

/* ================================================================== */
/* boot                                                               */
/* ================================================================== */
async function boot() {
  state.token = sessionToken() || "";
  const member = getMember();
  const write = $("[data-a-write]");
  if (write && !member) {
    /* writing needs a name on it: send a guest through the sign-in first */
    write.setAttribute("href", "login.html?next=article-editor.html");
  }

  bind();
  await loadFeed();
  loadMine();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot, { once: true });
} else {
  boot();
}
