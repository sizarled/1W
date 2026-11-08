/**
 * embed.js — one list of hosts, shared by the editor and the watch screen.
 * ------------------------------------------------------------------
 * A member pastes what the platform gave them: a watch link, a share link, a
 * short link, a direct file. This turns any of them into something an <iframe>
 * or a <video> will accept, and names the host so the page can say what it is.
 *
 *   YouTube · Vimeo · Dailymotion · TikTok · Facebook · Google Drive ·
 *   Pinterest · Reddit · Instagram · X · Streamtape · a direct file
 *   (.mp4 .webm .ogv .ogg .mov .m4v)
 *
 * Anything else is left as it is and framed as-is — an honest last resort:
 * some sites refuse to be framed, and the player says so rather than showing a
 * blank rectangle. Nothing here fetches anything; it is all string work.
 */

export const HOSTS = {
  youtube: "YouTube",
  vimeo: "Vimeo",
  instagram: "Instagram",
  x: "X",
  dailymotion: "Dailymotion",
  tiktok: "TikTok",
  facebook: "Facebook",
  drive: "Google Drive",
  pinterest: "Pinterest",
  reddit: "Reddit",
  streamtape: "Streamtape",
  file: "File",
  embed: "Embed",
};

const FILE = /\.(mp4|webm|ogv|ogg|mov|m4v)(\?|#|$)/i;

/** A file a browser can play by itself. */
export function isFile(raw = "") {
  return FILE.test(String(raw));
}

/** The eleven-character id in any YouTube address we have seen. */
export function youtubeId(raw = "") {
  const value = String(raw).trim();
  if (!value) return "";
  try {
    const u = new URL(value, "https://www.youtube.com");
    const host = u.hostname.replace(/^www\./, "");
    if (host === "youtu.be") return u.pathname.slice(1).split("/")[0];
    if (host.endsWith("youtube.com") || host === "youtube-nocookie.com") {
      const v = u.searchParams.get("v");
      if (v) return v;
      const parts = u.pathname.split("/").filter(Boolean);
      if (["embed", "shorts", "live", "v", "e"].includes(parts[0])) return parts[1] || "";
    }
  } catch {
    /* not an address — fall through to the pattern */
  }
  const match = value.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/|v\/))([\w-]{11})/);
  return match ? match[1] : "";
}

/** The file id in a Streamtape address — `/v/<id>/<name>` or `/e/<id>`. */
export function streamtapeId(raw = "") {
  const match = String(raw).match(/streamtape\.com\/(?:v|e)\/([\w-]+)/i);
  return match ? match[1] : "";
}

/** The pin id in a Pinterest pin address. */
export function pinterestId(raw = "") {
  const match = String(raw).match(/pinterest\.[a-z.]+\/pin\/(\d+)/i);
  return match ? match[1] : "";
}

/** The thread in a Reddit address. */
export function redditPath(raw = "") {
  const value = String(raw).trim();
  const match = value.match(/reddit\.com\/(r\/[^/]+\/comments\/[a-z0-9]+)/i);
  if (match) return match[1];
  const short = value.match(/redd\.it\/([a-z0-9]+)/i);
  return short ? `comments/${short[1]}` : "";
}

/**
 * Any share link → a URL an <iframe> will accept.
 * `""` for an empty value; the value itself when we do not know the host.
 */
