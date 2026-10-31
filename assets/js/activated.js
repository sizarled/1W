/**
 * activated.html — activation, then re-activation or upgrade.
 * ------------------------------------------------------------------
 * Rule from the brief:
 *   • the account is activated **once**, on the free plan, on the first visit;
 *   • after that the page offers two doors — re-activate the account, or
 *     upgrade the membership.
 *
 * `member_activation_state(token)` decides which door is which, from
 * `members.account_activated_at` (stamped by the database the first time the
 * status becomes `active` and never cleared), the current status and the plan.
 * Requests are posted to `member_activation_request()` for the first
 * activation and `member_reactivate_request()` afterwards; both write a
 * notification and a log row, and both are rate-limited to one an hour.
 */

import { rpc } from "./data.js";
import { qs, qsa, esc, formatDate } from "./utils.js";
import { hydrateIcons } from "./icons.js";
import { toast } from "./ui.js";
import { sessionToken, clearSessionToken, signOut, setMember } from "./session.js";

const token = sessionToken();
const params = new URLSearchParams(location.search);
const wanted = params.get("member") || "";
const wantedMode = params.get("mode") || "";

const PLAN_LABEL = { free: "Free", silver: "Silver", gold: "Gold", diamond: "Diamond" };
const STATUS_LABEL = { active: "Active", inactive: "Inactive", expired: "Expired", banned: "Banned" };

const COPY = {
  activate: {
    eyebrow: "First activation · free plan",
    title: "Activate your account",
    lead:
      "New accounts start as <b>inactive</b>. Activation happens once, on the free plan: a moderator reviews the request, normally within 24 hours. Until then you can sign in, keep your profile and see your member ID, but the dashboard, viewing codes and points stay closed.",
  },
  choose: {
    eyebrow: "Activation · account already activated",
    title: "Manage your activation",
    lead:
      "This account has been activated before, so activation is no longer offered on its own. You have two options: <b>re-activate</b> the account on the current plan, or <b>upgrade</b> the membership.",
  },
  blocked: {
    eyebrow: "Account banned",
    title: "This account is banned",
    lead:
      "A banned account cannot be activated or upgraded. The only way back is a trial: open the dashboard, read the reason and send a trial request to the court.",
  },
  guest: {
    eyebrow: "Account activation",
    title: "Sign in to activate your account",
    lead: "Activation belongs to the member, not to a link — sign in first and this page will request it for your own account.",
  },
};

const state = { data: null };

/* ================================================================== */
/* boot                                                               */
/* ================================================================== */
async function boot() {
  const root = qs("[data-act]");
  if (!root) return;

  wireLogout();

  if (!token) {
    paintGuest(root);
    return;
  }

  const data = await rpc("member_activation_state", { p_token: token }).catch(() => null);
  if (!data || data.ok !== true) {
    clearSessionToken();
    signOut();
    location.replace("login.html?next=activated.html");
    return;
  }

  state.data = data;
  if (data.member) setMember(data.member);
  paint(data, root);
  wireForms(root);
}

function paintGuest(root) {
  const copy = COPY.guest;
  root.dataset.state = "guest";
  root.dataset.mode = "guest";
  qs("[data-act-eyebrow]", root).textContent = copy.eyebrow;
  qs("[data-act-title]", root).textContent = copy.title;
  qs("[data-act-lead]", root).innerHTML = copy.lead;
  qsa("[data-act-member], [data-act-username], [data-act-membership], [data-act-status], [data-act-activated]", root).forEach((el) => {
    el.textContent = "—";
  });
  qs("[data-act-form]", root).hidden = true;
  qs("[data-act-choice]", root).hidden = true;
  note(root, "", false);
  const link = document.createElement("a");
  link.className = "dsh-btn dsh-btn--primary";
  link.href = "login.html?next=activated.html";
  link.innerHTML = `<i data-icon="login"></i>Sign in`;
  qs("[data-act-form]", root).replaceWith(link);
  hydrateIcons(root);
}

