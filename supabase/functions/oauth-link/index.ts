/**
 * 1World — the OAuth callback (Supabase edge function).
 * ------------------------------------------------------------------
 * The six networks that sign in with OAuth all come back here:
 *
 *   https://<ref>.supabase.co/functions/v1/oauth-link/callback
 *
 * That one URL is what you paste into every developer console — Google,
 * Meta, X, Pinterest, Reddit, TikTok — because the provider is carried by the
 * `state`, not by the path. `state` is the pending row's `link_code`, so the
 * callback never trusts anything the browser says beyond it: it asks
 * `oauth_state_take(state)` who the member is, spends the state, and only then
 * talks to the provider.
 *
 * The provider's quirks (URLs, parameter names, Basic auth, where the id
 * hides) live in `oauth_config()` in the database, not here. This file is a
 * generic authorization-code machine:
 *
 *   callback  → state → code → token → profile → oauth_identity_save()
 *
 * The answer is a small page that tells the window that opened it, then closes
 * itself. No token is ever handed to the browser.
 *
 * Needs no extra secrets: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are in
 * the runtime. The client id/secret pairs live in `site_secrets` — see
 * tools/sql/oauth-linking.sql and the README.
 */

const SERVICE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

type Json = Record<string, unknown>;

async function rpc(name: string, body: Json): Promise<Json> {
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

/** `data.user.username` → answer.data.user.username */
function dig(source: unknown, path: string): string {
  let cursor: unknown = source;
  for (const step of String(path || "").split(".")) {
    if (cursor === null || typeof cursor !== "object") return "";
    cursor = (cursor as Json)[step];
  }
  return cursor === null || cursor === undefined ? "" : String(cursor);
}

const esc = (value: string): string =>
  String(value ?? "").replace(/[&<>"']/g, (ch) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch] as string)
  );

/**
 * The page the member sees in the popup. It tells the dashboard what happened
 * (`postMessage`), then closes; if it cannot close — a window that was opened
 * as a tab — it shows the sentence and a link back.
 */
function page(title: string, detail: string, ok: boolean, provider: string): Response {
  const payload = JSON.stringify({ type: "1world-oauth", ok, provider, detail });
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} — 1World</title>
<style>
  :root { color-scheme: dark }
  body { margin:0; min-height:100vh; display:grid; place-items:center;
         background:#060607; color:#f6f6f7;
         font:16px/1.6 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif }
  .card { max-width:26rem; padding:2rem; text-align:center }
  .mark { width:3rem; height:3rem; margin:0 auto 1rem; border-radius:50%;
          display:grid; place-items:center; border:1px solid ${ok ? "#3d3d47" : "#5a3030"};
          font-size:1.5rem }
  h1 { margin:0 0 .5rem; font-size:1.15rem; letter-spacing:-.01em }
  p { margin:0; color:#9d9da8; font-size:.9rem }
  a { display:inline-block; margin-top:1.25rem; color:#f6f6f7; font-size:.85rem }
</style></head>
<body>
  <main class="card">
    <div class="mark">${ok ? "&#10003;" : "&#33;"}</div>
    <h1>${esc(title)}</h1>
    <p>${esc(detail)}</p>
    <a href="/dashboard.html">Back to the dashboard</a>
  </main>
  <script>
    (function () {
      try { window.opener && window.opener.postMessage(${payload}, "*"); } catch (e) {}
      setTimeout(function () { try { window.close(); } catch (e) {} }, ${ok ? 1200 : 3500});
    })();
  </script>
</body></html>`,
    {
      status: ok ? 200 : 400,
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
    }
  );
}

const SAY: Record<string, string> = {
  state: "This link has already been used, or it was never ours. Start again from Account settings.",
  expired: "The link took longer than 20 minutes. Start again from Account settings.",
  provider: "That network is not configured.",
  external: "The provider did not tell us which account this is.",
  taken: "That account is already linked to another member.",
  oauth: "The OAuth app for this network is not configured yet.",
  token: "The provider refused the exchange. Check the client id, the secret and the redirect URI.",
  profile: "The provider answered, but without a profile we can read.",
  save: "We could not store the link. Try once more.",
};

Deno.serve(async (request) => {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "");
  const provider = url.searchParams.get("provider") ?? "";

  if (path.endsWith("/health")) {
    return new Response(JSON.stringify({ ok: true, service: "oauth-link" }), {
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  }

  const callback = path.endsWith("/callback") || path.endsWith("/oauth-link");
  if (!callback) {
    return page("Nothing here", "This address only answers an OAuth provider coming back.", false, provider);
  }

  const failure = url.searchParams.get("error");
  if (failure) {
    const why = url.searchParams.get("error_description") || failure;
    return page("Not linked", `The provider said: ${why}.`, false, provider);
  }

  const code = url.searchParams.get("code") ?? "";
  const state = url.searchParams.get("state") ?? "";
  if (!code || !state) {
    return page("Not linked", SAY.state, false, provider);
  }

  // 1. who is this, and what is the PKCE verifier?
  const pending = await rpc("oauth_state_take", { p_state: state });
  if (pending.ok !== true) {
    const key = String(pending.error ?? "state");
    return page("Not linked", SAY[key] ?? SAY.state, false, String(pending.provider ?? provider));
  }

  const who = String(pending.provider ?? "");
  const verifier = String(pending.code_verifier ?? "");
  const member = String(pending.member_id ?? "");

  // 2. the recipe for this network
  const config = await rpc("oauth_config", { p_provider: who });
  if (config.ok !== true) {
    return page("Not linked", SAY.oauth, false, who);
  }

  // 3. code → token
  const form = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: String(config.redirect_uri ?? ""),
  });
  for (const [key, value] of Object.entries((config.token_params ?? {}) as Json)) {
    form.set(key, String(value));
  }
  if (config.pkce === true && verifier) form.set("code_verifier", verifier);

  const headers: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
    Accept: "application/json",
  };
  if (config.token_basic === true) {
    const pair = `${config.client_id ?? ""}:${config.client_secret ?? ""}`;
    headers.Authorization = `Basic ${btoa(pair)}`;
    form.delete("client_secret");
  }

  let token: Json = {};
  try {
    const answer = await fetch(String(config.token_url), { method: "POST", headers, body: form });
    token = (await answer.json().catch(() => ({}))) as Json;
  } catch {
    return page("Not linked", SAY.token, false, who);
  }

  const access = String(token.access_token ?? "");
  if (!access) {
    // The provider's own words, so `invalid_client` (wrong secret) and
    // `redirect_uri_mismatch` (wrong URL) are told apart at a glance.
    const code = String(token.error ?? "").trim();
    const why = String(token.error_description ?? "").trim();
    const seen = [code, why].filter(Boolean).join(" — ").slice(0, 180);
    return page("Not linked", seen ? `${SAY.token} (${seen})` : SAY.token, false, who);
  }

  // 4. token → profile
  let profile: Json = {};
  try {
    const answer = await fetch(String(config.userinfo_url), {
      headers: { ...(config.userinfo_headers as Json ?? {}), Authorization: `Bearer ${access}` } as Record<string, string>,
    });
    profile = (await answer.json().catch(() => ({}))) as Json;
  } catch {
    return page("Not linked", SAY.profile, false, who);
  }

  const external = dig(profile, String(config.id_path ?? ""));
  const handle = dig(profile, String(config.handle_path ?? ""));
  if (!external) {
    return page("Not linked", SAY.profile, false, who);
  }

  // 5. and the row
  const seconds = Number(token.expires_in ?? 0);
  const saved = await rpc("oauth_identity_save", {
    p_member: member,
    p_provider: who,
    p_external: external,
    p_handle: handle,
    p_access: access,
    p_refresh: token.refresh_token ? String(token.refresh_token) : null,
    p_expires: seconds > 0 ? new Date(Date.now() + seconds * 1000).toISOString() : null,
  });

  if (saved.ok !== true) {
    const key = String(saved.error ?? "save");
    return page("Not linked", SAY[key] ?? SAY.save, false, who);
  }

  return page(
    `${who[0].toUpperCase()}${who.slice(1)} linked`,
    handle ? `Codes and sign-in can now find ${handle}.` : "The account is linked.",
    true,
    who
  );
});
