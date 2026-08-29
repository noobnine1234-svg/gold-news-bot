import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DedupStore } from "../src/dedup.js";

describe("DedupStore", () => {
  let path: string;
  beforeEach(() => {
    path = join(mkdtempSync(join(tmpdir(), "gnb-")), "seen.sqlite");
  });

  it("starts empty and unseen", () => {
    const s = new DedupStore(path);
    expect(s.count()).toBe(0);
    expect(s.seen("abc")).toBe(false);
  });

  it("marks and sees", () => {
    const s = new DedupStore(path);
    s.markSent("abc");
    expect(s.seen("abc")).toBe(true);
    expect(s.count()).toBe(1);
  });

  it("persists across reopen", () => {
    new DedupStore(path).markSent("xyz");
    const reopened = new DedupStore(path);
    expect(reopened.seen("xyz")).toBe(true);
  });

  it("ignores duplicate marks", () => {
    const s = new DedupStore(path);
    s.markSent("q");
    s.markSent("q");
    expect(s.count()).toBe(1);
  });

  it("tracks and expires messages", () => {
    const s = new DedupStore(path);
    const now = Date.now();
    s.trackMessage("h1", 101, now - 25 * 3_600_000); // 25h old
    s.trackMessage("h2", 102, now - 1 * 3_600_000); // 1h old

    expect(s.expiredMessages(24)).toEqual([101]);

    s.forgetMessage(101);
    expect(s.expiredMessages(24)).toEqual([]);
    expect(s.expiredMessages(0).sort()).toEqual([102]);
  });

  it("logs and retains ai_rank_log with 30d cutoff", () => {
    const s = new DedupStore(path);
    s.logRank({ model: "gemini-3.1-flash-lite", threshold: 6, inputCount: 10, outputCount: 8, latencyMs: 1200, error: null, rawTruncated: "ok" });
    s.logRank({ cycleAt: Date.now() - 31 * 24 * 3600_000, model: "old", threshold: 6, inputCount: 5, outputCount: 5, latencyMs: 500, error: null });
    const logs = s.recentRankLogs(10);
    expect(logs.length).toBe(1);
    expect(logs[0].model).toBe("gemini-3.1-flash-lite");
    expect(logs[0].input_count).toBe(10);
  });

  it("caps rawTruncated at 2000 chars", () => {
    const s = new DedupStore(path);
    s.logRank({ model: "m", threshold: 6, inputCount: 1, outputCount: 1, latencyMs: 10, rawTruncated: "x".repeat(5000) });
    expect(s.recentRankLogs(1)[0].model).toBe("m");
  });
});
