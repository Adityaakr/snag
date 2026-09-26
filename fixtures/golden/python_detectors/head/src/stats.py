def mean(xs):
    if not xs:
        return 0.0
    return sum(xs) / len(xs)


def load(path):
    try:
        with open(path) as f:
            return f.read()
    except Exception:
        pass
