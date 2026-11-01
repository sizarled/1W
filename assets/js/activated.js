/**
 * activated.html — first activation (four steps), re-activation, upgrade.
 * ------------------------------------------------------------------
 * Server side decides which doors exist: `member_activation_state(token)`
 * returns `mode` = activate | choose | blocked, the plans that may be
 * upgraded to, the points price list, the durations and the ad URL.
 *
 *   activate — never activated, inactive, free plan:
 *       1 profile       → activation_profile_save()   (+ storage upload)
 *       2 viewing code  → activation_viewing_code_save()
 *       3 activation code → activation_ad_open/claim() (~30 s ad, server-timed)
 *       4 activate      → activation_redeem('initial')
 *
 *   choose — activated before:
 *       re-activate → activation_redeem('reactivation')  (free: ad gate,
 *                     premium: patreon code or activation_pay_points())
 *       upgrade     → activation_redeem('upgrade')        (strictly higher tier)
 *
 * Every code is issued by the database and consumed in one transaction with
 * the points payment; the page never marks anything active by itself.
 */

import { rpc } from "./data.js";
import { deviceId, deviceName } from "./device.js";
import { qs, qsa, esc, formatDate, sleep, clamp } from "./utils.js";
import { hydrateIcons } from "./icons.js";
import { toast } from "./ui.js";
import { sessionToken, clearSessionToken, signOut, setMember } from "./session.js";
import { SUPABASE, storageUrl } from "./config.js";
import { cachedVisitor, lookupVisitor } from "./geo.js";

const token = sessionToken();
const params = new URLSearchParams(location.search);
const wanted = params.get("member") || "";
const wantedMode = params.get("mode") || "";

const PLAN_LABEL = { free: "Free", silver: "Silver", gold: "Gold", diamond: "Diamond" };
const STATUS_LABEL = { active: "Active", inactive: "Inactive", expired: "Expired", banned: "Banned" };
const AD_FALLBACK_URL = "https://asiafilm.org/4/e476b83b0c777b7828ac79fef485bd1a";
const PATREON_URL = "https://www.patreon.com/1world";

const COPY = {
  activate: {
    eyebrow: "First activation · free plan",
    title: "Activate your account",
    lead:
      "Activation happens once, on the free plan. Four short steps: create your profile, create a viewing code, collect your activation code, then switch the account on.",
  },
  choose: {
    eyebrow: "Activation · account already activated",
    title: "Manage your membership",
    lead:
      "This account was activated before, so first activation is no longer available. Two doors stay open: <b>re-activate</b> the plan you have, or <b>upgrade</b> to a higher tier.",
  },
  blocked: {
    eyebrow: "Account banned",
    title: "This account is banned",
    lead:
      "A banned account cannot be activated, re-activated or upgraded. The only way back is a trial: open the dashboard, read the reason and send a trial request to the court.",
  },
  guest: {
    eyebrow: "Account activation",
    title: "Sign in to activate your account",
    lead:
      "Activation belongs to the member, not to a link — sign in first and this page will run the steps for your own account.",
  },
};

const app = {
  data: null,
  step: 1,
  files: { avatar: null, cover: null },
  uploaded: { avatar: null, cover: null },
  profile: null,
  viewing: null,
  code: null,
  ad: null,
  busy: false,
};

/* ================================================================== */
/* boot                                                               */
/* ================================================================== */
async function boot() {
  const root = qs("[data-act]");
  if (!root) return;

  wireLogout();
  wireAdModal();
  wireWizard(root);
  wirePanels(root);

  if (!token) {
    paintGuest(root);
    return;
  }

  const data = await rpc("member_activation_state", { p_token: token }).catch(() => null);
  if (!data || data.ok !== true) {
    clearSessionToken();
    signOut();
    location.replace("login.html?next=activated.html");
    return;
  }

  app.data = data;
  if (data.member) setMember(data.member);
  paint(root);
}

/* ================================================================== */
/* paint                                                              */
/* ================================================================== */
function paint(root) {
  const data = app.data;
  const member = data.member || {};
  const mode = data.mode || "activate";
  const copy = COPY[mode] || COPY.activate;

  root.dataset.state = data.status || "inactive";
  root.dataset.mode = mode;

  qs("[data-act-eyebrow]", root).textContent = copy.eyebrow;
  qs("[data-act-title]", root).textContent = copy.title;
  qs("[data-act-lead]", root).innerHTML = copy.lead;

  set(root, "[data-act-member]", member.member_id || "—");
  set(root, "[data-act-username]", member.username || "—");
  set(root, "[data-act-membership]", planLabel(data.membership));
  set(root, "[data-act-activated]", data.activated_at ? formatDate(data.activated_at) : "Never");

  const status = qs("[data-act-status]", root);
  if (status) {
    status.textContent = STATUS_LABEL[data.status] || cap(data.status || "");
    status.dataset.state = data.status || "";
  }

  const deadline = qs("[data-act-deadline]", root);
  if (deadline) {
    if (data.deadline && (data.status === "inactive" || data.status === "expired")) {
      deadline.hidden = false;
      deadline.textContent = `Accounts that stay unactivated — or unrenewed — until ${formatDate(
        data.deadline
      )} are removed automatically under the 30-day policy.`;
    } else {
      deadline.hidden = true;
    }
  }

  qs("[data-wizard]", root).hidden = mode !== "activate";
  qs("[data-act-choice]", root).hidden = mode !== "choose";
  qs("[data-paid-note]", root).hidden = !(mode === "choose" && !data.activated_at);

  if (mode === "activate") {
    if (data.profile) prefillProfile(root, data.profile);
    setStep(root, 1);
  } else if (mode === "choose") {
    paintDoors(root, data, member);
    if (wantedMode === "reactivate" && data.can_reactivate) openReact(root);
    if (wantedMode === "upgrade" && data.can_upgrade) openUpgrade(root);
  } else {
    note(
      root,
      "A banned account cannot be activated, re-activated or upgraded. Open the dashboard, read the reason and send a trial request to the court.",
      true
    );
    if (!qs(".dsh-gate__actions--banned", root)) {
      const back = document.createElement("div");
      back.className = "dsh-gate__actions dsh-gate__actions--banned";
      back.innerHTML = `<a class="dsh-btn dsh-btn--primary" href="dashboard.html"><i data-icon="scale"></i>Open the dashboard</a>
        <a class="dsh-btn" href="dashboard.html#court"><i data-icon="gavel"></i>Go to court</a>`;
      root.append(back);
    }
  }

  if (wanted && member.member_id && wanted !== member.member_id) {
    note(root, "This page works on your own account only. The link pointed at another member ID, so it was ignored.", true);
  }

  hydrateIcons(root);
}

