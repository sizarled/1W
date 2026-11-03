/**
 * 1World — the OAuth callback (Supabase edge function).
 * ------------------------------------------------------------------
 * One URL serves two jobs, because a provider will only ever call back to a
 * registered address:
 *
 *   https://<ref>.supabase.co/functions/v1/oauth-link/callback
 *
 *   link   the member is signed in and the row is being added to their
 *          account: dashboard.html → Account settings → Connect.
 *   login  nobody is signed in yet: login.html → "Continue with Google".
 *          The provider proves the account, `oauth_login_complete()` finds the
 *          member it belongs to, and a one-use ticket comes back through
 *          `postMessage` — never in a URL, so no return address can be poisoned.
 *
 * Which one it is, is decided by the `state` alone: `oauth_attempt_take()`
 * looks in `oauth_logins` first and in `member_identities` second. The browser
 * is never asked.
 *
 * Everything provider-specific (URLs, parameter names, Basic auth, where the
 * id hides) lives in `oauth_config()` in the database. This file is a generic
 * authorization-code machine:
 *
 *   state → code → token → profile → oauth_identity_save() | oauth_login_complete()
 *
 * No token is ever handed to the browser.
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

const TITLE = { link: "Account linking", login: "Signing in" };

type Answer = {
  ok: boolean;
  detail: string;
  note?: string;
  provider?: string;
  /** login only: the one-use ticket the opener swaps for a session */
  ticket?: string;
  error?: string;
  mode?: "link" | "login";
};

/**
 * The window the member came back in. It tells the page that opened it
 * (`postMessage`), then closes itself; a window that cannot close — a tab
 * opened by hand — shows the sentence and a way back.
 */
function page(answer: Answer): Response {
  const mode = answer.mode ?? "link";
  const payload = JSON.stringify({
    type: mode === "login" ? "1world-oauth-login" : "1world-oauth",
    ok: answer.ok,
    provider: answer.provider ?? "",
    detail: answer.detail,
    error: answer.error ?? "",
    ticket: answer.ticket ?? "",
  });

  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(answer.ok ? "Done" : "Not done")} — 1World</title>
