#!/usr/bin/env Rscript
# materialize-serving-artifacts (issue #802)
#
# Materialize the serving artifacts the unified publishers consume — the
# scalar-serving, series-serving, profile-serving and typed-reading families —
# from the COMMITTED product payload (public/data), into a caller-owned private
# work directory. This is the offline preparation step of the production rollout
# (parent #801): the committed snapshot holds the product payload but not the
# pipeline-generated serving artifacts, so the publishers cannot run until those
# artifacts exist locally.
#
# The committed payload plus the package's byte-pinned producer artifacts are the
# only producer inputs: no `data/raw` download cache, no database and no network.
# The payload inputs are copied into the work directory first and the committed
# snapshot is asserted unchanged, so it is never written in place. Before the first
# write, the work root, every planned owner directory and every copied input
# destination file are resolved through the filesystem — symlinks, junctions and
# reparse points included — and refused if any of them reaches the snapshot. A hard
# link is invisible to that resolution, so the copy never opens a pre-existing
# destination object either: each input is staged and installed by rename. The work
# directory is otherwise a complete
# `LUSK_SORTIE` for the rollout's publication step (it also carries the shared
# Programme Parquets the Programme publisher reads directly, and it declares the
# producer sources the serving generations were built from).
#
# One retained owner is not a committed-payload projection: the Mobilite owned
# series `raccordement_courbe`, with the `raccordement_tc` headline and the
# `raccordement_reference` trajectory it is projected from, is a producer-owned
# built result the committed payload predates (#728). It is taken from the pinned
# national GTFS artifact through the producer's own reader and projection, with the
# producer's current declarations and vintage, so no owner depends on a stale
# theme-wide Parquet and no retired fact is relabelled. A pin or producer-contract
# failure blocks before any generation is written.
#
# Retained owners are derived from producer metadata only — never a copied theme
# list: the scalar owners from each theme's scalar_contracts minus the excluded
# serving_disposition, the series owners from each theme's owned_series_routes,
# the typed-reading owners from the artifact contract map, and the profile owners
# from the declared pyramid/dense profile contracts.
#
# Usage (run from pipeline/):
#   Rscript scripts/materialize-serving-artifacts.R --source ../public/data --work <dir>
#   Rscript scripts/materialize-serving-artifacts.R --check
#
#   --source <dir>  committed payload snapshot (default: ../public/data)
#   --work <dir>    private work directory (required unless --check)
#   --check         validate the committed inputs and report the planned
#                   artifacts and their content versions; read-only apart from a
#                   disposable temp directory.
#
# An owner the inputs cannot feed (a producer contract the committed facts or the
# pinned artifact no longer satisfy) is reported as BLOCKED with the reason and the
# run exits non-zero; every other owner is still materialized, so the work
# directory stays usable for those publishers. The status is fail-closed: a
# non-zero exit means the retained owner set is incomplete, so a publication built
# from that work directory is diagnostic evidence and not all-owner acceptance for
# the rollout. A clean run reports no blocked owner and exits zero.
#
# Wall-clock and disk: the materialization reads the committed JSON projections
# (~100 MB) and writes immutable generations plus their current pointers into the
# work directory. Delete the work directory to start clean; re-running reuses the
# identical generations (the writers only replace a pointer when the content
# version changes).
if (!requireNamespace("pkgload", quietly=TRUE))
  stop("pkgload is required to load the pipeline", call.=FALSE)
pkgload::load_all(".", quiet=TRUE)

arguments <- parse_materialize_serving_args(commandArgs(trailingOnly=TRUE))
result <- materialize_serving_artifacts(arguments$source, arguments$work,
  mode=if (arguments$check) "check" else "materialize")
cat(paste(format_serving_artifact_report(result), collapse="\n"), "\n", sep="")
if (!identical(result$mode, "check"))
  cat("Materialized into", result$work, "\n")
if (nrow(result$blocked))
  stop("Blocked owner(s): the committed payload and the pinned producer inputs ",
    "cannot feed them: ",
    paste(paste0(result$blocked$family, "/", result$blocked$owner), collapse=", "), call.=FALSE)
