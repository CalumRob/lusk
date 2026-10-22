"""Closed typed request grammar for semantic resource reads."""

from typing import Annotated, Literal, Union

from pydantic import BaseModel, ConfigDict, Field, model_validator


class TerritoryTarget(BaseModel):
    model_config = ConfigDict(extra="forbid")
    kind: Literal["territory"]
    type: Literal["commune", "epci", "departement", "region"]
    id: str = Field(min_length=1, max_length=32)


class NamedReferenceTarget(BaseModel):
    model_config = ConfigDict(extra="forbid")
    kind: Literal["named_reference"]
    id: str = Field(min_length=1, max_length=128)


ResourceTarget = Annotated[
    Union[TerritoryTarget, NamedReferenceTarget], Field(discriminator="kind")
]


class TerritoryMember(BaseModel):
    model_config = ConfigDict(extra="forbid")
    type: Literal["commune", "epci", "departement", "region"]
    id: str = Field(min_length=1, max_length=32)


class FactsIntent(BaseModel):
    model_config = ConfigDict(extra="forbid")
    kind: Literal["facts"]


class FixedComparisonIntent(BaseModel):
    model_config = ConfigDict(extra="forbid")
    kind: Literal["fixed_comparison"]
    context: str = Field(min_length=1, max_length=64)


class SelectedComparisonIntent(BaseModel):
    model_config = ConfigDict(extra="forbid")
    kind: Literal["selected_comparison"]
    members: list[TerritoryMember] = Field(max_length=1500)

    @model_validator(mode="after")
    def validate_unique_members(self):
        identities = [(member.type, member.id) for member in self.members]
        if len(identities) != len(set(identities)):
            raise ValueError("selected comparison members must be unique")
        return self


ResourceIntent = Annotated[
    Union[FactsIntent, FixedComparisonIntent, SelectedComparisonIntent],
    Field(discriminator="kind"),
]


class ResourceReadItem(BaseModel):
    """One stable item shape; the batch adds only its correlation ID."""
    model_config = ConfigDict(extra="forbid")
    resource: str = Field(pattern=r"^[a-z][a-z0-9_]{0,95}$")
    target: ResourceTarget
    coordinates: dict[str, list[str]] | None = None
    fields: list[str] | None = Field(default=None, max_length=32)
    intent: ResourceIntent

    @model_validator(mode="after")
    def validate_coordinate_selection(self):
        if self.fields is not None and (not self.fields or len(self.fields) != len(set(self.fields))):
            raise ValueError("fields must be omitted or contain non-empty unique field names")
        if self.coordinates is None:
            return self
        if not self.coordinates:
            raise ValueError("coordinates must be omitted or contain a non-empty axis selection")
        for axis, values in self.coordinates.items():
            if not axis or not values or len(values) != len(set(values)):
                raise ValueError("coordinate axes require non-empty unique value lists")
        return self


class ResourceBatchItem(ResourceReadItem):
    id: str = Field(min_length=1, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")


class ResourceBatchRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    items: list[ResourceBatchItem] = Field(min_length=1, max_length=12)

    @model_validator(mode="after")
    def validate_unique_ids(self):
        ids = [item.id for item in self.items]
        if len(ids) != len(set(ids)):
            raise ValueError("Batch item ids must be unique")
        return self
