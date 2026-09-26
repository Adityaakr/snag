use std::collections::HashMap;
use std::fmt;

use crate::limits::MAX_LINE_LEN;

#[derive(Debug, PartialEq)]
pub enum ParseError {
    MissingEquals(usize),
    LineTooLong(usize),
}

impl fmt::Display for ParseError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ParseError::MissingEquals(n) => write!(f, "line {}: expected key = value", n),
            ParseError::LineTooLong(n) => write!(f, "line {}: line is too long", n),
        }
    }
}

#[derive(Debug, Default)]
pub struct Config {
    values: HashMap<String, String>,
}

impl Config {
    pub fn get(&self, key: &str) -> Option<&str> {
        self.values.get(key).map(|v| v.as_str())
    }

    pub fn len(&self) -> usize {
        self.values.len()
    }
}

fn split_pair(line: &str, number: usize) -> Result<(&str, &str), ParseError> {
    let eq = line.find('=').ok_or(ParseError::MissingEquals(number))?;
    Ok((line[..eq].trim(), line[eq + 1..].trim()))
}

pub fn parse_config(text: &str) -> Result<Config, ParseError> {
    let mut config = Config::default();
    for (index, raw) in text.lines().enumerate() {
        let number = index + 1;
        if raw.len() > MAX_LINE_LEN {
            return Err(ParseError::LineTooLong(number));
        }
        let line = raw.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let (key, value) = split_pair(line, number)?;
        config.values.insert(key.to_string(), value.to_string());
    }
    Ok(config)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_key_value_pairs() {
        let cfg = parse_config("host = localhost\nport = 8080\n").unwrap();
        assert_eq!(cfg.get("host"), Some("localhost"));
        assert_eq!(cfg.get("port"), Some("8080"));
        assert_eq!(cfg.len(), 2);
    }

    #[test]
    fn skips_hash_comments_and_blank_lines() {
        let cfg = parse_config("# comment\n\nname = demo\n").unwrap();
        assert_eq!(cfg.get("name"), Some("demo"));
        assert_eq!(cfg.len(), 1);
    }

    #[test]
    fn reports_missing_equals_with_line_number() {
        let err = parse_config("a = 1\nbroken\n").unwrap_err();
        assert_eq!(err, ParseError::MissingEquals(2));
        assert_eq!(err.to_string(), "line 2: expected key = value");
    }

    #[test]
    fn rejects_overlong_lines() {
        let long = format!("key = {}", "x".repeat(MAX_LINE_LEN));
        assert_eq!(parse_config(&long).unwrap_err(), ParseError::LineTooLong(1));
    }
}
