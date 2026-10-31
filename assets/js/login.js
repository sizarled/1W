/**
 * login.html — member sign-in.
 * ------------------------------------------------------------------
 * Three tables only:
 *   members   identity + account status
 *   sessions  one row per successful sign-in (sha256 of the token only)
 *   log       every attempt and action, written by the database itself
 *
 * The password is posted once to `member_login()` (security definer) which
 * compares it with the bcrypt hash. The browser receives a session token,
 * never a hash and never the password back.
 */

import { esc, qs, formatDate, avatarPlaceholder } from "./utils.js";
import { hydrateIcons } from "./icons.js";
import { toast } from "./ui.js";
import { playSound } from "./sound.js";
import { rpc } from "./data.js";
import { cachedVisitor, lookupVisitorFast } from "./geo.js";
import { setMember, signOut, setSessionToken, sessionToken, clearSessionToken } from "./session.js";

/* ================================================================== */
/* copy                                                               */
/* ================================================================== */
const MESSAGES = {
  empty: "Enter your member ID, username or email and your password.",
  not_found: "No account matches those details. Check the spelling, or create an account.",
  password: "That password is not correct.",
  inactive: "Your account is waiting for activation. You can sign in as soon as it has been activated.",
  banned: "This account has been banned and cannot sign in.",
  expired: "This account has expired. Contact support to restore it.",
  unknown: "That session is no longer valid. Please sign in again.",
  ended: "You already signed out of that session. Please sign in again.",
  server: "We could not sign you in right now. Please try again in a moment.",
};

const STATUS_NOTICE = {
  inactive: {
    title: "Your account is not activated yet",
    text: "You can sign in and open your profile, but publishing, purchases and points stay locked until your account is activated.",
  },
  banned: {
    title: "This account is banned",
    text: "You can sign in, but restricted areas stay locked. Contact support to appeal the ban.",
  },
  expired: {
    title: "This account has expired",
    text: "You can sign in, but membership features stay locked until the account is renewed.",
  },
};

const state = {
  busy: false,
  member: null,
  session: null,
  next: "",
  restored: false,
};

/* ================================================================== */
/* boot                                                               */
/* ================================================================== */
export async function initLogin() {
  const form = qs("[data-lgform]");
  if (!form) return;

  readQuery();
  wireReveal();
  wireSubmit();
  wireLogout();
  setSubmitBusy(false);

  const prefill = qs('[name="login"]');
  if (prefill && !prefill.value) {
    const params = new URLSearchParams(location.search);
    const username = params.get("username") || params.get("member") || params.get("email") || "";
    if (username) {
      prefill.value = username.replace(/^@?/, "@").replace("@@", "@");
      qs('[name="password"]')?.focus();
    }
  }

  await restoreSession();
}

