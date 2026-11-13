/**
 * ads.js — the gate itself: one link, one countdown, one honest clock.
 * ------------------------------------------------------------------
 * What is being gated, for how long, and how often is `gates.js`'s business.
 * This file is only the *mechanism*, and it has three jobs:
 *
 *   • **Draw the gate as markup** — one card, one button, one link.
 *   • **Open the link and keep the handle.** `window.closed` is the only honest
 *     signal that the ad's page is still open, so the window is kept and asked
 *     four times a second. A blocked popup is said out loud, and the link
 *     itself is offered instead.
 *   • **Count real seconds.** What is added is the wall clock that went by
 *     while the ad's page was open — not the number of ticks that happened — so
 *     a throttled tab lands on the right number, and a closed page stops the
 *     count where it stood instead of restarting it.
 */
import { esc } from "./utils.js";

/** Where the ad goes. One link, in one place, so it is easy to change. */
export const AD_URL = "https://asiafilm.org/4/e476b83b0c777b7828ac79fef485bd1a";

/** The shortest count this file will draw. Each kind of content sets its own. */
export const AD_SECONDS = 30;

/**
 * The gate, as markup — one card over the content.
 *
 * It is drawn **instead of** the playable player or readable article: what is
 * behind it is inert, so neither a click nor a tab key reaches it before the
 * count is done.
 */
export function adGateMarkup({
  url = AD_URL,
  seconds = AD_SECONDS,
  tag = "Before this video",
  title = null,
  text = null,
} = {}) {
  const heading = title || `Open the link for ${seconds} seconds`;
  const body =
    text ||
    `Open the link and keep its page open: the count starts when it opens, stops the moment you close it, and this page opens by itself when the count is done.`;
  return `
    <div class="vad" data-v-ad data-v-ad-seconds="${esc(String(seconds))}" role="dialog" aria-modal="true" aria-labelledby="vad-title">
      <div class="vad__box">
        <p class="vad__tag">${esc(tag)}</p>
        <h2 class="vad__title" id="vad-title">${esc(heading)}</h2>
        <p class="vad__text">${esc(body)}</p>
        <button class="btn btn--primary vad__open" type="button" data-v-ad-open>Open the link</button>
        <a class="vad__link" href="${esc(url)}" target="_blank" rel="noopener noreferrer" data-v-ad-fallback hidden>${esc(url)}</a>
        <p class="vad__count" aria-live="polite"><span class="vad__dial" data-v-ad-dial>${esc(String(seconds))}</span><span class="vad__unit">s</span></p>
        <p class="vad__said" role="status" data-v-ad-said>The count has not started.</p>
      </div>
    </div>`;
}

/**
 * Wire a gate: the button opens the ad, the clock runs while that page is
 * open, and `onPaid` is called once, when it is done.
 *
 * Answers a function that stops the clock — a page that is left behind must
 * not keep a timer alive.
 */
export function mountAdGate(host, { url = AD_URL, seconds = AD_SECONDS, onPaid = null, key = "" } = {}) {
  if (!host) return () => {};
  const openButton = host.querySelector("[data-v-ad-open]");
  const dial = host.querySelector("[data-v-ad-dial]");
  const said = host.querySelector("[data-v-ad-said]");
  const fallback = host.querySelector("[data-v-ad-fallback]");
  const total = Math.max(1, Number(seconds) || AD_SECONDS);

  /* what has already been counted for this item is remembered in
     `sessionStorage`, so reloading the page does not throw the count away and
     opening the link again carries on where it stood */
  const memo = key ? `1w.ad.spent:${key}:${total}` : "";
  const remembered = memo ? Number(sessionStorage.getItem(memo) || 0) : 0;
  const remember = () => {
    if (!memo) return;
    try {
      sessionStorage.setItem(memo, String(Math.round(spent)));
    } catch {
      /* private mode — the count simply starts again with the page */
    }
  };

  let win = null;
  let spent = Number.isFinite(remembered) && remembered > 0 ? remembered : 0;
  let last = 0;
  let timer = null;
  let done = false;

  const paint = () => {
    if (dial) dial.textContent = String(Math.max(0, Math.ceil(total - spent / 1000)));
  };

  const stop = () => {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  };

  const finish = () => {
    if (done) return;
    done = true;
    stop();
    if (memo) {
      try {
        sessionStorage.removeItem(memo);
      } catch {
        /* ignore */
      }
    }
    host.remove();
    /* the page that drew the gate is told, wherever it is listening */
    try {
      document.dispatchEvent(new CustomEvent("1w:ad-paid"));
    } catch {
      /* a document that will not carry an event opens the same way */
    }
    if (typeof onPaid === "function") onPaid();
  };

  /* one tick four times a second: what is added is the wall clock that went by
     while the ad's window was open, not the number of ticks that happened */
  const tick = () => {
    /* the gate left the page: nothing is being watched, and nothing is owed */
    if (!host.isConnected) {
      stop();
      return;
    }
    const now = Date.now();
    if (win && !win.closed) spent += now - last;
    last = now;
    remember();
    paint();
    if (spent >= total * 1000) finish();
    else if (win && win.closed && said) {
      said.textContent = spent > 0
        ? `The count stopped at ${Math.floor(spent / 1000)}s. Open the link again to carry on.`
        : "The count has not started.";
    }
  };

  if (openButton) {
    openButton.addEventListener("click", () => {
      if (done) return;
      /* the window is kept, not opened blind: `closed` is the only honest
         signal that the ad is still being watched */
      win = window.open(url, "_blank");
      if (win) {
        try {
          win.opener = null;
        } catch {
          /* a browser that will not let go of the handle still reports `closed` */
        }
        if (fallback) fallback.hidden = true;
        if (said) said.textContent = "The link is open — keep it open.";
      } else if (fallback) {
        /* a blocked popup is said out loud, and the link itself is offered */
        fallback.hidden = false;
        if (said) said.textContent = "This browser held the new tab back. Open the link below instead.";
      }
      last = Date.now();
      if (!timer) timer = setInterval(tick, 250);
    });
  }

  if (fallback) {
    fallback.addEventListener("click", () => {
      if (done) return;
      last = Date.now();
      if (said) said.textContent = "Opened below — keep that page open.";
      if (!timer) timer = setInterval(tick, 250);
    });
  }

  paint();
  return stop;
}
