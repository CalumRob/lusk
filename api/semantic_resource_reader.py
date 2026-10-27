"""Project semantic resource requests through the retained snapshot readers.

This module owns shape/intent dispatch and coordinate projection. SQL snapshot
readers are explicit constructor dependencies so this layer never imports the
FastAPI composition root.
"""

from fastapi import HTTPException

from api.cohort_reads import (preflight_cohort, read_cohort, resolve_territory_cohort,
                              validate_typed_reading_integrity)
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
        self._cohort_scopes = {}

    @staticmethod
    def _has_dual_scalar_series(resource):
        return (resource.resource_kind == "indicator"
                and "scalar" in resource.shapes and "ordered_series" in resource.shapes)

    def _require_dual_series_route(self, conn, resource):
        route = self._owned_series_route(conn, resource.resource_id)
        if (not route or route[2] or route[1] != resource.theme_id):
            raise HTTPException(503, "Declared ordered-series facet publication is unavailable or incompatible")

    @staticmethod
    def _scalar_facet_fields(item):
        if item.fields is None:
            return None
        return [field for field in item.fields
                if field in {"value", "support_count", "denominator_count"}]

    @staticmethod
    def _profile_comparison_coordinates(item, resource):
        """Resolve one complete profile cell for a coordinate-aware comparison."""
        if ("declared_profile" not in resource.shapes or not item.coordinates
                or item.intent.kind not in {"fixed_comparison", "selected_comparison"}):
            return None
        axes = {axis for axis, _values in resource.axis_values}
        if not axes:
            axes = set(resource.axes)
        if set(item.coordinates) != axes or any(len(values) != 1
                                                for values in item.coordinates.values()):
            raise HTTPException(422, "Profile comparison requires one value for every declared coordinate axis")
        return {axis: values[0] for axis, values in item.coordinates.items()}

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
        profile_coordinates = self._profile_comparison_coordinates(item, resource)
        if resource.resource_kind in {"indicator", "typed_reading"}:
            self._coordinate_values(conn, item, resource)
        dual_scalar_series = (self._has_dual_scalar_series(resource)
                              and item.target.kind == "territory")
        if dual_scalar_series:
            self._require_dual_series_route(conn, resource)
        if resource.resource_kind == "typed_reading":
            if item.target.kind == "territory_cohort":
                cohort = resolve_territory_cohort(conn, item.target, work_budget=work_budget)
                estimate = preflight_cohort(conn, item, resource, cohort,
                    self._legacy_fields(item, catalogue), work_budget)
                self._cohort_scopes[id(item)] = cohort
                return estimate
            return self._typed_reading_preflight(conn, item, resource, work_budget=work_budget)
        if item.target.kind == "territory_cohort":
            cohort = resolve_territory_cohort(conn, item.target, work_budget=work_budget)
            estimate = preflight_cohort(conn, item, resource, cohort,
                self._legacy_fields(item, catalogue), work_budget)
            self._cohort_scopes[id(item)] = cohort
            return estimate
        if resource.resource_kind == "aedar_source_grain":
            from api.aedar_reads import (_aedar_comparison_snapshot,
                _aedar_territorial_aggregate_snapshot)
            coordinates = item.coordinates or {}
            typequ = coordinates.get("typequ")
            measures = coordinates.get("measure")
            # (a) Request-shape validation runs first: a malformed request must
            # fail with 422 rather than be misreported as a publication problem.
            if measures:
                from api.aedar_models import AEDAR_MEASURE_KEYS
                if not set(measures) <= AEDAR_MEASURE_KEYS:
                    raise HTTPException(422, "Coordinate measure is not declared for AEDAR")
            if item.intent.kind == "fixed_comparison" and not (
                    typequ and len(typequ) == 1 and measures and len(measures) == 1):
                raise HTTPException(422, "AEDAR comparison requires one TYPEQU and one measure coordinate")
            # (b) Publication preflight runs second: an absent, stale or
            # incompatible publication fails closed with 503, matching the
            # retired legacy routes and the documented endpoint contract, so a
            # valid request is never reported as malformed.
            if item.intent.kind == "fixed_comparison":
                _aedar_comparison_snapshot(conn, item.target.type, item.target.id,
                    item.intent.context, typequ[0], measures[0], item.fields, preflight_only=True)
            elif item.intent.kind == "facts":
                _aedar_territorial_aggregate_snapshot(conn, item.target.type,
                    item.target.id, typequ, None, 100, 0, preflight_only=True)
            # (c) Published-descriptor domain check runs last: 422 only once the
            # publication is available and the value is not declared by it.
            if typequ:
                known = {row[0] for row in conn.execute(
                    "SELECT DISTINCT typequ FROM aedar_territorial_aggregate WHERE typequ=ANY(%s)",
                    (typequ,)).fetchall()}
                if known != set(typequ):
                    raise HTTPException(422, "Coordinate value is not present in the published AEDAR descriptor")
            if item.intent.kind == "fixed_comparison":
                return 1
            if item.intent.kind == "facts":
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
                conn, item.target.type, item.target.id, item.resource, selection, fields,
                include_scalar_facet=dual_scalar_series,
                scalar_facet_theme_id=resource.theme_id if dual_scalar_series else None,
                profile_coordinates=profile_coordinates)
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
            return work + int((estimate or {}).get("scalar_facet_work_units", 0))

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
        scalar_facet_work = 0
        if dual_scalar_series:
            scalar_estimate = self._indicator_facts_snapshot(conn, item.target.type,
                item.target.id, item.resource, self._scalar_facet_fields(item),
                preflight_only=True, scalar_facet=True, expected_theme_id=resource.theme_id)
            scalar_facet_work = int(scalar_estimate["work_units"])
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
        return estimate.get("work_units", declared_cells) + scalar_facet_work

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
        if item.target.kind == "territory_cohort":
            cohort = self._cohort_scopes.pop(id(item), None)
            if cohort is None:
                cohort = resolve_territory_cohort(conn, item.target, work_budget=200_000)
            return read_cohort(conn, item, resource, cohort,
                               self._legacy_fields(item, catalogue))
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
                self._comparison_field_selection(item.fields),
                include_scalar_facet=(self._has_dual_scalar_series(resource)
                                      and item.target.kind == "territory"),
                scalar_facet_theme_id=(resource.theme_id if self._has_dual_scalar_series(resource)
                                       and item.target.kind == "territory" else None),
                profile_coordinates=self._profile_comparison_coordinates(item, resource))
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
                    "content_version": version,
                    "reference_content_version": profile["reference_content_version"],
                    "descriptor": profile,
                    "observations": observations}

        data = self._indicator_facts_snapshot(
            conn, item.target.type, item.target.id, item.resource, requested_fields,
            require_declared_resource=True)
        if item.coordinates:
            data = self._filter_coordinates(data, item.coordinates, resource)
        if (self._has_dual_scalar_series(resource) and item.target.kind == "territory"):
            self._require_dual_series_route(conn, resource)
            data["scalar_facet"] = self._indicator_facts_snapshot(conn, item.target.type,
                item.target.id, item.resource, self._scalar_facet_fields(item),
                scalar_facet=True, expected_theme_id=resource.theme_id)
        return {"resource": item.resource, "target": item.target.model_dump(),
                **(data if isinstance(data, dict) else {"result": data})}

    @staticmethod
    def _typed_reading_preflight(conn, item, resource, *, work_budget=200_000):
        from api.typed_reading_snapshots import typed_reading_descriptor

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
        if (resource.publication_table in {"demographic_typed_reading", "selected_reading"}
                and work_budget < 1):
            raise HTTPException(413, "Resource request exceeds the bounded work limit")
        descriptor = typed_reading_descriptor(conn, resource, marker)
        # Publication tokens alone do not prove that declared physical rows
        # remain present. Validate the primary and evidence row counts with the
        # shared budgeted scan before counting focal rows.
        side_markers = []
        coordinates = item.coordinates or {}
        group = coordinates.get("groupe")
        selected_fields = set(resource.fields) if item.fields is None else set(item.fields)
        relation = resource.storage_relation
        for side in resource.side_relations:
            side_marker = conn.execute("""SELECT content_version,reference_content_version,row_count
                FROM table_publication WHERE table_name=%s""", (side["publication_table"],)).fetchone()
            if not side_marker or side_marker[1] != reference[0]:
                raise HTTPException(503, "Typed-reading evidence publication is unavailable or stale")
            if side["publication_table"] == resource.publication_table and side_marker[0] != marker[0]:
                raise HTTPException(503, "Typed-reading evidence publication is incompatible")
            if side.get("same_content_version_as") == "resource" and side_marker[0] != marker[0]:
                raise HTTPException(503, "Typed-reading evidence publication is stale")
            side_markers.append(side_marker)
        work = validate_typed_reading_integrity(
            conn, resource, marker, side_markers, work_budget)
        if descriptor and descriptor.get("source"):
            work += 1
        clauses = ["territory_id=%s", "territory_type=%s"]
        params = [item.target.id, item.target.type]
        if group:
            clauses.append("groupe=ANY(%s::text[])")
            params.append(group)
        work += int(conn.execute(f"SELECT count(*) FROM {relation} WHERE " + " AND ".join(clauses), params).fetchone()[0])
        if work > work_budget:
            raise HTTPException(413, "Resource request exceeds the bounded work limit")
        for side in resource.side_relations:
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
            if side["storage_relation"] == "milieux_reading_source" and "source_bindings" in selected_fields:
                remaining = work_budget - work
                revisions = conn.execute("""SELECT count(*) FROM (
                    SELECT a.provenance_revision_id FROM milieux_reading_source b
                    JOIN series_observation_provenance a ON a.dataset_id=b.dataset_id
                      AND a.indicator_id='artif_par_habitant' AND a.territory_id=b.territory_id
                      AND a.axis_value=b.axis_value
                    WHERE b.territory_id=%s AND b.territory_type=%s
                      AND b.field_key IN ('artif_m2_par_habitant','artif_m3_par_habitant')
                      AND (%s::text[] IS NULL OR b.groupe=ANY(%s::text[]))
                    LIMIT %s) AS bounded_rows""",
                    (item.target.id, item.target.type, group, group, remaining + 1)).fetchone()[0]
                work += int(revisions)
                if work > work_budget:
                    raise HTTPException(413, "Typed-reading source lineage exceeds the bounded work limit")
        return max(1, work)

    @staticmethod
    def _typed_reading_read(conn, item, resource):
        from api.typed_reading_snapshots import typed_reading_descriptor, typed_reading_fact_fields

        marker = conn.execute("""SELECT p.content_version,p.reference_content_version,t.content_version
            FROM table_publication p LEFT JOIN table_publication t
              ON t.table_name='territory_reference' WHERE p.table_name=%s""",
            (resource.publication_table,)).fetchone()
        if not marker or not marker[0] or not marker[1] or marker[1] != marker[2]:
            raise HTTPException(503, "Typed-reading publication is unavailable or stale")
        descriptor = typed_reading_descriptor(conn, resource, marker)
        coordinates = item.coordinates or {}
        selected_fields = set(resource.fields) if item.fields is None else set(item.fields)
        fields = typed_reading_fact_fields(resource, item.fields)
        clauses = ["territory_id=%s", "territory_type=%s"]
        params = [item.target.id, item.target.type]
        if coordinates.get("groupe"):
            clauses.append("groupe=ANY(%s::text[])")
            params.append(coordinates["groupe"])
        rows = conn.execute(f"SELECT {','.join('r.' + field for field in fields)},sd.name AS registry_name,"
            "sv.version AS registry_version,sv.reference_date AS registry_reference_date,"
            f"sv.publication_date AS registry_publication_date FROM {resource.storage_relation} r "
            "LEFT JOIN source_dataset sd ON sd.source_id=r.source_id "
            "LEFT JOIN source_vintage sv ON sv.source_id=r.source_id AND sv.vintage_id=r.vintage_id WHERE " +
            " AND ".join(clauses) + " ORDER BY groupe", params).fetchall() if fields else []
        facts = []
        for row in rows:
            fact = dict(zip((*fields, "registry_name", "registry_version", "registry_reference_date",
                             "registry_publication_date"), row))
            source_id, vintage_id = fact.get("source_id"), fact.get("vintage_id")
            if (not source_id or not vintage_id or not fact["registry_name"]
                    or not fact["registry_version"]):
                raise HTTPException(503, "Typed-reading source provenance is unavailable")
            declared_source = descriptor.get("source") if descriptor else None
            if declared_source and (source_id != declared_source["source_id"] or
                                    vintage_id != declared_source["vintage_id"]):
                raise HTTPException(503, "Typed-reading source differs from its published descriptor")
            fact["source"] = {
                "source_id": source_id, "name": fact.pop("registry_name"),
                "vintage_id": vintage_id, "version": fact.pop("registry_version"),
                "reference_date": fact.pop("registry_reference_date"),
                "publication_date": fact.pop("registry_publication_date"),
            }
            facts.append(fact)
        evidence = {}
        for side in resource.side_relations:
            if side["field"] not in selected_fields and side["field"] != "source_absences":
                continue
            side_fields = list(side["fields"])
            side_clauses = ["r.territory_id=%s", "r.territory_type=%s"]
            side_params = [item.target.id, item.target.type]
            if "groupe" in side_fields and coordinates.get("groupe"):
                side_clauses.append("r.groupe=ANY(%s::text[])")
                side_params.append(coordinates["groupe"])
            order = ("r.rank" if "rank" in side_fields else
                     ",".join("r." + field for field in side_fields))
            milieux_bindings = side["storage_relation"] == "milieux_reading_source"
            revision_select = (",p.source_id AS population_source_id,p.vintage_id AS population_vintage_id,"
                "p.source_name AS population_source_name,p.source_version AS population_source_version,"
                "p.reference_date AS population_reference_date,p.publication_date AS population_publication_date,"
                "s.source_id AS series_source_id,s.vintage_id AS series_vintage_id,"
                "s.source_name AS series_source_name,s.source_version AS series_source_version,"
                "s.reference_date AS series_reference_date,s.publication_date AS series_publication_date,"
                "o.state_role AS observed_state_role,o.observation_period AS observed_period,"
                "ARRAY(SELECT a.provenance_revision_id FROM series_observation_provenance a "
                "WHERE a.dataset_id=r.dataset_id AND a.indicator_id='artif_par_habitant' "
                "AND a.territory_id=r.territory_id AND a.axis_value=r.axis_value "
                "ORDER BY a.provenance_revision_id) AS registered_revisions"
                if milieux_bindings else "")
            revision_joins = (" LEFT JOIN milieux_population_provenance_revision p "
                "ON p.population_revision_id=r.population_revision_id "
                "LEFT JOIN series_provenance_revision s ON s.provenance_revision_id=r.provenance_revision_id "
                "LEFT JOIN series_dataset_observation o ON o.dataset_id=r.dataset_id "
                "AND o.indicator_id='artif_par_habitant' AND o.territory_id=r.territory_id "
                "AND o.territory_type=r.territory_type AND o.axis_value=r.axis_value"
                if milieux_bindings else "")
            side_rows = conn.execute(f"SELECT {','.join('r.' + field for field in side_fields)},"
                "sd.name AS registry_name,sv.version AS registry_version,"
                "sv.reference_date AS registry_reference_date,sv.publication_date AS registry_publication_date" +
                revision_select + " "
                f"FROM {side['storage_relation']} r "
                "LEFT JOIN source_dataset sd ON sd.source_id=r.source_id "
                "LEFT JOIN source_vintage sv ON sv.source_id=r.source_id AND sv.vintage_id=r.vintage_id" +
                revision_joins + " WHERE " +
                " AND ".join(side_clauses) + f" ORDER BY {order}", side_params).fetchall()
            side_rows_with_source = []
            for row in side_rows:
                extras = ["registry_name", "registry_version", "registry_reference_date",
                          "registry_publication_date"]
                if milieux_bindings:
                    extras.extend([f"{prefix}_{field}" for prefix in ("population", "series")
                                   for field in ("source_id", "vintage_id", "source_name", "source_version",
                                                 "reference_date", "publication_date")])
                    extras.extend(("observed_state_role", "observed_period", "registered_revisions"))
                value = dict(zip((*side_fields, *extras), row))
                source_id, vintage_id = value.get("source_id"), value.get("vintage_id")
                own_name = value.get("source_name") or value.get("registry_name")
                own_version = value.get("source_version") or value.get("registry_version")
                if not source_id or not vintage_id or not own_name or not own_version:
                    raise HTTPException(503, "Typed-reading evidence provenance is unavailable")
                source = {"source_id": source_id, "name": own_name, "vintage_id": vintage_id,
                    "version": own_version,
                    "reference_date": (value.get("reference_date") if "reference_date" in value
                                       else value.get("registry_reference_date")),
                    "publication_date": (value.get("publication_date") if "publication_date" in value
                                          else value.get("registry_publication_date"))}
                for key in ("registry_name", "registry_version", "registry_reference_date",
                            "registry_publication_date"):
                    value.pop(key, None)
                value["source"] = source
                side_rows_with_source.append(value)
            if milieux_bindings:
                from api.typed_reading_snapshots import validate_milieux_source_bindings
                validate_milieux_source_bindings(conn, side_rows_with_source, marker[1])
                for value in side_rows_with_source:
                    for prefix in ("population", "series"):
                        for field in ("source_id", "vintage_id", "source_name", "source_version",
                                      "reference_date", "publication_date"):
                            value.pop(f"{prefix}_{field}", None)
                    for key in ("observed_state_role", "observed_period", "registered_revisions"):
                        value.pop(key, None)
            evidence[side["field"]] = side_rows_with_source
        if "source_absences" in evidence:
            absences = evidence["source_absences"]
            has_facts = bool(facts)
            if not fields:
                has_facts = conn.execute(f"SELECT 1 FROM {resource.storage_relation} WHERE " +
                    " AND ".join(clauses) + " LIMIT 1", params).fetchone() is not None
            if (not has_facts and len(absences) != 1) or (has_facts and absences):
                raise HTTPException(503, "Milieux reading is missing or overlaps its source-absence evidence")
        return {"resource": item.resource, "target": item.target.model_dump(),
                "content_version": marker[0], "reference_content_version": marker[1],
                **({"descriptor": descriptor} if descriptor is not None else {}), "facts": facts,
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
                source_facet = result["source_facet"]
                values = None
                if isinstance(source_facet, dict):
                    matches = all(str(source_facet.get(axis)) in set(values)
                                  for axis, values in coordinates.items())
                else:
                    if "declared_profile" in getattr(resource, "shapes", ()):
                        # A profile may declare a distinct linked scalar
                        # comparison (for example the DPE signature). Its
                        # result is not a comparison of the selected profile bin.
                        rows_found = True
                        matches = True
                    else:
                        axis = resource.axes[0] if resource.axes else "axis"
                        values = coordinates.get(axis)
                        matches = values is not None and str(source_facet) in set(values)
                if (isinstance(source_facet, dict) or values is not None
                        or "declared_profile" in getattr(resource, "shapes", ())):
                    rows_found = True
                    if not matches:
                        for field in ("median", "mean", "rank", "rank_size", "rank_ties",
                                      "focal_value", "mean_curve"):
                            result.pop(field, None)
                        result["status"] = "unavailable"
                        result["reason"] = "selected_coordinate_has_no_comparison_result"
        if not rows_found:
            raise HTTPException(503, "Published resource does not expose its declared coordinate rows")
        return data
