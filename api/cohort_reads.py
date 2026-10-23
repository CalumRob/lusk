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
    facts = _bounded_count(conn, """SELECT 1 FROM series_dataset_observation o
        WHERE o.dataset_id=%s AND o.indicator_id=%s AND o.territory_type=%s
          AND o.territory_id=ANY(%s::text[]) AND o.axis_value=ANY(%s::text[])""",
        params, budget, "Cohort ordered-series facts exceed the bounded work limit")
    if descriptor[3] == "dense_complete" and facts != len(cohort.members) * len(axes):
        raise HTTPException(503, "Owned-series cohort is incomplete")
    budget -= facts
    provenance = _bounded_count(conn, """SELECT 1 FROM series_observation_provenance p
        WHERE p.dataset_id=%s AND p.indicator_id=%s AND p.territory_id=ANY(%s::text[])
          AND p.axis_value=ANY(%s::text[])""",
        (route[0], route[3], cohort.territory_ids, axes), budget,
        "Cohort ordered-series provenance exceeds the bounded work limit")
    if provenance < facts:
        raise HTTPException(503, "Owned-series provenance is incomplete")
    return max(1, len(cohort.members) + facts + provenance)


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
