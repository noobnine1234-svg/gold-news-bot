# Gold News Telegram Bot — Design

Date: 2026-08-24 · Status: implemented · Rev 2 (updated to match shipped code)

## Goal

Real-time gold-market news from multiple trusted sources (Thai + English),
AI-quality-filtered before sending, summarized in Thai from real article
content, pushed to Telegram with auto-delete to keep the chat clean.
Zero running cost.

## Decisions (user-approved)

- Channel: **Telegram bot**
- Sources: **mixed Thai + English** — direct RSS + Google News RSS queries
- Delivery: **real-time alerts** (poll every interval_minutes)
- Curation: **2-stage AI pipeline**:
  1. batch-score all candidate headlines in one Gemini call per cycle;
     only items scoring >= `quality_threshold` proceed
     (hashes the model omits are treated as unvetted and never sent)
  2. for each passing item, fetch the real article body (~3.5k chars) and
     write a deep Thai prose summary; falls back to the stage-1 headline
     summary or raw headline when content is unavailable
- Hygiene: **auto-delete** messages older than `delete_after_hours`

## Architecture

```
cycle (every interval_minutes)
├── telegram purge    delete messages older than delete_after_hours
├── fetcher.ts        parallel RSS -> NewsItem {hash,url,title,source,lang,date}
├── filter.ts         cheap relevance gate (strong kw OR >=2 weak kw)
├── dedup.ts          node:sqlite `sent(hash)` + `messages(message_id)` tables
├── rank.ts           stage 1: one batch call scores+short-summarizes headlines
│                     model fallback chain on 429/404/503/empty/unparseable
├── article.ts        stage 2: fetch article HTML -> text (script/style stripped,
│                     <article> preferred); Google News wrapper links yield null
├── rank.ts           stage 2: summarizeArticle() deep Thai prose per passing item
└── telegram.ts       send (HTML parse_mode, escaped variables), returns message_id
                      or throws; deleteMessage best-effort
```

Entry `index.ts`: `--dry-run` prints to console and never writes the dedup DB;
`--once` runs a single cycle then exits (used by systemd).

## Sources (verified live 2026-08-24)

- FXStreet, MarketWatch, Investing.com gold (EN direct — full article bodies)
- Thairath Money, Brand Inside (TH direct — full article bodies)
- Google News RSS EN (`gold price OR XAUUSD`) + TH (`ทองคำ ราคาทอง`) as
  discovery layers; their wrapper links resolve to headline-only summaries

## AI models

Fallback chain: gemini-3.6-flash → 3.7-flash → 3.5-flash → 3.1-flash-lite
(3.6 hit free-tier RPD first; chain remembers last working model).
Thinking budget pinned to 0 so output tokens go to text.

## Error handling

- feed fail → log, continue other feeds (Promise.allSettled)
- AI unavailable at any stage → stage-1 fallback sends headlines unfiltered;
  a news item is never lost because of AI, worst case it arrives uncategorized
- Telegram send without message_id → treated as failure (retry ×3 backoff),
  so auto-delete never loses track of a sent message
- item send failure (after retry ×3) → poison-pill: hash IS marked sent so a
  permanently unsendable item can't burn AI quota every cycle forever
- all outbound HTTP (feeds + articles) goes through one SSRF-guarded fetch:
  DNS resolves inside the connect step, only public addresses reach the socket
  (IPv4-mapped IPv6 normalized), redirects manual ≤3 hops — no TOCTOU window
- GitHub Actions dedup cache saves on SUCCESS only: a failed run must never
  publish its state; cost is a possible single duplicate after a failed cycle

## Testing

vitest 31 tests: filter logic, dedup + message expiry, message format +
HTML escaping, hash determinism, ranking JSON parser (fences/bad fields/
omitted hashes), isPassing gate (omitted hash never passes).

## Deployment

systemd user service (`--once`) + timer every 5 min, linger enabled.
Secrets in `.env` only (TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, GEMINI_API_KEY).