function paintGuest(root) {
  const copy = COPY.guest;
  root.dataset.state = "guest";
  root.dataset.mode = "guest";
  qs("[data-act-eyebrow]", root).textContent = copy.eyebrow;
  qs("[data-act-title]", root).textContent = copy.title;
  qs("[data-act-lead]", root).innerHTML = copy.lead;
  qsa("[data-wizard], [data-act-choice], [data-done], [data-react], [data-upgrade], [data-paid-note]", root).forEach((el) => {
    el.hidden = true;
  });
  const slot = qs("[data-act-guest]", root);
  const link = document.createElement("a");
  link.className = "dsh-btn dsh-btn--primary";
  link.href = "login.html?next=activated.html";
  link.innerHTML = `<i data-icon="login"></i>Sign in to activate`;
  if (slot) {
    slot.hidden = false;
    slot.append(link);
  } else {
    qs("[data-act-notice]", root)?.before(link);
  }
  hydrateIcons(root);
}

/* ================================================================== */
/* 1–4 · the wizard                                                   */
/* ================================================================== */
function wireWizard(root) {
  /* step 1 — profile ------------------------------------------------ */
  const desc = qs("[data-pf-desc]", root);
  const counter = qs("[data-pf-desc-count]", root);
  desc?.addEventListener("input", () => {
    if (counter) counter.textContent = String(desc.value.length);
  });

  qsa("[data-file]", root).forEach((input) => {
    input.addEventListener("change", () => {
      const kind = input.dataset.file;
      const file = input.files && input.files[0];
      if (!file) return;
      if (!/^image\//.test(file.type)) {
        toast({ title: "Not an image", message: "Choose a PNG, JPG, WEBP or GIF file." });
        input.value = "";
        return;
      }
      app.files[kind] = file;
      const preview = qs(`[data-preview="${kind}"]`, root);
      const box = qs(`[data-preview-box="${kind}"]`, root);
      const clear = qs(`[data-clear="${kind}"]`, root);
      if (preview) {
        try {
          preview.src = URL.createObjectURL(file);
        } catch (error) {
          /* previews are a nicety — a browser without createObjectURL still uploads */
        }
      }
      if (box) box.hidden = false;
      if (clear) clear.hidden = false;
      const crop = qs(`[data-crop="${kind}"]`, root);
      if (crop) crop.hidden = false;
    });
  });

  /* a direct image link, and cropping the chosen image */
  qsa("[data-url-apply]", root).forEach((btn) => {
    btn.addEventListener("click", () => applyImageUrl(root, btn.dataset.urlApply));
  });

  qsa("[data-url-input]", root).forEach((input) => {
    input.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      applyImageUrl(root, input.dataset.urlInput);
    });
  });

  qsa("[data-crop]", root).forEach((btn) => {
    btn.addEventListener("click", () => openCrop(root, btn.dataset.crop));
  });

  qsa("[data-clear]", root).forEach((btn) => {
    btn.addEventListener("click", () => {
      const kind = btn.dataset.clear;
      app.files[kind] = null;
      app.uploaded[kind] = null;
      const input = qs(`[data-file="${kind}"]`, root);
      if (input) input.value = "";
      const box = qs(`[data-preview-box="${kind}"]`, root);
      const preview = qs(`[data-preview="${kind}"]`, root);
      if (box) box.hidden = true;
      if (preview) preview.removeAttribute("src");
      btn.hidden = true;
      const crop = qs(`[data-crop="${kind}"]`, root);
      if (crop) crop.hidden = true;
      const url = qs(`[data-url-input="${kind}"]`, root);
      if (url) url.value = "";
    });
  });

  qs("[data-step='1']", root)?.addEventListener("submit", async (event) => {
    event.preventDefault();
    await saveProfile(root);
  });

  /* step 2 — viewing code ------------------------------------------- */
  const vcode = qs("[data-vc-code]", root);
  vcode?.addEventListener("input", () => {
    vcode.value = vcode.value.replace(/\D+/g, "").slice(0, 6);
  });

  qs("[data-vc-generate]", root)?.addEventListener("click", () => {
    if (vcode) vcode.value = String(Math.floor(100000 + Math.random() * 900000));
  });

  detectDevice(root);

  qs("[data-step='2']", root)?.addEventListener("submit", async (event) => {
    event.preventDefault();
    await saveViewingCode(root);
  });

  /* step 3 — activation code ---------------------------------------- */
  const acode = qs("[data-ac-code]", root);
  acode?.addEventListener("input", () => {
    acode.value = acode.value.toUpperCase().slice(0, 14);
    const next = qs("[data-ac-next]", root);
    if (next) next.disabled = acode.value.trim().length < 8;
  });

  qs("[data-ac-get]", root)?.addEventListener("click", () =>
    startAd(root, { type: "initial", target: "free", duration: 1, input: "[data-ac-code]" })
  );

  qs("[data-ac-next]", root)?.addEventListener("click", () => {
    app.code = qs("[data-ac-code]", root).value.trim().toUpperCase();
    if (!app.code) return;
    paintSummary(root);
    setStep(root, 4);
  });

  qsa("[data-step-back]", root).forEach((btn) => {
    btn.addEventListener("click", () => setStep(root, Math.max(1, Number(btn.dataset.stepBack) - 1)));
  });

  qs("[data-activate]", root)?.addEventListener("click", activateAccount);
}

function setStep(root, step) {
  app.step = clamp(step, 1, 4);
  qsa("[data-step]", root).forEach((panel) => {
    panel.hidden = Number(panel.dataset.step) !== app.step;
  });
  qsa("[data-step-dot]", root).forEach((dot) => {
    const n = Number(dot.dataset.stepDot);
    dot.dataset.state = n < app.step ? "done" : n === app.step ? "current" : "todo";
  });

  const bar = qs("[data-progress]", root);
  const wrap = qs("[data-progressbar]", root);
  if (bar) bar.style.width = `${app.step * 25}%`;
  if (wrap) wrap.setAttribute("aria-valuenow", String(app.step * 25));

  const hint = qs("[data-step-hint]", root);
  if (hint) hint.textContent = `Step ${app.step} of 4 — ${STEP_HINT[app.step]}`;
  hydrateIcons(root);
}

const STEP_HINT = {
  1: "your profile is the face of the account.",
  2: "the viewing code is what the player uses to sign in.",
  3: "open the short ad and the code is filled in for you.",
  4: "one click and the account is on.",
};

