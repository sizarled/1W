/**
 * cast.html — TMDB person profile controller.
 * ------------------------------------------------------------------
 *  • reads ?id=TMDB_PERSON_ID
 *  • looks the person up on 1World first (tmdb_people), then asks TMDB and
 *    stores the fresh copy back — TMDB is never called on a plain page view
 *    once the record is warm, and the cached copy is used when it fails
 *  • fans / haters / critics counts come from person_reactions (read-only)
 *  • the three dials (follow / repost / block) live in member_person_actions
 *  • films and series come from combined_credits, one reel each
 *  • reviews / articles / videos come from content_person_mentions
 *
 * Every network call degrades gracefully: no TMDB leaves the cached person,
 * no Supabase leaves the page readable.
 */

import { TMDB } from "./config.js";
import {
  esc,
  qs,
  qsa,
  compact,
  num,
  formatDate,
  enableDragScrollAll,
  scrollRail,
  tilePlaceholder,
  avatarPlaceholder,
} from "./utils.js";
import { icon } from "./icons.js";
import { brand } from "./brands.js";
import { toast } from "./ui.js";
import { playSound } from "./sound.js";
import { getMember } from "./session.js";
import { rest, rpc } from "./data.js";
import { refreshBlockMap } from "./blocks.js";

/* ================================================================== */
/* constants                                                          */
/* ================================================================== */
const PAGE = 24; // works per reel batch
const CACHE_FRESH_MS = 24 * 3600 * 1000; // re-sync a person at most once a day
const MEMBER_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/* TMDB external ids → the only links we will ever show (nothing invented) */
const SOCIAL = [
  { network: "facebook", field: "facebook_id", label: "Facebook", ico: "facebook", url: (id) => `https://www.facebook.com/${id}` },
  { network: "instagram", field: "instagram_id", label: "Instagram", ico: "instagram", url: (id) => `https://www.instagram.com/${id}` },
  { network: "twitter", field: "twitter_id", label: "X", ico: "x", url: (id) => `https://twitter.com/${id}` },
  { network: "tiktok", field: "tiktok_id", label: "TikTok", ico: "tiktok", url: (id) => `https://www.tiktok.com/@${String(id).replace(/^@/, "")}` },
  { network: "youtube", field: "youtube_id", label: "YouTube", ico: "youtube", url: (id) => `https://www.youtube.com/${id}` },
  { network: "imdb", field: "imdb_id", label: "IMDb", ico: "imdb", url: (id) => `https://www.imdb.com/name/${id}/` },
  { network: "wikidata", field: "wikidata_id", label: "Wikidata", ico: "globe", url: (id) => `https://www.wikidata.org/wiki/${id}` },
];

const state = {
  id: 0,
  person: null,
  links: [],
  works: { movie: [], tv: [] },
  shown: { movie: PAGE, tv: PAGE },
  mentions: [],
  tab: "review",
  stats: { fans: 0, haters: 0, critics: 0, followers: 0, reposters: 0, blocks: 0, mine: {} },
  actions: { follow: false, repost: false, block: false },
  member: null,
  cachedOnly: false,
  busy: false,
  savedAt: "",
};

/* ================================================================== */
/* helpers                                                            */
/* ================================================================== */
const param = (name, fallback = "") => new URLSearchParams(location.search).get(name) || fallback;
const img = (path, size = "w500") => (path ? `${TMDB.image}/${size}${path.startsWith("/") ? path : `/${path}`}` : "");

function imgTag(src, fallback, alt, cls = "") {
  const source = src || fallback || "";
  const fb = fallback && fallback !== source ? `data-fb="${esc(fallback)}"` : "";
  return `<img class="${cls}" src="${esc(source)}" alt="${esc(alt)}" loading="lazy" decoding="async" ${fb}
    onload="this.classList.add('is-loaded')"
    onerror="this.onerror=null;this.src=this.dataset.fb||'';this.classList.add('is-loaded')" />`;
}

