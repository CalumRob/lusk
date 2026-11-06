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

# Registry-wide overview aggregate readings served as request-time comparison
# facets (ADR-0039's 2026-11-04 aggregate-ranks amendment, #914): each reading
# is the sum of its per-type measure over the complete published TYPEQU
# registry of a member, computed per request from `aedar_territorial_aggregate`
# — never a new publication. meanDiversity = Σ count_15_car_share
# (types / address); meanVolume = Σ count_15_car_mean (establishments /
# address); both are high-is-better ranked comparison facets.
AEDAR_AGGREGATE_READINGS = {
    "meanDiversity": "count_15_car_share",
    "meanVolume": "count_15_car_mean",
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
