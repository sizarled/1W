/**
 * watch.html — title page controller.
 * ------------------------------------------------------------------
 * 1. Reads the title from the URL   (?movie=|?tv=  &publisher=  &link=  &season=  &episode=)
 * 2. Pulls everything from TMDB     (details, credits, providers, collection, similar)
 * 3. Pulls the community layer      (watch links, comments, playlists, articles, prizes, tasks)
 * 4. Runs the player                (ad gate → playback → viewing-code gate → watch-time ledger)
 *
 * Every network call degrades gracefully: a blocked API or an empty table
 * leaves the page usable instead of throwing.
 */

import { SITE, TMDB, SUPABASE } from "./config.js";
import { esc, qs, qsa, compact, num, clamp, avatarPlaceholder, tilePlaceholder, enableDragScrollAll } from "./utils.js";
import { icon } from "./icons.js";
import { toast } from "./ui.js";
import { playSound } from "./sound.js";
import { getMember, visitorId } from "./session.js";
import { awardPoints } from "./wallet.js";
import { rest, rpc } from "./data.js";
import { refreshBlockMap, isMediaBlocked, noBlocks, filterBlocked } from "./blocks.js";

/* ================================================================== */
/* constants                                                          */
/* ================================================================== */
const AD_URL = "https://asiafilm.org/4/e476b83b0c777b7828ac79fef485bd1a";
const AD_SECONDS = 30;
const CODE_DELAY = 5 * 60; // seconds of playback before the viewing code is required
const HEARTBEAT = 20; // flush the watch-time ledger every 20 s
const WATCH_KEY = "1w.watched"; // per-title counted seconds (best effort, survives a reload)
// used only when TMDB has no runtime for the title (never the normal case)
const FALLBACK_RUNTIME = { movie: 150, tv: 45 };
const ADULT_CERTS = ["R", "NC-17", "18", "18+", "TV-MA", "MA 15+", "X"];
const DEVICE_KEY = "1w.device";
const REMEMBER_KEY = "1w.code";

const sb = {
  apikey: SUPABASE.publishableKey,
  Authorization: `Bearer ${SUPABASE.publishableKey}`,
  "Content-Type": "application/json",
};

const state = {
  kind: "movie",
  id: null,
  season: 1,
  episode: 1,
  member: getMember(),
  publisher: qsParam("publisher"),
  linkParam: qsParam("link"),
  detail: null,
  credits: null,
  providers: [],
  links: [],
  activeLink: null,
  location: "",
  needsCode: false,
  adVerified: false,
  codeVerified: false,
  playbackStarted: false,
  adBlocked: false,
  runtimeMinutes: 0, // TMDB runtime of the film / of this episode
  capSeconds: 0, // how many seconds this title may ever count
  capReached: false,
  seasonMeta: [],
  offers: [],
};

/* ================================================================== */
/* small helpers                                                      */
/* ================================================================== */
function qsParam(name) {
  return new URLSearchParams(location.search).get(name) || null;
}

function setHTML(el, html) {
  if (el) el.innerHTML = html;
}

