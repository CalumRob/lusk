"""Published typed-reading snapshots for retained Demography and Milieux shapes."""

from fastapi import HTTPException


def typed_reading_fact_fields(resource, requested_fields):
    """Project typed readings without dropping their native fact rows or metadata."""
    evidence_fields = {side["field"] for side in resource.side_relations}
    selected = set(resource.fields) if requested_fields is None else set(requested_fields)
    mandatory = {"groupe", "story_key", "salience_reason", "classification", "status",
                 "source_id", "vintage_id"}
    return [field for field in resource.fields
            if field not in evidence_fields and (field in selected or field in mandatory)]


def typed_reading_descriptor(conn, resource, marker):
    """Return only descriptor evidence actually published for this typed resource."""
    if resource.publication_table == "demographic_typed_reading":
        declared = _demographic_reading_marker(conn)
        if (not declared or declared[0] != marker[0] or declared[2] != marker[2]):
            raise HTTPException(503, "Demographic reading descriptor is unavailable or stale")
        return {
            "descriptor_version": declared[4],
            "rate_unit": declared[11],
            "source": {
                "source_id": declared[5], "name": declared[6],
                "vintage_id": declared[7], "version": declared[8],
                "reference_date": declared[9], "publication_date": declared[10],
            },
        }
    if resource.publication_table == "selected_reading":
        row = conn.execute("""SELECT d.descriptor_version,d.source_id,sd.name,d.vintage_id,
            sv.version,sv.reference_date,sv.publication_date,d.linked_content_version
            FROM selected_reading_descriptor d
            JOIN source_dataset sd ON sd.source_id=d.source_id
            JOIN source_vintage sv ON sv.source_id=d.source_id AND sv.vintage_id=d.vintage_id
            WHERE d.theme_id=%s""", (resource.theme_id,)).fetchone()
        if (not row or row[0] != marker[0] or not row[1] or not row[2] or not row[3]
                or not row[4] or not row[7]):
            raise HTTPException(503, "Selected-reading descriptor is unavailable or incompatible")
        return {
            "descriptor_version": row[0],
            "linked_content_version": row[7],
            "source": {
                "source_id": row[1], "name": row[2], "vintage_id": row[3],
                "version": row[4], "reference_date": row[5], "publication_date": row[6],
            },
        }
    return None


def validate_milieux_source_bindings(conn, bindings, reference_content_version):
    """Check returned Milieux clocks against their exact immutable revisions and datasets."""
    if not bindings:
        return
    dataset_ids = sorted({row["dataset_id"] for row in bindings if row.get("dataset_id")})
    publications = {}
    if dataset_ids:
        publications = {row[0]: (row[1], row[2]) for row in conn.execute("""SELECT dataset_id,
            content_version,reference_content_version FROM series_dataset_publication
            WHERE dataset_id=ANY(%s::text[])""", (dataset_ids,)).fetchall()}
    for row in bindings:
        identity = (row.get("source_id"), row.get("vintage_id"), row.get("source_name"),
                    row.get("source_version"), row.get("reference_date"), row.get("publication_date"))
        if row.get("field_key") == "population":
            revision = tuple(row.get(f"population_{field}") for field in (
                "source_id", "vintage_id", "source_name", "source_version", "reference_date", "publication_date"))
            valid = (row.get("population_revision_id") and not row.get("provenance_revision_id")
                     and row.get("dataset_id") is None and identity == revision)
        else:
            revision = tuple(row.get(f"series_{field}") for field in (
                "source_id", "vintage_id", "source_name", "source_version", "reference_date", "publication_date"))
            valid = (row.get("provenance_revision_id") and not row.get("population_revision_id")
                     and identity == revision
                     and row.get("observed_state_role") == row.get("state_role")
                     and row.get("observed_period") == row.get("observation_period")
                     and row.get("provenance_revision_id") in (row.get("registered_revisions") or [])
                     and row.get("state_role") == ("M2" if row.get("field_key") == "artif_m2_par_habitant" else "M3")
                     and row.get("dataset_id") is not None
                     and publications.get(row.get("dataset_id")) == (
                         row.get("dataset_content_version"), reference_content_version))
        if not valid:
            raise HTTPException(503, "Milieux source binding is stale or incompatible")

