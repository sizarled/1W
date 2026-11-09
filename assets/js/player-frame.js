/**
 * player-frame.js — steering a player we do not own.
 * ------------------------------------------------------------------
 * A chapter is a second in a file, and a file that plays inside somebody
 * else's `<iframe>` is not ours to seek: the frame is another document, on
 * another origin, and `video.currentTime` does not reach across it.
 *
 * What does reach across is a conversation. The **player.js** spec is a small
 * `postMessage` protocol most embedded players speak: the page asks
 * `setCurrentTime`, `play`, `pause`, `getDuration`; the player answers with
 * `ready`, `timeupdate`, `ended`. Streamtape's player speaks it, which is why
 * a chapter list works on a video hosted there.
 *
 * The library is vendored (`assets/js/vendor/player-0.1.0.min.js`, BSD,
 * Embed.ly) rather than pulled from a CDN: the site must keep working when a
 * third-party CDN does not, and a page load should not depend on one. It is
 * brought in the first time a frame is actually steered, and never before —
 * a page with a `<video>` or a YouTube frame does not pay for it.
 *
 * Everything here is patient and honest:
 *
 *   • a frame that never says `ready` is not pretended to have seeked — the
 *     call answers `false`, and the caller says so in words;
 *   • the same frame is bridged once, and the second ask is instant;
 *   • nothing throws out of this file: a caller gets `false`, `null`, or a
 *     stop function, never an exception climbing into a click handler.
 *
 * The bridge is not a replacement for the platform's own words. YouTube reads
 * `&t=90s` and Vimeo reads `#t=90s`, and those are written into the address
 * instead; player.js is for the frames that offer no such word.
 */

/** Where the vendored conversation lives, beside this file. */
const LIBRARY = new URL("./vendor/player-0.1.0.min.js", import.meta.url).href;

/** How long a frame is given to say `ready` before it is called silent. */
const PATIENCE = 2500;

let loading = null;

/**
 * The `playerjs` namespace, loaded once.
 *
 * The script sets a global; a page that already loaded it (or a test that
 * planted one) is answered without touching the network. A failure is
 * remembered, so a browser that cannot load the file is not asked again on
 * every click.
 */
function loadBridge() {
  const planted = globalThis.playerjs;
  if (planted) return Promise.resolve(planted);
  if (loading) return loading;
  loading = new Promise((resolve, reject) => {
    if (typeof document === "undefined") {
      reject(new Error("no document"));
      return;
    }
    const tag = document.createElement("script");
    tag.src = LIBRARY;
    tag.async = true;
    tag.onload = () => {
      if (globalThis.playerjs) resolve(globalThis.playerjs);
      else reject(new Error("the library loaded but said nothing"));
    };
    tag.onerror = () => reject(new Error("the library did not load"));
    document.head.appendChild(tag);
  });
  /* a rejected promise kept for the next caller must not be an unhandled one,
     and a library that failed to load is retried by the next click rather than
     refused for the rest of the visit */
  loading.catch(() => {
    loading = null;
  });
  return loading;
}

/** One bridge per frame: the conversation is not opened twice. */
const bridges = new WeakMap();

function bridgeFor(frame) {
  if (bridges.has(frame)) return bridges.get(frame);
  const record = { frame, player: null, error: null };
  record.ready = loadBridge()
    .then(
      (playerjs) =>
        new Promise((resolve, reject) => {
          const player = new playerjs.Player(frame);
          record.player = player;
          const timer = setTimeout(() => settle(new Error("the frame did not answer")), PATIENCE);
          /* a frame that said `ready` in the instant between being painted and
             being bridged is still ready: the flag is read as well as the word */
          const poll = setInterval(() => {
            if (player.isReady) settle(null);
          }, 120);
          function settle(error) {
            clearTimeout(timer);
            clearInterval(poll);
            if (error) reject(error);
            else resolve(player);
          }
          try {
            player.on("ready", () => settle(null));
            player.on("error", () => settle(new Error("the frame answered with an error")));
          } catch {
            settle(new Error("the frame refused the bridge"));
          }
        })
    )
    .catch((error) => {
      record.error = error;
      /* a frame that was silent once may answer on a later click — a slow
         player is not a broken one, so the record is dropped and the next
         ask starts a fresh conversation */
      bridges.delete(frame);
      throw error;
    });
  record.ready.catch(() => {});
  bridges.set(frame, record);
  return record;
}

/**
 * Ask a frame to jump to `seconds`, and — when `play` is asked for — to keep
 * playing from there. Answers `true` only when the frame itself said `ready`.
 *
 * `seconds` of 0 is a real place (the beginning), so it is not treated as
 * "nothing asked".
 */
export async function seekFrame(frame, seconds, { play = false } = {}) {
  const at = Math.floor(Number(seconds));
  if (!frame || !Number.isFinite(at) || at < 0) return false;
  /* a frame that has been taken off the page has nobody to ask */
  if (frame.isConnected === false) return false;
  try {
    const player = await bridgeFor(frame).ready;
    player.setCurrentTime(at);
    if (play) player.play();
    return true;
  } catch {
    return false;
  }
}

/**
 * Follow a frame's playhead: `onTick({ seconds, duration })` on every
 * `timeupdate`, and once more on `ready` so a chapter list is marked before
 * the first tick. Answers a stop function, safe to call more than once.
 */
export async function followFrame(frame, onTick) {
  if (!frame || typeof onTick !== "function" || frame.isConnected === false) return () => {};
  let live = true;
  const stop = () => {
    live = false;
  };
  try {
    const player = await bridgeFor(frame).ready;
    const handle = (payload) => {
      if (!live) return;
      const data = payload && typeof payload === "object" ? payload : {};
      const seconds = Number(data.seconds);
      if (!Number.isFinite(seconds)) return;
      onTick({ seconds, duration: Number(data.duration) || 0 });
    };
    player.on("timeupdate", handle);
    player.on("seeked", handle);
    try {
      player.getCurrentTime((seconds) => handle({ seconds }));
    } catch {
      /* a frame without `getCurrentTime` is followed by its ticks alone */
    }
    return () => {
      stop();
      try {
        player.off("timeupdate", handle);
        player.off("seeked", handle);
      } catch {
        /* the player is gone with the frame */
      }
    };
  } catch {
    return stop;
  }
}

/** Whether a frame has already answered on this page — mostly for tests. */
export function bridged(frame) {
  const record = bridges.get(frame);
  return Boolean(record && record.player);
}
