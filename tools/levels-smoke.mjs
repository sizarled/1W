/**
 * Level engine smoke test — no DOM, no network.
 *
 *   node tools/levels-smoke.mjs
 *
 * The rules under test, straight from the brief:
 *   · the points decide the level (10, 100, 1 000 … 100 000 000 000)
 *   · the membership only decides the ceiling (Free LV30, Silver LV50,
 *     Gold LV80, Diamond open)
 *   · the badge is LV + level + the tens digit of the progress, so LV85 is
 *     level 8 with half of the points to level 9 already earned
 *   · zero points is LV00, and the last level is LVMax
 */
import { LEVELS, levelForPoints, levelInfo, capFor, quotaFor, can, rowFor, unlockFee, unlockOffer, storedLevel } from "../assets/js/levels.js";

const checks = [];
const expect = (name, ok, detail = "") => checks.push({ name, ok: Boolean(ok), detail });
/* The level is paid for, never accumulated: these helpers model a member who
 * has already bought every level his points allow — that is the badge the
 * engine must print once the payment lands. */
const paid = (points, membership = "diamond", extra = {}) =>
  levelInfo({ points, membership, unlocked: levelForPoints(points), ...extra });
const badge = (points, membership = "diamond") => paid(points, membership).badge;

/* ------------------------------------------------------------------ */
/* the ladder                                                          */
/* ------------------------------------------------------------------ */
expect("ladder: twelve rows from LV00 to LVMax", LEVELS.length === 12, String(LEVELS.length));
expect(
  "ladder: thresholds are powers of ten",
  [10, 100, 1e3, 1e4, 1e5, 1e6, 1e7, 1e8, 1e9, 1e10, 1e11].every((value, index) => LEVELS[index + 1].points === value),
  LEVELS.map((row) => row.points).join(",")
);

const ladder = [
  [0, 0],
  [9, 0],
  [10, 1],
  [99, 1],
  [100, 2],
  [999, 2],
  [1000, 3],
  [9999, 3],
  [10000, 4],
  [100000, 5],
  [1000000, 6],
  [10000000, 7],
  [100000000, 8],
  [1000000000, 9],
  [10000000000, 10],
  [100000000000, "max"],
];
for (const [points, level] of ladder) {
  expect(`points ${points} → level ${level}`, levelForPoints(points) === level, String(levelForPoints(points)));
}

/* ------------------------------------------------------------------ */
/* the badge                                                           */
/* ------------------------------------------------------------------ */
expect("badge: zero points is LV00", badge(0) === "LV00", badge(0));
expect("badge: level 1 at 0 % is LV10", badge(10) === "LV10", badge(10));
expect("badge: level 8 at 50 % is LV85", badge(550000000) === "LV85", badge(550000000));
expect("badge: 10 % into level 2 is LV21", badge(190) === "LV21", badge(190));
expect("badge: 90 % into level 4 is LV49", badge(91000) === "LV49", badge(91000));
expect("badge: level 10 at 0 % is LV100", badge(10000000000) === "LV100", badge(10000000000));
expect("badge: the open level is LVMax", badge(100000000000) === "LVMax", badge(100000000000));
expect("badge: never shows a tenth tens digit", badge(99999) === "LV49", badge(99999));

const half = paid(550000000, "diamond");
expect("progress: 50 % inside level 8", half.progressPct === 50, String(half.progressPct));
expect("progress: the digit is 5", half.progressTens === 5, String(half.progressTens));
expect("progress: the next level is 9", half.next.level === 9, String(half.next?.level));
expect("progress: points to level 9", half.toNext === 450000000, String(half.toNext));

/* ------------------------------------------------------------------ */
/* the ceiling                                                         */
/* ------------------------------------------------------------------ */
expect("caps: free LV30", capFor("free") === 3);
expect("caps: silver LV50", capFor("silver") === 5);
expect("caps: gold LV80", capFor("gold") === 8);
expect("caps: diamond is open", capFor("diamond") === Infinity);
expect("caps: an unknown plan behaves like free", capFor("platinum") === 3);

const freeHeld = paid(1e9, "free");
expect("cap: a free member with a billion points stays at level 3", freeHeld.level === 3, String(freeHeld.level));
expect("cap: the badge shows the ceiling", freeHeld.badge === "LV39", freeHeld.badge);
expect("cap: flagged as capped", freeHeld.capped === true);
expect("cap: the cap badge is printed", freeHeld.capBadge === "LV30", freeHeld.capBadge);
expect("cap: the bar reads full", freeHeld.progressPct === 100, String(freeHeld.progressPct));
expect("cap: nothing left to climb", freeHeld.toNext === 0, String(freeHeld.toNext));

const silverHeld = paid(1e9, "silver");
expect("cap: silver stops at level 5", silverHeld.level === 5 && silverHeld.badge === "LV59", silverHeld.badge);

const goldFree = paid(1200, "gold");
expect("cap: a low level is not capped by a high plan", goldFree.capped === false);
expect("cap: the badge is the earned one", goldFree.badge === "LV30", goldFree.badge);

const diamondTop = paid(1e11, "diamond");
expect("cap: diamond reaches LVMax", diamondTop.badge === "LVMax" && diamondTop.capped === false, diamondTop.badge);

