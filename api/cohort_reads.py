"""Bounded semantic facts over a producer-declared territory population."""

from dataclasses import dataclass

from fastapi import HTTPException


@dataclass(frozen=True)
class TerritoryCohort:
    territory_type: str
    department_id: str | None
    epci_id: str | None
    members: tuple[dict, ...]
    reference_content_version: str

    @property
    def territory_ids(self):
        return [member["id"] for member in self.members]

    def envelope(self):
        return {
            "territory_type": self.territory_type,
            "department_id": self.department_id,
            "epci_id": self.epci_id,
            "member_count": len(self.members),
            "members": list(self.members),
            "reference_content_version": self.reference_content_version,
        }


def resolve_territory_cohort(conn, target, *, work_budget):
    """Resolve only a declared-level population from the published reference."""
    marker = conn.execute("""SELECT content_version,row_count FROM table_publication
        WHERE table_name='territory_reference'""").fetchone()
    if not marker or not marker[0] or int(marker[1]) < 1:
        raise HTTPException(503, "Territory reference publication is unavailable")

    if target.department_id is not None:
        parent = conn.execute("""SELECT 1 FROM territory_reference
            WHERE territory_id=%s AND territory_type='departement'""",
            (target.department_id,)).fetchone()
        if not parent:
            raise HTTPException(422, "Cohort department filter is not a published department")
    if target.epci_id is not None:
        parent = conn.execute("""SELECT 1 FROM territory_reference
            WHERE territory_id=%s AND territory_type='epci'""", (target.epci_id,)).fetchone()
        if not parent:
            raise HTTPException(422, "Cohort EPCI filter is not a published EPCI")

    clauses = ["territory_type=%s"]
    params = [target.type]
    if target.department_id is not None:
        clauses.append("department_id=%s")
        params.append(target.department_id)
    if target.epci_id is not None:
        clauses.append("epci_id=%s")
        params.append(target.epci_id)
    limit = max(0, work_budget) + 1
    rows = conn.execute("""SELECT territory_id,territory_type,name FROM territory_reference
        WHERE """ + " AND ".join(clauses) + " ORDER BY territory_id LIMIT %s",
        (*params, limit)).fetchall()
    if len(rows) > work_budget:
        raise HTTPException(413, "Cohort population exceeds the bounded work limit")
    members = tuple({"id": row[0], "type": row[1], "name": row[2]} for row in rows)
    return TerritoryCohort(target.type, target.department_id, target.epci_id,
                           members, marker[0])


def _bounded_count(conn, query, params, budget, message):
    if budget < 0:
        raise HTTPException(413, "Resource request exceeds the bounded work limit")
    count = int(conn.execute("SELECT count(*) FROM (" + query + " LIMIT %s) AS bounded_rows",
                             (*params, budget + 1)).fetchone()[0])
    if count > budget:
        raise HTTPException(413, message)
    return count


def _bounded_fact_summary(conn, query, params, budget, message):
    if budget < 0:
        raise HTTPException(413, "Resource request exceeds the bounded work limit")
    facts, members = conn.execute("SELECT count(*),count(DISTINCT territory_id) FROM (" + query +
        " LIMIT %s) AS bounded_rows", (*params, budget + 1)).fetchone()
    if int(facts) > budget:
        raise HTTPException(413, message)
    return int(facts), int(members)


def _scalar_contract(conn, resource_id, territory_type, cohort):
    descriptor = conn.execute("""SELECT indicator_id,theme_id,label,unit,direction,
        comparison_facet,allowed_levels,denominator_semantics,completeness,descriptor_version
        FROM scalar_descriptor WHERE indicator_id=%s""", (resource_id,)).fetchone()
    if not descriptor:
        raise HTTPException(503, "Declared scalar publication is unavailable")
    if territory_type not in descriptor[6]:
        raise HTTPException(422, "Indicator is not declared for this cohort level")
    marker = conn.execute("""SELECT p.content_version,p.reference_content_version,t.content_version
        FROM table_publication p LEFT JOIN table_publication t
          ON t.table_name='territory_reference'
        WHERE p.table_name='scalar_observation'""").fetchone()
    if not marker or not marker[0] or not marker[1] or marker[1] != marker[2] or marker[1] != cohort.reference_content_version:
        raise HTTPException(503, "Scalar publication is stale or incompatible")
    return descriptor, marker


def preflight_scalar_cohort(conn, item, resource, cohort, fields, work_budget):
    descriptor, _marker = _scalar_contract(conn, item.resource, item.target.type, cohort)
    remaining = work_budget - len(cohort.members)
    ids = cohort.territory_ids
    facts = _bounded_count(conn, """SELECT 1 FROM scalar_observation o
        WHERE o.indicator_id=%s AND o.territory_type=%s AND o.territory_id=ANY(%s::text[])""",
        (item.resource, item.target.type, ids), remaining,
        "Cohort scalar observations exceed the bounded work limit")
    remaining -= facts
    provenance = _bounded_count(conn, """SELECT 1 FROM scalar_observation_source s
        WHERE s.indicator_id=%s AND s.territory_id=ANY(%s::text[])""",
        (item.resource, ids), remaining,
        "Cohort scalar provenance exceeds the bounded work limit")
    return max(1, len(cohort.members) + facts + provenance)


def read_scalar_cohort(conn, item, resource, cohort, fields):
    descriptor, marker = _scalar_contract(conn, item.resource, item.target.type, cohort)
    selected = set(fields) if fields is not None else {"value", "support_count", "denominator_count"}
    optional_columns = {
        "value": "o.value AS value",
        "support_count": "o.support_count AS support_count",
        "denominator_count": "o.denominator_count AS denominator_count",
    }
    projection = ["o.territory_id", "o.territory_type", "t.name AS territory_name"]
    projection.extend(optional_columns[field] for field in ("value", "support_count", "denominator_count")
                      if field in selected)
    projection.extend(("o.status", "s.source_id", "sd.name AS source_name", "s.vintage_id", "v.version",
                      "v.reference_date", "v.publication_date"))
    cursor = conn.execute("""SELECT """ + ",".join(projection) + """
        FROM scalar_observation o
        JOIN territory_reference t ON t.territory_id=o.territory_id
          AND t.territory_type=o.territory_type
        LEFT JOIN scalar_observation_source s ON s.indicator_id=o.indicator_id
          AND s.territory_id=o.territory_id
        LEFT JOIN source_dataset sd ON sd.source_id=s.source_id
        LEFT JOIN source_vintage v ON v.source_id=s.source_id AND v.vintage_id=s.vintage_id
        WHERE o.indicator_id=%s AND o.territory_type=%s AND o.territory_id=ANY(%s::text[])
        ORDER BY o.territory_id,s.source_id,s.vintage_id""",
        (item.resource, item.target.type, cohort.territory_ids))
    names = [column.name for column in cursor.description]
    grouped = {}
    for row in cursor.fetchall():
        values = dict(zip(names, row))
        territory_id = values["territory_id"]
        fact = grouped.setdefault(territory_id, {
            "territory": {"id": territory_id, "type": values["territory_type"],
                          "name": values["territory_name"]},
            "status": values["status"], "sources": [],
        })
        for field in selected:
            if field in optional_columns:
                fact[field] = values[field]
        if not values["source_id"] or not values["source_name"] or not values["version"]:
            raise HTTPException(503, "Scalar observation provenance is incomplete")
        fact["sources"].append({
            "source_id": values["source_id"], "name": values["source_name"],
            "vintage_id": values["vintage_id"], "version": values["version"],
            "reference_date": values["reference_date"],
            "publication_date": values["publication_date"],
        })
    desc = dict(zip(("indicator_id", "theme_id", "label", "unit", "direction",
                     "comparison_facet", "allowed_levels", "denominator_semantics",
                     "completeness", "descriptor_version"), descriptor))
    observations = list(grouped.values())
    if any(not fact["sources"] for fact in observations):
        raise HTTPException(503, "Scalar observation provenance is incomplete")
    return {"resource": item.resource, "target": item.target.model_dump(),
        "shape": "scalar", "cohort": cohort.envelope(),
        "content_version": marker[0], "reference_content_version": marker[1],
        "descriptor": desc, "observations": observations}


