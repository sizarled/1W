/**
 * 1World — recovery mailer (Google Apps Script web app).
 * ------------------------------------------------------------------
 * The database hands the recovery code to this script, and the script sends the
 * message from the Google account that deployed it. Nothing else is required:
 * no SMTP password, no third-party mail service.
 *
 * Deploy once:
 *   1. script.google.com → New project → paste this file → Save
 *   2. change TOKEN below to a long random string
 *   3. Deploy → New deployment → type "Web app"
 *        Execute as:  Me
 *        Who has access:  Anyone
 *   4. copy the …/exec URL and store it in the database (see tools/sql/recovery-page.sql,
 *      section "delivery"):
 *
 *        insert public.site_secrets (key, value)
 *        values ('gs_mail_url',   'https://script.google.com/macros/s/XXXX/exec'),
 *               ('gs_mail_token', '<the same TOKEN>')
 *        on conflict (key) do update set value = excluded.value, updated_at = now();
 *
 * The script answers JSON, so `recovery_send()` can tell a refusal from a send.
 */

var TOKEN = 'change-me-to-a-long-random-string';
var FROM_NAME = '1World';

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) return out({ ok: false, error: 'empty' });

    var body = JSON.parse(e.postData.contents);

    if (TOKEN && body.token !== TOKEN) return out({ ok: false, error: 'token' });

    var to = String(body.to || '').trim();
    if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(to)) return out({ ok: false, error: 'to' });

    var subject = String(body.subject || '1World — your recovery code').slice(0, 140);
    // optional copy (the operator's address while the flow is being tested)
    var cc = String(body.cc || '').trim();
    if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(cc)) cc = '';
    var text = String(body.text || '');
    if (!text) return out({ ok: false, error: 'text' });

    MailApp.sendEmail({
      to: to,
      subject: subject,
      body: text,
      name: FROM_NAME,
      cc: cc || undefined,
      replyTo: Session.getActiveUser().getEmail() || undefined,
    });

    return out({ ok: true, to: to });
  } catch (error) {
    return out({ ok: false, error: String(error) });
  }
}

/** A GET is only a heartbeat: it must never send anything. */
function doGet() {
  return out({ ok: true, service: '1world-recovery-mailer' });
}

function out(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(
    ContentService.MimeType.JSON
  );
}
