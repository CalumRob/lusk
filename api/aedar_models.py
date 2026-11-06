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

# The full comparison `measure` coordinate vocabulary: the 312 per-cell
# measures plus the two registry-wide aggregate readings.
AEDAR_COMPARISON_MEASURE_KEYS = frozenset(AEDAR_MEASURE_KEYS) | frozenset(AEDAR_AGGREGATE_READINGS)


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
