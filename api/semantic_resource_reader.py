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

    def preflight(self, conn, item, catalogue: ResourceCatalogue | None = None) -> int:
        catalogue = catalogue or default_resource_catalogue()
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
            self._indicator_comparison_preflight(
                conn, item.target.type, item.target.id, item.resource, selection, fields)
            if item.intent.kind == "fixed_comparison":
                return 1
            resource = catalogue.resources_by_id[item.resource]
            axis_work = 1
            for _, values in resource.axis_values:
                axis_work *= max(1, len(values))
            return len(selection) * axis_work

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
        if item.intent.kind in {"fixed_comparison", "selected_comparison"}:
            selection = ([(member.type, member.id) for member in item.intent.members]
                         if item.intent.kind == "selected_comparison" else None)
            data = self._indicator_comparison_snapshot(
                conn, item.target.type, item.target.id, item.resource, selection,
                self._comparison_field_selection(item.fields))
            return {"resource": item.resource, "target": item.target.model_dump(), **data}

        requested_fields = self._legacy_fields(item, catalogue)
        if item.target.kind == "named_reference":
            route = self._owned_series_route(conn, item.resource)
            if not route or not route[2]:
                raise HTTPException(503, "Named reference publication is unavailable")
            data = self._owned_named_reference_snapshot(conn, route, None, None, item.resource,
                fields=requested_fields, reference_target_id=item.target.id)
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
            dimensions = {"detail": "detail", "sex": "sex", "typequ": "typequ",
                          "year": "axis", "duration_minute": "axis", "declared_detail": "axis",
                          "axis": "axis", "period": "observation_period", "state_role": "state_role"}
            for key in ("cells", "points", "observations", "facts", "entries"):
                rows = data.get(key) if isinstance(data, dict) else None
                if not isinstance(rows, list):
                    continue
                for axis, values in item.coordinates.items():
                    if axis in resource.dynamic_axes:
                        axis_field = dimensions.get(axis, "axis")
                        available = {row.get(axis_field) for row in rows}
                        if not set(values) <= available:
                            raise HTTPException(422,
                                "Coordinate value is not present in the published descriptor")
                data[key] = [row for row in rows if all(
                    axis in dimensions and row.get(dimensions[axis]) in values
                    for axis, values in item.coordinates.items())]
                break
            for key in ("relationships", "summaries"):
                rows = data.get(key) if isinstance(data, dict) else None
                if isinstance(rows, list) and "detail" in item.coordinates:
                    data[key] = [row for row in rows if row.get("detail") in item.coordinates["detail"]]
        return {"resource": item.resource, "target": item.target.model_dump(),
                **(data if isinstance(data, dict) else {"result": data})}
