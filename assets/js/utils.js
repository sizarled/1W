/** Small shared helpers. No dependencies. */

export const qs = (sel, root = document) => root.querySelector(sel);
export const qsa = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export const esc = (value = "") =>
  String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

export const clamp = (n, min, max) => Math.min(Math.max(n, min), max);

export function money(value, currency = "USD") {
  const n = Number(value) || 0;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: n % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(n);
}

export function num(value) {
  const n = Number(value) || 0;
  return new Intl.NumberFormat("en-US").format(n);
}

export function compact(value) {
  const n = Number(value) || 0;
  return n >= 1000 ? new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(n) : String(n);
}

export function formatDate(input, opts = {}) {
  if (!input) return "—";
  const d = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", { day: "2-digit", month: "short", year: "numeric", ...opts }).format(d);
}

export function timeAgo(input) {
  if (!input) return "";
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) return "";
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 45) return "just now";
  if (diff < 3600) return `${Math.round(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.round(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.round(diff / 86400)}d ago`;
  return formatDate(d);
}

export function debounce(fn, wait = 220) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------------ */
/* Storage                                                            */
/* ------------------------------------------------------------------ */
export const store = {
  get(key, fallback = null) {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* private mode — ignore */
    }
  },
  remove(key) {
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  },
};

/* ------------------------------------------------------------------ */
/* Generated art (used whenever remote artwork is unavailable)        */
/* ------------------------------------------------------------------ */
const initialsOf = (text = "") =>
  text
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase() || "1W";

function wrapTitle(title = "", perLine = 12, maxLines = 3) {
  const words = String(title).toUpperCase().split(/\s+/).filter(Boolean);
  const lines = [];
  let current = "";
  for (const word of words) {
    if (!current.length) current = word;
    else if ((current + " " + word).length <= perLine) current += " " + word;
    else {
      lines.push(current);
      current = word;
      if (lines.length === maxLines) break;
    }
  }
  if (lines.length < maxLines && current) lines.push(current);
  return lines.slice(0, maxLines);
}

const svgData = (svg) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg.replace(/\s{2,}/g, " "))}`;

/** A monochrome typographic poster, 2:3. */
export function posterPlaceholder({ title = "Untitled", year = "", rating = "", kind = "Film", seed = 0 } = {}) {
  const lines = wrapTitle(title, 11, 3);
  const startY = 300 - (lines.length - 1) * 26;
  const text = lines
    .map(
      (line, i) =>
        `<text x="250" y="${startY + i * 54}" text-anchor="middle" font-family="Helvetica Neue,Helvetica,Arial,sans-serif" font-size="${
          line.length > 10 ? 38 : 44
        }" font-weight="700" letter-spacing="1.5" fill="#f4f4f5">${esc(line)}</text>`
    )
    .join("");
  const angle = 18 + (seed % 7) * 9;
  return svgData(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 500 750" width="500" height="750" role="img" aria-label="${esc(title)}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1" gradientTransform="rotate(${angle} .5 .5)">
      <stop offset="0" stop-color="#1b1b1f"/><stop offset=".55" stop-color="#0d0d10"/><stop offset="1" stop-color="#050506"/>
    </linearGradient>
    <radialGradient id="v" cx="50%" cy="38%" r="70%">
      <stop offset="0" stop-color="#ffffff" stop-opacity=".12"/><stop offset="1" stop-color="#000" stop-opacity=".55"/>
    </radialGradient>
    <filter id="n"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="3" stitchTiles="stitch"/><feColorMatrix type="saturate" values="0"/></filter>
  </defs>
  <rect width="500" height="750" fill="url(#g)"/>
  <text x="250" y="150" text-anchor="middle" font-family="Helvetica Neue,Helvetica,Arial,sans-serif" font-size="16" letter-spacing="7" fill="#8b8b93">${esc(kind.toUpperCase())}</text>
  <line x1="196" y1="190" x2="304" y2="190" stroke="#5c5c66" stroke-width="1"/>
  ${text}
  <text x="250" y="${startY + lines.length * 54 + 18}" text-anchor="middle" font-family="Helvetica Neue,Helvetica,Arial,sans-serif" font-size="18" letter-spacing="3" fill="#9a9aa3">${esc([year, rating ? `★ ${rating}` : ""].filter(Boolean).join("  ·  "))}</text>
  <text x="472" y="716" text-anchor="end" font-family="Helvetica Neue,Helvetica,Arial,sans-serif" font-size="13" letter-spacing="4" fill="#4b4b54">${esc(initialsOf(title))}</text>
  <rect width="500" height="750" fill="url(#v)" opacity=".55"/>
  <rect width="500" height="750" filter="url(#n)" opacity=".05"/>
  <rect x=".5" y=".5" width="499" height="749" fill="none" stroke="#ffffff" stroke-opacity=".10"/>
</svg>`);
}

/** A monochrome landscape still for hero slides, 16:9. */
export function backdropPlaceholder({ title = "", kind = "Film", seed = 0 } = {}) {
  const angle = 8 + (seed % 5) * 12;
  return svgData(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 900" width="1600" height="900" role="img" aria-label="${esc(title)}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1" gradientTransform="rotate(${angle} .5 .5)">
      <stop offset="0" stop-color="#232328"/><stop offset=".5" stop-color="#0e0e11"/><stop offset="1" stop-color="#030304"/>
    </linearGradient>
    <radialGradient id="glow" cx="72%" cy="42%" r="52%">
      <stop offset="0" stop-color="#ffffff" stop-opacity=".22"/><stop offset="1" stop-color="#000" stop-opacity="0"/>
    </radialGradient>
    <filter id="grain"><feTurbulence type="fractalNoise" baseFrequency=".75" numOctaves="3" stitchTiles="stitch"/><feColorMatrix type="saturate" values="0"/></filter>
  </defs>
  <rect width="1600" height="900" fill="url(#bg)"/>
  <rect width="1600" height="900" fill="url(#glow)"/>
  <g stroke="#ffffff" stroke-opacity=".07" stroke-width="1">
    <circle cx="1150" cy="400" r="300"/><circle cx="1150" cy="400" r="380"/><circle cx="1150" cy="400" r="460"/>
  </g>
  <text x="150" y="770" font-family="Helvetica Neue,Helvetica,Arial,sans-serif" font-size="120" font-weight="700" letter-spacing="6" fill="#ffffff" opacity=".10">${esc(title.toUpperCase().slice(0, 22))}</text>
  <text x="151" y="380" font-family="Helvetica Neue,Helvetica,Arial,sans-serif" font-size="18" letter-spacing="8" fill="#6e6e78">${esc(kind.toUpperCase())}</text>
  <rect width="1600" height="900" filter="url(#grain)" opacity=".06"/>
</svg>`);
}

