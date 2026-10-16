# Dense declared-detail profile projection. Descriptor axes are sourced only
# from indicator_pages metadata; canonical rows may not extend or reorder them.
# Fixed-context comparison coverage is deliberately an inventory, separate
# from rendering/publishing mechanics. Keep it aligned with ADR-0039; the
# contract test guards against dropping a family as its implementation evolves.
# ADR-0039 comparison families represented by this constrained publisher set.
ADR0039_COMPARISON_FAMILIES <- c(
  "declared_profile", "numeric_period_collection",
  "numeric_detail_collection", "scalar", "ordered_series", "aedar_fixed"
)

serving_publication_target_names <- function(profile_opt_in = identical(Sys.getenv("LUSK_PUBLISH_PROFILE", unset=""), "1")) {
  targets <- "publie_tables_service"
  if (isTRUE(profile_opt_in)) c(targets, "publie_profiles_declares") else targets
}

# Profiles compare their declared facet (or, for the DPE scalar-backed facet,
# the scalar publication itself). The statistic and rank semantics intentionally
# match the established scalar publication contract: median and competition rank.
project_declared_profile_comparisons <- function(profiles, territory_reference,
    profile_content_version, reference_content_version, scalar_comparisons = NULL) {
  if (!is.list(profiles) || !length(profiles) ||
      any(!vapply(profiles, function(p) is.list(p) && !is.null(p$descriptor), logical(1))))
    stop("Declared profile comparison projections are required", call.=FALSE)
  group_rows <- list(); territory_rows <- list(); lineage_rows <- list()
  for (profile in profiles) {
    d <- profile$descriptor
    id <- d$indicator_id
    detail <- d$comparison_detail
    sex <- d$comparison_sex
    # The projection is selected by the producer contract, not by a second
    # domain-ID inventory: only descriptors that declare a comparison facet
    # are comparable profiles.
    if (is.null(d$comparison_direction) || is.null(d$comparison_detail) ||
        length(d$comparison_detail) != 1L || is.na(d$comparison_detail) ||
        !nzchar(d$comparison_detail)) next
    # DPE's declared comparison is exactly the scalar facet. It is deliberately
    # not copied into profile comparison storage; publication/API consume the
    # shared scalar comparison tables by this descriptor reference.
    if (!is.null(d$comparison_scalar)) {
      next
    }
    if (!d$comparison_direction %in% c("high", "low")) stop("Invalid declared profile comparison direction", call.=FALSE)
    facts <- profile$facts[profile$facts$detail == detail & profile$facts$sex == ifelse(is.na(sex), "", sex),,drop=FALSE]
    if (!nrow(facts)) stop(sprintf("Declared profile comparison facet is empty: %s", id),call.=FALSE)
    membership <- comparison_context_membership(territory_reference, d$levels)
    for (i in seq_len(nrow(membership))) {
      g <- membership[i,,drop=FALSE]
      type <- as.character(g$territory_type)
      if (!type %in% d$levels) next
      ids <- g$member_ids[[1L]]
      selected <- facts[facts$territory_type == type & facts$territory_id %in% ids,,drop=FALSE]
      if (anyDuplicated(selected$territory_id) || !setequal(selected$territory_id, ids))
        stop("Profile comparison membership differs from declared territory facts", call.=FALSE)
      selected <- selected[match(ids, selected$territory_id),,drop=FALSE]
      provenance <- profile$provenance
      lineage_source_count <- 0L
      if (is.data.frame(provenance)) {
        provenance <- provenance[provenance$indicator_id == id & provenance$territory_id %in% ids &
          provenance$detail_key == detail & provenance$sex_key == ifelse(is.na(sex),"",sex),,drop=FALSE]
        if (nrow(provenance)) {
          provenance <- unique(provenance[c("source_id","vintage_id")])
          lineage_source_count <- nrow(provenance)
          lineage_rows[[length(lineage_rows)+1L]] <- data.frame(
          comparison_context=as.character(g$comparison_context),group_id=as.character(g$group_id),
          territory_type=type,facet_id=id,source_id=as.character(provenance$source_id),
          vintage_id=as.character(provenance$vintage_id),stringsAsFactors=FALSE)
        }
      }
      selected$status[is.na(selected$status)] <- "not_published"
      if (any(!selected$status %in% c("measured", "suppressed", "unsupported", "not_available", "not_published")))
        stop("Invalid profile comparison availability state", call.=FALSE)
      if (any(selected$status == "measured" & is.na(selected$value)))
        stop("Measured profile comparison facts must have values", call.=FALSE)
      ok <- selected$status == "measured" & !is.na(selected$value)
      vals <- selected$value[ok]
      ranks <- rep(NA_integer_,length(ids)); ties <- ranks; sizes <- ranks
      for (j in which(ok)) {
        ranks[j] <- 1L + sum(if (d$comparison_direction == "high") vals > selected$value[j] else vals < selected$value[j])
        ties[j] <- sum(vals == selected$value[j]); sizes[j] <- length(vals)
      }
      key <- data.frame(comparison_context=as.character(g$comparison_context),
        group_id=as.character(g$group_id), territory_type=type, indicator_id=id,
        detail_key=detail, sex_key=ifelse(is.na(sex),"",sex), stringsAsFactors=FALSE)
      group_rows[[length(group_rows)+1L]] <- cbind(key,
        statistic="median", median=if(length(vals)) stats::median(vals) else NA_real_,
        member_count=length(ids), eligible_count=length(vals), missing_count=length(ids)-length(vals),
        lineage_source_count=lineage_source_count,
        profile_content_version=profile_content_version, reference_content_version=reference_content_version)
      territory_rows[[length(territory_rows)+1L]] <- cbind(key,
        territory_id=ids, value=selected$value, status=selected$status, rank=ranks,
        tie_count=ties, rank_size=sizes, profile_content_version=profile_content_version,
        reference_content_version=reference_content_version)
    }
  }
  groups <- if(length(group_rows)) do.call(rbind,group_rows) else data.frame()
  territories <- if(length(territory_rows)) do.call(rbind,territory_rows) else data.frame()
  if (nrow(groups)) {
    groups <- groups[order(groups$comparison_context, groups$group_id, groups$territory_type, groups$indicator_id, groups$detail_key, groups$sex_key),,drop=FALSE]
    territories <- territories[order(territories$comparison_context, territories$group_id, territories$territory_type, territories$indicator_id, territories$detail_key, territories$sex_key, territories$territory_id),,drop=FALSE]
  }
  lineage <- if(length(lineage_rows)) do.call(rbind,lineage_rows) else data.frame(
    comparison_context=character(),group_id=character(),territory_type=character(),facet_id=character(),
    source_id=character(),vintage_id=character(),stringsAsFactors=FALSE)
  if(nrow(lineage)) lineage <- unique(lineage[order(lineage$comparison_context,lineage$group_id,
    lineage$territory_type,lineage$facet_id,lineage$source_id,lineage$vintage_id),,drop=FALSE])
  list(groups=groups, territories=territories, lineage=lineage,
       profile_content_version=profile_content_version,
       reference_content_version=reference_content_version)
}

