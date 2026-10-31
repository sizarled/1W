/**
 * Notification bell + mini panel.
 * Filters: Now · Hour · Today · Yesterday · Week  (the full page is
 * notifications.html, which adds month / year / explicit date / all time).
 */
import { getMember } from "./session.js";
import { loadNotifications } from "./data.js";
import { icon } from "./icons.js";
import { esc, timeAgo } from "./utils.js";
import { playSound } from "./sound.js";
import { toast } from "./ui.js";

export const FILTERS = [
  { id: "now", label: "Now" },
  { id: "hour", label: "Hour" },
  { id: "today", label: "Today" },
  { id: "yesterday", label: "Yesterday" },
  { id: "week", label: "Week" },
];

let items = [];
let activeFilter = "today";
let seenIds = new Set();
let firstLoad = true;
let pollHandle = null;
let panel = null;

function startOfDay(date = new Date()) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function inFilter(iso, filter) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return false;
  const now = new Date();
  switch (filter) {
    case "now":
      return now - date <= 15 * 60 * 1000;
    case "hour":
      return now - date <= 60 * 60 * 1000;
    case "today":
      return date >= startOfDay(now);
    case "yesterday": {
      const start = startOfDay(now);
      const prev = new Date(start);
      prev.setDate(prev.getDate() - 1);
      return date >= prev && date < start;
    }
    case "week":
      return now - date <= 7 * 24 * 60 * 60 * 1000;
    case "month":
      return now - date <= 31 * 24 * 60 * 60 * 1000;
    case "year":
      return date.getFullYear() === now.getFullYear();
    default:
      return true;
  }
}

function itemTemplate(n) {
  return `
    <article class="notif__item">
      <span class="notif__icon">${icon(n.source_icon || "bell")}</span>
      <div class="notif__body">
        <p class="notif__name">${esc(n.title)}${n.read ? "" : "<span></span>"}</p>
        ${n.subject ? `<p class="notif__text">${esc(n.subject)}</p>` : ""}
        <p class="notif__time">${esc(timeAgo(n.createdAt))}${n.read ? "" : " · unread"}</p>
      </div>
    </article>`;
}

function emptyTemplate(guest) {
  if (guest) {
    return `<div class="notif__empty">${icon("bell")}
      <p>Sign in to see your notifications</p>
      <a class="btn btn--ghost btn--sm" href="login.html" style="margin-top:.6rem">Log in</a>
    </div>`;
  }
  return `<div class="notif__empty">${icon("bell")}
    <p>Nothing here yet</p>
    <span class="faint" style="font-size:.72rem">Activity from your account will appear here.</span>
  </div>`;
}

export function renderNotifications() {
  if (!panel) return;
  const list = panel.querySelector("[data-notif-list]");
  const filters = panel.querySelector("[data-notif-filters]");
  const badge = document.querySelector("[data-notif-badge]");
  const member = getMember();

  if (filters) {
    filters.innerHTML = FILTERS.map(
      (f) => `<button class="chip ${f.id === activeFilter ? "is-active" : ""}" data-filter="${f.id}">${f.label}</button>`
    ).join("");
  }

  const visible = items.filter((n) => inFilter(n.createdAt, activeFilter));
  if (list) {
    list.innerHTML = member
      ? visible.length
        ? visible.map(itemTemplate).join("")
        : emptyTemplate(false)
      : emptyTemplate(true);
  }

  const unread = items.filter((n) => !n.read).length;
  if (badge) {
    badge.hidden = !member || unread === 0;
    badge.dataset.count = unread > 9 ? "9+" : String(unread);
    badge.setAttribute("data-count", unread > 9 ? "9+" : String(unread));
  }
}

export async function refreshNotifications({ announce = true } = {}) {
  const member = getMember();
  if (!member) {
    items = [];
    renderNotifications();
    return [];
  }
  const rows = await loadNotifications(member.id).catch(() => []);
  items = rows.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  if (!firstLoad && announce) {
    const fresh = items.filter((n) => !n.read && !seenIds.has(String(n.id)));
    if (fresh.length) {
      playSound("notification");
      toast({
        tone: "info",
        iconName: "bell",
        title: "New notification",
        message: fresh[0].title,
        action: { label: "View all notifications", href: "notifications.html" },
      });
    }
  }
  items.forEach((n) => seenIds.add(String(n.id)));
  firstLoad = false;
  renderNotifications();
  return items;
}

export function initNotifications() {
  panel = document.querySelector("[data-notif]");
  if (!panel) return;

  const trigger = panel.querySelector("[data-notif-trigger]");
  const sheet = panel.querySelector("[data-notif-panel]");

  const setOpen = (open) => {
    sheet.hidden = !open;
    trigger.setAttribute("aria-expanded", String(open));
    if (open) {
      refreshNotifications({ announce: false });
      renderNotifications();
    }
  };

  trigger.addEventListener("click", (event) => {
    event.stopPropagation();
    setOpen(sheet.hidden);
  });

  panel.addEventListener("click", (event) => {
    const filterBtn = event.target.closest("[data-filter]");
    if (filterBtn) {
      activeFilter = filterBtn.dataset.filter;
      renderNotifications();
      return;
    }
    const item = event.target.closest(".notif__item");
    if (item) {
      window.location.href = "notifications.html";
    }
  });

  document.addEventListener("click", (event) => {
    if (!sheet.hidden && !panel.contains(event.target)) setOpen(false);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !sheet.hidden) {
      setOpen(false);
      trigger.focus();
    }
  });

  refreshNotifications({ announce: false });
  if (pollHandle) clearInterval(pollHandle);
  if (getMember()) {
    pollHandle = setInterval(() => {
      if (!document.hidden) refreshNotifications({ announce: true });
    }, 60000);
  }

  window.addEventListener("1w:session", () => {
    firstLoad = true;
    items = [];
    refreshNotifications({ announce: false });
  });

  return { refresh: refreshNotifications };
}
