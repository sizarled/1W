/**
 * rest.html — account recovery.
 * ------------------------------------------------------------------
 * Three steps, exactly as the flow was specified:
 *   1. email + phone, matched against `members` (both must agree) — the code
 *      is issued and sent on the same call (`recovery_start`)
 *   2. the recovery code (`recovery_verify`) — a ticket comes back, 20 minutes
 *   3. the new password (`recovery_reset`) — and a **new** code, because the
 *      one that was just spent is dead
 *
 * Two short-cuts, both wired here:
 *   · `rest.html?recovry=OW-…` — the recovery link: `recovery_link()` turns the
 *     code into the same ticket, so the page opens at the password step with the
 *     account details already on screen. The misspelled parameter is the one
 *     that was agreed on; `recovery=` and `code=` are accepted as well.
 *   · the device path (`recovery_device`) — full name + phone + email + a
 *     viewing code, refused unless this browser's `1w.device` id is already
 *     bound to one of the member's codes.
 *
 * Nothing is stored in the browser except the identity typed into step 1 and
 * the ticket, and the ticket lives only in this page's memory.
 */

import { rpc } from "./data.js";
import { esc, qs, qsa, formatDate } from "./utils.js";
import { hydrateIcons } from "./icons.js";
import { toast } from "./ui.js";
import { playSound } from "./sound.js";
import { deviceId } from "./device.js";

/* ------------------------------------------------------------------ */
/* state + copy                                                       */
/* ------------------------------------------------------------------ */
const state = {
  step: "identity",
  email: "",
  phone: "",
  ticket: "",
  member: null,
  code: "",
  link: "",
  channels: null,
  via: "",
  masked: {},
  viaLink: false,
  busy: false,
  saved: false,
  cooldown: 0,
  timer: 0,
};

const STEP_ORDER = ["identity", "code", "password"];

/** how the password was changed, written into the .txt */
const RECOVERED_VIA = {
  code: "recovery code",
  link: "recovery link",
  device: "linked device + viewing code",
};

const MESSAGES = {
  email_format: "Enter a valid email address.",
  phone_format: "Enter the phone number with at least six digits.",
  not_found: "No account matches that email address.",
  phone: "That phone number does not belong to this account.",
  closed: "That account is permanently closed. Contact support.",
  code: "That code is not right.",
  expired: "That code has expired — send yourself a new one.",
  no_code: "No recovery code is waiting for this account. Send one first.",
  locked: "Too many wrong tries. Recovery is paused for a while.",
  ticket: "The verification expired. Start again from the email and phone.",
  password: "Use at least 8 characters (72 maximum).",
  email: "Enter a valid email address.",
  full_name: "Enter the full name written on the account.",
  view_code: "Enter the six-digit viewing code.",
  view_code_server: "Those six digits are not an original code of this account on this device.",
  identity: "The name, phone, email and code do not describe one account.",
  device_not_bound:
    "That code is bound to another device. Enter the code that was created on this device — its original code.",
  device_other:
    "That code belongs to another device. Only the device's own original code opens this path.",
  device_unknown:
    "No code on this account was created on this browser, so it cannot be the linked device. Use the recovery code or the recovery link.",
  device: "This browser has no device id, so it cannot be the linked device.",
  identity_name: "That is not the full name on this account.",
  identity_phone: "That is not the phone number on this account.",
  identity_email: "That is not the email address on this account.",
  server: "The request did not go through. Try again in a moment.",
};

/** server error code → the field that owns it, per step */
const SERVER_FIELD = {
  identity: { email_format: "email", phone_format: "phone", not_found: "email", phone: "phone" },
  code: { code: "code" },
  password: { password: "password" },
  device: {
    email: "dev_email",
    full_name: "full_name",
    identity: "full_name",
    view_code: "view_code",
    device_not_bound: "view_code",
    device: "view_code",
    password: "dev_password",
  },
};

