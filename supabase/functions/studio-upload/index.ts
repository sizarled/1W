// 1World — the studio's host (Supabase edge function).
// ------------------------------------------------------------------
// A studio's video files do not live on the site: they live on Streamtape, in
// the account's own tree:
//
// Home / Users / Studio / <studio code> / <video code>.mp4
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
// GET ?action=file/stream&file=<id>[&Range]             the file itself, relayed
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
// Every action names the studio it is about, and the member's token must be one
// that may publish into that studio — the same list the editor's own picker is
// built from. A token that owns nothing gets 403 and the API is never called.
//
// `file/stream` is the one door a reader may knock on — no session, no studio.
// It is not about publishing but about **watching**: a Streamtape frame cannot
// be told a second from outside (its page carries no `postMessage` listener and
// its player reads no start word), so a chapter plays the file itself. The file
// is reachable only through a ticket the account mints, the endpoint that turns
// a ticket into an address answers no `Access-Control-Allow-Origin` (so no page
// can read it), and an address made here belongs to this function's own address
// — hence the bytes are relayed, Range and all, and a pressed chapter in the
// reader's browser is a `<video>` pointed at this function.
//
// It is asked for **only** when a chapter is pressed, so ordinary watching
// stays inside the host's player and costs this project nothing; and it is
// answered only for a file that is one of the site's published videos
// (`video_file_published`), so the function is not a door to the whole account.
// The address it makes is kept for five minutes, and a refused one is made
// again once — a function instance that has just started deserves one retry.
//
// Secrets: STREAMTAPE_LOGIN (the API Login), STREAMTAPE_KEY (the API Key).
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by the runtime.
//
// With the secrets missing the function answers 503 with a sentence, and the
// editor shows it — it never pretends a file went anywhere.

const API = "https://api.streamtape.com";
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

/* The file's address, kept for a few minutes: the host makes one per ticket,
   and a player asks for the same film many times, in pieces. */
const LINKS = new Map<string, { url: string; until: number }>();
const LINK_LIFE = 300_000;
const nap = (ms: number | undefined) => new Promise((done) => setTimeout(done, ms));

/** The address Streamtape gives this function for one published file. */
async function streamLink(id: string): Promise<string> {
  const kept = LINKS.get(id);
  if (kept && kept.until > Date.now()) return kept.url;

  const minted = await api("file/dlticket", { file: id });
  if (Number(minted.status) !== 200 || !minted.result) return "";
  const box = minted.result as Json;
  const ticket = String(box.ticket || "");
  if (!ticket) return "";
  /* the host's own pause before a ticket may be turned into an address */
  const wait = Math.max(0, Math.min(15, Number(box.wait_time) || 0));
  if (wait) await nap(wait * 1000);

  const answer = await api("file/dl", { file: id, ticket });
  if (Number(answer.status) !== 200 || !answer.result) return "";
  const url = String((answer.result as Json).url || "");
  if (url) LINKS.set(id, { url, until: Date.now() + LINK_LIFE });
  return url;
}

Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (request.method !== "GET" && request.method !== "POST") {
    return json({ status: 405, msg: "Only GET and POST.", result: null }, 405);
  }

  const url = new URL(request.url);
  const action = String(url.searchParams.get("action") || "").replace(/^\/+/, "");
  /* `file/stream` is the reader's door and is answered below; every other
     action is a studio's, and a studio's door is the member's */
  const isStream = action === "file/stream";
  if (!isStream && !ALLOWED.has(action)) {
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

  /* the one public door: the file of a published video, as it is asked for */
  if (isStream) {
    const wanted = String(url.searchParams.get("file") || "").trim();
    if (!wanted) return json({ status: 400, msg: "No file named.", result: null }, 400);
    if (!/^[\w-]{4,40}$/.test(wanted)) {
      return json({ status: 400, msg: "That is not a file id.", result: null }, 400);
    }

    const published = (await rpc("video_file_published", { p_file: wanted })) as unknown as boolean | null;
    if (published !== true) {
      return json({ status: 403, msg: "That file is not one of the site's videos.", result: null }, 403);
    }

    const range = request.headers.get("range") || "";
    const ask = (address: string) => fetch(address, range ? { headers: { Range: range } } : undefined);

    let address = await streamLink(wanted);
    if (!address) {
      return json({ status: 502, msg: "The host did not give the file.", result: null }, 502);
    }

    let upstream: Response;
    try {
      upstream = await ask(address);
      /* an address is tied to the address that asked for it: a function
         instance that has just woken up may be answering from another one */
      if (upstream.status === 403 || upstream.status === 401) {
        await upstream.body?.cancel().catch(() => {});
        LINKS.delete(wanted);
        address = await streamLink(wanted);
        if (!address) {
          return json({ status: 502, msg: "The host did not give the file.", result: null }, 502);
        }
        upstream = await ask(address);
      }
    } catch {
      return json({ status: 502, msg: "The host's file could not be reached.", result: null }, 502);
    }

    if (!upstream.ok && upstream.status !== 206) {
      await upstream.body?.cancel().catch(() => {});
      return json(
        { status: upstream.status || 502, msg: "The host refused the file.", result: null },
        upstream.status || 502,
      );
    }

    const headers = new Headers(CORS);
    headers.set("Content-Type", upstream.headers.get("content-type") || "video/mp4");
    headers.set("Accept-Ranges", "bytes");
    headers.set("Cache-Control", "private, max-age=30");
    const length = upstream.headers.get("content-length");
    const span = upstream.headers.get("content-range");
    if (length) headers.set("Content-Length", length);
    if (span) headers.set("Content-Range", span);

    return new Response(upstream.body, { status: upstream.status, headers });
  }

  const token = tokenOf(request);
  if (!token) return json({ status: 401, msg: "Sign in first.", result: null }, 401);

  const studio = String(url.searchParams.get("studio") || "").trim();
  if (!studio) return json({ status: 400, msg: "No studio named.", result: null }, 400);

  const allowed = await studiosOf(token);
  if (!allowed.has(studio)) {
    return json({ status: 403, msg: "This studio is not one you publish into.", result: null }, 403);
  }

  const folder = String(url.searchParams.get("folder") || "").trim();
  const name = String(url.searchParams.get("name") || "").trim();
  const file = String(url.searchParams.get("file") || "").trim();
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
