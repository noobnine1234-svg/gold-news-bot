# Gold News Telegram Bot — Design

Date: 2026-08-24 · Status: implemented

## Goal

Real-time gold-market news from multiple trusted sources (Thai + English),
summarized in Thai, pushed to Telegram. Zero running cost.

## Decisions (user-approved)

- Channel: **Telegram bot**
- Sources: **mixed Thai + English** via direct RSS + Google News RSS queries
- Delivery: **real-time alerts** (poll every 5 min)
- Content: **Thai summary (2-3 lines, Gemini 2.0 Flash) + source link**

## Architecture

```
cycle (every interval_minutes from config.yaml)
├── fetcher.ts   fetch all feeds parallel → NewsItem {hash,url,title,source,lang,date}
├── filter.ts    relevance: strong kw (gold/xau/ทองคำ/ราคาทอง...) OR ≥2 weak kw
│                (fed/rate cut/dollar/war/สงคราม...)
├── dedup.ts     node:sqlite table `sent(hash PK)` — never resend
├── summarize.ts Gemini REST gemini-2.0-flash, temp 0.2, exact numbers preserved
└── telegram.ts  sendMessage MarkdownV1-style, escape title, retry ×3 backoff
```

Entry `index.ts`: dry-run mode (`--dry-run`) prints to console; loop mode uses setInterval.

## Sources (verified live 2026-08-24)

- FXStreet `https://www.fxstreet.com/rss/news` (Kitco public RSS is dead — 404)
- MarketWatch `https://feeds.content.dowjones.io/public/rss/mw_topstories`
- Investing.com gold `https://www.investing.com/rss/news_11.rss`
- Google News RSS EN: `q=gold+price+OR+XAUUSD+when:1d`
- Google News RSS TH: `q=ทองคำ+ราคาทอง+when:1d`

## Error handling

- feed fail → log, continue other feeds
- Gemini fail / no key → fallback raw headline + link
- Telegram fail → 3 retries with backoff, then log and keep item unsent (hash not marked)

## Testing

vitest: filter logic (strong/weak/unrelated), dedup persistence/reopen,
message format + markdown escaping, hash determinism — 12 tests.
Smoke: live dry-run cycle fetched 5/5 feeds, 10 relevant TH+EN items.

## Deployment

systemd user service (oneshot) + timer every 5 min on this machine.
Secrets in `.env` only (TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, GEMINI_API_KEY).
