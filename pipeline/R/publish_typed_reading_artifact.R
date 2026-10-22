# Owner-scoped typed-reading serving grain. One owner is one theme reading;
# every generation is immutable and the small pointer is replaced only once the
# projection has been written and read back through the public reader. The
# transport is shared with the scalar, ordered-series and declared-profile
# grains (publish_typed_artifact.R); this file owns the reading family schema,
# the projection/assembly pair, and the one content-version rule per reading.
#
# The persisted projection is the projector's own output split into pieces: the
# selected reading facts plus the producer-owned pieces the projector carried as
# attributes (serving descriptor, source clock, source bindings, population
# provenance revision). The database publishers still consume the
# projector-shaped object, so assemble_typed_reading() rebuilds exactly the
# attributes the projector set — no more and no fewer. An extra attribute on the
# facts would change a database content version for unchanged facts.
#
# The reading facts themselves are stored without those attributes: they are
# persisted as their own typed fields, and the reading's serving identity is the
# projection, never the attribute envelope.
typed_reading_artifact_contracts <- function() {
  list(
    economie=list(table_fields=c("facts","source"), json_fields=character()),
    demographie=list(table_fields="facts", json_fields="descriptor"),
    habitat=list(table_fields=c("facts","vintage"), json_fields=character()),
    milieux=list(table_fields=c("facts","source_bindings","population_revisions"),
      json_fields=character()))
}

typed_reading_artifact_fields <- function(owner) {
  if (!is.character(owner) || length(owner)!=1L || is.na(owner) || !nzchar(owner))
    stop("Typed reading artifact owner is required",call.=FALSE)
  contract <- typed_reading_artifact_contracts()[[owner]]
  if (is.null(contract)) stop("Unknown typed-reading artifact owner: ",owner,call.=FALSE)
  contract
}

typed_reading_family <- "typed-reading"

# The transport's reader rebuilds every column from Parquet, which clears R's
# internal allocation flags; re-materialising each atomic vector reproduces
# exactly that canonical form. That rule belongs to the shared transport and is
# owned by the declared-profile family, which publishes it as
# materialize_profile_value(); the reading grain reuses it rather than
# reimplementing a second canonicalisation.
canonicalize_typed_reading_projection <- function(projection)
  restore_typed_value(materialize_profile_value(projection), typed_value_schema(projection))

# A missing source clock date is written as JSON null; the transport records no
# per-value NA payload for character vectors, so it must be decoded back to a
# length-one typed NA rather than dropped. An empty declared vector must stay
# character(0), which is why this is an explicit rule — the same one the
# declared-profile descriptor sidecar uses.
decode_typed_reading_json <- function(value, field) {
  if (identical(field,"descriptor")) return(restore_profile_descriptor_json(value))
  value
}

# The economy reading's source clock is the single vintage record the producer
# metadata declares for its activity source, the same expression the previous
# economy_reading_content_version() hashed. The producer-metadata term that
# function also hashed is deliberately not part of the serving grain: the
# metadata is re-validated when the reading is projected, it is not a fact of
# the published reading.
economy_reading_source <- function(metadata, vintages) {
  source_id <- metadata$sources$eco_activites
  source <- vintages[vintages$id==source_id,,drop=FALSE]
  if (nrow(source)!=1L)
    stop("Canonical vintage manifest has no unique economy source clock",call.=FALSE)
  source
}

# Split a projector's output into the persisted pieces of one reading.
typed_reading_projection <- function(reading, owner, metadata, vintages) {
  if (!is.data.frame(reading)) stop("Typed reading projection requires a selected reading",call.=FALSE)
  facts <- reading
  attributes(facts) <- attributes(reading)[c("names","row.names","class")]
  switch(owner,
    economie=list(facts=facts,source=economy_reading_source(metadata,vintages)),
    demographie=list(facts=facts,descriptor=list(rate_unit=attr(reading,"rate_unit"),
      source_clock=as.list(attr(reading,"source_clock")[1L,,drop=FALSE]))),
    habitat=list(facts=facts,vintage=attr(reading,"vintage")),
    milieux=list(facts=facts,source_bindings=attr(reading,"source_bindings"),
      population_revisions=attr(reading,"population_revisions")),
    stop("Unsupported typed-reading owner: ",owner,call.=FALSE))
}

# Rebuild the projector-shaped object the database publishers consume. A reading
# is published from the persisted pieces only: no theme Parquet is re-projected
# and no attribute is invented.
assemble_typed_reading <- function(projection, owner) {
  validate_typed_reading_projection(projection,owner)
  facts <- projection$facts
  switch(owner,
    economie=facts,
    demographie={
      attr(facts,"rate_unit") <- projection$descriptor$rate_unit
      attr(facts,"source_clock") <- as.data.frame(projection$descriptor$source_clock,
        stringsAsFactors=FALSE,optional=TRUE)
      facts
    },
    habitat={attr(facts,"vintage") <- projection$vintage; facts},
    milieux={
      attr(facts,"source_bindings") <- projection$source_bindings
      attr(facts,"population_revisions") <- projection$population_revisions
      facts
    },
    stop("Unsupported typed-reading owner: ",owner,call.=FALSE))
}

