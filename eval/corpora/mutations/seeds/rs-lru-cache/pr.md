# LRU eviction, cache stats and a capacity ceiling

`insert` now evicts the front entry of the vector when the cache is full, and `get` moves the entry it reads to the back, so the front is always the least recently used entry. A new `Stats` struct counts hits, misses and evictions and is returned by `Cache::stats()`. `Cache::new` clamps the requested capacity to `MAX_CAPACITY` (10000). Unit tests cover eviction order, recency on `get`, the counters and the clamp.
