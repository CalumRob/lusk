"""Central typed publication-outcome contract for semantic batch reads (#984).

A declared resource may have no usable publication yet. Under the v1 batch
contract that is a request-wide ``503``. The v2 contract turns *that exact,
explicitly classified* condition into one correlated
``publication_unavailable`` result while every other failure keeps the v1
whole-request semantics.

Only guards that mean "this resource publication is absent / not offered" may
raise :class:`PublicationUnavailable`. The outcome family is always derived from
the producer resource declaration (``family_for_resource``), never from the
lookup that failed. The type is the classification: the API never inspects an
exception message, never catches ``HTTPException`` broadly and never converts a
database error into an outcome. Guards that indicate a present but
contradictory/global state (snapshot clocks, provenance, reference identity,
malformed rows, SQL/schema faults) keep raising plain ``503`` (or the
appropriate ``404``/``422``) and abort the whole request.
"""

from fastapi import HTTPException


# Closed set of resource families a publication outcome can name. A cohort
# target is not a family of its own: its outcome names the declared resource
# family it reads (scalar, profile, ordered_series, ...).
UNAVAILABLE_FAMILIES = frozenset({
    "scalar",
    "profile",
    "ordered_series",
    "named_reference",
    "typed_reading",
    "collection",
    "aedar",
})


def family_for_resource(resource) -> str:
    """One family name derived from the producer declaration, never a lookup.

    Every guard for the same declared resource must use this mapping. A failed
    descriptor lookup, a missing dataset publication or a comparison intent
    must not rename the resource's family.
    """
    kind = getattr(resource, "resource_kind", "")
    shapes = set(getattr(resource, "shapes", ()))
    if kind == "typed_reading":
        return "typed_reading"
    if kind in {"aedar_source_grain", "aedar_territory_summary"}:
        return "aedar"
    if "declared_profile" in shapes:
        return "profile"
    if "named_reference" in shapes and "ordered_series" not in shapes:
        return "named_reference"
    if "ordered_series" in shapes:
        return "ordered_series"
    if "period_detail" in shapes or "anchored_membership" in shapes:
        return "collection"
    return "scalar"

# One closed reason code. It names the *kind* of absence, not a human message:
# the required publication marker/descriptor/rows are not present, or the
# declared read route is not currently offered. Consumers must not parse
# ``detail``.
PUBLICATION_ABSENT = "publication_absent"
UNAVAILABLE_REASONS = frozenset({PUBLICATION_ABSENT})


class PublicationUnavailable(HTTPException):
    """A classified, item-scoped publication gap.

    Subclasses ``HTTPException`` so the v1 single/batch routes and every
    existing error contract keep returning the same ``503`` detail. The v2
    batch executor is the only caller that inspects this type.
    """

    def __init__(self, family: str, detail: str, *, reason: str = PUBLICATION_ABSENT):
        if family not in UNAVAILABLE_FAMILIES:
            raise ValueError(f"Unknown publication family: {family!r}")
        if reason not in UNAVAILABLE_REASONS:
            raise ValueError(f"Unknown publication reason: {reason!r}")
        super().__init__(503, detail)
        self.family = family
        self.reason = reason
        self.detail = detail

    def outcome(self) -> dict:
        """The correlated v2 result fields; no data and no invented versions."""
        return {"status": "publication_unavailable",
                "reason": self.reason, "family": self.family}


def publication_unavailable(family: str, detail: str) -> None:
    """Raise the classified item-scoped publication gap."""
    raise PublicationUnavailable(family, detail)
