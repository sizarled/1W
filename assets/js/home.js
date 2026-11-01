/**
 * Homepage controller: hero slideshow, feature grid, search, trending rails,
 * IPTV channels, membership plans, apps, support form and platforms.
 */
import { PLANS, APP_TARGETS, PLATFORMS, POINTS_PER_USD } from "./config.js";
import { loadHomeData, loadApps, submitMessage } from "./data.js";
import { icon } from "./icons.js";
import { brand } from "./brands.js";
import {
  esc,
  qs,
  qsa,
  money,
  num,
  compact,
  clamp,
  posterPlaceholder,
  backdropPlaceholder,
  tilePlaceholder,
  store,
  enableDragScrollAll,
} from "./utils.js";
import { isPremium, getMember } from "./session.js";
import { refreshBlockMap, filterBlocked } from "./blocks.js";
import { toast } from "./ui.js";
import { groupChannels } from "./playlists.js";
import { playSound } from "./sound.js";

const state = {
  movies: [],
  series: [],
  hero: { mode: "movies", index: 0, timer: null, raf: null, start: 0 },
  channels: { free: [], premium: [], tab: "free" },
};

const HERO_COUNT = 5;
const HERO_MS = 9000;
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/* ------------------------------------------------------------------ */
/* helpers                                                            */
/* ------------------------------------------------------------------ */
const fbAttr = (src) => `data-fb="${src}"`;

function imgTag({ src, fallback, alt, cls = "", eager = false }) {
  const source = src || fallback;
  const needsFallback = source !== fallback;
  return `<img class="${cls}" src="${source}" alt="${esc(alt)}" ${
    needsFallback ? fbAttr(fallback) : ""
  } ${eager ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async"
    onload="this.classList.add('is-loaded')"
    onerror="this.onerror=null;this.src=this.dataset.fb||'';this.classList.add('is-loaded')" />`;
}

function hydrateImages(root = document) {
  qsa("img", root).forEach((img) => {
    if (img.complete && img.naturalWidth) img.classList.add("is-loaded");
  });
}

function setHTML(node, html) {
  if (!node) return;
  node.innerHTML = html;
  hydrateImages(node);
}

function mediaFor(item) {
  return {
    title: item.title,
    year: item.year,
    rating: item.rating,
    kind: item.kind === "tv" ? "Series" : "Film",
    poster: item.poster || posterPlaceholder({ title: item.title, year: item.year, rating: item.rating }),
    backdrop: item.backdrop || backdropPlaceholder({ title: item.title, kind: item.kind === "tv" ? "Series" : "Film" }),
  };
}

/* ------------------------------------------------------------------ */
/* hero                                                               */
/* ------------------------------------------------------------------ */
function heroItems() {
  return (state.hero.mode === "movies" ? state.movies : state.series).slice(0, HERO_COUNT);
}

function paintHero() {
  const items = heroItems();
  const hero = qs("[data-hero]");
  if (!hero || !items.length) return;
  state.hero.index = clamp(state.hero.index, 0, items.length - 1);
  const item = items[state.hero.index];
  const media = mediaFor(item);

  // background — two stacked layers for a cross-fade
  const layers = qsa("[data-hero-layer]", hero);
  const nextLayer = layers[state.hero.index % layers.length];
  if (nextLayer) {
    nextLayer.style.backgroundImage = `url("${media.backdrop}")`;
    layers.forEach((l) => l.classList.toggle("is-on", l === nextLayer));
  }

  // copy
  const content = qs("[data-hero-content]", hero);
  if (content) {
    const meta = [
      item.year ? `<span>${esc(item.year)}</span>` : "",
      item.rating ? `<span class="hero__rating">${icon("star")}${esc(item.rating)}</span>` : "",
      item.kind === "tv" ? "<span>Series</span>" : "<span>Feature film</span>",
    ]
      .filter(Boolean)
      .join('<span class="dot"></span>');

    setHTML(
      content,
      `
      <div class="hero__meta">
        <span class="badge badge--solid">${state.hero.mode === "movies" ? "Trending film" : "Trending series"}</span>
        ${meta}
      </div>
      <h1 class="hero__title">${esc(item.title)}</h1>
      ${
        item.genres && item.genres.length
          ? `<p class="hero__genre">${item.genres
              .map((g) => `<span class="badge badge--outline">${esc(g)}</span>`)
              .join(" ")}</p>`
          : ""
      }
      <p class="hero__overview">${esc(item.overview || "A 1World selection. Full synopsis, cast and streaming quality are available on the title page.")}</p>
      <div class="hero__actions">
        <a class="btn btn--primary btn--lg" href="${item.href}">${icon("play")} Watch now</a>
        <a class="btn btn--ghost btn--lg" href="${item.href}">${icon("info")} More details</a>
      </div>`
    );
    content.style.animation = "none";
    void content.offsetWidth;
    content.style.animation = "";
  }

  // thumbnails
  const thumbs = qs("[data-hero-thumbs]", hero);
  if (thumbs) {
    setHTML(
      thumbs,
      items
        .map(
          (it, i) => `
        <button class="hero__thumb ${i === state.hero.index ? "is-active" : ""}" data-hero-thumb="${i}" aria-label="Show ${esc(
            it.title
          )}" aria-current="${i === state.hero.index}">
          ${imgTag({ src: it.poster, fallback: mediaFor(it).poster, alt: "" })}
          <span class="hero__thumb-track"><i></i></span>
        </button>`
        )
        .join("")
    );
  }

  const counter = qs("[data-hero-count]", hero);
  if (counter) {
    counter.innerHTML = `<b>${String(state.hero.index + 1).padStart(2, "0")}</b> / ${String(items.length).padStart(2, "0")}`;
  }
}

