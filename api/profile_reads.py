"""Focal-only declared profiles inside the caller's read-only DB snapshot."""
from fastapi import HTTPException


def focal_profiles(conn, territory_type, territory_id, *, theme_id=None, indicator_id=None, include_cells=True):
    descriptors = conn.execute("""SELECT indicator_id,label,unit,allowed_levels,descriptor_version,
        comparison_detail,comparison_sex,comparison_direction,comparison_scalar,required_scalar_version,denominator_semantics,detail_units_required
        FROM profile_descriptor WHERE (%s::text IS NULL OR theme_id=%s)
          AND (%s::text IS NULL OR indicator_id=%s) AND %s=ANY(allowed_levels)
        ORDER BY indicator_id""", (theme_id, theme_id, indicator_id, indicator_id, territory_type)).fetchall()
    if not descriptors:
        return [], None
    marker = conn.execute("""SELECT p.content_version,p.reference_content_version,t.content_version
        FROM table_publication p LEFT JOIN table_publication t ON t.table_name='territory_reference'
        WHERE p.table_name='declared_profile'""").fetchone()
    if not marker or not marker[0] or not marker[1] or marker[1] != marker[2]:
        raise HTTPException(503, 'Profile publication is unavailable or incompatible')
    dependencies = [d[8] for d in descriptors if d[8] is not None]
    if dependencies:
        scalar_marker = conn.execute("""SELECT content_version,reference_content_version
            FROM table_publication WHERE table_name='scalar_observation'""").fetchone()
        scalar_descriptors = {r[0]: r[1:] for r in conn.execute("""SELECT indicator_id,unit,direction,
            allowed_levels,comparison_facet FROM scalar_descriptor WHERE indicator_id=ANY(%s)""", (dependencies,)).fetchall()}
        for d in descriptors:
            if d[8] is None:
                continue
            facet = scalar_descriptors.get(d[8])
            if (not scalar_marker or scalar_marker[0] != d[9] or scalar_marker[1] != marker[2]
                    or not facet or facet[0] != d[2] or facet[1] != d[7]
                    or not set(d[3]).issubset(facet[2]) or facet[3] != d[8]):
                raise HTTPException(503, 'Profile scalar dependency is stale or incompatible')
    if not include_cells:
        return [{'indicator': d[0], 'comparison_scalar': d[8]} for d in descriptors if d[8]], marker[0]
    ids = [d[0] for d in descriptors]
    axes_by_id = {}
    for row in conn.execute("""SELECT indicator_id,axis_name,axis_key,label,ordinal,unit FROM profile_axis
        WHERE indicator_id=ANY(%s) ORDER BY indicator_id,axis_name,ordinal""", (ids,)).fetchall():
        axes_by_id.setdefault(row[0], []).append(row[1:])
    cells_by_id = {}
    for row in conn.execute("""SELECT o.indicator_id,o.detail_key,o.sex_key,o.value,o.status,
        COALESCE((SELECT json_agg(json_build_object('source_id',os.source_id,'vintage_id',os.vintage_id,
          'name',sd.name,'version',sv.version,'reference_date',sv.reference_date,'publication_date',sv.publication_date)
          ORDER BY os.source_id,os.vintage_id) FROM profile_observation_source os
          JOIN source_dataset sd USING(source_id) JOIN source_vintage sv USING(source_id,vintage_id)
          WHERE os.indicator_id=o.indicator_id AND os.territory_id=o.territory_id
            AND os.detail_key=o.detail_key AND os.sex_key=o.sex_key),'[]'::json)
        FROM profile_observation o WHERE o.indicator_id=ANY(%s) AND o.territory_id=%s AND o.territory_type=%s""",
        (ids, territory_id, territory_type)).fetchall():
        cells_by_id.setdefault(row[0], []).append(row[1:])
    profiles = []
    for d in descriptors:
        axes = axes_by_id.get(d[0], [])
        details = [a[1] for a in axes if a[0] == 'detail']
        sexes = [a[1] for a in axes if a[0] == 'sex']
        if (not details or any(a[0] not in ('detail', 'sex') for a in axes)
                or any([a[3] for a in axes if a[0] == name] != list(range(len([a for a in axes if a[0] == name])))
                       for name in ('detail', 'sex'))):
            raise HTTPException(503, 'Profile axes are invalid')
        if d[8] is None and (d[5] not in details or (d[6] not in sexes if sexes else d[6] is not None)):
            raise HTTPException(503, 'Profile comparison point is invalid')
        rows = cells_by_id.get(d[0], [])
        detail_units = {}
        for axis_name, key, _label, _order, unit in axes:
            if axis_name != 'detail':
                continue
            if d[11]:
                if unit is None or not str(unit).strip():
                    raise HTTPException(503, 'Profile detail units are unavailable')
                detail_units[key] = unit
            else:
                # Legacy homogeneous profiles predate per-axis units. Their
                # descriptor unit is the contract; migration 014 backfills it,
                # and this fallback also handles older NULL-unit snapshots.
                if not d[2] or (unit is not None and unit != d[2]):
                    raise HTTPException(503, 'Legacy profile unit contract is incompatible')
                detail_units[key] = unit if unit is not None else d[2]
        if set(detail_units) != set(details):
            raise HTTPException(503, 'Profile detail units are unavailable')
        expected = [(detail, sex) for detail in details for sex in (sexes or [''])]
        cells = {(r[0], r[1]): r for r in rows}
        if len(cells) != len(rows) or set(cells) != set(expected):
            raise HTTPException(503, 'Profile publication is incomplete')
        if any(not row[4] for row in rows):
            raise HTTPException(503, 'Profile cell provenance is unavailable')
        comparison_unit = detail_units.get(d[5], d[2])
        profiles.append({'indicator': d[0], 'label': d[1], 'unit': d[2], 'denominator_semantics': d[10], 'descriptor_version': d[4],
            'content_version': marker[0], 'comparison_scalar': d[8], 'required_scalar_version': d[9],
            'comparison_point': None if d[8] else {'detail': d[5], 'sex': d[6], 'direction': d[7], 'unit': comparison_unit},
            'axes': [{'name': name, 'key': key, 'label': label, 'order': order,
                      'unit': detail_units[key] if name == 'detail' else unit} for name,key,label,order,unit in axes],
            'cells': [{'detail': detail, 'sex': sex or None, 'unit': detail_units[detail], 'denominator_semantics': d[10], 'value': cells[(detail,sex)][2],
                       'status': cells[(detail,sex)][3], 'sources': cells[(detail,sex)][4]} for detail,sex in expected]})
    return profiles, marker[0]