def _profile_context(conn, item, cohort, fields):
    # Reuse the current profile contract validator, including scalar dependency
    # versions, rather than introducing another descriptor authority.
    from api.profile_reads import focal_profiles

    profiles, version = focal_profiles(conn, item.target.type, "", indicator_id=item.resource,
        include_cells=False, fields=fields, include_all_descriptors=True)
    if len(profiles) != 1:
        raise HTTPException(503, "Declared profile publication is unavailable")
    descriptor = conn.execute("""SELECT indicator_id,theme_id,label,unit,allowed_levels,completeness,
        descriptor_version,comparison_detail,comparison_sex,comparison_direction,comparison_scalar,
        required_scalar_version,denominator_semantics,detail_units_required
        FROM profile_descriptor WHERE indicator_id=%s""", (item.resource,)).fetchone()
    if not descriptor:
        raise HTTPException(503, "Declared profile publication is unavailable")
    if item.target.type not in descriptor[4]:
        raise HTTPException(422, "Profile is not declared for this cohort level")
    axes = conn.execute("""SELECT axis_name,axis_key,label,ordinal,unit FROM profile_axis
        WHERE indicator_id=%s ORDER BY axis_name,ordinal""", (item.resource,)).fetchall()
    axes_by_name = {}
    for axis, key, label, ordinal, unit in axes:
        axes_by_name.setdefault(axis, []).append({"name": axis, "key": key, "label": label,
                                                  "order": ordinal, "unit": unit})
    details = axes_by_name.get("detail", [])
    sexes = axes_by_name.get("sex", [])
    if (not details or any(axis not in {"detail", "sex"} for axis in axes_by_name)
            or any(entry["order"] != index for axis in axes_by_name.values()
                   for index, entry in enumerate(axis))):
        raise HTTPException(503, "Profile axes are invalid")
    if descriptor[13]:
        if any(not entry["unit"] or not str(entry["unit"]).strip() for entry in details):
            raise HTTPException(503, "Profile detail units are unavailable")
        detail_units = {entry["key"]: entry["unit"] for entry in details}
    else:
        if not descriptor[3] or any(entry["unit"] is not None and entry["unit"] != descriptor[3]
                                    for entry in details):
            raise HTTPException(503, "Legacy profile unit contract is incompatible")
        detail_units = {entry["key"]: entry["unit"] or descriptor[3] for entry in details}
    if set(detail_units) != {entry["key"] for entry in details}:
        raise HTTPException(503, "Profile detail units are unavailable")

    coordinates = item.coordinates or {}
    selected_details = [entry["key"] for entry in details
                        if "detail" not in coordinates or entry["key"] in coordinates["detail"]]
    selected_sexes = [entry["key"] for entry in sexes
                      if "sex" not in coordinates or entry["key"] in coordinates["sex"]]
    if not sexes:
        selected_sexes = [""]
    if not selected_details or not selected_sexes:
        raise HTTPException(422, "Profile coordinate selection is empty")
    marker = conn.execute("""SELECT content_version,reference_content_version FROM table_publication
        WHERE table_name='declared_profile'""").fetchone()
    if not marker or marker[0] != version or marker[1] != cohort.reference_content_version:
        raise HTTPException(503, "Profile publication is unavailable or incompatible")
    return descriptor, marker, axes_by_name, detail_units, selected_details, selected_sexes


def preflight_profile_cohort(conn, item, resource, cohort, fields, work_budget):
    descriptor, _marker, _axes, _units, details, sexes = _profile_context(
        conn, item, cohort, fields)
    expected = len(cohort.members) * len(details) * len(sexes)
    remaining = work_budget - len(cohort.members)
    params = (item.resource, item.target.type, cohort.territory_ids, details, sexes)
    facts = _bounded_count(conn, """SELECT 1 FROM profile_observation o
        WHERE o.indicator_id=%s AND o.territory_type=%s AND o.territory_id=ANY(%s::text[])
          AND o.detail_key=ANY(%s::text[]) AND o.sex_key=ANY(%s::text[])""",
        params, remaining, "Cohort profile observations exceed the bounded work limit")
    if facts != expected:
        raise HTTPException(503, "Declared profile population is incomplete")
    remaining -= facts
    sources = _bounded_count(conn, """SELECT 1 FROM profile_observation_source s
        JOIN profile_observation o USING(indicator_id,territory_id,detail_key,sex_key)
        WHERE s.indicator_id=%s AND o.territory_type=%s AND o.territory_id=ANY(%s::text[])
          AND s.detail_key=ANY(%s::text[]) AND s.sex_key=ANY(%s::text[])""",
        params, remaining, "Cohort profile provenance exceeds the bounded work limit")
    if sources < facts:
        raise HTTPException(503, "Profile cell provenance is unavailable")
    return max(1, len(cohort.members) + facts + sources)


