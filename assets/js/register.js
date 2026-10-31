/**
 * register.html — account registration.
 * ------------------------------------------------------------------
 * One table only: `members`.
 *   • the form is validated here and again inside `member_register()` (the
 *     server is the authority: unique username, unique email, inactive status)
 *   • the password never leaves this page except as the argument of that
 *     security-definer call, which stores a bcrypt hash — no plaintext anywhere
 *   • the recovery code is returned exactly once, shown once, and stored on the
 *     server as a sha256 fingerprint only
 *   • the success card offers the account details, a .txt download and a login
 *     button that reports "waiting for activation" until the account is active
 *
 * Password storage note: the platform's publishable key cannot create Supabase
 * Auth users, so the password is hashed server-side into `members.password_hash`.
 * When the Auth-backed sign-in lands, `auth_user_id` links the same row.
 */

import { PLANS } from "./config.js";
import { esc, qs, qsa, formatDate } from "./utils.js";
import { icon, hydrateIcons } from "./icons.js";
import { toast } from "./ui.js";
import { playSound } from "./sound.js";
import { rpc } from "./data.js";

/* ================================================================== */
/* countries                                                          */
/* ================================================================== */
const COUNTRIES = [
  "Afghanistan", "Albania", "Algeria", "Andorra", "Angola", "Argentina", "Armenia", "Australia", "Austria",
  "Azerbaijan", "Bahrain", "Bangladesh", "Belarus", "Belgium", "Belize", "Benin", "Bhutan", "Bolivia",
  "Bosnia and Herzegovina", "Botswana", "Brazil", "Brunei", "Bulgaria", "Burkina Faso", "Burundi", "Cambodia",
  "Cameroon", "Canada", "Cape Verde", "Chad", "Chile", "China", "Colombia", "Comoros", "Costa Rica", "Croatia",
  "Cuba", "Cyprus", "Czechia", "Denmark", "Djibouti", "Dominican Republic", "Ecuador", "Egypt", "El Salvador",
  "Estonia", "Eswatini", "Ethiopia", "Fiji", "Finland", "France", "Gabon", "Gambia", "Georgia", "Germany",
  "Ghana", "Greece", "Guatemala", "Guinea", "Guyana", "Haiti", "Honduras", "Hong Kong", "Hungary", "Iceland",
  "India", "Indonesia", "Iran", "Iraq", "Ireland", "Italy", "Ivory Coast", "Jamaica", "Japan", "Jordan",
  "Kazakhstan", "Kenya", "Kuwait", "Kyrgyzstan", "Laos", "Latvia", "Lebanon", "Lesotho", "Liberia", "Libya",
  "Liechtenstein", "Lithuania", "Luxembourg", "Madagascar", "Malawi", "Malaysia", "Maldives", "Mali", "Malta",
  "Mauritania", "Mauritius", "Mexico", "Moldova", "Monaco", "Mongolia", "Montenegro", "Morocco", "Mozambique",
  "Myanmar", "Namibia", "Nepal", "Netherlands", "New Zealand", "Nicaragua", "Niger", "Nigeria", "North Macedonia",
  "Norway", "Oman", "Pakistan", "Palestine", "Panama", "Paraguay", "Peru", "Philippines", "Poland", "Portugal",
  "Qatar", "Romania", "Russia", "Rwanda", "Saudi Arabia", "Senegal", "Serbia", "Seychelles", "Sierra Leone",
  "Singapore", "Slovakia", "Slovenia", "Somalia", "South Africa", "South Korea", "Spain", "Sri Lanka", "Sudan",
  "Suriname", "Sweden", "Switzerland", "Syria", "Taiwan", "Tajikistan", "Tanzania", "Thailand", "Togo",
  "Trinidad and Tobago", "Tunisia", "Turkey", "Turkmenistan", "Uganda", "Ukraine", "United Arab Emirates",
  "United Kingdom", "United States", "Uruguay", "Uzbekistan", "Venezuela", "Vietnam", "Yemen", "Zambia", "Zimbabwe",
];

/* ================================================================== */
/* state                                                              */
/* ================================================================== */
const state = {
  member: null,
  code: "",
  plan: "",
  duration: "",
  busy: false,
  saved: false,
  availability: { username: null, email: null },
};

const MESSAGES = {
  full_name: "Enter your full name (at least 3 characters).",
  username_format: "3–24 characters: letters, numbers, dot, dash or underscore. Start and end with a letter or number.",
  username_taken: "That username is already taken.",
  email_format: "Enter a valid email address.",
  email_taken: "That email address is already registered.",
  phone: "Enter a valid phone number, including the country code.",
  password: "Use at least 8 characters (72 maximum).",
  password_confirm: "The two passwords do not match.",
  birth_date: "Enter a valid date of birth. You must be at least 13 years old.",
  country: "Choose your country.",
  terms: "You must accept the terms and the privacy policy.",
  server: "The account could not be created. Please try again.",
};