function deviceId() {
  let id = localStorage.getItem(DEVICE_KEY);
  if (!id) {
    id = `dev_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;
    localStorage.setItem(DEVICE_KEY, id);
  }
  return id;
}

function rememberedCode() {
  try {
    const saved = JSON.parse(localStorage.getItem(REMEMBER_KEY) || "null");
    if (saved && saved.code && (!saved.until || saved.until > Date.now())) return saved;
  } catch {
    /* ignore */
  }
  return null;
}

async function safe(promise, fallback = null) {
  try {
    return await promise;
  } catch {
    return fallback;
  }
}

/* ================================================================== */
/* TMDB                                                               */
/* ================================================================== */
async function tmdb(path, params = {}) {
  const url = new URL(`${TMDB.base}${path}`);
  url.searchParams.set("api_key", TMDB.apiKey);
  url.searchParams.set("language", "en-US");
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`TMDB ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

const img = (path, size = "w500") => (path ? `${TMDB.image}/${size}${path.startsWith("/") ? path : `/${path}`}` : "");
const tmdbName = (item) => item.title || item.name || "Untitled";
const yearOf = (item) => String(item.release_date || item.first_air_date || "").slice(0, 4);

function minutesLabel(minutes) {
  if (!minutes) return "";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h ? `${h}h ${m.toString().padStart(2, "0")}m` : `${m}m`;
}

/* ================================================================== */
/* boot                                                               */
/* ================================================================== */
export async function initWatch() {
  const movieId = qsParam("movie");
  const tvId = qsParam("tv");
  state.kind = tvId ? "tv" : "movie";
  state.id = Number(tvId || movieId || 0);
  state.season = Math.max(1, Number(qsParam("season") || 1));
  state.episode = Math.max(1, Number(qsParam("episode") || 1));
  state.location = state.kind === "movie" ? `movie:${state.id}` : `tv:${state.id}`;

  wireRails();

  // a blocked person's works stay out of reach — even by direct URL
  if (getMember()) {
    await refreshBlockMap().catch(() => null);
    if (isMediaBlocked(state.kind, state.id)) {
      renderBlockedTitle();
      return;
    }
  }

  if (!state.id || Number.isNaN(state.id)) {
    renderMissing();
    return;
  }

  hydrateChrome();
  detectAdBlocker();
  await Promise.all([loadTitle(), loadCommunity()]);
  await loadEpisodeRuntime();
  wireActions();
  wirePlayer();
  wireWatchTimeGuards();
  wireExitIntent();
  renderLimitNote();
}

function renderMissing() {
  const main = qs("#main");
  if (!main) return;
  main.innerHTML = `
    <section class="soon" style="min-height: 60vh">
      <div class="soon__inner">
        <span class="soon__icon">${icon("film")}</span>
        <p class="eyebrow"><span class="eyebrow__dot"></span>Nothing to play</p>
        <h1 class="soon__title">Pick a film or a series</h1>
        <p class="soon__text">Open this page as <code>watch.html?movie=ID</code> or <code>watch.html?tv=ID</code>,
        or start from the catalogue.</p>
        <div class="soon__actions">
          <a class="btn btn--primary" href="movies.html">${icon("film")} Browse films</a>
          <a class="btn btn--ghost" href="series.html">${icon("tv")} Browse series</a>
        </div>
      </div>
    </section>`;
}

/* chrome that does not depend on TMDB ------------------------------- */
function hydrateChrome() {
  const member = state.member;
  const hint = qs("[data-w-comment-hint]");
  if (hint) {
    hint.textContent = member ? `Commenting as ${member.username || "@member"}` : "Sign in to comment.";
  }
  const form = qs("[data-w-comment-form]");
  if (form && !member) {
    qs("[data-w-comment-input]", form)?.setAttribute("disabled", "disabled");
    qs("button[type='submit']", form)?.setAttribute("disabled", "disabled");
  }

  const dl = qs("[data-w-download]");
  if (dl) dl.href = `download.html?${state.kind}=${state.id}`;

  document.title = `Watch — ${SITE.name} Web`;

  qsAll(".w-act").forEach((el) => {
    el.querySelector("i[data-icon]")?.replaceWith(iconEl(el.querySelector("i[data-icon]")?.dataset.icon));
  });

  // icons inside static markup
  qsa("i[data-icon]").forEach((node) => {
    const name = node.dataset.icon;
    if (name) node.replaceWith(iconEl(name));
  });
}

function iconEl(name) {
  const wrap = document.createElement("span");
  wrap.innerHTML = icon(name || "sparkle");
  return wrap.firstElementChild || wrap;
}

const qsAll = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/* ================================================================== */
/* ad-block probe                                                     */
/* ================================================================== */
function detectAdBlocker() {
  const bait = document.createElement("div");
  bait.className = "adsbox ad-banner pub_300x250 text-ad";
  bait.style.cssText = "position:absolute;left:-9999px;top:-9999px;width:300px;height:250px";
  bait.innerHTML = "&nbsp;";
  document.body.appendChild(bait);
  const blocked = () => {
    const hidden = bait.offsetHeight === 0 || bait.offsetParent === null || getComputedStyle(bait).display === "none";
    bait.remove();
    state.adBlocked = hidden;
    if (hidden) {
      toast({
        tone: "error",
        iconName: "shield",
        title: "Ad blocker detected",
        message: "Watch minutes are recorded but not credited while the blocker stays on.",
      });
    }
  };
  setTimeout(blocked, 180);
}

/* ================================================================== */
/* title                                                            */
/* ================================================================== */
async function loadTitle() {
  const append =
    state.kind === "movie"
      ? "credits,watch/providers,similar,recommendations,release_dates,external_ids"
      : "credits,watch/providers,similar,recommendations,content_ratings,external_ids";

  const detail = await safe(tmdb(`/${state.kind}/${state.id}`, { append_to_response: append }), null);
  if (!detail) {
    toast({ tone: "error", iconName: "info", title: "TMDB unreachable", message: "Details could not load — the player still works." });
    return;
  }
  state.detail = detail;
  const credits = detail.credits || {};
  state.credits = credits;

  renderHero(detail, credits);
  renderCast(credits);
  renderProviders(detail["watch/providers"]);
  renderRelated(detail);
  renderSeasons(detail);
  preparePlayer(detail);

  loadSuggested();
  loadStats();
  loadLinks();
  loadComments();
  loadPlaylists();
  loadPrizes();
  loadTasks();
}

function certification(detail) {
  if (state.kind === "movie") {
    const dates = detail.release_dates?.results || [];
    const order = ["US", "GB", "MA", "FR", "DE"];
    for (const code of order) {
      const row = dates.find((r) => r.iso_3166_1 === code && r.release_dates?.some((d) => d.certification));
      if (row) return row.release_dates.find((d) => d.certification)?.certification || "";
    }
    return "";
  }
  const ratings = detail.content_ratings?.results || [];
  return ratings.find((r) => r.iso_3166_1 === "US")?.rating || ratings[0]?.rating || "";
}

/** The runtime TMDB gives the film, or this exact episode of a series. */
function rememberRuntime(minutes) {
  const value = Number(minutes) || 0;
  if (value <= 0) return;
  state.runtimeMinutes = value;
  state.capSeconds = Math.round(value * 60);
  renderLimitNote();
}

async function loadEpisodeRuntime() {
  if (state.kind !== "tv") return;
  const episode = await safe(tmdb(`/tv/${state.id}/season/${state.season}/episode/${state.episode}`), null);
  const detail = state.detail || {};
  const minutes =
    Number(episode?.runtime || 0) ||
    Number(detail.episode_run_time?.[0] || 0) ||
    Number(detail.last_episode_to_air?.runtime || 0);
  if (minutes > 0) rememberRuntime(minutes);
}

/** Season / episode changed: the allowance follows the new episode's runtime. */
async function refreshEpisodeRuntime() {
  state.capReached = false;
  await loadEpisodeRuntime();
  counterKey = null; // force a fresh allowance for this episode
  resetCounter();
  renderLimitNote();
}

function renderHero(detail, credits) {
  const title = tmdbName(detail);
  const year = yearOf(detail);
  const runtime =
    state.kind === "movie" ? detail.runtime : detail.episode_run_time?.[0] || detail.last_episode_to_air?.runtime || 0;
  if (state.kind === "movie") rememberRuntime(detail.runtime);
  else rememberRuntime(runtime);
  const rating = detail.vote_average ? Number(detail.vote_average).toFixed(1) : "";
  const votes = detail.vote_count ? compact(detail.vote_count) : "";
  const cert = certification(detail);
  const director = (credits.crew || []).find((c) => c.job === "Director")?.name || "";
  const writers = (credits.crew || []).filter((c) => ["Writer", "Screenplay", "Story"].includes(c.job)).slice(0, 2).map((c) => c.name);
  const companies = (detail.production_companies || []).slice(0, 2).map((c) => c.name);
  const countries = (detail.production_countries || []).map((c) => c.name).slice(0, 3);

  document.title = `${title}${year ? ` (${year})` : ""} — Watch on ${SITE.name} Web`;
  qs("[data-w-crumb-kind]")?.setAttribute("href", state.kind === "movie" ? "movies.html" : "series.html");
  const crumbKind = qs("[data-w-crumb-kind]");
  if (crumbKind) crumbKind.textContent = state.kind === "movie" ? "Movies" : "TV Series";
  const crumbTitle = qs("[data-w-crumb-title]");
  if (crumbTitle) crumbTitle.textContent = title;

  const poster = qs("[data-w-poster]");
  if (poster) {
    poster.src = img(detail.poster_path, "w500") || tilePlaceholder(title, state.id);
    poster.alt = `${title} poster`;
  }
  const backdrop = qs("[data-w-backdrop]");
  if (backdrop) backdrop.style.backgroundImage = `url("${img(detail.backdrop_path, "w1280") || img(detail.poster_path, "w780")}")`;

  const titleEl = qs("[data-w-title]");
  if (titleEl) titleEl.textContent = title;

  const original = qs("[data-w-original]");
  if (original) {
    const alt = (state.kind === "movie" ? detail.original_title : detail.original_name) || "";
    if (alt && alt !== title) {
      original.textContent = `${alt} · ${detail.original_language?.toUpperCase() || ""}`;
      original.hidden = false;
    }
  }

  const tagline = qs("[data-w-tagline]");
  if (tagline && detail.tagline) {
    tagline.textContent = `“${detail.tagline}”`;
    tagline.hidden = false;
  }

  const overview = qs("[data-w-overview]");
  if (overview) overview.textContent = detail.overview || "No synopsis has been published for this title yet.";

  const kindBadge = qs("[data-w-kind]");
  if (kindBadge) kindBadge.textContent = state.kind === "movie" ? "Film" : "TV Series";

  const certBadge = qs("[data-w-cert]");
  if (certBadge && cert) {
    certBadge.textContent = cert;
    certBadge.hidden = false;
    certBadge.classList.toggle("badge--solid", ADULT_CERTS.includes(cert));
  }
  const statusBadge = qs("[data-w-status]");
  if (statusBadge && detail.status) {
    statusBadge.textContent = detail.status;
    statusBadge.hidden = false;
  }

  const genres = qs("[data-w-genres]");
  setHTML(genres, (detail.genres || []).map((g) => `<span class="w-genre">${esc(g.name)}</span>`).join(""));

  const meta = [];
  if (year) meta.push(["calendar", `${year}`]);
  if (runtime) meta.push(["clock", minutesLabel(runtime)]);
  if (state.kind === "tv" && detail.number_of_seasons) meta.push(["tv", `${detail.number_of_seasons} seasons · ${detail.number_of_episodes || 0} episodes`]);
  if (rating) meta.push(["star", `${rating} <b>TMDB</b>${votes ? ` · ${votes} votes` : ""}`]);
  if (director) meta.push(["user", `Directed by <b>${esc(director)}</b>`]);
  if (writers.length) meta.push(["article", `Written by <b>${esc(writers.join(", "))}</b>`]);
  if (companies.length) meta.push(["film", esc(companies.join(", "))]);
  if (countries.length) meta.push(["globe", esc(countries.join(", "))]);
  if (detail.original_language) meta.push(["mic", `${detail.original_language.toUpperCase()} original`]);

  setHTML(
    qs("[data-w-meta]"),
    meta.map(([ic, text]) => `<span class="w-meta__item">${icon(ic)}<span>${text}</span></span>`).join("")
  );

  // state used by the gates
  const adult = Boolean(detail.adult) || ADULT_CERTS.includes(cert);
  state.needsCode = adult || Number(detail.vote_average || 0) >= 5;

  qs("[data-w-hero]")?.setAttribute("aria-busy", "false");
}

/* ================================================================== */
/* cast / providers / related                                        */
/* ================================================================== */
function renderCast(credits) {
  const cast = (credits.cast || []).slice(0, 18);
  const crew = (credits.crew || []).filter((c) => ["Director", "Writer", "Screenplay", "Producer", "Director of Photography", "Original Music Composer"].includes(c.job));
  const people = [...crew.slice(0, 6), ...cast];
  if (!people.length) return fillRail("cast", "");

  fillRail(
    "cast",
    people
      .map(
        (p) => `
      <a class="w-person" href="cast.html?id=${p.id}" aria-label="${esc(p.name)}">
        <span class="w-person__avatar">${imgTag(img(p.profile_path, "w185"), avatarPlaceholder(p.name, 120), p.name)}</span>
        <span class="w-person__name">${esc(p.name)}</span>
        <span class="w-person__role">${esc(p.job || p.character || "")}</span>
      </a>`
      )
      .join("")
  );
}

function renderProviders(block) {
  const results = block?.results || {};
  const region = (navigator.language || "en-US").split("-")[1] || "US";
  const data = results[region] || results.US || Object.values(results)[0];
  if (!data) {
    state.providers = [];
    fillRail("providers", "");
    qs('[data-w-section="providers"]')?.setAttribute("hidden", "hidden");
    return;
  }
  const rows = [
    ...(data.flatrate || []).map((p) => ({ ...p, type: "Stream" })),
    ...(data.free || []).map((p) => ({ ...p, type: "Free" })),
    ...(data.rent || []).map((p) => ({ ...p, type: "Rent" })),
    ...(data.buy || []).map((p) => ({ ...p, type: "Buy" })),
  ];
  const seen = new Set();
  state.providers = rows.filter((p) => (seen.has(p.provider_id) ? false : seen.add(p.provider_id)));
  if (!state.providers.length) {
    fillRail("providers", "");
    qs('[data-w-section="providers"]')?.setAttribute("hidden", "hidden");
    return;
  }
  fillRail(
    "providers",
    state.providers
      .map(
        (p) => `
      <a class="w-provider" href="${esc(data.link || "#")}" target="_blank" rel="noopener">
        <img src="${esc(img(p.logo_path, "w92"))}" alt="" loading="lazy" />
        <span class="w-provider__name">${esc(p.provider_name)}</span>
        <span class="w-provider__type">${esc(p.type)}</span>
      </a>`
      )
      .join("")
  );
}

async function renderRelated(detail) {
  const items = [];
  const push = (list) =>
    (list || []).forEach((m) => {
      if (!m || m.id === state.id) return;
      if (!items.some((x) => x.id === m.id)) items.push(m);
    });

  if (detail.belongs_to_collection?.id) {
    const collection = await safe(tmdb(`/collection/${detail.belongs_to_collection.id}`), null);
    push((collection?.parts || []).map((p) => ({ ...p, __kind: p.first_air_date ? "tv" : "movie", __why: "Saga" })));
  }
  push((detail.recommendations?.results || []).map((m) => ({ ...m, __why: "Recommended" })));
  push((detail.similar?.results || []).map((m) => ({ ...m, __why: "Similar" })));

  const visible = noBlocks() ? items : filterBlocked(items, state.kind);

  fillRail(
    "related",
    visible
      .slice(0, 30)
      .map((m) => mediaCard({ ...m, kind: m.first_air_date || m.media_type === "tv" ? "tv" : state.kind }, m.__why))
      .join("")
  );
}

async function loadSuggested() {
  const data = await safe(tmdb(`/trending/${state.kind}/week`), null);
  const list = (data?.results || []).filter((m) => m.id !== state.id).slice(0, 20);
  fillRail("suggested", list.map((m) => mediaCard(m, "Trending")).join(""));
}

function renderBlockedTitle() {
  const main = qs("#main");
  if (!main) return;
  main.innerHTML = `
    <section class="soon" style="min-height: 60vh">
      <div class="soon__inner">
        <span class="soon__icon">${icon("lock")}</span>
        <p class="eyebrow"><span class="eyebrow__dot"></span>Blocked person</p>
        <h1 class="soon__title">This title is hidden</h1>
        <p class="soon__text">You blocked someone who appears in this title, so it is hidden from your lists,
        search, recommendations, Updates and sharing.</p>
        <div class="soon__actions">
          <a class="btn btn--primary" href="index.html">${icon("home")} Back home</a>
          <a class="btn btn--ghost" href="movies.html">${icon("film")} Browse films</a>
        </div>
      </div>
    </section>`;
}

function mediaCard(item, why) {
  const known = item.__kind || (item.first_air_date || item.media_type === "tv" ? "tv" : "movie");
  const isTv = known === "tv" || (item.media_type === "tv" && !item.title);
  const title = tmdbName(item);
  const year = yearOf(item);
  const rating = item.vote_average ? Number(item.vote_average).toFixed(1) : "";
  const href = `watch.html?${isTv ? "tv" : "movie"}=${item.id}${state.publisher ? `&publisher=${state.publisher}` : ""}`;
  return `
    <a class="pcard" href="${href}" aria-label="${esc(title)}">
      <span class="pcard__media">
        ${imgTag(img(item.poster_path, "w342"), tilePlaceholder(title, item.id), `${title} poster`, "pcard__img")}
        <span class="pcard__shade"></span>
        ${why ? `<span class="pcard__kind">${esc(why)}</span>` : ""}
        ${rating ? `<span class="pcard__rate">${icon("star")}${rating}</span>` : ""}
      </span>
      <span class="pcard__body">
        <span class="pcard__title">${esc(title)}</span>
        <span class="pcard__meta">${esc([year, isTv ? "Series" : "Film"].filter(Boolean).join(" · "))}</span>
      </span>
    </a>`;
}

function imgTag(src, fallback, alt, cls = "") {
  const source = src || fallback || "";
  const fb = fallback && fallback !== source ? `data-fb="${esc(fallback)}"` : "";
  return `<img class="${cls}" src="${esc(source)}" alt="${esc(alt)}" loading="lazy" decoding="async" ${fb}
    onload="this.classList.add('is-loaded')"
    onerror="this.onerror=null;this.src=this.dataset.fb||'';this.classList.add('is-loaded')" />`;
}

/* ================================================================== */
/* rails                                                              */
/* ================================================================== */
function fillRail(name, html) {
  const track = qs(`[data-w-rail="${name}"]`);
  if (!track) return;
  setHTML(track, html || `<p class="w-empty">Nothing published here yet.</p>`);
  track.parentElement?.parentElement?.classList.toggle("is-empty", !html);
  enableDragScrollAll(track.closest("section") || document);
  syncRailButtons(name);
}

function syncRailButtons(name) {
  const track = qs(`[data-w-rail="${name}"]`);
  const section = track?.closest(".w-sec");
  if (!track || !section) return;
  const prev = qs("[data-rail-prev]", section);
  const next = qs("[data-rail-next]", section);
  const max = track.scrollWidth - track.clientWidth;
  if (prev) prev.disabled = track.scrollLeft <= 4;
  if (next) next.disabled = max <= 4 || track.scrollLeft >= max - 4;
}

function wireRails() {
  qsa(".w-sec").forEach((section) => {
    const track = qs("[data-rail-track]", section);
    if (!track) return;
    const scroll = (dir) => track.scrollBy({ left: dir * Math.max(track.clientWidth * 0.8, 280), behavior: "smooth" });
    qs("[data-rail-prev]", section)?.addEventListener("click", () => scroll(-1));
    qs("[data-rail-next]", section)?.addEventListener("click", () => scroll(1));
    track.addEventListener("scroll", () => {
      const max = track.scrollWidth - track.clientWidth;
      const prev = qs("[data-rail-prev]", section);
      const next = qs("[data-rail-next]", section);
      if (prev) prev.disabled = track.scrollLeft <= 4;
      if (next) next.disabled = track.scrollLeft >= max - 4;
    }, { passive: true });
  });
}

/* ================================================================== */
/* stats / likes / watch later                                        */
/* ================================================================== */
async function loadStats() {
  const stats = await safe(rpc("content_stats", { p_location: state.location }), null);
  if (stats) {
    setText("[data-w-like-count]", compact(stats.likes || 0));
    setText("[data-w-dislike-count]", compact(stats.dislikes || 0));
    setText("[data-w-comment-count]", compact(stats.comments || 0));
    setText("[data-w-views-count]", `${compact(stats.minutes || 0)} min`);
  }
  const member = state.member;
  if (member?.id) {
    const mine = await safe(rest("content_reaction", { filters: { location: `eq.${state.location}`, idmember: `eq.${memberUuid()}` }, limit: 1 }), null);
    if (Array.isArray(mine) && mine[0]) {
      const btn = mine[0].value === 1 ? qs("[data-w-like]") : qs("[data-w-dislike]");
      btn?.classList.add("is-on");
      btn?.setAttribute("aria-pressed", "true");
    }
    const saved = await safe(rest("watch_later", { filters: { idmember: `eq.${memberUuid()}`, idtmdb: `eq.${state.id}`, media_type: `eq.${state.kind}` }, limit: 1 }), null);
    if (Array.isArray(saved) && saved.length) {
      const btn = qs("[data-w-later]");
      btn?.classList.add("is-on");
      btn?.setAttribute("aria-pressed", "true");
    }
  }
}

function setText(sel, value) {
  const el = qs(sel);
  if (el) el.textContent = value;
}

function memberUuid() {
  const id = state.member?.id;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id || "") ? id : null;
}

function requireMember(action = "do that") {
  if (memberUuid()) return true;
  toast({
    tone: "error",
    iconName: "lock",
    title: "Members only",
    message: `Sign in to ${action}.`,
  });
  playSound("error");
  return false;
}

async function react(value) {
  if (!requireMember("like or dislike a title")) return;
  const likeBtn = qs("[data-w-like]");
  const dislikeBtn = qs("[data-w-dislike]");
  const current = likeBtn?.classList.contains("is-on") ? 1 : dislikeBtn?.classList.contains("is-on") ? -1 : 0;
  try {
    if (current === value) {
      await fetch(`${SUPABASE.restUrl}/content_reaction?location=eq.${encodeURIComponent(state.location)}&idmember=eq.${memberUuid()}`, {
        method: "DELETE",
        headers: sb,
      });
      likeBtn?.classList.remove("is-on");
      dislikeBtn?.classList.remove("is-on");
    } else {
      await fetch(`${SUPABASE.restUrl}/content_reaction`, {
        method: "POST",
        headers: { ...sb, Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify({ location: state.location, idmember: memberUuid(), value }),
      });
      likeBtn?.classList.toggle("is-on", value === 1);
      dislikeBtn?.classList.toggle("is-on", value === -1);
    }
    likeBtn?.setAttribute("aria-pressed", String(value === 1));
    dislikeBtn?.setAttribute("aria-pressed", String(value === -1));
    loadStats();
  } catch {
    toast({ tone: "error", iconName: "info", title: "Could not save your vote" });
  }
}

async function toggleWatchLater() {
  if (!requireMember("save titles for later")) return;
  const btn = qs("[data-w-later]");
  const on = btn?.classList.contains("is-on");
  try {
    if (on) {
      await fetch(
        `${SUPABASE.restUrl}/watch_later?idmember=eq.${memberUuid()}&idtmdb=eq.${state.id}&media_type=eq.${state.kind}`,
        { method: "DELETE", headers: sb }
      );
      btn.classList.remove("is-on");
      btn.setAttribute("aria-pressed", "false");
      toast({ tone: "default", iconName: "bookmark", title: "Removed from watch later" });
    } else {
      await rest("watch_later", {
        method: "POST",
        minimal: true,
        body: {
          idmember: memberUuid(),
          idtmdb: state.id,
          media_type: state.kind,
          season: state.kind === "tv" ? state.season : null,
          episode: state.kind === "tv" ? state.episode : null,
        },
      });
      btn.classList.add("is-on");
      btn.setAttribute("aria-pressed", "true");
      playSound("success");
      toast({ tone: "success", iconName: "bookmark", title: "Added to watch later" });
    }
  } catch {
    toast({ tone: "error", iconName: "info", title: "Could not update your list" });
  }
}

/* ================================================================== */
/* player                                                            */
/* ================================================================== */
function embedUrl(link) {
  if (link) return link.url;
  return state.kind === "movie"
    ? `https://vidsrc.sh/embed/movie/${state.id}`
    : `https://vidsrc.sh/embed/tv/${state.id}/${state.season}/${state.episode}`;
}

function preparePlayer(detail) {
  const runtime =
    state.kind === "movie" ? detail.runtime : detail.episode_run_time?.[0] || 0;
  const label = state.kind === "movie" ? minutesLabel(runtime) : runtime ? `${runtime} min episodes` : "";
  setText("[data-w-duration]", label);
  setText("[data-w-duration-sub]", state.kind === "movie" ? "Film" : `S${state.season} · E${state.episode}`);

  const adLink = qs("[data-w-ad-link]");
  if (adLink) adLink.href = AD_URL;

  // a code that is already remembered on this device skips the gate
  const remembered = rememberedCode();
  if (remembered) state.codeVerified = true;
}

function wirePlayer() {
  qs("[data-w-play]")?.addEventListener("click", beginPlayback);
  qs("[data-w-ad-link]")?.addEventListener("click", startAdCountdown);
  qs("[data-w-unlock]")?.addEventListener("click", () => {
    const form = qs("[data-w-code-form]");
    if (form) form.hidden = false;
    qs("[data-w-code-input]")?.focus();
  });
  qs("[data-w-code-submit]")?.addEventListener("click", submitCode);
  qs("[data-w-code-input]")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") submitCode();
    const input = e.currentTarget;
    input.value = input.value.replace(/\D/g, "").slice(0, 6);
  });
  qs("[data-w-season-select]")?.addEventListener("change", (e) => {
    state.season = Number(e.target.value);
    state.episode = 1;
    buildEpisodeOptions();
    changeSource();
    refreshEpisodeRuntime();
  });
  qs("[data-w-episode-select]")?.addEventListener("change", (e) => {
    state.episode = Number(e.target.value);
    changeSource();
    refreshEpisodeRuntime();
  });
}

