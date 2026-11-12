"""Source-grain AEDAR aggregate, fixed-comparison and selected-comparison snapshots."""

from math import fsum, isfinite
from typing import NamedTuple

from fastapi import HTTPException

from api.aedar_models import AEDAR_AGGREGATE_READINGS, AEDAR_MEASURE_KEYS
from api.field_selection import normalize_field_selection
from api.publication_outcomes import publication_unavailable


def _aedar_territory_summary_snapshot(conn, territory_type, territory_ids, measures, *,
                                      preflight_only=False):
    """Read published registry-wide readings from one caller-owned RR snapshot.

    The summary has its own content clock (its canonical hash differs from the
    source-grain hash); compatibility is established by explicit source and
    reference clocks plus a complete, internally consistent publication marker.
    """
    requested = tuple(dict.fromkeys(measures))
    if not requested or not set(requested) <= set(AEDAR_AGGREGATE_READINGS):
        raise HTTPException(422, "Unknown AEDAR summary measure")
    ids = tuple(sorted(set(territory_ids)))
    if not ids:
        return {"content_version": None, "aedar_content_version": None,
                "reference_content_version": None, "readings": {}}
    marker = conn.execute("""SELECT s.content_version,s.row_count,s.reference_content_version,
            s.aedar_source_content_version,a.content_version,a.reference_content_version,r.content_version
        FROM table_publication s
        JOIN table_publication a ON a.table_name='aedar_territorial_aggregate'
        JOIN table_publication r ON r.table_name='territory_reference'
        WHERE s.table_name='aedar_territory_summary'""").fetchone()
    if not marker:
        # The joins hide which publication is absent. The shared territory
        # reference is request-wide; only the AEDAR summary's own absence is a
        # typed item outcome.
        reference = conn.execute(
            "SELECT content_version FROM table_publication WHERE table_name='territory_reference'"
        ).fetchone()
        if not reference or not reference[0]:
            raise HTTPException(503, "Territory reference publication is unavailable")
        summary = conn.execute("""SELECT content_version,row_count FROM table_publication
            WHERE table_name='aedar_territory_summary'""").fetchone()
        if not summary or not summary[0] or summary[1] < 1:
            publication_unavailable("aedar",
                "AEDAR territory summary publication is unavailable")
        aedar = conn.execute(
            "SELECT content_version FROM table_publication WHERE table_name='aedar_territorial_aggregate'"
        ).fetchone()
        if not aedar or not aedar[0]:
            raise HTTPException(503, "AEDAR territory summary dependency publication is unavailable")
        raise HTTPException(503, "AEDAR territory summary publication is stale or incompatible")
    if not marker[0] or marker[1] < 1 or not marker[3]:
        publication_unavailable("aedar", "AEDAR territory summary publication is unavailable")
    if (marker[2] != marker[6] or marker[4] != marker[3]
            or marker[5] != marker[6]):
        raise HTTPException(503, "AEDAR territory summary publication is stale or incompatible")
    if preflight_only:
        return {"content_version": marker[0], "aedar_content_version": marker[3],
                "reference_content_version": marker[2]}
    cursor = conn.execute("""SELECT territory_id,measure,value,status,n_typequ,n_addresses,n_observed,
            coverage_status,source_id,vintage_id,source_url,licence,attribution,reference_date,publication_date
        FROM aedar_territory_summary WHERE territory_type=%s AND territory_id=ANY(%s::text[])
          AND measure=ANY(%s::text[]) ORDER BY territory_id,measure""",
        (territory_type, list(ids), list(requested)))
    rows = cursor.fetchall()
    by_key = {(row[0], row[1]): row[2:] for row in rows}
    expected = {(territory_id, measure) for territory_id in ids for measure in requested}
    if len(by_key) != len(rows) or set(by_key) != expected:
        raise HTTPException(503, "AEDAR territory summary is incomplete for the requested projection")
    readings = {}
    for (territory_id, measure), row in by_key.items():
        (value,status,n_typequ,n_addresses,n_observed,coverage,source,vintage,url,licence,
         attribution,reference_date,publication_date) = row
        if status not in ("available", "unavailable") or (status == "available" and
                (value is None or not isfinite(value) or n_typequ != 235 or n_addresses is None or n_addresses <= 0
                 or n_observed is None or n_observed < 0 or n_observed > 235 * n_addresses
                 or coverage != "covered")) or (status == "unavailable" and
                 (value is not None or n_typequ is not None or
                  (n_addresses is not None and n_addresses < 0) or
                  (n_observed is not None and n_observed < 0))):
            raise HTTPException(503, "AEDAR territory summary contains an invalid reading")
        readings[(territory_id, measure)] = {"value": value, "available": status == "available",
            "n_typequ": n_typequ, "n_addresses": n_addresses, "n_observed": n_observed,
            "coverage_status": coverage, "statistic": "direct", "source_id": source,
            "vintage_id": vintage, "source_url": url, "licence": licence,
            "attribution": attribution, "reference_date": reference_date,
            "publication_date": publication_date}
    provenance = {(v["source_id"],v["vintage_id"],v["source_url"],v["licence"],v["attribution"],
                   v["reference_date"],v["publication_date"]) for v in readings.values()}
    if len(provenance) != 1:
        raise HTTPException(503, "AEDAR territory summary provenance is inconsistent")
    return {"content_version": marker[0], "aedar_content_version": marker[3],
            "reference_content_version": marker[2], "readings": readings}


def _aedar_territory_summary_resource_snapshot(conn, territory_type, territory_id,
                                               measures, fields, summary_fields, *,
                                               preflight_only=False):
    """Read a projected focal summary without acquiring TYPEQU detail facts."""
    requested = tuple(dict.fromkeys(AEDAR_AGGREGATE_READINGS if measures is None else measures))
    if not requested or not set(requested) <= set(AEDAR_AGGREGATE_READINGS):
        raise HTTPException(422, "Unknown AEDAR summary measure")
    selected_fields = normalize_field_selection(fields, set(summary_fields))
    territory = conn.execute(
        "SELECT 1 FROM territory_reference WHERE territory_type=%s AND territory_id=%s",
        (territory_type, territory_id)).fetchone()
    if not territory:
        raise HTTPException(404, "Unknown territory type/id")
    snapshot = _aedar_territory_summary_snapshot(
        conn, territory_type, [territory_id], requested, preflight_only=preflight_only)
    if preflight_only:
        return snapshot
    projected = set(summary_fields) if selected_fields is None else set(selected_fields)
    readings = []
    for measure in requested:
        record = snapshot["readings"][(territory_id, measure)]
        values = {**record, "status": "available" if record["available"] else "unavailable",
                  "statistic": "direct"}
        readings.append({"measure": measure,
                         **{field: values[field] for field in summary_fields if field in projected}})
    return {"territory": {"territory_type": territory_type, "territory_id": territory_id},
            "summary_content_version": snapshot["content_version"],
            "aedar_content_version": snapshot["aedar_content_version"],
            "reference_content_version": snapshot["reference_content_version"],
            "readings": readings}


def _aedar_summary_records(snapshot, measures, territory_ids):
    """Adapt validated summary readings to the fixed-comparison record shape."""
    return {measure: {territory_id: snapshot["readings"][(territory_id, measure)]
                      for territory_id in territory_ids}
            for measure in measures}