function prefillProfile(root, profile) {
  const name = qs("[data-pf-name]", root);
  const desc = qs("[data-pf-desc]", root);
  const lang = qs("[data-pf-lang]", root);
  const country = qs("[data-pf-country]", root);
  if (name && !name.value) name.value = profile.name || "";
  if (desc && !desc.value) desc.value = profile.description || "";
  if (lang && profile.language) lang.value = profile.language;
  if (country && !country.value) country.value = profile.country || "";

  const count = qs("[data-pf-desc-count]", root);
  if (count) count.textContent = String((desc && desc.value.length) || 0);

  if (profile.avatar && !app.files.avatar) showExisting(root, "avatar", profile.avatar);
  if (profile.cover && !app.files.cover) showExisting(root, "cover", profile.cover);
  autoCountry(root);
}

function showExisting(root, kind, url) {
  const preview = qs(`[data-preview="${kind}"]`, root);
  const box = qs(`[data-preview-box="${kind}"]`, root);
  if (!preview || !box) return;
  preview.src = url;
  box.hidden = false;
  app.uploaded[kind] = url;
}

/* ------------------------------------------------------------------ */
/* avatar + cover: link, upload, crop                                 */
/* ------------------------------------------------------------------ */
/* An avatar is square, a cover is three wide for one high. Both are
 * cropped on a canvas before they are uploaded, so what the member sees
 * in the preview is exactly what the profile shows. */
const CROP_SHAPE = {
  avatar: { ratio: 1, width: 512, height: 512, label: "the avatar" },
  cover: { ratio: 3, width: 1200, height: 400, label: "the cover" },
};

const crop = { kind: "", img: null, zoom: 1, x: 0, y: 0, src: "" };

function paintMedia(root, kind, src) {
  const preview = qs(`[data-preview="${kind}"]`, root);
  const box = qs(`[data-preview-box="${kind}"]`, root);
  if (preview) preview.src = src;
  if (box) box.hidden = false;
  const clear = qs(`[data-clear="${kind}"]`, root);
  if (clear) clear.hidden = false;
  const cropBtn = qs(`[data-crop="${kind}"]`, root);
  if (cropBtn) cropBtn.hidden = false;
}

/** A direct image link: usable as it is, and croppable when the host allows it. */
function applyImageUrl(root, kind) {
  const input = qs(`[data-url-input="${kind}"]`, root);
  const value = String((input && input.value) || "").trim();
  if (!/^https?:\/\/[^\s]+$/i.test(value)) {
    toast({ title: "That is not an image link", message: "A link starts with http:// or https://." });
    return;
  }
  app.files[kind] = null;
  app.uploaded[kind] = value;
  paintMedia(root, kind, value);
  toast({ title: "Image link set", message: "It is used as it is — crop it if the host allows it." });
}

/** Open the cropper over the current file or link. */
function openCrop(root, kind) {
  const file = app.files[kind];
  const remote = app.uploaded[kind];
  const src = file ? URL.createObjectURL(file) : remote;
  if (!src) {
    toast({ title: "Nothing to crop", message: "Choose an image or paste a link first." });
    return;
  }

  const shape = CROP_SHAPE[kind] || CROP_SHAPE.avatar;
  const img = new Image();
  if (!file) img.crossOrigin = "anonymous";

  img.onload = () => {
    crop.kind = kind;
    crop.img = img;
    crop.zoom = 1;
    crop.x = 0;
    crop.y = 0;
    crop.src = src;
    paintCropper(root, shape);
  };
  img.onerror = () => {
    toast({ title: "Image not loaded", message: "The link did not answer with an image." });
  };
  img.src = src;
}

function paintCropper(root, shape) {
  qs("[data-crop-modal]")?.remove();
  const wrap = document.createElement("div");
  wrap.className = "dsh-crop";
  wrap.setAttribute("data-crop-modal", "");
  wrap.innerHTML = `
    <div class="dsh-crop__card" role="dialog" aria-modal="true" aria-label="Crop the image">
      <div class="dsh-crop__head">
        <h2 class="dsh-crop__title">Crop ${shape.label}</h2>
        <button class="dsh-icon-btn" type="button" data-crop-cancel aria-label="Close"><i data-icon="close"></i></button>
      </div>
      <div class="dsh-crop__stage" data-crop-stage style="--crop-ratio:${shape.ratio}">
        <img class="dsh-crop__img" data-crop-image alt="" draggable="false" />
      </div>
      <label class="dsh-crop__zoom">
        <span>Zoom</span>
        <input type="range" min="1" max="3" step="0.01" value="1" data-crop-zoom />
      </label>
      <p class="dsh-crop__hint">Drag the image to choose the part that stays. ${shape.width} × ${shape.height} on save.</p>
      <div class="dsh-crop__actions">
        <button class="dsh-btn dsh-btn--ghost" type="button" data-crop-cancel>Cancel</button>
        <button class="dsh-btn dsh-btn--primary" type="button" data-crop-apply><i data-icon="check"></i>Use this crop</button>
      </div>
    </div>`;
  document.body.append(wrap);
  hydrateIcons(wrap);

  const stage = qs("[data-crop-stage]", wrap);
  const image = qs("[data-crop-image]", wrap);
  const zoom = qs("[data-crop-zoom]", wrap);
  image.src = crop.src;
  layoutCrop(stage, image);

  qs("[data-crop-zoom]", wrap)?.addEventListener("input", (event) => {
    crop.zoom = Number(event.target.value) || 1;
    layoutCrop(stage, image);
  });

  let drag = null;
  const start = (event) => {
    const point = event.touches ? event.touches[0] : event;
    drag = { x: point.clientX, y: point.clientY, ox: crop.x, oy: crop.y };
  };
  const move = (event) => {
    if (!drag) return;
    const point = event.touches ? event.touches[0] : event;
    crop.x = drag.ox + (point.clientX - drag.x);
    crop.y = drag.oy + (point.clientY - drag.y);
    layoutCrop(stage, image);
    event.preventDefault();
  };
  const end = () => {
    drag = null;
  };
  stage.addEventListener("mousedown", start);
  stage.addEventListener("touchstart", start, { passive: true });
  window.addEventListener("mousemove", move);
  window.addEventListener("touchmove", move, { passive: false });
  window.addEventListener("mouseup", end);
  window.addEventListener("touchend", end);

  qsa("[data-crop-cancel]", wrap).forEach((btn) => btn.addEventListener("click", () => wrap.remove()));
  qs("[data-crop-apply]", wrap)?.addEventListener("click", () => applyCrop(root, wrap, stage, image, shape));
}

