"""Bounded reads of published sparse period/detail collections."""
from fastapi import HTTPException
from statistics import median
from math import isfinite
from api.field_selection import normalize_field_selection


def collection_descriptors(conn, *, indicator_id=None, theme_id=None):
    if not conn.execute("SELECT to_regclass('observed_collection_descriptor')").fetchone()[0]:
        return []
    cursor = conn.execute("""SELECT indicator_id,theme_id,kind,label,unit,descriptor_version,
        allowed_levels,comparison_detail,comparison_period,direction
        FROM observed_collection_descriptor WHERE (%s::text IS NULL OR indicator_id=%s)
          AND (%s::text IS NULL OR theme_id=%s) ORDER BY indicator_id""",
        (indicator_id,indicator_id,theme_id,theme_id))
    names = [column.name for column in cursor.description]
    return [dict(zip(names,row)) for row in cursor.fetchall()]


def collection_marker(conn, descriptor):
    indicator = descriptor["indicator_id"]
    marker = conn.execute("""SELECT p.content_version,p.reference_content_version,t.content_version
        FROM observed_collection_publication p LEFT JOIN table_publication t
          ON t.table_name='territory_reference' WHERE p.indicator_id=%s""", (indicator,)).fetchone()
    if not marker or not marker[0] or marker[1] != marker[2]:
        raise HTTPException(503,"Observed collection publication is missing or incompatible")
    if descriptor["kind"] not in ("period_detail","anchored_membership"):
        raise HTTPException(503,"Unknown observed collection contract")
    # Full parity is enforced by the deferred publication constraint at commit.
    # Acquisition checks compatible tokens, then reads only its needed facts.
    return {"content_version":marker[0],"reference_content_version":marker[1]}


def collection_snapshot(conn, descriptor, territory_type, territory_id, *, fields=None,
                        preflight_only=False):
    if territory_type not in descriptor["allowed_levels"]:
        raise HTTPException(422,"Collection is not declared for this territory level")
    focal = conn.execute("SELECT name,territory_type FROM territory_reference WHERE territory_id=%s", (territory_id,)).fetchone()
    if not focal:
        raise HTTPException(404,"Territory not found")
    if focal[1] != territory_type:
        raise HTTPException(422,"Territory does not match its declared level")
    marker = collection_marker(conn,descriptor)
    if descriptor["kind"] == "anchored_membership":
        membership_fields = normalize_field_selection(fields,
            {"detail", "label", "rider", "anchor_count", "availability"})
        if preflight_only:
            return {**marker, "supported_fields": {
                "detail", "label", "rider", "anchor_count", "availability"}}
        return membership_snapshot(conn,descriptor,territory_type,territory_id,focal[0],marker,
                                   fields=membership_fields)
    selection = normalize_field_selection(fields, {"value", "status"})
    if preflight_only:
        return {**marker, "supported_fields": {"value", "status"}}
    project_value = selection is None or "value" in selection
    rows = conn.execute("""SELECT o.detail_key,c.label,o.observation_period,
        CASE WHEN %s THEN o.value ELSE NULL::double precision END AS value,o.source_id,
        sd.name,o.vintage_id,v.version,v.reference_date,v.publication_date
        FROM period_detail_observation o JOIN observed_collection_category c USING(indicator_id,detail_key)
        JOIN source_dataset sd ON sd.source_id=o.source_id
        JOIN source_vintage v ON v.source_id=o.source_id AND v.vintage_id=o.vintage_id
        WHERE o.indicator_id=%s AND o.territory_id=%s AND o.territory_type=%s
        ORDER BY o.observation_period,c.ordinal""", (project_value,descriptor["indicator_id"],territory_id,territory_type)).fetchall()
    entries = [{"detail":key,"label":label,"observation_period":period,
        **({"value":value} if project_value else {}),"status":"measured",
        "sources":[{"source_id":source_id,"name":source_name,"vintage_id":vintage_id,"version":version,
                     "reference_date":reference_date,"publication_date":publication_date}]}
        for key,label,period,value,source_id,source_name,vintage_id,version,reference_date,publication_date in rows]
    return {**descriptor,**marker,"territory":{"id":territory_id,"type":territory_type,"name":focal[0]},
            "completeness":"observed_sparse","availability":"observed" if entries else "no_record","entries":entries}