# One content-version rule per reading, and it is the serving identity of the
# persisted projection: each owner hashes exactly the pieces
# they persist. The Milieux database marker still hashes the source-absence
# declarations it derives at publication time; those are a database-time
# projection of the CONSOENAF snapshot, not part of this serving grain.
typed_reading_content_version <- function(projection, owner) {
  switch(owner,
    economie=scalar_content_version(list(facts=projection$facts,source=projection$source)),
    demographie=scalar_content_version(list(facts=projection$facts,descriptor=projection$descriptor)),
    habitat=scalar_content_version(list(facts=projection$facts,vintage=projection$vintage)),
    milieux=scalar_content_version(list(facts=projection$facts,
      source_bindings=projection$source_bindings,population_revisions=projection$population_revisions)),
    stop("Unsupported typed-reading owner: ",owner,call.=FALSE))
}

validate_typed_reading_projection <- function(projection, owner) {
  contract <- typed_reading_artifact_fields(owner)
  fields <- c(contract$table_fields,contract$json_fields)
  if (!is.list(projection) || !identical(sort(names(projection)),sort(fields)))
    stop("Typed reading projection does not declare the ",owner," artifact fields",call.=FALSE)
  facts <- projection$facts
  identity <- c("territory_id","territory_type","groupe")
  declared <- c("story_key","salience_reason","status","source_id","vintage_id")
  if (!is.data.frame(facts) || !all(c(identity,declared) %in% names(facts)) ||
      anyNA(facts[c(identity,declared)]) || anyDuplicated(facts[identity]))
    stop("Typed reading facts are not a valid selected reading for ",owner,call.=FALSE)
  switch(owner,
    economie={
      source <- projection$source
      if (!is.data.frame(source) || nrow(source)!=1L ||
          !all(c("id","source","version","date_reference","date_publication") %in% names(source)) ||
          anyNA(source[c("id","source","version")]) ||
          any(!nzchar(vapply(source[c("id","source","version")],function(value) as.character(value[[1L]]),character(1)))) ||
          any(facts$source_id!=as.character(source$id[[1L]])) ||
          any(facts$vintage_id!=paste(as.character(source$version[[1L]]),
            if (is.na(source$date_reference[[1L]])) "NA" else as.character(source$date_reference[[1L]]),sep="/")) ||
          any(!paste0("top",seq_len(5L),"_activity_code") %in% names(facts)))
        stop("Typed economy reading projection disagrees with its source clock",call.=FALSE)
    },
    demographie={
      descriptor <- projection$descriptor
      if (!is.list(descriptor))
        stop("Typed demographic reading artifact has an invalid persisted source clock; rematerialize it",call.=FALSE)
      rate_unit <- descriptor$rate_unit
      clock <- descriptor$source_clock
      clock_fields <- c("source_id","source_name","version","reference_date","publication_date","vintage_id")
      if (is.list(clock) && identical(names(clock),clock_fields) && is.data.frame(facts) &&
          all(c("source_id","vintage_id") %in% names(facts)) &&
          (any(facts$source_id!=clock$source_id) || any(facts$vintage_id!=clock$vintage_id) ||
           !identical(clock$vintage_id,paste(clock$version,clock$reference_date,sep="/"))))
        stop("Typed demographic reading disagrees with its canonical source clock",call.=FALSE)
      if (!identical(sort(names(descriptor)),sort(c("rate_unit","source_clock"))) ||
          !is.character(rate_unit) || length(rate_unit)!=1L || is.na(rate_unit) || !nzchar(rate_unit) ||
          !is.list(clock) || !identical(names(clock),clock_fields) ||
          any(vapply(clock,function(value) !is.character(value) || length(value)!=1L || is.na(value) || !nzchar(value),logical(1))) ||
          !all(c("periode","solde_naturel","solde_migratoire","taux_solde_naturel",
            "taux_solde_migratoire","classification") %in% names(facts)))
        stop("Typed demographic reading artifact has an invalid persisted source clock; rematerialize it",call.=FALSE)
    },
    habitat={
      vintage <- projection$vintage
      if (!is.data.frame(vintage) || nrow(vintage)!=1L ||
          !all(c("id","source","version","date_publication") %in% names(vintage)) ||
          anyNA(vintage[c("id","source","version","date_publication")]) ||
          any(facts$source_id!=as.character(vintage$id[[1L]])) ||
          any(facts$vintage_id!=paste(as.character(vintage$version[[1L]]),
            ifelse(is.na(vintage$date_reference[[1L]]),"NA",as.character(vintage$date_reference[[1L]])),sep="/")) ||
          !all(c("part_passoires","part_abc","n_dpe","classification") %in% names(facts)))
        stop("Typed Habitat reading projection disagrees with its DPE source clock",call.=FALSE)
    },
    milieux={
      bindings <- projection$source_bindings; revisions <- projection$population_revisions
      binding_fields <- c("territory_id","territory_type","groupe","field_key","source_id","vintage_id",
        "source_name","source_version","reference_date","publication_date","observation_period",
        "dataset_id","dataset_content_version","state_role","axis_value","provenance_revision_id",
        "population_revision_id")
      revision_fields <- c("population_revision_id","source_id","vintage_id","source_name","dataset_name",
        "source_version","reference_date","publication_date","revision_hash")
      if (!is.data.frame(bindings) || !all(binding_fields %in% names(bindings)) ||
          !is.data.frame(revisions) || nrow(revisions)!=1L || !all(revision_fields %in% names(revisions)) ||
          !all(c("periode_pop","periode_artif","delta_population","taux_variation_population",
            "artif_m2_par_habitant","artif_m3_par_habitant","trajectoire_artif_par_habitant",
            "classification") %in% names(facts)))
        stop("Typed Milieux reading projection is incomplete",call.=FALSE)
      population <- bindings[bindings$field_key=="population",,drop=FALSE]
      if (!nrow(population) ||
          any(population$population_revision_id!=revisions$population_revision_id[[1L]]) ||
          any(population$source_id!=revisions$source_id[[1L]]) ||
          any(population$vintage_id!=revisions$vintage_id[[1L]]) ||
          any(!paste(bindings$territory_id,bindings$territory_type,bindings$groupe) %in%
            paste(facts$territory_id,facts$territory_type,facts$groupe)))
        stop("Typed Milieux source bindings are detached from their stored revision or selected reading",call.=FALSE)
    },
    stop("Unsupported typed-reading owner: ",owner,call.=FALSE))
  invisible(projection)
}

