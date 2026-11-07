/**
 * Entry point for every page.
 * Mounts the shell, restores the session and, on the homepage, boots the
 * section controllers.
 */
import { mountShell } from "./shell.js?v=20261116b";
import { getMember, refreshMember, setMember, signOut, noteSeen } from "./session.js";
import { awardPoints, renderWallet, startWalletPolling, syncFromMember } from "./wallet.js";
import { toast } from "./ui.js";
import { avatarPlaceholder, enableDragScrollAll } from "./utils.js";
import { startVisitTracking, finishVisit, lastVisitError } from "./visits.js?v=20261101a";
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

async function boot() {
  capturePublisherRef();
  mountShell();
  enableDragScrollAll();
  // the header list can be re-rendered when the session changes → wire it again
  window.addEventListener("1w:session", () => enableDragScrollAll());
  startVisitTracking().catch((error) => console.warn("[1World] visits:", error.message));

  if (document.body.dataset.page === "home") {
    const { initHome } = await import("./home.js?v=20261116b");
    initHome().catch((error) => console.warn("[1World] homepage data:", error));
  }

  if (document.body.dataset.page === "watch") {
    const { initWatch } = await import("./watch.js?v=20261116c");
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
    const fresh = await refreshMember().catch(() => null);
    if (fresh) {
      noteSeen(fresh);
      syncFromMember(fresh);
    }
    startWalletPolling();
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
    startWalletPolling();
    toast({ tone: "success", iconName: "user", title: `Signed in as ${username}`, message: "Local preview session." });
    return member;
  },
};
