import { existsSync } from "node:fs";
if (existsSync(".env")) process.loadEnvFile(".env");

import { loadConfig } from "./config.js";
import { KEYWORDS, FEEDS } from "./sources.js";
import { fetchFeed } from "./fetcher.js";
import type { NewsItem } from "./types.js";
import { isGoldRelevant } from "./filter.js";
import { DedupStore } from "./dedup.js";
import { rankAndSummarize, summarizeArticle, isPassing } from "./rank.js";
import { fetchArticleText } from "./article.js";
import { isReputableLink } from "./reputation.js";
import { guardedFetch } from "./http.js";
import { formatMessage, sendTelegram, deleteMessage } from "./telegram.js";

const dryRun = process.argv.includes("--dry-run");
const once = process.argv.includes("--once");

export async function runCycle(): Promise<void> {
  const config = loadConfig();
  const store = new DedupStore(config.db_path);
  const geminiKey = process.env.GEMINI_API_KEY;
  const tgToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  // auto-delete old messages to keep the chat clean
  if (!dryRun && config.delete_after_hours > 0 && tgToken && chatId) {
    for (const id of store.expiredMessages(config.delete_after_hours)) {
      const ok = await deleteMessage(tgToken, chatId, id);
      if (!ok) console.log(`[purge] message ${id} already gone or too old — forgotten`);
      store.forgetMessage(id);
    }
  }

  console.log(`[cycle] fetching ${FEEDS.length} feeds...`);
  const results = await Promise.allSettled(FEEDS.map((f) => fetchFeed(f)));

  let items: NewsItem[] = results.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
  for (const r of results) if (r.status === "rejected") console.error("[fetch] failed:", r.reason);

  items = items.filter((it) => isGoldRelevant(it, KEYWORDS));
  items = items.filter((it) => !store.seen(it.hash));
  items.sort((a, b) => (b.pubDate?.getTime() ?? 0) - (a.pubDate?.getTime() ?? 0));

  // reputable-sources-only gate + link pinning (same rationale as the worker)
  const vettedLocal = await Promise.all(
    items.slice(0, 15).map(async (it) => ({
      it,
      rep: await isReputableLink(it, !!it.trusted, guardedFetch),
    }))
  );
  const droppedRep = vettedLocal.filter((v) => !v.rep.ok).length;
  if (droppedRep) console.log(`[reputation] dropped ${droppedRep} non-allowlisted source(s)`);
  items = vettedLocal
    .filter((v) => v.rep.ok)
    .map((v) => ({ ...v.it, link: v.rep.ok ? v.rep.url : v.it.link }));

  items = items.slice(0, config.max_items_per_cycle);

  console.log(`[cycle] ${items.length} candidate(s)`);

  if (!items.length) {
    console.log("[cycle] done");
    return;
  }

  // stage 1: one Gemini call scores the whole batch from headlines
  const ranked = geminiKey
    ? await rankAndSummarize(items, geminiKey, config.quality_threshold)
    : null;
  if (geminiKey && !ranked) console.warn("[rank] AI ranking unavailable — falling back to send-all");

  const aiVetted = !!ranked;
  const passes = (it: NewsItem): boolean =>
    isPassing(ranked, it.hash, config.quality_threshold);

  // stage 2: read the real article for each passing item and write a deep Thai summary
  const deepSummaries = new Map<string, string>();
  if (geminiKey && ranked) {
    let n = 0;
    for (const item of items.filter(passes)) {
      const content = await fetchArticleText(item.link);
      if (!content) {
        console.log(`[article] no content (${item.source}): ${item.title.slice(0, 50)}`);
        continue;
      }
      if (n++ > 0) await new Promise((r) => setTimeout(r, 2000));
      const summary = await summarizeArticle(item, content, geminiKey);
      if (summary) deepSummaries.set(item.hash, summary);
      console.log(`[article] summarized (${content.length} chars): ${item.title.slice(0, 50)}`);
    }
  }

  for (const item of items) {
    try {
      const r = ranked?.[item.hash];
      if (aiVetted && !passes(item)) {
        console.log(`[skip] (${r?.score ?? "?"}/10) ${item.title.slice(0, 60)}`);
        if (!dryRun) store.markSent(item.hash);
        continue;
      }
      const summary =
        deepSummaries.get(item.hash) ?? (r && r.summary ? r.summary : null);
      const msg = formatMessage(item, summary, { direction: r?.direction, why: r?.why });
      if (dryRun || !tgToken || !chatId) {
        console.log(`---- (dry-run${r ? ` score=${r.score}/10` : " no-ai"}) ----\n${msg}\n`);
        continue; // dry-run never touches the dedup DB
      }
      const messageId = await sendTelegram(tgToken, chatId, msg);
      store.trackMessage(item.hash, messageId);
      console.log(
        `[sent]${r ? ` (${r.score}/10)` : ""}${deepSummaries.has(item.hash) ? " [deep]" : ""} ${item.source}: ${item.title.slice(0, 60)}`
      );
      store.markSent(item.hash);
    } catch (err) {
      console.error("[cycle] item failed:", err);
      // poison-pill guard: sendTelegram already retried x3; without this a
      // permanently unsendable item would burn AI quota every cycle forever
      if (!dryRun) {
        console.warn(`[poison] marking ${item.hash} seen to stop the retry loop`);
        store.markSent(item.hash);
      }
    }
  }
  console.log(`[cycle] done, total processed ever: ${store.count()}`);
}

const config = loadConfig();
const intervalMs = config.interval_minutes * 60_000;

if (dryRun || once) {
  await runCycle();
} else {
  let running = false;
  console.log(`gold-news-bot started, every ${config.interval_minutes} min`);
  const launch = (): void => {
    if (running) return console.warn("[cycle] previous cycle still running — skipped");
    running = true;
    runCycle().finally(() => {
      running = false;
    });
  };
  launch();
  setInterval(launch, intervalMs);
}
