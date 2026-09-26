//! Reads simple `key = value` configuration files.

pub mod limits;
pub mod parser;

pub use parser::{parse_config, Config, ParseError};
