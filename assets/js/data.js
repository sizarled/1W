/**
 * Data access layer.
 *  • Supabase → members, notifications, features, apps, iptvfree, iptvpremium
 *  • TMDB     → trending films & series
 * Every call degrades gracefully: if the network, RLS policy or table is not
 * ready yet, the UI keeps rendering with the local editorial fallback below.
 */
import { SUPABASE, TMDB } from "./config.js";
import {
  pick,
  isTruthy,
  posterPlaceholder,
  backdropPlaceholder,
  tilePlaceholder,
  avatarPlaceholder,
} from "./utils.js";

const TIMEOUT = 6500;

async function http(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeout || TIMEOUT);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = text;
    }
    if (!res.ok) {
      const err = new Error((json && (json.message || json.error_description || json.hint)) || `HTTP ${res.status}`);
      err.status = res.status;
      err.body = json;
      throw err;
    }
    return json;
  } finally {
    clearTimeout(timer);
  }
}

/* ================================================================== */
/* Supabase REST                                                      */
/* ================================================================== */
const sbHeaders = {
  apikey: SUPABASE.publishableKey,
  Authorization: `Bearer ${SUPABASE.publishableKey}`,
  "Content-Type": "application/json",
};

export async function rest(table, { select = "*", filters = {}, order, limit, offset, method = "GET", body, single, minimal = false } = {}) {
  const url = new URL(`${SUPABASE.restUrl}/${table}`);
  url.searchParams.set("select", select);
  Object.entries(filters).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, value);
  });
  if (order) url.searchParams.set("order", order);
  if (limit) url.searchParams.set("limit", String(limit));
  if (offset) url.searchParams.set("offset", String(offset));

  // RLS tables without a SELECT policy reject INSERT … RETURNING, so writes that do
  // not need the row back must ask for `return=minimal`.
  const headers = { ...sbHeaders, Prefer: minimal ? "return=minimal" : "return=representation" };
  const res = await http(url.toString(), {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (Array.isArray(res) && single) return res[0] || null;
  return res;
}

/** Calls a Postgres function through PostgREST (security definer on the server). */
export async function rpc(fn, body = {}, { keepalive = false } = {}) {
  const res = await fetch(`${SUPABASE.restUrl}/rpc/${fn}`, {
    method: "POST",
    headers: { ...sbHeaders, Prefer: "return=representation" },
    body: JSON.stringify(body || {}),
    keepalive,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`rpc ${fn} ${res.status} ${text.slice(0, 180)}`);
  }
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/* ================================================================== */
/* Media helpers                                                      */
/* ================================================================== */
const GENRES = {
  movie: {
    28: "Action", 12: "Adventure", 16: "Animation", 35: "Comedy", 80: "Crime", 99: "Documentary",
    18: "Drama", 10751: "Family", 14: "Fantasy", 36: "History", 27: "Horror", 10402: "Music",
    9648: "Mystery", 10749: "Romance", 878: "Sci-Fi", 10770: "TV Movie", 53: "Thriller",
    10752: "War", 37: "Western",
  },
  tv: {
    10759: "Action", 16: "Animation", 35: "Comedy", 80: "Crime", 99: "Documentary", 18: "Drama",
    10751: "Family", 10762: "Kids", 9648: "Mystery", 10763: "News", 10764: "Reality",
    10765: "Sci-Fi", 10766: "Soap", 10767: "Talk", 10768: "War", 37: "Western",
  },
};

export const posterUrl = (path, size = "w500") =>
  path ? `${TMDB.image}/${size}${path.startsWith("/") ? path : `/${path}`}` : "";
export const backdropUrl = (path, size = "w1280") =>
  path ? `${TMDB.image}/${size}${path.startsWith("/") ? path : `/${path}`}` : "";

function normaliseMedia(item, kind) {
  const isTv = kind === "tv";
  const title =
    (isTv ? item.name || item.title : item.title || item.name) ||
    item.original_name ||
    item.original_title ||
    "Untitled";
  const date = (isTv ? item.first_air_date : item.release_date) || "";
  const year = date ? String(date).slice(0, 4) : "";
  const rating = item.vote_average ? Number(item.vote_average).toFixed(1) : "";
  const genreIds = item.genre_ids || [];
  return {
    id: item.id,
    kind,
    title,
    year,
    rating,
    overview: item.overview || "",
    posterPath: item.poster_path || "",
    backdropPath: item.backdrop_path || "",
    poster: posterUrl(item.poster_path) || posterPlaceholder({ title, year, rating, kind: isTv ? "Series" : "Film", seed: Number(item.id) || 0 }),
    backdrop: backdropUrl(item.backdrop_path) || backdropPlaceholder({ title, kind: isTv ? "Series" : "Film", seed: Number(item.id) || 0 }),
    genres: genreIds.map((g) => GENRES[isTv ? "tv" : "movie"][g]).filter(Boolean).slice(0, 3),
    href: `watch.html?${isTv ? "tv" : "movie"}=${item.id}`,
    source: item.__source || "live",
  };
}

/* ================================================================== */
/* TMDB                                                               */
/* ================================================================== */
const cache = new Map();
const CACHE_MS = 10 * 60 * 1000;

async function tmdb(path, params = {}) {
  const url = new URL(`${TMDB.base}${path}`);
  url.searchParams.set("api_key", TMDB.apiKey);
  url.searchParams.set("language", "en-US");
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const key = url.toString();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
  const json = await http(key, { timeout: 8000 });
  cache.set(key, { at: Date.now(), value: json });
  return json;
}

async function trending(kind, wanted = 50) {
  const pages = [1, 2, 3];
  const responses = await Promise.allSettled(pages.map((page) => tmdb(`/trending/${kind}/week`, { page })));
  const seen = new Set();
  const out = [];
  responses.forEach((r) => {
    if (r.status !== "fulfilled" || !r.value || !Array.isArray(r.value.results)) return;
    r.value.results.forEach((item) => {
      if (!item || seen.has(item.id)) return;
      seen.add(item.id);
      out.push(normaliseMedia(item, kind));
    });
  });
  if (!out.length) throw new Error("TMDB unavailable");
  return out.slice(0, wanted);
}

/* ================================================================== */
/* Fallback editorial catalogue (used when TMDB cannot be reached)     */
/* ================================================================== */
const FALLBACK_MOVIES = [
  { id: 157336, title: "Interstellar", year: "2014", rating: "8.4", overview: "A former pilot leads a small crew through a wormhole in search of a world humanity can call home." },
  { id: 27205, title: "Inception", year: "2010", rating: "8.4", overview: "A specialist who steals ideas inside dreams is offered one last job: plant one instead." },
  { id: 155, title: "The Dark Knight", year: "2008", rating: "8.5", overview: "Gotham's protector is pushed to his limit by an anarchist who wants to watch the city burn." },
  { id: 680, title: "Pulp Fiction", year: "1994", rating: "8.5", overview: "Several stories of small-time criminals fold into one another across a single Los Angeles day." },
  { id: 550, title: "Fight Club", year: "1999", rating: "8.4", overview: "An insomniac office worker builds an underground club that spirals far beyond his control." },
  { id: 603, title: "The Matrix", year: "1999", rating: "8.2", overview: "A programmer learns the world he lives in is a simulation, and that he may be able to bend it." },
  { id: 278, title: "The Shawshank Redemption", year: "1994", rating: "8.7", overview: "Two men serve decades behind bars and build a friendship that outlasts the walls around them." },
  { id: 238, title: "The Godfather", year: "1972", rating: "8.7", overview: "The reluctant son of a crime dynasty is pulled into the family business he tried to avoid." },
  { id: 13, title: "Forrest Gump", year: "1994", rating: "8.5", overview: "An ordinary man drifts through extraordinary decades, never quite meaning to change history." },
  { id: 496243, title: "Parasite", year: "2019", rating: "8.5", overview: "A struggling family infiltrates a wealthy household — until the house reveals what it hides." },
  { id: 872585, title: "Oppenheimer", year: "2023", rating: "8.1", overview: "The physicist who built the bomb spends the rest of his life living inside its shadow." },
  { id: 693134, title: "Dune: Part Two", year: "2024", rating: "8.2", overview: "A young heir joins the desert people and chooses between revenge and the fate they see in him." },
  { id: 438631, title: "Dune", year: "2021", rating: "7.8", overview: "A noble house is sent to a hostile desert world to harvest the most valuable substance alive." },
  { id: 361743, title: "Top Gun: Maverick", year: "2022", rating: "8.2", overview: "A veteran flyer returns to train the next generation for a mission almost nobody survives." },
  { id: 274, title: "The Silence of the Lambs", year: "1991", rating: "8.3", overview: "A young agent seeks the counsel of a brilliant killer to catch another one still at large." },
  { id: 807, title: "Se7en", year: "1995", rating: "8.4", overview: "Two detectives hunt a killer who stages his crimes around the seven deadly sins." },
  { id: 694, title: "The Shining", year: "1980", rating: "8.2", overview: "A writer takes a winter job at an empty hotel that would rather keep him forever." },
  { id: 313369, title: "La La Land", year: "2016", rating: "7.9", overview: "A pianist and an actress fall in love in a city that rewards ambition more than it rewards them." },
  { id: 120467, title: "The Grand Budapest Hotel", year: "2014", rating: "8.0", overview: "A concierge and his lobby boy chase a stolen painting across a disappearing Europe." },
  { id: 475557, title: "Joker", year: "2019", rating: "8.1", overview: "A failed comedian in a decaying city slowly becomes the joke everyone is telling." },
  { id: 419430, title: "Get Out", year: "2017", rating: "7.6", overview: "A weekend with his girlfriend's family becomes the longest weekend of a young man's life." },
  { id: 76341, title: "Mad Max: Fury Road", year: "2015", rating: "8.1", overview: "A drifter and a runaway commander tear across a wasteland in a chase that barely pauses." },
  { id: 324857, title: "Spider-Man: Into the Spider-Verse", year: "2018", rating: "8.4", overview: "A teenager discovers that every universe has its own spider — and they all need him." },
  { id: 77, title: "Memento", year: "2000", rating: "8.2", overview: "A man who cannot form new memories hunts his wife's killer backwards through his own notes." },
  { id: 141, title: "Donnie Darko", year: "2001", rating: "7.8", overview: "A troubled teenager is warned by a rabbit that the world ends in twenty-eight days." },
  { id: 62, title: "2001: A Space Odyssey", year: "1968", rating: "8.1", overview: "From bone to orbit, humanity follows a signal to the edge of what it can understand." },
  { id: 1891, title: "The Empire Strikes Back", year: "1980", rating: "8.4", overview: "The rebellion scatters, a teacher is found, and a family secret finally surfaces." },
  { id: 77338, title: "The Intouchables", year: "2011", rating: "8.3", overview: "A wealthy quadriplegic hires a young man from the projects who refuses to pity him." },
  { id: 137113, title: "Edge of Tomorrow", year: "2014", rating: "7.6", overview: "A soldier dies on the front line and wakes up the day before — again and again." },
  { id: 210577, title: "Gone Girl", year: "2014", rating: "8.0", overview: "A wife disappears and her husband becomes the story everyone is writing about." },
];

const FALLBACK_SERIES = [
  { id: 1396, title: "Breaking Bad", year: "2008", rating: "8.9", overview: "A chemistry teacher with a terminal diagnosis builds an empire out of a moving van." },
  { id: 1399, title: "Game of Thrones", year: "2011", rating: "8.4", overview: "Great houses claw for a throne while something colder gathers far to the north." },
  { id: 66732, title: "Stranger Things", year: "2016", rating: "8.6", overview: "A missing boy, a girl with a shaved head, and a town sitting on top of something else." },
  { id: 94605, title: "Arcane", year: "2021", rating: "8.7", overview: "Two sisters grow up on opposite sides of a city that never stopped arguing with itself." },
  { id: 71446, title: "Money Heist", year: "2017", rating: "8.2", overview: "A planner called the Professor rehearses the heist of a lifetime with eight strangers." },
  { id: 76479, title: "The Boys", year: "2019", rating: "8.5", overview: "Superheroes are a product; a small crew of civilians decides to take the product apart." },
  { id: 87108, title: "Chernobyl", year: "2019", rating: "8.7", overview: "The reactor explodes and the truth is buried before the fallout reaches the ground." },
  { id: 60574, title: "Peaky Blinders", year: "2013", rating: "8.8", overview: "A family of bookmakers in post-war Birmingham expands its business one street at a time." },
  { id: 60059, title: "Better Call Saul", year: "2015", rating: "8.7", overview: "A well-meaning lawyer slowly talks himself into becoming someone else entirely." },
  { id: 100088, title: "The Last of Us", year: "2023", rating: "8.5", overview: "A smuggler escorts a teenage girl across a country that has stopped pretending to be one." },
  { id: 94997, title: "House of the Dragon", year: "2022", rating: "8.3", overview: "A royal family divides itself into two halves that will not survive the split." },
  { id: 85552, title: "Euphoria", year: "2019", rating: "8.1", overview: "A group of teenagers in a small town map the edges of pleasure, grief and addiction." },
  { id: 119051, title: "Wednesday", year: "2022", rating: "8.0", overview: "An unusually serious student arrives at a school for outcasts with a mystery already waiting." },
  { id: 95479, title: "Jujutsu Kaisen", year: "2020", rating: "8.5", overview: "A student swallows a cursed relic and is drafted into a war he cannot opt out of." },
  { id: 85937, title: "Demon Slayer", year: "2019", rating: "8.6", overview: "A boy takes up a blade to bring his sister back from what was done to her." },
  { id: 1429, title: "Attack on Titan", year: "2013", rating: "8.8", overview: "Humanity hides behind walls that were never as tall as the thing outside them." },
  { id: 1668, title: "Friends", year: "1994", rating: "8.4", overview: "Six people share apartments, coffee and a decade of extremely bad timing." },
  { id: 2316, title: "The Office", year: "2005", rating: "8.6", overview: "An office in Pennsylvania is documented at a length its employees never agreed to." },
  { id: 19885, title: "Sherlock", year: "2010", rating: "8.5", overview: "A consulting detective and an army doctor share a flat and a talent for trouble." },
  { id: 65494, title: "The Crown", year: "2016", rating: "8.6", overview: "A young queen inherits a crown, a country, and a family that does not take orders." },
  { id: 71912, title: "The Witcher", year: "2019", rating: "7.9", overview: "A monster hunter bound by an old vow finds himself the last thing standing in the way." },
  { id: 1402, title: "The Walking Dead", year: "2010", rating: "8.1", overview: "A sheriff wakes from a coma into a world where the rules are all new." },
  { id: 1416, title: "Grey's Anatomy", year: "2005", rating: "8.2", overview: "Surgical interns learn that saving lives is easier than keeping their own together." },
  { id: 1411, title: "Person of Interest", year: "2011", rating: "8.4", overview: "A machine predicts violent crimes; two men decide what to do with the names it gives them." },
  { id: 91363, title: "Loki", year: "2021", rating: "8.1", overview: "The god of mischief is drafted into an agency that polices the timeline he broke." },
  { id: 46648, title: "True Detective", year: "2014", rating: "8.5", overview: "Two detectives tell the story of a case that has been telling itself for seventeen years." },
  { id: 62560, title: "Dark", year: "2017", rating: "8.3", overview: "Four families in a small German town discover the cave beneath them has a schedule." },
  { id: 60735, title: "The Flash", year: "2014", rating: "7.5", overview: "A forensic scientist wakes from a lightning strike able to outrun the consequences." },
  { id: 1622, title: "Supernatural", year: "2005", rating: "8.2", overview: "Two brothers drive the back roads of America looking for what took their mother." },
  { id: 1412, title: "Arrow", year: "2012", rating: "7.5", overview: "A castaway returns home with a bow, a list, and very little patience for the city." },
];

const FALLBACK_FEATURES = [
  { id: "f1", title: "Curated catalogue", description: "Hand-picked films, series and documentaries, refreshed every week by our editors.", icon: "film", link: "#movies" },
  { id: "f2", title: "IPTV without the noise", description: "Free and premium channels organised by country, genre and group — with EPG guides.", icon: "broadcast", link: "#iptv" },
  { id: "f3", title: "Watch together", description: "Generate six-digit viewing codes and share access with the people you trust.", icon: "users", link: "#membership" },
  { id: "f4", title: "Publish and earn", description: "Members upload videos, write articles and answer questions — and get paid in points.", icon: "upload", link: "articles.html" },
  { id: "f5", title: "Points that mean something", description: "Earn on tasks, reviews and referrals. Spend in the market, the auction or the bank.", icon: "zap", link: "tasks.html" },
  { id: "f6", title: "Auctions and prizes", description: "Bid on rare digital items with your points and collect monthly member rewards.", icon: "gavel", link: "auction.html" },
  { id: "f7", title: "No ads, ever", description: "Premium members watch everything uninterrupted — across every device they own.", icon: "shield", link: "#membership" },
  { id: "f8", title: "An app for every screen", description: "Windows, macOS, Linux, Android, iOS, Android TV and Apple TV.", icon: "monitor", link: "#apps" },
];

const FALLBACK_CHANNELS = [
  ["Aurora One", "Entertainment", "Europe", 12400], ["Cine Noire", "Movies", "Europe", 9800],
  ["Metro Sports", "Sports", "Global", 21500], ["Docu World", "Documentary", "Global", 6400],
  ["Kids Orbit", "Kids", "MENA", 5200], ["Music Noir", "Music", "Europe", 4300],
  ["Nova News 24", "News", "Global", 18700], ["Retro Screen", "Movies", "Americas", 3900],
  ["Atlas Drama", "Drama", "MENA", 7600], ["Pacific Live", "Entertainment", "Asia", 8800],
  ["Studio 1W", "Originals", "Global", 11200], ["Cinema Classic", "Movies", "Europe", 6100],
  ["Harbour TV", "Lifestyle", "Europe", 2800], ["Terra Nature", "Documentary", "Global", 3400],
  ["Orbit Anime", "Anime", "Asia", 9100], ["Verde Football", "Sports", "Americas", 14300],
  ["Casa Novelas", "Drama", "Americas", 4700], ["Northline Live", "Entertainment", "Europe", 3100],
].map(([name, category, group, views], i) => ({ name, category, group, views, id: `playlist${String(101 + i).padStart(6, "0")}` }));

const PREMIUM_CHANNELS = [
  ["Cine Premiere 4K", "Movies", "Global", 22600], ["Sport Ultra HD", "Sports", "Global", 31200],
  ["Noir Originals", "Originals", "Global", 15400], ["Aurora Max", "Entertainment", "Europe", 12100],
  ["Studio 1W+", "Originals", "Global", 18900], ["Arena Boxing", "Sports", "Americas", 9700],
  ["Grand Cinema", "Movies", "MENA", 8200], ["Atlas Premium", "Drama", "MENA", 11400],
  ["Sky Documentary+", "Documentary", "Global", 5300], ["Vortex Sci-Fi", "Movies", "Global", 6800],
  ["Kids Orbit+", "Kids", "Global", 4400], ["Opera House", "Culture", "Europe", 1900],
  ["Tokyo Live", "Entertainment", "Asia", 7200], ["Latina Max", "Drama", "Americas", 5600],
  ["Cine Drive", "Movies", "Global", 8900], ["Prime Events", "Events", "Global", 13100],
].map(([name, category, group, views], i) => ({ name, category, group, views, id: `playlist${String(201 + i).padStart(6, "0")}` }));

const decorateFallback = (list, kind) =>
  list.map((item) =>
    normaliseMedia(
      {
        ...item,
        genre_ids: [],
        __source: "demo",
      },
      kind
    )
  );

/* ================================================================== */
/* Public loaders                                                     */
/* ================================================================== */
export async function loadMovies() {
  try {
    return await trending("movie", 50);
  } catch {
    return decorateFallback(FALLBACK_MOVIES, "movie");
  }
}

export async function loadSeries() {
  try {
    return await trending("tv", 50);
  } catch {
    return decorateFallback(FALLBACK_SERIES, "tv");
  }
}

const mapChannel = (row, index, premium) => {
  const name = pick(row, ["channel_name", "name", "title", "Channel Name"], `Channel ${index + 1}`);
  const fallbackId = `playlist${String(index + 1).padStart(6, "0")}`;
  // The public deep-link is the M3U / playlist identity, not the row uuid.
  const m3u = pick(row, ["m3u", "m3u_id", "playlist_id", "channel_id", "id"], fallbackId);
  return {
    id: pick(row, ["id"], m3u),
    m3u,
    name,
    category: pick(row, ["channel_category", "category", "genre"], "General"),
    group: pick(row, ["channel_group", "group", "country"], "Global"),
    logo: pick(row, ["channel_logo", "logo", "logo_url", "image"], "") || tilePlaceholder(name, index),
    link: pick(row, ["channel_link", "url", "stream_url", "link"], ""),
    views: Number(pick(row, ["channel_views_per_minute", "views_per_minute", "views", "viewers"], 0)) || 0,
    premium: Boolean(premium),
    href: `iptv.html?M3U=${encodeURIComponent(m3u)}`,
  };
};

async function loadChannelTable(table, premium) {
  const rows = await rest(table, {
    limit: 40,
    order: "channel_views_per_minute.desc",
  }).catch(() => null);
  if (Array.isArray(rows)) rows.sort((a, b) => Number(b.channel_views_per_minute || 0) - Number(a.channel_views_per_minute || 0));
  if (!Array.isArray(rows) || !rows.length) return null;
  return rows.map((row, i) => mapChannel(row, i, premium));
}

export async function loadChannels() {
  const [free, premium] = await Promise.all([
    loadChannelTable("iptvfree", false),
    loadChannelTable("iptvpremium", true),
  ]);
  const fallback = (list, isPremium) =>
    list.map((item, i) => ({
      ...item,
      premium: isPremium,
      logo: tilePlaceholder(item.name, i),
      link: "",
      href: `iptv.html?M3U=${encodeURIComponent(item.id)}`,
    }));
  return {
    free: free && free.length ? free : fallback(FALLBACK_CHANNELS, false),
    premium: premium && premium.length ? premium : fallback(PREMIUM_CHANNELS, true),
  };
}

export async function loadFeatures() {
  const rows = await rest("features", { limit: 12, order: "display_order.asc" }).catch(() => null);
  if (!Array.isArray(rows) || !rows.length) return FALLBACK_FEATURES.map((f) => ({ ...f, clicks: 0, releaseDate: "" }));
  return rows.slice(0, 12).map((row, i) => ({
    id: pick(row, ["id", "feature_id"], `f${i}`),
    title: pick(row, ["feature_title", "title", "name"], "Feature"),
    description: pick(row, ["feature_description", "description", "summary"], ""),
    icon: pick(row, ["feature_icon", "icon"], "sparkle"),
    link: pick(row, ["feature_link", "link", "url"], "#"),
    clicks: Number(pick(row, ["number_of_clicks_on_feature_link", "feature_clicks", "clicks"], 0)) || 0,
    releaseDate: pick(row, ["feature_release_date", "release_date", "created_at"], ""),
  }));
}

export async function loadApps() {
  const tables = ["apps", "app_versions", "versions"];
  for (const table of tables) {
    const rows = await rest(table, { limit: 20 }).catch(() => null);
    if (Array.isArray(rows) && rows.length) {
      return rows.map((row) => ({
        id: pick(row, ["id"], ""),
        system: pick(row, ["version_system", "system", "platform", "os"], "").toLowerCase(),
        number: pick(row, ["version_number", "version", "number"], ""),
        link: pick(row, ["version_link", "link", "download_url", "url"], ""),
        downloads: Number(pick(row, ["number_of_version_downloads", "downloads"], 0)) || 0,
      }));
    }
  }
  return [];
}

/* ------------------------------------------------------------------ */
/* Members / notifications                                            */
/* ------------------------------------------------------------------ */
const normaliseMember = (row) => {
  if (!row) return null;
  const username = pick(row, ["username", "user_name", "name"], "@member");
  const id = pick(row, ["id", "member_id", "member"], "");
  return {
    id,
    shortId: String(id).replace(/\D/g, "").slice(-6).padStart(6, "0") || "000000",
    username: username.startsWith("@") ? username : `@${username}`,
    name: pick(row, ["username", "user_name", "name"], "Member").replace(/^@/, ""),
    email: pick(row, ["email"], ""),
    avatar: pick(row, ["avatar", "avatar_url", "profile_avatar"], ""),
    cover: pick(row, ["cover", "cover_url", "profile_cover"], ""),
    status: pick(row, ["statue", "status", "state"], "active"),
    level: Number(pick(row, ["level", "lvl"], 1)) || 1,
    membership: pick(row, ["membership", "plan", "tier"], "free"),
    duration: pick(row, ["duretion", "duration", "membership_duration", "expires_at"], ""),
    points: Number(pick(row, ["points", "balance", "credit"], 0)) || 0,
    createdAt: pick(row, ["created_at", "date_crated", "date_created"], ""),
    raw: row,
  };
};

export async function loadMember(id) {
  if (!id) return null;
  const attempts = [{ id: `eq.${id}` }, { member_id: `eq.${id}` }, { id_member: `eq.${id}` }];
  for (const filters of attempts) {
    const rows = await rest("members", { filters, limit: 1 }).catch(() => null);
    if (Array.isArray(rows) && rows.length) return normaliseMember(rows[0]);
  }
  return null;
}

export async function loadNotifications(memberId) {
  const filters = memberId ? [{ id_member: `eq.${memberId}` }, { member_id: `eq.${memberId}` }, {}] : [{}];
  const attempts = filters.map((f) => ({ limit: 40, filters: f }));
  for (const opts of attempts) {
    const rows = await rest("notifications", opts).catch(() => null);
    if (Array.isArray(rows) && rows.length) {
      return rows.map((row, i) => ({
        id: pick(row, ["id", "notification_id"], `n${i}`),
        source: pick(row, ["source", "from", "origin"], "1World"),
        title: pick(row, ["title", "subject", "heading"], "Notification"),
        subject: pick(row, ["subject", "content", "body", "message"], ""),
        read: isTruthy(pick(row, ["read_or_unread", "read", "is_read", "status"], false)),
        createdAt: pick(row, ["created_at", "creation_date", "date"], new Date().toISOString()),
        readAt: pick(row, ["read_date", "read_at"], ""),
      }));
    }
  }
  return [];
}

export async function submitMessage({ name, email, subject, message }) {
  const payload = {
    email,
    message_type: subject || "Support",
    message_status: "sent",
    message_title: subject || "Website contact form",
    message_content: `${message}\n\n— ${name}`,
    message_sent_date: new Date().toISOString(),
  };
  const tables = ["messages", "member_messages", "requests"];
  for (const table of tables) {
    try {
      await rest(table, { method: "POST", body: payload });
      return { ok: true, table };
    } catch {
      /* try the next table */
    }
  }
  return { ok: false };
}

/* ================================================================== */
/* Aggregate home payload                                             */
/* ================================================================== */
export async function loadHomeData() {
  const [movies, series, features, channels] = await Promise.all([
    loadMovies(),
    loadSeries(),
    loadFeatures(),
    loadChannels(),
  ]);
  return { movies, series, features, channels };
}

export { avatarPlaceholder, posterPlaceholder, tilePlaceholder };
