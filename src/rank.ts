import type { NewsItem } from "./fetcher.js";

const API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const MODEL_CHAIN = [
  "gemini-3.6-flash",
  "gemini-3.7-flash",
  "gemini-3.5-flash",
  "gemini-3.1-flash-lite",
];
let activeModel: string | null = null;

export type Ranked = { score: number; summary: string };

export async function rankAndSummarize(
  items: NewsItem[],
  apiKey: string,
  threshold: number
): Promise<Record<string, Ranked> | null> {
  const result = await withModelFallback(apiKey, (model) => callGemini(model, items, apiKey, threshold));
  return result;
}

type CallResult<T> = { ok: true; value: T } | { ok: false; error: string };

async function withModelFallback<T>(
  apiKey: string,
  call: (model: string) => Promise<CallResult<T>>
): Promise<T | null> {
  const order = activeModel
    ? [activeModel, ...MODEL_CHAIN.filter((m) => m !== activeModel)]
    : MODEL_CHAIN;
  let lastErr = "";
  for (const model of order) {
    const result = await call(model);
    if (result.ok) {
      activeModel = model;
      return result.value;
    }
    lastErr = result.error;
    console.warn(`[ai] ${model} unavailable: ${lastErr} — trying next`);
  }
  console.error(`[ai] all models failed (last: ${lastErr})`);
  return null;
}

export async function summarizeArticle(
  item: NewsItem,
  content: string,
  apiKey: string
): Promise<string | null> {
  const text = await withModelFallback(apiKey, async (model) => {
    try {
      const res = await fetch(`${API_BASE}/${model}:generateContent?key=${apiKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text:
                    `You are a Thai financial editor. Read this gold-market article and write a clear Thai summary ` +
                    `(3-5 short lines) for everyday investors: what happened, why it matters for gold, key numbers exact. ` +
                    `Plain Thai prose only — no markdown, no preamble.\n\n` +
                    `Source: ${item.source}\nHeadline: ${item.title}\n\nArticle content:\n${content}`,
                },
              ],
            },
          ],
          generationConfig: {
            temperature: 0.3,
            maxOutputTokens: 1200,
            thinkingConfig: { thinkingBudget: 0 },
          },
        }),
        signal: AbortSignal.timeout(45000),
      });
      if (!res.ok) return { ok: false as const, error: `HTTP ${res.status}` };
      const json = (await res.json()) as {
        candidates?: { content?: { parts?: { text?: string }[] } }[];
      };
      const out = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("").trim();
      if (!out) return { ok: false as const, error: "empty response" };
      return { ok: true as const, value: out };
    } catch (err) {
      return { ok: false as const, error: String(err).slice(0, 120) };
    }
  });
  return text;
}

async function callGemini(
  model: string,
  items: NewsItem[],
  apiKey: string,
  threshold: number
): Promise<{ ok: true; value: Record<string, Ranked> } | { ok: false; error: string }> {
  const body = {
    contents: [
      {
        parts: [
          {
            text:
              `You are the chief editor of a gold-market news desk serving Thai investors.\n` +
              `Below are ${items.length} headlines from trusted outlets. Evaluate them as a set:\n\n` +
              `1. Score each headline 0-10 for value to a gold investor:\n` +
              `   - 8-10: substantive and actionable (price moves with causes, Fed/central bank policy, ` +
              `geopolitics affecting gold, demand/supply shifts, serious analysis)\n` +
              `   - 4-7: mild context, generic recaps\n` +
              `   - 0-3: fluff, ads, clickbait, or DUPLICATES (near-identical story from another outlet — ` +
              `give duplicates a low score, keep only the single best-phrased version high)\n` +
              `2. For every item scoring >= ${threshold}, write a concise Thai summary (1-2 short lines) ` +
              `keeping every number exact. Otherwise use an empty string.\n\n` +
              `Respond ONLY with a JSON array covering ALL input hashes:\n` +
              `[{"hash":"...","score":N,"summary_th":"..."}]\n\n` +
              items.map((it, i) => `${i + 1}. hash=${it.hash} [${it.source}] ${it.title}`).join("\n"),
          },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: 4096,
      responseMimeType: "application/json",
      thinkingConfig: { thinkingBudget: 0 },
    },
  };

  try {
    const res = await fetch(`${API_BASE}/${model}:generateContent?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(45000),
    });
    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status}` };
    }
    const json = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("");
    if (!text) return { ok: false, error: "empty response" };
    const parsed = parseRanking(text);
    if (!parsed) return { ok: false, error: "unparseable response" };
    return { ok: true, value: parsed };
  } catch (err) {
    return { ok: false, error: String(err).slice(0, 120) };
  }
}

export function parseRanking(text: string): Record<string, Ranked> | null {
  try {
    const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
    const arr = JSON.parse(cleaned) as { hash?: string; score?: number; summary_th?: string }[];
    if (!Array.isArray(arr)) return null;
    const out: Record<string, Ranked> = {};
    for (const r of arr) {
      if (!r || typeof r.hash !== "string") continue;
      out[r.hash] = {
        score: typeof r.score === "number" ? r.score : 0,
        summary: typeof r.summary_th === "string" ? r.summary_th.trim() : "",
      };
    }
    return Object.keys(out).length ? out : null;
  } catch {
    return null;
  }
}
