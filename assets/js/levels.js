/**
 * The level engine.
 *
 * Two inputs decide what a member is:
 *
 *   points      → the level itself (10, 100, 1 000 … 10 000 000 000)
 *   membership  → only the ceiling (free LV30, silver LV50, gold LV80, diamond open)
 *
 * The badge reads `LV` + level + the tens digit of the progress inside that
 * level, so **LV85** is level 8 with 50 % of the points to level 9 already
 * earned. `LV00` is a membership that has not collected a point yet, and
 * `LVMax` is the open-ended last level.
 *
 * Every threshold, every daily quota and every right in the platform reads
 * from `LEVELS` below — no page keeps its own copy.
 */

import { clamp } from "./utils.js";

/* ------------------------------------------------------------------ */
/* membership caps                                                     */
/* ------------------------------------------------------------------ */
export const MEMBERSHIP_CAPS = {
  free: 3,
  silver: 5,
  gold: 8,
  diamond: Infinity,
};

export const MEMBERSHIP_LABELS = {
  free: "Free",
  silver: "Silver",
  gold: "Gold",
  diamond: "Diamond",
};

export function capFor(membership = "free") {
  const key = String(membership || "free").toLowerCase();
  return MEMBERSHIP_CAPS[key] ?? MEMBERSHIP_CAPS.free;
}

/* ------------------------------------------------------------------ */
/* the ladder                                                          */
/* ------------------------------------------------------------------ */
/** Daily quotas and creation limits, derived from the level number. */
function quotas(level) {
  return {
    /** studio · blog · gallery · space · library · cinema · store products, each per day */
    content: level * 10,
    /** M3U / Xtream servers published per day */
    server: level,
    /** studios, blogs, galleries, spaces, libraries and cinemas a member may own */
    spaces: level,
    /** own stores — merchant and above only */
    stores: level >= 4 ? level : 0,
    /** communities a member may own */
    communities: level,
    /** prize / challenge / lottery entries per prize */
    prizeEntries: level >= 1 ? 1 : 0,
    /** tasks that must be done before the next level is granted */
    tasks: level,
  };
}

