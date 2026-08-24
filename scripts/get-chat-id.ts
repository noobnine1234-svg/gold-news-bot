import { existsSync } from "node:fs";

if (existsSync(".env")) process.loadEnvFile(".env");
const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  console.error("set TELEGRAM_BOT_TOKEN first (.env or export)");
  process.exit(1);
}

const res = await fetch(`https://api.telegram.org/bot${token}/getUpdates`);
const json = await res.json() as {
  result?: { message?: { chat?: { id?: number; title?: string; username?: string } } }[];
};
const chats = new Map<number, string>();
for (const u of json.result ?? []) {
  const c = u.message?.chat;
  if (c?.id) chats.set(c.id, c.title ?? c.username ?? "chat");
}
if (!chats.size) {
  console.log("no chats found — open your bot in Telegram, send /start, then run again");
} else {
  for (const [id, name] of chats) console.log(`${id}  (${name})`);
}
