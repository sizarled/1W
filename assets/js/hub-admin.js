/**
 * hub-admin.js — where a creator page is managed.
 * ------------------------------------------------------------------
 * A creator page is a *hub*: its name, its look, its audience. The page is
 * made, named and shaped here, on `dashboard.html#creator` — and nowhere
 * else. The studio (`creator.html`) writes what hangs under it and only that.
 *
 * The panes are the four the studio used to carry as management tabs:
 *
 *   Page          identity, related links, who sees it, viewers, staff, VIP,
 *                 and the delete door — `creator_hub_save` / `_access` / `_delete`
 *   Categories    the three-level tree                `creator_categories*`
 *   Participants  publishers and advertisers, approve  `creator_participants`,
 *                 or refuse, and the hub's own ads       `creator_ads`, `creator_request_decide`
 *   Subscribers   who follows it                      `creator_subscribers`
 *
 * It is mounted into a host element and owns its own small state, so the
 * dashboard does not have to know how a hub is written.
 */
import { rpc } from "./data.js";
import { qs, qsa, esc, num, timeAgo } from "./utils.js";
import { hydrateIcons } from "./icons.js";
import { toast } from "./ui.js";

/* ------------------------------------------------------------------ */
/* the module's own state                                             */
/* ------------------------------------------------------------------ */
const state = {
  token: "",
  section: null,
  hub: null,
  pane: "page",
  categories: [],
  subscribers: [],
  participants: null,
  ads: [],
  busy: false,
  confirm: null,
};

const el = (sel, root = document) => qs(sel, root);
const sectionOf = () => state.section;
const currentHub = () => state.hub;

/* what the page around us wants to know about */
let onChange = () => {};
let onDeleted = () => {};

const REQUIRES = [
  ["", "Anybody inside the criteria"],
  ["subscribe", "Subscribers only"],
  ["follow", "Followers only"],
];

const VISIBILITY = [
  ["public", "Public"],
  ["exclusive", "Exclusive"],
  ["private", "Private"],
];

const ACCESS_MESSAGES = {
  code: "One of those member codes is unknown.",
  audience: "That exclusive rule is not one we know.",
  viewers: "More viewers than this level allows.",
  not_found: "That hub is not yours.",
  seats: "More seats than this level allows.",
};

const MESSAGES = {
  session: "Your session ended — sign in again.",
  hub: "That hub is not yours, or it is gone.",
  kind: "That kind of content does not belong in this hub.",
  visibility: "Pick public, exclusive or private.",
  title: "A published title needs between 3 and 200 characters.",
  name: "A name needs between 2 and 80 characters.",
  url: "Links must start with http:// or https://.",
  media: "This kind needs its link before it can be published.",
  body: "Not enough text to publish.",
  inactive: "Publishing needs an active membership.",
  limit: "This hub kind is at its limit for your level.",
  not_found: "That item is gone.",
  member: "No member with that code.",
  duplicate: "That name already exists here.",
  deep: "Categories stop at the third level.",
  status: "That status is not allowed.",
  video_editor: "A video is published from video-editor.html, not from this table.",
  parent: "Pick the question first.",
  staff: "One of those staff codes is not a member.",
  vip: "One of those VIP codes is not a member.",
  links: "Ten related links is the maximum.",
  password: "This hub has no password yet.",
  expired: "The password window has closed.",
  denied: "Wrong password.",
  closed: "This hub has closed its door — subscriptions and follows are off.",
  viewers: "That many viewers is above this level's ceiling.",
  seats: "That many seats is above this level's ceiling.",
  code: "One of those member codes is unknown.",
  audience: "That exclusive rule is not one we know.",
  own: "This hub is yours already.",
};

const splitCodes = (value) =>
  String(value || "")
    .split(",")
    .map((code) => code.trim().toUpperCase())
    .filter(Boolean);