async function tmdb(path, params = {}) {
  const url = new URL(`${TMDB.base}${path}`);
  url.searchParams.set("api_key", TMDB.apiKey);
  url.searchParams.set("language", "en-US");
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 9000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`TMDB ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

function ageOf(person) {
  if (!person?.birthday) return "";
  const born = new Date(person.birthday);
  if (Number.isNaN(born.getTime())) return "";
  const end = person.deathday ? new Date(person.deathday) : new Date();
  let age = end.getFullYear() - born.getFullYear();
  const before =
    end.getMonth() < born.getMonth() || (end.getMonth() === born.getMonth() && end.getDate() < born.getDate());
  if (before) age -= 1;
  return age > 0 ? String(age) : "";
}

function longDate(value) {
  if (!value) return "";
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}

function yearOf(value) {
  return String(value || "").slice(0, 4);
}

function memberId() {
  const id = String(state.member?.id || "");
  return MEMBER_RE.test(id) ? id : null;
}

/* ================================================================== */
/* boot                                                               */
/* ================================================================== */
export async function initCast() {
  state.id = Number(param("id") || 0);
  state.member = getMember();

  wireChrome();

  if (!state.id || Number.isNaN(state.id)) {
    renderMissing();
    return;
  }

  renderSkeleton();

  if (state.member) {
    refreshBlockMap(state.member).catch(() => null);
  }

  await loadPerson();
  await Promise.all([loadStats(), loadMentions()]);
  renderWorks();
  renderStats();
  renderActions();
  if (state.member) deliverNewWork();
}

/* ================================================================== */
/* person                                                             */
/* ================================================================== */
async function loadPerson() {
  const hero = qs("[data-c-hero]");

  // 1) warm cache first — the page is usable before TMDB answers
  const cached = await cacheRead();
  if (cached) {
    paint(cached.person, cached.links, cached.credits, { cached: true });
  }

  // 2) TMDB (fresh, also refreshes the stored copy)
  let fresh = null;
  try {
    const data = await tmdb(`/person/${state.id}`, { append_to_response: "external_ids,combined_credits" });
    if (data && data.id) fresh = normaliseTmdb(data);
  } catch (error) {
    console.warn("[1World] cast: TMDB unavailable", error.message);
  }

  if (!fresh) {
    state.cachedOnly = true;
    if (!cached) {
      renderMissing("This person could not be loaded. Check the id, or try again in a moment.");
      hero?.setAttribute("aria-busy", "false");
      return;
    }
    toast({
      title: "Showing the saved copy",
      message: "TMDB did not answer — biography, works and links come from 1World's own record.",
      tone: "info",
      iconName: "database",
    });
    return;
  }

  paint(fresh.person, fresh.links, fresh.credits, { cached: false });
  savePerson(fresh);
}

async function cacheRead() {
  try {
    const rows = await rest("tmdb_people", {
      select: "*,tmdb_person_external_links(network,url,handle),tmdb_person_credits(*)",
      filters: { tmdb_person_id: `eq.${state.id}` },
      single: true,
    });
    if (!rows) return null;
    const person = pickPerson(rows);
    const links = Array.isArray(rows.tmdb_person_external_links) ? rows.tmdb_person_external_links : [];
    const credits = Array.isArray(rows.tmdb_person_credits) ? rows.tmdb_person_credits : [];
    if (!person.name) return null;
    state.savedAt = rows.last_synced_at || "";
    return { person, links, credits: credits.map(pickCredit) };
  } catch {
    return null;
  }
}

function pickPerson(row) {
  return {
    tmdb_person_id: Number(row.tmdb_person_id),
    name: row.name || "",
    also_known_as: Array.isArray(row.also_known_as) ? row.also_known_as : [],
    biography: row.biography || "",
    profile_path: row.profile_path || "",
    known_for_department: row.known_for_department || "",
    birthday: row.birthday || "",
    deathday: row.deathday || "",
    place_of_birth: row.place_of_birth || "",
    gender: row.gender,
    popularity: row.popularity,
    imdb_id: row.imdb_id || "",
    homepage: row.homepage || "",
  };
}

function pickCredit(row) {
  return {
    media_type: row.media_type === "tv" ? "tv" : "movie",
    tmdb_media_id: Number(row.tmdb_media_id),
    title: row.title || "",
    original_title: row.original_title || "",
    character: row.character || "",
    job: row.job || "",
    department: row.department || "",
    release_date: row.release_date || "",
    poster_path: row.poster_path || "",
    vote_average: row.vote_average,
    popularity: row.popularity,
    episode_count: row.episode_count,
    is_cast: Boolean(row.is_cast),
  };
}

function normaliseTmdb(data) {
  const ids = data.external_ids || {};
  const links = [];
  SOCIAL.forEach((entry) => {
    const handle = ids[entry.field] || (entry.network === "imdb" ? data.imdb_id : "");
    if (!handle) return;
    links.push({ network: entry.network, url: entry.url(handle), handle: String(handle) });
  });
  if (data.homepage) {
    // TMDB's `homepage` is the official site — keep it only when it is a real URL
    try {
      const url = new URL(data.homepage);
      if (url.protocol === "https:" || url.protocol === "http:") {
        if (!links.some((link) => link.network === "website")) {
          links.push({ network: "website", url: data.homepage, handle: url.hostname.replace(/^www\./, "") });
        }
      }
    } catch {
      /* ignore a malformed homepage */
    }
  }

  const credits = [];
  const push = (item, isCast) => {
    const media = item.media_type === "tv" ? "tv" : "movie";
    credits.push({
      media_type: media,
      tmdb_media_id: Number(item.id),
      title: item.title || item.name || "Untitled",
      original_title: item.original_title || item.original_name || "",
      character: item.character || "",
      job: item.job || "",
      department: item.department || "",
      release_date: item.release_date || item.first_air_date || "",
      poster_path: item.poster_path || "",
      vote_average: item.vote_average ?? null,
      popularity: item.popularity ?? null,
      episode_count: item.episode_count ?? null,
      is_cast: isCast,
    });
  };
  (data.combined_credits?.cast || []).forEach((item) => push(item, true));
  (data.combined_credits?.crew || []).forEach((item) => push(item, false));

  return {
    person: {
      tmdb_person_id: Number(data.id),
      name: data.name || "",
      also_known_as: Array.isArray(data.also_known_as) ? data.also_known_as : [],
      biography: data.biography || "",
      profile_path: data.profile_path || "",
      known_for_department: data.known_for_department || "",
      birthday: data.birthday || "",
      deathday: data.deathday || "",
      place_of_birth: data.place_of_birth || "",
      gender: data.gender,
      popularity: data.popularity,
      imdb_id: data.imdb_id || "",
      homepage: data.homepage || "",
    },
    links,
    credits,
  };
}

/** Store the fresh copy — TMDB is not hit again for this person today. */
async function savePerson({ person, links, credits }) {
  if (!person?.tmdb_person_id) return;
  const fresh = !state.cachedOnly && !state.savedAt;
  try {
    const payload = {
      p_person: person,
      p_links: links,
      p_credits: credits.slice(0, 400),
    };
    const saved = await rpc("person_save", payload);
    if (saved?.credits_added > 0 && state.member) {
      // new titles for a followed / reposted person are delivered by the dials
      deliverNewWork();
    }
    if (fresh) state.savedAt = new Date().toISOString();
  } catch (error) {
    console.warn("[1World] cast: could not store the person", error.message);
  }
}

/* ================================================================== */
/* paint                                                              */
/* ================================================================== */
function renderSkeleton() {
  const facts = qs("[data-c-facts]");
  if (facts) {
    facts.innerHTML = ["Birthday", "Place of birth", "Known for", "TMDB id"]
      .map((label) => `<div class="c-fact"><dt>${label}</dt><dd class="c-skel">—</dd></div>`)
      .join("");
  }
}

function paint(person, links, credits, { cached }) {
  state.person = person;
  state.links = links || [];
  state.works = groupWorks(credits || []);
  state.shown = { movie: PAGE, tv: PAGE };

  document.title = `${person.name} — 1World Web`;
  const crumb = qs("[data-c-crumb]");
  if (crumb) crumb.textContent = person.name;

  const hero = qs("[data-c-hero]");
  hero?.setAttribute("aria-busy", "false");
  hero?.classList.toggle("is-cached", Boolean(cached));

  const nameEl = qs("[data-c-name]");
  if (nameEl) nameEl.textContent = person.name || "Unknown";

  const photo = qs("[data-c-photo]");
  if (photo) {
    photo.src = img(person.profile_path, "w500") || avatarPlaceholder(person.name || "1W", 450);
    photo.alt = person.name ? `${person.name} portrait` : "Portrait";
    photo.dataset.fb = avatarPlaceholder(person.name || "1W", 450);
    photo.addEventListener("load", () => photo.classList.add("is-loaded"));
    photo.addEventListener("error", () => {
      photo.onerror = null;
      photo.src = photo.dataset.fb;
      photo.classList.add("is-loaded");
    });
  }

  const dept = qs("[data-c-dept]");
  if (dept) {
    dept.hidden = !person.known_for_department;
    dept.textContent = person.known_for_department || "";
  }

  const kicker = qs("[data-c-kicker]");
  if (kicker) kicker.textContent = `${person.known_for_department || "Cast & crew"} · TMDB person ${person.tmdb_person_id}`;

  const aka = qs("[data-c-aka]");
  if (aka) {
    const list = (person.also_known_as || []).filter(Boolean).slice(0, 6);
    aka.hidden = !list.length;
    aka.innerHTML = list.length ? `<span>Also known as</span> ${list.map((n) => `<em>${esc(n)}</em>`).join(", ")}` : "";
  }

  renderFacts(person);
  renderLinks(person, links);
  renderBio(person);
  renderSide();
}

function fact(label, value, extra = "") {
  if (!value) return "";
  return `<div class="c-fact"><dt>${esc(label)}</dt><dd>${value}${extra}</dd></div>`;
}

function renderFacts(person) {
  const age = ageOf(person);
  const birthday = person.birthday
    ? `${esc(longDate(person.birthday))}${age ? `<span class="c-fact__note">age ${esc(age)}</span>` : ""}`
    : "";
  const death = person.deathday ? esc(longDate(person.deathday)) : "";

  const primary = [
    fact("Birthday", birthday),
    fact("Place of birth", person.place_of_birth ? esc(person.place_of_birth) : ""),
    fact("Died", death),
    fact("Known for", person.known_for_department ? esc(person.known_for_department) : ""),
    fact("Popularity", person.popularity ? compact(person.popularity) : ""),
    fact("TMDB id", `<a class="c-fact__link" href="https://www.themoviedb.org/person/${person.tmdb_person_id}" target="_blank" rel="noopener">${person.tmdb_person_id}${icon("external")}</a>`),
  ].join("");

  const facts = qs("[data-c-facts]");
  if (facts) facts.innerHTML = primary;

  const extra = [
    fact("Full name", (person.also_known_as || [])[0] ? esc(person.also_known_as[0]) : ""),
    fact("Birthday", person.birthday ? esc(longDate(person.birthday)) : ""),
    fact("Place of birth", person.place_of_birth ? esc(person.place_of_birth) : ""),
    fact("Died", death),
    fact("Department", person.known_for_department ? esc(person.known_for_department) : ""),
    fact("IMDb", person.imdb_id ? `<a class="c-fact__link" href="https://www.imdb.com/name/${esc(person.imdb_id)}/" target="_blank" rel="noopener">${esc(person.imdb_id)}${icon("external")}</a>` : ""),
    fact("1World record", state.savedAt ? `synced ${esc(formatDate(state.savedAt))}` : "stored on first visit"),
    fact("TMDB", `<a class="c-fact__link" href="https://www.themoviedb.org/person/${person.tmdb_person_id}" target="_blank" rel="noopener">person ${person.tmdb_person_id}${icon("external")}</a>`),
  ].join("");

  const extraEl = qs("[data-c-facts-extra]");
  if (extraEl) extraEl.innerHTML = extra || `<p class="c-empty">No personal data on record.</p>`;
}

function brandIcon(name) {
  if (name === "x") {
    // X (formerly Twitter) — official simple-icons path
    return `<svg class="ico c-link__brand" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z"/></svg>`;
  }
  if (name === "imdb") {
    return `<svg class="ico c-link__brand" viewBox="0 0 24 24" aria-hidden="true"><rect x="0.6" y="5.4" width="22.8" height="13.2" rx="2.4" fill="currentColor"/><text x="12" y="15.4" text-anchor="middle" font-size="8.2" font-family="Inter, sans-serif" font-weight="800" fill="var(--bg)">IMDb</text></svg>`;
  }
  const markup = brand(name, "ico c-link__brand");
  if (markup) return markup;
  return icon("globe", "ico c-link__brand");
}