export const LEVELS = [
  {
    level: 0,
    points: 0,
    key: "scout",
    name: "Scout",
    nameAr: "مستكشف",
    membership: ["free"],
    months: null,
    interact: false,
    approval: false,
    summary: "Watch only: films, series, IPTV and every e-section, with nothing to publish.",
    rights: [
      "Watch films, series and IPTV channels",
      "Save to the automatic lists: completed, watch later, start later, not interested",
      "Save titles to favourite works",
      "Follow sections and profiles for future updates",
      "Browse e-studio, e-server, e-blog, e-gallery, e-space, e-library, e-cinema, e-store, auctions and community",
      "No comment, like, dislike or reshare",
      "No publishing, no prizes, no tasks",
    ],
    flags: { buy: false, sell: false, withdraw: false, bank: false, auctionBuy: "none", auctionSell: "none", auctionCreate: "none" },
  },
  {
    level: 1,
    points: 10,
    key: "participant",
    name: "Participant",
    nameAr: "مشارك",
    membership: ["free"],
    months: null,
    interact: true,
    approval: true,
    summary: "You can speak: comment, react and publish inside the sections, with moderator approval.",
    rights: [
      "Comment, like, dislike and follow sections",
      "Publish 10 items a day in e-studio, e-blog, e-gallery, e-space, e-library and e-cinema",
      "Publish 1 M3U file or Xtream server a day",
      "Own 1 community",
      "Enter one prize, challenge or lottery",
      "e-store, e-auction, super-auction and hyper-auction stay closed",
    ],
    flags: { buy: false, sell: false, withdraw: false, bank: false, auctionBuy: "none", auctionSell: "none", auctionCreate: "none" },
  },
  {
    level: 2,
    points: 100,
    key: "beneficiary",
    name: "Beneficiary",
    nameAr: "مستفيد",
    membership: ["free"],
    months: null,
    interact: true,
    approval: true,
    summary: "You can buy: the store and reviews open, and the daily quota doubles.",
    rights: [
      "Buy from e-store and market",
      "Publish buy lists (buylist.html) and product reviews (review.html)",
      "Publish 20 items a day in each e-section",
      "Publish 2 M3U files or Xtream servers a day",
      "Own 2 communities",
      "Two tasks before the next level",
    ],
    flags: { buy: true, sell: false, withdraw: false, bank: false, auctionBuy: "none", auctionSell: "none", auctionCreate: "none" },
  },
  {
    level: 3,
    points: 1000,
    key: "publisher",
    name: "Publisher",
    nameAr: "ناشر",
    membership: ["free"],
    months: 6,
    interact: true,
    approval: false,
    summary: "A publisher: your own e-studio, e-server, e-blog, e-gallery, e-space, e-library and e-cinema.",
    rights: [
      "Create up to 3 studios, servers, blogs, galleries, spaces, libraries and cinemas",
      "Publish 30 items a day in each e-section",
      "Publish 30 products a day — inside another member's store, not your own",
      "Own 3 communities",
      "Three tasks before the next level",
    ],
    flags: { buy: true, sell: true, withdraw: false, bank: false, auctionBuy: "none", auctionSell: "none", auctionCreate: "none" },
  },
  {
    level: 4,
    points: 10000,
    key: "merchant",
    name: "Merchant",
    nameAr: "تاجر",
    membership: ["silver"],
    months: 3,
    interact: true,
    approval: false,
    summary: "A merchant: your own stores, selling your products and the publishers' for a commission.",
    rights: [
      "Create up to 4 stores of your own",
      "Sell products published by other members and keep a percentage of the price",
      "Publish 40 products and 40 items a day in each e-section",
      "Publish 4 M3U files or Xtream servers a day",
      "Own 4 communities",
      "Four tasks before the next level",
    ],
    flags: { buy: true, sell: true, withdraw: false, bank: false, auctionBuy: "none", auctionSell: "none", auctionCreate: "none" },
  },
  {
    level: 5,
    points: 100000,
    key: "banker",
    name: "Banker",
    nameAr: "مصرفي",
    membership: ["silver"],
    months: 6,
    interact: true,
    approval: false,
    summary: "A banker: withdraw your points as real money for the first time.",
    rights: [
      "Withdraw points as money (withdraw)",
      "Create up to 5 stores",
      "Publish 50 items and 50 products a day",
      "Publish 5 M3U files or Xtream servers a day",
      "Own 5 communities",
      "Five tasks before the next level",
    ],
    flags: { buy: true, sell: true, withdraw: true, bank: false, auctionBuy: "none", auctionSell: "none", auctionCreate: "none" },
  },
  {
    level: 6,
    points: 1000000,
    key: "major",
    name: "Major",
    nameAr: "من الكبار",
    membership: ["gold"],
    months: 6,
    interact: true,
    approval: false,
    summary: "One of the big accounts: create an e-bank and convert other members' points for a fee.",
    rights: [
      "Convert other members' points into money against a percentage",
      "Create an e-bank",
      "Buy inside e-auction",
      "Create up to 6 stores",
      "Publish 60 items and 60 products a day",
      "Six tasks before the next level",
    ],
    flags: { buy: true, sell: true, withdraw: true, bank: true, auctionBuy: "auction", auctionSell: "none", auctionCreate: "none" },
  },
  {
    level: 7,
    points: 10000000,
    key: "elite",
    name: "Elite",
    nameAr: "نخبة",
    membership: ["gold"],
    months: 6,
    interact: true,
    approval: false,
    summary: "Elite: buy and sell in e-auction, and buy inside super-auction.",
    rights: [
      "Sell and buy inside e-auction",
      "Buy at super-auction",
      "Create up to 7 stores",
      "Publish 70 items and 70 products a day",
      "Own 7 communities",
      "Seven tasks before the next level",
    ],
    flags: { buy: true, sell: true, withdraw: true, bank: true, auctionBuy: "super", auctionSell: "auction", auctionCreate: "none" },
  },
  {
    level: 8,
    points: 100000000,
    key: "high-elite",
    name: "High elite",
    nameAr: "نخبة عالية",
    membership: ["diamond"],
    months: 12,
    interact: true,
    approval: false,
    summary: "Organise e-auction yourself, sell at super-auction and buy at hyper-auction.",
    rights: [
      "Create and organise an e-auction and open it to lower levels",
      "Sell inside super-auction",
      "Buy inside hyper-auction",
      "Create up to 8 stores",
      "Publish 80 items and 80 products a day",
      "Eight tasks before the next level",
    ],
    flags: { buy: true, sell: true, withdraw: true, bank: true, auctionBuy: "hyper", auctionSell: "super", auctionCreate: "auction" },
  },
  {
    level: 9,
    points: 1000000000,
    key: "premier",
    name: "Premier",
    nameAr: "نخبة عالية جدًا",
    membership: ["diamond"],
    months: 12,
    interact: true,
    approval: false,
    summary: "Create and run super-auction, and trade both ways inside hyper-auction.",
    rights: [
      "Create and organise super-auction",
      "Sell and buy inside hyper-auction",
      "Every e-auction right",
      "Create up to 9 stores",
      "Publish 90 items and 90 products a day",
      "Nine tasks before the next level",
    ],
    flags: { buy: true, sell: true, withdraw: true, bank: true, auctionBuy: "hyper", auctionSell: "hyper", auctionCreate: "super" },
  },
  {
    level: 10,
    points: 10000000000,
    key: "private-elite",
    name: "Private elite",
    nameAr: "نخبة خاصة",
    membership: ["diamond"],
    months: 12,
    interact: true,
    approval: false,
    summary: "Create and run hyper-auction — everything in the auction family is open.",
    rights: [
      "Create and organise hyper-auction",
      "Every right of the auctions below",
      "Create up to 10 stores",
      "Publish 100 items and 100 products a day",
      "Own 10 communities",
      "Ten tasks before the next level",
    ],
    flags: { buy: true, sell: true, withdraw: true, bank: true, auctionBuy: "hyper", auctionSell: "hyper", auctionCreate: "hyper" },
  },
  {
    level: "max",
    points: 100000000000,
    key: "supreme",
    name: "Supreme elite",
    nameAr: "نخبة خاصة جدًا",
    membership: ["diamond"],
    months: 12,
    interact: true,
    approval: false,
    summary: "No ceiling: every right, no daily limit, no cap on stores or communities.",
    rights: [
      "Everything, without a ceiling",
      "Unlimited publishing in every e-section",
      "Unlimited stores and communities",
      "Every auction, including creating hyper-auction",
    ],
    flags: { buy: true, sell: true, withdraw: true, bank: true, auctionBuy: "hyper", auctionSell: "hyper", auctionCreate: "hyper" },
  },
].map((row) => ({ ...row, quotas: row.level === "max" ? { content: Infinity, server: Infinity, spaces: Infinity, stores: Infinity, communities: Infinity, prizeEntries: 1, tasks: 1 } : quotas(row.level) }));

