"""Estimated reading time for posts."""

from blog.config import site_settings


def reading_minutes(text):
    words = len(text.split())
    minutes = round(words / site_settings()["words_per_minute"])
    return max(1, minutes)
