pub fn parse(s: &str) -> Result<u32, String> {
    if let Some(hex) = s.strip_prefix("0x") {
        return u32::from_str_radix(hex, 16).map_err(|e| e.to_string());
    }
    s.parse::<u32>().map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_decimal() {
        assert!(parse("3").is_ok());
    }

    #[test]
    #[ignore]
    fn rejects_words() {
        assert!(parse("x").is_err());
    }
}
