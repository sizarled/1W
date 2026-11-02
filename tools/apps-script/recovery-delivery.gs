/**
 * 1World — recovery delivery (Google Apps Script web app).
 * ------------------------------------------------------------------
 * One web app, three channels. The database posts a recovery code here and the
 * script carries it to the member by **email** (Gmail/MailApp), **WhatsApp**
 * (Meta WhatsApp Cloud API) or **Telegram** (bot API). Nothing else is needed:
 * no SMTP password, no mail server, no server of your own.
 *
 * Deploy once:
 *   1. script.google.com → New project → paste this file → Save
 *   2. Project Settings → Script properties — add the keys you use:
 *
 *        SHARED_TOKEN        a long random string; the same value goes into
 *                            site_secrets as `gs_mail_token`
 *        FROM_NAME           "1World" (the sender name on the email)
 *        CC                  optional copy of every mail, your own address
 *        WHATSAPP_TOKEN      Meta permanent access token   (WhatsApp only)
 *        WHATSAPP_PHONE_ID   the "Phone number ID" of the sender
 *        WHATSAPP_TEMPLATE   approved template name; leave empty to send text
 *        WHATSAPP_LANG       "en" (the language of the template)
 *        TELEGRAM_BOT_TOKEN  the bot token (optional here — the database can
 *                            also post to Telegram itself)
 *        TELEGRAM_CHAT_ID    default chat (optional)
 *
 *   3. Deploy → New deployment → type "Web app"
 *        Execute as:      Me
 *        Who has access:  Anyone
 *   4. copy the …/exec URL and store it in the database:
 *
 *        insert into public.site_secrets (key, value)
 *        values ('gs_mail_url',   'https://script.google.com/macros/s/XXXX/exec'),
 *               ('gs_mail_token', '<SHARED_TOKEN>')
 *        on conflict (key) do update set value = excluded.value, updated_at = now();
 *
 * The database calls it per channel (`channel: "email" | "whatsapp" | "telegram"`,
 * or "all") and reads the JSON answer, so a refusal is never mistaken for a send.
 * `doGet` is a heartbeat and never sends anything: open the /exec URL in a browser
 * to see which channels this deployment is configured for.
 *
 * The WhatsApp text — and the template body to submit to Meta — is:
 *
 *   1World recovery code: {{1}}. It is valid for 30 minutes and works once.
 *
 * Category: Utility (or Authentication, whose body is just {{1}}).
 */

/* ------------------------------------------------------------------ */
/* configuration — Script properties win, these are the fallbacks      */
/* ------------------------------------------------------------------ */
var SHARED_TOKEN = 'change-me-to-a-long-random-string';
var FROM_NAME = '1World';
var CC = '';

var WHATSAPP_TOKEN = '';
var WHATSAPP_PHONE_ID = '';
var WHATSAPP_TEMPLATE = ''; // empty → plain text (only inside the 24h window)
var WHATSAPP_LANG = 'en';
var WHATSAPP_VERSION = 'v21.0';

var TELEGRAM_BOT_TOKEN = '';
var TELEGRAM_CHAT_ID = '';

/* ------------------------------------------------------------------ */
/* the entry points                                                    */
/* ------------------------------------------------------------------ */
function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) return out({ ok: false, error: 'empty' });

    var body = JSON.parse(e.postData.contents);
    var token = prop('SHARED_TOKEN');
    if (token && String(body.token || '') !== token) return out({ ok: false, error: 'token' });

    var channel = String(body.channel || 'email').toLowerCase();
    if (['email', 'whatsapp', 'telegram', 'all'].indexOf(channel) < 0) {
      return out({ ok: false, error: 'channel' });
    }

    var text = String(body.text || '');
    var code = String(body.code || '');
    var name = String(body.name || body.member || 'member');
    var subject = String(body.subject || '1World — your recovery code').slice(0, 140);
    if (!text && !code) return out({ ok: false, error: 'text' });

    if (channel === 'all') {
      var results = {};
      results.email = attempt(sendEmail, body, subject, text);
      results.whatsapp = attempt(sendWhatsApp, body, code, text, name);
      results.telegram = attempt(sendTelegram, body, text);
      return out({ ok: true, channel: 'all', results: results });
    }

    if (channel === 'email') {
      var sentEmail = sendEmail(body, subject, text);
      return out({ ok: true, channel: 'email', to: sentEmail });
    }

    if (channel === 'whatsapp') {
      var sentWhats = sendWhatsApp(body, code, text, name);
      return out({ ok: true, channel: 'whatsapp', to: sentWhats.to, id: sentWhats.id, mode: sentWhats.mode });
    }

    var sentTelegram = sendTelegram(body, text);
    return out({ ok: true, channel: 'telegram', to: sentTelegram.chat, id: sentTelegram.id });
  } catch (error) {
    return out({ ok: false, error: String(error && error.message ? error.message : error) });
  }
}

