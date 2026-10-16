"""Source-grain AEDAR aggregate and fixed-comparison snapshots."""

from fastapi import HTTPException

from api.aedar_models import AEDAR_MEASURE_KEYS
from api.field_selection import normalize_field_selection

_AEDAR_COMPARISON_OPTIONAL_FIELDS = {
    "group_value", "value", "rank", "rank_size", "member_count", "eligible_count", "missing_count",
}
_AEDAR_COMPARISON_MANDATORY_FIELDS = {
    "comparison_context", "group_id", "territory_type", "typequ", "typequ_label",
    "source_id", "vintage_id", "source_url", "licence", "attribution", "reference_date",
    "publication_date", "measure", "statistic", "group_n_addresses", "group_n_observed",
    "group_coverage_status", "n_addresses", "n_observed", "coverage_status", "status",
}

def _aedar_comparison_field_selection(fields):
    return normalize_field_selection(
        fields, _AEDAR_COMPARISON_OPTIONAL_FIELDS | _AEDAR_COMPARISON_MANDATORY_FIELDS)


def _aedar_territorial_aggregate_snapshot(conn, territory_type, territory_id,
                                         typequ=None, fields=None, limit=50, offset=0,
                                         *, preflight_only=False):
    """Build the published AEDAR aggregate response in a caller-owned snapshot."""
    if typequ is not None and (not typequ or any(not item or len(item)>32 for item in typequ)):
        raise HTTPException(422, "typequ must contain non-empty source codes")
    optional_fields = {"measures." + key for key in AEDAR_MEASURE_KEYS}
    selected_fields = normalize_field_selection(fields, optional_fields)
    selected_measure_keys = ({field.removeprefix("measures.") for field in selected_fields
                              if field.startswith("measures.")} if selected_fields is not None else None)
    marker = conn.execute("""SELECT p.content_version,p.row_count,p.reference_content_version,t.content_version
              FROM table_publication p JOIN table_publication t ON t.table_name='territory_reference'
              WHERE p.table_name='aedar_territorial_aggregate'""").fetchone()
    if not marker or not marker[0] or marker[1] < 1 or marker[2] != marker[3]:
        raise HTTPException(503,"AEDAR territorial publication is unavailable or incompatible")
    supported = conn.execute("SELECT 1 FROM territory_reference WHERE territory_type=%s AND territory_id=%s",
                             (territory_type,territory_id)).fetchone()
    if not supported:
        raise HTTPException(404,"Unknown territory type/id")
    if preflight_only:
        return {"content_version": marker[0], "reference_content_version": marker[2]}
    measure_projection = ("measures" if selected_measure_keys is None else
        "COALESCE((SELECT jsonb_object_agg(k, v) FROM jsonb_each(aedar_territorial_aggregate.measures) AS m(k,v) WHERE k = ANY(%s::text[])), '{}'::jsonb) AS measures")
    base_projection = """SELECT territory_id,territory_type,typequ,typequ_label,typequ_hierarchy_label,typequ_description,
              typequ_domain_code,typequ_domain_label,typequ_subdomain_code,typequ_subdomain_label,
              typequ_gamme,typequ_gamme_status,typequ_source_order,identity,
              n_addresses,n_observed,coverage_status,""" + measure_projection + """,source_id,vintage_id,source_url,licence,attribution,
              reference_date,publication_date
              FROM aedar_territorial_aggregate
              WHERE territory_type=%s AND territory_id=%s AND (%s::text[] IS NULL OR typequ=ANY(%s))
              ORDER BY typequ LIMIT %s OFFSET %s"""
    params = ((sorted(selected_measure_keys), territory_type,territory_id,typequ,typequ,limit,offset)
              if selected_measure_keys is not None else
              (territory_type,territory_id,typequ,typequ,limit,offset))
    cursor = conn.execute(base_projection, params)
    names = [d.name for d in cursor.description]
    rows = [dict(zip(names,row)) for row in cursor.fetchall()]
    expected_measures = AEDAR_MEASURE_KEYS if selected_measure_keys is None else selected_measure_keys
    if any(set(row["measures"] or {}) != expected_measures for row in rows):
        raise HTTPException(503, "AEDAR measure publication is incomplete for the requested projection")
    required_typequ_metadata = ("typequ_hierarchy_label","typequ_description","typequ_domain_code","typequ_domain_label",
        "typequ_subdomain_code","typequ_subdomain_label","typequ_gamme_status","typequ_source_order")
    if any(any(row[key] is None for key in required_typequ_metadata) for row in rows):
        raise HTTPException(503,"AEDAR TYPEQU metadata publication is incomplete")
    return {"territory":{"territory_type":territory_type,"territory_id":territory_id},
      "content_version":marker[0],"reference_content_version":marker[2],"limit":limit,"offset":offset,
      "facts":rows}


