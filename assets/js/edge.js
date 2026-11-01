/**
 * Edge rail — a sidebar that leaves the screen and comes back from its edge.
 *
 * Two states, one preference:
 *
 *   pinned    the panel stays out, the page keeps room for it;
 *   unpinned  the panel is gone and the page uses the whole width — moving the
 *             pointer to the left edge (or onto the edge tab) slides it back in
 *             *over* the content, and it leaves again as soon as the pointer
 *             moves away from it.
 *
 * The preference lives in `1w.sidebar.pin`, so pinning the menu on one page
 * pins it on the next one. Below 1024px the sidebar stays a drawer driven by
 * the header menu button and the scrim — there is no edge to reach with a
 * finger, and the pin control is hidden.
 *
 * Usage:
 *
 *   const rail = createEdgeRail({
 *     panel,                              // the <aside>
 *     tab,                                // the button pinned to the edge
 *     pins: "[data-sidebar-pin]",         // every pin toggle inside the panel
 *     onOpen, onClose, onPin,             // paint the page
 *   });
 *   rail.reveal(); rail.hide(); rail.togglePin(); rail.close();
 */
import { store } from "./utils.js";
import { icon } from "./icons.js";

export const PIN_KEY = "1w.sidebar.pin";
const LEGACY_KEY = "1w.sidebar";

/** The edge only exists on a desktop pointer. */
export function isDesktop() {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(min-width: 1024px)").matches;
}

/**
 * The saved pin. Without one, the old open/closed preference decides, and if
 * that is missing the page says what it wants: the homepage starts pinned, the
 * player, the profile and the dashboard start on the edge.
 */
export function storedPin(defaultPinned = false) {
  const saved = store.get(PIN_KEY, null);
  if (saved === "1" || saved === true) return true;
  if (saved === "0" || saved === false) return false;
  const legacy = store.get(LEGACY_KEY, null);
  if (legacy !== null) return Boolean(legacy);
  return Boolean(defaultPinned) && isDesktop();
}

function savePin(pinned) {
  store.set(PIN_KEY, pinned ? "1" : "0");
}

/* One name for the toggle, its state in `aria-pressed`; the tooltip says what
   the click does and the little text says where the panel is right now. */
const PIN_NAME = "Pin the menu";
const PIN_TITLE = {
  on: "Pinned — the menu stays open. Click to let it hide until the pointer reaches the screen edge.",
  off: "On hover — the menu slides in when the pointer reaches the screen edge. Click to pin it open.",
};
const PIN_TEXT = { on: "Pinned", off: "On hover" };

/**
 * @param {object} opts
 * @param {HTMLElement|null} opts.panel  the sidebar itself
 * @param {HTMLElement|null} opts.tab    the sliver sitting on the screen edge
 * @param {HTMLElement|null} opts.root   element carrying the state attributes
 * @param {string} [opts.pinSelector]    selector for the pin toggles
 * @param {string} [opts.revealAttr]     dataset key flipped while revealed
 * @param {string} [opts.openClass]      body class while the panel is out
 * @param {string} [opts.pinnedClass]    body class while it is pinned
 * @param {string} [opts.railClass]      body class while it waits on the edge
 * @param {(open:boolean)=>void} [opts.onOpen]
 * @param {(open:boolean)=>void} [opts.onClose]
 * @param {(pinned:boolean)=>void} [opts.onPin]
 * @param {number} [opts.edgePx]         how close to the edge counts as "at the edge"
 */
