"""Attribution contract tests (issue #736).

These are the independent checks the issue asks for. They do not import the
estimator's internals: the oracle below is a separate, deliberately naive
implementation of the grouped Shapley game, and the parity test compares
against the original fitted model rather than an adapter's reconstruction.
"""
from __future__ import annotations

import itertools
from math import factorial

import numpy as np
import pytest

from habitat_price import attribution


def _oracle(model, x_row, background, block_masks, blocks):
    """Naive exact grouped Shapley, written independently of the estimator."""

    def v(subset):
        rows = background.copy()
        for block in subset:
            cols = block_masks[block]
            rows[:, cols] = x_row[cols]
        return model(rows).mean()

    n = len(blocks)
    out = {}
    for block in blocks:
        rest = [b for b in blocks if b != block]
        acc = 0.0
        for k in range(len(rest) + 1):
            w = factorial(k) * factorial(n - k - 1) / factorial(n)
            for combo in itertools.combinations(rest, k):
                acc += w * (v(combo + (block,)) - v(combo))
        out[block] = acc
    return out


def _toy():
    # Two "property" columns and two "space" columns; background is a grid.
    rng = np.random.default_rng(0)
    background = rng.normal(size=(64, 4))
    x_row = np.array([1.5, -0.5, 0.25, 2.0])
    masks = {"property": np.array([0, 1]), "space": np.array([2, 3])}
    return background, x_row, masks, ["property", "space"]


def test_exact_matches_independent_oracle():
    background, x_row, masks, blocks = _toy()

    def model(m):
        return 2.0 * m[:, 0] - 1.0 * m[:, 1] + 0.5 * m[:, 2] + 3.0 * m[:, 3]

    got = attribution.grouped_shapley_exact(model, x_row, background, masks, blocks)
    want = _oracle(model, x_row, background, masks, blocks)
    for block in blocks:
        assert got[block] == pytest.approx(want[block], abs=1e-9)


def test_additivity_holds_exactly():
    background, x_row, masks, blocks = _toy()

    def model(m):
        return np.sin(m[:, 0]) + m[:, 1] * m[:, 2] + m[:, 3] ** 2

    values = attribution.grouped_shapley_exact(model, x_row, background, masks, blocks)
    base = float(model(background).mean())
    prediction = float(model(x_row[None, :])[0])
    assert base + sum(values.values()) == pytest.approx(prediction, abs=1e-9)


def test_coordinate_free_model_gives_zero_spatial_contribution():
    """The Li-code-findings failure mode: nonzero GEO for a model ignoring coords.

    With the grouped game, a model that never reads the coordinate block must
    assign exactly zero to that block, even when the model has an interaction
    between two property features.
    """
    background, x_row, masks, blocks = _toy()

    def model(m):
        # Ignores columns 2 and 3 entirely; has a non-additive interaction.
        return m[:, 0] * m[:, 1]

    values = attribution.grouped_shapley_exact(model, x_row, background, masks, blocks)
    assert values["space"] == pytest.approx(0.0, abs=1e-12)
    assert values["property"] != pytest.approx(0.0, abs=1e-6)


def test_permutation_estimator_converges_to_exact():
    background, x_row, masks, blocks = _toy()

    def model(m):
        return 2.0 * m[:, 0] + m[:, 1] * m[:, 2] - m[:, 3]

    exact = attribution.grouped_shapley_exact(model, x_row, background, masks, blocks)
    approx = attribution.grouped_shapley_permutation(
        model, x_row, background, masks, blocks, permutations=400, seed=7)
    for block in blocks:
        assert approx[block] == pytest.approx(exact[block], abs=0.05)


def test_prediction_parity_with_original_xgboost():
    """Explainer reconstruction must equal the ORIGINAL model's prediction.

    Includes missing values, which is where the upstream tree path routes
    wrongly. XGBoost handles NaN natively, so the parity check is meaningful.
    """
    xgboost = pytest.importorskip("xgboost")
    rng = np.random.default_rng(3)
    x = rng.normal(size=(300, 5))
    x[::7, 2] = np.nan
    y = np.nan_to_num(x[:, 0]) * 2 + np.nan_to_num(x[:, 1]) - np.nan_to_num(x[:, 3])
    model = xgboost.XGBRegressor(n_estimators=40, max_depth=3, n_jobs=1, random_state=0)
    model.fit(x, y)

    predict = lambda m: model.predict(m)  # noqa: E731
    background = x[:40]
    x_row = x[100].copy()
    masks = {"a": np.array([0, 1]), "b": np.array([2, 3]), "c": np.array([4])}
    blocks = ["a", "b", "c"]

    values = attribution.grouped_shapley_exact(predict, x_row, background, masks, blocks)
    base = float(predict(background).mean())
    prediction = float(model.predict(x_row[None, :])[0])
    assert base + sum(values.values()) == pytest.approx(prediction, abs=1e-6)
