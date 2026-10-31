/** Toasts, dialogs and other tiny UI primitives shared by every page. */
import { icon } from "./icons.js";
import { esc } from "./utils.js";
import { playSound } from "./sound.js";

let host;

function toastHost() {
  if (host && document.body.contains(host)) return host;
  host = document.createElement("div");
  host.className = "toast-host";
  host.setAttribute("role", "status");
  host.setAttribute("aria-live", "polite");
  document.body.appendChild(host);
  return host;
}

/**
 * Show a toast.
 * @param {object} opts
 * @param {string} opts.title
 * @param {string} [opts.message]
 * @param {"info"|"success"|"error"|"points"|"level"} [opts.tone]
 * @param {string} [opts.iconName]
 * @param {string|number} [opts.badge]   – big number on the right (e.g. "+120")
 * @param {number} [opts.duration]       – ms before auto dismiss (0 = sticky)
 * @param {string} [opts.sound]          – sound key to play
 */
export function toast({
  title,
  message = "",
  tone = "info",
  iconName,
  badge,
  duration = 5600,
  sound,
  action,
} = {}) {
  if (sound) playSound(sound);

  const node = document.createElement("div");
  node.className = `toast toast--${tone}`;
  node.innerHTML = `
    <span class="toast__icon">${icon(iconName || (tone === "error" ? "close" : tone === "points" ? "zap" : tone === "level" ? "arrowUpRight" : "check"))}</span>
    <div class="toast__body">
      <p class="toast__title">${esc(title)}</p>
      ${message ? `<p class="toast__msg">${esc(message)}</p>` : ""}
      ${action ? `<a class="toast__action" href="${esc(action.href)}">${esc(action.label)}</a>` : ""}
    </div>
    ${badge !== undefined ? `<span class="toast__badge">${esc(badge)}</span>` : ""}
    <button class="toast__close" type="button" aria-label="Dismiss">${icon("close")}</button>
    ${duration ? `<span class="toast__timer" style="--t:${duration}ms"></span>` : ""}
  `;

  const remove = () => {
    node.classList.add("is-leaving");
    setTimeout(() => node.remove(), 260);
  };
  node.querySelector(".toast__close").addEventListener("click", remove);
  toastHost().prepend(node);

  requestAnimationFrame(() => node.classList.add("is-in"));
  if (duration) setTimeout(remove, duration);
  return node;
}

/** The signature "+points" banner described in the brief. */
export function pointsToast(delta, reason = "") {
  const value = Number(delta) || 0;
  return toast({
    tone: "points",
    iconName: value < 0 ? "minus" : "zap",
    title: "The following points have been added to your points",
    message: reason ? `${reason} · Balance updated` : "Balance updated",
    badge: `${value > 0 ? "+" : ""}${value} pts`,
    sound: value < 0 ? "error" : "addPoint",
    duration: 6500,
  });
}

export function levelToast(level) {
  return toast({
    tone: "level",
    iconName: "arrowUpRight",
    title: `Level up — you are now LV${level}`,
    message: "New rewards are unlocked in the market.",
    sound: "uplevel",
    duration: 6000,
  });
}

export function errorToast(title, message = "") {
  return toast({ tone: "error", title, message, sound: "error" });
}
