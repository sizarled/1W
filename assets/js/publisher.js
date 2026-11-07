/**
 * publisher.html — the Publisher program.
 * ------------------------------------------------------------------
 * A **publisher** is somebody who works *outside* the site: a channel, a
 * newsletter, a group, a blog of their own. Their job is to carry 1World's
 * blogs, libraries, studios and films to an audience that never comes here,
 * with a link of their own, and be paid in points for the people who arrive:
 *
 *   visit 0 · signup 50 · activation 250 · membership 1 000
 *
 * The page has two rooms — **the program** (what it is, and the seat: a public
 * code `IDPB100001`-style) and **your links** (one per hub, or one for the
 * whole site, each with its clicks, sign-ups and points).
 *
 * A publisher *inside* the site is a different person with a different page:
 * the member an owner admits into a hub writes there, in `creator.html`, which
 * is where the content of a hub is made — the tables, the editors, the drafts
 * the owner publishes. This page is the audience brought from outside, and
 * nothing else. `?studio=` links from the old desk land on that page too.
 *
 * The server owns all of it: `publisher_me`, `publisher_join`,
 * `publisher_link_save`, `publisher_link_delete`, `publisher_visit`. A
 * conversion is credited by `publisher_credit`, which only the server may
 * call — a browser cannot mint its own points.
 */
import { rpc } from "./data.js";
import { qs, qsa, esc, compact } from "./utils.js";
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

const state = {
  token: "",
  /* the hubs this member writes in — the options of the link builder */
  hubs: [],
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
function flash(html) {
  if (!el.flash) return;
  el.flash.hidden = false;
  el.flash.innerHTML = html;
}

/* ================================================================== */
/* the program — the seat, the links, the points                      */
/* ================================================================== */
const VIEWS = ["program", "links"];

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
/* wiring                                                             */
/* ================================================================== */
function bind() {
  /* the two rooms */
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
  el.flash = qs("[data-pub-flash]");

  const params = new URLSearchParams(location.search);

  /* the desk used to live here. A `?studio=` link is a hub, and a hub is
     written in the creator page, which is where the content of the site is
     made — so the old link is handed over instead of landing on nothing. */
  const studio = (params.get("studio") || "").trim().toUpperCase();
  if (studio) {
    location.replace(`creator.html?studio=${encodeURIComponent(studio)}`);
    return;
  }

  bind();
  setView(params.get("tab") === "links" ? "links" : "program");

  /* the hubs this member writes in are the options of the link builder. One
     call; the page does not wait on it, and a guest gets none of it. */
  if (state.token && getMember()) {
    try {
      const res = await rpc("publisher_hubs", { p_token: state.token });
      if (res && res.ok === true) {
        state.hubs = (Array.isArray(res.hubs) ? res.hubs : []).filter((hub) => hub && hub.code);
      }
    } catch (error) {
      console.warn("[1World] publisher hubs:", error.message);
    }
  }

  await loadProgram();
}

boot();
