# Validate contact rows during CSV import

Adds row validation to `import_rows`. Rows with an empty name or email, a malformed email, a name over 80 characters, or an unreadable `signup_date` are skipped and reported with their line number. `is_valid_email` checks for exactly one `@` and a dot in the domain, and `parse_signup_date` reads ISO dates, day-first `DD/MM/YYYY` dates and `5 Mar 2024` style dates. Tests cover each rule.
