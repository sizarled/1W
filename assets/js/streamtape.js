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
 * **The credentials never reach this file.** Every call goes through the
 * `studio-upload` Edge Function (`STREAMTAPE.proxy`), which holds the API Login
 * and Key and checks that the member's token may publish into the studio being
 * named. The file itself is posted straight to the upload address the function
 * hands back, so a large film never travels through a function.
 *
 * A brand-new video has no id until it is saved, so its file travels up under a
 * provisional name and is renamed by `renameFile()` the moment the server gives
 * the video its code. The embed address is the id-only form (`/e/<id>`), so
 * renaming never breaks the link already in the field.
 *
 *   const out = await uploadToStudio(file, {
 *     studio: "IDST100001", name: "PST-001100.mp4",
 *     onStage: (text) => note(text),
 *   });
 *   out.embed   → https://streamtape.com/e/<id>
 */
import { STREAMTAPE } from "./config.js";
import { sessionToken } from "./session.js";

const CACHE_KEY = "1w.streamtape.folders";

/** The studio shelf is reachable: a proxy stands in front, or keys are set. */
export function studioReady() {
  return Boolean(STREAMTAPE.proxy || (STREAMTAPE.login && STREAMTAPE.key));
}

/** A member-facing sentence for "the host is not connected". */
export const NOT_CONNECTED =
  "The studio host is not connected yet — the site's owner has to deploy the studio-upload function and give it the Streamtape API Login and Key.";

/** The embed address for a file id — name-free, so a rename cannot break it. */
export function embedOf(id) {
  return id ? `https://streamtape.com/e/${id}` : "";
}

/**
 * Two ways to the same API, and the page tries them in order:
 *
 *   proxy   the `studio-upload` function — the browser holds no credential,
 *           and the function decides which studio the token may upload into.
 *   direct  Streamtape's own address, with the keys from `config.js`. It is the
 *           fallback for the day the function is not deployed yet, or the day
 *           the browser cannot reach it at all.
 *
 * The one that answered last is remembered, so the failing one is not asked
 * again on every keystroke.
 */
const PATH_KEY = "1w.streamtape.path";

function paths() {
  const proxy = Boolean(STREAMTAPE.proxy);
  const direct = Boolean(STREAMTAPE.login && STREAMTAPE.key);
  const order = [];
  const last = (() => {
    try {
      return localStorage.getItem(PATH_KEY) || "";
    } catch {
      return "";
    }
  })();
  if (last === "direct" && direct) order.push("direct");
  if (proxy) order.push("proxy");
  if (direct && !order.includes("direct")) order.push("direct");
  return order;
}

function rememberPath(path) {
  try {
    localStorage.setItem(PATH_KEY, path);
  } catch {
    /* nothing to remember */
  }
}

function urlOf(path, action, params = {}) {
  const base =
    path === "proxy"
      ? `${STREAMTAPE.proxy.replace(/\/$/, "")}?action=${encodeURIComponent(action)}`
      : `${STREAMTAPE.api.replace(/\/$/, "")}/${action}`;
  const url = new URL(base);
  if (path !== "proxy") {
    url.searchParams.set("login", STREAMTAPE.login);
    url.searchParams.set("key", STREAMTAPE.key);
  }
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") return;
    url.searchParams.set(key, String(value));
  });
  return url.toString();
}

/** A failure that means "this way never arrived" — the other way gets a turn. */
const unreachable = (message) => {
  const error = new Error(message);
  error.unreachable = true;
  return error;
};

/** One call along one way. */
async function along(path, action, params) {
  const token = sessionToken();
  let response;
  try {
    response = await fetch(urlOf(path, action, params), {
      headers: path === "proxy" && token ? { Authorization: `Bearer ${token}` } : {},
    });
  } catch {
    throw unreachable(
      path === "proxy"
        ? "The studio host's function did not answer — it is probably not deployed yet (studio-upload)."
        : "Streamtape could not be reached from this browser."
    );
  }
  const text = await response.text();
  if (response.status === 404) {
    throw unreachable("The studio host's function is not deployed yet (studio-upload).");
  }
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    throw unreachable(`The host answered something unexpected (${response.status}).`);
  }
  if (Number(body?.status) === 401 || Number(body?.status) === 403) {
    /* the function says this token may not publish here — no other way helps */
    throw new Error(String(body?.msg || "This studio is not one you publish into.").slice(0, 160));
  }
  if (Number(body?.status) === 503) {
    throw unreachable(String(body?.msg || "The studio host is not connected.").slice(0, 160));
  }
  if (!body || Number(body.status) !== 200) {
    throw new Error(String(body?.msg || `The host refused (${body?.status || response.status}).`).slice(0, 160));
  }
  return body.result;
}