/** The image always covers the stage; `crop.x/y` is the drag offset in px. */
function layoutCrop(stage, image) {
  if (!stage || !image) return;
  const sw = stage.clientWidth || 320;
  const sh = stage.clientHeight || Math.round(sw / 1);
  const nw = image.naturalWidth || sw;
  const nh = image.naturalHeight || sh;
  const base = Math.max(sw / nw, sh / nh);
  const scale = base * crop.zoom;
  const dw = nw * scale;
  const dh = nh * scale;
  const maxX = 0;
  const minX = Math.min(0, sw - dw);
  const minY = Math.min(0, sh - dh);
  const maxY = 0;
  crop.x = clamp(crop.x, minX, maxX);
  crop.y = clamp(crop.y, minY, maxY);
  image.style.width = `${dw}px`;
  image.style.height = `${dh}px`;
  image.style.left = `${(sw - dw) / 2 + crop.x}px`;
  image.style.top = `${(sh - dh) / 2 + crop.y}px`;
  crop.metrics = { sw, sh, nw, nh, scale };
}

function applyCrop(root, wrap, stage, image, shape) {
  const m = crop.metrics || {};
  const left = parseFloat(image.style.left || "0") || 0;
  const top = parseFloat(image.style.top || "0") || 0;
  const scale = m.scale || 1;
  const sx = Math.max(0, -left / scale);
  const sy = Math.max(0, -top / scale);
  const sw = Math.min(m.nw || 1, (m.sw || 1) / scale);
  const sh = Math.min(m.nh || 1, (m.sh || 1) / scale);

  const canvas = document.createElement("canvas");
  canvas.width = shape.width;
  canvas.height = shape.height;
  const ctx = canvas.getContext ? canvas.getContext("2d") : null;
  if (!ctx) {
    wrap.remove();
    toast({ title: "Cropping unavailable", message: "This browser cannot crop — the image is used whole." });
    return;
  }

  try {
    ctx.drawImage(crop.img, sx, sy, sw, sh, 0, 0, shape.width, shape.height);
    canvas.toBlob((blob) => {
      if (!blob) {
        wrap.remove();
        toast({ title: "Crop failed", message: "The image is used whole." });
        return;
      }
      const ext = blob.type.includes("png") ? "png" : "jpg";
      const file = new File([blob], `${crop.kind}_crop.${ext}`, { type: blob.type || "image/jpeg" });
      app.files[crop.kind] = file;
      app.uploaded[crop.kind] = null;
      paintMedia(root, crop.kind, URL.createObjectURL(file));
      wrap.remove();
      toast({ title: "Cropped", message: "The preview is exactly what gets saved." });
    }, "image/jpeg", 0.92);
  } catch (error) {
    /* the host of a remote image may refuse CORS — keep the link as it is */
    wrap.remove();
    toast({
      title: "This image cannot be cropped",
      message: "Its host does not allow it. The link is saved as it is.",
    });
  }
}

async function autoCountry(root) {
  const input = qs("[data-pf-country]", root);
  if (!input || input.value) return;
  const cached = (() => {
    try {
      return cachedVisitor();
    } catch (error) {
      return null;
    }
  })();
  const apply = (visitor) => {
    if (visitor && visitor.country && !input.value) input.value = visitor.country;
  };
  apply(cached);
  if (input.value) return;
  try {
    const visitor = typeof lookupVisitor === "function" ? await lookupVisitor().catch(() => null) : null;
    apply(visitor);
  } catch (error) {
    /* geo lookup is a nicety, never a blocker */
  }
}

async function saveProfile(root) {
  const name = String(qs("[data-pf-name]", root).value || "").trim();
  const desc = String(qs("[data-pf-desc]", root).value || "").trim();
  const lang = String(qs("[data-pf-lang]", root).value || "en");
  const country = String(qs("[data-pf-country]", root).value || "").trim() || null;

  if (name.length < 2) {
    toast({ title: "Profile name too short", message: "Use at least two characters." });
    return;
  }

  const btn = qs("[data-step-next='1']", root);
  if (app.busy) return;
  app.busy = true;
  if (btn) btn.disabled = true;

  try {
    const memberId = (app.data.member && app.data.member.member_id) || "";
    let avatar = app.uploaded.avatar;
    let cover = app.uploaded.cover;

    let uploadError = "";
    for (const kind of ["avatar", "cover"]) {
      if (!app.files[kind]) continue;
      try {
        const url = await uploadImage(app.files[kind], kind, memberId);
        if (kind === "avatar") avatar = url;
        else cover = url;
        app.uploaded[kind] = url;
      } catch (error) {
        uploadError = String(error.message || error);
      }
    }

    const result = await rpc("activation_profile_save", {
      p_token: token,
      p_name: name,
      p_description: desc || null,
      p_avatar: avatar || null,
      p_cover: cover || null,
      p_language: lang,
      p_country: country,
    });

    if (!result || result.ok !== true) {
      toast({ title: "Profile not saved", message: errorText(result && result.error) });
      return;
    }

    app.profile = result.profile || { name };
    setNameTags(root, memberId);
    setStep(root, 2);
    if (uploadError) {
      note(
        root,
        `The profile was saved without the image (storage said: ${uploadError}). You can add it later from profile.html.`,
        true
      );
      toast({ title: "Image not uploaded", message: uploadError.slice(0, 140) });
    } else {
      toast({ title: "Profile saved", message: "Step 2 — create the viewing code." });
    }
  } catch (error) {
    toast({ title: "Upload failed", message: String(error.message || error).slice(0, 140) });
  } finally {
    app.busy = false;
    if (btn) btn.disabled = false;
  }
}

/**
 * Uploads to `source/users/profile/<kind>_<IDMEMBER>.<ext>` and returns the
 * public URL. A publishable key goes in `apikey` only — sending it again as a
 * Bearer token makes the storage API parse a non-JWT and answer
 * `403 new row violates row-level security policy`. The Bearer form is kept as
 * a fallback for deployments that still use the legacy anon key.
 */
