/**
 * rte.js — one contenteditable, edited properly.
 * ------------------------------------------------------------------
 * The article body and anything else that lets a member write uses this
 * instead of `document.execCommand`, which is deprecated, refuses to work
 * after a programmatic insert, and keeps the browser's own undo stack in a
 * state nobody can reason about.
 *
 * What it offers, all of it on real DOM ranges:
 *
 *   run("bold" | "italic" | "underline" | "strikeThrough")
 *   run("formatBlock", "p" | "h2" | "h3" | "h4" | "blockquote" | "pre")
 *   run("insertUnorderedList" | "insertOrderedList")
 *   run("justifyLeft" | "justifyCenter" | "justifyRight")
 *   run("insertLink", { url, text, blank }) · run("unlink")
 *   run("removeFormat") · run("insertHtml", html) · run("insertHorizontalRule")
 *   run("undo") · run("redo")
 *
 * It also owns what a writing surface is expected to do and usually does not:
 * a selection that survives a click on the toolbar (the page calls
 * `keepSelection` on mousedown), plain-text paste, a link dropped from another
 * tab, files dropped on the body, a caret that gets out of a heading on Enter,
 * indenting a list item with Tab, and Ctrl/Cmd+B · I · U · K · Z · Enter.
 *
 * The history is ours: a stack of snapshots with the caret bookmarked by path,
 * so undo works even after an image or a caption was inserted.
 */

const BLOCKS = ["P", "DIV", "H1", "H2", "H3", "H4", "H5", "H6", "BLOCKQUOTE", "PRE", "LI", "FIGURE", "FIGCAPTION"];
const HEADINGS = ["H1", "H2", "H3", "H4", "H5", "H6"];
const INLINE_TAGS = { bold: "STRONG", italic: "EM", underline: "U", strikeThrough: "S" };
const STRIP_ON_CLEAR = ["STRONG", "B", "EM", "I", "U", "S", "STRIKE", "DEL", "INS", "CODE", "MARK", "SUB", "SUP", "SPAN", "A", "FONT", "SMALL", "BIG"];

function docOf(node) {
  return node.ownerDocument || document;
}

function isBlock(node) {
  return Boolean(node && node.nodeType === 1 && BLOCKS.includes(node.tagName));
}

function closest(node, test) {
  let cur = node;
  while (cur && cur.nodeType !== 9) {
    if (cur.nodeType === 1 && test(cur)) return cur;
    cur = cur.parentNode;
  }
  return null;
}

/** Every block element the range touches, outermost first, without duplicates. */
function blocksInRange(root, range) {
  const found = [];
  const seen = new Set();
  const push = (node) => {
    const block = closest(node, (n) => isBlock(n) && n !== root);
    if (!block || seen.has(block)) return;
    seen.add(block);
    found.push(block);
  };
  push(range.startContainer);
  if (!range.collapsed) {
    push(range.endContainer);
    const walker = docOf(root).createTreeWalker(range.commonAncestorContainer, 4 /* TEXT */, null);
    let node = walker.nextNode();
    while (node) {
      if (range.intersectsNode && range.intersectsNode(node)) push(node);
      node = walker.nextNode();
    }
  }
  /* the innermost blocks come last; keep document order at the end */
  return found.sort((a, b) => (a === b ? 0 : a.compareDocumentPosition(b) & 4 ? -1 : 1));
}

function unwrap(node) {
  const parent = node.parentNode;
  if (!parent) return null;
  while (node.firstChild) parent.insertBefore(node.firstChild, node);
  parent.removeChild(node);
  parent.normalize?.();
  return parent;
}

function stripTags(container, tagName) {
  Array.from(container.querySelectorAll(tagName.toLowerCase())).forEach(unwrap);
}

/** A caret position that survives innerHTML being replaced. */
function bookmark(root) {
  const sel = docOf(root).getSelection?.();
  if (!sel || !sel.rangeCount) return null;
  const range = sel.getRangeAt(0);
  if (!root.contains(range.commonAncestorContainer)) return null;
  const path = [];
  let node = range.startContainer;
  while (node && node !== root) {
    const parent = node.parentNode;
    if (!parent) return null;
    path.unshift(Array.prototype.indexOf.call(parent.childNodes, node));
    node = parent;
  }
  return { path, offset: range.startOffset, endPath: path, endOffset: range.startOffset, collapsed: range.collapsed };
}

