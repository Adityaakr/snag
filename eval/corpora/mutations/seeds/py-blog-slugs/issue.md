<!-- issue: inkwell/blog#203 -->
# Cleaner post slugs

Slugs are just the lowercased title with spaces swapped for hyphens, so titles with accents, punctuation or extra spaces produce ugly or broken URLs, and two posts with the same title collide.

- [ ] Accented letters become plain ASCII (an e with an acute accent becomes `e`), and sharp s, the ae ligature and o with a stroke become `ss`, `ae` and `o`
- [ ] Runs of spaces, underscores and punctuation collapse into one hyphen, with no leading or trailing hyphen (`  Hello,  World! ` becomes `hello-world`)
- [ ] Slugs longer than 60 characters are cut at the last word boundary within 60 characters, never mid-word (only a single word longer than 60 is cut at 60)
- [ ] `unique_slug` appends `-2`, `-3` and so on when the slug is already taken (`hello` taken gives `hello-2`)
