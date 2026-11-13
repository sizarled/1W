/**
 * contents.js — a rail of places, for the two editors.
 * ------------------------------------------------------------------
 * Both editors are long. An article grows headings as it is written; a
 * video form grows sections — the source, the words, the thumbnail, the
 * audience, the moment. Neither should make a member scroll to find where
 * they were, so both carry the same small index:
 *
 *   const contents = createContents(host, {
 *     empty: "No headings yet — press H2 and they appear here.",
 *     onJump: (item, row) => { … },
 *   });
 *
 *   contents.paint([{ label: "The port at night", level: 2, node }]);
 *
 * The list is only rebuilt when the labels change, so a writer typing in
 * the piece never loses the row they were standing on. The rail is dumb
 * about what it lists: a heading, a section, a place — an item is a label
 * and the node it points at.
 */
import { esc } from "./utils.js";

export function createContents(host, options = {}) {
  const state = {
    items: [],
    empty: options.empty || "Nothing to list yet.",
    onJump: options.onJump,
  };

  if (!host) return { paint() {}, host: null };

  host.addEventListener("click", (event) => {
    const row = event.target.closest ? event.target.closest("[data-toc]") : null;
    if (!row || !host.contains(row)) return;
    const item = state.items[Number(row.getAttribute("data-toc"))];
    if (!item) return;
    [...host.querySelectorAll("[data-toc]")].forEach((other) => {
      const active = other === row;
      other.classList.toggle("is-active", active);
      if (active) other.setAttribute("aria-current", "true");
      else other.removeAttribute("aria-current");
    });
    state.onJump?.(item, row);
  });

  function paint(items) {
    state.items = Array.isArray(items) ? items : [];
    const key = state.items.map((item) => `${item.level || 0}\u0002${item.label}`).join("\u0001");
    if (host.dataset.tocKey === key) return;
    host.dataset.tocKey = key;

    if (!state.items.length) {
      /* a rail with nothing to say and nothing to say it with stays out */
      host.innerHTML = state.empty ? `<p class="toc__empty">${esc(state.empty)}</p>` : "";
      return;
    }

    host.innerHTML = state.items
      .map(
        (item, index) =>
          `<button class="toc__row${item.level ? ` is-h${item.level}` : ""}" type="button" data-toc="${index}">` +
          `<span class="toc__n">${String(index + 1).padStart(2, "0")}</span>` +
          `<span class="toc__label">${esc(item.label)}</span>` +
          `</button>`
      )
      .join("");
  }

  return { paint, host };
}

/** The words of a heading, flattened and shortened for a row. */
export function rowLabel(node, limit = 80) {
  const text = String((node && node.textContent) || "")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}
