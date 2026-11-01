/**
 * dashboard.html — the member dashboard.
 * ------------------------------------------------------------------
 * One server call, `member_dashboard(token)`, returns everything the page
 * needs (member, ban + trial state, codes, devices, notifications, prefs,
 * lists, reports, prizes, points, history). The browser never reads the
 * tables directly and never sees a hash, a token or another member's row.
 *
 * Three states are gated before any tool is drawn:
 *   active    → the full dashboard
 *   inactive  → activation message + «Activate account» + log out
 *   expired   → renewal message + log out
 *   banned    → ban reason + «Request trial» + log out
 *               ... then «date will be set soon» → «Go to trial» + warning
 *               ... then permanently closed, log out only
 */

import { rpc } from "./data.js";
import { LEVELS, levelInfo, rowFor as levelRow, unlockOffer, unlockFee } from "./levels.js";
import {
  qs,
  qsa,
  esc,
  num,
  formatDate,
  timeAgo,
  avatarPlaceholder,
  tilePlaceholder,
  enableDragScroll,
  scrollRail,
} from "./utils.js";
import { hydrateIcons, icon } from "./icons.js";
import { toast } from "./ui.js";
import { setMember, signOut, sessionToken, clearSessionToken } from "./session.js";

/* ================================================================== */
/* vocabulary                                                          */
/* ================================================================== */
const POINTS_PER_USD = 100;

const NOTIFY_SOURCES = [
  { key: "messages", label: "Messages", text: "Direct messages and support replies. Always on.", locked: true },
  { key: "court", label: "Court", text: "Trial dates, verdicts and bans. Always on.", locked: true },
  { key: "movies", label: "Movies", text: "New releases matching your lists." },
  { key: "series", label: "Series", text: "New seasons and episodes." },
  { key: "channels", label: "Channels", text: "IPTV playlists added to your packages." },
  { key: "videos", label: "Videos", text: "Uploads from the creators you follow." },
  { key: "podcasts", label: "Podcasts", text: "New episodes in your queue." },
  { key: "images", label: "Images", text: "Galleries and collections." },
  { key: "articles", label: "Articles", text: "Long reads from the writers you follow." },
  { key: "reviews", label: "Reviews", text: "Replies to your reviews and ratings." },
  { key: "answers", label: "Q&A", text: "Answers to your questions." },
  { key: "documents", label: "Documents", text: "Library files and updates." },
  { key: "store", label: "Store", text: "Orders, shipping and price drops." },
  { key: "auction", label: "Auction", text: "Outbid warnings and closing lots." },
  { key: "points", label: "Points", text: "Points earned, spent and expiring." },
  { key: "prizes", label: "Prizes", text: "New draws and results." },
  { key: "payments", label: "Payments", text: "Transfer status changes." },
  { key: "reports", label: "Reports", text: "Decisions on reports you filed." },
];

const LIST_TYPES = [
  { key: "movies", label: "Movies", media: "movie" },
  { key: "series", label: "Series", media: "tv" },
  { key: "channels", label: "Channels", media: "channel" },
  { key: "podcasts", label: "Podcasts", media: "podcast" },
  { key: "articles", label: "Articles", media: "article" },
  { key: "answers", label: "Answers", media: "answer" },
  { key: "documents", label: "Documents", media: "document" },
  { key: "images", label: "Images", media: "image" },
];

const HISTORY_TYPES = [
  { key: "all", label: "All" },
  ...LIST_TYPES.map((t) => ({ key: t.key, label: t.label })),
  { key: "videos", label: "Videos" },
  { key: "products", label: "Products" },
  { key: "profiles", label: "Profiles" },
];

const VIEW_META = {
  overview: ["Overview", "Membership, points, codes and the devices linked to them."],
  notifications: ["Notifications", "Everything the platform told you, with per-section switches."],
  codes: ["Codes", "Six-digit viewing codes and the devices they are bound to."],
  iptv: ["IPTV", "M3U and Xtream playlists shared with your account."],
  favorites: ["Favorites", "What you saved while browsing."],
  later: ["Watch later", "A queue that follows you between devices."],
  complete: ["Completed", "Everything you finished watching, reading or listening to."],
  reports: ["Reports", "Reports you filed and reports against your content."],
  court: ["Court", "Trials where you are a party, and the verdicts."],
  points: ["Points", "Balance, earn methods and the full ledger."],
  level: ["Level", "Your rank, what unlocks next and what it takes."],
  payments: ["Payments", "Points to money, bank details and transfer status."],
  prizes: ["Prizes", "Draws you can join and what you already won."],
  history: ["Viewing history", "Every title, channel and page you opened."],
  analytics: ["Analytics", "How other people engage with your content."],
  creator: ["Creator management", "The studios and spaces you own."],
  publisher: ["Publisher management", "Servers, cinemas and libraries you publish."],
  advertiser: ["Advertising campaigns", "Point budgets, placements and results."],
  "settings-site": ["Website settings", "Language, country and skin."],
  "settings-profile": ["Profile settings", "Name, bio, avatar, cover and privacy."],
  "settings-account": ["Account settings", "Email, password, phone, recovery and activation."],
  "settings-platforms": ["Platforms", "Connect the services your account publishes to."],
};

const state = {
  data: null,
  view: "overview",
  popFilter: "hour",
  popOpen: false,
  tabs: { codes: "codes", iptv: "m3u", notif: "list", lists: "movies", history: "all" },
  notifWindow: "today",
  custom: { from: "", to: "" },
  busy: false,
  tmdb: new Map(),
};

const token = sessionToken();

/* ================================================================== */
/* boot                                                                */
/* ================================================================== */
export async function initDashboard() {
  if (!qs("[data-dsh]")) return;

  if (!token) {
    goToLogin();
    return;
  }

  wireChrome();

  let data = null;
  try {
    data = await rpc("member_dashboard", { p_token: token });
  } catch (error) {
    console.warn("[1World] dashboard:", error.message);
  }

  if (!data || data.ok !== true) {
    clearSessionToken();
    signOut();
    goToLogin();
    return;
  }

  state.data = data;
  if (data.member) setMember(data.member);

  paintIdentity();
  paintSideState();
  paintGate();
}

function goToLogin() {
  const next = "dashboard.html";
  location.replace(`login.html?next=${encodeURIComponent(next)}`);
}

async function reload() {
  if (!token) return goToLogin();
  const data = await rpc("member_dashboard", { p_token: token }).catch(() => null);
  if (!data || data.ok !== true) {
    clearSessionToken();
    signOut();
    goToLogin();
    return;
  }
  state.data = data;
  paintIdentity();
  paintGate();
}

/* ================================================================== */
/* header + sidebar chrome                                             */
/* ================================================================== */
function wireChrome() {
  const dsh = qs("[data-dsh]");
  dsh.addEventListener("click", onClick);
  dsh.addEventListener("change", onChange);

  qsa("[data-rail-dir]").forEach((btn) => {
    btn.addEventListener("click", () => scrollRail(qs("[data-rail]"), Number(btn.dataset.railDir)));
  });

  enableDragScroll(qs("[data-rail]"));

  document.addEventListener("click", (event) => {
    if (!state.popOpen) return;
    if (event.target.closest(".dsh-bell-wrap")) return;
    closePopover();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (closeUnlock()) return;
    if (state.popOpen) closePopover();
  });

  window.addEventListener("hashchange", () => {
    const key = (location.hash || "").replace("#", "");
    if (key && VIEW_META[key] && key !== state.view) setView(key, { silent: true });
  });
}

function paintIdentity() {
  const member = state.data.member || {};
  const name = member.username || "member";
  const avatar = member.avatar_url || avatarPlaceholder(name);

  qsa("[data-me-avatar], [data-side-avatar]").forEach((el) => {
    el.innerHTML = `<img src="${esc(avatar)}" alt="" width="44" height="44" loading="lazy" />`;
  });

  qsa("[data-me-username], [data-side-username]").forEach((el) => {
    el.textContent = name.startsWith("@") ? name : `@${name}`;
  });

  qsa("[data-me-id], [data-side-id]").forEach((el) => {
    el.textContent = member.member_id || "—";
  });

  /* the avatar and the username open the member's own profile */
  const handle = member.username || "";
  const profileHref = handle ? `profile.html?u=${encodeURIComponent(handle)}` : "profile.html";
  qsa("[data-me-link], [data-side-profile]").forEach((link) => {
    link.setAttribute("href", profileHref);
    link.setAttribute("title", `Open ${handle || "your profile"}`);
  });

  const status = qs("[data-side-status]");
  if (status) {
    const value = String(member.status || "").toLowerCase();
    status.textContent = value ? value : "";
    status.dataset.state = value;
    status.hidden = !value;
  }

  const admin = isAdmin(member);
  const group = qs("[data-admin-group]");
  if (group) group.hidden = !admin;

  const unread = (state.data.notifications || []).filter((n) => !n.read).length;
  const dot = qs("[data-bell-dot]");
  if (dot) dot.hidden = unread === 0;
  const count = qs("[data-nav-unread]");
  if (count) {
    count.textContent = unread > 99 ? "99+" : String(unread);
    count.hidden = unread === 0;
  }
}

function isAdmin(member) {
  const role = String(member.account_status || "").toLowerCase();
  return ["admin", "moderator", "owner", "staff"].includes(role) || Number(member.level || 1) >= 8;
}

/* ================================================================== */
/* gates                                                               */
/* ================================================================== */
function gateKey() {
  const d = state.data;
  const member = d.member || {};
  const status = String(member.status || "inactive").toLowerCase();
  const court = d.court || {};
  const active = court.active;
  const ban = d.ban || {};

  if (status === "banned") {
    if (ban.permanent || (active && active.decision === "uphold")) return "closed";
    if (active && active.status === "scheduled") return "scheduled";
    if (active && active.status === "requested") return "requested";
    return "banned";
  }
  if (status === "expired") return "expired";
  if (status !== "active") return "inactive";
  return "active";
}

function paintGate() {
  const key = gateKey();
  const main = qs("[data-main]");
  const dsh = qs("[data-dsh]");
  const side = qs("[data-side]");
  const rail = qs("[data-rail-wrap]");

  closePopover();

  if (key === "active") {
    dsh.dataset.state = "active";
    if (side) side.hidden = false;
    if (rail) rail.hidden = false;
    const pending = initialView();
    setView(pending, { first: true });
    return;
  }

  dsh.dataset.state = key;
  if (side) side.hidden = true;
  if (rail) rail.hidden = true;
  main.innerHTML = "";
  main.append(gateNode(key));
  hydrateIcons(main);

  if (key === "inactive") {
    const member = state.data.member || {};
    const link = qs("[data-gate-activate]", main);
    // an account that was activated before gets the two doors on that page
    const again = Boolean(member.account_activated_at);
    if (link) {
      link.href = `activated.html?member=${encodeURIComponent(member.member_id || "")}${again ? "&mode=reactivate" : ""}`;
      const label = link.querySelector("span");
      if (label) label.textContent = again ? "Re-activate or upgrade" : "Activate account";
      link.dataset.mode = again ? "reactivate" : "activate";
    }
    const created = member.created_at ? new Date(member.created_at) : null;
    const note = qs("[data-gate-deadline]", main);
    if (note && created && !Number.isNaN(created.getTime())) {
      const deadline = new Date(created.getTime() + 30 * 86400000);
      note.hidden = false;
      note.textContent = `Accounts that stay inactive until ${formatDate(deadline)} are banned automatically.`;
    }
  }

  if (key === "banned" || key === "closed" || key === "requested" || key === "scheduled") {
    const ban = state.data.ban || {};
    const court = (state.data.court || {}).active || {};
    const reason = qs("[data-gate-ban-reason]", main);
    if (reason) reason.textContent = ban.reason || "No reason was recorded.";
    const by = qs("[data-gate-ban-by]", main);
    if (by) by.textContent = ban.by ? `@${String(ban.by).replace(/^@/, "")}` : "the moderation team";
    const meta = qs("[data-gate-ban-meta]", main);
    if (meta && ban.at) {
      meta.hidden = false;
      meta.textContent = `Banned ${formatDate(ban.at)} · permanent: ${ban.permanent ? "yes" : "no"}`;
    }
    qsa("[data-gate-case]", main).forEach((el) => {
      el.textContent = court.case_code || "—";
    });
    const why = qs("[data-gate-reason]", main);
    if (why) why.textContent = court.reason || ban.reason || "—";

    if (key === "scheduled" && court.scheduled_at) {
      const when = qs("[data-gate-when]", main);
      if (when) when.textContent = fullDate(court.scheduled_at);
      const link = qs("[data-gate-court]", main);
      if (link) link.href = `court.html?id=${encodeURIComponent(court.id)}`;
    }

    if (key === "closed" && court.decision_note) {
      const note = qs("[data-gate-decision]", main);
      if (note) {
        note.hidden = false;
        note.textContent = `Court note: ${court.decision_note}`;
      }
    }
  }
}

