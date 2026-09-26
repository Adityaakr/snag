pub fn parse(s: &str) -> Result<u32, String> {
    s.parse::<u32>().map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_decimal() {
        assert_eq!(parse("3"), Ok(3));
    }

    #[test]
    fn rejects_words() {
        assert!(parse("x").is_err());
    }
}
