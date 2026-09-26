"""URL slugs for blog posts."""


def slugify(title):
    return title.strip().lower().replace(" ", "-")