def read_profile_cohort(conn, item, resource, cohort, fields):
    descriptor, marker, axes_by_name, detail_units, details, sexes = _profile_context(
        conn, item, cohort, fields)
    project_value = fields is None or "value" in fields
    cursor = conn.execute("""SELECT o.territory_id,o.territory_type,t.name,o.detail_key,o.sex_key,
        CASE WHEN %s THEN o.value ELSE NULL::double precision END AS value,o.status,
        s.source_id,sd.name AS source_name,s.vintage_id,v.version,v.reference_date,v.publication_date
        FROM profile_observation o JOIN territory_reference t
          ON t.territory_id=o.territory_id AND t.territory_type=o.territory_type
        LEFT JOIN profile_observation_source s ON s.indicator_id=o.indicator_id
          AND s.territory_id=o.territory_id AND s.detail_key=o.detail_key AND s.sex_key=o.sex_key
        LEFT JOIN source_dataset sd ON sd.source_id=s.source_id
        LEFT JOIN source_vintage v ON v.source_id=s.source_id AND v.vintage_id=s.vintage_id
        WHERE o.indicator_id=%s AND o.territory_type=%s AND o.territory_id=ANY(%s::text[])
          AND o.detail_key=ANY(%s::text[]) AND o.sex_key=ANY(%s::text[])
        ORDER BY o.territory_id,array_position(%s::text[],o.detail_key),array_position(%s::text[],o.sex_key),
          s.source_id,s.vintage_id""",
        (project_value, item.resource, item.target.type, cohort.territory_ids,
         details, sexes, details, sexes))
    names = [column.name for column in cursor.description]
    grouped = {}
    for row in cursor.fetchall():
        value = dict(zip(names, row))
        territory_id = value["territory_id"]
        key = (territory_id, value["detail_key"], value["sex_key"])
        cell = grouped.setdefault(key, {
            "detail": value["detail_key"], "sex": value["sex_key"] or None,
            "unit": detail_units[value["detail_key"]],
            "denominator_semantics": descriptor[12], "status": value["status"], "sources": [],
        })
        if project_value:
            cell["value"] = value["value"]
        if not value["source_id"] or not value["source_name"] or not value["version"]:
            raise HTTPException(503, "Profile cell provenance is unavailable")
        cell["sources"].append({"source_id": value["source_id"],
            "vintage_id": value["vintage_id"], "name": value["source_name"],
            "version": value["version"], "reference_date": value["reference_date"],
            "publication_date": value["publication_date"]})

    members = []
    for member in cohort.members:
        cells = []
        for detail in details:
            for sex in sexes:
                cell = grouped.get((member["id"], detail, sex))
                if not cell or not cell["sources"]:
                    raise HTTPException(503, "Declared profile population is incomplete")
                cells.append(cell)
        members.append({"territory": member, "cells": cells})
    desc = {
        "indicator": descriptor[0], "label": descriptor[2], "unit": descriptor[3],
        "allowed_levels": descriptor[4], "completeness": descriptor[5],
        "descriptor_version": descriptor[6], "comparison_scalar": descriptor[10],
        "required_scalar_version": descriptor[11], "denominator_semantics": descriptor[12],
        "axes": [{**axis, "unit": detail_units[axis["key"]] if axis["name"] == "detail" else axis["unit"]}
                 for axis in (*axes_by_name.get("detail", []), *axes_by_name.get("sex", []))],
        "comparison_point": (None if descriptor[10] else {
            "detail": descriptor[7], "sex": descriptor[8], "direction": descriptor[9],
            "unit": detail_units.get(descriptor[7], descriptor[3])}),
    }
    return {"resource": item.resource, "target": item.target.model_dump(),
        "shape": "declared_profile", "cohort": cohort.envelope(),
        "content_version": marker[0], "reference_content_version": marker[1],
        "descriptor": desc, "profiles": members}


def _indicator_shape(conn, item, resource):
    from api.observed_collections import collection_descriptors
    from api.snapshot_reads import _owned_series_route

    route = _owned_series_route(conn, item.resource) if "ordered_series" in resource.shapes else None
    if route and not route[2]:
        return "owned_series", route
    collections = collection_descriptors(conn, indicator_id=item.resource)
    if collections:
        shapes = []
        for relation, shape in (("scalar_descriptor", "scalar"),
                                ("profile_descriptor", "declared_profile"),
                                ("series_descriptor", "legacy_series")):
            if conn.execute("SELECT to_regclass(%s)", (relation,)).fetchone()[0] and conn.execute(
                    f"SELECT 1 FROM {relation} WHERE indicator_id=%s", (item.resource,)).fetchone():
                shapes.append(shape)
        if shapes:
            raise HTTPException(503, "Indicator has ambiguous collection/storage declarations")
        return collections[0]["kind"], collections[0]
    shapes = []
    for relation, shape in (("scalar_descriptor", "scalar"),
                            ("profile_descriptor", "declared_profile"),
                            ("series_descriptor", "legacy_series")):
        if conn.execute("SELECT to_regclass(%s)", (relation,)).fetchone()[0] and conn.execute(
                f"SELECT 1 FROM {relation} WHERE indicator_id=%s", (item.resource,)).fetchone():
            shapes.append(shape)
    if len(shapes) != 1:
        raise HTTPException(503, "Indicator has ambiguous or unavailable published storage shapes")
    shape = shapes[0]
    declared = {"legacy_series": "ordered_series"}.get(shape, shape)
    if declared not in resource.shapes:
        raise HTTPException(503, "Published storage shape differs from its producer declaration")
    return shape, None


def _selected_axis_values(item, axis, declared):
    coordinates = item.coordinates or {}
    selected = coordinates.get(axis)
    values = [str(value) for value in declared]
    return [value for value in values if selected is None or value in set(selected)]


def _owned_series_context(conn, item, resource, cohort):
    from api.snapshot_reads import _owned_series_route

    route = _owned_series_route(conn, item.resource)
    if not route or route[2]:
        raise HTTPException(503, "Owned-series cohort route is unavailable")
    dataset_id, _theme_id, _is_reference, indicator_id, _reference_id = route
    marker = conn.execute("""SELECT p.content_version,p.reference_content_version,p.row_count,
        p.published_at,t.content_version FROM series_dataset_publication p
        CROSS JOIN table_publication t WHERE p.dataset_id=%s AND t.table_name='territory_reference'""",
        (dataset_id,)).fetchone()
    if not marker or not marker[0] or marker[1] != marker[4] or marker[1] != cohort.reference_content_version:
        raise HTTPException(503, "Owned-series publication is stale or unavailable")
    descriptor = conn.execute("""SELECT axis_kind,axis_values,axis_numeric_values,completeness,label,unit,
        direction,descriptor_version,allowed_levels,comparison_point,theme_id,observation_period_kind,
        COALESCE(to_jsonb(series_dataset_descriptor)->>'absence_semantics','unavailable')
        FROM series_dataset_descriptor WHERE dataset_id=%s AND indicator_id=%s AND active_read_route""",
        (dataset_id, indicator_id)).fetchone()
    if not descriptor:
        raise HTTPException(503, "Owned-series active publication route is unavailable")
    if item.target.type not in descriptor[8]:
        raise HTTPException(422, "Owned series is not declared for this cohort level")
    axes = _selected_axis_values(item, descriptor[0], descriptor[1])
    if not axes:
        raise HTTPException(422, "Series coordinate selection is empty")
    return route, marker, descriptor, axes


