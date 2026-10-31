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
import { SUPABASE } from "./config.js";

const KEY = "1w.visit";
const ERROR_KEY = "1w.visit.error";
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

/** Last failed attempt, kept for debugging: localStorage["1w.visit.error"]. */
function noteFailure(stage, error, extra = {}) {
  try {
    localStorage.setItem(
      ERROR_KEY,
      JSON.stringify({
        at: new Date().toISOString(),
        stage,
        message: error?.message || String(error),
        status: error?.status || extra.status || null,
        body: error?.body || extra.body || null,
        path: pageLocation(),
      })
    );
  } catch {
    /* ignore */
  }
}

/** Reads the last failure (null when the last attempt worked). */
export function lastVisitError() {
  try {
    return JSON.parse(localStorage.getItem(ERROR_KEY) || "null");
  } catch {
    return null;
  }
}

function clearFailure() {
  try {
    localStorage.removeItem(ERROR_KEY);
  } catch {
    /* ignore */
  }
}

// dwell time counts only while the visitor is really on the page: a hidden tab
// or another window in front of this one does not add seconds
let pageFocused = !document.hidden;

function tick() {
  if (document.hidden || !pageFocused) return;
  state.seconds += 1;
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
  window.addEventListener("focus", () => {
    pageFocused = true;
  });
  window.addEventListener("blur", () => {
    pageFocused = false;
  });
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
  const payload = {
    p_visitor: visitorId(),
    p_link: document.referrer || null,
    p_location: path,
    p_purpose: purposeFor(page),
    p_source: "web",
    p_member: memberId,
  };

  try {
    let result = null;
    try {
      result = await rpc("log_visit", payload);
    } catch (rpcError) {
      // the function may be missing from the API schema cache — fall back to the
      // table itself (it accepts anonymous inserts through its RLS policy)
      result = await insertVisitRow(payload);
      if (!result) {
        noteFailure("insert", rpcError);
        throw rpcError;
      }
    }
    if (result && typeof result === "object") {
      state.visitId = result.visit_id || null;
      state.memberVisitId = result.member_visit_id || null;
      remember(path, { visitId: state.visitId, memberVisitId: state.memberVisitId, seconds: 0 });
      clearFailure();
      // visible proof for the console: <html data-visit="visit000123">
      document.documentElement.dataset.visit = state.visitId || "direct-row";
      console.info("[1World] visit logged:", state.visitId || "(direct row)", path);
    }
  } catch (error) {
    // a blocked request must never break the page
    if (!lastVisitError()) noteFailure("rpc", error);
    console.warn("[1World] visit logging:", error.message);
  }
}

/** Direct REST insert, used only when the RPC is unavailable. */
async function insertVisitRow(payload) {
  const res = await fetch(`${SUPABASE.restUrl}/visitor_visits`, {
    method: "POST",
    headers: {
      apikey: SUPABASE.publishableKey,
      Authorization: `Bearer ${SUPABASE.publishableKey}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify([
      {
        visitor_id: payload.p_visitor,
        visitor_link: payload.p_link,
        visitor_location: payload.p_location,
        visitor_frequency: 1,
        visitor_purpose: payload.p_purpose,
        visitor_source: payload.p_source,
      },
    ]),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const error = new Error(`insert visitor_visits ${res.status} ${text.slice(0, 180)}`);
    error.status = res.status;
    error.body = text.slice(0, 400);
    throw error;
  }
  return { visit_id: null, member_visit_id: null, fallback: true };
}