async function beginPlayback() {
  const idle = qs("[data-w-idle]");
  if (state.adVerified) return startPlayer();
  if (idle) idle.hidden = true;
  const gate = qs("[data-w-ad]");
  if (gate) gate.hidden = false;
  setText("[data-w-ad-count]", String(AD_SECONDS));
  resetRing(AD_SECONDS);
}

let adTimer = null;
let adLeft = AD_SECONDS;

function startAdCountdown(event) {
  // the link opens in a new tab; the timer only runs while this page is visible
  adLeft = AD_SECONDS;
  setText("[data-w-ad-note]", "Keep the sponsor tab open — closing this page stops the countdown.");
  if (adTimer) return;
  adTimer = setInterval(() => {
    adLeft -= 1;
    setText("[data-w-ad-count]", String(Math.max(adLeft, 0)));
    updateRing(adLeft);
    if (adLeft <= 0) {
      clearInterval(adTimer);
      adTimer = null;
      state.adVerified = true;
      const gate = qs("[data-w-ad]");
      if (gate) gate.hidden = true;
      startPlayer();
    }
  }, 1000);
}

window.addEventListener("pagehide", () => {
  if (adTimer) {
    clearInterval(adTimer);
    adTimer = null;
  }
});

function ringLength() {
  const circle = qs("[data-w-ad-progress]");
  return circle ? 2 * Math.PI * Number(circle.getAttribute("r")) : 226;
}

