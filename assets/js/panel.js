/**
 * Control panel — the Platform table.
 * ------------------------------------------------------------------
 * The one page that writes `public.platform` (the table the homepage's
 * section 09 and the footer dots read). It reads every row through
 * `platform_admin_list(token)` — the server decides whether the session is
 * staff — draws them, and writes with `platform_save()` / `platform_delete()`.
 *
 * Everything on this page is a row and a dialog: no second form, no inline
 * editing that disagrees with the table. A logo is either an uploaded picture
 * (the `source` bucket, `users/platform/…`, exactly like the editors) or a
 * pasted link; the brand glyph is the fallback for both surfaces.
 *
 * The page has three honest states before it has rows: no session (sign in),
 * a session that is not staff (the desk is shut), and a table that could not be
 * read (the note says so). It never draws an empty table as if the table were
 * empty.
 */
import { rpc } from "./data.js";
import { SUPABASE, storageUrl } from "./config.js";
import { sessionToken } from "./session.js";
import { BRANDS, brand } from "./brands.js";
import { icon } from "./icons.js";
import { esc, qs, qsa } from "./utils.js";
import { toast } from "./ui.js";
import { forgetPlatforms } from "./platforms.js?v=20261116b";

/** The listeners survive a retry; only the data is fetched again. */
let bound = false;

const S = {
  rows: [],
  status: "all",
  q: "",
  editing: null,
  draft: { logo_url: "", icon: "", status: "available", sort_order: 100 },
  armed: "",
  state: "loading",
};

/* ================================================================== */
/* boot                                                               */
/* ================================================================== */
export async function initPanel() {
  const root = qs("[data-panel]");
  if (!root) return;

  fillIconOptions();
  if (!bound) {
    bindToolbar();
    bindDialog();
    bindRows();
    bound = true;
  }
  paintState("loading");
  note("");

  // the token is the only thing this page needs: the server decides the rest
  const token = sessionToken();
  if (!token) {
    paintState("signedout");
    return;
  }

  let answer = null;
  try {
    answer = await rpc("platform_admin_list", { p_token: token });
  } catch (error) {
    console.warn("[1World] platforms:", error.message || error);
    paintState("error");
    note("The table could not be reached. Check the connection and reload — nothing was changed.");
    return;
  }

  if (!answer || answer.ok !== true) {
    paintState(answer?.error === "staff" ? "locked" : "error");
    if (answer?.error !== "staff") note("The table could not be read. Reload in a moment.");
    return;
  }

  S.rows = (answer.rows || []).map(normalise).filter((r) => r.name);
  root.dataset.state = "ready";
  paintState("ready");
  paintRows();
}

function normalise(row) {
  return {
    id: String(row?.id || ""),
    code: String(row?.code || ""),
    name: String(row?.name || "").trim(),
    username: String(row?.username || "").trim(),
    url: String(row?.url || "").trim(),
    logo_url: String(row?.logo_url || "").trim(),
    icon: String(row?.icon || "").trim().toLowerCase(),
    status: String(row?.status || "available").trim().toLowerCase() === "unavailable" ? "unavailable" : "available",
    sort_order: Number(row?.sort_order ?? 100),
  };
}

/* ================================================================== */
/* states                                                             */
/* ================================================================== */
function paintState(state) {
  S.state = state;
  const root = qs("[data-panel]");
  if (root) root.dataset.state = state;

  qsa("[data-p-state]").forEach((el) => {
    el.hidden = el.dataset.pState !== state;
  });

  const bar = qs("[data-p-bar]");
  if (bar) bar.hidden = state !== "ready";
  const table = qs("[data-p-table]");
  if (table) table.hidden = state !== "ready";
}

function note(text, tone = "") {
  const el = qs("[data-p-note]");
  if (!el) return;
  el.hidden = !text;
  el.textContent = text || "";
  el.dataset.tone = tone;
}

