/**
 * Entry point for every page.
 * Mounts the shell, restores the session and, on the homepage, boots the
 * section controllers.
 */
import { mountShell } from "./shell.js";
import { getMember, refreshMember, setMember, signOut, noteSeen } from "./session.js";
import { awardPoints, renderWallet, startWalletPolling, syncFromMember } from "./wallet.js";
import { toast } from "./ui.js";
import { avatarPlaceholder, enableDragScrollAll } from "./utils.js";
import { startVisitTracking, finishVisit, lastVisitError } from "./visits.js?v=20261031c";
import { initTheme, setTheme, toggleTheme, resetTheme, currentTheme, systemTheme } from "./theme.js";

async function boot() {
  mountShell();
  enableDragScrollAll();
  startVisitTracking().catch((error) => console.warn("[1World] visits:", error.message));

  if (document.body.dataset.page === "home") {
    const { initHome } = await import("./home.js");
    initHome().catch((error) => console.warn("[1World] homepage data:", error));
  }

  if (document.body.dataset.page === "watch") {
    const { initWatch } = await import("./watch.js");
    initWatch().catch((error) => console.warn("[1World] watch page:", error));
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
