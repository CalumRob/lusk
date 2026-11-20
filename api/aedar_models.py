"""Typed response contracts for source-grain AEDAR reads."""

from datetime import date
from typing import Literal

from pydantic import BaseModel, Field, field_validator


AEDAR_MEASURE_KEYS = {
    f"count_{duration}_{mode}_{statistic}"
    for duration in (5, 10, 15, 20)
    for mode in ("walk", "transit", "transit_gain", "bike_lts2", "bike_lts4", "car")
    for statistic in ("share", "min", "max", *(f"decile{i}" for i in range(1, 10)), "mean")
}

# Registry-wide aggregate readings: sum the per-type share/mean over the
# complete TYPEQU registry. The 5 displayed mode identities and 4 horizons
# are a projection of the producer's existing measure coordinates; the
# additional transit_gain family is intentionally not a display mode.
AEDAR_AGGREGATE_MODES = ("walk", "transit", "bike_lts2", "bike_lts4", "car")
AEDAR_AGGREGATE_HORIZONS = (5, 10, 15, 20)

def _aedar_aggregate_key(mode, horizon, kind):
    if mode == "car" and horizon == 15:
        return "meanDiversity" if kind == "diversity" else "meanVolume"
    return f"{mode}{horizon}{'Diversity' if kind == 'diversity' else 'Volume'}"

AEDAR_AGGREGATE_READINGS = {
    _aedar_aggregate_key(mode, horizon, kind):
        f"count_{horizon}_{mode}_{'share' if kind == 'diversity' else 'mean'}"
    for mode in AEDAR_AGGREGATE_MODES
    for horizon in AEDAR_AGGREGATE_HORIZONS
    for kind in ("diversity", "volume")
}

# Declared Cellule axes for the two AEDAR families (#1076). They share
# `horizon` and `mode`; `statistic` belongs only to the 312-key aggregate and
# `kind` only to the 40 summary readings. Their product rebuilds the source
# measure vocabulary exactly — no family can satisfy the other's point.
AEDAR_MEASURE_HORIZONS = tuple(str(value) for value in AEDAR_AGGREGATE_HORIZONS)
AEDAR_MEASURE_MODES = ("walk", "transit", "transit_gain", "bike_lts2", "bike_lts4", "car")
AEDAR_MEASURE_STATISTICS = (
    "share", "min", "max", *(f"decile{i}" for i in range(1, 10)), "mean")
AEDAR_SUMMARY_KINDS = ("diversity", "volume")


def aedar_axes_match_registered_measures():
    """The declared aggregate axes reconstruct the registered 312 keys exactly."""
    rebuilt = {
        f"count_{horizon}_{mode}_{statistic}"
        for horizon in AEDAR_MEASURE_HORIZONS
        for mode in AEDAR_MEASURE_MODES
        for statistic in AEDAR_MEASURE_STATISTICS
    }
    return rebuilt == AEDAR_MEASURE_KEYS


# One family vocabulary, shared by discovery declarations, admission and the
# reader. The old ``measure`` union let one selector span both families; a
# declared Cellule resolves to exactly one of these before any read.
AEDAR_PER_CELL_FAMILY = "aedar_per_cell"
AEDAR_SUMMARY_FAMILY = "aedar_summary"

# Declared Cellule axes per resource kind. `typequ` is a real coordinate of the
# aggregate Cellule — equipment × horizon × mode × statistic — not a side list.
AEDAR_CELLULE_AXES = {
    "aedar_source_grain": ("typequ", "horizon", "mode", "statistic"),
    "aedar_territory_summary": ("horizon", "mode", "kind"),
}

class AEDARAddressError(ValueError):
    """A declared AEDAR address is not well formed or crosses family lines."""


def aedar_measure_family(measures):
    """Name the one declared family a *legacy* measure selector belongs to.

    Retained only for the deprecated alias below and for internal diagnostics.
    No API address uses ``measure`` any more: :func:`resolve_aedar_address`
    is the single translation from declared coordinates to a family.
    """
    requested = set(measures)
    if not requested:
        return None
    if requested <= AEDAR_MEASURE_KEYS:
        return AEDAR_PER_CELL_FAMILY
    if requested <= set(AEDAR_AGGREGATE_READINGS):
        return AEDAR_SUMMARY_FAMILY
    return None


# Deprecated: published symbol kept as an alias for callers that still build a
# measure vocabulary. Its replacement is the declared Cellule coordinates
# (``resolve_aedar_address``), never a union selector crossing the families.
AEDAR_COMPARISON_MEASURE_KEYS = frozenset(AEDAR_MEASURE_KEYS) | frozenset(AEDAR_AGGREGATE_READINGS)


