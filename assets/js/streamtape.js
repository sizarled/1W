/**
 * streamtape.js — the host a studio's video files live on.
 * ------------------------------------------------------------------
 * A video uploaded in the editor while a studio is chosen is not kept in the
 * site's storage: it is sent to Streamtape, and the tree it lands in is the
 * one the account uses for studios:
 *
 *   Home
 *     └ Users
 *         └ Studio
 *             └ <studio code>          e.g. IDST100001
 *                 └ <video code>.mp4   e.g. PST-001100.mp4
 *
 * The folder is made on the way in — `Users` and `Studio` once, the studio's
 * own folder the first time that studio uploads — and their ids are remembered
 * on this device so a second upload is three calls shorter.
 *
 * The file is renamed the moment the video gets its code: a brand-new video
 * has no id until it is saved, so it travels up under a provisional name and
 * is renamed by `renameFile()` afterwards. The embed address is the id-only
 * form (`/e/<id>`), so renaming never breaks the link already in the field.
 *
 * Nothing here decides *whether* to use the host — the editor asks for that.
 * This module only speaks Streamtape's API and hands back an id and a link.
 *
 *   const out = await uploadToStudio(file, {
 *     studio: "IDST100001", name: "PST-001100.mp4",
 *     onStage: (text) => note(text),
 *   });
 *   out.embed   → https://streamtape.com/e/<id>
 */
import { STREAMTAPE } from "./config.js";

const CACHE_KEY = "1w.streamtape.folders";

/**
 * The studio shelf is reachable: a credential is set, or a proxy stands in
 * front. One half of the pair is enough to try — the host answers a 403 of its
 * own when the login is missing, and that answer is worth more than a guess
 * made here.
 */
export function studioReady() {
  if (STREAMTAPE.proxy) return true;
  return Boolean(STREAMTAPE.login || STREAMTAPE.key);
}

/** A member-facing sentence for "the host is not connected". */
export const NOT_CONNECTED =
  "The studio host is not connected yet — an owner has to set the Streamtape API Login and Key in config.js.";

/** The embed address for a file id — name-free, so a rename cannot break it. */
export function embedOf(id) {
  return id ? `https://streamtape.com/e/${id}` : "";
}

function urlOf(action, params = {}) {
  const base = STREAMTAPE.proxy ? `${STREAMTAPE.proxy.replace(/\/$/, "")}?action=${encodeURIComponent(action)}` : `${STREAMTAPE.api.replace(/\/$/, "")}/${action}`;
  const url = new URL(base);
  if (STREAMTAPE.login) url.searchParams.set("login", STREAMTAPE.login);
  if (STREAMTAPE.key) url.searchParams.set("key", STREAMTAPE.key);
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") return;
    url.searchParams.set(key, String(value));
  });
  return url.toString();
}

/** One API call; `result` on success, a readable Error on refusal. */
async function call(action, params = {}) {
  let response;
  try {
    response = await fetch(urlOf(action, params));
  } catch {
    throw new Error("The host could not be reached — check the connection and try again.");
  }
  const text = await response.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`The host answered something unexpected (${response.status}).`);
  }
  if (!body || Number(body.status) !== 200) {
    throw new Error(String(body?.msg || `The host refused (${body?.status || response.status}).`).slice(0, 160));
  }
  return body.result;
}

/* ------------------------------------------------------------------ */
/* folders                                                            */
/* ------------------------------------------------------------------ */
const remembered = (() => {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    const value = raw ? JSON.parse(raw) : {};
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
})();

function remember(path, id) {
  remembered[path] = id;
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(remembered));
  } catch {
    /* a full or blocked store is not a reason to fail an upload */
  }
}

/** The folders and files inside one folder — root when no id is given. */
export async function listFolder(folder = "") {
  const result = await call("file/listfolder", { folder });
  return {
    folders: Array.isArray(result?.folders) ? result.folders : [],
    files: Array.isArray(result?.files) ? result.files : [],
  };
}

