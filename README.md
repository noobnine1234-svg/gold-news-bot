# gold-news-bot

ดึงข่าวทองคำจากแหล่งน่าเชื่อถือหลายสำนัก (EN+TH) กรองด้วย keyword ตัดข่าวซ้ำ
สรุปเป็นไทยด้วย Gemini Flash แล้ว push เข้า Telegram แบบ real-time (ทุก 5 นาที)

## Stack

Node.js 24 + TypeScript · rss-parser · node:sqlite (dedup) · Gemini REST · Telegram REST

## Feeds

| แหล่ง | ประเภท |
|---|---|
| FXStreet, MarketWatch, Investing.com | EN ตรง |
| Google News RSS `gold price` / `ราคาทอง` | รวมหลายสำนัก EN + TH |

Kitco ปิด RSS สาธารณะแล้ว (404) — ใช้ FXStreet แทน

ข่าว **EN** สรุปไทยด้วย `gemini-3.6-flash` (pacing 5 วิ/call กันชน free-tier 20 req/min)
ข่าว **TH** ส่ง headline ตรง ไม่เสียโควตา Gemini

## Setup

```bash
npm install
cp .env.example .env
```

1. **Telegram token** — คุยกับ [@BotFather](https://t.me/BotFather) → `/newbot` → เอา token ใส่ `.env`
2. **chat_id** — กด `/start` ที่ bot ของคุณแล้วรัน:
   ```bash
   npx tsx scripts/get-chat-id.ts
   ```
3. **Gemini key** — [aistudio.google.com/apikey](https://aistudio.google.com/apikey) (ฟรี) ใส่ `.env`

## Run

```bash
npm run once    # dry-run: fetch+filter พิมพ์ออก console ไม่ส่ง Telegram
npm start       # รัน loop จริง ทุก interval_minutes (config.yaml)
```

### Deploy: Cloudflare Workers (production)

Bot รันบน Cloudflare Workers — cron ทุก 5 นาที, เครื่องปิดได้, state บน KV

```bash
cd worker
npx wrangler login                      # ครั้งแรก (browser authorize)
npx wrangler kv namespace create STATE  # เอา id ใส่ wrangler.toml
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put TELEGRAM_CHAT_ID
npx wrangler secret put GEMINI_API_KEY
npx wrangler deploy
curl https://gold-news-bot.<subdomain>.workers.dev/   # trigger cycle ทันที
```

หมายเหตุ: Google News RSS block CF egress IPs (503) → aggregator ใช้ Bing News TH;
ข่าว EN วิ่งผ่าน direct feeds (FXStreet/MarketWatch/Investing)

### Deploy สำรอง: GitHub Actions / systemd (optional)

### Deploy สำรอง: systemd ในเครื่อง (optional)

```bash
mkdir -p ~/.config/systemd/user
cp deploy/gold-news.service deploy/gold-news.timer ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now gold-news.timer
loginctl enable-linger   # ให้รันต่อหลัง logout
```

## Features

- **AI คัดกรองก่อนส่ง** — 1 cycle = 1 Gemini call: ให้คะแนนทุก headline 0-10
  (ตัดข่าวซ้ำ/โฆษณา/fluff เชิงเปรียบเทียบทั้งชุด) ส่งเฉพาะ `quality_threshold` ขึ้นไป พร้อมสรุปไทยใน call เดียว
- **Model fallback chain** — 3.6-flash → 3.7-flash → 3.5-flash → 3.1-flash-lite (สลับอัตโนมัติเมื่อ quota/model ล่ม, AI ล่ม = fallback ส่ง raw ไม่มีข่าวหาย)
- **Auto-delete** — ลบข้อความเก่ากว่า `delete_after_hours` (default 24 ชม.) กันห้องแชทรก

## Config

แก้ `config.yaml` — feeds, keywords, interval_minutes, max_items_per_cycle,
`quality_threshold` (0-10, default 6), `delete_after_hours` (0 = ปิดการลบ)
Secrets อยู่ `.env` เท่านั้น

## Test

```bash
npm test        # vitest unit tests
npm tsc --noEmit 2>/dev/null || npx tsc --noEmit
```

## Error behavior

- feed ล่ม → log แดง + ข้าม (feed อื่นไม่กระทบ)
- Gemini fail/quota → ส่ง headline+ลิงก์ดิบแทน
- Telegram fail → retry 3 ครั้ง backoff