function restartProgress() {
  const hero = qs("[data-hero]");
  if (!hero) return;
  cancelAnimationFrame(state.hero.raf);
  const thumb = qs(".hero__thumb.is-active .hero__thumb-track i", hero);
  if (!thumb) return;
  state.hero.start = 0;
  if (reduceMotion) {
    thumb.style.width = "100%";
    return;
  }
  const step = (ts) => {
    if (!state.hero.start) state.hero.start = ts;
    const p = Math.min(1, (ts - state.hero.start) / HERO_MS);
    thumb.style.width = `${p * 100}%`;
    if (p < 1) {
      state.hero.raf = requestAnimationFrame(step);
    } else {
      heroNext();
    }
  };
  state.hero.raf = requestAnimationFrame(step);
}

function heroGo(index) {
  const items = heroItems();
  if (!items.length) return;
  state.hero.index = (index + items.length) % items.length;
  paintHero();
  restartProgress();
}

function heroNext() {
  heroGo(state.hero.index + 1);
}

function heroPrev() {
  heroGo(state.hero.index - 1);
}

function initHero() {
  const hero = qs("[data-hero]");
  if (!hero) return;

  hero.addEventListener("click", (event) => {
    const thumb = event.target.closest("[data-hero-thumb]");
    if (thumb) {
      heroGo(Number(thumb.dataset.heroThumb));
      return;
    }
    if (event.target.closest("[data-hero-next]")) heroNext();
    if (event.target.closest("[data-hero-prev]")) heroPrev();
    const seg = event.target.closest("[data-hero-mode]");
    if (seg) {
      state.hero.mode = seg.dataset.heroMode;
      state.hero.index = 0;
      qsa("[data-hero-mode]", hero).forEach((b) => {
        b.classList.toggle("is-active", b === seg);
        b.setAttribute("aria-selected", String(b === seg));
      });
      paintHero();
      restartProgress();
    }
  });

  hero.addEventListener("mouseenter", () => cancelAnimationFrame(state.hero.raf));
  hero.addEventListener("mouseleave", () => restartProgress());
  hero.addEventListener("focusin", () => cancelAnimationFrame(state.hero.raf));
  hero.addEventListener("focusout", () => restartProgress());

  document.addEventListener("keydown", (event) => {
    if (!document.body.contains(hero)) return;
    if (event.target.closest("input, textarea, select")) return;
    if (event.key === "ArrowRight" && document.activeElement?.closest("[data-hero]")) heroNext();
    if (event.key === "ArrowLeft" && document.activeElement?.closest("[data-hero]")) heroPrev();
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) cancelAnimationFrame(state.hero.raf);
    else restartProgress();
  });
}

/* ------------------------------------------------------------------ */
/* rails                                                              */
/* ------------------------------------------------------------------ */
function posterCard(item, { showKind = true } = {}) {
  const media = mediaFor(item);
  return `
    <a class="pcard" href="${item.href}" aria-label="${esc(item.title)}${item.year ? ` (${esc(item.year)})` : ""}">
      <span class="pcard__media">
        ${imgTag({ src: media.poster, fallback: media.poster, alt: `${item.title} poster`, cls: "pcard__img" })}
        <span class="pcard__shade"></span>
        ${showKind ? `<span class="pcard__kind">${media.kind}</span>` : ""}
        ${item.rating ? `<span class="pcard__rate">${icon("star")}${esc(item.rating)}</span>` : ""}
        <span class="pcard__play">${icon("play")}</span>
      </span>
      <span class="pcard__body">
        <span class="pcard__title">${esc(item.title)}</span>
        <span class="pcard__meta">${esc([item.year, ...(item.genres || []).slice(0, 1)].filter(Boolean).join(" · ") || "—")}</span>
      </span>
    </a>`;
}