function resetRing(total) {
  const circle = qs("[data-w-ad-progress]");
  if (!circle) return;
  circle.dataset.total = String(total);
  const len = ringLength();
  circle.style.strokeDasharray = String(len);
  circle.style.strokeDashoffset = String(len);
  circle.dataset.total = String(total);
}

function updateRing(left) {
  const circle = qs("[data-w-ad-progress]");
  if (!circle) return;
  const total = Number(circle.dataset.total || AD_SECONDS);
  const len = ringLength();
  const done = clamp((total - left) / total, 0, 1);
  circle.style.strokeDashoffset = String(len * (1 - done));
}

function startPlayer() {
  const frame = qs("[data-w-frame]");
  const idle = qs("[data-w-idle]");
  if (!frame) return;
  if (idle) idle.hidden = true;
  frame.hidden = false;
  mountIframe(embedUrl(state.activeLink));

  state.playbackStarted = true;
  startTracker();
  if (state.needsCode && !state.codeVerified) scheduleCodeGate();
  updateSourceLabel();
}

function mountIframe(url) {
  const frame = qs("[data-w-frame]");
  if (!frame) return;
  frame.innerHTML = `<iframe src="${esc(url)}" title="Player" allow="autoplay; fullscreen; encrypted-media; picture-in-picture" allowfullscreen referrerpolicy="origin"></iframe>`;
}

/* ----- viewing-code gate ------------------------------------------- */
let codeTimer = null;

function scheduleCodeGate() {
  clearTimeout(codeTimer);
  codeTimer = setTimeout(openCodeGate, CODE_DELAY * 1000);
  toast({
    tone: "default",
    iconName: "clock",
    title: "Viewing code in 5 minutes",
    message: "This title is protected — keep your six-digit code ready.",
  });
}

function openCodeGate() {
  if (state.codeVerified) return;
  // stop the film: drop the iframe so playback really stops
  const frame = qs("[data-w-frame]");
  if (frame) frame.innerHTML = "";
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  pauseTracker();
  const lock = qs("[data-w-lock]");
  if (lock) lock.hidden = false;
  playSound("error");
}

async function submitCode() {
  const input = qs("[data-w-code-input]");
  const error = qs("[data-w-code-error]");
  const code = (input?.value || "").replace(/\D/g, "");
  if (code.length !== 6) {
    if (error) error.textContent = "The code has exactly six digits.";
    input?.classList.add("is-bad");
    return;
  }
  input?.classList.remove("is-bad");
  if (error) error.textContent = "Checking…";

  const remember = qs("[data-w-code-remember]")?.checked;
  const result = await safe(rpc("verify_watch_code", {
    p_code: code,
    p_device: remember ? deviceId() : null,
    p_member: memberUuid(),
  }), null);

  if (result?.ok) {
    state.codeVerified = true;
    if (remember) {
      localStorage.setItem(REMEMBER_KEY, JSON.stringify({ code, until: Date.now() + 30 * 24 * 3600 * 1000 }));
    }
    const lock = qs("[data-w-lock]");
    if (lock) lock.hidden = true;
    if (error) error.textContent = "";
    playSound("success");
    toast({ tone: "success", iconName: "unlock", title: "Unlocked", message: "Your code was accepted on this device." });
    mountIframe(embedUrl(state.activeLink));
    resumeTracker();
  } else {
    const reason = result?.reason;
    if (error) {
      error.textContent =
        reason === "device"
          ? "This code is already bound to another device."
          : reason === "format"
            ? "Enter the six digits exactly."
            : "That code is not valid or has expired.";
    }
    playSound("error");
  }
}

/* ----- seasons ------------------------------------------------------ */
function renderSeasons(detail) {
  if (state.kind !== "tv" || !detail?.seasons) return;
  const seasons = detail.seasons.filter((s) => s.season_number > 0);
  state.seasonMeta = seasons;
  const select = qs("[data-w-season-select]");
  if (!select) return;
  select.innerHTML = seasons
    .map((s) => `<option value="${s.season_number}" ${s.season_number === state.season ? "selected" : ""}>Season ${s.season_number}</option>`)
    .join("");
  qs("[data-w-season]")?.removeAttribute("hidden");
  buildEpisodeOptions();
}

function buildEpisodeOptions() {
  const meta = state.seasonMeta.find((s) => s.season_number === state.season);
  const count = meta?.episode_count || 12;
  const select = qs("[data-w-episode-select]");
  if (!select) return;
  select.innerHTML = Array.from({ length: count }, (_, i) => {
    const ep = i + 1;
    return `<option value="${ep}" ${ep === state.episode ? "selected" : ""}>Episode ${ep}</option>`;
  }).join("");
}