def collection_comparison(conn, descriptor, territory_type, territory_id, cohort_type, members,
                          fixed_context=None, fields=None):
    allowed = ({"status", "reason", "selected_member_count"} if descriptor["kind"] == "anchored_membership"
               else {"status", "reason", "selected_member_count", "eligible_count", "missing_count",
                     "median", "rank", "rank_size"})
    selected = normalize_field_selection(fields, allowed)
    selected = set(allowed) if selected is None else set(selected)
    marker = collection_marker(conn,descriptor)
    if descriptor["kind"] == "anchored_membership":
        return {"indicator_id":descriptor["indicator_id"],"theme_id":descriptor["theme_id"],
                "status":"unavailable","reason":"categorical_membership_not_comparable",
                **({"selected_member_count":len(members)} if "selected_member_count" in selected else {}),**marker}
    valid = territory_type in descriptor["allowed_levels"] and cohort_type in descriptor["allowed_levels"]
    if fixed_context is not None and valid:
        return _published_collection_comparison(conn, descriptor, territory_type, territory_id,
                                                members, fixed_context, marker, selected)
    rows = conn.execute("""SELECT o.territory_id,o.value,o.source_id,sd.name,o.vintage_id,v.version,
        v.reference_date,v.publication_date FROM period_detail_observation o
        JOIN source_dataset sd ON sd.source_id=o.source_id
        JOIN source_vintage v ON v.source_id=o.source_id AND v.vintage_id=o.vintage_id
        WHERE o.indicator_id=%s AND o.detail_key=%s AND o.observation_period=%s
          AND o.territory_id=ANY(%s)""", (descriptor["indicator_id"],descriptor["comparison_detail"],
            descriptor["comparison_period"],list(dict.fromkeys([*members,territory_id])))).fetchall() if valid else []
    peers = [row for row in rows if row[0] in members]
    values = [row[1] for row in peers]
    enough = len(values)>=2
    focal = next((row[1] for row in rows if row[0]==territory_id),None)
    rank = (1+sum(value>focal if descriptor["direction"]=="high" else value<focal for value in values)
            if enough and focal is not None and territory_id in members else None)
    sources = {(row[2],row[4]):{"source_id":row[2],"name":row[3],"vintage_id":row[4],"version":row[5],
                              "reference_date":row[6],"publication_date":row[7]} for row in peers}
    return {"indicator_id":descriptor["indicator_id"],"theme_id":descriptor["theme_id"],
        "label":descriptor["label"],"unit":descriptor["unit"],"descriptor_version":descriptor["descriptor_version"],
        "source_facet":{"detail":descriptor["comparison_detail"],"observation_period":descriptor["comparison_period"]},
        "direction":descriptor["direction"],"statistic":"median","status":"available" if enough else "unavailable",
        "reason":None if enough else "fewer_than_two_comparable_values" if valid else "unsupported_comparison_contract",
        **({"selected_member_count":len(members)} if "selected_member_count" in selected else {}),
        **({"eligible_count":len(values)} if "eligible_count" in selected else {}),
        **({"missing_count":len(members)-len(values)} if "missing_count" in selected else {}),
        **({"median":median(values) if enough else None} if "median" in selected else {}),
        **({"rank":rank} if "rank" in selected else {}),
        **({"rank_size":len(values) if rank is not None else None} if "rank_size" in selected else {}),
        "comparison_sources":list(sources.values()),**marker}


def collection_comparison_preflight(conn, descriptor, fields, fixed_context, marker):
    """Resolve collection comparison dependencies without reading published results."""
    allowed = ({"status", "reason", "selected_member_count"}
        if descriptor["kind"] == "anchored_membership" else
        {"status", "reason", "selected_member_count", "eligible_count", "missing_count",
         "median", "rank", "rank_size"})
    normalize_field_selection(fields, allowed)
    if descriptor["kind"] == "anchored_membership" or fixed_context is None:
        return marker
    storage = conn.execute("""SELECT to_regclass('observed_collection_comparison_lineage'),
        EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema()
          AND table_name='observed_collection_comparison_publication' AND column_name='lineage_complete')""").fetchone()
    if not storage or not storage[0] or not storage[1]:
        raise HTTPException(503,"Observed collection comparison lineage storage is unavailable")
    publication = conn.execute("""SELECT content_version,collection_content_version,
        reference_content_version,lineage_complete FROM observed_collection_comparison_publication
        WHERE indicator_id=%s""", (descriptor["indicator_id"],)).fetchone()
    if (not publication or not publication[0] or publication[1] != marker["content_version"]
            or publication[2] != marker["reference_content_version"] or publication[3] is not True):
        raise HTTPException(503,"Observed collection comparison publication is missing or incompatible")
    return marker


