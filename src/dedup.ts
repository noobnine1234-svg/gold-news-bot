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
}