def _aedar_summary_provenance(snapshot):
    reading = next(iter(snapshot["readings"].values()))
    return tuple(reading[key] for key in ("source_id", "vintage_id", "source_url", "licence",
                                           "attribution", "reference_date", "publication_date"))

_AEDAR_COMPARISON_OPTIONAL_FIELDS = {
    "group_value", "value",
}
# Request-time rank fields of AEDAR comparisons (ADR-0039's 2026-11-04
# aggregate-ranks amendment, #914, and the 2026-11-10 per-cell amendment,
# #951). They are opt-in for every fixed and selected comparison; a fixed
# per-cell default projection therefore keeps its reference-only shape.
_AEDAR_AGGREGATE_RANK_FIELDS = {"rank", "rank_size", "rank_ties"}
_AEDAR_COMPARISON_MANDATORY_FIELDS = {
    "comparison_context", "group_id", "territory_type", "typequ", "typequ_label",
    "source_id", "vintage_id", "source_url", "licence", "attribution", "reference_date",
    "publication_date", "measure", "statistic", "group_n_addresses", "group_n_observed",
    "group_coverage_status", "n_addresses", "n_observed", "coverage_status", "status",
}

def _aedar_comparison_optional_fields(aggregate):
    return _AEDAR_COMPARISON_OPTIONAL_FIELDS | (_AEDAR_AGGREGATE_RANK_FIELDS if aggregate else set())

def _aedar_comparison_field_selection(fields):
    """Validate one comparison projection; rank fields are selectable in both shapes.

    The aggregate readings keep the rank fields in their default projection
    (#914), while a fixed per-cell default stays reference-only; that difference
    lives in `_aedar_comparison_optional_fields`, never in what is selectable.
    """
    return normalize_field_selection(
        fields, _AEDAR_COMPARISON_OPTIONAL_FIELDS | _AEDAR_AGGREGATE_RANK_FIELDS
        | _AEDAR_COMPARISON_MANDATORY_FIELDS)

def _aedar_requested_rank_fields(fields, aggregate):
    """The rank fields this comparison actually requests.

    The fixed per-cell default projection predates the rank fields, so `None`
    (the full default response) only carries them on the aggregate readings —
    the shape #914 established. Per-cell ranks are strictly opt-in, which keeps
    every unranked request byte-equivalent to its pre-#951 response.
    """
    selected = _aedar_comparison_field_selection(fields)
    if selected is None:
        return set(_AEDAR_AGGREGATE_RANK_FIELDS) if aggregate else set()
    return set(selected) & _AEDAR_AGGREGATE_RANK_FIELDS

def _aedar_peer_rank(values, focal_id, direction):
    """Direction-aware flat ordinal of one focal among eligible peer values.

    Ranks are competition ranks (`1, 1, 3`): ties share the focal's rank and
    the next rank skips. Only eligible peers are in `values` — an unavailable
    peer is excluded, never converted to zero or ranked. An ineligible focal is
    not ranked at all.
    """
    focal_value = values.get(focal_id)
    if focal_value is None:
        return None, None, None
    better = sum(1 for value in values.values()
                 if (value > focal_value if direction == "high" else value < focal_value))
    return (better + 1, len(values),
            sum(1 for value in values.values() if value == focal_value))

def _aedar_cell_value_published(value):
    """Whether the producer published a comparable value for one per-cell cell.

    This is the selected comparison's law: a finite published value. An
    uncovered territory row publishes no value (the producer writes NULL when it
    has no address origin for the cell), while a genuine zero is a real value
    and stays rankable.
    """
    return value is not None and isfinite(value)

def _aedar_fixed_peer_ids_cached(conn, territory_type, territory_id, context, snapshot_state):
    """Resolve the fixed context's peer group once per snapshot state."""
    key = (territory_type, territory_id, context)
    cache = snapshot_state.setdefault("aedar_fixed_peer_ids", {}) if snapshot_state is not None else None
    peer_ids = cache.get(key) if cache is not None else None
    if peer_ids is None:
        peer_ids = _aedar_fixed_peer_ids(conn, territory_type, territory_id, context)
        if cache is not None:
            cache[key] = peer_ids
    return peer_ids

def _aedar_fixed_cell_rank(conn, territory_type, territory_id, typequ, measure, context,
                           facet, snapshot_state=None):
    """Request-time rank of one fixed per-cell reading over the context's peers.

    One set-wise read of the resolved peer population per comparison item (no
    per-peer round trips); the peer values come from the same published
    `aedar_territorial_aggregate` snapshot the reference and focal were read in.
    """
    if not facet.get("ranked"):
        return None, None, None
    peer_ids = _aedar_fixed_peer_ids_cached(conn, territory_type, territory_id, context,
                                            snapshot_state)
    rows = conn.execute("""SELECT territory_id,(measures->>%s)::double precision AS value
              FROM aedar_territorial_aggregate
              WHERE territory_type=%s AND territory_id=ANY(%s::text[]) AND typequ=%s""",
        (measure, territory_type, peer_ids, typequ)).fetchall()
    comparable = {row[0]: row[1] for row in rows if _aedar_cell_value_published(row[1])}
    return _aedar_peer_rank(comparable, territory_id, facet["direction"])


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
    if not marker:
        reference = conn.execute(
            "SELECT content_version FROM table_publication WHERE table_name='territory_reference'"
        ).fetchone()
        if not reference or not reference[0]:
            raise HTTPException(503, "Territory reference publication is unavailable")
        own = conn.execute("""SELECT content_version,row_count FROM table_publication
            WHERE table_name='aedar_territorial_aggregate'""").fetchone()
        if not own or not own[0] or own[1] < 1:
            publication_unavailable("aedar", "AEDAR territorial publication is unavailable")
        raise HTTPException(503, "AEDAR territorial publication is stale or incompatible")
    if not marker[0] or marker[1] < 1:
        publication_unavailable("aedar", "AEDAR territorial publication is unavailable")
    if marker[2] != marker[3]:
        raise HTTPException(503, "AEDAR territorial publication is stale or incompatible")
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


def _aedar_comparison_marker(conn):
    """Read and validate the reference-only AEDAR comparison publication marker."""
    marker = conn.execute("""SELECT p.content_version,p.source_snapshot_id,p.aedar_content_version,
              p.reference_content_version,p.input_content_version,p.input_identity,p.group_row_count,p.territory_row_count,
              p.publication_mode,
              a.content_version,r.content_version
              ,p.density_summary_class_count,p.density_summary_measure_count,p.density_summary_row_count,
              (SELECT count(*) FROM aedar_density_class_summary s
                 WHERE s.comparison_content_version=p.content_version),
              (SELECT count(DISTINCT group_id) FROM aedar_density_class_summary s
                  WHERE s.comparison_content_version=p.content_version),
              p.density_summary_typequ_count
              FROM aedar_comparison_publication p
              LEFT JOIN table_publication a ON a.table_name='aedar_territorial_aggregate'
              LEFT JOIN table_publication r ON r.table_name='territory_reference'
              WHERE p.singleton""").fetchone()
    if not marker or not marker[0]:
        reference = conn.execute(
            "SELECT content_version FROM table_publication WHERE table_name='territory_reference'"
        ).fetchone()
        if not reference or not reference[0]:
            raise HTTPException(503, "Territory reference publication is unavailable")
        publication_unavailable("aedar", "AEDAR comparison publication is unavailable")
    if marker[9] is None or marker[10] is None:
        raise HTTPException(503, "AEDAR comparison dependency publication is unavailable")
    if (marker[2] != marker[9] or marker[3] != marker[10] or marker[6] < 1 or
             marker[7] != 0 or marker[8] != "reference_only" or marker[1] != "2026-v1" or
             marker[11] < 1 or marker[12] != len(AEDAR_AGGREGATE_READINGS) or
             marker[13] != marker[11] * marker[12] or marker[14] != marker[13] or
             marker[15] != marker[11] or marker[16] < 1):
        raise HTTPException(503, "AEDAR comparison publication is stale or incompatible")
    return marker