/* ================================================================== */
/* paint                                                              */
/* ================================================================== */
function paint(data, root) {
  const member = data.member || {};
  const mode = data.mode || "activate";
  const copy = COPY[mode] || COPY.activate;

  root.dataset.state = data.status || "inactive";
  root.dataset.mode = mode;

  qs("[data-act-eyebrow]", root).textContent = copy.eyebrow;
  qs("[data-act-title]", root).textContent = copy.title;
  qs("[data-act-lead]", root).innerHTML = copy.lead;

  set(root, "[data-act-member]", member.member_id || "—");
  set(root, "[data-act-username]", member.username || "—");
  set(root, "[data-act-membership]", PLAN_LABEL[data.membership] || cap(data.membership || "free"));
  set(root, "[data-act-activated]", data.activated_at ? formatDate(data.activated_at) : "Never");

  const status = qs("[data-act-status]", root);
  if (status) {
    status.textContent = STATUS_LABEL[data.status] || cap(data.status || "");
    status.dataset.state = data.status || "";
  }

  // the auto-ban date only concerns an account that was never activated
  const deadline = qs("[data-act-deadline]", root);
  if (deadline) {
    if (data.deadline && data.status === "inactive") {
      deadline.hidden = false;
      deadline.textContent = `Accounts that stay inactive until ${formatDate(data.deadline)} are banned automatically.`;
    } else {
      deadline.hidden = true;
    }
  }

  const form = qs("[data-act-form]", root);
  const choice = qs("[data-act-choice]", root);

  if (mode === "activate") {
    const pending = Boolean(data.pending);
    form.hidden = pending;
    choice.hidden = true;
    if (pending) {
      note(
        root,
        `Your activation request was sent ${
          data.requested_at ? formatDate(data.requested_at, { hour: "2-digit", minute: "2-digit" }) : "recently"
        }. A moderator reviews new accounts within 24 hours — the account turns active and you will get a notification here.`
      );
    }
  } else if (mode === "choose") {
    form.hidden = true;
    choice.hidden = false;
    paintChoice(root, data, member);
    if (wantedMode === "reactivate") {
      qs("[data-choice='reactivate']", root)?.scrollIntoView?.({ block: "center", behavior: "smooth" });
    }
  } else {
    // banned — neither door is open
    form.hidden = true;
    choice.hidden = true;
    note(
      root,
      "A banned account cannot be activated or upgraded. Open the dashboard, read the reason and send a trial request to the court."
    );
    if (!qs(".dsh-gate__actions--banned", root)) {
      const back = document.createElement("div");
      back.className = "dsh-gate__actions dsh-gate__actions--banned";
      back.innerHTML = `<a class="dsh-btn dsh-btn--primary" href="dashboard.html"><i data-icon="scale"></i>Open the dashboard</a>
        <a class="dsh-btn" href="dashboard.html#court"><i data-icon="gavel"></i>Go to court</a>`;
      root.append(back);
    }
  }

  if (wanted && member.member_id && wanted !== member.member_id) {
    note(root, "This request is for your own account only. The link pointed at another member ID, so it was ignored.", true);
  }

  hydrateIcons(root);
}

