/**
 * publisher.html — the publisher's desk.
 * ------------------------------------------------------------------
 * A publisher (ناشر) is a member an owner approved into
 * `creator_hubs.publishers`. Their desk is this page: the rail of the hubs
 * that approved them, the video editor itself embedded beside it, and the list
 * of what they published there.
 *
 * The editor is not re-implemented here. `video-editor.js` runs on this page
 * too — `<body data-ved-embed="1">` tells it so — and reads its hubs from
 * `publisher_hubs` instead of the studio list. This module owns only what is
 * around it:
 *
 *   the rail      which hub the editor is pointed at (`ved:hub`)
 *   the tabs      New video · Your videos here
 *   the list      `video_mine`, filtered to the selected hub
 *   the handover  `ved:published` / `ved:drafted` — the editor stays put
 *
 * Publishing here is live: an approved publisher writes into the hub with no
 * one reviewing it first, which is why the server's `video_save` accepts them.
 */
import { rpc } from "./data.js";
import { qs, qsa, esc, timeAgo, compact } from "./utils.js";
import { icon } from "./icons.js";
import { sessionToken, getMember } from "./session.js";

const KIND = {
  channel: "studio",
  server: "server",
  cinema: "cinema",
  blog: "blog",
  space: "space",
  library: "bookOpen",
  gallery: "gallery",
};

const KIND_ICON = {
  channel: "tv",
  server: "database",
  cinema: "film",
  blog: "article",
  space: "users",
  library: "bookOpen",
  gallery: "image",
};

const VIS = {
  general: "Public",
  public: "Public",
  limited: "Exclusive",
  exclusive: "Exclusive",
  private: "Private",
  followers: "Followers",
};

const STATUS = {
  published: "Published",
  draft: "Draft",
  scheduled: "Scheduled",
  pending: "Waiting",
  closed: "Closed",
};

const state = {
  token: "",
  hubs: [],
  hub: "",
  videos: [],
  tab: "new",
};

const el = {};

/* ================================================================== */
/* small helpers                                                      */
/* ================================================================== */
function hubCode(row) {
  return String((row && row.video && row.video.hub && row.video.hub.code) || row.hub_code || "").toUpperCase();
}

function hubOf(code) {
  return state.hubs.find((h) => h.code === code) || null;
}

function plural(count, one, many) {
  return `${count} ${count === 1 ? one : many}`;
}

function showState({ title, text, action = "", tone = "" }) {
  if (!el.state) return;
  el.state.hidden = false;
  el.state.dataset.tone = tone;
  el.state.innerHTML = `
    <div class="vempty">
      <span class="vempty__icon">${icon(tone === "error" ? "info" : "users")}</span>
      <h2>${esc(title)}</h2>
      <p>${esc(text)}</p>
      ${action ? `<div class="vempty__acts">${action}</div>` : ""}
    </div>`;
  if (el.shell) el.shell.hidden = true;
}

function hideState() {
  if (el.state) el.state.hidden = true;
  if (el.shell) el.shell.hidden = false;
}

function flash(html) {
  if (!el.flash) return;
  el.flash.hidden = false;
  el.flash.innerHTML = html;
}

/* ================================================================== */
/* the rail — where this member may publish                           */
/* ================================================================== */
function paintRail() {
  if (!el.hubs) return;
  el.hubs.innerHTML = state.hubs
    .map((hub) => {
      const on = hub.code === state.hub;
      const mark = hub.logo_url
        ? `<img src="${esc(hub.logo_url)}" alt="" loading="lazy" />`
        : icon(KIND_ICON[hub.kind] || "tv");
      return `
        <button class="pub__hub${on ? " is-on" : ""}" type="button" data-pub-hub="${esc(hub.code)}" aria-pressed="${on}">
          <span class="pub__hubmark">${mark}</span>
          <span class="pub__hubtext">
            <span class="pub__hubname">${esc(hub.name || hub.code)}</span>
            <span class="pub__hubmeta">${esc(KIND[hub.kind] || "hub")} · ${esc(hub.code)} · ${esc(plural(Number(hub.mine || 0), "video", "videos"))}</span>
          </span>
          <span class="pub__hubrole">${hub.role === "staff" ? "Staff" : "Publisher"}</span>
        </button>`;
    })
    .join("");

  if (el.count) el.count.textContent = plural(state.hubs.length, "hub", "hubs");
  paintHubNote();
}