/* ------------------------------------------------------------------ */
/* boot                                                               */
/* ------------------------------------------------------------------ */
export async function initRest() {
  if (!qs("[data-rc-panel]")) return;

  wireForms();
  wireReveals();
  wireGo();
  wireSteps();
  wireResend();
  wireDone();
  wireDevice();
  hydrateIcons();

  const link = linkCodeFromUrl();
  if (link) {
    await useLink(link);
  } else {
    paintDeviceState();
    showStep("identity");
    qs("#rc-email")?.focus();
  }
}

/** `rest.html?recovry=…` — the agreed spelling, plus two harmless variants. */
function linkCodeFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const raw = params.get("recovry") || params.get("recovery") || params.get("code") || "";
  return String(raw).trim();
}

/* ------------------------------------------------------------------ */
/* steps                                                              */
/* ------------------------------------------------------------------ */
function showStep(name) {
  state.step = name;
  qsa("[data-rc-panel]").forEach((panel) => {
    panel.hidden = panel.dataset.rcPanel !== name;
  });

  // the stepper: the current step is marked, the finished ones are ticked
  // ("done" is one past the last step, so all three dots close)
  const index = name === "done" ? STEP_ORDER.length : STEP_ORDER.indexOf(name);
  qsa("[data-rc-stepdot]").forEach((dot) => {
    const own = STEP_ORDER.indexOf(dot.dataset.rcStepdot);
    if (index >= 0 && own === index) {
      dot.setAttribute("aria-current", "step");
    } else {
      dot.removeAttribute("aria-current");
    }
    if (index > 0 && own < index) {
      dot.dataset.done = "true";
    } else {
      delete dot.dataset.done;
    }
  });

  const top = qs(".rc-card");
  if (top && state.step !== "identity") top.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
}

function wireSteps() {
  // Back from step 3 returns to the code step — unless the recovery link skipped it
  qs("[data-rc-back]")?.addEventListener("click", () => {
    showStep(state.viaLink ? "identity" : "code");
  });
}

/**
 * Step 3 shows the account once it is verified. When the recovery link was
 * used there is no code step at all, so the heading says so.
 */
function paintWho(title, text) {
  const box = qs("[data-rc-who]");
  if (!box) return;
  box.hidden = false;
  const t = qs("[data-rc-who-title]");
  const s = qs("[data-rc-who-text]");
  if (t) t.textContent = title;
  if (s) s.textContent = text;

  const list = qs("[data-rc-account]");
  if (list) list.innerHTML = accountRows(state.member)
    .slice(0, 5)
    .map(([label, value]) => `<div><dt>${esc(label)}</dt><dd>${esc(value || "—")}</dd></div>`)
    .join("");
}

function accountRows(member) {
  const m = member || {};
  return [
    ["Member ID", m.member_id],
    ["Full name", m.full_name],
    ["Username", m.username],
    ["Email", m.email],
    ["Phone number", m.phone_number],
    ["Country", m.country],
    ["Account status", m.status ? m.status.replace(/^./, (c) => c.toUpperCase()) : ""],
    ["Member since", m.created_at ? formatDate(m.created_at) : ""],
  ];
}

/* ------------------------------------------------------------------ */
/* step 1 — email + phone                                             */
/* ------------------------------------------------------------------ */
function wireForms() {
  qs('[data-rc-form="identity"]')?.addEventListener("submit", (event) => {
    event.preventDefault();
    submitIdentity();
  });
  qs('[data-rc-form="code"]')?.addEventListener("submit", (event) => {
    event.preventDefault();
    submitCode();
  });
  qs('[data-rc-form="password"]')?.addEventListener("submit", (event) => {
    event.preventDefault();
    submitPassword();
  });
  qs('[data-rc-form="device"]')?.addEventListener("submit", (event) => {
    event.preventDefault();
    submitDevice();
  });

  // the code field formats itself while typing: OW-XXXX-XXXX-XXXX
  qs("#rc-code")?.addEventListener("input", (event) => {
    const input = event.target;
    const at = input.selectionStart;
    const before = input.value.length;
    input.value = formatCode(input.value);
    const after = input.value.length;
    if (typeof at === "number") {
      const next = Math.max(0, at + (after - before));
      input.setSelectionRange(next, next);
    }
  });

  // a stray letter in the phone field is kept, only digits are compared
  qs("#rc-view-code")?.addEventListener("input", (event) => {
    event.target.value = event.target.value.replace(/[^0-9]/g, "").slice(0, 6);
  });
}