def _aedar_comparison_snapshot(conn, territory_type, territory_id, context,
                               typequ, measure, fields=None, *, preflight_only=False):
    """Build one fixed AEDAR result inside a caller-owned snapshot."""
    if measure not in AEDAR_MEASURE_KEYS:
        raise HTTPException(422, "Unknown AEDAR measure")
    selected_fields = _aedar_comparison_field_selection(fields)
    selected = set(_AEDAR_COMPARISON_OPTIONAL_FIELDS) if selected_fields is None else set(selected_fields)
    marker = conn.execute("""SELECT p.content_version,p.source_snapshot_id,p.aedar_content_version,
              p.reference_content_version,p.input_content_version,p.input_identity,p.group_row_count,p.territory_row_count,
              a.content_version,r.content_version
              FROM aedar_comparison_publication p
              JOIN table_publication a ON a.table_name='aedar_territorial_aggregate'
              JOIN table_publication r ON r.table_name='territory_reference'
              WHERE p.singleton""").fetchone()
    if not marker or marker[2] != marker[8] or marker[3] != marker[9] or marker[6] < 1 or marker[7] < 1 or marker[1] != "2026-v1":
        raise HTTPException(503, "AEDAR comparison publication is unavailable or stale")
    territory = conn.execute("SELECT 1 FROM territory_reference WHERE territory_type=%s AND territory_id=%s",
                             (territory_type, territory_id)).fetchone()
    if not territory:
        raise HTTPException(404, "Unknown territory type/id")
    if preflight_only:
        return {"content_version": marker[0], "reference_content_version": marker[3]}
    cursor = conn.execute("""SELECT g.comparison_context,g.group_id,g.territory_type,g.typequ,
              a.typequ_label,a.source_id,a.vintage_id,a.source_url,a.licence,a.attribution,a.reference_date,a.publication_date,
              g.measure,g.statistic,
              CASE WHEN %s THEN g.value ELSE NULL::double precision END AS group_value,g.n_addresses AS group_n_addresses,
              g.n_observed AS group_n_observed,g.coverage_status AS group_coverage_status,
              CASE WHEN %s THEN g.member_count ELSE NULL::integer END AS member_count,
              CASE WHEN %s THEN g.eligible_count ELSE NULL::integer END AS eligible_count,
              CASE WHEN %s THEN g.missing_count ELSE NULL::integer END AS missing_count,
              CASE WHEN %s THEN t.value ELSE NULL::double precision END AS value,
              t.status,t.n_addresses,t.n_observed,t.coverage_status,
              CASE WHEN %s THEN t.rank ELSE NULL::integer END AS rank,
              CASE WHEN %s THEN t.rank_size ELSE NULL::integer END AS rank_size
              FROM aedar_comparison_territory t JOIN aedar_comparison_group g USING
                (comparison_context,group_id,territory_type,typequ,measure)
              JOIN aedar_territorial_aggregate a ON (a.territory_type,a.territory_id,a.typequ)=
                (t.territory_type,t.territory_id,t.typequ)
              WHERE t.territory_type=%s AND t.territory_id=%s AND t.comparison_context=%s
                AND t.typequ=%s AND t.measure=%s""",
                 ("group_value" in selected,"member_count" in selected,"eligible_count" in selected,
                 "missing_count" in selected,"value" in selected,"rank" in selected,"rank_size" in selected,
                  territory_type,territory_id,context,typequ,measure))
    row = cursor.fetchone()
    if not row:
        raise HTTPException(404, "No published result for this fixed context")
    names = [column.name for column in cursor.description]
    result = dict(zip(names,row))
    for key in _AEDAR_COMPARISON_OPTIONAL_FIELDS-selected:
        result.pop(key,None)
    return {"territory":{"territory_type":territory_type,"territory_id":territory_id},
      "content_version":marker[0],"source_snapshot_id":marker[1],
      "aedar_content_version":marker[2],"reference_content_version":marker[3],
      "input_content_version":marker[4],"input_identity":marker[5],"comparison":result}