function restoreBookmark(root, mark) {
  if (!mark) return false;
  const walk = (path) => {
    let node = root;
    for (const index of path) {
      if (!node || !node.childNodes[index]) return null;
      node = node.childNodes[index];
    }
    return node;
  };
  const start = walk(mark.path);
  if (!start) return false;
  const range = docOf(root).createRange();
  try {
    range.setStart(start, Math.min(mark.offset, (start.length ?? start.childNodes.length) || 0));
    const end = walk(mark.endPath || mark.path) || start;
    range.setEnd(end, Math.min(mark.endOffset ?? mark.offset, (end.length ?? end.childNodes.length) || 0));
  } catch {
    return false;
  }
  const sel = docOf(root).getSelection?.();
  if (!sel) return false;
  sel.removeAllRanges();
  sel.addRange(range);
  return true;
}

export function createRte(root, options = {}) {
  if (!root) return null;
  const doc = docOf(root);
  const opts = {
    onChange: () => {},
    onTool: () => {},
    onAsk: () => {},
    onSubmit: () => {},
    onFile: () => {},
    historyLimit: 80,
    ...options,
  };

  let savedRange = null;
  let stack = [];
  let index = -1;
  let typingTimer = null;
  let applying = false;

  /* ---------------------------------------------------------------- */
  /* selection                                                         */
  /* ---------------------------------------------------------------- */
  function liveRange() {
    const sel = doc.getSelection?.();
    if (!sel || !sel.rangeCount) return null;
    const range = sel.getRangeAt(0);
    return root.contains(range.commonAncestorContainer) ? range : null;
  }

  function remember() {
    const live = liveRange();
    if (live) savedRange = live.cloneRange();
    return live;
  }

  function setSelection(range) {
    const sel = doc.getSelection?.();
    if (!sel) return;
    sel.removeAllRanges();
    sel.addRange(range);
  }

  /** The live caret, or the one we last saw inside the body (after a dialog). */
  function resolveRange() {
    const live = liveRange();
    if (live) {
      savedRange = live.cloneRange();
      return live;
    }
    if (savedRange && root.contains(savedRange.commonAncestorContainer)) return savedRange;
    return null;
  }

  function caretAtEnd() {
    const range = doc.createRange();
    range.selectNodeContents(root);
    range.collapse(false);
    setSelection(range);
    savedRange = range.cloneRange();
    return range;
  }

  function caretInside(el, atStart = false) {
    const range = doc.createRange();
    range.selectNodeContents(el);
    range.collapse(atStart);
    setSelection(range);
    savedRange = range.cloneRange();
    return range;
  }

  function focusBody() {
    try {
      if (doc.activeElement !== root) root.focus();
    } catch {
      /* jsdom, or a document without focus */
    }
  }

  /* ---------------------------------------------------------------- */
  /* history                                                           */
  /* ---------------------------------------------------------------- */
  function html() {
    return root.innerHTML;
  }

  function trimTrailingBr() {
    /* an empty body reads as "<br>" — keep the placeholder honest */
    if (root.innerHTML === "<br>") root.innerHTML = "";
  }

  function pushHistory() {
    trimTrailingBr();
    const current = root.innerHTML;
    if (index >= 0 && stack[index] && stack[index].html === current) {
      opts.onTool();
      return;
    }
    const mark = bookmark(root);
    stack = stack.slice(0, index + 1);
    stack.push({ html: current, mark });
    if (stack.length > opts.historyLimit) stack.shift();
    index = stack.length - 1;
    opts.onTool();
  }

  function commit() {
    opts.onChange(root.innerHTML);
    pushHistory();
  }

  function commitSoon() {
    clearTimeout(typingTimer);
    typingTimer = setTimeout(() => {
      applying = true;
      pushHistory();
      applying = false;
      opts.onChange(root.innerHTML);
    }, 350);
  }

  function applySnapshot(entry) {
    if (!entry) return;
    applying = true;
    root.innerHTML = entry.html;
    if (!restoreBookmark(root, entry.mark)) caretAtEnd();
    applying = false;
    opts.onChange(root.innerHTML);
    opts.onTool();
  }

  function undo() {
    clearTimeout(typingTimer);
    pushHistory();
    if (index <= 0) return false;
    index -= 1;
    applySnapshot(stack[index]);
    return true;
  }

  function redo() {
    if (index >= stack.length - 1) return false;
    index += 1;
    applySnapshot(stack[index]);
    return true;
  }

  /* ---------------------------------------------------------------- */
  /* inline formatting                                                 */
  /* ---------------------------------------------------------------- */
  function toggleInline(tagName) {
    const range = resolveRange();
    if (!range) return;
    const host = closest(range.commonAncestorContainer, (n) => n.tagName === tagName || (tagName === "STRONG" && n.tagName === "B") || (tagName === "EM" && n.tagName === "I"));
    if (host && root.contains(host)) {
      const parent = unwrap(host) || root;
      const range2 = doc.createRange();
      range2.selectNodeContents(parent);
      range2.collapse(false);
      setSelection(range2);
      savedRange = range2.cloneRange();
      commit();
      opts.onTool();
      return;
    }
    if (range.collapsed) {
      const el = doc.createElement(tagName);
      el.appendChild(doc.createTextNode("\u200b"));
      range.insertNode(el);
      caretInside(el, false);
      commit();
      return;
    }
    const fragment = range.extractContents();
    stripTags(fragment.nodeType === 1 ? fragment : doc.createElement("div"), tagName);
    const el = doc.createElement(tagName);
    el.appendChild(fragment);
    range.insertNode(el);
    const after = doc.createRange();
    after.selectNodeContents(el);
    after.collapse(false);
    setSelection(after);
    savedRange = after.cloneRange();
    commit();
  }

  /* ---------------------------------------------------------------- */
  /* blocks                                                            */
  /* ---------------------------------------------------------------- */
  function liftOutOfList(li, tag) {
    const list = li.parentElement;
    if (!list) return null;
    const block = doc.createElement(tag);
    while (li.firstChild) block.appendChild(li.firstChild);
    if (!block.firstChild) block.appendChild(doc.createElement("br"));
    li.remove();
    if (list.children.length) list.after(block);
    else list.replaceWith(block);
    return block;
  }

  function setBlock(tag) {
    const range = resolveRange();
    if (!range) return;
    const blocks = blocksInRange(root, range);
    if (!blocks.length) {
      const block = doc.createElement(tag);
      block.appendChild(doc.createElement("br"));
      root.appendChild(block);
      caretInside(block, true);
      commit();
      return;
    }
    let last = null;
    blocks.forEach((block) => {
      if (block.tagName === "LI") {
        last = liftOutOfList(block, tag) || last;
        return;
      }
      const replacement = doc.createElement(tag);
      while (block.firstChild) replacement.appendChild(block.firstChild);
      if (!replacement.firstChild) replacement.appendChild(doc.createElement("br"));
      block.replaceWith(replacement);
      last = replacement;
    });
    if (last) {
      const after = doc.createRange();
      after.selectNodeContents(last);
      after.collapse(false);
      setSelection(after);
      savedRange = after.cloneRange();
    }
    commit();
  }

  function toggleList(tagName) {
    const range = resolveRange();
    if (!range) return;
    const list = closest(range.commonAncestorContainer, (n) => n.tagName === "UL" || n.tagName === "OL");
    if (list && root.contains(list)) {
      if (list.tagName === tagName) {
        /* take the list apart: every item becomes a paragraph */
        const paragraphs = Array.from(list.children).map((li) => {
          const p = doc.createElement("p");
          while (li.firstChild) p.appendChild(li.firstChild);
          if (!p.firstChild) p.appendChild(doc.createElement("br"));
          return p;
        });
        const fragment = doc.createDocumentFragment();
        paragraphs.forEach((p) => fragment.appendChild(p));
        list.replaceWith(fragment);
        const after = doc.createRange();
        after.selectNodeContents(paragraphs[paragraphs.length - 1] || root);
        after.collapse(false);
        setSelection(after);
        savedRange = after.cloneRange();
      } else {
        const replacement = doc.createElement(tagName);
        while (list.firstChild) replacement.appendChild(list.firstChild);
        list.replaceWith(replacement);
        caretInside(replacement, false);
      }
      commit();
      return;
    }
    const blocks = blocksInRange(root, range);
    if (!blocks.length) {
      const listEl = doc.createElement(tagName);
      const li = doc.createElement("li");
      li.appendChild(doc.createElement("br"));
      listEl.appendChild(li);
      root.appendChild(listEl);
      caretInside(li, true);
      commit();
      return;
    }
    const listEl = doc.createElement(tagName);
    const anchor = blocks[blocks.length - 1].nextSibling;
    blocks.forEach((block) => {
      const li = doc.createElement("li");
      while (block.firstChild) li.appendChild(block.firstChild);
      if (!li.firstChild) li.appendChild(doc.createElement("br"));
      listEl.appendChild(li);
      block.remove();
    });
    if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(listEl, anchor);
    else root.appendChild(listEl);
    const last = listEl.lastElementChild;
    if (last) caretInside(last, false);
    commit();
  }

  function align(where) {
    const range = resolveRange();
    if (!range) return;
    const blocks = blocksInRange(root, range);
    if (!blocks.length) return;
    blocks.forEach((block) => {
      if (where === "left") block.style.textAlign = "";
      else block.style.textAlign = where;
      if (!block.getAttribute("style")) block.removeAttribute("style");
    });
    commit();
  }

  /* ---------------------------------------------------------------- */
  /* links and insertion                                               */
  /* ---------------------------------------------------------------- */
  function insertNode(node) {
    let range = resolveRange();
    if (!range) {
      focusBody();
      range = caretAtEnd();
    }
    range.deleteContents();
    range.insertNode(node);
    const after = doc.createRange();
    after.setStartAfter(node);
    after.collapse(true);
    setSelection(after);
    savedRange = after.cloneRange();
    return after;
  }

  /** After a block was inserted at the end, the writer needs an empty line. */
  function ensureParagraphAfter(node) {
    if (!node) return;
    const next = node.nextSibling;
    if (next && !isBlock(next)) {
      const p = doc.createElement("p");
      p.appendChild(next);
      node.after(p);
      return;
    }
    if (!next) {
      const p = doc.createElement("p");
      p.appendChild(doc.createElement("br"));
      root.appendChild(p);
      caretInside(p, true);
    }
  }

  function insertHtml(markup) {
    const holder = doc.createElement("div");
    holder.innerHTML = String(markup);
    if (!holder.firstChild) return;
    let range = resolveRange();
    if (!range) {
      focusBody();
      range = caretAtEnd();
    }
    range.deleteContents();
    const fragment = doc.createDocumentFragment();
    let last = null;
    while (holder.firstChild) {
      last = holder.firstChild;
      fragment.appendChild(last);
    }
    range.insertNode(fragment);
    if (last) {
      const after = doc.createRange();
      after.setStartAfter(last);
      after.collapse(true);
      setSelection(after);
      savedRange = after.cloneRange();
      if (isBlock(last)) ensureParagraphAfter(last);
    }
    commit();
  }

  function link({ url, text = "", blank = true }) {
    const href = String(url || "").trim();
    if (!href) return;
    const range = resolveRange();
    if (!range) return;
    const anchor = doc.createElement("a");
    anchor.setAttribute("href", href);
    if (blank) {
      anchor.setAttribute("target", "_blank");
      anchor.setAttribute("rel", "noopener noreferrer");
    }
    if (range.collapsed) {
      anchor.textContent = text || href;
      insertNode(anchor);
      insertNode(doc.createTextNode(" "));
    } else {
      const fragment = range.extractContents();
      anchor.appendChild(fragment);
      range.insertNode(anchor);
      const after = doc.createRange();
      after.selectNodeContents(anchor);
      after.collapse(false);
      setSelection(after);
      savedRange = after.cloneRange();
    }
    commit();
  }

  function unlink() {
    const range = resolveRange();
    if (!range) return;
    const anchor = closest(range.commonAncestorContainer, (n) => n.tagName === "A");
    if (!anchor) return;
    const parent = unwrap(anchor) || root;
    const after = doc.createRange();
    after.selectNodeContents(parent);
    after.collapse(false);
    setSelection(after);
    savedRange = after.cloneRange();
    commit();
  }

  function clearFormat() {
    const range = resolveRange();
    if (!range) return;
    const block = closest(range.startContainer, (n) => isBlock(n) && n !== root);
    const scope = range.collapsed && block ? block : root;
    Array.from(scope.querySelectorAll("*")).forEach((node) => {
      if (STRIP_ON_CLEAR.includes(node.tagName)) {
        unwrap(node);
        return;
      }
      node.removeAttribute("style");
      node.removeAttribute("class");
      node.removeAttribute("align");
    });
    blocksInRange(root, range).forEach((each) => each.removeAttribute("style"));
    if (block) block.removeAttribute("style");
    commit();
  }

  function insertHorizontalRule() {
    const rule = doc.createElement("hr");
    insertNode(rule);
    ensureParagraphAfter(rule);
    commit();
  }

  function indentList(out = false) {
    const range = resolveRange();
    if (!range) return false;
    const li = closest(range.startContainer, (n) => n.tagName === "LI");
    if (!li) return false;
    if (out) {
      const list = li.parentElement;
      const grand = list?.parentElement?.closest("li");
      if (!grand) return true;
      const outerList = grand.parentElement;
      outerList.after(li);
      if (!list.children.length) list.remove();
      caretInside(li, false);
    } else {
      const previous = li.previousElementSibling;
      if (!previous) return true;
      let sub = previous.lastElementChild;
      if (!sub || (sub.tagName !== "UL" && sub.tagName !== "OL")) {
        sub = doc.createElement(li.parentElement.tagName);
        previous.appendChild(sub);
      }
      sub.appendChild(li);
      caretInside(li, false);
    }
    commit();
    return true;
  }

  /* ---------------------------------------------------------------- */
  /* the public commands                                               */
  /* ---------------------------------------------------------------- */
  function run(name, value) {
    /* read the caret before touching focus: focusing a contenteditable can
       move the selection to the start of the element, which would silently
       turn "bold these three words" into "bold nothing". */
    if (!resolveRange()) {
      focusBody();
      caretAtEnd();
    }
    const inlineTag = INLINE_TAGS[name];
    if (inlineTag) return toggleInline(inlineTag);
    switch (name) {
      case "formatBlock":
        return setBlock(String(value || "p").replace(/[<>]/g, "").toLowerCase());
      case "insertUnorderedList":
        return toggleList("UL");
      case "insertOrderedList":
        return toggleList("OL");
      case "justifyLeft":
        return align("left");
      case "justifyCenter":
        return align("center");
      case "justifyRight":
        return align("right");
      case "insertLink":
        return link(value || {});
      case "unlink":
        return unlink();
      case "removeFormat":
        return clearFormat();
      case "insertHtml":
        return insertHtml(value || "");
      case "insertHorizontalRule":
        return insertHorizontalRule();
      case "undo":
        return undo();
      case "redo":
        return redo();
      default:
        return undefined;
    }
  }

  /* ---------------------------------------------------------------- */
  /* what the toolbar should look like right now                        */
  /* ---------------------------------------------------------------- */
  function state() {
    const range = liveRange();
    if (!range) return { bold: false, italic: false, underline: false, strikeThrough: false, block: "", list: "", align: "" };
    const has = (tagName) => Boolean(closest(range.commonAncestorContainer, (n) => n.tagName === tagName || (tagName === "STRONG" && n.tagName === "B") || (tagName === "EM" && n.tagName === "I")));
    const block = closest(range.commonAncestorContainer, (n) => isBlock(n) && n !== root);
    const list = closest(range.commonAncestorContainer, (n) => n.tagName === "UL" || n.tagName === "OL");
    const styled = block?.style?.textAlign || "";
    return {
      bold: has("STRONG"),
      italic: has("EM"),
      underline: has("U"),
      strikeThrough: has("S") || has("STRIKE") || has("DEL"),
      block: block ? block.tagName.toLowerCase() : "",
      list: list ? list.tagName.toLowerCase() : "",
      align: styled === "center" ? "justifyCenter" : styled === "right" ? "justifyRight" : styled === "justify" ? "justify" : "justifyLeft",
      canUndo: index > 0,
      canRedo: index < stack.length - 1,
      link: Boolean(closest(range.commonAncestorContainer, (n) => n.tagName === "A")),
    };
  }

  /* ---------------------------------------------------------------- */
  /* events                                                            */
  /* ---------------------------------------------------------------- */
  function onKeydown(event) {
    const meta = event.ctrlKey || event.metaKey;
    if (meta && !event.altKey) {
      const key = event.key.toLowerCase();
      if (key === "b" || key === "i" || key === "u") {
        event.preventDefault();
        return run(key === "b" ? "bold" : key === "i" ? "italic" : "underline");
      }
      if (key === "x" && event.shiftKey) {
        event.preventDefault();
        return run("strikeThrough");
      }
      if (key === "k") {
        event.preventDefault();
        opts.onAsk("link");
        return undefined;
      }
      if (key === "z") {
        event.preventDefault();
        return event.shiftKey ? redo() : undo();
      }
      if (key === "y") {
        event.preventDefault();
        return redo();
      }
      if (key === "enter") {
        event.preventDefault();
        opts.onSubmit();
        return undefined;
      }
    }
    if (event.key === "Tab") {
      if (indentList(event.shiftKey)) {
        event.preventDefault();
        return undefined;
      }
      return undefined;
    }
    if (event.key === "Enter" && !event.shiftKey) {
      const range = liveRange();
      const block = range ? closest(range.startContainer, (n) => isBlock(n) && n !== root) : null;
      if (block && (HEADINGS.includes(block.tagName) || block.tagName === "BLOCKQUOTE")) {
        event.preventDefault();
        const p = doc.createElement("p");
        p.appendChild(doc.createElement("br"));
        block.after(p);
        caretInside(p, true);
        commit();
        return undefined;
      }
    }
    return undefined;
  }

  function onPaste(event) {
    const data = event.clipboardData;
    if (!data) return;
    const text = data.getData("text/plain");
    if (!text) return;
    event.preventDefault();
    const trimmed = text.trim();
    if (/^https?:\/\/\S+$/i.test(trimmed)) {
      const range = resolveRange();
      const selected = range && !range.collapsed ? range.toString() : "";
      link({ url: trimmed, text: selected || trimmed, blank: true });
      return;
    }
    const safe = trimmed.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
    const paragraphs = safe
      .split(/\n{2,}/)
      .map((block) => `<p>${block.replace(/\n/g, "<br />")}</p>`)
      .join("");
    insertHtml(paragraphs);
  }

  function caretFromPoint(event) {
    const pointDoc = doc;
    if (typeof pointDoc.caretRangeFromPoint === "function") {
      const range = pointDoc.caretRangeFromPoint(event.clientX, event.clientY);
      if (range && root.contains(range.startContainer)) {
        setSelection(range);
        savedRange = range.cloneRange();
        return range;
      }
    }
    return resolveRange() || caretAtEnd();
  }

  function onDrop(event) {
    const transfer = event.dataTransfer;
    if (!transfer) return;
    const files = Array.from(transfer.files || []);
    const text = transfer.getData("text/plain") || transfer.getData("text/uri-list") || "";
    if (!files.length && !text.trim()) return;
    event.preventDefault();
    caretFromPoint(event);
    if (files.length) {
      files.forEach((file) => opts.onFile(file));
      return;
    }
    const trimmed = text.trim();
    if (/^https?:\/\/\S+$/i.test(trimmed)) link({ url: trimmed, text: trimmed });
    else insertHtml(`<p>${trimmed.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c])}</p>`);
  }

  function onInput() {
    if (applying) return;
    opts.onChange(root.innerHTML);
    commitSoon();
  }

  /* ---------------------------------------------------------------- */
  /* wiring                                                            */
  /* ---------------------------------------------------------------- */
  root.setAttribute("contenteditable", "true");
  root.addEventListener("keydown", onKeydown);
  root.addEventListener("paste", onPaste);
  root.addEventListener("input", onInput);
  root.addEventListener("dragover", (event) => {
    if (event.dataTransfer) event.preventDefault();
  });
  root.addEventListener("drop", onDrop);
  root.addEventListener("mouseup", remember);
  root.addEventListener("keyup", remember);
  doc.addEventListener("selectionchange", () => {
    if (liveRange()) {
      remember();
      opts.onTool();
    }
  });

  const api = {
    root,
    html,
    state,
    run,
    insert: insertHtml,
    focus: focusBody,
    /** keep the caret where it is when a toolbar button takes the click */
    keepSelection(node) {
      node?.addEventListener("mousedown", (event) => {
        if (event.target.closest?.("[data-cmd], [data-block], select, option")) event.preventDefault();
      });
    },
    /** The page changed the DOM itself (an image resized, a caption removed). */
    snapshot() {
      opts.onChange(root.innerHTML);
      pushHistory();
    },
    setHtml(value) {
      applying = true;
      root.innerHTML = value || "";
      stack = [{ html: root.innerHTML, mark: null }];
      index = 0;
      applying = false;
      opts.onChange(root.innerHTML);
      opts.onTool();
    },
    save() {
      remember();
    },
    restore() {
      if (!savedRange) return false;
      try {
        setSelection(savedRange.cloneRange());
        return true;
      } catch {
        return false;
      }
    },
    destroy() {
      root.removeEventListener("keydown", onKeydown);
      root.removeEventListener("paste", onPaste);
      root.removeEventListener("input", onInput);
      root.removeEventListener("drop", onDrop);
    },
  };

  stack = [{ html: root.innerHTML, mark: null }];
  index = 0;
  return api;
}