async function submitIdentity() {
  if (state.busy) return;
  clearErrors("identity");

  const email = (qs("#rc-email")?.value || "").trim().toLowerCase();
  const phone = (qs("#rc-phone")?.value || "").trim();

  if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email)) {
    setError("email", MESSAGES.email_format);
    qs("#rc-email")?.focus();
    return;
  }
  if ((phone.match(/\d/g) || []).length < 6) {
    setError("phone", MESSAGES.phone_format);
    qs("#rc-phone")?.focus();
    return;
  }

  state.email = email;
  state.phone = phone;

  const result = await call("identity", "recovery_start", { p_email: email, p_phone: phone });
  if (!result || !result.ok) {
    fail("identity", result);
    return;
  }

  state.member = null;
  state.channels = result.channels || { email: false, telegram: false };
  state.masked = {
    email: result.masked_email,
    phone: result.masked_phone,
    name: result.full_name,
  };

  paintSent(result);
  showStep("code");
  startCooldown(60);
  playSound("success", 0.3);
  toast({
    title: "Code sent",
    message: deliveryLine(state.channels),
    tone: "success",
    iconName: "send",
    duration: 6000,
  });
  qs("#rc-code")?.focus();
}

function paintSent(result) {
  const box = qs("[data-rc-sent]");
  if (box) box.hidden = false;
  const title = qs("[data-rc-sent-title]");
  const text = qs("[data-rc-sent-text]");
  if (title) {
    title.textContent = `A recovery code is on its way${
      state.masked.name ? ` for ${state.masked.name}` : ""
    }.`;
  }
  if (text) {
    const parts = [`Sent to ${state.masked.email || "your email"}`];
    if (state.channels?.telegram) parts.push("and to your Telegram");
    parts.push("— valid for 30 minutes, and it works once.");
    text.textContent = parts.join(" ");
  }
  if (result?.restricted) {
    alertBox(
      "code",
      "This account is not active right now. You can still change the password; the restriction stays until the account is renewed."
    );
  }
}

function deliveryLine(channels) {
  const list = [];
  if (channels?.email) list.push("email");
  if (channels?.telegram) list.push("Telegram");
  if (!list.length) return "The code was issued, but no channel is configured yet — use the recovery link.";
  return `Sent by ${list.join(" and ")}. It works once.`;
}

/* ------------------------------------------------------------------ */
/* step 2 — the code                                                  */
/* ------------------------------------------------------------------ */
async function submitCode() {
  if (state.busy) return;
  clearErrors("code");

  const code = formatCode(qs("#rc-code")?.value || "");
  if (!/^OW-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(code)) {
    setError("code", "The code looks like OW-XXXX-XXXX-XXXX.");
    qs("#rc-code")?.focus();
    return;
  }

  const result = await call("code", "recovery_verify", {
    p_email: state.email,
    p_phone: state.phone,
    p_code: code,
  });
  if (!result || !result.ok) {
    fail("code", result);
    return;
  }

  state.ticket = result.ticket || "";
  state.member = result.member || null;
  state.viaLink = false;
  state.via = "code";
  paintWho(
    "The code is correct",
    "Set the new password below. Every open session on the account will be closed."
  );
  showStep("password");
  qs("#rc-password")?.focus();
}

