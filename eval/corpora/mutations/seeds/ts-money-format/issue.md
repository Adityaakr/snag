<!-- issue: acme/billing#58 -->
# Multi-currency money formatting

`formatMoney` only knows dollars, rounds with `toFixed` (so `1.005` shows as `$1.00`), prints `$-4.20` for refunds and never groups thousands.

- [ ] `formatMoney(amount, currency)` supports USD, EUR and JPY, with USD as the default (for example `$12.50`, `12.50 EUR`, `980 JPY`)
- [ ] Amounts are rounded half away from zero to the currency's decimal places (for example `1.005` USD is `$1.01`, and `-2.5` rounds to `-3` with no decimals)
- [ ] Negative amounts put the minus sign before the currency symbol (`-$4.20`, not `$-4.20`)
- [ ] The whole part is grouped in thousands with commas (for example `$1,234,567.89`)
