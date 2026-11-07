/**
 * UI sound engine.
 * Sounds live in the public `source` bucket of the 1World Supabase project.
 * Browsers block audio until the first gesture, so we "unlock" the pool on
 * the first click / key press.
 */
import { SOUNDS } from "./config.js";
import { store } from "./utils.js";

const KEY = "1w.sound";
const pool = new Map();
let enabled = store.get(KEY, true);
let unlocked = false;

function el(name) {
  const src = SOUNDS[name];
  if (!src) return null;
  if (!pool.has(name)) {
    const audio = new Audio();
    audio.preload = "auto";
    audio.src = src;
    audio.volume = 0.5;
    pool.set(name, audio);
  }
  return pool.get(name);
}

function unlock() {
  if (unlocked) return;
  unlocked = true;
  Object.keys(SOUNDS).forEach((name) => {
    const audio = el(name);
    if (!audio) return;
    const prev = audio.volume;
    audio.volume = 0;
    const p = audio.play();
    if (p && p.catch) p.catch(() => {});
    setTimeout(() => {
      audio.pause();
      audio.currentTime = 0;
      audio.volume = prev;
    }, 30);
  });
}

["pointerdown", "keydown", "touchstart"].forEach((evt) =>
  window.addEventListener(evt, unlock, { once: true, passive: true })
);

export function playSound(name, volume = 0.5) {
  if (!enabled) return;
  const audio = el(name);
  if (!audio) return;
  try {
    audio.volume = volume;
    audio.currentTime = 0;
    const p = audio.play();
    if (p && p.catch) p.catch(() => {});
  } catch {
    /* ignore */
  }
}

export function soundOn() {
  return enabled;
}

export function toggleSound(force) {
  enabled = typeof force === "boolean" ? force : !enabled;
  store.set(KEY, enabled);
  if (enabled) {
    unlocked = false;
    unlock();
  }
  return enabled;
}
