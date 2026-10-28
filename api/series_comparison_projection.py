"""Requested-only projection of existing ordered-series comparison evidence.

The ordinary reader/default stays unchanged. Fixed groups read their publication,
never reconstructing its medians from raw observations. Calendar details are not
aliases for OCS-GE's published state roles.
"""

from fastapi import HTTPException
from statistics import median

from api.cohort_reads import _bounded_count
from api.snapshot_reads import _comparison_cohort, _fixed_scalar_comparison_context


def _context(conn, item):
    descriptor = conn.execute("""SELECT d.dataset_id,d.axis_kind,d.axis_values,d.direction,
        d.comparison_statistic,d.comparison_scope,d.descriptor_version,
        p.content_version,p.reference_content_version,t.content_version
        FROM series_dataset_descriptor d JOIN series_dataset_publication p USING(dataset_id)
        JOIN table_publication t ON t.table_name='territory_reference'
        WHERE d.indicator_id=%s AND d.active_read_route""", (item.resource,)).fetchone()
    if not descriptor or descriptor[8] != descriptor[9]:
        raise HTTPException(503, "Series comparison descriptor/publication is unavailable")
    selection = ([(m.type, m.id) for m in item.intent.members]
                 if item.intent.kind == 'selected_comparison' else None)
    level, members, scope = _comparison_cohort(conn, item.target.type, item.target.id, selection)
    fixed = _fixed_scalar_comparison_context(conn, item.target.type, item.target.id,
                                            selection, level, members, scope)
    publication = conn.execute("""SELECT comparison_axes,ordered_series_content_version,
        reference_content_version FROM ordered_series_comparison_publication
        WHERE dataset_id=%s AND indicator_id=%s""", (descriptor[0], item.resource)).fetchone()
    if not publication or publication[1:] != descriptor[7:9]:
        raise HTTPException(503, "Series comparison axis publication is unavailable or stale")
    declared = publication[0]
    requested = item.coordinates or {}
    if requested and (len(requested) != 1 or next(iter(requested)) != descriptor[1]):
        raise HTTPException(422, "Series comparison coordinate axis differs from its native descriptor")
    axes = next(iter(requested.values())) if requested else declared
    if not set(axes) <= set(declared):
        raise HTTPException(422, "Series comparison coordinate is not a published comparison axis")
    axes = [axis for axis in declared if axis in axes]
    return descriptor, level, members, fixed, axes


def preflight_axis_comparisons(conn, item, budget):
    descriptor, level, members, fixed, axes = _context(conn, item)
    work = len(members) * len(axes)
    if work > budget:
        raise HTTPException(413, "Series comparison member/axis projection exceeds work limit")
    if fixed:
        extra = _bounded_count(conn, """SELECT 1 FROM ordered_series_comparison_lineage
            WHERE dataset_id=%s AND indicator_id=%s AND comparison_context=%s AND group_id=%s
              AND territory_type=%s AND axis_value=ANY(%s)""",
            (descriptor[0], item.resource, *fixed, axes), budget - work,
            "Series comparison lineage exceeds work limit")
    else:
        extra = _bounded_count(conn, """SELECT 1 FROM series_observation_provenance
            WHERE dataset_id=%s AND indicator_id=%s AND territory_id=ANY(%s) AND axis_value=ANY(%s)""",
            (descriptor[0], item.resource, list(members), axes), budget - work,
            "Series comparison lineage exceeds work limit")
    return max(1, work + extra)


