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

### Deploy systemd (user)

```bash
mkdir -p ~/.config/systemd/user
cp deploy/gold-news.service deploy/gold-news.timer ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now gold-news.timer
loginctl enable-linger   # ให้รันต่อหลัง logout
```

## Config

แก้ `config.yaml` — feeds, keywords, interval_minutes, max_items_per_cycle
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
