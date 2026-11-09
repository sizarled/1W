/**
 * offers.js — the sponsor offers, and the leads they send back.
 * ------------------------------------------------------------------
 * The offers are a JSONP feed (a script tag, because the feed answers with a
 * callback), and the leads are a second one: when an offer really converts, the
 * network writes it there. Neither is trusted for anything but "an offer
 * converted" — the points are still credited through `taskcomplet`.
 *
 * Three callers need this list, so it lives here rather than in one page:
 *
 *   • the tasks rail on the watch page, which lists what can be earned;
 *   • the gate, which asks for one completed task after so many new items;
 *   • the lead watcher, which turns a conversion into points and an event
 *     (`1w:task-done`) so a gate that is waiting for one can open.
 */
import { rest } from "./data.js";
import { awardPoints } from "./wallet.js";

export const OFFERS_FEED =
  "https://dtvpp42hfuyb2.cloudfront.net/public/offers/feed.php?user_id=213564&api_key=f66502e8a3e2f4674d4dfd1291d34a22&s1=&s2=&callback=?";
export const LEADS_FEED =
  "https://dtvpp42hfuyb2.cloudfront.net/public/external/check2.php?testing=0&callback=?";

/** A JSONP call, as a promise. Removes its script whatever happens. */
export function jsonp(url, timeout = 8000) {
  return new Promise((resolve, reject) => {
    if (typeof document === "undefined") return reject(new Error("no document"));
    const cb = `__wcb${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
    const script = document.createElement("script");
    const done = (fn, arg) => {
      fn(arg);
      delete window[cb];
      script.remove();
    };
    const timer = setTimeout(() => done(reject, new Error("timeout")), timeout);
    window[cb] = (data) => {
      clearTimeout(timer);
      done(resolve, data);
    };
    script.onerror = () => {
      clearTimeout(timer);
      done(reject, new Error("blocked"));
    };
    script.src = url.replace("callback=?", `callback=${cb}`);
    document.head.appendChild(script);
  });
}

/** The offers, or an empty list — a feed that is blocked is not an error. */
export async function loadOffers(limit = 6) {
  try {
    const offers = await jsonp(OFFERS_FEED);
    return (Array.isArray(offers) ? offers : [])
      .filter((offer) => offer && offer.url)
      .slice(0, Math.max(0, Number(limit) || 0) || 6);
  } catch {
    return [];
  }
}

let leadsTimer = null;

/**
 * Watch the lead feed.
 *
 * Every conversion the network reports is written to `taskcomplet` once (the
 * insert is what tells us it is new), credited, and announced — a gate that is
 * waiting for a task hears `1w:task-done` and opens.
 */
export function watchLeads({ every = 15000, memberId, onLead = null } = {}) {
  stopWatchingLeads();
  const member = () => (typeof memberId === "function" ? memberId() : memberId);
  leadsTimer = setInterval(async () => {
    if (document.hidden) return;
    if (!member()) return;
    let leads = null;
    try {
      leads = await jsonp(LEADS_FEED);
    } catch {
      return;
    }
    if (!Array.isArray(leads) || !leads.length) return;
    for (const lead of leads) {
      const offerId = String(lead.offer_id || "");
      if (!offerId) continue;
      const payout = Number(lead.points || 0) / 100;
      let done = null;
      try {
        done = await rest("taskcomplet", {
          method: "POST",
          minimal: true,
          body: { offer_id: offerId, idmember: member(), payout, points: Math.round(payout * 100) },
        });
      } catch {
        done = null;
      }
      if (!done) continue;
      awardPoints(Math.round(payout * 100), `Task #${offerId}`);
      try {
        document.dispatchEvent(new CustomEvent("1w:task-done", { detail: { offer: offerId } }));
      } catch {
        /* an engine without CustomEvent still credits the points */
      }
      if (typeof onLead === "function") onLead({ offer: offerId, points: Math.round(payout * 100) });
    }
  }, every);
  return stopWatchingLeads;
}

export function stopWatchingLeads() {
  if (leadsTimer) clearInterval(leadsTimer);
  leadsTimer = null;
}