/** The id of `name` inside `parent`, made when it is not there yet. */
async function ensureFolder(name, parent, path) {
  const known = remembered[path];
  if (known) return known;
  const listing = await listFolder(parent);
  const found = listing.folders.find((row) => String(row.name || "").trim().toLowerCase() === name.toLowerCase());
  if (found) {
    remember(path, found.id);
    return found.id;
  }
  const made = await call("file/createfolder", { name, pid: parent });
  const id = made?.folderid || made?.id;
  if (!id) throw new Error(`The host would not make the “${name}” folder.`);
  remember(path, id);
  return id;
}

/**
 * `Home / Users / Studio / <studio>` — the folder this studio's videos live in.
 * Made on the way in; its id is remembered for the rest of the session and the
 * next ones on this device.
 */
export async function studioFolder(studio) {
  const code = String(studio || "").trim();
  if (!code) throw new Error("Choose the studio first — the video's folder is named after it.");
  const users = await ensureFolder(STREAMTAPE.users, "", STREAMTAPE.users);
  const shelf = await ensureFolder(STREAMTAPE.shelf, users, `${STREAMTAPE.users}/${STREAMTAPE.shelf}`);
  return ensureFolder(code, shelf, `${STREAMTAPE.users}/${STREAMTAPE.shelf}/${code}`);
}

/** Forget where the folders were — used when an id turns out to be stale. */
export function forgetFolders() {
  Object.keys(remembered).forEach((key) => delete remembered[key]);
  try {
    localStorage.removeItem(CACHE_KEY);
  } catch {
    /* nothing to forget */
  }
}

/* ------------------------------------------------------------------ */
/* files                                                              */
/* ------------------------------------------------------------------ */
/** The newest file in a folder whose name matches, else the newest file. */
async function newestFile(folder, name) {
  const listing = await listFolder(folder);
  const files = listing.files;
  if (!files.length) return null;
  const wanted = String(name || "").toLowerCase();
  const named = files.find((row) => String(row.name || "").toLowerCase() === wanted);
  if (named) return named;
  return [...files].sort((a, b) => Number(b.created_at || 0) - Number(a.created_at || 0))[0];
}

/** The id in a row of the host's file list — the API calls it different names. */
function idOf(row) {
  return row?.linkid || row?.id || row?.fileid || "";
}

/**
 * Upload one file into the studio's folder and name it.
 * Returns `{ id, name, folder, link, embed }`; throws a readable Error.
 */
export async function uploadToStudio(file, { studio, name, onStage } = {}) {
  if (!studioReady()) throw new Error(NOT_CONNECTED);
  const fileName = String(name || file.name || "video.mp4");
  const stage = typeof onStage === "function" ? onStage : () => {};

  stage("Making the studio's folder…");
  const folder = await studioFolder(studio);

  stage("Getting a place to put it…");
  let target = urlOf("file/upload", { folder, name: fileName });
  if (!STREAMTAPE.proxy) {
    const spot = await call("file/ul", { folder });
    target = spot?.url;
    if (!target) throw new Error("The host did not hand back an upload address.");
  }

  const body = new FormData();
  body.append("file1", file, fileName);

  stage("Uploading…");
  let answer = null;
  try {
    const response = await fetch(target, { method: "POST", body });
    answer = await response.json().catch(() => null);
  } catch {
    throw new Error("The upload broke off — check the connection and try again.");
  }
  if (answer && Number(answer.status) && Number(answer.status) !== 200) {
    throw new Error(String(answer.msg || "The host refused the file.").slice(0, 160));
  }
  const sent = answer?.result || answer || {};
  let id = idOf(sent);

  /* some answers carry only a link; the folder's own list names the file */
  if (!id) {
    const row = await newestFile(folder, fileName);
    id = idOf(row);
  }
  if (!id) throw new Error("The host took the file but did not give it an id.");

  return {
    id,
    name: String(sent.name || fileName),
    folder: String(studio),
    link: String(sent.url || sent.link || `https://streamtape.com/v/${id}/${fileName}`),
    embed: embedOf(id),
  };
}

/** Give a file the video's own name — `PST-001100.mp4`. */
export async function renameFile(id, name) {
  if (!id || !name) return false;
  await call("file/rename", { file: id, name });
  return true;
}

/** The file still exists, and what it is called now. */
export async function fileInfo(id) {
  if (!id) return null;
  const result = await call("file/info", { file: id });
  const row = result && typeof result === "object" ? result[id] || Object.values(result)[0] : null;
  return row && Number(row.status) === 200 ? row : null;
}
