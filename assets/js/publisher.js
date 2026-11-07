/**
 * publisher.html — the Publisher program, and the desk under it.
 * ------------------------------------------------------------------
 * A **publisher** is somebody who works *outside* the site: a channel, a
 * newsletter, a group, a blog of their own. Their job is to carry 1World's
 * blogs, libraries, studios and films to an audience that never comes here,
 * with a link of their own, and be paid in points for the people who arrive:
 *
 *   visit 0 · signup 50 · activation 250 · membership 1 000
 *
 * The page has three rooms — **the program** (what it is, and the seat: a
 * public code `IDPB100001`-style), **your links** (one per hub, or one for
 * the whole site, each with its clicks, sign-ups and points) and **the
 * desk**, which is the older half: a member an owner approved into
 * `creator_hubs.publishers` writes in that hub with the video editor.
 *
 * The server owns all of it: `publisher_me`, `publisher_join`,
 * `publisher_link_save`, `publisher_link_delete`, `publisher_visit`. A
 * conversion is credited by `publisher_credit`, which only the server may
 * call — a browser cannot mint its own points.
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
  /* the program */
  view: "program",
  me: null,
  links: [],
  conversions: [],
  values: { signup: 50, activation: 250, membership: 1000 },
  busy: false,
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
/* the program — the seat, the links, the points                      */
/* ================================================================== */
const VIEWS = ["program", "links", "desk"];

function setView(view) {
  state.view = VIEWS.includes(view) ? view : "program";
  qsa("[data-pub-view]").forEach((btn) => {
    const on = btn.getAttribute("data-pub-view") === state.view;
    btn.classList.toggle("is-on", on);
    btn.setAttribute("aria-selected", String(on));
  });
  qsa("[data-pub-viewpanel]").forEach((panel) => {
    panel.hidden = panel.getAttribute("data-pub-viewpanel") !== state.view;
  });
  document.body.dataset.pubView = state.view;
}

/** The four numbers at the head of the page. */
function paintStats() {
  if (!el.stats) return;
  const publisher = state.me && state.me.publisher;
  const totals = (state.me && state.me.totals) || {};
  const tile = (label, value, meta) => `
    <div class="pstat">
      <span class="pstat__label">${esc(label)}</span>
      <p class="pstat__value">${esc(value)}</p>
      <p class="pstat__meta">${esc(meta || "")}</p>
    </div>`;
  el.stats.innerHTML = [
    tile("Your publisher code", publisher ? publisher.code : "—", publisher ? publisher.status === "paused" ? "Paused" : "Active" : "Join to get one"),
    tile("Clicks", compact(Number(totals.clicks) || 0), "Through every link"),
    tile("Sign-ups", compact(Number(totals.signups) || 0), "People who stayed"),
    tile("Points earned", compact(Number(totals.points) || 0), publisher ? `From ${publisher.links || 0} link${Number(publisher.links) === 1 ? "" : "s"}` : "Nothing yet"),
  ].join("");
}

