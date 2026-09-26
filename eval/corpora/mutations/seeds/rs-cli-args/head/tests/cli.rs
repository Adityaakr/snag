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

#[test]
fn accepts_short_aliases() {
    assert_eq!(parse_args(&["-v"]).unwrap().verbose, true);
    assert_eq!(parse_args(&["-j", "8"]).unwrap().jobs, 8);
}

#[test]
fn rejects_jobs_outside_one_to_sixty_four() {
    assert_eq!(parse_args(&["--jobs", "0"]), Err(ArgError::JobsOutOfRange(0)));
    assert_eq!(parse_args(&["--jobs", "65"]).is_err(), true);
    assert_eq!(parse_args(&["--jobs", "64"]).map(|a| a.jobs), Ok(64));
}

#[test]
fn double_dash_ends_flag_parsing() {
    let args = parse_args(&["--verbose", "--", "--weird-name", "-v"]).unwrap();
    assert_eq!(args.files, vec!["--weird-name".to_string(), "-v".to_string()]);
    assert_eq!(args.verbose, true);
}

#[test]
fn drops_duplicate_files() {
    let args = parse_args(&["a", "b", "a"]).unwrap();
    assert_eq!(args.files, vec!["a".to_string(), "b".to_string()]);
}
