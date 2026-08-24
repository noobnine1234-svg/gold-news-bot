import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export class DedupStore {
  private db: DatabaseSync;

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec("CREATE TABLE IF NOT EXISTS sent (hash TEXT PRIMARY KEY, sent_at INTEGER)");
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
}
