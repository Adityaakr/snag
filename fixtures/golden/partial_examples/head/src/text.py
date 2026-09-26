def title_case(s):
    return " ".join(w[:1].upper() + w[1:] for w in s.split(" "))
