/**
 * Visit tracking.
 * ------------------------------------------------------------------
 * Two things are tracked separately:
 *   · `visit_id` — the browser session. It is minted when the site is opened and
 *     never changes afterwards, no matter how many pages are opened; a new one
 *     appears only when every page was closed (the browser was closed).
 *   · the row — one per page. Moving to another page adds a row carrying the
 *     same `visit_id`, with its own frequency, start date, end date and duration.
 *     Reloading the page that is already recorded adds nothing.
 *
 * How it is recognised (`localStorage["1w.visit.session"]`, shared by all tabs of
 * this browser):
 *   · every open tab registers itself and beats every 10 s
 *   · a page that loads while another tab is still open is part of the same stay
 *   · a page that loads less than 15 s after the last page closed is a reload or
 *     a navigation, not a new stay
 *   · the recorded `path` decides: same path = reload (row reused), other path =
 *     page change (new row)
 *
 * The row carries: visitor id (six digits), referrer, landing page, IP, country,
 * how many times this visitor has been seen, the purpose, the source and the
 * seconds spent on the site — `finish_visit()` moves the end date forward and
 * never shortens the duration.
 */

import { getMember, visitorId } from "./session.js";
import { rpc } from "./data.js";
import { SUPABASE } from "./config.js";
import { lookupVisitor, lookupVisitorFast } from "./geo.js";

const KEY = "1w.visit"; // this tab's copy, for the console
const SESSION_KEY = "1w.visit.session"; // shared by every tab
const TAB_KEY = "1w.visit.tab"; // one id per tab, survives a reload
const ERROR_KEY = "1w.visit.error";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEARTBEAT = 10000; // how often a tab says "still here"
const TAB_STALE = 150000; // a tab that missed beats for 2.5 min is gone (background throttling)
const REJOIN_GRACE = 15000; // page-to-page gap that still counts as the same visit

const state = {
  visitId: null, // the browser session id, shared by every row
  rowId: null, // this page's row
  memberRowId: null,
  memberVisitId: null,
  seconds: 0, // seconds counted by this page
  pending: 0, // counted but not yet written to the shared session
  startedAt: 0,
  sent: false,
  timer: null,
  beat: null,
  tab: null,
  page: "",
};

function purposeFor(page) {
  return ["register", "login", "actevite"].includes(page) ? "joining" : "watching";
}

function pageLocation() {
  return `${location.pathname}${location.search}`.slice(0, 2000);
}

