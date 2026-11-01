/**
 * Edge rail — a sidebar that leaves the screen and comes back from its edge.
 *
 * Two states, one preference:
 *
 *   pinned    the panel stays out, the page keeps room for it;
 *   unpinned  the panel is gone and the page uses the whole width — the pointer
 *             must touch the very last pixels of the left edge and rest there
 *             for a moment (or press the edge tab) before the panel slides in
 *             *over* the content; it leaves again as soon as the pointer moves
 *             away from it.
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
/* A stored choice is only trusted from this build on: the old `1w.sidebar` flag
   was the homepage's "is the panel open" switch (written when the panel was
   closed), and an early build of the pin let a "0" hide the dashboard menu for
   good. One stale value must never be the reason a menu is missing. */
const PIN_VERSION_KEY = "1w.sidebar.pin.v";
const PIN_VERSION = "2";

/** The edge only exists on a desktop pointer. */
export function isDesktop() {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(min-width: 1024px)").matches;
}

/**
 * The saved pin, or the page's own default: the homepage, the profile and the
 * dashboard start pinned, the player starts on the edge. The legacy
 * `1w.sidebar` flag is deliberately ignored — it was written by the old menu
 * button when a panel was *closed*, so reading it hid every menu at once.
 */
export function storedPin(defaultPinned = false) {
  const fresh = store.get(PIN_VERSION_KEY, null) === PIN_VERSION;
  const saved = fresh ? store.get(PIN_KEY, null) : null;
  if (saved === "1" || saved === true) return true;
  if (saved === "0" || saved === false) return false;
  return Boolean(defaultPinned) && isDesktop();
}

function savePin(pinned) {
  store.set(PIN_KEY, pinned ? "1" : "0");
  store.set(PIN_VERSION_KEY, PIN_VERSION);
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
 * @param {number} [opts.edgePx]         how close to the edge counts as "at the edge" (2px)
 * @param {number} [opts.edgeDwell]      how long the pointer must stay there (180ms)
 * @param {number} [opts.hideDelay]      how long it lingers after the pointer leaves (320ms)
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
  // only the last couple of pixels of the screen count as "the edge": a menu
  // that jumps out 30px away covers the content the pointer was aiming at
  edgePx = 2,
  // and the pointer has to stay there for a moment, so crossing the edge on the
  // way to something else never pops the menu open
  edgeDwell = 180,
  hideDelay = 320,
} = {}) {
  let pinned = storedPin(defaultPinned);
  let open = false;
  let hideTimer = 0;
  let edgeTimer = 0;

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
    clearTimeout(edgeTimer);
    edgeTimer = 0;
    if (next === open) return;
    paint(next);
  };

  /* "Am I on the menu?" — only asked while the menu is actually out. Asking it
     while the panel is closed turned the whole left band of the page into the
     trigger (the panel still has a width while it hides off-screen), which is
     exactly the annoyance the edge is meant to avoid.
     Once it is open, its own width beats the animated rect: mid-slide the rect
     is still off-screen, and a pointer that already moved to where the menu is
     appearing must not close it. */
  const nearPanel = (event) => {
    if (!panel || !open) return false;
    if (panel.contains(event.target)) return true;
    const rect = panel.getBoundingClientRect();
    const width = panel.offsetWidth || 0;
    if (!width) return false;
    return (
      event.clientX <= width + 12 &&
      event.clientY >= rect.top - 4 &&
      event.clientY <= rect.bottom + 4
    );
  };

  const onMove = (event) => {
    if (pinned || !isDesktop()) return;

    // over the open menu (or just beside it): keep it out
    if (nearPanel(event)) {
      clearTimeout(hideTimer);
      clearTimeout(edgeTimer);
      edgeTimer = 0;
      if (!open) setOpen(true);
      return;
    }

    // touching the very edge: wait for the pointer to settle before revealing
    if (event.clientX <= edgePx) {
      clearTimeout(hideTimer);
      if (!open && !edgeTimer) {
        edgeTimer = setTimeout(() => {
          edgeTimer = 0;
          setOpen(true);
        }, edgeDwell);
      }
      return;
    }

    // anywhere else: the promise is cancelled, and an open menu goes away
    clearTimeout(edgeTimer);
    edgeTimer = 0;
    if (!open) return;
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => setOpen(false), hideDelay);
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