/* ================================================================== */
/* toolbar — the filter and the search                                */
/* ================================================================== */
function bindToolbar() {
  qsa("[data-p-status]").forEach((btn) => {
    btn.addEventListener("click", () => {
      S.status = btn.dataset.pStatus || "all";
      qsa("[data-p-status]").forEach((other) => {
        const on = other === btn;
        other.classList.toggle("is-active", on);
        other.setAttribute("aria-pressed", String(on));
      });
      paintRows();
    });
  });

  const search = qs("[data-p-search]");
  search?.addEventListener("input", () => {
    S.q = search.value.trim().toLowerCase();
    paintRows();
  });

  qsa("[data-p-add]").forEach((btn) => btn.addEventListener("click", () => openEditor(null)));
}

/* ================================================================== */
/* the rows                                                           */
/* ================================================================== */
function visibleRows() {
  return S.rows.filter((row) => {
    if (S.status !== "all" && row.status !== S.status) return false;
    if (!S.q) return true;
    return `${row.name} ${row.username} ${row.code} ${row.url}`.toLowerCase().includes(S.q);
  });
}

function paintRows() {
  const list = qs("[data-p-list]");
  if (!list) return;

  const counts = {
    all: S.rows.length,
    available: S.rows.filter((r) => r.status === "available").length,
    unavailable: S.rows.filter((r) => r.status === "unavailable").length,
  };
  qsa("[data-p-count]").forEach((el) => {
    el.textContent = String(counts[el.dataset.pCount] ?? 0);
  });

  const rows = visibleRows();
  list.innerHTML = rows.map(rowMarkup).join("");

  const empty = qs("[data-p-empty]");
  const emptyTitle = qs("[data-p-empty-title]");
  const emptyText = qs("[data-p-empty-text]");
  if (empty) {
    empty.hidden = rows.length > 0;
    if (emptyTitle) emptyTitle.textContent = S.rows.length ? "Nothing matches that" : "Nothing on the shelf yet";
    if (emptyText) {
      emptyText.textContent = S.rows.length
        ? "No platform answers that search and that filter. Clear one of them, or add a new place."
        : "Add the first place — a name, the handle you follow and the link it opens. It appears on the homepage the moment it is saved.";
    }
  }
}

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function rowMarkup(row) {
  const mark = row.logo_url
    ? `<img src="${esc(row.logo_url)}" alt="" loading="lazy" decoding="async" />`
    : brand(row.icon) || icon("globe");
  const statusLabel = row.status === "available" ? "Available" : "Unavailable";

  return `
      <article class="pfrow" data-p-row data-id="${esc(row.id)}" data-status="${esc(row.status)}">
        <span class="pfrow__logo">${mark}</span>

        <span class="pfrow__place">
          <span class="pfrow__name">${esc(row.name)}</span>
          <span class="pfrow__code">${esc(row.code || "—")}</span>
        </span>

        <span class="pfrow__handle">${esc(row.username || "—")}</span>

        <a class="pfrow__link" href="${esc(row.url)}" target="_blank" rel="noopener noreferrer" title="${esc(row.url)}">
          ${icon("external")}<span>${esc(hostOf(row.url))}</span>
        </a>

        <button class="pfrow__status" type="button" data-p-toggle aria-pressed="${row.status === "available"}" title="Click to switch this platform on or off">
          <span class="pfrow__dot" aria-hidden="true"></span>${statusLabel}
        </button>

        <span class="pfrow__acts">
          <button class="icon-btn" type="button" data-p-edit aria-label="Edit ${esc(row.name)}" title="Edit">${icon("pen")}</button>
          <button class="icon-btn pfrow__danger" type="button" data-p-remove aria-label="Delete ${esc(row.name)}" title="Delete">${icon("trash")}</button>
        </span>
      </article>`;
}

