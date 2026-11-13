/**
 * WhatsApp Cloud API — webhook (Supabase edge function).
 * ------------------------------------------------------------------
 * Meta calls this URL twice over its life:
 *
 *   GET  ?hub.mode=subscribe&hub.verify_token=…&hub.challenge=…
 *        the console saving the callback URL. The function answers with the
 *        challenge **in plain text**, and only when the token matches.
 *
 *   POST a real event — `statuses[]` (sent → delivered → read, or failed) or
 *        `messages[]` (somebody wrote to the business number). Every event is
 *        stored in `whatsapp_events`, and a status is pushed onto the
 *        `recovery_delivery` row that carries the same WhatsApp message id, so
 *        "queued" can finally become "delivered".
 *
 * Secrets (Project → Edge Functions → Secrets):
 *   WHATSAPP_VERIFY_TOKEN   the string typed into the Meta console
 *   WHATSAPP_APP_SECRET     App settings → Basic → App secret. When it is set,
 *                           `X-Hub-Signature-256` must match, and a request
 *                           that does not is answered 403 and dropped.
 *
 * `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are provided by the runtime.
 * Deploy with `verify_jwt: false` — Meta has no Supabase JWT.
 *
 *   supabase functions deploy whatsapp-webhook --no-verify-jwt
 */

const SERVICE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const VERIFY_TOKEN = Deno.env.get("WHATSAPP_VERIFY_TOKEN") ?? "";
const APP_SECRET = Deno.env.get("WHATSAPP_APP_SECRET") ?? "";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

const rest = (path: string, init: RequestInit = {}) =>
  fetch(`${SERVICE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });

/* ------------------------------------------------------------------ */
/* request verification                                                */
/* ------------------------------------------------------------------ */
/** `hub.challenge` in plain text, and nothing at all when the token is wrong. */
function verifySubscription(url: URL): Response {
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge") ?? "";

  if (!VERIFY_TOKEN) return new Response("not configured", { status: 503 });
  if (mode !== "subscribe" || token !== VERIFY_TOKEN) {
    return new Response("forbidden", { status: 403 });
  }
  return new Response(challenge, {
    status: 200,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}

/** HMAC-SHA256 of the raw body, compared with `X-Hub-Signature-256`. */
async function signatureOk(raw: string, header: string | null): Promise<boolean> {
  if (!APP_SECRET) return true; // not configured: accept, and say so in the docs
  if (!header || !header.startsWith("sha256=")) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(APP_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(raw)),
  );
  const expected = Array.from(digest).map((b) => b.toString(16).padStart(2, "0")).join("");

  const given = header.slice("sha256=".length).toLowerCase();
  if (given.length !== expected.length) return false;
  // constant-time-ish: never stop at the first difference
  let diff = 0;
  for (let i = 0; i < expected.length; i += 1) {
    diff |= expected.charCodeAt(i) ^ given.charCodeAt(i);
  }
  return diff === 0;
}

/* ------------------------------------------------------------------ */
/* the events                                                          */
/* ------------------------------------------------------------------ */
type Event = {
  wamid: string | null;
  kind: "status" | "message" | "other";
  status: string | null;
  recipient: string | null;
  sender: string | null;
  body: string | null;
  error_code: string | null;
  error_text: string | null;
  raw: unknown;
};

/** Flatten whatever Meta sent into the rows this project keeps. */
function readEvents(payload: Record<string, unknown>): Event[] {
  const events: Event[] = [];
  const entries = Array.isArray(payload?.entry) ? payload.entry : [];

  for (const entry of entries as Array<Record<string, unknown>>) {
    const changes = Array.isArray(entry?.changes) ? entry.changes : [];
    for (const change of changes as Array<Record<string, unknown>>) {
      const value = (change?.value ?? {}) as Record<string, unknown>;

      const statuses = Array.isArray(value.statuses) ? value.statuses : [];
      for (const item of statuses as Array<Record<string, unknown>>) {
        const errors = Array.isArray(item.errors) ? item.errors : [];
        const first = (errors[0] ?? {}) as Record<string, unknown>;
        events.push({
          wamid: String(item.id ?? "") || null,
          kind: "status",
          status: String(item.status ?? "") || null,
          recipient: String(item.recipient_id ?? "") || null,
          sender: null,
          body: null,
          error_code: first.code !== undefined ? String(first.code) : null,
          error_text: first.title ? String(first.title) : null,
          raw: item,
        });
      }

      const messages = Array.isArray(value.messages) ? value.messages : [];
      for (const item of messages as Array<Record<string, unknown>>) {
        const text = (item.text ?? {}) as Record<string, unknown>;
        events.push({
          wamid: String(item.id ?? "") || null,
          kind: "message",
          status: null,
          recipient: null,
          sender: String(item.from ?? "") || null,
          body: text.body ? String(text.body).slice(0, 1000) : null,
          error_code: null,
          error_text: null,
          raw: item,
        });
      }
    }
  }

  return events;
}

async function store(events: Event[]): Promise<void> {
  if (!events.length) return;
  const rows = events.map((event) => ({
    wamid: event.wamid,
    kind: event.kind,
    status: event.status,
    recipient: event.recipient,
    sender: event.sender,
    body: event.body,
    error_code: event.error_code,
    error_text: event.error_text,
    raw: event.raw,
  }));

  const saved = await rest("whatsapp_events", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify(rows),
  });
  if (!saved.ok) {
    throw new Error(`insert ${saved.status}: ${(await saved.text()).slice(0, 200)}`);
  }
}

/** `queued` → `sent` → `delivered` → `read`, or `failed`. */
async function applyStatuses(events: Event[]): Promise<number> {
  let matched = 0;
  for (const event of events) {
    if (event.kind !== "status" || !event.wamid || !event.status) continue;
    const detail = event.error_text ? `${event.error_code ?? ""} ${event.error_text}`.trim() : null;
    const answer = await rest("rpc/recovery_whatsapp_status", {
      method: "POST",
      body: JSON.stringify({ p_wamid: event.wamid, p_status: event.status, p_detail: detail }),
    });
    if (!answer.ok) continue;
    const body = (await answer.json().catch(() => null)) as { matched?: number } | null;
    matched += Number(body?.matched ?? 0);
  }
  return matched;
}

/* ------------------------------------------------------------------ */
Deno.serve(async (request) => {
  if (request.method === "GET") return verifySubscription(new URL(request.url));
  if (request.method !== "POST") return new Response("method", { status: 405 });

  const raw = await request.text();

  if (!(await signatureOk(raw, request.headers.get("x-hub-signature-256")))) {
    return json({ ok: false, error: "signature" }, 403);
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(raw);
  } catch {
    return json({ ok: false, error: "json" }, 400);
  }

  try {
    const events = readEvents(payload);
    await store(events);
    const matched = await applyStatuses(events);
    return json({ ok: true, events: events.length, matched });
  } catch (error) {
    // a 500 makes Meta retry, which is what we want when storage failed
    return json({ ok: false, error: String((error as Error)?.message ?? error) }, 500);
  }
});
