# Projections relationnelles du service, dérivées des Parquet canoniques.
preparer_tables_service <- function(sortie = "public/data", metadata_path = NULL) {
  files <- c("territoires", "indicateurs_mobilite", "vintages",
             "rampe_acces_batiments", "distribution_acces_batiments")
  input <- stats::setNames(lapply(files, function(n) {
    p <- file.path(sortie, paste0(n, ".parquet"))
    if (!file.exists(p)) stop("Parquet canonique absent : ", p, call. = FALSE)
    nanoparquet::read_parquet(p)
  }), files)
  meta <- lire_theme_metadata("mobilite", chemin = metadata_path)
  abort <- function(...) stop(..., call. = FALSE)
  valid_text <- function(x) is.character(x) && length(x) == 1L && !is.na(x) && nzchar(trimws(x))
  scope <- meta$comparison_scopes$bretagne
  if (!is.list(scope) || !valid_text(scope$kind) || !valid_text(scope$label)) abort("Portée Bretagne absente ou invalide.")
  direction <- meta$building_comparison$direction
  if (!identical(meta$building_comparison$statistic, "mean") || !direction %in% c("high", "low")) abort("Métadonnées building_comparison invalides.")
  terr <- input$territoires; ind <- input$indicateurs_mobilite; vint <- input$vintages
  need <- function(d, cols, name) if (!all(cols %in% names(d))) abort(name, " : colonnes absentes ", paste(setdiff(cols, names(d)), collapse = ", "))
  need(terr, c("territoire","nom","departement","epci","classe_densite_code","classe_densite_libelle_public"), "territoires")
  need(ind, c("territoire","type","theme","key","value","unit","vintage_source","vintage_version","vintage_date_reference","vintage_date_publication"), "indicateurs_mobilite")
  need(vint, c("id","source","version","date_reference","date_publication"), "vintages")
  if (anyDuplicated(as.character(terr$territoire))) abort("Référentiel territorial dupliqué.")
  mob <- ind[ind$theme == "mobilite", , drop = FALSE]
  types <- split(as.character(mob$type), as.character(mob$territoire))
  if (any(vapply(types, function(z) length(unique(z)) != 1L, logical(1)))) abort("Type territorial Mobilité contradictoire.")
  typemap <- vapply(types, `[[`, character(1), 1L)
  ids <- as.character(terr$territoire)
  if (any(!ids %in% names(typemap))) abort("Type Mobilité absent pour une référence territoriale.")
  refs <- data.frame(territory_id=ids, territory_type=unname(typemap[ids]), name=as.character(terr$nom), department_id=as.character(terr$departement), epci_id=as.character(terr$epci), density_class_code=as.character(terr$classe_densite_code), density_class_label=as.character(terr$classe_densite_libelle_public), stringsAsFactors=FALSE)
  vint$id <- as.character(vint$id)
  if (anyDuplicated(vint$id)) abort("Identifiant de vintage dupliqué.")
  vmap <- stats::setNames(seq_len(nrow(vint)), vint$id)
  labels <- meta$indicator_labels; sources <- meta$sources; directions <- meta$indicator_directions
  if (!is.list(labels) || !is.list(sources) || !is.list(directions)) abort("Métadonnées d'indicateurs invalides.")
  declared <- unlist(lapply(meta$subgroups, `[[`, "indicators"), use.names=FALSE)
  share_keys <- declared[grepl("^share_", declared)]
  matches <- regexec("^share_([a-z0-9]+)_([tbc])$", share_keys)
  parts <- regmatches(share_keys, matches)
  if (!length(parts) || any(lengths(parts) != 3L)) abort("Clé share déclarée invalide.")
  services <- unique(vapply(parts, `[[`, character(1), 2L))
  for (s in services) if (!setequal(vapply(parts[vapply(parts, `[[`, character(1), 2L) == s], `[[`, character(1), 3L), c("t","b","c"))) abort("Triptyque de service incomplet : ", s)
  service_for_key <- stats::setNames(vapply(parts, `[[`, character(1), 2L), share_keys)
  mode_for_key <- stats::setNames(vapply(parts, `[[`, character(1), 3L), share_keys)
  rows <- mob[mob$key %in% share_keys, , drop=FALSE]
  # Une clé share mal formée est never silently ignored, même si absente des métadonnées.
  if (any(grepl("^share_", as.character(mob$key)) & !mob$key %in% share_keys)) abort("Clé share non déclarée ou mal formée.")
  if (nrow(rows) != length(ids) * length(share_keys) || anyDuplicated(rows[c("territoire","key")])) abort("Triptyques incomplets ou dupliqués.")
  if (!setequal(as.character(rows$territoire), ids)) abort("Territoires de service différents du référentiel.")
  if (any(!is.na(rows$value) & (!is.finite(rows$value) | rows$value < 0 | rows$value > 1)) || any(rows$unit != "%")) abort("Valeur/unit de part invalide.")
  service <- unname(service_for_key[rows$key]); modecode <- unname(mode_for_key[rows$key])
  source_ids <- vapply(rows$key, function(k) { z <- sources[[k]]; if (!valid_text(z)) abort("Source manquante pour ",k); z }, character(1))
  if (any(!source_ids %in% names(vmap))) abort("Vintage absent pour une source d'indicateur.")
  vi <- vint[vmap[source_ids], , drop=FALSE]
  if (any(as.character(rows$vintage_source) != as.character(vi$source)) || any(as.character(rows$vintage_version) != as.character(vi$version)) || any(as.character(rows$vintage_date_reference) != as.character(vi$date_reference)) || any(as.character(rows$vintage_date_publication) != as.character(vi$date_publication))) abort("Provenance d'indicateur incohérente avec le vintage.")
  labs <- vapply(rows$key, function(k) { z <- labels[[k]]; if (!valid_text(z)) abort("Libellé absent pour ",k); z }, character(1))
  dirs <- vapply(rows$key, function(k) { z <- directions[[k]]; if (!valid_text(z) || !z %in% c("high","low")) abort("Direction absente/invalide pour ",k); z }, character(1))
  access <- data.frame(territory_id=as.character(rows$territoire), service=service, mode=unname(c(t="walk_transit",b="bike",c="car")[modecode]), share=as.numeric(rows$value), indicator_label=labs, effective_direction=dirs, source_id=source_ids, source_name=as.character(vi$source), source_version=as.character(vi$version), reference_date=as.character(vi$date_reference), source_publication_date=as.character(vi$date_publication), stringsAsFactors=FALSE)
  access$reference_date[is.na(vi$date_reference)] <- NA_character_; access$source_publication_date[is.na(vi$date_publication)] <- NA_character_
  access$territory_type <- unname(typemap[access$territory_id])
  registry <- data.frame(service=sort(services), stringsAsFactors=FALSE)

  ramp0 <- input$rampe_acces_batiments; grid0 <- input$distribution_acces_batiments
  # Required contract validators also validate explicit absent sentinels and complete rows.
  verifier_contrat_rampe_acces_batiments(ramp0); verifier_contrat_distribution_acces_batiments(grid0)
  # Keep canonical aggregates for every supported territory level alongside
  # commune facts: consumers can compute weighted peer results from communes,
  # while focal EPCI/departement/region rows remain directly addressable.
  expected_building <- refs[refs$territory_type %in% c("commune", "epci", "departement", "region"),
                            c("territory_id", "territory_type"), drop=FALSE]
  expected_key <- paste(expected_building$territory_type, expected_building$territory_id, sep="::")
  ramp <- ramp0; grid <- grid0
  ramp_key <- unique(paste(as.character(ramp$type), as.character(ramp$territoire), sep="::"))
  grid_key <- unique(paste(as.character(grid$type), as.character(grid$territoire), sep="::"))
  if (!setequal(ramp_key, expected_key) || !setequal(grid_key, expected_key)) abort("Faits bâtimentiers incomplets ou hors référentiel.")
  # An absent group is exactly one sentinel; complete groups contain 11/30 rows;
  # incomplete groups are rejected because the serving contract is all-or-nothing.
  rg <- split(ramp, paste(ramp$type,ramp$territoire,ramp$mode,sep="::"))
  for (g in rg) {
    state <- unique(g$availability)
    if (length(state)!=1L || state=="incomplete" ||
        !(state=="absent" && nrow(g)==1L) && !(state=="complete" && nrow(g)==11L)) abort("Rampe communale incomplète/invalide.")
  }
  gg <- split(grid, paste(grid$type,grid$territoire,sep="::"))
  for (g in gg) {
    state <- unique(g$availability)
    if (length(state)!=1L || state=="incomplete" ||
        !(state=="absent" && nrow(g)==1L) && !(state=="complete" && nrow(g)==30L)) abort("Grille communale incomplète/invalide.")
  }
  ramp_support <- tapply(ramp$total_buildings, paste(ramp$type,ramp$territoire,sep="::"), function(z) unique(z))
  grid_support <- tapply(grid$total_buildings, paste(grid$type,grid$territoire,sep="::"), function(z) unique(z))
  if (!identical(unname(ramp_support[sort(expected_key)]), unname(grid_support[sort(expected_key)]))) abort("Dénominateurs bâtimentiers divergents.")
  check_prov <- function(d) {
    if (any(!d$source_id %in% names(vmap))) abort("Vintage bâtimentier absent.")
    v <- vint[vmap[as.character(d$source_id)],,drop=FALSE]
    if (any(as.character(d$version)!=as.character(v$version)) || any(as.character(d$source)!=as.character(v$source)) || any(as.character(d$date_reference)!=as.character(v$date_reference)) || any(as.character(d$date_publication)!=as.character(v$date_publication))) abort("Provenance bâtimentière incohérente.")
  }
  check_prov(ramp); check_prov(grid)
  building_sources <- unique(rbind(
    data.frame(source_id=as.character(ramp$source_id), source_name=as.character(ramp$source),
      vintage_id=as.character(ramp$version), reference_date=as.character(ramp$date_reference),
      publication_date=as.character(ramp$date_publication), stringsAsFactors=FALSE),
    data.frame(source_id=as.character(grid$source_id), source_name=as.character(grid$source),
      vintage_id=as.character(grid$version), reference_date=as.character(grid$date_reference),
      publication_date=as.character(grid$date_publication), stringsAsFactors=FALSE)
  ))
  ramp <- ramp[order(ramp$type,ramp$territoire,ramp$mode,ramp$quantile,na.last=TRUE),,drop=FALSE]
  ramp$quantile_index <- ifelse(is.na(ramp$quantile), -1L, as.integer(round(ramp$quantile*10)))
  grid <- grid[order(grid$type,grid$territoire,grid$breadth_bucket,grid$depth_bucket,na.last=TRUE),,drop=FALSE]
  grid$cell_index <- ave(seq_len(nrow(grid)), interaction(grid$type,grid$territoire, drop=TRUE), FUN=function(i) seq_along(i)-1L)
  grid$cell_index[grid$availability=="absent"] <- -1L
  ramp_table <- data.frame(territory_id=as.character(ramp$territoire),territory_type=as.character(ramp$type),availability=as.character(ramp$availability),mode=as.character(ramp$mode),quantile_index=ramp$quantile_index,quantile=as.numeric(ramp$quantile),accessible_types=as.numeric(ramp$accessible_types),total_buildings=as.integer(ramp$total_buildings),source_id=as.character(ramp$source_id),source_version=as.character(ramp$version),effective_direction=direction,stringsAsFactors=FALSE)
  grid_table <- data.frame(territory_id=as.character(grid$territoire),territory_type=as.character(grid$type),availability=as.character(grid$availability),mode=as.character(grid$mode),cell_index=as.integer(grid$cell_index),breadth_bucket=as.character(grid$breadth_bucket),depth_bucket=as.character(grid$depth_bucket),building_count=as.integer(grid$building_count),total_buildings=as.integer(grid$total_buildings),source_id=as.character(grid$source_id),source_version=as.character(grid$version),stringsAsFactors=FALSE)
  # Per-commune complete grids must recombine their declared denominator.
  complete <- grid_table[grid_table$availability=="complete",]
  sums <- tapply(complete$building_count, complete$territory_id, sum)
  complete_key <- paste(complete$territory_type, complete$territory_id, sep="::")
  sums <- tapply(complete$building_count, complete_key, sum)
  denoms <- tapply(complete$total_buildings, complete_key, unique)
  if (any(sums != denoms[names(sums)])) abort("Cellules de grille ne recomposent pas le total.")
  tables <- list(territory_reference=refs[c("territory_id","territory_type","name","department_id","epci_id","density_class_code","density_class_label")], service_registry=registry, essential_service_access=access[c("territory_id","service","mode","share","indicator_label","effective_direction","source_id","source_name","source_version","reference_date","source_publication_date")], building_ramp=ramp_table, building_grid=grid_table)
  # The physical tables remain dedicated evidence grains. Their descriptors
  # are versioned with their own facts so a change to axis/weighting semantics
  # cannot leave an apparently current marker behind.
  building_contract <- contrat_publication_batiments(meta$building_comparison)
  for (n in names(building_contract)) {
    source_ids <- unique(as.character(tables[[n]]$source_id))
    provenance <- building_sources[building_sources$source_id %in% source_ids, , drop=FALSE]
    provenance <- provenance[order(provenance$source_id, provenance$vintage_id), , drop=FALSE]
    rownames(provenance) <- NULL
    building_contract[[n]]$provenance <- provenance
  }
  versions <- versions_tables_service(tables, scope, building_contract)
  list(tables=tables, versions=versions, access_scope=scope,
       building_contract=building_contract, building_sources=building_sources)
}

