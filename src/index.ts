import { loadConfig } from "./config.js";
import { fetchFeed } from "./fetcher.js";
import { isGoldRelevant } from "./filter.js";
import { DedupStore } from "./dedup.js";
import { rankAndSummarize } from "./rank.js";
import { formatMessage, sendTelegram, deleteMessage } from "./telegram.js";
import { existsSync } from "node:fs";

if (existsSync(".env")) process.loadEnvFile(".env");

const dryRun = process.argv.includes("--dry-run");
const once = process.argv.includes("--once");

async function runCycle(): Promise<void> {
  const config = loadConfig();
  const store = new DedupStore(config.db_path);
  const geminiKey = process.env.GEMINI_API_KEY;
  const tgToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  // F2: auto-delete old messages to keep the chat clean
  if (!dryRun && config.delete_after_hours > 0 && tgToken && chatId) {
    for (const id of store.expiredMessages(config.delete_after_hours)) {
      const ok = await deleteMessage(tgToken, chatId, id);
      if (!ok) console.log(`[purge] message ${id} already gone or too old — forgotten`);
      store.forgetMessage(id);
    }
  }

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

  console.log(`[cycle] ${items.length} candidate(s)`);

  if (!items.length) {
    console.log("[cycle] done");
    return;
  }

  // F1: one Gemini call per cycle scores + summarizes the whole batch
  let ranked: Record<string, { score: number; summary: string }> | null = null;
  if (geminiKey) ranked = await rankAndSummarize(items, geminiKey, config.quality_threshold);
  if (!ranked && geminiKey) console.warn("[rank] AI ranking unavailable — falling back to send-all");

  for (const item of items) {
    try {
      const r = ranked?.[item.hash];
      if (geminiKey && ranked && r && r.score < config.quality_threshold) {
        console.log(`[skip] (${r.score}/10) ${item.title.slice(0, 60)}`);
        store.markSent(item.hash);
        continue;
      }
      const summary = r && r.summary ? r.summary : null;
      const msg = formatMessage(item, summary);
      if (dryRun || !tgToken || !chatId) {
        console.log(`---- (dry-run${r ? ` score=${r.score}/10` : " no-ai"}) ----\n${msg}\n`);
      } else {
        const messageId = await sendTelegram(tgToken, chatId, msg);
        if (messageId) store.trackMessage(item.hash, messageId);
        console.log(
          `[sent]${r ? ` (${r.score}/10)` : ""} ${item.source}: ${item.title.slice(0, 60)}`
        );
      }
      store.markSent(item.hash);
    } catch (err) {
      console.error("[cycle] item failed:", err);
    }
  }
  console.log(`[cycle] done, total processed ever: ${store.count()}`);
}

const config = loadConfig();
const intervalMs = config.interval_minutes * 60_000;

if (dryRun || once) {
  await runCycle();
} else {
  console.log(`gold-news-bot started, every ${config.interval_minutes} min`);
  void runCycle();
  setInterval(runCycle, intervalMs);
}