write_profile_comparison_parquets <- function(projection, directory,
    write_fn = nanoparquet::write_parquet, rename_fn = file.rename) {
  if (!is.list(projection) || !all(c("groups", "territories") %in% names(projection)) ||
      !is.data.frame(projection$groups) || !is.data.frame(projection$territories))
    stop("Invalid profile comparison projection", call.=FALSE)
  if (!requireNamespace("nanoparquet", quietly=TRUE)) stop("nanoparquet is required", call.=FALSE)
  dir.create(directory, recursive=TRUE, showWarnings=FALSE)
  version <- profile_content_version(projection)
  generation <- file.path(directory, paste0("profile-comparison-", version))
  targets <- file.path(generation, c("groups.parquet", "territories.parquet", "lineage.parquet"))
  dir.create(generation, recursive=TRUE, showWarnings=FALSE)
  lineage <- projection$lineage
  if (is.null(lineage)) lineage <- data.frame(comparison_context=character(),group_id=character(),
    territory_type=character(),facet_id=character(),source_id=character(),vintage_id=character())
  expected <- list(projection$groups, projection$territories, lineage)
  present <- file.exists(targets)
  for (i in which(present)) {
    existing <- tryCatch(nanoparquet::read_parquet(targets[i]), error=function(e) NULL)
    if (is.null(existing) || !isTRUE(all.equal(existing, expected[[i]], check.attributes=FALSE)))
      stop("Existing profile comparison generation does not match its content version", call.=FALSE)
  }
  if (all(present)) return(invisible(targets))
  staged <- vapply(targets, function(p) tempfile("profile-comparison-", dirname(p), fileext=".parquet"), character(1))
  on.exit(unlink(staged[file.exists(staged)]), add=TRUE)
  for (i in which(!present)) write_fn(expected[[i]], staged[i])
  for (i in which(!present)) {
    checked <- nanoparquet::read_parquet(staged[i])
    if (!isTRUE(all.equal(checked, expected[[i]], check.attributes=FALSE)))
      stop("Staged profile comparison artifact validation failed", call.=FALSE)
    if (!rename_fn(staged[i], targets[i])) stop("Could not install profile comparison artifacts", call.=FALSE)
  }
  invisible(targets)
}

validate_declared_profile <- function(facts, descriptor, axes, eligible_territories = NULL) {
  required <- c("territory_id", "territory_type", "detail", "sex", "value", "status")
  if (!is.data.frame(facts) || !setequal(names(facts), required) ||
      !is.data.frame(axes) || !all(c("axis_name", "axis_key", "label", "ordinal") %in% names(axes)) ||
      any(!names(axes) %in% c("axis_name", "axis_key", "label", "ordinal", "unit")))
    stop("Profile projection has invalid contract columns", call. = FALSE)
  if (anyNA(facts[c("territory_id", "territory_type", "detail", "sex", "status")]) ||
      any(!facts$territory_type %in% descriptor$levels) || any(!facts$status %in% c("measured", "not_available", "suppressed", "unsupported")) ||
      any((facts$status == "measured") != !is.na(facts$value)) || any(!is.na(facts$value) & !is.finite(facts$value)))
    stop("Invalid profile identity, level, value or status", call. = FALSE)
  details <- axes[axes$axis_name == "detail", , drop = FALSE]
  sexes <- axes[axes$axis_name == "sex", , drop = FALSE]
  if (!setequal(unique(axes$axis_name), c("detail", if (length(descriptor$sexes)) "sex")) ||
      !identical(as.character(details$axis_key), as.character(descriptor$details)) ||
      !identical(as.character(sexes$axis_key), as.character(descriptor$sexes)) ||
      !identical(as.integer(details$ordinal), seq_along(descriptor$details) - 1L) ||
      !identical(as.integer(sexes$ordinal), seq_along(descriptor$sexes) - 1L) ||
      anyDuplicated(axes[c("axis_name", "axis_key")]) || anyDuplicated(axes[c("axis_name", "ordinal")]))
    stop("Profile axes differ from declared metadata", call. = FALSE)
  if (!"unit" %in% names(details) || anyNA(details$unit) || any(!nzchar(details$unit)))
    stop("Profile detail units must be declared", call.=FALSE)
  scalar_facet <- !is.null(descriptor$comparison_scalar)
  if ((!scalar_facet && (length(descriptor$comparison_detail) != 1L || is.na(descriptor$comparison_detail) ||
      !descriptor$comparison_detail %in% details$axis_key ||
      (length(descriptor$sexes) && (length(descriptor$comparison_sex) != 1L || is.na(descriptor$comparison_sex) ||
       !descriptor$comparison_sex %in% sexes$axis_key)) ||
      (!length(descriptor$sexes) && !is.na(descriptor$comparison_sex)))) ||
      (scalar_facet && (!is.na(descriptor$comparison_detail) || !is.na(descriptor$comparison_sex) ||
        !grepl("^[a-z][a-z0-9_]{0,95}$", descriptor$comparison_scalar) ||
        length(descriptor$required_scalar_version) != 1L || is.na(descriptor$required_scalar_version) ||
        !nzchar(descriptor$required_scalar_version))) ||
      length(descriptor$comparison_direction) != 1L ||
      !descriptor$comparison_direction %in% c("high", "low"))
    stop("Profile comparison facet differs from declared axes or direction", call. = FALSE)
  key <- paste(facts$territory_type, facts$territory_id, facts$detail, facts$sex, sep = "\r")
  if (anyDuplicated(key)) stop("Duplicate profile coordinate", call. = FALSE)
  if (any(!facts$detail %in% descriptor$details) || any(!facts$sex %in% if (length(descriptor$sexes)) descriptor$sexes else ""))
    stop("Undeclared profile coordinate", call. = FALSE)
  universe <- unique(paste(facts$territory_type, facts$territory_id, sep = "\r"))
  if (!is.null(eligible_territories)) {
    if (!is.data.frame(eligible_territories) ||
        !all(c("territory_id", "territory_type") %in% names(eligible_territories)) ||
        anyDuplicated(eligible_territories[c("territory_id", "territory_type")]) ||
        any(!eligible_territories$territory_type %in% descriptor$levels))
      stop("Invalid profile eligible territory universe", call. = FALSE)
    required <- paste(eligible_territories$territory_type, eligible_territories$territory_id, sep = "\r")
    if (!setequal(required, universe)) stop("Dense profile does not cover eligible territories", call. = FALSE)
  }
  for (territory in universe) {
    rows <- facts[paste(facts$territory_type, facts$territory_id, sep = "\r") == territory, , drop = FALSE]
    expected <- expand.grid(detail = descriptor$details, sex = if (length(descriptor$sexes)) descriptor$sexes else "", stringsAsFactors = FALSE)
    if (!setequal(paste(rows$detail, rows$sex), paste(expected$detail, expected$sex)))
      stop("Dense profile has missing coordinates", call. = FALSE)
  }
  invisible(facts)
}