def _demographic_reading_marker(conn):
    """Return a compatible selected-reading marker from this caller-owned snapshot."""
    if not conn.execute("SELECT to_regclass('demographic_typed_reading')").fetchone()[0]:
        return None
    marker = conn.execute("""SELECT p.content_version,p.row_count,p.reference_content_version,
        t.content_version,d.descriptor_version,d.source_id,sd.name,sv.vintage_id,sv.version,
        sv.reference_date,sv.publication_date,d.rate_unit
        FROM table_publication p JOIN table_publication t ON t.table_name='territory_reference'
        JOIN demographic_reading_descriptor d ON d.singleton
        JOIN source_dataset sd ON sd.source_id=d.source_id
        JOIN source_vintage sv ON sv.source_id=d.source_id AND sv.vintage_id=d.vintage_id
        WHERE p.table_name='demographic_typed_reading'""").fetchone()
    if marker is None:
        return None
    if (not marker[0] or marker[1] < 1 or marker[2] != marker[3] or
            marker[0] != marker[4] or not marker[5] or not marker[7] or not marker[11]):
        raise HTTPException(503, "Demographic reading publication is unavailable or incompatible")
    return marker


def _demographic_reading_cloud(conn, marker, territory_type, territory_id,
                               cohort_type, members, scope):
    """Minimal selected-group plot evidence; never a history dump or focal summary."""
    focal = conn.execute("""SELECT groupe,story_key FROM demographic_typed_reading
        WHERE territory_id=%s AND territory_type=%s ORDER BY groupe""",
        (territory_id, territory_type)).fetchall()
    if len(focal) != 1:
        raise HTTPException(503, "Demographic cloud reading identity is ambiguous or absent")
    group, story_key = focal[0]
    points = []
    if members:
        rows = conn.execute("""SELECT o.territory_id,o.territory_type,t.name,o.periode,
            o.taux_solde_naturel,o.taux_solde_migratoire,o.status,o.source_id,o.vintage_id
            FROM demographic_typed_reading o JOIN territory_reference t
              ON t.territory_id=o.territory_id AND t.territory_type=o.territory_type
            WHERE o.groupe=%s AND o.territory_type=%s AND o.territory_id=ANY(%s::text[])
            ORDER BY t.name,o.territory_id""", (group,cohort_type,list(members))).fetchall()
        if len(rows) != len(set(members)):
            raise HTTPException(503, "Selected demographic cloud members have missing reading facts")
        if any(row[6] != "measured" or row[4] is None or row[5] is None or
               row[7] != marker[5] or row[8] != marker[7] for row in rows):
            raise HTTPException(503, "Selected demographic cloud facts are unavailable or incompatible")
        points = [{"territory": {"territory_id":row[0],"territory_type":row[1],"name":row[2]},
                   "periode":row[3],"taux_solde_naturel":row[4],"taux_solde_migratoire":row[5]}
                  for row in rows]
    return {"status":"available" if points else "unavailable",
        "reason":None if points else "no_selected_members","groupe":group,"story_key":story_key,
        "scope":scope,"rate_unit":marker[11],"source":{"source_id":marker[5],"name":marker[6],
            "vintage_id":marker[7],"version":marker[8],
            "reference_date":marker[9].isoformat() if marker[9] else None,
            "publication_date":marker[10].isoformat() if marker[10] else None},
        "content_version":marker[0],"points":points}


def _milieux_reading_marker(conn):
    """Pin the typed Milieux reading and shared territory reference in this snapshot."""
    if not conn.execute("SELECT to_regclass('milieux_typed_reading')").fetchone()[0]:
        return None
    marker = conn.execute("""SELECT p.content_version,p.row_count,p.reference_content_version,t.content_version,
        p.content_version FROM table_publication p JOIN table_publication t ON t.table_name='territory_reference'
        WHERE p.table_name='milieux_typed_reading'""").fetchone()
    if not marker:
        raise HTTPException(503, "Milieux reading publication is unavailable")
    if not marker[0] or marker[1] < 1 or marker[2] != marker[3]:
        raise HTTPException(503, "Milieux reading publication is unavailable or incompatible")
    absence_exists = conn.execute("SELECT to_regclass('milieux_reading_absence')").fetchone()[0]
    if absence_exists:
        absence = conn.execute("SELECT content_version,row_count,reference_content_version FROM table_publication WHERE table_name='milieux_reading_absence'").fetchone()
        if absence and (absence[0] != marker[0] or absence[2] != marker[2]):
            raise HTTPException(503, "Milieux source-absence publication is stale or incompatible")
        marker = (*marker, bool(absence), absence[0] if absence else None)
    return marker