function changeSource() {
  if (!qs("[data-w-frame]") || qs("[data-w-frame]").hidden) return;
  mountIframe(embedUrl(state.activeLink));
  resetPlaybackTimers();
  refreshEpisodeRuntime();
  toast({ tone: "default", iconName: "tv", title: `Season ${state.season} · Episode ${state.episode}`, message: "Playback restarted for this episode." });
}

function resetPlaybackTimers() {
  clearTimeout(codeTimer);
  pauseTracker();
  if (state.playbackStarted) startTracker();
  if (state.needsCode && !state.codeVerified) scheduleCodeGate();
}

/* ================================================================== */
/* watch-time ledger                                                  */
/* ================================================================== */
/**
 * The ledger only advances when ALL of these are true:
 *   · the visitor pressed Play and the frame is mounted
 *   · the tab is visible and the window has focus (another window/dialog = paused)
 *   · the browser is online and the viewing-code lock is not covering the film
 *   · the title has not used up its TMDB runtime yet (anti-abuse ceiling)
 */
const tracker = { seconds: 0, pending: 0, timer: null, running: false, stored: 0 };
let counterKey = null; // which title/episode/day the counted seconds belong to
// optimistically focused: a page opened in a background tab reports hidden anyway,
// and the blur/focus listeners correct the flag from then on
let windowFocused = !document.hidden;

function capSeconds() {
  if (!state.capSeconds) {
    const fallback = FALLBACK_RUNTIME[state.kind] || FALLBACK_RUNTIME.movie;
    state.capSeconds = Math.round((state.runtimeMinutes || fallback) * 60);
  }
  return state.capSeconds;
}

function dayStamp() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function countKey() {
  const day = dayStamp(); // the allowance is per day, like the server backstop
  return state.kind === "movie"
    ? `${WATCH_KEY}:movie:${state.id}:${day}`
    : `${WATCH_KEY}:tv:${state.id}:s${state.season}:e${state.episode}:${day}`;
}

function clockLabel(total) {
  const value = Math.max(0, Math.floor(total));
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  const seconds = value % 60;
  const pad = (n) => String(n).padStart(2, "0");
  return hours ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}

function storedSeconds() {
  try {
    return Math.max(0, Number(localStorage.getItem(countKey()) || 0));
  } catch {
    return 0;
  }
}

function saveCounted(seconds) {
  // always write to the bucket the counter belongs to, so switching episodes
  // cannot credit the previous episode's seconds to the new one
  const key = counterKey || countKey();
  tracker.stored = seconds;
  try {
    localStorage.setItem(key, String(Math.round(seconds)));
  } catch {
    /* private mode — the count simply restarts next time */
  }
}

function codeLockOpen() {
  return qs("[data-w-lock]")?.hidden === false;
}

function isCounting() {
  if (!state.playbackStarted) return false;
  if (state.capReached) return false;
  if (document.hidden) return false;
  if (!windowFocused) return false;
  if (!navigator.onLine) return false;
  if (codeLockOpen()) return false;
  return true;
}

/** Re-loads the counted seconds for the current title (called when the title changes). */
function resetCounter() {
  counterKey = countKey();
  tracker.pending = 0;
  tracker.seconds = Math.min(storedSeconds(), capSeconds());
  state.capReached = tracker.seconds >= capSeconds();
  renderLimitNote();
}

function startTracker() {
  resetCounterIfIdle();
  if (tracker.running) return;
  tracker.running = true;
  tracker.timer = setInterval(stepTracker, 1000);
}

function resetCounterIfIdle() {
  if (countKey() !== counterKey) resetCounter();
}

function stepTracker() {
  if (!isCounting()) return;
  const cap = capSeconds();
  if (tracker.seconds >= cap) return reachCap();
  tracker.seconds += 1;
  tracker.pending += 1;
  if (tracker.seconds % 5 === 0) saveCounted(tracker.seconds);
  if (tracker.pending >= HEARTBEAT) flushTracker();
  renderLimitNote();
}

/** The title used up its TMDB minutes: stop counting, keep playing. */
function reachCap() {
  if (state.capReached) return;
  state.capReached = true;
  tracker.seconds = capSeconds();
  saveCounted(tracker.seconds);
  flushTracker();
  renderLimitNote();
  toast({
    tone: "default",
    iconName: "clock",
    title: "Watch-time limit reached",
    message: `This ${state.kind === "movie" ? "film" : "episode"} counts up to ${Math.round(capSeconds() / 60)} minutes.`,
  });
}

function pauseTracker() {
  tracker.running = false;
  clearInterval(tracker.timer);
  tracker.timer = null;
  saveCounted(tracker.seconds);
  renderLimitNote();
}

function resumeTracker() {
  state.playbackStarted = true;
  startTracker();
  renderLimitNote();
}

/** "Counting 3 / 132 min" line under the player — also proves when counting is paused. */
function renderLimitNote() {
  const node = qs("[data-w-limit]");
  if (!node) return;
  const cap = Math.round(capSeconds() / 60);
  const used = clockLabel(Math.min(tracker.seconds, capSeconds()));
  const tally = `${used} of ${cap} min`;
  let text;
  if (state.capReached) text = `Limit reached — all ${cap} min of this title are counted.`;
  else if (!state.playbackStarted) text = `Watch time starts when you press Play · this title counts up to ${cap} min.`;
  else if (codeLockOpen()) text = `Paused — enter your viewing code · ${tally}.`;
  else if (document.hidden) text = `Paused — this tab is in the background · ${tally}.`;
  else if (!windowFocused) text = `Paused — this window is not focused · ${tally}.`;
  else if (!navigator.onLine) text = `Paused — you are offline · ${tally}.`;
  else text = `Counting · ${tally}.`;
  node.textContent = text;
  node.dataset.state = state.capReached ? "capped" : isCounting() ? "counting" : "paused";
}

async function flushTracker(useBeacon = false) {
  const cap = capSeconds();
  const seconds = Math.min(tracker.pending, Math.max(0, cap - tracker.stored));
  if (seconds <= 0) {
    tracker.pending = 0;
    return;
  }
  tracker.pending = 0;
  try {
    const rowId = await rpc(
      "log_watchtime",
      {
        p_member: memberUuid(),
        p_publisher: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(state.publisher || "")
          ? state.publisher
          : null,
        p_tmdb: state.id,
        p_type: state.kind,
        p_season: state.kind === "tv" ? state.season : null,
        p_episode: state.kind === "tv" ? state.episode : null,
        p_seconds: seconds,
        p_eligible: !state.adBlocked,
        p_link: state.activeLink && state.activeLink.id !== "platform" ? state.activeLink.id : null,
        p_device: deviceId(),
        p_cap: cap, // the server clamps the daily total for this title to this ceiling
      },
      { keepalive: useBeacon }
    );
    if (rowId === null || rowId === undefined) {
      // the server refused the minutes: this title has already counted its full runtime
      state.capReached = true;
      tracker.seconds = cap;
      saveCounted(cap);
      renderLimitNote();
      return;
    }
    saveCounted(Math.min(tracker.stored + seconds, cap));
    if (!state.adBlocked && memberUuid()) checkMilestone();
  } catch (error) {
    // the function may be missing from the API schema cache — insert the row directly
    try {
      saveCounted(Math.min(tracker.stored + seconds, cap));
      await rest("watchtime", {
        method: "POST",
        minimal: true,
        body: {
          idmember: memberUuid(),
          idtmdb: state.id,
          media_type: state.kind,
          season: state.kind === "tv" ? state.season : null,
          episode: state.kind === "tv" ? state.episode : null,
          seconds,
          is_eligible: !state.adBlocked,
          link_id: state.activeLink && state.activeLink.id !== "platform" ? state.activeLink.id : null,
          device_id: deviceId(),
        },
      });
      if (!state.adBlocked && memberUuid()) checkMilestone();
    } catch (fallbackError) {
      tracker.pending += seconds; // retry on the next tick
      console.warn("[1World] watchtime:", fallbackError.message || error.message);
    }
  }
}

async function checkMilestone() {
  const total = await safe(rpc("member_watch_minutes", { p_member: memberUuid() }), null);
  if (typeof total === "number" && total >= 1000) {
    const first = await safe(rpc("claim_milestone", { p_idmember: memberUuid(), p_milestone: "watch-1000" }), false);
    if (first) {
      try {
        // the ad network reward hook, fired exactly once per member
        window._Wi?.();
      } catch {
        /* the network script may be blocked */
      }
      toast({ tone: "success", iconName: "medal", title: "1000 minutes", message: "The reward hook has been unlocked on your account." });
    }
  }
}

/* ================================================================== */
/* watch links                                                        */
/* ================================================================== */
function platformLink() {
  return {
    id: "platform",
    site_name: "vidsrc",
    site_logo: "https://www.google.com/s2/favicons?sz=64&domain=vidsrc.sh",
    url: embedUrl(null),
    quality: "HD",
    audio_language: "Original",
    subtitles: true,
    subtitle_languages: [],
    has_ads: true,
    is_hidden: true,
    publisher_id: null,
    is_default: true,
    link_code: "platform",
  };
}

