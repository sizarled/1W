# Levels — points decide the level, membership decides the ceiling

Everything below is implemented in **[`assets/js/levels.js`](../assets/js/levels.js)** and nothing
else keeps a copy of the ladder. The badge in the header, the sidebar meter, the login card, the
profile flag and the dashboard level page all read from `levelInfo()`.

## The badge

```
LV  8  5
│   │  └── tens digit of the progress towards the next level  (5 = 50 %)
│   └───── the level itself
└───────── always LV
```

| Badge | Meaning |
| --- | --- |
| `LV00` | the level-0 member: activated, no points yet — or an account that is not activated |
| `LV10` | level 1, 0 % of the way to level 2 |
| `LV23` | level 2, between 30 % and 39 % of the way to level 3 |
| `LV85` | level 8, 50 % of the points needed for level 9 |
| `LV100` | level 10, 0 % |
| `LVMax` | past 100 000 000 000 points — the open level |

The digit is `floor(percent / 10)`, so it never reaches 10: a progress of 99 % still prints 9.

## The ladder

| Level | Badge at 0 % | Points needed | Actor |
| --- | --- | --- | --- |
| 0 | `LV00` | 0 — activation only | Scout · مستكشف |
| 1 | `LV10` | 10 | Participant · مشارك |
| 2 | `LV20` | 100 | Beneficiary · مستفيد |
| 3 | `LV30` | 1 000 | Publisher · ناشر |
| 4 | `LV40` | 10 000 | Merchant · تاجر |
| 5 | `LV50` | 100 000 | Banker · مصرفي |
| 6 | `LV60` | 1 000 000 | Major · من الكبار |
| 7 | `LV70` | 10 000 000 | Elite · نخبة |
| 8 | `LV80` | 100 000 000 | High elite · نخبة عالية |
| 9 | `LV90` | 1 000 000 000 | Premier · نخبة عالية جدًا |
| 10 | `LV100` | 10 000 000 000 | Private elite · نخبة خاصة |
| Max | `LVMax` | 100 000 000 000 | Supreme elite · نخبة خاصة جدًا |

The threshold of level *n* is `10^n`; the open level starts at `10^11`.

## The ceiling

The membership never raises or lowers the level, it only stops the climb:

| Membership | Ceiling | A member with more points than the ceiling |
| --- | --- | --- |
| Free | `LV30` | held at level 3, badge `LV39`, meter full, “cap” chip |
| Silver | `LV50` | held at level 5, badge `LV59` |
| Gold | `LV80` | held at level 8, badge `LV89` |
| Diamond | open | reaches `LVMax` |

A capped member keeps the points — upgrading the membership grants the level immediately, because
the level was always the points'. `levelInfo()` returns `capped`, `capBadge` and a full progress
bar in that state, and the dashboard level page says so in one sentence.

## Quotas, per level

| Level | Publish per day (each e-section) | M3U / Xtream per day | Own spaces | Own stores | Communities | Task before the next level |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | — | — | — | — | — | — |
| 1 | 10 | 1 | 0 | 0 | 1 | 1 |
| 2 | 20 | 2 | 0 | 0 | 2 | 2 |
| 3 | 30 | 3 | 3 | 0 | 3 | 3 |
| 4 | 40 | 4 | 4 | 4 | 4 | 4 |
| 5 | 50 | 5 | 5 | 5 | 5 | 5 |
| 6 | 60 | 6 | 6 | 6 | 6 | 6 |
| 7 | 70 | 7 | 7 | 7 | 7 | 7 |
| 8 | 80 | 8 | 8 | 8 | 8 | 8 |
| 9 | 90 | 9 | 9 | 9 | 9 | 9 |
| 10 | 100 | 10 | 10 | 10 | 10 | 10 |
| Max | unlimited | unlimited | unlimited | unlimited | unlimited | — |

One prize / challenge / lottery entry per prize from level 1 onward.

## Rights, level by level