/* ------------------------------------------------------------------ */
/* the shared visit session                                            */
/* ------------------------------------------------------------------ */
function tabId() {
  try {
    let id = sessionStorage.getItem(TAB_KEY);
    if (!id) {
      id = `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
      sessionStorage.setItem(TAB_KEY, id);
    }
    return id;
  } catch {
    return `m${Math.random().toString(36).slice(2, 10)}`;
  }
}

function readSession() {
  try {
    const saved = JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
    if (!saved || typeof saved !== "object") return null;
    if (!saved.tabs || typeof saved.tabs !== "object") saved.tabs = {};
    return saved;
  } catch {
    return null;
  }
}

function writeSession(session) {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {
    /* private mode — the visit simply restarts on the next page */
  }
}

function freshTabs(tabs = {}, now = Date.now()) {
  return Object.entries(tabs).filter(([, at]) => now - Number(at || 0) < TAB_STALE);
}

/** True when the stay is still running: another tab is open, or the last page just left. */
function sessionIsOpen(session, tab, now = Date.now()) {
  if (!session?.id) return false;
  const others = freshTabs(session.tabs, now).filter(([id]) => id !== tab);
  if (others.length) return true;
  const last = Math.max(Number(session.closedAt || 0), Number(session.lastSeen || 0));
  return Boolean(last) && now - last < REJOIN_GRACE;
}

function markTab(session, tab, now = Date.now()) {
  session.tabs = Object.fromEntries(freshTabs(session.tabs, now));
  session.tabs[tab] = now;
  session.lastSeen = now;
  delete session.closedAt;
  return session;
}

/** Registers this tab and optionally adds counted seconds to the shared total. */
function touchSession(deltaSeconds = 0) {
  const session = readSession();
  if (!session?.id) return;
  markTab(session, state.tab);
  if (deltaSeconds > 0) session.seconds = Number(session.seconds || 0) + deltaSeconds;
  writeSession(session);
}

/** Counted seconds of the whole stay, including the ones not written yet. */
function sessionSeconds() {
  const session = readSession();
  const shared = session?.id === state.visitId ? Number(session?.seconds || 0) : 0;
  return Math.max(shared + state.pending, state.seconds);
}

function flushPending() {
  if (!state.pending) return;
  const delta = state.pending;
  state.pending = 0;
  touchSession(delta);
}

/* ------------------------------------------------------------------ */
/* errors + per-tab copy                                               */
/* ------------------------------------------------------------------ */
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

/* ------------------------------------------------------------------ */
/* counting                                                            */
/* ------------------------------------------------------------------ */
// dwell time counts only while the visitor is really on the page: a hidden tab
// or another window in front of this one does not add seconds
let pageFocused = !document.hidden;

function tick() {
  if (document.hidden || !pageFocused) return;
  state.seconds += 1;
  state.pending += 1;
  if (state.pending >= 5) flushPending();
}

/**
 * Records the duration + end date of the visit so far. Safe to call as often as
 * needed: the server keeps the greatest duration and simply moves the end date,
 * so a tab that was hidden for a while can keep counting when it comes back.
 */
export function finishVisit({ keepalive = false } = {}) {
  if (!state.visitId && !state.memberVisitId) return;
  flushPending();
  const seconds = Math.max(0, sessionSeconds());
  rpc(
    "finish_visit",
    {
      p_visit: state.visitId,
      p_member_visit: state.memberVisitId,
      p_seconds: seconds,
      p_row: state.rowId, // one row = one page, so every page closes on its own
      p_member_row: state.memberRowId,
    },
    { keepalive }
  ).catch(() => {
    /* the next flush will carry the same total */
  });
}

/** This page is going away: drop the tab from the shared session. */
function leaveTab() {
  clearInterval(state.timer);
  clearInterval(state.beat);
  state.timer = null;
  state.beat = null;
  flushPending();
  const session = readSession();
  if (session?.id === state.visitId) {
    delete session.tabs?.[state.tab];
    session.closedAt = Date.now();
    session.lastSeen = Date.now();
    session.seconds = Math.max(Number(session.seconds || 0), state.seconds);
    writeSession(session);
  }
  finishVisit({ keepalive: true });
}

/* ------------------------------------------------------------------ */
/* boot                                                                */
/* ------------------------------------------------------------------ */
/** Boots the tracker for the current page. */
export async function startVisitTracking() {
  const page = document.body?.dataset.page || "home";
  const path = pageLocation();
  state.page = page;
  state.tab = tabId();
  state.startedAt = Date.now();

  state.timer = setInterval(tick, 1000);
  state.beat = setInterval(() => touchSession(0), HEARTBEAT);

  window.addEventListener("pagehide", leaveTab);
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) touchSession(0);
  });
  window.addEventListener("focus", () => {
    pageFocused = true;
  });
  window.addEventListener("blur", () => {
    pageFocused = false;
    flushPending();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      flushPending();
      finishVisit({ keepalive: true });
    }
  });

  // ---- 1. same page again (reload, or the page reopened) ------------
  // A visit is counted per page: reloading the page that is already recorded
  // keeps its visit_id, moving to another page starts a new visit row.
  const session = readSession();
  if (sessionIsOpen(session, state.tab) && session.path === path) {
    state.visitId = session.id || null;
    state.rowId = session.rowId || null;
    state.memberVisitId = session.memberId || null;
    state.memberRowId = session.memberRowId || null;
    state.seconds = Number(session.seconds || 0);
    markTab(session, state.tab);
    writeSession(session);
    remember(path, { visitId: state.visitId, memberVisitId: state.memberVisitId, seconds: state.seconds, continued: true });
    document.documentElement.dataset.visit = state.visitId || "direct-row";
    console.info("[1World] visit continued:", state.visitId, path);
    return;
  }

  // ---- 2. a new stay: one row for the whole session ------------------
  const member = getMember();
  // only a real member uuid can be written (the local demo session uses numbers)
  const memberId = UUID.test(member?.id || "") ? member.id : null;

  // the address and the country come from a geo-IP service; the row is written
  // either way, and annotated later if the lookup needs more than 2.5 s
  const geo = await lookupVisitorFast(2500);
  const payload = {
    p_visitor: visitorId(),
    p_link: document.referrer || null,
    p_page: path,
    p_purpose: purposeFor(page),
    p_source: "web",
    p_member: memberId,
    p_address: geo?.ip || null,
    p_country: geo?.country || null,
    p_code: geo?.code || null,
    // keep the browser session: the server only mints a new visit id when this
    // is empty, i.e. when the visitor opened the site after closing every page
    p_visit: sessionIsOpen(session, state.tab) ? session.id || null : null,
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
      state.rowId = result.row_id || null;
      state.memberVisitId = result.member_visit_id || null;
      state.memberRowId = result.member_row_id || null;
      remember(path, { visitId: state.visitId, memberVisitId: state.memberVisitId, seconds: 0 });
      clearFailure();

      // remember which page this visit covers: a reload of it will not add a row,
      // while any other page of the site starts its own visit
      if (state.visitId) {
        const now = Date.now();
        // keep the tabs that are still open, so the stay survives the page change
        const tabs = sessionIsOpen(session, state.tab, now) ? { ...markTab(session, state.tab, now).tabs } : {};
        tabs[state.tab] = now;
        writeSession({
          id: state.visitId,
          rowId: state.rowId,
          memberId: state.memberVisitId,
          memberRowId: state.memberRowId,
          startedAt: now,
          lastSeen: now,
          seconds: 0,
          path,
          tabs,
        });
      }

      // visible proof for the console: <html data-visit="visit000123">
      document.documentElement.dataset.visit = state.visitId || "direct-row";
      if (geo?.code || geo?.country) document.documentElement.dataset.country = geo.code || geo.country;
      console.info(
        payload.p_visit ? "[1World] page opened in visit:" : "[1World] visit started:",
        state.visitId || "(direct row)",
        path,
        geo?.ip ? `${geo.ip} · ${geo.country || geo.code || "?"}` : "(address pending)"
      );
      if (!geo?.ip) annotateLater();
    }
  } catch (error) {
    // a blocked request must never break the page
    if (!lastVisitError()) noteFailure("rpc", error);
    console.warn("[1World] visit logging:", error.message);
  }
}

/** Fills address + country once a slow geo-IP lookup finally answers. */
function annotateLater() {
  lookupVisitor()
    .then((geo) => {
      if (!geo?.ip || (!state.visitId && !state.memberVisitId)) return;
      document.documentElement.dataset.country = geo.code || geo.country || "";
      return rpc("annotate_visit", {
        p_visit: state.visitId,
        p_visitor: visitorId(),
        p_member_visit: state.memberVisitId,
        p_address: geo.ip,
        p_country: geo.country,
        p_code: geo.code,
        p_row: state.rowId,
        p_member_row: state.memberRowId,
      });
    })
    .catch(() => {
      /* the row simply stays without an address */
    });
}

/** A session id the browser can keep using while the RPC is unavailable. */
function localSessionId() {
  return `visit${String(Date.now()).slice(-9)}`;
}

/** Direct REST insert, used only when the RPC is unavailable. */
async function insertVisitRow(payload) {
  const sessionId = payload.p_visit || localSessionId();
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
        visit_id: sessionId,
        visitor_id: payload.p_visitor,
        visitor_link: payload.p_link,
        visitor_page: payload.p_page,
        visitor_address: payload.p_address,
        visitor_location: payload.p_country,
        visitor_country_code: payload.p_code,
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
  return { visit_id: sessionId, row_id: null, member_visit_id: null, member_row_id: null, fallback: true };
}

/** Debug/console surface: the shared session as stored. */
export function currentVisitSession() {
  return readSession();
}
