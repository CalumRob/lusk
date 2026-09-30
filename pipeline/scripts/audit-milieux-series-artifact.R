#!/usr/bin/env Rscript
# Reproducible audit of additive M2/M3 artifact fields against a pre-change
# parquet supplied by the caller. Does not modify canonical artifacts.
args <- commandArgs(trailingOnly=TRUE)
if (length(args) != 1L || !file.exists(args[[1L]]))
  stop("Usage: Rscript scripts/audit-milieux-series-artifact.R <pre-change-indicateurs_milieux.parquet>", call.=FALSE)
pkgload::load_all(".", quiet=TRUE)
baseline <- as.data.frame(nanoparquet::read_parquet(args[[1L]]))
current <- as.data.frame(nanoparquet::read_parquet(file.path("..","public","data","indicateurs_milieux.parquet")))
conso <- readRDS("data/processed/milieux/consoenaf_communes.rds")
ocsge <- readRDS("data/processed/milieux/ocsge_communes.rds")
stopifnot(nrow(conso)==1200L,nrow(ocsge)==1200L,!anyDuplicated(conso$code),!anyDuplicated(ocsge$code))
data <- dplyr::left_join(conso,ocsge,by="code",suffix=c("",".ocsge"))
stopifnot(!anyNA(data$artif_m2),!anyNA(data$artif_m3))
payload <- as.data.frame(compute_payload(data,theme=theme_milieux())$indicateurs)
key <- c("territoire","type","theme","key","detail")
stopifnot(all(key %in% names(baseline)),all(key %in% names(current)),all(key %in% names(payload)),
  !anyDuplicated(baseline[key]),!anyDuplicated(current[key]),!anyDuplicated(payload[key]))
id <- function(x) do.call(paste,c(lapply(x[key],as.character),sep="\x1f"))
baseline_id <- id(baseline); current_id <- id(current); payload_id <- id(payload)
if (!setequal(baseline_id,payload_id) || length(baseline_id)!=length(payload_id))
  stop("Baseline and regenerated row keys differ",call.=FALSE)
if (!setequal(current_id,payload_id) || length(current_id)!=length(payload_id))
  stop("Current artifact and regenerated row keys differ",call.=FALSE)
payload_at_baseline <- match(baseline_id,payload_id)
payload_at_current <- match(current_id,payload_id)
old_columns <- names(baseline)
if (!all(old_columns %in% names(payload)) || !all(old_columns %in% names(current)))
  stop("An existing baseline column is absent from current artifact or regenerated payload",call.=FALSE)
for (column in old_columns) {
  if (!identical(baseline[[column]],payload[[column]][payload_at_baseline]))
    stop("Pre-change parity mismatch (values or type): ",column,call.=FALSE)
  if (!identical(current[[column]],payload[[column]][payload_at_current]))
    stop("Current artifact/payload mismatch (values or type): ",column,call.=FALSE)
}
for (column in c("state_role","source_components")) {
  if (!column %in% names(current) || !identical(current[[column]],payload[[column]][payload_at_current]))
    stop("Additive typed lineage differs from regenerated payload: ",column,call.=FALSE)
}
cat("MILIEUX ARTIFACT AUDIT PASS | baseline rows:",nrow(baseline),
  "| current rows:",nrow(current),"| regenerated rows:",nrow(payload),
  "| exact old columns (names/types/values):",length(old_columns),
  "| existing keyed facts: exact | additive typed fields: exact\n")
