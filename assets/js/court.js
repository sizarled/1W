/**
 * court.html — one case, for a member who is a party in it.
 * ------------------------------------------------------------------
 * The case id comes from `?id=`; `member_court_history(token)` only ever
 * returns cases that belong to the signed-in member, so a guessed id from
 * somebody else simply shows "case not found".
 */

import { rpc } from "./data.js";
import { qs, esc, formatDate } from "./utils.js";
import { hydrateIcons } from "./icons.js";
import { sessionToken, clearSessionToken, signOut, setMember } from "./session.js";

const token = sessionToken();
const id = new URLSearchParams(location.search).get("id") || "";

async function boot() {
  const room = qs("[data-court-room]");
  if (!room) return;

  wireLogout();

  if (!token) {
    room.innerHTML = `<section class="dsh-gate">
      <span class="dsh-gate__icon"><i data-icon="gavel"></i></span>
      <h1 class="dsh-gate__title">Sign in to open the court room</h1>
      <p class="dsh-gate__text">The case file is private: only the parties can read it.</p>
      <div class="dsh-gate__actions">
        <a class="dsh-btn dsh-btn--primary" href="login.html?next=court.html"><i data-icon="login"></i>Sign in</a>
      </div>
    </section>`;
    hydrateIcons(room);
    return;
  }

  const data = await rpc("member_court_history", { p_token: token }).catch(() => null);
  if (!data || data.ok !== true) {
    clearSessionToken();
    signOut();
    location.replace("login.html?next=court.html");
    return;
  }

  const cases = data.cases || [];
  const found = id ? cases.find((c) => String(c.id) === String(id)) : cases[0];

  if (!found) {
    room.innerHTML = `<section class="dsh-gate">
      <span class="dsh-gate__icon"><i data-icon="scale"></i></span>
      <h1 class="dsh-gate__title">Case not found</h1>
      <p class="dsh-gate__text">This case is not yours, or it no longer exists. Open your court section to see every case where you are a party.</p>
      <div class="dsh-gate__actions">
        <a class="dsh-btn dsh-btn--primary" href="dashboard.html#court"><i data-icon="arrowLeft"></i>Back to court</a>
      </div>
    </section>`;
    hydrateIcons(room);
    return;
  }

  paint(found, data, room);
}

function paint(item, data, room) {
  const code = qs("[data-court-code]");
  if (code) code.textContent = item.case_code;

  const member = (data.ban && data.ban.by) || "";
  const scheduled = item.scheduled_at ? new Date(item.scheduled_at) : null;
  const state = String(item.status || "");
  const decided = Boolean(item.decision);

  room.innerHTML = `
    <section class="dsh-card">
      <div class="dsh-card__head">
        <h1 class="dsh-card__title" style="font-size:1.15rem">Case ${esc(item.case_code)}</h1>
        <span class="dsh-chip" data-tone="${state === "scheduled" ? "on" : "off"}">${esc(cap(state))}</span>
      </div>

      <div class="dsh-court">
        ${
          scheduled
            ? `<div class="dsh-court__clock">
                <strong>${esc(scheduled.toLocaleDateString("en-US", { weekday: "long", day: "2-digit", month: "long", year: "numeric" }))}</strong>
                <span>${esc(scheduled.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }))} · hearing opens ${
                  Math.max(0, Math.round((scheduled.getTime() - Date.now()) / 86400000))
                } day(s) from now</span>
              </div>`
            : `<div class="dsh-court__clock"><strong>No date yet</strong><span>The court will set a time and notify you.</span></div>`
        }

        <div class="dsh-court__stage">
          <div class="dsh-court__party"><span>Judge</span><strong>Platform moderator</strong></div>
          <div class="dsh-court__party"><span>Defendant</span><strong>You${member ? ` · banned by @${esc(String(member).replace(/^@/, ""))}` : ""}</strong></div>
          <div class="dsh-court__party"><span>Plaintiff</span><strong>Content owner / reporter</strong></div>
        </div>

        <dl class="dsh-kv">
          <div><dt>Reason</dt><dd>${esc(item.reason || "—")}</dd></div>
          <div><dt>Opened</dt><dd>${esc(formatDate(item.created_at))}</dd></div>
          <div><dt>Status</dt><dd>${esc(cap(state))}</dd></div>
          <div><dt>Decision</dt><dd>${esc(item.decision ? cap(item.decision) : "Pending")}</dd></div>
          ${item.decided_at ? `<div><dt>Decided</dt><dd>${esc(formatDate(item.decided_at))}</dd></div>` : ""}
          ${item.decision_note ? `<div><dt>Court note</dt><dd>${esc(item.decision_note)}</dd></div>` : ""}
        </dl>

        ${
          state === "scheduled"
            ? `<p class="dsh-gate__warn"><i data-icon="info"></i><span>
                Attendance is required. If you do not attend the hearing, the ban becomes permanent and the
                account is closed.
              </span></p>`
            : ""
        }

        ${
          decided
            ? `<div class="dsh-note"><i data-icon="scale"></i><span>
                <strong>${item.decision === "unban" ? "Ban lifted by court decision." : "Ban upheld by court decision."}</strong>
                ${item.decision_note ? esc(item.decision_note) : ""}
              </span></div>`
            : `<div class="dsh-note"><i data-icon="info"></i><span>
                The hearing room itself opens a few minutes before the scheduled time. Until then this page
                shows the case file, the parties and the warning.
              </span></div>`
        }

        <div class="dsh-hero__actions">
          <a class="dsh-btn" href="dashboard.html#court"><i data-icon="arrowLeft"></i>All cases</a>
          <a class="dsh-btn" href="notifications.html"><i data-icon="bell"></i>Notifications</a>
        </div>
      </div>
    </section>
  `;
  hydrateIcons(room);
}

function cap(value) {
  const text = String(value || "");
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : "—";
}

function wireLogout() {
  document.querySelectorAll("[data-logout]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const done = () => {
        clearSessionToken();
        signOut();
        location.replace("login.html");
      };
      if (token) rpc("member_logout", { p_token: token }).then(done).catch(done);
      else done();
    });
  });
}

boot();
