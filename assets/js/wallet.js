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
let pending = null;
let live = false;

export function levelCap(member = getMember()) {
  return capFor(member?.membership || "free");
}

export function renderWallet() {
  const member = getMember();
  const points = pointsValue(member);
  document.querySelectorAll("[data-wallet]").forEach((el) => {
    const valueEl = el.querySelector("[data-wallet-value]");
    const levelEl = el.querySelector("[data-wallet-level]");
    const info = member ? levelInfo({ points, membership: member.membership || "free", unlocked: member.level_unlocked }) : null;
    if (valueEl) valueEl.textContent = member ? num(points) : "—";
    if (levelEl) levelEl.textContent = member ? info.badge : "Guest";
    el.setAttribute(
      "aria-label",
      member ? `Your points: ${num(points)}, ${info.badge}, ${info.row.name}` : "Sign in to collect points"
    );
  });

  document.querySelectorAll("[data-level-fill]").forEach((el) => {
    const info = member ? levelInfo({ points: pointsValue(member), membership: member.membership || "free", unlocked: member.level_unlocked }) : null;
    el.style.width = `${info ? info.progressPct : 0}%`;
  });
  document.querySelectorAll("[data-level-cap]").forEach((el) => {
    const info = member ? levelInfo({ points: pointsValue(member), membership: member.membership || "free", unlocked: member.level_unlocked }) : null;
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

/**
 * Ask the server for the member's row, now, and paint what comes back.
 *
 * Several asks in the same breath are one ask: a like, a comment and a share
 * pressed in a row must not become three round trips, and the counter must not
 * be seen to step backwards as they land out of order.
 */
export function refreshWallet(delayMs = 120) {
  if (!getMember()) {
    renderWallet();
    return Promise.resolve(null);
  }
  if (pending) clearTimeout(pending);
  return new Promise((resolve) => {
    pending = setTimeout(async () => {
      pending = null;
      const fresh = await refreshMember().catch(() => null);
      if (fresh) syncFromMember(fresh);
      else renderWallet();
      resolve(fresh);
    }, delayMs);
  });
}

/**
 * Keep the counter live.
 *
 * Three things make it real time rather than *eventually* right: every call
 * that moves points says so (see `notePoints` in `data.js`), coming back to the
 * tab asks at once, and a slow poll is the safety net for a change made on
 * another device.
 */
export function watchWallet(intervalMs = 30000) {
  if (!live) {
    live = true;
    window.addEventListener("1w:points", () => refreshWallet());
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) refreshWallet(0);
    });
    window.addEventListener("focus", () => refreshWallet(0));
  }
  /* a member who signs in after the page was read starts the poll too */
  startWalletPolling(intervalMs);
}

export function startWalletPolling(intervalMs = 30000) {
  stopWalletPolling();
  if (!getMember()) return;
  noteSeen(getMember());
  pollHandle = setInterval(() => {
    if (document.hidden) return;
    refreshMember()
      .then((fresh) => {
        if (fresh) syncFromMember(fresh);
      })
      .catch(() => {});
  }, intervalMs);
}

export function stopWalletPolling() {
  if (pollHandle) clearInterval(pollHandle);
  pollHandle = null;
  if (pending) clearTimeout(pending);
  pending = null;
}

export { noteSeen };