def _aedar_direct_reference(conn, measure, reference_type, group_id, typequ):
    """Read one direct published aggregate as a fixed reference (statistic direct)."""
    row = conn.execute("""SELECT (measures->>%s)::double precision AS value,n_addresses,n_observed,coverage_status
        FROM aedar_territorial_aggregate WHERE territory_type=%s AND territory_id=%s AND typequ=%s""",
        (measure,reference_type,group_id,typequ)).fetchone()
    return (*row, "direct") if row else None


# Structural guarantee of the territorial adapter: it reads one territory's own
# published rows, so the reading's statistic is direct by construction.
_AEDAR_TERRITORIAL_DIRECT_STATISTIC = "direct"
_AEDAR_TERRITORIAL_DIRECT_STATISTIC_TIE = 1


class _AEDARAggregateLawInputs(NamedTuple):
    """The one normalized law-input record emitted by both aggregate SQL adapters."""
    n_rows: int
    n_measured: int
    total: float | None
    v_min: float | None
    v_max: float | None
    na_min: int | None
    na_max: int | None
    observed_sum: int | None
    n_provenance: int
    n_uncovered: int
    n_bad_observed: int
    n_statistic: int
    statistic: str | None
    coverage: str | None
    n_coverage: int


_AEDAR_AGGREGATE_RECORDS_SQL = f"""SELECT territory_id,
       count(*) AS n_rows,
       count((measures->>%s)::double precision) AS n_measured,
       sum((measures->>%s)::double precision) AS total,
       min((measures->>%s)::double precision) AS v_min,
       max((measures->>%s)::double precision) AS v_max,
       min(n_addresses) AS na_min, max(n_addresses) AS na_max,
       sum(n_observed)::bigint AS observed_sum,
       count(DISTINCT (source_id,vintage_id,source_url,licence,attribution,
                      reference_date,publication_date)) AS n_provenance,
       count(*) FILTER (WHERE coverage_status IS DISTINCT FROM 'covered') AS n_uncovered,
       count(*) FILTER (WHERE n_observed IS NULL OR n_observed < 0
                          OR n_observed > n_addresses) AS n_bad_observed,
       {_AEDAR_TERRITORIAL_DIRECT_STATISTIC_TIE} AS n_statistic,
       '{_AEDAR_TERRITORIAL_DIRECT_STATISTIC}' AS statistic,
       min(coverage_status) AS coverage,
       count(DISTINCT coverage_status) AS n_coverage
FROM aedar_territorial_aggregate
WHERE territory_type=%s AND territory_id=ANY(%s::text[])
GROUP BY territory_id"""


def _aedar_aggregate_available(inputs, registry_size, underlying):
    """The fiche's compatibility law over one normalized law-input record.

    Applied once, over the single record type both adapters emit. Mirrors
    `carAccessMeans` (app/src/fiche/content/aedarAccessSection.ts) and
    CONTEXT.md « Moyennes d'accès en voiture AEDAR »: the reading is available
    only over the complete TYPEQU registry, with one shared source
    vintage/provenance across all rows, one uniform statistic, every row
    `covered`, an agreeing positive address population, valid observed counts
    (0 <= n_observed <= n_addresses; NULL counts as bad) and finite
    non-negative per-type values (<= 1 for share readings). Incomplete,
    uncovered or unknown evidence never becomes a partial sum or a fabricated
    zero — the reading is honestly unavailable.
    """
    return bool(
        inputs.n_rows == registry_size
        and inputs.n_provenance == 1
        and inputs.n_statistic == 1
        and inputs.n_uncovered == 0
        and inputs.na_min == inputs.na_max and inputs.na_max is not None and inputs.na_max > 0
        and inputs.n_bad_observed == 0
        and inputs.n_measured == registry_size
        and inputs.v_min is not None
        and isfinite(inputs.v_min) and isfinite(inputs.v_max)
        and inputs.v_min >= 0
        and (not underlying.endswith("_share") or inputs.v_max <= 1)
    )


def _aedar_aggregate_reading(inputs, registry_size, underlying):
    """Assemble one registry-wide aggregate reading's response fields.

    The territorial assembler used by direct reference aggregates, peer-rank
    populations and selected members/focals. Fixed density references consume
    the producer-published summary instead.
    """
    available = _aedar_aggregate_available(inputs, registry_size, underlying)
    return {
        "value": float(inputs.total) if available else None,
        "available": available,
        "n_addresses": inputs.na_max if inputs.na_min == inputs.na_max else None,
        "n_observed": inputs.observed_sum,
        "coverage_status": inputs.coverage if inputs.n_coverage == 1 else None,
        "statistic": inputs.statistic if inputs.n_statistic == 1 else None,
    }


def _aedar_aggregate_records(conn, territory_type, territory_ids, underlying, registry_size):
    """Territorial adapter: per-territory law inputs from `aedar_territorial_aggregate`.

    A territory's reading is the sum over its complete published registry and
    is available only under the full compatibility law above; otherwise it
    stays unknown, never a partial value (ADR-0039's 2026-11-04 amendment,
    #914). All law inputs — including provenance uniformity and observed
    validity — are computed in SQL.
    """
    cursor = conn.execute(_AEDAR_AGGREGATE_RECORDS_SQL,
                          (underlying, underlying, underlying, underlying,
                           territory_type, sorted(set(territory_ids))))
    records = {}
    for row in cursor.fetchall():
        territory_id, *law_inputs = row
        records[territory_id] = _aedar_aggregate_reading(
            _AEDARAggregateLawInputs(*law_inputs), registry_size, underlying)
    return records


_AEDAR_MULTI_TERRITORIAL_AGGREGATES_SQL = f"""SELECT a.territory_id,m.measure,
       count(*) AS n_rows,
       count((a.measures->>m.measure)::double precision) AS n_measured,
       sum((a.measures->>m.measure)::double precision) AS total,
       min((a.measures->>m.measure)::double precision) AS v_min,
       max((a.measures->>m.measure)::double precision) AS v_max,
       min(a.n_addresses) AS na_min,max(a.n_addresses) AS na_max,
       sum(a.n_observed)::bigint AS observed_sum,
       count(DISTINCT (a.source_id,a.vintage_id,a.source_url,a.licence,a.attribution,
                       a.reference_date,a.publication_date)) AS n_provenance,
       count(*) FILTER (WHERE a.coverage_status IS DISTINCT FROM 'covered') AS n_uncovered,
       count(*) FILTER (WHERE a.n_observed IS NULL OR a.n_observed < 0
                           OR a.n_observed > a.n_addresses) AS n_bad_observed,
       {_AEDAR_TERRITORIAL_DIRECT_STATISTIC_TIE} AS n_statistic,
       '{_AEDAR_TERRITORIAL_DIRECT_STATISTIC}' AS statistic,
       min(a.coverage_status) AS coverage,count(DISTINCT a.coverage_status) AS n_coverage
 FROM aedar_territorial_aggregate a CROSS JOIN unnest(%s::text[]) AS m(measure)
 WHERE a.territory_type=%s AND a.territory_id=ANY(%s::text[])
 GROUP BY a.territory_id,m.measure"""


