//! Command-line parsing for the `lintr` tool.

pub mod args;
pub mod defaults;
pub mod help;

pub use args::{parse_args, ArgError, Args};
