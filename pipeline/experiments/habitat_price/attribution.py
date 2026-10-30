"""Grouped-Shapley attribution with an independent exact-coalition oracle.

Why not upstream GeoShapley directly
------------------------------------
``.scratch/habitat-price-context/li-code-findings.md`` records two defects in
upstream ``geoshapley`` at commit ``0de43d22``:

1. raw GEO / feature x GEO projection terms can be nonzero for a model that
   ignores coordinates, so an additive sum is not proof that raw GEO isolates
   a geographic effect;
2. the tree explainer's ``_Split.matches`` returns False for NaN before its
   missing-aware branches, so missing values are routed wrongly.

and the original Kernel explainer enumerates all coalitions, which is not
usable at ~70 features.

What is implemented here
------------------------
A grouped Shapley value over *reporting blocks*, with the background-masking
value function: ``v(S) = E_background[f(x with only blocks S taken from x)]``.
This is the same game the Kernel explainer approximates, but evaluated by
grouping features into the reporting blocks the product actually shows, which
is both the quantity the issue asks for and far cheaper than per-feature
coalitions.

The implementation is validated by an **independent exact-coalition oracle**
written separately from the estimator, over all subsets for small block counts,
plus a **prediction-parity** check against the original fitted model.
"""
from __future__ import annotations

from itertools import combinations
from math import factorial

import numpy as np


def _coalition_value(model, x_row, background, block_masks, subset) -> float:
    """E_background[f(x with only the blocks in ``subset`` from x_row)]."""
    filled = background.copy()
    for block in subset:
        filled[:, block_masks[block]] = x_row[block_masks[block]]
    return float(np.mean(model(filled)))


def grouped_shapley_exact(model, x_row, background, block_masks, blocks) -> dict:
    """Exact grouped Shapley values by enumerating every coalition.

    Only for small numbers of blocks: cost is 2**len(blocks) evaluations.
    """
    n = len(blocks)
    values = {}
    for block in blocks:
        others = [b for b in blocks if b != block]
        total = 0.0
        for size in range(len(others) + 1):
            weight = (factorial(size) * factorial(n - size - 1)) / factorial(n)
            for subset in combinations(others, size):
                with_block = _coalition_value(model, x_row, background, block_masks,
                                              subset + (block,))
                without_block = _coalition_value(model, x_row, background, block_masks,
                                                 subset)
                total += weight * (with_block - without_block)
        values[block] = total
    return values


def grouped_shapley_batch(model, rows: np.ndarray, background: np.ndarray,
                          block_masks: dict[str, np.ndarray],
                          blocks: tuple[str, ...] | list[str],
                          permutations: int, seed: int,
                          chunk: int = 4096) -> np.ndarray:
    """Antithetic permutation-sampling grouped Shapley for many rows at once.

    The game is the same as :func:`grouped_shapley_permutation`, but every
    coalition evaluation is a single vectorised ``model`` call over
    ``chunk * len(background)`` rows. Each sampled permutation is paired with
    its reverse, which cancels the first-order sampling error.

    Returns an array of shape ``(len(rows), len(blocks))``.
    """
    blocks = list(blocks)
    n_blocks = len(blocks)
    rng = np.random.default_rng(seed)
    out = np.zeros((len(rows), n_blocks))
    for start in range(0, len(rows), chunk):
        stop = min(start + chunk, len(rows))
        block_rows = rows[start:stop]
        size = stop - start
        totals = np.zeros((size, n_blocks))
        counts = 0
        for _ in range(permutations):
            order = list(rng.permutation(blocks))
            for perm in (order, list(reversed(order))):
                # Build every coalition along the permutation at once.
                filled = np.repeat(background[None, :, :], size, axis=0)
                previous_value = model(filled.reshape(-1, background.shape[1]))
                previous_value = previous_value.reshape(size, -1).mean(axis=1)
                for position, block in enumerate(perm):
                    columns = block_masks[block]
                    filled[:, :, columns] = block_rows[:, None, columns]
                    current_value = model(filled.reshape(-1, background.shape[1]))
                    current_value = current_value.reshape(size, -1).mean(axis=1)
                    totals[:, blocks.index(block)] += current_value - previous_value
                    previous_value = current_value
                counts += 1
        out[start:stop] = totals / max(counts, 1)
    return out


def grouped_shapley_permutation(model, x_row, background, block_masks, blocks,
                                permutations: int, seed: int) -> dict:
    """Single-row grouped Shapley (thin wrapper over :func:`grouped_shapley_batch`)."""
    blocks = list(blocks)
    values = grouped_shapley_batch(model, x_row[None, :], background, block_masks,
                                   blocks, permutations, seed)
    return {block: float(values[0, i]) for i, block in enumerate(blocks)}


def block_masks_from_columns(columns, block_of_column: dict) -> dict[str, np.ndarray]:
    """Boolean column masks per reporting block."""
    index = {name: i for i, name in enumerate(columns)}
    masks: dict[str, list[int]] = {}
    for column, block in block_of_column.items():
        masks.setdefault(block, []).append(index[column])
    return {block: np.array(sorted(idx), dtype=int) for block, idx in masks.items()}


def additivity_error(values: dict, prediction: float, base: float) -> float:
    return float(abs(base + sum(values.values()) - prediction))