def _aedar_multi_aggregate_records(conn, territory_type, territory_ids, measures, registry_size):
    """Set-wise territorial adapter for compatible readings in one request snapshot."""
    underlying_to_reading = {AEDAR_AGGREGATE_READINGS[measure]: measure for measure in measures}
    cursor = conn.execute(_AEDAR_MULTI_TERRITORIAL_AGGREGATES_SQL,
                          (sorted(underlying_to_reading), territory_type, sorted(set(territory_ids))))
    result = {measure: {} for measure in measures}
    for row in cursor.fetchall():
        territory_id, underlying, *law_inputs = row
        measure = underlying_to_reading[underlying]
        result[measure][territory_id] = _aedar_aggregate_reading(
            _AEDARAggregateLawInputs(*law_inputs), registry_size, underlying)
    return result


def _aedar_focal_provenance(conn, territory_type, territory_id):
    """Shared source provenance of one territory's published aggregate rows."""
    row = conn.execute("""SELECT source_id,vintage_id,source_url,licence,attribution,
        reference_date,publication_date FROM aedar_territorial_aggregate
        WHERE territory_type=%s AND territory_id=%s LIMIT 1""",
        (territory_type, territory_id)).fetchone()
    if not row:
        raise HTTPException(404, "No published focal AEDAR value")
    return row


def _aedar_direct_aggregate(conn, underlying, reference_type, group_id, registry_size):
    """Registry-wide sum of a direct reference territory's published rows.

    A thin consumer of the territorial adapter: the assembled record already
    carries the direct statistic.
    """
    record = _aedar_aggregate_records(conn, reference_type, [group_id], underlying,
                                      registry_size).get(group_id)
    if record is None:
        raise HTTPException(404, "No published result for this fixed context")
    return record


def _aedar_density_class_summary_records(conn, group_id, measures, marker):
    """Read producer-published pooled class summaries from this RR snapshot."""
    requested = tuple(dict.fromkeys(measures))
    if not requested or not set(requested) <= set(AEDAR_AGGREGATE_READINGS):
        raise HTTPException(422, "Unknown AEDAR density summary measure")
    rows = conn.execute("""SELECT measure,value,status,n_typequ,n_addresses,n_observed,coverage_status,
            aedar_content_version,reference_content_version,input_content_version
        FROM aedar_density_class_summary
        WHERE comparison_content_version=%s AND group_id=%s AND measure=ANY(%s::text[])""",
        (marker[0], group_id, sorted(requested))).fetchall()
    if not rows:
        publication_unavailable("aedar", "AEDAR density-class summary is unavailable")
    if len(rows) != len(requested) or len({row[0] for row in rows}) != len(requested):
        raise HTTPException(503, "AEDAR density-class summary is incomplete")
    result = {}
    for (measure, value, status, n_typequ, n_addresses, n_observed, coverage_status,
         aedar_version, reference_version, input_version) in rows:
        if (measure not in requested or status not in ("available", "unavailable") or
                aedar_version != marker[2] or reference_version != marker[3] or input_version != marker[4]):
            raise HTTPException(503, "AEDAR density-class summary is malformed")
        available = status == "available"
        if (available and (value is None or not isfinite(value) or value < 0 or n_typequ != marker[16] or
                n_addresses is None or n_addresses <= 0 or n_observed is None or n_observed < 0 or
                n_observed > marker[16] * n_addresses or coverage_status != "covered")) or (
                not available and (value is not None or n_typequ is not None or
                    (n_addresses is not None and n_addresses < 0) or
                    (n_observed is not None and n_observed < 0))):
            raise HTTPException(503, "AEDAR density-class summary contains an invalid reading")
        result[measure] = {
            "value": value,
            "available": available,
            "n_typequ": n_typequ,
            "n_addresses": n_addresses,
            "n_observed": n_observed,
            "coverage_status": coverage_status,
            "statistic": "pooled",
        }
    return result


def _aedar_fixed_peer_ids(conn, territory_type, territory_id, context):
    """Resolved peer group of a declared fixed context (ADR-0021 scopes).

    The ambient comparison group behind a request-time aggregate rank: the
    communes of the focal EPCI, all Breton communes, the density class, or the
    same-level territories — resolved from the published territory reference
    in the same committed snapshot.
    """
    focal = conn.execute(
        "SELECT epci_id,density_class_code FROM territory_reference WHERE territory_type=%s AND territory_id=%s",
        (territory_type, territory_id)).fetchone()
    if not focal:
        raise HTTPException(404, "Unknown territory type/id")
    if context == "density_class":
        rows = conn.execute(
            "SELECT territory_id FROM territory_reference WHERE territory_type='commune' AND density_class_code=%s",
            (focal[1],)).fetchall()
    elif context == "same_level":
        if territory_type not in ("epci", "departement"):
            raise HTTPException(422, "Same-level reference is unavailable for this territory scope")
        rows = conn.execute("SELECT territory_id FROM territory_reference WHERE territory_type=%s",
                            (territory_type,)).fetchall()
    elif context == "epci":
        if territory_type != "commune":
            raise HTTPException(422, "Commune reference is unavailable for this territory scope")
        if not focal[0]:
            raise HTTPException(503, "Published AEDAR reference identity is unavailable")
        rows = conn.execute(
            "SELECT territory_id FROM territory_reference WHERE territory_type='commune' AND epci_id=%s",
            (focal[0],)).fetchall()
    elif context == "bretagne":
        if territory_type != "commune":
            raise HTTPException(422, "Commune reference is unavailable for this territory scope")
        rows = conn.execute(
            "SELECT territory_id FROM territory_reference WHERE territory_type='commune'").fetchall()
    else:
        raise HTTPException(422, "AEDAR comparison context is not declared")
    ids = sorted({row[0] for row in rows})
    if territory_id not in ids:
        ids = sorted([*ids, territory_id])
    return ids


