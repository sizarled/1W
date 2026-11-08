/**
 * media.js — the address book.
 * ------------------------------------------------------------------
 * Every piece of content on the site has one address, and this is the
 * only place that knows it. A page asks for a link, a page reads the
 * hash, and both go through the same four functions:
 *
 *   creator.html?studio=IDST100001&creator=ID100019
 *       `studio` is the studio's id, `creator` the id of the member
 *       whose content it is. Both ride on every studio link, so a page
 *       opened from anywhere knows the studio and whose page it is.
 *
 *   videos.html#/h/ID=video001032     a horizontal video (16:9)
 *   videos.html#/v/ID=video001032     a vertical one (9:16)
 *
 *   audio.html#/p/ID=podcast001032    a podcast
 *   audio.html#/m/ID=song001032       a song
 *
 *   playlist.html#/videos/ID=playlist001032
 *   playlist.html#/podcasts/ID=playlist001032
 *   playlist.html#/songs/ID=playlist001032
 *
 * The shelf in a playlist address says what is in it, so a playlist
 * opens on the right list without asking. `h` and `v` are the only two
 * letters that describe a *shape*; `p` and `m` describe a *kind*.
 *
 * Nothing here talks to the server or the DOM: it is a grammar, and the
 * gate can read it without a browser.
 */

/* ------------------------------------------------------------------ */
/* the words                                                          */
/* ------------------------------------------------------------------ */

/** The two letters a video address may carry, and what they mean. */
export const ORIENTATIONS = {
  h: { key: "h", label: "Horizontal", ratio: "16 / 9", portrait: false },
  v: { key: "v", label: "Vertical", ratio: "9 / 16", portrait: true },
};

/** `p` and `m`, and the kind of thing each one is. */
export const AUDIO_KINDS = {
  p: { key: "p", kind: "podcast", label: "Podcast", noun: "podcast", icon: "mic" },
  m: { key: "m", kind: "song", label: "Music", noun: "song", icon: "music" },
};

/** The three shelves a playlist can hold, and what a row on it plays. */
export const PLAYLIST_SHELVES = {
  videos: { key: "videos", kind: "video", label: "Videos", noun: "video", page: "videos" },
  podcasts: { key: "podcasts", kind: "podcast", label: "Podcasts", noun: "podcast", page: "audio" },
  songs: { key: "songs", kind: "song", label: "Songs", noun: "song", page: "audio" },
};

/** The surfaces that carry a hash address. */
export const MEDIA_PAGES = {
  videos: "videos.html",
  audio: "audio.html",
  playlist: "playlist.html",
};

/* ------------------------------------------------------------------ */
/* reading the words                                                  */
/* ------------------------------------------------------------------ */

/** `"v"`, `"vertical"`, `"portrait"`, `"9:16"` → `"v"`. */
export function orientationOf(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return "h";
  if (["v", "vertical", "portrait", "9:16", "9/16", "reel", "short"].includes(raw)) return "v";
  if (["h", "horizontal", "landscape", "16:9", "16/9", "wide"].includes(raw)) return "h";
  return "h";
}

/** `"p"`, `"podcast"`, `"audio"` → `"p"`; `"m"`, `"song"`, `"music"` → `"m"`. */
export function audioKeyOf(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (["m", "song", "songs", "music", "track", "audio-song"].includes(raw)) return "m";
  return "p";
}

/** `"videos"`, `"video"`, `"v"` → `"videos"`; likewise podcasts and songs. */
export function shelfOf(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (["podcasts", "podcast", "p", "audio"].includes(raw)) return "podcasts";
  if (["songs", "song", "m", "music", "tracks"].includes(raw)) return "songs";
  return "videos";
}

/** The kind of a row, as `creator_items` spells it. */
export function kindOfShelf(shelf) {
  const key = shelfOf(shelf);
  return (PLAYLIST_SHELVES[key] || PLAYLIST_SHELVES.videos).kind;
}

/** The shelf a kind belongs on. */
export function shelfOfKind(kind) {
  const raw = String(kind || "").trim().toLowerCase();
  if (["podcast", "podcasts", "audio"].includes(raw)) return "podcasts";
  if (["song", "songs", "music", "track"].includes(raw)) return "songs";
  return "videos";
}

/* ------------------------------------------------------------------ */
/* writing an address                                                 */
/* ------------------------------------------------------------------ */

/** The id in an address is always `ID=<code>`, never bare. */
export function idSegment(code) {
  return `ID=${encodeURIComponent(String(code == null ? "" : code).trim())}`;
}

/**
 * `creator.html?studio=<studio>&creator=<creator>`
 * Either id may be left out — the page then simply has less to go on.
 */
export function creatorUrl(studio, creator, extra) {
  const params = new URLSearchParams();
  const s = String(studio || "").trim();
  const c = String(creator || "").trim();
  if (s) params.set("studio", s);
  if (c) params.set("creator", c);
  if (extra && typeof extra === "object") {
    Object.entries(extra).forEach(([key, value]) => {
      if (value != null && value !== "") params.set(key, String(value));
    });
  }
  const query = params.toString();
  return `creator.html${query ? `?${query}` : ""}`;
}

/** `videos.html#/h/ID=<code>` or `#/v/ID=<code>` */
export function videoUrl(code, orientation) {
  const o = orientationOf(orientation);
  return `${MEDIA_PAGES.videos}#/${o}/${idSegment(code)}`;
}

/** `audio.html#/p/ID=<code>` or `#/m/ID=<code>` */
export function audioUrl(code, kind) {
  const key = audioKeyOf(kind);
  return `${MEDIA_PAGES.audio}#/${key}/${idSegment(code)}`;
}