def read_axis_comparisons(conn, item):
    descriptor, level, members, fixed, axes = _context(conn, item)
    if not fixed:
        return _selected_axes(conn, item, descriptor, level, members, axes)
    groups = conn.execute("""SELECT axis_value,statistic,group_value,member_count,eligible_count,
        missing_count,lineage_source_count FROM ordered_series_comparison_group
        WHERE dataset_id=%s AND indicator_id=%s AND comparison_context=%s AND group_id=%s
          AND territory_type=%s AND axis_value=ANY(%s)""", (descriptor[0], item.resource, *fixed, axes)).fetchall()
    rows = conn.execute("""SELECT axis_value,territory_id,value,status,rank,rank_size,tie_count
        FROM ordered_series_comparison_territory WHERE dataset_id=%s AND indicator_id=%s
          AND comparison_context=%s AND group_id=%s AND territory_type=%s AND axis_value=ANY(%s)
        ORDER BY territory_id""", (descriptor[0], item.resource, *fixed, axes)).fetchall()
    lineage = conn.execute("""SELECT l.axis_value,p.provenance_revision_id,p.source_id,p.vintage_id,
        p.source_name,p.dataset_name,p.source_version,p.reference_date,p.publication_date,p.revision_hash
        FROM ordered_series_comparison_lineage l JOIN series_provenance_revision p USING(provenance_revision_id)
        WHERE l.dataset_id=%s AND l.indicator_id=%s AND l.comparison_context=%s AND l.group_id=%s
          AND l.territory_type=%s AND l.axis_value=ANY(%s) ORDER BY l.axis_value,p.provenance_revision_id""",
        (descriptor[0], item.resource, *fixed, axes)).fetchall()
    result = []
    for axis in axes:
        matches = [g for g in groups if g[0] == axis]
        points = [r for r in rows if r[0] == axis]
        sources = [r for r in lineage if r[0] == axis]
        if len(matches) != 1:
            raise HTTPException(503, "Published series comparison axis is incomplete")
        _, statistic, value, count, eligible, missing, source_count = matches[0]
        measured = [p for p in points if p[3] == 'measured']
        if (count != len(members) or eligible + missing != count or len(measured) != eligible
                or {p[1] for p in points} != set(members) or len(points) != count
                or len(sources) != source_count or statistic != (descriptor[4] or 'median')
                or any(p[2] is None or p[4] is None or p[5] != eligible or p[6] is None
                       or not 1 <= p[4] <= eligible or not 1 <= p[6] <= eligible for p in measured)
                or any(p[2] is not None or any(v is not None for v in p[4:])
                       for p in points if p[3] != 'measured')):
            raise HTTPException(503, "Published series peer comparison evidence is inconsistent")
        available = eligible >= 2
        values = [p[2] for p in measured]
        result.append({"axis": axis, "statistic": statistic, "status": 'available' if available else 'unavailable',
            "value": value if available else None, "min": min(values) if available else None,
            "max": max(values) if available else None, "selected_member_count": count,
            "eligible_count": eligible, "missing_count": missing,
            "member_ranks": [{"territory_id": p[1], "rank": p[4] if available else None,
                              "rank_size": p[5] if available else None, "rank_ties": p[6] if available else None}
                             for p in points],
            "sources": [dict(zip(('revision_id','source_id','vintage_id','source_name','dataset_name','version',
                                  'reference_date','publication_date','revision_hash'), p[1:])) for p in sources]})
    return result


def _selected_axes(conn, item, descriptor, level, members, axes):
    """Existing explicit-selection policy: unique communes, min two; no fixed rebuild."""
    rows = conn.execute("""SELECT o.axis_value,o.territory_id,o.value,o.status,o.missing_reason,
        p.provenance_revision_id,p.source_id,p.vintage_id,p.source_name,p.dataset_name,p.source_version,
        p.reference_date,p.publication_date,p.revision_hash
        FROM series_dataset_observation o LEFT JOIN series_observation_provenance a
          USING(dataset_id,indicator_id,territory_id,axis_value)
        LEFT JOIN series_provenance_revision p USING(provenance_revision_id)
        WHERE o.dataset_id=%s AND o.indicator_id=%s AND o.territory_type=%s
          AND o.territory_id=ANY(%s) AND o.axis_value=ANY(%s)
        ORDER BY o.territory_id,p.provenance_revision_id""",
        (descriptor[0], item.resource, level, list(members), axes)).fetchall()
    statistic = descriptor[4] or 'median'
    mean = statistic == 'mean' and descriptor[5] == 'selected_group'
    result = []
    for axis in axes:
        matching = [r for r in rows if r[0] == axis]
        observations = {}
        sources = {}
        for row in matching:
            if (row[3] == 'measured' and row[5] is None) or (
                    row[1] in observations and observations[row[1]][2:5] != row[2:5]):
                raise HTTPException(503, 'Selected series comparison fact/provenance is inconsistent')
            observations[row[1]] = row
            if row[5] is not None:
                sources[row[5]] = row[5:]
        values = {member: observations[member][2] for member in members if member in observations
                  and observations[member][3] == 'measured' and observations[member][2] is not None}
        if mean and members and len(values) != len(members):
            raise HTTPException(503, 'Selected raccordement member curve is incomplete')
        available = len(values) >= 2
        group_value = (sum(values.values())/len(values) if mean else median(values.values())) if available else None
        result.append({'axis': axis, 'statistic': statistic, 'status': 'available' if available else 'unavailable',
            'value': group_value, 'min': min(values.values()) if available else None,
            'max': max(values.values()) if available else None, 'selected_member_count': len(members),
            'eligible_count': len(values), 'missing_count': len(members)-len(values),
            'member_ranks': [{'territory_id': member,
                'rank': 1+sum(v > values[member] if descriptor[3]=='high' else v < values[member]
                              for v in values.values()) if available and member in values else None,
                'rank_size': len(values) if available and member in values else None,
                'rank_ties': sum(v == values[member] for v in values.values()) if available and member in values else None}
                for member in members],
            'sources': [dict(zip(('revision_id','source_id','vintage_id','source_name','dataset_name','version',
                                  'reference_date','publication_date','revision_hash'), p)) for p in sources.values()]})
    return result
