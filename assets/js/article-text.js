/**
 * The little that both sides of an article need to agree on.
 * ------------------------------------------------------------------
 * The editor writes HTML, the reader displays it, and the word count
 * decides the reading time the site prints everywhere. All three rules
 * live here so the two pages can never drift apart.
 *
 *   wordsIn(html)      words, with the tags stripped
 *   readingTime(html)  minutes, ceil(words / 200) — the site's rule
 *   firstImage(html)   the first <img src> in the piece, or ""
 *   sanitizeHtml(html) the same allowlist the editor can produce, and
 *                      nothing else: no scripts, no frames, no inline
 *                      handlers, no javascript: URLs
 */

const ALLOWED_TAGS = new Set([
  "P", "H2", "H3", "H4", "BLOCKQUOTE", "UL", "OL", "LI", "STRONG", "B", "EM", "I",
  "U", "S", "BR", "A", "IMG", "FIGURE", "FIGCAPTION", "HR", "CODE", "PRE", "DIV", "SPAN",
]);
const SAFE_STYLE = /^(width|height|max-width|float|margin|display)\s*:/i;

function cleanStyle(value) {
  return String(value || "")
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part && SAFE_STYLE.test(part))
    .join("; ");
}

/** Words in an HTML body: tags are whitespace, everything else counts. */
export function wordsIn(html) {
  const text = String(html || "")
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&[a-z#0-9]+;/gi, "x")
    .trim();
  if (!text) return 0;
  return text.split(/\s+/).filter(Boolean).length;
}

/** ceil(words / 200), never less than one minute. */
export function readingTime(html) {
  return Math.max(1, Math.ceil(wordsIn(html) / 200));
}

export function firstImage(html) {
  const match = String(html || "").match(/<img[^>]+src=["']([^"']+)["']/i);
  return match ? match[1] : "";
}

export function sanitizeHtml(html) {
  if (typeof DOMParser === "undefined") {
    /* no parser to walk the tree with: refuse the dangerous shapes rather
       than hand the html along untouched */
    return String(html || "")
      .replace(/<script\b[\s\S]*?<\/script>/gi, "")
      .replace(/<style\b[\s\S]*?<\/style>/gi, "")
      .replace(/<\s*(iframe|object|embed|form|link|meta)\b[^>]*>/gi, "")
      .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
      .replace(/\s(srcdoc|srcset)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
      .replace(/\s(href|src)\s*=\s*("|')?\s*(javascript|data|vbscript):[^"'\s>]*("|')?/gi, "");
  }
  const doc = new DOMParser().parseFromString(`<div id="r">${html || ""}</div>`, "text/html");
  const root = doc.getElementById("r");
  if (!root) return "";

  const clean = (node) => {
    [...node.children].forEach((el) => {
      if (!ALLOWED_TAGS.has(el.tagName)) {
        const parent = el.parentNode;
        el.replaceWith(...el.childNodes);
        if (parent) clean(parent);
        return;
      }
      [...el.attributes].forEach((attr) => {
        const name = attr.name.toLowerCase();
        if (name.startsWith("on") || name === "srcdoc" || name === "srcset") {
          el.removeAttribute(attr.name);
          return;
        }
        if (name === "style") {
          const safe = cleanStyle(attr.value);
          if (safe) el.setAttribute("style", safe);
          else el.removeAttribute(attr.name);
          return;
        }
        if (!["href", "src", "alt", "title", "colspan", "rowspan"].includes(name)) {
          el.removeAttribute(attr.name);
        }
      });
      if (el.tagName === "A") {
        const url = el.getAttribute("href") || "";
        if (/^\s*(javascript|data|vbscript):/i.test(url)) el.removeAttribute("href");
        el.setAttribute("rel", "noopener noreferrer nofollow");
        el.setAttribute("target", "_blank");
      }
      if (el.tagName === "IMG") {
        const url = el.getAttribute("src") || "";
        if (!/^\s*(https?:|\/|assets\/)/i.test(url)) el.removeAttribute("src");
        if (!el.getAttribute("alt")) el.setAttribute("alt", "");
        el.setAttribute("loading", "lazy");
      }
      clean(el);
    });
    return node;
  };

  clean(root);
  return root.innerHTML;
}
