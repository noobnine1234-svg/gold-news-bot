// Shared streaming utility to read a Response body with a byte cap.
// Used by both extract.ts (article fetch) and fetcher.ts (feed fetch)
// to prevent OOM from huge or hostile responses.

export async function readCappedStream(
  res: Response,
  maxBytes: number
): Promise<string | null> {
  if (!res.body) return null;
  const declared = Number(res.headers.get("content-length") ?? 0);
  if (declared > maxBytes) {
    try {
      res.body.cancel();
    } catch {
      /* ignore */
    }
    return null;
  }
  const reader = (res.body as ReadableStream<Uint8Array>).getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let text = "";
  try {
    for (;;) {
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await reader.read();
      } catch {
        try { await reader.cancel(); } catch {}
        return null;
      }
      const { done, value } = chunk;
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        try { await reader.cancel(); } catch {}
        return null;
      }
      text += decoder.decode(value, { stream: true });
    }
  } catch {
    try { await reader.cancel(); } catch {}
    return null;
  }
  try {
    text += decoder.decode();
  } catch {
    return null;
  }
  return text;
}