function wireResend() {
  qs("[data-rc-resend]")?.addEventListener("click", async () => {
    if (state.cooldown > 0 || state.busy) return;
    if (!state.email || !state.phone) {
      showStep("identity");
      return;
    }
    clearErrors("code");
    const result = await call("code", "recovery_start", {
      p_email: state.email,
      p_phone: state.phone,
    });
    if (!result || !result.ok) {
      if (result?.error === "wait") {
        startCooldown(Number(result.retry_after) || 30);
      }
      fail("code", result);
      return;
    }
    state.channels = result.channels || state.channels;
    state.masked = {
      email: result.masked_email || state.masked.email,
      phone: result.masked_phone || state.masked.phone,
      name: result.full_name || state.masked.name,
    };
    paintSent(result);
    startCooldown(60);
    toast({ title: "New code sent", message: deliveryLine(state.channels), tone: "success", iconName: "send" });
    qs("#rc-code")?.focus();
  });
}

/** The server refuses a second send inside 60 s; the button agrees. */
function startCooldown(seconds) {
  const button = qs("[data-rc-resend]");
  const label = qs("[data-rc-resend-label]");
  const note = qs("[data-rc-countdown]");
  clearInterval(state.timer);
  state.cooldown = Math.max(0, Math.round(seconds));

  const paint = () => {
    if (state.cooldown <= 0) {
      clearInterval(state.timer);
      if (button) button.disabled = false;
      if (label) label.textContent = "Send a new code";
      if (note) note.hidden = true;
      return;
    }
    if (button) button.disabled = true;
    if (label) label.textContent = "Send a new code";
    if (note) {
      note.hidden = false;
      note.textContent = `Another code can be sent in ${state.cooldown}s.`;
    }
    state.cooldown -= 1;
  };

  paint();
  if (state.cooldown >= 0) state.timer = setInterval(paint, 1000);
}

/* ------------------------------------------------------------------ */
/* step 3 — the new password                                          */
/* ------------------------------------------------------------------ */
async function submitPassword() {
  if (state.busy) return;
  clearErrors("password");

  const password = qs("#rc-password")?.value || "";
  const repeat = qs("#rc-password2")?.value || "";

  if (password.length < 8 || password.length > 72) {
    setError("password", MESSAGES.password);
    qs("#rc-password")?.focus();
    return;
  }
  if (password !== repeat) {
    setError("password2", "The two passwords do not match.");
    qs("#rc-password2")?.focus();
    return;
  }
  if (!state.ticket) {
    alertBox("password", MESSAGES.ticket);
    showStep("identity");
    return;
  }

  const result = await call("password", "recovery_reset", {
    p_ticket: state.ticket,
    p_password: password,
  });
  if (!result || !result.ok) {
    fail("password", result);
    return;
  }

  qsa('#rc-password, #rc-password2, #rc-device-password, #rc-code').forEach((input) => {
    input.value = "";
    if (input.type === "password") input.type = "password";
  });
  const strength = qs("[data-rc-strength]");
  if (strength) strength.hidden = true;

  finish(result);
}

/* ------------------------------------------------------------------ */
/* the device path                                                    */
/* ------------------------------------------------------------------ */
/** The id the player and the activation wizard share — read, never invented. */
function thisDevice() {
  return deviceId({ create: false });
}

function paintDeviceState(verdict = "") {
  const node = qs("[data-rc-device-state]");
  if (!node) return;
  const id = thisDevice();
  node.hidden = false;
  node.textContent = verdict || (id
    ? `This device is ${id}. The path accepts the original code of this device — the one created here at activation.`
    : "This browser has no device id yet — it is written the first time the player or the activation wizard runs here.");
}

/**
 * Ask the server, without changing anything, whether this browser is recognised
 * as the device of the account: name + phone + email + the id. Three true/false
 * answers come back — never a code, never a device of somebody else.
 */