/** The seat: the join form, the seat card, or the way in. */
function paintSeat() {
  if (!el.seat) return;
  const me = state.me;

  if (!me || !me.member) {
    el.seat.innerHTML = `
      <div class="seat__card">
        ${icon("lock")}
        <h2>Join with your account</h2>
        <p>The program is open to members — that is how the points have somewhere to land. Sign in, or make an
        account, and the form is one field away.</p>
        <div class="seat__acts">
          <a class="btn btn--primary btn--sm" href="login.html?next=publisher.html">${icon("login")} Sign in</a>
          <a class="btn btn--ghost btn--sm" href="register.html?next=publisher.html">${icon("user")} Create an account</a>
        </div>
      </div>`;
    return;
  }

  const publisher = me.publisher;
  if (publisher && !state.seatEdit) {
    el.seat.innerHTML = `
      <div class="seat__card seat__card--on">
        <div class="seat__head">
          <span class="pstat__label">Your seat</span>
          <span class="seat__chip" data-tone="${esc(publisher.status)}">${esc(publisher.status === "paused" ? "Paused" : "Active")}</span>
        </div>
        <p class="seat__code">${esc(publisher.code)}</p>
        <div class="seat__acts">
          <button class="btn btn--ghost btn--sm" type="button" data-pub-copy="${esc(publisher.code)}">${icon("link")} Copy the code</button>
          <button class="btn btn--quiet btn--sm" type="button" data-pub-seat-edit>${icon("pen")} Change where you publish</button>
        </div>
        <dl class="seat__facts">
          <div><dt>Where you publish</dt><dd>${esc(publisher.channel || "—")}</dd></div>
          <div><dt>From</dt><dd>${esc(publisher.place || "—")}</dd></div>
          <div><dt>Audience</dt><dd>${esc(compact(Number(publisher.audience) || 0))}</dd></div>
          <div><dt>Since</dt><dd>${esc(whenOf(publisher.created_at))}</dd></div>
        </dl>
        <p class="vhint">Paste <code>${esc(publisher.code)}</code> wherever you write about 1World. The links below are
        what actually count the clicks.</p>
      </div>`;
    return;
  }

  const seat = publisher || {};
  el.seat.innerHTML = `
    <form class="seat__form" data-pub-join>
      <h2 class="promo__title">Take a seat</h2>
      <p class="vhint">One form. The seat is free, it is yours alone, and the code it prints is what the site
      recognises you by.</p>
      <label class="field">
        <span>Where you publish <b>*</b></span>
        <input class="input" type="text" name="channel" maxlength="120" required value="${esc(seat.channel || "")}" placeholder="My Telegram channel, the newsletter, the YouTube channel…" />
      </label>
      <label class="field">
        <span>From where</span>
        <input class="input" type="text" name="place" maxlength="80" value="${esc(seat.place || "")}" placeholder="Casablanca" />
      </label>
      <label class="field">
        <span>How many people read you</span>
        <input class="input" type="number" name="audience" min="0" max="100000000" step="1" value="${esc(seat.audience || "")}" placeholder="4200" />
      </label>
      <label class="field">
        <span>A word about what you write</span>
        <textarea class="textarea" rows="3" name="note" maxlength="400" placeholder="Film writing, three posts a week…">${esc(seat.note || "")}</textarea>
      </label>
      <p class="seat__error" data-pub-seat-error hidden></p>
      <div class="seat__acts">
        <button class="btn btn--primary btn--sm" type="submit">${icon("check")} ${publisher ? "Save the seat" : "Join the program"}</button>
        ${publisher ? `<button class="btn btn--ghost btn--sm" type="button" data-pub-seat-cancel>${icon("close")} Cancel</button>` : ""}
      </div>
    </form>`;
}

/** The builder: one link, per hub or for the whole site. */
function paintLinkForm() {
  if (!el.linkForm) return;
  if (!state.me || !state.me.member) {
    el.linkForm.innerHTML = `<p class="vhint">Sign in to build a link.</p>`;
    return;
  }
  if (!state.me.publisher) {
    el.linkForm.innerHTML = `<p class="vhint">Join the program first — then this is where the links are made.</p>`;
    return;
  }
  const options = [
    `<option value="">The whole site (register.html)</option>`,
    ...state.hubs.map((hub) => `<option value="${esc(hub.code)}">${esc(hub.name)} · ${esc(hub.code)}</option>`),
  ].join("");
  el.linkForm.innerHTML = `
    <form class="links__form" data-pub-link-form-el>
      <h2 class="promo__title">A new link</h2>
      <label class="field">
        <span>Where it points</span>
        <select class="select" name="hub">${options}</select>
      </label>
      <label class="field">
        <span>Or a hub code from anywhere on the site</span>
        <input class="input" type="text" name="hubcode" maxlength="24" placeholder="IDBL100003" spellcheck="false" />
      </label>
      <label class="field">
        <span>A label, so you know which post it was</span>
        <input class="input" type="text" name="label" maxlength="60" placeholder="Instagram bio · March" />
      </label>
      <p class="seat__error" data-pub-link-error hidden></p>
      <div class="seat__acts">
        <button class="btn btn--primary btn--sm" type="submit" ${state.busy ? "disabled" : ""}>${icon("plus")} Make the link</button>
      </div>
      <p class="vhint">A hub you do not publish in can still be linked to; a private or hidden one cannot.</p>
    </form>`;
}

function paintLinks() {
  if (!el.links) return;
  if (el.linkCount) el.linkCount.textContent = state.links.length ? String(state.links.length) : "";

  if (!state.links.length) {
    el.links.innerHTML = `
      <div class="pub__none">
        <span class="vempty__icon">${icon("link")}</span>
        <h3>No link yet</h3>
        <p>One link is enough to start: point it at the whole site, paste it outside, and the first clicks appear
        here.</p>
      </div>`;
    return;
  }

  el.links.innerHTML = state.links
    .map((link) => {
      const where = link.hub_name || "The whole site";
      const kind = link.hub_kind ? KIND[link.hub_kind] || link.hub_kind : "register";
      return `
        <article class="linkrow" data-pub-link="${esc(link.id)}">
          <div class="linkrow__head">
            <span class="linkrow__where">${esc(where)}</span>
            <span class="linkrow__kind">${esc(kind)}</span>
            ${link.label ? `<span class="linkrow__label">${esc(link.label)}</span>` : ""}
          </div>
          <p class="linkrow__url"><code>${esc(link.url)}</code></p>
          <p class="linkrow__counts">
            <span><b>${esc(compact(Number(link.clicks) || 0))}</b> clicks</span>
            <span><b>${esc(compact(Number(link.signups) || 0))}</b> sign-ups</span>
            <span><b>${esc(compact(Number(link.points) || 0))}</b> points</span>
            <span>${esc(whenOf(link.created_at))}</span>
          </p>
          <div class="linkrow__acts">
            <button class="btn btn--ghost btn--sm" type="button" data-pub-copy-link="${esc(link.url)}">${icon("link")} Copy</button>
            <a class="btn btn--quiet btn--sm" href="${esc(link.url)}" target="_blank" rel="noopener">${icon("external")} Open</a>
            <button class="btn btn--quiet btn--sm" type="button" data-pub-link-del="${esc(link.id)}">${icon("trash")} Remove</button>
          </div>
        </article>`;
    })
    .join("");
}

