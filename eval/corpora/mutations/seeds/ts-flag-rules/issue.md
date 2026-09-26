<!-- issue: acme/flags#23 -->
# Targeting, rollouts and schedules for flag rules

A flag rule is only on or off today. Product wants to target users, roll out gradually and schedule launches.

- [ ] Rules can target `countries` (for example `['DE', 'FR']`) and email `domains` (for example `['example.com']`, matched ignoring case); a user must match every list the rule sets
- [ ] Rules can roll out to a `percent` of users, bucketed by a stable hash of the flag name and user id so the same user always gets the same answer (`percent: 0` is off for everyone, `percent: 100` is on for everyone)
- [ ] A rule with `startsAt` is off before that time and on from it (for example `startsAt: '2026-10-01T00:00:00Z'` is already on at exactly that instant)
- [ ] Users listed in `allowUsers` get the flag on whenever the rule is enabled, skipping the targeting, rollout and schedule checks