function readQuery() {
  const params = new URLSearchParams(location.search);
  // only same-site pages are honoured, so the button can never be a redirect oracle
  const next = params.get("next") || "";
  state.next = /^[a-z0-9][a-z0-9._-]*\.html(?:[?#].*)?$/i.test(next) && !next.includes("//") ? next : "";
}

/* ================================================================== */
/* restore                                                            */
/* ================================================================== */
async function restoreSession() {
  const token = sessionToken();
  if (!token) return;

  let result = null;
  try {
    result = await rpc("member_session", { p_token: token });
  } catch (error) {
    console.warn("[1World] login: session check failed", error.message);
    return;
  }

  if (!result || result.ok !== true) {
    clearSessionToken();
    signOut();
    return;
  }

  state.restored = true;
  showSignedIn(result.member, result.session, "Your session is still active. Welcome back.", isRestricted(result));
}

/* ================================================================== */
/* form                                                               */
/* ================================================================== */
function wireReveal() {
  const button = qs("[data-reveal]");
  const input = qs('[name="password"]');
  button?.addEventListener("click", () => {
    if (!input) return;
    const show = input.type === "password";
    input.type = show ? "text" : "password";
    button.setAttribute("aria-pressed", show ? "true" : "false");
    button.classList.toggle("is-on", show);
    input.focus({ preventScroll: true });
  });
}

function setSubmitBusy(busy, label) {
  state.busy = busy;
  const button = qs("[data-lg-submit]");
  const text = qs("[data-submit-label]");
  if (button) button.disabled = busy;
  if (text) text.textContent = busy ? label || "Signing in…" : "Log in";
}

function field(name) {
  return qs(`[data-field="${name}"]`);
}

function setError(name, message) {
  const node = qs(`[data-err="${name}"]`);
  if (node) {
    node.textContent = message || "";
    node.hidden = !message;
  }
  field(name)?.classList.toggle("is-invalid", Boolean(message));
  const input = qs(`[name="${name}"]`);
  if (input) input.setAttribute("aria-invalid", message ? "true" : "false");
}

function clearErrors() {
  setError("login", "");
  setError("password", "");
  const alert = qs("[data-lg-error]");
  if (alert) alert.hidden = true;
  const extra = qs("[data-lg-error-extra]");
  if (extra) {
    extra.hidden = true;
    extra.textContent = "";
  }
}

function showError(message, extra = "") {
  const alert = qs("[data-lg-error]");
  if (alert) alert.hidden = false;
  const text = qs("[data-lg-error-text]");
  if (text) text.textContent = message;
  const extraNode = qs("[data-lg-error-extra]");
  if (extraNode) {
    extraNode.hidden = !extra;
    extraNode.textContent = extra || "";
  }
}

function wireSubmit() {
  const form = qs("[data-lgform]");
  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (state.busy) return;

    const login = (qs('[name="login"]')?.value || "").trim();
    const password = qs('[name="password"]')?.value || "";
    const remember = Boolean(qs("[data-remember]")?.checked);

    clearErrors();

    if (!login) {
      setError("login", "Enter your member ID, username or email.");
      qs('[name="login"]')?.focus();
      return;
    }
    if (!password) {
      setError("password", "Enter your password.");
      qs('[name="password"]')?.focus();
      return;
    }

    setSubmitBusy(true);
    try {
      const visitor = cachedVisitor() || (await lookupVisitorFast(900));
      const result = await rpc("member_login", {
        p_login: login,
        p_password: password,
        p_remember: remember,
        p_ip: visitor?.ip || null,
        p_agent: navigator.userAgent || null,
      });

      if (!result || result.ok !== true) {
        handleFailure(result || { error: "server" });
        return;
      }

      setSessionToken(result.session?.token || "", remember);
      showSignedIn(result.member, result.session, "You are signed in.", isRestricted(result));
      qs('[name="password"]').value = "";
      playSound("success", 0.4);
      const restricted = isRestricted(result);
      toast({
        title: restricted ? "Signed in — account restricted" : "Signed in",
        message: restricted
          ? `${statusLabel(result.member?.status)} account. Some areas stay locked.`
          : `Welcome back, ${displayName(result.member)}.`,
        tone: restricted ? "info" : "success",
        iconName: restricted ? "info" : "check",
      });
    } catch (error) {
      console.warn("[1World] login:", error.message);
      showError(MESSAGES.server);
      toast({ title: "Connection problem", message: MESSAGES.server, tone: "error" });
      playSound("error", 0.3);
    } finally {
      setSubmitBusy(false);
    }
  });
}

function handleFailure(result) {
  const code = result.error || "server";
  const message = MESSAGES[code] || MESSAGES.server;

  if (code === "password") {
    setError("password", MESSAGES.password);
    showError(MESSAGES.password);
  } else if (code === "not_found") {
    setError("login", MESSAGES.not_found);
    showError(MESSAGES.not_found);
  } else if (code === "inactive") {
    const deadline = result.activate_deadline ? formatDate(result.activate_deadline) : "";
    showError(MESSAGES.inactive, deadline ? `Accounts that stay inactive until ${deadline} are banned automatically.` : "");
  } else if (code === "banned" || code === "expired") {
    showError(message);
  } else if (code === "empty") {
    showError(MESSAGES.empty);
  } else {
    showError(message);
  }

  playSound("error", 0.3);
  toast({ title: "Could not sign in", message, tone: "error", iconName: "info" });
}

/* ================================================================== */
/* signed in                                                          */
/* ================================================================== */
function displayName(member) {
  return String(member?.username || member?.full_name || "member").replace(/^@/, "") || "member";
}

function isRestricted(result) {
  const status = String(result?.member?.status || result?.status || "active").toLowerCase();
  return Boolean(result?.restricted) || status !== "active";
}

function statusLabel(status) {
  return String(status || "active").replace(/^./, (c) => c.toUpperCase());
}