def _aedar_prepare_fixed_aggregate_batch(conn, territory_type, territory_id, context, batch, marker):
    """Prepare compatible aggregate readings once inside the owning RR snapshot."""
    measures = list(dict.fromkeys(batch["measures"]))
    group_type = None
    group_id = None
    focal = conn.execute("""SELECT t.epci_id,r.territory_id
        FROM territory_reference t CROSS JOIN territory_reference r
        WHERE t.territory_type=%s AND t.territory_id=%s AND r.territory_type='region'""",
        (territory_type,territory_id)).fetchone()
    if not focal:
        raise HTTPException(404, "Unknown territory type/id")
    if context == "density_class":
        from api.snapshot_reads import _comparison_cohort
        _, _, scope = _comparison_cohort(conn, territory_type, territory_id, None)
        if territory_type != "commune" or not scope or scope.get("kind") != "density_class":
            raise HTTPException(422, "Density reference is available for commune scopes only")
        group_type, group_id = "commune", scope["density_class_code"]
        groups = _aedar_density_class_summary_records(conn, group_id, measures, marker)
    elif context == "same_level":
        if territory_type not in ("epci", "departement"):
            raise HTTPException(422, "Same-level reference is unavailable for this territory scope")
        group_type, group_id = "region", focal[1]
    elif context in ("epci", "bretagne"):
        if territory_type != "commune":
            raise HTTPException(422, "Commune reference is unavailable for this territory scope")
        group_type = "epci" if context == "epci" else "region"
        group_id = focal[0] if context == "epci" else focal[1]
        if not group_id:
            raise HTTPException(503, "Published AEDAR reference identity is unavailable")
    else:
        raise HTTPException(422, "AEDAR comparison context is not declared")

    rank_measures = set(batch.get("rank_measures", ()))
    peer_ids = (batch.get("peer_ids") or [territory_id]) if rank_measures else [territory_id]
    territorial_ids = sorted(set(peer_ids) | {territory_id})
    summary_measures = sorted(set(measures) | set(rank_measures))
    summary = _aedar_territory_summary_snapshot(conn, territory_type, territorial_ids, summary_measures)
    territorial = _aedar_summary_records(summary, summary_measures, territorial_ids)
    if context != "density_class":
        group_snapshot = _aedar_territory_summary_snapshot(conn, group_type, [group_id], measures)
        if group_snapshot["content_version"] != summary["content_version"]:
            raise HTTPException(503, "AEDAR territory summary publication changed within the read snapshot")
        group_records = _aedar_summary_records(group_snapshot, measures, [group_id])
        groups = {measure: records.get(group_id) for measure, records in group_records.items()}
    provenance = _aedar_summary_provenance(summary)
    return {"group_id": group_id, "group_type": group_type,
            "groups": groups, "territorial": territorial, "provenance": provenance,
            "rank_measures": rank_measures,
            "summary_content_version": summary["content_version"]}


def _aedar_comparison_snapshot(conn, territory_type, territory_id, context,
                               typequ, measure, fields=None, measure_facets=None, *,
                               preflight_only=False, snapshot_state=None):
    """Build one fixed AEDAR result inside a caller-owned snapshot."""
    aggregate = measure in AEDAR_AGGREGATE_READINGS
    if not aggregate and measure not in AEDAR_MEASURE_KEYS:
        raise HTTPException(422, "Unknown AEDAR measure")
    if aggregate and typequ:
        raise HTTPException(422, "Aggregate readings are registry-wide and take no typequ coordinate")
    if not aggregate and not typequ:
        raise HTTPException(422, "AEDAR per-cell comparison requires one TYPEQU coordinate")
    selected_fields = _aedar_comparison_field_selection(fields)
    optional_fields = _aedar_comparison_optional_fields(aggregate)
    selected = set(optional_fields) if selected_fields is None else set(selected_fields)
    # The rank fields are opt-in per shape: the aggregate default projection
    # carries them (#914), the per-cell one never does.
    wants_rank = bool(_AEDAR_AGGREGATE_RANK_FIELDS & selected)
    facet = (measure_facets or {}).get(measure)
    # The facet declaration is mandatory whenever this request consults it:
    # every aggregate reading (which also requires a ranked facet), and a
    # per-cell reading only when it asks for a rank. An unranked per-cell facet
    # is not an error - it serves null ranks.
    if (aggregate or wants_rank) and (facet is None or (aggregate and not facet.get("ranked"))):
        raise HTTPException(503, "AEDAR comparison facet declaration is incomplete for the requested measures")
    marker = _aedar_comparison_marker(conn)
    territory = conn.execute("SELECT 1 FROM territory_reference WHERE territory_type=%s AND territory_id=%s",
                             (territory_type, territory_id)).fetchone()
    if not territory:
        raise HTTPException(404, "Unknown territory type/id")
    if preflight_only:
        return {"content_version": marker[0], "reference_content_version": marker[3]}
    if aggregate:
        return _aedar_fixed_aggregate_snapshot(conn, territory_type, territory_id, context,
                                               measure, facet, selected, marker, snapshot_state=snapshot_state)
    focal = conn.execute("""SELECT t.epci_id,r.territory_id
        FROM territory_reference t CROSS JOIN territory_reference r
        WHERE t.territory_type=%s AND t.territory_id=%s AND r.territory_type='region'""",
        (territory_type,territory_id)).fetchone()
    if not focal:
        raise HTTPException(404, "Unknown territory type/id")
    if context == "density_class":
        from api.snapshot_reads import _comparison_cohort
        _, _, scope = _comparison_cohort(conn, territory_type, territory_id, None)
        if territory_type != "commune" or not scope or scope.get("kind") != "density_class":
            raise HTTPException(422, "Density reference is available for commune scopes only")
        group_id, reference_type = scope["density_class_code"], "commune"
        group_row = conn.execute("""SELECT value,n_addresses,n_observed,coverage_status,statistic
            FROM aedar_comparison_group WHERE comparison_context='density_class' AND group_id=%s
              AND territory_type='commune' AND typequ=%s AND measure=%s""",
            (group_id,typequ,measure)).fetchone()
    elif context == "same_level":
        # The published EPCI/departement same-level median summaries are retired
        # (#768/#859): the reference is the Region's own direct published AEDAR
        # aggregate ("Moyenne de Bretagne"), as commune Bretagne references already do.
        if territory_type not in ("epci","departement"):
            raise HTTPException(422, "Same-level reference is unavailable for this territory scope")
        reference_type, group_id = "region", focal[1]
        group_row = _aedar_direct_reference(conn, measure, reference_type, group_id, typequ)
    elif context in ("epci", "bretagne"):
        if territory_type != "commune":
            raise HTTPException(422, "Commune reference is unavailable for this territory scope")
        reference_type = "epci" if context == "epci" else "region"
        group_id = focal[0] if context == "epci" else focal[1]
        if not group_id:
            raise HTTPException(503, "Published AEDAR reference identity is unavailable")
        group_row = _aedar_direct_reference(conn, measure, reference_type, group_id, typequ)
    else:
        raise HTTPException(422, "AEDAR comparison context is not declared")
    if not group_row:
        raise HTTPException(404, "No published result for this fixed context")
    focal_row = conn.execute("""SELECT a.typequ_label,a.source_id,a.vintage_id,a.source_url,a.licence,
        a.attribution,a.reference_date,a.publication_date,(a.measures->>%s)::double precision AS value,a.n_addresses,
        a.n_observed,a.coverage_status FROM aedar_territorial_aggregate a
        WHERE a.territory_type=%s AND a.territory_id=%s AND a.typequ=%s""",
        (measure,territory_type,territory_id,typequ)).fetchone()
    if not focal_row:
        raise HTTPException(404, "No published focal AEDAR value")
    result = {
        "comparison_context": context,
        "group_id": group_id,
        "territory_type": reference_type,
        "typequ": typequ,
        "typequ_label": focal_row[0],
        "source_id": focal_row[1],
        "vintage_id": focal_row[2],
        "source_url": focal_row[3],
        "licence": focal_row[4],
        "attribution": focal_row[5],
        "reference_date": focal_row[6],
        "publication_date": focal_row[7],
        "measure": measure,
        "statistic": group_row[4],
        "group_value": group_row[0],
        "group_n_addresses": group_row[1],
        "group_n_observed": group_row[2],
        "group_coverage_status": group_row[3],
        "value": focal_row[8],
        "status": "measured" if focal_row[8] is not None else "not_available",
        "n_addresses": focal_row[9],
        "n_observed": focal_row[10],
        "coverage_status": focal_row[11],
    }
    if wants_rank:
        rank, rank_size, rank_ties = _aedar_fixed_cell_rank(
            conn, territory_type, territory_id, typequ, measure, context, facet,
            snapshot_state=snapshot_state)
        result.update({"rank": rank, "rank_size": rank_size, "rank_ties": rank_ties})
        for key in _AEDAR_AGGREGATE_RANK_FIELDS - selected:
            result.pop(key, None)
    for key in optional_fields-selected:
        result.pop(key,None)
    return {"territory":{"territory_type":territory_type,"territory_id":territory_id},
      "content_version":marker[0],"source_snapshot_id":marker[1],
      "aedar_content_version":marker[2],"reference_content_version":marker[3],
      "input_content_version":marker[4],"input_identity":marker[5],"comparison":result}