async function uploadImage(file, kind, memberId) {
  const rawExt = String(file.name || "").split(".").pop() || "";
  const ext = (rawExt.toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg").slice(0, 5);
  const cleanId = String(memberId || "").replace(/[^A-Za-z0-9]/g, "");
  const name = `${kind}_${cleanId}.${ext}`;
  const path = `users/profile/${name}`;
  const url = `${SUPABASE.url}/storage/v1/object/${SUPABASE.storageBucket}/${path}`;
  const base = {
    "Content-Type": file.type || "image/jpeg",
    "x-upsert": "false",
    "cache-control": "3600",
  };

  const attempts = [
    { apikey: SUPABASE.publishableKey, ...base },
    { apikey: SUPABASE.publishableKey, Authorization: `Bearer ${SUPABASE.publishableKey}`, ...base },
  ];

  let last = "";
  for (const headers of attempts) {
    const res = await fetch(url, { method: "POST", headers, body: file }).catch((error) => {
      last = String(error.message || error);
      return null;
    });
    if (!res) continue;
    if (res.ok || res.status === 409) return storageUrl(path); // 409 = already uploaded
    last = `${res.status} ${(await res.text().catch(() => "")).slice(0, 160)}`;
    if (res.status !== 401 && res.status !== 403) break;
  }
  throw new Error(last || "upload failed");
}

function setNameTags(root, memberId) {
  const clean = String(memberId || "").replace(/[^A-Za-z0-9]/g, "");
  qsa("[data-file-name]", root).forEach((el) => {
    el.textContent = `${el.dataset.fileName}_${clean}`;
  });
}

function detectDevice(root) {
  const id = deviceMac();
  const name = deviceName();
  set(root, "[data-device-id]", id);
  set(root, "[data-device-name]", name);
}

/* The device id lives in one module: the wizard binds a code to it, and the
   player, the dashboard and the recovery page read the same value. */
function deviceMac() {
  return deviceId();
}

async function saveViewingCode(root) {
  const code = String(qs("[data-vc-code]", root).value || "").trim();
  const age = String(qs("[data-vc-age]", root).value || "unspecified");
  const months = Number(qs("[data-vc-months]", root).value || 1);

  if (!/^\d{6}$/.test(code)) {
    toast({ title: "Six digits", message: "A viewing code is exactly six digits." });
    return;
  }

  const btn = qs("[data-step-next='2']", root);
  if (app.busy) return;
  app.busy = true;
  if (btn) btn.disabled = true;

  const result = await rpc("activation_viewing_code_save", {
    p_token: token,
    p_code: code,
    p_months: months,
    p_age: age,
    p_device: deviceMac(),
    p_device_name: deviceName(),
  }).catch(() => null);

  app.busy = false;
  if (btn) btn.disabled = false;

  if (!result || result.ok !== true) {
    toast({ title: "Viewing code not saved", message: errorText(result && result.error) });
    return;
  }

  app.viewing = result.code;
  setStep(root, 3);
  toast({ title: "Viewing code ready", message: `Code ${result.code.code} is bound to this device.` });
}

function paintSummary(root) {
  const profile = app.profile || {};
  set(root, "[data-sum-profile]", profile.name || (qs("[data-pf-name]", root) || {}).value || "—");
  set(root, "[data-sum-viewing]", app.viewing ? app.viewing.code : "—");
  set(root, "[data-sum-device]", deviceMac());
  set(root, "[data-sum-code]", app.code || "—");
}

/* ================================================================== */
/* the ad gate (30 s, timed by the server)                            */
/* ================================================================== */
function wireAdModal() {
  const modal = qs("[data-ad]");
  if (!modal) return;

  /* the countdown only runs while the member is watching the ad: leaving the
   * page, hiding it or closing the ad tab stops it on the spot */
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") pauseAd("hidden");
  });
  window.addEventListener("pagehide", () => stopAd());
  window.addEventListener("beforeunload", () => stopAd());

  qs("[data-ad-close]", modal)?.addEventListener("click", async () => {
    const session = app.ad && app.ad.session;
    stopAd();
    modal.hidden = true;
    if (session) await rpc("activation_ad_cancel", { p_token: token, p_session: session }).catch(() => null);
  });

  qs("[data-ad-link]", modal)?.addEventListener("click", (event) => {
    event.preventDefault();
    if (app.ad && app.ad.opened) return; // the ad is already running
    runAd();
  });
}

async function startAd(root, options) {
  if (app.busy) return;
  const modal = qs("[data-ad]");
  if (!modal) return;

  app.ad = { ...options, session: null, opened: false, seconds: 30, remaining: 30, timer: null, poll: null, code: null };

  const link = qs("[data-ad-link]", modal);
  const url = (app.data && app.data.ad_url) || AD_FALLBACK_URL;
  if (link) link.href = url;
  setModal("[data-ad-time]", "30");
  setModal("[data-ad-status]", "The timer starts when the ad opens.");
  const bar = qs("[data-ad-bar]", modal);
  if (bar) bar.style.width = "0%";

  modal.hidden = false;
  hydrateIcons(modal);
  app.ad.root = root;
}

/** Runs on the click of "Open the ad": opens the tab, then starts the server clock. */
async function runAd() {
  const modal = qs("[data-ad]");
  const ad = app.ad;
  if (!modal || !ad || ad.opened) return;

  const href = (qs("[data-ad-link]", modal) || {}).href || AD_FALLBACK_URL;
  ad.opened = true;
  const win = window.open(href, "_blank");
  if (win) {
    try {
      win.opener = null;
    } catch (error) {}
    ad.win = win;
  } else {
    /* blocked pop-up or blocked ad page (an ad blocker on the ad host does
     * this) — say it plainly and keep the clock at zero */
    ad.opened = false;
    setModal(
      "[data-ad-status]",
      "The ad page was blocked. Allow pop-ups for this site — or pause the ad blocker on this page — then press the link again."
    );
    toast({
      tone: "error",
      iconName: "shield",
      title: "The ad page was blocked",
      message: "Your browser or an ad blocker refused to open it. Allow it here, then try again.",
    });
    return;
  }

  // resuming after the tab was closed: the server clock keeps running
  if (ad.session) {
    setModal("[data-ad-status]", "Countdown resumed — keep the ad open.");
    startAdTimers();
    claimAd();
    return;
  }

  const opened = await rpc("activation_ad_open", {
    p_token: token,
    p_type: ad.type,
    p_target: ad.target,
    p_duration: ad.duration,
  }).catch(() => null);

  if (!opened || opened.ok !== true) {
    ad.opened = false;
    setModal("[data-ad-status]", errorText(opened && opened.error));
    toast({ title: "Ad did not start", message: errorText(opened && opened.error) });
    return;
  }

  ad.session = opened.session;
  ad.seconds = Number(opened.seconds || 30);
  ad.remaining = ad.seconds;
  setModal("[data-ad-status]", "Countdown running — keep the ad open.");
  startAdTimers();
  paintAdClock();
}

function startAdTimers() {
  const ad = app.ad;
  if (!ad) return;
  clearInterval(ad.timer);
  clearInterval(ad.poll);
  ad.timer = setInterval(() => {
    if (document.visibilityState === "hidden") {
      pauseAd("hidden");
      return;
    }
    if (ad.win && ad.win.closed) {
      pauseAd("closed");
      return;
    }
    ad.remaining = Math.max(0, ad.remaining - 1);
    paintAdClock();
  }, 1000);
  ad.poll = setInterval(claimAd, 2500);
  claimAd();
}

function paintAdClock() {
  const modal = qs("[data-ad]");
  const ad = app.ad;
  if (!modal || !ad) return;
  setModal("[data-ad-time]", String(ad.remaining));
  const bar = qs("[data-ad-bar]", modal);
  if (bar) bar.style.width = `${Math.round(((ad.seconds - ad.remaining) / ad.seconds) * 100)}%`;
}

