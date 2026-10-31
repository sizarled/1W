/**
 * Visitor IP + country lookup.
 * ------------------------------------------------------------------
 * The site is static, so the address of the visitor is resolved in the
 * browser by public geo-IP services (no key, CORS enabled):
 *
 *   1. ipwho.is    → ip, country, country code, city
 *   2. ipapi.co    → fallback with the same fields
 *   3. api.ipify.org → address only, when both geo services are down
 *
 * The answer is cached in memory and in sessionStorage for six hours, so a
 * visitor browsing ten pages asks the service once. Every failure is silent:
 * a blocked or slow lookup must never delay or break the page.
 */

const CACHE_KEY = "1w.geo";
const CACHE_TTL = 6 * 3600 * 1000; // six hours
const TIMEOUT = 3500; // per provider

const PROVIDERS = [
  {
    name: "ipwho.is",
    url: "https://ipwho.is/?fields=success,ip,country,country_code,city",
    pick: (data) =>
      data && data.success !== false && data.ip
        ? { ip: data.ip, country: data.country || null, code: data.country_code || null, city: data.city || null }
        : null,
  },
  {
    name: "ipapi.co",
    url: "https://ipapi.co/json/",
    pick: (data) =>
      data && data.ip
        ? {
            ip: data.ip,
            country: data.country_name || null,
            code: data.country_code || null,
            city: data.city || null,
          }
        : null,
  },
  {
    name: "ipify",
    url: "https://api.ipify.org?format=json",
    pick: (data) => (data && data.ip ? { ip: data.ip, country: null, code: null, city: null } : null),
  },
];

let pending = null; // one lookup per page load, shared by every caller

function readCache() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(CACHE_KEY) || "null");
    if (saved && saved.ip && Date.now() - (saved.at || 0) < CACHE_TTL) return saved;
  } catch {
    /* ignore */
  }
  return null;
}

function writeCache(result) {
  try {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify({ ...result, at: Date.now() }));
  } catch {
    /* private mode */
  }
}

async function ask(provider) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT);
  try {
    const res = await fetch(provider.url, {
      signal: controller.signal,
      mode: "cors",
      cache: "no-store",
      credentials: "omit",
      referrerPolicy: "no-referrer",
    });
    if (!res.ok) return null;
    const data = await res.json();
    const picked = provider.pick(data);
    return picked ? { ...picked, provider: provider.name } : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Resolves the visitor address / country; never throws, never blocks for long. */
export function lookupVisitor() {
  const cached = readCache();
  if (cached) return Promise.resolve(cached);
  if (pending) return pending;

  pending = (async () => {
    for (const provider of PROVIDERS) {
      const found = await ask(provider);
      if (found && found.ip) {
        writeCache(found);
        return found;
      }
    }
    return null;
  })();

  return pending;
}

/** Same as lookupVisitor(), but gives up after `ms` so the page never waits. */
export async function lookupVisitorFast(ms = 2500) {
  const timeout = new Promise((resolve) => setTimeout(() => resolve(null), ms));
  return Promise.race([lookupVisitor(), timeout]);
}

/** Cached answer, if the browser already asked during this session. */
export function cachedVisitor() {
  return readCache();
}
