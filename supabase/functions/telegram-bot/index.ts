/**
 * 1World — the Telegram bot (Supabase edge function).
 * ------------------------------------------------------------------
 * The bot does one job: it is where a member **links their Telegram** so the
 * recovery code can reach their own chat — never the operator's.
 *
 *   /start <code>   the code comes from dashboard.html → Settings → Account →
 *                   Connect Telegram. Arriving from a deep link
 *                   (https://t.me/<bot>?start=<code>) it is already in `/start`.
 *                   The function answers the linking RPC and replies.
 *   /start          no code: explains where to find one, and shows the chat id.
 *   /stop           unlinks this chat from whichever account holds it.
 *   /id             the chat id, for the operator.
 *
 * Secrets:
 *   TELEGRAM_BOT_TOKEN       from @BotFather
 *   TELEGRAM_WEBHOOK_SECRET  the `secret_token` given to setWebhook; Telegram
 *                            sends it back in `X-Telegram-Bot-Api-Secret-Token`
 *   SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by the runtime.
 *
 * Deploy with `verify_jwt: false` — Telegram has no Supabase JWT — then point
 * the bot at it once:
 *
 *   https://api.telegram.org/bot<TOKEN>/setWebhook
 *     ?url=https://<ref>.supabase.co/functions/v1/telegram-bot
 *     &secret_token=<TELEGRAM_WEBHOOK_SECRET>
 *     &allowed_updates=["message"]
 */

const BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
const WEBHOOK_SECRET = Deno.env.get("TELEGRAM_WEBHOOK_SECRET") ?? "";
const SERVICE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

type TelegramUpdate = {
  message?: {
    chat?: { id?: number | string; type?: string };
    from?: { username?: string; first_name?: string };
    text?: string;
  };
};

async function rpc(name: string, body: unknown): Promise<Record<string, unknown>> {
  const answer = await fetch(`${SERVICE_URL}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  return (await answer.json().catch(() => ({}))) as Record<string, unknown>;
}

async function reply(chat: string | number, text: string): Promise<void> {
  if (!BOT_TOKEN) return;
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chat, text, disable_web_page_preview: true }),
  }).catch(() => undefined);
}

const LINKED = (who?: string) =>
  `تم ربط حسابك بتلغرام ✅\n${
    who ? `الحساب: ${who}\n` : ""
  }\nسيصلك كود الاستعادة هنا.\nلإلغاء الربط أرسل /stop`;

const BAD_CODE =
  "الرمز غير صحيح أو انتهت صلاحيته ⏳\nافتح: لوحة التحكم ← الإعدادات ← الحساب ← ربط تلغرام، ثم أعد المحاولة.\n\nThis code is wrong or expired — start again from the dashboard.";

const WELCOME =
  "مرحبًا 👋\nلربط حسابك: لوحة التحكم ← الإعدادات ← الحساب ← Connect Telegram،\nثم اضغط على الرابط الذي يظهر لك.\n\nLink your account from the dashboard; the button opens this bot with a code.";

const STOPPED = "تم إلغاء الربط. لن تصلك أكواد الاستعادة هنا بعد الآن.\nUnlinked.";

const NOT_LINKED = "هذه المحادثة غير مرتبطة بأي حساب.\nThis chat is not linked to an account.";

Deno.serve(async (request) => {
  if (request.method !== "POST") return new Response("ok", { status: 200 });

  // only Telegram knows the secret word
  if (WEBHOOK_SECRET) {
    const given = request.headers.get("x-telegram-bot-api-secret-token") ?? "";
    if (given !== WEBHOOK_SECRET) return new Response("forbidden", { status: 403 });
  }

  let update: TelegramUpdate;
  try {
    update = (await request.json()) as TelegramUpdate;
  } catch {
    return new Response("ok", { status: 200 });
  }

  const message = update?.message;
  const chat = message?.chat?.id;
  const text = String(message?.text ?? "").trim();
  if (chat === undefined || !text) return new Response("ok", { status: 200 });

  const [command, ...rest] = text.split(/\s+/);
  const argument = String(rest[0] ?? "").trim();
  const username = message?.from?.username;

  try {
    if (command === "/start" || command.startsWith("/start@")) {
      if (!argument) {
        await reply(chat, `${WELCOME}\n\nchat id: ${chat}`);
        return new Response("ok", { status: 200 });
      }
      const answer = await rpc("telegram_identity_link", {
        p_code: argument,
        p_chat: String(chat),
        p_username: username ?? null,
      });
      await reply(chat, answer?.ok === true ? LINKED(String(answer.username ?? "")) : BAD_CODE);
      return new Response("ok", { status: 200 });
    }

    if (command === "/stop" || command.startsWith("/stop@")) {
      const answer = await rpc("telegram_identity_unlink", { p_chat: String(chat) });
      await reply(chat, answer?.unlinked === true ? STOPPED : NOT_LINKED);
      return new Response("ok", { status: 200 });
    }

    if (command === "/id") {
      await reply(chat, `chat id: ${chat}`);
      return new Response("ok", { status: 200 });
    }

    await reply(chat, `${WELCOME}\n\nchat id: ${chat}`);
    return new Response("ok", { status: 200 });
  } catch (error) {
    console.error("telegram-bot:", error);
    return new Response("ok", { status: 200 }); // never make Telegram retry a loop
  }
});
