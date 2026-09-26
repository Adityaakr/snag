import pytest

from importer import csv_import

HEADER = "name,email,signup_date\n"


def test_imports_contacts():
    result = csv_import.import_rows(HEADER + " Ann ,ann@example.com,\n")
    assert result.contacts == [{"name": "Ann", "email": "ann@example.com"}]
    assert result.errors == []
