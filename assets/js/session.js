/**
 * Session state.
 * ------------------------------------------------------------------
 * Visitors get a persistent 6-digit id:            Visitor - 482913
 * Signed-in members are stored as `1w.member`:     Member - 000482
 *
 * Auth pages (login.html / register.html) are expected to call
 * OneW.setMember({ id, username, level, points, membership, avatar }).
 * This module only reads the session — it never invents one.
 */
import { store, randomId, avatarPlaceholder } from "./utils.js";
import { levelInfo } from "./levels.js";
import { loadMember } from "./data.js";

const VISITOR_KEY = "1w.visitor";
const VISITOR_COOKIE = "1w_vid";
const VISITOR_MAX_AGE = 2 * 365 * 24 * 3600; // two years
const MEMBER_KEY = "1w.member";
const SEEN_POINTS = "1w.points.seen";
const SEEN_LEVEL = "1w.level.seen";

let visitorMemory = null; // survives a browser that refuses storage

function sixDigits(value) {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (!/^\d{6}$/.test(digits) || digits === "000000") return null;
  return digits;
}

function readVisitorCookie() {
  try {
    const entry = document.cookie
      .split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${VISITOR_COOKIE}=`));
    if (!entry) return null;
    return sixDigits(decodeURIComponent(entry.slice(VISITOR_COOKIE.length + 1)));
  } catch {
    return null;
  }
}

function writeVisitorCookie(id) {
  try {
    const secure = location.protocol === "https:" ? "; Secure" : "";
    document.cookie = `${VISITOR_COOKIE}=${id}; Max-Age=${VISITOR_MAX_AGE}; Path=/; SameSite=Lax${secure}`;
  } catch {
    /* cookies blocked — localStorage still holds the id */
  }
}

/**
 * The visitor id never changes for the same browser:
 *   localStorage["1w.visitor"] → cookie "1w_vid" (2 years) → a new number.
 * It is written back to both stores, and kept in memory when a browser blocks
 * storage entirely, so a page reload can never mint a second identity.
 */
export function visitorId() {
  if (visitorMemory) return visitorMemory;
  const id = sixDigits(store.get(VISITOR_KEY)) || readVisitorCookie() || sixDigits(randomId(6)) || "482913";
  visitorMemory = id;
  store.set(VISITOR_KEY, id);
  writeVisitorCookie(id);
  return id;
}

/** True when this browser already had an identity (used by the UI / tests). */
export function visitorKnown() {
  return Boolean(sixDigits(store.get(VISITOR_KEY)) || readVisitorCookie());
}

export function getMember() {
  const member = store.get(MEMBER_KEY, null);
  if (!member || !member.id) return null;
  return member;
}

export function setMember(member) {
  if (!member || !member.id) return;
  store.set(MEMBER_KEY, member);
  window.dispatchEvent(new CustomEvent("1w:session", { detail: member }));
}

export function signOut() {
  clearSessionToken();
  store.remove(MEMBER_KEY);
  store.remove(SEEN_POINTS);
  store.remove(SEEN_LEVEL);
  window.dispatchEvent(new CustomEvent("1w:session", { detail: null }));
}

/* ------------------------------------------------------------------ */
/* server session token                                                */
/* ------------------------------------------------------------------ */
const SESSION_KEY = "1w.session";
let sessionTokenMemory = "";

/**
 * The login page trades the password for a session token. The token is kept
 * in localStorage when "stay signed in" was chosen (30 days) and in
 * sessionStorage otherwise (the server expires it after 12 hours).
 */
export function setSessionToken(token, remember = false) {
  if (!token) return;
  sessionTokenMemory = token;
  try {
    if (remember) {
      localStorage.setItem(SESSION_KEY, token);
      sessionStorage.removeItem(SESSION_KEY);
    } else {
      sessionStorage.setItem(SESSION_KEY, token);
      localStorage.removeItem(SESSION_KEY);
    }
  } catch {
    /* storage blocked — the token still lives in memory for this page */
  }
}

export function sessionToken() {
  if (sessionTokenMemory) return sessionTokenMemory;
  try {
    return sessionStorage.getItem(SESSION_KEY) || localStorage.getItem(SESSION_KEY) || "";
  } catch {
    return "";
  }
}

export function clearSessionToken() {
  sessionTokenMemory = "";
  try {
    sessionStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(SESSION_KEY);
  } catch {
    /* nothing to clear */
  }
}

/** Pull the authoritative row from Supabase and merge it in. */
export async function refreshMember() {
  const local = getMember();
  if (!local) return null;
  const fresh = await loadMember(local.id).catch(() => null);
  if (!fresh) return local;

  const raw = fresh.raw || {};
  const hasServerPoints = ["points", "balance", "credit"].some((k) => raw[k] !== undefined && raw[k] !== null);
  const merged = {
    ...local,
    ...fresh,
    points: hasServerPoints ? fresh.points : local.points ?? 0,
    avatar: fresh.avatar || local.avatar || "",
    username: fresh.username || local.username,
    level: fresh.level || local.level || 1,
    membership: fresh.membership || local.membership || "free",
  };
  store.set(MEMBER_KEY, merged);
  return merged;
}

export const PREMIUM_TIERS = ["silver", "gold", "diamond"];

export function isPremium(member = getMember()) {
  if (!member) return false;
  return PREMIUM_TIERS.includes(String(member.membership || "").toLowerCase());
}

export function displayName(member = getMember()) {
  if (!member) return "Visitor";
  return String(member.username || member.name || "Member").replace(/^@/, "");
}

export function memberCode(member = getMember()) {
  if (!member) return visitorId();
  const digits = String(member.id ?? "").replace(/\D/g, "");
  if (digits.length >= 6) return digits.slice(-6);
  return digits.padStart(6, "0") || String(visitorId());
}

export function avatarFor(member = getMember(), name = "Visitor") {
  if (member && member.avatar) return member.avatar;
  return avatarPlaceholder(member ? displayName(member) : name);
}

export function levelLabel(member = getMember()) {
  if (!member) return "Guest";
  return levelInfo({
    points: Number(member.points) || 0,
    membership: member.membership || "free",
  }).badge;
}

export function pointsValue(member = getMember()) {
  if (!member) return null;
  return Number(member.points) || 0;
}

/* ------------------------------------------------------------------ */
/* Change detection (drives the "+points" banner and level-up sound)  */
/* ------------------------------------------------------------------ */
export function noteSeen(member = getMember()) {
  if (!member) return;
  store.set(SEEN_POINTS, Number(member.points) || 0);
  store.set(SEEN_LEVEL, Number(member.level) || 1);
}

export function consumeChanges(member = getMember()) {
  if (!member) return { points: 0, level: 0, deltaPoints: 0 };
  const prevPoints = store.get(SEEN_POINTS, null);
  const prevLevel = store.get(SEEN_LEVEL, null);
  const points = Number(member.points) || 0;
  const level = Number(member.level) || 1;

  store.set(SEEN_POINTS, points);
  store.set(SEEN_LEVEL, level);

  if (prevPoints === null) return { points, level, deltaPoints: 0 };
  return {
    points,
    level,
    deltaPoints: points - Number(prevPoints),
    levelUp: prevLevel !== null && level > Number(prevLevel),
  };
}