/** `playlist.html#/videos/ID=<code>`, `…/podcasts/…`, `…/songs/…` */
export function playlistUrl(code, shelf) {
  const key = shelfOf(shelf);
  return `${MEDIA_PAGES.playlist}#/${key}/${idSegment(code)}`;
}

/**
 * The address of any row, whatever it is.
 * The one function the rest of the site needs: give it a row from a
 * table or a card and it hands back the page that shows it.
 */
export function mediaUrl(row) {
  const item = row || {};
  const code = item.code || item.id || "";
  const kind = String(item.kind || item.type || "").toLowerCase();
  if (kind === "video") {
    return videoUrl(code, orientationOf(item.orientation || (item.video && item.video.orientation)));
  }
  if (kind === "podcast" || kind === "song" || kind === "music" || kind === "audio") {
    return audioUrl(code, kind === "podcast" ? "p" : "m");
  }
  if (kind === "playlist") {
    return playlistUrl(code, item.shelf || shelfOfKind((item.content_kind || (item.meta && item.meta.kind) || "")));
  }
  /* everything else keeps the page it lives on */
  const page = { article: "article", question: "answer", document: "document", image: "picture" }[kind];
  return page ? `${page}.html?id=${encodeURIComponent(code)}` : "";
}

/* ------------------------------------------------------------------ */
/* reading an address                                                 */
/* ------------------------------------------------------------------ */

function segmentsOf(hash) {
  return String(hash || "")
    .replace(/^#/, "")
    .replace(/^!?\//, "")
    .replace(/\/+$/, "")
    .split("/")
    .filter(Boolean);
}

function idOf(segment) {
  const raw = String(segment || "");
  if (/^id=/i.test(raw)) return decodeURIComponent(raw.slice(3));
  return decodeURIComponent(raw);
}

/**
 * Read a hash into a route.
 *
 * @returns {{surface: string, kind: string, shelf: string, orientation: string,
 *            id: string, key: string, empty: boolean}}
 */
export function parseRoute(hash) {
  const segs = segmentsOf(hash);
  const empty = { surface: "", kind: "", shelf: "", orientation: "", id: "", key: "", empty: true };
  if (!segs.length) return empty;

  const head = segs[0].toLowerCase();
  const tail = segs.length > 1 ? idOf(segs[segs.length - 1]) : "";

  /* ---- a shape: videos.html#/h/ID=… ---- */
  if (head === "h" || head === "v") {
    const explicitId = segs.length > 1 && /^id=/i.test(segs[1]);
    /* `#/v/<code>` is the older address of a plain video */
    if (head === "v" && !explicitId) {
      return {
        surface: "videos",
        kind: "video",
        shelf: "",
        orientation: "h",
        id: idOf(segs[1] || ""),
        key: "h",
        empty: false,
      };
    }
    return {
      surface: "videos",
      kind: "video",
      shelf: "",
      orientation: head,
      id: idOf(segs[1] || ""),
      key: head,
      empty: !idOf(segs[1] || ""),
    };
  }

  /* ---- an audio kind: audio.html#/p/ID=… ---- */
  if (head === "p" || head === "m") {
    const audio = AUDIO_KINDS[head];
    return {
      surface: "audio",
      kind: audio.kind,
      shelf: shelfOfKind(audio.kind),
      orientation: "",
      id: idOf(segs[1] || ""),
      key: head,
      empty: !idOf(segs[1] || ""),
    };
  }

  /* ---- a shelf: playlist.html#/videos/ID=… ---- */
  const shelf = shelfOf(head);
  if (["videos", "podcasts", "songs"].includes(head) || ["video", "podcast", "song", "music"].includes(head)) {
    return {
      surface: "playlist",
      kind: kindOfShelf(shelf),
      shelf,
      orientation: "",
      id: idOf(segs[1] || tail),
      key: shelf,
      empty: !idOf(segs[1] || tail),
    };
  }

  /* ---- anything else is a bare id: videos.html#/video001032 ---- */
  return {
    surface: "videos",
    kind: "",
    shelf: "",
    orientation: "h",
    id: idOf(segs[0]),
    key: "",
    empty: !idOf(segs[0]),
  };
}

/** `?studio=…&creator=…` — both optional, both trimmed, both decoded. */
export function readParams(search) {
  let params = null;
  try {
    params = new URLSearchParams(String(search == null ? "" : search).replace(/^\?/, ""));
  } catch {
    params = new URLSearchParams("");
  }
  const studio = String(params.get("studio") || "").trim();
  const creator = String(params.get("creator") || params.get("member") || "").trim();
  return { studio, creator, hasStudio: Boolean(studio), hasCreator: Boolean(creator) };
}

/**
 * The address the page should show while a thing is open — used to keep
 * the bar honest when a player is opened by a click rather than a link.
 */
export function addressedUrl(surface, id, { orientation, shelf, kind } = {}) {
  if (surface === "audio") return audioUrl(id, kind || "p");
  if (surface === "playlist") return playlistUrl(id, shelf || "videos");
  return videoUrl(id, orientation || "h");
}

export default {
  ORIENTATIONS,
  AUDIO_KINDS,
  PLAYLIST_SHELVES,
  MEDIA_PAGES,
  orientationOf,
  audioKeyOf,
  shelfOf,
  shelfOfKind,
  kindOfShelf,
  idSegment,
  creatorUrl,
  videoUrl,
  audioUrl,
  playlistUrl,
  mediaUrl,
  parseRoute,
  readParams,
  addressedUrl,
};
