from src.text import title_case


def test_title_case_words():
    assert title_case("hello world") == "Hello World"
    assert title_case("a b") == "A B"