/** server error code → the field that owns it */
const SERVER_FIELD = {
  full_name: "full_name",
  username_format: "username",
  username_taken: "username",
  email_format: "email",
  email_taken: "email",
  phone: "phone",
  password: "password",
  birth_date: "birth_date",
  country: "country",
  terms: "terms",
};

const cleanUsername = (value = "") => String(value).trim().replace(/^@+/, "").toLowerCase();

/* ================================================================== */
/* boot                                                               */
/* ================================================================== */
export async function initRegister() {
  const form = qs("[data-regform]");
  if (!form) return;

  fillCountries();
  readPlan();
  renderPlan();
  wireReveal();
  wireAvailability();
  wireLiveValidation();
  wireSubmit();
  wireSuccessActions();
  setMaxBirthDate();

  qs("#reg-full-name")?.focus();
}

function fillCountries() {
  const list = qs("#reg-countries");
  if (!list) return;
  list.innerHTML = COUNTRIES.map((name) => `<option value="${esc(name)}"></option>`).join("");
}

function readPlan() {
  const params = new URLSearchParams(location.search);
  const plan = (params.get("plan") || "").toLowerCase();
  const duration = params.get("duration") || "";
  if (!plan) return;
  const known = PLANS.find((entry) => entry.id === plan);
  state.plan = known ? known.id : plan;
  state.duration = duration || String(known?.durationOptions?.[0] || "");
}

function renderPlan() {
  const box = qs("[data-reg-plan]");
  if (!box) return;
  if (!state.plan) {
    box.hidden = true;
    return;
  }
  const known = PLANS.find((entry) => entry.id === state.plan);
  box.hidden = false;
  const name = qs("[data-reg-plan-name]");
  if (name) name.textContent = known ? `${known.name} — ${known.tier}` : state.plan.replace(/\b\w/g, (c) => c.toUpperCase());
  const meta = qs("[data-reg-plan-meta]");
  if (meta) {
    const price = known ? `$${known.pricePerQuarter} / 3 months` : "";
    meta.textContent = [state.duration ? `${state.duration} month${state.duration === "1" ? "" : "s"}` : "", price]
      .filter(Boolean)
      .join(" · ");
  }
}

function setMaxBirthDate() {
  const input = qs("#reg-birth");
  if (!input) return;
  const date = new Date();
  date.setFullYear(date.getFullYear() - 13);
  input.max = date.toISOString().slice(0, 10);
  input.min = "1900-01-01";
}

/* ================================================================== */
/* form helpers                                                       */
/* ================================================================== */
function field(name) {
  return qs(`[data-field="${name}"]`);
}

function setError(name, message) {
  const box = field(name);
  const node = qs(`[data-err="${name}"]`);
  if (node) {
    node.textContent = message || "";
    node.hidden = !message;
  }
  box?.classList.toggle("is-invalid", Boolean(message));
  const input = box?.querySelector("input");
  if (input) input.setAttribute("aria-invalid", message ? "true" : "false");
}

function clearErrors() {
  Object.keys(MESSAGES).forEach((name) => setError(name, ""));
  const alert = qs("[data-reg-error]");
  if (alert) alert.hidden = true;
}

function readForm() {
  const get = (name) => qs(`[name="${name}"]`)?.value ?? "";
  return {
    full_name: get("full_name").trim(),
    username: cleanUsername(get("username")),
    email: get("email").trim(),
    phone: get("phone").trim(),
    password: get("password"),
    password_confirm: get("password_confirm"),
    birth_date: get("birth_date"),
    country: get("country").trim(),
    terms: Boolean(qs("[data-terms]")?.checked),
  };
}

function isAdult(dateString) {
  if (!dateString) return false;
  const born = new Date(`${dateString}T00:00:00`);
  if (Number.isNaN(born.getTime())) return false;
  if (born.getFullYear() < 1900) return false;
  const limit = new Date();
  limit.setFullYear(limit.getFullYear() - 13);
  return born <= limit;
}

