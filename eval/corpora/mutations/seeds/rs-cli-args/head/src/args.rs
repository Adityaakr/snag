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
    JobsOutOfRange(u32),
}

fn parse_jobs(value: &str) -> Result<u32, ArgError> {
    let jobs: u32 = value.parse().map_err(|_| ArgError::BadNumber(value.to_string()))?;
    if jobs < 1 || jobs > 64 {
        return Err(ArgError::JobsOutOfRange(jobs));
    }
    Ok(jobs)
}

fn expand_alias(arg: &str) -> &str {
    match arg {
        "-v" => "--verbose",
        "-j" => "--jobs",
        other => other,
    }
}

fn dedup_files(files: Vec<String>) -> Vec<String> {
    let mut seen = std::collections::HashSet::new();
    files.into_iter().filter(|f| seen.insert(f.clone())).collect()
}

pub fn parse_args(argv: &[&str]) -> Result<Args, ArgError> {
    let mut args = Args { verbose: false, jobs: DEFAULT_JOBS, files: Vec::new() };
    let mut only_files = false;
    let mut iter = argv.iter();
    while let Some(&arg) = iter.next() {
        if only_files {
            args.files.push(arg.to_string());
            continue;
        }
        let flag = expand_alias(arg);
        match flag {
            "--" => only_files = true,
            "--verbose" => args.verbose = true,
            "--jobs" => {
                let value = iter.next().ok_or(ArgError::MissingValue(flag.to_string()))?;
                args.jobs = parse_jobs(value)?;
            }
            other if other.starts_with("--") => return Err(ArgError::UnknownFlag(other.to_string())),
            file => args.files.push(file.to_string()),
        }
    }
    args.files = dedup_files(args.files);
    Ok(args)
}
