/**
 * iptv.html — the channel lists.
 * ------------------------------------------------------------------
 * Free channels come from `IPTV/IPTV-Free.m3u`, premium channels from
 * `IPTV/IPTV Premuim.m3u` (both in the `source` bucket). The page groups
 * them by `group-title`; a channel written as `General;News` is listed
 * under **General** and under **News**, never under a joined name.
 *
 * `iptv.html?M3U=<id>` (the deep-link the cards use) opens straight on
 * that channel, and `iptv.html?list=premium` opens the premium table.
 */

import { esc, qs, qsa, num, enableDragScrollAll } from "./utils.js";
import { icon, hydrateIcons } from "./icons.js";
import { toast } from "./ui.js";
import { loadPlaylist, groupChannels, searchChannels, PLAYLISTS } from "./playlists.js";
import { isPremium } from "./session.js";

const state = {
  list: "free",
  group: "all",
  query: "",
  limit: 60,
  rows: { free: [], premium: [] },
  ready: false,
};

const GRID_STEP = 60;

function locked(channel) {
  return Boolean(channel.premium) && !isPremium();
}

function chip(label, value, active, count) {
  return `<button class="iptv-chip ${active ? "is-active" : ""}" type="button"
    data-group="${esc(value)}" role="tab" aria-selected="${active ? "true" : "false"}">
    <span>${esc(label)}</span>${count ? `<small>${num(count)}</small>` : ""}
  </button>`;
}

function card(channel) {
  const isLocked = locked(channel);
  const groups = channel.groups && channel.groups.length ? channel.groups : [channel.group];
  return `
    <a class="chcard ${isLocked ? "is-locked" : ""}" href="${esc(channel.href)}" data-channel="${esc(channel.name)}"
       ${isLocked ? 'data-locked="1"' : ""} title="${esc(channel.name)}">
      <span class="chcard__media">
        <img class="chcard__logo" src="${esc(channel.logo)}" alt="" loading="lazy" />
        <span class="chcard__live"><i></i>Live</span>
        ${isLocked ? `<span class="chcard__lock" title="Premium members only">${icon("lock")}</span>` : ""}
      </span>
      <span class="chcard__body">
        <span class="chcard__name">${esc(channel.name)}</span>
        <span class="chcard__meta">
          <span>${esc(groups.join(" · "))}</span>
          ${channel.country ? `<span class="dot"></span><span>${esc(channel.country)}</span>` : ""}
        </span>
      </span>
    </a>`;
}

function currentRows() {
  return state.rows[state.list] || [];
}

/** Every channel of the chosen group — a multi-group channel shows up in each one. */
function rowsForView() {
  const rows = currentRows();
  const byGroup = state.group === "all" ? rows : groupChannels(rows).find((entry) => entry.name === state.group)?.channels || [];
  return state.query ? searchChannels(byGroup, state.query, 5000) : byGroup;
}

function paintTabs() {
  qsa("[data-list]").forEach((button) => {
    const active = button.dataset.list === state.list;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", active ? "true" : "false");
  });
}

function paintGroups() {
  const box = qs("[data-iptv-groups]");
  if (!box) return;
  const groups = groupChannels(currentRows());
  box.innerHTML = [
    chip("All groups", "all", state.group === "all", currentRows().length),
    ...groups.map((entry) => chip(entry.name, entry.name, state.group === entry.name, entry.channels.length)),
  ].join("");
}