function skeletons(count, width = 168) {
  return Array.from({ length: count })
    .map(
      () => `
    <div class="pcard" aria-hidden="true" style="width:${width}px">
      <div class="sk" style="aspect-ratio:2/3;border-radius:13px"></div>
      <div class="sk" style="height:10px;width:82%"></div>
      <div class="sk" style="height:8px;width:48%"></div>
    </div>`
    )
    .join("");
}

function renderRail(section, items, { showKind = true, limit = items.length } = {}) {
  const track = qs("[data-rail-track]", section);
  if (!track) return;
  setHTML(track, items.slice(0, limit).map((item) => posterCard(item, { showKind })).join(""));
  updateRailButtons(section);
}

function updateRailButtons(section) {
  const track = qs("[data-rail-track]", section);
  const prev = qs("[data-rail-prev]", section);
  const next = qs("[data-rail-next]", section);
  if (!track || !prev || !next) return;
  const max = track.scrollWidth - track.clientWidth;
  prev.disabled = track.scrollLeft <= 4;
  next.disabled = track.scrollLeft >= max - 4;
}

function initRail(section) {
  const track = qs("[data-rail-track]", section);
  if (!track) return;
  const scroll = (dir) => {
    track.scrollBy({ left: dir * Math.max(track.clientWidth * 0.8, 300), behavior: "smooth" });
  };
  qs("[data-rail-prev]", section)?.addEventListener("click", () => scroll(-1));
  qs("[data-rail-next]", section)?.addEventListener("click", () => scroll(1));
  track.addEventListener("scroll", () => updateRailButtons(section), { passive: true });
  window.addEventListener("resize", () => updateRailButtons(section));
  updateRailButtons(section);
}

/* ------------------------------------------------------------------ */
/* features                                                           */
/* ------------------------------------------------------------------ */
function renderFeatures(features) {
  const grid = qs("[data-features]");
  if (!grid) return;
  setHTML(
    grid,
    features
      .map(
        (f, i) => `
      <article class="feature" data-reveal style="--delay:${i * 45}ms">
        <span class="feature__icon">${
          /^https?:\/\//i.test(f.icon)
            ? `<img src="${esc(f.icon)}" alt="" width="19" height="19" loading="lazy" />`
            : icon(f.icon) || icon("sparkle")
        }</span>
        <h3 class="feature__title">${esc(f.title)}</h3>
        <p class="feature__desc">${esc(f.description)}</p>
        <a class="feature__link" href="${esc(f.link || "#")}">Learn more ${icon("arrowUpRight")}</a>
      </article>`
      )
      .join("")
  );
  observeReveals(grid);
}

/* ------------------------------------------------------------------ */
/* search                                                             */
/* ------------------------------------------------------------------ */
function initSearch() {
  const form = qs("[data-search-form]");
  if (!form) return;
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const value = (qs("input[name='q']", form)?.value || "").trim();
    window.location.href = value ? `search.html?q=${encodeURIComponent(value)}` : "search.html";
  });
  qsa("[data-search-tag]").forEach((tag) => {
    tag.addEventListener("click", () => {
      const input = qs("input[name='q']", form);
      if (input) {
        input.value = tag.dataset.searchTag;
        input.focus();
      }
    });
  });
}

/* ------------------------------------------------------------------ */
/* IPTV                                                               */
/* ------------------------------------------------------------------ */
function channelCard(channel, locked) {
  const fallbackLogo = tilePlaceholder(channel.name, channel.name.length);
  return `
    <a class="chcard ${locked ? "is-locked" : ""}" href="${channel.href}" data-channel-name="${esc(channel.name)}" ${
    locked ? 'data-locked="1"' : ""
  }>
      <span class="chcard__media">
        <img class="chcard__logo" src="${channel.logo || fallbackLogo}" alt="" loading="lazy" data-fb="${fallbackLogo}"
             onerror="this.onerror=null;this.src=this.dataset.fb" />
        <span class="chcard__live"><i></i>Live</span>
        ${locked ? `<span class="chcard__lock" title="Premium members only">${icon("lock")}</span>` : ""}
      </span>
      <span class="chcard__body">
        <span class="chcard__name">${esc(channel.name)}</span>
        <span class="chcard__meta">
          <span>${esc(channel.category)}</span><span class="dot"></span><span>${esc(channel.group)}</span>
          ${channel.views ? `<span class="dot"></span><span class="chcard__views">${compact(channel.views)}/min</span>` : ""}
        </span>
      </span>
    </a>`;
}