function paintConversions() {
  if (!el.conversions) return;
  const rows = state.conversions || [];
  if (!rows.length) {
    el.conversions.innerHTML = `<p class="vhint">Nothing yet. A conversion is written by the server the moment
    somebody who came through your link signs up, activates, or takes a membership.</p>`;
    return;
  }
  el.conversions.innerHTML = `
    <table class="promo__table">
      <thead><tr><th>Conversion</th><th>Who</th><th>Link</th><th>Points</th><th>When</th></tr></thead>
      <tbody>
        ${rows
          .map(
            (row) => `<tr>
              <td>${esc(row.kind)}</td>
              <td>${esc(row.who || "—")}</td>
              <td>${esc(row.link || "—")}</td>
              <td><b>${esc(compact(Number(row.points) || 0))}</b></td>
              <td>${esc(whenOf(row.at))}</td>
            </tr>`
          )
          .join("")}
      </tbody>
    </table>`;
}

function whenOf(value) {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  } catch (e) {
    return String(value).slice(0, 10);
  }
}

function paintValues() {
  const values = state.values || {};
  qsa("[data-pub-value]").forEach((node) => {
    const key = node.getAttribute("data-pub-value");
    const value = Number(values[key] || 0);
    if (value) node.textContent = value.toLocaleString("en-GB");
  });
}

function paintProgram() {
  paintStats();
  paintSeat();
  paintLinkForm();
  paintLinks();
  paintConversions();
  paintValues();
}

async function loadProgram() {
  let res = null;
  try {
    res = await rpc("publisher_me", { p_token: state.token || "" });
  } catch (error) {
    console.warn("[1World] publisher program:", error.message);
  }
  if (res && res.ok) {
    state.me = res;
    state.links = Array.isArray(res.links) ? res.links : [];
    state.conversions = Array.isArray(res.conversions) ? res.conversions : [];
    state.values = res.values || state.values;
  }
  paintProgram();
}

/* ---------------------------------------------------------------- */
/* writing                                                           */
/* ---------------------------------------------------------------- */
/** One named field of a form, whatever the browser hands us. */
function fieldOf(form, name) {
  const node = form && form.querySelector(`[name="${name}"]`);
  return node ? String(node.value || "") : "";
}

async function joinProgram(form) {
  const errorNode = qs("[data-pub-seat-error]");
  if (errorNode) errorNode.hidden = true;
  const audience = Number(fieldOf(form, "audience") || 0);
  let res = null;
  try {
    res = await rpc("publisher_join", {
      p_token: state.token,
      p_channel: fieldOf(form, "channel").trim(),
      p_place: fieldOf(form, "place").trim(),
      p_audience: Number.isFinite(audience) ? Math.max(0, Math.round(audience)) : 0,
      p_note: fieldOf(form, "note").trim(),
    });
  } catch (error) {
    res = null;
  }
  if (!res || res.ok !== true) {
    const words = {
      session: "Your session ended — sign in again.",
      banned: "A closed account cannot join the program.",
      channel: "Say where you publish; it is the one thing the seat needs.",
    };
    if (errorNode) {
      errorNode.textContent = words[res && res.error] || "The server refused. Try again in a moment.";
      errorNode.hidden = false;
    }
    return;
  }
  state.seatEdit = false;
  flash(`${icon("check")} You are a publisher — <b>${esc(res.publisher.code)}</b> is yours.`);
  setView("links");
  await loadProgram();
}

