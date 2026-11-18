#!/usr/bin/env Rscript
# Produce the already-pooled AEDAR littoral artifact (C/NC groups) from the six
# address-grain sources and the pinned DREAL classification. This is the
# producer-side pooling step (#1043): fixed requests never average commune
# summaries and never repeat TYPEQU aggregation.
pkgload::load_all(".",quiet=TRUE)

args<-commandArgs(trailingOnly=TRUE)
if(length(args)>0L&&(length(args)!=2L||args[[1L]]!="--output"))
  stop("Usage: Rscript scripts/build-aedar-littoral-aggregate.R [--output PATH] (from pipeline/)",call.=FALSE)

raw_dir<-Sys.getenv("LUSK_AEDAR_RAW_DIR",unset=file.path("data","raw"))
origins_path<-Sys.getenv("LUSK_AEDAR_ADDRESS_ORIGINS",unset="")
if(!nzchar(origins_path))
  stop("Set LUSK_AEDAR_ADDRESS_ORIGINS to the complete address-origin Parquet",call.=FALSE)
output_path<-if(length(args)) args[[2L]] else Sys.getenv("LUSK_AEDAR_LITTORAL_OUTPUT",unset=file.path(raw_dir,"aedar_littoral_aggregate.parquet"))
resources<-AEDAR_SOURCE_RESOURCES[AEDAR_SOURCE_RESOURCES$kind=="address",,drop=FALSE]
mode_paths<-stats::setNames(file.path(raw_dir,resources$filename),resources$mode)

# The crosswalk is built ONCE from the admitted DREAL positive list over the
# canonical commune universe: listed codes become C, the validated complement
# becomes NC. An absent/unpinned source fails closed; no commune is implicitly
# NC. The same crosswalk feeds the published territory reference.
littoral_reference<-read_aedar_littoral_reference(
  file.path(raw_dir,MANIFEST_CLASSES_LITTORAL[["fichier"]][[1L]]))
crosswalk<-littoral_reference$crosswalk

protected<-c(unname(mode_paths),origins_path,
  file.path(raw_dir,AEDAR_AGGREGATE_RESOURCES$filename),
  file.path(raw_dir,MANIFEST_CLASSES_LITTORAL[["fichier"]][[1L]]))
if(tolower(normalizePath(output_path,winslash="/",mustWork=FALSE))%in%
   tolower(normalizePath(protected,winslash="/",mustWork=FALSE)))
  stop("AEDAR littoral output cannot overwrite a registered source or territorial aggregate",call.=FALSE)

result<-build_aedar_littoral_aggregate(mode_paths,origins_path,crosswalk,
  littoral_reference$identity,littoral_reference$sha256,littoral_reference$vintage,
  output_path,verify_hashes=TRUE)
cat("Built AEDAR littoral aggregate:",nrow(result),"rows;",
  length(unique(result$littoral_code)),"status groups;",
  length(unique(result$TYPEQU)),"TYPEQU;",
  length(AEDAR_AGGREGATE_MEASURES),"measures; source",
  littoral_reference$identity,"SHA-256",littoral_reference$sha256,"to",
  normalizePath(output_path,winslash="/",mustWork=TRUE),"\n")