/** A rail cannot hold thousands of channels: take a fair sample of every group. */
function sampleByGroup(list, size = 40) {
  const buckets = groupChannels(list);
  const out = [];
  let round = 0;
  while (out.length < size) {
    let added = 0;
    for (const bucket of buckets) {
      const channel = bucket.channels[round];
      if (!channel) continue;
      out.push(channel);
      added += 1;
      if (out.length >= size) break;
    }
    if (!added) break;
    round += 1;
  }
  return out;
}

function renderChannels() {
  const section = qs("#iptv");
  const track = qs("[data-channel-track]", section);
  if (!track) return;
  const locked = !isPremium();
  const list = state.channels[state.channels.tab];
  const groups = groupChannels(list);
  const shown = sampleByGroup(list, 40);
  setHTML(
    track,
    shown.length
      ? shown.map((c) => channelCard(c, c.premium && locked)).join("")
      : `<p class="muted">No channels published yet.</p>`
  );
  qsa("[data-iptv-tab]", section).forEach((tab) => {
    const active = tab.dataset.iptvTab === state.channels.tab;
    tab.classList.toggle("is-active", active);
    tab.setAttribute("aria-selected", String(active));
  });
  const note = qs("[data-iptv-note]", section);
  if (note) {
    const count = `<a href="iptv.html?list=${state.channels.tab}">All ${num(list.length)} ${state.channels.tab} channels in ${groups.length} groups</a>`;
    note.innerHTML = locked
      ? `${icon("lock")} Premium channels unlock with a Silver, Gold or Diamond membership — free channels are open to every member. ${count}`
      : `${icon("shield")} Premium access active — free and premium channels without ads. ${count}`;
  }
  updateRailButtons(section);
}

function initIptv() {
  const section = qs("#iptv");
  if (!section) return;
  section.addEventListener("click", (event) => {
    const tab = event.target.closest("[data-iptv-tab]");
    if (tab) {
      state.channels.tab = tab.dataset.iptvTab;
      renderChannels();
      return;
    }
    const lockedCard = event.target.closest("[data-locked]");
    if (lockedCard) {
      event.preventDefault();
      playSound("error");
      toast({
        tone: "error",
        iconName: "lock",
        title: "Premium members only",
        message: "Unlock every channel with a Silver, Gold or Diamond plan.",
        action: { label: "See membership plans", href: "#membership" },
      });
    }
  });
}

/* ------------------------------------------------------------------ */
/* membership                                                         */
/* ------------------------------------------------------------------ */
function planPrice(plan, months) {
  if (!plan.pricePerQuarter) return 0;
  return (plan.pricePerQuarter * months) / 3;
}

function planCard(plan, index) {
  const months = plan.durationOptions.find((m) => m > 1) ?? plan.durationOptions[0];
  const price = planPrice(plan, months);
  const free = price === 0;
  const points = Math.round(price * POINTS_PER_USD);
  return `
    <article class="plan ${plan.featured ? "plan--featured" : ""}" data-plan="${plan.id}" data-months="${months}" data-reveal style="--delay:${index * 60}ms">
      <div class="plan__head">
        <div>
          <h3 class="plan__name">${plan.name}</h3>
          <p class="plan__tier">${plan.tier}</p>
        </div>
        <span class="plan__cap">${plan.levelCap}</span>
      </div>

      <div>
        <div class="plan__price">
          <span class="plan__amount" data-price>${free ? "Free" : money(price)}</span>
          <span class="plan__per" data-per>${free ? "/ month" : `/ ${months} months`}</span>
        </div>
        <p class="plan__points" data-points>
          ${free ? `${icon("zap")} Earn points as you watch` : `${icon("zap")} or ${num(points)} points · 100 pts = $1`}
        </p>
      </div>

      <p class="plan__blurb">${plan.blurb}</p>

      <div class="plan__durations" role="group" aria-label="Membership duration">
        ${plan.durationOptions
          .map(
            (m) =>
              `<button class="plan__dur ${m === months ? "is-active" : ""}" data-duration="${m}" type="button">${
                plan.durationOptions.length === 1 ? (m === 1 ? "1 month" : `${m} months`) : `${m}m`
              }</button>`
          )
          .join("")}
      </div>

      <ul class="plan__features">
        ${plan.features.map((f) => `<li>${icon("check")}<span>${esc(f)}</span></li>`).join("")}
      </ul>

      <div class="plan__cta">
        <a class="btn ${plan.featured ? "btn--primary" : "btn--ghost"} btn--block" href="register.html?plan=${plan.id}&duration=${months}">
          ${icon("user")} Register — free
        </a>
        <p class="plan__note">${esc(plan.note)}</p>
      </div>
    </article>`;
}

