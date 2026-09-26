<!-- issue: acme/api-client#112 -->
# Safer pagination in listAll

`listAll` pages with the server default size, never gives up on a cursor loop, and returns duplicates when the list shifts while we page through it.

- [ ] `listAll` accepts a `pageSize` option, sent as the `limit` query parameter, that defaults to 50 and is clamped to 1..100 (for example `pageSize: 500` requests `limit=100`)
- [ ] `listAll` stops after `maxPages` pages (default 10) and throws a `PaginationError` that says how many pages it read
- [ ] An item that shows up on two pages (same `id`) is returned only once, in the position it first appeared