/** One delegated listener: the list is repainted on every change. */
function bindRows() {
  const list = qs("[data-p-list]");
  if (!list) return;

  list.addEventListener("click", async (event) => {
    const rowEl = event.target.closest("[data-p-row]");
    if (!rowEl) return;
    const row = S.rows.find((r) => r.id === rowEl.dataset.id);
    if (!row) return;

    if (event.target.closest("[data-p-edit]")) {
      openEditor(row);
      return;
    }

    if (event.target.closest("[data-p-toggle]")) {
      const next = row.status === "available" ? "unavailable" : "available";
      await save({ ...row, status: next }, { quiet: true });
      return;
    }

    if (event.target.closest("[data-p-remove]")) {
      const button = event.target.closest("[data-p-remove]");
      if (S.armed !== row.id) {
        S.armed = row.id;
        button.classList.add("is-armed");
        button.innerHTML = `${icon("trash")}<span class="pfrow__sure">Remove?</span>`;
        setTimeout(() => {
          if (S.armed !== row.id) return;
          S.armed = "";
          button.classList.remove("is-armed");
          button.innerHTML = icon("trash");
        }, 4000);
        return;
      }
      S.armed = "";
      await remove(row);
    }
  });
}

/* ================================================================== */
/* the dialog                                                         */
/* ================================================================== */
function dialog() {
  return qs("[data-p-dialog]");
}

function fillIconOptions() {
  const select = qs("[data-p-icon]");
  if (!select) return;
  const keys = Object.keys(BRANDS).sort();
  select.innerHTML =
    `<option value="">— none —</option>` +
    keys.map((key) => `<option value="${esc(key)}">${esc(key)}</option>`).join("");
}

function field(name) {
  return qs(`[data-p-${name}]`);
}

function openEditor(row) {
  const box = dialog();
  if (!box) return;

  S.editing = row ? row.id : "";
  S.draft = {
    logo_url: row?.logo_url || "",
    icon: row?.icon || "",
    status: row?.status || "available",
    sort_order: Number(row?.sort_order ?? 100),
    uploading: false,
  };

  const title = qs("[data-p-form-title]");
  if (title) title.textContent = row ? "Edit this platform" : "Add a platform";

  field("name").value = row?.name || "";
  field("user").value = row?.username || "";
  field("url").value = row?.url || "";
  field("logo").value = row?.logo_url || "";
  field("sort").value = String(S.draft.sort_order);
  const icons = field("icon");
  if (icons) icons.value = row?.icon || "";

  setFormStatus(S.draft.status);
  paintPreview();
  clearErrors();

  const reset = qs("[data-p-reset]");
  if (reset) reset.hidden = !row;

  if (typeof box.showModal === "function") box.showModal();
  else box.setAttribute("open", "");
  setTimeout(() => field("name")?.focus(), 40);
}

function closeEditor() {
  const box = dialog();
  if (!box) return;
  if (typeof box.close === "function") box.close();
  else box.removeAttribute("open");
  S.editing = null;
}

function setFormStatus(status) {
  S.draft.status = status === "unavailable" ? "unavailable" : "available";
  qsa("[data-p-form-status]").forEach((btn) => {
    const on = btn.dataset.pFormStatus === S.draft.status;
    btn.classList.toggle("is-active", on);
    btn.setAttribute("aria-pressed", String(on));
  });
}

function paintPreview() {
  const host = qs("[data-p-preview]");
  if (!host) return;
  const logo = field("logo")?.value.trim() || S.draft.logo_url;
  if (logo) {
    host.innerHTML = `<img src="${esc(logo)}" alt="" />`;
    return;
  }
  const glyph = S.draft.icon ? brand(S.draft.icon) : "";
  host.innerHTML = glyph || icon("image");
}

function clearErrors() {
  const box = qs("[data-p-form-error]");
  if (box) {
    box.hidden = true;
    box.textContent = "";
  }
  qsa("[data-p-error]").forEach((el) => (el.hidden = true));
  qsa(".input--error").forEach((el) => el.classList.remove("input--error"));
}