const splitList = (value) =>
  String(value || "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

const capText = (value) => (value === null || value === undefined || value === "" ? "no limit" : `${num(Number(value))} at once`);

const hubCeiling = (hub) => (hub && hub.viewer_limit != null ? Number(hub.viewer_limit) : null);

const ROLES = { publisher: "Publisher", advertiser: "Advertiser" };

const AD_FORMATS = [
  ["banner", "Banner"],
  ["video", "Video"],
  ["image", "Image"],
  ["paragraph", "Paragraph"],
];

const AD_FORMAT_LABEL = Object.fromEntries(AD_FORMATS);

const AD_FORMAT_ICON = { banner: "image", video: "film", image: "crop", paragraph: "article" };

const requestStatusLabel = (status) =>
  ({
    pending: "Waiting",
    approved: "Approved",
    rejected: "Refused",
    withdrawn: "Withdrawn",
  })[status] || "Waiting";

const studioLink = (code) => `creator.html?studio=${encodeURIComponent(code || "")}`;

function avatarBlock(url, name, cls = "crp-avatar") {
  const src = String(url || "").trim();
  if (src) return `<span class="${cls}"><img src="${esc(src)}" alt="" width="64" height="64" loading="lazy" /></span>`;
  return `<span class="${cls} is-initial" aria-hidden="true">${esc(initials(name))}</span>`;
}

function excludedField(codes, prefix) {
  const list = Array.isArray(codes) ? codes : [];
  return `
    <div class="cr-excluded" data-aud-excluded="${prefix}">
      <span class="dsh-field__label">Excluded members — comma separated codes</span>
      <div class="cr-chips" data-excluded-chips>
        ${
          list
            .map(
              (code) => `<span class="cr-chip-x">${esc(code)}<button type="button" data-cr-excl-remove="${esc(code)}" data-excl-prefix="${prefix}" aria-label="Stop excluding ${esc(code)}"><i data-icon="close"></i></button></span>`
            )
            .join("") || '<span class="cr-card__hint">Nobody is excluded.</span>'
        }
      </div>
      <input class="dsh-input" type="text" placeholder="ID100016, ID100015" data-excluded-input="${prefix}" />
    </div>`;
}

function audienceFields(audience, prefix, open = false) {
  const aud = audience && typeof audience === "object" ? audience : {};
  const requires = String(aud.requires || "");
  const countries = Array.isArray(aud.countries) ? aud.countries.join(", ") : "";
  const langs = Array.isArray(aud.languages) ? aud.languages.join(", ") : "";
  return `
    <div class="cr-aud" data-aud="${prefix}" ${open ? "" : "hidden"}>
      <div class="cr-grid3">
        <label class="dsh-field">
          <span class="dsh-field__label">Who gets in</span>
          <select class="dsh-select" data-aud-requires="${prefix}">
            ${REQUIRES.map(([value, label]) => `<option value="${value}" ${requires === value ? "selected" : ""}>${label}</option>`).join("")}
          </select>
        </label>
        <label class="dsh-field">
          <span class="dsh-field__label">Countries — comma separated, empty is any</span>
          <input class="dsh-input" type="text" value="${esc(countries)}" placeholder="Morocco, Egypt" data-aud-countries="${prefix}" />
        </label>
        <label class="dsh-field">
          <span class="dsh-field__label">Languages — comma separated, empty is any</span>
          <input class="dsh-input" type="text" value="${esc(langs)}" placeholder="ar, fr" data-aud-languages="${prefix}" />
        </label>
      </div>
      <div class="cr-grid2">
        <label class="dsh-field">
          <span class="dsh-field__label">Account level at least</span>
          <input class="dsh-input" type="number" min="0" max="10" value="${esc(String(aud.level_min || 0))}" data-aud-level="${prefix}" />
        </label>
        <label class="dsh-field">
          <span class="dsh-field__label">Wealth — points at least</span>
          <input class="dsh-input" type="number" min="0" value="${esc(String(aud.wealth_min || 0))}" data-aud-wealth="${prefix}" />
        </label>
      </div>
    </div>`;
}

function audienceOf(prefix) {
  const val = (name) => el(`[data-${name}="${prefix}"]`)?.value ?? "";
  return {
    requires: val("aud-requires"),
    countries: splitList(val("aud-countries")),
    languages: splitList(val("aud-languages")),
    level_min: Number(val("aud-level") || 0),
    wealth_min: Number(val("aud-wealth") || 0),
  };
}

const audienceIsEmpty = (aud) =>
  !aud.requires && !aud.countries.length && !aud.languages.length && !aud.level_min && !aud.wealth_min;

const initials = (name) =>
  String(name || "?")
    .trim()
    .slice(0, 2)
    .toUpperCase() || "?";

function audienceFor(visibility, prefix) {
  if (visibility !== "exclusive") return {};
  const aud = audienceOf(prefix);
  return audienceIsEmpty(aud) ? {} : aud;
}

function excludedOf(prefix) {
  const node = el(`[data-excluded-input="${prefix}"]`);
  const typed = splitCodes(node ? node.value : "");
  const chips = qsa(`[data-aud-excluded="${prefix}"] [data-cr-excl-remove]`).map((btn) =>
    String(btn.dataset.crExclRemove || "").toUpperCase()
  );
  return [...new Set([...chips, ...typed])].slice(0, 200);
}

function emptyBlock(iconName, title, text, action = "") {
  return `
    <div class="cr-empty">
      <i data-icon="${esc(iconName)}"></i>
      <p class="cr-empty__title">${esc(title)}</p>
      <p class="cr-empty__text">${esc(text)}</p>
      ${action}
    </div>`;
}


/* ================================================================== */
/* the four panes                                                     */
/* ================================================================== */
function renderSettings(host, hub) {
  const section = state.section;
  const links = Array.isArray(hub.links) ? hub.links : [];
  const linkRows = (links.length ? links : [{ label: "", url: "" }])
    .map(
      (link, index) => `
      <div class="cr-link-row" data-link-row data-index="${index}">
        <input class="dsh-input" type="text" maxlength="40" value="${esc(link.label || "")}" placeholder="Label" data-link-label />
        <input class="dsh-input" type="url" value="${esc(link.url || "")}" placeholder="https://…" data-link-url />
        <button class="dsh-btn dsh-btn--sm" type="button" data-cr-link-remove aria-label="Remove link"><i data-icon="trash"></i></button>
      </div>`
    )
    .join("");

  host.innerHTML = `
    <div class="cr-settings" data-settings="${esc(hub.id)}">
      <div class="cr-card">
        <div class="cr-card__head">
          <h2 class="cr-card__title">${esc(section.label)} identity</h2>
          <span class="cr-bar__count">${hub.owned === false ? "You are staff on this one" : "You own this one"}</span>
        </div>

        <div class="cr-logo-row">
          <span class="cr-logo-row__mark" data-logo-mark>
            ${hub.logo_url ? `<img src="${esc(hub.logo_url)}" alt="" width="64" height="64" />` : '<i data-icon="image"></i>'}
          </span>
          <label class="dsh-field">
            <span class="dsh-field__label">Logo link</span>
            <input class="dsh-input" type="url" value="${esc(hub.logo_url || "")}" placeholder="https://…/logo.png" data-hub-logo />
          </label>
        </div>

        <div class="cr-cover-row">
          <span class="cr-cover-row__mark" data-cover-mark>
            ${hub.cover_url ? `<img src="${esc(hub.cover_url)}" alt="" width="108" height="62" />` : '<i data-icon="image"></i>'}
          </span>
          <label class="dsh-field">
            <span class="dsh-field__label">Cover link</span>
            <input class="dsh-input" type="url" value="${esc(hub.cover_url || "")}" placeholder="https://…/cover.jpg" data-hub-cover />
          </label>
        </div>

        <label class="dsh-field">
          <span class="dsh-field__label">Name</span>
          <input class="dsh-input" type="text" maxlength="80" value="${esc(hub.name || "")}" data-hub-name />
        </label>

        <label class="dsh-field">
          <span class="dsh-field__label">Description</span>
          <textarea class="dsh-textarea" rows="3" maxlength="600" data-hub-description>${esc(hub.description || "")}</textarea>
        </label>

        <div class="cr-grid2">
          <label class="dsh-field">
            <span class="dsh-field__label">Field — one only</span>
            <input class="dsh-input" type="text" maxlength="40" value="${esc(hub.field || "")}" placeholder="Cinema" data-hub-field />
          </label>
          <label class="dsh-field">
            <span class="dsh-field__label">Niches — up to five, comma separated</span>
            <input class="dsh-input" type="text" maxlength="200" value="${esc((hub.niches || []).join(", "))}" placeholder="Documentary, Essay" data-hub-niches />
          </label>
        </div>
      </div>

      <div class="cr-card">
        <div class="cr-card__head"><h2 class="cr-card__title">Related links</h2><span class="cr-bar__count">up to ten</span></div>
        <div class="cr-chips" data-links>${linkRows}</div>
        <div><button class="dsh-btn dsh-btn--sm" type="button" data-cr-link-add><i data-icon="plus"></i> Add a link</button></div>
      </div>

      <div class="cr-card">
        <div class="cr-card__head"><h2 class="cr-card__title">Who sees it</h2></div>
        <div class="cr-grid3">
          <label class="dsh-field">
            <span class="dsh-field__label">Visibility</span>
            <select class="dsh-select" data-hub-visibility>
              ${VISIBILITY.map(([value, label]) => `<option value="${value}" ${hub.visibility === value ? "selected" : ""}>${label}${value === "public" ? " — anyone" : value === "exclusive" ? " — subscribers" : " — password / VIP"}</option>`).join("")}
            </select>
          </label>
          <label class="dsh-field cr-hidden-field" data-hub-pass-wrap ${hub.visibility === "private" ? "" : "hidden"}>
            <span class="dsh-field__label">Password</span>
            <input class="dsh-input" type="text" maxlength="60" value="" placeholder="${hub.locked ? "•••• (unchanged)" : "set a password"}" data-hub-password autocomplete="new-password" />
          </label>
          <label class="dsh-field cr-hidden-field" data-hub-hours-wrap ${hub.visibility === "private" ? "" : "hidden"}>
            <span class="dsh-field__label">Valid for</span>
            <select class="dsh-select" data-hub-hours>
              ${[[1, "1 hour"], [6, "6 hours"], [24, "1 day"], [72, "3 days"], [168, "1 week"], [336, "2 weeks"], [720, "1 month"]]
                .map(([hours, label]) => `<option value="${hours}" ${hours === 24 ? "selected" : ""}>${label}</option>`)
                .join("")}
            </select>
          </label>
        </div>
        <p class="cr-card__hint">${hub.password_until ? `The current password closes on ${esc(new Date(hub.password_until).toLocaleString())}.` : "A private hub asks for its password before anything opens; the window runs from one hour to one month."}</p>

        ${excludedField(hub.excluded, "hub")}

        <p class="cr-card__hint">Public is everyone except the excluded list. Exclusive asks for a subscription or a follow, and optionally a country, a language, an account level and a wealth of points.</p>
        ${audienceFields(hub.audience, "hub", hub.visibility === "exclusive")}

        <label class="cr-switch">
          <input type="checkbox" data-hub-auto ${hub.auto_accept === false ? "" : "checked"} />
          <span><strong>Take subscriptions and follows</strong> — with this off, nobody can subscribe to or follow this ${esc(section.noun)}.</span>
        </label>
      </div>

      <div class="cr-card">
        <div class="cr-card__head">
          <h2 class="cr-card__title">${section.caps ? "Available devices" : "Viewers"}</h2>
          <span class="cr-bar__count">${esc(section.caps ? "how many may watch at once" : "level based")}</span>
        </div>
        <div class="cr-grid2">
          <label class="dsh-field">
            <span class="dsh-field__label">Simultaneous viewers — empty means the level's ceiling</span>
            <input class="dsh-input" type="number" min="0" value="${hub.max_viewers != null ? esc(String(hub.max_viewers)) : ""}" placeholder="${esc(String(hubCeiling(hub) ?? ""))}" data-hub-viewers />
          </label>
          <div class="cr-pill-wrap">
            <span class="cr-pill" data-hub-cap><i data-icon="users"></i>${esc(capText(hubCeiling(hub)))}</span>
          </div>
        </div>
        <p class="cr-card__hint">${
          section.kind === "cinema"
            ? "A cinema's films take 100 viewers per level and its series and episodes 1000; the top level has no ceiling. A film or an episode may carry a smaller number of its own."
            : section.kind === "server"
              ? "A server takes 100 simultaneous viewers per level, and the top level has no ceiling. A channel or a list may carry a smaller number of its own."
              : "Simultaneous viewers stay open for this kind of hub."
        }</p>
      </div>

      <div class="cr-card">
        <div class="cr-card__head">
          <h2 class="cr-card__title">Staff</h2>
          <span class="cr-bar__count">they see this ${esc(section.noun)} in their own studio</span>
        </div>
        <p class="cr-card__hint">Staff are the publishers whose requests you approved — the Participants tab lists them. A member code added here works too.</p>
        <div class="cr-chips" data-staff>
          ${(hub.staff || []).map((code) => `<span class="cr-chip-x">${esc(code)}<button type="button" data-cr-chip-remove="staff" data-code="${esc(code)}" aria-label="Remove ${esc(code)} from staff"><i data-icon="close"></i></button></span>`).join("") || '<span class="cr-card__hint">Nobody yet.</span>'}
        </div>
        <label class="dsh-field">
          <span class="dsh-field__label">Member codes — comma separated</span>
          <input class="dsh-input" type="text" placeholder="ID100003, ID100015" data-hub-staff />
        </label>
      </div>

      <div class="cr-card">
        <div class="cr-card__head">
          <h2 class="cr-card__title">VIP list</h2>
          <span class="cr-bar__count">${(hub.vip || []).length} member${(hub.vip || []).length === 1 ? "" : "s"}</span>
        </div>
        <div class="cr-chips" data-vip>
          ${(hub.vip || []).map((code) => `<span class="cr-chip-x">${esc(code)}<button type="button" data-cr-chip-remove="vip" data-code="${esc(code)}" aria-label="Remove ${esc(code)} from VIP"><i data-icon="close"></i></button></span>`).join("") || '<span class="cr-card__hint">Nobody yet — add a member code to let them in even when the hub is private.</span>'}
        </div>
        <label class="dsh-field">
          <span class="dsh-field__label">Member codes — comma separated</span>
          <input class="dsh-input" type="text" placeholder="ID100015" data-hub-vip />
        </label>
      </div>

      <div class="cr-save">
        <span class="cr-save__state" data-hub-state></span>
        <button class="dsh-btn dsh-btn--primary dsh-btn--sm" type="button" data-cr-save-hub><i data-icon="check"></i> Save ${esc(section.noun)}</button>
      </div>

      ${
        hub.owned === false
          ? ""
          : `<div class="cr-danger">
              <p class="cr-danger__text">Deleting the ${esc(section.noun)} removes everything under it — its items, categories and subscribers. This cannot be undone.</p>
              <button class="dsh-btn dsh-btn--sm dsh-btn--danger" type="button" data-cr-delete-hub><i data-icon="trash"></i> Delete ${esc(section.noun)}</button>
            </div>`
      }
    </div>`;
  hydrateIcons(host);
}

function renderSubscribers(host, hub) {
  const rows = state.subscribers || [];
  host.innerHTML = `
    <div class="cr-bar">
      <div class="cr-bar__left">
        <span class="cr-bar__title">Subscribers</span>
        <span class="cr-bar__count">${esc(num(rows.length))} member${rows.length === 1 ? "" : "s"} · ${esc(num(hub.subscribers || 0))} counted</span>
      </div>
      <span class="cr-pill"><i data-icon="users"></i>${esc(num(hub.vip?.length || 0))} VIP · ${esc(num(hub.staff?.length || 0))} staff</span>
    </div>
    ${
      rows.length
        ? `<div class="dsh-table-wrap cr-table"><table class="dsh-table">
            <thead><tr><th>Member</th><th>Code</th><th>Country</th><th>Subscribed</th></tr></thead>
            <tbody>${rows
              .map(
                (row) => `<tr>
                  <td><strong>${esc(row.name || "Member")}</strong> <span class="cr-code">${esc(row.username || "")}</span></td>
                  <td class="cr-code">${esc(row.code || "—")}</td>
                  <td>${esc(row.country || "—")}</td>
                  <td>${esc(timeAgo(row.since) || "—")}</td>
                </tr>`
              )
              .join("")}</tbody>
          </table></div>`
        : emptyBlock("users", "No subscriber yet", `When a member subscribes to your ${state.section.noun}, they appear here with their code, country and date.`)
    }`;
  hydrateIcons(host);
}

function renderCategories(host, hub) {
  const rows = state.categories || [];
  const byParent = new Map();
  rows.forEach((row) => {
    const key = row.parent || "root";
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key).push(row);
  });

  const ordered = [];
  const walk = (parent, depth) => {
    (byParent.get(parent) || []).forEach((row) => {
      ordered.push({ ...row, depth });
      walk(row.id, depth + 1);
    });
  };
  walk("root", 1);

  const options = ordered
    .filter((row) => row.level < 3)
    .map((row) => `<option value="${esc(row.id)}">${"— ".repeat(row.level - 1)}${esc(row.name)}</option>`)
    .join("");

  host.innerHTML = `
    <div class="cr-card">
      <div class="cr-card__head">
        <h2 class="cr-card__title">Categories</h2>
        <span class="cr-bar__count">main → second → last · three levels</span>
      </div>
      ${
        ordered.length
          ? `<div class="dsh-table-wrap cr-table"><table class="dsh-table">
              <thead><tr><th>Name</th><th>Level</th><th>Items</th><th></th></tr></thead>
              <tbody>${ordered
                .map(
                  (row) => `<tr>
                    <td><div class="cr-cat cr-cat--l${row.level}"><span class="cr-cat__lvl">${row.level}</span><span class="cr-cat__name">${esc(row.name)}</span></div></td>
                    <td>${row.level === 1 ? "Main" : row.level === 2 ? "Second" : "Last"}</td>
                    <td class="cr-num">${esc(num(row.items || 0))}</td>
                    <td><div class="dsh-table__actions">
                      <button class="dsh-btn dsh-btn--sm" type="button" data-cr-cat-del="${esc(row.id)}"><i data-icon="trash"></i> Delete</button>
                    </div></td>
                  </tr>`
                )
                .join("")}</tbody>
            </table></div>`
          : emptyBlock("filter", "No category yet", "Categories organise what sits in this hub. The first one is the main category; a second and a third can sit under it.")
      }
      <div class="cr-grid3">
        <label class="dsh-field">
          <span class="dsh-field__label">Name</span>
          <input class="dsh-input" type="text" maxlength="60" placeholder="Documentary" data-cat-name />
        </label>
        <label class="dsh-field">
          <span class="dsh-field__label">Under</span>
          <select class="dsh-select" data-cat-parent><option value="">Nothing — a main category</option>${options}</select>
        </label>
        <div style="display:flex;align-items:flex-end">
          <button class="dsh-btn dsh-btn--primary dsh-btn--sm" type="button" data-cr-cat-add><i data-icon="plus"></i> Add category</button>
        </div>
      </div>
    </div>`;
  hydrateIcons(host);
}

