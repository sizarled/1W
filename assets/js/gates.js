/**
 * gates.js — one rule for every kind of content: a new item asks first.
 * ------------------------------------------------------------------
 * Nothing is free and nothing is endless. The rule is the same everywhere, and
 * only the numbers differ:
 *
 *   • **A new item asks first.** A film, an episode, a video, a podcast, a song,
 *     an article, an answer, a document, an album — the first time a member
 *     opens one, a gate stands in front of it and one link must be opened.
 *   • **An item that was opened before is not asked for again.** The ledger of
 *     what has been opened lives in `localStorage` (`1w.gate.seen`), one list
 *     per kind, so the gate is about *new* content, never about the same film
 *     twice.
 *   • **The count belongs to the link being open.** It starts when the link
 *     opens, stops the moment its page is closed (and picks up where it stopped
 *     when it opens again), and the gate leaves on its own when the count is
 *     done.
 *   • **After so many new items, one task.** The counter per kind
 *     (`1w.gate.since`) is the honest count of new items opened since the last
 *     task; when it reaches the kind's own number the gate asks for a task
 *     instead of a countdown, and a conversion reported by the offers feed is
 *     what opens it (`1w:task-done`).
 *
 * The numbers are here, in one table, because they are the whole policy:
 *
 *   kind        countdown   a task after
 *   films       30 s        30 films
 *   series      15 s        15 episodes
 *   videos      20 s        20 videos
 *   audio       10 s        10 podcasts or songs
 *   articles    20 s        20 articles
 *   answers     10 s        10 answers
 *   documents   20 s        20 documents
 *   albums      10 s        10 albums
 */
import { esc, store } from "./utils.js";
import { AD_URL, AD_SECONDS, adGateMarkup, mountAdGate } from "./ads.js";
import { loadOffers, watchLeads, stopWatchingLeads } from "./offers.js";
import { getMember } from "./session.js";

export { AD_URL };

/** The whole policy, in one table. */
export const RULES = {
  films: { seconds: 30, after: 30, one: "film", many: "films" },
  series: { seconds: 15, after: 15, one: "episode", many: "episodes" },
  videos: { seconds: 20, after: 20, one: "video", many: "videos" },
  audio: { seconds: 10, after: 10, one: "podcast or song", many: "podcasts and songs" },
  articles: { seconds: 20, after: 20, one: "article", many: "articles" },
  answers: { seconds: 10, after: 10, one: "answer", many: "answers" },
  documents: { seconds: 20, after: 20, one: "document", many: "documents" },
  albums: { seconds: 10, after: 10, one: "album", many: "albums" },
};

const SEEN_KEY = "1w.gate.seen";
const SINCE_KEY = "1w.gate.since";
/** How many opened ids each kind remembers — a year of watching, at most. */
const REMEMBER = 500;

const read = (key) => {
  const value = store.get(key, null);
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
};
const write = (key, value) => store.set(key, value);

/** The rule for a kind, or a sensible one for a kind this file has not met. */
export function rule(kind) {
  return RULES[kind] || { seconds: 20, after: 20, one: "item", many: "items" };
}

export function gateSeconds(kind) {
  return rule(kind).seconds;
}

/** The ids already opened for a kind, newest first. */
export function seen(kind) {
  const list = read(SEEN_KEY)[kind];
  return Array.isArray(list) ? list : [];
}

export function hasSeen(kind, id) {
  const key = String(id || "");
  return !!key && seen(kind).includes(key);
}

