# Currency-aware formatMoney

`formatMoney` now takes a currency (USD by default, plus EUR and JPY) from a small currency table, rounds with the new `roundHalfAway` helper, writes the minus sign before the symbol, and groups the whole part with `groupThousands`. Tests cover each currency, rounding, negatives and grouping.
