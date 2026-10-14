"""Bounded reads of published sparse period/detail collections."""
from fastapi import HTTPException
from statistics import median
from math import isfinite


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


def collection_snapshot(conn, descriptor, territory_type, territory_id):
    if territory_type not in descriptor["allowed_levels"]:
        raise HTTPException(422,"Collection is not declared for this territory level")
    focal = conn.execute("SELECT name,territory_type FROM territory_reference WHERE territory_id=%s", (territory_id,)).fetchone()
    if not focal:
        raise HTTPException(404,"Territory not found")
    if focal[1] != territory_type:
        raise HTTPException(422,"Territory does not match its declared level")
    marker = collection_marker(conn,descriptor)
    if descriptor["kind"] == "anchored_membership":
        return membership_snapshot(conn,descriptor,territory_type,territory_id,focal[0],marker)
    rows = conn.execute("""SELECT o.detail_key,c.label,o.observation_period,o.value,o.source_id,
        sd.name,o.vintage_id,v.version,v.reference_date,v.publication_date
        FROM period_detail_observation o JOIN observed_collection_category c USING(indicator_id,detail_key)
        JOIN source_dataset sd ON sd.source_id=o.source_id
        JOIN source_vintage v ON v.source_id=o.source_id AND v.vintage_id=o.vintage_id
        WHERE o.indicator_id=%s AND o.territory_id=%s AND o.territory_type=%s
        ORDER BY o.observation_period,c.ordinal""", (descriptor["indicator_id"],territory_id,territory_type)).fetchall()
    entries = [{"detail":key,"label":label,"observation_period":period,"value":value,"status":"measured",
        "sources":[{"source_id":source_id,"name":source_name,"vintage_id":vintage_id,"version":version,
                    "reference_date":reference_date,"publication_date":publication_date}]}
        for key,label,period,value,source_id,source_name,vintage_id,version,reference_date,publication_date in rows]
    return {**descriptor,**marker,"territory":{"id":territory_id,"type":territory_type,"name":focal[0]},
            "completeness":"observed_sparse","availability":"observed" if entries else "no_record","entries":entries}


def collection_comparison(conn, descriptor, territory_type, territory_id, cohort_type, members,
                          fixed_context=None):
    marker = collection_marker(conn,descriptor)
    if descriptor["kind"] == "anchored_membership":
        return {"indicator_id":descriptor["indicator_id"],"theme_id":descriptor["theme_id"],
                "status":"unavailable","reason":"categorical_membership_not_comparable",
                "selected_member_count":len(members),"median":None,"rank":None,**marker}
    valid = territory_type in descriptor["allowed_levels"] and cohort_type in descriptor["allowed_levels"]
    if fixed_context is not None and valid:
        return _published_collection_comparison(conn, descriptor, territory_type, territory_id,
                                                members, fixed_context, marker)
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
        "selected_member_count":len(members),"eligible_count":len(values),"missing_count":len(members)-len(values),
        "median":median(values) if enough else None,"rank":rank,"rank_size":len(values) if rank is not None else None,
        "comparison_sources":list(sources.values()),**marker}