function renderPlans() {
  const host = qs("[data-plans]");
  if (!host) return;
  setHTML(host, PLANS.map(planCard).join(""));

  host.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-duration]");
    if (!btn) return;
    const card = btn.closest("[data-plan]");
    const plan = PLANS.find((p) => p.id === card.dataset.plan);
    if (!plan) return;
    const months = Number(btn.dataset.duration);
    card.dataset.months = String(months);
    qsa("[data-duration]", card).forEach((b) => b.classList.toggle("is-active", b === btn));

    const price = planPrice(plan, months);
    const priceEl = qs("[data-price]", card);
    const perEl = qs("[data-per]", card);
    const pointsEl = qs("[data-points]", card);
    if (priceEl) priceEl.textContent = price === 0 ? "Free" : money(price);
    if (perEl) perEl.textContent = price === 0 ? "/ month" : `/ ${months} months`;
    if (pointsEl) {
      pointsEl.innerHTML =
        price === 0
          ? `${icon("zap")} Earn points as you watch`
          : `${icon("zap")} or ${num(Math.round(price * POINTS_PER_USD))} points · 100 pts = $1`;
    }
    const cta = qs(".plan__cta a", card);
    if (cta) cta.setAttribute("href", `register.html?plan=${plan.id}&duration=${months}`);
  });
  observeReveals(host);
}

/* ------------------------------------------------------------------ */
/* apps                                                               */
/* ------------------------------------------------------------------ */
function appCard(target, published) {
  const live = Boolean(published?.link);
  const iconMarkup =
    target.icon === "apple" || target.icon === "linux" || target.icon === "android" || target.icon === "appletv"
      ? brand(target.icon)
      : icon(target.icon);
  return `
    <article class="app-card ${live ? "is-live" : ""}">
      <div class="app-card__top">
        <span class="app-card__icon">${iconMarkup}</span>
        <span class="app-card__soon">${live ? "Available" : "Coming soon"}</span>
      </div>
      <div>
        <h3 class="app-card__name">${esc(target.name)}</h3>
        <p class="app-card__meta">${esc(target.meta)}</p>
      </div>
      <div class="app-card__bar">
        <span>${live ? `v${esc(published.number || "1.0")}` : "In development"}</span>
        ${
          live
            ? `<a class="btn btn--ghost btn--sm" href="${esc(published.link)}" rel="noopener">${icon("download")} Download</a>`
            : `<span aria-hidden="true">${icon("clock")}</span>`
        }
      </div>
    </article>`;
}

function renderApps(apps) {
  const track = qs("[data-apps]");
  if (!track) return;
  const bySystem = new Map(apps.map((a) => [String(a.system || "").toLowerCase(), a]));
  setHTML(
    track,
    APP_TARGETS.map((t) => appCard(t, bySystem.get(t.id) || bySystem.get(t.name.toLowerCase()))).join("")
  );
}

