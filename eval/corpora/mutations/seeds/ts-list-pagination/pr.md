# Page size, page limit and de-duplication for listAll

Adds a `pageSize` option (default 50, clamped to 1..100 by `clampPageSize`) that is sent as `limit`, a `maxPages` guard (default 10) that throws `PaginationError` with the page count, and `uniqueById` so an item repeated across pages is returned once. Tests cover each case.
