/**
 * Site shell — header, footer and the sidebar.
 *
 * The sidebar is mounted on the pages that live around the site navigation:
 * the homepage, the player (`watch.html`) and the profile. It slides in *under*
 * the header, so the header keeps its exact position and the content is what
 * moves. Everywhere else the header simply renders without its menu button.
 *
 * The panel is pinned by default: it stays out and the page keeps room for it.
 * Unpin it (the pin in the sidebar tools) and it leaves the screen — the page
 * then uses the whole width and the panel slides back in over the content
 * whenever the pointer reaches the left edge. See `edge.js`.
 */
import { PRIMARY_NAV, SIDEBAR_NAV, FOOTER_NAV, PLATFORMS, SITE } from "./config.js";
import { brand } from "./brands.js";
import { icon } from "./icons.js";
import { store, esc } from "./utils.js";
import { toggleSound, soundOn } from "./sound.js";
import {
  getMember,
  visitorId,
  memberCode,
  displayName,
  avatarFor,
  signOut,
} from "./session.js";
import { renderWallet } from "./wallet.js";
import { initNotifications } from "./notifications.js";
import { toast } from "./ui.js";
import { hydrateIcons } from "./icons.js";
import { initTheme, toggleTheme, currentTheme, flashTransition } from "./theme.js";
import { createEdgeRail, isDesktop } from "./edge.js";

/** Pages that mount the site navigation panel. */
const SIDEBAR_PAGES = new Set(["index.html", "watch.html", "profile.html"]);

function pageFile() {
  return window.location.pathname.split("/").pop() || "index.html";
}

/** Homepage, player and profile carry the panel; the rest of the site does not. */
function hasSidebar() {
  if (SIDEBAR_PAGES.has(pageFile())) return true;
  const page = document.body?.dataset.page;
  return page === "home" || page === "watch" || page === "profile";
}

/* the rail instance, shared with the header button */
let sidebarRail = null;

/* ------------------------------------------------------------------ */
/* markup                                                             */
/* ------------------------------------------------------------------ */
function notifPanel() {
  return `
    <div class="notif__panel" data-notif-panel hidden>
      <div class="notif__head">
        <div>
          <p class="notif__title">Notifications</p>
          <p class="notif__sub">Latest activity on your account</p>
        </div>
        <a class="icon-btn" href="dashboard.html" aria-label="Notification settings">${icon("settings")}</a>
      </div>
      <div class="notif__filters" data-notif-filters></div>
      <div class="notif__list" data-notif-list></div>
      <div class="notif__foot">
        <a class="btn btn--ghost btn--block" href="notifications.html">View all notifications ${icon("arrowRight")}</a>
      </div>
    </div>`;
}

function headerTemplate(withSections = true) {
  return `
  <header class="site-header" data-header>
    <div class="site-header__bar">
      ${
        withSections
          ? `<button class="icon-btn header__menu" data-action="toggle-sidebar" aria-label="Open navigation" aria-controls="siteSidebar" aria-expanded="false">
        ${icon("menu")}
      </button>`
          : ""
      }

      <a class="brand" href="index.html" aria-label="${SITE.name} — home">
        <span class="brand__mark" aria-hidden="true">1W</span>
        <span class="brand__word">${SITE.name}<span class="brand__suffix">Web</span></span>
      </a>

      <nav class="primary-nav" aria-label="Sections" data-primary-nav>
        ${PRIMARY_NAV.map(
          (item) => `<a class="primary-nav__item" href="${item.href}" data-nav-link="${item.href.replace(".html", "").replace("#", "")}" title="${esc(item.label)}">
            <span class="primary-nav__icon" aria-hidden="true">${icon(item.icon || "sparkle")}</span>
            <span class="primary-nav__label">${esc(item.label)}</span>
          </a>`
        ).join("")}
      </nav>

      <div class="header__actions">
        <button class="icon-btn theme-btn" data-theme-toggle data-variant="icon" type="button" title="Light theme">
          ${icon("sun")}
        </button>

        <a class="icon-btn header-avatar" href="profile.html" data-header-avatar aria-label="Open your profile">
          <span class="header-avatar__img" data-header-avatar-img>${icon("user")}</span>
        </a>

        <div class="notif" data-notif>
          <button class="icon-btn notif__btn" data-notif-trigger aria-label="Notifications" aria-haspopup="true" aria-expanded="false">
            ${icon("bell")}
            <span class="notif__dot" data-notif-badge hidden></span>
          </button>
          ${notifPanel()}
        </div>

        <a class="wallet" data-wallet href="dashboard.html#points" title="Your points and level — open the points page">
          <span class="wallet__icon" aria-hidden="true">${icon("zap")}</span>
          <span class="wallet__main">
            <span class="wallet__label">Your points</span>
            <span class="wallet__value"><b data-wallet-value>—</b><em>pts</em></span>
            <span class="wallet__level">Level · <b data-wallet-level>Guest</b></span>
          </span>
        </a>

        <div class="auth-actions" data-auth-actions></div>
      </div>
    </div>
  </header>`;
}