def preflight_owned_series_cohort(conn, item, resource, cohort, fields, work_budget):
    route, marker, descriptor, axes = _owned_series_context(conn, item, resource, cohort)
    budget = work_budget - len(cohort.members)
    params = (route[0], route[3], item.target.type, cohort.territory_ids, axes)
    facts, populated_members = _bounded_fact_summary(conn, """SELECT o.territory_id
        FROM series_dataset_observation o
        WHERE o.dataset_id=%s AND o.indicator_id=%s AND o.territory_type=%s
          AND o.territory_id=ANY(%s::text[]) AND o.axis_value=ANY(%s::text[])""",
        params, budget, "Cohort ordered-series facts exceed the bounded work limit")
    if descriptor[3] == "dense_complete" and facts != len(cohort.members) * len(axes):
        raise HTTPException(503, "Owned-series cohort is incomplete")
    axis_work = (populated_members if descriptor[12] == "no_record" and
                 descriptor[3] == "may_be_missing" else len(cohort.members)) * len(axes)
    budget = work_budget - len(cohort.members) - axis_work
    if budget < 0:
        raise HTTPException(413, "Cohort ordered-series axes exceed the bounded work limit")
    provenance = _bounded_count(conn, """SELECT 1 FROM series_observation_provenance p
        WHERE p.dataset_id=%s AND p.indicator_id=%s AND p.territory_id=ANY(%s::text[])
          AND p.axis_value=ANY(%s::text[])""",
        (route[0], route[3], cohort.territory_ids, axes), budget,
        "Cohort ordered-series provenance exceeds the bounded work limit")
    if provenance < facts:
        raise HTTPException(503, "Owned-series provenance is incomplete")
    return max(1, len(cohort.members) + axis_work + provenance)


def read_owned_series_cohort(conn, item, resource, cohort, fields):
    route, marker, descriptor, axes = _owned_series_context(conn, item, resource, cohort)
    project_value = fields is None or "value" in fields
    cursor = conn.execute("""SELECT o.territory_id,o.territory_type,t.name,o.axis_value,o.observation_period,
        CASE WHEN %s THEN o.value ELSE NULL::double precision END AS value,o.status,o.missing_reason,o.state_role,
        p.provenance_revision_id,p.source_id,p.vintage_id,p.source_name,p.dataset_name,p.source_version,
        p.reference_date,p.publication_date,p.revision_hash
        FROM series_dataset_observation o JOIN territory_reference t
          ON t.territory_id=o.territory_id AND t.territory_type=o.territory_type
        LEFT JOIN series_observation_provenance a ON a.dataset_id=o.dataset_id
          AND a.indicator_id=o.indicator_id AND a.territory_id=o.territory_id AND a.axis_value=o.axis_value
        LEFT JOIN series_provenance_revision p USING(provenance_revision_id)
        WHERE o.dataset_id=%s AND o.indicator_id=%s AND o.territory_type=%s
          AND o.territory_id=ANY(%s::text[]) AND o.axis_value=ANY(%s::text[])
        ORDER BY o.territory_id,array_position(%s::text[],o.axis_value),p.provenance_revision_id""",
        (project_value, route[0], route[3], item.target.type, cohort.territory_ids,
         axes, list(descriptor[1])))
    names = [column.name for column in cursor.description]
    grouped = {}
    for row in cursor.fetchall():
        value = dict(zip(names, row))
        key = (value["territory_id"], value["axis_value"])
        point = grouped.setdefault(key, {
            "axis": value["axis_value"], "observation_period": value["observation_period"],
            "status": value["status"], "missing_reason": value["missing_reason"],
            "provenance": [],
        })
        if (point["observation_period"], point["status"], point["missing_reason"]) != (
                value["observation_period"], value["status"], value["missing_reason"]):
            raise HTTPException(503, "Owned-series fact conflicts across provenance rows")
        if project_value:
            if "value" in point and point["value"] != value["value"]:
                raise HTTPException(503, "Owned-series value conflicts across provenance rows")
            point["value"] = value["value"]
        if value["provenance_revision_id"] is None or not value["source_id"] or not value["source_version"]:
            raise HTTPException(503, "Owned-series provenance is incomplete")
        point["provenance"].append({"revision_id": value["provenance_revision_id"],
            "source_id": value["source_id"], "vintage_id": value["vintage_id"],
            "source_name": value["source_name"], "dataset_name": value["dataset_name"],
            "version": value["source_version"], "reference_date": value["reference_date"],
            "publication_date": value["publication_date"], "revision_hash": value["revision_hash"]})
        if value["state_role"] is not None:
            point["state_role"] = value["state_role"]

    series = []
    for member in cohort.members:
        observations = [grouped.get((member["id"], axis)) for axis in axes]
        present = [point for point in observations if point is not None]
        if not present and descriptor[12] == "no_record" and descriptor[3] == "may_be_missing":
            points = []
            availability = "no_record"
        else:
            points = []
            for axis, point in zip(axes, observations):
                if point is None:
                    if descriptor[3] == "dense_complete":
                        raise HTTPException(503, "Owned-series declared axis point is missing")
                    missing = {"axis": axis, "observation_period": None, "status": "missing",
                               "missing_reason": None, "provenance": []}
                    if project_value:
                        missing["value"] = None
                    points.append(missing)
                else:
                    points.append(point)
            availability = "complete" if all(point["status"] == "measured" for point in points) else "incomplete"
        territory = dict(member)
        series.append({"territory": territory, "availability": availability, "points": points})
    desc = {"dataset_id": route[0], "theme_id": descriptor[10], "axis_kind": descriptor[0],
        "axis_values": descriptor[1], "axis_numeric_values": descriptor[2],
        "completeness": descriptor[3], "absence_semantics": descriptor[12],
        "label": descriptor[4], "unit": descriptor[5], "direction": descriptor[6],
        "descriptor_version": descriptor[7], "allowed_levels": descriptor[8],
        "comparison_point": descriptor[9], "observation_period_kind": descriptor[11]}
    return {"resource": item.resource, "target": item.target.model_dump(),
        "shape": "ordered_series", "cohort": cohort.envelope(),
        "content_version": marker[0], "reference_content_version": marker[1],
        "descriptor": desc, "series": series}


def _legacy_series_context(conn, item, cohort):
    marker = conn.execute("""SELECT s.content_version,s.reference_content_version,t.content_version
        FROM table_publication s LEFT JOIN table_publication t
          ON t.table_name='territory_reference' WHERE s.table_name='ordered_series'""").fetchone()
    if not marker or not marker[0] or marker[1] != marker[2] or marker[1] != cohort.reference_content_version:
        raise HTTPException(503, "Series publication is unavailable or incompatible")
    descriptor = conn.execute("""SELECT axis_kind,axis_values,completeness,comparison_point,label,unit,
        direction,source_id,vintage_id,descriptor_version,allowed_levels
        FROM series_descriptor WHERE indicator_id=%s""", (item.resource,)).fetchone()
    if not descriptor:
        raise HTTPException(503, "Series descriptor is unavailable")
    if item.target.type not in descriptor[10]:
        raise HTTPException(422, "Series is not declared for this cohort level")
    axes = _selected_axis_values(item, descriptor[0], descriptor[1])
    if not axes:
        raise HTTPException(422, "Series coordinate selection is empty")
    return marker, descriptor, axes