# The declared-profile provenance contract is shared by the database publisher
# and the offline serving artifact: every dense fact coordinate resolves to
# exactly one declared source/vintage association, no more and no less.
validate_profile_provenance <- function(profile) {
  provenance <- profile$provenance
  provenance_fields <- c("indicator_id", "territory_id", "detail_key", "sex_key", "source_id", "vintage_id")
  fact_keys <- paste(profile$descriptor$indicator_id, profile$facts$territory_id, profile$facts$detail,
    profile$facts$sex, sep="\r")
  provenance_keys <- if (is.data.frame(provenance) && all(provenance_fields %in% names(provenance)))
    paste(provenance$indicator_id, provenance$territory_id, provenance$detail_key, provenance$sex_key, sep="\r") else character()
  if (!is.data.frame(provenance) || !setequal(names(provenance), provenance_fields) ||
      anyNA(provenance[provenance_fields]) || anyDuplicated(provenance[provenance_fields]) ||
      any(!provenance$source_id %in% profile$descriptor$source) ||
      !setequal(fact_keys, provenance_keys) ||
      any(!paste(provenance$source_id, provenance$vintage_id) %in%
          paste(profile$vintages$source_id, profile$vintages$vintage_id)) ||
      any(!provenance$source_id %in% profile$datasets$source_id))
    stop("Invalid or incomplete profile provenance associations", call.=FALSE)
  invisible(profile)
}

project_structure_age_profile <- function(indicateurs, metadata, territoires = NULL) {
  if (is.list(indicateurs) && !is.data.frame(indicateurs)) {
    territoires <- indicateurs$territoires
    indicateurs <- indicateurs$indicateurs
  }
  page <- metadata$indicator_pages$structure_age
  if (is.null(page) || !identical(unlist(page$pyramid$dimensions), c("detail", "sex")))
    stop("structure_age profile descriptor is not declared", call. = FALSE)
  details <- unlist(page$comparison$details, use.names = FALSE)
  sexes <- unlist(page$comparison$sexes, use.names = FALSE)
  labels <- unlist(metadata$detail_labels$structure_age, use.names = TRUE)
  if (!setequal(names(labels), details)) stop("structure_age detail labels mismatch", call. = FALSE)
  axes <- rbind(
    data.frame(axis_name = "detail", axis_key = details, label = unname(labels[details]), ordinal = seq_along(details) - 1L, unit=page$unit),
    data.frame(axis_name = "sex", axis_key = sexes, label = sexes, ordinal = seq_along(sexes) - 1L, unit=page$unit)
  )
  facts <- indicateurs[indicateurs$key == "structure_age" & indicateurs$type %in% unlist(page$levels), , drop = FALSE]
  projected <- data.frame(territory_id = facts$territoire, territory_type = facts$type,
    detail = facts$detail, sex = facts$sex, value = facts$value,
    # The canonical structure_age contract is a numeric value or NA only:
    # indicator_structure_age() computes effectif/population and carries no
    # suppression/unsupported reason. NA therefore has the declared
    # not_available meaning; do not infer finer-grained status distinctions.
    status = ifelse(is.na(facts$value), "not_available", "measured"), stringsAsFactors = FALSE)
  descriptor <- list(indicator_id = page$indicator, theme_id = metadata$theme,
    levels = unlist(page$levels), details = details, sexes = sexes,
    label = page$label, unit = page$unit, source = unlist(page$sources),
    comparison_detail = page$comparison$detail,
    comparison_sex = page$comparison$sex,
    comparison_direction = page$direction, completeness = "dense_complete")
  eligible <- NULL
  if (!is.null(territoires)) eligible <- unique(data.frame(
    territory_id = territoires$territoire[territoires$type %in% descriptor$levels],
    territory_type = territoires$type[territoires$type %in% descriptor$levels],
    stringsAsFactors = FALSE))
  validate_declared_profile(projected, descriptor, axes, eligible)
  if (!all(c("vintage_source", "vintage_version", "vintage_date_reference", "vintage_date_publication") %in% names(facts)))
    stop("Canonical structure_age facts have no source vintage fields", call. = FALSE)
  source_id <- descriptor$source[[1L]]
  version <- as.character(facts$vintage_version)
  vintage_id <- paste(version, facts$vintage_date_reference, sep = "/")
  provenance <- unique(data.frame(indicator_id = "structure_age", territory_id = projected$territory_id,
    detail_key = projected$detail, sex_key = projected$sex, source_id = source_id,
    vintage_id = paste(as.character(facts$vintage_version), facts$vintage_date_reference, sep = "/"),
    stringsAsFactors = FALSE))
  vintages <- unique(data.frame(source_id = source_id, vintage_id = vintage_id, version = version,
    reference_date = as.Date(facts$vintage_date_reference),
    publication_date = as.Date(facts$vintage_date_publication), stringsAsFactors = FALSE))
  datasets <- data.frame(source_id = source_id,
    name = unique(as.character(facts$vintage_source))[[1L]], stringsAsFactors = FALSE)
  if (length(unique(as.character(facts$vintage_source))) != 1L)
    stop("structure_age source identity maps to conflicting source names", call. = FALSE)
  descriptor$descriptor_version <- profile_content_version(list(descriptor, axes))
  list(facts = projected, axes = axes, descriptor = descriptor, provenance = provenance,
    vintages = vintages, datasets = datasets, eligible_territories = eligible)
}

