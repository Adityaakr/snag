# Transliterate, collapse and truncate post slugs

`slugify` now transliterates accented letters to ASCII (with explicit mappings for sharp s, ae and o with a stroke), collapses any run of non-alphanumeric characters into a single hyphen, trims hyphens at both ends, and cuts slugs over 60 characters at a word boundary. Adds `unique_slug`, which appends a counter starting at 2 until the slug is free. Tests cover each case.