def preflight_legacy_series_cohort(conn, item, resource, cohort, fields, work_budget):
    marker, descriptor, axes = _legacy_series_context(conn, item, cohort)
    axis_work = len(cohort.members) * len(axes)
    remaining = work_budget - len(cohort.members) - axis_work
    if remaining < 0:
        raise HTTPException(413, "Cohort ordered-series axes exceed the bounded work limit")
    params = (item.resource, item.target.type, cohort.territory_ids, axes)
    facts = _bounded_count(conn, """SELECT 1 FROM ordered_series o
        WHERE o.indicator_id=%s AND o.territory_type=%s AND o.territory_id=ANY(%s::text[])
          AND o.axis_value=ANY(%s::text[])""",
        params, axis_work, "Cohort ordered-series facts exceed the bounded work limit")
    if descriptor[2] == "dense_complete" and facts != len(cohort.members) * len(axes):
        raise HTTPException(503, "Series cohort is incomplete")
    # The legacy series contract has one descriptor-owned source/vintage per point.
    if not descriptor[7] or not descriptor[8]:
        raise HTTPException(503, "Series source provenance is unavailable")
    if facts > remaining:
        raise HTTPException(413, "Cohort ordered-series provenance exceeds the bounded work limit")
    return max(1, len(cohort.members) + axis_work + facts)


def read_legacy_series_cohort(conn, item, resource, cohort, fields):
    marker, descriptor, axes = _legacy_series_context(conn, item, cohort)
    project_value = fields is None or "value" in fields
    cursor = conn.execute("""SELECT o.territory_id,o.territory_type,t.name,o.axis_value,o.observation_period,
        CASE WHEN %s THEN o.value ELSE NULL::double precision END AS value,o.status,o.source_id,o.vintage_id,
        v.version,v.reference_date,v.publication_date
        FROM ordered_series o JOIN territory_reference t
          ON t.territory_id=o.territory_id AND t.territory_type=o.territory_type
        LEFT JOIN source_vintage v ON v.source_id=o.source_id AND v.vintage_id=o.vintage_id
        WHERE o.indicator_id=%s AND o.territory_type=%s AND o.territory_id=ANY(%s::text[])
          AND o.axis_value=ANY(%s::text[])
        ORDER BY o.territory_id,array_position(%s::text[],o.axis_value)""",
        (project_value, item.resource, item.target.type, cohort.territory_ids, axes,
         list(descriptor[1])))
    names = [column.name for column in cursor.description]
    by_member = {}
    for raw in cursor.fetchall():
        row = dict(zip(names, raw))
        if not row["version"]:
            raise HTTPException(503, "Series source provenance is unavailable")
        points = by_member.setdefault(row["territory_id"], {})
        if row["axis_value"] in points:
            raise HTTPException(503, "Series contains duplicate axis facts")
        point = {"axis": row["axis_value"], "status": row["status"],
            "observation_period": row["observation_period"], "source_id": row["source_id"],
            "vintage_id": row["vintage_id"], "source_version": row["version"],
            "source_reference_date": row["reference_date"],
            "source_publication_date": row["publication_date"]}
        if project_value:
            point["value"] = row["value"]
        points[row["axis_value"]] = point
    series = []
    for member in cohort.members:
        actual = by_member.get(member["id"], {})
        if descriptor[2] == "dense_complete" and set(actual) != set(axes):
            raise HTTPException(503, "Series cohort is incomplete")
        points = []
        for axis in axes:
            point = actual.get(axis)
            if point is None:
                point = {"axis": axis, "status": "missing", "observation_period": None,
                         "source_id": descriptor[7], "vintage_id": descriptor[8],
                         "source_version": None, "source_reference_date": None,
                         "source_publication_date": None}
                if project_value:
                    point["value"] = None
            points.append(point)
        series.append({"territory": dict(member), "points": points,
            "availability": "complete" if all(p["status"] == "measured" for p in points) else "incomplete"})
    desc = {"axis_kind": descriptor[0], "axis_values": descriptor[1],
        "completeness": descriptor[2], "comparison_point": descriptor[3],
        "label": descriptor[4], "unit": descriptor[5], "direction": descriptor[6],
        "source_id": descriptor[7], "vintage_id": descriptor[8],
        "descriptor_version": descriptor[9], "allowed_levels": descriptor[10]}
    return {"resource": item.resource, "target": item.target.model_dump(),
        "shape": "ordered_series", "cohort": cohort.envelope(),
        "content_version": marker[0], "reference_content_version": marker[1],
        "descriptor": desc, "series": series}


def _collection_context(conn, item, cohort, descriptor):
    from api.observed_collections import collection_marker

    if item.target.type not in descriptor["allowed_levels"]:
        raise HTTPException(422, "Collection is not declared for this cohort level")
    marker = collection_marker(conn, descriptor)
    if marker["reference_content_version"] != cohort.reference_content_version:
        raise HTTPException(503, "Observed collection publication is incompatible with the cohort")
    coordinates = item.coordinates or {}
    categories = conn.execute("""SELECT detail_key,label,ordinal,source_id,rider_label
        FROM observed_collection_category WHERE indicator_id=%s ORDER BY ordinal""",
        (item.resource,)).fetchall()
    if not categories:
        raise HTTPException(503, "Collection coordinate descriptor is unavailable")
    details = [row[0] for row in categories]
    selected_details = [key for key in details
                        if "detail" not in coordinates and "membership" not in coordinates
                        or key in coordinates.get("detail", coordinates.get("membership", []))]
    if not selected_details:
        raise HTTPException(422, "Collection coordinate selection is empty")
    periods = None
    if descriptor["kind"] == "period_detail":
        if "period" in coordinates:
            periods = coordinates["period"]
    return marker, categories, selected_details, periods


def preflight_period_detail_cohort(conn, item, resource, descriptor, cohort, fields, work_budget):
    _marker, _categories, details, periods = _collection_context(conn, item, cohort, descriptor)
    remaining = work_budget - len(cohort.members)
    clauses = ["indicator_id=%s", "territory_type=%s", "territory_id=ANY(%s::text[])",
               "detail_key=ANY(%s::text[])"]
    params = [item.resource, item.target.type, cohort.territory_ids, details]
    if periods is not None:
        clauses.append("observation_period=ANY(%s::text[])")
        params.append(periods)
    facts = _bounded_count(conn, "SELECT 1 FROM period_detail_observation WHERE " + " AND ".join(clauses),
        tuple(params), remaining, "Cohort period/detail facts exceed the bounded work limit")
    if facts:
        return max(1, len(cohort.members) + facts * 2)
    return max(1, len(cohort.members))


