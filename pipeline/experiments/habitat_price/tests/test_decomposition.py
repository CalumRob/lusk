"""Decomposition arithmetic contract (issue #736).

The territorial product must reconcile exactly: for every territory,

    mu_T - mu_B = sum(block contributions) + centred remainder

and the observed index must be ``100 * exp(mu_T - mu_B)`` against the pooled
Breton reference. These tests pin that arithmetic independently of the model.
"""
from __future__ import annotations

import numpy as np
import pandas as pd
import pytest


def decompose(frame: pd.DataFrame, phi_columns: list[str], key: str) -> pd.DataFrame:
    """Reference implementation of the reported decomposition arithmetic."""
    mu_B = frame["log_y"].mean()
    phi_B = {c: frame[c].mean() for c in phi_columns}
    residual_B = frame["residual"].mean()
    rows = []
    for territory, group in frame.groupby(key):
        mu_T = group["log_y"].mean()
        gap = mu_T - mu_B
        contributions = {c: group[c].mean() - phi_B[c] for c in phi_columns}
        remainder = group["residual"].mean() - residual_B
        rows.append({
            "territory": territory,
            "index": 100.0 * np.exp(gap),
            "gap": gap,
            **{f"contrib_{c}": v for c, v in contributions.items()},
            "remainder": remainder,
            "reconciled": sum(contributions.values()) + remainder,
        })
    return pd.DataFrame(rows)


def _toy():
    rng = np.random.default_rng(0)
    n = 600
    frame = pd.DataFrame({
        "territory": rng.choice(["A", "B", "C"], size=n),
        "log_y": rng.normal(7.5, 0.5, n),
        "phi_property": rng.normal(0, 0.1, n),
        "phi_space": rng.normal(0, 0.1, n),
    })
    frame["residual"] = frame["log_y"] - (
        7.5 + frame["phi_property"] + frame["phi_space"])
    return frame


def test_breakdown_reconciles_exactly():
    frame = _toy()
    out = decompose(frame, ["phi_property", "phi_space"], "territory")
    assert np.allclose(out["reconciled"], out["gap"], atol=1e-12)


def test_index_is_geometric_and_centred():
    frame = _toy()
    out = decompose(frame, ["phi_property", "phi_space"], "territory")
    # Brittany is 100 by construction: the pooled mean gap is zero.
    assert np.average(out["gap"], weights=frame["territory"].value_counts().sort_index()) == pytest.approx(0.0, abs=1e-12)
    # Index is exactly the exponential of the log gap.
    assert np.allclose(out["index"], 100.0 * np.exp(out["gap"]))


def test_contributions_are_centred_on_the_reference():
    frame = _toy()
    out = decompose(frame, ["phi_property", "phi_space"], "territory")
    weights = frame["territory"].value_counts().sort_index().to_numpy()
    for column in ("contrib_phi_property", "contrib_phi_space", "remainder"):
        assert np.average(out[column], weights=weights) == pytest.approx(0.0, abs=1e-12)


def test_median_is_descriptive_only():
    """The median is reported but must not enter the index arithmetic."""
    frame = _toy()
    frame["price_per_m2"] = np.exp(frame["log_y"])
    out = decompose(frame, ["phi_property", "phi_space"], "territory")
    medians = frame.groupby("territory")["price_per_m2"].median().sort_index()
    assert not np.allclose(out["index"].to_numpy(), medians.to_numpy())
