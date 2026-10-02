#!/usr/bin/env Rscript
# Read-only parity check for the closed profile projections against the
# published canonical Parquet artifacts. Does not connect to or write a DB.
pkgload::load_all(".", quiet=TRUE)
if (!requireNamespace("nanoparquet", quietly=TRUE)) stop("nanoparquet is required")
data_dir <- Sys.getenv("LUSK_CANONICAL_PUBLIC_DATA", "E:/Lusk/public/data")
facts <- nanoparquet::read_parquet(file.path(data_dir, "indicateurs_mobilite.parquet"))
territories <- nanoparquet::read_parquet(file.path(data_dir, "territoires.parquet"))
vintages <- nanoparquet::read_parquet(file.path(data_dir, "vintages.parquet"))
metadata <- lire_theme_metadata("mobilite")
canonical <- list(indicateurs=facts, territoires=territories, source_vintages=vintages)
expected_rows <- c(voitures_menage=3801L, reseaux=3801L,
  reseaux_par_habitant=3801L, offre_cyclable=6335L)
profiles <- lapply(names(expected_rows), function(id) project_mobility_profile(canonical, metadata, id))
names(profiles) <- names(expected_rows)
scalar_rows <- data.frame(territory_id=facts$territoire, territory_type=facts$type,
  indicator_id=facts$key, value=facts$value, unit=facts$unit,
  source_name=facts$vintage_source, source_version=facts$vintage_version,
  reference_date=facts$vintage_date_reference, publication_date=facts$vintage_date_publication,
  stringsAsFactors=FALSE)
eligible <- unique(data.frame(territory_id=territories$territoire, territory_type=territories$type,
  stringsAsFactors=FALSE))
scalar_projection <- project_scalar_canonical_rows(scalar_rows, metadata,
  names(metadata$scalar_contracts), eligible, source_vintages=vintages)
stopifnot(nrow(scalar_projection$descriptors) == 21L,
  setequal(scalar_projection$descriptors$indicator_id, names(metadata$scalar_contracts)))
stopifnot(identical(vapply(profiles, function(p) nrow(p$facts), integer(1)), expected_rows))
for (id in names(profiles)) {
  profile <- profiles[[id]]
  expected <- facts[facts$key == id & facts$type %in% unlist(metadata$indicator_pages[[id]]$levels), , drop=FALSE]
  key <- function(territory, type, detail, sex="") paste(type, territory, detail, ifelse(is.na(sex), "", sex), sep="\r")
  expected_key <- key(expected$territoire, expected$type, expected$detail, expected$sex)
  actual_key <- key(profile$facts$territory_id, profile$facts$territory_type, profile$facts$detail, profile$facts$sex)
  stopifnot(setequal(actual_key, expected_key), !anyDuplicated(actual_key))
  matched <- match(actual_key, expected_key)
  stopifnot(isTRUE(all.equal(profile$facts$value, expected$value[matched])),
    identical(profile$facts$status, ifelse(is.na(expected$value[matched]), "not_available", "measured")),
    identical(as.character(profile$axes$unit), as.character(unlist(metadata$profile_contracts[[id]]$detail_units, use.names=TRUE)[profile$axes$axis_key])))
  primary <- as.character(metadata$sources[[id]])
  dependencies <- if (id == "reseaux_par_habitant") setdiff(as.character(unlist(metadata$indicator_pages[[id]]$sources, use.names=FALSE)), primary) else character()
  stopifnot(setequal(unique(profile$provenance$source_id), c(primary, dependencies)),
    nrow(profile$provenance) == nrow(profile$facts) * (1L + length(dependencies)))
  primary_vintage <- vintages[vintages$id == primary, , drop=FALSE]
  stopifnot(nrow(primary_vintage) == 1L,
    all(profile$provenance$vintage_id[profile$provenance$source_id == primary] ==
      paste(primary_vintage$version, primary_vintage$date_reference, sep="/")))
}
rennes <- function(id) {
  p <- profiles[[id]]
  observed <- p$facts[p$facts$territory_id == "35238", c("detail", "value")]
  expected <- facts[facts$territoire == "35238" & facts$key == id, c("detail", "value")]
  expected <- expected[match(observed$detail, expected$detail), , drop=FALSE]
  stopifnot(identical(observed$detail, expected$detail), isTRUE(all.equal(observed$value, expected$value)))
  observed
}
stopifnot(isTRUE(all.equal(rennes("voitures_menage")$value,
  c(0.150347686201,0.319333188215,0.530319125665), tolerance=1e-9)))
stopifnot(identical(profiles$offre_cyclable$axes$unit,
  c("km","km / 1 000 hab","km","km / 1 000 hab","km")))
cat("Canonical Mobility Parquet projection parity: PASS\n")
cat("Ordinary scalar metadata contracts projected:", nrow(scalar_projection$descriptors),
  "indicators;", nrow(scalar_projection$facts), "observations\n")
for (id in names(profiles)) cat(id, nrow(profiles[[id]]$facts), "cells;", length(profiles[[id]]$descriptor$source), "declared sources\n")
cat("Rennes offer-cyclable cells and per-detail units:\n")
print(rennes("offre_cyclable"))