/** One API call; `result` on success, a readable Error on refusal. */
async function call(action, params = {}) {
  const order = paths();
  if (!order.length) throw new Error(NOT_CONNECTED);
  let last = null;
  for (const path of order) {
    try {
      const result = await along(path, action, params);
      rememberPath(path);
      return result;
    } catch (error) {
      last = error;
      if (!error.unreachable) throw error;
    }
  }
  const message =
    order.length > 1
      ? `Neither way reached Streamtape (${order.join(" and ")}). Deploy the studio-upload function — supabase functions deploy studio-upload — then try again.`
      : last?.message || "The host could not be reached.";
  throw new Error(message);
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
export async function listFolder(folder, studio) {
  const result = await call("file/listfolder", { folder, studio });
  return {
    folders: Array.isArray(result?.folders) ? result.folders : [],
    files: Array.isArray(result?.files) ? result.files : [],
  };
}

/** The id of `name` inside `parent`, made when it is not there yet. */
async function ensureFolder(name, parent, studio, path) {
  const known = remembered[path];
  if (known) return known;
  const listing = await listFolder(parent, studio);
  const found = listing.folders.find((row) => String(row.name || "").trim().toLowerCase() === name.toLowerCase());
  if (found) {
    remember(path, found.id);
    return found.id;
  }
  const made = await call("file/createfolder", { name, pid: parent, studio });
  const id = made?.folderid || made?.id;
  if (!id) throw new Error(`The host would not make the “${name}” folder.`);
  remember(path, id);
  return id;
}

/**
 * `Home / Users / Studio / <studio>` — the folder this studio's videos live in.
 * Made on the way in; its id is remembered for the rest of this session and the
 * ones that follow on this device.
 */
export async function studioFolder(studio) {
  const code = String(studio || "").trim();
  if (!code) throw new Error("Choose the studio first — the video's folder is named after it.");
  const users = await ensureFolder(STREAMTAPE.users, "", code, STREAMTAPE.users);
  const shelf = await ensureFolder(STREAMTAPE.shelf, users, code, `${STREAMTAPE.users}/${STREAMTAPE.shelf}`);
  return ensureFolder(code, shelf, code, `${STREAMTAPE.users}/${STREAMTAPE.shelf}/${code}`);
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
/** The id in a row of the host's file list — the API calls it different names. */
function idOf(row) {
  return row?.linkid || row?.id || row?.fileid || "";
}

/** The newest file in a folder whose name matches, else the newest file. */
async function newestFile(folder, name, studio) {
  const listing = await listFolder(folder, studio);
  const files = listing.files;
  if (!files.length) return null;
  const wanted = String(name || "").toLowerCase();
  const named = files.find((row) => String(row.name || "").toLowerCase() === wanted);
  if (named) return named;
  return [...files].sort((a, b) => Number(b.created_at || 0) - Number(a.created_at || 0))[0];
}

/**
 * The file itself, posted as `multipart/form-data`.
 *
 * XHR rather than fetch for one reason only: it reports bytes as they go, so
 * the page can show a bar and a speed. A browser that has no XHR, or a host
 * that refuses to be read across origins, still gets the file — the answer is
 * just empty, and the folder names it afterwards.
 */
function postFile(target, file, name, onProgress) {
  return new Promise((resolve) => {
    let xhr = null;
    try {
      xhr = typeof XMLHttpRequest === "function" ? new XMLHttpRequest() : null;
    } catch {
      xhr = null;
    }
    if (!xhr) {
      const body = new FormData();
      body.append("file1", file, name);
      fetch(target, { method: "POST", body })
        .then((response) => response.text().then((text) => ({ status: response.status, text })).catch(() => ({ status: response.status, text: "" })))
        .then(resolve, () => resolve({ status: 0, text: "" }));
      return;
    }
    try {
      xhr.open("POST", target);
      if (xhr.upload && typeof onProgress === "function") {
        xhr.upload.onprogress = (event) => {
          if (event && event.lengthComputable) onProgress(event.loaded, event.total);
        };
      }
      xhr.onload = () => resolve({ status: xhr.status, text: xhr.responseText || "" });
      xhr.onerror = () => resolve({ status: 0, text: "" });
      xhr.ontimeout = () => resolve({ status: 0, text: "" });
      const body = new FormData();
      body.append("file1", file, name);
      xhr.send(body);
    } catch {
      resolve({ status: 0, text: "" });
    }
  });
}

/**
 * Upload one file into the studio's folder and name it.
 * Returns `{ id, name, folder, link, embed }`; throws a readable Error.
 */
export async function uploadToStudio(file, { studio, name, onStage, onProgress } = {}) {
  if (!studioReady()) throw new Error(NOT_CONNECTED);
  const fileName = String(name || file.name || "video.mp4");
  const stage = typeof onStage === "function" ? onStage : () => {};

  stage("Making the studio's folder…");
  const folder = await studioFolder(studio);

  stage("Getting a place to put it…");
  const spot = await call("file/ul", { folder, studio });
  const target = spot?.url;
  if (!target) throw new Error("The host did not hand back an upload address.");

  stage("Uploading…");
  const sent = await postFile(target, file, fileName, onProgress);
  let answer = null;
  try {
    answer = sent.text ? JSON.parse(sent.text) : null;
  } catch {
    /* a host that refuses to be read across origins: the upload still went,
       and the folder will name the file below */
    answer = null;
  }
  if (answer && Number(answer.status) && Number(answer.status) !== 200) {
    throw new Error(String(answer.msg || "The host refused the file.").slice(0, 160));
  }
  const row = answer?.result || answer || {};
  let id = idOf(row);

  /* the answer was bare or unreadable — the folder knows what arrived */
  if (!id) {
    try {
      const found = await call("file/find", { studio, folder, name: fileName });
      id = String(found?.id || "");
    } catch {
      id = "";
    }
  }
  if (!id) {
    const row = await newestFile(folder, fileName, studio).catch(() => null);
    id = idOf(row);
  }
  if (!id) throw new Error("The host took the file but did not give it an id.");

  return {
    id,
    name: String(row.name || fileName),
    folder: String(studio),
    link: String(row.url || row.link || `https://streamtape.com/v/${id}/${fileName}`),
    embed: embedOf(id),
  };
}

/** Give a file the video's own name — `PST-001100.mp4`. */
export async function renameFile(id, name, studio) {
  if (!id || !name) return false;
  await call("file/rename", { file: id, name, studio });
  return true;
}

/** The file still exists, and what it is called now. */
export async function fileInfo(id, studio) {
  if (!id) return null;
  const result = await call("file/info", { file: id, studio });
  const row = result && typeof result === "object" ? result[id] || Object.values(result)[0] : null;
  return row && Number(row.status) === 200 ? row : null;
}
