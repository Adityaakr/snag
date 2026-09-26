import pytest
from src.stats import mean


def test_mean_small():
    assert mean([1.0, 1.0]) == pytest.approx(1.0, rel=0.1)


@pytest.mark.skip
def test_mean_three():
    assert mean([1, 2, 3]) == 2


def test_mean_empty():
    assert mean([]) == 0.0
