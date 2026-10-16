"""Small typed field-selection contract for bounded serving resources."""

from fastapi import HTTPException


def normalize_field_selection(requested: list[str] | None, allowed: set[str]) -> tuple[str, ...] | None:
    """Validate repeated logical fields; ``None`` preserves the full response."""
    if requested is None:
        return None
    if not requested or any(not field for field in requested):
        raise HTTPException(422, "fields must contain at least one field")
    if len(set(requested)) != len(requested):
        raise HTTPException(422, "fields must not contain duplicates")
    unknown = sorted(set(requested) - allowed)
    if unknown:
        raise HTTPException(422, f"Unknown or non-selectable fields: {', '.join(unknown)}")
    return tuple(sorted(requested))
