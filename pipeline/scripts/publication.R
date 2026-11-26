#!/usr/bin/env Rscript
# Local publication commands (ADR-0049 step 2, #1135/#1136/#1137/#1142).
# Thin dispatcher: every command lives in pipeline/R/publication_cli.R as an entry
# function that tests call exactly as the operator does.
#   split <sortie>            -> immutable per-resource artefacts (LUSK_ARTEFACTS)
#   plan [sortie]             -> READ-ONLY plan. Never opens a serving connection
#                                (#1136). Live source = explicit offline listing file
#                                LUSK_LIVE_LISTING.
#   listing                   -> prints the LIVE registry as the JSON listing `plan`
#                                reads, read-only, through the shared serving-session
#                                seam: `listing > live.json` then
#                                `LUSK_LIVE_LISTING=live.json plan <sortie>`.
#   adopt <sortie> [--dry-run] -> split the kept sortie, prove EVERY resource's
#                                live rows equal its artefact, then write only
#                                registry rows, descriptors and adopted receipts in
#                                one transaction. Any mismatch refuses with zero
#                                writes. Typed readings are ignored.
#   apply <ids...> [--confirm-definition <id>] [--retire <id>]
#                             -> publishes explicit resources through the SAME
#                                serving-session seam and the SAME lock/registre
#                                options as adopt. Refuses before any write on
#                                lineage freeze, code regression or unconfirmed
#                                definition change. One transaction; append-only DB
#                                receipt; local JSON after commit.
#                                `<id>@<version>` applies that artefact version
#                                (rollback). Run from pipeline/.
if (!requireNamespace("pkgload", quietly = TRUE)) {
  stop("pkgload is required to load the pipeline.", call. = FALSE)
}
pkgload::load_all(".", quiet = TRUE)

executer_commande_publication(commandArgs(trailingOnly = TRUE))
