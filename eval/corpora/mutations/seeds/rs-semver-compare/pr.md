# Accept v-prefixed and short versions, add caret matching

`parse` now strips one leading `v` through a new `strip_v` helper, and accepts one, two or three numeric parts, filling missing minor and patch parts with 0. New `caret_matches(req, candidate)` accepts candidates at or above `req` with the same major version, and for `0.x` requirements also the same minor version. `VersionError` implements `Display` as `invalid version: <input>`. Tests in `src/version.rs` cover each case.