function showSignedIn(member, session, message, restricted = false) {
  state.member = member || null;
  state.session = session || null;

  const formCard = qs("[data-lg-form]");
  const doneCard = qs("[data-lg-success]");
  if (formCard) formCard.hidden = true;
  if (doneCard) doneCard.hidden = false;

  const avatar = qs("[data-lg-avatar]");
  if (avatar) {
    avatar.src = member?.avatar_url || avatarPlaceholder(displayName(member));
    avatar.alt = `${displayName(member)} avatar`;
  }

  const name = qs("[data-lg-name]");
  if (name) name.textContent = member?.username || `@${displayName(member)}`;

  const id = qs("[data-lg-member-id]");
  if (id) id.textContent = member?.member_id || "—";

  const status = qs("[data-lg-status]");
  if (status) {
    const label = statusLabel(member?.status);
    status.textContent = label;
    status.dataset.state = restricted ? "restricted" : "active";
  }

  paintNotice(member, restricted, session);

  const lead = qs("[data-lg-message]");
  if (lead) lead.textContent = message || "You are signed in. Welcome back.";

  const details = qs("[data-lg-details]");
  if (details) {
    const rows = [
      ["Member ID", member?.member_id],
      ["Username", member?.username],
      ["Email", member?.email],
      ["Level", member?.level ? `LV ${member.level}` : "—"],
      ["Membership", titleCase(member?.membership || "free")],
      ["Signed in", formatDate(new Date())],
      ["Session ends", session?.expires_at ? formatDate(session.expires_at) : "—"],
      [session?.remember_me ? "Stay signed in" : "Session", session?.remember_me ? "Yes — 30 days" : "12 hours"],
    ];
    details.innerHTML = rows
      .map(([label, value]) => `<div><dt>${esc(label)}</dt><dd>${esc(value ?? "—")}</dd></div>`)
      .join("");
  }

  const next = qs("[data-lg-next]");
  if (next) {
    if (state.next) {
      next.href = state.next;
      next.hidden = false;
    } else {
      next.hidden = true;
      next.removeAttribute("href");
    }
  }

  // keep the shell (header, sidebar, wallet) in step with the server
  setMember({
    id: member?.id,
    memberId: member?.member_id,
    memberCode: member?.member_code,
    username: member?.username,
    name: displayName(member),
    email: member?.email,
    avatar: member?.avatar_url || avatarPlaceholder(displayName(member)),
    level: member?.level || 1,
    points: member?.points || 0,
    membership: member?.membership || "free",
    status: member?.status || "active",
    sessionExpiresAt: session?.expires_at || "",
  });

  hydrateIcons();
  doneCard?.scrollIntoView?.({ block: "start", behavior: "smooth" });
}

function paintNotice(member, restricted, session) {
  const box = qs("[data-lg-notice]");
  if (!box) return;
  const status = String(member?.status || "active").toLowerCase();
  const copy = STATUS_NOTICE[status];
  if (!restricted || !copy) {
    box.hidden = true;
    return;
  }

  const title = qs("[data-lg-notice-title]");
  const text = qs("[data-lg-notice-text]");
  if (title) title.textContent = copy.title;
  if (text) {
    let extra = "";
    if (status === "inactive" && member?.created_at) {
      const deadline = new Date(new Date(member.created_at).getTime() + 30 * 864e5);
      if (!Number.isNaN(deadline.getTime())) {
        extra = ` Accounts that stay inactive until ${formatDate(deadline)} are banned automatically.`;
      }
    }
    if (session?.remember_me === false && status === "inactive") {
      extra += " This session ends after 12 hours.";
    }
    text.textContent = copy.text + extra;
  }
  box.hidden = false;
}

function titleCase(value) {
  return String(value).replace(/\b\w/g, (c) => c.toUpperCase());
}

/* ================================================================== */
/* log out                                                            */
/* ================================================================== */
function wireLogout() {
  const button = qs("[data-lg-logout]");
  button?.addEventListener("click", async () => {
    const label = qs("[data-logout-label]");
    const token = sessionToken();
    if (button.disabled) return;
    button.disabled = true;
    if (label) label.textContent = "Signing out…";

    try {
      if (token) await rpc("member_logout", { p_token: token });
    } catch (error) {
      console.warn("[1World] logout:", error.message);
    }

    clearSessionToken();
    signOut();
    state.member = null;
    state.session = null;
    state.restored = false;

    const formCard = qs("[data-lg-form]");
    const doneCard = qs("[data-lg-success]");
    if (doneCard) doneCard.hidden = true;
    if (formCard) formCard.hidden = false;
    clearErrors();
    const notice = qs("[data-lg-notice]");
    if (notice) notice.hidden = true;
    const password = qs('[name="password"]');
    if (password) password.value = "";
    qs('[name="login"]')?.focus();

    if (label) label.textContent = "Log out";
    button.disabled = false;

    playSound("notefcation", 0.25);
    toast({ title: "Signed out", message: "Your session was ended on the server.", tone: "info", iconName: "logout" });
  });
}

/* exposed only for the jsdom test */
export const __debug = { state, MESSAGES };
