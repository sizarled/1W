/**
 * Points & level wallet shown in the header.
 * Reads from the `members` row, reacts to OneW.awardPoints() and to any
 * points change picked up from Supabase while the page is open.
 */
import { getMember, setMember, consumeChanges, noteSeen, refreshMember, levelLabel, pointsValue } from "./session.js";
import { pointsToast, levelToast } from "./ui.js";
import { num } from "./utils.js";
import { capFor, levelInfo } from "./levels.js";

let pollHandle = null;

export function levelCap(member = getMember()) {
  return capFor(member?.membership || "free");
}

export function renderWallet() {
  const member = getMember();
  const points = pointsValue(member);
  document.querySelectorAll("[data-wallet]").forEach((el) => {
    const valueEl = el.querySelector("[data-wallet-value]");
    const levelEl = el.querySelector("[data-wallet-level]");
    const info = member ? levelInfo({ points, membership: member.membership || "free" }) : null;
    if (valueEl) valueEl.textContent = member ? num(points) : "—";
    if (levelEl) levelEl.textContent = member ? info.badge : "Guest";
    el.setAttribute(
      "aria-label",
      member ? `Your points: ${num(points)}, ${info.badge}, ${info.row.name}` : "Sign in to collect points"
    );
  });

  document.querySelectorAll("[data-level-fill]").forEach((el) => {
    const info = member ? levelInfo({ points: pointsValue(member), membership: member.membership || "free" }) : null;
    el.style.width = `${info ? info.progressPct : 0}%`;
  });
  document.querySelectorAll("[data-level-cap]").forEach((el) => {
    const info = member ? levelInfo({ points: pointsValue(member), membership: member.membership || "free" }) : null;
    if (!info) {
      el.textContent = "Guest";
      return;
    }
    el.textContent = `${info.badge} / ${info.capBadge}${info.capped ? " · cap" : ""}`;
  });
  document.querySelectorAll("[data-member-points]").forEach((el) => {
    el.textContent = member ? num(points) : "0";
  });
}

function bumpWallet() {
  document.querySelectorAll("[data-wallet]").forEach((el) => {
    el.classList.add("is-bump");
    setTimeout(() => el.classList.remove("is-bump"), 800);
  });
}

/**
 * Credit (or debit, with a negative delta) points to the signed-in member.
 * Other pages can call:  OneW.awardPoints(120, "Review published")
 */
export function awardPoints(delta, reason = "") {
  const member = getMember();
  if (!member) {
    pointsToast(delta, reason || "Sign in to keep your points");
    return false;
  }
  member.points = Math.max(0, (Number(member.points) || 0) + Number(delta));
  setMember(member);
  noteSeen(member);
  renderWallet();
  bumpWallet();
  pointsToast(delta, reason);
  return true;
}

/** Compare the current row against what the UI last showed. */
export function syncFromMember(member = getMember()) {
  if (!member) return;
  const changes = consumeChanges(member);
  renderWallet();
  if (changes.deltaPoints > 0) {
    bumpWallet();
    pointsToast(changes.deltaPoints, "Added to your account");
  }
  if (changes.levelUp) levelToast(changes.level);
}

export function startWalletPolling(intervalMs = 45000) {
  stopWalletPolling();
  if (!getMember()) return;
  noteSeen(getMember());
  pollHandle = setInterval(async () => {
    if (document.hidden) return;
    const fresh = await refreshMember();
    if (fresh) syncFromMember(fresh);
  }, intervalMs);
}

export function stopWalletPolling() {
  if (pollHandle) clearInterval(pollHandle);
  pollHandle = null;
}

export { noteSeen };
