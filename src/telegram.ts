import type { NewsItem } from "./fetcher.js";

export function formatMessage(item: NewsItem, summary: string | null): string {
  const flag = item.lang === "th" ? "🇹🇭" : "🌍";
  const lines = [
    `🟡 <b>${escapeHtml(item.title)}</b>`,
    `${flag} <i>${escapeHtml(item.source)}</i>${item.pubDate ? ` · ${formatDate(item.pubDate)}` : ""}`,
  ];
  if (summary) lines.push("", escapeHtml(summary));
  else if (item.lang === "en") lines.push("", "<i>(สรุปอัตโนมัติไม่สำเร็จ — อ่านต้นทาง)</i>");
  lines.push("", `🔗 ${escapeHtml(item.link)}`);
  return lines.join("\n");
}

export async function sendTelegram(token: string, chatId: string, text: string): Promise<number> {
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  let lastErr = "";
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
        signal: AbortSignal.timeout(15000),
      });
      if (res.ok) {
        const json = (await res.json()) as { result?: { message_id?: number } };
        const id = json.result?.message_id;
        if (!id) lastErr = "ok response without message_id — refusing to create untracked message";
        else return id;
      } else {
        lastErr = `HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`;
      }
    } catch (err) {
      lastErr = String(err);
    }
    if (attempt < 3) await sleep(attempt * 2000);
  }
  throw new Error(`telegram send failed after 3 attempts: ${lastErr}`);
}

export async function deleteMessage(
  token: string,
  chatId: string,
  messageId: number
): Promise<boolean> {
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/deleteMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, message_id: messageId }),
      signal: AbortSignal.timeout(15000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function formatDate(d: Date): string {
  return new Intl.DateTimeFormat("th-TH", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Bangkok",
  }).format(d);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
