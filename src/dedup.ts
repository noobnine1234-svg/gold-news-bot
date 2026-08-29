import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export class DedupStore {
  private db: DatabaseSync;

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec("CREATE TABLE IF NOT EXISTS sent (hash TEXT PRIMARY KEY, sent_at INTEGER)");
    this.db.exec(
      "CREATE TABLE IF NOT EXISTS messages (message_id INTEGER PRIMARY KEY, hash TEXT, sent_at INTEGER)"
    );
    this.db.exec(
      "CREATE TABLE IF NOT EXISTS ai_rank_log (id INTEGER PRIMARY KEY AUTOINCREMENT, cycle_at INTEGER, model TEXT, threshold INTEGER, input_count INTEGER, output_count INTEGER, latency_ms INTEGER, error TEXT, raw_truncated TEXT)"
    );
  }

  seen(hash: string): boolean {
    return this.db.prepare("SELECT 1 FROM sent WHERE hash = ?").get(hash) !== undefined;
  }

  markSent(hash: string): void {
    this.db.prepare("INSERT OR IGNORE INTO sent (hash, sent_at) VALUES (?, ?)").run(hash, Date.now());
  }

  count(): number {
    return (this.db.prepare("SELECT COUNT(*) AS c FROM sent").get() as { c: number }).c;
  }

  trackMessage(hash: string, messageId: number, sentAt: number = Date.now()): void {
    this.db
      .prepare("INSERT OR REPLACE INTO messages (message_id, hash, sent_at) VALUES (?, ?, ?)")
      .run(messageId, hash, sentAt);
  }

  expiredMessages(hours: number): number[] {
    const cutoff = Date.now() - hours * 3_600_000;
    return this.db
      .prepare("SELECT message_id FROM messages WHERE sent_at <= ?")
      .all(cutoff)
      .map((r) => (r as { message_id: number }).message_id);
  }

  forgetMessage(messageId: number): void {
    this.db.prepare("DELETE FROM messages WHERE message_id = ?").run(messageId);
  }

  logRank(entry: {
    cycleAt?: number;
    model: string | null;
    threshold: number;
    inputCount: number;
    outputCount: number | null;
    latencyMs: number;
    error?: string | null;
    rawTruncated?: string | null;
  }): void {
    try {
      this.db
        .prepare(
          "INSERT INTO ai_rank_log (cycle_at, model, threshold, input_count, output_count, latency_ms, error, raw_truncated) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
        )
        .run(
          entry.cycleAt ?? Date.now(),
          entry.model,
          entry.threshold,
          entry.inputCount,
          entry.outputCount,
          entry.latencyMs,
          entry.error ?? null,
          entry.rawTruncated ? entry.rawTruncated.slice(0, 2000) : null
        );
      // retention: keep last 30 days (cheap, runs per log)
      const cutoff = Date.now() - 30 * 24 * 3600_000;
      this.db.prepare("DELETE FROM ai_rank_log WHERE cycle_at < ?").run(cutoff);
    } catch {}
  }

  recentRankLogs(limit = 10): Array<{
    cycle_at: number;
    model: string | null;
    threshold: number;
    input_count: number;
    output_count: number | null;
    latency_ms: number;
    error: string | null;
  }> {
    return this.db
      .prepare("SELECT cycle_at, model, threshold, input_count, output_count, latency_ms, error FROM ai_rank_log ORDER BY cycle_at DESC LIMIT ?")
      .all(limit) as any;
  }
}