function validate(data) {
  const errors = {};

  if (data.full_name.length < 3 || !/[a-z\u00C0-\u024F]/i.test(data.full_name)) errors.full_name = MESSAGES.full_name;
  if (!/^[a-z0-9](?:[a-z0-9._-]{1,22})[a-z0-9]$/.test(data.username)) errors.username = MESSAGES.username_format;
  else if (state.availability.username === false) errors.username = MESSAGES.username_taken;
  if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(data.email)) errors.email = MESSAGES.email_format;
  else if (state.availability.email === false) errors.email = MESSAGES.email_taken;
  if (!/^\+?[0-9][0-9 ()\-]{6,19}$/.test(data.phone)) errors.phone = MESSAGES.phone;
  if (data.password.length < 8 || data.password.length > 72) errors.password = MESSAGES.password;
  if (data.password_confirm !== data.password || !data.password_confirm) errors.password_confirm = MESSAGES.password_confirm;
  if (!isAdult(data.birth_date)) errors.birth_date = MESSAGES.birth_date;
  if (data.country.length < 2) errors.country = MESSAGES.country;
  if (!data.terms) errors.terms = MESSAGES.terms;

  return errors;
}

function firstInvalid(errors) {
  return ["full_name", "username", "email", "phone", "password", "password_confirm", "birth_date", "country", "terms"].find(
    (name) => errors[name]
  );
}

function wireLiveValidation() {
  ["full_name", "phone", "birth_date", "country"].forEach((name) => {
    const input = qs(`[name="${name}"]`);
    input?.addEventListener("blur", () => {
      const data = readForm();
      const errors = validate({ ...data, password: "x".repeat(8), password_confirm: "x".repeat(8), terms: true });
      setError(name, errors[name] || "");
    });
    input?.addEventListener("input", () => setError(name, ""));
  });

  ["password", "password_confirm"].forEach((name) => {
    qs(`[name="${name}"]`)?.addEventListener("input", () => {
      setError(name, "");
      paintStrength();
      if (name === "password" && qs('[name="password_confirm"]')?.value) {
        const data = readForm();
        setError("password_confirm", data.password === data.password_confirm ? "" : MESSAGES.password_confirm);
      }
    });
  });

  qs("[data-terms]")?.addEventListener("change", () => setError("terms", ""));

  // the "@" is decoration only: the field accepts anything and the handle is
  // echoed in the hint, so nothing ever sits on top of what you type
  const handle = qs('[name="username"]');
  const preview = qs("[data-handle-preview]");
  const paintHandle = () => {
    if (!preview) return;
    const value = cleanUsername(handle?.value || "");
    preview.textContent = value ? `@${value}` : "@yourname";
  };
  handle?.addEventListener("input", paintHandle);
  paintHandle();

  ["username", "email"].forEach((name) => {
    qs(`[name="${name}"]`)?.addEventListener("input", () => {
      // the previous availability answer belongs to the previous value
      state.availability[name] = null;
      setError(name, "");
      const chip = qs(`[data-${name}-state]`);
      if (chip) chip.hidden = true;
    });
  });
}

function paintStrength() {
  const input = qs('[name="password"]');
  const wrap = qs("[data-strength]");
  const bar = qs("[data-strength-bar]");
  const label = qs("[data-strength-label]");
  if (!input || !wrap || !bar || !label) return;
  const value = input.value;
  wrap.hidden = !value;
  const score = passwordScore(value);
  bar.style.width = `${score * 25}%`;
  bar.dataset.score = String(score);
  label.textContent = ["Too short", "Weak", "Fair", "Good", "Strong"][score];
}

function passwordScore(value) {
  if (!value) return 0;
  let score = 0;
  if (value.length >= 8) score += 1;
  if (value.length >= 12) score += 1;
  if (/[A-Z]/.test(value) && /[a-z]/.test(value)) score += 1;
  if (/[0-9]/.test(value) && /[^A-Za-z0-9]/.test(value)) score += 1;
  return Math.min(score, 4);
}

function wireReveal() {
  qsa("[data-reveal]").forEach((button) => {
    button.addEventListener("click", () => {
      const name = button.dataset.reveal;
      const input = qs(`[name="${name}"]`);
      if (!input) return;
      const show = input.type === "password";
      input.type = show ? "text" : "password";
      button.setAttribute("aria-pressed", show ? "true" : "false");
      button.classList.toggle("is-on", show);
      input.focus({ preventScroll: true });
    });
  });
}

/* ================================================================== */
/* availability                                                       */
/* ================================================================== */
function wireAvailability() {
  let timer = null;
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(checkAvailability, 550);
  };
  qs('[name="username"]')?.addEventListener("blur", checkAvailability);
  qs('[name="email"]')?.addEventListener("blur", checkAvailability);
  qs('[name="username"]')?.addEventListener("input", schedule);
  qs('[name="email"]')?.addEventListener("input", schedule);
}