function renderLinks(person, links) {
  const host = qs("[data-c-links]");
  if (!host) return;
  const list = (links || []).filter((link) => link && link.url);
  const chips = list.map((link) => {
    const known = SOCIAL.find((entry) => entry.network === link.network);
    const label = known ? known.label : link.network === "website" ? "Website" : link.network;
    const ico = known ? known.ico : "globe";
    return `<a class="c-link" href="${esc(link.url)}" target="_blank" rel="noopener noreferrer" title="${esc(label)}">
      ${brandIcon(ico)}<span class="c-link__label">${esc(label)}</span>
    </a>`;
  });
  if (person?.homepage && !list.some((link) => link.network === "website")) {
    chips.push(`<a class="c-link" href="${esc(person.homepage)}" target="_blank" rel="noopener noreferrer" title="Official website">
      ${brandIcon("globe")}<span class="c-link__label">Website</span></a>`);
  }
  host.innerHTML = chips.length
    ? `<p class="c-links__title">Official links</p><div class="c-links__row">${chips.join("")}</div>`
    : `<p class="c-links__title">Official links</p><p class="c-empty c-empty--inline">TMDB holds no official social link for this person — nothing is made up.</p>`;
}

function renderBio(person) {
  const host = qs("[data-c-bio]");
  const note = qs("[data-c-bio-note]");
  const more = qs("[data-c-bio-more]");
  const text = (person.biography || "").trim();

  if (note) note.textContent = text ? `${text.split(/\s+/).length} words` : "";
  if (!host) return;

  if (!text) {
    host.innerHTML = `<p class="c-empty">No biography on record for ${esc(person.name || "this person")}.</p>`;
    if (more) more.hidden = true;
    return;
  }

  const paragraphs = text.split(/\n{2,}/).filter(Boolean);
  host.innerHTML = paragraphs.map((block) => `<p>${esc(block.trim())}</p>`).join("");
  host.classList.add("is-clamped");
  if (more) {
    more.hidden = host.scrollHeight <= host.clientHeight + 24;
    more.textContent = "Read more";
    more.setAttribute("aria-expanded", "false");
  }
}

