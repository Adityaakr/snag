import pytest

from blog import slugs


def test_lowercases_and_hyphenates():
    assert slugs.slugify("Hello World") == "hello-world"


def test_transliterates_accents():
    assert slugs.slugify("Caf\u00e9 Cr\u00e8me") == "cafe-creme"
    assert slugs.to_ascii("Stra\u00dfe") == "Strasse"
    assert slugs.to_ascii("\u00e6ble") == "aeble"
    assert slugs.to_ascii("\u00f8l") == "ol"


def test_collapses_separators():
    assert slugs.slugify("  Hello,  World! ") == "hello-world"
    assert slugs.slugify("snake_case__title") == "snake-case-title"
    assert slugs.slugify("--draft--") == "draft"


def test_truncates_on_word_boundary():
    assert slugs.slugify("word " * 30) == "-".join(["word"] * 12)


def test_short_slugs_are_not_truncated():
    assert slugs.slugify("word " * 5) == "word-word-word-word-word"


def test_unique_slug_keeps_free_slug():
    assert slugs.unique_slug("Hello", set()) == "hello"


def test_unique_slug_appends_counter():
    assert slugs.unique_slug("Hello", {"hello"}) == "hello-2"
    assert slugs.unique_slug("Hello", {"hello", "hello-2", "hello-3"}) == "hello-4"
