/**
 * recovery-delivery.gs smoke test — the Apps Script, run under Node with stubbed
 * Google services (no deployment, no network, no quota).
 *
 *   node tools/delivery-smoke.mjs
 *
 * It answers the questions that matter for a web app the database calls blind:
 *   · a wrong token, a bad address and an unknown channel are refused, never sent;
 *   · email goes out with the code, the HTML body and the operator copy;
 *   · WhatsApp uses the approved template with the code in `{{1}}`, and falls back
 *     to plain text — reporting that it did — when Meta rejects the template;
 *   · Telegram uses the chat it was given, or the configured default;
 *   · `channel: "all"` sends each channel independently and reports all three;
 *   · `doGet` is a heartbeat: it sends nothing and never prints a secret.
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = readFileSync(join(root, "tools/apps-script/recovery-delivery.gs"), "utf8");

const checks = [];
function check(name, ok, detail = "") {
  checks.push({ name, ok: Boolean(ok), detail: ok ? "" : String(detail) });
}

/* ------------------------------------------------------------------ */
/* the Google services, stubbed                                        */
/* ------------------------------------------------------------------ */
const BASE_PROPS = {
  SHARED_TOKEN: "s3cret-token",
  FROM_NAME: "1World",
  CC: "operator@example.com",
  WHATSAPP_TOKEN: "wa-token",
  WHATSAPP_PHONE_ID: "1234567890",
  WHATSAPP_TEMPLATE: "recovery_code",
  WHATSAPP_LANG: "en",
  TELEGRAM_BOT_TOKEN: "123456:AAH-test-token",
  TELEGRAM_CHAT_ID: "777",
};

/** every boot starts from the same configuration, so a test cannot leak into the next */
let props = { ...BASE_PROPS };

const sent = { mail: [], http: [], meta: { failTemplate: false, failTelegram: false } };

function boot(overrides = {}) {
  sent.mail.length = 0;
  sent.http.length = 0;
  sent.meta.failTemplate = false;
  sent.meta.failTelegram = false;
  props = { ...BASE_PROPS, ...overrides };

  const sandbox = {
    PropertiesService: {
      getScriptProperties: () => ({ getProperty: (key) => (key in props ? props[key] : null) }),
    },
    MailApp: {
      sendEmail: (to, subject, body, options) => sent.mail.push({ to, subject, body, options }),
    },
    Session: { getActiveUser: () => ({ getEmail: () => "me@example.com" }) },
    UrlFetchApp: {
      fetch: (url, options) => {
        sent.http.push({ url, options, payload: JSON.parse(options.payload) });
        if (url.includes("graph.facebook.com")) {
          if (sent.meta.failTemplate && sent.http.at(-1).payload.type === "template") {
            return {
              getResponseCode: () => 400,
              getContentText: () => JSON.stringify({ error: { message: "Template not found" } }),
            };
          }
          return {
            getResponseCode: () => 200,
            getContentText: () => JSON.stringify({ messages: [{ id: "wamid.TEST" }] }),
          };
        }
        if (url.includes("api.telegram.org")) {
          if (sent.meta.failTelegram) {
            return {
              getResponseCode: () => 400,
              getContentText: () => JSON.stringify({ ok: false, description: "Bad Request: chat not found" }),
            };
          }
          return {
            getResponseCode: () => 200,
            getContentText: () => JSON.stringify({ ok: true, result: { message_id: 42 } }),
          };
        }
        return { getResponseCode: () => 404, getContentText: () => "{}" };
      },
    },
    ContentService: {
      MimeType: { JSON: "json" },
      createTextOutput: (body) => ({ setMimeType: () => ({ body }) }),
    },
    Logger: { log: () => {} },
  };

  sandbox.globalThis = sandbox;
  const context = vm.createContext(sandbox);
  vm.runInContext(source, context);

  const post = (body) =>
    JSON.parse(
      vm.runInContext("doPost", context)({ postData: { contents: JSON.stringify(body) } }).body
    );
  const get = () => JSON.parse(vm.runInContext("doGet", context)().body);

  return { post, get, sandbox, context };
}

