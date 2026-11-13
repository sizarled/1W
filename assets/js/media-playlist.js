/**
 * playlist.html — a playlist of videos, podcasts or songs.
 * ------------------------------------------------------------------
 * One address per shelf, and the shelf is part of the address:
 *
 *   playlist.html#/videos/ID=playlist001032
 *   playlist.html#/podcasts/ID=playlist001032
 *   playlist.html#/songs/ID=playlist001032
 *
 * The shelf decides what a row opens: a video row goes to
 * `videos.html#/h|v/ID=…`, a podcast to `audio.html#/p/ID=…` and a song
 * to `audio.html#/m/ID=…`. Nothing about those shapes is decided here —
 * media.js hands them over.
 *
 *   playlist_get(token, ref, shelf)
 *     → { ok, playlist, rows[] }
 *     → { ok:false, error }
 *
 * A playlist that holds more than one kind says so: the shelves that are
 * empty are still drawn, greyed, so the address stays readable.
 */
import { rpc } from "./data.js";
import { qs, esc, num, clamp } from "./utils.js";
import { icon } from "./icons.js";
import { toast } from "./ui.js";
import { sessionToken } from "./session.js";
import {
  parseRoute,
  playlistUrl,
  videoUrl,
  audioUrl,
  orientationOf,
  shelfOf,
  PLAYLIST_SHELVES,
  creatorUrl,
  readParams,
} from "./media.js";

const state = {
  token: "",
  shelf: "videos",
  id: "",
  playlist: null,
  rows: [],
  error: "",
  scope: { studio: "", creator: "" },
  seq: 0,
};

const root = () => qs("[data-p-root]");
const fmt = (seconds) => {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  const m = Math.floor(total / 60);
  const s = String(total % 60).padStart(2, "0");
  return `${m}:${s}`;
};

/** The row's own address, through the address book. */
function hrefOf(row, shelf) {
  const code = row.code || row.id || "";
  const kind = String(row.kind || (PLAYLIST_SHELVES[shelf] || PLAYLIST_SHELVES.videos).kind).toLowerCase();
  if (kind === "video") return videoUrl(code, row.orientation || orientationOf(row.shape));
  if (kind === "podcast") return audioUrl(code, "p");
  if (kind === "song" || kind === "music") return audioUrl(code, "m");
  return playlistUrl(code, shelf);
}

function rowMarkup(row, shelf, index) {
  const href = hrefOf(row, shelf);
  const kind = String(row.kind || (PLAYLIST_SHELVES[shelf] || PLAYLIST_SHELVES.videos).kind);
  const portrait = kind === "video" && orientationOf(row.orientation || row.shape) === "v";
  return `
    <li class="plq__row" data-p-row="${esc(row.code || row.id || "")}">
      <span class="plq__index">${esc(String(index + 1).padStart(2, "0"))}</span>
      <a class="plq__link" href="${esc(href)}" data-p-open="${esc(row.code || row.id || "")}">
        <span class="plq__thumb${row.thumbnail || row.cover ? "" : " is-plain"}"${row.thumbnail || row.cover ? ` style="background-image:url('${esc(row.thumbnail || row.cover)}')"` : ""}>
          ${row.thumbnail || row.cover ? "" : icon(kind === "video" ? "film" : kind === "podcast" ? "mic" : "music")}
          ${kind === "video" ? `<span class="plq__shape" data-shape="${portrait ? "v" : "h"}">${portrait ? "9:16" : "16:9"}</span>` : ""}
        </span>
        <span class="plq__text">
          <span class="plq__title">${esc(row.title || "Untitled")}</span>
          <span class="plq__meta">
            ${esc(kind === "video" ? "Video" : kind === "podcast" ? "Podcast" : "Song")}
            ${row.minutes ? ` · ${esc(num(row.minutes))} min` : ""}
            ${row.visibility && row.visibility !== "public" ? ` · ${esc(row.visibility)}` : ""}
          </span>
        </span>
        <span class="plq__time">${row.minutes ? fmt((Number(row.minutes) || 0) * 60) : ""}</span>
      </a>
    </li>`;
}

function shelvesMarkup() {
  return `
    <div class="plq__shelves" role="tablist" aria-label="What is on the playlist">
      ${Object.values(PLAYLIST_SHELVES)
        .map(
          (shelf) => `
        <a class="plq__shelf${state.shelf === shelf.key ? " is-on" : ""}" role="tab" aria-selected="${state.shelf === shelf.key}"
           href="${esc(playlistUrl(state.id, shelf.key))}" data-p-shelf="${esc(shelf.key)}">
          ${icon(shelf.key === "videos" ? "film" : shelf.key === "podcasts" ? "mic" : "music")} ${esc(shelf.label)}
        </a>`
        )
        .join("")}
    </div>`;
}