/** A GET is only a heartbeat: it must never send anything. */
function doGet() {
  return out({
    ok: true,
    service: '1world-recovery-delivery',
    channels: {
      email: true,
      whatsapp: Boolean(prop('WHATSAPP_TOKEN') && prop('WHATSAPP_PHONE_ID')),
      telegram: Boolean(prop('TELEGRAM_BOT_TOKEN')),
    },
    template: prop('WHATSAPP_TEMPLATE') || null,
  });
}

/* ------------------------------------------------------------------ */
/* email                                                               */
/* ------------------------------------------------------------------ */
function sendEmail(body, subject, text) {
  var to = String(body.email || body.to || '').trim();
  if (!isEmail_(to)) throw new Error('to: ' + to);

  var cc = String(body.cc || prop('CC') || '').trim();
  if (!isEmail_(cc) || cc.toLowerCase() === to.toLowerCase()) cc = '';

  var options = {
    name: prop('FROM_NAME') || FROM_NAME,
    body: text,
    replyTo: Session.getActiveUser().getEmail() || undefined,
  };
  if (cc) options.cc = cc;

  var code = String(body.code || '');
  if (code) options.htmlBody = html_(subject, body.name || body.member || '', code);

  MailApp.sendEmail(to, subject, text, options);
  return to;
}

/* ------------------------------------------------------------------ */
/* WhatsApp — Meta Cloud API                                           */
/* ------------------------------------------------------------------ */
/**
 * `to` must be E.164 digits (212668313718). The database normalises it before
 * posting; anything that is not 10–15 digits is refused here.
 *
 * A business-initiated message needs an **approved template**. When
 * WHATSAPP_TEMPLATE is empty the script tries a plain text message, which Meta
 * only delivers inside a 24-hour conversation window; a template that fails is
 * retried as text so the answer says what happened instead of a bare error.
 */
function sendWhatsApp(body, code, text, name) {
  var token = prop('WHATSAPP_TOKEN');
  var phoneId = prop('WHATSAPP_PHONE_ID');
  if (!token || !phoneId) throw new Error('whatsapp not configured');

  // `to` is the number for a single-channel call; "all" carries `whatsapp`
  var raw = body.whatsapp || body.wa || body.to;
  var to = String(raw || '').replace(/[^0-9]/g, '');
  if (to.length < 10 || to.length > 15) throw new Error('to: ' + (raw || ''));

  var template = String(body.template || prop('WHATSAPP_TEMPLATE') || '').trim();
  var lang = String(body.lang || prop('WHATSAPP_LANG') || 'en');
  var note = '';

  if (template) {
    try {
      var sent = post_(phoneId, token, {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: to,
        type: 'template',
        template: {
          name: template,
          language: { code: lang },
          components: [
            { type: 'body', parameters: [{ type: 'text', text: code || text }] },
          ],
        },
      });
      return { to: to, id: sent.id, mode: 'template' };
    } catch (error) {
      note = String(error && error.message ? error.message : error);
    }
  }

  var fallback = post_(phoneId, token, {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: to,
    type: 'text',
    text: { preview_url: false, body: text || ('1World recovery code: ' + code) },
  });
  return { to: to, id: fallback.id, mode: note ? 'text (template failed: ' + note + ')' : 'text' };
}

function post_(phoneId, token, payload) {
  var response = UrlFetchApp.fetch(
    'https://graph.facebook.com/' + (prop('WHATSAPP_VERSION') || WHATSAPP_VERSION) + '/' + phoneId + '/messages',
    {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + token },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true,
    }
  );

  var raw = response.getContentText() || '{}';
  var json = {};
  try {
    json = JSON.parse(raw);
  } catch (ignored) {
    json = {};
  }

  if (response.getResponseCode() >= 300 || (json.error && json.error.message)) {
    throw new Error((json.error && json.error.message) || 'HTTP ' + response.getResponseCode());
  }

  var message = (json.messages && json.messages[0]) || {};
  return { id: message.id || null, raw: raw };
}

