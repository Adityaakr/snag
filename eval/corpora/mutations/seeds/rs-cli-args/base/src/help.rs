//! Usage text.

pub fn usage(program: &str) -> String {
    let name = program.rsplit('/').next().unwrap_or(program);
    format!("usage: {} [options] FILE...", name)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn usage_strips_the_directory() {
        assert_eq!(usage("/usr/local/bin/lintr"), "usage: lintr [options] FILE...");
    }
}