contrat_publication_batiments <- function(comparison) {
  if (!identical(comparison$statistic, "mean") ||
      !comparison$direction %in% c("high", "low")) {
    stop("M\u00e9tadonn\u00e9es building_comparison invalides.", call. = FALSE)
  }
  list(
    building_ramp = list(
      shape = "building_ramp", modes = as.character(RAMPE_ACCES_BATIMENTS_MODES$mode),
      positions = as.numeric(RAMPE_ACCES_BATIMENTS_QUANTILES),
      territory_levels = c("commune", "epci", "departement", "region"),
      axes = list(mode = as.character(RAMPE_ACCES_BATIMENTS_MODES$mode),
                  quantile = as.numeric(RAMPE_ACCES_BATIMENTS_QUANTILES)),
      denominator = "total_buildings", peer_statistic = "building_count_weighted_mean",
      absent = "explicit_absent_sentinel", direction = comparison$direction
    ),
    building_grid = list(
      shape = "building_grid", mode = DISTRIBUTION_ACCES_BATIMENTS_MODE,
      breadth_bins = DISTRIBUTION_ACCES_BATIMENTS_BREADTH_BINS$key,
      depth_bins = DISTRIBUTION_ACCES_BATIMENTS_DEPTH_BINS$key,
      territory_levels = c("commune", "epci", "departement", "region"),
      axes = list(mode = DISTRIBUTION_ACCES_BATIMENTS_MODE,
                  breadth = DISTRIBUTION_ACCES_BATIMENTS_BREADTH_BINS$key,
                  depth = DISTRIBUTION_ACCES_BATIMENTS_DEPTH_BINS$key),
      denominator = "total_buildings", peer_statistic = "pooled_building_counts",
      absent = "explicit_absent_sentinel"
    )
  )
}

versions_tables_service <- function(tables, access_scope, building_comparison) {
  hash <- function(d, extra=NULL) {
    d <- d[do.call(order,c(unname(d),list(na.last=TRUE))),,drop=FALSE]
    rownames(d) <- NULL
    paste(as.character(openssl::sha256(serialize(list(d,extra),NULL))),collapse="")
  }
  vapply(names(tables), function(n) hash(tables[[n]],
    if(n=="essential_service_access") access_scope else
      if(n %in% c("building_ramp", "building_grid")) building_comparison[[n]] else NULL), character(1))
}