function authButtons() {
  const member = getMember();
  if (member) {
    return `
      <a class="btn btn--ghost btn--sm" href="dashboard.html">${icon("dashboard")} Dashboard</a>
      <button class="btn btn--primary btn--sm" data-action="logout">${icon("logout")} Log out</button>`;
  }
  return `
    <a class="btn btn--ghost btn--sm" href="login.html">Log in</a>
    <a class="btn btn--primary btn--sm" href="register.html">Register</a>`;
}

function sidebarTemplate() {
  return `
  <aside class="sidebar" id="siteSidebar" aria-label="Site navigation">
    <div class="sidebar__inner">
      <div class="sidebar__account">
        <a class="account" href="profile.html" data-account-link>
          <span class="account__avatar" data-account-avatar></span>
          <span class="account__meta">
            <span class="account__name" data-account-name>Visitor</span>
            <span class="account__id" data-account-id></span>
          </span>
          <span class="account__chev">${icon("chevronRight")}</span>
        </a>

        <div class="sidebar__auth" data-sidebar-auth></div>

        <div class="level-meter">
          <div class="level-meter__row"><span>Your level</span><b data-level-cap>Guest</b></div>
          <div class="level-meter__track" aria-hidden="true"><i class="level-meter__fill" data-level-fill></i></div>
          <div class="level-meter__row"><span>Your points</span><b><span data-member-points>0</span></b></div>
        </div>
      </div>

      <nav aria-label="All sections">
        ${SIDEBAR_NAV.map(
          (group) => `
          <div class="snav">
            ${group.title ? `<p class="snav__title">${group.title}</p>` : ""}
            ${group.items
              .map(
                (item) =>
                  `<a class="snav__link" href="${item.href}" data-sidebar-link="${item.href}">${icon(item.icon)}<span>${esc(
                    item.label
                  )}</span></a>`
              )
              .join("")}
          </div>`
        ).join("")}
      </nav>

      <div class="sidebar__foot">
        <div class="sidebar__tools">
          <button class="tool-btn" type="button" data-sidebar-pin aria-pressed="true" aria-label="Pin the menu">
            <span class="pin-glyph" data-pin-glyph></span><span data-pin-text>Pinned</span>
          </button>
          <button class="tool-btn" type="button" data-theme-toggle data-variant="label" title="Light theme">
            ${icon("sun")}<span>Light</span>
          </button>
          <button class="tool-btn" data-action="sound" aria-label="Toggle interface sounds">
            ${icon("volume")}<span data-sound-label>Sound</span>
          </button>
        </div>
        <p class="sidebar__legal">© ${SITE.year} ${SITE.name}. Films, series &amp; live TV.<br /><span data-visitor-line></span></p>
      </div>
    </div>
  </aside>
  <button class="edge-tab" type="button" data-sidebar-edge aria-controls="siteSidebar" aria-expanded="false" aria-label="Show the menu" title="Show the menu">
    ${icon("chevronRight")}
  </button>
  <div class="scrim" data-scrim></div>`;
}


function footerTemplate() {
  return `
  <footer class="site-footer" data-footer>
    <div class="wrap">
      <div class="site-footer__top">
        <div class="site-footer__brand">
          <a class="brand" href="index.html" aria-label="${SITE.name} — home">
            <span class="brand__mark" aria-hidden="true">1W</span>
            <span class="brand__word">${SITE.name}<span class="brand__suffix">Web</span></span>
          </a>
          <p class="site-footer__desc">${esc(SITE.description)}</p>
          <div class="site-footer__social">
            ${PLATFORMS.slice(0, 8)
              .map(
                (p) =>
                  `<a class="social-dot" href="${p.url}" target="_blank" rel="noopener noreferrer" aria-label="${esc(p.label)}">${brand(
                    p.key
                  )}</a>`
              )
              .join("")}
            <a class="social-dot" href="#platform" aria-label="All platforms">${icon("arrowUpRight")}</a>
          </div>
        </div>
        ${FOOTER_NAV.map(
          (col) => `
          <div class="site-footer__col">
            <h3>${esc(col.title)}</h3>
            <ul>${col.links.map((l) => `<li><a href="${l.href}">${esc(l.label)}</a></li>`).join("")}</ul>
          </div>`
        ).join("")}
      </div>

      <div class="site-footer__bottom">
        <span>© ${SITE.year} ${SITE.name} Web — All rights reserved.</span>
        <nav aria-label="Legal">
          <a href="privacy.html">Privacy</a>
          <a href="terms.html">Terms</a>
          <a href="contact.html">Contact</a>
          <a href="help.html">Help</a>
        </nav>
        <span>Films · Series · IPTV · Member publishing</span>
      </div>
    </div>
    <div class="site-footer__wordmark" aria-hidden="true">1WORLD</div>
  </footer>`;
}