/* ------------------------------------------------------------------ */
/* Telegram                                                            */
/* ------------------------------------------------------------------ */
function sendTelegram(body, text) {
  var token = prop('TELEGRAM_BOT_TOKEN');
  if (!token) throw new Error('telegram not configured');

  var chat = String(body.chat || body.chat_id || body.telegram_chat_id || prop('TELEGRAM_CHAT_ID') || '').trim();
  if (!chat) throw new Error('chat');

  var response = UrlFetchApp.fetch('https://api.telegram.org/bot' + token + '/sendMessage', {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({ chat_id: chat, text: text, disable_web_page_preview: true }),
    muteHttpExceptions: true,
  });

  var json = {};
  try {
    json = JSON.parse(response.getContentText() || '{}');
  } catch (ignored) {
    json = {};
  }

  if (!json.ok) throw new Error((json.description) || 'HTTP ' + response.getResponseCode());
  return { chat: chat, id: (json.result && json.result.message_id) || null };
}

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */
function prop(key) {
  try {
    var value = PropertiesService.getScriptProperties().getProperty(key);
    if (value !== null && value !== undefined && String(value).trim() !== '') return String(value).trim();
  } catch (ignored) {
    /* no properties service: fall through to the constants below the header */
  }
  var scope = typeof globalThis !== 'undefined' ? globalThis : this;
  var constant = scope[key];
  return constant === undefined || constant === null ? '' : String(constant).trim();
}

function isEmail_(value) {
  return /^[^@\s]+@[^@\s]+\.[a-zA-Z]{2,}$/.test(String(value || ''));
}

function escape_(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function html_(subject, name, code) {
  return (
    '<div style="font:16px/1.6 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#111">' +
    '<h2 style="margin:0 0 12px;font-size:18px">' + escape_(subject) + '</h2>' +
    (name ? '<p>Hello ' + escape_(name) + ',</p>' : '') +
    '<p>Your recovery code is:</p>' +
    '<p style="font:22px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:2px;' +
    'background:#f5f5f5;border:1px solid #e5e5e5;border-radius:10px;padding:14px 18px;display:inline-block">' +
    escape_(code) + '</p>' +
    '<p>It is valid for 30 minutes and it works once: after you change the password a new code ' +
    'replaces it.</p>' +
    '<p style="color:#666">If you did not ask for this, ignore the message — your password stays ' +
    'as it is.</p></div>'
  );
}

/** Run one channel and turn an exception into a value the caller can report. */
function attempt(fn, body, a, b, c) {
  try {
    fn(body, a, b, c);
    return 'sent';
  } catch (error) {
    return 'failed: ' + (error && error.message ? error.message : error);
  }
}

function out(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(
    ContentService.MimeType.JSON
  );
}

/* ------------------------------------------------------------------ */
/* run these from the editor, never from the web app                   */
/* ------------------------------------------------------------------ */
/** Sends a real message on every configured channel. Edit these two lines first. */
function testSend() {
  var EMAIL = Session.getActiveUser().getEmail(); // ← your address
  var WHATSAPP = '212600000000';                  // ← your number, E.164 digits, no +

  var body = {
    token: prop('SHARED_TOKEN'),
    code: 'OW-TEST-0000-0001',
    name: 'test',
    subject: '1World — test message',
    text: '1World — test message.\n\nCode: OW-TEST-0000-0001',
  };

  Logger.log('email:    ' + attempt(sendEmail, shallow(body, { to: EMAIL }), body.subject, body.text));
  Logger.log('whatsapp: ' + attempt(sendWhatsApp, shallow(body, { to: WHATSAPP }), body.code, body.text, 'test'));
  Logger.log('telegram: ' + attempt(sendTelegram, body, body.text));
}

/** body + a few overrides, without touching the original. */
function shallow(base, extra) {
  var copy = {};
  Object.keys(base).forEach(function (key) {
    copy[key] = base[key];
  });
  Object.keys(extra || {}).forEach(function (key) {
    copy[key] = extra[key];
  });
  return copy;
}

/** Prints which properties this deployment actually has, without printing secrets. */
function checkSetup() {
  ['SHARED_TOKEN', 'FROM_NAME', 'CC', 'WHATSAPP_TOKEN', 'WHATSAPP_PHONE_ID', 'WHATSAPP_TEMPLATE',
   'WHATSAPP_LANG', 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID'].forEach(function (key) {
    var value = prop(key);
    Logger.log(key + ': ' + (value ? 'set (' + value.length + ' chars)' : 'MISSING'));
  });
}
