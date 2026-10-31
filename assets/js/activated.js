/**
 * activated.html — activation request for an inactive account.
 * ------------------------------------------------------------------
 * Reads the signed-in member through `member_dashboard` (so the page cannot
 * be opened for somebody else), then posts the request to
 * `member_activation_request()` which writes a notification + a log row.
 */

import { rpc } from "./data.js";
import { qs, formatDate } from "./utils.js";
import { hydrateIcons } from "./icons.js";
import { toast } from "./ui.js";
import { sessionToken, clearSessionToken, signOut, setMember } from "./session.js";

const token = sessionToken();
const params = new URLSearchParams(location.search);
const wanted = params.get("member") || "";

async function boot() {
  const root = qs("[data-act]");
  if (!root) return;

  wireLogout();

  if (!token) {
    root.dataset.state = "guest";
    qs(".dsh-gate__text", root).innerHTML =
      "Sign in first — then this page can request activation for your own account.";
    const form = qs("[data-act-form]", root);
    if (form) {
      form.innerHTML = `<div class="dsh-field dsh-field--wide">
        <a class="dsh-btn dsh-btn--primary" href="login.html?next=activated.html"><i data-icon="login"></i>Sign in</a>
      </div>`;
    }
    hydrateIcons(root);
    return;
  }

  const data = await rpc("member_dashboard", { p_token: token }).catch(() => null);
  if (!data || data.ok !== true) {
    clearSessionToken();
    signOut();
    location.replace("login.html?next=activated.html");
    return;
  }

  if (data.member) setMember(data.member);
  paint(data, root);
  wireForm(root);
}

function paint(data, root) {
  const member = data.member || {};
  root.dataset.state = String(member.status || "inactive");

  const idSlot = qs("[data-act-member]", root);
  if (idSlot) idSlot.textContent = member.member_id || "—";
  const nameSlot = qs("[data-act-username]", root);
  if (nameSlot) nameSlot.textContent = member.username || "—";
  const statusSlot = qs("[data-act-status]", root);
  if (statusSlot) {
    statusSlot.textContent = String(member.status || "").toUpperCase();
    statusSlot.dataset.state = member.status;
  }

  if (wanted && member.member_id && wanted !== member.member_id) {
    note(root, "This request is for your own account only. The link pointed at another member ID, so it was ignored.");
  }

  const created = member.created_at ? new Date(member.created_at) : null;
  const deadline = qs("[data-act-deadline]", root);
  if (deadline && created && !Number.isNaN(created.getTime())) {
    deadline.hidden = false;
    deadline.textContent = `Accounts that stay inactive until ${formatDate(new Date(created.getTime() + 30 * 86400000))} are banned automatically.`;
  }

  if (member.status === "active") {
    note(root, "This account is already active — nothing to request. Open the dashboard.");
    const form = qs("[data-act-form]", root);
    if (form) form.hidden = true;
  } else if (member.status === "banned") {
    note(root, "This account is banned, not inactive. Activation is not the way back — request a trial from the dashboard.");
    const form = qs("[data-act-form]", root);
    if (form) form.hidden = true;
  }

  hydrateIcons(root);
}

function wireForm(root) {
  const form = qs("[data-act-form]", root);
  if (!form || form.hidden) return;

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (stateBusy(form)) return;

    const message = String(new FormData(form).get("note") || "").trim();
    const result = await rpc("member_activation_request", { p_token: token, p_note: message || null }).catch(() => null);

    if (!result || result.ok !== true) {
      release(form);
      toast({
        title: "Request not sent",
        message: result && result.error === "status" ? "This account is no longer inactive." : "Try again in a moment.",
      });
      return;
    }

    release(form);
    form.hidden = true;
    note(
      root,
      result.already
        ? "Your request is already with a moderator. You will get a notification when the account is activated."
        : "Request received. A moderator reviews new accounts within 24 hours — you will be notified here."
    );
    toast({ title: "Activation requested", message: "We will notify you when the account is active." });
    hydrateIcons(root);
  });
}

function stateBusy(form) {
  const btn = qs("button[type=submit]", form);
  if (btn && btn.disabled) return true;
  if (btn) btn.disabled = true;
  return false;
}

function release(form) {
  const btn = qs("button[type=submit]", form);
  if (btn) btn.disabled = false;
}

function note(root, text) {
  const box = qs("[data-act-notice]", root);
  const slot = qs("[data-act-notice-text]", root);
  if (!box || !slot) return;
  box.hidden = false;
  slot.textContent = text;
  hydrateIcons(root);
}

function wireLogout() {
  document.querySelectorAll("[data-logout]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const done = () => {
        clearSessionToken();
        signOut();
        location.replace("login.html");
      };
      if (token) rpc("member_logout", { p_token: token }).then(done).catch(done);
      else done();
    });
  });
}

boot();
