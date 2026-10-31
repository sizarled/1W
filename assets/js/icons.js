/**
 * Hand-tuned line icon set (24×24, 1.6 stroke) plus filled utility glyphs.
 * Usage:  import { icon } from "./icons.js";  icon("bell", "ico")
 * Every icon inherits `currentColor`, so it works in both themes.
 */

const S = (d, extra = "") =>
  `<path d="${d}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" ${extra}/>`;
const F = (d) => `<path d="${d}" fill="currentColor"/>`;
const CIRC = (cx, cy, r) =>
  `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="currentColor" stroke-width="1.6"/>`;

export const ICONS = {
  /* ---- navigation / chrome ---- */
  menu: S("M4 7h16M4 12h16M4 17h16"),
  close: S("M6 6l12 12M18 6L6 18"),
  search: CIRC(11, 11, 6.4) + S("M16 16l4.5 4.5"),
  bell: S("M18 8.6a6 6 0 0 0-12 0c0 6-2.6 7.6-2.6 7.6h17.2S18 14.6 18 8.6Z") + S("M13.7 20a2 2 0 0 1-3.4 0"),
  settings: S("M4 7h9M17 7h3M4 17h3M11 17h9") + CIRC(15, 7, 2.2) + CIRC(8, 17, 2.2),
  user: CIRC(12, 8, 3.6) + S("M4.8 20c.9-3.7 3.7-5.6 7.2-5.6s6.3 1.9 7.2 5.6"),
  dashboard: `<rect x="3.2" y="3.2" width="7.2" height="7.2" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/><rect x="13.6" y="3.2" width="7.2" height="7.2" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/><rect x="3.2" y="13.6" width="7.2" height="7.2" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/><rect x="13.6" y="13.6" width="7.2" height="7.2" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/>`,
  logout: S("M15 4h3.2A1.8 1.8 0 0 1 20 5.8v12.4A1.8 1.8 0 0 1 18.2 20H15") + S("M10 16.5 5.5 12 10 7.5") + S("M5.6 12h9"),
  login: S("M9 4H5.8A1.8 1.8 0 0 0 4 5.8v12.4A1.8 1.8 0 0 0 5.8 20H9") + S("M14 16.5 18.5 12 14 7.5") + S("M18.4 12h-9"),
  chevronDown: S("M6 9.5l6 6 6-6"),
  chevronRight: S("M9.5 6l6 6-6 6"),
  chevronLeft: S("M14.5 6l-6 6 6 6"),
  chevronUp: S("M6 14.5l6-6 6 6"),
  arrowRight: S("M4 12h15") + S("M13.5 6.5 20 12l-6.5 5.5"),
  arrowLeft: S("M20 12H5") + S("M10.5 6.5 4 12l6.5 5.5"),
  arrowUpRight: S("M7 17 17 7") + S("M8.5 7H17v8.5"),
  external: S("M14 4h6v6") + S("M20 4l-8.5 8.5") + S("M18 14.5V18a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h3.5"),
  plus: S("M12 5v14M5 12h14"),
  minus: S("M5 12h14"),
  check: S("M4.5 12.5 9.5 17.5 19.5 6.5"),
  clock: CIRC(12, 12, 8.2) + S("M12 7.4V12l3.2 2"),
  calendar: `<rect x="3.5" y="5" width="17" height="15.5" rx="2.4" fill="none" stroke="currentColor" stroke-width="1.6"/>${S("M3.5 10h17M8 3.2v3.6M16 3.2v3.6")}`,
  eye: S("M2.2 12S5.6 5.8 12 5.8 21.8 12 21.8 12 18.4 18.2 12 18.2 2.2 12 2.2 12Z") + CIRC(12, 12, 2.9),
  users: CIRC(9.5, 8.5, 3.4) + S("M3 19.4c.7-3.3 3.3-5 6.5-5s5.8 1.7 6.5 5") + S("M16 5.4a3.2 3.2 0 0 1 0 6.2M18 14.8c2 .7 3.2 2.2 3.6 4.6"),
  zap: F("M13.4 2 4.9 13.3h5.4L9.6 22l8.9-11.6h-5.7L14.6 2Z"),
  lock: `<rect x="4.6" y="10.4" width="14.8" height="10.2" rx="2.6" fill="none" stroke="currentColor" stroke-width="1.6"/>${S("M8.4 10.4V7.8a3.6 3.6 0 0 1 7.2 0v2.6")}`,
  logoutAlt: S("M15 4h3.2A1.8 1.8 0 0 1 20 5.8v12.4A1.8 1.8 0 0 1 18.2 20H15"),
  volume: S("M11 5.4 6.4 9.2H3.4v5.6h3L11 18.6z") + S("M14.8 9.2a3.8 3.8 0 0 1 0 5.6") + S("M17.4 6.8a7.2 7.2 0 0 1 0 10.4"),
  mute: S("M11 5.4 6.4 9.2H3.4v5.6h3L11 18.6z") + S("M15 10l4 4M19 10l-4 4"),
  home: S("M4 10.4 12 4l8 6.4V19a1.6 1.6 0 0 1-1.6 1.6H5.6A1.6 1.6 0 0 1 4 19z") + S("M9.4 20.6v-6.2h5.2v6.2"),
  logoutSquare: S("M9 4H5.8A1.8 1.8 0 0 0 4 5.8v12.4A1.8 1.8 0 0 0 5.8 20H9") + S("M14 16.5 18.5 12 14 7.5"),

  /* ---- content ---- */
  film: `<rect x="2.8" y="4.4" width="18.4" height="15.2" rx="2.4" fill="none" stroke="currentColor" stroke-width="1.6"/>${S("M7.6 4.4v15.2M16.4 4.4v15.2M2.8 9.6h4.8M16.4 9.6h4.8M2.8 14.4h4.8M16.4 14.4h4.8")}`,
  tv: `<rect x="2.6" y="7" width="18.8" height="12.6" rx="2.4" fill="none" stroke="currentColor" stroke-width="1.6"/>${S("M8.4 3.2 12 7l3.6-3.8")}`,
  broadcast: CIRC(12, 12, 2.4) + S("M8.4 8.4a5 5 0 0 0 0 7.2M15.6 8.4a5 5 0 0 1 0 7.2") + S("M5.6 5.6a9 9 0 0 0 0 12.8M18.4 5.6a9 9 0 0 1 0 12.8"),
  play: F("M8.6 4.9a1 1 0 0 1 1.52-.85l9.32 5.9a1.2 1.2 0 0 1 0 2.04l-9.32 5.9A1 1 0 0 1 8.6 17Z"),
  video: `<rect x="2.6" y="6" width="13.4" height="12" rx="2.6" fill="none" stroke="currentColor" stroke-width="1.6"/>${S("M16 10.4 21.4 7v10L16 13.6")}`,
  mic: `<rect x="9.2" y="2.6" width="5.6" height="11" rx="2.8" fill="none" stroke="currentColor" stroke-width="1.6"/>${S("M5.6 11.4a6.4 6.4 0 0 0 12.8 0M12 17.8V21M8.6 21h6.8")}`,
  image: `<rect x="3" y="4.4" width="18" height="15.2" rx="2.4" fill="none" stroke="currentColor" stroke-width="1.6"/>${CIRC(8.6, 9.6, 1.6)}${S("M3.6 17.6 9.4 12l4 4 3-2.8 4 4.4")}`,
  file: S("M13.6 3.4H7.4A2 2 0 0 0 5.4 5.4v13.2a2 2 0 0 0 2 2h9.2a2 2 0 0 0 2-2V8.6z") + S("M13.4 3.6v5h5.2"),
  article: S("M13.6 3.4H7.4A2 2 0 0 0 5.4 5.4v13.2a2 2 0 0 0 2 2h9.2a2 2 0 0 0 2-2V8.6z") + S("M13.4 3.6v5h5.2M8.8 12.6h6.4M8.8 16.2h4.4"),
  help: CIRC(12, 12, 8.4) + S("M9.6 9.4a2.6 2.6 0 0 1 5 1c0 1.7-2.6 2-2.6 3.8") + `<circle cx="12" cy="17.4" r=".95" fill="currentColor"/>`,
  star: F("M12 2.9l2.66 5.6 6.14.86-4.48 4.3 1.1 6.08L12 16.86l-5.42 2.88 1.1-6.08-4.48-4.3 6.14-.86Z"),
  fire: F("M12.6 2.2c.5 3.3 3 4.4 4.3 6.6 1 1.7 1.1 3.9.2 5.7a5.6 5.6 0 0 1-10-1c-.6-2 .2-3.9 1.4-5.1.1 1.4.7 2.4 1.7 2.8-.2-3.4.6-6.6 2.4-9Z"),
  cart: CIRC(9.4, 19.4, 1.5) + CIRC(17.4, 19.4, 1.5) + S("M3 4h2.2l2.6 11.2h10.4L20.6 8H6.2"),
  gavel: S("M13.4 3.2 20.8 10.6M10.4 6.2l4.6 4.6M12.6 4.4 4.4 12.6l2.4 2.4 8.2-8.2zM9.4 15.6l3 3M3.4 21.2h9"),
  bank: S("M3 9.6 12 4l9 5.6") + S("M5.4 10.4v8M10 10.4v8M14 10.4v8M18.6 10.4v8M3.4 20.8h17.2"),
  gift: `<rect x="3.4" y="8.6" width="17.2" height="4.4" rx="1.2" fill="none" stroke="currentColor" stroke-width="1.6"/><rect x="5" y="13" width="14" height="7.6" rx="1.2" fill="none" stroke="currentColor" stroke-width="1.6"/>${S("M12 8.6v12M12 8.6C10 8.6 7 7.8 7 6a2 2 0 0 1 3.6-1.2c.9 1 1.4 2.4 1.4 3.8ZM12 8.6c2 0 5-.8 5-2.6a2 2 0 0 0-3.6-1.2c-.9 1-1.4 2.4-1.4 3.8Z")}`,
  tasks: `<rect x="3.6" y="3.6" width="16.8" height="16.8" rx="4" fill="none" stroke="currentColor" stroke-width="1.6"/>${S("M8 12.2l2.6 2.6L16.4 9")}`,
  info: CIRC(12, 12, 8.6) + S("M12 11v5.4") + `<circle cx="12" cy="8.1" r=".95" fill="currentColor"/>`,
  shield: S("M12 3.2 19 6v6.1c0 4.4-2.9 7.3-7 8.7-4.1-1.4-7-4.3-7-8.7V6z") + S("M9.2 12.1l2.1 2.1 3.8-4"),
  scale: S("M12 4.2v15.6M7.4 20h9.2M5 9.4h14M12 5.6 5 9.4M12 5.6l7 3.8") + S("M5 9.4 3 14.2a2.2 2.2 0 0 0 4 0zM19 9.4l-2 4.8a2.2 2.2 0 0 0 4 0z"),
  mail: `<rect x="2.8" y="5" width="18.4" height="14" rx="2.6" fill="none" stroke="currentColor" stroke-width="1.6"/>${S("M3.6 7 12 13l8.4-6")}`,
  lifebuoy: CIRC(12, 12, 8.4) + CIRC(12, 12, 3.4) + S("M6.4 6.4l3.4 3.4M17.6 6.4l-3.4 3.4M17.6 17.6l-3.4-3.4M6.4 17.6l3.4-3.4"),
  download: S("M12 3.6v11.2M7.6 10.8 12 15.2l4.4-4.4M4.4 20.4h15.2"),
  upload: S("M12 20.4V9.2M7.6 13.2 12 8.8l4.4 4.4M4.4 3.6h15.2"),
  send: S("M20.6 3.4 3.6 10.2l7 2.6 2.6 7z") + S("M20.6 3.4 10.6 12.8"),
  globe: CIRC(12, 12, 8.6) + S("M3.4 12h17.2") + S("M12 3.4c2.6 2.6 2.6 14.6 0 17.2-2.6-2.6-2.6-14.6 0-17.2Z"),
  windows: F("M3.2 4.7 10.6 3.6v7.7H3.2zM12.1 3.4 20.8 2v9.3h-8.7zM3.2 12.6h7.4v7.7L3.2 19.2zM12.1 12.6h8.7V22l-8.7-1.2z"),
  apple: null, // filled brand, injected from brands.js when needed
  linux: null,
  android: null,
  appletv: null,
  smartphone: `<rect x="6.4" y="2.4" width="11.2" height="19.2" rx="3" fill="none" stroke="currentColor" stroke-width="1.6"/>${S("M10.6 18.6h2.8")}`,
  monitor: `<rect x="2.6" y="4" width="18.8" height="12.8" rx="2.4" fill="none" stroke="currentColor" stroke-width="1.6"/>${S("M8.4 20.6h7.2M12 16.8v3.8")}`,
  database: `<ellipse cx="12" cy="6" rx="7.6" ry="3.2" fill="none" stroke="currentColor" stroke-width="1.6"/>${S("M4.4 6v12c0 1.8 3.4 3.2 7.6 3.2s7.6-1.4 7.6-3.2V6M4.4 12c0 1.8 3.4 3.2 7.6 3.2s7.6-1.4 7.6-3.2")}`,
  sun: CIRC(12, 12, 4.2) + S("M12 2.6v2.2M12 19.2v2.2M4.4 12H2.2M21.8 12h-2.2M6.3 6.3 4.8 4.8M19.2 19.2l-1.5-1.5M17.7 6.3l1.5-1.5M4.8 19.2l1.5-1.5"),
  moon: S("M20 14.6A8.4 8.4 0 0 1 9.4 4a8.6 8.6 0 1 0 10.6 10.6Z"),
  dots: `<circle cx="5.4" cy="12" r="1.6" fill="currentColor"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/><circle cx="18.6" cy="12" r="1.6" fill="currentColor"/>`,
  trash: S("M4.4 6.6h15.2M9.4 6.6V4.4h5.2v2.2M6.6 6.6l.9 13a1.6 1.6 0 0 0 1.6 1.4h5.8a1.6 1.6 0 0 0 1.6-1.4l.9-13"),
  filter: S("M3.6 5.4h16.8l-6.6 7.6v6.2l-3.6-2.2v-4z"),
  refresh: S("M19.6 12a7.6 7.6 0 0 1-12.9 5.4L3.6 14.6M4.4 12a7.6 7.6 0 0 1 12.9-5.4l3.1 2.8") + S("M3.6 19.4v-4.8h4.8M20.4 4.6v4.8h-4.8"),
  crown: F("M3 8.2l4.2 3L12 4.2l4.8 7 4.2-3-1.9 11.2H4.9Z"),
  gem: S("M7 3.4h10l3.6 5.2L12 20.6 3.4 8.6z") + S("M3.6 8.6h16.8M9 3.6l3 16.8M15 3.6l-3 16.8"),
  medal: CIRC(12, 9, 5.2) + S("M8.2 13.4 6.2 21l5.8-3 5.8 3-2-7.6"),
  sparkle: F(
    "M12 2.6l1.72 5.18 5.18 1.72-5.18 1.72L12 16.4l-1.72-5.18L5.1 9.5l5.18-1.72Zm6.4 12.2.9 2.5 2.5.9-2.5.9-.9 2.5-.9-2.5-2.5-.9 2.5-.9Zm-12.8 0 .9 2.5 2.5.9-2.5.9-.9 2.5-.9-2.5L2.2 18l2.5-.9Z"
  ),
};

export function icon(name, cls = "ico") {
  const body = ICONS[name];
  if (!body) return "";
  return `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${body}</svg>`;
}

/** Replace every <i data-icon="name"> with a real inline SVG (same classes). */
export function hydrateIcons(root = document) {
  root.querySelectorAll("[data-icon]").forEach((el) => {
    const body = ICONS[el.getAttribute("data-icon")];
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    if (!body) {
      el.remove();
      return;
    }
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    svg.setAttribute("class", `${el.getAttribute("class") || ""} ico`.trim());
    svg.innerHTML = body;
    el.replaceWith(svg);
  });
}