def _published_collection_comparison(conn, descriptor, territory_type, territory_id, members,
                                     fixed_context, marker):
    context, group_id, group_type = fixed_context
    indicator = descriptor["indicator_id"]
    facet = (descriptor["comparison_detail"], str(descriptor["comparison_period"]))
    publication = conn.execute("""SELECT content_version,collection_content_version,
        reference_content_version,group_row_count,territory_row_count
        FROM observed_collection_comparison_publication WHERE indicator_id=%s""", (indicator,)).fetchone()
    if (not publication or not publication[0] or publication[1] != marker["content_version"]
        or publication[2] != marker["reference_content_version"]):
        raise HTTPException(503, "Observed collection comparison publication is missing or incompatible")
    physical_counts = conn.execute("""SELECT
        (SELECT count(*) FROM observed_collection_comparison_group WHERE indicator_id=%s),
        (SELECT count(*) FROM observed_collection_comparison_territory WHERE indicator_id=%s)""",
        (indicator,indicator)).fetchone()
    if not physical_counts or tuple(physical_counts) != tuple(publication[3:5]):
        raise HTTPException(503, "Observed collection comparison row counts are inconsistent")
    group = conn.execute("""SELECT statistic,median,member_count,eligible_count,missing_count,
        collection_content_version,reference_content_version FROM observed_collection_comparison_group
        WHERE indicator_id=%s AND comparison_context=%s AND group_id=%s AND territory_type=%s
        AND detail_key=%s AND observation_period=%s""",
        (indicator,context,group_id,group_type,*facet)).fetchone()
    rows = conn.execute("""SELECT territory_id,value,status,rank,tie_count,rank_size,
        collection_content_version,reference_content_version FROM observed_collection_comparison_territory
        WHERE indicator_id=%s AND comparison_context=%s AND group_id=%s AND territory_type=%s
        AND detail_key=%s AND observation_period=%s""",
        (indicator,context,group_id,group_type,*facet)).fetchall()
    expected = set(members)
    if (not group or group[0] != "median" or group[1] is None and group[3] > 0
        or group[1] is not None and not isfinite(group[1])
        or group[2] != len(expected) or group[3] + group[4] != group[2]
        or publication[4] < len(rows) or publication[3] < 1
        or group[5:] != (marker["content_version"], marker["reference_content_version"])
        or any(r[0] not in expected for r in rows) or {r[0] for r in rows} != expected
        or len(rows) != len(expected)):
        raise HTTPException(503, "Observed collection comparison publication is incomplete")
    for row in rows:
        if row[6:] != (marker["content_version"], marker["reference_content_version"]):
            raise HTTPException(503, "Observed collection comparison publication is stale")
        if row[2] == "not_published":
            valid = row[1] is None and row[3:6] == (None,None,None)
        else:
            valid = (row[2] == "measured" and isinstance(row[1], (int,float)) and isfinite(row[1])
                     and all(isinstance(v, int) for v in row[3:6])
                     and 1 <= row[3] <= row[5] and 1 <= row[4] <= row[5])
        if not valid:
            raise HTTPException(503, "Observed collection comparison row is invalid")
    eligible = [r for r in rows if r[2] == "measured"]
    if len(eligible) != group[3] or group[4] != len(expected)-len(eligible):
        raise HTTPException(503, "Observed collection comparison counts are inconsistent")
    values = [r[1] for r in eligible]
    expected_median = median(values) if values else None
    if group[1] != expected_median:
        raise HTTPException(503, "Observed collection comparison median is inconsistent")
    for row in eligible:
        better = sum(v > row[1] if descriptor["direction"] == "high" else v < row[1] for v in values)
        ties = sum(v == row[1] for v in values)
        if descriptor["direction"] not in ("high", "low") or row[3] != 1 + better or row[4] != ties or row[5] != len(values):
            raise HTTPException(503, "Observed collection comparison rank is inconsistent")
    focal = next((r for r in rows if r[0] == territory_id), None)
    rank = focal[3] if focal and focal[2] == "measured" else None
    sources = []
    if eligible:
        provenance = conn.execute("""SELECT DISTINCT o.source_id,sd.name,o.vintage_id,v.version,
            v.reference_date,v.publication_date FROM period_detail_observation o
            JOIN source_dataset sd ON sd.source_id=o.source_id JOIN source_vintage v
            ON v.source_id=o.source_id AND v.vintage_id=o.vintage_id
            WHERE o.indicator_id=%s AND o.detail_key=%s AND o.observation_period=%s
            AND o.territory_id=ANY(%s)""", (indicator,*facet,[r[0] for r in eligible])).fetchall()
        sources = [{"source_id":r[0],"name":r[1],"vintage_id":r[2],"version":r[3],
                    "reference_date":r[4],"publication_date":r[5]} for r in provenance]
        if not sources or any(not source["source_id"] or not source["name"] or not source["vintage_id"] or not source["version"] for source in sources):
            raise HTTPException(503, "Observed collection comparison provenance is incomplete")
    enough = len(eligible) >= 2
    return {"indicator_id":indicator,"theme_id":descriptor["theme_id"],"label":descriptor["label"],
        "unit":descriptor["unit"],"descriptor_version":descriptor["descriptor_version"],
        "source_facet":{"detail":facet[0],"observation_period":descriptor["comparison_period"]},
        "direction":descriptor["direction"],"statistic":"median","status":"available" if enough else "unavailable",
        "reason":None if enough else "fewer_than_two_comparable_values","selected_member_count":len(expected),
        "eligible_count":len(eligible),"missing_count":len(expected)-len(eligible),
        "median":group[1] if enough else None,
        "rank":rank if enough else None,"rank_size":focal[5] if rank and enough else None,
        "comparison_sources":sources,**marker}


def membership_snapshot(conn, descriptor, territory_type, territory_id, focal_name, marker):
    rows = conn.execute("""SELECT t.territory_id,t.territory_type,t.name,m.detail_key,c.label,
        CASE WHEN m.convention_valant_ort THEN c.rider_label ELSE NULL END,
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
        (descriptor["indicator_id"],territory_id,territory_type,territory_id,territory_type,territory_id,
         territory_type,territory_id,territory_id,territory_type)).fetchall()
    entries,relationships,summaries = [],[],{}
    for anchor_id,anchor_type,name,detail,label,rider,source_id,source_name,vintage_id,version,reference_date,publication_date in rows:
        entry = {"detail":detail,"label":label,"rider":rider,
                 "sources":[{"source_id":source_id,"name":source_name,"vintage_id":vintage_id,
                    "version":version,"reference_date":reference_date,"publication_date":publication_date}]}
        summary = summaries.setdefault(detail,{"detail":detail,"label":label,"anchor_count":0})
        summary["anchor_count"] += 1
        if anchor_id == territory_id:
            entries.append(entry)
        else:
            relationships.append({**entry,"anchor":{"id":anchor_id,"type":anchor_type,"name":name},
                "relation":"covering_parent" if territory_type=="commune" else "member_anchor"})
    return {**descriptor,**marker,"territory":{"id":territory_id,"type":territory_type,"name":focal_name},
        "completeness":"observed_sparse","availability":"observed" if entries or relationships else "no_record",
        "entries":entries,"relationships":relationships,"summaries":list(summaries.values())}
