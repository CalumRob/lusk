#!/usr/bin/env Rscript
# Local publication commands (ADR-0049 step 2, #1135/#1136/#1137).
#   split <sortie>            -> immutable per-resource artefacts (LUSK_ARTEFACTS)
#   plan [sortie]             -> READ-ONLY plan. Never opens a serving connection.
#                                Live source = explicit offline LUSK_LIVE_LISTING
#                                file; the live registry is used by `apply`.
#   adopt <sortie> [--dry-run] -> split the kept sortie, prove EVERY resource's
#                                live rows equal its artefact, then write only
#                                registry rows and adopted receipts in one
#                                transaction. Any mismatch refuses with zero
#                                writes. Typed readings are ignored.
#   apply <ids...> [--confirm-definition <id>] [--retire <id>]
#                             -> publishes explicit resources through the SAME
#                                serving-session seam as adopt. Refuses before
#                                any write on lineage freeze, code regression or
#                                unconfirmed definition change. One transaction;
#                                append-only DB receipt; local JSON after commit.
#                                `<id>@<version>` applies that artefact version
#                                (rollback). Run from pipeline/.
if (!requireNamespace("pkgload", quietly = TRUE)) {
  stop("pkgload is required to load the pipeline.", call. = FALSE)
}
pkgload::load_all(".", quiet = TRUE)

args <- commandArgs(trailingOnly = TRUE)
commande <- if (length(args)) args[[1L]] else ""

if (identical(commande, "split")) {
  if (length(args) != 2L) {
    stop("Usage: Rscript scripts/publication.R split <sortie> (from pipeline/)",
         call. = FALSE)
  }
  resultat <- splitter_sortie(args[[2L]])
  for (i in seq_len(nrow(resultat))) {
    cat(sprintf("%s, %s, %s, %s\n", resultat$ressource[[i]], resultat$forme[[i]],
                resultat$version[[i]], resultat$statut[[i]]))
  }
} else if (identical(commande, "plan")) {
  if (length(args) > 2L) {
    stop("Usage: Rscript scripts/publication.R plan [sortie] (from pipeline/)",
         call. = FALSE)
  }
  sortie <- if (length(args) == 2L) args[[2L]] else ""
  plan <- plan_publication(
    live = Sys.getenv("LUSK_LIVE_LISTING", unset = ""),
    attributions = if (nzchar(sortie)) sortie else NULL)
  imprimer_plan_publication(plan)
} else if (identical(commande, "adopt")) {
  if (!length(args) %in% 2:3 || any(!args %in% c(args[[2L]], "--dry-run")))
    stop("Usage: Rscript scripts/publication.R adopt <sortie> [--dry-run] (from pipeline/)",
         call. = FALSE)
  if (length(args) == 3L && !identical(args[[3L]], "--dry-run"))
    stop("Usage: Rscript scripts/publication.R adopt <sortie> [--dry-run] (from pipeline/)",
         call. = FALSE)
  resultat <- adopter_ressources(args[[2L]], dry_run = "--dry-run" %in% args,
    commit_sha = Sys.getenv("GITHUB_SHA", unset = ""))
  imprimer_adoption(resultat)
} else if (identical(commande, "apply")) {
  if (length(args) < 2L) {
    stop(paste0("Usage: Rscript scripts/publication.R apply <ids...> ",
      "[--confirm-definition <id>] [--retire <id>] (from pipeline/)"), call. = FALSE)
  }
  reste <- args[-1L]
  confirmer <- character(); retirer <- character(); ids <- character()
  i <- 1L
  while (i <= length(reste)) {
    token <- reste[[i]]
    if (identical(token, "--confirm-definition") || identical(token, "--retire")) {
      if (i == length(reste)) stop("Missing id after ", token, call. = FALSE)
      if (identical(token, "--confirm-definition")) confirmer <- c(confirmer, reste[[i + 1L]])
      else retirer <- c(retirer, reste[[i + 1L]])
      i <- i + 2L
    } else {
      ids <- c(ids, token)
      i <- i + 1L
    }
  }
  if (length(ids) && length(retirer))
    stop("--retire cannot be mixed with normal apply ids in one command", call. = FALSE)
  cibles <- c(ids, retirer)
  if (!length(cibles)) stop("apply requires at least one resource id", call. = FALSE)
  resultat <- apply_publication(
    cibles,
    confirm_definition = confirmer,
    retire = length(retirer) > 0L,
    commit_sha = Sys.getenv("GITHUB_SHA", unset = ""))
  for (recette in resultat$receipts) {
    cat(sprintf("applied %s %s %s -> %s\n", recette$ressource, recette$operation,
                if (is.null(recette$old_version)) "none" else recette$old_version,
                recette$new_version))
  }
} else {
  stop(paste0("Usage: Rscript scripts/publication.R split <sortie> | ",
       "plan [sortie] | adopt <sortie> [--dry-run] | ",
       "apply <ids...> [--confirm-definition <id>] [--retire <id>]"),
       call. = FALSE)
}
