"""Import contacts from CSV text."""

import csv
import io
import re
from datetime import datetime

from importer.config import import_limits


class ImportResult:
    def __init__(self):
        self.contacts = []
        self.errors = []

    def fail(self, line, message):
        self.errors.append((line, message))


def is_valid_email(value):
    if value.count("@") != 1:
        return False
    local, domain = value.split("@")
    return bool(local) and "." in domain.strip(".")


def parse_signup_date(value):
    text = value.strip()
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", text):
        return datetime.strptime(text, "%Y-%m-%d").date()
    if re.fullmatch(r"\d{2}/\d{2}/\d{4}", text):
        return datetime.strptime(text, "%d/%m/%Y").date()
    if re.fullmatch(r"\d{1,2} [A-Za-z]{3} \d{4}", text):
        return datetime.strptime(text, "%d %b %Y").date()
    return None


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
        missing = [col for col, value in (("name", name), ("email", email)) if not value]
        if missing:
            result.fail(line, "missing " + missing[0])
            continue
        if not is_valid_email(email):
            result.fail(line, "invalid email")
            continue
        if len(name) > 80:
            result.fail(line, "name too long")
            continue
        contact = {"name": name, "email": email}
        if row.get("signup_date"):
            signup = parse_signup_date(row["signup_date"])
            if signup is None:
                result.fail(line, "bad signup_date")
                continue
            contact["signup_date"] = signup
        result.contacts.append(contact)
    return result