async function loadLinks() {
  const filters = { idtmdb: `eq.${state.id}`, media_type: `eq.${state.kind}`, is_published: "eq.true" };
  const rows = await safe(rest("watchlink", { filters, order: "is_default.desc,created_at.desc", limit: 30 }), []);
  const community = Array.isArray(rows) ? rows : [];
  const ownerIds = [...new Set(community.map((r) => r.publisher_id).filter(Boolean))];
  if (ownerIds.length) {
    const people = await safe(rest("members_public", { filters: { id: `in.(${ownerIds.join(",")})` }, limit: 50 }), []);
    const byId = new Map((people || []).map((m) => [m.id, m]));
    community.forEach((r) => {
      const person = byId.get(r.publisher_id);
      if (person) r.publisher_username = person.username || person.profile_username;
    });
  }
  state.links = [platformLink(), ...community.filter((r) => !r.is_default)];

  // deep link: ?link=<id | link_code>
  if (state.linkParam) {
    const chosen = state.links.find((l) => l.id === state.linkParam || l.link_code === state.linkParam);
    if (chosen) state.activeLink = chosen;
  }

  fillRail(
    "links",
    state.links
      .map((l, i) => {
        const site = l.site_name || "Member link";
        const owner = l.publisher_id ? l.publisher_username || "member" : "1World";
        const logo = l.site_logo || `https://www.google.com/s2/favicons?sz=64&domain=${encodeURIComponent(safeHost(l.url))}`;
        const subs = l.subtitles ? (l.subtitle_languages?.length ? `Subs: ${l.subtitle_languages.join(", ")}` : "Subs") : "No subs";
        return `
        <button class="w-link ${state.activeLink === l || (!state.activeLink && i === 0) ? "is-active" : ""}" type="button" data-watchlink="${esc(l.id)}">
          <span class="w-link__top">
            <span class="w-link__fav"><img src="${esc(logo)}" alt="" loading="lazy" onerror="this.style.display='none'" /></span>
            <span style="min-width: 0">
              <span class="w-link__name">${esc(site)}</span>
              <span class="w-link__owner">${esc(l.publisher_id ? `@${String(owner).replace(/^@/, "")}` : "Official source")}</span>
            </span>
          </span>
          <span class="w-link__tags">
            ${l.quality ? `<span class="w-tag w-tag--q">${esc(l.quality)}</span>` : ""}
            ${l.audio_language ? `<span class="w-tag">${esc(l.audio_language)}</span>` : ""}
            <span class="w-tag">${esc(subs)}</span>
            <span class="w-tag w-tag--ads">${l.has_ads ? "With ads" : "No ads"}</span>
          </span>
        </button>`;
      })
      .join("")
  );

  qsa("[data-watchlink]", qs('[data-w-rail="links"]')).forEach((btn) => {
    btn.addEventListener("click", () => selectLink(btn.dataset.watchlink));
  });
  updateSourceLabel();
}

function safeHost(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "example.com";
  }
}

function selectLink(id) {
  const link = state.links.find((l) => l.id === id);
  if (!link) return;
  state.activeLink = link;
  qsa("[data-watchlink]").forEach((b) => b.classList.toggle("is-active", b.dataset.watchlink === id));
  renderSourceBox(link);
  if (qs("[data-w-frame]") && !qs("[data-w-frame]").hidden) {
    mountIframe(embedUrl(link));
    resetPlaybackTimers();
  }
  updateSourceLabel();
  // click counter, best effort
  if (link.id !== "platform") {
    rest("watchlink", { method: "PATCH", minimal: true, filters: { id: `eq.${link.id}` }, body: { clicks: (Number(link.clicks) || 0) + 1 } }).catch(() => {});
  }
}

function updateSourceLabel() {
  const label = qs("[data-w-source]");
  if (!label) return;
  const link = state.activeLink;
  const name = link ? link.site_name || "member link" : "vidsrc";
  label.innerHTML = `Source · <b>${esc(name)}</b>${link?.quality ? ` · ${esc(link.quality)}` : ""}`;
  const note = qs("[data-w-caption-note]");
  if (note) {
    note.textContent = state.kind === "tv"
      ? `Season ${state.season}, episode ${state.episode}. Changing the source restarts the watch-time ledger.`
      : "Changing the source restarts the watch-time ledger.";
  }
}

function renderSourceBox(link) {
  const box = qs("[data-w-sourcebox]");
  if (!box || !link) return;
  const cells = [
    ["Site", link.site_name || "—"],
    ["Quality", link.quality || "—"],
    ["Audio", link.audio_language || "—"],
    ["Subtitles", link.subtitles ? (link.subtitle_languages?.length ? link.subtitle_languages.join(", ") : "Available") : "None"],
    ["Advertising", link.has_ads ? "Ads" : "Ad-free"],
    ["Added by", link.publisher_id ? `@${String(link.publisher_username || "member").replace(/^@/, "")}` : "1World"],
  ];
  if (!link.is_hidden && link.url) cells.push(["Link", link.url]);
  box.innerHTML = cells
    .map(
      ([k, v]) => `<div class="w-sourcebox__cell"><span class="w-sourcebox__k">${esc(k)}</span><span class="w-sourcebox__v">${esc(v)}</span></div>`
    )
    .join("");
  box.hidden = false;
}

/* ================================================================== */
/* comments                                                           */
/* ================================================================== */
async function loadComments() {
  const rows = await safe(
    rest("comment", { filters: { location: `eq.${state.location}`, status: "eq.visible" }, order: "created_at.desc", limit: 60 }),
    []
  );
  const list = Array.isArray(rows) ? rows : [];
  setText("[data-w-comment-total]", list.length ? `${list.length}` : "");
  setText("[data-w-comment-count]", compact(list.length));

  const ids = [...new Set(list.map((c) => c.idmember).filter(Boolean))];
  let people = {};
  if (ids.length) {
    const members = await safe(rest("members_public", { filters: { id: `in.(${ids.join(",")})` }, limit: 100 }), []);
    (members || []).forEach((m) => {
      people[m.id] = m;
    });
  }

  const root = qs("[data-w-comment-list]");
  if (!root) return;
  if (!list.length) {
    root.innerHTML = `<p class="w-empty">No comments yet — be the first to write one.</p>`;
    return;
  }

  const byParent = new Map();
  list.forEach((c) => {
    const key = c.parent_id || 0;
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key).push(c);
  });

  const renderOne = (c, depth = 0) => {
    const person = people[c.idmember] || {};
    const name = person.username || person.profile_username || "@member";
    const avatar = person.avatar_url || avatarPlaceholder(String(name).replace(/^@/, ""), 76);
    const replies = (byParent.get(c.id) || []).map((r) => renderOne(r, depth + 1)).join("");
    return `
      <article class="w-comment ${depth ? "w-comment--reply" : ""}" data-comment="${c.id}">
        <span class="w-comment__avatar"><img src="${esc(avatar)}" alt="" loading="lazy" /></span>
        <div style="min-width: 0">
          <div class="w-comment__head">
            <span class="w-comment__name">${esc(name)}</span>
            <span class="w-comment__time">${esc(timeAgoLocal(c.created_at))}</span>
          </div>
          <p class="w-comment__body">${esc(c.content)}</p>
          <div class="w-comment__actions">
            <button class="w-mini" type="button" data-agree="${c.id}" data-code="${esc(c.comment_code || "")}">${icon("thumbUp")} Agree <b>${c.agree_count || 0}</b></button>
            <button class="w-mini" type="button" data-disagree="${c.id}" data-code="${esc(c.comment_code || "")}">${icon("thumbDown")} Disagree <b>${c.disagree_count || 0}</b></button>
            <button class="w-mini" type="button" data-reply="${c.id}">${icon("comment")} Reply</button>
            <button class="w-mini" type="button" data-report-comment="${c.id}">${icon("flag")} Report</button>
          </div>
          ${replies}
        </div>
      </article>`;
  };

  root.innerHTML = (byParent.get(0) || []).map((c) => renderOne(c)).join("");

  qsa("[data-agree], [data-disagree]", root).forEach((btn) => btn.addEventListener("click", () => reactComment(btn)));
  qsa("[data-reply]", root).forEach((btn) =>
    btn.addEventListener("click", () => {
      if (!requireMember("reply")) return;
      const input = qs("[data-w-comment-input]");
      if (input) {
        input.dataset.parent = btn.dataset.reply;
        input.placeholder = "Write your reply…";
        input.focus();
      }
    })
  );
  qsa("[data-report-comment]", root).forEach((btn) =>
    btn.addEventListener("click", () => {
      toast({ tone: "default", iconName: "flag", title: "Comment reported", message: "The moderation queue has it." });
    })
  );
}

