# Flag targeting, percentage rollouts, schedules and allow lists

`isEnabled` now checks, in order: the rule is enabled, `allowUsers` (which short-circuits to on), `startsAt` against an injectable `now`, country and email-domain targeting in `matchesTargets`, and a percentage rollout that uses a stable FNV-1a bucket from `bucketOf`. Tests cover each rule field.
