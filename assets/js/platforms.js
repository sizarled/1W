/**
 * The platform shelf — `public.platform`, read in one place.
 * ------------------------------------------------------------------
 * Section 09 on the homepage used to be a list in `config.js`. It is a table
 * now (`tools/sql/platforms-page.sql`), and this module is the only reader:
 *
 *   platform_public()   → the rows whose status is `available`, already ordered.
 *
 * Two surfaces draw it — the homepage rail and the footer's social dots — so
 * the fetch is cached and both of them ask for it. A row carries a logo
 * (`logo_url`, an uploaded picture or a pasted link) and a fallback glyph
 * (`icon`, a key from `brands.js`); the picture wins when it is there.
 *
 * If the call fails — offline, a deploy that has not run the SQL yet — the
 * shelf falls back to the list the build shipped with, so the homepage is
 * never empty. If the call succeeds and answers with nothing, the shelf is
 * genuinely empty and the page hides it: that is the owner switching every
 * platform off, not a broken request.
 */
import { rpc } from "./data.js";
import { PLATFORMS } from "./config.js";
import { brand } from "./brands.js";
import { icon } from "./icons.js";
import { esc } from "./utils.js";

/** What the build shipped — the fallback when the table cannot be read. */
export function fallbackPlatforms() {
  return PLATFORMS.map((p) => ({
    id: "",
    code: "",
    name: p.label,
    username: p.handle,
    url: p.url,
    logo_url: "",
    icon: p.key,
    status: "available",
  }));
}

function normalise(row) {
  return {
    id: String(row?.id || ""),
    code: String(row?.code || ""),
    name: String(row?.name || "").trim(),
    username: String(row?.username || "").trim(),
    url: String(row?.url || "").trim(),
    logo_url: String(row?.logo_url || "").trim(),
    icon: String(row?.icon || "").trim().toLowerCase(),
    status: String(row?.status || "available").trim().toLowerCase(),
    sort_order: Number(row?.sort_order ?? 100),
  };
}

let cache = null; // { rows, source: "db" | "fallback" }
let pending = null;

/** The last list this page drew — the shipped one until the table answers. */
export function platformsNow() {
  return cache ? cache.rows : fallbackPlatforms();
}

/**
 * The available platforms.
 * @returns {Promise<{rows: Array, source: "db"|"fallback"}>}
 */
export function loadPlatforms({ fresh = false } = {}) {
  if (cache && !fresh) return Promise.resolve(cache);
  if (pending) return pending;

  pending = (async () => {
    try {
      const res = await rpc("platform_public");
      const list = Array.isArray(res?.rows) ? res.rows.map(normalise).filter((r) => r.name) : null;
      if (res && res.ok === true && list) {
        cache = { rows: list, source: "db" };
        return cache;
      }
      throw new Error("platform_public: unexpected answer");
    } catch {
      cache = { rows: fallbackPlatforms(), source: "fallback" };
      return cache;
    } finally {
      pending = null;
    }
  })();

  return pending;
}

/** Forget the cached list — after the control panel writes. */
export function forgetPlatforms() {
  cache = null;
}

/* ------------------------------------------------------------------ */
/* markup                                                             */
/* ------------------------------------------------------------------ */
/** The logo slot: the uploaded picture if there is one, the brand glyph if not. */
export function platformMark(p) {
  if (p.logo_url) {
    return `<img class="platform-card__logo" src="${esc(p.logo_url)}" alt="" loading="lazy" decoding="async" />`;
  }
  const glyph = p.icon ? brand(p.icon) : "";
  return glyph || icon("link");
}

/** One card for the homepage rail. */
export function platformCard(p) {
  const handle = p.username ? `<span class="platform-card__handle">${esc(p.username)}</span>` : "";
  return `
      <a class="platform-card" href="${esc(p.url)}" target="_blank" rel="noopener noreferrer" title="${esc(
        p.name
      )}">
        <span class="platform-card__icon">${platformMark(p)}</span>
        <span class="platform-card__meta">
          <span class="platform-card__name">${esc(p.name)}</span>
          ${handle}
        </span>
        <span class="platform-card__arrow">${icon("arrowUpRight")}</span>
      </a>`;
}

/** Paint the homepage rail. */
export function paintPlatforms(track, list = platformsNow()) {
  if (!track) return 0;
  track.innerHTML = list.map(platformCard).join("");
  return list.length;
}

/** Paint the footer's social dots (the first eight, the rest live on the shelf). */
export function paintFooterDots(host, list = platformsNow()) {
  if (!host) return 0;
  const shown = list.slice(0, 8);
  host.innerHTML =
    shown
      .map(
        (p) =>
          `<a class="social-dot" href="${esc(p.url)}" target="_blank" rel="noopener noreferrer" aria-label="${esc(
            p.name
          )}">${(p.icon && brand(p.icon)) || icon("link")}</a>`
      )
      .join("") +
    `<a class="social-dot" href="index.html#platform" aria-label="All platforms">${icon("arrowUpRight")}</a>`;
  return shown.length;
}

/** "Fourteen places to follow the project" — the heading follows the count. */
export function platformHeading(count) {
  if (!count) return "Nowhere to follow the project — yet";
  if (count === 1) return "One place to follow the project";
  const words = [
    "No",
    "One",
    "Two",
    "Three",
    "Four",
    "Five",
    "Six",
    "Seven",
    "Eight",
    "Nine",
    "Ten",
    "Eleven",
    "Twelve",
    "Thirteen",
    "Fourteen",
    "Fifteen",
    "Sixteen",
    "Seventeen",
    "Eighteen",
    "Nineteen",
    "Twenty",
  ];
  const word = words[count] || String(count);
  return `${word} places to follow the project`;
}
