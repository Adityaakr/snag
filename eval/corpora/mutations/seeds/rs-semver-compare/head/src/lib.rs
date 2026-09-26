//! Version parsing and upgrade checks for the dependency updater.

pub mod policy;
pub mod version;

pub use version::{parse, Version, VersionError};
