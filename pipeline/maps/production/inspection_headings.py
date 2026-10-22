"""Explicit inspection-heading registration composed from family owners."""


def registered_inspection_headings(network_config):
    """Keep the approved three network templates plus selected car title."""
    from aedar_map_content import loss_map_content
    from network import NETWORK_MODES, _load_network_family_config, _title_and_content
    from qgis.PyQt.QtGui import QColor

    effective = _load_network_family_config()
    for key, value in network_config.items():
        if key in {"inspection", "marks"} and isinstance(value, dict):
            effective[key].update(value)
        else:
            effective[key] = value
    rows = [(f"network/{mode}", _title_and_content(mode, effective)[0])
            for mode in NETWORK_MODES]
    car = loss_map_content("car")
    rows.append(("aedar-car/car", (
        (car["title_prefix"], QColor("#273A37"), 0.55, False),
        (car["title_mode"], QColor("#57726F"), 1.0, True),
    )))
    return tuple((name, tuple((text, colour.getRgb(), opacity, solid)
        for text, colour, opacity, solid in runs)) for name, runs in rows)
