import { loadConfig } from "./config.js";
import { fetchFeed } from "./fetcher.js";
import { isGoldRelevant } from "./filter.js";
import { DedupStore } from "./dedup.js";
import { summarizeThai } from "./summarize.js";
import { formatMessage, sendTelegram } from "./telegram.js";

const dryRun = process.argv.includes("--dry-run");

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`missing ${name} — copy .env.example to .env and fill it`);
    process.exit(1);
  }
  return v;
}

async function runCycle(): Promise<void> {
  const config = loadConfig();
  const store = new DedupStore(config.db_path);
  const geminiKey = process.env.GEMINI_API_KEY;
  const tgToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  console.log(`[cycle] fetching ${config.feeds.length} feeds...`);
  const results = await Promise.allSettled(
    config.feeds.map((f) => fetchFeed(f.url, f.name, f.lang))
  );

  let items = results.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
  for (const r of results) if (r.status === "rejected") console.error("[fetch] failed:", r.reason);

  items = items.filter((it) => isGoldRelevant(it, config.keywords));
  items = items.filter((it) => !store.seen(it.hash));
  items.sort((a, b) => (b.pubDate?.getTime() ?? 0) - (a.pubDate?.getTime() ?? 0));
  items = items.slice(0, config.max_items_per_cycle);

  console.log(`[cycle] ${items.length} new relevant item(s)`);

  for (const item of items) {
    try {
      let summary: string | null = null;
      if (geminiKey) summary = await summarizeThai(item, geminiKey);
      const msg = formatMessage(item, summary);
      if (dryRun || !tgToken || !chatId) {
        console.log("---- (dry-run / no token) ----\n" + msg + "\n");
      } else {
        await sendTelegram(tgToken, chatId, msg);
        console.log(`[sent] ${item.source}: ${item.title.slice(0, 60)}`);
      }
      store.markSent(item.hash);
    } catch (err) {
      console.error("[cycle] item failed:", err);
    }
  }
  console.log(`[cycle] done, total sent ever: ${store.count()}`);
}

const config = loadConfig();
const intervalMs = config.interval_minutes * 60_000;

if (dryRun) {
  await runCycle();
} else {
  console.log(`gold-news-bot started, every ${config.interval_minutes} min`);
  void runCycle();
  setInterval(runCycle, intervalMs);
}
