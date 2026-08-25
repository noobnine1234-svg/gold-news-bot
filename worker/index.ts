/// <reference types="@cloudflare/workers-types" />
import { KEYWORDS, FEEDS } from "../src/sources.js";
import type { NewsItem } from "../src/types.js";
import { isGoldRelevant } from "../src/filter.js";
import { rankAndSummarize, summarizeArticle, isPassing, setPreferredModel, activeModelAfterCycle } from "../src/rank.js";
import { fetchArticleText } from "./article.js";
import { fetchFeed } from "./rss.js";
import { guardedFetch } from "./http.js";
import { KVState } from "./kvstore.js";
import { isReputableLink } from "../src/reputation.js";
import { formatMessage, sendTelegram, deleteMessage } from "../src/telegram.js";

export interface Env {
  STATE: KVNamespace;
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_CHAT_ID: string;
  GEMINI_API_KEY: string;
}

// Balance knobs: quality over quantity, and a hard cap on the expensive
// stage-2 deep summaries (the main Gemini token consumer).
const QUALITY_THRESHOLD = 7;
const MAX_ITEMS_PER_CYCLE = 5;
const MAX_DEEP_PER_CYCLE = 2;
const DELETE_AFTER_HOURS = 12;

// Bump on every deploy so a live [build] marker tells us exactly which commit
// is running — without it a stale worker is invisible in the logs.
const BUILD = "feat/visibility-and-purge-1";

export default {
  async scheduled(
    _controller: ScheduledController,
    env: Env,
    ctx: ExecutionContext
  ): Promise<void> {
    ctx.waitUntil(runCycle(env));
  },

  // manual trigger for testing: curl the worker URL
  async fetch(_req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    await runCycle(env);
    return new Response("cycle done\n", { status: 200 });
  },
};

async function runCycle(env: Env): Promise<void> {
  const store = await KVState.load(env.STATE);
  setPreferredModel(store.preferredModel); // skip 429'd models after isolate reset
  const { TELEGRAM_BOT_TOKEN: tgToken, TELEGRAM_CHAT_ID: chatId, GEMINI_API_KEY: geminiKey } = env;

  if (DELETE_AFTER_HOURS > 0 && tgToken && chatId) {
    const expired = store.expiredMessages(DELETE_AFTER_HOURS);
    for (const id of expired) {
      const ok = await deleteMessage(tgToken, chatId, id);
      if (!ok) console.log(`[purge] message ${id} already gone or too old — forgotten`);
      store.forgetMessage(id);
    }
    if (expired.length) console.log(`[purge] deleted ${expired.length} message(s) older than ${DELETE_AFTER_HOURS}h`);
    // Always stamp the purge pass so a stalled worker (cron skipped) is visible
    // from KV alone — even when nothing was old enough to delete.
    store.markPurge();
  }

  console.log(`[cycle] fetching ${FEEDS.length} feeds...`);
  console.log(`[build] ${BUILD}`);
  const results = await Promise.allSettled(
    FEEDS.map(async (f) => ({ feed: f, items: await fetchFeed(f) }))
  );
  for (const r of results)
    if (r.status === "rejected") console.error("[fetch] failed:", String(r.reason).slice(0, 120));

  const perFeed = results.map((r, i) =>
    r.status === "fulfilled"
      ? `${FEEDS[i].name}:${r.value.items.length}`
      : `${FEEDS[i].name}:ERR`
  );
  console.log(`[feeds] ${perFeed.join(" | ")}`);

  let items: NewsItem[] = results.flatMap((r) =>
    r.status === "fulfilled" ? r.value.items : []
  );

  items = items.filter((it) => isGoldRelevant(it, KEYWORDS));
  items = items.filter((it) => !store.seen(it.hash));
  items.sort((a, b) => (b.pubDate?.getTime() ?? 0) - (a.pubDate?.getTime() ?? 0));

  // reputable-sources-only: resolve wrapped aggregator links, drop the rest
  const vetted = await Promise.all(
    items.slice(0, 15).map(async (it) => ({
      it,
      ok: await isReputableLink(it, !!it.trusted, guardedFetch),
    }))
  );
  const droppedRep = vetted.filter((v) => !v.ok).length;
  if (droppedRep) console.log(`[reputation] dropped ${droppedRep} non-allowlisted source(s)`);
  items = vetted.filter((v) => v.ok).map((v) => v.it);

  items = items.slice(0, MAX_ITEMS_PER_CYCLE);

  console.log(`[cycle] ${items.length} candidate(s)`);
  if (!items.length) {
    await store.flush();
    console.log("[cycle] done");
    return;
  }

  const ranked = geminiKey
    ? await rankAndSummarize(items, geminiKey, QUALITY_THRESHOLD)
    : null;
  if (geminiKey && !ranked) console.warn("[rank] AI ranking unavailable — falling back to send-all");

  // persist the model that actually served this cycle so the next isolate
  // starts warm instead of burning 3 calls re-learning which models are 429'd
  const served = activeModelAfterCycle();
  if (served && ranked) store.setPreferredModel(served);
  else if (!ranked) store.setPreferredModel(null);

  const aiVetted = !!ranked;
  const passes = (it: NewsItem): boolean => isPassing(ranked, it.hash, QUALITY_THRESHOLD);

  const deepSummaries = new Map<string, string>();
  if (geminiKey && ranked) {
    let n = 0;
    for (const item of items.filter(passes)) {
      if (n >= MAX_DEEP_PER_CYCLE) break; // rest fall back to stage-1 summary
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
        store.markSent(item.hash);
        continue;
      }
      const summary = deepSummaries.get(item.hash) ?? (r && r.summary ? r.summary : null);
      const msg = formatMessage(item, summary, { direction: r?.direction, why: r?.why });
      const messageId = await sendTelegram(tgToken, chatId, msg);
      store.trackMessage(item.hash, messageId);
      store.markSent(item.hash);
      console.log(
        `[sent]${r ? ` (${r.score}/10)` : ""}${deepSummaries.has(item.hash) ? " [deep]" : ""} ${item.source}: ${item.title.slice(0, 60)}`
      );
    } catch (err) {
      console.error("[cycle] item failed:", err);
      console.warn(`[poison] marking ${item.hash} seen to stop the retry loop`);
      store.markSent(item.hash);
    }
  }

  await store.flush();
  console.log(`[cycle] done, total processed ever: ${store.count()}`);
}
