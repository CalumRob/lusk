#!/usr/bin/env Rscript
# Self-contained canonical inputs for the guarded retained-reference smoke.
# Run from pipeline/: Rscript --vanilla <this-file> <output-directory>
args <- commandArgs(TRUE)
if (length(args) != 1L) stop("usage: retained_reference_fixture.R <output-directory>")
out <- args[[1L]]
dir.create(out, recursive=TRUE, showWarnings=FALSE)
pkgload::load_all(".", quiet=TRUE)

territories <- data.frame(
  territoire = c("fixture-commune", "53"),
  type = c("commune", "region"),
  nom = c("Fixture commune", "Bretagne"),
  departement = c(NA_character_, NA_character_),
  epci = c(NA_character_, NA_character_),
  classe_densite_code = c(NA_character_, NA_character_),
  stringsAsFactors = FALSE
)
nanoparquet::write_parquet(territories, file.path(out, "territoires.parquet"))
eligible <- data.frame(territory_id="fixture-commune", territory_type="commune",
                       stringsAsFactors=FALSE)

for (owner in retained_scalar_artifact_owners()) {
  indicator <- paste0("fixture_", owner)
  source <- paste0(owner, "_fixture_source")
  facts <- data.frame(
    indicator_id=indicator, territory_id="fixture-commune", territory_type="commune",
    value=1, status="measured", support_count=NA_integer_, denominator_count=NA_integer_,
    stringsAsFactors=FALSE
  )
  descriptors <- data.frame(
    indicator_id=indicator, theme_id=owner, allowed_sources=I(list(source)),
    label="Fixture scalar", unit="count", direction="high", comparison_facet=indicator,
    allowed_levels=I(list("commune")), denominator_semantics="fixture denominator",
    completeness="sparse", descriptor_version="1", stringsAsFactors=FALSE
  )
  provenance <- data.frame(indicator_id=indicator, territory_id="fixture-commune",
                           source_id=source, vintage_id="v1", stringsAsFactors=FALSE)
  datasets <- data.frame(source_id=source, name="Fixture source", stringsAsFactors=FALSE)
  vintages <- data.frame(source_id=source, vintage_id="v1", version="1",
    reference_date=as.Date("2026-01-01"), publication_date=as.Date("2026-01-02"),
    stringsAsFactors=FALSE)
  projection <- list(facts=facts, descriptors=descriptors, provenance=provenance,
    datasets=datasets, vintages=vintages, eligible_territories=eligible)
  write_scalar_serving_artifact(projection, file.path(out, "scalar-serving", owner))
}
