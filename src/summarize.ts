import type { NewsItem } from "./fetcher.js";

const API = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent";

export async function summarizeThai(item: NewsItem, apiKey: string): Promise<string | null> {
  const body = {
    contents: [
      {
        parts: [
          {
            text:
              `You are a Thai financial news editor. Summarize this gold-market news headline into concise Thai (2-3 short lines).\n` +
              `Keep all numbers exact (prices, percentages, dates). No preamble, no markdown, output only the Thai summary.\n\n` +
              `Source: ${item.source}\nHeadline: ${item.title}`,
          },
        ],
      },
    ],
    generationConfig: { temperature: 0.2, maxOutputTokens: 200 },
  };

  try {
    const res = await fetch(`${API}?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) {
      console.error(`[summarize] HTTP ${res.status}: ${await res.text()}`);
      return null;
    }
    const json = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("").trim();
    return text || null;
  } catch (err) {
    console.error("[summarize] failed:", err);
    return null;
  }
}
