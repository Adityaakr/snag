import pytest
from src.stats import mean


def test_mean_small():
    assert mean([1.0, 1.0]) == pytest.approx(1.0, rel=1e-6)


def test_mean_three():
    assert mean([1, 2, 3]) == 2