typed_reading_version_fn <- function(owner) {
  force(owner)
  function(projection) typed_reading_content_version(projection,owner)
}

typed_reading_validator <- function(owner) {
  force(owner)
  function(projection) validate_typed_reading_projection(projection,owner)
}

write_typed_reading_artifact <- function(projection, directory, owner) {
  contract <- typed_reading_artifact_fields(owner)
  projection <- canonicalize_typed_reading_projection(projection)
  validate_typed_reading_projection(projection,owner)
  write_typed_artifact(projection, directory, typed_reading_family, owner,
    contract$table_fields, contract$json_fields, typed_reading_version_fn(owner),
    typed_reading_validator(owner), decode_typed_reading_json)
}

read_typed_reading_artifact <- function(directory, owner) {
  contract <- typed_reading_artifact_fields(owner)
  read_typed_artifact(directory, typed_reading_family, owner,
    contract$table_fields, contract$json_fields, typed_reading_version_fn(owner),
    typed_reading_validator(owner), decode_typed_reading_json)
}

# The production entry point for every reader: the immutable projection, the
# projector-shaped reading the database publishers consume, and the serving
# content version. A missing, stale, tampered or foreign-owner artifact fails
# closed inside the transport; there is no theme-Parquet fallback.
read_typed_reading_publication <- function(directory, owner) {
  projection <- read_typed_reading_artifact(directory, owner)
  list(projection=projection, reading=assemble_typed_reading(projection, owner),
    content_version=typed_reading_content_version(projection, owner))
}

typed_reading_artifact_directory <- function(sortie, owner)
  file.path(sortie,"typed-reading-serving",owner)

read_typed_reading_publication_from <- function(sortie, owner)
  read_typed_reading_publication(typed_reading_artifact_directory(sortie, owner), owner)

# The artifacts are already projected and validated; the identity projector
# exists only so a reading is published through the registered publisher and its
# transaction, never a second projection of the same facts.
register_typed_reading_artifact_publisher <- function(registry, name, publish) {
  register_typed_reading_publisher(registry, name, function(input) input$reading, publish)
}

publish_typed_reading_publication <- function(registry, owner, publication, con) {
  publish_registered_typed_reading(registry, owner,
    list(reading=publication$reading, content_version=publication$content_version), con)
}

# Materialize one theme reading from the in-memory payload, its validated
# metadata and the merged vintage universe. A theme without a reading
# materializes nothing.
materialize_theme_typed_reading_artifacts <- function(payload, metadata, vintages, theme, directory) {
  projection <- project_theme_typed_reading_artifact(payload, metadata, vintages, theme)
  if (is.null(projection)) return(invisible(NULL))
  write_typed_reading_artifact(projection, typed_reading_artifact_directory(directory, theme), theme)
}

project_theme_typed_reading_artifact <- function(payload, metadata, vintages, theme) {
  if (!theme %in% names(typed_reading_artifact_contracts())) return(NULL)
  if (!is.list(payload) || !is.data.frame(payload$histoires))
    stop("Current theme reading inputs are incomplete",call.=FALSE)
  histories <- payload$histoires
  reading <- switch(theme,
    economie=project_economy_reading(histories,vintages,metadata),
    demographie=project_demographic_reading(histories,payload$territoires,vintages,metadata),
    habitat=project_habitat_reading(histories,vintages,metadata),
    milieux=project_milieux_reading(histories,vintages,metadata,
      canonical=list(indicateurs=payload$indicateurs,histoires=histories)),
    stop("Unsupported typed-reading theme: ",theme,call.=FALSE))
  typed_reading_projection(reading, theme, metadata, vintages)
}
