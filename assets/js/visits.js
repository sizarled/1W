/**
 * Visit tracking.
 * ------------------------------------------------------------------
 * Every page load writes one row to `visitor_visits` (and to `member_visits`
 * when a member session exists) through the `log_visit()` function, then closes
 * it with `finish_visit()` when the page is hidden or closed.
 *
 * The row carries: visitor id (six digits), referrer, page path, how many times
 * this visitor has been seen, the purpose (watching / joining), the source and
 * the seconds spent on the page.
 */

import { getMember, visitorId } from "./session.js";
import { rpc } from "./data.js";

const KEY = "1w.visit";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MIN_GAP = 12000; // ignore a second log for the same page within 12 s

const state = {
  visitId: null,
  memberVisitId: null,
  seconds: 0,
  startedAt: 0,
  sent: false,
  timer: null,
};

function purposeFor(page) {
  return ["register", "login", "actevite"].includes(page) ? "joining" : "watching";
}

function pageLocation() {
  return `${location.pathname}${location.search}`.slice(0, 2000);
}

function recentLog(path) {
  try {
    const saved = JSON.parse(sessionStorage.getItem(KEY) || "null");
    if (saved && saved.path === path && Date.now() - saved.at < MIN_GAP) return saved;
  } catch {
    /* ignore */
  }
  return null;
}

function remember(path, payload) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ path, at: Date.now(), ...payload }));
  } catch {
    /* ignore */
  }
}

function tick() {
  if (!document.hidden) state.seconds += 1;
}

/** Sends the closing frame: duration + end date. Safe to call more than once. */
export function finishVisit({ keepalive = false } = {}) {
  if (!state.visitId && !state.memberVisitId) return;
  if (state.sent) return;
  state.sent = true;
  clearInterval(state.timer);
  const seconds = Math.max(0, state.seconds);
  rpc(
    "finish_visit",
    { p_visit: state.visitId, p_member_visit: state.memberVisitId, p_seconds: seconds },
    { keepalive }
  ).catch(() => {
    state.sent = false;
  });
}

/** Boots the tracker for the current page. */
export async function startVisitTracking() {
  const page = document.body?.dataset.page || "home";
  const path = pageLocation();
  const previous = recentLog(path);

  state.startedAt = Date.now();
  state.timer = setInterval(tick, 1000);

  window.addEventListener("pagehide", () => finishVisit({ keepalive: true }));
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) finishVisit({ keepalive: true });
  });

  if (previous?.visitId) {
    // same page reopened moments ago — continue that row instead of adding one
    state.visitId = previous.visitId;
    state.memberVisitId = previous.memberVisitId || null;
    state.seconds = Number(previous.seconds || 0);
    return;
  }

  const member = getMember();
  // only a real member uuid can be written (the local demo session uses numbers)
  const memberId = UUID.test(member?.id || "") ? member.id : null;
  try {
    const result = await rpc("log_visit", {
      p_visitor: visitorId(),
      p_link: document.referrer || null,
      p_location: path,
      p_purpose: purposeFor(page),
      p_source: "web",
      p_member: memberId,
    });
    if (result && typeof result === "object") {
      state.visitId = result.visit_id || null;
      state.memberVisitId = result.member_visit_id || null;
      remember(path, { visitId: state.visitId, memberVisitId: state.memberVisitId, seconds: 0 });
    }
  } catch (error) {
    // a blocked request must never break the page
    console.warn("[1World] visit logging:", error.message);
  }
}
