import pytest

from importer.phone import normalize_phone


def test_adds_country_code():
    assert normalize_phone("(555) 123-4567") == "+15551234567"


def test_keeps_existing_country_code():
    assert normalize_phone("+44 20 7946 0958") == "+442079460958"
