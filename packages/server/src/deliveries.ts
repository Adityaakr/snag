/** Delivery dedupe (BUILD_PROMPT 9.1, 10.2): each `X-GitHub-Delivery` id is processed once, blocking replays. */
export interface DeliveryStore {
  /** Records the id; false when it was already seen. */
  claim(id: string): Promise<boolean>;
}

/** In-memory store with a bounded size (the Postgres `deliveries` table replaces it in M8). */
export class MemoryDeliveryStore implements DeliveryStore {
  private readonly seen = new Map<string, number>();
  constructor(private readonly max = 50_000) {}

  async claim(id: string): Promise<boolean> {
    if (this.seen.has(id)) return false;
    this.seen.set(id, Date.now());
    if (this.seen.size > this.max) {
      const oldest = this.seen.keys().next().value;
      if (oldest !== undefined) this.seen.delete(oldest);
    }
    return true;
  }
}