def _published_collection_comparison(conn, descriptor, territory_type, territory_id, members,
                                     fixed_context, marker, selected):
    context, group_id, group_type = fixed_context
    indicator = descriptor["indicator_id"]
    facet = (descriptor["comparison_detail"], str(descriptor["comparison_period"]))
    storage = conn.execute("""SELECT to_regclass('observed_collection_comparison_lineage'),
        EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema()
          AND table_name='observed_collection_comparison_publication' AND column_name='lineage_complete')""").fetchone()
    if not storage or not storage[0] or not storage[1]:
        raise HTTPException(503,"Observed collection comparison lineage storage is unavailable")
    publication = conn.execute("""SELECT content_version,collection_content_version,
        reference_content_version,group_row_count,territory_row_count,lineage_row_count,lineage_complete
        FROM observed_collection_comparison_publication WHERE indicator_id=%s""", (indicator,)).fetchone()
    if (not publication or not publication[0] or publication[1] != marker["content_version"]
        or publication[2] != marker["reference_content_version"]):
        raise HTTPException(503, "Observed collection comparison publication is missing or incompatible")
    if publication[6] is not True:
        raise HTTPException(503,"Observed collection comparison lineage is not complete")
    group = conn.execute("""SELECT statistic,
        CASE WHEN %s THEN median ELSE NULL::double precision END,member_count,eligible_count,missing_count,
        lineage_source_count,collection_content_version,reference_content_version,
        ((eligible_count=0 AND median IS NULL) OR (eligible_count>0 AND median IS NOT NULL
          AND median NOT IN ('Infinity'::float8,'-Infinity'::float8,'NaN'::float8))) AS median_valid
        FROM observed_collection_comparison_group
        WHERE indicator_id=%s AND comparison_context=%s AND group_id=%s AND territory_type=%s
        AND detail_key=%s AND observation_period=%s""",
        ("median" in selected,indicator,context,group_id,group_type,*facet)).fetchone()
    focal = conn.execute("""SELECT territory_id,
        CASE WHEN %s THEN value ELSE NULL::double precision END,status,
        CASE WHEN %s THEN rank ELSE NULL::integer END,
        CASE WHEN %s THEN tie_count ELSE NULL::integer END,
        CASE WHEN %s THEN rank_size ELSE NULL::integer END,
        collection_content_version,reference_content_version,
        ((status='not_published' AND value IS NULL AND rank IS NULL AND tie_count IS NULL AND rank_size IS NULL)
         OR (status='measured' AND value IS NOT NULL AND rank IS NOT NULL AND tie_count IS NOT NULL AND rank_size IS NOT NULL
             AND rank>=1 AND rank<=rank_size AND tie_count>=1 AND tie_count<=rank_size
             AND rank_size=(SELECT eligible_count FROM observed_collection_comparison_group g
               WHERE g.indicator_id=observed_collection_comparison_territory.indicator_id
                 AND g.comparison_context=observed_collection_comparison_territory.comparison_context
                 AND g.group_id=observed_collection_comparison_territory.group_id
                 AND g.territory_type=observed_collection_comparison_territory.territory_type
                 AND g.detail_key=observed_collection_comparison_territory.detail_key
                 AND g.observation_period=observed_collection_comparison_territory.observation_period))) AS result_valid
        FROM observed_collection_comparison_territory
        WHERE indicator_id=%s AND comparison_context=%s AND group_id=%s AND territory_type=%s
        AND detail_key=%s AND observation_period=%s AND territory_id=%s""",
        ("focal_value" in selected,"rank" in selected,"rank_ties" in selected,"rank_size" in selected,
         indicator,context,group_id,group_type,*facet,territory_id)).fetchone()
    expected = set(members)
    if (not group or group[0] != "median" or not group[8]
        or group[2] != len(expected) or group[3] + group[4] != group[2]
        or publication[3] < 1 or publication[4] < 1
        or group[6:8] != (marker["content_version"], marker["reference_content_version"])):
        raise HTTPException(503, "Observed collection comparison publication is incomplete")
    if territory_id in expected:
        if (not focal or focal[0] != territory_id or
                focal[6:8] != (marker["content_version"], marker["reference_content_version"]) or not focal[8]):
            raise HTTPException(503, "Observed collection comparison publication is stale")
        valid = focal[8]
        if not valid:
            raise HTTPException(503, "Observed collection comparison row is invalid")
    lineage = conn.execute("""SELECT source_id,vintage_id,comparison_content_version
        FROM observed_collection_comparison_lineage WHERE indicator_id=%s AND comparison_context=%s
          AND group_id=%s AND territory_type=%s AND detail_key=%s AND observation_period=%s""",
        (indicator,context,group_id,group_type,*facet)).fetchall()
    if (len(lineage)!=group[5] or len(lineage)>publication[5] or
        any(row[2]!=publication[0] for row in lineage) or
        len({(row[0],row[1]) for row in lineage})!=len(lineage) or (group[3]>0 and not lineage)):
        raise HTTPException(503,"Observed collection comparison provenance is incomplete")
    sources=[]
    if lineage:
        metadata=conn.execute("""SELECT sd.source_id,sd.name,v.vintage_id,v.version,v.reference_date,v.publication_date
            FROM source_dataset sd JOIN source_vintage v ON v.source_id=sd.source_id
            WHERE (sd.source_id,v.vintage_id) IN
              (SELECT * FROM unnest(%s::text[],%s::text[])) ORDER BY sd.source_id,v.vintage_id""",
            ([row[0] for row in lineage],[row[1] for row in lineage])).fetchall()
        if (len(metadata)!=len(lineage) or
            any(not r[0] or not r[1] or not r[2] or not r[3] for r in metadata)):
            raise HTTPException(503,"Observed collection comparison source metadata is incomplete")
        sources=[{"source_id":r[0],"name":r[1],"vintage_id":r[2],"version":r[3],
                  "reference_date":r[4],"publication_date":r[5]} for r in metadata]
    enough = group[3] >= 2
    rank = focal[3] if focal and focal[2]=="measured" else None
    return {"indicator_id":indicator,"theme_id":descriptor["theme_id"],"label":descriptor["label"],
        "unit":descriptor["unit"],"descriptor_version":descriptor["descriptor_version"],
        "source_facet":{"detail":facet[0],"observation_period":descriptor["comparison_period"]},
        "direction":descriptor["direction"],"statistic":"median","status":"available" if enough else "unavailable",
        "reason":None if enough else "fewer_than_two_comparable_values",
        **({"selected_member_count":len(expected)} if "selected_member_count" in selected else {}),
        **({"eligible_count":group[3]} if "eligible_count" in selected else {}),
        **({"missing_count":group[4]} if "missing_count" in selected else {}),
        **({"median":group[1] if enough else None} if "median" in selected else {}),
        **({"rank":rank if enough else None} if "rank" in selected else {}),
        **({"rank_size":focal[5] if rank and enough else None} if "rank_size" in selected else {}),
        "comparison_sources":sources,**marker}


