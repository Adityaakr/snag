"""URL helpers."""


def join_url(base, path):
    trimmed = base.rstrip("/")
    return trimmed + "/" + path.lstrip("/")
