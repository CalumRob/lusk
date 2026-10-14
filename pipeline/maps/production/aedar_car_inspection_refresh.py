"""Selection and evidence helpers for affected AEDAR car inspection outputs."""
from collections.abc import Mapping

from runner import Binding, MapSet


def acquire_aedar_car_inspection_context(features, context_root, *, acquire=None):
    """Acquire the exact official context covering selected AEDAR inspection frames."""
    if acquire is None:
        from mainland_context import acquire_context
        acquire = acquire_context
    from inspection_frame import shared_ground_extent
    extent = shared_ground_extent(features, ("inspection",))
    bbox = (extent.xMinimum(), extent.yMinimum(), extent.xMaximum(), extent.yMaximum())
    return acquire(context_root, bbox)


def _bounds(value):
    if value is None:
        raise ValueError("AEDAR car inspection refresh requires analytical and inspection extents")
    accessors = ("xMinimum", "yMinimum", "xMaximum", "yMaximum")
    if all(callable(getattr(value, name, None)) for name in accessors):
        return tuple(float(getattr(value, name)()) for name in accessors)
    try:
        result = tuple(float(part) for part in value)
    except (TypeError, ValueError) as error:
        raise ValueError("map extents must expose four numeric bounds") from error
    if len(result) != 4:
        raise ValueError("map extents must expose four numeric bounds")
    return result


def select_affected_aedar_car_inspection_binding(full_binding: Binding) -> Binding:
    """Select the live full-binding car features whose shared inspection frame changed."""
    if not isinstance(full_binding, Binding) or full_binding.family != "aedar":
        raise ValueError("AEDAR car inspection refresh requires a complete AEDAR binding")
    layers = full_binding.map_set.layers
    layer_names = set(layers)
    allowed_layers = ({"car-diversity"}, {"car-diversity-inspection-refresh"},
                      {"aedar-static-selected"}, {"aedar-static-car-inspection-refresh"})
    if layer_names not in allowed_layers:
        raise ValueError("AEDAR car inspection refresh accepts only the car-diversity layer")

    selected = []
    seen = set()
    layer_name = next(iter(layer_names))
    for feature in layers[layer_name]:
        territory = feature.get("territory")
        if not isinstance(territory, Mapping):
            raise ValueError("AEDAR car feature is missing territory identity")
        key = (str(territory.get("kind", "")), str(territory.get("code", "")))
        if not all(key) or feature.get("mode") != "car":
            raise ValueError("AEDAR car-diversity feature has invalid territory or mode identity")
        if key in seen:
            raise ValueError(f"duplicate AEDAR car feature for {key[0]}/{key[1]}")
        seen.add(key)
        if _bounds(feature.get("extent")) != _bounds(feature.get("inspection_extent")):
            selected.append(feature)
    if not selected:
        raise ValueError("contains no affected AEDAR car inspection maps")
    return Binding("aedar", MapSet({"aedar-static-car-inspection-refresh": tuple(selected)}))
