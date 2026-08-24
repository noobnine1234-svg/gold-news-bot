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
});
