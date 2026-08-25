import { describe, it, expect } from "vitest";
import { KVState, type KVLike } from "../worker/kvstore.js";

function memoryKV(): KVLike & { store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    async get(k) {
      return store.get(k) ?? null;
    },
    async put(k, v) {
      store.set(k, v);
    },
    async delete(k) {
      store.delete(k);
    },
  };
}

describe("KVState", () => {
  it("round-trips seen + messages through flush/load", async () => {
    const kv = memoryKV();
    const s1 = await KVState.load(kv);
    s1.markSent("abc");
    s1.trackMessage("abc", 101);
    await s1.flush();

    const s2 = await KVState.load(kv);
    expect(s2.seen("abc")).toBe(true);
    expect(s2.expiredMessages(0)).toEqual([101]);
  });

  it("dirty-write: flush with no changes writes nothing", async () => {
    const kv = memoryKV();
    const s = await KVState.load(kv);
    await s.flush();
    expect(kv.store.size).toBe(0);
  });

  it("expiredMessages honors the hour window; forgetMessage removes", async () => {
    const kv = memoryKV();
    const now = Date.now();
    const s = await KVState.load(kv);
    s.trackMessage("h1", 1, now - 25 * 3_600_000);
    s.trackMessage("h2", 2, now - 1 * 3_600_000);
    expect(s.expiredMessages(24)).toEqual([1]);
    s.forgetMessage(1);
    expect(s.expiredMessages(24)).toEqual([]);
  });

  it("persists preferred AI model across load/flush (429 churn fix)", async () => {
    const kv = memoryKV();
    const s1 = await KVState.load(kv);
    expect(s1.preferredModel).toBeNull(); // cold start: no preference
    s1.setPreferredModel("gemini-3.5-flash");
    await s1.flush();

    const s2 = await KVState.load(kv);
    expect(s2.preferredModel).toBe("gemini-3.5-flash");

    // clearing writes the removal through
    s2.setPreferredModel(null);
    await s2.flush();
    const s3 = await KVState.load(kv);
    expect(s3.preferredModel).toBeNull();
  });

  it("tracks last purge pass across load/flush (stalled-worker visibility)", async () => {
    const kv = memoryKV();
    const s1 = await KVState.load(kv);
    expect(s1.lastPurgeAt).toBe(0); // cold start: never purged
    s1.markPurge();
    await s1.flush();

    const s2 = await KVState.load(kv);
    expect(s2.lastPurgeAt).toBeGreaterThan(0);

    // a second pass overwrites the stamp
    s2.markPurge();
    await s2.flush();
    const s3 = await KVState.load(kv);
    expect(s3.lastPurgeAt).toBeGreaterThanOrEqual(s2.lastPurgeAt);
  });
});