function paintHubNote() {
  const hub = hubOf(state.hub);
  if (el.note) {
    el.note.textContent = hub
      ? `Publishing into ${hub.name} · ${hub.code}. It appears there the moment you publish.`
      : "Pick the hub you are publishing into.";
  }
  if (el.link) {
    el.link.hidden = !hub;
    if (hub) el.link.href = `creator.html?studio=${encodeURIComponent(hub.code)}`;
  }
}

/* ================================================================== */
/* choosing a hub                                                     */
/* ================================================================== */
function selectHub(code, { announce = true } = {}) {
  const next = String(code || "").trim().toUpperCase();
  if (next === state.hub) {
    paintRail();
    return Promise.resolve();
  }
  state.hub = next;
  document.body.dataset.vedHubcode = next;

  const url = new URL(location.href);
  if (next) url.searchParams.set("studio", next);
  else url.searchParams.delete("studio");
  try {
    history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  } catch (e) {
    /* a sandboxed history is not worth a broken page */
  }

  paintRail();
  if (announce) document.dispatchEvent(new CustomEvent("ved:hub", { detail: { code: next, from: "rail" } }));
  return loadMine();
}

/* ================================================================== */
/* what this member published in the selected hub                     */
/* ================================================================== */
async function loadMine() {
  let res = null;
  try {
    res = await rpc("video_mine", { p_token: state.token });
  } catch (error) {
    console.warn("[1World] videos:", error.message);
  }
  if (!res || res.ok !== true) {
    state.videos = [];
    paintMine();
    return;
  }
  const rows = Array.isArray(res.rows) ? res.rows : [];
  state.videos = rows.filter((row) => hubCode(row) === state.hub);
  paintMine();
}

function paintMine() {
  if (!el.list) return;
  const hub = hubOf(state.hub);
  const name = (hub && hub.name) || state.hub || "this hub";
  if (el.mineCount) {
    el.mineCount.textContent = state.videos.length ? String(state.videos.length) : "";
  }

  if (!state.videos.length) {
    el.list.innerHTML = `
      <div class="pub__none">
        <span class="vempty__icon">${icon("film")}</span>
        <h3>Nothing of yours in ${esc(name)} yet</h3>
        <p>The editor beside this list is how it starts: a link, a title, a picture — then Publish.</p>
      </div>`;
    return;
  }

  el.list.innerHTML = state.videos
    .map((row) => {
      const thumb = row.thumbnail || (row.video && row.video.thumbnail) || "";
      const code = row.code || "";
      const views = Number((row.counters && (row.counters.impressions || row.counters.views)) || 0);
      const status = STATUS[row.status] || row.status || "—";
      const vis = VIS[row.visibility] || row.visibility || "";
      const when = row.published_at ? timeAgo(row.published_at) : "not out yet";
      return `
        <article class="pubrow">
          <span class="pubrow__thumb">${thumb ? `<img src="${esc(thumb)}" alt="" loading="lazy" />` : icon("film")}</span>
          <div class="pubrow__text">
            <p class="pubrow__title">${esc(row.title || "Untitled")}</p>
            <p class="pubrow__meta">
              <span class="pubrow__badge" data-status="${esc(row.status || "")}">${esc(status)}</span>
              <span>${esc(vis)}</span>
              <span>${esc(compact(views))} views</span>
              <span>${esc(when)}</span>
            </p>
          </div>
          <div class="pubrow__acts">
            <a class="btn btn--quiet btn--sm" href="video.html?id=${encodeURIComponent(code)}">${icon("play")} Open</a>
            <a class="btn btn--ghost btn--sm" href="publisher.html?studio=${encodeURIComponent(state.hub)}&id=${encodeURIComponent(code)}">${icon("pen")} Edit here</a>
          </div>
        </article>`;
    })
    .join("");
}

/* ================================================================== */
/* the two tabs                                                       */
/* ================================================================== */
function setTab(tab) {
  state.tab = tab === "mine" ? "mine" : "new";
  document.body.dataset.pubTab = state.tab;
  qsa("[data-pub-tab]").forEach((btn) => {
    const on = btn.getAttribute("data-pub-tab") === state.tab;
    btn.classList.toggle("is-on", on);
    btn.setAttribute("aria-selected", String(on));
  });
  qsa("[data-pub-panel]").forEach((panel) => {
    panel.hidden = panel.getAttribute("data-pub-panel") !== state.tab;
  });
}