def resolve_aedar_address(resource_kind, coordinates):
    """Translate declared Cellule coordinates to the internal read selectors.

    Returns ``(typequ, measures, family)``. ``typequ`` and ``measures`` are the
    selectors the existing snapshot readers consume; ``measures`` is ``None``
    for a legacy, measure-free ``typequ``-scoped facts read, which addresses no
    Cellule and keeps returning every published measure of that equipment type.

    A ``measure`` coordinate is never an address: it is rejected by name so a
    measure-key string cannot cross the API boundary and so a summary facet
    sent to the aggregate (or the reverse) fails instead of resolving.
    """
    coords = coordinates or {}
    if "measure" in coords:
        raise AEDARAddressError(
            "measure is not an AEDAR Cellule address; declare horizon, mode and "
            "statistic (per-cell) or horizon, mode and kind (summary)")
    axes = AEDAR_CELLULE_AXES[resource_kind]
    legacy_axes = {"context"} if resource_kind == "aedar_source_grain" else set()
    unknown = set(coords) - set(axes) - legacy_axes
    if unknown:
        raise AEDARAddressError(f"coordinate axis is not declared for AEDAR: {sorted(unknown)}")

    def one(axis):
        values = coords.get(axis)
        if not isinstance(values, (list, tuple)) or len(values) != 1 or not values[0]:
            raise AEDARAddressError(f"an AEDAR Cellule names exactly one {axis}")
        return str(values[0])

    if resource_kind == "aedar_source_grain":
        if {"horizon", "mode", "statistic"} & set(coords):
            missing = {"horizon", "mode", "statistic"} - set(coords)
            if missing:
                raise AEDARAddressError(
                    f"per-cell Cellule is missing {sorted(missing)} coordinate(s)")
            measure = f"count_{one('horizon')}_{one('mode')}_{one('statistic')}"
            if measure not in AEDAR_MEASURE_KEYS:
                raise AEDARAddressError("coordinate combination does not name a declared per-cell measure")
            return coords.get("typequ"), [measure], AEDAR_PER_CELL_FAMILY
        # Legacy, measure-free read of every measure for one or more typequ.
        return coords.get("typequ"), None, AEDAR_PER_CELL_FAMILY

    if {"horizon", "mode", "kind"} & set(coords):
        missing = {"horizon", "mode", "kind"} - set(coords)
        if missing:
            raise AEDARAddressError(
                f"summary Cellule is missing {sorted(missing)} coordinate(s)")
        mode, horizon, kind = one("mode"), one("horizon"), one("kind")
        if (mode not in AEDAR_AGGREGATE_MODES or horizon not in AEDAR_MEASURE_HORIZONS
                or kind not in AEDAR_SUMMARY_KINDS):
            raise AEDARAddressError("coordinate combination does not name a declared AEDAR summary")
        reading = _aedar_aggregate_key(mode, int(horizon), kind)
        if reading not in AEDAR_AGGREGATE_READINGS:
            raise AEDARAddressError("coordinate combination does not name a declared AEDAR summary")
        return None, [reading], AEDAR_SUMMARY_FAMILY
    return None, None, AEDAR_SUMMARY_FAMILY


class ThemeTerritorySelection(BaseModel):
    territory_type: Literal["commune", "epci", "departement", "region"]
    territory_id: str = Field(min_length=1, max_length=32)


class AEDARFactResponse(BaseModel):
    territory_id: str
    territory_type: Literal["commune", "epci", "departement", "region"]
    typequ: str
    typequ_label: str
    typequ_hierarchy_label: str
    typequ_description: str
    typequ_domain_code: str
    typequ_domain_label: str
    typequ_subdomain_code: str
    typequ_subdomain_label: str
    typequ_gamme: str | None
    typequ_gamme_status: Literal["classified", "hors_gamme", "absent"]
    typequ_source_order: int = Field(ge=1, le=235)
    identity: dict[str, str | None]
    n_addresses: int = Field(ge=0)
    n_observed: int = Field(ge=0)
    coverage_status: str
    measures: dict[str, float | None]
    source_id: str
    vintage_id: str
    source_url: str
    licence: str
    attribution: str
    reference_date: date | None
    publication_date: date | None

    @field_validator("measures")
    @classmethod
    def exact_aedar_measure_schema(cls, value):
        if not set(value) <= AEDAR_MEASURE_KEYS:
            raise ValueError("AEDAR fact contains an unregistered measure")
        return value


class AEDARTerritorialAggregateResponse(BaseModel):
    territory: ThemeTerritorySelection
    content_version: str
    reference_content_version: str
    limit: int = Field(ge=1, le=100)
    offset: int = Field(ge=0, le=10000)
    facts: list[AEDARFactResponse]