function showError(code) {
  const messages = {
    name: "Give the platform a name.",
    url: "The link must start with http:// or https://.",
    logo: "The logo link must start with http:// or https://.",
    duplicate: "That name and handle are already on the shelf.",
    missing: "This row is gone — reload the page.",
    staff: "Your session is not on the staff list any more.",
    network: "The save did not reach the server. Try again.",
  };
  const text = messages[code] || "The save did not go through.";
  const box = qs("[data-p-form-error]");
  if (box) {
    box.hidden = false;
    box.textContent = text;
  }
  if (code === "name") {
    field("name")?.classList.add("input--error");
    const hint = qs('[data-p-error="name"]');
    if (hint) hint.hidden = false;
  }
  if (code === "url") {
    field("url")?.classList.add("input--error");
    const hint = qs('[data-p-error="url"]');
    if (hint) hint.hidden = false;
  }
  if (code === "logo") {
    field("logo")?.classList.add("input--error");
  }
}

function bindDialog() {
  const box = dialog();
  if (!box) return;

  qsa("[data-p-close]").forEach((btn) => btn.addEventListener("click", closeEditor));

  qsa("[data-p-form-status]").forEach((btn) => {
    btn.addEventListener("click", () => setFormStatus(btn.dataset.pFormStatus));
  });

  const icons = field("icon");
  icons?.addEventListener("change", () => {
    S.draft.icon = icons.value;
    paintPreview();
  });

  const logo = field("logo");
  logo?.addEventListener("input", () => {
    S.draft.logo_url = logo.value.trim();
    paintPreview();
  });

  const file = qs("[data-p-file]");
  const drop = qs("[data-p-drop]");
  file?.addEventListener("change", () => uploadLogo(file.files?.[0]));

  if (drop) {
    ["dragenter", "dragover"].forEach((type) =>
      drop.addEventListener(type, (event) => {
        event.preventDefault();
        drop.classList.add("is-over");
      })
    );
    ["dragleave", "drop"].forEach((type) =>
      drop.addEventListener(type, (event) => {
        event.preventDefault();
        drop.classList.remove("is-over");
      })
    );
    drop.addEventListener("drop", (event) => uploadLogo(event.dataTransfer?.files?.[0]));
  }

  qs("[data-p-reset]")?.addEventListener("click", () => openEditor(null));

  qs("[data-p-form]")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    await submit();
  });

  // clicking the backdrop closes the sheet
  box.addEventListener("click", (event) => {
    if (event.target === box) closeEditor();
  });
}

/* ================================================================== */
/* the logo, from the machine                                          */
/* ================================================================== */
const LOGO_TYPES = /^image\/(png|jpe?g|webp|gif|svg\+xml)$/;