const CODE = "OW-AB12-CD34-EF56";
const base = {
  token: "s3cret-token",
  code: CODE,
  name: "Mehdi",
  member: "ID100003",
  text: `1World — account recovery\n\nYour recovery code is:\n\n   ${CODE}\n`,
};
const report = {};

/* ------------------------------------------------------------------ */
/* refusals                                                            */
/* ------------------------------------------------------------------ */
{
  const app = boot();
  const wrongToken = app.post({ ...base, token: "nope", channel: "email", to: "m@example.com" });
  const noChannel = app.post({ ...base, channel: "sms", to: "m@example.com" });
  const badEmail = app.post({ ...base, channel: "email", to: "not-an-address" });
  const badWhats = app.post({ ...base, channel: "whatsapp", to: "12345" });
  const empty = app.post({ ...base, channel: "email", to: "", text: "", code: "" });

  report.refusals = { wrongToken, noChannel, badEmail, badWhats, empty };
  check("a wrong token sends nothing", wrongToken.ok === false && wrongToken.error === "token" && sent.mail.length === 0 && sent.http.length === 0);
  check("an unknown channel is refused", noChannel.error === "channel");
  check("a malformed email is refused", badEmail.ok === false && badEmail.error.startsWith("to:"));
  check("a short WhatsApp number is refused", badWhats.ok === false && badWhats.error.startsWith("to:"));
  check("an empty body is refused", empty.ok === false && empty.error === "text");
  check("nothing left the script", sent.mail.length === 0 && sent.http.length === 0, `${sent.mail.length}/${sent.http.length}`);
}

/* ------------------------------------------------------------------ */
/* email                                                               */
/* ------------------------------------------------------------------ */
{
  const app = boot();
  const answer = app.post({ ...base, channel: "email", to: "member@example.com", subject: "1World — your recovery code" });
  const mail = sent.mail[0] || {};

  report.email = { answer, to: mail.to, cc: mail.options?.cc, html: Boolean(mail.options?.htmlBody), subject: mail.subject };
  check("email is sent and confirmed", answer.ok === true && answer.channel === "email" && answer.to === "member@example.com");
  check("the code is in the body", String(mail.body).includes(CODE));
  check("the HTML body carries the code too", String(mail.options?.htmlBody || "").includes(CODE), mail.options?.htmlBody?.slice(0, 80));
  check("the operator copy is added", mail.options?.cc === "operator@example.com", String(mail.options?.cc));
  check("the sender name is set", mail.options?.name === "1World");

  const noCopy = boot({ CC: "" }).post({ ...base, channel: "email", to: "member@example.com" });
  check("no copy when CC is empty", noCopy.ok === true && sent.mail[0].options.cc === undefined, String(sent.mail[0]?.options?.cc));
}

/* ------------------------------------------------------------------ */
/* WhatsApp                                                            */
/* ------------------------------------------------------------------ */
{
  const app = boot();
  const answer = app.post({ ...base, channel: "whatsapp", to: "+212 668-313718" });
  const call = sent.http.at(-1) || { payload: {} };

  report.whatsapp = { answer, url: call.url, type: call.payload.type, to: call.payload.to };
  check("WhatsApp answers with the message id", answer.ok === true && answer.id === "wamid.TEST" && answer.mode === "template");
  check("the Cloud API url carries the phone number id", String(call.url).includes("/1234567890/messages"), call.url);
  check("the number is digits only", call.payload.to === "212668313718", call.payload.to);
  check("the template carries the code as {{1}}", call.payload.type === "template" && call.payload.template?.name === "recovery_code" && call.payload.template?.components?.[0]?.parameters?.[0]?.text === CODE);

  const falling = boot({ WHATSAPP_TEMPLATE: "" });
  const textAnswer = falling.post({ ...base, channel: "whatsapp", to: "212668313718" });
  check("without a template it sends text", textAnswer.ok === true && sent.http.at(-1).payload.type === "text", JSON.stringify(textAnswer));

  const rejected = boot();
  sent.meta.failTemplate = true;
  const retry = rejected.post({ ...base, channel: "whatsapp", to: "212668313718" });
  report.whatsapp.fallback = { answer: retry, type: sent.http.at(-1).payload.type };
  check("a rejected template falls back to text", retry.ok === true && sent.http.at(-1).payload.type === "text");
  check("and says the template failed", String(retry.mode).startsWith("text (template failed"), retry.mode);

  const unconfigured = boot({ WHATSAPP_TOKEN: "", WHATSAPP_PHONE_ID: "" });
  const refused = unconfigured.post({ ...base, channel: "whatsapp", to: "212668313718" });
  check("without credentials it refuses", refused.ok === false && refused.error === "whatsapp not configured", JSON.stringify(refused));
  check("and nothing is sent", sent.http.length === 0, String(sent.http.length));
}