async function checkAvailability() {
  const username = cleanUsername(qs('[name="username"]')?.value || "");
  const email = (qs('[name="email"]')?.value || "").trim();
  if (!username && !email) return;

  let result = null;
  try {
    result = await rpc("member_check", { p_username: username || null, p_email: email || null });
  } catch {
    return; // offline: the submit call is still authoritative
  }
  if (!result || typeof result !== "object") return;

  const userNode = qs("[data-username-state]");
  const mailNode = qs("[data-email-state]");

  if (username && username === cleanUsername(qs('[name="username"]')?.value || "")) {
    state.availability.username = !result.username_taken;
    if (userNode) {
      userNode.hidden = false;
      userNode.textContent = result.username_taken ? "Taken" : "Available";
      userNode.dataset.state = result.username_taken ? "taken" : "ok";
    }
    if (result.username_taken) setError("username", MESSAGES.username_taken);
  }

  if (email) {
    state.availability.email = !result.email_taken;
    if (mailNode) {
      mailNode.hidden = false;
      mailNode.textContent = result.email_taken ? "Already registered" : "Available";
      mailNode.dataset.state = result.email_taken ? "taken" : "ok";
    }
    if (result.email_taken) setError("email", MESSAGES.email_taken);
  }
}

/* ================================================================== */
/* submit                                                             */
/* ================================================================== */
function wireSubmit() {
  const form = qs("[data-regform]");
  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (state.busy) return;

    const data = readForm();
    const errors = validate(data);
    clearErrors();
    Object.entries(errors).forEach(([name, message]) => setError(name, message));

    const first = firstInvalid(errors);
    if (first) {
      toast({ title: "Check the form", message: errors[first], tone: "error", iconName: "info" });
      playSound("error", 0.3);
      const input = qs(`[name="${first}"]`) || qs("[data-terms]");
      input?.focus();
      field(first)?.scrollIntoView?.({ block: "center", behavior: "smooth" });
      return;
    }

    await submit(data);
  });
}

async function submit(data) {
  state.busy = true;
  const button = qs("[data-reg-submit]");
  const label = qs("[data-submit-label]");
  if (button) button.disabled = true;
  if (label) label.textContent = "Creating account…";
  clearErrors();

  try {
    const result = await rpc("member_register", {
      p_full_name: data.full_name,
      p_username: data.username,
      p_email: data.email,
      p_phone: data.phone,
      p_password: data.password,
      p_birth_date: data.birth_date,
      p_country: data.country,
      p_terms: true,
    });

    if (!result || result.ok !== true) {
      const code = result?.error || "server";
      const fieldName = SERVER_FIELD[code] || "";
      const message = MESSAGES[code] || MESSAGES.server;

      if (fieldName) {
        setError(fieldName, message);
        if (fieldName === "username") state.availability.username = false;
        if (fieldName === "email") state.availability.email = false;
        qs(`[name="${fieldName === "terms" ? "terms" : fieldName}"]`)?.focus();
      }

      const alert = qs("[data-reg-error]");
      if (alert) {
        alert.hidden = false;
        const text = qs("[data-reg-error-text]");
        if (text) text.textContent = message;
      }
      toast({ title: "Could not create the account", message, tone: "error" });
      playSound("error", 0.3);
      return;
    }

    showSuccess(result);
  } catch (error) {
    console.warn("[1World] register:", error.message);
    const alert = qs("[data-reg-error]");
    if (alert) {
      alert.hidden = false;
      const text = qs("[data-reg-error-text]");
      if (text) text.textContent = MESSAGES.server;
    }
    toast({ title: "Connection problem", message: "The account was not created. Try again in a moment.", tone: "error" });
    playSound("error", 0.3);
  } finally {
    state.busy = false;
    if (button) button.disabled = false;
    if (label) label.textContent = "Create account";
  }
}

