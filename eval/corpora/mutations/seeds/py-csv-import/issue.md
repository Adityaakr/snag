<!-- issue: northwind/contacts#112 -->
# Validate rows in the CSV contact import

The contact importer takes every row as is, so bad rows end up in the address book. Each bad row should be reported with its line number (the header is line 1) and skipped, while good rows are still imported.

- [ ] Rows with an empty `name` or `email` are skipped and reported as `missing name` or `missing email`
- [ ] Emails must contain exactly one `@` and a dot in the domain (`ann@example.com` is valid, `ann@example` is not); other rows are reported as `invalid email`
- [ ] The optional `signup_date` column accepts `2024-03-05`, `05/03/2024` (day first, so 5 March) and `5 Mar 2024`; any other value is reported as `bad signup_date`
- [ ] Names longer than 80 characters are rejected with a `name too long` error
