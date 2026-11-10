// 1World — the video host (Supabase edge function).
// ------------------------------------------------------------------
// No video file lives on the site: every one of them lives on Streamtape, in
// the account's own tree — a studio's under its own folder, and a video with no
// studio under the member's:
//
// Home / Users / Studio  / <studio code> / <video code>.mp4
// Home / Users / Members / <member code> / <video code>.mp4
//
// The browser is not trusted with the Streamtape credentials, so it talks to
// this function instead, and the function talks to the API:
//
// GET ?action=file/listfolder&studio=<code>&folder=<id>
// GET ?action=file/createfolder&studio=<code>&name=<name>&pid=<id>
// GET ?action=file/ul&studio=<code>&folder=<id>        an upload address
// GET ?action=file/rename&studio=<code>&file=<id>&name=<name>
// GET ?action=file/info&studio=<code>&file=<id>
// GET ?action=file/find&studio=<code>&folder=<id>&name=<name>
// GET ?action=file/getsplash&studio=<code>&file=<id>   the video's own still
//
// The same actions without `studio` are a video of the member's own: the
// function reads the member from the token and answers for that member's folder,
// so the browser never has to know where on the host its own shelf is.
//
// The answer is Streamtape's own { status, msg, result } — the client reads it
// exactly as it would read the API, so the shape never has to be learned twice.
//
// The file itself is not sent through here: the browser asks for an upload
// address and posts the file straight to it, so a two-gigabyte film costs this
// function one small JSON answer. file/find is the safety net for the case
// where the browser cannot read the upload answer (a host without CORS on its
// upload endpoint): the function lists the folder and names the file instead.
//
// Every action names who it is about, and the name is checked against the
// token before the API is touched:
//
//   ?studio=<code>  the token must be one that may publish into that studio —
//                   the same list the editor's own picker is built from (403
//                   otherwise), and the folder is the client's, inside it.
//   no studio       the token must belong to a member. The member's own folder
//                   is resolved **here** from the token (`member_from_token`),
//                   so the browser neither names nor chooses it: `file/ul`,
//                   `file/listfolder` and `file/find` always answer for that
//                   folder, and `file/createfolder` is refused.
//
// There is no reader's door here, and there used to be one. A Streamtape frame
// cannot be told a second from outside, so a chapter used to play the file
// itself, relayed through this function; that cost the project the film's own
// size on every full view and carried nothing the host's player did not. It is
// gone, and Streamtape videos now carry no chapter index at all — a chapter is
// only drawn where a second can actually be spent (a file of our own, or a host
// that reads a start word: YouTube, Vimeo, Facebook). This function is the
// video host: nothing here is public, and every action needs a member's token —
// either a studio's, or the member's own shelf.
//
// Secrets: STREAMTAPE_LOGIN (the API Login), STREAMTAPE_KEY (the API Key).
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by the runtime.
//
// With the secrets missing the function answers 503 with a sentence, and the
// editor shows it — it never pretends a file went anywhere.

const API = "https://api.streamtape.com";
/* the account's tree: Home / Users / { Studio | Members } / <code> */
const SHELF_USERS = "Users";
const SHELF_MEMBERS = "Members";
const LOGIN = Deno.env.get("STREAMTAPE_LOGIN") ?? "";
const KEY = Deno.env.get("STREAMTAPE_KEY") ?? "";
const SERVICE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

type Json = Record<string, unknown>;

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });

