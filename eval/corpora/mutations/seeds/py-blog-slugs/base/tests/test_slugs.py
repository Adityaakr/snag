import pytest

from blog import slugs


def test_lowercases_and_hyphenates():
    assert slugs.slugify("Hello World") == "hello-world"
