/**
 * audio.html — one podcast, one song.
 * ------------------------------------------------------------------
 * The page has exactly two addresses, and media.js is the only place
 * that spells them:
 *
 *   audio.html#/p/ID=podcast001032    a podcast
 *   audio.html#/m/ID=song001032       a song
 *
 * `p` and `m` are the kinds; the id after `ID=` is the item's code. The
 * hash is the state: opening the page on either address paints the same
 * page with the right kind, and a `hashchange` re-reads it without a
 * reload.
 *
 * The server gives one call:
 *
 *   audio_get(token, ref, kind)
 *     → { ok, item, queue, hub }   the thing, what plays next, and the hub
 *                                  it belongs to (so the byline can name it)
 *     → { ok:false, error }        not_found | locked | server
 *
 * A locked item still shows its cover and its name: the gate asks for the
 * password instead of pretending the page is empty.
 */
import { rpc } from "./data.js";
import { qs, esc, num, clamp } from "./utils.js";
import { icon } from "./icons.js";
import { toast } from "./ui.js";
import { sessionToken } from "./session.js";
import { parseRoute, audioUrl, AUDIO_KINDS, creatorUrl, readParams } from "./media.js";
import { gateNeed, mountGate } from "./gates.js";

const state = {
  token: "",
  key: "p",
  kind: "podcast",
  id: "",
  item: null,
  gateNote: "",
  queue: [],
  hub: null,
  scope: { studio: "", creator: "" },
  error: "",
  locked: false,
  playing: false,
  duration: 0,
  current: 0,
  volume: 0.8,
  muted: false,
  seq: 0,
};

const root = () => qs("[data-a-root]");
const audioEl = () => qs("[data-a-media]");

const fmt = (seconds) => {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
};

/* ------------------------------------------------------------------ */
/* markup                                                             */
/* ------------------------------------------------------------------ */
function errorMarkup(title, text) {
  return `
    <div class="aud__empty">
      <span class="aud__empty-icon">${icon("music")}</span>
      <h1 class="aud__empty-title">${esc(title)}</h1>
      <p class="aud__empty-text">${esc(text)}</p>
      <div class="aud__empty-acts">
        <a class="btn btn--primary btn--sm" href="videos.html">${icon("film")} Videos</a>
        <a class="btn btn--ghost btn--sm" href="index.html">${icon("home")} Home</a>
      </div>
    </div>`;
}

function coverMarkup(item, kindInfo) {
  const cover = item.cover || item.thumbnail || item.image || "";
  return cover
    ? `<img class="aud__cover" src="${esc(cover)}" alt="" loading="lazy" />`
    : `<span class="aud__cover is-plain" aria-hidden="true">${icon(kindInfo.icon)}</span>`;
}

function byline(item) {
  const hub = state.hub || {};
  const creator = item.creator || item.creator_name || hub.owner || "";
  const creatorId = item.creator_id || hub.owner || state.scope.creator || "";
  const name = esc(creator || "A member");
  const link = creatorId ? creatorUrl(hub.code || state.scope.studio, creatorId) : "";
  const hubLink = hub.code ? creatorUrl(hub.code, creatorId) : "";
  return `
    <p class="aud__byline">
      ${icon("user")}
      ${link ? `<a href="${esc(link)}">${name}</a>` : `<span>${name}</span>`}
      ${
        hub.name
          ? `<span class="aud__byline-dot" aria-hidden="true"></span>
             <a href="${esc(hubLink)}" class="aud__hub">${esc(hub.name)}</a>
             ${hub.code ? `<span class="aud__hub-code">${esc(hub.code)}</span>` : ""}`
          : ""
      }
    </p>`;
}