async function makeLink(form) {
  const errorNode = qs("[data-pub-link-error]");
  if (errorNode) errorNode.hidden = true;
  /* the select is the hubs this member writes in; the box is any public hub */
  const code = (fieldOf(form, "hubcode") || fieldOf(form, "hub")).trim().toUpperCase();
  state.busy = true;
  let res = null;
  try {
    res = await rpc("publisher_link_save", {
      p_token: state.token,
      p_id: null,
      p_hub: code,
      p_label: fieldOf(form, "label").trim(),
    });
  } catch (error) {
    res = null;
  }
  state.busy = false;
  if (!res || res.ok !== true) {
    const words = {
      not_a_publisher: "Join the program first.",
      paused: "This seat is paused.",
      hidden_hub: "That hub is private or hidden — it cannot be promoted.",
      hub: "That hub was not found.",
      limit: "Forty links is the ceiling.",
    };
    if (errorNode) {
      errorNode.textContent = words[res && res.error] || "The link was not made. Try again.";
      errorNode.hidden = false;
    }
    return;
  }
  flash(`${icon("link")} Link made: <code>${esc(res.link.url)}</code>`);
  await loadProgram();
}

async function removeLink(id) {
  let res = null;
  try {
    res = await rpc("publisher_link_delete", { p_token: state.token, p_id: id });
  } catch (error) {
    res = null;
  }
  if (!res || res.ok !== true) {
    flash(`${icon("info")} The link was not removed.`);
    return;
  }
  flash(`${icon("trash")} Link removed — its clicks and points stay in your totals.`);
  await loadProgram();
}

async function copyText(text) {
  const value = String(text || "");
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(value);
      flash(`${icon("link")} Copied: <code>${esc(value)}</code>`);
      return;
    }
  } catch (error) {
    /* the clipboard is closed — the code is still on screen */
  }
  flash(`${icon("link")} <code>${esc(value)}</code>`);
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
  /* the three rooms */
  qsa("[data-pub-view]").forEach((btn) => {
    btn.addEventListener("click", () => setView(btn.getAttribute("data-pub-view")));
  });

  document.addEventListener("click", (event) => {
    const jump = event.target.closest("[data-pub-jump]");
    if (jump) {
      event.preventDefault();
      setView(jump.getAttribute("data-pub-jump"));
      el.stats?.scrollIntoView?.({ behavior: "smooth", block: "start" });
      return;
    }
    const copy = event.target.closest("[data-pub-copy]");
    if (copy) {
      event.preventDefault();
      return copyText(copy.getAttribute("data-pub-copy"));
    }
    const copyLink = event.target.closest("[data-pub-copy-link]");
    if (copyLink) {
      event.preventDefault();
      return copyText(copyLink.getAttribute("data-pub-copy-link"));
    }
    const drop = event.target.closest("[data-pub-link-del]");
    if (drop) {
      event.preventDefault();
      return removeLink(drop.getAttribute("data-pub-link-del"));
    }
    if (event.target.closest("[data-pub-seat-edit]")) {
      event.preventDefault();
      state.seatEdit = true;
      return paintSeat();
    }
    if (event.target.closest("[data-pub-seat-cancel]")) {
      event.preventDefault();
      state.seatEdit = false;
      return paintSeat();
    }
  });

  document.addEventListener("submit", (event) => {
    const join = event.target.closest("[data-pub-join]");
    if (join) {
      event.preventDefault();
      return joinProgram(join);
    }
    const link = event.target.closest("[data-pub-link-form-el]");
    if (link) {
      event.preventDefault();
      return makeLink(link);
    }
  });

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
  el.stats = qs("[data-pub-stats]");
  el.seat = qs("[data-pub-seat]");
  el.linkForm = qs("[data-pub-link-form]");
  el.links = qs("[data-pub-links]");
  el.linkCount = qs("[data-pub-link-count]");
  el.conversions = qs("[data-pub-conversions]");
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

  bind();
  setView(params.get("tab") === "links" || params.get("tab") === "desk" ? params.get("tab") : "program");
  await loadProgram();

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
  paintLinkForm();
  if (!state.hubs.length) {
    /* the desk is a second room now: no hub is a note in it, not a wall */
    showState({
      title: "No hub has approved you yet",
      text: "The program above needs no hub — a link for the whole site is enough. If you also want to write inside somebody's blog, library or studio, open a hub, ask to publish in it, and the editor here is yours once the owner approves.",
      action: `
        <a class="btn btn--primary btn--sm" href="creator.html">${icon("globe")} Find a hub</a>
        <a class="btn btn--ghost btn--sm" href="creator.html?section=publishers">${icon("pen")} The publishers</a>`,
    });
    return;
  }

  hideState();
  const first = state.hubs.some((hub) => hub.code === wanted) ? wanted : state.hubs[0].code;
  state.hub = "";
  setTab("new");
  await selectHub(first);

  if (editing) {
    const heading = qs("[data-ved-heading]");
    if (heading) heading.textContent = "Edit a video";
  }
}

boot();
