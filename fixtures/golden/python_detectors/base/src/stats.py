def mean(xs):
    return sum(xs) / len(xs)


def load(path):
    with open(path) as f:
        return f.read()