function uploadLogo(file) {
  if (!file) return;
  if (!LOGO_TYPES.test(file.type)) {
    toast({ title: "That is not a picture", message: "PNG, JPEG, WEBP, GIF or SVG.", tone: "error" });
    return;
  }
  if (file.size > 2 * 1024 * 1024) {
    toast({ title: "Too large", message: "2 MB at most for a logo.", tone: "error" });
    return;
  }

  const drop = qs("[data-p-drop]");
  const label = qs("[data-p-drop-text]");
  const reset = () => {
    if (drop) drop.classList.remove("is-busy");
    if (label) label.textContent = "Drop a logo, or choose a file";
  };
  if (drop) drop.classList.add("is-busy");
  if (label) label.textContent = "Uploading…";

  const ext = (file.name.split(".").pop() || "png").toLowerCase().replace(/[^a-z0-9]/g, "") || "png";
  const name = `platform_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const path = `users/platform/${name}`;

  const request = new XMLHttpRequest();
  request.open("POST", `${SUPABASE.url}/storage/v1/object/source/${path}`);
  request.setRequestHeader("apikey", SUPABASE.publishableKey);
  request.setRequestHeader("Content-Type", file.type || "application/octet-stream");
  request.setRequestHeader("x-upsert", "true");

  request.onload = () => {
    reset();
    if (request.status < 200 || request.status >= 300) {
      toast({ title: "The upload was refused", message: String(request.responseText || request.status).slice(0, 120), tone: "error" });
      return;
    }
    const url = storageUrl(path);
    S.draft.logo_url = url;
    const input = field("logo");
    if (input) input.value = url;
    paintPreview();
    toast({ title: "Logo uploaded", message: "Save the platform to publish it.", tone: "success", iconName: "image" });
  };
  request.onerror = () => {
    reset();
    toast({ title: "The upload did not reach the server", message: "Try the link field instead.", tone: "error" });
  };
  request.send(file);
}

/* ================================================================== */
/* write                                                              */
/* ================================================================== */
async function submit() {
  clearErrors();
  const token = sessionToken();
  if (!token) {
    toast({ title: "Signed out", message: "Sign in again to save.", tone: "error" });
    paintState("signedout");
    closeEditor();
    return;
  }

  const draft = {
    name: field("name")?.value.trim() || "",
    username: field("user")?.value.trim() || "",
    url: field("url")?.value.trim() || "",
    logo_url: field("logo")?.value.trim() || "",
    icon: field("icon")?.value.trim() || "",
    status: S.draft.status,
    sort_order: Number(field("sort")?.value || 100),
  };

  if (!draft.name) {
    showError("name");
    field("name")?.focus();
    return;
  }
  if (draft.url && !/^https?:\/\//i.test(draft.url)) {
    showError("url");
    field("url")?.focus();
    return;
  }
  if (draft.logo_url && !/^https?:\/\//i.test(draft.logo_url)) {
    showError("logo");
    return;
  }

  const button = qs("[data-p-save]");
  if (button) {
    button.disabled = true;
    button.dataset.label = button.innerHTML;
    button.innerHTML = `${icon("clock")} Saving…`;
  }

  const answer = await save({ id: S.editing || null, ...draft });

  if (button) {
    button.disabled = false;
    if (button.dataset.label) button.innerHTML = button.dataset.label;
  }

  if (answer?.ok) {
    closeEditor();
    toast({
      title: S.editing ? "Platform updated" : "Platform added",
      message: draft.status === "available" ? "It is on the homepage now." : "Saved — hidden from the homepage.",
      tone: "success",
      iconName: "check",
    });
  }
}

/** One save path for the dialog and for the status switch. */
async function save(draft, { quiet = false } = {}) {
  const token = sessionToken();
  if (!token) return { ok: false, error: "staff" };

  let answer = null;
  try {
    answer = await rpc("platform_save", {
      p_token: token,
      p_id: draft.id || null,
      p_name: draft.name,
      p_username: draft.username,
      p_url: draft.url,
      p_logo_url: draft.logo_url,
      p_icon: draft.icon,
      p_status: draft.status,
      p_sort: Number.isFinite(draft.sort_order) ? draft.sort_order : 100,
    });
  } catch (error) {
    console.warn("[1World] platform save:", error.message || error);
    answer = { ok: false, error: "network" };
  }

  if (!answer?.ok) {
    if (quiet) {
      toast({ title: "Not saved", message: "The table refused the change.", tone: "error" });
      return answer;
    }
    showError(answer?.error || "network");
    return answer;
  }

  forgetPlatforms();
  const row = normalise(answer.row);
  const index = S.rows.findIndex((r) => r.id === row.id);
  if (index >= 0) S.rows[index] = row;
  else S.rows.push(row);
  S.rows.sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
  paintState("ready");
  paintRows();

  if (quiet) {
    toast({
      title: row.status === "available" ? "On the homepage" : "Hidden from the homepage",
      message: `${row.name} — the shelf and the footer follow.`,
      tone: "success",
      iconName: row.status === "available" ? "eye" : "lock",
    });
  }
  return answer;
}

async function remove(row) {
  const token = sessionToken();
  if (!token) return;

  let answer = null;
  try {
    answer = await rpc("platform_delete", { p_token: token, p_id: row.id });
  } catch {
    answer = { ok: false, error: "network" };
  }

  if (!answer?.ok) {
    toast({ title: "Not removed", message: "The table refused the change.", tone: "error" });
    return;
  }

  forgetPlatforms();
  S.rows = S.rows.filter((r) => r.id !== row.id);
  paintRows();
  toast({ title: "Platform removed", message: `${row.name} is gone from the shelf.`, tone: "success", iconName: "trash" });
}

/* the retry button lives outside the states it retries */
document.addEventListener("click", (event) => {
  if (event.target.closest("[data-p-retry]")) initPanel();
});