/* ------------------------------------------------------------------ */
/* Telegram                                                            */
/* ------------------------------------------------------------------ */
{
  const app = boot();
  const answer = app.post({ ...base, channel: "telegram" });
  const call = sent.http.at(-1) || { payload: {} };
  report.telegram = { answer, url: call.url, chat: call.payload.chat_id };
  check("Telegram answers with the message id", answer.ok === true && answer.id === 42);
  check("it posts to the bot", String(call.url).startsWith("https://api.telegram.org/bot123456:AAH-test-token/sendMessage"), call.url);
  check("it uses the default chat", call.payload.chat_id === "777", String(call.payload.chat_id));
  check("the message carries the code", String(call.payload.text).includes(CODE));

  const perMember = app.post({ ...base, channel: "telegram", chat: "999" });
  check("a chat in the body wins", perMember.ok === true && sent.http.at(-1).payload.chat_id === "999");

  const failing = boot();
  sent.meta.failTelegram = true;
  const failed = failing.post({ ...base, channel: "telegram" });
  check("a Telegram refusal is not a send", failed.ok === false && failed.error.includes("chat not found"), JSON.stringify(failed));
}

/* ------------------------------------------------------------------ */
/* every channel at once                                               */
/* ------------------------------------------------------------------ */
{
  const app = boot();
  const answer = app.post({ ...base, channel: "all", email: "member@example.com", whatsapp: "212668313718" });
  report.all = answer;
  check("all three channels report", answer.ok === true && answer.results?.email === "sent" && answer.results?.whatsapp === "sent" && answer.results?.telegram === "sent", JSON.stringify(answer));
  check("one mail and two http calls", sent.mail.length === 1 && sent.http.length === 2, `${sent.mail.length}/${sent.http.length}`);
  check("each channel gets its own address", sent.mail[0].to === "member@example.com" && sent.http[0].payload.to === "212668313718");

  const broken = boot({ WHATSAPP_TOKEN: "" });
  const partial = broken.post({ ...base, channel: "all", email: "member@example.com", whatsapp: "212668313718" });
  check("a missing channel does not spoil the others", partial.ok === true && partial.results.email === "sent" && String(partial.results.whatsapp).startsWith("failed"), JSON.stringify(partial.results));
}

/* ------------------------------------------------------------------ */
/* the heartbeat                                                       */
/* ------------------------------------------------------------------ */
{
  const app = boot();
  const beat = app.get();
  report.heartbeat = beat;
  check("doGet is a heartbeat", beat.ok === true && beat.service === "1world-recovery-delivery");
  check("it reports the configured channels", beat.channels.email === true && beat.channels.whatsapp === true && beat.channels.telegram === true);
  check("it prints no secret", !JSON.stringify(beat).includes("s3cret-token") && !JSON.stringify(beat).includes("wa-token"));
  check("it never sends", sent.mail.length === 0 && sent.http.length === 0);
}

const passed = checks.filter((item) => item.ok).length;
const failed = checks.length - passed;
for (const item of checks) {
  if (!item.ok) console.log(`FAIL ${item.name}${item.detail ? ` — ${item.detail}` : ""}`);
}
console.log(JSON.stringify(report, null, 2));
console.log(`delivery smoke: ${passed}/${checks.length}`);
process.exit(failed ? 1 : 0);
