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
import { loadMember } from "./data.js";

const VISITOR_KEY = "1w.visitor";
const MEMBER_KEY = "1w.member";
const SEEN_POINTS = "1w.points.seen";
const SEEN_LEVEL = "1w.level.seen";

export function visitorId() {
  let id = store.get(VISITOR_KEY);
  if (!id || !/^\d{6}$/.test(String(id))) {
    id = randomId(6);
    store.set(VISITOR_KEY, id);
  }
  return id;
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
  store.remove(MEMBER_KEY);
  store.remove(SEEN_POINTS);
  store.remove(SEEN_LEVEL);
  window.dispatchEvent(new CustomEvent("1w:session", { detail: null }));
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
  const lvl = Number(member.level) || 1;
  return `LV ${lvl}`;
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