function pauseAd(reason = "closed") {
  const ad = app.ad;
  if (!ad) return;
  if (!ad.timer && !ad.poll) return;
  clearInterval(ad.timer);
  clearInterval(ad.poll);
  ad.timer = null;
  ad.poll = null;
  ad.opened = false;
  setModal(
    "[data-ad-status]",
    reason === "hidden"
      ? "Paused — you left the activation page. Come back and open the ad again to finish the countdown."
      : "Paused — the ad page was closed. Open the ad again to finish the countdown."
  );
}

function stopAd() {
  const ad = app.ad;
  if (!ad) return;
  clearInterval(ad.timer);
  clearInterval(ad.poll);
  ad.timer = null;
  ad.poll = null;
}

async function claimAd() {
  const ad = app.ad;
  if (!ad || !ad.session || ad.code) return;

  const result = await rpc("activation_ad_claim", { p_token: token, p_session: ad.session }).catch(() => null);
  if (!result) return;

  if (result.ok === true && result.code) {
    ad.code = result.code;
    stopAd();
    setModal("[data-ad-status]", `Code ready: ${result.code}`);
    deliverCode(result.code);
    setTimeout(() => {
      const modal = qs("[data-ad]");
      if (modal) modal.hidden = true;
      returnToActivation();
    }, 900);
    return;
  }

  if (result.error === "too_soon") {
    ad.remaining = Math.min(ad.remaining, Number(result.remaining || ad.remaining));
    paintAdClock();
    return;
  }

  stopAd();
  setModal("[data-ad-status]", errorText(result.error || "code"));
}

function deliverCode(code) {
  const ad = app.ad;
  if (!ad) return;
  const input = qs(ad.input || "[data-ac-code]");
  if (input) {
    input.value = code;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }
  const next = qs("[data-ac-next]");
  if (next) next.disabled = false;
  toast({ title: "Activation code ready", message: code });
  hydrateIcons(document);
}

/**
 * The countdown is over: the ad tab is closed and the activation page takes
 * the focus back, with the code field in view.
 */
function returnToActivation() {
  const ad = app.ad;
  if (ad && ad.win) {
    try {
      if (!ad.win.closed) ad.win.close();
    } catch (error) {
      /* a tab the browser keeps open is fine — focus is what matters */
    }
    ad.win = null;
  }
  try {
    window.focus();
  } catch (error) {}
  const input = qs(ad && ad.input ? ad.input : "[data-ac-code]") || qs("[data-ac-code]");
  if (input) {
    input.scrollIntoView?.({ block: "center", behavior: "smooth" });
    try {
      input.focus?.({ preventScroll: true });
    } catch (error) {}
  }
}

function setModal(selector, text) {
  const modal = qs("[data-ad]");
  const el = modal && qs(selector, modal);
  if (el) el.textContent = text;
}

/* ================================================================== */
/* 4 · activate                                                       */
/* ================================================================== */
async function activateAccount() {
  const root = qs("[data-act]");
  if (app.busy) return;
  if (!app.code) {
    toast({ title: "No activation code", message: "Use Get Activation Code first." });
    return;
  }

  app.busy = true;
  const btn = qs("[data-activate]", root);
  if (btn) btn.disabled = true;

  const run = await runProgress(root, "activate", "Activating Your Account…");

  const result = await rpc("activation_redeem", {
    p_token: token,
    p_code: app.code,
    p_type: "initial",
    p_target: "free",
    p_duration: 1,
  }).catch(() => null);

  app.busy = false;
  if (btn) btn.disabled = false;

  if (!result || result.ok !== true) {
    run.fail();
    toast({ title: "Activation failed", message: errorText(result && result.error) });
    return;
  }

  run.done();
  await sleep(320);
  showDone(root, {
    title: "Account Activated Successfully!",
    text: `Your free membership is live until ${formatDate(result.expires_at)}. The viewing code ${esc(
      (app.viewing && app.viewing.code) || ""
    )} is bound to this device.`,
    plan: "Free · 1 month",
    until: result.expires_at,
  });
}

/* ================================================================== */
/* doors · re-activation and upgrade                                  */
/* ================================================================== */
function wirePanels(root) {
  qs("[data-open-react]", root)?.addEventListener("click", () => openReact(root));
  qs("[data-open-upgrade]", root)?.addEventListener("click", () => openUpgrade(root));

  qsa("[data-close-panel]", root).forEach((btn) => {
    btn.addEventListener("click", () => {
      const panel = btn.dataset.closePanel;
      qs(`[data-${panel}]`, root).hidden = true;
      hydrateIcons(root);
    });
  });

  /* re-activation ---------------------------------------------------- */
  const reactMonths = qs("[data-react-months]", root);
  reactMonths?.addEventListener("change", () => paintReactPrice(root));

  qs("[data-react-get]", root)?.addEventListener("click", () => {
    const plan = (app.data && app.data.membership) || "free";
    if (plan === "free") {
      startAd(root, { type: "reactivation", target: "free", duration: 1, input: "[data-react-code]" });
      return;
    }
    toast({
      title: "Premium codes come from a payment",
      message: "Pay with Patreon and paste the code you receive, or pay with points to get one instantly.",
    });
  });

  qs("[data-react-patreon]", root)?.addEventListener("click", () => {
    window.open(PATREON_URL, "_blank", "noopener");
    toast({ title: "Patreon opened", message: "Finish the payment there, then paste the code you receive." });
  });

  qs("[data-react-points]", root)?.addEventListener("click", () => payWithPoints(root, "react"));
  qs("[data-react-go]", root)?.addEventListener("click", () => redeemFromPanel(root, "react"));

  /* upgrade ---------------------------------------------------------- */
  const upTier = qs("[data-up-tier]", root);
  upTier?.addEventListener("change", () => paintUpgradePrice(root));
  qs("[data-up-months]", root)?.addEventListener("change", () => paintUpgradePrice(root));

  qs("[data-up-get]", root)?.addEventListener("click", () => {
    toast({
      title: "Upgrade codes come from a payment",
      message: "Pay with Patreon and paste the code, or pay with points to receive one immediately.",
    });
  });

  qs("[data-up-patreon]", root)?.addEventListener("click", () => {
    window.open(PATREON_URL, "_blank", "noopener");
    toast({ title: "Patreon opened", message: "Finish the payment there, then paste the code you receive." });
  });

  qs("[data-up-points]", root)?.addEventListener("click", () => payWithPoints(root, "upgrade"));
  qs("[data-up-go]", root)?.addEventListener("click", () => redeemFromPanel(root, "upgrade"));
}