export function embedUrl(raw = "") {
  const url = String(raw).trim();
  if (!url) return "";
  /* a Streamtape link can end in .mp4 — and then it is still a page, not a
     file a <video> can play, so it is read before the file test */
  const tape = streamtapeId(url);
  if (tape) return `https://streamtape.com/e/${tape}`;
  if (isFile(url)) return url;
  try {
    const u = new URL(url, "https://example.com");
    const host = u.hostname.replace(/^www\./, "");

    if (host === "youtu.be" || host.endsWith("youtube.com") || host.endsWith("youtube-nocookie.com")) {
      const id = youtubeId(url);
      if (id) return `https://www.youtube.com/embed/${id}`;
    }

    if (host === "vimeo.com" || host.endsWith(".vimeo.com")) {
      const id = u.pathname.split("/").filter(Boolean).pop();
      if (/^\d+$/.test(id || "")) return `https://player.vimeo.com/video/${id}`;
    }

    if (host.endsWith("dailymotion.com") || host === "dai.ly") {
      const id = u.pathname.split("/").filter(Boolean).pop();
      if (id && /^[a-z0-9]+$/i.test(id)) return `https://www.dailymotion.com/embed/video/${id}`;
    }

    if (host.endsWith("tiktok.com")) {
      const id = (u.pathname.match(/\/video\/(\d+)/) || [])[1];
      if (id) return `https://www.tiktok.com/embed/v2/${id}`;
    }

    if (host === "drive.google.com") {
      const id = (u.pathname.match(/\/file\/d\/([\w-]+)/) || [])[1];
      if (id) return `https://drive.google.com/file/d/${id}/preview`;
    }

    if (host.endsWith("facebook.com") || host === "fb.watch" || host === "fb.me") {
      return `https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(url)}&show_text=false&width=734`;
    }

    if (host.endsWith("pinterest.com") || host === "pin.it") {
      const id = pinterestId(url);
      /* a pin.it short link cannot be resolved without a round trip: the frame
         gets the address and Pinterest decides. A full pin link is better. */
      if (id) return `https://assets.pinterest.com/ext/embed.html?id=${id}`;
      return `https://assets.pinterest.com/ext/embed.html?url=${encodeURIComponent(url)}`;
    }

    if (host.endsWith("reddit.com") || host === "redd.it") {
      const path = redditPath(url);
      if (path) return `https://embed.reddit.com/${path}/?embed=true&theme=dark`;
      return `https://embed.reddit.com/?embed=true&theme=dark`;
    }

    if (host.endsWith("instagram.com") || host === "instagr.am") {
      /* /p/<code>, /reel/<code> and /tv/<code> all have an embed address —
         the code is the segment before any query, not the whole path */
      const code = (u.pathname.match(/\/(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/) || [])[1];
      if (code) return `https://www.instagram.com/p/${code}/embed/captioned/`;
    }
  } catch {
    /* a plain text source, used as it is */
  }
  return url;
}

/** Which host a link belongs to; `embed` when we cannot tell. */
export function sourceKind(raw = "") {
  const url = String(raw).trim();
  if (!url) return "";
  if (/streamtape\.com\//i.test(url)) return "streamtape";
  if (isFile(url)) return "file";
  if (youtubeId(url)) return "youtube";
  if (/vimeo\.com\//i.test(url)) return "vimeo";
  if (/dailymotion\.com\/|dai\.ly\//i.test(url)) return "dailymotion";
  if (/tiktok\.com\//i.test(url)) return "tiktok";
  if (/drive\.google\.com\//i.test(url)) return "drive";
  if (/facebook\.com\/|fb\.watch\/|fb\.me\//i.test(url)) return "facebook";
  if (/pinterest\.[a-z.]+\/|pin\.it\//i.test(url)) return "pinterest";
  if (/reddit\.com\/|redd\.it\//i.test(url)) return "reddit";
  if (/instagram\.com\/|instagr\.am\//i.test(url)) return "instagram";
  if (/twitter\.com\/|x\.com\//i.test(url)) return "x";
  return "embed";
}

/** The label the page shows for a source. */
export function sourceLabel(raw = "") {
  const kind = sourceKind(raw);
  return kind ? HOSTS[kind] || "Link" : "";
}

/** YouTube hands over a still for free. Nothing else does without an API. */
export function autoThumb(raw = "") {
  const id = youtubeId(raw);
  return id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : "";
}

/** Hosts that bring their own picture inside the frame. */
export const SELF_PICTURED = ["youtube", "tiktok", "pinterest", "reddit", "facebook", "vimeo", "dailymotion"];