project_dpe_profile <- function(canonical, metadata, scalar_version) {
  page <- metadata$indicator_pages$distribution_dpe
  policy <- metadata$profile_contracts$distribution_dpe
  if (is.null(page) || is.null(policy) || !identical(policy$completeness, "dense_complete") ||
      is.null(page$comparison$indicator) || is.null(page$distribution$signature) ||
      length(scalar_version) != 1L || is.na(scalar_version) || !nzchar(scalar_version))
    stop("DPE profile and scalar dependency must be declared", call.=FALSE)
  rows <- canonical$indicateurs
  territories <- canonical$territoires
  details <- unlist(page$distribution$signature, use.names=FALSE)
  labels <- unlist(metadata$detail_labels[[page$indicator]], use.names=TRUE)
  source_ids <- unlist(page$sources, use.names=FALSE)
  if (!setequal(names(labels), details) || length(source_ids) != 1L)
    stop("DPE axes or source identity is not declared", call.=FALSE)
  rows <- rows[rows$key == page$indicator & rows$type %in% unlist(page$levels), , drop=FALSE]
  if (!nrow(rows) || any(!is.na(rows$sex)) || any(rows$unit != page$unit) ||
      !all(c("vintage_source","vintage_version","vintage_date_reference","vintage_date_publication") %in% names(rows)))
    stop("Canonical DPE facts do not match declared one-axis profile", call.=FALSE)
  if (!policy$support_count_field %in% names(rows)) stop("DPE support field is missing", call.=FALSE)
  support <- rows[[policy$support_count_field]]
  status <- ifelse(is.na(rows$value), policy$missing_status, "measured")
  status[!is.na(support) & support > 0 & support < policy$suppressed_below] <- "suppressed"
  status[!is.na(support) & support == 0] <- policy$zero_support_status
  facts <- data.frame(territory_id=rows$territoire, territory_type=rows$type, detail=rows$detail,
    sex="", value=rows$value, status=status, stringsAsFactors=FALSE)
  axes <- data.frame(axis_name="detail", axis_key=details, label=unname(labels[details]), ordinal=seq_along(details)-1L, unit=page$unit)
  descriptor <- list(indicator_id=page$indicator, theme_id=metadata$theme, levels=unlist(page$levels),
    details=details, sexes=character(), label=page$label, unit=page$unit, source=source_ids,
    comparison_detail=NA_character_, comparison_sex=NA_character_, comparison_direction=page$comparison$direction,
    comparison_scalar=page$comparison$indicator, required_scalar_version=scalar_version,
    completeness=policy$completeness)
  eligible <- unique(data.frame(territory_id=territories$territoire[territories$type %in% descriptor$levels],
    territory_type=territories$type[territories$type %in% descriptor$levels], stringsAsFactors=FALSE))
  validate_declared_profile(facts, descriptor, axes, eligible)
  vintage_ids <- paste(rows$vintage_version, rows$vintage_date_reference, sep="/")
  datasets <- unique(data.frame(source_id=source_ids, name=rows$vintage_source, stringsAsFactors=FALSE))
  if (nrow(datasets) != 1L) stop("DPE source maps to conflicting names", call.=FALSE)
  vintages <- unique(data.frame(source_id=source_ids, vintage_id=vintage_ids, version=rows$vintage_version,
    reference_date=as.Date(rows$vintage_date_reference), publication_date=as.Date(rows$vintage_date_publication)))
  provenance <- data.frame(indicator_id=page$indicator, territory_id=facts$territory_id,
    detail_key=facts$detail, sex_key=facts$sex, source_id=source_ids, vintage_id=vintage_ids)
  descriptor$descriptor_version <- profile_content_version(list(descriptor, axes, policy))
  list(facts=facts, axes=axes, descriptor=descriptor, provenance=provenance, vintages=vintages,
       datasets=datasets, eligible_territories=eligible)
}

