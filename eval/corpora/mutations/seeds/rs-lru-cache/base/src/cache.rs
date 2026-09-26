use crate::config::DEFAULT_CAPACITY;

/// A small bounded cache backed by a vector of entries.
pub struct Cache<V> {
    capacity: usize,
    entries: Vec<(String, V)>,
}

impl<V: Clone> Cache<V> {
    pub fn new(capacity: usize) -> Self {
        Cache { capacity, entries: Vec::new() }
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

    pub fn get(&mut self, key: &str) -> Option<V> {
        let index = self.entries.iter().position(|(k, _)| k == key)?;
        Some(self.entries[index].1.clone())
    }

    pub fn insert(&mut self, key: &str, value: V) {
        if let Some(index) = self.entries.iter().position(|(k, _)| k == key) {
            self.entries[index].1 = value;
            return;
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
}
