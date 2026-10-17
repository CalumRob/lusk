"""Resolve explicit comparison targets to a bounded canonical commune set."""


class ComparisonInputError(ValueError):
    """An explicit target set cannot resolve to a valid publication cohort."""


def resolve_commune_members(reference, selected, *, max_members):
    """Resolve territory identities to unique communes in one reference snapshot."""
    if not isinstance(max_members, int) or isinstance(max_members, bool) or max_members < 2:
        raise ComparisonInputError("Invalid member bound")
    targets = tuple(selected)
    if not targets or len(targets) > max_members or len(set(targets)) != len(targets):
        raise ComparisonInputError("Invalid territory selection")
    by_target = {(row["type"], row["territoire"]): row for row in reference}
    if len(by_target) != len(reference):
        raise ComparisonInputError("Ambiguous territory reference")
    communes = [row for row in reference if row["type"] == "commune"]
    members = set()
    for level, code in targets:
        if (level, code) not in by_target:
            raise ComparisonInputError("Unknown selected territory")
        if level == "commune":
            matched = [code]
        elif level == "epci":
            matched = [row["territoire"] for row in communes if row.get("epci") == code]
        elif level == "departement":
            matched = [row["territoire"] for row in communes if row.get("departement") == code]
        elif level == "region":
            matched = [row["territoire"] for row in communes]
        else:
            raise ComparisonInputError("Unsupported territory level")
        if not matched:
            raise ComparisonInputError("Selected territory has no member communes")
        members.update(matched)
        if len(members) > max_members:
            raise ComparisonInputError("Unbounded commune selection")
    return tuple(sorted(members))