# Project a closed metadata-declared list/composition profile from canonical
# indicator rows. No values or source decisions are calculated here.
project_declared_detail_profile <- function(canonical, metadata, indicator, source_vintages = canonical$source_vintages) {
  page <- metadata$indicator_pages[[indicator]]
  contract <- metadata$profile_contracts[[indicator]]
  rows <- canonical$indicateurs
  if (is.null(page) || is.null(contract) || is.null(contract$detail_units) ||
      !identical(contract$completeness, "dense_complete") || !is.character(contract$denominator_semantics) ||
      length(contract$denominator_semantics) != 1L || is.na(contract$denominator_semantics) ||
      !nzchar(contract$denominator_semantics))
    stop("Mobility profile contract is incomplete", call.=FALSE)
  details <- unlist(page$comparison$details, use.names=FALSE)
  labels <- unlist(metadata$detail_labels[[indicator]], use.names=TRUE)
  units <- unlist(contract$detail_units, use.names=TRUE)
  sources <- unlist(page$sources, use.names=FALSE)
  if (!identical(names(labels), details) || !identical(names(units), details) ||
      !setequal(names(units), details) || !length(sources))
    stop("Mobility profile axes, units or source are undeclared", call.=FALSE)
  levels <- if (!is.null(contract$allowed_levels)) unlist(contract$allowed_levels, use.names=FALSE) else unlist(page$levels, use.names=FALSE)
  rows <- rows[rows$key == indicator & rows$type %in% levels,,drop=FALSE]
  if (!nrow(rows) || any(!rows$detail %in% details) || any(!is.na(rows$sex)) ||
      !all(c("vintage_source","vintage_version","vintage_date_reference","vintage_date_publication") %in% names(rows)))
    stop("Canonical mobility profile rows do not match declared axes or provenance", call.=FALSE)
  if (!"unit" %in% names(rows) || anyNA(rows$unit) || any(!nzchar(as.character(rows$unit))) ||
      any(as.character(rows$unit) != unname(units[rows$detail])))
    stop("Canonical mobility profile contains an undeclared unit", call.=FALSE)
  facts <- data.frame(territory_id=rows$territoire, territory_type=rows$type,
    detail=rows$detail, sex="", value=rows$value,
    status=ifelse(is.na(rows$value), "not_available", "measured"), stringsAsFactors=FALSE)
  axes <- data.frame(axis_name="detail", axis_key=details, label=unname(labels[details]),
    ordinal=seq_along(details)-1L, stringsAsFactors=FALSE)
  axes$unit <- unname(units[details])
  descriptor <- list(indicator_id=indicator, theme_id=metadata$theme, levels=levels,
    details=details, sexes=character(), label=page$label, unit=page$unit, source=sources,
    comparison_detail=page$comparison$detail, comparison_sex=NA_character_,
    comparison_direction=page$direction, completeness=contract$completeness,
    denominator_semantics=contract$denominator_semantics, detail_units_required=TRUE)
  eligible <- unique(data.frame(territory_id=canonical$territoires$territoire[canonical$territoires$type %in% descriptor$levels],
    territory_type=canonical$territoires$type[canonical$territoires$type %in% descriptor$levels], stringsAsFactors=FALSE))
  validate_declared_profile(facts, descriptor, axes, eligible)
  # Source identity remains metadata-owned; canonical vintage columns supply
  # the row-level vintage and human-readable dataset identity.
  if (is.null(source_vintages)) {
    records <- metadata$source_records[sources]
    source_vintages <- do.call(rbind, lapply(sources, function(id) {
      record <- records[[id]]
      if (is.null(record) || is.null(record$vintages)) stop("Declared profile source vintage metadata is incomplete", call.=FALSE)
      do.call(rbind, lapply(record$vintages, function(v) data.frame(id=id,
        source=as.character(record$dataset), version=as.character(v$version),
        date_reference=as.character(v$dateReference), date_publication=as.character(v$datePublication),
        stringsAsFactors=FALSE)))
    }))
  }
  if (!is.data.frame(source_vintages) || !all(c("id", "source", "version", "date_reference", "date_publication") %in% names(source_vintages)))
    stop("Canonical declared profile source vintages are required", call.=FALSE)
  if (any(!sources %in% source_vintages$id) || anyDuplicated(source_vintages[c("id", "version", "date_reference")]))
    stop("Missing or duplicate canonical Mobility source vintage", call.=FALSE)
  primary <- as.character(unlist(metadata$sources[[indicator]], use.names=FALSE))
  if (length(primary) != 1L || !primary %in% sources) stop("Mobility primary source is not declared", call.=FALSE)
  records <- metadata$source_records
  if (is.null(records) || any(!sources %in% names(records))) stop("Mobility source records are incomplete", call.=FALSE)
  row_primary <- match(paste(rows$vintage_version, rows$vintage_date_reference, rows$vintage_date_publication,
      rows$vintage_source, sep="\r"),
    paste(source_vintages$version, source_vintages$date_reference, source_vintages$date_publication,
      source_vintages$source, sep="\r"))
  if (anyNA(row_primary) || any(source_vintages$id[row_primary] != primary))
    stop("Canonical Mobility freshness stamp disagrees with primary source vintage", call.=FALSE)
  primary_vintages <- source_vintages[row_primary, , drop=FALSE]
  secondary <- setdiff(sources, primary)
  secondary_rows <- lapply(secondary, function(source) {
    declared <- records[[source]]$vintages
    if (is.null(declared) || length(declared) != 1L) stop("Mobility secondary source must declare one current vintage", call.=FALSE)
    declared_version <- as.character(declared[[1L]]$version)
    declared_reference <- as.character(declared[[1L]]$dateReference)
    candidates <- source_vintages[source_vintages$id == source & as.character(source_vintages$version) == declared_version &
      as.character(source_vintages$date_reference) == declared_reference, , drop=FALSE]
    if (nrow(candidates) != 1L) stop("Canonical current secondary source vintage is missing or ambiguous", call.=FALSE)
    candidates
  })
  current <- unique(rbind(primary_vintages, if (length(secondary_rows)) do.call(rbind, secondary_rows) else primary_vintages[0,,drop=FALSE]))
  datasets <- unique(data.frame(source_id=as.character(current$id), name=as.character(current$source), stringsAsFactors=FALSE))
  if (anyDuplicated(datasets$source_id)) stop("Mobility canonical source maps to conflicting dataset names", call.=FALSE)
  vintages <- data.frame(source_id=current$id, vintage_id=paste(current$version, current$date_reference, sep="/"),
    version=as.character(current$version), reference_date=as.Date(current$date_reference),
    publication_date=as.Date(current$date_publication), stringsAsFactors=FALSE)
  if (anyNA(vintages) || any(!nzchar(datasets$name))) stop("Mobility source vintage metadata is invalid", call.=FALSE)
  provenance <- do.call(rbind, lapply(unique(facts$detail), function(detail) data.frame(indicator_id=indicator,
    territory_id=facts$territory_id[facts$detail == detail], detail_key=detail,
    sex_key=facts$sex[facts$detail == detail], source_id=primary,
    vintage_id=paste(rows$vintage_version[rows$detail == detail], rows$vintage_date_reference[rows$detail == detail], sep="/"), stringsAsFactors=FALSE)))
  # reseaux_par_habitant is computed from the OSM network and population carried
  # by the stationnement-velo input; the other closed profiles have one producer.
  dependencies <- if (identical(indicator, "reseaux_par_habitant")) setdiff(sources, primary) else character()
  if (length(dependencies)) provenance <- rbind(provenance, do.call(rbind, lapply(dependencies, function(source)
    data.frame(indicator_id=indicator, territory_id=facts$territory_id, detail_key=facts$detail,
      sex_key=facts$sex, source_id=source, vintage_id=vintages$vintage_id[vintages$source_id == source],
      stringsAsFactors=FALSE))))
  descriptor$descriptor_version <- profile_content_version(list(descriptor, axes, contract))
  list(facts=facts, axes=axes, descriptor=descriptor, provenance=provenance,
    vintages=vintages, datasets=datasets, eligible_territories=eligible)
}

# Mobility profiles retain their historic caller while sharing the validated
# producer-declared detail projection with other themes.
project_mobility_profile <- project_declared_detail_profile

