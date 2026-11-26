# Guarded adoption proofs (#1142) on the operator-owned lusk_it_contract DB.
# NEVER connects to `lusk`. Without the exact test DSNs/private passfile and
# cleanup opt-in, every test skips before dbConnect. One random schema per test;
# only that schema is dropped in on.exit.
#
# Fixture-scale limitation (deliberate, no SQL seeds): the normal full backend
# entry point also publishes four typed-reading families which adoption ignores
# and whose complete canonical fixtures are not available at this scale. These
# proofs call publish_retained_backend_snapshot(atomic=TRUE) with ONLY those
# retired families stubbed to no-ops. Territory reference, scalar snapshot,
# declared profile, comparisons and every serving write are the real publishers.
# project_retained_scalar_snapshot supplies the bounded fixture snapshot and the
# profile binding is the matching real scalar token; no expected serving rows
# are inserted directly in SQL.

local({
  etat <- new.env(parent = emptyenv())
  etat$con <- NULL; etat$schema <- NULL; etat$fixture <- NULL
  etat$builds <- NULL; etat$artefacts <- NULL
  etat$digest <- NULL; etat$registry <- NULL

  fixture_partage <- function() {
    if (is.null(etat$fixture)) {
      etat$con <- .adopt_db_connect()
      etat$schema <- .adopt_db_schema(etat$con)
      etat$fixture <- .adopt_db_fixture()
      etat$builds <- splitter_sortie(etat$fixture$sortie, root = etat$fixture$root,
        projections = etat$fixture$projections, reference = etat$fixture$reference,
        metadata_directory = etat$fixture$metadata_directory)
      etat$artefacts <- charger_artefacts_construits(etat$builds, etat$fixture$root)
      expect_setequal(names(etat$artefacts), as.character(etat$builds$ressource))
      .adopt_db_publish_all(etat$con, etat$fixture)
      etat$digest <- .adopt_db_digest(etat$con)
      etat$registry <- .adopt_db_registry_digest(etat$con)
    }
    etat
  }

  on.exit({
    if (!is.null(etat$fixture)) {
      unlink(c(etat$fixture$sortie, etat$fixture$root, etat$fixture$aedar_dir,
        etat$fixture$base_metadata), recursive = TRUE)
    }
    if (!is.null(etat$con) && !is.null(etat$schema)) {
      try(DBI::dbExecute(etat$con, paste0('DROP SCHEMA IF EXISTS "', etat$schema,
        '" CASCADE')), silent = TRUE)
    }
    if (!is.null(etat$con)) try(DBI::dbDisconnect(etat$con), silent = TRUE)
  }, add = TRUE)

test_that("DPE-like fixture derives its semantic contract from the scalar descriptor", {
  reference <- artefacts_fixture_reference()
  source <- list(descriptor = list(indicator_id = "distribution_dpe", unit = "wrong",
      comparison_direction = "low", levels = "commune"),
    axes = data.frame(axis_name = "detail", axis_key = "d1", label = "D1",
      ordinal = 0L, unit = "wrong", stringsAsFactors = FALSE),
    provenance = data.frame(source_id = "s", vintage_id = "v", stringsAsFactors = FALSE),
    datasets = data.frame(source_id = "s", name = "S", stringsAsFactors = FALSE),
    vintages = data.frame(source_id = "s", vintage_id = "v", version = "v",
      reference_date = as.Date("2020-01-01"), publication_date = as.Date("2021-01-01"),
      stringsAsFactors = FALSE))
  scalar <- data.frame(indicator_id = "part_passoires", unit = "count",
    direction = "high", comparison_facet = "part_passoires",
    allowed_levels = I(list(c("commune", "epci", "departement", "region"))),
    stringsAsFactors = FALSE)
  profile <- .adopt_db_profile_projection(source, "distribution_dpe", reference,
    scalar_version = "facts-v1", comparison_scalar = "part_passoires",
    scalar_descriptor = scalar)
  expect_identical(profile$descriptor$unit, scalar$unit)
  expect_identical(profile$descriptor$comparison_direction, scalar$direction)
  expect_identical(profile$descriptor$comparison_scalar, scalar$comparison_facet)
  expect_true(all(profile$descriptor$levels %in%
    as.character(scalar$allowed_levels[[1L]])))
})

test_that("guarded: real full-path publication adopts every shape with unchanged data and plan", {
  partage <- fixture_partage()
  con <- partage$con
  fixture <- partage$fixture
  expect_identical(partage$digest, .adopt_db_digest(con))
  expect_identical(partage$registry, .adopt_db_registry_digest(con))
  .adopt_db_begin_rollback(con)
  avant <- partage$digest
  # fixture_partage() already ran the real splitter/loader once. Every CLI call
  # below reuses those immutable artefacts and the real artifact store contents.
  .adopt_db_reuse_artefacts(partage)
  # Everything below goes through the CLI ENTRY FUNCTION `scripts/publication.R`
  # calls, with the same arguments the operator types; only the connection, the
  # lock and the pre-read projections are injected (as in apply's own proofs).
  cli <- function(args, ...) {
    sortie <- character()
    tc <- textConnection("sortie", "w", local = TRUE)
    on.exit(close(tc), add = TRUE)
    resultat <- executer_commande_publication(args, out = tc, ...)
    list(resultat = resultat, sortie = { flush(tc); sortie })
  }
  adopter <- function(args) cli(args, root = fixture$root, registre = fixture$lock,
    projections = fixture$projections, reference = fixture$reference,
    metadata_directory = fixture$metadata_directory, con = con)

  # --dry-run through the CLI: not ONE row of any serving, registry, descriptor or
  # receipt table changes, and nothing is reported adopted.
  total_avant <- list(partage$digest, partage$registry)
  sec <- adopter(c("adopt", fixture$sortie, "--dry-run"))
  expect_identical(sec$resultat$adopted, character())
  expect_true("adoption=match adopted= zero_data_writes=true" %in% sec$sortie)
  expect_identical(list(.adopt_db_digest(con), .adopt_db_registry_digest(con)), total_avant)
  expect_equal(as.numeric(DBI::dbGetQuery(con,
    "SELECT count(*) AS n FROM resource_publication")$n[[1L]]), 0)

  reel <- adopter(c("adopt", fixture$sortie))
  resultat <- reel$resultat
  expect_true(any(grepl("^adoption=match adopted=", reel$sortie)))
  attendus <- c("densite", "part_passoires", "structure_age", "distribution_dpe",
    "artif_par_habitant", "acv", "membres", "aedar")
  expect_setequal(resultat$adopted, attendus)
  expect_identical(.adopt_db_digest(con), avant)
  pub <- DBI::dbGetQuery(con, paste0(
    "SELECT resource_id,shape,content_version,retired FROM resource_publication ",
    "ORDER BY resource_id"))
  expect_setequal(pub$resource_id, attendus)
  expect_false(any(pub$retired))
  descriptors <- DBI::dbGetQuery(con, paste0(
    "SELECT d.publication_resource_id,d.content_version,p.content_version AS registry_version ",
    "FROM resource_publication_descriptor d JOIN resource_publication p ",
    "ON p.resource_id=d.publication_resource_id ORDER BY d.publication_resource_id"))
  # The expected count is DERIVED from the declarations, not an offset: one descriptor
  # per declared discovery identity of each adopted resource (an indicator, plus one per
  # named reference alias its owned-series route publishes, or the grammar identities of
  # a storage resource such as AEDAR's two).
  declares <- vapply(attendus, function(id) length(declarations_decouverte_ressource(id,
    fixture$metadata_directory)), integer(1))
  expect_equal(nrow(descriptors), sum(declares))
  expect_equal(sum(descriptors$publication_resource_id == "aedar"), 2L)
  expect_identical(declares[["aedar"]], 2L)
  expect_setequal(descriptors$publication_resource_id, attendus)
  expect_identical(descriptors$content_version, descriptors$registry_version)
  expect_equal(nrow(DBI::dbGetQuery(con, paste0(
    "SELECT * FROM resource_publication_event WHERE operation='adopt'"))), length(attendus))

  # The operator path to "plan shows every resource unchanged": `listing` reads the
  # live registry read-only through the shared seam and prints the file `plan`
  # (which never connects, #1136) consumes via LUSK_LIVE_LISTING. Both are the CLI
  # entry functions, run on the registry the CLI adopt just wrote.
  registre_avant <- .adopt_db_registry_digest(con)
  listing <- cli(c("listing"), registre = fixture$lock, con = con)
  expect_identical(.adopt_db_registry_digest(con), registre_avant)
  fichier <- tempfile(fileext = ".json")
  on.exit(unlink(fichier), add = TRUE, after = FALSE)
  writeLines(listing$sortie, fichier)
  plan <- cli(c("plan"), root = fixture$root, registre = fixture$lock, live = fichier)
  lignes <- plan$sortie[grepl("^ressource=", plan$sortie)]
  expect_length(lignes, length(attendus))
  for (id in attendus)
    expect_true(any(startsWith(lignes, paste0("ressource=", id, " "))), info = id)
  expect_true(all(grepl("adoption=adopted", lignes, fixed = TRUE)))
  expect_true(all(grepl("status=unchanged", lignes, fixed = TRUE)))
  expect_true(all(grepl("cascade=no", lignes, fixed = TRUE)))
  expect_true("changed=" %in% plan$sortie)
  expect_true("freeze=ok" %in% plan$sortie)
  expect_setequal(plan$resultat$ressources$ressource, attendus)
  expect_false(any(plan$resultat$ressources$change))
  expect_false(any(plan$resultat$ressources$cascade))
  expect_true(all(plan$resultat$ressources$drift_nb == 0L))

  # --- Round 9: adopt + the new API must not 503 every comparison read ------------
  # The per-resource comparison markers exist and satisfy the api/snapshot_reads.py
  # predicates (cited in .adopt_db_predicats_api), carrying the GLOBAL token the live
  # comparison rows already carry, with no comparison row rewritten.
  predicats <- .adopt_db_predicats_api(con, c("densite", "part_passoires"),
    "structure_age", "distribution_dpe")
  global_scalaire <- DBI::dbGetQuery(con,
    "SELECT content_version FROM scalar_comparison_publication WHERE singleton")$content_version[[1L]]
  expect_true(all(predicats$scalaires$content_version == global_scalaire))
  global_profil <- DBI::dbGetQuery(con,
    "SELECT content_version FROM profile_comparison_publication WHERE singleton")$content_version[[1L]]
  expect_identical(predicats$profils$content_version[predicats$profils$indicator_id == "structure_age"],
                   global_profil)
  # ...and the receipt records which comparison token was adopted.
  jetons <- vapply(resultat$receipts, function(r) as.character(r$comparison_token), character(1))
  names(jetons) <- vapply(resultat$receipts, function(r) r$ressource, character(1))
  expect_identical(jetons[["densite"]], global_scalaire)
  expect_identical(jetons[["structure_age"]], global_profil)
  expect_true(is.na(jetons[["aedar"]]))
  # A rowless scalar-backed placeholder has no live token to carry and the API never
  # reads its marker: adopt writes none (the next apply does).
  expect_true(is.na(jetons[["distribution_dpe"]]))
  expect_equal(as.numeric(DBI::dbGetQuery(con, paste0("SELECT count(*) FROM ",
    "profile_resource_comparison_publication WHERE indicator_id='distribution_dpe'"))[[1L]]), 0)
  # The scalar-backed profile's binding: the dependency's marker scalar_content_version
  # == the descriptor's required_scalar_version (profile_reads.py:52), asserted inside
  # .adopt_db_predicats_api. Spelled out here: both are the GLOBAL live scalar token.
  expect_identical(
    DBI::dbGetQuery(con, paste0("SELECT scalar_content_version FROM ",
      "scalar_resource_comparison_publication WHERE indicator_id='part_passoires'"))[[1L]],
    DBI::dbGetQuery(con, paste0("SELECT required_scalar_version FROM profile_descriptor ",
      "WHERE indicator_id='distribution_dpe'"))[[1L]])

  # AEDAR discovery (api/resource_catalogue.py:1026-1033): both grammar identities of the
  # single `aedar` storage resource have a live version-bound descriptor.
  catalogue <- .adopt_db_catalogue(con)
  aedar <- catalogue[catalogue$resource_id %in%
    c("aedar_territorial_aggregate", "aedar_territory_summary"), ]
  expect_setequal(aedar$resource_id, c("aedar_territorial_aggregate", "aedar_territory_summary"))
  expect_true(all(aedar$publication_id == "aedar"))
  expect_true(all(aedar$live))
  expect_true(all(catalogue$live))   # and every other adopted descriptor is live too

  # A later `apply` of that resource (a new artefact) replaces its marker normally:
  # the predicates still hold, now with the new token; the untouched resource keeps
  # the adopted one.
  nouvelles <- fixture$projections
  nouvelles$scalar$densite$facts$value <- nouvelles$scalar$densite$facts$value + 1000
  splitter_sortie(fixture$sortie, root = fixture$root, projections = nouvelles,
    reference = fixture$reference, metadata_directory = fixture$metadata_directory)
  appliquer <- cli(c("apply", "densite"), root = fixture$root, registre = fixture$lock, con = con)
  expect_identical(appliquer$resultat$applied, "densite")
  apres <- .adopt_db_predicats_api(con, c("densite", "part_passoires"),
    "structure_age", "distribution_dpe")
  tok <- function(x, id) x$scalaires$content_version[x$scalaires$indicator_id == id]
  expect_false(identical(tok(apres, "densite"), global_scalaire))
  expect_identical(tok(apres, "part_passoires"), global_scalaire)

  # Apply of the DEPENDENCY: the cascade (#1138) moves the scalar marker and the profile
  # binding together, so profile_reads.py:52 still holds with the NEW token.
  avant_liaison <- DBI::dbGetQuery(con, paste0("SELECT required_scalar_version FROM ",
    "profile_descriptor WHERE indicator_id='distribution_dpe'"))[[1L]]
  nouvelles$scalar$part_passoires$facts$value <- nouvelles$scalar$part_passoires$facts$value + 500
  splitter_sortie(fixture$sortie, root = fixture$root, projections = nouvelles,
    reference = fixture$reference, metadata_directory = fixture$metadata_directory)
  appliquer <- cli(c("apply", "part_passoires"), root = fixture$root,
    registre = fixture$lock, con = con)
  expect_true(all(c("part_passoires", "distribution_dpe") %in% appliquer$resultat$applied))
  apres2 <- .adopt_db_predicats_api(con, c("densite", "part_passoires"),
    "structure_age", "distribution_dpe")
  apres_liaison <- DBI::dbGetQuery(con, paste0("SELECT required_scalar_version FROM ",
    "profile_descriptor WHERE indicator_id='distribution_dpe'"))[[1L]]
  expect_false(identical(apres_liaison, avant_liaison))          # the binding really moved
  expect_identical(tok(apres2, "part_passoires") == tok(apres, "part_passoires"), FALSE)
  expect_identical(DBI::dbGetQuery(con, paste0("SELECT scalar_content_version FROM ",
    "scalar_resource_comparison_publication WHERE indicator_id='part_passoires'"))[[1L]],
    apres_liaison)
})

test_that("guarded: one altered live row in each shape refuses with zero writes", {
  partage <- fixture_partage()
  con <- partage$con
  fixture <- partage$fixture
  expect_identical(partage$digest, .adopt_db_digest(con))
  expect_identical(partage$registry, .adopt_db_registry_digest(con))
  .adopt_db_begin_rollback(con)
  cas <- list(
    list(ressource = "densite", table = "scalar_observation", colonne = "value",
      where = "indicator_id='densite'", num = TRUE),
    list(ressource = "structure_age", table = "profile_observation", colonne = "value",
      where = "indicator_id='structure_age'", num = TRUE),
    list(ressource = "artif_par_habitant", table = "series_dataset_observation",
      colonne = "value", where = "dataset_id='artif_par_habitant'", num = TRUE),
    list(ressource = "acv", table = "period_detail_observation", colonne = "value",
      where = "indicator_id='acv'", num = TRUE),
    list(ressource = "aedar", table = "aedar_territorial_aggregate", colonne = "n_observed",
      where = "territory_type='commune'", num = TRUE))
  for (x in cas) {
    key <- DBI::dbGetQuery(con, paste0("SELECT ctid::text AS rowid FROM ", x$table,
      " WHERE ", x$where, " ORDER BY ctid LIMIT 1"))$rowid[[1L]]
    old <- DBI::dbGetQuery(con, paste0("SELECT ", x$colonne, " FROM ", x$table,
      " WHERE ctid='", key, "'"))[[1L]][[1L]]
    DBI::dbExecute(con, paste0("ALTER TABLE ", x$table, " DISABLE TRIGGER USER"))
    DBI::dbExecute(con, paste0("UPDATE ", x$table, " SET ", x$colonne, "=", x$colonne,
      "+1 WHERE ctid='", key, "'"))
    DBI::dbExecute(con, paste0("ALTER TABLE ", x$table, " ENABLE TRIGGER USER"))
    avant_table <- .adopt_db_table_digest(con, x$table)
    registre_avant <- .adopt_db_registry_digest(con)
    err <- local({
      .adopt_db_reuse_artefacts(partage, ids = x$ressource)
      tryCatch(executer_commande_publication(c("adopt", fixture$sortie),
        root = fixture$root, registre = fixture$lock, projections = fixture$projections,
        reference = fixture$reference, metadata_directory = fixture$metadata_directory,
        con = con, out = nullfile()), error = identity)
    })
    expect_true(inherits(err, "erreur_adoption"), info = x$ressource)
    expect_match(conditionMessage(err), x$ressource, fixed = TRUE, info = x$ressource)
    expect_match(conditionMessage(err), x$table, fixed = TRUE, info = x$ressource)
    expect_identical(.adopt_db_table_digest(con, x$table), avant_table, info = x$ressource)
    expect_identical(.adopt_db_registry_digest(con), registre_avant, info = x$ressource)
    DBI::dbExecute(con, paste0("ALTER TABLE ", x$table, " DISABLE TRIGGER USER"))
    DBI::dbExecute(con, paste0("UPDATE ", x$table, " SET ", x$colonne, "=$1 WHERE ctid=$2"),
      params = list(old, key))
    DBI::dbExecute(con, paste0("ALTER TABLE ", x$table, " ENABLE TRIGGER USER"))
  }
  expect_identical(.adopt_db_digest(con), partage$digest)
  expect_identical(.adopt_db_registry_digest(con), partage$registry)
})

test_that("guarded: a forced receipt failure rolls back every adopted registry row", {
  partage <- fixture_partage()
  con <- partage$con
  fixture <- partage$fixture
  expect_identical(partage$digest, .adopt_db_digest(con))
  expect_identical(partage$registry, .adopt_db_registry_digest(con))
  .adopt_db_begin_rollback(con)
  .adopt_db_reuse_artefacts(partage)
  avant <- .adopt_db_digest(con)
  registre_avant <- .adopt_db_registry_digest(con)
  local_mocked_bindings(ecrire_recette_ressource = function(con, ressource, ...) {
    if (identical(ressource, "structure_age")) stop("forced adoption receipt failure")
    invisible(TRUE)
  }, .package = "lusk")
  err <- tryCatch(executer_commande_publication(c("adopt", fixture$sortie),
    root = fixture$root, registre = fixture$lock, projections = fixture$projections,
    reference = fixture$reference, metadata_directory = fixture$metadata_directory,
    con = con, out = nullfile()), error = identity)
  expect_match(conditionMessage(err), "forced adoption receipt failure", fixed = TRUE)
  expect_identical(.adopt_db_digest(con), avant)
  expect_identical(.adopt_db_registry_digest(con), registre_avant)
})

test_that("guarded: a forged live scalar binding refuses with the typed reason and zero writes", {
  partage <- fixture_partage()
  con <- partage$con
  fixture <- partage$fixture
  expect_identical(partage$digest, .adopt_db_digest(con))
  expect_identical(partage$registry, .adopt_db_registry_digest(con))
  .adopt_db_begin_rollback(con)
  .adopt_db_reuse_artefacts(partage, ids = c("distribution_dpe", "part_passoires"))
  # The legitimate pre-registry binding (live token == live global scalar marker ==
  # the token the sortie recorded) is what the first guarded test adopts. Here the
  # live token is neither: nothing may rebind it silently.
  DBI::dbExecute(con, "ALTER TABLE profile_descriptor DISABLE TRIGGER USER")
  DBI::dbExecute(con, paste0("UPDATE profile_descriptor SET required_scalar_version='forged' ",
    "WHERE indicator_id='distribution_dpe'"))
  DBI::dbExecute(con, "ALTER TABLE profile_descriptor ENABLE TRIGGER USER")
  avant <- .adopt_db_digest(con)
  registre_avant <- .adopt_db_registry_digest(con)
  err <- tryCatch(executer_commande_publication(c("adopt", fixture$sortie),
    root = fixture$root, registre = fixture$lock, projections = fixture$projections,
    reference = fixture$reference, metadata_directory = fixture$metadata_directory,
    con = con, out = nullfile()), error = identity)
  expect_s3_class(err, "erreur_adoption")
  expect_match(conditionMessage(err), "distribution_dpe", fixed = TRUE)
  expect_match(conditionMessage(err), "dependance_divergente", fixed = TRUE)
  ligne <- err$comparaisons[err$comparaisons$ressource == "distribution_dpe", ]
  expect_identical(ligne$motif, "dependance_divergente")
  expect_identical(.adopt_db_digest(con), avant)
  expect_identical(.adopt_db_registry_digest(con), registre_avant)
})

test_that("guarded: an existing divergent marker refuses adopt (and --dry-run) with zero writes", {
  partage <- fixture_partage()
  con <- partage$con
  fixture <- partage$fixture
  expect_identical(partage$digest, .adopt_db_digest(con))
  expect_identical(partage$registry, .adopt_db_registry_digest(con))
  .adopt_db_begin_rollback(con)
  .adopt_db_reuse_artefacts(partage, ids = "densite")
  adopter <- function(...) executer_commande_publication(c("adopt", fixture$sortie, ...),
    root = fixture$root, registre = fixture$lock, projections = fixture$projections,
    reference = fixture$reference, metadata_directory = fixture$metadata_directory,
    con = con, out = nullfile())
  ref <- DBI::dbGetQuery(con, paste0("SELECT content_version FROM table_publication ",
    "WHERE table_name='territory_reference'"))[[1L]]
  jeton <- DBI::dbGetQuery(con,
    "SELECT content_version FROM scalar_comparison_publication WHERE singleton")[[1L]]
  # A divergent marker (another token) already exists for densite: refused, untouched.
  DBI::dbExecute(con, paste0("INSERT INTO scalar_resource_comparison_publication(indicator_id,",
    "content_version,scalar_content_version,reference_content_version,group_row_count,",
    "territory_row_count,lineage_row_count) VALUES('densite','autre-jeton','s',$1,1,1,1)"),
    params = list(ref))
  avant <- list(.adopt_db_digest(con), .adopt_db_registry_digest(con))
  for (args in list(character(), "--dry-run")) {
    err <- tryCatch(adopter(args), error = identity)
    if (length(args)) {
      # dry-run reports the refusal instead of raising, and still writes nothing
      expect_false(inherits(err, "error"))
    } else {
      expect_s3_class(err, "erreur_adoption")
      expect_match(conditionMessage(err), "marqueur_existant_divergent", fixed = TRUE)
    }
    expect_identical(list(.adopt_db_digest(con), .adopt_db_registry_digest(con)), avant)
  }
})
})