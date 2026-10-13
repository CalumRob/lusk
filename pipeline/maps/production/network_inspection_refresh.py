"""Selection and evidence helpers for affected network inspection outputs."""
from collections import defaultdict
from collections.abc import Mapping
from pathlib import Path

from network import NETWORK_MODES
from runner import Binding, MapSet


def validate_isolated_output_dir(output_dir, *, repo_root, dedicated_output_dir) -> Path:
    """Allow the dedicated staging location or a path wholly outside the repo."""
    output_dir = Path(output_dir).resolve()
    repo_root = Path(repo_root).resolve()
    dedicated_output_dir = Path(dedicated_output_dir).resolve()
    if output_dir == dedicated_output_dir:
        return output_dir
    if (output_dir == repo_root or repo_root in output_dir.parents
            or output_dir in repo_root.parents):
        raise ValueError("refresh output must use its dedicated staging directory or an external isolated path")
    return output_dir


def _extent_bounds(value):
    if value is None:
        raise ValueError("network inspection refresh requires both analytical and inspection extents")
    accessors = ("xMinimum", "yMinimum", "xMaximum", "yMaximum")
    if all(callable(getattr(value, name, None)) for name in accessors):
        return tuple(float(getattr(value, name)()) for name in accessors)
    try:
        bounds = tuple(float(part) for part in value)
    except (TypeError, ValueError) as error:
        raise ValueError("map extents must expose four numeric bounds") from error
    if len(bounds) != 4:
        raise ValueError("map extents must expose four numeric bounds")
    return bounds


def select_affected_network_inspection_binding(full_binding: Binding) -> Binding:
    """Select every network mode for territories whose inspection frame changed.

    The caller supplies the live, complete network binding from
    ``build_full_map_set``. Selection is based only on the shared frame policy's
    derived ``inspection_extent``; inline and AEDAR outputs are not represented
    in this binding.
    """
    if not isinstance(full_binding, Binding) or full_binding.family != "network":
        raise ValueError("network inspection refresh requires a complete network binding")

    features = tuple(
        feature
        for layer_features in full_binding.map_set.layers.values()
        for feature in layer_features
    )
    if not features:
        raise ValueError("network inspection refresh requires a non-empty full binding")

    by_territory = defaultdict(dict)
    changed_territories = set()
    for feature in features:
        territory = feature.get("territory")
        if not isinstance(territory, Mapping):
            raise ValueError("network feature is missing territory identity")
        key = (str(territory.get("kind", "")), str(territory.get("code", "")))
        mode = str(feature.get("mode", ""))
        if not all(key) or not mode:
            raise ValueError("network feature is missing territory or mode identity")
        if mode in by_territory[key]:
            raise ValueError(f"duplicate network mode for territory {key[0]}/{key[1]}: {mode}")
        by_territory[key][mode] = feature
        base = _extent_bounds(feature.get("extent"))
        inspection = _extent_bounds(feature.get("inspection_extent"))
        if base != inspection:
            changed_territories.add(key)

    if not changed_territories:
        raise ValueError("contains no affected network inspection maps")

    selected = []
    expected_modes = set(NETWORK_MODES)
    for key in sorted(changed_territories):
        territory_features = by_territory[key]
        if set(territory_features) != expected_modes:
            raise ValueError(
                f"affected territory {key[0]}/{key[1]} must include all network modes"
            )
        frames = {
            _extent_bounds(feature["inspection_extent"])
            for feature in territory_features.values()
        }
        if len(frames) != 1:
            raise ValueError(
                f"affected territory {key[0]}/{key[1]} has inconsistent shared inspection frames"
            )
        selected.extend(territory_features[mode] for mode in NETWORK_MODES)

    return Binding("network", MapSet({"network-inspection-refresh": tuple(selected)}))


def select_refresh_spot_check_outputs(outputs, candidate_binding: Binding) -> list[dict]:
    """Choose all network modes for the largest frame expansion per territory kind."""
    features = tuple(
        feature
        for layer_features in candidate_binding.map_set.layers.values()
        for feature in layer_features
    )
    candidates = {}
    for feature in features:
        territory = feature["territory"]
        key = (str(territory["kind"]), str(territory["code"]))
        base, inspection = (_extent_bounds(feature.get("extent")),
                            _extent_bounds(feature.get("inspection_extent")))
        if base[2] <= base[0]:
            raise ValueError(f"territory {key[0]}/{key[1]} has an invalid analytical extent")
        factor = (inspection[2] - inspection[0]) / (base[2] - base[0])
        existing = candidates.get(key)
        if existing is not None and abs(existing["factor"] - factor) > 1e-10:
            raise ValueError(f"territory {key[0]}/{key[1]} has inconsistent frame expansion")
        candidates[key] = {"territory": territory, "factor": factor}
    if not candidates:
        raise ValueError("cannot select a visual spot check from an empty candidate binding")

    output_by_key = {}
    for item in outputs:
        key = (str(item["territory"]["kind"]), str(item["territory"]["code"]),
               str(item["mode"]))
        if item.get("profile") != "inspection" or key in output_by_key:
            raise ValueError("refresh outputs must contain unique inspection artifacts")
        output_by_key[key] = item

    selected_territories = {}
    for kind in sorted({key[0] for key in candidates}):
        key, details = min(
            ((key, value) for key, value in candidates.items() if key[0] == kind),
            key=lambda pair: (-pair[1]["factor"], pair[0][1]),
        )
        selected_territories[key] = details

    review = []
    for kind, code in sorted(selected_territories):
        for mode in NETWORK_MODES:
            item = output_by_key.get((kind, code, mode))
            if item is None:
                raise ValueError(f"spot-check output missing for {kind}/{code}/{mode}")
            review.append({field: item[field] for field in (
                "territory", "mode", "profile", "path", "effective_identity", "output_sha256")})
    return review