/* ------------------------------------------------------------------ */
/* render                                                             */
/* ------------------------------------------------------------------ */
function renderAccount() {
  const member = getMember();
  const name = member ? displayName(member) : "Visitor";
  const code = member ? `Member - ${memberCode(member)}` : `Visitor - ${visitorId()}`;

  document.querySelectorAll("[data-account-link]").forEach((a) => {
    a.setAttribute("href", member ? "profile.html" : "login.html");
    a.setAttribute("aria-label", member ? `Open ${name}'s profile` : "Log in to your account");
  });

  document.querySelectorAll("[data-account-avatar]").forEach((el) => {
    el.innerHTML = member
      ? `<img src="${esc(avatarFor(member))}" alt="" />`
      : icon("user");
    el.classList.toggle("account__avatar--ghost", !member);
  });

  document.querySelectorAll("[data-header-avatar]").forEach((a) => {
    a.setAttribute("href", member ? "profile.html" : "login.html");
    a.setAttribute("aria-label", member ? `Open ${name}'s profile` : "Log in to your account");
  });
  document.querySelectorAll("[data-header-avatar-img]").forEach((el) => {
    el.innerHTML = member ? `<img src="${esc(avatarFor(member))}" alt="" />` : icon("user");
    el.classList.toggle("is-ghost", !member);
  });

  document.querySelectorAll("[data-account-name]").forEach((el) => {
    el.textContent = name;
  });
  document.querySelectorAll("[data-account-id]").forEach((el) => {
    el.textContent = code;
  });
  document.querySelectorAll("[data-visitor-line]").forEach((el) => {
    el.textContent = code;
  });
}

function renderAuth() {
  const html = authButtons();
  document.querySelectorAll("[data-auth-actions]").forEach((el) => (el.innerHTML = html));
  document.querySelectorAll("[data-sidebar-auth]").forEach((el) => {
    const member = getMember();
    el.innerHTML = member
      ? `<a class="btn btn--ghost btn--sm" href="dashboard.html">${icon("dashboard")} Dashboard</a>
         <button class="btn btn--primary btn--sm" data-action="logout">Log out</button>`
      : `<a class="btn btn--ghost btn--sm" href="login.html">Log in</a>
         <a class="btn btn--primary btn--sm" href="register.html">Register</a>`;
  });
}

function renderSoundLabel() {
  document.querySelectorAll("[data-sound-label]").forEach((el) => {
    el.textContent = soundOn() ? "Sound" : "Muted";
  });
}

/**
 * Both switches (header icon + sidebar label) always describe the mode you
 * would switch TO, and expose it to assistive tech.
 */
function syncThemeToggles() {
  const dark = currentTheme() === "dark";
  const target = dark ? "light" : "dark";
  const label = dark ? "Switch to light mode" : "Switch to dark mode";

  document.querySelectorAll("[data-theme-toggle]").forEach((btn) => {
    const variant = btn.getAttribute("data-variant") || "icon";
    btn.innerHTML =
      variant === "label"
        ? `${icon(dark ? "sun" : "moon")}<span>${target === "light" ? "Light" : "Dark"}</span>`
        : icon(dark ? "sun" : "moon");
    btn.setAttribute("aria-label", label);
    btn.setAttribute("title", `Switch to ${target} mode`);
    btn.setAttribute("aria-pressed", String(!dark));
  });
}

/* ------------------------------------------------------------------ */
/* sidebar                                                            */
/* ------------------------------------------------------------------ */
/**
 * The panel is painted by `edge.js`: it owns the open/closed state and the
 * pinned preference, this is only the chrome that follows it — the header
 * button and the scrim (which exists for the touch drawer alone).
 */
