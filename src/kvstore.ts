// Dedup + sent-message tracking. Originally backed by Workers KV; ported to a
// KVLike interface so the same tests run against an in-memory KV. State loads
// once, mutations land in memory, and a single write per key happens at flush()
// — but only when something actually changed (typical cycle: zero writes).

const SEEN_KEY = "seen_hashes_v1";
const MSG_KEY = "messages_v1";
const MODEL_KEY = "preferred_model_v1";
const PURGE_KEY = "last_purge_v1";

export type KVLike = {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
};

export class KVState {
  private _seen: Set<string>;
  private _messages: Map<number, { hash: string; sentAt: number }>;
  preferredModel: string | null;
  lastPurgeAt: number;
  private dirtySeen = false;
  private dirtyMsg = false;
  private dirtyModel = false;
  private dirtyPurge = false;

  private constructor(
    private kv: KVLike,
    seen: Set<string>,
    messages: Map<number, { hash: string; sentAt: number }>,
    preferredModel: string | null,
    lastPurgeAt: number
  ) {
    this._seen = seen;
    this._messages = messages;
    this.preferredModel = preferredModel;
    this.lastPurgeAt = lastPurgeAt;
  }

  static async load(kv: KVLike): Promise<KVState> {
    const [seenRaw, msgRaw, modelRaw, purgeRaw] = await Promise.all([
      kv.get(SEEN_KEY),
      kv.get(MSG_KEY),
      kv.get(MODEL_KEY),
      kv.get(PURGE_KEY),
    ]);
    const seen = new Set<string>(seenRaw ? (JSON.parse(seenRaw) as string[]) : []);
    const messages = new Map<number, { hash: string; sentAt: number }>(
      Object.entries(JSON.parse(msgRaw ?? "{}") as Record<string, { hash: string; sentAt: number }>).map(
        ([k, v]) => [Number(k), v]
      )
    );
    return new KVState(kv, seen, messages, modelRaw, purgeRaw ? Number(purgeRaw) : 0);
  }

  /** Remember the last Gemini model that worked so a fresh isolate skips 429'd models. */
  setPreferredModel(model: string | null): void {
    if (this.preferredModel !== model) {
      this.preferredModel = model;
      this.dirtyModel = true;
    }
  }

  /** Record that a purge pass ran, so a stalled worker is detectable from KV alone. */
  markPurge(): void {
    this.lastPurgeAt = Date.now();
    this.dirtyPurge = true;
  }

  seen(hash: string): boolean {
    return this._seen.has(hash);
  }

  markSent(hash: string): void {
    if (!this._seen.has(hash)) {
      this._seen.add(hash);
      this.dirtySeen = true;
    }
  }

  trackMessage(hash: string, messageId: number, sentAt: number = Date.now()): void {
    this._messages.set(messageId, { hash, sentAt });
    this.dirtyMsg = true;
  }

  expiredMessages(hours: number): number[] {
    const cutoff = Date.now() - hours * 3_600_000;
    return [...this._messages.entries()]
      .filter(([, v]) => v.sentAt <= cutoff)
      .map(([id]) => id);
  }

  forgetMessage(messageId: number): void {
    if (this._messages.delete(messageId)) this.dirtyMsg = true;
  }

  count(): number {
    return this._seen.size;
  }

  async flush(): Promise<void> {
    if (this.dirtySeen) await this.kv.put(SEEN_KEY, JSON.stringify([...this._seen]));
    if (this.dirtyMsg)
      await this.kv.put(MSG_KEY, JSON.stringify(Object.fromEntries(this._messages)));
    if (this.dirtyModel) {
      if (this.preferredModel) await this.kv.put(MODEL_KEY, this.preferredModel);
      else await this.kv.delete(MODEL_KEY);
    }
    if (this.dirtyPurge) await this.kv.put(PURGE_KEY, String(this.lastPurgeAt));
    this.dirtySeen = false;
    this.dirtyMsg = false;
    this.dirtyModel = false;
    this.dirtyPurge = false;
  }
}
