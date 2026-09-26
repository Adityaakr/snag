/** Okapi BM25 (BUILD_PROMPT 6.5 step 2: k1 = 1.2, b = 0.75). */
export class Bm25 {
  private readonly df = new Map<string, number>();
  private readonly tf: Map<string, number>[] = [];
  private readonly lengths: number[] = [];
  private readonly avg: number;

  constructor(
    docs: readonly string[][],
    readonly k1 = 1.2,
    readonly b = 0.75,
  ) {
    for (const doc of docs) {
      const counts = new Map<string, number>();
      for (const t of doc) counts.set(t, (counts.get(t) ?? 0) + 1);
      this.tf.push(counts);
      this.lengths.push(doc.length);
      for (const t of counts.keys()) this.df.set(t, (this.df.get(t) ?? 0) + 1);
    }
    this.avg = this.lengths.reduce((a, b) => a + b, 0) / Math.max(1, docs.length);
  }

  get size(): number {
    return this.tf.length;
  }

  /** Score of document i for a query (duplicate query terms count once). */
  score(query: readonly string[], i: number): number {
    const counts = this.tf[i];
    if (!counts) return 0;
    const n = this.tf.length;
    const len = this.lengths[i] ?? 0;
    let s = 0;
    for (const term of new Set(query)) {
      const f = counts.get(term);
      if (!f) continue;
      const df = this.df.get(term) ?? 0;
      const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5));
      s += (idf * (f * (this.k1 + 1))) / (f + this.k1 * (1 - this.b + (this.b * len) / (this.avg || 1)));
    }
    return s;
  }
}
