<!-- issue: tinycache/tinycache#12 -->
# Make the cache least-recently-used

Once the cache fills up it silently ignores every new key, so hot entries that arrive late never get cached. We want real LRU behavior and some numbers to tune it with.

- [ ] When the cache is full, inserting a new key evicts the least recently used entry
- [ ] Reading an entry with `get` makes it the most recently used (for example with capacity 2: insert `a`, insert `b`, get `a`, insert `c` evicts `b`)
- [ ] `stats()` reports the number of hits, misses and evictions
- [ ] `Cache::new` clamps capacities above 10000 down to 10000