def read_period_detail_cohort(conn, item, resource, descriptor, cohort, fields):
    marker, _categories, details, periods = _collection_context(conn, item, cohort, descriptor)
    project_value = fields is None or "value" in fields
    params = [project_value, item.resource, cohort.territory_type, cohort.territory_ids, details]
    period_clause = ""
    if periods is not None:
        period_clause = " AND o.observation_period=ANY(%s::text[])"
        params.append(periods)
    cursor = conn.execute("""SELECT o.territory_id,o.detail_key,c.label,o.observation_period,
        CASE WHEN %s THEN o.value ELSE NULL::double precision END AS value,o.source_id,sd.name AS source_name,
        o.vintage_id,v.version,v.reference_date,v.publication_date,c.ordinal
        FROM period_detail_observation o JOIN observed_collection_category c USING(indicator_id,detail_key)
        JOIN source_dataset sd ON sd.source_id=o.source_id
        JOIN source_vintage v ON v.source_id=o.source_id AND v.vintage_id=o.vintage_id
        WHERE o.indicator_id=%s AND o.territory_type=%s AND o.territory_id=ANY(%s::text[])
          AND o.detail_key=ANY(%s::text[])""" + period_clause + " ORDER BY o.territory_id,o.observation_period,c.ordinal",
        tuple(params))
    names = [column.name for column in cursor.description]
    entries = {}
    for raw in cursor.fetchall():
        row = dict(zip(names, raw))
        entry = {"detail": row["detail_key"], "label": row["label"],
            "observation_period": row["observation_period"], "status": "measured",
            "sources": [{"source_id": row["source_id"], "name": row["source_name"],
                "vintage_id": row["vintage_id"], "version": row["version"],
                "reference_date": row["reference_date"], "publication_date": row["publication_date"]}]}
        if project_value:
            entry["value"] = row["value"]
        entries.setdefault(row["territory_id"], []).append(entry)
    populations = []
    for member in cohort.members:
        rows = entries.get(member["id"], [])
        populations.append({"territory": dict(member), "completeness": "observed_sparse",
            "availability": "observed" if rows else "no_record", "entries": rows})
    return {"resource": item.resource, "target": item.target.model_dump(),
        "shape": "period_detail", "cohort": cohort.envelope(),
        "content_version": marker["content_version"],
        "reference_content_version": marker["reference_content_version"],
        "descriptor": descriptor, "territories": populations}


def _membership_cohort_query(projection):
    return f"""SELECT {projection}
        FROM territory_reference f
        JOIN anchored_membership m ON m.indicator_id=%s
        JOIN territory_reference a ON a.territory_id=m.territory_id
        JOIN observed_collection_category c
          ON c.indicator_id=m.indicator_id AND c.detail_key=m.detail_key
        JOIN source_dataset sd ON sd.source_id=m.source_id
        JOIN source_vintage v ON v.source_id=m.source_id AND v.vintage_id=m.vintage_id
        WHERE f.territory_type=%s AND f.territory_id=ANY(%s::text[])
          AND m.detail_key=ANY(%s::text[]) AND (
            a.territory_id=f.territory_id
            OR (f.territory_type='commune' AND a.territory_id=(
                SELECT epci_id FROM territory_reference WHERE territory_id=f.territory_id
                  AND territory_type='commune'))
            OR (f.territory_type='epci' AND a.territory_type='commune' AND a.epci_id=f.territory_id)
            OR (f.territory_type='departement' AND (
                (a.territory_type='commune' AND a.department_id=f.territory_id)
                OR (a.territory_type='epci' AND EXISTS(
                    SELECT 1 FROM territory_reference member
                    WHERE member.epci_id=a.territory_id AND member.department_id=f.territory_id))))
            OR f.territory_type='region')"""


def preflight_membership_cohort(conn, item, resource, descriptor, cohort, fields, work_budget):
    _marker, _categories, details, _periods = _collection_context(conn, item, cohort, descriptor)
    remaining = work_budget - len(cohort.members)
    facts = _bounded_count(conn, _membership_cohort_query("1"),
        (item.resource, item.target.type, cohort.territory_ids, details), remaining,
        "Cohort membership relationships exceed the bounded work limit")
    return max(1, len(cohort.members) + facts * 2)


def read_membership_cohort(conn, item, resource, descriptor, cohort, fields):
    marker, _categories, details, _periods = _collection_context(conn, item, cohort, descriptor)
    project_rider = fields is None or "rider" in fields
    project_anchor_count = fields is None or "anchor_count" in fields
    projection = """f.territory_id AS focal_id,a.territory_id AS anchor_id,a.territory_type AS anchor_type,
        a.name AS anchor_name,m.detail_key,c.label,
        CASE WHEN %s AND m.convention_valant_ort THEN c.rider_label ELSE NULL END AS rider,
        m.source_id,sd.name AS source_name,m.vintage_id,v.version,v.reference_date,v.publication_date,
        c.ordinal"""
    cursor = conn.execute(_membership_cohort_query(projection) +
        " ORDER BY f.territory_id,c.ordinal,a.territory_id",
        (project_rider, item.resource, item.target.type, cohort.territory_ids, details))
    names = [column.name for column in cursor.description]
    by_focal = {member["id"]: {"entries": [], "relationships": [], "summaries": {}}
                for member in cohort.members}
    for raw in cursor.fetchall():
        row = dict(zip(names, raw))
        result = by_focal[row["focal_id"]]
        entry = {"detail": row["detail_key"], "label": row["label"],
                 **({"rider": row["rider"]} if project_rider else {}),
                 "sources": [{"source_id": row["source_id"], "name": row["source_name"],
                     "vintage_id": row["vintage_id"], "version": row["version"],
                     "reference_date": row["reference_date"],
                     "publication_date": row["publication_date"]}]}
        summary = result["summaries"].setdefault(row["detail_key"], {
            "detail": row["detail_key"], "label": row["label"],
            **({"anchor_count": 0} if project_anchor_count else {})})
        if project_anchor_count:
            summary["anchor_count"] += 1
        if row["anchor_id"] == row["focal_id"]:
            result["entries"].append(entry)
        else:
            relation = "covering_parent" if item.target.type == "commune" else "member_anchor"
            result["relationships"].append({**entry, "anchor": {
                "id": row["anchor_id"], "type": row["anchor_type"], "name": row["anchor_name"]},
                "relation": relation})

    territories = []
    for member in cohort.members:
        result = by_focal[member["id"]]
        entries, relationships = result["entries"], result["relationships"]
        territories.append({"territory": dict(member), "completeness": "observed_sparse",
            "availability": "observed" if entries or relationships else "no_record",
            "entries": entries, "relationships": relationships,
            "summaries": list(result["summaries"].values())})
    return {"resource": item.resource, "target": item.target.model_dump(),
        "shape": "anchored_membership", "cohort": cohort.envelope(),
        "content_version": marker["content_version"],
        "reference_content_version": marker["reference_content_version"],
        "descriptor": descriptor, "territories": territories}