export function createEdgeRail({
  panel,
  tab,
  root = null,
  pinSelector = "[data-sidebar-pin]",
  revealAttr = "sideReveal",
  openClass = "sb-open",
  pinnedClass = "sb-pinned",
  railClass = "sb-rail",
  onOpen,
  onClose,
  onPin,
  defaultPinned = false,
  edgePx = 34,
} = {}) {
  let pinned = storedPin(defaultPinned);
  let open = false;
  let hideTimer = 0;

  const stateRoot = root || panel;

  const paint = (next) => {
    open = next;
    document.body.classList.toggle(openClass, next);
    panel?.classList.toggle("is-open", next);
    panel?.setAttribute("aria-hidden", String(!next));
    // a page root only carries the reveal flag — it is never hidden itself
    if (stateRoot && stateRoot !== panel) stateRoot.dataset[revealAttr] = next ? "on" : "off";
    tab?.setAttribute("aria-expanded", String(next));
    (next ? onOpen : onClose)?.({ open: next, pinned });
  };

  const setOpen = (next) => {
    clearTimeout(hideTimer);
    if (next === open) return;
    paint(next);
  };

  /* The panel is anchored to the left edge, so its own width is a better
     "am I on the menu?" test than the animated rect: mid-slide the rect is
     still off-screen, and a pointer that has already moved to where the menu
     is appearing must not close it. */
  const nearPanel = (event) => {
    if (!panel) return false;
    if (panel.contains(event.target)) return true;
    const width = panel.offsetWidth || 0;
    if (!width) return false;
    return event.clientX <= width + 12 && event.clientY >= panel.getBoundingClientRect().top - 4;
  };

  const onMove = (event) => {
    if (pinned || !isDesktop()) return;
    if (event.clientX <= edgePx || nearPanel(event)) {
      clearTimeout(hideTimer);
      if (!open) setOpen(true);
      return;
    }
    if (!open) return;
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => setOpen(false), 320);
  };

  const onFocusIn = (event) => {
    if (pinned || !isDesktop() || !panel) return;
    if (panel.contains(event.target) && !open) setOpen(true);
  };

  /* ---- pin -------------------------------------------------------- */

  const paintPins = () => {
    const state = pinned ? "on" : "off";
    document.querySelectorAll(pinSelector).forEach((btn) => {
      btn.setAttribute("aria-pressed", String(pinned));
      btn.setAttribute("aria-label", PIN_NAME);
      btn.setAttribute("title", PIN_TITLE[state]);
      btn.classList.toggle("is-on", pinned);
      const glyph = btn.querySelector("[data-pin-glyph]");
      if (glyph) glyph.innerHTML = icon(pinned ? "pin" : "pinOff");
      btn.querySelectorAll("[data-pin-text]").forEach((el) => {
        el.textContent = PIN_TEXT[state];
      });
    });
    document.body.classList.toggle(pinnedClass, pinned);
    document.body.classList.toggle(railClass, !pinned);
    // `data-pin` on the page root, never `data-side-pin` — that is the button itself
    if (stateRoot && stateRoot !== panel) stateRoot.dataset.pin = pinned ? "on" : "off";
  };

  const setPinned = (next) => {
    pinned = Boolean(next);
    savePin(pinned);
    paintPins();
    onPin?.(pinned);
    if (pinned) setOpen(true);
    else setOpen(false);
  };

  /* ---- wiring ------------------------------------------------------ */

  paintPins();
  // a saved pin opens the panel on a desktop only: below the breakpoint the
  // panel is a drawer and starts closed, whatever the pin says
  paint(pinned && isDesktop());

  document.addEventListener("mousemove", onMove, { passive: true });
  document.addEventListener("focusin", onFocusIn);
  document.addEventListener("mouseleave", () => {
    if (!pinned) setOpen(false);
  });

  tab?.addEventListener("click", () => setOpen(!open));
  tab?.addEventListener("mouseenter", () => {
    if (!pinned) setOpen(true);
  });

  document.addEventListener("click", (event) => {
    const pin = event.target.closest(pinSelector);
    if (!pin) return;
    event.preventDefault();
    setPinned(!pinned);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || pinned || !open) return;
    setOpen(false);
  });

  window.addEventListener("resize", () => {
    if (!isDesktop()) setOpen(false);
    else if (pinned) setOpen(true);
  });

  return {
    get pinned() {
      return pinned;
    },
    get open() {
      return open;
    },
    setPinned,
    togglePin: () => setPinned(!pinned),
    reveal: () => setOpen(true),
    hide: () => setOpen(false),
    toggle: () => setOpen(!open),
    /** re-paint after a page changed the panel markup */
    sync: () => {
      paintPins();
      paint(pinned ? true : open);
    },
  };
}
