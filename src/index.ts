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
import { getGoldContext } from "./price.js";

function isQuarantineEligible(item: NewsItem, keywords: typeof KEYWORDS): boolean {
  // balanced fallback: only trusted + strong keyword + recent <6h may pass when AI is down
  const strong = keywords.strong.some((k) => item.title.toLowerCase().includes(k.toLowerCase()));
  const ageOk = item.pubDate ? (Date.now() - item.pubDate.getTime()) < 6 * 3600_000 : false;
  return !!item.trusted && strong && ageOk;
}

function dedupByTitle(items: NewsItem[]): NewsItem[] {
  // Jaccard on token sets, threshold 0.82 — cheap semantic dedup without embedding
  const tokenize = (s: string) => new Set(s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").split(/\s+/).filter(Boolean));
  const jaccard = (a: Set<string>, b: Set<string>) => {
    let inter = 0;
    for (const x of a) if (b.has(x)) inter++;
    const union = a.size + b.size - inter;
    return union ? inter / union : 0;
  };
  const kept: NewsItem[] = [];
  for (const it of items) {
    const tok = tokenize(it.title);
    let dup = false;
    for (const k of kept) {
      if (jaccard(tok, tokenize(k.title)) > 0.82) { dup = true; break; }
    }
    if (!dup) kept.push(it);
  }
  const dropped = items.length - kept.length;
  if (dropped) console.log(`[dedup] dropped ${dropped} near-duplicate(s) by title`);
  return kept;
}

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

  // semantic dedup before reputation (cheap, saves fetches)
  items = dedupByTitle(items);

  // reputable-sources-only gate + link pinning — Tiered, with sample log
  const toVet = items.slice(0, 15);
  const vettedLocal = await Promise.allSettled(
    toVet.map(async (it) => ({ it, rep: await isReputableLink(it, !!it.trusted, guardedFetch) }))
  );
  const vetted: { it: NewsItem; rep: Awaited<ReturnType<typeof isReputableLink>> }[] = [];
  let droppedRep = 0;
  let dropSample: string | null = null;
  for (const r of vettedLocal) {
    if (r.status === "fulfilled") {
      vetted.push(r.value as any);
      if (!r.value.rep.ok) {
        droppedRep++;
        if (!dropSample) dropSample = `${r.value.it.source}: ${r.value.it.title.slice(0, 80)}`;
      }
    } else {
      droppedRep++;
    }
  }
  if (droppedRep) {
    console.log(`[reputation] dropped ${droppedRep} non-allowlisted source(s)`);
    if (dropSample) console.log(`[reputation:drop-sample] ${dropSample}`);
  }
  items = vetted
    .filter((v) => v.rep.ok)
    .map((v) => ({ ...v.it, link: v.rep.ok ? v.rep.url : v.it.link }));

  items = items.slice(0, config.max_items_per_cycle);

  console.log(`[cycle] ${items.length} candidate(s)`);

  if (!items.length) {
    console.log("[cycle] done");
    return;
  }

  // stage 1: one Gemini call scores the whole batch from headlines — with observability + gold spot context
  let priceContext: string | null = null;
  if (geminiKey) {
    try { priceContext = await getGoldContext(); if (priceContext) console.log(`[price] ${priceContext}`); } catch {}
  }
  let ranked: Awaited<ReturnType<typeof rankAndSummarize>> = null;
  if (geminiKey) {
    const t0 = Date.now();
    try {
      ranked = await rankAndSummarize(items, geminiKey, config.quality_threshold, priceContext);
      const ms = Date.now() - t0;
      // logRank is fail-safe; never break the cycle on DB error
      try {
        const { getActiveModel, getLastRaw } = await import("./rank.js");
        store.logRank({
          model: getActiveModel(),
          threshold: config.quality_threshold,
          inputCount: items.length,
          outputCount: ranked ? Object.keys(ranked).length : null,
          latencyMs: ms,
          error: ranked ? null : "all models failed or unparseable",
          rawTruncated: getLastRaw()?.slice(0, 2000) ?? null,
        });
      } catch {}
      console.log(`[rank] ${ranked ? Object.keys(ranked).length : 0}/${items.length} scored in ${ms}ms`);
    } catch (e) {
      const ms = Date.now() - t0;
      try {
        store.logRank({ model: null, threshold: config.quality_threshold, inputCount: items.length, outputCount: null, latencyMs: ms, error: String(e).slice(0, 300) });
      } catch {}
      console.warn("[rank] exception", e);
    }
  }
  if (geminiKey && !ranked) console.warn("[rank] AI ranking unavailable — quarantine mode (no send-all)");

  // aiVetted true only when we have a ranking; when ranked is null we are in quarantine
  const aiVetted = !!ranked;
  const passes = (it: NewsItem): boolean => {
    if (ranked) return isPassing(ranked, it.hash, config.quality_threshold);
    // quarantine: only trusted+strong+recent may pass, and they get a badge
    return isQuarantineEligible(it, KEYWORDS);
  };

  // stage 2: deep Thai summary + content re-score — budget-gated top 3, single batch call (saves N-1 quota)
  const deepSummaries = new Map<string, string>();
  const revisedScores = new Map<string, number>();
  if (geminiKey && ranked) {
    const passing = items.filter(passes).sort((a, b) => (ranked[b.hash]?.score ?? 0) - (ranked[a.hash]?.score ?? 0)).slice(0, 3);
    if (passing.length) {
      const fetched = await Promise.all(
        passing.map(async (it) => ({ it, content: await fetchArticleText(it.link) }))
      );
      const withContent = fetched.filter((x): x is { it: typeof x.it; content: string } => !!x.content);
      if (withContent.length === 0) {
        console.log("[article] no content for top passing items");
      } else {
        // batch path: one Gemini call for all deep summaries + revised scores
        const { summarizeArticlesBatch, summarizeArticle: summarizeOne } = await import("./rank.js");
        // adapt {it,content} -> {item,content} for batch API
        const batchInput = withContent.map(({ it, content }) => ({ item: it, content }));
        let batch: Map<string, import("./rank.js").BatchSummary> | null = null;
        try {
          batch = await summarizeArticlesBatch(batchInput, geminiKey, priceContext);
        } catch (e) {
          console.warn("[article] batch summarize failed, falling back to single", e);
        }
        if (batch && batch.size) {
          for (const [h, v] of batch) { deepSummaries.set(h, v.summary); if (v.revisedScore != null) revisedScores.set(h, v.revisedScore); }
          console.log(`[article] batch summarized ${batch.size}/${withContent.length} (saved ${withContent.length - 1} call(s))`);
          if (revisedScores.size) console.log(`[rescore] ${[...revisedScores.entries()].map(([h,s]) => h.slice(0,6)+":"+s).join(" ")}`);
          // fallback any missing (partial failure) via single-call path
          for (const { it, content } of withContent) {
            if (!deepSummaries.has(it.hash)) {
              const s = await summarizeOne(it, content, geminiKey);
              if (s) deepSummaries.set(it.hash, s);
            }
          }
        } else {
          // batch unparseable or empty -> sequential fallback (max 3 calls)
          console.warn("[article] batch empty/unparseable, sequential fallback");
          for (const { it, content } of withContent) {
            const s = await summarizeOne(it, content, geminiKey);
            if (s) deepSummaries.set(it.hash, s);
            console.log(`[article] summarized (${content.length} chars): ${it.title.slice(0, 50)}`);
          }
        }
      }
    }
  }

  let rescoreDropped = 0;
  for (const item of items) {
    try {
      const r = ranked?.[item.hash];
      // content re-score gate: if batch judged the full article weaker than threshold, drop it
      const rs = revisedScores.get(item.hash);
      if (rs != null && rs < config.quality_threshold) {
        console.log(`[skip:rescore] ${rs}/10 < ${config.quality_threshold} ${item.title.slice(0,60)}`);
        rescoreDropped++;
        if (!dryRun) store.markSent(item.hash);
        continue;
      }
      if (!passes(item)) {
        // in quarantine mode we still want to log why, but aiVetted distinguishes
        const reason = ranked ? `score ${r?.score ?? "?"}/10` : "quarantine";
        console.log(`[skip] (${reason}) ${item.title.slice(0, 60)}`);
        if (!dryRun) store.markSent(item.hash);
        continue;
      }
      const inQuarantine = !ranked && isQuarantineEligible(item, KEYWORDS);
      const summary =
        deepSummaries.get(item.hash) ?? (r && r.summary ? r.summary : null);
      const whyBadge = inQuarantine ? "⚠️ AI กรองไม่สำเร็จ — ส่งเพราะแหล่งเชื่อถือ+ตรงประเด็น" : r?.why;
      const msg = formatMessage(item, summary, { direction: r?.direction, why: whyBadge });
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
  if (rescoreDropped) console.log(`[rescore] dropped ${rescoreDropped} after content re-score`);
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
