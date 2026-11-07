/**
 * The device id — one module, one shape, one value.
 * ------------------------------------------------------------------
 * Four places need to agree on "which device is this":
 *   · `activated.html` binds a viewing code to it (`viewing_codes.device_mac`,
 *     `watch_code_devices.device_id`) — that code is the device's **original**
 *     code and stays bound to it;
 *   · the player sends it with every code check;
 *   · the recovery page needs the same value to accept the no-code path;
 *   · the dashboard lists the devices behind the codes.
 *
 * The shape is a MAC — `9E:3D:EB:E8:B8:50` — because that is what the activation
 * wizard has always written, and because a second format is how an id gets
 * regenerated behind a binding that already exists. A stored value is never
 * rewritten: whatever is in `1w.device` is returned as it is, so a device that
 * was bound before this module existed keeps working.
 */

const KEY = "1w.device";
const MAC = /^([0-9A-F]{2}:){5}[0-9A-F]{2}$/;

function read() {
  try {
    return String(localStorage.getItem(KEY) || "").trim();
  } catch {
    return "";
  }
}

function make() {
  const bytes = [];
  const source = globalThis.crypto && globalThis.crypto.getRandomValues ? globalThis.crypto : null;
  if (source) {
    const buffer = new Uint8Array(6);
    source.getRandomValues(buffer);
    buffer.forEach((b) => bytes.push(b));
  } else {
    for (let i = 0; i < 6; i += 1) bytes.push(Math.floor(Math.random() * 256));
  }
  return bytes.map((b) => b.toString(16).toUpperCase().padStart(2, "0")).join(":");
}

/**
 * @param {{create?: boolean}} options `create: false` reads without ever writing —
 *   the recovery page must not invent an id, because an invented id can never
 *   match a binding.
 */
export function deviceId({ create = true } = {}) {
  const saved = read();
  if (saved) return saved;
  if (!create) return "";
  const id = make();
  try {
    localStorage.setItem(KEY, id);
  } catch {
    /* private mode: the id simply does not persist */
  }
  return id;
}

/** A readable name for the device, e.g. "Windows · Windows". */
export function deviceName() {
  const nav = typeof navigator === "undefined" ? {} : navigator;
  const platform = (nav.userAgentData && nav.userAgentData.platform) || nav.platform || "This browser";
  const ua = String(nav.userAgent || "");
  const kind = /Android/i.test(ua)
    ? "Android"
    : /iPhone|iPad|iPod/i.test(ua)
      ? "iOS"
      : /Windows/i.test(ua)
        ? "Windows"
        : /Mac/i.test(ua)
          ? "macOS"
          : /Linux/i.test(ua)
            ? "Linux"
            : "";
  return kind ? `${platform} · ${kind}` : String(platform);
}

/** Same value the database compares: upper case, letters and digits only. */
export function deviceKey(value = "") {
  return String(value).toUpperCase().replace(/[^0-9A-Z]/g, "");
}

/** True when the value already looks like a MAC, i.e. it is the current shape. */
export function isMac(value = "") {
  return MAC.test(String(value).trim().toUpperCase());
}
