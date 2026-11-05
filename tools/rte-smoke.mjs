/**
 * tools/rte-smoke.mjs — the writing surface, on real ranges.
 *
 *   node tools/rte-smoke.mjs
 *
 * Everything here runs in jsdom, which has no `document.execCommand` at all —
 * so this is a test of the real code path, not of a browser shim.
 */
import { JSDOM } from "jsdom";

const checks = [];
function expect(label, pass, detail = "") {
  const ok = Boolean(pass);
  checks.push({ label, ok, detail });
  console.log(`${ok ? "ok   " : "FAIL "} ${label}${ok || detail === "" ? "" : `: ${detail}`}`);
}

function boot() {
  const dom = new JSDOM('<!doctype html><html><body><div id="host"></div></body></html>', { url: "http://localhost/articles.html" });
  const { window } = dom;
  globalThis.window = window;
  globalThis.document = window.document;
  globalThis.location = window.location;
  globalThis.Node = window.Node;
  globalThis.Element = window.Element;
  globalThis.HTMLElement = window.HTMLElement;
  globalThis.Range = window.Range;
  globalThis.Event = window.Event;
  globalThis.KeyboardEvent = window.KeyboardEvent;
  globalThis.MouseEvent = window.MouseEvent;
  globalThis.DragEvent = window.DragEvent || window.Event;
  Object.defineProperty(globalThis, "navigator", { value: window.navigator, configurable: true });
  return window;
}

function select(window, node, start = 0, end = null) {
  const range = window.document.createRange();
  range.setStart(node, start);
  range.setEnd(node, end == null ? (node.textContent || "").length : end);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
  return range;
}

function caret(window, node, offset = 0) {
  const range = window.document.createRange();
  range.setStart(node, offset);
  range.collapse(true);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
  return range;
}

const window = boot();
const { createRte } = await import(new URL("../assets/js/rte.js", import.meta.url).href);

let changes = 0;
const root = document.getElementById("host");
const rte = createRte(root, {
  onChange: () => {
    changes += 1;
  },
  onAsk: (kind) => {
    asked = kind;
  },
  onSubmit: () => {
    submitted += 1;
  },
});
let asked = "";
let submitted = 0;

/* --------------------------------------------------------------- */
/* inline                                                          */
/* --------------------------------------------------------------- */
rte.setHtml("<p>the kitchen scene</p>");
const text = root.querySelector("p").firstChild;
select(window, text, 4, 11);
rte.run("bold");
expect("bold wraps the selection", root.innerHTML.includes("<strong>kitchen</strong>"), root.innerHTML);
expect("the words survive", root.textContent.trim() === "the kitchen scene", root.textContent);

/* the selection now sits inside the strong */
const strongText = root.querySelector("strong")?.firstChild;
if (strongText) select(window, strongText, 0, 7);
rte.run("bold");
expect("bold again takes it off", !root.innerHTML.includes("<strong>"), root.innerHTML);
expect("still one sentence", root.textContent.trim() === "the kitchen scene", root.textContent);

rte.setHtml("<p>italics here</p>");
select(window, root.querySelector("p").firstChild, 0, 7);
rte.run("italic");
expect("italic works", root.innerHTML.includes("<em>italics</em>"), root.innerHTML);
rte.setHtml("<p>under here</p>");
select(window, root.querySelector("p").firstChild, 0, 5);
rte.run("underline");
expect("underline works", root.innerHTML.includes("<u>under</u>"), root.innerHTML);

rte.setHtml("<p>strike here</p>");
select(window, root.querySelector("p").firstChild, 0, 6);
rte.run("strikeThrough");
expect("strikethrough works", root.innerHTML.includes("<s>strike</s>"), root.innerHTML);

/* --------------------------------------------------------------- */
/* blocks                                                          */
/* --------------------------------------------------------------- */
rte.setHtml("<p>a heading to be</p>");
caret(window, root.querySelector("p").firstChild, 2);
rte.run("formatBlock", "h2");
expect("formatBlock makes an h2", root.querySelector("h2")?.textContent === "a heading to be", root.innerHTML);

rte.run("formatBlock", "blockquote");
expect("and a quote", root.querySelector("blockquote")?.textContent === "a heading to be", root.innerHTML);

rte.run("formatBlock", "p");
expect("and back to a paragraph", Boolean(root.querySelector("p")) && !root.querySelector("blockquote"), root.innerHTML);