async function checkDevice() {
  const node = qs("[data-rc-device-state]");
  const id = thisDevice();
  const name = (qs("#rc-name")?.value || "").trim();
  const phone = (qs("#rc-device-phone")?.value || "").trim();
  const email = (qs("#rc-device-email")?.value || "").trim().toLowerCase();

  if (!id) {
    paintDeviceState("This browser has no device id yet — it is written the first time the player or the activation wizard runs here.");
    return;
  }
  if (!name || !phone || !email) {
    paintDeviceState(`This device is ${id}. Fill in the name, phone and email to see whether it is recognised.`);
    return;
  }

  const button = qs("[data-rc-device-check]");
  if (button) button.disabled = true;
  const result = await rpc("recovery_device_status", {
    p_name: name,
    p_phone: phone,
    p_email: email,
    p_device: id,
  }).catch(() => null);
  if (button) button.disabled = false;

  if (!result || result.ok !== true) {
    paintDeviceState(`This device is ${id}. The check did not go through — try again.`);
    return;
  }
  if (result.identity) {
    paintDeviceState(
      `${id}: this device holds the original code of ${result.username}. Enter that code below.`
    );
  } else if (!result.bound) {
    paintDeviceState(
      `${id}: no code on this account was created on this browser, so it cannot be the linked device. Use the recovery code or the link instead.`
    );
  } else {
    paintDeviceState(`${id}: ${describeMatches(result)}`);
  }
  if (node) {
    node.dataset.bound = result.bound ? "true" : "false";
    node.dataset.identity = result.identity ? "true" : "false";
  }
}

/**
 * The device holds the codes of one or more accounts. Say how many, and — when
 * one of them nearly fits the typed identity — which field is the odd one out.
 */
function describeMatches(result) {
  const rows = Array.isArray(result.matches) ? result.matches : [];
  const names = rows.map((row) => row.username).filter(Boolean);

  if (!rows.length) {
    return "this device holds no code of the account.";
  }

  const near = rows
    .map((row) => ({ ...row, score: [row.name, row.phone, row.email].filter(Boolean).length }))
    .filter((row) => row.score >= 2)
    .sort((a, b) => b.score - a.score)[0];

  if (near) {
    const wrong = [
      near.name ? "" : "the full name",
      near.phone ? "" : "the phone number",
      near.email ? "" : "the email address",
    ].filter(Boolean);
    return `this device holds the original code of ${near.username}, and ${
      wrong.length === 1 ? `${wrong[0]} is the only field that does not match it` : `${wrong.join(" and ")} do not match it`
    }.`;
  }

  return `this device holds the original codes of ${names.length} account${
    names.length === 1 ? "" : "s"
  } (${names.join(", ")}) — the name, the phone and the email do not match any of them.`;
}

async function submitDevice() {
  if (state.busy) return;
  clearErrors("device");

  const name = (qs("#rc-name")?.value || "").trim();
  const phone = (qs("#rc-device-phone")?.value || "").trim();
  const email = (qs("#rc-device-email")?.value || "").trim().toLowerCase();
  const viewCode = (qs("#rc-view-code")?.value || "").replace(/[^0-9]/g, "");
  const password = qs("#rc-device-password")?.value || "";

  if (name.length < 3) {
    setError("full_name", MESSAGES.full_name);
    qs("#rc-name")?.focus();
    return;
  }
  if ((phone.match(/\d/g) || []).length < 6) {
    setError("dev_phone", MESSAGES.phone_format);
    qs("#rc-device-phone")?.focus();
    return;
  }
  if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email)) {
    setError("dev_email", MESSAGES.email);
    qs("#rc-device-email")?.focus();
    return;
  }
  if (!/^[0-9]{6}$/.test(viewCode)) {
    setError("view_code", MESSAGES.view_code);
    qs("#rc-view-code")?.focus();
    return;
  }
  if (password.length < 8 || password.length > 72) {
    setError("dev_password", MESSAGES.password);
    qs("#rc-device-password")?.focus();
    return;
  }

  const result = await call("device", "recovery_device", {
    p_name: name,
    p_phone: phone,
    p_email: email,
    p_view_code: viewCode,
    p_device: thisDevice(),
    p_password: password,
  });
  if (!result || !result.ok) {
    fail("device", result);
    return;
  }

  qs("#rc-device-password").value = "";
  finish(result);
}