function rowMarkup(row) {
  const kind = String(row.kind || state.kind);
  const code = row.code || row.id || "";
  const href = kind === "podcast" || kind === "song" ? audioUrl(code, kind === "podcast" ? "p" : "m") : audioUrl(code, state.key);
  const current = code === state.id;
  return `
    <li class="audq__row${current ? " is-on" : ""}">
      <a class="audq__link" href="${esc(href)}" data-a-open="${esc(code)}">
        <span class="audq__sign">${icon(current && state.playing ? "volume" : "play")}</span>
        <span class="audq__text">
          <span class="audq__title">${esc(row.title || "Untitled")}</span>
          <span class="audq__meta">${esc(String(kind === "song" ? "Song" : "Podcast"))}${row.minutes ? ` · ${esc(num(row.minutes))} min` : ""}</span>
        </span>
        <span class="audq__time">${row.minutes ? fmt((Number(row.minutes) || 0) * 60) : ""}</span>
      </a>
    </li>`;
}

function podcastPlayerSource(input) {
  const raw = String(input || "").trim();
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    const tape = url.pathname.match(/^\/(?:e|v)\/([\w-]+)/i);
    if ((host === "streamtape.com" || host === "streamtape.to" || host.endsWith(".tapecontent.net")) && tape) {
      return { kind: "embed", url: `https://streamtape.com/e/${encodeURIComponent(tape[1])}` };
    }
    const spotify = url.pathname.match(/^\/(episode|show)\/([\w]+)/i);
    if (host === "open.spotify.com" && spotify) {
      return { kind: "embed", url: `https://open.spotify.com/embed/${spotify[1]}/${spotify[2]}?utm_source=generator&theme=0` };
    }
    if (host === "podcasts.apple.com") {
      const show = url.pathname.match(/\/id(\d+)/i);
      if (show) {
        const episode = url.searchParams.get("i");
        const region = url.pathname.match(/^\/([a-z]{2})\//i)?.[1] || "us";
        return { kind: "embed", url: `https://embed.podcasts.apple.com/${region}/podcast/id${show[1]}${episode ? `?i=${encodeURIComponent(episode)}&theme=auto` : "?theme=auto"}` };
      }
    }
    if (host === "soundcloud.com") {
      return { kind: "embed", url: `https://w.soundcloud.com/player/?url=${encodeURIComponent(url.href)}&color=%23ffffff&auto_play=false&hide_related=true&show_comments=false&show_reposts=false&visual=false` };
    }
    if (/\.(mp4|webm|mov|ogv)(\?|#|$)/i.test(url.href)) return { kind: "video", url: url.href };
    if (/\.(mp3|wav|m4a|ogg|oga|opus|flac|aac)(\?|#|$)/i.test(url.href)) return { kind: "audio", url: url.href };
    return { kind: "link", url: url.href };
  } catch {
    return { kind: "none", url: "" };
  }
}

function playerMarkup(item, kindInfo) {
  const src = item.media_url || item.audio || item.src || "";
  const source = podcastPlayerSource(src);
  const meta = item.meta && typeof item.meta === "object" ? item.meta : {};
  const showName = String(meta.show_name || "").trim();
  const knownDuration = Number(meta.duration_seconds) || (Number(item.minutes) || 0) * 60;
  const episodeLabel = [meta.season != null ? `Season ${meta.season}` : "", meta.episode != null ? `Episode ${meta.episode}` : "", knownDuration ? fmt(knownDuration) : ""].filter(Boolean).join(" · ");
  const locked = Boolean(item.locked) || state.locked;
  return `
    <section class="aud__card" data-a-card data-kind="${esc(state.key)}">
      ${coverMarkup(item, kindInfo)}
      <div class="aud__body">
        <p class="aud__kind">${icon(kindInfo.icon)} ${esc(kindInfo.label)}${item.visibility ? `<span class="aud__vis">${esc(item.visibility)}</span>` : ""}${meta.explicit ? `<span class="aud__vis">Explicit</span>` : ""}</p>
        <h1 class="aud__title" data-a-title>${esc(item.title || "Untitled")}</h1>
        ${byline(item)}
        ${showName ? `<p class="aud__show">${esc(showName)}${episodeLabel ? ` · ${esc(episodeLabel)}` : ""}</p>` : ""}
        ${item.summary ? `<p class="aud__summary">${esc(item.summary)}</p>` : ""}
        ${meta.transcript ? `<details class="aud__transcript"><summary>Transcript</summary><p>${esc(meta.transcript)}</p></details>` : ""}

        ${
          locked
            ? `<div class="aud__gate">
                 <span class="aud__gate-icon">${icon("lock")}</span>
                 <p>${esc(state.gateNote || "This one is not for everyone. Ask the creator.")}</p>
               </div>`
            : source.kind === "embed"
              ? `<div class="aud__deck aud__deck--embed">
                   <iframe class="aud__embed-frame" src="${esc(source.url)}" title="${esc(item.title || "Podcast player")}" loading="lazy" allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture" allowfullscreen></iframe>
                 </div>`
              : source.kind === "video"
              ? `<div class="aud__deck aud__deck--embed"><video class="aud__embed-video" src="${esc(source.url)}" controls playsinline preload="metadata"></video>${meta.allow_download ? `<a class="aud__download" href="${esc(source.url)}" download>${icon("download")} Open or download episode file</a>` : ""}</div>`
              : source.kind === "link"
                ? `<div class="aud__gate"><span class="aud__gate-icon">${icon("link")}</span><p>This source has no supported embedded player. <a href="${esc(source.url)}" target="_blank" rel="noopener">Open source</a>.</p></div>`
                : source.kind === "audio"
                ? `<div class="aud__deck">
                   <audio data-a-media preload="metadata" src="${esc(source.url)}"></audio>
                   <div class="aud__transport">
                     <button class="aud__btn" type="button" data-a-skip="-15" aria-label="Back 15 seconds">${icon("rewind")}</button>
                     <button class="aud__btn aud__btn--play" type="button" data-a-play aria-label="Play" aria-pressed="false">${icon("play")}</button>
                     <button class="aud__btn" type="button" data-a-skip="15" aria-label="Forward 15 seconds">${icon("forward")}</button>
                   </div>
                   <div class="aud__timeline">
                     <span class="aud__time" data-a-now>0:00</span>
                     <input class="aud__range" type="range" min="0" max="1000" value="0" step="1" data-a-seek aria-label="Seek" />
                     <span class="aud__time" data-a-dur>${knownDuration ? fmt(knownDuration) : "0:00"}</span>
                   </div>
                   <div class="aud__volume">
                     <button class="aud__btn aud__btn--sm" type="button" data-a-mute aria-label="Mute" aria-pressed="false">${icon("volume")}</button>
                     <input class="aud__range aud__range--vol" type="range" min="0" max="100" value="80" step="1" data-a-vol aria-label="Volume" />
                     <button class="aud__btn aud__btn--sm" type="button" data-a-share aria-label="Copy the link">${icon("link")}</button>
                   </div>
                   ${meta.allow_download ? `<a class="aud__download" href="${esc(source.url)}" download>${icon("download")} Open or download episode file</a>` : ""}
                 </div>`
                : `<div class="aud__gate">
                   <span class="aud__gate-icon">${icon("info")}</span>
                   <p>This one has no playable audio link yet — the creator has not added a supported source.</p>
                 </div>`
        }
      </div>
    </section>`;
}

function queueMarkup() {
  const rows = state.queue || [];
  if (!rows.length) return "";
  return `
    <section class="audq">
      <div class="audq__head">
        <h2 class="audq__title-h">${icon(state.key === "m" ? "music" : "mic")} More ${esc(state.key === "m" ? "songs" : "podcasts")}</h2>
        <span class="audq__count">${esc(num(rows.length))}</span>
      </div>
      <ul class="audq__list">${rows.map(rowMarkup).join("")}</ul>
    </section>`;
}

function paint() {
  const host = root();
  if (!host) return;
  const kindInfo = AUDIO_KINDS[state.key] || AUDIO_KINDS.p;
  if (state.error) {
    host.innerHTML = errorMarkup(
      state.error === "not_found" ? "That one is gone" : "The audio did not load",
      state.error === "not_found"
        ? "The link may be old, or the creator took it down."
        : "The server is not reachable from here. Try again in a moment."
    );
    return;
  }
  if (!state.item) return;
  host.innerHTML = `
    <nav class="aud__back">
      <a href="videos.html">${icon("arrowLeft")} All videos</a>
      <span class="aud__crumb">${esc(kindInfo.label)}</span>
    </nav>
    ${playerMarkup(state.item, kindInfo)}
    ${queueMarkup()}`;
  bind();
}

/* ------------------------------------------------------------------ */
/* the player                                                         */
/* ------------------------------------------------------------------ */
function bind() {
  const el = audioEl();
  const playBtn = qs("[data-a-play]");
  const seek = qs("[data-a-seek]");
  const vol = qs("[data-a-vol]");
  const mute = qs("[data-a-mute]");

  const paintTime = () => {
    const dur = state.duration || Number(state.item?.meta?.duration_seconds) || (Number(state.item?.minutes) || 0) * 60;
    const now = state.current || 0;
    const nowEl = qs("[data-a-now]");
    const durEl = qs("[data-a-dur]");
    if (nowEl) nowEl.textContent = fmt(now);
    if (durEl && dur) durEl.textContent = fmt(dur);
    if (seek && dur) seek.value = String(Math.round(clamp((now / dur) * 1000, 0, 1000)));
  };

  if (el) {
    el.volume = state.volume;
    el.addEventListener("loadedmetadata", () => {
      state.duration = el.duration || 0;
      paintTime();
    });
    el.addEventListener("timeupdate", () => {
      state.current = el.currentTime || 0;
      paintTime();
    });
    el.addEventListener("play", () => {
      state.playing = true;
      if (playBtn) {
        playBtn.innerHTML = icon("pause");
        playBtn.setAttribute("aria-pressed", "true");
        playBtn.setAttribute("aria-label", "Pause");
      }
    });
    el.addEventListener("pause", () => {
      state.playing = false;
      if (playBtn) {
        playBtn.innerHTML = icon("play");
        playBtn.setAttribute("aria-pressed", "false");
        playBtn.setAttribute("aria-label", "Play");
      }
    });
    el.addEventListener("ended", () => {
      state.current = 0;
      paintTime();
    });
    paintTime();
  }

  if (seek) {
    seek.addEventListener("input", () => {
      const node = audioEl();
      if (!node) return;
      const dur = state.duration || (Number(state.item?.minutes) || 0) * 60;
      if (!dur) return;
      const next = (Number(seek.value) / 1000) * dur;
      state.current = next;
      try {
        node.currentTime = next;
      } catch {
        /* the browser refused the seek — the label still follows the thumb */
      }
      paintTime();
    });
  }

  if (vol) {
    vol.addEventListener("input", () => {
      state.volume = clamp(Number(vol.value) / 100, 0, 1);
      const node = audioEl();
      if (node) node.volume = state.volume;
      state.muted = state.volume === 0;
    });
  }
}

/** The gate, over the card: a podcast or song that is new to you asks first. */
function openGate(id) {
  const card = qs("[data-a-card]");
  if (!card) return;
  const host = document.createElement("div");
  host.className = "aud__ad gate-host";
  host.setAttribute("data-a-gate", "");
  card.append(host);
  mountGate(host, {
    kind: "audio",
    id,
    onPaid: () => {
      host.remove();
      togglePlay();
    },
  });
}

function togglePlay() {
  const el = audioEl();
  if (!el) return;
  /* a press on a new podcast or song is a gate, not a play */
  const gateId = state.item?.code || state.item?.id || state.id;
  if (el.paused && gateNeed("audio", gateId)) return openGate(gateId);
  try {
    if (el.paused) {
      const p = el.play();
      if (p && p.catch) p.catch(() => toast({ title: "The browser blocked it", message: "Press play once more.", iconName: "info" }));
    } else {
      el.pause();
    }
  } catch {
    /* no media element support — nothing to do */
  }
}

function seekBy(seconds) {
  const el = audioEl();
  if (!el) return;
  const dur = state.duration || (Number(state.item?.minutes) || 0) * 60;
  const next = clamp((el.currentTime || 0) + Number(seconds), 0, dur || 0);
  try {
    el.currentTime = next;
  } catch {
    /* ignore */
  }
  state.current = next;
  const nowEl = qs("[data-a-now]");
  if (nowEl) nowEl.textContent = fmt(next);
}

/* ------------------------------------------------------------------ */
/* data                                                               */
/* ------------------------------------------------------------------ */
async function load() {
  const route = parseRoute(location.hash);
  const key = route.surface === "audio" && route.key ? route.key : "p";
  const info = AUDIO_KINDS[key] || AUDIO_KINDS.p;
  state.key = key;
  state.kind = info.kind;
  state.id = route.id || "";
  state.item = null;
  state.gateNote = "";
  state.queue = [];
  state.hub = null;
  state.error = "";
  state.playing = false;
  state.current = 0;
  state.duration = 0;

  if (!state.id) {
    state.error = "empty";
    const host = root();
    if (host) {
      host.innerHTML = `
        <div class="aud__empty">
          <span class="aud__empty-icon">${icon("music")}</span>
          <h1 class="aud__empty-title">Open a podcast or a song</h1>
          <p class="aud__empty-text">Every one has its own address — <code>audio.html#/p/ID=&lt;podcast&gt;</code> or <code>audio.html#/m/ID=&lt;song&gt;</code> — and a playlist opens them from <a href="playlist.html">playlist.html</a>.</p>
        </div>`;
    }
    document.title = "Audio — 1World Web";
    return;
  }

  const host = root();
  if (host) host.innerHTML = `<div class="aud__skeleton" aria-hidden="true"><span class="aud__sk-cover"></span><div class="aud__sk-lines"><span></span><span></span><span></span></div></div>`;

  state.seq += 1;
  const mine = state.seq;
  let res = null;
  try {
    res = await rpc("audio_get", { p_token: state.token, p_ref: state.id, p_kind: info.kind });
  } catch (error) {
    console.warn("[1World] audio:", error.message);
  }
  if (mine !== state.seq) return;

  if (!res || res.ok !== true) {
    state.error = (res && res.error) || "server";
    paint();
    document.title = `${info.label} — 1World Web`;
    return;
  }

  state.item = res.item || res.audio || null;
  state.gateNote = String(res.gate_note || "");
  state.queue = Array.isArray(res.queue) ? res.queue : [];
  state.hub = res.hub || null;
  if (state.item && state.item.locked) state.locked = true;
  else state.locked = false;
  if (!state.item) {
    state.error = "not_found";
    paint();
    return;
  }
  document.title = `${state.item.title || info.label} — 1World Web`;
  paint();
}

/* ------------------------------------------------------------------ */
/* events                                                             */
/* ------------------------------------------------------------------ */
document.addEventListener("click", (event) => {
  const target = event.target;
  if (target.closest("[data-a-play]")) {
    event.preventDefault();
    return togglePlay();
  }
  const skip = target.closest("[data-a-skip]");
  if (skip) {
    event.preventDefault();
    return seekBy(Number(skip.getAttribute("data-a-skip")) || 0);
  }
  if (target.closest("[data-a-mute]")) {
    event.preventDefault();
    state.muted = !state.muted;
    const el = audioEl();
    if (el) el.muted = state.muted;
    const btn = qs("[data-a-mute]");
    if (btn) {
      btn.innerHTML = icon(state.muted ? "mute" : "volume");
      btn.setAttribute("aria-pressed", String(state.muted));
    }
    return;
  }
  if (target.closest("[data-a-share]")) {
    event.preventDefault();
    const url = `${location.origin || ""}${location.pathname}${audioUrl(state.id, state.key).replace(/^audio\.html/, "")}`;
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(url).then(
        () => toast({ title: "Link copied", message: url, iconName: "link" }),
        () => toast({ title: "The link", message: url, iconName: "link" })
      );
      return;
    }
    return toast({ title: "The link", message: url, iconName: "link" });
  }
});

window.addEventListener("hashchange", () => load());

async function boot() {
  state.token = sessionToken() || "";
  state.scope = readParams(location.search);
  await load();
}

boot();