function paintDoors(root, data, member) {
  const points = Number((member && member.points) || 0);

  const reactState = qs("[data-react-state]", root);
  if (reactState) {
    reactState.hidden = false;
    reactState.textContent = data.already_active ? "Active now" : STATUS_LABEL[data.status] || "Available";
    reactState.dataset.tone = data.can_reactivate || data.already_active ? "on" : "off";
  }

  const reactBtn = qs("[data-open-react]", root);
  if (reactBtn) {
    reactBtn.disabled = !data.can_reactivate;
    reactBtn.classList.toggle("is-disabled", !data.can_reactivate);
  }

  const reactText = qs("[data-react-text]", root);
  if (reactText && data.membership === "free") {
    reactText.innerHTML =
      "Free membership renews <b>one month at a time</b>: open the short ad, take the code, and the month is added — no payment. Days left on the current month are kept.";
  }

  const upgradeBtn = qs("[data-open-upgrade]", root);
  const upgradeState = qs("[data-upgrade-state]", root);
  const targets = Array.isArray(data.upgrade_targets) ? data.upgrade_targets : [];

  if (upgradeBtn) {
    upgradeBtn.disabled = !data.can_upgrade;
    upgradeBtn.classList.toggle("is-disabled", !data.can_upgrade);
  }
  if (upgradeState) {
    upgradeState.hidden = false;
    upgradeState.textContent = data.can_upgrade ? `To ${targets.map(planLabel).join(" / ")}` : "Top tier";
    upgradeState.dataset.tone = data.can_upgrade ? "on" : "off";
  }

  const upgradeText = qs("[data-upgrade-text]", root);
  if (upgradeText && !targets.length) {
    upgradeText.innerHTML =
      "<b>Diamond</b> is the top tier — there is nothing above it, so upgrading is closed. Re-activation stays open.";
  }

  set(root, "[data-upgrade-current]", planLabel(data.membership));
  set(root, "[data-upgrade-points]", `${points.toLocaleString("en-US")} · ≈ $${(points / 100).toFixed(2)}`);

  /* panels */
  set(root, "[data-react-plan]", planLabel(data.membership));
  set(root, "[data-react-current]", planLabel(data.membership));
  set(root, "[data-react-expiry]", data.membership_expires_at ? formatDate(data.membership_expires_at) : "Not started");
  set(root, "[data-react-points]", `${points.toLocaleString("en-US")} · ≈ $${(points / 100).toFixed(2)}`);
  set(root, "[data-react-rate]", "100 points = $1");

  const months = qs("[data-react-months]", root);
  if (months) {
    const durations = Array.isArray(data.durations) ? data.durations : [3, 6, 9, 12, 18, 24];
    const list = data.membership === "free" ? [1] : durations;
    months.innerHTML = list.map((m) => `<option value="${m}">${m} month${m === 1 ? "" : "s"}</option>`).join("");
    months.value = String(list[0]);
  }

  const monthsHint = qs("[data-react-months-hint]", root);
  if (monthsHint) {
    monthsHint.textContent =
      data.membership === "free"
        ? "Free membership is one month per code."
        : "Premium renewals run 3, 6, 9, 12, 18 or 24 months.";
  }

  const pay = qs("[data-react-pay]", root);
  if (pay) pay.hidden = data.membership === "free";

  const tiers = qs("[data-up-tier]", root);
  if (tiers) {
    tiers.innerHTML = targets.map((t) => `<option value="${t}">${planLabel(t)}</option>`).join("");
  }
  const upMonths = qs("[data-up-months]", root);
  if (upMonths) {
    const durations = Array.isArray(data.durations) ? data.durations : [3, 6, 9, 12, 18, 24];
    upMonths.innerHTML = durations.map((m) => `<option value="${m}">${m} months</option>`).join("");
    upMonths.value = String(durations[0]);
  }

  paintReactPrice(root);
  paintUpgradePrice(root);
}

function openReact(root) {
  qs("[data-act-choice]", root).hidden = true;
  qs("[data-upgrade]", root).hidden = true;
  const panel = qs("[data-react]", root);
  panel.hidden = false;
  panel.scrollIntoView?.({ block: "start", behavior: "smooth" });
  hydrateIcons(root);
}

function openUpgrade(root) {
  qs("[data-act-choice]", root).hidden = true;
  qs("[data-react]", root).hidden = true;
  const panel = qs("[data-upgrade]", root);
  panel.hidden = false;
  panel.scrollIntoView?.({ block: "start", behavior: "smooth" });
  hydrateIcons(root);
}

function priceFor(tier, months) {
  const prices = (app.data && app.data.prices) || {};
  const row = prices[tier] || {};
  const value = Number(row[String(months)] || row[months] || 0);
  return Number.isFinite(value) ? value : 0;
}

function paintReactPrice(root) {
  const months = Number((qs("[data-react-months]", root) || {}).value || 1);
  const tier = (app.data && app.data.membership) || "free";
  const price = priceFor(tier, months);
  set(root, "[data-react-price]", price ? `${price.toLocaleString("en-US")} points · $${(price / 100).toFixed(2)}` : "—");
}

function paintUpgradePrice(root) {
  const tier = String((qs("[data-up-tier]", root) || {}).value || "");
  const months = Number((qs("[data-up-months]", root) || {}).value || 3);
  const price = priceFor(tier, months);
  set(root, "[data-up-price]", price ? `${price.toLocaleString("en-US")} points · $${(price / 100).toFixed(2)}` : "—");
}

async function payWithPoints(root, kind) {
  if (app.busy) return;
  const isUpgrade = kind === "upgrade";
  const target = isUpgrade
    ? String((qs("[data-up-tier]", root) || {}).value || "")
    : (app.data && app.data.membership) || "free";
  const months = Number(
    (qs(isUpgrade ? "[data-up-months]" : "[data-react-months]", root) || {}).value || (isUpgrade ? 3 : 1)
  );
  const price = priceFor(target, months);

  if (!price) {
    toast({ title: "No price", message: "Pick another duration." });
    return;
  }

  app.busy = true;
  const result = await rpc("activation_pay_points", {
    p_token: token,
    p_type: isUpgrade ? "upgrade" : "reactivation",
    p_target: target,
    p_duration: months,
  }).catch(() => null);
  app.busy = false;

  if (!result || result.ok !== true) {
    if (result && result.error === "points") {
      toast({
        title: "Not enough points",
        message: `This costs ${Number(result.needed).toLocaleString("en-US")} points; you have ${Number(
          result.balance
        ).toLocaleString("en-US")}.`,
      });
      return;
    }
    toast({ title: "Payment failed", message: errorText(result && result.error) });
    return;
  }

  const input = qs(isUpgrade ? "[data-up-code]" : "[data-react-code]", root);
  if (input) {
    input.value = result.code;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }
  if (app.data && app.data.member) app.data.member.points = result.balance;
  set(root, isUpgrade ? "[data-upgrade-points]" : "[data-react-points]", `${Number(result.balance).toLocaleString("en-US")} points`);
  set(root, isUpgrade ? "[data-up-rate]" : "[data-react-rate]", "Code issued");
  toast({
    title: "Code issued",
    message: `${Number(result.points).toLocaleString("en-US")} points deducted — ${result.balance.toLocaleString(
      "en-US"
    )} left.`,
  });
}

