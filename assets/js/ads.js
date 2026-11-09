/**
 * ads.js — the hour, and the thirty seconds it costs.
 * ------------------------------------------------------------------
 * Watching is free, and it is not endless: a member who has watched **sixty
 * minutes of video** is asked once, before the next video opens. The ask is a
 * link, and the link has to be really open — the count starts when its page
 * opens, stops the moment it is closed, and only when it has run out does the
 * video open.
 *
 * Three rules, and each one is a decision:
 *
 *   • **The hour is watching, not reading.** `addWatched` is fed by a player's
 *     own clock — a `<video>`'s `timeupdate`, a frame's `timeupdate` through
 *     the player.js bridge — and never by a page being open.
 *   • **The count is time on the ad, not time on this page.** It is measured
 *     from `Date.now()` and only while the opened window reports itself open,
 *     so switching tabs cannot pause it and closing the ad cannot help it. A
 *     background tab whose timers are throttled still lands on the right
 *     number when it next fires.
 *   • **Nothing is pretended.** If the browser refuses to open the window, the
 *     gate says so and offers the link itself; if the ad is closed early, the
 *     gate says where the count stopped. The video is under the gate the whole
 *     time and is not playable until it is paid.
 *
 * The ledger lives in `localStorage` (`1w.videos.watched`, `1w.videos.adsPaid`),
 * so it survives a reload and a visit that ends mid-hour.
 */
import { store, esc } from "./utils.js";

/** Where the ad goes. One link, in one place, so it is easy to change. */
export const AD_URL = "https://asiafilm.org/4/e476b83b0c777b7828ac79fef485bd1a";

/** How long it must stay open. */
export const AD_SECONDS = 30;

/** Watching that buys one hour of video. */
export const AD_EVERY = 60 * 60;

const WATCH_KEY = "1w.videos.watched";
const PAID_KEY = "1w.videos.adsPaid";

/** Seconds watched since the last ad was paid. */
export function watchedSeconds() {
  const value = Number(store.get(WATCH_KEY, 0));
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * Book watching.
 *
 * A player books what it played — a step of a second or two at a time — so a
 * single call that claims more than ten minutes is not watching at all (a
 * seek, a sleeping laptop, a clock that jumped) and is refused rather than
 * believed.
 */
export function addWatched(seconds) {
  const many = Number(seconds);
  if (!Number.isFinite(many) || many <= 0 || many > 600) return watchedSeconds();
  const next = watchedSeconds() + many;
  store.set(WATCH_KEY, next);
  return next;
}

/** Whether the next video must ask first. */
export function adDue() {
  return watchedSeconds() >= AD_EVERY;
}

/** How many ads have been paid on this device — for the page to be honest. */
export function adsPaid() {
  const value = Number(store.get(PAID_KEY, 0));
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/** The ad was watched: the hour starts again, and one more is on the ledger. */
export function payAd() {
  store.set(WATCH_KEY, Math.max(0, watchedSeconds() - AD_EVERY));
  store.set(PAID_KEY, adsPaid() + 1);
}

/** Forget the ledger (a test, or a member starting over). */
export function forgetAds() {
  store.set(WATCH_KEY, 0);
  store.set(PAID_KEY, 0);
}

/**
 * The gate itself, as markup — one card over the player.
 *
 * It is drawn **instead of** a playable player: the frame behind it is inert,
 * so neither a click nor a tab key reaches the film before the ad is paid.
 */
export function adGateMarkup({ url = AD_URL, seconds = AD_SECONDS } = {}) {
  return `
    <div class="vad" data-v-ad data-v-ad-seconds="${esc(String(seconds))}" role="dialog" aria-modal="true" aria-labelledby="vad-title">
      <div class="vad__box">
        <p class="vad__tag">Before this video</p>
        <h2 class="vad__title" id="vad-title">Open the link for thirty seconds</h2>
        <p class="vad__text">
          An hour of watching has gone by, so the next video asks first. Open the link and keep its page
          open: the count starts when it opens, stops the moment you close it, and the video opens by
          itself when the count is done.
        </p>
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
export function mountAdGate(host, { url = AD_URL, seconds = AD_SECONDS, onPaid = null } = {}) {
  if (!host) return () => {};
  const openButton = host.querySelector("[data-v-ad-open]");
  const dial = host.querySelector("[data-v-ad-dial]");
  const said = host.querySelector("[data-v-ad-said]");
  const fallback = host.querySelector("[data-v-ad-fallback]");
  const total = Math.max(1, Number(seconds) || AD_SECONDS);

  let win = null;
  let spent = 0;
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
    payAd();
    host.remove();
    /* the page that drew the gate is told, wherever it is listening */
    try {
      document.dispatchEvent(new CustomEvent("1w:ad-paid"));
    } catch {
      /* a document that will not carry an event pays the same way */
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
