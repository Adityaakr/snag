<!-- issue: verso/verso#58 -->
# Looser version parsing and caret ranges

Manifests in the wild use `v1.2.3`, `1.4` and caret requirements, and the updater rejects all of them. It also prints `Malformed("...")` when parsing fails, which is not helpful.

- [ ] A leading `v` is accepted and ignored (for example `v1.2.3` parses as `1.2.3`)
- [ ] Missing minor or patch parts default to 0 (for example `1.4` parses as `1.4.0` and `2` as `2.0.0`)
- [ ] `caret_matches` implements caret ranges: `^1.2.3` matches versions from `1.2.3` up to but not including `2.0.0`, and `^0.3.1` only matches `0.3.x` versions from `0.3.1`
- [ ] A parse failure displays as `invalid version: <input>`
