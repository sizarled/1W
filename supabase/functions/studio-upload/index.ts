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
// GET ?action=file/ticket&file=<id>                    a download ticket
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
// `file/ticket` is the one door a reader may knock on — no session, no studio —
// because it is not about publishing but about **watching**: a Streamtape frame
// cannot be told a second from outside (its page carries no `postMessage`
// listener and its player reads no start word), so a chapter plays the file
// itself, and Streamtape only hands out the address of a file to the browser
// that will play it. The function mints the ticket — that half needs the
// credentials — and the reader's own browser turns it into an address that
// belongs to that reader. The ticket is only minted for a file that is one of
// the site's published videos (`video_file_published`), and it is kept for a
// couple of minutes so a page's first chapter does not mint one per click.
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

/* The ticket a chapter is played with: minted once per file per couple of
   minutes, handed out with the wait already counted down, so a reader who asks
   again — or a second reader — is told nothing they have to sit through. */
const TICKETS = new Map<string, { answer: Json; readyAt: number }>();
const TICKET_LIFE = 120_000;

Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (request.method !== "GET" && request.method !== "POST") {
    return json({ status: 405, msg: "Only GET and POST.", result: null }, 405);
  }

  const url = new URL(request.url);
  const action = String(url.searchParams.get("action") || "").replace(/^\/+/, "");
  /* `file/ticket` is the reader's door and is answered below; every other
     action is a studio's, and a studio's door is the member's */
  const isTicket = action === "file/ticket";
  if (!isTicket && !ALLOWED.has(action)) {
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

  /* the one public door: a ticket for a published video's file */
  if (isTicket) {
    const wanted = String(url.searchParams.get("file") || "").trim();
    if (!wanted) return json({ status: 400, msg: "No file named.", result: null }, 400);
    if (!/^[\w-]{4,40}$/.test(wanted)) {
      return json({ status: 400, msg: "That is not a file id.", result: null }, 400);
    }

    const now = Date.now();
    const kept = TICKETS.get(wanted);
    if (kept && kept.readyAt + TICKET_LIFE > now) {
      const left = Math.max(0, Math.ceil((kept.readyAt - now) / 1000));
      const result = { ...(kept.answer.result as Json), wait_time: left };
      return json({ status: 200, msg: "OK", result });
    }

    const published = (await rpc("video_file_published", { p_file: wanted })) as unknown as boolean | null;
    if (published !== true) {
      return json({ status: 403, msg: "That file is not one of the site's videos.", result: null }, 403);
    }

    const answer = await api("file/dlticket", { file: wanted });
    if (Number(answer.status) === 200 && answer.result) {
      const wait = Number((answer.result as Json).wait_time) || 0;
      TICKETS.set(wanted, { answer, readyAt: Date.now() + wait * 1000 });
    }
    return json(answer);
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