/** Round avatar with initials (monochrome). */
export function avatarPlaceholder(name = "1W", size = 96) {
  const text = initialsOf(name).slice(0, 2);
  return svgData(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" width="${size}" height="${size}" role="img" aria-label="${esc(name)}">
  <defs>
    <linearGradient id="a" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2a2a30"/><stop offset="1" stop-color="#101014"/></linearGradient>
  </defs>
  <rect width="96" height="96" rx="48" fill="url(#a)"/>
  <circle cx="48" cy="48" r="47" fill="none" stroke="#ffffff" stroke-opacity=".14"/>
  <text x="48" y="58" text-anchor="middle" font-family="Helvetica Neue,Helvetica,Arial,sans-serif" font-size="34" font-weight="600" letter-spacing="1" fill="#e6e6ea">${esc(text)}</text>
</svg>`);
}

/** Square tile used for channel / app logos. */
export function tilePlaceholder(label = "TV", seed = 0) {
  const chars = initialsOf(label).slice(0, 2) || "TV";
  const a = 12 + (seed % 5) * 6;
  return svgData(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" width="120" height="120" role="img" aria-label="${esc(label)}">
  <defs><linearGradient id="t" x1="0" y1="0" x2="1" y2="1" gradientTransform="rotate(${a} .5 .5)"><stop offset="0" stop-color="#303038"/><stop offset="1" stop-color="#121216"/></linearGradient></defs>
  <rect width="120" height="120" rx="26" fill="url(#t)"/>
  <rect x=".6" y=".6" width="118.8" height="118.8" rx="25.4" fill="none" stroke="#ffffff" stroke-opacity=".12"/>
  <text x="60" y="74" text-anchor="middle" font-family="Helvetica Neue,Helvetica,Arial,sans-serif" font-size="42" font-weight="700" letter-spacing="1" fill="#f0f0f2">${esc(chars)}</text>
</svg>`);
}

/* ------------------------------------------------------------------ */
/* Misc                                                               */
/* ------------------------------------------------------------------ */
export function randomId(len = 6) {
  let out = "";
  for (let i = 0; i < len; i += 1) out += Math.floor(Math.random() * 10);
  return out;
}

/** Pick the first defined value from a set of possible column names. */
export function pick(row = {}, keys = [], fallback = "") {
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== null && row[key] !== "") return row[key];
  }
  return fallback;
}

export const isTruthy = (v) => v === true || v === "true" || v === 1 || v === "1" || v === "yes" || v === "read";

export function chunk(list, size) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