/* ------------------------------------------------------------------ */
/* done                                                               */
/* ------------------------------------------------------------------ */
function finish(result) {
  state.member = result.member || state.member;
  state.via = result.via === "device" ? "device" : state.via || "code";
  state.code = result.recovery_code || "";
  state.link = result.recovery_link || (state.code ? `rest.html?recovry=${state.code}` : "");
  state.ticket = "";
  state.saved = false;

  const code = qs("[data-rc-code]");
  if (code) code.textContent = state.code || "—";
  const link = qs("[data-rc-link]");
  if (link) link.textContent = state.link || "—";

  const details = qs("[data-rc-details]");
  if (details) {
    const rows = [...accountRows(state.member), ["Password changed", formatDate(new Date())]];
    details.innerHTML = rows
      .map(([label, value]) => `<div><dt>${esc(label)}</dt><dd>${esc(value || "—")}</dd></div>`)
      .join("");
  }

  const stepDots = qsa("[data-rc-stepdot]");
  stepDots.forEach((dot) => {
    dot.dataset.done = "true";
    dot.removeAttribute("aria-current");
  });

  hydrateIcons();
  showStep("done");
  playSound("success", 0.45);
  toast({
    title: "Password changed",
    message: "A new recovery code is on screen — save it.",
    tone: "success",
    iconName: "check",
    duration: 8000,
  });
  qs("[data-rc-details]")?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
}

async function useLink(code) {
  const result = await call("identity", "recovery_link", { p_code: code });
  if (!result || !result.ok) {
    showStep("identity");
    paintDeviceState();
    const reason =
      result?.error === "locked"
        ? MESSAGES.locked
        : "That recovery link is no longer valid — a code works once, and a new one replaces it. Enter your email and phone to get a fresh code.";
    alertBox("identity", reason);
    qs("#rc-email")?.focus();
    toast({ title: "Link not accepted", message: "Request a new recovery code.", tone: "error", iconName: "info" });
    return;
  }

  state.ticket = result.ticket || "";
  state.member = result.member || null;
  state.viaLink = true;
  state.via = "link";
  state.email = state.member?.email || "";
  state.phone = state.member?.phone_number || "";

  const email = qs("#rc-email");
  if (email) email.value = state.email;
  const phone = qs("#rc-phone");
  if (phone) phone.value = state.phone;

  paintWho(
    "The recovery link is valid",
    "Set the new password below. Every open session on the account will be closed."
  );
  showStep("password");
  qs("#rc-password")?.focus();
}

function wireDone() {
  qs("[data-rc-copy-code]")?.addEventListener("click", (event) => {
    copyValue(state.code, event.currentTarget, "Copy code", "[data-rc-code]");
  });
  qs("[data-rc-copy-link]")?.addEventListener("click", (event) => {
    copyValue(state.link, event.currentTarget, "Copy link", "[data-rc-link]");
  });
  qs("[data-rc-download]")?.addEventListener("click", () => {
    const name = `ONEWORLD-RECOVERY-${(state.member?.username || "account").replace(/^@/, "")}.txt`;
    downloadText(name, txtBody());
    state.saved = true;
    toast({
      title: "Details downloaded",
      message: "The file holds the account and the new recovery code.",
      tone: "success",
      iconName: "download",
    });
  });
}

async function copyValue(text, button, idle, target) {
  const label = button?.querySelector("span");
  try {
    await navigator.clipboard.writeText(text);
    if (label) label.textContent = "Copied";
  } catch {
    const node = qs(target);
    if (node && window.getSelection) {
      const range = document.createRange();
      range.selectNodeContents(node);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      if (label) label.textContent = "Select and copy";
    }
  }
  setTimeout(() => {
    if (label) label.textContent = idle;
  }, 2200);
}

