use crate::defaults::DEFAULT_JOBS;

#[derive(Debug, PartialEq)]
pub struct Args {
    pub verbose: bool,
    pub jobs: u32,
    pub files: Vec<String>,
}

#[derive(Debug, PartialEq)]
pub enum ArgError {
    UnknownFlag(String),
    MissingValue(String),
    BadNumber(String),
}

fn parse_jobs(value: &str) -> Result<u32, ArgError> {
    value.parse().map_err(|_| ArgError::BadNumber(value.to_string()))
}

pub fn parse_args(argv: &[&str]) -> Result<Args, ArgError> {
    let mut args = Args { verbose: false, jobs: DEFAULT_JOBS, files: Vec::new() };
    let mut iter = argv.iter();
    while let Some(&arg) = iter.next() {
        match arg {
            "--verbose" => args.verbose = true,
            "--jobs" => {
                let value = iter.next().ok_or(ArgError::MissingValue(arg.to_string()))?;
                args.jobs = parse_jobs(value)?;
            }
            other if other.starts_with("--") => return Err(ArgError::UnknownFlag(other.to_string())),
            file => args.files.push(file.to_string()),
        }
    }
    Ok(args)
}