def _typed_reading_context(conn, item, resource, cohort):
    reference = conn.execute("SELECT content_version FROM table_publication WHERE table_name='territory_reference'").fetchone()
    marker = conn.execute("""SELECT content_version,row_count,reference_content_version
        FROM table_publication WHERE table_name=%s""", (resource.publication_table,)).fetchone()
    if (not reference or reference[0] != cohort.reference_content_version or not marker or
            not marker[0] or marker[1] < 1 or marker[2] != reference[0]):
        raise HTTPException(503, "Typed-reading publication is unavailable or stale")
    if item.target.type not in resource.allowed_levels:
        raise HTTPException(422, "Typed reading is not declared for this cohort level")
    if not conn.execute("SELECT to_regclass(%s)", (resource.storage_relation,)).fetchone()[0]:
        raise HTTPException(503, "Typed-reading storage is unavailable")
    if resource.publication_table == "selected_reading":
        owner_marker = conn.execute("""SELECT content_version,row_count,reference_content_version
            FROM selected_reading_publication WHERE theme_id=%s""", (resource.theme_id,)).fetchone()
        if not owner_marker or tuple(owner_marker) != tuple(marker):
            raise HTTPException(503, "Selected-reading publication is inconsistent")

    for side in resource.side_relations:
        if not conn.execute("SELECT to_regclass(%s)", (side["storage_relation"],)).fetchone()[0]:
            raise HTTPException(503, "Typed-reading evidence storage is unavailable")
        side_marker = conn.execute("""SELECT content_version,reference_content_version
            FROM table_publication WHERE table_name=%s""", (side["publication_table"],)).fetchone()
        if not side_marker or side_marker[1] != reference[0]:
            raise HTTPException(503, "Typed-reading evidence publication is unavailable or stale")
        if ((side["publication_table"] == resource.publication_table or
             side.get("same_content_version_as") == "resource") and side_marker[0] != marker[0]):
            raise HTTPException(503, "Typed-reading evidence publication is incompatible")
    return marker


def _typed_cohort_filters(item, cohort, group_filter=True):
    clauses = ["territory_type=%s", "territory_id=ANY(%s::text[])"]
    params = [cohort.territory_type, cohort.territory_ids]
    groups = (item.coordinates or {}).get("groupe")
    if group_filter and groups:
        clauses.append("groupe=ANY(%s::text[])")
        params.append(groups)
    return " AND ".join(clauses), tuple(params)


def preflight_typed_reading_cohort(conn, item, resource, cohort, work_budget):
    _typed_reading_context(conn, item, resource, cohort)
    remaining = work_budget - len(cohort.members)
    where, params = _typed_cohort_filters(item, cohort)
    facts = _bounded_count(conn, f"SELECT 1 FROM {resource.storage_relation} WHERE {where}",
        params, remaining, "Cohort typed-reading facts exceed the bounded work limit")
    work = len(cohort.members) + facts
    selected = set(item.fields or resource.fields)
    for side in resource.side_relations:
        # Evidence is only read/charged when selected, except absence evidence,
        # which must always be checked against its primary reading.
        if side["field"] not in selected and side["field"] != "source_absences":
            continue
        remaining = work_budget - work
        where, params = _typed_cohort_filters(item, cohort, "groupe" in side["fields"])
        count = _bounded_count(conn, f"SELECT 1 FROM {side['storage_relation']} WHERE {where}",
            params, remaining, "Cohort typed-reading evidence exceeds the bounded work limit")
        work += count
    return max(1, work)


def read_typed_reading_cohort(conn, item, resource, cohort):
    marker = _typed_reading_context(conn, item, resource, cohort)
    selected = set(item.fields or resource.fields)
    evidence_fields = {side["field"] for side in resource.side_relations}
    fact_fields = [field for field in resource.fields if field in selected and field not in evidence_fields]
    facts_by_member = {member["id"]: [] for member in cohort.members}
    members_with_facts = set()
    if fact_fields:
        where, params = _typed_cohort_filters(item, cohort)
        cursor = conn.execute(f"SELECT territory_id,{','.join(fact_fields)} FROM {resource.storage_relation} "
            f"WHERE {where} ORDER BY territory_id,groupe", params)
        for raw in cursor.fetchall():
            members_with_facts.add(raw[0])
            facts_by_member[raw[0]].append(dict(zip(fact_fields, raw[1:])))
    else:
        where, params = _typed_cohort_filters(item, cohort)
        members_with_facts = {row[0] for row in conn.execute(
            f"SELECT territory_id FROM {resource.storage_relation} WHERE {where}", params).fetchall()}

    evidence_by_member = {member["id"]: {} for member in cohort.members}
    for side in resource.side_relations:
        if side["field"] not in selected and side["field"] != "source_absences":
            continue
        side_fields = list(side["fields"])
        where, params = _typed_cohort_filters(item, cohort, "groupe" in side_fields)
        order = "rank" if "rank" in side_fields else ",".join(side_fields)
        rows = conn.execute(f"SELECT {','.join(side_fields)} FROM {side['storage_relation']} "
            f"WHERE {where} ORDER BY {order}", params).fetchall()
        by_member = {member["id"]: [] for member in cohort.members}
        for row in rows:
            evidence = dict(zip(side_fields, row))
            by_member[evidence["territory_id"]].append(evidence)
        for territory_id, evidence in by_member.items():
            evidence_by_member[territory_id][side["field"]] = evidence

    territories = []
    for member in cohort.members:
        facts = facts_by_member[member["id"]]
        absences = evidence_by_member[member["id"]].get("source_absences")
        if absences is not None and ((member["id"] not in members_with_facts and len(absences) != 1)
                                     or (member["id"] in members_with_facts and absences)):
            raise HTTPException(503, "Milieux reading is missing or overlaps its source-absence evidence")
        territories.append({"territory": dict(member), "facts": facts,
            **evidence_by_member[member["id"]]})
    return {"resource": item.resource, "target": item.target.model_dump(),
        "shape": "typed_reading", "cohort": cohort.envelope(),
        "content_version": marker[0], "reference_content_version": marker[2],
        "territories": territories}


def _aedar_cohort_context(conn, item, cohort):
    from api.aedar_models import AEDAR_MEASURE_KEYS

    reference = conn.execute("SELECT content_version FROM table_publication WHERE table_name='territory_reference'").fetchone()
    marker = conn.execute("""SELECT p.content_version,p.row_count,p.reference_content_version,t.content_version
        FROM table_publication p JOIN table_publication t ON t.table_name='territory_reference'
        WHERE p.table_name='aedar_territorial_aggregate'""").fetchone()
    if (not reference or reference[0] != cohort.reference_content_version or not marker or
            not marker[0] or marker[1] < 1 or marker[2] != marker[3] or marker[2] != reference[0]):
        raise HTTPException(503, "AEDAR territorial publication is unavailable or incompatible")
    coordinates = item.coordinates or {}
    selected_typequ = coordinates.get("typequ")
    if selected_typequ:
        known = {row[0] for row in conn.execute(
            "SELECT DISTINCT typequ FROM aedar_territorial_aggregate WHERE typequ=ANY(%s::text[])",
            (selected_typequ,)).fetchall()}
        if known != set(selected_typequ):
            raise HTTPException(422, "Coordinate value is not present in the published AEDAR descriptor")
    selected_measures = coordinates.get("measure")
    if selected_measures and not set(selected_measures) <= AEDAR_MEASURE_KEYS:
        raise HTTPException(422, "Coordinate measure is not declared for AEDAR")
    fields = item.fields
    measure_keys = (set(AEDAR_MEASURE_KEYS) if fields is None else
        {field.removeprefix("measures.") for field in fields})
    if selected_measures:
        measure_keys &= set(selected_measures)
    if not measure_keys:
        raise HTTPException(422, "AEDAR measure coordinate selection is empty")
    return marker, selected_typequ, measure_keys


