/**
 * Appearance: dark ⇄ light.
 * ------------------------------------------------------------------
 * • First visit follows the operating system (prefers-color-scheme).
 * • An explicit choice is stored in `1w.theme` and wins from then on.
 * • The inline script in <head> applies the same rule before first paint,
 *   so there is never a flash of the wrong theme.
 */
import { store } from "./utils.js";

const KEY = "1w.theme";
const COLOR = { dark: "#060607", light: "#f4f4f5" };
const media = () => (window.matchMedia ? window.matchMedia("(prefers-color-scheme: light)") : null);

/** 'light' | 'dark' from the operating system. */
export function systemTheme() {
  return media()?.matches ? "light" : "dark";
}

/** The theme the user picked, or null when they never chose. */
export function storedTheme() {
  const value = store.get(KEY, null);
  return value === "light" || value === "dark" ? value : null;
}

export function currentTheme() {
  return document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
}

function paintMeta(theme) {
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", COLOR[theme]);
  document.documentElement.style.colorScheme = theme;
}

/** Apply without persisting (used for the initial + system-driven state). */
export function applyTheme(theme) {
  const next = theme === "light" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", next);
  paintMeta(next);
  return next;
}

/** Apply and remember the choice. */
export function setTheme(theme) {
  const next = applyTheme(theme);
  store.set(KEY, next);
  return next;
}

export function toggleTheme() {
  return setTheme(currentTheme() === "dark" ? "light" : "dark");
}

/** Back to following the OS. */
export function resetTheme() {
  store.remove(KEY);
  return applyTheme(systemTheme());
}

/**
 * Boot: honour the stored choice, otherwise the system preference,
 * and keep following the OS until the user makes a choice.
 */
export function initTheme() {
  applyTheme(storedTheme() || systemTheme());
  const mq = media();
  if (mq && mq.addEventListener) {
    mq.addEventListener("change", () => {
      if (!storedTheme()) applyTheme(systemTheme());
    });
  }
}

/** Brief transition window so switching feels deliberate, not jarring. */
export function flashTransition() {
  const root = document.documentElement;
  root.classList.add("is-theme-changing");
  window.clearTimeout(flashTransition._t);
  flashTransition._t = window.setTimeout(() => root.classList.remove("is-theme-changing"), 420);
}