function renderSide() {
  const host = qs("[data-c-side]");
  if (!host) return;
  const films = state.works.movie.length;
  const series = state.works.tv.length;
  const latest = [...state.works.movie, ...state.works.tv]
    .filter((item) => item.date)
    .sort((a, b) => (a.date < b.date ? 1 : -1))[0];
  const best = [...state.works.movie, ...state.works.tv]
    .filter((item) => item.rating)
    .sort((a, b) => b.rating - a.rating)[0];

  host.innerHTML = `
    <p class="c-side__title">At a glance</p>
    <dl class="c-side__list">
      <div><dt>Movies</dt><dd>${num(films)}</dd></div>
      <div><dt>TV series</dt><dd>${num(series)}</dd></div>
      <div><dt>Followers</dt><dd data-c-side-followers>${num(state.stats.followers || 0)}</dd></div>
      <div><dt>Reposters</dt><dd data-c-side-reposters>${num(state.stats.reposters || 0)}</dd></div>
    </dl>
    ${latest ? `<p class="c-side__latest"><span>Latest</span><b>${esc(latest.title)}</b><i>${esc(yearOf(latest.date))}</i></p>` : ""}
    ${best ? `<p class="c-side__latest"><span>Top rated</span><b>${esc(best.title)}</b><i>${best.rating ? `★ ${Number(best.rating).toFixed(1)}` : ""}</i></p>` : ""}
  `;
}

