#!/usr/bin/env Rscript
pkgload::load_all(".",quiet=TRUE)

args<-commandArgs(trailingOnly=TRUE)
if(length(args)>0L&&(length(args)!=2L||args[[1L]]!="--output"))
  stop("Usage: Rscript scripts/build-aedar-density-aggregate.R [--output PATH] (from pipeline/)",call.=FALSE)

raw_dir<-Sys.getenv("LUSK_AEDAR_RAW_DIR",unset=file.path("data","raw"))
origins_path<-Sys.getenv("LUSK_AEDAR_ADDRESS_ORIGINS",unset="")
if(!nzchar(origins_path))
  stop("Set LUSK_AEDAR_ADDRESS_ORIGINS to the complete address-origin Parquet",call.=FALSE)
output_path<-if(length(args)) args[[2L]] else Sys.getenv("LUSK_AEDAR_DENSITY_OUTPUT",unset=file.path(raw_dir,"aedar_density_aggregate.parquet"))
resources<-AEDAR_SOURCE_RESOURCES[AEDAR_SOURCE_RESOURCES$kind=="address",,drop=FALSE]
mode_paths<-stats::setNames(file.path(raw_dir,resources$filename),resources$mode)

crosswalk_path<-file.path(raw_dir,MANIFEST_CLASSES_DENSITE[["fichier"]][[1L]])
actual_hash<-sha256_aedar_file(crosswalk_path)
expected_hash<-MANIFEST_CLASSES_DENSITE[["sha256"]][[1L]]
if(!identical(tolower(actual_hash),tolower(expected_hash)))
  stop("Pinned local commune-density source checksum mismatch",call.=FALSE)
classes<-lire_classes_densite(crosswalk_path)
registry<-registre_classes_densite()
class_index<-match(as.character(classes[["DENS7"]]),registry[["classe_densite_code"]])
if(anyNA(class_index)||anyNA(classes[["CODGEO"]])||anyNA(classes[["LIBDENS7"]])||
   any(as.character(classes[["LIBDENS7"]])!=registry[["classe_densite_libelle_insee"]][class_index]))
  stop("Local commune-density source has a code/label outside the authoritative registry",call.=FALSE)
crosswalk<-data.frame(code_insee=as.character(classes[["CODGEO"]]),
  density_class_code=as.character(classes[["DENS7"]]),
  density_class_label=as.character(registry[["classe_densite_libelle_public"]][class_index]),
  stringsAsFactors=FALSE)

protected<-c(unname(mode_paths),origins_path,
  file.path(raw_dir,AEDAR_AGGREGATE_RESOURCES$filename),crosswalk_path)
if(tolower(normalizePath(output_path,winslash="/",mustWork=FALSE))%in%
   tolower(normalizePath(protected,winslash="/",mustWork=FALSE)))
  stop("AEDAR density output cannot overwrite a registered source or territorial aggregate",call.=FALSE)

result<-build_aedar_density_aggregate(mode_paths,origins_path,crosswalk,
  MANIFEST_CLASSES_DENSITE[["id"]][[1L]],MANIFEST_CLASSES_DENSITE[["sha256"]][[1L]],
  MANIFEST_CLASSES_DENSITE[["vintage"]][[1L]],output_path,verify_hashes=TRUE)
cat("Built AEDAR density aggregate:",nrow(result),"rows;",
  length(unique(result$density_class_code)),"density classes;",
  length(unique(result$TYPEQU)),"TYPEQU;",
  length(AEDAR_AGGREGATE_MEASURES),"measures; source",
  MANIFEST_CLASSES_DENSITE[["id"]][[1L]],"SHA-256",actual_hash,"to",
  normalizePath(output_path,winslash="/",mustWork=TRUE),"\n")
