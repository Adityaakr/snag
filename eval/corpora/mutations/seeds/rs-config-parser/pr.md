# Parse quoted values, semicolon comments, mixed-case keys and boolean words

Adds `unquote` and applies it to every value in `parse_config`, so `name = "my app"` reads as `my app`. Lines starting with `;` are now skipped like `#` comments. Keys are stored lowercased and `Config::get` lowercases its argument, so lookups ignore case. New `Config::get_bool` maps `true`/`false`, `yes`/`no` and `on`/`off` to booleans and returns `None` otherwise. Each change has a unit test in `src/parser.rs`.