/* ================================================================== */
/* works                                                              */
/* ================================================================== */
function groupWorks(credits) {
  const out = { movie: [], tv: [] };
  const seen = new Map();

  credits.forEach((credit) => {
    if (!credit?.tmdb_media_id) return;
    const type = credit.media_type === "tv" ? "tv" : "movie";
    const key = `${type}:${credit.tmdb_media_id}`;
    let item = seen.get(key);
    if (!item) {
      item = {
        id: credit.tmdb_media_id,
        media_type: type,
        title: credit.title,
        date: credit.release_date || "",
        poster_path: credit.poster_path || "",
        rating: credit.vote_average ? Number(credit.vote_average) : 0,
        roles: [],
      };
      seen.set(key, item);
      out[type].push(item);
    }
    if (credit.poster_path && !item.poster_path) item.poster_path = credit.poster_path;
    if (credit.release_date && !item.date) item.date = credit.release_date;
    if (credit.vote_average && !item.rating) item.rating = Number(credit.vote_average);
    if (credit.character) item.roles.push({ kind: "Acting", value: credit.character });
    if (credit.job) item.roles.push({ kind: credit.job, value: "" });
  });

  Object.values(out).forEach((list) =>
    list.sort((a, b) => {
      if (a.date && b.date) return a.date < b.date ? 1 : -1;
      if (a.date) return -1;
      if (b.date) return 1;
      return a.title.localeCompare(b.title);
    })
  );

  return out;
}

function roleLabel(item) {
  if (!item.roles.length) return item.media_type === "tv" ? "Series" : "Film";
  const acting = item.roles.find((role) => role.kind === "Acting");
  if (acting) return acting.value ? `as ${acting.value}` : "Acting";
  const jobs = Array.from(new Set(item.roles.map((role) => role.kind))).filter(Boolean);
  return jobs.slice(0, 2).join(" · ");
}

function workKind(item) {
  if (item.roles.some((role) => role.kind === "Acting")) return "Acting";
  return item.roles[0]?.kind || (item.media_type === "tv" ? "Series" : "Film");
}

function workCard(item) {
  const href = item.media_type === "tv" ? `watch.html?tv=${item.id}` : `watch.html?movie=${item.id}`;
  const title = item.title || "Untitled";
  const year = yearOf(item.date);
  const kind = workKind(item);
  const role = roleLabel(item);
  return `<a class="pcard c-card-work" href="${href}" aria-label="${esc(title)}${role ? ` — ${esc(role)}` : ""}">
    <span class="pcard__media">
      ${imgTag(img(item.poster_path, "w342"), tilePlaceholder(title, item.id), `${title} poster`, "pcard__img")}
      <span class="pcard__shade"></span>
      <span class="pcard__kind">${esc(kind)}</span>
      ${item.rating ? `<span class="pcard__rate">${icon("star")}${Number(item.rating).toFixed(1)}</span>` : ""}
    </span>
    <span class="pcard__body">
      <span class="pcard__title">${esc(title)}</span>
      <span class="pcard__meta">${esc([year, role].filter(Boolean).join(" · "))}</span>
      <span class="c-card-work__id">TMDB ${item.media_type === "tv" ? "tv" : "movie"} ${item.id}</span>
    </span>
  </a>`;
}

function renderWorks() {
  ["movie", "tv"].forEach((type) => {
    const track = qs(`[data-c-track="${type}"]`);
    const section = qs(`[data-c-reel="${type}"]`);
    const counter = qs(`[data-c-count="${type}"]`);
    const list = state.works[type];
    if (counter) counter.textContent = num(list.length);

    if (!track) return;
    track.setAttribute("aria-busy", "false");

    if (!list.length) {
      track.innerHTML = `<p class="c-empty">No ${type === "tv" ? "series" : "films"} recorded for this person.</p>`;
      section?.classList.add("is-empty");
      syncRail(type);
      return;
    }

    section?.classList.remove("is-empty");
    const shown = list.slice(0, state.shown[type]);
    const left = list.length - shown.length;
    track.innerHTML =
      shown.map(workCard).join("") +
      (left > 0
        ? `<button class="c-more c-more--rail" type="button" data-c-more="${type}">
             ${icon("plus")}<span>Show ${Math.min(PAGE, left)} more</span><em>${num(left)} left</em>
           </button>`
        : "");

    track.querySelectorAll("[data-c-more]").forEach((button) => {
      button.addEventListener("click", () => {
        state.shown[type] += PAGE;
        renderWorks();
        if (typeof track.scrollIntoView === "function") track.scrollIntoView({ block: "nearest", inline: "nearest" });
      });
    });

    enableDragScrollAll(section || document);
    syncRail(type);
  });
}

