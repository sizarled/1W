/**
 * article.html — one article.
 * ------------------------------------------------------------------
 * Reads ?id=PST-001015 (a code, or the row's uuid) and paints one of
 * three screens from a single call:
 *
 *   article_get(token, ref, key)
 *
 *     open      the piece, its writer, the reactions, the comments
 *     locked    the door: the audience this piece asks for, what the
 *               viewer actually has, and a password box when the writer
 *               set one
 *     missing   a quiet page that says so
 *
 * A password in the URL (`?key=…`) opens the piece for that visit. A
 * password typed into the form is tried the same way. Nothing is stored
 * on the device except the "remind me" mark and the reading list.
 */
import { rpc } from "./data.js";
import { sanitizeHtml as sanitize } from "./article-text.js";
import { qs, qsa, esc, compact, timeAgo, avatarPlaceholder } from "./utils.js";
import { icon } from "./icons.js";
import { toast } from "./ui.js";
import { sessionToken } from "./session.js";

const SAVED_KEY = "1w.articles.saved";
const REMIND_KEY = "1w.articles.remind";

const state = {
  token: "",
  ref: "",
  key: "",
  data: null,
  reaction: 0,
  comments: null,
  canComment: false,
  parent: null,
  reminder: false,
};

const $ = (sel) => qs(sel);

/* ================================================================== */
/* helpers                                                            */
/* ================================================================== */
function signedIn() {
  return Boolean(state.token);
}

function article() {
  return (state.data && state.data.article) || {};
}

function meta() {
  return article().article || {};
}

function host() {
  return meta().host || article().host || {};
}

function counters() {
  return article().counters || {};
}

function readSet() {
  try {
    const raw = JSON.parse(localStorage.getItem(SAVED_KEY) || "[]");
    return new Set(Array.isArray(raw) ? raw : []);
  } catch {
    return new Set();
  }
}

function toggleSaved(code) {
  const set = readSet();
  if (set.has(code)) set.delete(code);
  else set.add(code);
  try {
    localStorage.setItem(SAVED_KEY, JSON.stringify([...set]));
  } catch {
    /* storage blocked — the button still flips for the visit */
  }
  return set.has(code);
}

function remindSet() {
  try {
    const raw = JSON.parse(localStorage.getItem(REMIND_KEY) || "[]");
    return new Set(Array.isArray(raw) ? raw : []);
  } catch {
    return new Set();
  }
}

function toggleRemind(code) {
  const set = remindSet();
  if (set.has(code)) set.delete(code);
  else set.add(code);
  try {
    localStorage.setItem(REMIND_KEY, JSON.stringify([...set]));
  } catch {
    /* nothing to do */
  }
  return set.has(code);
}

/* ================================================================== */
/* the door                                                           */
/* ================================================================== */
const KIND_LABEL = {
  country: "Country",
  language: "Language",
  level: "Account level",
  wealth: "Balance",
  entity: "Named member",
};

function levelRange(values) {
  const numbers = [...new Set(values.map((v) => Number(v)).filter((n) => Number.isFinite(n)))].sort((a, b) => a - b);
  if (!numbers.length) return "";
  if (numbers.length === 1) return `LV ${numbers[0]}`;
  const contiguous = numbers.every((n, i) => i === 0 || n === numbers[i - 1] + 1);
  if (contiguous) return `LV ${numbers[0]} – LV ${numbers[numbers.length - 1]}`;
  return numbers.map((n) => `LV ${n}`).join(", ");
}

function matches(rule, viewer) {
  if (!viewer || !viewer.signed_in) return false;
  const have = String(viewer[rule.kind] ?? "").toLowerCase();
  const want = String(rule.value ?? "").toLowerCase();
  if (!have) return false;
  return have === want;
}

function stepRow({ iconName, label, value, ok, delay = 0 }) {
  return `
    <div class="astep ${ok ? "is-ok" : "is-no"}" style="animation-delay:${delay}ms">
      <span class="astep__mark">${icon(ok ? "check" : "minus")}</span>
      <span class="astep__label">${esc(label)}</span>
      <span class="astep__val">${esc(value)}</span>
    </div>`;
}

