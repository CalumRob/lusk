from fastapi import HTTPException
import pytest

from api.field_selection import normalize_field_selection


def test_omitted_selection_preserves_legacy_full_response():
    assert normalize_field_selection(None, {"value", "status"}) is None


def test_selection_is_normalized_and_rejects_empty_duplicate_and_unknown_fields():
    assert normalize_field_selection(["denominator_count", "support_count"],
                                     {"support_count", "denominator_count"}) == (
                                         "denominator_count", "support_count")
    for invalid in ([], [""], ["value", "value"], ["raw_sql"]):
        with pytest.raises(HTTPException) as error:
            normalize_field_selection(invalid, {"value"})
        assert error.value.status_code == 422


def test_aedar_projection_happens_inside_sql_and_scalar_uses_only_contract_columns():
    from api import aedar_reads, aedar_routes, snapshot_reads
    from api.main import app

    aedar = next(route.endpoint for route in aedar_routes.create_aedar_router(get_pool=lambda: None).routes if getattr(route, "path", "") ==
        "/api/aedar/territories/{territory_type}/{territory_id}/aggregates")
    import inspect
    aedar_source = inspect.getsource(aedar_reads._aedar_territorial_aggregate_snapshot)
    scalar_source = inspect.getsource(snapshot_reads._indicator_facts_snapshot)
    assert "jsonb_object_agg" in aedar_source and "jsonb_each" in aedar_source
    assert "selected_measure_keys" in aedar_source
    assert '"value": "o.value"' in scalar_source
    assert '"support_count": "o.support_count"' in scalar_source
    assert '"denominator_count": "o.denominator_count"' in scalar_source
    assert "o.value, o.status" not in scalar_source
    assert 'selected_scalar_columns' in scalar_source
    assert "bpe_profile_evidence" not in scalar_source