function syncRail(type) {
  const track = qs(`[data-c-track="${type}"]`);
  const prev = qs(`[data-c-prev="${type}"]`);
  const next = qs(`[data-c-next="${type}"]`);
  if (!track) return;
  const overflow = track.scrollWidth - track.clientWidth > 8;
  if (prev) prev.disabled = !overflow || track.scrollLeft < 8;
  if (next) next.disabled = !overflow || track.scrollLeft > track.scrollWidth - track.clientWidth - 8;
}

/* ================================================================== */
/* stats + dials                                                      */
/* ================================================================== */
async function loadStats() {
  const json = await rpc("person_stats", {
    p_tmdb: state.id,
    p_member: memberId(),
  }).catch(() => null);
  if (json && typeof json === "object") applyStats(json);
}

function applyStats(json) {
  state.stats = { ...state.stats, ...json, mine: json.mine || {} };
  state.actions = {
    follow: Boolean(json.mine?.follow),
    repost: Boolean(json.mine?.repost),
    block: Boolean(json.mine?.block),
  };
  renderStats();
  renderActions();
}

function renderStats() {
  const set = (sel, value) => {
    const node = qs(sel);
    if (node) node.textContent = num(value || 0);
  };
  set("[data-c-fans]", state.stats.fans);
  set("[data-c-haters]", state.stats.haters);
  set("[data-c-critics]", state.stats.critics);
  set("[data-c-side-followers]", state.stats.followers);
  set("[data-c-side-reposters]", state.stats.reposters);

  const mine = state.stats.mine?.reaction || "";
  qsa("[data-reaction]").forEach((button) => {
    const on = button.dataset.reaction === mine;
    button.setAttribute("aria-pressed", on ? "true" : "false");
    button.classList.toggle("is-on", on);
  });
}

function renderActions() {
  qsa("[data-dial-btn]").forEach((button) => {
    const name = button.dataset.dialBtn;
    const on = Boolean(state.actions[name]);
    button.setAttribute("aria-checked", on ? "true" : "false");
    button.classList.toggle("is-on", on);
    const row = button.closest("[data-dial]");
    row?.classList.toggle("is-on", on);
    if (name === "follow" || name === "repost") {
      button.disabled = state.actions.block;
      row?.classList.toggle("is-locked", state.actions.block);
    }
  });

  const note = qs("[data-c-action-state]");
  if (note) {
    const parts = [];
    if (state.actions.block) parts.push("Blocked — works hidden");
    if (state.actions.follow) parts.push("Following");
    if (state.actions.repost) parts.push("Reposting");
    note.textContent = parts.length ? parts.join(" · ") : "Follow, repost or block this person.";
    note.classList.toggle("is-on", parts.length > 0);
  }

  const blocked = Boolean(state.actions.block);
  const banner = qs("[data-c-blocked]");
  if (banner) banner.hidden = !blocked;
  ["movie", "tv"].forEach((type) => {
    const section = qs(`[data-c-reel="${type}"]`);
    if (section) section.hidden = blocked;
  });
  const mentions = qs("[data-c-mentions]");
  if (mentions) mentions.hidden = blocked;
}

function guardMember() {
  if (memberId()) return true;
  toast({
    title: "Members only",
    message: "Sign in to follow, repost, block or react to a person.",
    tone: "info",
    iconName: "lock",
    action: { href: `login.html?next=${encodeURIComponent(`cast.html?id=${state.id}`)}`, label: "Sign in" },
  });
  setTimeout(() => {
    location.href = `login.html?next=${encodeURIComponent(`cast.html?id=${state.id}`)}`;
  }, 900);
  return false;
}

async function setAction(name, on) {
  if (!guardMember()) return;
  if (state.busy) return;
  const next = { ...state.actions, [name]: on };
  if (name === "block" && on) {
    next.follow = false;
    next.repost = false;
  }
  if (name === "block" && !on) {
    // unblocking never restores follow / repost
    next.follow = false;
    next.repost = false;
  }

  state.busy = true;
  try {
    const json = await rpc("person_action_set", {
      p_member: memberId(),
      p_tmdb: state.id,
      p_follow: Boolean(next.follow),
      p_repost: Boolean(next.repost),
      p_block: Boolean(next.block),
    });
    state.actions = {
      follow: Boolean(json?.follow),
      repost: Boolean(json?.repost),
      block: Boolean(json?.block),
    };
    if (json?.stats) {
      state.stats = { ...state.stats, ...json.stats, mine: json.stats.mine || state.stats.mine };
    }
    renderActions();
    renderStats();
    updateBlockCache();

    const label = name === "block" ? (on ? "Blocked" : "Unblocked") : name === "follow" ? (on ? "Following" : "Unfollowed") : on ? "Reposting" : "Reposting off";
    toast({ title: label, message: personLabel(), tone: on ? "success" : "info", iconName: name === "block" ? "lock" : name === "follow" ? "bell" : "refresh" });
    playSound(on ? "success" : "notefcation", 0.3);

    if (on && (name === "follow" || name === "repost")) deliverNewWork();
  } catch (error) {
    console.warn("[1World] cast: action failed", error.message);
    toast({ title: "Could not save the action", message: "Try again in a moment.", tone: "error" });
    playSound("error", 0.3);
    renderActions();
  } finally {
    state.busy = false;
  }
}