| Level | What opens |
| --- | --- |
| 0 | Watch films, series and IPTV; the automatic lists (completed, watch later, start later, not interested) and favourite works; follow sections; browse every e-section. No comment, no reaction, no reshare, no publishing, no prizes, no tasks. |
| 1 | Comment / like / dislike / follow. Publish inside e-studio, e-blog, e-gallery, e-space, e-library, e-cinema and e-server **with moderator approval**, 10 a day each. One community, one prize entry. |
| 2 | Buy from e-store and market; publish buy lists and product reviews; 20 a day. |
| 3 | Publisher: create your own studios, servers, blogs, galleries, spaces, libraries and cinemas (3 each); 30 a day plus 30 products — inside another member's store, not your own. |
| 4 | Merchant: create up to 4 stores and sell other members' products for a commission. Silver membership. |
| 5 | Banker: withdraw points as money. Silver membership for 6 months. |
| 6 | Major: convert other members' points for a percentage, create an e-bank, buy inside e-auction. Gold. |
| 7 | Elite: sell and buy inside e-auction, buy at super-auction. Gold. |
| 8 | High elite: create and run an e-auction, sell at super-auction, buy at hyper-auction. Diamond. |
| 9 | Premier: create and run super-auction, sell and buy at hyper-auction. Diamond. |
| 10 | Private elite: create and run hyper-auction. Diamond. |
| Max | Everything, without a ceiling. |

`rowFor(level)` holds these as data (`rights[]`, `flags{}`), so a page asks `can(info, "withdraw")`
instead of testing numbers.

## Where it shows

| Page | What |
| --- | --- |
| Header wallet | `Level · LV85`, points and the tier |
| Sidebar meter | `LV85 / LVMax` and the fill bar (`progressPct`) |
| `login.html` success card | the badge next to the membership |
| `profile.html` | `LV85 · High elite` beside the display name |
| `dashboard.html → Level` | badge, ceiling, progress, the whole ladder, and the rights of the current level |

## Unlock now — paying for the next level

A level is **never granted before it is paid for**. The points are the currency: they must reach the
level's threshold, and then the level's own points leave the balance and the level is stored in
`members.level_unlocked`.

The level page shows `Unlock now` on the next rung the moment its points condition is met (the rung
reads **Ready** in the ladder); before that the row stays **Locked** and no button appears. The dialog
names the price — the level's own threshold — and pays it from the balance. When the balance is short
it says how much is missing and links to buying the rest, and the button carries the price in its
tooltip either way.

| Target | LV1 | LV2 | LV3 | LV4 | LV5 | LV6 | LV7 | LV8 | LV9 | LV10 | LVMax |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Fee (points) | 10 | 100 | 1 000 | 10 000 | 100 000 | 1 000 000 | 10 000 000 | 100 000 000 | 1 000 000 000 | 10 000 000 000 | 100 000 000 000 |

`levels.js` exposes the price and the offer as data — `unlockFee(level)` and
`unlockOffer(info, available)` — so no page keeps its own copy of the numbers.

Server side, `level_unlock(p_token, p_level)` finishes the whole thing in one transaction:

1. the session (`member_from_token`) and `status = 'active'` are required;
2. the membership ceiling is applied — Free `3`, Silver `5`, Gold `8`, Diamond `11` — with an
   expired membership falling back to Free;
3. only **one rung at a time** (`p_level = level_unlocked + 1`);
4. the points condition is checked against the lifetime total
   (`greatest(sum of positive ledger deltas, members.points)`);
5. the fee is written to `points_ledger` (`reason = 'level unlock'`, `source = 'level'`, negative) and
   the trigger moves `members.points`;
6. `members.level_unlocked` stores the level — this column **is** the level, so
   `levelInfo({ …, unlocked })` reads it directly (still capped by the membership).

Errors come back as `{ ok: false, error }` with `session · inactive · level · cap · already · step ·
earned · points`; `cap` also returns `cap` and `membership`, `earned` returns `fee` and `earned`,
`points` returns `fee` and `balance`.

`members.level` (smallint, 1–10, default 1) is the legacy column and stays untouched: the level of a
member is `members.level_unlocked`, never that field — and never the points alone.

## Still to wire

- `members.level` is still the legacy 1–10 column; the real level is `members.level_unlocked`.
  A `level_for_points()` SQL function (for the eligibility of a rung) and the section-quota checks
  server-side are the next database step — today the client computes eligibility and the
  `level_unlock` RPC re-checks it.
- The task requirement (`tasks` in the quotas) and the membership duration conditions
  (`months` in the ladder rows) are shown, not yet enforced.
- `tools/levels-smoke.mjs` holds **64 checks** over the thresholds, badges, caps, quotas and rights;
  `tools/shell-smoke.mjs` checks the header badge and the capped meter in a real DOM.
