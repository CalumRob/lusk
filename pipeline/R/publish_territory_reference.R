# The territory reference is the shared dependency for retained serving owners.
# Its projection comes from the canonical theme territory artifact, not from
# Mobility share/building serving parquet.
project_territory_reference <- function(territories) {
  id_column <- if (is.data.frame(territories) && "code" %in% names(territories)) "code" else "territoire"
  required <- c(id_column, "type", "nom", "departement", "epci")
  if (!is.data.frame(territories) || !all(required %in% names(territories)))
    stop("Canonical territory artifact is missing reference fields", call.=FALSE)
  density_code <- if ("classe_densite_code" %in% names(territories))
    as.character(territories$classe_densite_code) else rep(NA_character_, nrow(territories))
  density_label <- if ("classe_densite_libelle_public" %in% names(territories))
    as.character(territories$classe_densite_libelle_public) else rep(NA_character_, nrow(territories))
  champs_littoral <- c("littoral_code", "littoral_classement_source")
  presents <- champs_littoral %in% names(territories)
  if (any(presents) && !all(presents))
    stop("Territory reference littoral fields must be declared together", call.=FALSE)
  littoral_declare <- all(presents)
  littoral_code <- if (littoral_declare)
    as.character(territories$littoral_code) else rep(NA_character_, nrow(territories))
  littoral_classement <- if (littoral_declare)
    as.character(territories$littoral_classement_source) else rep(NA_character_, nrow(territories))
  result <- data.frame(territory_id=as.character(territories[[id_column]]),
    territory_type=as.character(territories$type), name=as.character(territories$nom),
    department_id=as.character(territories$departement), epci_id=as.character(territories$epci),
    density_class_code=density_code, density_class_label=density_label,
    littoral_code=littoral_code, littoral_classement_source=littoral_classement,
    stringsAsFactors=FALSE)
  if (!nrow(result) || anyNA(result[c("territory_id", "territory_type", "name")]) ||
      any(!nzchar(trimws(result$territory_id)) | !nzchar(trimws(result$territory_type)) |
          !nzchar(trimws(result$name))) || anyDuplicated(result$territory_id))
    stop("Canonical territory reference has missing or duplicate identities", call.=FALSE)
  # #1041 : la classification littorale est TOUTE ou RIEN. Une projection
  # partielle (quelques lignes classées) ne doit jamais être publiée comme si
  # l'absence valait NC ; un non-commune classé est une erreur d'identité.
  # Les colonnes ABSENTES sont la transition historique autorisée ; des
  # colonnes PRÉSENTES mais entièrement vides sont une référence enrichie
  # silencieusement vide — refusée, comme côté app.
  if (littoral_declare) {
    if (all(is.na(result$littoral_code)))
      stop("Territory reference littoral classification is present but empty", call.=FALSE)
    classees <- !is.na(result$littoral_code)
    communes <- result$territory_type == "commune"
    if (any(classees & !communes))
      stop("Territory reference classifies a non-commune as littoral", call.=FALSE)
    if (any(!classees & communes))
      stop("Territory reference littoral classification is incomplete", call.=FALSE)
    if (any(!result$littoral_code[communes] %in% c("C", "NC")))
      stop("Territory reference has an unknown littoral code", call.=FALSE)
    # NA-safe : un non-commune n'est jamais "C", et un `NC` valide ne rend pas
    # la garde inconnue (l'ancien `any(x == "C")` valait NA sur ces lignes).
    est_c <- classees & result$littoral_code == "C"
    if (any(est_c & !result$littoral_classement_source %in% c("Mer", "Estuaire")) ||
        any(!est_c & classees & !is.na(result$littoral_classement_source)))
      stop("Territory reference has an incoherent littoral source classement", call.=FALSE)
    # Une source sans classification est un orphelin : le CHECK SQL exige
    # (code IS NULL AND source IS NULL) pour toute ligne non classée (typiquement
    # un non-commune, qui n'a jamais de code). Le refuser ici, avant la publication.
    if (any(!classees & !is.na(result$littoral_classement_source)))
      stop("Territory reference has an orphan littoral source classement without a littoral code", call.=FALSE)
  }
  result <- result[order(result$territory_type, result$territory_id), , drop=FALSE]
  rownames(result) <- NULL
  # Le contenu est haché AVANT d'ajouter le drapeau : la version de la
  # référence reste donc exactement celle de la transition historique.
  version <- scalar_content_version(result)
  # Les lignes projetées portent TOUJOURS les deux colonnes (NA/NA pour une
  # transition sans classification). Ce drapeau distingue cette transition
  # autorisée d'une référence enrichie déclarée mais vidée : les éditeurs de
  # comparaisons peuvent refuser cette dernière par un motif nommé.
  attr(result, "littoral_declared") <- littoral_declare
  list(rows=result, content_version=version)
}