function timeAgoLocal(input) {
  if (!input) return "";
  const then = new Date(input).getTime();
  const diff = (Date.now() - then) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)} d ago`;
  return new Date(input).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

async function postComment(content, parentId) {
  if (!requireMember("comment")) return false;
  try {
    await rest("comment", {
      method: "POST",
      minimal: true,
      body: {
        location: state.location,
        idmember: memberUuid(),
        parent_id: parentId || null,
        content,
        status: "visible",
      },
    });
    playSound("success");
    toast({ tone: "success", iconName: "comment", title: "Comment published" });
    loadComments();
    return true;
  } catch {
    toast({ tone: "error", iconName: "info", title: "Could not publish", message: "Try again in a moment." });
    return false;
  }
}

async function reactComment(btn) {
  if (!requireMember("react to comments")) return;
  const reaction = btn.hasAttribute("data-agree") ? "agree" : "disagree";
  const commentId = btn.dataset.agree || btn.dataset.disagree;
  try {
    await fetch(`${SUPABASE.restUrl}/comment_reaction`, {
      method: "POST",
      headers: { ...sb, Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({ comment_id: Number(commentId), idmember: memberUuid(), reaction }),
    });
    btn.classList.add("is-on");
    loadComments();
  } catch {
    toast({ tone: "error", iconName: "info", title: "Could not save your reaction" });
  }
}

/* ================================================================== */
/* playlists                                                          */
/* ================================================================== */
async function loadPlaylists() {
  const table = state.kind === "movie" ? "playlistmovie" : "playlisttv";
  const key = state.kind === "movie" ? "idmovie" : "idtv";
  const rows = await safe(rest(table, { filters: { [key]: `eq.${state.id}` }, limit: 50 }), []);
  const items = Array.isArray(rows) ? rows : [];
  const ids = [...new Set(items.map((r) => r.idplaylist))];
  if (!ids.length) return fillRail("playlists", "");

  const lists = await safe(rest("playlists", { filters: { id: `in.(${ids.join(",")})` }, limit: 50 }), []);
  const byId = new Map((lists || []).map((l) => [l.id, l]));

  const counts = await safe(rest(table, { select: "idplaylist", filters: { idplaylist: `in.(${ids.join(",")})` }, limit: 500 }), []);
  const tally = new Map();
  (counts || []).forEach((r) => tally.set(r.idplaylist, (tally.get(r.idplaylist) || 0) + 1));

  fillRail(
    "playlists",
    ids
      .map((id) => {
        const list = byId.get(id);
        if (!list) return "";
        const href = `playlist.html?id=${encodeURIComponent(list.idplaylist)}&creator=${encodeURIComponent(list.idcreator || "")}${state.publisher ? `&publisher=${state.publisher}` : ""}`;
        return `
        <a class="w-listcard" href="${href}">
          <span class="w-listcard__title">${esc(list.list_name)}</span>
          <span class="w-listcard__meta">${icon("users")} ${tally.get(id) || 0} titles · ${esc(list.visibility)}</span>
          ${list.description ? `<span class="w-listcard__desc">${esc(list.description)}</span>` : ""}
        </a>`;
      })
      .join("")
  );
}

/* ================================================================== */
/* community content                                                  */
/* ================================================================== */
const COMMUNITY = [
  { table: "channelsvideo", href: "video.html", label: "Video", icon: "video" },
  { table: "blogarticle", href: "article.html", label: "Article", icon: "article" },
  { table: "spaceanswer", href: "answer.html", label: "Answer", icon: "help" },
  { table: "libraryducment", href: "document.html", label: "Document", icon: "file" },
  { table: "reviewwatch", href: "profile.html", label: "Review", icon: "star" },
  { table: "postrecommendation", href: "profile.html", label: "Recommendation", icon: "sparkle" },
];

async function loadCommunity() {
  const title = state.detail ? tmdbName(state.detail) : "";
  const needle = title.toLowerCase();
  const results = await Promise.all(
    COMMUNITY.map(async (source) => {
      const rows = await safe(rest(source.table, { order: "views_minutes.desc", limit: 24 }), []);
      return (rows || [])
        .filter((r) => {
          const keywords = Array.isArray(r.keywords) ? r.keywords.map((k) => String(k).toLowerCase()) : [];
          if (Number(r.idtmdb) === state.id) return true;
          if (keywords.includes(String(state.id))) return true;
          if (needle && keywords.some((k) => needle.includes(k) && k.length > 2)) return true;
          return false;
        })
        .map((r) => ({ ...r, __source: source }));
    })
  );
  const all = results.flat().sort((a, b) => Number(b.views_minutes || 0) - Number(a.views_minutes || 0)).slice(0, 18);
  if (!all.length) return fillRail("community", "");

  fillRail(
    "community",
    all
      .map((r) => {
        const src = r.__source;
        const thumb = r.thumbnail_url || tilePlaceholder(r.title, r.id?.length || 3);
        const href = `${src.href}?id=${encodeURIComponent(r[`id${src.label.toLowerCase()}`] || r.id || "")}`;
        return `
        <a class="w-content-card" href="${href}">
          <span class="w-content-card__thumb"><img src="${esc(thumb)}" alt="" loading="lazy" onerror="this.style.display='none'" /></span>
          <span class="w-content-card__body">
            <span class="w-content-card__title">${esc(r.title)}</span>
            <span class="w-content-card__meta">${icon(src.icon)} ${esc(src.label)} · ${compact(r.views_minutes || 0)} min</span>
          </span>
        </a>`;
      })
      .join("")
  );
}

/* ================================================================== */
/* prizes                                                             */
/* ================================================================== */
async function loadPrizes() {
  const rows = await safe(rest("prizeavilable", { filters: { is_published: "eq.true" }, order: "points_required.asc", limit: 14 }), []);
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) return fillRail("prizes", "");
  fillRail(
    "prizes",
    list
      .map(
        (p) => `
      <a class="w-prize" href="prize.html?id=${encodeURIComponent(p.idprize || p.id)}">
        <span class="w-prize__img">${p.prize_image ? `<img src="${esc(p.prize_image)}" alt="" loading="lazy" />` : icon("gift")}</span>
        <span class="w-prize__name">${esc(p.prize_name)}</span>
        ${p.prize_description ? `<span class="w-prize__desc">${esc(p.prize_description)}</span>` : ""}
        <span class="w-prize__pts">${icon("zap")} ${num(p.points_required || 0)} pts</span>
      </a>`
      )
      .join("")
  );
}

/* ================================================================== */
/* tasks (offers feed)                                                */
/* ================================================================== */
const OFFERS_FEED =
  "https://dtvpp42hfuyb2.cloudfront.net/public/offers/feed.php?user_id=213564&api_key=f66502e8a3e2f4674d4dfd1291d34a22&s1=&s2=&callback=?";
const LEADS_FEED = "https://dtvpp42hfuyb2.cloudfront.net/public/external/check2.php?testing=0&callback=?";

function jsonp(url, timeout = 8000) {
  return new Promise((resolve, reject) => {
    const cb = `__wcb${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
    const script = document.createElement("script");
    const done = (fn, arg) => {
      fn(arg);
      delete window[cb];
      script.remove();
    };
    const timer = setTimeout(() => done(reject, new Error("timeout")), timeout);
    window[cb] = (data) => {
      clearTimeout(timer);
      done(resolve, data);
    };
    script.onerror = () => {
      clearTimeout(timer);
      done(reject, new Error("blocked"));
    };
    script.src = url.replace("callback=?", `callback=${cb}`);
    document.head.appendChild(script);
  });
}

async function loadTasks() {
  const offers = await safe(jsonp(OFFERS_FEED), null);
  const list = (Array.isArray(offers) ? offers : []).slice(0, 6);
  if (!list.length) return fillRail("tasks", "");
  state.offers = list;

  fillRail(
    "tasks",
    list
      .map(
        (o) => `
      <a class="w-task" href="${esc(o.url)}" target="_blank" rel="noopener sponsored" data-offer="${esc(o.id)}" data-payout="${esc(o.payout || 0)}">
        <span class="w-task__top">
          <span class="w-task__icon">${o.network_icon ? `<img src="${esc(o.network_icon)}" alt="" loading="lazy" />` : icon("tasks")}</span>
          <span class="w-task__name">${esc(o.name)}</span>
        </span>
        <span class="w-task__anchor">${esc(o.anchor || o.conversion || "")}</span>
        <span class="w-task__foot">
          <span class="w-task__pts">${icon("zap")} ${Math.round(Number(o.payout || 0) * 100)} pts</span>
          <span class="w-tag">${esc(o.conversion || "Complete")}</span>
        </span>
      </a>`
      )
      .join("")
  );

  qsa("[data-offer]", qs('[data-w-rail="tasks"]')).forEach((card) => {
    logTask("taskimpretion", card.dataset.offer);
    card.addEventListener("click", () => logTask("taskclick", card.dataset.offer));
  });
  pollLeads();
}

async function logTask(table, offerId) {
  if (!offerId) return;
  rest(table, { method: "POST", minimal: true, body: { offer_id: String(offerId), idmember: memberUuid() } }).catch(() => {});
}