/* ================================================================== */
/* wiring                                                             */
/* ================================================================== */
function bind() {
  el.hubs?.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-pub-hub]");
    if (!btn) return;
    const code = btn.getAttribute("data-pub-hub");
    if (code === state.hub) return;
    selectHub(code);
  });

  qsa("[data-pub-tab]").forEach((btn) => {
    btn.addEventListener("click", () => setTab(btn.getAttribute("data-pub-tab")));
  });

  /* the editor's own picker moved: the rail and the list follow it */
  document.addEventListener("ved:hub", (event) => {
    if (!event.detail || event.detail.from !== "editor") return;
    selectHub(event.detail.code, { announce: false });
  });

  /* the editor stayed on the page; the desk shows what just landed */
  document.addEventListener("ved:published", (event) => {
    const detail = (event && event.detail) || {};
    const title = detail.title ? `<b>${esc(detail.title)}</b>` : "Your video";
    const when = detail.status === "scheduled" ? "is scheduled" : "is published";
    flash(
      `${icon("check")} ${title} ${when}${detail.code ? ` — <a href="video.html?id=${encodeURIComponent(detail.code)}">open it</a>` : ""}`
    );
    if (el.mineCount) el.mineCount.textContent = "";
    loadMine();
  });

  document.addEventListener("ved:drafted", () => {
    flash(`${icon("file")} Draft saved — it is under <button class="pub__linkbtn" type="button" data-pub-goto="mine">your videos</button>.`);
    loadMine();
  });

  el.flash?.addEventListener("click", (event) => {
    const go = event.target.closest("[data-pub-goto]");
    if (go) setTab(go.getAttribute("data-pub-goto"));
  });
}

/* ================================================================== */
/* boot                                                               */
/* ================================================================== */
async function boot() {
  state.token = sessionToken();
  el.state = qs("[data-pub-state]");
  el.shell = qs("[data-pub-shell]");
  el.hubs = qs("[data-pub-hubs]");
  el.count = qs("[data-pub-count]");
  el.note = qs("[data-pub-hubnote]");
  el.link = qs("[data-pub-hub-link]");
  el.list = qs("[data-pub-list]");
  el.flash = qs("[data-pub-flash]");
  el.mineCount = qs("[data-pub-mine-count]");

  const params = new URLSearchParams(location.search);
  const wanted = (params.get("studio") || "").trim().toUpperCase();
  const editing = (params.get("id") || "").trim();
  /* the editor reads this while it boots, so it is set before anything waits */
  if (wanted) document.body.dataset.vedHubcode = wanted;

  if (!state.token || !getMember()) {
    showState({
      title: "Sign in to publish",
      text: "A publisher works under their own name — sign in, and the hubs that approved you will be waiting here.",
      action: `<a class="btn btn--primary btn--sm" href="login.html?next=publisher.html">${icon("login")} Sign in</a>`,
    });
    return;
  }

  let res = null;
  try {
    res = await rpc("publisher_hubs", { p_token: state.token });
  } catch (error) {
    console.warn("[1World] publisher hubs:", error.message);
  }
  if (!res || res.ok !== true) {
    showState({
      title: "The desk could not open",
      text: res && res.error === "session"
        ? "Your session ended. Sign in again and come back."
        : "The list of hubs did not arrive. Refresh in a moment.",
      action: `<a class="btn btn--primary btn--sm" href="login.html?next=publisher.html">${icon("login")} Sign in</a>`,
      tone: "error",
    });
    return;
  }

  state.hubs = (Array.isArray(res.hubs) ? res.hubs : []).filter((hub) => hub && hub.code);
  if (!state.hubs.length) {
    showState({
      title: "No hub has approved you yet",
      text: "A publisher is a member an owner lets in. Open a hub, ask to publish in it, and once the owner approves you the editor here is yours.",
      action: `
        <a class="btn btn--primary btn--sm" href="creator.html">${icon("globe")} Find a hub</a>
        <a class="btn btn--ghost btn--sm" href="help.html">${icon("info")} How it works</a>`,
    });
    return;
  }

  hideState();
  const first = state.hubs.some((hub) => hub.code === wanted) ? wanted : state.hubs[0].code;
  state.hub = "";
  bind();
  setTab("new");
  await selectHub(first);

  if (editing) {
    const heading = qs("[data-ved-heading]");
    if (heading) heading.textContent = "Edit a video";
  }
}

boot();