/* ------------------------------------------------------------------ */
/* reading the ladder                                                  */
/* ------------------------------------------------------------------ */
export function rowFor(level) {
  if (level === "max" || level === Infinity) return LEVELS[LEVELS.length - 1];
  return LEVELS.find((row) => row.level === Number(level)) || LEVELS[0];
}

/** The level the total points alone would give, ignoring the membership cap. */
export function levelForPoints(points = 0) {
  const value = Math.max(0, Number(points) || 0);
  let level = 0;
  for (const row of LEVELS) {
    if (value >= row.points) level = row.level;
  }
  return level;
}

/** `members.level` comes back as a number; 11 and above is the open level. */
export function storedLevel(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n >= LEVELS.length - 1 ? "max" : Math.trunc(n);
}

/**
 * What a level costs when it is bought instead of earned: the level's own
 * points threshold. LV1 10 · LV2 100 · LV3 1 000 … LVMax 100 000 000 000.
 */
export function unlockFee(level) {
  return rowFor(level).points;
}

/** The next level, when it can be bought now with the available balance. */
export function unlockOffer(info, available = 0) {
  if (!info || info.level === "max" || info.capped) return null;
  const next = nextLevel(info.level);
  if (!next) return null;
  const fee = unlockFee(next.level);
  const balance = Math.max(0, Number(available) || 0);
  return { level: next.level, fee, row: next, affordable: balance >= fee, balance };
}