async function redeemFromPanel(root, kind) {
  if (app.busy) return;
  const isUpgrade = kind === "upgrade";
  const codeInput = qs(isUpgrade ? "[data-up-code]" : "[data-react-code]", root);
  const code = String((codeInput && codeInput.value) || "").trim().toUpperCase();
  const months = Number(
    (qs(isUpgrade ? "[data-up-months]" : "[data-react-months]", root) || {}).value || (isUpgrade ? 3 : 1)
  );
  const target = isUpgrade
    ? String((qs("[data-up-tier]", root) || {}).value || "")
    : (app.data && app.data.membership) || "free";

  if (!code) {
    toast({ title: "Enter the activation code", message: "Get one with Patreon, points, or the short ad." });
    return;
  }
  if (isUpgrade && !target) {
    toast({ title: "Nothing to upgrade to", message: "This membership is already the top tier." });
    return;
  }

  app.busy = true;
  const run = await runProgress(root, kind, isUpgrade ? "Upgrading Your Membership…" : "Reactivating Your Membership…");

  const result = await rpc("activation_redeem", {
    p_token: token,
    p_code: code,
    p_type: isUpgrade ? "upgrade" : "reactivation",
    p_target: target,
    p_duration: months,
  }).catch(() => null);

  app.busy = false;

  if (!result || result.ok !== true) {
    run.fail();
    toast({ title: isUpgrade ? "Upgrade failed" : "Re-activation failed", message: errorText(result && result.error) });
    return;
  }

  run.done();
  await sleep(300);

  const freeReactivate = !isUpgrade && (app.data.membership || "free") === "free";
  showDone(root, {
    title: isUpgrade
      ? "Membership Upgraded Successfully!"
      : freeReactivate
        ? "Your Free Membership Has Been Reactivated Successfully!"
        : "Membership Reactivated Successfully!",
    text: isUpgrade
      ? `You are now on ${planLabel(result.membership)} until ${formatDate(result.expires_at)}.`
      : `${planLabel(result.membership)} is extended until ${formatDate(result.expires_at)} — no days were lost.`,
    plan: planLabel(result.membership),
    until: result.expires_at,
  });
}

/* ================================================================== */
/* success + progress                                                 */
/* ================================================================== */
function showDone(root, { title, text, plan, until }) {
  qsa("[data-wizard], [data-act-choice], [data-react], [data-upgrade], [data-paid-note]", root).forEach((el) => {
    el.hidden = true;
  });
  const done = qs("[data-done]", root);
  if (!done) return;
  set(root, "[data-done-title]", title);
  set(root, "[data-done-text]", text);
  set(root, "[data-done-plan]", plan);
  set(root, "[data-done-until]", until ? formatDate(until) : "—");
  done.hidden = false;
  done.scrollIntoView?.({ block: "center", behavior: "smooth" });
  hydrateIcons(root);
  toast({ title: "Done", message: title });
}

/** Animates the per-section progress bar and returns { done, fail }. */
async function runProgress(root, kind, label) {
  const wrap = qs(`[data-run="${kind}"]`, root);
  const bar = wrap && qs("[data-run-bar]", wrap);
  const text = wrap && qs("[data-run-label]", wrap);
  if (wrap) wrap.hidden = false;
  if (text) text.textContent = label;
  if (bar) bar.style.width = "8%";
  await sleep(240);
  if (bar) bar.style.width = "46%";
  await sleep(420);
  if (bar) bar.style.width = "72%";

  return {
    done() {
      if (bar) bar.style.width = "100%";
      if (text) text.textContent = "Almost there…";
      setTimeout(() => {
        if (wrap) wrap.hidden = true;
        if (bar) bar.style.width = "0%";
      }, 900);
    },
    fail() {
      if (bar) bar.style.width = "0%";
      if (wrap) wrap.hidden = true;
    },
  };
}

/* ================================================================== */
/* helpers                                                            */
/* ================================================================== */
function errorText(code) {
  const map = {
    session: "Your session ended. Sign in again.",
    code: "That code was not found. Check it and try again.",
    used: "That code has already been used — request a new one.",
    expired: "That code expired. Request a new one.",
    other_member: "That code belongs to another member.",
    type_mismatch: "That code is for a different action (activation, re-activation, upgrade).",
    target_mismatch: "That code is for a different plan.",
    duration_mismatch: "That code is for a different duration.",
    not_higher: "An upgrade must go to a higher tier.",
    already_activated: "This account was already activated once.",
    not_activated_yet: "This account was never activated — use the four steps.",
    banned: "A banned account cannot be reactivated. Request a trial instead.",
    status: "The account is not in a state where this works.",
    plan: "First activation is free-plan only.",
    name: "The profile name is not valid (2–60 characters).",
    description: "The description is too long (300 characters).",
    language: "Pick a supported language.",
    age: "Pick an age rating.",
    code_format: "A viewing code is exactly six digits.",
    code_taken: "That viewing code is already taken — pick another.",
    duration: "That duration is not allowed for this plan.",
    free_uses_ad: "Free membership renews with the short ad, not with points.",
    payment: "That code must come from a payment.",
    price: "No price for that combination — pick another duration.",
    points: "Not enough points.",
    transaction: "The transaction was rolled back. Nothing was charged.",
    too_soon: "The countdown is still running.",
    not_found: "That advertising session expired — open the ad again.",
    closed: "That advertising session is closed.",
  };
  return map[code] || "Try again in a moment.";
}

function set(root, selector, value) {
  const el = qs(selector, root);
  if (el) el.textContent = value;
}

function note(root, text, show = true) {
  const box = qs("[data-act-notice]", root);
  const slot = qs("[data-act-notice-text]", root);
  if (!box || !slot) return;
  box.hidden = !text || !show;
  slot.textContent = text;
  hydrateIcons(root);
}

function planLabel(value) {
  return PLAN_LABEL[String(value || "free").toLowerCase()] || cap(value || "free");
}

function cap(value) {
  const text = String(value || "");
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : "";
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