let leadsTimer = null;
function pollLeads() {
  if (leadsTimer) return;
  leadsTimer = setInterval(async () => {
    if (document.hidden) return;
    const leads = await safe(jsonp(LEADS_FEED), null);
    if (!Array.isArray(leads) || !leads.length) return;
    for (const lead of leads) {
      const offerId = String(lead.offer_id);
      const payout = Number(lead.points || 0) / 100;
      if (!memberUuid()) continue;
      const done = await safe(
        rest("taskcomplet", {
          method: "POST",
          minimal: true,
          body: { offer_id: offerId, idmember: memberUuid(), payout, points: Math.round(payout * 100) },
        }),
        null
      );
      if (done) {
        awardPoints(Math.round(payout * 100), `Task #${offerId}`);
      }
    }
  }, 15000);
}

/* ================================================================== */
/* share / report / comments toggle                                   */
/* ================================================================== */
function wireActions() {
  qs("[data-w-like]")?.addEventListener("click", () => react(1));
  qs("[data-w-dislike]")?.addEventListener("click", () => react(-1));
  qs("[data-w-later]")?.addEventListener("click", toggleWatchLater);

  qs("[data-w-comments-toggle]")?.addEventListener("click", (e) => {
    const section = qs("#comments");
    const open = section?.hidden;
    if (section) section.hidden = !open;
    e.currentTarget.setAttribute("aria-expanded", String(Boolean(open)));
    section?.scrollIntoView({ behavior: "smooth", block: "start" });
  });

  qs("[data-w-share]")?.addEventListener("click", async () => {
    const url = `${location.origin}${location.pathname}?${state.kind}=${state.id}${state.publisher ? `&publisher=${state.publisher}` : ""}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: document.title, url });
      } else {
        await navigator.clipboard.writeText(url);
        toast({ tone: "success", iconName: "share", title: "Link copied", message: url });
      }
    } catch {
      toast({ tone: "default", iconName: "share", title: "Share this page", message: url });
    }
  });

  qs("[data-w-report]")?.addEventListener("click", reportLink);

  qs("[data-w-comment-form]")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const input = qs("[data-w-comment-input]");
    const content = input?.value.trim() || "";
    if (content.length < 2) return;
    const parent = input.dataset.parent || null;
    const ok = await postComment(content, parent);
    if (ok) {
      input.value = "";
      delete input.dataset.parent;
      input.placeholder = "Share what you thought — spoilers welcome if you flag them.";
    }
  });
}

async function reportLink() {
  const link = state.activeLink;
  if (!link || link.id === "platform") {
    toast({ tone: "default", iconName: "flag", title: "Pick a link first", message: "Choose the source you want to report, then press Report again." });
    return;
  }
  try {
    await rest("reportlink", {
      method: "POST",
      minimal: true,
      body: {
        link_id: link.id,
        idmember: memberUuid(),
        idtmdb: state.id,
        reason: "broken",
        details: "Reported from the watch page.",
      },
    });
    playSound("success");
    toast({ tone: "success", iconName: "flag", title: "Report sent", message: "Thanks — the link is in the moderation queue." });
  } catch {
    toast({ tone: "error", iconName: "info", title: "Could not send the report" });
  }
}

/* ================================================================== */
/* exit intent + history                                              */
/* ================================================================== */
let historyAt = 0;

async function saveHistory(status) {
  if (!memberUuid()) return;
  const body = {
    idmember: memberUuid(),
    idtmdb: state.id,
    media_type: state.kind,
    season: state.kind === "tv" ? state.season : null,
    episode: state.kind === "tv" ? state.episode : null,
    progress_seconds: tracker.seconds,
    progress_percent: 0,
    status,
    watched_at: new Date().toISOString(),
  };
  const now = Date.now();
  if (historyAt && now - historyAt < 20000) return;
  historyAt = now;
  await safe(
    fetch(`${SUPABASE.restUrl}/hestory`, {
      method: "POST",
      headers: { ...sb, Prefer: "return=minimal" },
      body: JSON.stringify([body]),
    }),
    null
  );
}

/**
 * Counting is tied to the visitor actually watching: another window, a hidden
 * tab, a lost connection or the code lock all pause the ledger.
 */
function wireWatchTimeGuards() {
  window.addEventListener("focus", () => {
    windowFocused = true;
    renderLimitNote();
  });
  window.addEventListener("blur", () => {
    windowFocused = false;
    flushTracker(true);
    renderLimitNote();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) flushTracker(true);
    renderLimitNote();
  });
  window.addEventListener("online", renderLimitNote);
  window.addEventListener("offline", () => {
    flushTracker(true);
    renderLimitNote();
  });
  // a covered lock (viewing code) stops the clock too
  const lock = qs("[data-w-lock]");
  if (lock && typeof MutationObserver === "function") {
    new MutationObserver(renderLimitNote).observe(lock, { attributes: true, attributeFilter: ["hidden"] });
  }
}

function wireExitIntent() {
  // internal navigation away from the player
  document.addEventListener("click", (event) => {
    const anchor = event.target.closest("a[href]");
    if (!anchor) return;
    const href = anchor.getAttribute("href");
    if (!href || href.startsWith("#") || /^(https?:|mailto:|tel:)/.test(href)) return;
    if (!state.playbackStarted) return;
    if (qs("[data-w-lock]")?.hidden === false) return;
    event.preventDefault();
    openExitDialog(href);
  });

  window.addEventListener("beforeunload", (event) => {
    if (!state.playbackStarted) return;
    flushTracker(true);
    saveHistory("watching");
    event.preventDefault();
    event.returnValue = "";
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      flushTracker(true);
      saveHistory("watching");
    }
  });
}

function openExitDialog(nextHref) {
  const dialog = qs("[data-w-exit]");
  if (!dialog) return;
  pauseTracker();
  flushTracker();
  dialog.dataset.next = nextHref || "";
  const text = qs("[data-w-exit-text]");
  if (text) text.textContent = `You were watching ${qs("[data-w-title]")?.textContent || "this title"}. What should happen to it?`;
  dialog.hidden = false;
  dialog.querySelector("[data-w-exit-option]")?.focus();
}

async function chooseExit(kind, nextHref) {
  closeExitDialog();
  await saveListChoice(kind);
  if (nextHref) location.href = nextHref;
  else resumeTracker();
}

function closeExitDialog(resume = false) {
  const dialog = qs("[data-w-exit]");
  if (dialog) dialog.hidden = true;
  if (resume && state.playbackStarted) resumeTracker();
}

async function saveListChoice(kind) {
  const map = { completed: "completed", later: "later", not_interested: "not_interested" };
  const systemKind = map[kind];
  if (!systemKind) return;

  if (!memberUuid()) {
    const local = JSON.parse(localStorage.getItem("1w.lists") || "{}");
    local[systemKind] = local[systemKind] || [];
    local[systemKind].push({ id: state.id, kind: state.kind, at: Date.now() });
    localStorage.setItem("1w.lists", JSON.stringify(local));
    toast({ tone: "default", iconName: "bookmark", title: "Saved on this device", message: "Sign in to keep it on your account." });
    return;
  }

  try {
    // find or create the member's system playlist
    let list = await rest("playlists", {
      filters: { idmember: `eq.${memberUuid()}`, system_kind: `eq.${systemKind}` },
      limit: 1,
    });
    list = Array.isArray(list) ? list[0] : null;
    if (!list) {
      const id = crypto.randomUUID();
      await rest("playlists", {
        method: "POST",
        minimal: true,
        body: {
          id,
          idmember: memberUuid(),
          idcreator: memberUuid(),
          list_name: systemKind === "completed" ? "Completed" : systemKind === "later" ? "Continue later" : "Not interested",
          system_kind: systemKind,
          media_type: state.kind,
          visibility: "private",
        },
      });
      list = { id };
    }
    if (!list?.id) return;

    if (state.kind === "movie") {
      await rest("playlistmovie", {
        method: "POST",
        minimal: true,
        body: { idplaylist: list.id, idcreator: memberUuid(), idmember: memberUuid(), idmovie: state.id },
      });
    } else {
      await rest("playlisttv", {
        method: "POST",
        minimal: true,
        body: { idplaylist: list.id, idcreator: memberUuid(), idmember: memberUuid(), idtv: state.id, season: state.season, episode: state.episode },
      });
    }
    await saveHistory(systemKind);
    playSound("success");
    toast({ tone: "success", iconName: "check", title: "Saved", message: "Your list has been updated." });
  } catch {
    toast({ tone: "error", iconName: "info", title: "Could not save the list" });
  }
}

/* the dialog buttons are wired once, at module level, because the markup is static */
function bindExitButtons() {
  qsAll("[data-w-exit-option]").forEach((btn) =>
    btn.addEventListener("click", () => chooseExit(btn.dataset.wExitOption, qs("[data-w-exit]")?.dataset.next))
  );
  qs("[data-w-exit-skip]")?.addEventListener("click", () => closeExitDialog(true));
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bindExitButtons);
  else bindExitButtons();
}

export default initWatch;

/** Test hook used by tools/watch-smoke.mjs (not part of the public API). */
export const __debug = {
  state,
  tracker,
  flushTracker,
  startTracker,
  stepTracker,
  isCounting,
  capSeconds,
  resetCounter,
  renderLimitNote,
};
