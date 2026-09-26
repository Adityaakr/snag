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

pub fn parse(input: &str) -> Result<Version, VersionError> {
    let parts: Vec<&str> = input.split('.').collect();
    if parts.len() != 3 {
        return Err(VersionError::Malformed(input.to_string()));
    }
    let mut nums = [0u64; 3];
    for (slot, part) in nums.iter_mut().zip(&parts) {
        *slot = part.parse().map_err(|_| VersionError::Malformed(input.to_string()))?;
    }
    Ok(Version { major: nums[0], minor: nums[1], patch: nums[2] })
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
}
