use crate::config::DEFAULT_CAPACITY;

const MAX_CAPACITY: usize = 10_000;

#[derive(Debug, Default, Clone, Copy, PartialEq)]
pub struct Stats {
    pub hits: u64,
    pub misses: u64,
    pub evictions: u64,
}

fn clamp_capacity(requested: usize) -> usize {
    requested.min(MAX_CAPACITY)
}

/// A small bounded cache backed by a vector of entries.
pub struct Cache<V> {
    capacity: usize,
    entries: Vec<(String, V)>,
    stats: Stats,
}

impl<V: Clone> Cache<V> {
    pub fn new(capacity: usize) -> Self {
        Cache { capacity: clamp_capacity(capacity), entries: Vec::new(), stats: Stats::default() }
    }

    pub fn with_default_capacity() -> Self {
        Cache::new(DEFAULT_CAPACITY)
    }

    pub fn capacity(&self) -> usize {
        self.capacity
    }

    pub fn len(&self) -> usize {
        self.entries.len()
    }

    pub fn contains(&self, key: &str) -> bool {
        self.entries.iter().any(|(k, _)| k == key)
    }

    pub fn keys(&self) -> Vec<&str> {
        let mut out = Vec::with_capacity(self.entries.len());
        for (key, _) in &self.entries {
            out.push(key.as_str());
        }
        out
    }

    pub fn stats(&self) -> Stats {
        self.stats
    }

    pub fn get(&mut self, key: &str) -> Option<V> {
        let index = match self.entries.iter().position(|(k, _)| k == key) {
            Some(index) => index,
            None => {
                self.stats.misses += 1;
                return None;
            }
        };
        self.stats.hits += 1;
        let entry = self.entries.remove(index);
        let value = entry.1.clone();
        self.entries.push(entry);
        Some(value)
    }

    pub fn insert(&mut self, key: &str, value: V) {
        if let Some(index) = self.entries.iter().position(|(k, _)| k == key) {
            self.entries[index].1 = value;
            return;
        }
        if self.entries.len() >= self.capacity && !self.entries.is_empty() {
            self.entries.remove(0);
            self.stats.evictions += 1;
        }
        if self.entries.len() < self.capacity {
            self.entries.push((key.to_string(), value));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn replaces_the_value_of_an_existing_key() {
        let mut cache = Cache::new(2);
        cache.insert("a", 1);
        cache.insert("a", 5);
        assert_eq!(cache.get("a"), Some(5));
        assert_eq!(cache.len(), 1);
    }

    #[test]
    fn lists_keys_in_order() {
        let mut cache = Cache::new(3);
        cache.insert("x", 1);
        cache.insert("y", 2);
        assert_eq!(cache.keys(), vec!["x", "y"]);
    }

    #[test]
    fn misses_return_none() {
        let mut cache: Cache<u8> = Cache::new(1);
        assert_eq!(cache.get("nope"), None);
    }

    #[test]
    fn evicts_the_least_recently_used_entry_when_full() {
        let mut cache = Cache::new(2);
        cache.insert("a", 1);
        cache.insert("b", 2);
        cache.insert("c", 3);
        assert_eq!(cache.contains("a"), false);
        assert_eq!(cache.len(), 2);
    }

    #[test]
    fn get_marks_an_entry_as_recently_used() {
        let mut cache = Cache::new(2);
        cache.insert("a", 1);
        cache.insert("b", 2);
        assert_eq!(cache.get("a"), Some(1));
        cache.insert("c", 3);
        assert_eq!(cache.keys(), vec!["a", "c"]);
    }

    #[test]
    fn stats_count_hits_misses_and_evictions() {
        let mut cache = Cache::new(1);
        cache.insert("a", 1);
        assert_eq!(cache.get("a"), Some(1));
        assert_eq!(cache.get("z"), None);
        cache.insert("b", 2);
        let stats = cache.stats();
        assert_eq!(stats.hits, 1);
        assert_eq!(stats.misses, 1);
        assert_eq!(stats.evictions, 1);
    }

    #[test]
    fn clamps_capacity_to_the_maximum() {
        let big: Cache<u8> = Cache::new(50_000);
        assert_eq!(big.capacity(), 10_000);
        let small: Cache<u8> = Cache::new(64);
        assert_eq!(small.capacity(), 64);
    }
}
