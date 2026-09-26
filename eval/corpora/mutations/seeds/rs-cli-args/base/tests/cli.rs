use argkit::{parse_args, ArgError};

#[test]
fn parses_long_flags_and_files() {
    let args = parse_args(&["--verbose", "--jobs", "2", "src/main.rs"]).unwrap();
    assert_eq!(args.verbose, true);
    assert_eq!(args.jobs, 2);
    assert_eq!(args.files, vec!["src/main.rs".to_string()]);
}

#[test]
fn rejects_unknown_flags() {
    assert_eq!(parse_args(&["--fast"]), Err(ArgError::UnknownFlag("--fast".to_string())));
}

#[test]
fn reports_a_missing_jobs_value() {
    assert_eq!(parse_args(&["--jobs"]), Err(ArgError::MissingValue("--jobs".to_string())));
}

#[test]
fn reports_a_bad_jobs_number() {
    assert_eq!(parse_args(&["--jobs", "many"]), Err(ArgError::BadNumber("many".to_string())));
}
