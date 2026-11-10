/**
 * Entry point for every page.
 * Mounts the shell, restores the session and, on the homepage, boots the
 * section controllers.
 */
import { mountShell } from "./shell.js?v=20261217a";
import { getMember, refreshMember, setMember, signOut, noteSeen } from "./session.js";
import { awardPoints, renderWallet, syncFromMember, watchWallet, refreshWallet } from "./wallet.js";
import { toast } from "./ui.js";
import { avatarPlaceholder, enableDragScrollAll } from "./utils.js";
import { startVisitTracking, finishVisit, lastVisitError } from "./visits.js?v=20261217a";
import { initTheme, setTheme, toggleTheme, resetTheme, currentTheme, systemTheme } from "./theme.js";
import { lookupVisitor, cachedVisitor } from "./geo.js";
import { rpc } from "./data.js";

/**
 * A `?ref=` in the address is a publisher's link. The click is counted once
 * per visit (`publisher_visit`), and the code is kept for the session so the
 * registration page can credit the same publisher if this visitor signs up.
 */
async function capturePublisherRef() {
  try {
    const code = String(new URLSearchParams(location.search).get("ref") || "").trim().toUpperCase();
    if (!code || !/^[A-Z0-9]{4,24}$/.test(code)) return;
    const seen = `1w.pub.ref.${code}`;
    if (sessionStorage.getItem(seen)) return;
    sessionStorage.setItem(seen, "1");
    sessionStorage.setItem("1w.pub.ref", code);
    await rpc("publisher_visit", { p_code: code });
  } catch (error) {
    /* a counter is never worth a broken page */
  }
}

/**
 * Work that nobody is waiting for waits for the browser to exhale.
 *
 * The visit row and a publisher's click are bookkeeping: the page is fully
 * painted and usable without them. They used to be fired inside `boot()`, in
 * the same breath as the shell, which put a geo-IP lookup and a write against
 * the critical path of the first screen. `requestIdleCallback` hands them to the
 * browser's spare time; a browser without it gets a short timer, and a page that
 * is closed before either runs still flushes the visit with `pagehide`.
 */
function whenIdle(task, timeout = 2500) {
  const run = () => {
    try {
      const out = task();
      if (out && out.catch) out.catch(() => {});
    } catch {
      /* bookkeeping never breaks a page */
    }
  };
  if (typeof window.requestIdleCallback === "function") {
    window.requestIdleCallback(run, { timeout });
    return;
  }
  setTimeout(run, 700);
}

async function boot() {
  mountShell();
  enableDragScrollAll();
  // the header list can be re-rendered when the session changes → wire it again
  window.addEventListener("1w:session", () => {
    if (window.requestAnimationFrame) window.requestAnimationFrame(() => enableDragScrollAll());
    else enableDragScrollAll();
  });
  whenIdle(() => capturePublisherRef());
  whenIdle(() => startVisitTracking().catch((error) => console.warn("[1World] visits:", error.message)));

  if (document.body.dataset.page === "home") {
    const { initHome } = await import("./home.js?v=20261116b");
    initHome().catch((error) => console.warn("[1World] homepage data:", error));
  }

  if (document.body.dataset.page === "watch") {
    const { initWatch } = await import("./watch.js?v=20261215a");
    initWatch().catch((error) => console.warn("[1World] watch page:", error));
  }

  if (document.body.dataset.page === "cast") {
    const { initCast } = await import("./cast.js");
    initCast().catch((error) => console.warn("[1World] cast page:", error));
  }

  if (document.body.dataset.page === "login") {
    const { initLogin } = await import("./login.js");
    initLogin().catch((error) => console.warn("[1World] login page:", error));
  }

  if (document.body.dataset.page === "iptv") {
    const { initIptv } = await import("./iptv.js");
    initIptv();
  }

  if (document.body.dataset.page === "panel") {
    const { initPanel } = await import("./panel.js?v=20261116b");
    initPanel().catch((error) => console.warn("[1World] control panel:", error));
  }

  if (document.body.dataset.page === "rest") {
    const { initRest } = await import("./rest.js");
    initRest().catch((error) => console.warn("[1World] recovery page:", error));
  }

  if (document.body.dataset.page === "register") {
    const { initRegister } = await import("./register.js");
    initRegister().catch((error) => console.warn("[1World] register page:", error));
  }

  const member = getMember();
  if (member) {
    /* the wallet shows what was stored last time at once — no waiting on a
       round trip to draw a number the visitor already saw on the last page */
    renderWallet();
    /* the counter is live from here on: an action, a tab coming back, or a
       change made elsewhere all move it without a reload */
    watchWallet();
    refreshMember()
      .then((fresh) => {
        if (!fresh) return;
        noteSeen(fresh);
        syncFromMember(fresh);
        renderWallet();
      })
      .catch(() => {});
    return;
  }

  renderWallet();
}

boot();

/* ------------------------------------------------------------------ */
/* Small public API used by the other pages (search, watch, market …) */
/* ------------------------------------------------------------------ */
window.OneW = {
  awardPoints,
  toast,
  signOut,
  refreshMember,
  refreshWallet,
  setMember,
  enableDragScrollAll,
  visits: { start: startVisitTracking, finish: finishVisit, lastError: lastVisitError },
  geo: { lookup: lookupVisitor, cached: cachedVisitor },
  theme: {
    current: currentTheme,
    system: systemTheme,
    set: setTheme,
    toggle: toggleTheme,
    reset: resetTheme,
    init: initTheme,
  },
  /** Preview helper — signs in a local demo member (no server call). */
  demoSignIn({
    id = "100001",
    username = "@cineaura",
    level = 4,
    points = 1250,
    membership = "gold",
  } = {}) {
    const member = {
      id,
      username,
      name: username.replace(/^@/, ""),
      level,
      points,
      membership,
      avatar: avatarPlaceholder(username.replace(/^@/, ""), 96),
    };
    setMember(member);
    noteSeen(member);
    watchWallet();
    toast({ tone: "success", iconName: "user", title: `Signed in as ${username}`, message: "Local preview session." });
    return member;
  },
};
