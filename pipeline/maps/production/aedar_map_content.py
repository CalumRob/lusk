"""User-facing copy for exploratory AEDAR map variants."""
from __future__ import annotations


LOSS_MAP_CONTENT = {
    "car": {
        "title_prefix": "Diversité d’accès ",
        "title_mode": "en voiture",
        "helper": None,
        "legend_label": "Types d’équipements accessibles en 15 minutes",
        "regional_reference_label": "Moy. Bretagne",
    },
    "transit": {
        "title_prefix": "Diversité perdue ",
        "title_mode": "en transports",
        "helper": "Nombre de types d’équipements BPE accessibles en 15 minutes en voiture, mais pas en transports.",
        "legend_label": "Types d’équipements BPE",
        "regional_reference_label": None,
    },
    "bike_lts2": {
        "title_prefix": "Diversité perdue ",
        "title_mode": "à vélo (LTS 2)",
        "helper": "Nombre de types d’équipements BPE accessibles en 15 minutes en voiture, mais pas à vélo.",
        "legend_label": "Types d’équipements BPE",
        "regional_reference_label": None,
    },
    "bike_lts4": {
        "title_prefix": "Diversité perdue ",
        "title_mode": "à vélo (LTS 4)",
        "helper": "Nombre de types d’équipements BPE accessibles en 15 minutes en voiture, mais pas à vélo.",
        "legend_label": "Types d’équipements BPE",
        "regional_reference_label": None,
    },
    "walk": {
        "title_prefix": "Diversité perdue ",
        "title_mode": "à pied",
        "helper": "Nombre de types d’équipements BPE accessibles en 15 minutes en voiture, mais pas à pied.",
        "legend_label": "Types d’équipements BPE",
        "regional_reference_label": None,
    },
}


def loss_map_content(mode: str) -> dict[str, str | None]:
    """Return the approved title/helper copy for a car or car-loss map."""
    try:
        return dict(LOSS_MAP_CONTENT[mode])
    except KeyError as error:
        raise ValueError(f"Unsupported AEDAR loss-map mode: {mode}") from error
