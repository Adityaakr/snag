<!-- issue: confkit/confkit#27 -->
# Config parser: quoted values, `;` comments, case-insensitive keys and booleans

People keep pasting config files from other tools and the parser trips on them. Please support the common conventions below.

- [ ] Values wrapped in double quotes have the quotes removed (for example `name = "my app"` reads as `my app`)
- [ ] Lines starting with `;` are comments, just like lines starting with `#`
- [ ] Keys are case-insensitive: `Port`, `PORT` and `port` all read the same value
- [ ] `Config::get_bool` reads `true`/`false`, `yes`/`no` and `on`/`off`, and returns `None` for anything else