# The Mobilité density signature is not a declared detail profile: the input
# carries one range and two distinct, paired ordinates (density and decile).
# Keep that producer grain intact for its named figure consumer.
project_mobility_density_distribution <- function(histories, vintages, metadata) {
  required <- c("territoire", "type", "dens_min", "dens_max", "vintage_source",
                "vintage_version", "vintage_date_reference", "vintage_date_publication")
  if (!is.data.frame(histories) || !all(required %in% names(histories)))
    stop("Canonical mobility distribution fields are incomplete", call.=FALSE)
  density_cols <- grep("^dens_[0-9]+$", names(histories), value=TRUE)
  decile_cols <- grep("^dec_[0-9]+$", names(histories), value=TRUE)
  density_index <- as.integer(sub("^dens_", "", density_cols))
  decile_index <- as.integer(sub("^dec_", "", decile_cols))
  if (!length(density_cols) || !identical(sort(density_index), sort(decile_index)) ||
      anyDuplicated(density_index) || anyDuplicated(decile_index))
    stop("Canonical mobility density and decile axes do not match", call.=FALSE)
  contract <- metadata$distribution_contracts$mobilite_density_distribution
  source_id <- MOBILITE_SNAPSHOT_SOURCE_ID
  allowed_levels <- as.character(unlist(contract$allowed_focal_levels, use.names=FALSE))
  suffixes <- as.integer(unlist(contract$axis_ordinals, use.names=FALSE))
  if (is.null(contract) || !identical(as.character(contract$source_id), source_id) ||
      !length(allowed_levels) || anyNA(allowed_levels) || any(!nzchar(allowed_levels)) || anyDuplicated(allowed_levels) ||
      !length(suffixes) || anyNA(suffixes) || anyDuplicated(suffixes) ||
      !identical(sort(density_index), sort(suffixes)) || !identical(sort(decile_index), sort(suffixes)) ||
      !is.character(contract$density_unit) || length(contract$density_unit)!=1L || !nzchar(contract$density_unit) ||
      !is.character(contract$decile_unit) || length(contract$decile_unit)!=1L || !nzchar(contract$decile_unit))
    stop("Mobility density distribution descriptor differs from its producer contract", call.=FALSE)
  # The producer emits one canonical density signature for every history
  # territory row. This includes the supported focal territories represented
  # by either story; it does not project or reconstruct the separate peer cloud.
  rows <- histories
  if (!nrow(rows) || anyDuplicated(rows[c("territoire", "type")]) ||
      any(!rows$type %in% allowed_levels))
    stop("Canonical mobility distribution contains a territory outside producer-declared focal levels", call.=FALSE)
  vintage <- vintages[vintages$id==source_id,,drop=FALSE]
  if (nrow(vintage)!=1L || !all(c("id","source","version","date_reference","date_publication") %in% names(vintage)) ||
      anyNA(vintage[c("source","version")]) || anyNA(rows[c("vintage_source", "vintage_version", "vintage_date_reference", "vintage_date_publication")]) ||
      any(rows$vintage_source!=vintage$source[[1L]] | rows$vintage_version!=vintage$version[[1L]] |
        rows$vintage_date_reference!=as.character(vintage$date_reference[[1L]]) |
        rows$vintage_date_publication!=as.character(vintage$date_publication[[1L]])))
    stop("Canonical Mobility distribution has incompatible snapshot provenance", call.=FALSE)
  vintage_id <- paste(as.character(vintage$version[[1L]]),
    if(is.na(vintage$date_reference[[1L]])) "NA" else as.character(vintage$date_reference[[1L]]),sep="/")
  point_order <- order(density_index)
  points <- do.call(rbind, lapply(seq_along(point_order), function(j) {
    i <- density_index[[point_order[[j]]]]
    density_value <- as.numeric(rows[[paste0("dens_", i)]])
    decile_value <- as.numeric(rows[[paste0("dec_", i)]])
    data.frame(territory_id=as.character(rows$territoire), territory_type=as.character(rows$type),
      ordinal=as.integer(j-1L), density=density_value,
      density_status=ifelse(is.na(density_value),"not_available","measured"),
      decile=decile_value, decile_status=ifelse(is.na(decile_value),"not_available","measured"),
      stringsAsFactors=FALSE)
  }))
  rownames(points) <- NULL
  ranges <- data.frame(territory_id=as.character(rows$territoire), territory_type=as.character(rows$type),
    range_min=as.numeric(rows$dens_min), range_max=as.numeric(rows$dens_max),
    status=ifelse(!is.na(rows$dens_min) & !is.na(rows$dens_max),"measured","not_available"), stringsAsFactors=FALSE)
  if (any(!is.na(points$density) & (!is.finite(points$density) | points$density < 0)) ||
      any(!is.na(points$decile) & !is.finite(points$decile)) ||
      any(ranges$status=="measured" & (!is.finite(ranges$range_min) | !is.finite(ranges$range_max) | ranges$range_min>ranges$range_max)) ||
      any((ranges$status!="measured") & (!is.na(ranges$range_min) | !is.na(ranges$range_max))))
    stop("Canonical mobility distribution contains invalid values", call.=FALSE)
  list(points=points, ranges=ranges, source_id=source_id,
    source_name=as.character(vintage$source[[1L]]), vintage_id=vintage_id,
    source_version=as.character(vintage$version[[1L]]), reference_date=as.Date(vintage$date_reference[[1L]]),
    publication_date=as.Date(vintage$date_publication[[1L]]), allowed_levels=allowed_levels, axis_count=length(suffixes),
    density_unit=contract$density_unit, decile_unit=contract$decile_unit,
    version=profile_content_version(list(points, ranges, contract, vintage)))
}

profile_content_version <- function(projection) {
  path <- tempfile("profile-version-")
  on.exit(unlink(path), add = TRUE)
  saveRDS(projection, path, version = 3)
  unname(tools::md5sum(path))
}

register_profile_publisher <- function(registry, name, project, publish) {
  if (!is.list(registry) || !is.function(project) || !is.function(publish) ||
      length(name) != 1L || !nzchar(name) || name %in% names(registry))
    stop("Invalid or duplicate profile publisher registration", call.=FALSE)
  registry[[name]] <- list(project=project, publish=publish)
  registry
}

publish_registered_profile <- function(registry, name, canonical, db, additional_projections = list()) {
  publisher <- registry[[name]]
  if (is.null(publisher)) stop("Unregistered profile publisher", call.=FALSE)
  projection <- publisher$project(canonical)
  profiles <- c(list(projection), additional_projections)
  ids <- vapply(profiles, function(p) p$descriptor$indicator_id, character(1))
  if (anyDuplicated(ids)) stop("Duplicate profile snapshot identity", call.=FALSE)
  for (profile in profiles) {
    validate_declared_profile(profile$facts, profile$descriptor,
      profile$axes, profile$eligible_territories)
    validate_profile_provenance(profile)
  }
  if (length(profiles) > 1L) projection <- list(profiles=profiles[order(ids)])
  version <- profile_content_version(projection)
  result <- db$transaction({
    if (is.function(db$lock)) db$lock()
    reference <- db$reference_marker()
    if (!nrow(reference) || is.na(reference$content_version[[1L]]) ||
        !nzchar(reference$content_version[[1L]]) ||
        (all(c("row_count", "actual_rows") %in% names(reference)) &&
         reference$row_count[[1L]] != reference$actual_rows[[1L]]))
      stop("Territory reference has no committed publication marker", call.=FALSE)
    for (profile in profiles) {
      db$validate_territories(profile$eligible_territories, profile$descriptor)
      if (!is.null(profile$descriptor$comparison_scalar)) {
        scalar <- db$marker("scalar_observation")
        if (!nrow(scalar) || !identical(as.character(scalar$content_version[[1L]]), profile$descriptor$required_scalar_version) ||
            !identical(as.character(scalar$reference_content_version[[1L]]), as.character(reference$content_version[[1L]])))
          stop("Profile scalar dependency is stale or incompatible", call.=FALSE)
        db$validate_scalar_facet(profile$descriptor)
      }
    }
    marker <- db$marker("declared_profile")
    changed <- !(nrow(marker) && identical(as.character(marker$content_version[[1L]]), version))
    reference_changed <- !changed && "reference_content_version" %in% names(marker) &&
      !identical(as.character(marker$reference_content_version[[1L]]), as.character(reference$content_version[[1L]]))
    comparison_stale <- FALSE
    if (is.function(db$prepare_comparisons)) {
      comparison_state <- db$prepare_comparisons(profiles, version, reference$content_version[[1L]])
      comparison_stale <- isTRUE(comparison_state$stale)
    }
    if (changed || reference_changed || comparison_stale) publisher$publish(projection, db, version)
    invisible(list(changed=changed || reference_changed || comparison_stale,
      compatibility_updated=reference_changed, content_version=version))
  })
  result
}

register_structure_age_profile_publisher <- function(registry, metadata) {
  register_profile_publisher(registry, "structure_age", function(canonical) {
    project_structure_age_profile(canonical, metadata)
  }, function(projection, db, version) db$replace(projection, version))
}