/* --------------------------------------------------------------- */
/* lists                                                           */
/* --------------------------------------------------------------- */
rte.setHtml("<p>one</p><p>two</p>");
const firstLine = root.querySelector("p").firstChild;
const secondLine = root.querySelectorAll("p")[1].firstChild;
select(window, firstLine, 0, 3);
rte.run("insertUnorderedList");
expect("a list is made", Boolean(root.querySelector("ul li")), root.innerHTML);
expect("the lines became items", root.querySelectorAll("ul li").length >= 1, root.innerHTML);

rte.setHtml("<p>alpha</p><p>beta</p>");
select(window, root.querySelector("p").firstChild, 0, 5);
rte.run("insertOrderedList");
expect("a numbered list is made", Boolean(root.querySelector("ol li")), root.innerHTML);
caret(window, root.querySelector("ol li").firstChild, 2);
rte.run("insertOrderedList");
expect("running it again takes the list apart", !root.querySelector("ol"), root.innerHTML);

rte.setHtml("<ul><li>first</li><li>second</li></ul>");
caret(window, root.querySelectorAll("li")[1].firstChild, 3);
const li = root.querySelectorAll("li")[1];
window.document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
li.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
expect("Tab nests a list item", Boolean(root.querySelector("li li")), root.innerHTML);

/* --------------------------------------------------------------- */
/* alignment                                                       */
/* --------------------------------------------------------------- */
rte.setHtml("<p>centre me</p>");
caret(window, root.querySelector("p").firstChild, 3);
rte.run("justifyCenter");
expect("centring sets the block style", root.querySelector("p").style.textAlign === "center", root.innerHTML);
rte.run("justifyRight");
expect("right alignment replaces it", root.querySelector("p").style.textAlign === "right", root.innerHTML);
rte.run("justifyLeft");
expect("left clears it", !root.querySelector("p").style.textAlign, root.innerHTML);

/* --------------------------------------------------------------- */
/* links                                                           */
/* --------------------------------------------------------------- */
rte.setHtml("<p>read this piece</p>");
select(window, root.querySelector("p").firstChild, 5, 9);
rte.run("insertLink", { url: "https://example.com/x", blank: true });
const anchor = root.querySelector("a");
expect("a link wraps the words", anchor?.textContent === "this", root.innerHTML);
expect("the link has its address", anchor?.getAttribute("href") === "https://example.com/x", anchor?.getAttribute("href"));
expect("a new tab is safe", anchor?.getAttribute("rel") === "noopener noreferrer", anchor?.getAttribute("rel"));
caret(window, anchor.firstChild, 1);
rte.run("unlink");
expect("unlink takes it off", !root.querySelector("a"), root.innerHTML);
expect("the words stay", root.textContent.trim() === "read this piece", root.textContent);

rte.setHtml("<p>tail</p>");
caret(window, root.querySelector("p").firstChild, 4);
rte.run("insertLink", { url: "https://example.com/y", text: "a link", blank: false });
expect("a collapsed caret gets a link", root.querySelector("a")?.textContent === "a link", root.innerHTML);

/* --------------------------------------------------------------- */
/* insertion                                                       */
/* --------------------------------------------------------------- */
rte.setHtml("<p>end of the piece</p>");
caret(window, root.querySelector("p").firstChild, 16);
rte.run("insertHtml", '<figure><img src="https://x/y.jpg" alt="a still" /><figcaption>a still</figcaption></figure>');
expect("an image is inserted", Boolean(root.querySelector("figure img")), root.innerHTML);
expect("an empty line follows for the caret", root.querySelectorAll("p").length >= 1, root.innerHTML);

rte.run("insertHtml", "<p>next paragraph</p>");
expect("a paragraph is inserted", root.textContent.includes("next paragraph"), root.innerHTML);

rte.setHtml("<p>before</p>");
caret(window, root.querySelector("p").firstChild, 0);
rte.run("insertHorizontalRule");
expect("a rule is inserted", Boolean(root.querySelector("hr")), root.innerHTML);

/* --------------------------------------------------------------- */
/* clear formatting                                                */
/* --------------------------------------------------------------- */
rte.setHtml('<p><strong>bold</strong> <em>and italic</em> <a href="https://x.y">a link</a></p>');
caret(window, root.querySelector("strong").firstChild, 1);
rte.run("removeFormat");
expect("clear formatting strips the tags", !root.querySelector("strong") && !root.querySelector("em") && !root.querySelector("a"), root.innerHTML);
expect("the words stay behind", root.textContent.replace(/\s+/g, " ").trim() === "bold and italic a link", root.textContent);

