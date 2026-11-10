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

/* A gesture unlocks the browser's audio, not the seven sounds.
 *
 * This used to build all seven players and play each one at volume 0 the first
 * time a finger touched the page — seven MP3s on the wire before the visitor had
 * asked for a single sound. One 44-byte silent WAV spends the gesture now; a
 * sound is fetched the first time it is actually played, and never before. */
const SILENT =
  "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAgD4AAIA+AAABAAgAZGF0YQAAAAA=";

function unlock() {
  if (unlocked) return;
  unlocked = true;
  try {
    const silent = new Audio(SILENT);
    silent.volume = 0;
    const p = silent.play();
    if (p && p.then) p.then(() => { silent.pause(); }).catch(() => {});
  } catch {
    /* a browser that refuses the silent note will ask again on the next press */
    unlocked = false;
  }
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