def membership_snapshot(conn, descriptor, territory_type, territory_id, focal_name, marker, *, fields=None):
    project_rider = fields is None or "rider" in fields
    project_anchor_count = fields is None or "anchor_count" in fields
    rows = conn.execute("""SELECT t.territory_id,t.territory_type,t.name,m.detail_key,c.label,
        CASE WHEN %s AND m.convention_valant_ort THEN c.rider_label ELSE NULL END,
        m.source_id,sd.name,m.vintage_id,v.version,v.reference_date,v.publication_date
        FROM anchored_membership m JOIN territory_reference t USING(territory_id)
        JOIN observed_collection_category c USING(indicator_id,detail_key)
        JOIN source_dataset sd ON sd.source_id=m.source_id
        JOIN source_vintage v ON v.source_id=m.source_id AND v.vintage_id=m.vintage_id
        WHERE m.indicator_id=%s AND (t.territory_id=%s
          OR (%s='commune' AND t.territory_id=(SELECT epci_id FROM territory_reference WHERE territory_id=%s))
          OR (%s='epci' AND t.epci_id=%s)
          OR (%s='departement' AND ((t.territory_type='commune' AND t.department_id=%s)
            OR (t.territory_type='epci' AND EXISTS(SELECT 1 FROM territory_reference member
              WHERE member.epci_id=t.territory_id AND member.department_id=%s))))
          OR %s='region') ORDER BY c.ordinal,t.territory_id""",
         (project_rider,descriptor["indicator_id"],territory_id,territory_type,territory_id,territory_type,territory_id,
         territory_type,territory_id,territory_id,territory_type)).fetchall()
    entries,relationships,summaries = [],[],{}
    for anchor_id,anchor_type,name,detail,label,rider,source_id,source_name,vintage_id,version,reference_date,publication_date in rows:
        entry = {"detail":detail,"label":label,**({"rider":rider} if project_rider else {}),
                 "sources":[{"source_id":source_id,"name":source_name,"vintage_id":vintage_id,
                    "version":version,"reference_date":reference_date,"publication_date":publication_date}]}
        summary = summaries.setdefault(detail,{"detail":detail,"label":label,
            **({"anchor_count":0} if project_anchor_count else {})})
        if project_anchor_count:
            summary["anchor_count"] += 1
        if anchor_id == territory_id:
            entries.append(entry)
        else:
            relationships.append({**entry,"anchor":{"id":anchor_id,"type":anchor_type,"name":name},
                "relation":"covering_parent" if territory_type=="commune" else "member_anchor"})
    return {**descriptor,**marker,"territory":{"id":territory_id,"type":territory_type,"name":focal_name},
        "completeness":"observed_sparse","availability":"observed" if entries or relationships else "no_record",
        "entries":entries,"relationships":relationships,"summaries":list(summaries.values())}