def _aedar_fixed_aggregate_snapshot(conn, territory_type, territory_id, context,
                                    measure, facet, selected, marker, *, snapshot_state=None):
    """One fixed-context registry-wide aggregate reading with its request-time rank.

    The group statistic keeps the declared context semantics unchanged (the
    direct EPCI/Bretagne/Région aggregate, or the producer-published pooled
    density summary); the focal's direction-aware rank, group size
    and tie count are computed per request over the context's resolved peer
    group from the published territory summaries in the same committed snapshot — no
    peer/rank rows are published (#810 stance intact; ADR-0039's 2026-11-04
    amendment, #914). Both the reference and the peer/focal readings flow
    through producer-owned summary projections. Density references read final
    pooled summaries from the atomic comparison publication; requests never
    aggregate the typed density artifact.
    """
    underlying = AEDAR_AGGREGATE_READINGS[measure]
    key = (territory_type, territory_id, context)
    batch = (snapshot_state or {}).get("aedar_fixed_aggregates", {}).get(key)
    prepared = None
    if batch and len(batch["measures"]) > 1:
        prepared = batch.get("prepared")
        if prepared is None:
            prepared = _aedar_prepare_fixed_aggregate_batch(conn, territory_type, territory_id, context, batch, marker)
            batch["prepared"] = prepared
    wants_rank = bool(_AEDAR_AGGREGATE_RANK_FIELDS & selected)
    if prepared:
        group_id, reference_type = prepared["group_id"], prepared["group_type"]
        group = prepared["groups"].get(measure)
        peer_records = prepared["territorial"].get(measure, {})
        focal_record = peer_records.get(territory_id)
        provenance = prepared["provenance"]
        summary_content_version = prepared["summary_content_version"]
        if group is None:
            raise HTTPException(404, "No published result for this fixed context")
    else:
        summary_content_version = None
        focal = conn.execute("""SELECT t.epci_id,r.territory_id
            FROM territory_reference t CROSS JOIN territory_reference r
            WHERE t.territory_type=%s AND t.territory_id=%s AND r.territory_type='region'""",
            (territory_type,territory_id)).fetchone()
        if not focal:
            raise HTTPException(404, "Unknown territory type/id")
        if context == "density_class":
            from api.snapshot_reads import _comparison_cohort
            _, _, scope = _comparison_cohort(conn, territory_type, territory_id, None)
            if territory_type != "commune" or not scope or scope.get("kind") != "density_class":
                raise HTTPException(422, "Density reference is available for commune scopes only")
            group_id, reference_type = scope["density_class_code"], "commune"
            group = _aedar_density_class_summary_records(conn, group_id, [measure], marker).get(measure)
        elif context == "same_level":
            if territory_type not in ("epci","departement"):
                raise HTTPException(422, "Same-level reference is unavailable for this territory scope")
            reference_type, group_id = "region", focal[1]
            group_snapshot = _aedar_territory_summary_snapshot(conn, reference_type, [group_id], [measure])
            summary_content_version = group_snapshot["content_version"]
            group = group_snapshot["readings"][(group_id, measure)]
        elif context in ("epci", "bretagne"):
            if territory_type != "commune":
                raise HTTPException(422, "Commune reference is unavailable for this territory scope")
            reference_type = "epci" if context == "epci" else "region"
            group_id = focal[0] if context == "epci" else focal[1]
            if not group_id:
                raise HTTPException(503, "Published AEDAR reference identity is unavailable")
            group_snapshot = _aedar_territory_summary_snapshot(conn, reference_type, [group_id], [measure])
            summary_content_version = group_snapshot["content_version"]
            group = group_snapshot["readings"][(group_id, measure)]
        else:
            raise HTTPException(422, "AEDAR comparison context is not declared")
        peer_ids = (_aedar_fixed_peer_ids(conn, territory_type, territory_id, context)
                    if wants_rank else [territory_id])
        summary = _aedar_territory_summary_snapshot(conn, territory_type, peer_ids, [measure])
        if summary_content_version is not None and summary_content_version != summary["content_version"]:
            raise HTTPException(503, "AEDAR territory summary publication changed within the read snapshot")
        summary_content_version = summary["content_version"]
        peer_records = {territory_id: summary["readings"][(territory_id, measure)]
                        for territory_id in peer_ids}
        focal_record = peer_records.get(territory_id)
        provenance = _aedar_summary_provenance(summary)
    if focal_record is None:
        raise HTTPException(404, "No published focal AEDAR value")
    direction = facet["direction"]
    focal_value = focal_record["value"]
    rank = rank_size = rank_ties = None
    if wants_rank and focal_value is not None:
        # Peers whose rows do not satisfy the compatibility law are honestly
        # unavailable: they are ineligible for the rank (never zeroed or
        # ranked), and rank_size reflects the eligible population; ties share
        # the focal's rank.
        comparable = {peer_id: record["value"] for peer_id, record in peer_records.items()
                      if record["available"]}
        rank, rank_size, rank_ties = _aedar_peer_rank(comparable, territory_id, direction)
    result = {
        "comparison_context": context,
        "group_id": group_id,
        "territory_type": reference_type,
        "typequ": None,
        "typequ_label": None,
        "source_id": provenance[0],
        "vintage_id": provenance[1],
        "source_url": provenance[2],
        "licence": provenance[3],
        "attribution": provenance[4],
        "reference_date": provenance[5],
        "publication_date": provenance[6],
        "measure": measure,
        "statistic": group["statistic"],
        "group_value": group["value"],
        "group_n_addresses": group["n_addresses"],
        "group_n_observed": group["n_observed"],
        "group_coverage_status": group["coverage_status"],
        "value": focal_value,
        "status": "measured" if focal_value is not None else "not_available",
        "n_addresses": focal_record["n_addresses"],
        "n_observed": focal_record["n_observed"],
        "coverage_status": focal_record["coverage_status"],
        "rank": rank,
        "rank_size": rank_size,
        "rank_ties": rank_ties,
    }
    for key in _aedar_comparison_optional_fields(True)-selected:
        result.pop(key,None)
    return {"territory":{"territory_type":territory_type,"territory_id":territory_id},
      "content_version":marker[0],"source_snapshot_id":marker[1],
      "aedar_content_version":marker[2],"reference_content_version":marker[3],
      "input_content_version":marker[4],"input_identity":marker[5],
      "summary_content_version":summary_content_version,"comparison":result}


_AEDAR_SELECTED_OPTIONAL_FIELDS = {"group_value", "value", "rank", "rank_size", "rank_ties"}
_AEDAR_SELECTED_MANDATORY_FIELDS = {
    "comparison_context", "group_id", "territory_type", "typequ", "typequ_label",
    "source_id", "vintage_id", "source_url", "licence", "attribution", "reference_date",
    "publication_date", "measure", "statistic", "direction", "comparison_facet",
    "group_n_addresses", "group_n_observed", "group_coverage_status",
    "n_addresses", "n_observed", "coverage_status", "status",
}