/* ================================================================== */
/* success                                                            */
/* ================================================================== */
function showSuccess(result) {
  const member = result.member || {};
  state.member = member;
  state.code = result.recovery_code || "";

  const formCard = qs("[data-reg-form]");
  const success = qs("[data-reg-success]");
  if (formCard) formCard.hidden = true;
  if (success) success.hidden = false;

  const code = qs("[data-reg-code]");
  if (code) code.textContent = state.code;

  const idNode = qs("[data-reg-member-id]");
  if (idNode) idNode.textContent = member.member_id || "—";

  const details = qs("[data-reg-details]");
  if (details) {
    const rows = [
      ["Member ID", member.member_id],
      ["Full name", member.full_name],
      ["Username", member.username],
      ["Email", member.email],
      ["Phone number", member.phone_number],
      ["Date of birth", member.birth_date ? formatDate(`${member.birth_date}T00:00:00`) : "—"],
      ["Country", member.country],
      ["Status", "Inactive"],
      ["Registered", member.created_at ? formatDate(member.created_at) : formatDate(new Date())],
    ];
    details.innerHTML = rows
      .map(([label, value]) => `<div><dt>${esc(label)}</dt><dd>${esc(value ?? "—")}</dd></div>`)
      .join("");
  }

  // the password fields are never kept around after a successful registration
  qsa('[name="password"], [name="password_confirm"]').forEach((input) => {
    input.value = "";
    input.type = "password";
  });
  const strength = qs("[data-strength]");
  if (strength) strength.hidden = true;

  hydrateIcons();
  playSound("success", 0.4);
  toast({
    title: "Registration complete",
    message: "Save your recovery code — it will not be shown again.",
    tone: "success",
    iconName: "check",
    duration: 8000,
  });

  success?.scrollIntoView?.({ block: "start", behavior: "smooth" });
  window.addEventListener("beforeunload", warnUnsaved);
}

function warnUnsaved(event) {
  if (state.saved) return undefined;
  event.preventDefault();
  event.returnValue = "";
  return "";
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

function wireSuccessActions() {
  qs("[data-reg-copy]")?.addEventListener("click", () => {
    copyValue(state.code, qs("[data-reg-copy]"), "Copy code", "[data-reg-code]");
  });

  qs("[data-reg-copy-id]")?.addEventListener("click", () => {
    copyValue(state.member?.member_id || "", qs("[data-reg-copy-id]"), "Copy ID", "[data-reg-member-id]");
  });

  qs("[data-reg-download]")?.addEventListener("click", () => {
    const text = buildTxt();
    const name = `ONEWORLD-${(state.member?.username || "account").replace(/^@/, "")}.txt`;
    downloadText(name, text);
    state.saved = true;
    toast({ title: "Details downloaded", message: "Keep the file and the recovery code safe.", tone: "success", iconName: "download" });
  });

  qs("[data-reg-login]")?.addEventListener("click", checkLogin);
}

function txtBody() {
  const m = state.member || {};
  const registered = m.created_at ? new Date(m.created_at) : new Date();
  return [
    "================================",
    "          ONEWORLD",
    "      ACCOUNT REGISTRATION",
    "================================",
    "",
    `Member ID: ${m.member_id || ""}`,
    `Full Name: ${m.full_name || ""}`,
    `Username: ${m.username || ""}`,
    `Email: ${m.email || ""}`,
    `Phone Number: ${m.phone_number || ""}`,
    `Birth Date: ${m.birth_date || ""}`,
    `Country: ${m.country || ""}`,
    "",
    `Recovery Code: ${state.code || ""}`,
    "",
    "Account Status: Inactive",
    `Registration Date: ${registered.toISOString().slice(0, 19).replace("T", " ")} UTC`,
    "",
    "================================",
    "IMPORTANT:",
    "Keep your recovery code secure.",
    "Do not share it with anyone.",
    "================================",
    "",
  ].join("\n");
}

function buildTxt() {
  return txtBody();
}

function downloadText(filename, text) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  let url = "";
  try {
    url = URL.createObjectURL(blob);
  } catch {
    url = `data:text/plain;charset=utf-8,${encodeURIComponent(text)}`;
  }
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  if (url.startsWith("blob:")) setTimeout(() => URL.revokeObjectURL(url), 2000);
}

async function checkLogin() {
  const note = qs("[data-reg-login-note]");
  const login = state.member?.username || "";
  if (!login) return;

  let status = null;
  try {
    status = await rpc("member_status", { p_login: login });
  } catch {
    status = null;
  }

  const active = status && status.found && status.status === "active";
  if (active) {
    const query = new URLSearchParams({ username: login });
    if (state.plan) query.set("plan", state.plan);
    location.href = `login.html?${query.toString()}`;
    return;
  }

  state.saved = true; // the code is no longer the only thing on screen
  if (note) {
    note.hidden = false;
    note.innerHTML = `${icon("clock")} <span>Your account is still <b>inactive</b>. You will be able to sign in as soon as it has been activated — keep your recovery code until then.</span>`;
  }
  playSound("notefcation", 0.28);
  toast({
    title: "Account not active yet",
    message: "Sign-in unlocks once the account is activated.",
    tone: "info",
    iconName: "clock",
  });
}

/* exposed only for the jsdom test */
export const __debug = { buildTxt, state };
