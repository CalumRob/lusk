"""Project semantic resource requests through the retained snapshot readers.

This module owns shape/intent dispatch and coordinate projection. SQL snapshot
readers are explicit constructor dependencies so this layer never imports the
FastAPI composition root.
"""

from fastapi import HTTPException

from api.profile_reads import focal_profiles
from api.resource_catalogue import ResourceCatalogue, default_resource_catalogue


class SemanticResourceReader:
    def __init__(self, *, indicator_facts_snapshot, indicator_comparison_preflight,
                 indicator_comparison_snapshot, owned_series_route,
                 owned_named_reference_snapshot, comparison_field_selection,
                 max_owned_series_provenance_per_point):
        self._indicator_facts_snapshot = indicator_facts_snapshot
        self._indicator_comparison_preflight = indicator_comparison_preflight
        self._indicator_comparison_snapshot = indicator_comparison_snapshot
        self._owned_series_route = owned_series_route
        self._owned_named_reference_snapshot = owned_named_reference_snapshot
        self._comparison_field_selection = comparison_field_selection
        self._max_owned_series_provenance_per_point = max_owned_series_provenance_per_point

    def _coordinate_values(self, conn, item, resource):
        coordinates = item.coordinates or {}
        domains = {axis: set(values) for axis, values in resource.axis_values}
        requested = set(coordinates)
        indicator = item.resource
        if "declared_profile" in resource.shapes:
            for axis in set(resource.axes) & {"detail", "sex"}:
                rows = conn.execute("SELECT axis_key FROM profile_axis WHERE indicator_id=%s AND axis_name=%s",
                                    (indicator, axis)).fetchall()
                if not rows:
                    raise HTTPException(503, "Profile coordinate descriptor is unavailable")
                domains[axis] = {str(row[0]) for row in rows}
        if "ordered_series" in resource.shapes or "named_reference" in resource.shapes:
            route = self._owned_series_route(conn, indicator)
            if route:
                row = conn.execute("SELECT axis_values FROM series_dataset_descriptor WHERE dataset_id=%s AND indicator_id=%s AND active_read_route",
                                   (route[0], route[3])).fetchone()
            else:
                row = conn.execute("SELECT axis_values FROM series_descriptor WHERE indicator_id=%s",
                                   (indicator,)).fetchone()
            if not row or not row[0]:
                raise HTTPException(503, "Series coordinate descriptor is unavailable")
            axis = resource.axes[0] if resource.axes else "axis"
            domains[axis] = {str(value) for value in row[0]}
        if "period_detail" in resource.shapes:
            if "detail" in requested or "period" in requested:
                categories = conn.execute("SELECT detail_key FROM observed_collection_category WHERE indicator_id=%s",
                                          (indicator,)).fetchall()
                periods = conn.execute("SELECT DISTINCT observation_period FROM period_detail_observation WHERE indicator_id=%s",
                                       (indicator,)).fetchall()
                domains["detail"] = {str(row[0]) for row in categories}
                domains["period"] = {str(row[0]) for row in periods}
        if "anchored_membership" in resource.shapes and "membership" in requested:
            categories = conn.execute("SELECT detail_key FROM observed_collection_category WHERE indicator_id=%s",
                                      (indicator,)).fetchall()
            domains["membership"] = {str(row[0]) for row in categories}
        for axis, values in coordinates.items():
            domain = domains.get(axis)
            if domain is None:
                raise HTTPException(422, "Coordinate axis has no published descriptor")
            if not set(values) <= domain:
                raise HTTPException(422, "Coordinate value is not declared by the published descriptor")
        return domains

    def preflight(self, conn, item, catalogue: ResourceCatalogue | None = None,
                  *, work_budget: int = 200_000) -> int:
        catalogue = catalogue or default_resource_catalogue()
        resource = catalogue.resources_by_id[item.resource]
        if resource.resource_kind == "typed_reading":
            return self._typed_reading_preflight(conn, item, resource, work_budget=work_budget)
        if resource.resource_kind == "indicator":
            self._coordinate_values(conn, item, resource)
        if resource.resource_kind == "aedar_source_grain":
            from api.aedar_reads import (_aedar_comparison_snapshot,
                _aedar_territorial_aggregate_snapshot)
            coordinates = item.coordinates or {}
            typequ = coordinates.get("typequ")
            measures = coordinates.get("measure")
            if typequ:
                known = {row[0] for row in conn.execute(
                    "SELECT DISTINCT typequ FROM aedar_territorial_aggregate WHERE typequ=ANY(%s)",
                    (typequ,)).fetchall()}
                if known != set(typequ):
                    raise HTTPException(422, "Coordinate value is not present in the published AEDAR descriptor")
            if measures:
                from api.aedar_models import AEDAR_MEASURE_KEYS
                if not set(measures) <= AEDAR_MEASURE_KEYS:
                    raise HTTPException(422, "Coordinate measure is not declared for AEDAR")
            if item.intent.kind == "fixed_comparison":
                if not typequ or len(typequ) != 1 or not measures or len(measures) != 1:
                    raise HTTPException(422, "AEDAR comparison requires one TYPEQU and one measure coordinate")
                return _aedar_comparison_snapshot(conn, item.target.type, item.target.id,
                    item.intent.context, typequ[0], measures[0], item.fields, preflight_only=True) and 1
            if item.intent.kind == "facts":
                result = _aedar_territorial_aggregate_snapshot(conn, item.target.type,
                    item.target.id, typequ, None, 100, 0, preflight_only=True)
                count = conn.execute("SELECT count(*) FROM aedar_territorial_aggregate WHERE territory_type=%s AND territory_id=%s AND (%s::text[] IS NULL OR typequ=ANY(%s))",
                    (item.target.type, item.target.id, typequ, typequ)).fetchone()[0]
                return min(count, 100)
        if item.intent.kind in {"fixed_comparison", "selected_comparison"}:
            selection = ([(member.type, member.id) for member in item.intent.members]
                         if item.intent.kind == "selected_comparison" else None)
            fields = self._comparison_field_selection(item.fields)
            focal = conn.execute("SELECT territory_type FROM territory_reference WHERE territory_id=%s",
                                 (item.target.id,)).fetchone()
            if not focal:
                raise HTTPException(404, "Focal territory not found")
            if focal[0] != item.target.type:
                raise HTTPException(422, "Focal territory type does not match route")
            if selection:
                member_ids = [member_id for _, member_id in selection]
                resolved = conn.execute(
                    "SELECT territory_id,territory_type FROM territory_reference WHERE territory_id=ANY(%s)",
                    (member_ids,)).fetchall()
                resolved_by_id = {territory_id: territory_type for territory_id, territory_type in resolved}
                if len(resolved_by_id) != len(selection):
                    raise HTTPException(404, "Selected comparison territory not found")
                if any(resolved_by_id.get(member_id) != member_type
                       for member_type, member_id in selection):
                    raise HTTPException(422, "Selected comparison territory type does not match")
            estimate = self._indicator_comparison_preflight(
                conn, item.target.type, item.target.id, item.resource, selection, fields)
            resource = catalogue.resources_by_id[item.resource]
            members = ([member_id for _, member_id in selection] if selection else
                       list(estimate.get("members", ())) if isinstance(estimate, dict) else [])
            output_axes = 1
            if "ordered_series" in resource.shapes or "declared_profile" in resource.shapes:
                domains = self._coordinate_values(conn, item, resource)
                for axis in resource.axes:
                    output_axes *= max(1, len(domains.get(axis, ())))
            fixed_context = (estimate.get("fixed_context") if isinstance(estimate, dict) else None)
            # Published fixed rows are keyed lookups; otherwise a fixed intent
            # falls back to the resolved selected cohort and its actual facts.
            fixed_lookup = item.intent.kind == "fixed_comparison" and fixed_context is not None
            if fixed_lookup:
                members = [item.target.id]
            work = max(1, len(members)) * output_axes
            if "ordered_series" in resource.shapes:
                route = self._owned_series_route(conn, item.resource)
                if route:
                    from api.snapshot_reads import _execute_comparison_publication_read
                    if fixed_lookup:
                        rows = conn.execute("""SELECT count(*) FROM ordered_series_comparison_territory
                            WHERE dataset_id=%s AND indicator_id=%s AND territory_id=%s
                              AND comparison_context=%s AND group_id=%s AND territory_type=%s""",
                            (route[0], route[3], item.target.id, fixed_context[0],
                             fixed_context[1], fixed_context[2])).fetchone()[0]
                        lineage = _execute_comparison_publication_read(conn,"""SELECT count(*) FROM ordered_series_comparison_lineage
                            WHERE dataset_id=%s AND indicator_id=%s AND comparison_context=%s
                              AND group_id=%s AND territory_type=%s""",
                            (route[0], route[3], fixed_context[0], fixed_context[1], fixed_context[2])).fetchone()[0]
                        work = max(1, int(rows) + int(lineage))
                    else:
                        facts = conn.execute("""SELECT count(*) FROM series_dataset_observation
                            WHERE dataset_id=%s AND indicator_id=%s AND territory_id=ANY(%s::text[])""",
                            (route[0], route[3], members)).fetchone()[0]
                        lineage = _execute_comparison_publication_read(conn,"""SELECT count(*) FROM series_observation_provenance
                            WHERE dataset_id=%s AND indicator_id=%s AND territory_id=ANY(%s::text[])""",
                            (route[0], route[3], members)).fetchone()[0]
                        work = max(work, int(facts) + int(lineage))
            elif resource.shapes and "scalar" in resource.shapes and item.intent.kind == "selected_comparison":
                facts = conn.execute("""SELECT count(*) FROM scalar_observation
                    WHERE indicator_id=%s AND territory_id=ANY(%s::text[])""",
                    (item.resource, members)).fetchone()[0]
                lineage = conn.execute("""SELECT count(*) FROM scalar_observation_source
                    WHERE indicator_id=%s AND territory_id=ANY(%s::text[])""",
                    (item.resource, members)).fetchone()[0]
                work = max(work, int(facts) + int(lineage))
            elif fixed_lookup and resource.shapes and "scalar" in resource.shapes:
                rows = conn.execute("""SELECT count(*) FROM scalar_comparison_territory
                    WHERE indicator_id=%s AND territory_id=%s""",
                    (item.resource, item.target.id)).fetchone()[0]
                from api.snapshot_reads import _execute_comparison_publication_read
                lineage = _execute_comparison_publication_read(conn,"""SELECT count(*) FROM comparison_source_lineage
                    WHERE comparison_family='scalar' AND facet_id=%s
                      AND comparison_context=%s AND group_id=%s AND territory_type=%s""",
                    (item.resource, fixed_context[0], fixed_context[1], fixed_context[2])).fetchone()[0]
                work = max(1, int(rows) + int(lineage))
            return work

        requested_fields = self._legacy_fields(item, catalogue)
        if item.target.kind == "named_reference":
            route = self._owned_series_route(conn, item.resource)
            if not route or not route[2]:
                raise HTTPException(503, "Named reference publication is unavailable")
            self._owned_named_reference_snapshot(conn, route, None, None, item.resource,
                fields=requested_fields, preflight_only=True, reference_target_id=item.target.id)
            return max(1, len(catalogue.resources_by_id[item.resource].axis_values[0][1]))

        resource = catalogue.resources_by_id[item.resource]
        if "declared_profile" in resource.shapes:
            descriptor = conn.execute(
                "SELECT allowed_levels FROM profile_descriptor WHERE indicator_id=%s",
                (item.resource,)).fetchone()
            if not descriptor:
                raise HTTPException(503, "Declared profile publication is unavailable")
            if item.target.type not in descriptor[0]:
                raise HTTPException(422, "Profile is not declared for this territory level")
        estimate = self._indicator_facts_snapshot(
            conn, item.target.type, item.target.id, item.resource,
            requested_fields, preflight_only=True, require_declared_resource=True)
        if not isinstance(estimate, dict):
            return 1
        declared_cells = 1
        for _axis, values in resource.axis_values:
            declared_cells *= max(1, len(values))
        route = self._owned_series_route(conn, item.resource) if "ordered_series" in resource.shapes else None
        if "ordered_series" in resource.shapes and resource.dynamic_axes:
            if route:
                descriptor = conn.execute("""SELECT axis_values FROM series_dataset_descriptor
                    WHERE dataset_id=%s AND indicator_id=%s AND active_read_route""",
                    (route[0], route[3])).fetchone()
            else:
                descriptor = conn.execute("SELECT axis_values FROM series_descriptor WHERE indicator_id=%s",
                                          (item.resource,)).fetchone()
            if descriptor and descriptor[0]:
                declared_cells = max(declared_cells, len(descriptor[0]))
        if route:
            declared_cells *= self._max_owned_series_provenance_per_point
        return estimate.get("work_units", declared_cells)

    @staticmethod
    def _legacy_fields(item, catalogue):
        if item.fields is None:
            return None
        resource = catalogue.resources_by_id[item.resource]
        shape = "ordered_series" if "ordered_series" in resource.shapes else resource.shapes[0]
        selected = set(item.fields)
        if shape == "scalar":
            return [field for field in selected
                    if field in {"value", "support_count", "denominator_count", "status"}] or ["status"]
        if shape in {"declared_profile", "ordered_series", "period_detail"}:
            return ["value"] if "value" in selected else ["status"]
        if shape == "anchored_membership":
            return [field for field in selected if field in {
                "detail", "label", "rider", "anchor_count", "availability"}] or ["availability"]
        return None

    def read(self, conn, item, catalogue: ResourceCatalogue | None = None) -> dict:
        catalogue = catalogue or default_resource_catalogue()
        resource = catalogue.resources_by_id[item.resource]
        if resource.resource_kind == "typed_reading":
            return self._typed_reading_read(conn, item, resource)
        if resource.resource_kind == "aedar_source_grain":
            from api.aedar_reads import (_aedar_comparison_snapshot,
                _aedar_territorial_aggregate_snapshot)
            coordinates = item.coordinates or {}
            if item.intent.kind == "fixed_comparison":
                data = _aedar_comparison_snapshot(conn, item.target.type, item.target.id,
                    item.intent.context, coordinates["typequ"][0], coordinates["measure"][0], item.fields)
            else:
                data = _aedar_territorial_aggregate_snapshot(conn, item.target.type,
                    item.target.id, coordinates.get("typequ"), item.fields, 100, 0)
            return {"resource": item.resource, "target": item.target.model_dump(), **data}
        if item.intent.kind in {"fixed_comparison", "selected_comparison"}:
            selection = ([(member.type, member.id) for member in item.intent.members]
                         if item.intent.kind == "selected_comparison" else None)
            data = self._indicator_comparison_snapshot(
                conn, item.target.type, item.target.id, item.resource, selection,
                self._comparison_field_selection(item.fields))
            if item.coordinates:
                data = self._filter_coordinates(data, item.coordinates, resource)
            return {"resource": item.resource, "target": item.target.model_dump(), **data}

        requested_fields = self._legacy_fields(item, catalogue)
        if item.target.kind == "named_reference":
            route = self._owned_series_route(conn, item.resource)
            if not route or not route[2]:
                raise HTTPException(503, "Named reference publication is unavailable")
            data = self._owned_named_reference_snapshot(conn, route, None, None, item.resource,
                fields=requested_fields, reference_target_id=item.target.id)
            if item.coordinates:
                data = self._filter_coordinates(data, item.coordinates, resource)
            return {"resource": item.resource, "target": item.target.model_dump(), **data}

        resource = catalogue.resources_by_id[item.resource]
        if "declared_profile" in resource.shapes:
            descriptor = conn.execute(
                "SELECT allowed_levels FROM profile_descriptor WHERE indicator_id=%s",
                (item.resource,)).fetchone()
            if not descriptor:
                raise HTTPException(503, "Declared profile publication is unavailable")
            if item.target.type not in descriptor[0]:
                raise HTTPException(422, "Profile is not declared for this territory level")
            profiles, version = focal_profiles(
                conn, item.target.type, item.target.id, indicator_id=item.resource,
                fields=requested_fields)
            if len(profiles) != 1:
                raise HTTPException(503, "Declared profile publication is unavailable")
            profile = profiles[0]
            observations = profile.pop("cells")
            if item.coordinates:
                observations = [observation for observation in observations if all(
                    observation.get(axis) in values for axis, values in item.coordinates.items())]
            return {"resource": item.resource, "target": item.target.model_dump(),
                    "content_version": version, "descriptor": profile,
                    "observations": observations}

        data = self._indicator_facts_snapshot(
            conn, item.target.type, item.target.id, item.resource, requested_fields,
            require_declared_resource=True)
        if item.coordinates:
            data = self._filter_coordinates(data, item.coordinates, resource)
        return {"resource": item.resource, "target": item.target.model_dump(),
                **(data if isinstance(data, dict) else {"result": data})}

    @staticmethod
    def _typed_reading_preflight(conn, item, resource, *, work_budget=200_000):
        territory = conn.execute("SELECT territory_type FROM territory_reference WHERE territory_id=%s",
                                 (item.target.id,)).fetchone()
        if not territory:
            raise HTTPException(404, "Territory not found")
        if territory[0] != item.target.type:
            raise HTTPException(422, "Territory target type does not match")
        marker = conn.execute("""SELECT content_version,row_count,reference_content_version
            FROM table_publication WHERE table_name=%s""", (resource.publication_table,)).fetchone()
        reference = conn.execute("SELECT content_version FROM table_publication WHERE table_name='territory_reference'").fetchone()
        if not marker or not marker[0] or not reference or marker[2] != reference[0]:
            raise HTTPException(503, "Typed-reading publication is unavailable or stale")
        if resource.publication_table == "selected_reading":
            owner_marker = conn.execute("""SELECT content_version,row_count,reference_content_version
                FROM selected_reading_publication WHERE theme_id=%s""",
                (resource.theme_id,)).fetchone()
            if (not owner_marker or owner_marker[0] != marker[0] or
                    owner_marker[1] != marker[1] or owner_marker[2] != marker[2]):
                raise HTTPException(503, "Selected-reading publication is inconsistent")
        # Validate physical completeness without an unaccounted full-relation
        # count. Each validation count is capped by the remaining request budget,
        # and the scanned rows are charged as work before any focal read runs.
        from api.snapshot_reads import _execute_comparison_publication_read
        work = 0

        def checked_count(relation, expected_count=None):
            nonlocal work
            remaining = work_budget - work
            if remaining <= 0 or (expected_count is not None and int(expected_count) > remaining):
                raise HTTPException(413, "Resource request exceeds the bounded work limit")
            scanned = int(_execute_comparison_publication_read(conn,
                f"SELECT count(*) FROM (SELECT 1 FROM {relation} LIMIT %s) AS bounded_rows",
                (remaining + 1,)).fetchone()[0])
            if scanned > remaining:
                raise HTTPException(413, "Resource request exceeds the bounded work limit")
            if expected_count is not None and scanned != int(expected_count):
                raise HTTPException(503, "Typed-reading publication row count is inconsistent")
            work += scanned
            return scanned

        checked_count(resource.storage_relation, marker[1])
        coordinates = item.coordinates or {}
        group = coordinates.get("groupe")
        relation = resource.storage_relation
        clauses = ["territory_id=%s", "territory_type=%s"]
        params = [item.target.id, item.target.type]
        if group:
            clauses.append("groupe=ANY(%s::text[])")
            params.append(group)
        work += int(conn.execute(f"SELECT count(*) FROM {relation} WHERE " + " AND ".join(clauses), params).fetchone()[0])
        if work > work_budget:
            raise HTTPException(413, "Resource request exceeds the bounded work limit")
        for side in resource.side_relations:
            side_marker = conn.execute("""SELECT content_version,reference_content_version,row_count
                FROM table_publication WHERE table_name=%s""", (side["publication_table"],)).fetchone()
            if not side_marker or side_marker[1] != reference[0]:
                raise HTTPException(503, "Typed-reading evidence publication is unavailable or stale")
            if side["publication_table"] == resource.publication_table and side_marker[0] != marker[0]:
                raise HTTPException(503, "Typed-reading evidence publication is incompatible")
            if side.get("same_content_version_as") == "resource" and side_marker[0] != marker[0]:
                raise HTTPException(503, "Typed-reading evidence publication is stale")
            expected_side_count = (side_marker[2]
                if side["publication_table"] != resource.publication_table else None)
            checked_count(side["storage_relation"], expected_side_count)
            side_clauses = ["territory_id=%s", "territory_type=%s"]
            side_params = [item.target.id, item.target.type]
            if "groupe" in side["fields"]:
                if group:
                    side_clauses.append("groupe=ANY(%s::text[])")
                    side_params.append(group)
            work += int(conn.execute(f"SELECT count(*) FROM {side['storage_relation']} WHERE " +
                " AND ".join(side_clauses), side_params).fetchone()[0])
            if work > work_budget:
                raise HTTPException(413, "Resource request exceeds the bounded work limit")
        return max(1, work)

    @staticmethod
    def _typed_reading_read(conn, item, resource):
        marker = conn.execute("SELECT content_version FROM table_publication WHERE table_name=%s",
                              (resource.publication_table,)).fetchone()
        if not marker or not marker[0]:
            raise HTTPException(503, "Typed-reading publication is unavailable")
        coordinates = item.coordinates or {}
        selected_fields = set(item.fields or resource.fields)
        evidence_fields = {side["field"] for side in resource.side_relations}
        fields = [field for field in resource.fields
                  if field in selected_fields and field not in evidence_fields]
        clauses = ["territory_id=%s", "territory_type=%s"]
        params = [item.target.id, item.target.type]
        if coordinates.get("groupe"):
            clauses.append("groupe=ANY(%s::text[])")
            params.append(coordinates["groupe"])
        rows = conn.execute(f"SELECT {','.join(fields)} FROM {resource.storage_relation} WHERE " +
            " AND ".join(clauses) + " ORDER BY groupe", params).fetchall() if fields else []
        facts = [dict(zip(fields, row)) for row in rows]
        evidence = {}
        for side in resource.side_relations:
            side_fields = list(side["fields"])
            side_clauses = ["territory_id=%s", "territory_type=%s"]
            side_params = [item.target.id, item.target.type]
            if "groupe" in side_fields and coordinates.get("groupe"):
                side_clauses.append("groupe=ANY(%s::text[])")
                side_params.append(coordinates["groupe"])
            order = "rank" if "rank" in side_fields else ",".join(side_fields)
            side_rows = conn.execute(f"SELECT {','.join(side_fields)} FROM {side['storage_relation']} WHERE " +
                " AND ".join(side_clauses) + f" ORDER BY {order}", side_params).fetchall()
            evidence[side["field"]] = [dict(zip(side_fields, row)) for row in side_rows]
        if "source_absences" in evidence:
            absences = evidence["source_absences"]
            if (not facts and len(absences) != 1) or (facts and absences):
                raise HTTPException(503, "Milieux reading is missing or overlaps its source-absence evidence")
        return {"resource": item.resource, "target": item.target.model_dump(),
                "content_version": marker[0], "facts": facts,
                **{key: value for key, value in evidence.items() if key in selected_fields}}

    @staticmethod
    def _filter_coordinates(data, coordinates, resource):
        dimensions = {"detail": "detail", "membership": "detail", "sex": "sex",
                      "year": "axis", "duration_minute": "axis", "declared_detail": "axis",
                      "axis": "axis", "period": "observation_period", "state_role": "state_role",
                      "typequ": "typequ"}
        rows_found = False
        row_keys = {"cells", "points", "observations", "facts", "entries", "relationships", "summaries", "results"}

        def project(node):
            nonlocal rows_found
            if isinstance(node, dict):
                for key, value in list(node.items()):
                    if key in row_keys and isinstance(value, list):
                        row_keys_present = all(all(dimensions.get(axis) in row for axis in coordinates)
                                               for row in value if isinstance(row, dict))
                        if row_keys_present:
                            rows_found = True
                            node[key] = [row for row in value if isinstance(row, dict) and all(
                                str(row[dimensions[axis]]) in set(values)
                                for axis, values in coordinates.items())]
                            project(node[key])
                    else:
                        project(value)
            elif isinstance(node, list):
                for value in node:
                    project(value)

        project(data)
        if not rows_found and isinstance(data, dict):
            result = data.get("result")
            if isinstance(result, dict) and result.get("source_facet") is not None:
                axis = resource.axes[0] if resource.axes else "axis"
                values = coordinates.get(axis)
                if values is not None:
                    rows_found = True
                    if str(result["source_facet"]) not in set(values):
                        for field in ("median", "mean", "rank", "rank_size", "rank_ties",
                                      "focal_value", "mean_curve"):
                            result.pop(field, None)
                        result["status"] = "unavailable"
                        result["reason"] = "selected_coordinate_has_no_comparison_result"
        if not rows_found:
            raise HTTPException(503, "Published resource does not expose its declared coordinate rows")
        return data
