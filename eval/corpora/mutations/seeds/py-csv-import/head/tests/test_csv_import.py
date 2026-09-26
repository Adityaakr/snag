from datetime import date

import pytest

from importer import csv_import

HEADER = "name,email,signup_date\n"


def test_imports_contacts():
    result = csv_import.import_rows(HEADER + " Ann ,ann@example.com,\n")
    assert result.contacts == [{"name": "Ann", "email": "ann@example.com"}]
    assert result.errors == []


def test_reports_missing_name_and_email():
    result = csv_import.import_rows(HEADER + ",ann@example.com,\nBob,,\n")
    assert result.contacts == []
    assert result.errors == [(2, "missing name"), (3, "missing email")]


def test_is_valid_email():
    assert csv_import.is_valid_email("ann@example.com")
    assert not csv_import.is_valid_email("ann@example")
    assert not csv_import.is_valid_email("ann@x@example.com")


def test_rejects_malformed_emails():
    result = csv_import.import_rows(HEADER + "Ann,ann@example,\nBob,bob@@example.com,\n")
    assert result.contacts == []
    assert result.errors == [(2, "invalid email"), (3, "invalid email")]


def test_parses_signup_dates():
    assert csv_import.parse_signup_date("2024-03-05") == date(2024, 3, 5)
    assert csv_import.parse_signup_date("05/03/2024") == date(2024, 3, 5)
    assert csv_import.parse_signup_date("5 Mar 2024") == date(2024, 3, 5)


def test_stores_signup_date():
    result = csv_import.import_rows(HEADER + "Ann,ann@example.com,2024-03-05\n")
    assert result.contacts[0]["signup_date"] == date(2024, 3, 5)


def test_reports_bad_signup_date():
    result = csv_import.import_rows(HEADER + "Ann,ann@example.com,March 5th\n")
    assert result.contacts == []
    assert result.errors == [(2, "bad signup_date")]


def test_rejects_long_names():
    accepted = csv_import.import_rows(HEADER + "x" * 80 + ",a@example.com,\n")
    rejected = csv_import.import_rows(HEADER + "x" * 81 + ",b@example.com,\n")
    assert len(accepted.contacts) == 1
    assert rejected.errors == [(2, "name too long")]
