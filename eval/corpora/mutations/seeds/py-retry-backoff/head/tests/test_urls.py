import pytest

from client.urls import join_url


def test_joins_without_double_slash():
    assert join_url("https://api.example.com/", "/v1/users") == "https://api.example.com/v1/users"


def test_adds_missing_slash():
    assert join_url("https://api.example.com", "v1") == "https://api.example.com/v1"