/** Mirror the new block state locally so the other pages filter at once. */
async function updateBlockCache() {
  if (!memberId()) return;
  await refreshBlockMap(state.member);
}

async function deliverNewWork() {
  if (!memberId()) return;
  if (!state.actions.follow && !state.actions.repost) return;
  try {
    const res = await rpc("person_sync_deliveries", {
      p_member: memberId(),
      p_tmdb: state.id,
      p_limit: 3,
    });
    const notes = Number(res?.notifications || 0);
    const reposts = Number(res?.reposts || 0);
    if (notes || reposts) {
      toast({
        title: "New work delivered",
        message: [notes ? `${notes} notification${notes > 1 ? "s" : ""}` : "", reposts ? `${reposts} repost${reposts > 1 ? "s" : ""}` : ""]
          .filter(Boolean)
          .join(" · "),
        tone: "info",
        iconName: "bell",
        action: { href: "notifications.html", label: "Open notifications" },
      });
      playSound("notefcation", 0.28);
    }
  } catch (error) {
    console.warn("[1World] cast: delivery failed", error.message);
  }
}

const personLabel = () => (state.person ? `TMDB person ${state.person.tmdb_person_id}` : "");

async function setReaction(reaction) {
  if (!guardMember()) return;
  if (state.busy) return;
  const current = state.stats.mine?.reaction || "";
  const next = current === reaction ? "" : reaction;
  state.busy = true;
  try {
    const json = await rpc("person_reaction_set", {
      p_member: memberId(),
      p_tmdb: state.id,
      p_reaction: next,
    });
    if (json && typeof json === "object") {
      state.stats = { ...state.stats, ...json, mine: json.mine || {} };
    }
    renderStats();
    playSound(next ? "addPoint" : "notefcation", 0.28);
  } catch (error) {
    console.warn("[1World] cast: reaction failed", error.message);
    toast({ title: "Could not save your reaction", tone: "error" });
  } finally {
    state.busy = false;
  }
}

/* ================================================================== */
/* mentions                                                           */
/* ================================================================== */
async function loadMentions() {
  let rows = [];
  try {
    const json = await rpc("person_mentions", { p_tmdb: state.id });
    if (Array.isArray(json)) rows = json;
  } catch {
    rows = [];
  }

  const known = new Set(rows.map((row) => `${row.content_type}:${row.content_id}`));
  const found = await discoverMentions(known);
  state.mentions = [...rows, ...found].map((row) => ({
    ...row,
    type: row.content_type || row.type,
    published: row.published_at || row.created_at || "",
  }));

  renderTabCounts();
  renderMentions();
}

/** Content already on the site that names the person (no invented rows). */
async function discoverMentions(known) {
  const name = (state.person?.name || "").trim();
  if (!name) return [];
  const term = name.replace(/[%,()*]/g, " ").trim();
  if (!term) return [];
  const filters = { or: `(title.ilike.*${term}*,description.ilike.*${term}*)`, is_published: "eq.true" };

  const [reviews, articles, videos] = await Promise.all([
    rest("reviewwatch", { select: "id,title,description,thumbnail_url,rating,created_at", filters, limit: 6 }).catch(() => []),
    rest("blogarticle", { select: "id,title,description,thumbnail_url,created_at", filters, limit: 6 }).catch(() => []),
    rest("channelsvideo", { select: "id,title,description,thumbnail_url,created_at", filters, limit: 6 }).catch(() => []),
  ]);

  const map = [
    ["review", reviews],
    ["article", articles],
    ["video", videos],
  ];
  const out = [];
  map.forEach(([type, list]) => {
    (Array.isArray(list) ? list : []).forEach((row) => {
      const key = `${type}:${row.id}`;
      if (!row.id || known.has(key)) return;
      known.add(key);
      out.push({
        content_type: type,
        content_id: row.id,
        title: row.title,
        description: row.description,
        thumbnail_url: row.thumbnail_url,
        rating: row.rating,
        published_at: row.created_at,
      });
      // remember the match for the next visitor
      rpc("person_mention_add", { p_tmdb: state.id, p_type: type, p_content: row.id, p_title: row.title || "" }).catch(() => null);
    });
  });
  return out;
}

function renderTabCounts() {
  ["review", "article", "video"].forEach((type) => {
    const node = qs(`[data-c-tabcount="${type}"]`);
    if (node) node.textContent = num(state.mentions.filter((row) => row.type === type).length);
  });
}