/** One RPC as the service role — the member's token travels in the body. */
async function rpc(name: string, body: Json): Promise<Json> {
  if (!SERVICE_URL || !SERVICE_KEY) return {};
  const answer = await fetch(`${SERVICE_URL}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  return (await answer.json().catch(() => ({}))) as Json;
}

/** The member's own session token, from the Authorization header. */
function tokenOf(request: Request): string {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1].trim() : "";
}

/**
 * The studios this token may publish into: the creator's own list first, then
 * the desk's (publisher.html embeds the same editor and asks a different door).
 */
async function studiosOf(token: string): Promise<Set<string>> {
  const codes = new Set<string>();
  for (const fn of ["creator_hubs_list", "publisher_hubs"]) {
    const answer = await rpc(fn, { p_token: token });
    if (!answer || answer.ok !== true) continue;
    const hubs = Array.isArray(answer.hubs) ? (answer.hubs as Json[]) : [];
    hubs.forEach((hub) => {
      if (!hub || !hub.code) return;
      if (hub.kind && hub.kind !== "channel") return;
      codes.add(String(hub.code));
    });
  }
  return codes;
}

/** A folder inside `parent` (or the root), made when it is not there yet. */
async function folderNamed(parent: string, name: string): Promise<string> {
  const listing = await api("file/listfolder", { folder: parent });
  if (Number(listing.status) !== 200) return "";
  const box = (listing.result || {}) as Json;
  const folders = Array.isArray(box.folders) ? (box.folders as Json[]) : [];
  const hit = folders.find((row) => String(row.name || "").trim().toLowerCase() === name.toLowerCase());
  if (hit) return String(hit.id || "");
  const made = await api("file/createfolder", { name, pid: parent });
  if (Number(made.status) !== 200) return "";
  const result = (made.result || {}) as Json;
  return String(result.folderid || result.id || "");
}

/**
 * Home / Users / Members / <member code> — the shelf a video with no studio
 * lives on. The code is the member's own public one, read from the token's
 * member row; two members can never be handed the same folder.
 */
async function memberShelf(memberCode: string): Promise<string> {
  const users = await folderNamed("", SHELF_USERS);
  if (!users) return "";
  const shelf = await folderNamed(users, SHELF_MEMBERS);
  if (!shelf) return "";
  return folderNamed(shelf, memberCode);
}

/** One call to Streamtape, with the account's credentials attached here. */
async function api(action: string, params: Json): Promise<Json> {
  const url = new URL(`${API}/${action}`);
  url.searchParams.set("login", LOGIN);
  url.searchParams.set("key", KEY);
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") return;
    url.searchParams.set(key, String(value));
  });
  let answer: Response;
  try {
    answer = await fetch(url.toString());
  } catch {
    return { status: 502, msg: "The host could not be reached.", result: null };
  }
  const text = await answer.text();
  try {
    return JSON.parse(text) as Json;
  } catch {
    return { status: answer.status || 502, msg: text.slice(0, 160) || "The host answered nothing readable.", result: null };
  }
}

const ALLOWED = new Set([
  "file/listfolder",
  "file/createfolder",
  "file/ul",
  "file/rename",
  "file/info",
  "file/find",
  // the video's own picture: the one Streamtape keeps for the file, which is
  // the one the account sees under Home / Thumbnails when it has put one there
  "file/getsplash",
]);

Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (request.method !== "GET" && request.method !== "POST") {
    return json({ status: 405, msg: "Only GET and POST.", result: null }, 405);
  }

  const url = new URL(request.url);
  const action = String(url.searchParams.get("action") || "").replace(/^\/+/, "");
  /* every action is a studio's, and a studio's door is the member's */
  if (!ALLOWED.has(action)) {
    return json({ status: 400, msg: "Unknown action.", result: null }, 400);
  }

  if (!LOGIN || !KEY) {
    return json(
      {
        status: 503,
        msg: "The studio host is not connected: set STREAMTAPE_LOGIN and STREAMTAPE_KEY for this function.",
        result: null,
      },
      503,
    );
  }

  const token = tokenOf(request);
  if (!token) return json({ status: 401, msg: "Sign in first.", result: null }, 401);

  const studio = String(url.searchParams.get("studio") || "").trim();
  const name = String(url.searchParams.get("name") || "").trim();
  const file = String(url.searchParams.get("file") || "").trim();

  /* no studio named: this is a member's own video, and the member's own folder
     is the only one the rest of this function will speak about */
  if (!studio) {
    const raw = await rpc("member_from_token", { p_token: token });
    const who = (Array.isArray(raw) ? raw[0] : raw) as Json;
    const id = String((who && who.id) || "");
    if (!id) return json({ status: 401, msg: "Sign in first.", result: null }, 401);
    /* the folder is the member's public code; the id is the fallback, and only
       letters, digits, dashes and underscores may name it */
    const named = String((who && who.member_id) || "").replace(/[^A-Za-z0-9_-]/g, "");
    const code = named || id;

    if (action === "file/createfolder") {
      return json({ status: 400, msg: "The member's folders are made here.", result: null }, 400);
    }
    if (action === "file/rename" || action === "file/info" || action === "file/getsplash") {
      return json(await api(action, { file, name }));
    }
    if (action === "file/ul" || action === "file/listfolder" || action === "file/find") {
      const folder = await memberShelf(code);
      if (!folder) return json({ status: 502, msg: "The host would not make the member's folder.", result: null }, 502);
      if (action === "file/find") {
        const listing = await api("file/listfolder", { folder });
        if (Number(listing.status) !== 200) return json(listing);
        const box = (listing.result || {}) as Json;
        const files = Array.isArray(box.files) ? (box.files as Json[]) : [];
        const wanted = name.toLowerCase();
        const hit =
          files.find((row) => String(row.name || "").toLowerCase() === wanted) ??
          [...files].sort((a, b) => Number(b.created_at || 0) - Number(a.created_at || 0))[0];
        const id = hit ? String(hit.linkid || hit.id || "") : "";
        if (!id) return json({ status: 404, msg: "The file is not in the folder yet.", result: null });
        return json({ status: 200, msg: "OK", result: { id, name: String(hit.name || ""), created_at: hit.created_at ?? null } });
      }
      return json(await api(action, { folder }));
    }
    return json({ status: 400, msg: "Unknown action.", result: null }, 400);
  }

  const allowed = await studiosOf(token);
  if (!allowed.has(studio)) {
    return json({ status: 403, msg: "This studio is not one you publish into.", result: null }, 403);
  }

  const folder = String(url.searchParams.get("folder") || "").trim();
  const pid = String(url.searchParams.get("pid") || "").trim();

  if (action === "file/find") {
    // the browser could not read the upload's answer — the folder names it
    const listing = await api("file/listfolder", { folder });
    if (Number(listing.status) !== 200) return json(listing);
    const box = (listing.result || {}) as Json;
    const files = Array.isArray(box.files) ? (box.files as Json[]) : [];
    const wanted = name.toLowerCase();
    const hit =
      files.find((row) => String(row.name || "").toLowerCase() === wanted) ??
      [...files].sort((a, b) => Number(b.created_at || 0) - Number(a.created_at || 0))[0];
    const id = hit ? String(hit.linkid || hit.id || "") : "";
    if (!id) return json({ status: 404, msg: "The file is not in the folder yet.", result: null });
    return json({ status: 200, msg: "OK", result: { id, name: String(hit.name || ""), created_at: hit.created_at ?? null } });
  }

  if (action === "file/getsplash") {
    // one file in, one address out — no folder is involved
    const answer = await api("file/getsplash", { file });
    return json(answer);
  }

  const answer = await api(action, { folder, name, file, pid });
  return json(answer);
});