profile_postgres_adapter <- function(con, artifact_directory = NULL) {
  if (!requireNamespace("DBI", quietly = TRUE)) stop("DBI is required")
  comparison_artifact <- NULL
  comparisons <- NULL
  list(
    write_artifacts = function() {
      if (!is.null(artifact_directory)) {
        if (is.null(comparison_artifact)) stop("Current profile comparison artifact was not prepared", call.=FALSE)
        write_profile_comparison_parquets(comparison_artifact, artifact_directory)
      }
    },
    transaction = function(expr) DBI::dbWithTransaction(con, expr),
    lock = function() DBI::dbGetQuery(con, "SELECT pg_advisory_xact_lock(596, 1)"),
    marker = function(name) DBI::dbGetQuery(con,
      "SELECT content_version,reference_content_version FROM table_publication WHERE table_name=$1", params=list(name)),
    prepare_comparisons = function(profiles, version, reference_version) {
      refs <- DBI::dbGetQuery(con, "SELECT territory_id,territory_type,epci_id,density_class_code FROM territory_reference")
      comparisons <<- project_declared_profile_comparisons(profiles, refs, version, reference_version)
      marker <- DBI::dbGetQuery(con, "SELECT content_version,profile_content_version,reference_content_version,group_row_count,territory_row_count,
        EXISTS(SELECT 1 FROM profile_comparison_group WHERE lineage_source_count IS NULL) AS lineage_incomplete
        FROM profile_comparison_publication WHERE singleton=true")
      comparison_version <- profile_content_version(comparisons)
      expected <- c(nrow(comparisons$groups), nrow(comparisons$territories))
      stale <- !nrow(marker) || !identical(as.character(marker$profile_content_version[[1L]]), as.character(version)) ||
        !identical(as.character(marker$reference_content_version[[1L]]), as.character(reference_version)) ||
        !identical(as.character(marker$content_version[[1L]]), comparison_version) ||
        !identical(as.integer(c(marker$group_row_count[[1L]], marker$territory_row_count[[1L]])), as.integer(expected)) ||
        isTRUE(marker$lineage_incomplete[[1L]])
      # Files are immutable generations. The DB marker is their pointer; a
      # rollback may leave an unreferenced orphan, but cannot invalidate the
      # prior committed generation. Never overwrite a referenced generation.
      if (!is.null(artifact_directory)) write_profile_comparison_parquets(comparisons, artifact_directory)
      list(stale=stale, projection=comparisons)
    },
    reference_marker = function() DBI::dbGetQuery(con,
      "SELECT p.content_version,p.row_count,(SELECT count(*) FROM territory_reference) AS actual_rows FROM table_publication p WHERE p.table_name='territory_reference'"),
    set_reference_version = function(version) DBI::dbExecute(con,
      "UPDATE table_publication SET reference_content_version=$1 WHERE table_name='declared_profile'", params=list(version)),
    validate_scalar_facet = function(descriptor) {
      facet <- DBI::dbGetQuery(con, "SELECT unit,direction,allowed_levels,comparison_facet FROM scalar_descriptor WHERE indicator_id=$1",
        params=list(descriptor$comparison_scalar))
      levels <- DBI::dbGetQuery(con, "SELECT unnest(allowed_levels) AS level FROM scalar_descriptor WHERE indicator_id=$1",
        params=list(descriptor$comparison_scalar))$level
      if (!nrow(facet) || facet$unit[[1L]] != descriptor$unit ||
          facet$direction[[1L]] != descriptor$comparison_direction ||
          !all(descriptor$levels %in% levels) ||
          facet$comparison_facet[[1L]] != descriptor$comparison_scalar)
        stop("Profile scalar facet descriptor is incompatible", call.=FALSE)
    },
    validate_territories = function(territories, descriptor) {
      actual <- DBI::dbGetQuery(con, "SELECT territory_id,territory_type FROM territory_reference")
      actual <- actual[actual$territory_type %in% unlist(descriptor$levels, use.names=FALSE), , drop=FALSE]
       expected <- unique(territories[c("territory_id","territory_type")])
       if (!setequal(paste(actual$territory_type,actual$territory_id),paste(expected$territory_type,expected$territory_id)))
         stop("Profile eligible territory universe differs from committed reference for ",
           descriptor$indicator_id, call.=FALSE)
    },
    replace = function(projection, version) {
      profiles <- if (!is.null(projection$profiles)) projection$profiles else list(projection)
      reference_version <- DBI::dbGetQuery(con, "SELECT content_version FROM table_publication WHERE table_name='territory_reference'")$content_version[[1L]]
      if (is.null(comparisons) || !identical(comparisons$profile_content_version, version) ||
          !identical(comparisons$reference_content_version, reference_version))
        stop("Profile comparisons were not prepared for the current publication snapshot", call.=FALSE)
      comparison_version <- profile_content_version(comparisons)
      ids <- vapply(profiles, function(p) p$descriptor$indicator_id, character(1))
      existing <- DBI::dbGetQuery(con, "SELECT indicator_id FROM profile_descriptor")$indicator_id
      if (any(!existing %in% ids)) stop("Complete profile snapshot would discard an existing profile", call.=FALSE)
      DBI::dbExecute(con, "DELETE FROM profile_comparison_territory")
      DBI::dbExecute(con, "DELETE FROM profile_comparison_group")
      DBI::dbExecute(con, "DELETE FROM comparison_source_lineage WHERE comparison_family='profile'")
      DBI::dbExecute(con, "DELETE FROM profile_observation")
      DBI::dbExecute(con, "DELETE FROM profile_descriptor_source")
      DBI::dbExecute(con, "DELETE FROM profile_descriptor")
      for (projection in profiles) {
      for (i in seq_len(nrow(projection$datasets))) DBI::dbExecute(con,
        "INSERT INTO source_dataset(source_id,name) VALUES($1,$2) ON CONFLICT(source_id) DO UPDATE SET name=EXCLUDED.name",
        params=unname(as.list(projection$datasets[i,])))
      for (i in seq_len(nrow(projection$vintages))) DBI::dbExecute(con,
        "INSERT INTO source_vintage(source_id,vintage_id,version,reference_date,publication_date) VALUES($1,$2,$3,$4,$5) ON CONFLICT(source_id,vintage_id) DO UPDATE SET version=EXCLUDED.version,reference_date=EXCLUDED.reference_date,publication_date=EXCLUDED.publication_date",
        params=unname(as.list(projection$vintages[i,])))
      d <- projection$descriptor
      levels_sql <- paste(as.character(DBI::dbQuoteString(con, as.character(d$levels))), collapse=",")
      if (is.null(d$completeness) || !identical(d$completeness, "dense_complete"))
        stop("Profile completeness contract is missing or unsupported", call.=FALSE)
      DBI::dbExecute(con, paste0("INSERT INTO profile_descriptor(indicator_id,label,unit,allowed_levels,completeness,descriptor_version,comparison_detail,comparison_sex,comparison_direction,theme_id,comparison_scalar,required_scalar_version,denominator_semantics,detail_units_required) VALUES($1,$2,$3,ARRAY[",
        levels_sql,
        "]::text[],$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)"),
        params=list(d$indicator_id, d$label, d$unit, d$completeness, d$descriptor_version,
          d$comparison_detail, d$comparison_sex, d$comparison_direction, d$theme_id,
          if (is.null(d$comparison_scalar)) NA_character_ else d$comparison_scalar,
          if (is.null(d$required_scalar_version)) NA_character_ else d$required_scalar_version,
          if (is.null(d$denominator_semantics)) NA_character_ else d$denominator_semantics,
          if (is.null(d$detail_units_required)) FALSE else isTRUE(d$detail_units_required)))
      for (source_id in d$source) DBI::dbExecute(con,
        "INSERT INTO profile_descriptor_source(indicator_id,source_id) VALUES($1,$2)", params=list(d$indicator_id,source_id))
      axes <- projection$axes
      if (!"unit" %in% names(axes)) axes$unit <- NA_character_
      DBI::dbWriteTable(con,"profile_axis",transform(axes,indicator_id=d$indicator_id),append=TRUE,row.names=FALSE)
      obs <- projection$facts
      names(obs)[names(obs)=="detail"] <- "detail_key"
      names(obs)[names(obs)=="sex"] <- "sex_key"
      obs$sex_axis_name <- if (length(d$sexes)) "sex" else NA_character_
      DBI::dbWriteTable(con,"profile_observation",transform(obs,indicator_id=d$indicator_id),append=TRUE,row.names=FALSE)
      DBI::dbWriteTable(con,"profile_observation_source",projection$provenance,append=TRUE,row.names=FALSE)
      actual_rows <- DBI::dbGetQuery(con,
        "SELECT count(*) AS n FROM profile_observation WHERE indicator_id=$1", params=list(d$indicator_id))$n[[1L]]
      if (actual_rows != nrow(projection$facts))
        stop("Published profile row count differs from validated projection", call.=FALSE)
      }
      DBI::dbWriteTable(con, "profile_comparison_group", comparisons$groups, append=TRUE, row.names=FALSE)
      DBI::dbWriteTable(con, "profile_comparison_territory", comparisons$territories, append=TRUE, row.names=FALSE)
      lineage <- comparisons$lineage
      lineage$comparison_family <- "profile"
      lineage$comparison_content_version <- comparison_version
      DBI::dbWriteTable(con,"comparison_source_lineage",lineage[c("comparison_family","comparison_context",
        "group_id","territory_type","facet_id","source_id","vintage_id","comparison_content_version")],append=TRUE,row.names=FALSE)
      DBI::dbExecute(con, "INSERT INTO profile_comparison_publication(singleton,content_version,profile_content_version,reference_content_version,group_row_count,territory_row_count,published_at) VALUES(true,$1,$2,$3,$4,$5,now()) ON CONFLICT(singleton) DO UPDATE SET content_version=EXCLUDED.content_version,profile_content_version=EXCLUDED.profile_content_version,reference_content_version=EXCLUDED.reference_content_version,group_row_count=EXCLUDED.group_row_count,territory_row_count=EXCLUDED.territory_row_count,published_at=EXCLUDED.published_at",
        params=list(comparison_version, version, reference_version, nrow(comparisons$groups), nrow(comparisons$territories)))
      reference <- DBI::dbGetQuery(con,"SELECT content_version FROM table_publication WHERE table_name='territory_reference'")
      if (!nrow(reference)) stop("Territory reference publication is unavailable", call.=FALSE)
      DBI::dbExecute(con,"INSERT INTO table_publication(table_name,content_version,row_count,reference_content_version,published_at) VALUES('declared_profile',$1,$2,$3,now()) ON CONFLICT(table_name) DO UPDATE SET content_version=EXCLUDED.content_version,row_count=EXCLUDED.row_count,reference_content_version=EXCLUDED.reference_content_version,published_at=EXCLUDED.published_at",
        params=list(version,sum(vapply(profiles,function(p) nrow(p$facts),integer(1))),reference$content_version[[1L]]))
    })
}

publier_structure_age_profile_postgres <- function(payload, metadata) {
  config <- configuration_service_postgres()
  con <- do.call(DBI::dbConnect, c(list(drv=RPostgres::Postgres()), config))
  tryCatch({
    registry <- register_structure_age_profile_publisher(list(), metadata)
    publish_registered_profile(registry, "structure_age", payload, profile_postgres_adapter(con))
  }, finally = DBI::dbDisconnect(con))
}

# Explicit complete snapshot from the offline declared-profile serving
# artifacts. The verified scalar binding is recomputed from the same canonical
# Parquet the shared scalar publisher consumes, so a stale local DPE generation
# (its required_scalar_version no longer matching) fails closed here before any
# database write. The DPE facet is still cross-checked against the live
# scalar_observation marker inside publish_registered_profile().
publier_declared_profiles_postgres <- function(artifact_directory, owners, con = NULL) {
  if (!is.character(owners) || !length(owners) || anyNA(owners) || anyDuplicated(owners))
    stop("Declared profile owners are required", call.=FALSE)
  if (!"structure_age" %in% owners)
    stop("Declared profile publication requires the structure_age owner", call.=FALSE)
  scalar_binding <- profile_scalar_binding(artifact_directory)
  profiles <- read_profile_serving_profiles(artifact_directory, owners, scalar_binding = scalar_binding)
  owned <- is.null(con)
  if (owned) con <- do.call(DBI::dbConnect, c(list(drv=RPostgres::Postgres()), configuration_service_postgres()))
  if (owned) on.exit(DBI::dbDisconnect(con), add=TRUE)
  # The artifacts are already projected and validated; the identity publisher
  # exists only to reuse the shared marker and comparison publication
  # transaction.
  registry <- register_profile_publisher(list(), "structure_age",
    function(projection) projection,
    function(projection, db, version) db$replace(projection, version))
  additional <- profiles[setdiff(names(profiles), "structure_age")]
  adapter <- profile_postgres_adapter(con, artifact_directory)
  publish_registered_profile(registry, "structure_age", profiles$structure_age, adapter,
    additional_projections = additional)
}

declared_detail_profile_ids <- function(metadata) {
  pages <- metadata$indicator_pages
  contracts <- metadata$profile_contracts
  if (is.null(pages) || is.null(contracts)) stop("Profile inventory requires typed metadata contracts", call.=FALSE)
  names(Filter(function(contract) identical(contract$completeness, "dense_complete") &&
    !is.null(contract$detail_units), contracts))
}