/* ------------------------------------------------------------------ */
/* rights and quotas                                                   */
/* ------------------------------------------------------------------ */
expect("rights: LV00 cannot interact", rowFor(0).interact === false);
expect("rights: LV00 can browse the e-sections", /Browse e-studio/.test(rowFor(0).rights.join(" ")));
expect("rights: LV10 interacts", rowFor(1).interact === true);
expect("rights: LV10 publishes with approval", rowFor(1).approval === true);
expect("rights: LV30 is a publisher", rowFor(3).approval === false && /Publisher/.test(rowFor(3).name));
expect("rights: LV40 keeps stores", rowFor(4).quotas.stores === 4);
expect("rights: LV30 has no store", rowFor(3).quotas.stores === 0);
expect("rights: LV50 can withdraw", can(rowFor(5), "withdraw") === true && can(rowFor(4), "withdraw") === false);
expect("rights: LV60 buys at the auction", rowFor(6).flags.auctionBuy === "auction");
expect("rights: LV80 creates the auction", rowFor(8).flags.auctionCreate === "auction");
expect("rights: LV90 creates super-auction", rowFor(9).flags.auctionCreate === "super");
expect("rights: LV100 creates hyper-auction", rowFor(10).flags.auctionCreate === "hyper");

expect("quotas: LV10 ten a day", quotaFor(rowFor(1), "content") === 10 && rowFor(1).quotas.server === 1);
expect("quotas: LV30 thirty a day", quotaFor(rowFor(3), "content") === 30 && rowFor(3).quotas.tasks === 3);
expect("quotas: LV80 eighty a day", quotaFor(rowFor(8), "content") === 80 && rowFor(8).quotas.communities === 8);
expect("quotas: LVMax has no ceiling", rowFor("max").quotas.content === Infinity);
expect("quotas: tasks grow with the level", LEVELS.slice(1, 11).every((row, index) => row.quotas.tasks === index + 1));
expect("quotas: one prize entry per prize from LV10", rowFor(1).quotas.prizeEntries === 1 && rowFor(0).quotas.prizeEntries === 0);
expect("labels: the Arabic actor names are kept", rowFor(0).nameAr === "مستكشف" && rowFor(3).nameAr === "ناشر");

/* ------------------------------------------------------------------ */
/* unlock now — the level is granted by the payment, never by points   */
/* ------------------------------------------------------------------ */
const FEES = [10, 100, 1e3, 1e4, 1e5, 1e6, 1e7, 1e8, 1e9, 1e10, 1e11];
expect(
  "unlock: the fee table is the ladder",
  FEES.every((fee, index) => unlockFee(index + 1) === fee) && unlockFee("max") === 1e11,
  FEES.map((fee, index) => unlockFee(index + 1)).join(",")
);

/* points alone never give a level */
const unpaid = levelInfo({ points: 20000, membership: "gold" });
expect("pay: points alone give no level", unpaid.level === 0 && unpaid.badge === "LV09", unpaid.badge);
expect("pay: the points still say which level is earned", unpaid.earnedLevel === 4, String(unpaid.earnedLevel));
expect("pay: the earned rung can be unlocked", unpaid.eligible === true);

/* the offer needs the rung to be earned */
{
  const poor = levelInfo({ points: 5, membership: "gold" });
  expect("unlock: nothing offered before the points are reached", unlockOffer(poor, 1e6) === null);
  expect("unlock: ten points open LV10", unlockOffer(levelInfo({ points: 10 }), 10)?.level === 1);
  const rich = levelInfo({ points: 12000, membership: "gold", unlocked: 3 });
  const offer = unlockOffer(rich, 2000);
  expect("unlock: the next rung is LV40", offer?.level === 4, String(offer?.level));
  expect("unlock: its fee is 10 000", offer?.fee === 10000, String(offer?.fee));
  expect("unlock: two thousand is not enough, and it says so", offer?.affordable === false && offer?.missing === 8000, String(offer?.missing));
  const covered = unlockOffer(levelInfo({ points: 12000, membership: "gold", unlocked: 3 }), 12000);
  expect("unlock: a covered balance opens the payment", covered?.affordable === true && covered?.missing === 0);
}

expect(
  "unlock: a capped member is not offered a rung past the ceiling",
  unlockOffer(levelInfo({ points: 1e9, membership: "free", unlocked: 3 }), 1e9) === null
);
expect("unlock: LVMax is the end", unlockOffer(levelInfo({ points: 1e12, membership: "diamond", unlocked: 11 }), 1e12) === null);

/* the paid level survives the payment that lowers the balance */
{
  const bought = levelInfo({ points: 900, membership: "gold", unlocked: 4 });
  expect("pay: the bought level stands after the points are spent", bought.level === 4 && bought.badge.startsWith("LV4"), bought.badge);
  expect("pay: stored 11 is the open level", storedLevel(11) === "max" && storedLevel(4) === 4 && storedLevel(0) === 0);
  const capped = levelInfo({ points: 1e7, membership: "free", unlocked: 6 });
  expect("pay: the membership ceiling still caps a bought level", capped.level === 3 && capped.capped === true, `${capped.level}`);
  expect("pay: paying never happens twice for one rung", unlockOffer(levelInfo({ points: 1e7, membership: "free", unlocked: 3 }), 1e9) === null);
}

/* ------------------------------------------------------------------ */
const failed = checks.filter((c) => !c.ok);
console.log(`levels smoke: ${checks.length - failed.length}/${checks.length}`);
failed.forEach((c) => console.log(`  ✗ ${c.name}${c.detail ? ` — ${c.detail}` : ""}`));
if (failed.length) process.exit(1);
