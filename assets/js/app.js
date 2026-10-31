/**
 * Entry point for every page.
 * Mounts the shell, restores the session and, on the homepage, boots the
 * section controllers.
 */
import { mountShell } from "./shell.js";
import { getMember, refreshMember, setMember, signOut, noteSeen } from "./session.js";
import { awardPoints, renderWallet, startWalletPolling, syncFromMember } from "./wallet.js";
import { toast } from "./ui.js";
import { avatarPlaceholder } from "./utils.js";

async function boot() {
  mountShell();

  if (document.body.dataset.page === "home") {
    const { initHome } = await import("./home.js");
    initHome().catch((error) => console.warn("[1World] homepage data:", error));
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