def _aedar_selected_field_selection(fields):
    return normalize_field_selection(
        fields, _AEDAR_SELECTED_OPTIONAL_FIELDS | _AEDAR_SELECTED_MANDATORY_FIELDS)


def _aedar_selected_members(conn, territory_type, members):
    """Resolve same-level typed members; fail closed naming any failed member."""
    members = tuple(members)
    if not members:
        raise HTTPException(422, "AEDAR selected comparison requires at least one member")
    if len({(level, code) for level, code in members}) != len(members):
        raise HTTPException(422, "selected comparison members must be unique")
    by_id = {row[0]: row[1] for row in conn.execute(
        "SELECT territory_id,territory_type FROM territory_reference WHERE territory_id=ANY(%s::text[])",
        ([code for _, code in members],)).fetchall()}
    resolved = []
    for level, code in members:
        if code not in by_id:
            raise HTTPException(404, f"Unknown selected comparison member {level}/{code}")
        if by_id[code] != level:
            raise HTTPException(422, f"Selected comparison member type does not match {level}/{code}")
        if level != territory_type:
            raise HTTPException(422, f"Selected comparison member {level}/{code} is not same-level as the focal territory")
        resolved.append((level, code))
    return tuple(resolved)


def _aedar_selected_comparison_snapshot(conn, territory_type, territory_id, members,
                                          typequ, measures, fields=None, measure_facets=None,
                                          *, preflight_only=False, snapshot_state=None):
    """Build one request-time AEDAR selected comparison in a caller-owned snapshot.

    The group statistic is the address-weighted mean of the members' published
    aggregate values (weights = published n_addresses) - exactly the pooled
    address aggregate of the selection - computed per request from one
    committed snapshot, for scalar readings and per-cell curve readings alike.
    The focal receives a direction-aware rank and the group size only when it
    is itself a member; no peer/rank rows are published (#810 stance intact).
    The registry-wide aggregate readings (#914) reuse the same pooled semantics
    over each member's sum over the complete TYPEQU registry.
    """
    if not measures:
        raise HTTPException(422, "AEDAR selected comparison requires measure coordinates")
    if not set(measures) <= AEDAR_MEASURE_KEYS | set(AEDAR_AGGREGATE_READINGS):
        raise HTTPException(422, "Coordinate measure is not declared for AEDAR")
    aggregate = set(measures) <= set(AEDAR_AGGREGATE_READINGS)
    if aggregate and typequ:
        raise HTTPException(422, "Aggregate readings are registry-wide and take no typequ coordinate")
    if not aggregate:
        if not typequ:
            raise HTTPException(422, "AEDAR selected comparison requires typequ and measure coordinates")
        if not set(measures) <= AEDAR_MEASURE_KEYS:
            raise HTTPException(422, "Coordinate measure mixes aggregate readings with per-cell measures")
    facets = measure_facets or {}
    if any(measure not in facets for measure in measures):
        raise HTTPException(503, "AEDAR comparison facet declaration is incomplete for the requested measures")
    selected_fields = _aedar_selected_field_selection(fields)
    selected = set(_AEDAR_SELECTED_OPTIONAL_FIELDS) if selected_fields is None else set(selected_fields)
    marker = _aedar_comparison_marker(conn)
    if not conn.execute("SELECT 1 FROM territory_reference WHERE territory_type=%s AND territory_id=%s",
                        (territory_type,territory_id)).fetchone():
        raise HTTPException(404, "Unknown territory type/id")
    resolved = _aedar_selected_members(conn, territory_type, members)
    aggregate_batch = None
    if aggregate and snapshot_state is not None:
        batch_key = (territory_type, territory_id,
                     tuple(sorted(code for _, code in resolved)))
        aggregate_batch = snapshot_state.setdefault("aedar_selected_aggregates", {}).setdefault(
            batch_key, {"measures": [], "summary": None})
        for measure in measures:
            if measure not in aggregate_batch["measures"]:
                aggregate_batch["measures"].append(measure)
    if preflight_only:
        return {"content_version": marker[0], "reference_content_version": marker[3]}
    if aggregate:
        return _aedar_selected_aggregate_snapshot(conn, territory_type, territory_id, resolved,
                                                  sorted(measures), selected, marker, facets,
                                                  snapshot_state=snapshot_state)
    typequ_list = sorted(typequ)
    measure_list = sorted(measures)
    member_ids = [code for _, code in resolved]
    member_rows = {}
    cursor = conn.execute("""SELECT territory_id,typequ,n_addresses,n_observed,coverage_status,
              COALESCE((SELECT jsonb_object_agg(k, v) FROM jsonb_each(aedar_territorial_aggregate.measures) AS m(k,v)
                        WHERE k = ANY(%s::text[])), '{}'::jsonb) AS measures
              FROM aedar_territorial_aggregate
              WHERE territory_type=%s AND territory_id=ANY(%s::text[]) AND typequ=ANY(%s::text[])""",
        (measure_list, territory_type, member_ids, typequ_list))
    names = [d.name for d in cursor.description]
    for row in cursor.fetchall():
        record = dict(zip(names, row))
        member_rows[(record["territory_id"], record["typequ"])] = record
    focal_rows = {}
    cursor = conn.execute("""SELECT a.typequ,a.typequ_label,a.source_id,a.vintage_id,a.source_url,a.licence,
              a.attribution,a.reference_date,a.publication_date,a.n_addresses,a.n_observed,a.coverage_status,
              COALESCE((SELECT jsonb_object_agg(k, v) FROM jsonb_each(a.measures) AS m(k,v)
                        WHERE k = ANY(%s::text[])), '{}'::jsonb) AS measures
              FROM aedar_territorial_aggregate a
              WHERE a.territory_type=%s AND a.territory_id=%s AND a.typequ=ANY(%s::text[])""",
        (measure_list, territory_type, territory_id, typequ_list))
    names = [d.name for d in cursor.description]
    for row in cursor.fetchall():
        record = dict(zip(names, row))
        focal_rows[record["typequ"]] = record
    entries = []
    for typequ_value in typequ_list:
        focal_row = focal_rows.get(typequ_value)
        if not focal_row:
            raise HTTPException(404, "No published focal AEDAR value")
        member_records = []
        for level, code in resolved:
            record = member_rows.get((code, typequ_value))
            if record is None:
                raise HTTPException(422, f"Selected comparison member {level}/{code} has no published AEDAR aggregate for typequ {typequ_value}")
            member_records.append((level, code, record))
        # Honest derived coverage: the members' common published status when
        # they all agree (all covered -> covered); a disagreement has no single
        # derivable coverage and stays unknown (null), never upgraded.
        statuses = {record["coverage_status"] for _, _, record in member_records}
        group_coverage = next(iter(statuses)) if len(statuses) == 1 else None
        for measure in measure_list:
            facet = facets[measure]
            values = []
            for level, code, record in member_records:
                value = (record["measures"] or {}).get(measure)
                weight = record["n_addresses"]
                if value is None or weight is None or weight <= 0:
                    raise HTTPException(422, f"Selected comparison member {level}/{code} has no published value for measure {measure} at typequ {typequ_value}")
                values.append((code, float(value), int(weight), int(record["n_observed"] or 0)))
            total_weight = sum(weight for _, _, weight, _ in values)
            group_value = fsum(value * weight for _, value, weight, _ in values) / total_weight
            total_observed = sum(observed for _, _, _, observed in values)
            rank = rank_size = rank_ties = None
            if facet["ranked"] and territory_id in member_ids:
                focal_value = next(value for code, value, _, _ in values if code == territory_id)
                direction = facet["direction"]
                better = sum(1 for _, value, _, _ in values
                             if (value > focal_value if direction == "high" else value < focal_value))
                rank = better + 1
                rank_ties = sum(1 for _, value, _, _ in values if value == focal_value)
                rank_size = len(values)
            focal_measures = focal_row["measures"] or {}
            focal_value = focal_measures.get(measure)
            entry = {
                "comparison_context": "selected_comparison",
                "group_id": None,
                "territory_type": territory_type,
                "typequ": typequ_value,
                "typequ_label": focal_row["typequ_label"],
                "source_id": focal_row["source_id"],
                "vintage_id": focal_row["vintage_id"],
                "source_url": focal_row["source_url"],
                "licence": focal_row["licence"],
                "attribution": focal_row["attribution"],
                "reference_date": focal_row["reference_date"],
                "publication_date": focal_row["publication_date"],
                "measure": measure,
                "statistic": "pooled",
                "direction": facet["direction"],
                "comparison_facet": facet["facet"],
                "group_value": group_value,
                "group_n_addresses": total_weight,
                "group_n_observed": total_observed,
                "group_coverage_status": group_coverage,
                "value": focal_value,
                "status": "measured" if focal_value is not None else "not_available",
                "n_addresses": focal_row["n_addresses"],
                "n_observed": focal_row["n_observed"],
                "coverage_status": focal_row["coverage_status"],
                "rank": rank,
                "rank_size": rank_size,
                "rank_ties": rank_ties,
            }
            for key in _AEDAR_SELECTED_OPTIONAL_FIELDS - selected:
                entry.pop(key, None)
            entries.append(entry)
    return {"territory":{"territory_type":territory_type,"territory_id":territory_id},
      "content_version":marker[0],"source_snapshot_id":marker[1],
      "aedar_content_version":marker[2],"reference_content_version":marker[3],
      "input_content_version":marker[4],"input_identity":marker[5],
      "selection":[{"territory_type":level,"territory_id":code} for level, code in resolved],
      "scope":{"kind":"explicit_selection","member_count":len(resolved),"territory_type":territory_type},
      "comparisons":entries}