/* --------------------------------------------------------------- */
/* history                                                         */
/* --------------------------------------------------------------- */
rte.setHtml("<p>one</p>");
const mark = root.innerHTML;
select(window, root.querySelector("p").firstChild, 0, 3);
rte.run("bold");
expect("history keeps the change", root.innerHTML.includes("<strong>"), root.innerHTML);
rte.run("undo");
expect("undo comes back", !root.innerHTML.includes("<strong>") && root.innerHTML.includes("one"), root.innerHTML);
rte.run("redo");
expect("redo goes forward again", root.innerHTML.includes("<strong>"), root.innerHTML);

/* --------------------------------------------------------------- */
/* typing and paste                                                */
/* --------------------------------------------------------------- */
rte.setHtml("<p>typed</p>");
const typingRoot = root.querySelector("p");
typingRoot.textContent = "typed more";
root.dispatchEvent(new window.Event("input", { bubbles: true }));
expect("typing reports a change", changes > 0, String(changes));

rte.setHtml("<p>paste here</p>");
caret(window, root.querySelector("p").firstChild, 5);
const pasteEvent = new window.Event("paste", { bubbles: true, cancelable: true });
pasteEvent.clipboardData = { getData: (kind) => (kind === "text/plain" ? 'one <script>alert(1)</script>\n\ntwo & three' : "") };
root.dispatchEvent(pasteEvent);
expect("paste is taken over", pasteEvent.defaultPrevented, String(pasteEvent.defaultPrevented));
expect("paste never injects markup", !root.innerHTML.includes("<script"), root.innerHTML);
expect("paste keeps the text", root.textContent.includes("one <script>alert(1)</script>") && root.textContent.includes("two & three"), root.textContent);

const linkPaste = new window.Event("paste", { bubbles: true, cancelable: true });
linkPaste.clipboardData = { getData: (kind) => (kind === "text/plain" ? "https://example.com/dropped" : "") };
rte.setHtml("<p>a url</p>");
caret(window, root.querySelector("p").firstChild, 5);
root.dispatchEvent(linkPaste);
expect("a pasted address becomes a link", root.querySelector("a")?.getAttribute("href") === "https://example.com/dropped", root.innerHTML);

/* --------------------------------------------------------------- */
/* files dropped in                                                */
/* --------------------------------------------------------------- */
const dropped = [];
const dropper = createRte(root, { onFile: (file) => dropped.push(file.name) });
rte.setHtml("<p>drop it</p>");
const dropEvent = new window.Event("drop", { bubbles: true, cancelable: true });
dropEvent.dataTransfer = { files: [{ name: "still.jpg", type: "image/jpeg" }], getData: () => "" };
root.dispatchEvent(dropEvent);
expect("a dropped file reaches the page", dropped.includes("still.jpg"), JSON.stringify(dropped));
dropper.destroy();

/* --------------------------------------------------------------- */
/* keys                                                            */
/* --------------------------------------------------------------- */
rte.setHtml("<p>hot keys</p>");
select(window, root.querySelector("p").firstChild, 0, 3);
root.dispatchEvent(new window.KeyboardEvent("keydown", { key: "b", ctrlKey: true, bubbles: true, cancelable: true }));
expect("Ctrl+B bolds", root.innerHTML.includes("<strong>hot</strong>"), root.innerHTML);

rte.setHtml("<h2>a heading</h2>");
caret(window, root.querySelector("h2").firstChild, 9);
root.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
expect("Enter out of a heading makes a paragraph", Boolean(root.querySelector("h2")) && Boolean(root.querySelector("p")), root.innerHTML);

rte.setHtml("<p>ask for a link</p>");
caret(window, root.querySelector("p").firstChild, 2);
root.dispatchEvent(new window.KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true, cancelable: true }));
expect("Cmd/Ctrl+K asks the page for a link", asked === "link", asked);

rte.setHtml("<p>submit me</p>");
root.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true, cancelable: true }));
expect("Ctrl+Enter asks the page to publish", submitted === 1, String(submitted));

/* --------------------------------------------------------------- */
/* state                                                           */
/* --------------------------------------------------------------- */
rte.setHtml('<h2>a <strong>bold</strong> line</h2>');
select(window, root.querySelector("strong").firstChild, 1, 3);
const st = rte.state();
expect("the toolbar knows it is bold", st.bold === true, JSON.stringify(st));
expect("the toolbar knows the block", st.block === "h2", st.block);

console.log(`\n${checks.filter((c) => c.ok).length}/${checks.length} checks passed`);
if (checks.some((c) => !c.ok)) {
  console.log("\nFailed:");
  checks.filter((c) => !c.ok).forEach((c) => console.log(` - ${c.label}: ${c.detail}`));
  process.exit(1);
}
process.exit(0);