def _milieux_reading_cloud(conn, marker, territory_type, territory_id, cohort_type, members, scope):
    """Return only selected Milieux cloud coordinates and identities; never focal facts/history."""
    if not members:
        return {"status":"unavailable","reason":"no_selected_members","groupe":None,
            "scope":scope,"selected_member_count":0,"plotted_member_count":0,
            "content_version":marker[0],"points":[]}
    focal = conn.execute("SELECT groupe FROM milieux_typed_reading WHERE territory_id=%s AND territory_type=%s ORDER BY groupe",
        (territory_id, territory_type)).fetchall()
    if len(focal) != 1:
        raise HTTPException(503, "Milieux cloud reading identity is ambiguous or absent")
    group = focal[0][0]
    points = []
    if members:
        rows = conn.execute("""SELECT r.territory_id,r.territory_type,t.name,r.periode_pop,r.periode_artif,
            r.taux_variation_population,r.artif_m2_par_habitant,r.artif_m3_par_habitant,r.status,r.source_id,r.vintage_id
            FROM milieux_typed_reading r JOIN territory_reference t
              ON t.territory_id=r.territory_id AND t.territory_type=r.territory_type
            WHERE r.groupe=%s AND r.territory_type=%s AND r.territory_id=ANY(%s::text[])
            ORDER BY t.name,r.territory_id""", (group,cohort_type,list(members))).fetchall()
        selected_members = set(members)
        by_code = {row[0]:row for row in rows}
        absent = []
        missing = selected_members - set(by_code)
        if missing and len(marker) > 5 and marker[5]:
            declarations = conn.execute("""SELECT territory_id,territory_type,reason,source_id,vintage_id,source_snapshot_sha256
                FROM milieux_reading_absence WHERE territory_type=%s AND territory_id=ANY(%s::text[])""",
                (cohort_type,sorted(missing))).fetchall()
            declared = {row[0]:row for row in declarations}
            if set(declared) != missing or any(d[2] != "source_record_absent" or not d[5] for d in declarations):
                raise HTTPException(503, "Selected Milieux members have undeclared or invalid reading absence")
            absence_pub = conn.execute("SELECT content_version,row_count,reference_content_version FROM table_publication WHERE table_name='milieux_reading_absence'").fetchone()
            if (absence_pub is None or absence_pub[0] != marker[6] or absence_pub[2] != marker[2] or
                    absence_pub[1] < len(declarations)):
                raise HTTPException(503, "Milieux source-absence publication is stale or incomplete")
            absent = declarations
        elif missing:
            raise HTTPException(503, "Selected Milieux cloud members have missing reading facts")
        # Fetch complete immutable population/state bindings for the whole selected set. These
        # joins check the association's exact state axis and revision rather than trusting its
        # denormalized clock columns. No per-peer/per-state round trips.
        bindings = conn.execute("""SELECT b.territory_id,b.field_key,b.source_id,b.vintage_id,b.source_name,
            b.source_version,b.reference_date,b.publication_date,b.observation_period,b.dataset_id,
            b.dataset_content_version,b.state_role,b.axis_value,b.provenance_revision_id,b.population_revision_id,
            p.source_id,p.vintage_id,p.source_name,p.source_version,p.reference_date,p.publication_date,
            s.source_id,s.vintage_id,s.source_name,s.source_version,s.reference_date,s.publication_date,
            o.state_role,o.observation_period,
            ARRAY(SELECT a.provenance_revision_id FROM series_observation_provenance a
              WHERE a.dataset_id=b.dataset_id AND a.indicator_id='artif_par_habitant'
                AND a.territory_id=b.territory_id AND a.axis_value=b.axis_value
              ORDER BY a.provenance_revision_id)
            FROM milieux_reading_source b
            LEFT JOIN milieux_population_provenance_revision p ON p.population_revision_id=b.population_revision_id
            LEFT JOIN series_provenance_revision s ON s.provenance_revision_id=b.provenance_revision_id
            LEFT JOIN series_dataset_observation o ON o.dataset_id=b.dataset_id AND o.indicator_id='artif_par_habitant'
              AND o.territory_id=b.territory_id AND o.territory_type=b.territory_type AND o.axis_value=b.axis_value
            WHERE b.territory_type=%s AND b.territory_id=ANY(%s::text[]) AND b.groupe=%s
            ORDER BY b.territory_id,b.field_key,b.source_id,b.vintage_id,b.provenance_revision_id""",
            (cohort_type,list(members),group)).fetchall()
        publications = conn.execute("""SELECT dataset_id,content_version,reference_content_version
            FROM series_dataset_publication WHERE dataset_id=ANY(%s::text[])""",
            (list({b[9] for b in bindings if b[9] is not None}),)).fetchall()
        published = {p[0]:p[1:] for p in publications}
        by_peer = {}
        for b in bindings:
            (code,field,source,vintage,name,version,ref_date,pub_date,period,dataset,dataset_version,
             role,axis,revision,pop_revision,p_source,p_vintage,p_name,p_version,p_ref,p_pub,
             s_source,s_vintage,s_name,s_version,s_ref,s_pub,observed_role,observed_period,registered_revisions)=b
            if field == "population":
                valid = (pop_revision is not None and revision is None and p_source == source and p_vintage == vintage
                    and p_name == name and p_version == version and p_ref == ref_date and p_pub == pub_date)
            else:
                valid = (revision is not None and pop_revision is None and s_source == source and s_vintage == vintage
                    and s_name == name and s_version == version and s_ref == ref_date and s_pub == pub_date
                    and observed_role == role and observed_period == period
                    and revision in (registered_revisions or [])
                    and role == ("M2" if field == "artif_m2_par_habitant" else "M3")
                    and published.get(dataset) == (dataset_version,marker[3]))
            if not valid:
                raise HTTPException(503, "Milieux cloud source binding is stale or incompatible")
            by_peer.setdefault(code,{}).setdefault(field,[]).append((source,vintage,revision,pop_revision,period,axis,dataset,dataset_version,role,registered_revisions))
        for code,row in by_code.items():
            fields=by_peer.get(code,{})
            population=fields.get("population",[])
            m2=fields.get("artif_m2_par_habitant",[])
            m3=fields.get("artif_m3_par_habitant",[])
            if row[8] == "unavailable":
                # Source-declared unavailable readings may have no resolved windows or state
                # associations; their typed status is not a broken publication.
                continue
            if (not population or not m2 or not m3 or any(item[4]!=row[3] for item in population)
                or any(item[4]!=row[4] or item[8]!="M2" for item in m2)
                or any(item[4]!=row[4] or item[8]!="M3" for item in m3)):
                raise HTTPException(503, "Milieux cloud source component sets/windows are incomplete")
            for field_items in (m2,m3):
                by_coordinate={}
                for item in field_items:
                    by_coordinate.setdefault((item[6],item[5]),{"bound":set(),"registered":set()})
                    by_coordinate[(item[6],item[5])]["bound"].add(item[2])
                    by_coordinate[(item[6],item[5])]["registered"].update(item[9] or [])
                if any(not group["registered"] or group["bound"] != group["registered"]
                       for group in by_coordinate.values()):
                    raise HTTPException(503, "Milieux cloud state component set differs from published provenance")
            if any(item[0]!=row[9] or item[1]!=row[10] for item in population):
                raise HTTPException(503, "Milieux cloud population provenance differs from its reading")
            # A source-declared unavailable peer is valid evidence but has no plot coordinate.
            if row[8] != "measured":
                continue
            if any(value is None for value in row[5:8]):
                # The fiche selector intentionally omits source-supported NA coordinates
                # (e.g. zero mean population) rather than placing them at invented values.
                continue
            points.append({"territory":{"territory_id":row[0],"territory_type":row[1],"name":row[2]},
                "periode_pop":row[3],"periode_artif":row[4],"taux_variation_population":row[5],
                "artif_m2_par_habitant":row[6],"artif_m3_par_habitant":row[7]})
    return {"status":"available" if points else "unavailable",
        "reason":None if points else ("no_selected_members" if not members else "source_records_absent" if 'absent' in locals() and absent else "no_plottable_members"),"groupe":group,"scope":scope,
        "selected_member_count":len(set(members)),"plotted_member_count":len(points),
        "unavailable_member_count":len(set(members))-len(points),
        "source_absent_member_count":len(absent) if 'absent' in locals() else 0,
        "unavailable_members":[{"territory_id":r[0],"territory_type":r[1],"reason":r[2],"source_id":r[3],"vintage_id":r[4],"source_snapshot_sha256":r[5]} for r in absent] if 'absent' in locals() else [],
        "content_version":marker[0],"points":points}
