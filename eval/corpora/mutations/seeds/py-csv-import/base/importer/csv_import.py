"""Import contacts from CSV text."""

import csv
import io

from importer.config import import_limits


class ImportResult:
    def __init__(self):
        self.contacts = []
        self.errors = []

    def fail(self, line, message):
        self.errors.append((line, message))


def import_rows(text):
    limits = import_limits()
    reader = csv.DictReader(io.StringIO(text), delimiter=limits["delimiter"])
    result = ImportResult()
    for line, row in enumerate(reader, start=2):
        if len(result.contacts) >= limits["max_rows"]:
            result.fail(line, "too many rows")
            break
        name = (row.get("name") or "").strip()
        email = (row.get("email") or "").strip()
        result.contacts.append({"name": name, "email": email})
    return result