function paintChoice(root, data, member) {
  /* — re-activation — */
  const reactForm = qs("[data-react-form]", root);
  const reactState = qs("[data-react-state]", root);
  const reactText = qs("[data-react-text]", root);
  const btn = qs("button[type=submit]", reactForm);

  const canReactivate = Boolean(data.can_reactivate);
  const active = Boolean(data.already_active);

  if (reactState) {
    reactState.hidden = false;
    reactState.textContent = active
      ? "Active now"
      : data.pending
        ? "Request sent"
        : canReactivate
          ? STATUS_LABEL[data.status] || "Closed"
          : data.activated_at
            ? "Not available"
            : "Included in plan";
    reactState.dataset.tone = canReactivate || active ? "on" : "off";
  }

  if (reactText) {
    reactText.innerHTML = !data.activated_at && !active
      ? "This account has never been activated. Activation is a free-plan step: on a paid plan the membership itself opens the account as soon as a moderator confirms it, so there is no separate request to send."
      : active
      ? "The account is active right now, so nothing has to be reopened. If it ever closes, this is the door back — without touching the plan."
      : data.pending
        ? `A request is already with a moderator (sent ${esc(data.requested_at ? formatDate(data.requested_at) : "recently")}). You will get a notification as soon as the account reopens.`
        : data.status === "expired"
          ? "The membership ran out. Re-activation reopens the same plan without buying an upgrade."
          : "Reopen the account on the current plan. A moderator reopens it within 24 hours.";
  }

  if (reactForm) {
    reactForm.hidden = !canReactivate || Boolean(data.pending) || active;
    if (btn) btn.disabled = !canReactivate || Boolean(data.pending) || active;
  }

  /* — upgrade — */
  const upgrade = qs("[data-upgrade]", root);
  const upgradeState = qs("[data-upgrade-state]", root);
  const canUpgrade = Boolean(data.can_upgrade);

  set(root, "[data-upgrade-current]", PLAN_LABEL[data.membership] || cap(data.membership || "free"));
  set(root, "[data-upgrade-points]", `${Number(member.points || 0).toLocaleString("en-US")} · ≈ $${(Number(member.points || 0) / 100).toFixed(2)}`);

  if (upgrade) {
    const id = member.member_id || "";
    upgrade.href = `actevite.html?member=${encodeURIComponent(id)}&from=activation`;
    upgrade.setAttribute("aria-disabled", canUpgrade ? "false" : "true");
    upgrade.classList.toggle("is-disabled", !canUpgrade);
  }

  if (upgradeState) {
    upgradeState.hidden = false;
    upgradeState.textContent = canUpgrade
      ? data.membership === "free"
        ? "Free plan"
        : `${PLAN_LABEL[data.membership] || cap(data.membership)} plan`
      : "Locked";
    upgradeState.dataset.tone = canUpgrade ? "on" : "off";
  }
}

/* ================================================================== */
/* requests                                                           */
/* ================================================================== */
function wireForms(root) {
  const first = qs("[data-act-form]", root);
  if (first) {
    first.addEventListener("submit", (event) => {
      event.preventDefault();
      send(root, first, "member_activation_request", "Activation requested", "A moderator reviews new accounts shortly.");
    });
  }

  const again = qs("[data-react-form]", root);
  if (again) {
    again.addEventListener("submit", (event) => {
      event.preventDefault();
      send(root, again, "member_reactivate_request", "Re-activation requested", "We will notify you when the account reopens.");
    });
  }
}

async function send(root, form, fn, title, success) {
  const btn = qs("button[type=submit]", form);
  if (btn && btn.disabled) return;
  if (btn) btn.disabled = true;

  const message = String(new FormData(form).get("note") || "").trim();
  const result = await rpc(fn, { p_token: token, p_note: message || null }).catch(() => null);

  if (btn) btn.disabled = false;

  if (!result || result.ok !== true) {
    toast({ title: "Request not sent", message: errorText(result && result.error) });
    return;
  }

  toast({ title, message: success });

  // refresh the state so the page shows "Request sent" and disables the form
  const data = await rpc("member_activation_state", { p_token: token }).catch(() => null);
  if (data && data.ok === true) {
    state.data = data;
    paint(data, root);
  } else {
    form.hidden = true;
    note(root, "Request received. A moderator will review it shortly — you will get a notification here.", true);
  }
}

function errorText(code) {
  const map = {
    session: "Your session ended. Sign in again.",
    status: "This account is no longer inactive.",
    already_activated: "This account was already activated once — use re-activation or an upgrade.",
    plan: "Activation is offered on the free plan only. Choose a plan first.",
    banned: "A banned account cannot be re-activated. Request a trial instead.",
    already_active: "This account is already active.",
    not_activated_yet: "This account was never activated — use the activation request.",
  };
  return map[code] || "Try again in a moment.";
}

/* ================================================================== */
/* helpers                                                            */
/* ================================================================== */
function set(root, selector, value) {
  const el = qs(selector, root);
  if (el) el.textContent = value;
}

function note(root, text, show = true) {
  const box = qs("[data-act-notice]", root);
  const slot = qs("[data-act-notice-text]", root);
  if (!box || !slot) return;
  box.hidden = !text || !show;
  slot.textContent = text;
  hydrateIcons(root);
}

function cap(value) {
  const text = String(value || "");
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : "";
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