territory_reference_postgres_adapter <- function(con) {
  list(
    transaction=function(expr) publication_transaction(con, expr),
    lock=function(owner) DBI::dbGetQuery(con, "SELECT pg_advisory_xact_lock(593, 1)"),
    marker=function(owner) DBI::dbGetQuery(con,
      "SELECT content_version,reference_content_version FROM table_publication WHERE table_name=$1",
      params=list(owner)),
    write=function(projection, version, dependency) {
      rows <- projection$rows
      for (i in seq_len(nrow(rows))) {
        DBI::dbExecute(con, "INSERT INTO territory_reference(territory_id,territory_type,name,department_id,epci_id,density_class_code,density_class_label,littoral_code,littoral_classement_source) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(territory_id) DO UPDATE SET territory_type=EXCLUDED.territory_type,name=EXCLUDED.name,department_id=EXCLUDED.department_id,epci_id=EXCLUDED.epci_id,density_class_code=EXCLUDED.density_class_code,density_class_label=EXCLUDED.density_class_label,littoral_code=EXCLUDED.littoral_code,littoral_classement_source=EXCLUDED.littoral_classement_source",
          params=unname(as.list(rows[i, , drop=FALSE])))
      }
      old_ids <- DBI::dbGetQuery(con, "SELECT territory_id FROM territory_reference")$territory_id
      for (id in setdiff(as.character(old_ids), rows$territory_id))
        DBI::dbExecute(con, "DELETE FROM territory_reference WHERE territory_id=$1", params=list(id))
      DBI::dbExecute(con, "INSERT INTO table_publication(table_name,content_version,row_count,reference_content_version,published_at) VALUES('territory_reference',$1,$2,$3,now()) ON CONFLICT(table_name) DO UPDATE SET content_version=EXCLUDED.content_version,row_count=EXCLUDED.row_count,reference_content_version=EXCLUDED.reference_content_version,published_at=EXCLUDED.published_at",
        params=list(version, nrow(rows), dependency$content_version[[1L]]))
    },
    rebind=function(owner, version) DBI::dbExecute(con,
      "UPDATE table_publication SET reference_content_version=$1 WHERE table_name=$2",
      params=list(version, owner))
  )
}

publish_territory_reference_projection <- function(projection, db) {
  if (!is.list(projection) || !is.data.frame(projection$rows) ||
      !all(c("territory_id", "territory_type", "name", "department_id", "epci_id",
             "density_class_code", "density_class_label",
             "littoral_code", "littoral_classement_source") %in% names(projection$rows)) ||
      length(projection$content_version) != 1L || is.na(projection$content_version) ||
      !nzchar(projection$content_version))
    stop("Invalid retained territory-reference projection", call.=FALSE)
  required <- c("transaction", "marker", "write", "rebind")
  if (!is.list(db) || !all(vapply(required, function(key) is.function(db[[key]]), logical(1))))
    stop("Invalid territory-reference database adapter", call.=FALSE)
  dependency <- data.frame(content_version=projection$content_version)
  publish_owner_snapshot(db=db,
    owner="territory_reference", content_version=projection$content_version,
    dependency_name="canonical_territories", read_dependency=function() dependency,
    validate_dependency=function(value) {
      if (!identical(as.character(value$content_version[[1L]]), projection$content_version))
        stop("Canonical territory dependency changed during publication", call.=FALSE)
    },
    publish_content=function(version, value) db$write(projection, version, value),
    rebind_dependency=function(version) db$rebind("territory_reference", version))
}

publish_canonical_territory_reference <- function(con, sortie="../public/data") {
  path <- file.path(sortie, "territoires.parquet")
  if (!file.exists(path))
    stop("Canonical territory artifact is required for territory-reference publication", call.=FALSE)
  projection <- project_territory_reference(nanoparquet::read_parquet(path))
  result <- publish_territory_reference_projection(projection,
    territory_reference_postgres_adapter(con))
  invisible(list(projection=projection, publication=result))
}