function paintGrid() {
  const grid = qs("[data-iptv-grid]");
  const empty = qs("[data-iptv-empty]");
  const more = qs("[data-iptv-more]");
  const title = qs("[data-iptv-title]");
  const meta = qs("[data-iptv-meta]");
  if (!grid) return;

  const rows = rowsForView();
  const shown = rows.slice(0, state.limit);

  if (title) title.textContent = state.group === "all" ? `Every ${state.list} channel` : state.group;
  if (meta) {
    const groups = groupChannels(rows).length;
    meta.textContent = state.query
      ? `${num(rows.length)} result${rows.length === 1 ? "" : "s"} for “${state.query}”`
      : `${num(rows.length)} channel${rows.length === 1 ? "" : "s"} · ${num(groups)} group${groups === 1 ? "" : "s"} · ${PLAYLISTS[state.list].path}`;
  }

  grid.innerHTML = shown.map(card).join("");
  if (empty) empty.hidden = rows.length > 0;
  if (more) {
    more.hidden = rows.length <= shown.length;
    more.textContent = `Show ${num(Math.min(GRID_STEP, rows.length - shown.length))} more`;
  }
  hydrateIcons(grid);
}

function paint() {
  paintTabs();
  paintGroups();
  paintGrid();
}

function wire() {
  document.addEventListener("click", (event) => {
    const tab = event.target.closest("[data-list]");
    if (tab) {
      state.list = tab.dataset.list;
      state.group = "all";
      state.limit = GRID_STEP;
      paint();
      return;
    }

    const group = event.target.closest("[data-group]");
    if (group) {
      state.group = group.dataset.group;
      state.limit = GRID_STEP;
      paintGroups();
      paintGrid();
      return;
    }

    const lockedCard = event.target.closest("[data-locked]");
    if (lockedCard) {
      event.preventDefault();
      toast({
        tone: "error",
        iconName: "lock",
        title: "Premium members only",
        message: "Unlock every premium channel with a Silver, Gold or Diamond membership.",
        action: { label: "See membership plans", href: "index.html#membership" },
      });
      return;
    }

    if (event.target.closest("[data-iptv-more]")) {
      state.limit += GRID_STEP;
      paintGrid();
    }
  });

  const search = qs("[data-iptv-search]");
  search?.addEventListener("input", () => {
    state.query = search.value.trim();
    state.limit = GRID_STEP;
    paintGrid();
  });

  const clear = qs("[data-iptv-clear]");
  clear?.addEventListener("click", () => {
    if (search) search.value = "";
    state.query = "";
    state.group = "all";
    state.limit = GRID_STEP;
    paint();
  });
}

/** Fill one list; the table/demo data covers a playlist that cannot be read. */
async function fill(kind) {
  const rows = await loadPlaylist(kind);
  state.rows[kind] = rows;
  return rows;
}

async function boot() {
  const params = new URLSearchParams(location.search);
  const wanted = (params.get("list") || "").toLowerCase();
  if (wanted === "premium" || wanted === "free") state.list = wanted;

  const deep = params.get("M3U");
  if (deep) {
    state.query = deep;
    const search = qs("[data-iptv-search]");
    if (search) search.value = deep;
  }

  const note = qs("[data-iptv-status]");
  if (note) note.hidden = false;

  await Promise.all([fill("free"), fill("premium")]);

  if (!currentRows().length) {
    /* nothing readable — fall back to whatever the tables hold */
    const { loadChannels } = await import("./data.js");
    const fallback = await loadChannels().catch(() => null);
    if (fallback) {
      state.rows.free = state.rows.free.length ? state.rows.free : fallback.free || [];
      state.rows.premium = state.rows.premium.length ? state.rows.premium : fallback.premium || [];
    }
  }

  state.ready = true;
  if (note) note.hidden = true;

  /* a deep link may point at a premium channel — open the list that holds it */
  if (deep) {
    const key = deep.toLowerCase();
    const holder = ["free", "premium"].find((kind) =>
      state.rows[kind].some((row) => String(row.id).toLowerCase() === key || row.name.toLowerCase() === key)
    );
    if (holder) state.list = holder;
  }

  enableDragScrollAll();
  paint();
}

export function initIptv() {
  if (!qs("[data-iptv-grid]")) return;
  wire();
  boot().catch((error) => console.warn("[1World] iptv:", error));
}