function renderParticipants(host, hub) {
  const data = state.participants || {};
  const rows = Array.isArray(data.rows) ? data.rows : [];
  const pubs = Array.isArray(data.publishers) ? data.publishers : [];
  const advs = Array.isArray(data.advertisers) ? data.advertisers : [];
  const ads = Array.isArray(state.ads) ? state.ads : [];
  const counts = data.counts || {};
  const pending = rows.filter((row) => row.status === "pending");
  const decided = rows.filter((row) => row.status !== "pending");

  const requestCard = (row) => {
    const member = row.member || {};
    const role = ROLES[row.role] || row.role;
    return `
      <article class="cr-req ${row.status === "pending" ? "is-pending" : ""}" data-req="${esc(row.id)}">
        <span class="cr-req__avatar">${avatarBlock(member.avatar, member.name, "crp-avatar crp-avatar--sm")}</span>
        <div class="cr-req__body">
          <p class="cr-req__head">
            <span class="cr-req__name">${esc(member.name || "Member")}</span>
            <span class="cr-req__code">${esc(member.code || "")}</span>
            <span class="cr-chip" data-tone="${esc(row.role)}">${esc(role)}</span>
            ${row.format ? `<span class="cr-chip" data-tone="format">${esc(AD_FORMAT_LABEL[row.format] || row.format)}</span>` : ""}
            <span class="cr-chip" data-tone="${esc(row.status)}">${esc(requestStatusLabel(row.status))}</span>
          </p>
          <p class="cr-req__text">${esc(row.message || "")}</p>
          <p class="cr-req__meta">
            <span>${esc(member.username || "")}</span>
            ${member.country ? `<span>${esc(member.country)}</span>` : ""}
            ${row.budget ? `<span>${esc(num(Number(row.budget) || 0))} pts</span>` : ""}
            ${row.link ? `<a href="${esc(row.link)}" target="_blank" rel="noopener noreferrer">The sample</a>` : ""}
            <span>${esc(timeAgo(row.created_at))}</span>
          </p>
        </div>
        <div class="cr-req__acts">
          ${row.status === "pending"
            ? `<button class="dsh-btn dsh-btn--primary dsh-btn--sm" type="button" data-cr-req="approve" data-id="${esc(row.id)}"><i data-icon="check"></i> Approve</button>
               <button class="dsh-btn dsh-btn--sm" type="button" data-cr-req="reject" data-id="${esc(row.id)}"><i data-icon="close"></i> Refuse</button>`
            : `<span class="cr-req__since">${row.decided_at ? esc(timeAgo(row.decided_at)) : ""}</span>`}
        </div>
      </article>`;
  };

  const listRow = (member, extra = "") => `
    <li class="cr-who">
      ${avatarBlock(member.avatar, member.name, "crp-avatar crp-avatar--sm")}
      <span class="cr-who__name">${esc(member.name || "Member")}</span>
      <span class="cr-who__code">${esc(member.code || "")}</span>
      <span class="cr-who__handle">${esc(member.username || "")}</span>
      ${extra}
    </li>`;

  const adRows = ads.length
    ? ads
        .map(
          (ad) => `
      <li class="cr-adrow">
        <span class="cr-adrow__format"><i data-icon="${esc(AD_FORMAT_ICON[ad.format] || "image")}"></i>${esc(AD_FORMAT_LABEL[ad.format] || ad.format)}</span>
        <span class="cr-adrow__title">${esc(ad.title)}</span>
        <span class="cr-adrow__who">${esc(ad.member?.name || "")}</span>
        <span class="cr-chip" data-tone="${ad.status === "live" ? "public" : "private"}">${esc(ad.status === "live" ? "Live" : "Paused")}</span>
        <span class="cr-adrow__num">${esc(num(Number(ad.impressions) || 0))}</span>
        <span class="cr-adrow__num">${esc(num(Number(ad.clicks) || 0))}</span>
        <button class="dsh-btn dsh-btn--sm" type="button" data-cr-ad-del="${esc(ad.id)}" aria-label="Remove the ad"><i data-icon="trash"></i></button>
      </li>`
        )
        .join("")
    : `<li class="cr-empty__line">No ad yet.</li>`;

  host.innerHTML = `
    <div class="cr-part">
      <div class="cr-bar">
        <span class="cr-bar__count">${esc(num(Number(counts.pending) || 0))} waiting · ${esc(num(pubs.length))} publisher${pubs.length === 1 ? "" : "s"} · ${esc(num(advs.length))} advertiser${advs.length === 1 ? "" : "s"}</span>
        <span class="cr-part__link">
          <i data-icon="link"></i><code>${esc(studioLink(hub.code || hub.id))}</code>
          <button class="dsh-btn dsh-btn--sm" type="button" data-cr-copy="${esc(studioLink(hub.code || hub.id))}">Copy</button>
        </span>
      </div>

      <section class="cr-panel">
        <h2 class="cr-panel__title"><i data-icon="users"></i> Waiting for an answer</h2>
        ${pending.length ? pending.map(requestCard).join("") : `<p class="cr-empty__line">Nobody is waiting. Publishers and advertisers ask from the hub's own page.</p>`}
      </section>

      <section class="cr-panel">
        <h2 class="cr-panel__title"><i data-icon="article"></i> Publishers <span class="cr-panel__n">${pubs.length}</span></h2>
        ${pubs.length ? `<ul class="cr-who-list">${pubs.map((member) => listRow(member)).join("")}</ul>` : `<p class="cr-empty__line">No publisher yet — their drafts would arrive as drafts in this hub's tables.</p>`}
      </section>

      <section class="cr-panel">
        <h2 class="cr-panel__title"><i data-icon="target"></i> Advertisers <span class="cr-panel__n">${advs.length}</span></h2>
        ${advs.length ? `<ul class="cr-who-list">${advs.map((member) => listRow(member, `<span class="cr-who__extra">${esc(num(Number(member.ads) || 0))} ad${Number(member.ads) === 1 ? "" : "s"}</span>`)).join("")}</ul>` : `<p class="cr-empty__line">No advertiser yet — a banner, a video, an image or a paragraph, chosen by them.</p>`}
      </section>

      <section class="cr-panel">
        <h2 class="cr-panel__title"><i data-icon="fire"></i> The ads in this hub <span class="cr-panel__n">${ads.length}</span></h2>
        ${
          ads.length
            ? `<div class="cr-adtable">
                 <div class="cr-adtable__head"><span>Format</span><span>Title</span><span>Advertiser</span><span>State</span><span>Views</span><span>Clicks</span><span></span></div>
                 <ul class="cr-adlist">${adRows}</ul>
               </div>`
            : `<p class="cr-empty__line">No ad in this hub yet.</p>`
        }
      </section>

      ${decided.length
        ? `<section class="cr-panel">
             <h2 class="cr-panel__title"><i data-icon="clock"></i> Already answered</h2>
             ${decided.map(requestCard).join("")}
           </section>`
        : ""}
    </div>`;
  hydrateIcons(host);
}

async function decideRequest(id, decision) {
  const stateNode = el(`[data-req="${id}"] .cr-req__acts`);
  if (stateNode) stateNode.innerHTML = `<span class="cr-req__since">Working…</span>`;
  try {
    const res = await rpc("creator_request_decide", { p_token: state.token, p_id: id, p_decision: decision });
    if (!res || !res.ok) {
      toast({
        title: "Not decided",
        message:
          { session: "The session ended.", decided: "Somebody already answered this one.", not_found: "That request is gone.", decision: "Unknown answer." }[
            res?.error
          ] || "The server refused the answer.",
        tone: "error",
      });
      return showPane("participants");
    }
    toast({
      title: decision === "approve" ? "Approved" : "Refused",
      message:
        decision === "approve"
          ? "They can work in this hub now."
          : "The request is closed; nothing was shared.",
      iconName: decision === "approve" ? "check" : "close",
    });
    await showPane("participants");
  } catch {
    toast({ title: "Not decided", message: "The connection dropped.", tone: "error" });
  }
}

async function removeAd(id) {
  try {
    const res = await rpc("creator_ad_delete", { p_token: state.token, p_id: id });
    if (!res || !res.ok) {
      toast({ title: "Not removed", message: "The server refused it.", tone: "error" });
      return;
    }
    toast({ title: "Ad removed", message: "It is gone from the hub.", iconName: "trash" });
    await showPane("participants");
  } catch {
    toast({ title: "Not removed", message: "The connection dropped.", tone: "error" });
  }
}

function hubPayload(hub) {
  const root = el("[data-settings]");
  if (!root) return null;
  const value = (sel) => el(sel, root)?.value ?? "";
  const links = qsa("[data-link-row]", root)
    .map((row) => ({
      label: (qs("[data-link-label]", row)?.value || "").trim(),
      url: (qs("[data-link-url]", row)?.value || "").trim(),
    }))
    .filter((link) => link.url || link.label);

  return {
    p_token: state.token,
    p_id: hub.id,
    p_kind: hub.kind,
    p_name: value("[data-hub-name]").trim(),
    p_description: value("[data-hub-description]"),
    p_logo_url: value("[data-hub-logo]").trim(),
    p_cover_url: value("[data-hub-cover]").trim(),
    p_links: links,
    p_field: value("[data-hub-field]").trim(),
    p_niches: value("[data-hub-niches]")
      .split(",")
      .map((n) => n.trim())
      .filter(Boolean),
    p_visibility: value("[data-hub-visibility]"),
    p_password: value("[data-hub-password]"),
    p_hours: Number(value("[data-hub-hours]") || 24),
    p_staff: [
      ...(hub.staff || []),
      ...value("[data-hub-staff]")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    ],
    p_vip: [
      ...(hub.vip || []),
      ...value("[data-hub-vip]")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    ],
  };
}

function accessPayload(hub) {
  const vis = el("[data-hub-visibility]")?.value || hub.visibility || "public";
  const viewers = el("[data-hub-viewers]")?.value ?? "";
  return {
    p_token: state.token,
    p_hub: hub.id,
    p_excluded: excludedOf("hub"),
    p_audience: audienceFor(vis, "hub"),
    p_auto_accept: Boolean(el("[data-hub-auto]")?.checked),
    p_viewers: viewers === "" ? 0 : Number(viewers),
  };
}

function saveStateText(text, tone = "") {
  const node = el("[data-hub-state]");
  if (!node) return;
  node.textContent = text;
  node.dataset.tone = tone;
}

async function saveHub() {
  const hub = currentHub();
  if (!hub || state.busy) return;
  const payload = hubPayload(hub);
  if (!payload) return;
  state.busy = true;
  saveStateText("Saving…");
  let res = null;
  try {
    res = await rpc("creator_hub_save", payload);
  } catch {
    res = null;
  }
  state.busy = false;
  if (!res || res.ok !== true) {
    const message = MESSAGES[res?.error] || "The save did not go through.";
    saveStateText(message, "error");
    toast({ title: "Not saved", message, tone: "error" });
    return;
  }
  let access = null;
  try {
    access = await rpc("creator_hub_access", accessPayload(res.hub));
  } catch {
    access = null;
  }
  if (access && access.ok === false && access.error) {
    const message = ACCESS_MESSAGES[access.error] || MESSAGES[access.error] || "The access rules were refused.";
    saveStateText(message, "error");
    toast({ title: "Access not saved", message, tone: "error" });
  }
  const saved = access && access.ok ? access.hub : res.hub;
  state.hub = { ...state.hub, ...saved };
  const pass = el("[data-hub-password]");
  if (pass) {
    pass.value = "";
    pass.placeholder = saved.locked ? "•••• (unchanged)" : "set a password";
  }
  const staffInput = el("[data-hub-staff]");
  if (staffInput) staffInput.value = "";
  const vipInput = el("[data-hub-vip]");
  if (vipInput) vipInput.value = "";
  paintHead();
  renderPane();
  saveStateText(`Saved ${timeAgo(saved.updated_at) || "just now"}`, "ok");
  onChange(state.hub);
  toast({ title: "Saved", message: `${saved.name} is up to date.`, iconName: "check" });
}

async function deleteHub() {
  const hub = currentHub();
  if (!hub) return;
  let res = null;
  try {
    res = await rpc("creator_hub_delete", { p_token: state.token, p_id: hub.id });
  } catch {
    res = null;
  }
  closeModal();
  if (!res || res.ok !== true) {
    toast({ title: "Not deleted", message: MESSAGES[res?.error] || "The server did not confirm.", tone: "error" });
    return;
  }
  state.hub = null;
  onDeleted(hub);
  toast({ title: "Deleted", message: `${hub.name} is gone with everything under it.`, iconName: "trash" });
}

async function removeChip(list, code) {
  const hub = currentHub();
  if (!hub || !code) return;
  const fn = list === "vip" ? "creator_hub_vip" : "creator_hub_staff";
  let res = null;
  try {
    res = await rpc(fn, { p_token: state.token, p_id: hub.id, p_action: "remove", p_ref: code });
  } catch {
    res = null;
  }
  if (!res || res.ok !== true) {
    toast({ title: "Not removed", message: MESSAGES[res?.error] || "The server refused.", tone: "error" });
    return;
  }
  hub[list] = res[list] || [];
  paintHead();
  renderPane();
  toast({ title: "Removed", message: `${code} is off the ${list} list.`, iconName: "check" });
}

async function addCategory() {
  const hub = currentHub();
  const name = (el("[data-cat-name]")?.value || "").trim();
  const parent = el("[data-cat-parent]")?.value || null;
  if (!hub || !name) {
    toast({ title: "A category needs a name", tone: "error" });
    return;
  }
  let res = null;
  try {
    res = await rpc("creator_category_save", { p_token: state.token, p_id: null, p_hub: hub.id, p_parent: parent, p_name: name });
  } catch {
    res = null;
  }
  if (!res || res.ok !== true) {
    const message = MESSAGES[res?.error] || "The category was refused.";
    toast({ title: "Not added", message, tone: "error" });
    return;
  }
  state.categories = [...state.categories, res.row];
  renderPane();
  toast({ title: "Category added", message: name, iconName: "check" });
}

async function deleteCategory(id) {
  const hub = currentHub();
  let res = null;
  try {
    res = await rpc("creator_category_delete", { p_token: state.token, p_id: id });
  } catch {
    res = null;
  }
  if (!res || res.ok !== true) {
    toast({ title: "Not deleted", message: MESSAGES[res?.error] || "The server refused.", tone: "error" });
    return;
  }
  state.categories = state.categories.filter((row) => row.id !== id);
  renderPane();
}

/* ================================================================== */
/* the frame: a head, four panes, and the sheet's own chrome          */
/* ================================================================== */

/** The four panes a page has, in the order the head draws them. */
function panesOf() {
  const section = state.section || {};
  return [
    { key: "page", label: `${section.label || "Page"} management`, icon: "settings" },
    ...(section.categories ? [{ key: "categories", label: "Categories", icon: "filter" }] : []),
    { key: "participants", label: "Participants", icon: "users" },
    { key: "subscribers", label: "Subscribers", icon: "target" },
  ];
}

/** The strip above the pane: the page, its code, and the four tabs. */
function paintHead() {
  const host = el("[data-ha-head]");
  if (!host) return;
  const hub = state.hub || {};
  const section = state.section || {};
  host.innerHTML = `
    <div class="ha__id">
      <span class="ha__mark">${
        hub.logo_url ? `<img src="${esc(hub.logo_url)}" alt="" width="44" height="44" />` : `<i data-icon="${esc(section.icon || "settings")}"></i>`
      }</span>
      <div class="ha__who">
        <p class="ha__name">${esc(hub.name || "A page")}</p>
        <p class="ha__meta">
          <span>${esc(section.surface || section.label || "")}</span>
          ${hub.code ? `<span class="ha__code">${esc(hub.code)}</span>` : ""}
          <span class="dsh-chip" data-tone="${hub.status === "hidden" ? "off" : "on"}">${hub.status === "hidden" ? "Hidden" : "Live"}</span>
          ${hub.owned === false ? '<span class="dsh-chip" data-tone="off">Staff</span>' : ""}
        </p>
      </div>
    </div>
    <div class="dsh-tabs ha__tabs" role="tablist" aria-label="Manage this page">
      ${panesOf()
        .map(
          (pane) => `<button class="dsh-tab${state.pane === pane.key ? " is-on" : ""}" type="button" role="tab"
              aria-selected="${state.pane === pane.key}" data-ha-pane="${esc(pane.key)}">
              <i data-icon="${esc(pane.icon)}"></i>${esc(pane.label)}</button>`
        )
        .join("")}
    </div>`;
  hydrateIcons(host);
}

/** Which pane is open, and the data it needs. */
async function showPane(key) {
  if (key && panesOf().some((pane) => pane.key === key)) state.pane = key;
  paintHead();
  const hub = state.hub;
  if (!hub) return;
  if (state.pane === "categories" && !state.categories.length) {
    const res = await rpc("creator_categories", { p_token: state.token, p_hub: hub.id });
    state.categories = res && res.ok ? res.rows || [] : [];
  }
  if (state.pane === "subscribers") {
    const res = await rpc("creator_subscribers", { p_token: state.token, p_hub: hub.id });
    state.subscribers = res && res.ok ? res.rows || [] : [];
  }
  if (state.pane === "participants") {
    const who = await rpc("creator_participants", { p_token: state.token, p_hub: hub.id });
    state.participants = who && who.ok ? who : null;
    const ads = await rpc("creator_ads", { p_token: state.token, p_hub: hub.id });
    state.ads = ads && ads.ok ? ads.rows || [] : [];
  }
  renderPane();
}

/** Draw the open pane into the host. */
function renderPane() {
  const view = el("[data-ha-view]");
  if (!view || !state.hub) return;
  if (state.pane === "categories") renderCategories(view, state.hub);
  else if (state.pane === "participants") renderParticipants(view, state.hub);
  else if (state.pane === "subscribers") renderSubscribers(view, state.hub);
  else renderSettings(view, state.hub);
  hydrateIcons(view);
}

/* the sheet that sits over the pane: a delete, and nothing else */
function openModal(html) {
  const host = el("[data-ha-modal]");
  if (!host) return;
  host.innerHTML = `<div class="cr-modal" data-ha-sheet><div class="cr-modal__card" role="dialog" aria-modal="true">${html}</div></div>`;
  hydrateIcons(host);
}

function closeModal() {
  const host = el("[data-ha-modal]");
  if (host) host.innerHTML = "";
  state.confirm = null;
}

function openConfirm(title, text, action, id) {
  state.confirm = { action, id };
  openModal(`
    <h2 class="cr-modal__title">${esc(title)}</h2>
    <p class="cr-modal__text">${esc(text)}</p>
    <div class="cr-modal__actions">
      <button class="dsh-btn dsh-btn--sm" type="button" data-ha-cancel>Cancel</button>
      <button class="dsh-btn dsh-btn--danger dsh-btn--sm" type="button" data-ha-confirm><i data-icon="trash"></i> Delete</button>
    </div>`);
}

/* ================================================================== */
/* the doors                                                          */
/* ================================================================== */

/**
 * Mount the management of one page into `host`.
 *
 * The host is emptied and filled; the caller keeps the hub row in its own
 * list and hears about a save (`changed`) or a delete (`deleted`).
 */
export function mountHubAdmin(host, { token = "", hub, section, changed = () => {}, deleted = () => {} } = {}) {
  state.token = token;
  state.hub = hub;
  state.section = section;
  state.pane = "page";
  state.categories = [];
  state.subscribers = [];
  state.participants = null;
  state.ads = [];
  onChange = changed;
  onDeleted = deleted;

  host.innerHTML = `
    <div class="ha" data-ha>
      <div class="ha__head" data-ha-head></div>
      <div class="ha__pane" data-ha-view></div>
      <div data-ha-modal></div>
    </div>`;
  paintHead();
  renderPane();
  if (!host.dataset.haWired) {
    host.dataset.haWired = "1";
    wire(host);
  }
  return state.hub;
}

/** Everything a pane leaves behind, so the next page starts clean. */
export function unmountHubAdmin() {
  state.hub = null;
  state.section = null;
  state.categories = [];
  state.subscribers = [];
  state.participants = null;
  state.ads = [];
  onChange = () => {};
  onDeleted = () => {};
}

/* ================================================================== */
/* the wiring — one listener on the host, no inline handlers          */
/* ================================================================== */
function wire(host) {
  host.addEventListener("click", (event) => {
    const target = event.target;

    const pane = target.closest("[data-ha-pane]");
    if (pane) {
      event.preventDefault();
      return showPane(pane.dataset.haPane);
    }

    if (target.closest("[data-ha-cancel]")) {
      event.preventDefault();
      return closeModal();
    }

    if (target.closest("[data-ha-confirm]")) {
      event.preventDefault();
      const pending = state.confirm || {};
      state.confirm = null;
      if (pending.action === "hub") return deleteHub();
      return closeModal();
    }

    const excl = target.closest("[data-cr-excl-remove]");
    if (excl) {
      event.preventDefault();
      const chip = excl.closest(".cr-chip-x");
      const box = excl.closest("[data-excluded-chips]");
      if (chip) chip.remove();
      if (box && !box.querySelector(".cr-chip-x")) {
        box.innerHTML = '<span class="cr-card__hint">Nobody is excluded.</span>';
      }
      return;
    }

    if (target.closest("[data-cr-save-hub]")) {
      event.preventDefault();
      return saveHub();
    }

    if (target.closest("[data-cr-delete-hub]")) {
      event.preventDefault();
      const hub = currentHub();
      return openConfirm(
        `Delete ${hub?.name || "this page"}?`,
        "Everything under it goes too — items, categories and subscribers. This cannot be undone.",
        "hub",
        hub?.id
      );
    }

    if (target.closest("[data-cr-link-add]")) {
      event.preventDefault();
      const links = el("[data-links]");
      if (!links) return;
      const row = document.createElement("div");
      row.className = "cr-link-row";
      row.setAttribute("data-link-row", "");
      row.innerHTML = `
        <input class="dsh-input" type="text" maxlength="40" placeholder="Label" data-link-label />
        <input class="dsh-input" type="url" placeholder="https://…" data-link-url />
        <button class="dsh-btn dsh-btn--sm" type="button" data-cr-link-remove aria-label="Remove link"><i data-icon="trash"></i></button>`;
      links.appendChild(row);
      hydrateIcons(row);
      return;
    }

    const linkRemove = target.closest("[data-cr-link-remove]");
    if (linkRemove) {
      event.preventDefault();
      linkRemove.closest("[data-link-row]")?.remove();
      return;
    }

    const chip = target.closest("[data-cr-chip-remove]");
    if (chip) {
      event.preventDefault();
      return removeChip(chip.dataset.crChipRemove, chip.dataset.code);
    }

    if (target.closest("[data-cr-cat-add]")) {
      event.preventDefault();
      return addCategory();
    }

    const catDel = target.closest("[data-cr-cat-del]");
    if (catDel) {
      event.preventDefault();
      return deleteCategory(catDel.dataset.crCatDel);
    }

    const req = target.closest("[data-cr-req]");
    if (req) {
      event.preventDefault();
      return decideRequest(req.dataset.id, req.dataset.crReq);
    }

    const adDel = target.closest("[data-cr-ad-del]");
    if (adDel) {
      event.preventDefault();
      return removeAd(adDel.dataset.crAdDel);
    }

    if (target.closest("[data-ha-back]")) {
      event.preventDefault();
      onChange(null);
    }
  });

  host.addEventListener("change", (event) => {
    const select = event.target;
    if (!select.matches("[data-hub-visibility]")) return;
    const priv = select.value === "private";
    const pass = el("[data-hub-pass-wrap]");
    const hours = el("[data-hub-hours-wrap]");
    if (pass) {
      pass.hidden = !priv;
      pass.style.display = priv ? "" : "none";
    }
    if (hours) {
      hours.hidden = !priv;
      hours.style.display = priv ? "" : "none";
    }
    const aud = el('[data-aud="hub"]');
    if (aud) {
      const open = select.value === "exclusive";
      aud.hidden = !open;
      aud.style.display = open ? "" : "none";
    }
  });
}
