import { describe, it, expect } from "vitest";
import { parseRanking } from "../src/rank.js";

describe("parseRanking", () => {
  it("parses plain JSON array", () => {
    const r = parseRanking('[{"hash":"a","score":8,"summary_th":"ทองขึ้น"},{"hash":"b","score":2,"summary_th":""}]');
    expect(r).not.toBeNull();
    expect(r!["a"]).toEqual({ score: 8, summary: "ทองขึ้น" });
    expect(r!["b"].score).toBe(2);
  });

  it("parses fenced json (```json ... ```)", () => {
    const r = parseRanking('```json\n[{"hash":"x","score":7,"summary_th":"ok"}]\n```');
    expect(r!["x"].score).toBe(7);
  });

  it("defaults bad score / missing summary fields", () => {
    const r = parseRanking('[{"hash":"q","score":"high"},{"hash":"w"}]');
    expect(r!["q"].score).toBe(0);
    expect(r!["q"].summary).toBe("");
    expect(r!["w"].score).toBe(0);
  });

  it("drops items without hash", () => {
    const r = parseRanking('[{"score":5},{"hash":"keep","score":9}]');
    expect(Object.keys(r!)).toEqual(["keep"]);
  });

  it("returns null on garbage", () => {
    expect(parseRanking("not json at all")).toBeNull();
    expect(parseRanking('{"hash":"a"}')).toBeNull();
  });

  it("returns null on empty array", () => {
    expect(parseRanking("[]")).toBeNull();
  });
});