export function scrollRail(rail, direction = 1) {
  if (!rail) return;
  const amount = Math.max(rail.clientWidth * 0.8, 320);
  rail.scrollBy({ left: amount * direction, behavior: "smooth" });
}

/* ------------------------------------------------------------------ */
/* Horizontal scrollers: click-and-drag with the mouse                */
/* ------------------------------------------------------------------ */
const DRAG_SELECTOR = [
  ".rail__track",
  ".plans",
  ".notif__filters",
  ".primary-nav", // the twelve sections in the header
  "[data-primary-nav]",
  "[data-rail-track]",
  "[data-channel-track]",
  "[data-drag-scroll]",
].join(", ");

/**
 * Lets a horizontal scroller be dragged with the mouse (click, hold, pull left
 * or right) while native touch swiping and the arrow buttons keep working.
 * Idempotent: a container is only wired once.
 */
export function enableDragScroll(el) {
  if (!el || el.dataset.dragReady === "1") return el;
  el.dataset.dragReady = "1";
  el.classList.add("is-draggable");

  const THRESHOLD = 4;
  let active = false; // pointer is down on the track
  let moved = false; // the pointer passed the drag threshold
  let swallowClick = false; // a drag just ended → ignore the click
  let pointerId = null;
  let startX = 0;
  let startY = 0;
  let startLeft = 0;

  const stop = () => {
    if (!active) return;
    active = false;
    swallowClick = moved;
    if (pointerId !== null && el.hasPointerCapture && el.hasPointerCapture(pointerId)) {
      el.releasePointerCapture(pointerId);
    }
    pointerId = null;
    el.classList.remove("is-dragging");
    document.documentElement.classList.remove("is-grabbing");
  };

  el.addEventListener("pointerdown", (event) => {
    // Touch and pen keep their native momentum scrolling.
    if (event.pointerType === "touch" || event.button !== 0) return;
    active = true;
    moved = false;
    swallowClick = false;
    pointerId = event.pointerId;
    startX = event.clientX;
    startY = event.clientY;
    startLeft = el.scrollLeft;
    el.classList.add("is-dragging");
  });

  el.addEventListener("pointermove", (event) => {
    if (!active || event.pointerId !== pointerId) return;
    const dx = event.clientX - startX;
    const dy = event.clientY - startY;

    if (!moved) {
      if (Math.abs(dx) < THRESHOLD) return;
      // Mostly vertical movement: the visitor is scrolling the page, not the rail.
      if (Math.abs(dx) <= Math.abs(dy)) {
        stop();
        return;
      }
      moved = true;
      el.setPointerCapture?.(pointerId);
      document.documentElement.classList.add("is-grabbing");
    }

    event.preventDefault();
    el.scrollLeft = startLeft - dx;
  });

  el.addEventListener("pointerup", stop);
  el.addEventListener("pointercancel", stop);
  el.addEventListener("lostpointercapture", stop);

  // Never start a native image/link drag while pulling the rail.
  el.addEventListener("dragstart", (event) => event.preventDefault());

  // A drag must not open the card the pointer happened to finish on.
  el.addEventListener(
    "click",
    (event) => {
      if (!swallowClick) return;
      swallowClick = false;
      event.preventDefault();
      event.stopPropagation();
    },
    true
  );

  // Vertical wheel over a rail scrolls it sideways until it reaches an edge,
  // then the page takes over again.
  el.addEventListener(
    "wheel",
    (event) => {
      if (event.ctrlKey) return;
      const max = el.scrollWidth - el.clientWidth;
      if (max <= 0) return;
      const horizontal = Math.abs(event.deltaX) > Math.abs(event.deltaY);
      const delta = horizontal ? event.deltaX : event.deltaY;
      if (!horizontal && !event.shiftKey) {
        const atStart = el.scrollLeft <= 0;
        const atEnd = el.scrollLeft >= max - 1;
        if ((delta > 0 && atEnd) || (delta < 0 && atStart)) return; // let the page scroll
      }
      event.preventDefault();
      el.classList.add("is-wheel-scrolling");
      el.scrollLeft += delta;
      clearTimeout(el.__wheelTimer);
      el.__wheelTimer = setTimeout(() => el.classList.remove("is-wheel-scrolling"), 140);
    },
    { passive: false }
  );

  return el;
}

/** Wires every horizontal scroller inside `root` (defaults to the document). */
export function enableDragScrollAll(root = document) {
  const scope = root?.querySelectorAll ? root : document;
  const nodes = new Set(scope.querySelectorAll(DRAG_SELECTOR));
  if (scope.matches?.(DRAG_SELECTOR)) nodes.add(scope);
  nodes.forEach((node) => enableDragScroll(node));
  return nodes.size;
}