function txtBody() {
  const m = state.member || {};
  const changed = new Date().toISOString().slice(0, 19).replace("T", " ");
  return [
    "================================",
    "          ONEWORLD",
    "      ACCOUNT RECOVERY",
    "================================",
    "",
    `Member ID: ${m.member_id || ""}`,
    `Full Name: ${m.full_name || ""}`,
    `Username: ${m.username || ""}`,
    `Email: ${m.email || ""}`,
    `Phone Number: ${m.phone_number || ""}`,
    `Country: ${m.country || ""}`,
    `Account status: ${m.status || ""}`,
    "",
    `Recovery Code: ${state.code || ""}`,
    `Recovery Link: ${state.link || ""}`,
    "",
    `Password changed: ${changed} UTC`,
    `Recovered through: ${RECOVERED_VIA[state.via] || "recovery code"}`,
    "",
    "================================",
    "IMPORTANT:",
    "This code works once — the next recovery replaces it.",
    "Keep the code and the link to yourself.",
    "================================",
    "",
  ].join("\n");
}

function downloadText(filename, text) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  let url = "";
  try {
    url = URL.createObjectURL(blob);
  } catch {
    return;
  }
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/* ------------------------------------------------------------------ */
/* plumbing                                                           */
/* ------------------------------------------------------------------ */
function wireReveals() {
  qsa("[data-rc-reveal]").forEach((button) => {
    button.addEventListener("click", () => {
      const input = qs(`#rc-${button.dataset.rcReveal}`);
      if (!input) return;
      const show = input.type === "password";
      input.type = show ? "text" : "password";
      button.setAttribute("aria-pressed", show ? "true" : "false");
      button.setAttribute("aria-label", show ? "Hide password" : "Show password");
    });
  });

  // a live strength hint, no library
  qs("#rc-password")?.addEventListener("input", (event) => {
    const value = event.target.value;
    const box = qs("[data-rc-strength]");
    const bar = qs("[data-rc-strength-bar]");
    const label = qs("[data-rc-strength-label]");
    if (!box || !bar || !label) return;
    if (!value) {
      box.hidden = true;
      return;
    }
    const score = strengthOf(value);
    box.hidden = false;
    bar.style.width = `${score.width}%`;
    label.textContent = score.label;
  });
}

function strengthOf(value) {
  let score = 0;
  if (value.length >= 8) score += 1;
  if (value.length >= 12) score += 1;
  if (/[a-z]/.test(value) && /[A-Z]/.test(value)) score += 1;
  if (/[0-9]/.test(value)) score += 1;
  if (/[^A-Za-z0-9]/.test(value)) score += 1;
  if (score <= 2) return { width: 33, label: "Weak — add length and symbols." };
  if (score <= 3) return { width: 66, label: "Fair — a longer password would be safer." };
  return { width: 100, label: "Strong." };
}

/** The device panel: a prefill from step 1, and the "check this device" answer. */
function wireDevice() {
  qs("[data-rc-device-check]")?.addEventListener("click", checkDevice);
}

/** Step 1 typed the email and the phone already — the device path reuses them. */
function prefillDevice() {
  const email = qs("#rc-device-email");
  const phone = qs("#rc-device-phone");
  if (email && !email.value) email.value = state.email || qs("#rc-email")?.value || "";
  if (phone && !phone.value) phone.value = state.phone || qs("#rc-phone")?.value || "";
  const name = qs("#rc-name");
  if (name && !name.value) name.value = state.member?.full_name || "";
}

/** Every step button in the page that only switches panels. */
function wireGo() {
  qsa("[data-rc-go]").forEach((button) => {
    button.addEventListener("click", () => {
      const target = button.dataset.rcGo;
      if (target === "device") {
        prefillDevice();
        paintDeviceState();
      }
      showStep(target);
      if (target === "identity") qs("#rc-email")?.focus();
    });
  });
}

/** One place for the network: agent, errors and the busy flag. */
async function call(step, fn, body) {
  state.busy = true;
  busy(step, true);
  try {
    const payload = { ...body, p_agent: (navigator.userAgent || "").slice(0, 200) };
    const result = await rpc(fn, payload);
    return result && typeof result === "object" ? result : null;
  } catch (error) {
    console.warn("[1World] recovery:", fn, error.message);
    const box = qs(`[data-rc-alert="${step}"]`);
    alertBox(step, MESSAGES.server);
    if (box) box.scrollIntoView?.({ block: "nearest" });
    playSound("error", 0.3);
    return null;
  } finally {
    state.busy = false;
    busy(step, false);
  }
}

