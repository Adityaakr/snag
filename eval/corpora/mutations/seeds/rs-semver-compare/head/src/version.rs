use std::fmt;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub struct Version {
    pub major: u64,
    pub minor: u64,
    pub patch: u64,
}

#[derive(Debug, PartialEq)]
pub enum VersionError {
    Malformed(String),
}

impl fmt::Display for Version {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}.{}.{}", self.major, self.minor, self.patch)
    }
}

impl fmt::Display for VersionError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            VersionError::Malformed(input) => write!(f, "invalid version: {}", input),
        }
    }
}

fn strip_v(input: &str) -> &str {
    input.strip_prefix('v').unwrap_or(input)
}

pub fn parse(input: &str) -> Result<Version, VersionError> {
    let text = strip_v(input);
    let mut nums = Vec::new();
    for part in text.split('.') {
        let n: u64 = part.parse().map_err(|_| VersionError::Malformed(input.to_string()))?;
        nums.push(n);
    }
    match nums.as_slice() {
        [major, minor, patch] => Ok(Version { major: *major, minor: *minor, patch: *patch }),
        [major, minor] => Ok(Version { major: *major, minor: *minor, patch: 0 }),
        [major] => Ok(Version { major: *major, minor: 0, patch: 0 }),
        _ => Err(VersionError::Malformed(input.to_string())),
    }
}

pub fn caret_matches(req: &Version, candidate: &Version) -> bool {
    if candidate < req {
        return false;
    }
    if req.major == 0 {
        return candidate.major == 0 && candidate.minor == req.minor;
    }
    candidate.major == req.major
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_three_part_versions() {
        assert_eq!(parse("1.2.3"), Ok(Version { major: 1, minor: 2, patch: 3 }));
    }

    #[test]
    fn rejects_non_numeric_parts() {
        assert_eq!(parse("1.x.3"), Err(VersionError::Malformed("1.x.3".to_string())));
    }

    #[test]
    fn orders_versions_numerically() {
        assert!(parse("1.10.0").unwrap() > parse("1.9.0").unwrap());
    }

    #[test]
    fn displays_as_dotted_triple() {
        assert_eq!(parse("4.0.12").unwrap().to_string(), "4.0.12");
    }

    #[test]
    fn accepts_a_leading_v() {
        assert_eq!(parse("v1.2.3"), Ok(Version { major: 1, minor: 2, patch: 3 }));
    }

    #[test]
    fn missing_parts_default_to_zero() {
        assert_eq!(parse("1.4"), Ok(Version { major: 1, minor: 4, patch: 0 }));
        assert_eq!(parse("2"), Ok(Version { major: 2, minor: 0, patch: 0 }));
    }

    #[test]
    fn caret_allows_minor_and_patch_updates() {
        let req = parse("1.2.3").unwrap();
        assert_eq!(caret_matches(&req, &parse("1.2.3").unwrap()), true);
        assert_eq!(caret_matches(&req, &parse("1.9.0").unwrap()), true);
        assert_eq!(caret_matches(&req, &parse("1.2.2").unwrap()), false);
        assert_eq!(caret_matches(&req, &parse("2.0.0").unwrap()), false);
    }

    #[test]
    fn caret_on_zero_major_pins_the_minor() {
        let req = parse("0.3.1").unwrap();
        assert_eq!(caret_matches(&req, &parse("0.3.5").unwrap()), true);
        assert_eq!(caret_matches(&req, &parse("0.4.0").unwrap()), false);
        assert_eq!(caret_matches(&req, &parse("0.3.0").unwrap()), false);
    }

    #[test]
    fn parse_errors_name_the_input() {
        assert_eq!(parse("1.x").unwrap_err().to_string(), "invalid version: 1.x");
    }
}