function gateMarkup(data) {
  const a = data.article || {};
  const viewer = data.viewer || {};
  const rules = Array.isArray(data.audience) ? data.audience : [];
  const privateOne = a.visibility === "private" || a.visibility === "others";
  const followersOnly = Boolean(data.followers_only);
  const steps = [];

  if (followersOnly) {
    steps.push({
      iconName: "users",
      label: "Follows this writer",
      value: "follow to read",
      ok: false,
    });
  }

  const byKind = new Map();
  rules
    .filter((rule) => rule.mode !== "exclude")
    .forEach((rule) => {
      if (!byKind.has(rule.kind)) byKind.set(rule.kind, []);
      byKind.get(rule.kind).push(rule);
    });

  byKind.forEach((list, kind) => {
    if (kind === "level") {
      const ok = list.some((rule) => matches(rule, viewer));
      steps.push({
        iconName: "chart",
        label: KIND_LABEL.level,
        value: levelRange(list.map((rule) => rule.value)),
        ok,
      });
      return;
    }
    const ok = list.some((rule) => matches(rule, viewer));
    const value =
      kind === "entity"
        ? list.map((rule) => rule.value).join(", ")
        : list.map((rule) => rule.value).join(" · ");
    steps.push({ iconName: kind === "country" ? "globe" : "sparkle", label: KIND_LABEL[kind] || kind, value, ok });
  });

  const rows = steps
    .map((step, index) => stepRow({ ...step, delay: 70 * index }))
    .join("");

  const allowed = Number(data.allowed) || 0;
  const signed = Boolean(viewer.signed_in);

  const passwordBlock = data.asks_password
    ? `<form class="agate__form" data-r-key-form>
         <label class="alabel" for="rkey">Password from the writer</label>
         <div class="aed__row" style="margin-top:0">
           <input class="input" id="rkey" type="text" data-r-key-input autocomplete="off" spellcheck="false" placeholder="The password you were given" />
           <button class="btn btn--primary btn--sm" type="submit">${icon("unlock")} Open</button>
         </div>
         <p class="agate__err" data-r-key-err hidden>${icon("info")} That password is not one of this article's.</p>
       </form>`
    : "";

  const acts = [];
  if (!signed) {
    acts.push(`<a class="btn btn--primary btn--sm" href="login.html?next=${encodeURIComponent(location.pathname + location.search)}">${icon("login")} Sign in</a>`);
  } else if (followersOnly && !steps.some((step) => step.ok)) {
    acts.push(`<button class="btn btn--primary btn--sm" type="button" data-r-follow>${icon("plus")} Follow ${esc(host().username || "the writer")}</button>`);
  }
  acts.push(
    `<button class="btn btn--ghost btn--sm" type="button" data-r-remind>${icon(state.reminder ? "check" : "bell")} ${state.reminder ? "Reminder set" : "Remind me when I match"}</button>`
  );

  return `
    <div class="agate">
      <div class="agate__card">
        <span class="agate__icon">${icon(privateOne ? "lock" : "sparkle")}</span>
        <p class="agate__kicker">${privateOne ? "Private article" : followersOnly ? "Followers only" : "Exclusive article"}</p>
        <h1 class="agate__title">${esc(a.title || "An article")}</h1>
        ${a.description ? `<p class="agate__text">${esc(a.description)}</p>` : ""}
        ${a.host ? `<p class="agate__note">Written by ${esc(a.host.name || a.host.username || "a member")}</p>` : ""}
        ${rows ? `<div class="agate__steps">${rows}</div>` : ""}
        ${
          allowed
            ? `<p class="agate__note">${allowed} ${allowed === 1 ? "member is" : "members are"} on the writer's list for this piece.</p>`
            : ""
        }
        ${passwordBlock}
        <div class="agate__acts">${acts.join("")}</div>
        <p class="agate__note">
          ${privateOne
            ? "This piece is private: it opens to the members the writer named, and to anyone holding one of its passwords."
            : followersOnly
              ? "This writer publishes to their followers. Follow them and the piece opens the next time you visit."
              : "This piece has an audience. Any one of the conditions above is enough — the ones already true for you are marked."}
        </p>
      </div>
    </div>`;
}

/* ================================================================== */
/* the reader                                                         */
/* ================================================================== */
function badgeMarkup(row) {
  const marks = [];
  if (row.visibility === "private") marks.push(`<span class="rbadge rbadge--private">${icon("lock")} Private</span>`);
  else if (row.visibility === "followers")
    marks.push(`<span class="rbadge rbadge--exclusive">${icon("users")} Followers</span>`);
  else if (row.visibility === "limited" || row.visibility === "excluded")
    marks.push(`<span class="rbadge rbadge--exclusive">${icon("sparkle")} Exclusive</span>`);
  if (row.status === "draft") marks.push(`<span class="rbadge rbadge--draft">${icon("pen")} Draft — only you</span>`);
  if (row.status === "scheduled") marks.push(`<span class="rbadge rbadge--draft">${icon("clock")} Scheduled</span>`);
  if (row.status === "pending") marks.push(`<span class="rbadge rbadge--draft">${icon("clock")} In review</span>`);
  if (state.data && state.data.unlocked) marks.push(`<span class="rbadge">${icon("unlock")} Opened with a password</span>`);
  return marks.join("");
}

function authorCard() {
  const person = host();
  const name = person.name || person.username || "A member";
  const avatar = person.avatar || avatarPlaceholder(String(name), 96);
  return `
    <div class="rauth" data-r-author-card>
      <div class="rauth__top">
        <img class="rauth__avatar" src="${esc(avatar)}" alt="" loading="lazy" />
        <div>
          <p class="rauth__name">${esc(name)}</p>
          <p class="rauth__handle">${esc(person.username || "")}</p>
        </div>
      </div>
      <div class="rauth__stats">
        <span><b>${compact(person.followers || 0)}</b> followers</span>
        <span><b>${compact(person.posts || 0)}</b> pieces</span>
        ${person.country ? `<span>${esc(person.country)}</span>` : ""}
      </div>
      <div class="rauth__acts">
        ${
          person.username
            ? `<a class="btn btn--ghost btn--sm" href="creator.html?studio=${encodeURIComponent(person.username)}">${icon("user")} Hub</a>`
            : ""
        }
        <button class="btn btn--primary btn--sm" type="button" data-r-follow>${icon("plus")} Follow</button>
      </div>
    </div>`;
}

function suggestMarkup(rows, title) {
  if (!rows.length) return "";
  return `
    <div class="rsug__group">
      <h2 class="rsug__title">${esc(title)}</h2>
      <div class="rsug__list">
        ${rows
          .slice(0, 6)
          .map(
            (row) => `
          <a class="rsug__item" href="article.html?id=${encodeURIComponent(row.code || row.id)}">
            ${row.thumbnail ? `<img class="rsug__thumb" src="${esc(row.thumbnail)}" alt="" loading="lazy" />` : `<span class="rsug__thumb"></span>`}
            <span>
              <span class="rsug__name">${esc(row.title || "Untitled")}</span>
              <span class="rsug__meta">${esc((row.article && row.article.field) || "")}${
                (row.article && row.article.reading) ? ` · ${row.article.reading} min` : ""
              }</span>
            </span>
          </a>`
          )
          .join("")}
      </div>
    </div>`;
}

function actsMarkup() {
  const c = counters();
  const row = article();
  const saved = readSet().has(row.code || row.id);
  return `
    <button class="ract ${state.reaction === 1 ? "is-on" : ""}" type="button" data-r-react="1" aria-pressed="${state.reaction === 1}">
      ${icon("thumbUp")} Useful <b data-r-like>${compact(c.likes || 0)}</b>
    </button>
    <button class="ract ${state.reaction === -1 ? "is-on" : ""}" type="button" data-r-react="-1" aria-pressed="${state.reaction === -1}">
      ${icon("thumbDown")} Not useful <b data-r-dislike>${compact(c.dislikes || 0)}</b>
    </button>
    <button class="ract" type="button" data-r-save aria-pressed="${saved}">${icon("bookmark")} ${saved ? "Saved" : "Save"}</button>
    <button class="ract" type="button" data-r-share>${icon("share")} Share</button>
    <button class="ract ract--quiet" type="button" data-r-report>${icon("flag")} Report</button>`;
}

function talkMarkup() {
  const list = (state.comments && state.comments.comments) || [];
  const signed = signedIn();
  const gate = !signed
    ? `<div class="talk__gate">${icon("user")} <span><a href="login.html">Sign in</a> to react to this piece and join the conversation.</span></div>`
    : !state.canComment
      ? `<div class="talk__gate">${icon("thumbUp")} <span>Mark the piece useful or not useful first — then the comments open.</span></div>`
      : `<form class="talk__form" data-r-comment-form>
           <textarea class="input" data-r-comment-input placeholder="Add something to the piece…" maxlength="1200"></textarea>
           <div class="talk__form-acts">
             <span class="talk__hint" data-r-reply-note></span>
             <button class="btn btn--primary btn--sm" type="submit">${icon("send")} Post</button>
           </div>
         </form>`;

  const body = list.length
    ? list.map((row) => commentMarkup(row, list)).join("")
    : `<p class="talk__hint">No comments yet.</p>`;

  return `
    <section class="talk" id="talk">
      <div class="talk__head">
        <h2 class="talk__title">${icon("comment")} Comments <span class="talk__count">${list.length}</span></h2>
        <button class="ract ract--quiet" type="button" data-r-goto-comments>${icon("arrowRight")} Reply</button>
      </div>
      ${gate}
      <div data-r-comment-list>${body}</div>
    </section>`;
}

function commentMarkup(row, all) {
  const avatar = (row.author && row.author.avatar) || avatarPlaceholder((row.author && row.author.name) || "1W", 76);
  const name = (row.author && (row.author.name || row.author.username)) || "A member";
  const replies = all.filter((other) => Number(other.parent_id) === Number(row.id) && other.id !== row.id);
  return `
    <article class="atalk" data-comment="${row.id}">
      <img class="atalk__avatar" src="${esc(avatar)}" alt="" loading="lazy" />
      <div style="min-width:0">
        <div class="atalk__head">
          <span class="atalk__name">${esc(name)}</span>
          <span class="atalk__time">${esc(timeAgo(row.created_at))}${row.edited ? " · edited" : ""}</span>
        </div>
        <p class="atalk__body">${esc(row.body || "")}</p>
        <div class="atalk__acts">
          <button class="ract" type="button" data-r-vote="${row.id}" data-agree="1">${icon("thumbUp")} Agree <b>${Number(row.likes) || 0}</b></button>
          <button class="ract" type="button" data-r-vote="${row.id}" data-agree="0">${icon("thumbDown")} Disagree <b>${Number(row.dislikes) || 0}</b></button>
          <button class="ract" type="button" data-r-reply="${Math.max(0, Number(row.id) || 0)}">${icon("comment")} Reply</button>
          <button class="ract" type="button" data-r-report-comment="${row.id}">${icon("flag")} Report</button>
        </div>
        ${
          replies.length
            ? `<div class="atalk__replies">${replies.map((reply) => commentMarkup(reply, []).replace('class="atalk"', 'class="atalk atalk--reply"')).join("")}</div>`
            : ""
        }
      </div>
    </article>`;
}

function readerMarkup(data) {
  const row = data.article || {};
  const info = row.article || {};
  const person = info.host || row.host || {};
  const name = person.name || person.username || "A member";
  const avatar = person.avatar || avatarPlaceholder(String(name), 96);
  const field = info.field || "";
  const category = info.category || "";
  const published = row.published_at;
  /* the body rides on the card: article_get puts it there when the piece opens */
  const body = sanitize(data.body || row.body || "");

  const cover = qs("[data-r-cover]");
  const img = qs("[data-r-cover-img]");
  if (cover && img) {
    if (row.thumbnail) {
      img.src = row.thumbnail;
      img.alt = "";
      cover.hidden = false;
    } else {
      cover.hidden = true;
    }
  }

  const crumbs = qs("[data-r-field]");
  if (crumbs) crumbs.innerHTML = field ? `${icon("chevronRight")} <span>${esc(field)}</span>` : "";

  const badges = qs("[data-r-badges]");
  if (badges) badges.innerHTML = badgeMarkup(row);

  const title = qs("[data-r-title]");
  if (title) title.textContent = row.title || "Untitled";

  const desc = qs("[data-r-desc]");
  if (desc) {
    desc.textContent = row.description || "";
    desc.hidden = !row.description;
  }

  const by = qs("[data-r-by]");
  if (by) {
    by.innerHTML = `
      <a class="rby" href="creator.html?studio=${encodeURIComponent(person.username || "")}">
        <img class="rby__avatar" src="${esc(avatar)}" alt="" loading="lazy" />
        <span>
          <span class="rby__name">${esc(name)}</span>
          <span class="rby__meta">${esc(person.username || "")} · <span>${esc(timeAgo(published))}</span></span>
        </span>
      </a>
      <span class="rby__meta" style="margin-left:auto">
        ${icon("clock")} ${Number(info.reading) || 1} min read
        <span class="acard__dot"></span>
        ${compact((row.counters && row.counters.impressions) || 0)} reads
        ${category ? `<span class="acard__dot"></span> ${esc(category)}` : ""}
      </span>`;
  }

  const bodyEl = qs("[data-r-body]");
  if (bodyEl) bodyEl.innerHTML = body;

  const tags = qs("[data-r-tags]");
  if (tags) {
    const list = Array.isArray(row.keywords) ? row.keywords : [];
    tags.innerHTML = list
      .slice(0, 8)
      .map((tag) => `<a class="chip" href="articles.html?q=${encodeURIComponent(tag.keyword || "")}">${esc(tag.keyword || "")}</a>`)
      .join("");
    tags.hidden = !list.length;
  }

  const acts = qs("[data-r-acts]");
  if (acts) acts.innerHTML = actsMarkup();

  const side = qs("[data-r-author]");
  if (side) side.innerHTML = authorCard();

  const related = Array.isArray(data.related) ? data.related : [];
  const more = Array.isArray(data.more) ? data.more : [];
  const sug = qs("[data-r-suggest]");
  const sugList = qs("[data-r-suggest-list]");
  if (sug && sugList) {
    sugList.innerHTML = suggestMarkup(related, "In the same field") + suggestMarkup(more, `More from ${name}`);
    sug.hidden = !related.length && !more.length;
  }

  const talk = qs("[data-r-talk]");
  if (talk) talk.innerHTML = talkMarkup();

  document.title = `${row.title || "Article"} — 1World Web`;
}

/* ================================================================== */
/* load                                                               */
/* ================================================================== */
function showState({ title, text, action = "", iconName = "info" }) {
  const host = qs("[data-r-state]");
  const reader = qs("[data-r-reader]");
  if (reader) reader.hidden = true;
  if (!host) return;
  host.hidden = false;
  host.innerHTML = `
    <div class="astate">
      <span class="astate__icon">${icon(iconName)}</span>
      <p class="astate__title">${esc(title)}</p>
      <p class="astate__text">${esc(text)}</p>
      ${action}
    </div>`;
}

async function load() {
  const params = new URLSearchParams(location.search);
  state.ref = params.get("id") || params.get("a") || "";
  state.key = params.get("key") || "";
  state.token = sessionToken() || "";
  state.reminder = state.ref ? remindSet().has(state.ref) : false;

  if (!state.ref) {
    showState({
      title: "No article named",
      text: "This page reads one article by its code. Open the index to find one.",
      iconName: "bookOpen",
      action: `<a class="btn btn--primary btn--sm" href="articles.html">${icon("arrowLeft")} All articles</a>`,
    });
    return;
  }

  let res = null;
  try {
    res = await rpc("article_get", { p_token: state.token, p_ref: state.ref, p_key: state.key });
  } catch (error) {
    console.warn("[1World] article:", error.message);
  }

  if (!res || res.ok !== true) {
    showState({
      title: res && res.error === "not_found" ? "That article is gone" : "The article did not load",
      text:
        res && res.error === "not_found"
          ? "The link may be old, or the writer deleted it."
          : "The server is not reachable from here. Try again in a moment.",
      iconName: "bookOpen",
      action: `<a class="btn btn--ghost btn--sm" href="articles.html">${icon("arrowLeft")} All articles</a>`,
    });
    return;
  }

  state.data = res;

  if (res.locked) {
    const host = qs("[data-r-state]");
    const reader = qs("[data-r-reader]");
    if (reader) reader.hidden = true;
    if (host) {
      host.hidden = false;
      host.innerHTML = gateMarkup(res);
    }
    const row = res.article || {};
    document.title = `${row.title || "Article"} — 1World Web`;
    return;
  }

  const reader = qs("[data-r-reader]");
  if (reader) reader.hidden = false;
  const stater = qs("[data-r-state]");
  if (stater) {
    stater.hidden = true;
    stater.innerHTML = "";
  }

  state.reaction = Number((res.article && res.article.mine && res.article.mine.reaction) || 0) || 0;
  state.canComment = state.reaction !== 0;
  readerMarkup(res);
  await loadComments();
}

async function loadComments() {
  const row = article();
  const ref = row.code || row.id;
  if (!ref) return;
  let res = null;
  try {
    res = await rpc("post_comments", { p_token: state.token, p_ref: ref, p_limit: 80 });
  } catch (error) {
    console.warn("[1World] comments:", error.message);
  }
  if (!res || res.ok !== true) return;
  state.comments = res;
  state.canComment = Boolean(res.can_comment);
  state.reaction = Number(res.reaction) || 0;
  const talk = qs("[data-r-talk]");
  if (talk) talk.innerHTML = talkMarkup();
}

/* ================================================================== */
/* events                                                             */
/* ================================================================== */
async function react(value) {
  if (!signedIn()) {
    toast({ title: "Sign in first", message: "Reactions need a member account.", tone: "error", iconName: "user" });
    return;
  }
  const row = article();
  const ref = row.code || row.id;
  const next = Number(state.reaction) === value ? 0 : value;
  let res = null;
  try {
    res = await rpc("post_react", { p_token: state.token, p_ref: ref, p_value: next });
  } catch (error) {
    toast({ title: "That did not go through", message: error.message, tone: "error" });
    return;
  }
  if (!res || !res.ok) {
    toast({ title: "Not saved", message: "The server refused the reaction.", tone: "error" });
    return;
  }
  const wasNone = !Number(state.reaction);
  state.reaction = Number(res.reaction) || 0;
  state.canComment = state.canComment || state.reaction !== 0;

  const acts = qs("[data-r-acts]");
  if (acts) acts.innerHTML = actsMarkup();
  const like = qs("[data-r-like]");
  const dislike = qs("[data-r-dislike]");
  if (like) like.textContent = compact(res.likes || 0);
  if (dislike) dislike.textContent = compact(res.dislikes || 0);

  if (state.reaction !== 0 && wasNone) {
    const talk = qs("[data-r-talk]");
    if (talk) talk.innerHTML = talkMarkup();
  }
}

async function follow() {
  if (!signedIn()) {
    toast({ title: "Sign in first", message: "Following needs a member account.", tone: "error", iconName: "user" });
    return;
  }
  const person = host();
  try {
    const res = await rpc("profile_follow_toggle", { p_token: state.token, p_ref: person.id || person.username || "" });
    if (res && res.ok) {
      toast({
        title: res.status === "pending" ? "Follow request sent" : res.following ? "You follow them now" : "You stopped following",
        message: res.status === "pending" ? "This member approves follows by hand." : "",
        tone: "success",
        iconName: "users",
      });
      qsa("[data-r-follow]").forEach((btn) => {
        btn.innerHTML = `${icon(res.following ? "check" : "plus")} ${res.following ? (res.status === "pending" ? "Requested" : "Following") : "Follow"}`;
      });
    }
  } catch (error) {
    toast({ title: "That did not go through", message: error.message, tone: "error" });
  }
}

async function share() {
  const row = article();
  const url = `${location.origin}${location.pathname}?id=${encodeURIComponent(row.code || row.id)}`;
  if (signedIn()) {
    rpc("post_reshare", { p_token: state.token, p_ref: row.code || row.id })
      .then((res) => {
        if (res && res.ok) toast({ title: res.reshared ? "Reshared to your feed" : "Reshare taken back", tone: "success", iconName: "share" });
      })
      .catch(() => {});
  }
  try {
    if (navigator.share) await navigator.share({ title: row.title || "Article", url });
    else {
      await navigator.clipboard.writeText(url);
      toast({ title: "Link copied", message: url, tone: "success", iconName: "link" });
    }
  } catch {
    /* the member closed the sheet */
  }
}

async function vote(commentId, agree) {
  if (!signedIn()) {
    toast({ title: "Sign in first", message: "Agreeing needs a member account.", tone: "error", iconName: "user" });
    return;
  }
  try {
    const res = await rpc("post_comment_vote", { p_token: state.token, p_comment_id: Number(commentId), p_agree: Boolean(agree) });
    if (res && res.ok) {
      const node = qs(`[data-comment="${commentId}"]`);
      if (node) {
        const agreeBtn = node.querySelector('[data-r-vote][data-agree="1"] b');
        const disagreeBtn = node.querySelector('[data-r-vote][data-agree="0"] b');
        if (agreeBtn) agreeBtn.textContent = res.agree;
        if (disagreeBtn) disagreeBtn.textContent = res.disagree;
      }
      return;
    }
    toast({ title: "Not saved", message: "The server refused that vote.", tone: "error" });
  } catch (error) {
    toast({ title: "Not saved", message: error.message, tone: "error" });
  }
}

function bind() {
  document.addEventListener("submit", async (event) => {
    const keyForm = event.target.closest("[data-r-key-form]");
    if (keyForm) {
      event.preventDefault();
      const input = qs("[data-r-key-input]");
      const err = qs("[data-r-key-err]");
      const value = String((input && input.value) || "").trim();
      if (!value) {
        if (input) input.focus();
        return;
      }
      if (err) err.hidden = true;
      const btn = keyForm.querySelector("button[type=submit]");
      if (btn) btn.disabled = true;
      const params = new URLSearchParams(location.search);
      params.set("key", value);
      history.replaceState(null, "", `${location.pathname}?${params.toString()}`);
      state.key = value;
      await load();
      if (btn && document.body.contains(btn)) btn.disabled = false;
      if (state.data && state.data.locked) {
        const nextErr = qs("[data-r-key-err]");
        if (nextErr) nextErr.hidden = false;
        history.replaceState(null, "", `${location.pathname}?id=${encodeURIComponent(state.ref)}`);
        state.key = "";
      }
      return;
    }

    const form = event.target.closest("[data-r-comment-form]");
    if (form) {
      event.preventDefault();
      const input = qs("[data-r-comment-input]");
      const body = String((input && input.value) || "").trim();
      if (!body) {
        if (input) input.focus();
        return;
      }
      const row = article();
      const btn = form.querySelector("button[type=submit]");
      if (btn) btn.disabled = true;
      try {
        const res = await rpc("post_comment", {
          p_token: state.token,
          p_ref: row.code || row.id,
          p_body: body,
          p_parent_id: state.parent || null,
        });
        if (res && res.ok) {
          if (input) input.value = "";
          state.parent = null;
          toast({ title: "Comment posted", tone: "success", iconName: "comment", duration: 2400 });
          await loadComments();
        } else {
          toast({
            title: "Not posted",
            message: res && res.error === "reaction" ? "Mark the piece useful first." : "The server refused the comment.",
            tone: "error",
          });
        }
      } catch (error) {
        toast({ title: "Not posted", message: error.message, tone: "error" });
      }
      if (btn) btn.disabled = false;
    }
  });

  document.addEventListener("click", async (event) => {
    const reactBtn = event.target.closest("[data-r-react]");
    if (reactBtn) {
      await react(Number(reactBtn.getAttribute("data-r-react")));
      return;
    }

    if (event.target.closest("[data-r-save]")) {
      const row = article();
      const on = toggleSaved(row.code || row.id);
      const btn = event.target.closest("[data-r-save]");
      btn.setAttribute("aria-pressed", String(on));
      btn.innerHTML = `${icon("bookmark")} ${on ? "Saved" : "Save"}`;
      toast({
        title: on ? "Saved for later" : "Removed from your list",
        message: "Kept on this device, next to the rest of your reading list.",
        tone: "info",
        iconName: "bookmark",
        duration: 2800,
      });
      return;
    }

    if (event.target.closest("[data-r-share]")) {
      await share();
      return;
    }

    if (event.target.closest("[data-r-report]")) {
      const box = qs("[data-r-report-box]");
      if (box) {
        box.hidden = false;
        box.querySelector("textarea")?.focus();
      }
      return;
    }

    if (event.target.closest("[data-r-report-cancel]")) {
      const box = qs("[data-r-report-box]");
      if (box) box.hidden = true;
      return;
    }

    if (event.target.closest("[data-r-report-send]")) {
      if (!signedIn()) {
        toast({ title: "Sign in first", message: "Reports need a member account.", tone: "error", iconName: "user" });
        return;
      }
      const row = article();
      const reason = (qs("[data-r-report-reason]") || {}).value || "other";
      const note = (qs("[data-r-report-note]") || {}).value || "";
      try {
        const res = await rpc("post_report", {
          p_token: state.token,
          p_ref: row.code || row.id,
          p_reason: reason,
          p_note: note,
        });
        if (res && res.ok) {
          toast({ title: "Report sent", message: "A moderator will look at it.", tone: "success", iconName: "flag" });
          const box = qs("[data-r-report-box]");
          if (box) box.hidden = true;
        } else {
          toast({ title: "Not sent", message: "The server refused the report.", tone: "error" });
        }
      } catch (error) {
        toast({ title: "Not sent", message: error.message, tone: "error" });
      }
      return;
    }

    if (event.target.closest("[data-r-follow]")) {
      await follow();
      return;
    }

    if (event.target.closest("[data-r-remind]")) {
      const btn = event.target.closest("[data-r-remind]");
      const row = article();
      const on = toggleRemind(row.code || state.ref);
      btn.innerHTML = `${icon(on ? "check" : "bell")} ${on ? "Reminder set" : "Remind me when I match"}`;
      toast({
        title: on ? "We will remind you" : "Reminder cleared",
        message: on
          ? "The mark is kept on this device — when you meet the audience, the piece opens on its own."
          : "You will not be reminded about this piece.",
        tone: on ? "success" : "info",
        iconName: on ? "bell" : "info",
        duration: 3000,
      });
      return;
    }

    const voteBtn = event.target.closest("[data-r-vote]");
    if (voteBtn) {
      await vote(voteBtn.getAttribute("data-r-vote"), voteBtn.getAttribute("data-agree") === "1");
      return;
    }

    const replyBtn = event.target.closest("[data-r-reply]");
    if (replyBtn) {
      const input = qs("[data-r-comment-input]");
      state.parent = Number(replyBtn.getAttribute("data-r-reply")) || null;
      const note = qs("[data-r-reply-note]");
      if (note) note.textContent = state.parent ? "Replying to a comment on this piece" : "";
      if (input) {
        input.placeholder = state.parent ? "Write your reply…" : "Add something to the piece…";
        input.focus();
        input.scrollIntoView({ block: "center", behavior: "smooth" });
      }
      return;
    }

    if (event.target.closest("[data-r-report-comment]")) {
      toast({
        title: "Comment reported",
        message: "The moderation queue has it.",
        tone: "default",
        iconName: "flag",
      });
      return;
    }

    if (event.target.closest("[data-r-goto-comments]")) {
      const talk = qs("#talk");
      if (talk) talk.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  });
}

/* ================================================================== */
/* boot                                                               */
/* ================================================================== */
function boot() {
  const reportBox = qs("[data-r-report-box]");
  if (reportBox) reportBox.hidden = true;
  bind();
  load();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot, { once: true });
} else {
  boot();
}