def _aedar_selected_aggregate_snapshot(conn, territory_type, territory_id, resolved,
                                       measure_list, selected, marker, facets, *,
                                       snapshot_state=None):
    """Request-time registry-wide aggregate readings over an explicit selection.

    Each member's reading is the sum of its per-type measure over the complete
    published TYPEQU registry; the group statistic keeps #859's address-weighted
    pooled semantics (weights = published n_addresses) over those readings -
    exactly the pooled address aggregate of the selection's overview scalars -
    and the focal receives a direction-aware rank within the selection when it
    is itself a member. Computed per request from one committed snapshot; no
    peer/rank rows are published (ADR-0039's 2026-11-04 amendment, #914).
    Availability is producer-owned in the summary rows; unavailable members
    remain ineligible for rank and excluded from the pooled statistic - never
    converted to zero or ranked.
    """
    member_ids = [code for _, code in resolved]
    territory_ids = sorted(set(member_ids) | {territory_id})
    batch_key = (territory_type, territory_id, tuple(sorted(member_ids)))
    batch = (snapshot_state or {}).get("aedar_selected_aggregates", {}).get(batch_key)
    summary_measures = list(dict.fromkeys(batch["measures"])) if batch else list(measure_list)
    summary = batch.get("summary") if batch else None
    if summary is None:
        summary = _aedar_territory_summary_snapshot(
            conn, territory_type, territory_ids, summary_measures)
        if batch is not None:
            batch["summary"] = summary
    records_by_measure = _aedar_summary_records(summary, summary_measures, territory_ids)
    provenance = _aedar_summary_provenance(summary)
    wants_rank = bool(_AEDAR_AGGREGATE_RANK_FIELDS & selected)
    entries = []
    for measure in measure_list:
        facet = facets[measure]
        records = records_by_measure[measure]
        # A member whose rows do not satisfy the compatibility law contributes
        # no comparable value: its reading is honestly unavailable and the
        # member is ineligible — never converted to zero, never ranked, and
        # excluded from the pooled statistic (family contract semantics).
        values = []
        for level, code in resolved:
            record = records.get(code)
            if record is None or not record["available"]:
                continue
            values.append((code, record["value"], int(record["n_addresses"]), int(record["n_observed"] or 0)))
        statuses = {records[code]["coverage_status"] for _, code in resolved
                    if records.get(code) is not None and records[code]["available"]}
        group_coverage = next(iter(statuses)) if len(statuses) == 1 else None
        total_weight = sum(weight for _, _, weight, _ in values)
        group_value = (fsum(value * weight for _, value, weight, _ in values) / total_weight
                       if total_weight > 0 else None)
        total_observed = sum(observed for _, _, _, observed in values)
        focal_record = records.get(territory_id)
        if focal_record is None:
            raise HTTPException(404, "No published focal AEDAR value")
        focal_value = focal_record["value"]
        rank = rank_size = rank_ties = None
        if (wants_rank and facet["ranked"] and territory_id in member_ids
                and focal_value is not None):
            better = sum(1 for _, value, _, _ in values
                         if (value > focal_value if facet["direction"] == "high" else value < focal_value))
            rank = better + 1
            rank_ties = sum(1 for _, value, _, _ in values if value == focal_value)
            rank_size = len(values)
        entry = {
            "comparison_context": "selected_comparison",
            "group_id": None,
            "territory_type": territory_type,
            "typequ": None,
            "typequ_label": None,
            "source_id": provenance[0],
            "vintage_id": provenance[1],
            "source_url": provenance[2],
            "licence": provenance[3],
            "attribution": provenance[4],
            "reference_date": provenance[5],
            "publication_date": provenance[6],
            "measure": measure,
            "statistic": "pooled",
            "direction": facet["direction"],
            "comparison_facet": facet["facet"],
            "group_value": group_value,
            "group_n_addresses": total_weight,
            "group_n_observed": total_observed,
            "group_coverage_status": group_coverage,
            "value": focal_value,
            "status": "measured" if focal_value is not None else "not_available",
            "n_addresses": focal_record["n_addresses"],
            "n_observed": focal_record["n_observed"],
            "coverage_status": focal_record["coverage_status"],
            "rank": rank,
            "rank_size": rank_size,
            "rank_ties": rank_ties,
        }
        for key in _AEDAR_SELECTED_OPTIONAL_FIELDS - selected:
            entry.pop(key, None)
        entries.append(entry)
    return {"territory":{"territory_type":territory_type,"territory_id":territory_id},
      "content_version":marker[0],"source_snapshot_id":marker[1],
      "aedar_content_version":marker[2],"reference_content_version":marker[3],
      "input_content_version":marker[4],"input_identity":marker[5],
      "summary_content_version":summary["content_version"],
      "selection":[{"territory_type":level,"territory_id":code} for level, code in resolved],
      "scope":{"kind":"explicit_selection","member_count":len(resolved),"territory_type":territory_type},
      "comparisons":entries}