function busy(step, on) {
  const button = qs(`[data-rc-submit="${step}"]`);
  if (!button) return;
  button.disabled = on;
  const label = button.querySelector("[data-rc-submit-label]");
  if (!label) return;
  if (on) {
    if (!label.dataset.idle) label.dataset.idle = label.textContent;
    label.textContent = "Working…";
  } else if (label.dataset.idle) {
    label.textContent = label.dataset.idle;
    delete label.dataset.idle;
  }
}

/** A known server error code → the right field, or the alert box. */
function fail(step, result) {
  const code = result?.error || "server";
  // the client already checked the shape, so a "view_code" answer from the
  // server means the code is not this account's original code on this device
  const message =
    step === "device" && code === "view_code" ? MESSAGES.view_code_server : messageFor(code, result);
  let field = SERVER_FIELD[step]?.[code];
  if (step === "device" && code === "identity") {
    field = result?.field === "phone" ? "dev_phone" : result?.field === "email" ? "dev_email" : "full_name";
  }
  if (field) setError(field, message);
  if (!field || !field.startsWith("dev_")) alertBox(step, message);
  const error = result?.error;
  if (error === "expired" || error === "ticket" || error === "no_code") {
    if (step !== "identity" && step !== "device") showStep("code");
  }
  playSound("error", 0.3);
}

function messageFor(code, result) {
  if (code === "device_not_bound") {
    return result?.reason === "other_device" ? MESSAGES.device_other : MESSAGES.device_unknown;
  }
  if (code === "identity") {
    const which =
      result?.field === "phone" ? "identity_phone" : result?.field === "email" ? "identity_email" : "identity_name";
    const base = MESSAGES[which];
    return result?.username ? `${base} This code belongs to ${result.username}.` : base;
  }
  if (code === "wait") {
    const wait = Number(result?.retry_after) || 60;
    return `Wait ${wait} seconds before asking for another code.`;
  }
  if (code === "locked") {
    const until = result?.until ? new Date(result.until) : null;
    const when = until && !Number.isNaN(until.getTime())
      ? until.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })
      : null;
    return when ? `Too many wrong tries. Try again after ${when}.` : MESSAGES.locked;
  }
  if (code === "code" && Number(result?.attempts_left) >= 0) {
    return `That code is not right — ${result.attempts_left} ${
      Number(result.attempts_left) === 1 ? "try" : "tries"
    } left.`;
  }
  return MESSAGES[code] || MESSAGES.server;
}

function setError(name, text) {
  const node = qs(`[data-err="${name}"]`);
  const field = node?.closest("[data-field]");
  if (node) {
    node.textContent = text || "";
    node.hidden = !text;
  }
  if (field) {
    if (text) field.dataset.invalid = "true";
    else delete field.dataset.invalid;
  }
}

function clearErrors(step) {
  const panel = qs(`[data-rc-panel="${step}"]`);
  if (!panel) return;
  qsa("[data-err]", panel).forEach((node) => {
    node.textContent = "";
    node.hidden = true;
  });
  qsa("[data-field]", panel).forEach((field) => delete field.dataset.invalid);
  const alert = qs(`[data-rc-alert="${step}"]`);
  if (alert) alert.hidden = true;
}

function alertBox(step, text) {
  const box = qs(`[data-rc-alert="${step}"]`);
  if (!box) return;
  const line = box.querySelector("[data-rc-alert-text]");
  if (line) line.textContent = text || "";
  box.hidden = !text;
}

/** Normalise anything typed in the code fields into OW-XXXX-XXXX-XXXX. */
function formatCode(value) {
  const raw = String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (raw.length <= 2) return raw;
  const head = raw.slice(0, 2);
  const rest = raw.slice(2, 14);
  const groups = [];
  for (let i = 0; i < rest.length; i += 4) groups.push(rest.slice(i, i + 4));
  return [head, ...groups].filter(Boolean).join("-");
}