export function nextLevel(level) {
  if (level === "max") return null;
  const index = LEVELS.findIndex((row) => row.level === Number(level));
  return index === -1 || index === LEVELS.length - 1 ? null : LEVELS[index + 1];
}

/** `LV85` — level, then the tens digit of the progress towards the next level. */
export function badgeFor(level, tens = 0, { capped = false } = {}) {
  if (level === "max") return "LVMax";
  const progress = capped ? 9 : clamp(Math.trunc(tens), 0, 9);
  return `LV${level}${progress}`;
}

/**
 * Everything a page needs in one call.
 *
 * @param {{points?: number, membership?: string, activated?: boolean}} input
 */
export function levelInfo({ points = 0, membership = "free", activated = true, unlocked = null } = {}) {
  const total = Math.max(0, Number(points) || 0);
  const paid = storedLevel(unlocked);
  const earned = levelForPoints(total);
  /* a level bought with points survives the drop that paying for it causes */
  const rawLevel =
    earned === "max" || paid === "max" ? "max" : Math.max(Number(earned) || 0, Number(paid) || 0);
  const cap = capFor(membership);
  const capped = cap !== Infinity && rawLevel !== "max" ? rawLevel > cap : rawLevel === "max" && cap !== Infinity;
  const level = capped ? cap : rawLevel;
  const row = rowFor(level);
  const next = nextLevel(level);
  const floor = row.points;
  const ceiling = next ? next.points : null;
  const share = ceiling ? clamp((total - floor) / Math.max(1, ceiling - floor), 0, 1) : 1;
  const cappedNow = capped || (cap !== Infinity && level === cap);
  const tens = cappedNow ? 9 : Math.min(9, Math.floor(share * 10));
  const badge = activated ? badgeFor(level, tens, { capped: cappedNow }) : "LV00";

  return {
    points: total,
    activated,
    level,
    rawLevel,
    row,
    next,
    cap,
    /** the membership is holding the level back */
    capped: cappedNow,
    capBadge: cap === Infinity ? "LVMax" : badgeFor(cap, 0),
    /** 0 – 100, rounded — a member held at the ceiling reads 100 */
    progressPct: cappedNow ? 100 : Math.round(share * 100),
    /** 0 – 9, the badge digit */
    progressTens: tens,
    badge,
    floor,
    ceiling,
    toNext: cappedNow || !next ? 0 : Math.max(0, next.points - total),
    /** every quota of the level, already capped */
    quotas: cappedNow ? rowFor(level).quotas : row.quotas,
  };
}

/** Short label for a list: `LV85 · High elite`. */
export function levelLabelFor(info) {
  return `${info.badge} · ${info.row.name}`;
}

/** The daily quota of one e-section at a level, after the membership cap. */
export function quotaFor(info, key) {
  const rows = info?.quotas || info?.row?.quotas || {};
  return rows[key] ?? 0;
}

/** Does this level unlock a right flag (`buy`, `withdraw`, `auctionCreate` …)? */
export function can(info, flag) {
  const row = info?.row || info || {};
  const value = row.flags?.[flag];
  return value === true || (typeof value === "string" && value !== "none");
}