/* ------------------------------------------------------------------ */
/* support                                                            */
/* ------------------------------------------------------------------ */
function initSupport() {
  const form = qs("[data-support-form]");
  if (!form) return;
  const success = qs("[data-support-success]", form.parentElement) || qs("[data-support-success]");

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const name = qs("[name='name']", form);
    const email = qs("[name='email']", form);
    const message = qs("[name='message']", form);
    const values = {
      name: name.value.trim(),
      email: email.value.trim(),
      subject: qs("[name='subject']", form)?.value.trim() || "Support request",
      message: message.value.trim(),
    };

    let invalid = false;
    const flag = (field, bad) => {
      field.classList.toggle("input--error", bad);
      if (bad) invalid = true;
    };
    flag(name, values.name.length < 2);
    flag(email, !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(values.email));
    flag(message, values.message.length < 10);
    if (invalid) {
      playSound("error");
      toast({ tone: "error", title: "Check your details", message: "Name, a valid email and a message of 10+ characters." });
      return;
    }

    const button = qs("button[type='submit']", form);
    if (button) {
      button.disabled = true;
      button.dataset.label = button.innerHTML;
      button.innerHTML = `${icon("clock")} Sending…`;
    }

    const result = await submitMessage(values);
    if (!result.ok) {
      const outbox = store.get("1w.outbox", []);
      outbox.push({ ...values, at: new Date().toISOString() });
      store.set("1w.outbox", outbox.slice(-20));
    }

    playSound("success");
    form.reset();
    if (button) {
      button.disabled = false;
      button.innerHTML = button.dataset.label || `${icon("send")} Send message`;
    }
    if (success) {
      success.classList.add("is-on");
      success.innerHTML = `${icon("check")} <span>${
        result.ok ? "Message sent. Our team replies within 48 hours." : "Message queued. We'll deliver it as soon as the inbox is reachable."
      }</span>`;
      setTimeout(() => success.classList.remove("is-on"), 9000);
    }
    toast({
      tone: "success",
      iconName: "check",
      title: "Thank you",
      message: result.ok ? "Your message is on its way." : "Saved to your outbox and queued for delivery.",
      duration: 5000,
    });
  });
}

/* ------------------------------------------------------------------ */
/* platforms                                                          */
/* ------------------------------------------------------------------ */
function renderPlatforms() {
  const track = qs("[data-platforms]");
  if (!track) return;
  setHTML(
    track,
    PLATFORMS.map(
      (p) => `
      <a class="platform-card" href="${p.url}" target="_blank" rel="noopener noreferrer">
        <span class="platform-card__icon">${brand(p.key)}</span>
        <span class="platform-card__meta">
          <span class="platform-card__name">${esc(p.label)}</span>
          <span class="platform-card__handle">${esc(p.handle)}</span>
        </span>
        <span class="platform-card__arrow">${icon("arrowUpRight")}</span>
      </a>`
    ).join("")
  );
}

/* ------------------------------------------------------------------ */
/* reveal                                                             */
/* ------------------------------------------------------------------ */
let revealObserver;
export function observeReveals(root = document) {
  if (!("IntersectionObserver" in window)) {
    qsa("[data-reveal]", root).forEach((el) => el.classList.add("is-in"));
    return;
  }
  if (!revealObserver) {
    revealObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add("is-in");
          revealObserver.unobserve(entry.target);
        });
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.05 }
    );
  }
  qsa("[data-reveal]", root).forEach((el) => {
    if (!el.classList.contains("is-in")) revealObserver.observe(el);
  });
}

/* ------------------------------------------------------------------ */
/* boot                                                               */
/* ------------------------------------------------------------------ */
export async function initHome() {
  // skeleton state
  const movieTrack = qs("[data-rail-track]", qs("#movies"));
  const seriesTrack = qs("[data-rail-track]", qs("#series"));
  if (movieTrack) movieTrack.innerHTML = skeletons(8);
  if (seriesTrack) seriesTrack.innerHTML = skeletons(8);

  qsa("section").forEach((section) => { if (qs(".rail", section)) initRail(section); });
  enableDragScrollAll();
  initHero();
  initSearch();
  initIptv();
  initSupport();
  renderPlans();
  renderPlatforms();
  observeReveals();

  const appsPromise = loadApps();

  if (getMember()) await refreshBlockMap().catch(() => null);

  const data = await loadHomeData();
  state.movies = data.movies;
  state.series = data.series;
  state.channels.free = data.channels.free;
  state.channels.premium = data.channels.premium;

  paintHero();
  restartProgress();

  renderRail(qs("#movies"), filterBlocked(state.movies, "movie"), { limit: 50 });
  renderRail(qs("#series"), filterBlocked(state.series, "tv"), { limit: 50, showKind: true });
  renderFeatures(data.features);
  renderChannels();

  const apps = await appsPromise;
  renderApps(apps);

  const movieCount = qs("[data-movies-count]");
  if (movieCount) movieCount.textContent = `${state.movies.length} titles`;
  const seriesCount = qs("[data-series-count]");
  if (seriesCount) seriesCount.textContent = `${state.series.length} series`;

  observeReveals();

  // re-evaluate premium locks when the session changes
  window.addEventListener("1w:session", () => {
    renderChannels();
    paintHero();
  });

  document.documentElement.dataset.ready = "true";
}