function initSidebar() {
  const panel = document.getElementById("siteSidebar");
  if (!panel) return;

  const tab = document.querySelector("[data-sidebar-edge]");
  const toggle = document.querySelector('[data-action="toggle-sidebar"]');
  // the shell's own scrim — some pages carry a stray `[data-scrim]` placeholder
  const scrim = document.querySelector(".scrim");

  const paint = ({ open }) => {
    if (toggle) {
      toggle.setAttribute("aria-expanded", String(open));
      toggle.setAttribute("aria-label", open ? "Hide navigation" : "Show navigation");
      toggle.innerHTML = icon(open ? "close" : "menu");
    }
    scrim?.classList.toggle("is-on", open && !isDesktop());
  };

  sidebarRail = createEdgeRail({
    panel,
    tab,
    pinSelector: "[data-sidebar-pin]",
    defaultPinned: pageFile() === "index.html" || document.body?.dataset.page === "home",
    onOpen: paint,
    onClose: paint,
  });
  paint({ open: sidebarRail.open });

  scrim?.addEventListener("click", () => sidebarRail.hide());

  window.addEventListener("resize", () => {
    if (isDesktop()) scrim?.classList.remove("is-on");
    else if (sidebarRail.open) scrim?.classList.add("is-on");
  });

  // mark the current page
  const path = pageFile();
  document.querySelectorAll("[data-sidebar-link]").forEach((link) => {
    if (link.getAttribute("data-sidebar-link") === path) {
      link.classList.add("is-active");
      link.setAttribute("aria-current", "page");
    }
  });
}

/* ------------------------------------------------------------------ */
/* scroll behaviour                                                   */
/* ------------------------------------------------------------------ */
function initScrollEffects() {
  const header = document.querySelector("[data-header]");
  const onScroll = () => {
    header?.classList.toggle("is-stuck", window.scrollY > 14);
  };
  onScroll();
  window.addEventListener("scroll", onScroll, { passive: true });

  // scroll-spy for the homepage anchors
  const links = Array.from(document.querySelectorAll("[data-nav-link]"));
  if (!links.length || !("IntersectionObserver" in window)) return;
  const sections = links
    .map((link) => document.getElementById(link.getAttribute("data-nav-link")))
    .filter(Boolean);
  if (!sections.length) return;

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        links.forEach((l) => l.classList.toggle("is-active", l.getAttribute("data-nav-link") === entry.target.id));
      });
    },
    { rootMargin: "-45% 0px -50% 0px", threshold: 0 }
  );
  sections.forEach((s) => observer.observe(s));
}

/* ------------------------------------------------------------------ */
/* actions                                                            */
/* ------------------------------------------------------------------ */
function handleLogout() {
  signOut();
  toast({ tone: "info", iconName: "logout", title: "Signed out", message: "See you soon.", duration: 3200 });
}

function bindActions() {
  document.addEventListener("click", (event) => {
    if (event.target.closest("[data-theme-toggle]")) {
      flashTransition();
      const next = toggleTheme();
      syncThemeToggles();
      toast({
        tone: "info",
        iconName: next === "dark" ? "moon" : "sun",
        title: `${next === "dark" ? "Dark" : "Light"} mode on`,
        message: next === "dark" ? "Black, white and grey — the cinema default." : "White, black and grey — daylight reading.",
        duration: 2600,
      });
      return;
    }

    const actionEl = event.target.closest("[data-action]");
    if (!actionEl) return;
    const action = actionEl.getAttribute("data-action");

    if (action === "toggle-sidebar") {
      if (!sidebarRail) return;
      // a mouse user pins and unpins the panel; a finger opens and closes the drawer
      if (isDesktop()) sidebarRail.setPinned(!sidebarRail.pinned);
      else sidebarRail.toggle();
      return;
    }
    if (action === "logout") {
      handleLogout();
    }
    if (action === "sound") {
      const on = toggleSound();
      renderSoundLabel();
      toast({
        tone: "info",
        iconName: on ? "volume" : "mute",
        title: on ? "Interface sounds on" : "Interface sounds muted",
        duration: 2400,
      });
    }
  });

  window.addEventListener("1w:session", () => {
    renderAccount();
    renderAuth();
    renderWallet();
    hydrateIcons();
  });
}

/* ------------------------------------------------------------------ */
/* public                                                             */
/* ------------------------------------------------------------------ */
export function mountShell() {
  initTheme();

  const withSidebar = hasSidebar();
  const headerMount = document.querySelector("[data-site-header]");
  const sidebarMount = document.querySelector("[data-site-sidebar]");
  const footerMount = document.querySelector("[data-site-footer]");
  if (headerMount) headerMount.innerHTML = headerTemplate(withSidebar);
  if (sidebarMount) sidebarMount.innerHTML = withSidebar ? sidebarTemplate() : "";
  if (footerMount) footerMount.innerHTML = footerTemplate();
  if (!withSidebar) {
    document.body.classList.remove("sb-open", "sb-pinned", "sb-rail");
  }

  renderAccount();
  renderAuth();
  renderWallet();
  syncThemeToggles();
  renderSoundLabel();
  if (withSidebar) initSidebar();
  initScrollEffects();
  bindActions();
  initNotifications();
  hydrateIcons();
}
