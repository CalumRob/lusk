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
# The committed payload is the ONLY producer input: no `data/raw` download cache,
# no database and no network. The payload inputs are copied into the work
# directory first and the committed snapshot is asserted unchanged, so it is
# never written in place. Before the first write, the work root and every planned
# write destination are resolved through the filesystem — symlinks, junctions and
# aliases included — and refused if any of them reaches the snapshot. The work
# directory is otherwise a complete `LUSK_SORTIE` for the rollout's publication
# step (it also carries the shared Programme Parquets the Programme publisher
# reads directly).
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
# An owner the committed payload cannot feed (its committed facts no longer
# satisfy the pinned producer contract) is reported as BLOCKED with the reason
# and the run exits non-zero; every other owner is still materialized, so the
# work directory is usable for those publishers. The status stays fail-closed:
# a non-zero exit means the retained owner set is incomplete, so a publication
# built from that work directory proves the feedable subset — it is diagnostic
# evidence, not all-owner acceptance for the rollout. Re-running after the
# committed payload is regenerated picks up the previously blocked owners, and
# only then can the run exit zero.
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
  stop("Blocked owner(s) require a regenerated committed payload: ",
    paste(paste0(result$blocked$family, "/", result$blocked$owner), collapse=", "), call.=FALSE)
