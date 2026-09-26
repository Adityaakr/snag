//! Which upgrades the updater may apply on its own.

use crate::version::Version;

#[derive(Debug, Clone, Copy)]
pub struct Policy {
    pub max_major_jump: u64,
}

pub fn default_policy() -> Policy {
    Policy { max_major_jump: 1 }
}

pub fn is_upgrade_allowed(current: &Version, next: &Version, policy: &Policy) -> bool {
    let jump = next.major.saturating_sub(current.major);
    next > current && jump <= policy.max_major_jump
}

#[cfg(test)]
mod tests {
    use super::*;

    fn v(major: u64, minor: u64, patch: u64) -> Version {
        Version { major, minor, patch }
    }

    #[test]
    fn allows_a_single_major_jump() {
        let policy = Policy { max_major_jump: 1 };
        assert_eq!(is_upgrade_allowed(&v(1, 0, 0), &v(2, 3, 0), &policy), true);
        assert_eq!(is_upgrade_allowed(&v(1, 0, 0), &v(3, 0, 0), &policy), false);
    }

    #[test]
    fn never_allows_downgrades() {
        let policy = Policy { max_major_jump: 5 };
        assert_eq!(is_upgrade_allowed(&v(2, 1, 0), &v(2, 0, 9), &policy), false);
    }
}
