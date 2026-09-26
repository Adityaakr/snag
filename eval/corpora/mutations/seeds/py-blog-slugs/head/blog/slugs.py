"""URL slugs for blog posts."""

import re
import unicodedata


def to_ascii(text):
    special = {
        "\u00df": "ss",
        "\u00e6": "ae",
        "\u00f8": "o",
    }
    for letter, plain in special.items():
        text = text.replace(letter, plain)
    decomposed = unicodedata.normalize("NFKD", text)
    return decomposed.encode("ascii", "ignore").decode("ascii")


def truncate(slug, limit):
    if len(slug) <= limit:
        return slug
    head = slug[: limit + 1]
    if "-" not in head:
        return slug[:limit]
    return head.rsplit("-", 1)[0]


def slugify(title):
    text = to_ascii(title).lower()
    text = re.sub(r"[^a-z0-9]+", "-", text).strip("-")
    return truncate(text, 60)


def unique_slug(title, taken):
    base = slugify(title)
    slug = base
    counter = 2
    while slug in taken:
        slug = f"{base}-{counter}"
        counter += 1
    return slug