function gateNode(key) {
  const map = {
    inactive: "dsh-gate-inactive",
    expired: "dsh-gate-expired",
    banned: "dsh-gate-banned",
    requested: "dsh-gate-requested",
    scheduled: "dsh-gate-scheduled",
    closed: "dsh-gate-closed",
  };
  const tpl = qs(`#${map[key]}`);
  if (!tpl) return document.createTextNode("");
  return tpl.content.cloneNode(true);
}

/* ================================================================== */
/* routing                                                             */
/* ================================================================== */
function initialView() {
  const key = (location.hash || "").replace("#", "");
  return VIEW_META[key] ? key : "overview";
}

function setView(key, { first = false, silent = false } = {}) {
  if (!VIEW_META[key]) key = "overview";
  state.view = key;

  qsa("[data-nav] [data-goto]").forEach((btn) => {
    btn.classList.toggle("is-on", btn.dataset.goto === key);
  });

  if (!first && !silent) {
    try {
      window.history.replaceState(null, "", `#${key}`);
    } catch {
      /* file:// or a locked-down browser */
    }
  }

  const main = qs("[data-main]");
  main.innerHTML = "";
  main.append(renderView(key));
  hydrateIcons(main);
  wireView(key, main);

  if (!first) {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
}

function renderView(key) {
  const wrap = document.createElement("div");
  wrap.className = "dsh-view";
  wrap.dataset.view = key;
  const [title, sub] = VIEW_META[key];
  const banner = reopenBanner(key);
  wrap.innerHTML = `
    ${banner}
    <header class="dsh-hero">
      <div>
        <h1 class="dsh-hero__title">${esc(title)}</h1>
        <p class="dsh-hero__sub">${esc(sub)}</p>
      </div>
      <div class="dsh-hero__actions">${heroActions(key)}</div>
    </header>
    ${viewBody(key)}
  `;
  return wrap;
}

function reopenBanner(key) {
  if (key !== "overview") return "";
  const court = state.data.court || {};
  const history = (court.history || []).find((c) => c.decision === "unban");
  if (!history) return "";
  return `<div class="dsh-note"><i data-icon="scale"></i><span><strong>Reopened by court decision.</strong>
    Case <b>${esc(history.case_code)}</b> lifted the ban${
      history.decided_at ? ` on ${esc(formatDate(history.decided_at))}` : ""
    }. Everything is available again.</span></div>`;
}

function heroActions(key) {
  if (key === "codes") return `<button class="dsh-btn dsh-btn--sm" type="button" data-tab="codes" data-tab-value="devices"><i data-icon="monitor"></i>Linked devices</button>`;
  if (key === "notifications") return `<a class="dsh-btn dsh-btn--sm" href="notifications.html"><i data-icon="external"></i>Open full page</a>`;
  if (key === "points") return `<a class="dsh-btn dsh-btn--sm" href="index.html#membership"><i data-icon="zap"></i>Buy points</a>`;
  if (key === "prizes") return `<a class="dsh-btn dsh-btn--sm" href="prizes.html"><i data-icon="gift"></i>All prizes</a>`;
  if (key === "history") return `<a class="dsh-btn dsh-btn--sm" href="watch.html"><i data-icon="play"></i>Continue watching</a>`;
  return "";
}

/* ================================================================== */
/* views                                                               */
/* ================================================================== */
function viewBody(key) {
  switch (key) {
    case "overview":
      return overviewView();
    case "notifications":
      return notificationsView();
    case "codes":
      return codesView();
    case "iptv":
      return iptvView();
    case "favorites":
    case "later":
    case "complete":
      return listView(key);
    case "reports":
      return reportsView();
    case "court":
      return courtView();
    case "points":
      return pointsView();
    case "level":
      return levelView();
    case "payments":
      return paymentsView();
    case "prizes":
      return prizesView();
    case "history":
      return historyView();
    case "analytics":
      return analyticsView();
    case "creator":
      return surfacesView("creator");
    case "publisher":
      return surfacesView("publisher");
    case "advertiser":
      return advertiserView();
    case "settings-site":
      return settingsSiteView();
    case "settings-profile":
      return settingsProfileView();
    case "settings-account":
      return settingsAccountView();
    case "settings-platforms":
      return settingsPlatformsView();
    default:
      return overviewView();
  }
}

/* ---------------------------------------------------------------- */
/* overview                                                          */
/* ---------------------------------------------------------------- */
function overviewView() {
  const o = state.data.overview || {};
  const member = state.data.member || {};
  const codes = state.data.codes || [];
  const devices = state.data.devices || [];
  const joined = o.joined_at ? new Date(o.joined_at) : null;
  const days = joined && !Number.isNaN(joined.getTime()) ? Math.max(1, Math.round((Date.now() - joined.getTime()) / 86400000)) : 0;

  return `
    <div class="dsh-grid">
      ${stat("crown", "Membership", `${cap(o.membership || "free")}`, o.membership_expires_at ? `Until ${formatDate(o.membership_expires_at)}` : "No expiry date")}
      ${stat("clock", "Member for", `${num(days)} ${days === 1 ? "day" : "days"}`, `Since ${formatDate(o.joined_at)}`)}
      ${stat("zap", "Points available", num(o.points_available || 0), `≈ ${usd(o.points_available)}`)}
      ${stat("minus", "Points spent", num(o.points_spent || 0), "Across orders, prizes and boosts")}
      ${stat("sparkle", "Points earned", num(o.points_total || 0), "Lifetime, all sources")}
      ${stat("clock", "Watch time", `${num(o.watch_minutes || 0)} min`, "Verified playback only")}
    </div>

    <section class="dsh-card">
      <div class="dsh-card__head">
        <h2 class="dsh-card__title">Your viewing codes</h2>
        <button class="dsh-btn dsh-btn--sm" type="button" data-goto="codes"><i data-icon="plus"></i>Manage codes</button>
      </div>
      ${
        codes.length
          ? `<div class="dsh-grid">${codes
              .slice(0, 6)
              .map(
                (c) => `<div class="dsh-stat">
                  <span class="dsh-stat__label">${esc(c.months)} ${c.months === 1 ? "month" : "months"} · ${esc(ageLabel(c.age))}</span>
                  <p class="dsh-stat__value dsh-code">${esc(c.code)}</p>
                  <p class="dsh-stat__meta">${c.device_name || c.device_mac ? `Bound to ${esc(c.device_name || c.device_mac)}` : "Not bound to a device yet"}</p>
                </div>`
              )
              .join("")}</div>`
          : empty("lock", "No codes yet", "Create a six-digit code and bind it to one device. Codes stop working when the account is not active.", "Create a code", "codes")
      }
    </section>

    <section class="dsh-card">
      <div class="dsh-card__head">
        <h2 class="dsh-card__title">Linked devices</h2>
        <span class="dsh-chip">${devices.length} ${devices.length === 1 ? "device" : "devices"}</span>
      </div>
      ${
        devices.length
          ? `<div class="dsh-table-wrap"><table class="dsh-table">
              <thead><tr><th>Device</th><th>MAC</th><th>Code</th><th>Last used</th></tr></thead>
              <tbody>${devices
                .slice(0, 5)
                .map(
                  (d) => `<tr><td><strong>${esc(deviceName(d))}</strong></td><td class="dsh-mono">${esc(d.device_id)}</td>
                    <td class="dsh-code">${esc(d.code || "—")}</td><td>${esc(timeAgo(d.last_used_at) || "—")}</td></tr>`
                )
                .join("")}</tbody>
            </table></div>`
          : empty("monitor", "No device linked", "A code binds to the first device that uses it, or to the MAC you set when you create it.", "Manage devices", "codes")
      }
    </section>

    <section class="dsh-card">
      <div class="dsh-card__head"><h2 class="dsh-card__title">Account</h2></div>
      <dl class="dsh-kv">
        <div><dt>Full name</dt><dd>${esc(member.full_name || "—")}</dd></div>
        <div><dt>Username</dt><dd>${esc(member.username || "—")}</dd></div>
        <div><dt>Member ID</dt><dd>${esc(member.member_id || "—")}</dd></div>
        <div><dt>Email</dt><dd>${esc(member.email || "—")}</dd></div>
        <div><dt>Phone</dt><dd>${esc(member.phone_number || "—")}</dd></div>
        <div><dt>Level</dt><dd>${esc(levelInfo({ points: o.points_total || 0, membership: o.membership || "free" }).badge)}</dd></div>
        <div><dt>Last sign-in</dt><dd>${esc(member.last_login_at ? formatDate(member.last_login_at, { hour: "2-digit", minute: "2-digit" }) : "—")}</dd></div>
      </dl>
    </section>
  `;
}

/* ---------------------------------------------------------------- */
/* notifications                                                     */
/* ---------------------------------------------------------------- */
function notificationsView() {
  const items = state.data.notifications || [];
  const tab = state.tabs.notif;

  return `
    <div class="dsh-tabs" role="tablist">
      <button class="dsh-tab ${tab === "list" ? "is-on" : ""}" type="button" data-tab="notif" data-tab-value="list">All notifications</button>
      <button class="dsh-tab ${tab === "settings" ? "is-on" : ""}" type="button" data-tab="notif" data-tab-value="settings">Settings</button>
    </div>
    ${tab === "list" ? notificationList(items) : notificationSettings()}
  `;
}

function notificationList(items) {
  const filtered = items.filter((n) => inWindow(n.created_at, state.notifWindow, state.custom));
  return `
    <div class="dsh-card">
      <div class="dsh-card__head">
        <h2 class="dsh-card__title">${filtered.length} ${filtered.length === 1 ? "notification" : "notifications"}</h2>
        <span class="dsh-chip">${items.filter((n) => !n.read).length} unread</span>
      </div>
      <div class="dsh-tabs" role="group" aria-label="Filter by date">
        ${[
          ["hour", "Last hour"],
          ["today", "Today"],
          ["yesterday", "Yesterday"],
          ["week", "This week"],
          ["month", "This month"],
          ["year", "This year"],
          ["all", "All time"],
          ["custom", "Custom"],
        ]
          .map(
            ([key, label]) =>
              `<button class="dsh-tab ${state.notifWindow === key ? "is-on" : ""}" type="button" data-window="${key}">${label}</button>`
          )
          .join("")}
      </div>
      ${
        state.notifWindow === "custom"
          ? `<form class="dsh-form" data-custom-range>
              <div class="dsh-field"><label for="nf-from">From</label><input class="dsh-input" id="nf-from" type="date" name="from" value="${esc(state.custom.from)}" /></div>
              <div class="dsh-field"><label for="nf-to">To</label><input class="dsh-input" id="nf-to" type="date" name="to" value="${esc(state.custom.to)}" /></div>
              <div class="dsh-field"><button class="dsh-btn" type="submit"><i data-icon="filter"></i>Apply range</button></div>
            </form>`
          : ""
      }
      <div style="margin-top:.7rem">
        ${
          filtered.length
            ? `<div class="dsh-table-wrap"><table class="dsh-table">
                <thead><tr><th>Source</th><th>Title</th><th>Message</th><th>When</th><th></th></tr></thead>
                <tbody>${filtered
                  .map(
                    (n) => `<tr data-notif="${esc(n.id)}" data-unread="${n.read ? 0 : 1}">
                      <td><span class="dsh-chip" data-tone="${n.read ? "off" : "on"}">${esc(n.source || "system")}</span></td>
                      <td><strong>${esc(n.title || "Notification")}</strong></td>
                      <td>${esc(n.subject || "")}</td>
                      <td>${esc(timeAgo(n.created_at))}</td>
                      <td><div class="dsh-table__actions">
                        ${n.read ? "" : `<button class="dsh-btn dsh-btn--sm" type="button" data-notif-read="${esc(n.id)}"><i data-icon="check"></i>Read</button>`}
                      </div></td>
                    </tr>`
                  )
                  .join("")}</tbody>
              </table></div>`
            : empty("bell", "Nothing in this window", "Try another date filter or open the full notifications page.", "Open full page", "notifications-page")
        }
      </div>
    </div>
  `;
}

function notificationSettings() {
  const prefs = state.data.prefs || {};
  return `
    <div class="dsh-note"><i data-icon="info"></i><span>
      Messages and Court can never be switched off — they carry decisions about your account.
    </span></div>
    <div class="dsh-grid dsh-grid--2">
      ${NOTIFY_SOURCES.map((s) => {
        const on = s.locked ? true : prefs[s.key] !== false;
        return `<label class="dsh-switch" data-locked="${s.locked ? 1 : 0}">
          <span class="dsh-switch__text"><strong>${esc(s.label)}</strong><span>${esc(s.text)}</span></span>
          <input type="checkbox" data-source="${esc(s.key)}" ${on ? "checked" : ""} ${s.locked ? "disabled" : ""} />
        </label>`;
      }).join("")}
    </div>
  `;
}

/* ---------------------------------------------------------------- */
/* codes + devices                                                   */
/* ---------------------------------------------------------------- */
function codesView() {
  const tab = state.tabs.codes;
  return `
    <div class="dsh-tabs" role="tablist">
      <button class="dsh-tab ${tab === "codes" ? "is-on" : ""}" type="button" data-tab="codes" data-tab-value="codes">Codes</button>
      <button class="dsh-tab ${tab === "devices" ? "is-on" : ""}" type="button" data-tab="codes" data-tab-value="devices">Linked devices</button>
    </div>
    ${tab === "codes" ? codesPanel() : devicesPanel()}
  `;
}

function codesPanel() {
  const codes = state.data.codes || [];
  const devices = state.data.devices || [];
  return `
    <section class="dsh-card">
      <div class="dsh-card__head"><h2 class="dsh-card__title">New code</h2></div>
      <form class="dsh-form" data-code-form>
        <div class="dsh-field">
          <label for="c-code">Six-digit code</label>
          <div class="dsh-inline">
            <input class="dsh-input dsh-code" id="c-code" name="code" inputmode="numeric" maxlength="6" pattern="[0-9]{6}" placeholder="••••••" autocomplete="off" />
            <button class="dsh-btn dsh-btn--sm" type="button" data-code-gen>Generate</button>
          </div>
        </div>
        <div class="dsh-field">
          <label for="c-months">Duration</label>
          <select class="dsh-select" id="c-months" name="months">
            <option value="1">1 month</option>
            <option value="3">3 months</option>
            <option value="6">6 months</option>
            <option value="12">12 months</option>
          </select>
        </div>
        <div class="dsh-field">
          <label for="c-age">Age rating</label>
          <select class="dsh-select" id="c-age" name="age">
            <option value="none">No rating</option>
            <option value="13">13+</option>
            <option value="16">16+</option>
            <option value="18">18+</option>
          </select>
        </div>
        <div class="dsh-field">
          <label for="c-device">Device</label>
          <select class="dsh-select" id="c-device" name="device">
            <option value="">No device (binds on first use)</option>
            ${devices
              .map((d) => `<option value="${esc(d.device_id)}">${esc(deviceName(d))} · ${esc(d.device_id)}</option>`)
              .join("")}
            <option value="__new">Another MAC address…</option>
          </select>
        </div>
        <div class="dsh-field" data-new-mac hidden>
          <label for="c-mac">MAC address</label>
          <input class="dsh-input dsh-mono" id="c-mac" name="mac" placeholder="AA:BB:CC:DD:EE:FF" autocomplete="off" />
        </div>
        <div class="dsh-field">
          <label for="c-name">Device name</label>
          <input class="dsh-input" id="c-name" name="deviceName" placeholder="Living room TV" autocomplete="off" />
        </div>
        <div class="dsh-field">
          <button class="dsh-btn dsh-btn--primary" type="submit"><i data-icon="plus"></i>Create code</button>
        </div>
      </form>
      <p class="dsh-help" style="margin-top:.6rem">
        One code belongs to one device. A code without a device binds to the last device that used it.
      </p>
    </section>

    <section class="dsh-card">
      <div class="dsh-card__head">
        <h2 class="dsh-card__title">Your codes</h2>
        <span class="dsh-chip">${codes.length}</span>
      </div>
      ${
        codes.length
          ? `<div class="dsh-table-wrap"><table class="dsh-table">
              <thead><tr><th>Code</th><th>Duration</th><th>Age</th><th>Device</th><th>Expires</th><th>Status</th><th></th></tr></thead>
              <tbody>${codes
                .map(
                  (c) => `<tr>
                    <td><span class="dsh-code">${esc(c.code)}</span></td>
                    <td>${esc(c.months)} ${c.months === 1 ? "month" : "months"}</td>
                    <td>${esc(ageLabel(c.age))}</td>
                    <td>${c.device_mac ? `<span class="dsh-mono">${esc(c.device_mac)}</span>${c.device_name ? `<br><span class="dsh-help">${esc(c.device_name)}</span>` : ""}` : '<span class="dsh-chip" data-tone="off">Free</span>'}</td>
                    <td>${esc(formatDate(c.expires_at))}</td>
                    <td><span class="dsh-chip" data-tone="${c.status === "active" ? "on" : "off"}">${esc(c.status)}</span></td>
                    <td><div class="dsh-table__actions">
                      <button class="dsh-btn dsh-btn--sm" type="button" data-copy="${esc(c.code)}" title="Copy"><i data-icon="file"></i>Copy</button>
                      <button class="dsh-btn dsh-btn--sm" type="button" data-download="${esc(c.id)}" title="Download"><i data-icon="download"></i></button>
                      <button class="dsh-btn dsh-btn--sm" type="button" data-share="${esc(c.id)}" title="Share"><i data-icon="share"></i></button>
                      <button class="dsh-btn dsh-btn--sm" type="button" data-code-action="${esc(c.id)}" data-action="unlink" title="Unlink device"><i data-icon="unlock"></i></button>
                      <button class="dsh-btn dsh-btn--sm dsh-btn--danger" type="button" data-code-action="${esc(c.id)}" data-action="delete" title="Delete code"><i data-icon="trash"></i></button>
                    </div></td>
                  </tr>`
                )
                .join("")}</tbody>
            </table></div>`
          : empty("lock", "No codes yet", "Generate a code or type your own six digits, choose a duration and an age rating, then bind it to a device.", "", "")
      }
    </section>
  `;
}

function devicesPanel() {
  const devices = state.data.devices || [];
  return `
    <section class="dsh-card">
      <div class="dsh-card__head">
        <h2 class="dsh-card__title">Linked devices</h2>
        <span class="dsh-chip">${devices.length}</span>
      </div>
      ${
        devices.length
          ? `<div class="dsh-table-wrap"><table class="dsh-table">
              <thead><tr><th>Device</th><th>MAC</th><th>Code</th><th>Linked</th><th>Status</th><th></th></tr></thead>
              <tbody>${devices
                .map(
                  (d) => `<tr>
                    <td><strong>${esc(deviceName(d))}</strong></td>
                    <td class="dsh-mono">${esc(d.device_id)}</td>
                    <td class="dsh-code">${esc(d.code || "—")}</td>
                    <td>${esc(formatDate(d.first_used_at))}</td>
                    <td><span class="dsh-chip" data-tone="${d.code ? "on" : "off"}">${d.code ? "Linked" : "Unlinked"}</span></td>
                    <td><div class="dsh-table__actions">
                      <button class="dsh-btn dsh-btn--sm dsh-btn--danger" type="button" data-device-delete="${esc(d.id)}"><i data-icon="trash"></i>Remove</button>
                    </div></td>
                  </tr>`
                )
                .join("")}</tbody>
            </table></div>`
          : empty("monitor", "No device linked yet", "Devices appear here the first time a code is used, or when you bind a code to a MAC.")
      }
    </section>
  `;
}

/* ---------------------------------------------------------------- */
/* IPTV                                                              */
/* ---------------------------------------------------------------- */
function iptvView() {
  const tab = state.tabs.iptv;
  const packages = []; // packages live in e-server; the dashboard only lists them
  return `
    <div class="dsh-note"><i data-icon="info"></i><span>
      Playlists are published by administrators and moderators. Members add their own packages from
      <b>e-server</b>; the dashboard only shows what is already shared with this account.
    </span></div>
    <div class="dsh-tabs" role="tablist">
      <button class="dsh-tab ${tab === "m3u" ? "is-on" : ""}" type="button" data-tab="iptv" data-tab-value="m3u">M3U</button>
      <button class="dsh-tab ${tab === "xtream" ? "is-on" : ""}" type="button" data-tab="iptv" data-tab-value="xtream">Xtream</button>
    </div>
    ${
      packages.length
        ? ""
        : empty(
            "broadcast",
            tab === "m3u" ? "No M3U package yet" : "No Xtream package yet",
            tab === "m3u"
              ? "An M3U package brings a name, a playlist URL, an EPG URL, a free or premium plan, a status, a downloadable file and its channels."
              : "An Xtream package brings a server URL, username, password, playlist and EPG URLs, a free or premium plan and its channels."
          )
    }
  `;
}

/* ---------------------------------------------------------------- */
/* favorites / later / completed                                     */
/* ---------------------------------------------------------------- */
function listView(kind) {
  const payloadKey = kind === "favorites" ? "favorite" : kind === "later" ? "later" : "complete";
  const all = ((state.data.lists || {})[payloadKey] || []);
  const tab = state.tabs.lists;
  const type = LIST_TYPES.find((t) => t.key === tab) || LIST_TYPES[0];
  const items = all.filter((row) => String(row.media_type || "").toLowerCase() === type.media);

  return `
    <div class="dsh-tabs" role="tablist">
      ${LIST_TYPES.map(
        (t) =>
          `<button class="dsh-tab ${tab === t.key ? "is-on" : ""}" type="button" data-tab="lists" data-tab-value="${t.key}">${t.label}</button>`
      ).join("")}
    </div>
    ${
      items.length
        ? `<div class="dsh-tiles">${items
            .map(
              (row) => `<article class="dsh-tile" data-list-row="${esc(row.id)}">
                <div class="dsh-tile__art ${artClass(type.media)}">
                  ${
                    row.poster
                      ? `<img src="${esc(row.poster)}" alt="" loading="lazy" />`
                      : `<img src="${esc(tilePlaceholder(type.label, Number(row.tmdb_id) || row.id))}" alt="" loading="lazy" />`
                  }
                </div>
                <h3 class="dsh-tile__title">${esc(row.title || `${type.label.replace(/s$/, "")} #${row.tmdb_id || ""}`)}</h3>
                <p class="dsh-tile__meta">${esc(formatDate(row.created_at))}</p>
                <div class="dsh-tile__actions">
                  <a class="dsh-btn dsh-btn--sm" href="${esc(row.link || openLink(type.media, row.tmdb_id))}"><i data-icon="play"></i>Open</a>
                  <button class="dsh-btn dsh-btn--sm" type="button" data-share-row="${esc(row.id)}"><i data-icon="share"></i></button>
                  <button class="dsh-btn dsh-btn--sm dsh-btn--danger" type="button" data-list-remove="${esc(row.id)}"><i data-icon="trash"></i></button>
                </div>
              </article>`
            )
            .join("")}</div>`
        : empty(
            "bookmark",
            `No ${type.label.toLowerCase()} here yet`,
            kind === "complete"
              ? "Titles you finish show up here with their poster and title."
              : `Save ${type.label.toLowerCase()} while you browse and they will appear in this tab.`
          )
    }
  `;
}

/* ---------------------------------------------------------------- */
/* reports                                                           */
/* ---------------------------------------------------------------- */
function reportsView() {
  const rows = state.data.reports || [];
  return `
    ${
      rows.length
        ? `<div class="dsh-table-wrap"><table class="dsh-table">
            <thead><tr><th>Report</th><th>Target</th><th>Filed by</th><th>Reason</th><th>Decision</th><th>Created</th><th>Updated</th></tr></thead>
            <tbody>${rows
              .map(
                (r) => `<tr>
                  <td class="dsh-mono">${esc(String(r.id).slice(0, 8))}</td>
                  <td>${r.tmdb_id ? `TMDB #${esc(r.tmdb_id)}` : esc(String(r.link_id || "—").slice(0, 8))}</td>
                  <td>${r.mine ? "<strong>You</strong>" : "Another member"}</td>
                  <td>${esc(r.reason || "—")}${r.details ? `<br><span class="dsh-help">${esc(r.details)}</span>` : ""}</td>
                  <td><span class="dsh-chip" data-tone="${r.status === "valid" ? "on" : "off"}">${esc(statusLabel(r.status))}</span></td>
                  <td>${esc(formatDate(r.created_at))}</td>
                  <td>—</td>
                </tr>`
              )
              .join("")}</tbody>
          </table></div>`
        : empty(
            "flag",
            "No reports",
            "Reports you file — and reports other members file against your content — are listed here with their decision."
          )
    }
  `;
}

/* ---------------------------------------------------------------- */
/* court                                                             */
/* ---------------------------------------------------------------- */
function courtView() {
  const court = state.data.court || {};
  const active = court.active;
  const history = court.history || [];
  const member = state.data.member || {};

  return `
    ${
      active
        ? `<section class="dsh-card">
            <div class="dsh-card__head">
              <h2 class="dsh-card__title">Case ${esc(active.case_code)}</h2>
              <span class="dsh-chip" data-tone="${active.status === "scheduled" ? "on" : "off"}">${esc(cap(active.status))}</span>
            </div>
            <dl class="dsh-kv">
              <div><dt>Reason</dt><dd>${esc(active.reason || "—")}</dd></div>
              <div><dt>Your role</dt><dd>Defendant (content owner)</dd></div>
              <div><dt>Judge</dt><dd>A platform moderator</dd></div>
              <div><dt>Hearing</dt><dd>${esc(active.scheduled_at ? fullDate(active.scheduled_at) : "Date to be set")}</dd></div>
              <div><dt>Decision</dt><dd>${esc(active.decision ? cap(active.decision) : "Pending")}</dd></div>
            </dl>
            ${
              active.status === "scheduled"
                ? `<p class="dsh-gate__warn"><i data-icon="info"></i><span>Missing the hearing makes the ban permanent.</span></p>`
                : ""
            }
            <div class="dsh-hero__actions" style="margin-top:.8rem">
              ${
                active.status === "scheduled"
                  ? `<a class="dsh-btn dsh-btn--primary" href="court.html?id=${encodeURIComponent(active.id)}"><i data-icon="gavel"></i>Enter court</a>`
                  : `<button class="dsh-btn" type="button" data-court-refresh><i data-icon="refresh"></i>Refresh status</button>`
              }
            </div>
          </section>`
        : `<section class="dsh-card">
            <div class="dsh-card__head"><h2 class="dsh-card__title">No open case</h2></div>
            <p class="dsh-card__hint">${
              member.status === "banned"
                ? "You can request a trial from the ban notice."
                : "Cases appear here when you are a party: judge, defendant (content owner) or plaintiff (reporter)."
            }</p>
          </section>`
    }

    <section class="dsh-card">
      <div class="dsh-card__head"><h2 class="dsh-card__title">Verdict history</h2></div>
      ${
        history.length
          ? `<div class="dsh-table-wrap"><table class="dsh-table">
              <thead><tr><th>Case</th><th>Reason</th><th>Decision</th><th>Note</th><th>Decided</th></tr></thead>
              <tbody>${history
                .map(
                  (c) => `<tr><td class="dsh-mono">${esc(c.case_code)}</td><td>${esc(c.reason || "—")}</td>
                    <td><span class="dsh-chip" data-tone="${c.decision === "unban" ? "on" : "off"}">${esc(c.decision ? cap(c.decision) : "Open")}</span></td>
                    <td>${esc(c.decision_note || "—")}</td><td>${esc(c.decided_at ? formatDate(c.decided_at) : "—")}</td></tr>`
                )
                .join("")}</tbody>
            </table></div>`
          : empty("scale", "No verdicts yet", "Every case you take part in is archived here with the decision and the court note.")
      }
    </section>
  `;
}

/* ---------------------------------------------------------------- */
/* points                                                            */
/* ---------------------------------------------------------------- */
function pointsView() {
  const o = state.data.overview || {};
  const ledger = state.data.points_ledger || [];
  const earned = ledger.filter((l) => l.delta > 0);
  const spent = ledger.filter((l) => l.delta < 0);
  const bySource = {};
  earned.forEach((l) => {
    bySource[l.source || "other"] = (bySource[l.source || "other"] || 0) + l.delta;
  });

  return `
    <div class="dsh-grid">
      ${stat("zap", "Available", num(o.points_available || 0), usd(o.points_available))}
      ${stat("minus", "Spent", num(o.points_spent || 0), usd(o.points_spent))}
      ${stat("sparkle", "Total earned", num(o.points_total || 0), usd(o.points_total))}
    </div>

    <section class="dsh-card">
      <div class="dsh-card__head"><h2 class="dsh-card__title">Add points</h2></div>
      <div class="dsh-grid dsh-grid--2">
        <div>
          <p class="dsh-card__hint">Buy points from the membership page, or redeem a serial key from a reseller.</p>
          <a class="dsh-btn dsh-btn--primary" href="index.html#membership" style="margin-top:.5rem"><i data-icon="cart"></i>Buy points on Patreon</a>
        </div>
        <form class="dsh-form" data-serial-form>
          <div class="dsh-field dsh-field--wide">
            <label for="serial">Serial key</label>
            <div class="dsh-inline">
              <input class="dsh-input" id="serial" name="serial" placeholder="XXXX-XXXX-XXXX" autocomplete="off" />
              <button class="dsh-btn" type="submit"><i data-icon="check"></i>Redeem</button>
            </div>
          </div>
        </form>
      </div>
      <p class="dsh-help" style="margin-top:.5rem">Serials are checked against the point key table on the server, one redemption per key.</p>
    </section>

    <section class="dsh-card">
      <div class="dsh-card__head"><h2 class="dsh-card__title">How you earn</h2></div>
      ${
        Object.keys(bySource).length
          ? `<div class="dsh-grid">${Object.entries(bySource)
              .map(([source, value]) => stat("zap", cap(source), `+${num(value)}`, usd(value)))
              .join("")}</div>`
          : `<p class="dsh-card__hint">Watch minutes, reviews, answers and referrals add to this breakdown once you start earning.</p>`
      }
    </section>

    <section class="dsh-card">
      <div class="dsh-card__head">
        <h2 class="dsh-card__title">Ledger</h2>
        <span class="dsh-chip">${earned.length} earned · ${spent.length} spent</span>
      </div>
      ${
        ledger.length
          ? `<div class="dsh-table-wrap"><table class="dsh-table">
              <thead><tr><th>Change</th><th>Reason</th><th>Source</th><th>Balance</th><th>When</th></tr></thead>
              <tbody>${ledger
                .slice(0, 40)
                .map(
                  (l) => `<tr><td><strong>${l.delta > 0 ? "+" : ""}${num(l.delta)}</strong></td>
                    <td>${esc(l.reason || "—")}</td><td>${esc(l.source || "—")}</td>
                    <td>${esc(num(l.balance_after))}</td><td>${esc(formatDate(l.created_at, { hour: "2-digit", minute: "2-digit" }))}</td></tr>`
                )
                .join("")}</tbody>
            </table></div>`
          : empty("zap", "No point movement yet", "Every earn and spend is written here with its balance after the change.")
      }
    </section>
  `;
}

/* ---------------------------------------------------------------- */
/* level                                                             */
/* ---------------------------------------------------------------- */
function levelView() {
  const o = state.data.overview || {};
  const info = levelInfo({
    points: o.points_total || 0,
    membership: o.membership || "free",
    /* a level bought with «Unlock now» is stored on the member */
    unlocked: (state.data.member || {}).level_unlocked ?? null,
  });
  const offer = unlockOffer(info, o.points_available || 0);
  const current = info.row;
  const next = info.next;

  const checks = [
    ["Account activated", String((state.data.member || {}).status) === "active"],
    ["Level 1 points collected", info.points >= 10],
    ["Membership active", Boolean(o.membership) && String(o.membership) !== "free"],
    ["Email confirmed", Boolean((state.data.member || {}).email)],
    ["Phone added", Boolean((state.data.member || {}).phone_number)],
    ["Profile picture", Boolean((state.data.member || {}).avatar_url)],
    ["First viewing code", (state.data.codes || []).length > 0],
  ];

  const rows = LEVELS.map((row) => {
    const mine = info.level === row.level || (info.level === "max" && row.level === "max");
    const reached = row.level === "max" ? info.level === "max" : info.level !== "max" && info.level >= row.level;
    const state_ = mine ? "Current" : reached ? "Unlocked" : "Locked";
    const canBuy = Boolean(offer) && row.level !== "max" && row.level === offer.level;
    const buyCell = canBuy
      ? `<button class="dsh-btn dsh-btn--sm dsh-unlock" type="button" data-level-unlock="${row.level}"
           ${offer.affordable ? "" : "disabled"}
           title="Pay ${num(offer.fee)} points to unlock LV${offer.level}0${offer.affordable ? "" : ` — ${num(offer.missing)} short`}">
           <i data-icon="key"></i>Unlock now</button>`
      : "";
    return `<tr>
      <td><strong>${row.level === "max" ? "LVMax" : `LV${row.level}0`}</strong></td>
      <td>${esc(row.name)}</td>
      <td>${row.level === "max" ? `${num(row.points)}+` : num(row.points)}</td>
      <td>${esc(row.membership.join(" / "))}${row.months ? ` · ${row.months} mo` : ""}</td>
      <td>${row.quotas.tasks === Infinity ? "—" : num(row.quotas.tasks)}</td>
      <td>${row.quotas.content === Infinity ? "unlimited" : `${num(row.quotas.content)} / day`}</td>
      <td>${row.quotas.server === Infinity ? "unlimited" : `${num(row.quotas.server)} / day`}</td>
      <td><span class="dsh-chip" data-tone="${mine || reached ? "on" : "off"}">${state_}</span></td>
      <td class="dsh-table__act">${buyCell}</td>
    </tr>`;
  }).join("");

  return `
    <div class="dsh-grid">
      ${stat("crown", "Current level", `${info.badge} · ${current.name}`, `${num(info.points)} points lifetime`)}
      ${
        info.capped
          ? stat("lock", "Membership cap", info.capBadge, `${esc(o.membership || "free")} membership is the ceiling`)
          : next
            ? stat("sparkle", "Next level", `LV${next.level}0 · ${next.name}`, `${num(info.toNext)} points to go`)
            : stat("sparkle", "Next level", "LVMax", "No ceiling left")
      }
    </div>

    <section class="dsh-card">
      <div class="dsh-card__head">
        <h2 class="dsh-card__title">Progress inside ${info.level === "max" ? "LVMax" : `level ${info.level}`}</h2>
        <span class="dsh-chip">${info.progressPct}%</span>
      </div>
      <div class="dsh-progress" role="progressbar" aria-valuenow="${info.progressPct}" aria-valuemin="0" aria-valuemax="100"><span style="width:${info.progressPct}%"></span></div>
      <p class="dsh-card__hint">
        ${
          info.capped
            ? `You are held at <strong>${info.capBadge}</strong> by your ${esc(o.membership || "free")} membership. The points stay in your account — a higher membership lifts the ceiling and the level is granted straight away.`
            : next
              ? `${num(info.toNext)} more points reach <strong>LV${next.level}0</strong> (${esc(next.name)}). The badge digit — the 5 in LV85 — is the tens of percent already earned towards it.`
              : "You are at the top of the ladder."
        }
      </p>
      <p class="dsh-card__hint">${esc(current.summary)}</p>
      <ul class="dsh-list">
        ${current.rights.map((right) => `<li><i data-icon="check"></i> ${esc(right)}</li>`).join("")}
      </ul>
    </section>

    <section class="dsh-card">
      <div class="dsh-card__head">
        <h2 class="dsh-card__title">The ladder</h2>
        <span class="dsh-chip">points decide the level · membership decides the ceiling</span>
      </div>
      <div class="dsh-table-wrap"><table class="dsh-table">
        <thead><tr><th>Badge</th><th>Name</th><th>Points</th><th>Membership</th><th>Tasks</th><th>Publish</th><th>Servers</th><th>Status</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
      <p class="dsh-card__hint">Every level needs the points below it and one more task than the level before. Card: Free LV30 · Silver LV50 · Gold LV80 · Diamond open above LV80.</p>
      ${
        offer
          ? `<p class="dsh-card__hint">Next rung: <strong>LV${offer.level}0</strong> for <strong>${num(offer.fee)} points</strong> taken from your balance (${num(offer.balance)} available). ${offer.affordable ? "Unlock now is open." : `Top up ${num(offer.missing)} points and Unlock now opens.`}</p>`
          : ""
      }
    </section>

    <section class="dsh-card">
      <div class="dsh-card__head"><h2 class="dsh-card__title">Criteria</h2></div>
      <div class="dsh-grid">
        ${checks
          .map(
            ([label, done]) => `<div class="dsh-switch">
              <span class="dsh-switch__text"><strong>${esc(label)}</strong></span>
              <span class="dsh-chip" data-tone="${done ? "on" : "off"}">${done ? "Done" : "Pending"}</span>
            </div>`
          )
          .join("")}
      </div>
    </section>
  `;
}

/* ---------------------------------------------------------------- */
/* payments                                                          */
/* ---------------------------------------------------------------- */
function paymentsView() {
  const o = state.data.overview || {};
  const available = Number(o.points_available || 0);
  return `
    <div class="dsh-wallet">
      <div><span>Points</span><strong>${num(available)}</strong></div>
      <div><span>Rate</span><strong>100 pts = $1</strong></div>
      <div><span>Value</span><strong>${usd(available)}</strong></div>
      <div><span>Minimum transfer</span><strong>$10</strong></div>
    </div>

    <section class="dsh-card">
      <div class="dsh-card__head"><h2 class="dsh-card__title">Request a transfer</h2></div>
      <div class="dsh-grid dsh-grid--2">
        <form class="dsh-form" data-payout-form>
          <div class="dsh-field">
            <label for="p-amount">Points to convert</label>
            <input class="dsh-input" id="p-amount" name="amount" type="number" min="0" step="100" value="${Math.min(available, 1000)}" />
          </div>
          <div class="dsh-field">
            <label>You receive</label>
            <output class="dsh-input dsh-code" data-payout-out>${usd(Math.min(available, 1000))}</output>
          </div>
          <div class="dsh-field">
            <label for="p-method">Payout method</label>
            <select class="dsh-select" id="p-method" name="method">
              <option value="bank">Bank transfer</option>
              <option value="paypal">PayPal</option>
              <option value="mastercard">MasterCard</option>
              <option value="visa">Visa</option>
            </select>
          </div>
          <div class="dsh-field">
            <button class="dsh-btn dsh-btn--primary" type="submit"><i data-icon="bank"></i>Submit request</button>
          </div>
        </form>
        <div>
          <p class="dsh-card__hint">Transfers follow a fixed chain, and every step is written to a second audit table.</p>
          <div class="dsh-tabs" style="margin-top:.5rem;flex-wrap:wrap">
            ${["Submitted", "Seen", "Reviewed", "Approved", "Sent", "Received"]
              .map((s) => `<span class="dsh-chip" data-tone="off">${s}</span>`)
              .join("")}
          </div>
          <p class="dsh-help" style="margin-top:.5rem">Rejected requests can be appealed and re-reviewed once.</p>
        </div>
      </div>
      <p class="dsh-note" style="margin-top:.7rem"><i data-icon="info"></i><span>
        Transfers open with the payment tables. The balance and the rate above are live; no transfer row is written yet.
      </span></p>
    </section>

    <section class="dsh-card">
      <div class="dsh-card__head"><h2 class="dsh-card__title">e-Bank wallet</h2></div>
      <p class="dsh-card__hint">Points moved into the wallet can be spent inside the platform without a minimum. Moving them back to a bank account follows the threshold above.</p>
      <div class="dsh-wallet" style="margin-top:.6rem">
        <div><span>Wallet</span><strong>${usd(0)}</strong></div>
        <div><span>In points</span><strong>0</strong></div>
      </div>
    </section>
  `;
}

/* ---------------------------------------------------------------- */
/* prizes                                                            */
/* ---------------------------------------------------------------- */
function prizesView() {
  const prizes = state.data.prizes || [];
  return prizes.length
    ? `<div class="dsh-tiles">${prizes
        .map(
          (p) => `<article class="dsh-tile">
            <div class="dsh-tile__art">
              <img src="${esc(p.image || tilePlaceholder("Prize", Number(String(p.prize_code).replace(/\D/g, "")) || 1))}" alt="" loading="lazy" />
            </div>
            <h3 class="dsh-tile__title">${esc(p.title)}</h3>
            <p class="dsh-tile__meta">Ends ${esc(formatDate(p.ends_at))} · ${num(p.points)} pts</p>
            <div class="dsh-tile__actions">
              <a class="dsh-btn dsh-btn--sm" href="prize.html?id=${encodeURIComponent(p.id)}"><i data-icon="gift"></i>Open</a>
            </div>
          </article>`
        )
        .join("")}</div>`
    : empty("gift", "No prize open", "Available, joined and won prizes appear here with their thumbnail and end date.");
}

/* ---------------------------------------------------------------- */
/* history                                                           */
/* ---------------------------------------------------------------- */
function historyView() {
  const rows = state.data.history || [];
  const tab = state.tabs.history;
  const filtered = tab === "all" ? rows : rows.filter((r) => guessType(r.media_type) === tab);

  return `
    <div class="dsh-tabs" role="tablist">
      ${HISTORY_TYPES.map(
        (t) => `<button class="dsh-tab ${tab === t.key ? "is-on" : ""}" type="button" data-tab="history" data-tab-value="${t.key}">${t.label}</button>`
      ).join("")}
    </div>
    <div class="dsh-tabs" role="group" aria-label="Filter by date">
      ${[
        ["today", "Today"],
        ["week", "This week"],
        ["month", "This month"],
        ["year", "This year"],
        ["all", "All time"],
      ]
        .map(
          ([key, label]) =>
            `<button class="dsh-tab ${state.notifWindow === key ? "is-on" : ""}" type="button" data-window="${key}">${label}</button>`
        )
        .join("")}
    </div>
    ${
      filtered.length
        ? `<div class="dsh-table-wrap"><table class="dsh-table">
            <thead><tr><th>Title</th><th>Type</th><th>Watched</th><th>Minutes</th><th></th></tr></thead>
            <tbody>${filtered
              .map(
                (h) => `<tr>
                  <td><strong data-hist-title="${esc(h.tmdb_id)}">${esc(guessType(h.media_type) === "channels" ? "Channel" : "Title")} #${esc(h.tmdb_id || "—")}</strong>
                    ${h.season ? `<span class="dsh-help">S${esc(h.season)}${h.episode ? ` · E${esc(h.episode)}` : ""}</span>` : ""}</td>
                  <td><span class="dsh-chip">${esc(cap(guessType(h.media_type)))}</span></td>
                  <td>${esc(formatDate(h.watched_at, { hour: "2-digit", minute: "2-digit" }))}</td>
                  <td>${esc(num(h.minutes))}</td>
                  <td><div class="dsh-table__actions"><a class="dsh-btn dsh-btn--sm" href="${esc(openLink(h.media_type, h.tmdb_id))}"><i data-icon="play"></i>Open</a></div></td>
                </tr>`
              )
              .join("")}</tbody>
          </table></div>`
        : empty("clock", "Nothing watched yet in this filter", "Playback writes to your history with the exact date, time and minutes watched.")
    }
  `;
}

/* ---------------------------------------------------------------- */
/* staged sections                                                   */
/* ---------------------------------------------------------------- */
function analyticsView() {
  return `
    <div class="dsh-grid">
      ${stat("users", "Viewers", "—", "Unique people who opened your content")}
      ${stat("globe", "Countries", "—", "Where they watched from")}
      ${stat("clock", "Watch minutes", "—", "Verified playback")}
      ${stat("eye", "Impressions", "—", "Times your content was shown")}
      ${stat("target", "Clicks", "—", "Opens from a listing")}
      ${stat("cart", "Sales", "—", "Store and auction orders")}
    </div>
    <div class="dsh-note"><i data-icon="info"></i><span>
      Analytics reads from the visitor and playback tables for the content you own. The section is staged:
      the metric layout, the per-section tabs (movies, series, channels, videos, podcasts, images, articles,
      answers, documents, store, auction) and the time filters are ready, the aggregation lands in the next build step.
    </span></div>
    <section class="dsh-card">
      <div class="dsh-card__head"><h2 class="dsh-card__title">Audience</h2></div>
      <dl class="dsh-kv">
        <div><dt>Country</dt><dd>—</dd></div>
        <div><dt>Language</dt><dd>—</dd></div>
        <div><dt>Age</dt><dd>—</dd></div>
        <div><dt>Visits</dt><dd>—</dd></div>
        <div><dt>Bank</dt><dd>${usd(0)}</dd></div>
      </dl>
    </section>
  `;
}

function surfacesView(kind) {
  const rows =
    kind === "creator"
      ? [
          ["e-Studio", "Films, series and videos"],
          ["e-Server", "IPTV playlists and channels"],
          ["e-Blog", "Articles and long reads"],
          ["e-Gallery", "Images and collections"],
          ["e-Space", "Community posts"],
          ["e-Library", "Documents and books"],
          ["e-Cinema", "Curated screenings"],
        ]
      : [
          ["e-Store", "Products and orders"],
          ["e-Auction", "Standard lots"],
          ["Super auction", "Featured lots"],
          ["Hyper auction", "Premium lots"],
          ["e-Bank", "Wallet and payouts"],
          ["Community", "Followers and members"],
        ];

  return `
    <div class="dsh-note"><i data-icon="info"></i><span>
      Every ${kind} page is managed here: name, description, logo, cover, category and niche.
      Publishing opens the public page at <b>${kind}.html?${kind}=ID</b>.
    </span></div>
    <section class="dsh-card">
      <div class="dsh-card__head"><h2 class="dsh-card__title">Your ${kind} pages</h2><span class="dsh-chip">${rows.length} types</span></div>
      <div class="dsh-table-wrap"><table class="dsh-table">
        <thead><tr><th>Surface</th><th>For</th><th>Status</th><th></th></tr></thead>
        <tbody>${rows
          .map(
            ([name, use]) => `<tr>
              <td><strong>${esc(name)}</strong></td><td>${esc(use)}</td>
              <td><span class="dsh-chip" data-tone="off">Not created</span></td>
              <td><div class="dsh-table__actions"><button class="dsh-btn dsh-btn--sm" type="button" data-surface="${esc(name)}"><i data-icon="plus"></i>Create</button></div></td>
            </tr>`
          )
          .join("")}</tbody>
      </table></div>
    </section>
  `;
}

function advertiserView() {
  return `
    <div class="dsh-note"><i data-icon="info"></i><span>
      A campaign carries a name, a point budget, the placement pages (every e-* surface), an audience,
      a country, a language, a duration and a launch/pause switch. Results are read back from the same
      tables as Analytics.
    </span></div>
    <div class="dsh-grid">
      ${stat("target", "Active campaigns", "0", "Nothing running")}
      ${stat("zap", "Budget in use", "0 pts", usd(0))}
      ${stat("eye", "Impressions", "0", "All campaigns")}
      ${stat("cart", "Conversions", "0", "Clicks that led to an order")}
    </div>
    ${empty("target", "No campaign yet", "Campaigns are created from this section once the advertising tables are live.", "", "")}
  `;
}

/* ---------------------------------------------------------------- */
/* settings                                                          */
/* ---------------------------------------------------------------- */
const SKINS = ["Facebook", "Instagram", "YouTube", "TikTok", "WhatsApp", "Telegram", "iOS", "Android", "macOS", "Windows 10", "Windows 8", "Windows 7"];
const PLATFORMS = ["YouTube", "Vimeo", "Dailymotion", "Facebook", "Instagram", "TikTok", "Twitch", "Spotify", "SoundCloud", "Podbean", "Medium", "Substack", "WordPress", "Vidshared"];

function settingsSiteView() {
  let theme = "dark";
  let lang = "en";
  try {
    theme = JSON.parse(localStorage.getItem("1w.theme") || '"dark"');
    lang = JSON.parse(localStorage.getItem("1w.lang") || '"en"');
  } catch {
    /* storage blocked */
  }
  const country = state.data.member.country || "";

  return `
    <section class="dsh-card">
      <div class="dsh-card__head"><h2 class="dsh-card__title">Language, country and skin</h2></div>
      <form class="dsh-form" data-site-form>
        <div class="dsh-field">
          <label for="s-lang">Language</label>
          <select class="dsh-select" id="s-lang" name="lang">
            ${["en:English", "ar:العربية", "fr:Français", "es:Español", "de:Deutsch", "pt:Português", "tr:Türkçe"]
              .map((pair) => {
                const [code, label] = pair.split(":");
                return `<option value="${code}" ${lang === code ? "selected" : ""}>${label}</option>`;
              })
              .join("")}
          </select>
        </div>
        <div class="dsh-field">
          <label for="s-country">Country</label>
          <input class="dsh-input" id="s-country" name="country" value="${esc(country)}" placeholder="Auto-detected" />
        </div>
        <div class="dsh-field">
          <label for="s-theme">Theme</label>
          <select class="dsh-select" id="s-theme" name="theme">
            <option value="system" ${theme === "system" ? "selected" : ""}>Follow the system</option>
            <option value="dark" ${theme === "dark" ? "selected" : ""}>Dark</option>
            <option value="light" ${theme === "light" ? "selected" : ""}>Light</option>
          </select>
        </div>
        <div class="dsh-field"><button class="dsh-btn dsh-btn--primary" type="submit"><i data-icon="check"></i>Save</button></div>
      </form>
      <p class="dsh-help" style="margin-top:.5rem">Country fills itself from the visitor lookup; you can override it here.</p>
    </section>

    <section class="dsh-card">
      <div class="dsh-card__head"><h2 class="dsh-card__title">Skins</h2><span class="dsh-chip">${SKINS.length}</span></div>
      <div class="dsh-tabs" style="flex-wrap:wrap">
        ${SKINS.map((s) => `<button class="dsh-tab" type="button" data-skin="${esc(s)}">${esc(s)}</button>`).join("")}
      </div>
      <p class="dsh-help" style="margin-top:.5rem">A skin changes the shape of components, not your data. The current build ships one skin per family.</p>
    </section>
  `;
}

function settingsProfileView() {
  const member = state.data.member || {};
  return `
    <section class="dsh-card">
      <div class="dsh-card__head"><h2 class="dsh-card__title">Public profile</h2></div>
      <form class="dsh-form" data-profile-form>
        <div class="dsh-field dsh-field--wide">
          <label for="pf-name">Display name</label>
          <input class="dsh-input" id="pf-name" name="full_name" value="${esc(member.full_name || "")}" />
        </div>
        <div class="dsh-field dsh-field--wide">
          <label for="pf-bio">Bio</label>
          <input class="dsh-input" id="pf-bio" name="bio" placeholder="One line about you" />
        </div>
        <div class="dsh-field">
          <label for="pf-avatar">Avatar URL</label>
          <input class="dsh-input" id="pf-avatar" name="avatar_url" value="${esc(member.avatar_url || "")}" placeholder="source/users/avatar.jpg" />
        </div>
        <div class="dsh-field">
          <label for="pf-cover">Cover URL</label>
          <input class="dsh-input" id="pf-cover" name="cover_url" value="${esc(member.cover_url || "")}" />
        </div>
        <div class="dsh-field">
          <label for="pf-visible">Profile visibility</label>
          <select class="dsh-select" id="pf-visible" name="visibility">
            <option value="public">Public</option>
            <option value="hidden">Hidden</option>
          </select>
        </div>
        <div class="dsh-field">
          <label for="pf-follow">Who can follow</label>
          <select class="dsh-select" id="pf-follow" name="follow">
            <option value="open">Anyone</option>
            <option value="approve">Ask me first</option>
          </select>
        </div>
        <div class="dsh-field"><button class="dsh-btn dsh-btn--primary" type="submit"><i data-icon="check"></i>Save profile</button></div>
      </form>
      <p class="dsh-note" style="margin-top:.7rem"><i data-icon="info"></i><span>
        Profile writes land with the profile service; until then this form is a preview of the fields and saves nothing.
      </span></p>
    </section>
  `;
}

function settingsAccountView() {
  const member = state.data.member || {};
  return `
    <section class="dsh-card">
      <div class="dsh-card__head"><h2 class="dsh-card__title">Identity</h2></div>
      <dl class="dsh-kv">
        <div><dt>Member ID</dt><dd>${esc(member.member_id || "—")}</dd></div>
        <div><dt>Username</dt><dd>${esc(member.username || "—")} <span class="dsh-chip" data-tone="off">locked</span></dd></div>
        <div><dt>Email</dt><dd>${esc(member.email || "—")}</dd></div>
        <div><dt>Phone</dt><dd>${esc(member.phone_number || "—")}</dd></div>
        <div><dt>Status</dt><dd>${esc(cap(member.status || ""))}</dd></div>
        <div><dt>Membership</dt><dd>${esc(cap(member.membership || "free"))}</dd></div>
      </dl>
    </section>
    <section class="dsh-card">
      <div class="dsh-card__head"><h2 class="dsh-card__title">Security</h2></div>
      <div class="dsh-grid dsh-grid--2">
        <div class="dsh-switch"><span class="dsh-switch__text"><strong>Change password</strong><span>Needs the current password and a new one.</span></span><span class="dsh-chip" data-tone="off">Staged</span></div>
        <div class="dsh-switch"><span class="dsh-switch__text"><strong>Change email</strong><span>Confirmed from both addresses.</span></span><span class="dsh-chip" data-tone="off">Staged</span></div>
        <div class="dsh-switch"><span class="dsh-switch__text"><strong>Recovery code</strong><span>One-time code issued at sign-up.</span></span><span class="dsh-chip" data-tone="off">Hashed</span></div>
        <div class="dsh-switch"><span class="dsh-switch__text"><strong>Upgrade membership</strong><span>Premium, family and creator plans.</span></span><a class="dsh-btn dsh-btn--sm" href="index.html#membership">Upgrade</a></div>
      </div>
    </section>
  `;
}

function settingsPlatformsView() {
  return `
    <div class="dsh-note"><i data-icon="shield"></i><span>
      API codes are stored on the server and never returned to the browser. A green dot means connected,
      grey means never connected, red means the last call failed.
    </span></div>
    <section class="dsh-card">
      <div class="dsh-card__head"><h2 class="dsh-card__title">Publishing platforms</h2><span class="dsh-chip">${PLATFORMS.length}</span></div>
      <div class="dsh-grid dsh-grid--2">
        ${PLATFORMS.map(
          (p) => `<div class="dsh-switch">
            <span class="dsh-switch__text"><strong><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--faint);margin-right:.4rem"></span>${esc(p)}</strong><span>Not connected</span></span>
            <button class="dsh-btn dsh-btn--sm" type="button" data-platform="${esc(p)}"><i data-icon="link"></i>Connect</button>
          </div>`
        ).join("")}
      </div>
    </section>
  `;
}

/* ================================================================== */
/* wiring                                                              */
/* ================================================================== */
const SIDE_KEY = "1w.dsh.side";

/* the menu folds into an icon rail; the header keeps its geometry either way */
function setSideCollapsed(collapsed) {
  const dsh = qs("[data-dsh]");
  if (!dsh) return;
  dsh.dataset.side = collapsed ? "collapsed" : "open";
  qsa("[data-side-toggle]").forEach((btn) => {
    btn.setAttribute("aria-expanded", collapsed ? "false" : "true");
  });
  try {
    localStorage.setItem(SIDE_KEY, collapsed ? "collapsed" : "open");
  } catch {
    /* storage may be blocked — the state still applies for this page */
  }
}

function paintSideState() {
  let saved = "";
  try {
    saved = localStorage.getItem(SIDE_KEY) || "";
  } catch {
    saved = "";
  }
  setSideCollapsed(saved === "collapsed");
}

/* ---------------------------------------------------------------- */
/* unlock now — pay the level's own points from the balance          */
/* ---------------------------------------------------------------- */
function openUnlock(level) {
  closeUnlock();
  const o = state.data.overview || {};
  const row = levelRow(level);
  const fee = unlockFee(level);
  const available = Number(o.points_available || 0);

  const wrap = document.createElement("div");
  wrap.className = "dsh-modal";
  wrap.setAttribute("data-level-modal", "");
  wrap.innerHTML = `
    <div class="dsh-modal__card" role="dialog" aria-modal="true" aria-labelledby="dsh-unlock-title">
      <div class="dsh-modal__head">
        <h2 class="dsh-modal__title" id="dsh-unlock-title">Unlock LV${level}0</h2>
        <button class="dsh-icon-btn" type="button" data-level-cancel aria-label="Close"><i data-icon="close"></i></button>
      </div>
      <p class="dsh-modal__text">
        Advancing to <strong>LV${level}0 · ${esc(row.name)}</strong> asks for
        <strong>${num(fee)} points</strong>. Your balance holds <strong>${num(available)}</strong> points${
          available >= fee ? "" : ` — <strong>${num(fee - available)}</strong> short`
        }.
      </p>
      <p class="dsh-modal__hint">
        The points are paid from your balance; your lifetime total keeps them, so the level stays yours.
      </p>
      <div class="dsh-modal__actions">
        <button class="dsh-btn dsh-btn--ghost" type="button" data-level-cancel>Not now</button>
        ${
          available >= fee
            ? `<button class="dsh-btn" type="button" data-level-pay="${level}"><i data-icon="key"></i>Pay ${num(fee)} points</button>`
            : `<a class="dsh-btn" href="index.html#membership"><i data-icon="zap"></i>Buy ${num(fee - available)} points</a>`
        }
      </div>
    </div>`;

  /* the dialog lives on <body> and handles its own clicks */
  wrap.addEventListener("click", (event) => {
    if (event.target.closest("[data-level-cancel]")) {
      event.preventDefault();
      closeUnlock();
      return;
    }
    const pay = event.target.closest("[data-level-pay]");
    if (pay) {
      event.preventDefault();
      payUnlock(Number(pay.dataset.levelPay), pay);
      return;
    }
    if (event.target === wrap) closeUnlock();
  });

  document.body.append(wrap);
  document.body.classList.add("dsh-modal-open");
  hydrateIcons(wrap);
  qs("[data-level-pay]", wrap)?.focus?.();
}

function closeUnlock() {
  const wrap = qs("[data-level-modal]");
  if (!wrap) return false;
  wrap.remove();
  document.body.classList.remove("dsh-modal-open");
  return true;
}

async function payUnlock(level, button) {
  const fee = unlockFee(level);
  if (button) button.disabled = true;
  try {
    const res = await rpc("level_unlock", { p_token: token, p_level: level });
    if (!res || res.ok !== true) {
      const reason = res?.error || "unknown";
      const text =
        reason === "points"
          ? `You need ${num(res.fee)} points and hold ${num(res.balance)}.`
          : reason === "cap"
            ? `Your ${res.membership || "current"} membership stops at LV${Number(res.cap) * 10}.`
            : reason === "already"
              ? "That level is already yours."
              : reason === "step"
                ? "Levels are unlocked one rung at a time."
                : "The level could not be unlocked.";
      toast({ tone: "error", title: "Unlock now", message: text });
      if (button) button.disabled = false;
      return;
    }
    closeUnlock();
    toast({
      tone: "level",
      title: `Level up — you are now LV${level}0`,
      message: `${num(fee)} points paid — ${num(res.balance)} left in your balance.`,
    });
    await reload();
  } catch (error) {
    if (button) button.disabled = false;
    toast({ tone: "error", title: "Unlock now", message: error.message });
  }
}

function onClick(event) {
  const dsh = qs("[data-dsh]");

  const goto = event.target.closest("[data-goto]");
  if (goto && dsh.contains(goto)) {
    event.preventDefault();
    closePopover();
    if (goto.hasAttribute("data-pop-settings")) state.tabs.notif = "settings";
    setView(goto.dataset.goto);
    return;
  }

  if (event.target.closest("[data-bell]")) {
    event.preventDefault();
    togglePopover();
    return;
  }

  const popFilter = event.target.closest("[data-pop-filter]");
  if (popFilter) {
    state.popFilter = popFilter.dataset.popFilter;
    paintPopover();
    return;
  }

  if (event.target.closest("[data-logout]")) {
    event.preventDefault();
    logout();
    return;
  }

  if (event.target.closest("[data-level-modal]")) return;

  const unlock = event.target.closest("[data-level-unlock]");
  if (unlock) {
    event.preventDefault();
    openUnlock(Number(unlock.dataset.levelUnlock));
    return;
  }

  const pay = event.target.closest("[data-level-pay]");
  if (pay) {
    event.preventDefault();
    payUnlock(Number(pay.dataset.levelPay), pay);
    return;
  }

  if (event.target.closest("[data-level-cancel]")) {
    event.preventDefault();
    closeUnlock();
    return;
  }

  if (event.target.matches("[data-level-modal]")) {
    event.preventDefault();
    closeUnlock();
    return;
  }

  if (event.target.closest("[data-side-toggle]")) {
    event.preventDefault();
    setSideCollapsed(true);
    return;
  }

  if (event.target.closest("[data-side-open]")) {
    event.preventDefault();
    setSideCollapsed(false);
    return;
  }

  if (event.target.closest("[data-court-request]")) {
    requestTrial();
    return;
  }

  if (event.target.closest("[data-court-refresh]")) {
    reload().then(() => toast({ title: "Court", message: "Case status refreshed." }));
    return;
  }

  const tab = event.target.closest("[data-tab]");
  if (tab) {
    state.tabs[tab.dataset.tab] = tab.dataset.tabValue;
    setView(state.view, { silent: true });
    return;
  }

  const win = event.target.closest("[data-window]");
  if (win) {
    state.notifWindow = win.dataset.window;
    setView(state.view, { silent: true });
    return;
  }

  if (event.target.closest("[data-code-gen]")) {
    const input = qs("#c-code");
    if (input) input.value = String(Math.floor(100000 + Math.random() * 900000));
    return;
  }

  const codeAction = event.target.closest("[data-code-action]");
  if (codeAction) {
    codeActionAction(codeAction.dataset.codeAction, codeAction.dataset.action);
    return;
  }

  const deviceDelete = event.target.closest("[data-device-delete]");
  if (deviceDelete) {
    removeDevice(deviceDelete.dataset.deviceDelete);
    return;
  }

  const copy = event.target.closest("[data-copy]");
  if (copy) {
    copyText(copy.dataset.copy);
    return;
  }

  const download = event.target.closest("[data-download]");
  if (download) {
    downloadCode(download.dataset.download);
    return;
  }

  const share = event.target.closest("[data-share]");
  if (share) {
    shareCode(share.dataset.share);
    return;
  }

  const remove = event.target.closest("[data-list-remove]");
  if (remove) {
    removeListRow(remove.dataset.listRemove);
    return;
  }

  const readBtn = event.target.closest("[data-notif-read]");
  if (readBtn) {
    markRead(readBtn.dataset.notifRead);
    return;
  }

  const skin = event.target.closest("[data-skin]");
  if (skin) {
    toast({ title: "Skin", message: `${skin.dataset.skin} skin will arrive with the theme packs.` });
    return;
  }

  const surface = event.target.closest("[data-surface]");
  if (surface) {
    toast({ title: surface.dataset.surface, message: "Creation form opens with the creator service." });
    return;
  }

  const platform = event.target.closest("[data-platform]");
  if (platform) {
    toast({ title: `${platform.dataset.platform} API`, message: "Enter the API code from the platform. It stays on the server." });
    return;
  }
}

function onChange(event) {
  const source = event.target.closest("[data-source]");
  if (source) {
    savePref(source.dataset.source, source.checked, source);
    return;
  }

  if (event.target.closest("#c-device")) {
    const value = qs("#c-device").value;
    const mac = qs("[data-new-mac]");
    if (mac) mac.hidden = value !== "__new";
  }
}

function wireView(key, root) {
  const form = qs("[data-code-form]", root);
  if (form) {
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      createCode(form);
    });
  }

  const custom = qs("[data-custom-range]", root);
  if (custom) {
    custom.addEventListener("submit", (event) => {
      event.preventDefault();
      state.custom = { from: qs("#nf-from").value, to: qs("#nf-to").value };
      setView(state.view, { silent: true });
    });
  }

  const serial = qs("[data-serial-form]", root);
  if (serial) {
    serial.addEventListener("submit", (event) => {
      event.preventDefault();
      toast({ title: "Serial", message: "Serial redemption opens with the point key table." });
    });
  }

  const payout = qs("[data-payout-form]", root);
  if (payout) {
    const amount = qs("#p-amount", root);
    const out = qs("[data-payout-out]", root);
    if (amount && out) {
      amount.addEventListener("input", () => {
        out.textContent = usd(Number(amount.value || 0));
      });
    }
    payout.addEventListener("submit", (event) => {
      event.preventDefault();
      toast({ title: "Transfer", message: "Transfers open with the payment service." });
    });
  }

  const site = qs("[data-site-form]", root);
  if (site) {
    site.addEventListener("submit", (event) => {
      event.preventDefault();
      const data = new FormData(site);
      const theme = String(data.get("theme") || "dark");
      try {
        localStorage.setItem("1w.theme", JSON.stringify(theme));
        localStorage.setItem("1w.lang", JSON.stringify(String(data.get("lang") || "en")));
      } catch {
        /* storage blocked */
      }
      if (theme === "dark" || theme === "light") document.documentElement.dataset.theme = theme;
      if (theme === "system") {
        const light = window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches;
        document.documentElement.dataset.theme = light ? "light" : "dark";
      }
      toast({ title: "Saved", message: "Language, country and theme updated." });
    });
  }

  const profile = qs("[data-profile-form]", root);
  if (profile) {
    profile.addEventListener("submit", (event) => {
      event.preventDefault();
      toast({ title: "Profile", message: "Profile saves arrive with the profile service." });
    });
  }

  if (key === "history") enrichHistory(root);
}

/* ================================================================== */
/* actions                                                             */
/* ================================================================== */
async function createCode(form) {
  if (state.busy) return;
  const data = new FormData(form);
  const code = String(data.get("code") || "").trim();
  const device = String(data.get("device") || "");
  const mac = device === "__new" ? String(data.get("mac") || "").trim() : device;

  state.busy = true;
  const btn = qs("button[type=submit]", form);
  if (btn) btn.disabled = true;

  const result = await rpc("member_code_create", {
    p_token: token,
    p_code: code || null,
    p_months: Number(data.get("months") || 1),
    p_age: String(data.get("age") || "none"),
    p_device_mac: mac || null,
    p_device_name: String(data.get("deviceName") || "").trim() || null,
  }).catch(() => null);

  state.busy = false;
  if (btn) btn.disabled = false;

  const errors = {
    session: "Your session ended. Sign in again.",
    inactive: "Your account must be active before a code can be created.",
    code_format: "A code is exactly six digits.",
    code_taken: "That code already exists. Generate another.",
    months: "Choose 1, 3, 6 or 12 months.",
    age: "Choose a valid age rating.",
    server: "We could not create the code. Try again.",
  };

  if (!result || result.ok !== true) {
    toast({ title: "Code not created", message: errors[(result && result.error) || "server"] });
    return;
  }

  toast({ title: "Code created", message: `${result.code.code} · ${result.code.months} months` });
  await reload();
  setView("codes");
}

async function codeActionAction(id, action) {
  if (action === "delete" && !window.confirm("Delete this code? Devices using it lose access.")) return;
  const result = await rpc("member_code_action", { p_token: token, p_code_id: id, p_action: action }).catch(() => null);
  if (!result || result.ok !== true) {
    toast({ title: "Not changed", message: "The code could not be updated." });
    return;
  }
  toast({ title: action === "unlink" ? "Device unlinked" : "Code deleted", message: "" });
  await reload();
  setView("codes");
}

async function removeDevice(id) {
  if (!window.confirm("Remove this device? Its code becomes free and can bind again.")) return;
  const result = await rpc("member_device_delete", { p_token: token, p_device_id: id }).catch(() => null);
  if (!result || result.ok !== true) {
    toast({ title: "Not removed", message: "The device could not be removed." });
    return;
  }
  toast({ title: "Device removed", message: "" });
  await reload();
  setView("codes");
}

async function savePref(source, enabled, input) {
  const result = await rpc("member_notify_set", { p_token: token, p_source: source, p_enabled: enabled }).catch(() => null);
  if (!result || result.ok !== true) {
    if (input) input.checked = !enabled;
    toast({ title: "Not saved", message: result && result.error === "locked" ? "Messages and Court stay on." : "Try again." });
    return;
  }
  state.data.prefs = { ...(state.data.prefs || {}), [source]: enabled };
  toast({ title: enabled ? "Notifications on" : "Notifications off", message: cap(source) });
}

async function markRead(id) {
  const result = await rpc("member_notify_read", { p_token: token, p_id: id }).catch(() => null);
  if (!result || result.ok !== true) return;
  state.data.notifications = (state.data.notifications || []).map((n) => (n.id === id ? { ...n, read: true } : n));
  paintIdentity();
  paintPopover();
  if (state.view === "notifications") setView("notifications", { silent: true });
}

async function removeListRow(id) {
  const result = await rpc("member_list_remove", { p_token: token, p_list_id: Number(id) }).catch(() => null);
  if (!result || result.ok !== true) {
    toast({ title: "Not removed", message: "Try again." });
    return;
  }
  const lists = state.data.lists || {};
  Object.keys(lists).forEach((key) => {
    lists[key] = (lists[key] || []).filter((row) => String(row.id) !== String(id));
  });
  setView(state.view, { silent: true });
  toast({ title: "Removed", message: "" });
}

async function requestTrial() {
  const result = await rpc("member_court_request", { p_token: token }).catch(() => null);
  if (!result || result.ok !== true) {
    toast({
      title: "Request not sent",
      message:
        result && result.error === "permanent"
          ? "A permanent ban cannot be appealed."
          : "The court could not take the request right now.",
    });
    return;
  }
  toast({ title: "Trial requested", message: "The court will set a date and notify you." });
  await reload();
}

function logout() {
  const done = () => {
    clearSessionToken();
    signOut();
    location.replace("login.html");
  };
  if (token) {
    rpc("member_logout", { p_token: token }).then(done).catch(done);
    return;
  }
  done();
}

/* ================================================================== */
/* popover                                                             */
/* ================================================================== */
function togglePopover() {
  if (state.popOpen) return closePopover();
  state.popOpen = true;
  const bell = qs("[data-bell]");
  const pop = qs("[data-pop]");
  if (bell) bell.setAttribute("aria-expanded", "true");
  if (pop) pop.hidden = false;
  paintPopover();
}

function closePopover() {
  state.popOpen = false;
  const bell = qs("[data-bell]");
  const pop = qs("[data-pop]");
  if (bell) bell.setAttribute("aria-expanded", "false");
  if (pop) pop.hidden = true;
}

function paintPopover() {
  const list = qs("[data-pop-list]");
  if (!list) return;

  qsa("[data-pop-filter]").forEach((btn) => {
    btn.classList.toggle("is-on", btn.dataset.popFilter === state.popFilter);
  });

  const items = (state.data.notifications || [])
    .filter((n) => inWindow(n.created_at, state.popFilter, state.custom))
    .slice(0, 8);

  if (!items.length) {
    list.innerHTML = `<p class="dsh-pop__empty">Nothing new in this window.</p>`;
    return;
  }

  list.innerHTML = items
    .map(
      (n) => `<button class="dsh-pop__item" type="button" data-notif-read="${esc(n.id)}" data-unread="${n.read ? 0 : 1}" style="text-align:left;width:100%">
        <strong>${esc(n.title || "Notification")}</strong>
        <span>${esc(n.subject || "")}</span>
        <time>${esc(timeAgo(n.created_at))} · ${esc(n.source || "system")}</time>
      </button>`
    )
    .join("");
  hydrateIcons(list);
}

/* ================================================================== */
/* helpers                                                             */
/* ================================================================== */
function stat(iconName, label, value, meta) {
  return `<div class="dsh-stat">
    <span class="dsh-stat__label">${icon(iconName, "ico")}${esc(label)}</span>
    <p class="dsh-stat__value">${esc(value)}</p>
    <p class="dsh-stat__meta">${esc(meta || "")}</p>
  </div>`;
}

function empty(iconName, title, text, actionLabel = "", action = "") {
  const actionHtml = actionLabel
    ? action === "codes"
      ? `<button class="dsh-btn dsh-btn--sm" type="button" data-goto="codes"><i data-icon="plus"></i>${esc(actionLabel)}</button>`
      : action === "notifications-page"
        ? `<a class="dsh-btn dsh-btn--sm" href="notifications.html">${esc(actionLabel)}</a>`
        : action
          ? `<button class="dsh-btn dsh-btn--sm" type="button" data-goto="${esc(action)}">${esc(actionLabel)}</button>`
          : ""
    : "";
  return `<div class="dsh-empty">
    <i data-icon="${esc(iconName)}"></i>
    <p class="dsh-empty__title">${esc(title)}</p>
    <p class="dsh-empty__text">${esc(text)}</p>
    ${actionHtml}
  </div>`;
}

function cap(value) {
  const text = String(value || "");
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : "";
}

function usd(points) {
  const value = Number(points || 0) / POINTS_PER_USD;
  return `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function ageLabel(age) {
  if (!age || age === "none") return "No rating";
  return `${age}+`;
}

function fullDate(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-US", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function deviceName(row) {
  return row.device_name || row.device_id || "Device";
}

function statusLabel(status) {
  const map = {
    pending: "Pending",
    under_review: "Under review",
    valid: "Valid",
    rejected: "Rejected",
    closed: "Closed",
  };
  return map[String(status || "").toLowerCase()] || cap(status || "Pending");
}

function artClass(media) {
  if (media === "channel" || media === "image") return "dsh-tile__art--square";
  if (media === "movie" || media === "tv") return "";
  return "dsh-tile__art--wide";
}

function guessType(media) {
  const value = String(media || "").toLowerCase();
  if (["movie", "movies", "film"].includes(value)) return "movies";
  if (["tv", "series", "episode"].includes(value)) return "series";
  if (["channel", "channels", "live"].includes(value)) return "channels";
  if (["podcast", "podcasts", "audio"].includes(value)) return "podcasts";
  if (["article", "articles", "post"].includes(value)) return "articles";
  if (["answer", "answers", "question"].includes(value)) return "answers";
  if (["document", "documents", "book"].includes(value)) return "documents";
  if (["image", "images", "picture"].includes(value)) return "images";
  if (["video", "videos"].includes(value)) return "videos";
  if (["product", "products", "store"].includes(value)) return "products";
  return "profiles";
}

function openLink(media, id) {
  const type = guessType(media);
  if (type === "movies") return `watch.html?movie=${encodeURIComponent(id || "")}`;
  if (type === "series") return `watch.html?series=${encodeURIComponent(id || "")}`;
  if (type === "channels") return "iptv.html";
  if (!id) return "index.html";
  return `search.html?q=${encodeURIComponent(id)}`;
}

function inWindow(value, windowKey, custom = {}) {
  if (!value) return false;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  const now = new Date();
  const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diff = now.getTime() - date.getTime();

  switch (windowKey) {
    case "hour":
      return diff <= 3600e3;
    case "today":
      return date >= startOfDay(now);
    case "yesterday": {
      const start = startOfDay(now);
      const before = new Date(start.getTime() - 86400e3);
      return date >= before && date < start;
    }
    case "week":
      return diff <= 7 * 86400e3;
    case "month":
      return date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear();
    case "year":
      return date.getFullYear() === now.getFullYear();
    case "custom": {
      const from = custom.from ? new Date(custom.from) : null;
      const to = custom.to ? new Date(custom.to) : null;
      if (to) to.setHours(23, 59, 59, 999);
      if (from && !Number.isNaN(from.getTime()) && date < from) return false;
      if (to && !Number.isNaN(to.getTime()) && date > to) return false;
      return true;
    }
    case "all":
    default:
      return true;
  }
}

function copyText(text) {
  const done = () => toast({ title: "Copied", message: String(text) });
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(String(text)).then(done).catch(() => fallbackCopy(text, done));
    return;
  }
  fallbackCopy(text, done);
}

function fallbackCopy(text, done) {
  const area = document.createElement("textarea");
  area.value = String(text);
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.appendChild(area);
  area.select();
  try {
    document.execCommand("copy");
  } catch {
    /* nothing else to try */
  }
  area.remove();
  done();
}

function codeById(id) {
  return (state.data.codes || []).find((c) => String(c.id) === String(id));
}

function codeText(row) {
  if (!row) return "";
  return [
    "1World viewing code",
    `Code: ${row.code}`,
    `Duration: ${row.months} ${row.months === 1 ? "month" : "months"}`,
    `Age rating: ${ageLabel(row.age)}`,
    row.device_mac ? `Device: ${row.device_name || "Device"} (${row.device_mac})` : "Device: not bound yet",
    `Expires: ${row.expires_at ? formatDate(row.expires_at) : "—"}`,
    `Member: ${(state.data.member || {}).member_id || ""}`,
  ].join("\n");
}

function downloadCode(id) {
  const row = codeById(id);
  if (!row) return;
  try {
    const blob = new Blob([codeText(row)], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `1world-code-${row.code}.txt`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  } catch {
    copyText(codeText(row));
  }
}

function shareCode(id) {
  const row = codeById(id);
  if (!row) return;
  const text = codeText(row);
  if (navigator.share) {
    navigator.share({ title: "1World viewing code", text }).catch(() => {});
    return;
  }
  copyText(text);
}

/* history titles: enrich from TMDB when the row is a movie or a series */
async function enrichHistory(root) {
  const rows = state.data.history || [];
  const wanted = rows.filter((r) => ["movies", "series"].includes(guessType(r.media_type)) && r.tmdb_id).slice(0, 12);
  if (!wanted.length) return;

  let key = "";
  try {
    const config = await import("./config.js");
    key = (config.TMDB && (config.TMDB.apiKey || config.TMDB.key)) || "";
  } catch {
    key = "";
  }
  if (!key) return;

  await Promise.all(
    wanted.map(async (row) => {
      const type = guessType(row.media_type) === "movies" ? "movie" : "tv";
      const cacheKey = `${type}:${row.tmdb_id}`;
      try {
        let title = state.tmdb.get(cacheKey);
        if (!title) {
          const res = await fetch(`https://api.themoviedb.org/3/${type}/${row.tmdb_id}?api_key=${key}&language=en-US`);
          if (!res.ok) return;
          const json = await res.json();
          title = json.title || json.name || "";
          state.tmdb.set(cacheKey, title);
        }
        if (!title) return;
        qsa(`[data-hist-title="${row.tmdb_id}"]`, root).forEach((el) => {
          el.textContent = title;
        });
      } catch {
        /* offline — the id stays as the label */
      }
    })
  );
}

initDashboard();
