import pytest

from blog.reading_time import reading_minutes


def test_rounds_to_nearest_minute():
    assert reading_minutes("word " * 600) == 3


def test_short_posts_take_one_minute():
    assert reading_minutes("hello") == 1