function paint() {
  const host = root();
  if (!host) return;
  const shelfInfo = PLAYLIST_SHELVES[state.shelf] || PLAYLIST_SHELVES.videos;

  if (state.error) {
    host.innerHTML = `
      <div class="aud__empty">
        <span class="aud__empty-icon">${icon("bookmark")}</span>
        <h1 class="aud__empty-title">${state.error === "not_found" ? "That playlist is gone" : "The playlist did not load"}</h1>
        <p class="aud__empty-text">${
          state.error === "not_found"
            ? "The link may be old, or the creator took it down."
            : "The server is not reachable from here. Try again in a moment."
        }</p>
        <div class="aud__empty-acts">
          <a class="btn btn--primary btn--sm" href="videos.html">${icon("film")} Videos</a>
          <a class="btn btn--ghost btn--sm" href="index.html">${icon("home")} Home</a>
        </div>
      </div>`;
    return;
  }
  if (!state.playlist) return;

  const list = state.playlist;
  const creator = list.creator || list.creator_name || state.scope.creator || "";
  const creatorId = list.creator_id || state.scope.creator || "";
  const hubCode = (list.hub && list.hub.code) || state.scope.studio || "";
  const total = state.rows.reduce((sum, row) => sum + (Number(row.minutes) || 0), 0);
  const cover = list.cover || list.thumbnail || "";

  host.innerHTML = `
    <nav class="aud__back">
      <a href="videos.html">${icon("arrowLeft")} All videos</a>
      <span class="aud__crumb">Playlist</span>
    </nav>

    <header class="plq__hero">
      <span class="plq__cover${cover ? "" : " is-plain"}"${cover ? ` style="background-image:url('${esc(cover)}')"` : ""}>${cover ? "" : icon("bookmark")}</span>
      <div class="plq__id">
        <p class="aud__kind">${icon("bookmark")} Playlist<span class="aud__vis">${esc(shelfInfo.label)}</span></p>
        <h1 class="plq__title" data-p-title>${esc(list.title || "Playlist")}</h1>
        ${
          creator
            ? `<p class="aud__byline">${icon("user")} ${
                creatorId || hubCode
                  ? `<a href="${esc(creatorUrl(hubCode, creatorId))}">${esc(creator)}</a>`
                  : `<span>${esc(creator)}</span>`
              }${hubCode ? `<span class="aud__hub-code">${esc(hubCode)}</span>` : ""}</p>`
            : ""
        }
        <div class="plq__meta">
          <span class="cr-pill">${icon("file")}${esc(num(state.rows.length))} ${esc(shelfInfo.label.toLowerCase())}</span>
          ${total ? `<span class="cr-pill">${icon("clock")}${esc(num(total))} min</span>` : ""}
          ${list.visibility && list.visibility !== "public" ? `<span class="cr-pill">${icon("lock")}${esc(list.visibility)}</span>` : ""}
        </div>
        ${list.summary ? `<p class="plq__summary">${esc(list.summary)}</p>` : ""}
      </div>
    </header>

    ${shelvesMarkup()}

    ${
      state.rows.length
        ? `<ol class="plq__list">${state.rows.map((row, index) => rowMarkup(row, state.shelf, index)).join("")}</ol>`
        : `<div class="plq__none">
             <span class="plq__none-icon">${icon("listBullet")}</span>
             <p>Nothing on the ${esc(shelfInfo.label.toLowerCase())} shelf yet. The other shelves are one tap away.</p>
           </div>`
    }`;
}

async function load() {
  const route = parseRoute(location.hash);
  const shelf = route.surface === "playlist" ? shelfOf(route.shelf || route.key) : "videos";
  state.shelf = shelf;
  state.id = route.id || "";
  state.playlist = null;
  state.rows = [];
  state.error = "";

  if (!state.id) {
    const host = root();
    if (host) {
      host.innerHTML = `
        <div class="aud__empty">
          <span class="aud__empty-icon">${icon("bookmark")}</span>
          <h1 class="aud__empty-title">Open a playlist</h1>
          <p class="aud__empty-text">A playlist has one address per shelf — <code>playlist.html#/videos/ID=&lt;playlist&gt;</code>, <code>#/podcasts/…</code>, <code>#/songs/…</code>.</p>
        </div>`;
    }
    document.title = "Playlist — 1World Web";
    return;
  }

  const host = root();
  if (host) host.innerHTML = `<div class="aud__skeleton" aria-hidden="true"><span class="aud__sk-cover"></span><div class="aud__sk-lines"><span></span><span></span><span></span></div></div>`;

  state.seq += 1;
  const mine = state.seq;
  let res = null;
  try {
    res = await rpc("playlist_get", { p_token: state.token, p_ref: state.id, p_shelf: shelf });
  } catch (error) {
    console.warn("[1World] playlist:", error.message);
  }
  if (mine !== state.seq) return;

  if (!res || res.ok !== true) {
    state.error = (res && res.error) || "server";
    paint();
    return;
  }

  state.playlist = res.playlist || null;
  state.rows = Array.isArray(res.rows) ? res.rows : [];
  if (!state.playlist) {
    state.error = "not_found";
    paint();
    return;
  }
  document.title = `${state.playlist.title || "Playlist"} — 1World Web`;
  paint();
}

/* ------------------------------------------------------------------ */
/* events                                                             */
/* ------------------------------------------------------------------ */
document.addEventListener("click", (event) => {
  /* the shelves are links, so a middle click still opens the other shelf in
     a tab; here we only keep the page from reloading for a plain click */
  const shelf = event.target.closest("[data-p-shelf]");
  if (shelf && !event.metaKey && !event.ctrlKey && !event.shiftKey) {
    event.preventDefault();
    location.hash = shelf.getAttribute("href").split("#")[1] || "";
    return;
  }
  if (event.target.closest("[data-p-open]") && !event.metaKey && !event.ctrlKey && !event.shiftKey) {
    /* a row is a normal link: the browser does the work, and the address is
       already the one media.js gave it */
    return;
  }
});

window.addEventListener("hashchange", () => load());

async function boot() {
  state.token = sessionToken() || "";
  state.scope = readParams(location.search);
  await load();
}

boot();