<style>
  :root { color-scheme: dark }
  * { box-sizing: border-box }
  body { margin:0; min-height:100vh; display:grid; place-items:center; padding:1.5rem;
         background:#060607; color:#f6f6f7;
         font:16px/1.6 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif }
  .card { width:100%; max-width:24rem; text-align:center }
  .wordmark { display:flex; align-items:center; justify-content:center; gap:.5rem;
              margin-bottom:1.75rem; color:#6d6d78; font-size:.7rem; letter-spacing:.28em;
              text-transform:uppercase }
  .wordmark span.mark { width:1.4rem; height:1.4rem; border:1px solid #3d3d47; border-radius:50%;
                        display:grid; place-items:center; font-size:.6rem; letter-spacing:0 }
  .ring { width:3.25rem; height:3.25rem; margin:0 auto 1.1rem; border-radius:50%;
          display:grid; place-items:center; font-size:1.4rem;
          border:1px solid ${answer.ok ? "#3d3d47" : "#5a3030"};
          color:${answer.ok ? "#f6f6f7" : "#e5a3a3"} }
  h1 { margin:0 0 .45rem; font-size:1.05rem; letter-spacing:-.01em; font-weight:600 }
  p { margin:0; color:#9d9da8; font-size:.88rem }
  p.note { margin-top:.5rem; direction:rtl; color:#77777f }
  a { display:inline-block; margin-top:1.4rem; color:#f6f6f7; font-size:.82rem;
      text-decoration:none; border-bottom:1px solid #3d3d47; padding-bottom:.1rem }
</style></head>
<body>
  <main class="card">
    <p class="wordmark"><span class="mark">1</span>1World · ${esc(TITLE[mode])}</p>
    <div class="ring">${answer.ok ? "&#10003;" : "&#33;"}</div>
    <h1>${esc(answer.detail)}</h1>
    ${answer.note ? `<p class="note">${esc(answer.note)}</p>` : ""}
    <p>${answer.ok ? "This window closes itself." : "You can close it and try again."}</p>
    <a href="/dashboard.html">Back to 1World</a>
  </main>
  <script>
    (function () {
      try { window.opener && window.opener.postMessage(${payload}, "*"); } catch (e) {}
      setTimeout(function () { try { window.close(); } catch (e) {} }, ${answer.ok ? 1400 : 6000});
    })();
  </script>
</body></html>`,
    {
      status: answer.ok ? 200 : 400,
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
    }
  );
}

const SAY: Record<string, string> = {
  state: "This link has already been used, or it was never ours. Start again.",
  expired: "That took longer than 20 minutes. Start again.",
  provider: "That network is not configured.",
  external: "The provider did not tell us which account this is.",
  taken: "That account is already linked to another member.",
  oauth: "The OAuth app for this network is not configured yet.",
  token: "The provider refused the exchange.",
  profile: "The provider answered, but without a profile we can read.",
  save: "We could not store the link. Try once more.",
  unlinked: "This account is not linked to any member yet.",
  ticket: "That sign-in link has already been used.",
};

const UNLINKED_NOTE =
  "هذا الحساب غير مرتبط بأي عضو بعد. سجّل الدخول بكلمة السر ثم اربطه من إعدادات الحساب.";

/** code → token, the one piece of OAuth that is identical everywhere. */
async function exchange(config: Json, code: string, verifier: string, login: boolean) {
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

  try {
    const answer = await fetch(String(config.token_url), { method: "POST", headers, body: form });
    const token = (await answer.json().catch(() => ({}))) as Json;
    return { token, failure: "" };
  } catch (error) {
    return { token: {} as Json, failure: String((error as Error)?.message ?? "network") };
  }
}

Deno.serve(async (request) => {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "");

  if (path.endsWith("/health")) {
    return new Response(JSON.stringify({ ok: true, service: "oauth-link" }), {
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  }

  if (!path.endsWith("/callback")) {
    return page({
      ok: false,
      detail: "This address only answers an OAuth provider coming back.",
      mode: "link",
    });
  }

  const failure = url.searchParams.get("error");
  if (failure) {
    const why = url.searchParams.get("error_description") || failure;
    return page({ ok: false, detail: `The provider said: ${why}.`, mode: "link" });
  }

  const code = url.searchParams.get("code") ?? "";
  const state = url.searchParams.get("state") ?? "";
  if (!code || !state) {
    return page({ ok: false, detail: SAY.state, error: "state", mode: "login" });
  }

  // 1. who is this, and is it a link or a sign-in?
  const attempt = await rpc("oauth_attempt_take", { p_state: state });
  if (attempt.ok !== true) {
    const key = String(attempt.error ?? "state");
    return page({ ok: false, detail: SAY[key] ?? SAY.state, error: key, mode: "login" });
  }

  const isLogin = attempt.kind === "login";
  const who = String(attempt.provider ?? "");
  const verifier = String(attempt.code_verifier ?? "");
  const mode = isLogin ? "login" : "link";

  // 2. the recipe for this network
  const config = await rpc("oauth_config", { p_provider: who });
  if (config.ok !== true) {
    return page({ ok: false, detail: SAY.oauth, error: "oauth", provider: who, mode });
  }

  // 3. code → token
  const { token, failure: netFailure } = await exchange(config, code, verifier, isLogin);
  const access = String(token.access_token ?? "");
  if (!access) {
    // The provider's own words, so `invalid_client` (wrong secret) and
    // `redirect_uri_mismatch` (wrong URL) are told apart at a glance.
    const errCode = String(token.error ?? "").trim();
    const why = String(token.error_description ?? "").trim();
    const seen = [errCode, why].filter(Boolean).join(" — ").slice(0, 180);
    const detail = seen ? `${SAY.token} (${seen})` : netFailure ? `${SAY.token} (${netFailure})` : SAY.token;
    return page({ ok: false, detail, error: "token", provider: who, mode });
  }

  // 4. token → profile
  let profile: Json = {};
  try {
    const answer = await fetch(String(config.userinfo_url), {
      headers: {
        ...((config.userinfo_headers as Json) ?? {}),
        Authorization: `Bearer ${access}`,
      } as Record<string, string>,
    });
    profile = (await answer.json().catch(() => ({}))) as Json;
  } catch {
    return page({ ok: false, detail: SAY.profile, error: "profile", provider: who, mode });
  }

  const external = dig(profile, String(config.id_path ?? ""));
  const handle = dig(profile, String(config.handle_path ?? ""));
  if (!external) {
    return page({ ok: false, detail: SAY.profile, error: "profile", provider: who, mode });
  }

  // 5a. a sign-in: find the member, hand back a one-use ticket
  if (isLogin) {
    const done = await rpc("oauth_login_complete", {
      p_login: String(attempt.login_id ?? ""),
      p_external: external,
      p_handle: handle,
    });

    if (done.ok !== true) {
      const key = String(done.error ?? "unlinked");
      return page({
        ok: false,
        detail: key === "unlinked" ? `${SAY.unlinked} ${handle}` : SAY[key] ?? SAY.unlinked,
        note: key === "unlinked" ? UNLINKED_NOTE : undefined,
        error: key,
        provider: who,
        mode,
      });
    }

    const name = handle || "your account";
    return page({
      ok: true,
      detail: `Signed in as ${name}`,
      note: "تم التحقق من الحساب. جاري تسجيل الدخول…",
      ticket: String(done.ticket ?? ""),
      provider: who,
      mode,
    });
  }

  // 5b. a link: write the row
  const seconds = Number(token.expires_in ?? 0);
  const saved = await rpc("oauth_identity_save", {
    p_member: String(attempt.member_id ?? ""),
    p_provider: who,
    p_external: external,
    p_handle: handle,
    p_access: access,
    p_refresh: token.refresh_token ? String(token.refresh_token) : null,
    p_expires: seconds > 0 ? new Date(Date.now() + seconds * 1000).toISOString() : null,
  });

  if (saved.ok !== true) {
    const key = String(saved.error ?? "save");
    return page({ ok: false, detail: SAY[key] ?? SAY.save, error: key, provider: who, mode });
  }

  const label = `${who[0].toUpperCase()}${who.slice(1)}`;
  return page({
    ok: true,
    detail: handle ? `${label} linked — ${handle}` : `${label} linked`,
    note: "سيصل كود الاستعادة إلى هذا الحساب أيضًا.",
    provider: who,
    mode,
  });
});