def preflight_aedar_cohort(conn, item, resource, cohort, work_budget):
    _marker, typequ, measure_keys = _aedar_cohort_context(conn, item, cohort)
    remaining = work_budget - len(cohort.members)
    clauses = ["territory_type=%s", "territory_id=ANY(%s::text[])"]
    params = [item.target.type, cohort.territory_ids]
    if typequ is not None:
        clauses.append("typequ=ANY(%s::text[])")
        params.append(typequ)
    per_fact = 1 + len(measure_keys)
    fact_budget = remaining // per_fact
    facts = _bounded_count(conn, "SELECT 1 FROM aedar_territorial_aggregate WHERE " +
        " AND ".join(clauses), tuple(params), fact_budget,
        "Cohort AEDAR aggregate facts exceed the bounded work limit")
    return max(1, len(cohort.members) + facts * per_fact)


def read_aedar_cohort(conn, item, resource, cohort):
    from api.aedar_models import AEDAR_MEASURE_KEYS

    marker, typequ, measure_keys = _aedar_cohort_context(conn, item, cohort)
    measure_projection = ("measures" if measure_keys == AEDAR_MEASURE_KEYS else
        "COALESCE((SELECT jsonb_object_agg(k,v) FROM jsonb_each(aedar_territorial_aggregate.measures) AS m(k,v) "
        "WHERE k=ANY(%s::text[])), '{}'::jsonb) AS measures")
    clauses = ["territory_type=%s", "territory_id=ANY(%s::text[])"]
    params = []
    if measure_keys != AEDAR_MEASURE_KEYS:
        params.append(sorted(measure_keys))
    params.extend((item.target.type, cohort.territory_ids))
    if typequ is not None:
        clauses.append("typequ=ANY(%s::text[])")
        params.append(typequ)
    cursor = conn.execute("""SELECT territory_id,territory_type,typequ,typequ_label,
        typequ_hierarchy_label,typequ_description,typequ_domain_code,typequ_domain_label,
        typequ_subdomain_code,typequ_subdomain_label,typequ_gamme,typequ_gamme_status,
        typequ_source_order,identity,n_addresses,n_observed,coverage_status,""" + measure_projection + """,
        source_id,vintage_id,source_url,licence,attribution,reference_date,publication_date
        FROM aedar_territorial_aggregate WHERE """ + " AND ".join(clauses) +
        " ORDER BY territory_id,typequ", tuple(params))
    names = [column.name for column in cursor.description]
    rows = [dict(zip(names, row)) for row in cursor.fetchall()]
    expected_measures = AEDAR_MEASURE_KEYS if item.fields is None else measure_keys
    if any(set(row["measures"] or {}) != expected_measures for row in rows):
        raise HTTPException(503, "AEDAR measure publication is incomplete for the requested projection")
    required_metadata = ("typequ_hierarchy_label", "typequ_description", "typequ_domain_code",
        "typequ_domain_label", "typequ_subdomain_code", "typequ_subdomain_label",
        "typequ_gamme_status", "typequ_source_order")
    if any(any(row[key] is None for key in required_metadata) for row in rows):
        raise HTTPException(503, "AEDAR TYPEQU metadata publication is incomplete")
    return {"resource": item.resource, "target": item.target.model_dump(),
        "shape": "aedar_source_grain", "cohort": cohort.envelope(),
        "content_version": marker[0], "reference_content_version": marker[2], "facts": rows}


def preflight_cohort(conn, item, resource, cohort, fields, work_budget):
    """Validate the native publication and actual bounded work before any read."""
    if resource.resource_kind == "indicator":
        shape, route = _indicator_shape(conn, item, resource)
        if shape == "owned_series":
            return preflight_owned_series_cohort(conn, item, resource, cohort, fields, work_budget)
        if shape == "scalar":
            return preflight_scalar_cohort(conn, item, resource, cohort, fields, work_budget)
        if shape == "declared_profile":
            return preflight_profile_cohort(conn, item, resource, cohort, fields, work_budget)
        if shape == "legacy_series":
            return preflight_legacy_series_cohort(conn, item, resource, cohort, fields, work_budget)
        if shape == "period_detail":
            return preflight_period_detail_cohort(conn, item, resource, route, cohort, fields, work_budget)
        if shape == "anchored_membership":
            return preflight_membership_cohort(conn, item, resource, route, cohort, fields, work_budget)
        raise HTTPException(503, "Cohort facts are unavailable for this published resource shape")
    if resource.resource_kind == "typed_reading":
        return preflight_typed_reading_cohort(conn, item, resource, cohort, work_budget)
    if resource.resource_kind == "aedar_source_grain":
        return preflight_aedar_cohort(conn, item, resource, cohort, work_budget)
    if resource.resource_kind == "indicator" and resource.shapes == ("scalar",):
        return preflight_scalar_cohort(conn, item, resource, cohort, fields, work_budget)
    if resource.resource_kind == "indicator" and "declared_profile" in resource.shapes:
        return preflight_profile_cohort(conn, item, resource, cohort, fields, work_budget)
    raise HTTPException(503, "Cohort facts are unavailable for this published resource shape")


def read_cohort(conn, item, resource, cohort, fields):
    if resource.resource_kind == "indicator":
        shape, route = _indicator_shape(conn, item, resource)
        if shape == "owned_series":
            return read_owned_series_cohort(conn, item, resource, cohort, fields)
        if shape == "scalar":
            return read_scalar_cohort(conn, item, resource, cohort, fields)
        if shape == "declared_profile":
            return read_profile_cohort(conn, item, resource, cohort, fields)
        if shape == "legacy_series":
            return read_legacy_series_cohort(conn, item, resource, cohort, fields)
        if shape == "period_detail":
            return read_period_detail_cohort(conn, item, resource, route, cohort, fields)
        if shape == "anchored_membership":
            return read_membership_cohort(conn, item, resource, route, cohort, fields)
    if resource.resource_kind == "typed_reading":
        return read_typed_reading_cohort(conn, item, resource, cohort)
    if resource.resource_kind == "aedar_source_grain":
        return read_aedar_cohort(conn, item, resource, cohort)
    raise HTTPException(503, "Cohort facts are unavailable for this published resource shape")