/** New items opened since the last completed task. */
export function since(kind) {
  const value = Number(read(SINCE_KEY)[kind] || 0);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

/** How many more new items may be opened before a task is asked for. */
export function untilTask(kind) {
  return Math.max(0, rule(kind).after - since(kind));
}

/**
 * What stands in front of this item, if anything.
 *
 *   `null`  — it was opened before: nothing is owed.
 *   `"task"`— enough new items have gone by: one task, then carry on.
 *   `"ad"`  — a countdown, this kind's own length.
 */
export function gateNeed(kind, id) {
  if (hasSeen(kind, id)) return null;
  if (since(kind) >= rule(kind).after) return "task";
  return "ad";
}

/** The countdown was paid: the item is opened for good, and the batch grows. */
export function payGate(kind, id) {
  const key = String(id || "");
  if (!key) return since(kind);
  const book = read(SEEN_KEY);
  const list = (Array.isArray(book[kind]) ? book[kind] : []).filter((row) => row !== key);
  list.unshift(key);
  book[kind] = list.slice(0, REMEMBER);
  write(SEEN_KEY, book);

  const counts = read(SINCE_KEY);
  counts[kind] = since(kind) + 1;
  write(SINCE_KEY, counts);
  return counts[kind];
}

/** A task was completed: the batch starts again, and the item opens. */
export function clearTask(kind, id = "") {
  const counts = read(SINCE_KEY);
  counts[kind] = 0;
  write(SINCE_KEY, counts);
  if (id) {
    /* the item the task was completed for is opened, not asked for again */
    const key = String(id);
    const book = read(SEEN_KEY);
    const list = (Array.isArray(book[kind]) ? book[kind] : []).filter((row) => row !== key);
    list.unshift(key);
    book[kind] = list.slice(0, REMEMBER);
    write(SEEN_KEY, book);
  }
  return 0;
}

/** Forget everything — a test, or a member starting over on this device. */
export function forgetGates() {
  write(SEEN_KEY, {});
  write(SINCE_KEY, {});
}

/* ------------------------------------------------------------------ */
/* the task gate                                                      */
/* ------------------------------------------------------------------ */
/**
 * The offers, as the gate draws them: a task is an offer that really converts,
 * so what is offered here is what the feed says is worth doing.
 */
function taskMarkup(kind, offers = []) {
  const r = rule(kind);
  const list = offers.length
    ? offers
        .map(
          (offer) => `
        <a class="vad__offer" href="${esc(offer.url)}" target="_blank" rel="noopener sponsored" data-v-ad-offer="${esc(offer.id)}">
          ${offer.network_icon ? `<img class="vad__offer-icon" src="${esc(offer.network_icon)}" alt="" loading="lazy" />` : ""}
          <span class="vad__offer-name">${esc(offer.name || "Task")}</span>
          <span class="vad__offer-what">${esc(offer.anchor || offer.conversion || "Complete it")}</span>
        </a>`
        )
        .join("")
    : `<p class="vad__text">The list of tasks could not be reached. Open <a class="vad__inline" href="tasks.html">tasks</a> to see them.</p>`;

  return `
    <div class="vad vad--task" data-v-ad data-v-task="${esc(kind)}" role="dialog" aria-modal="true" aria-labelledby="vad-title">
      <div class="vad__box">
        <p class="vad__tag">One task, then carry on</p>
        <h2 class="vad__title" id="vad-title">Complete one task to continue</h2>
        <p class="vad__text">
          You have opened ${esc(String(r.after))} new ${esc(r.many)}. Pick one of these,
          complete it, and this page opens by itself — the network tells us when a task really
          converts, so there is nothing to declare here.
        </p>
        <div class="vad__offers" data-v-ad-offers>${list}</div>
        <p class="vad__said" role="status" data-v-ad-said>Waiting for a completed task…</p>
      </div>
    </div>`;
}

/* ------------------------------------------------------------------ */
/* wiring a gate                                                      */
/* ------------------------------------------------------------------ */
/**
 * Draw and wire the gate in `host`, for one item.
 *
 * Answers a function that stops whatever is running (a countdown, a lead
 * watch) — a page left behind must not keep a timer alive. `onPaid` is called
 * once, when the item is opened.
 */
export function mountGate(host, { kind = "videos", id = "", onPaid = null } = {}) {
  if (!host) return () => {};
  const need = gateNeed(kind, id);
  if (!need) {
    if (typeof onPaid === "function") onPaid();
    return () => {};
  }
  const r = rule(kind);

  if (need === "ad") {
    host.innerHTML = adGateMarkup({
      seconds: r.seconds,
      tag: `Before this ${r.one}`,
      title: `Open the link for ${r.seconds} seconds`,
      text: `This ${r.one} is new to you. Open the link and keep its page open: the count starts when it opens, stops the moment you close it, and this ${r.one} opens by itself when the count is done.`,
    });
    const done = () => {
      payGate(kind, id);
      if (typeof onPaid === "function") onPaid();
    };
    return mountAdGate(host, { seconds: r.seconds, onPaid: done, key: `${kind}:${id}` });
  }

  /* the task gate: the offers are listed, and a conversion is what opens it */
  host.innerHTML = taskMarkup(kind, []);
  const offersBox = host.querySelector("[data-v-ad-offers]");
  const said = host.querySelector("[data-v-ad-said]");
  let finished = false;
  let stopLeads = () => {};

  const open = () => {
    if (finished) return;
    finished = true;
    stopLeads();
    clearTask(kind, id);
    host.remove();
    try {
      document.dispatchEvent(new CustomEvent("1w:gate-paid", { detail: { kind, mode: "task" } }));
    } catch {
      /* an engine without CustomEvent opens the same way */
    }
    if (typeof onPaid === "function") onPaid();
  };

  const hear = () => open();
  document.addEventListener("1w:task-done", hear);

  loadOffers(3)
    .then((offers) => {
      if (finished || !offersBox) return;
      if (!offers.length) return;
      const wrap = document.createElement("div");
      wrap.className = "vad__offers";
      wrap.setAttribute("data-v-ad-offers", "");
      wrap.innerHTML = offers
        .map(
          (offer) => `
          <a class="vad__offer" href="${esc(offer.url)}" target="_blank" rel="noopener sponsored" data-v-ad-offer="${esc(offer.id)}">
            ${offer.network_icon ? `<img class="vad__offer-icon" src="${esc(offer.network_icon)}" alt="" loading="lazy" />` : ""}
            <span class="vad__offer-name">${esc(offer.name || "Task")}</span>
            <span class="vad__offer-what">${esc(offer.anchor || offer.conversion || "Complete it")}</span>
          </a>`
        )
        .join("");
      offersBox.replaceWith(wrap);
      wrap.querySelectorAll("[data-v-ad-offer]").forEach((node) => {
        node.addEventListener("click", () => {
          if (said) said.textContent = "Keep the task open. This page opens when it converts.";
        });
      });
    })
    .catch(() => {});

  const member = getMember();
  if (member?.id) {
    stopLeads = watchLeads({
      memberId: () => getMember()?.id || "",
      onLead: () => open(),
    });
    if (said) said.textContent = `Waiting for a completed task… ${r.after} new ${r.many} since the last one.`;
  } else if (said) {
    said.textContent = "Sign in first — a task is credited to a member.";
  }

  return () => {
    finished = true;
    stopLeads();
    stopWatchingLeads();
    document.removeEventListener("1w:task-done", hear);
  };
}

export { AD_SECONDS };