function hrefFor(row) {
  if (row.type === "review") return `reviews.html?id=${encodeURIComponent(row.content_id)}`;
  if (row.type === "article") return `article.html?id=${encodeURIComponent(row.content_id)}`;
  return `video.html?id=${encodeURIComponent(row.content_id)}`;
}

function mentionCard(row) {
  const type = row.type;
  const label = type === "review" ? "Review" : type === "article" ? "Article" : "Video";
  const title = row.title || `${label} on 1World`;
  const text = String(row.description || "").replace(/\s+/g, " ").trim();
  const date = row.published ? formatDate(row.published) : "";
  const thumb = row.thumbnail_url || "";
  return `<a class="c-card" href="${hrefFor(row)}">
    <span class="c-card__thumb">${imgTag(thumb, tilePlaceholder(label, row.content_id || title), `${title} thumbnail`, "c-card__img")}</span>
    <span class="c-card__body">
      <span class="c-card__type">${icon(type === "review" ? "star" : type === "article" ? "article" : "video")}${label}</span>
      <span class="c-card__title">${esc(title)}</span>
      <span class="c-card__text">${esc(text.slice(0, 160))}${text.length > 160 ? "…" : ""}</span>
      <span class="c-card__meta">${esc(date)}${row.rating ? ` · ★ ${Number(row.rating).toFixed(1)}` : ""}</span>
    </span>
  </a>`;
}

function renderMentions() {
  const host = qs("[data-c-mention-list]");
  if (!host) return;
  const rows = state.mentions.filter((row) => row.type === state.tab);
  if (!rows.length) {
    const label = state.tab === "review" ? "reviews" : state.tab === "article" ? "articles" : "videos";
    host.innerHTML = `<p class="c-empty">No published ${label} mention ${esc(state.person?.name || "this person")} yet.</p>`;
    return;
  }
  host.innerHTML = rows
    .sort((a, b) => String(b.published || "").localeCompare(String(a.published || "")))
    .map(mentionCard)
    .join("");
}

/* ================================================================== */
/* chrome                                                             */
/* ================================================================== */
function wireChrome() {
  qsa("[data-dial-btn]").forEach((button) => {
    button.addEventListener("click", () => {
      const name = button.dataset.dialBtn;
      setAction(name, !state.actions[name]);
    });
  });

  qsa("[data-reaction]").forEach((button) => {
    button.addEventListener("click", () => setReaction(button.dataset.reaction));
  });

  const toggle = qs("[data-c-dials-toggle]");
  const dials = qs("[data-c-dials]");
  toggle?.addEventListener("click", () => {
    const open = dials?.hidden !== false;
    if (dials) dials.hidden = !open;
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
    toggle.classList.toggle("is-open", open);
    if (open && typeof dials?.scrollIntoView === "function") {
      dials.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  });

  qs("[data-c-unblock]")?.addEventListener("click", () => setAction("block", false));

  const bioMore = qs("[data-c-bio-more]");
  bioMore?.addEventListener("click", () => {
    const host = qs("[data-c-bio]");
    if (!host) return;
    const clamped = host.classList.toggle("is-clamped");
    bioMore.textContent = clamped ? "Read more" : "Show less";
    bioMore.setAttribute("aria-expanded", clamped ? "false" : "true");
  });

  qsa("[data-c-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      state.tab = button.dataset.cTab;
      qsa("[data-c-tab]").forEach((other) => other.setAttribute("aria-selected", other === button ? "true" : "false"));
      renderMentions();
    });
  });

  ["movie", "tv"].forEach((type) => {
    qs(`[data-c-prev="${type}"]`)?.addEventListener("click", () => {
      scrollRail(qs(`[data-c-track="${type}"]`), -1);
      setTimeout(() => syncRail(type), 380);
    });
    qs(`[data-c-next="${type}"]`)?.addEventListener("click", () => {
      scrollRail(qs(`[data-c-track="${type}"]`), 1);
      setTimeout(() => syncRail(type), 380);
    });
    qs(`[data-c-track="${type}"]`)?.addEventListener("scroll", () => syncRail(type), { passive: true });
  });
}

/* ================================================================== */
/* empty / missing                                                    */
/* ================================================================== */
function renderMissing(message = "Open this page as cast.html?id=TMDB_PERSON_ID, or pick a name from a title page.") {
  const main = qs("#main");
  if (!main) return;
  main.innerHTML = `
    <section class="soon" style="min-height: 60vh">
      <div class="soon__inner">
        <span class="soon__icon">${icon("users")}</span>
        <p class="eyebrow"><span class="eyebrow__dot"></span>Nothing to show</p>
        <h1 class="soon__title">Pick a person</h1>
        <p class="soon__text">${esc(message)}</p>
        <div class="soon__actions">
          <a class="btn btn--primary" href="movies.html">${icon("film")} Browse films</a>
          <a class="btn btn--ghost" href="index.html">${icon("home")} Home</a>
        </div>
      </div>
    </section>
  `;
}
