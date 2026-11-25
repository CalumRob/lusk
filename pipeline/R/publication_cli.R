# Entrées CLI de `scripts/publication.R` (ADR-0049 step 2, #1135-#1142).
#
# Le script n'est qu'un dispatcheur : TOUT le comportement vit ici, dans des
# fonctions que les tests (y compris les épreuves gardées PostgreSQL) appellent
# exactement comme l'opérateur. Les commandes qui touchent la base (`adopt`,
# `apply`, `listing`) partagent les MÊMES options d'injection — `lock`, `registre`,
# `con`, `root`, `receipts_dir`, `commit_sha` — avec les MÊMES défauts (NULL :
# `lire_lock()` et la configuration de service du seam partagé). Aucune n'a une
# option que l'autre n'a pas.
#
#   split <sortie>                     artefacts de ressource immuables
#   plan [sortie]                      plan en LECTURE SEULE ; ne se connecte JAMAIS
#                                      (contrat #1136) ; source vive = fichier
#                                      LUSK_LIVE_LISTING
#   listing                            liste (ressource, version) du REGISTRE vivant
#                                      sur stdout, en lecture seule, via le seam de
#                                      session partagé ; sa sortie EST le fichier
#                                      LUSK_LIVE_LISTING de `plan`
#   adopt <sortie> [--dry-run]         prouve puis enregistre (registre + descripteurs
#                                      + reçus, une transaction)
#   apply <ids...> [--confirm-definition <id>] [--retire <id>]

usage_publication <- paste0("Usage: Rscript scripts/publication.R split <sortie> | ",
  "plan [sortie] | listing | adopt <sortie> [--dry-run] | ",
  "apply <ids...> [--confirm-definition <id>] [--retire <id>] (from pipeline/)")

commande_publication_split <- function(args, root = NULL, out = stdout()) {
  if (length(args) != 2L) stop("Usage: Rscript scripts/publication.R split <sortie> (from pipeline/)",
                               call. = FALSE)
  resultat <- splitter_sortie(args[[2L]], root = root)
  for (i in seq_len(nrow(resultat)))
    cat(sprintf("%s, %s, %s, %s\n", resultat$ressource[[i]], resultat$forme[[i]],
                resultat$version[[i]], resultat$statut[[i]]), file = out)
  invisible(resultat)
}

# `plan` ne se connecte jamais : le listing vif est un fichier explicite.
commande_publication_plan <- function(args, root = NULL, lock = NULL, registre = NULL,
                                      live = Sys.getenv("LUSK_LIVE_LISTING", unset = ""),
                                      out = stdout()) {
  if (length(args) > 2L)
    stop("Usage: Rscript scripts/publication.R plan [sortie] (from pipeline/)", call. = FALSE)
  sortie <- if (length(args) == 2L) args[[2L]] else ""
  plan <- plan_publication(root = root, live = live, lock = lock, registre = registre,
    attributions = if (nzchar(sortie)) sortie else NULL)
  imprimer_plan_publication(plan, con = out)
  invisible(plan)
}

# Listing vivant du registre (lister_registre_publication, apply_publication.R),
# imprimé en JSON : le format que lit lire_listing_live_fichier().
commande_publication_listing <- function(args, lock = NULL, registre = NULL, con = NULL,
                                         out = stdout()) {
  if (length(args) != 1L)
    stop("Usage: Rscript scripts/publication.R listing (from pipeline/)", call. = FALSE)
  listing <- lister_registre_publication(lock = lock, registre = registre, con = con)
  cat(as.character(jsonlite::toJSON(
    data.frame(ressource = as.character(listing$ressource),
               version = as.character(listing$version), stringsAsFactors = FALSE),
    dataframe = "rows", auto_unbox = TRUE)), "\n", sep = "", file = out)
  invisible(listing)
}

commande_publication_adopt <- function(args, root = NULL, lock = NULL, registre = NULL,
                                       con = NULL, receipts_dir = NULL,
                                       commit_sha = Sys.getenv("GITHUB_SHA", unset = ""),
                                       projections = NULL, reference = NULL, digests = NULL,
                                       metadata_directory = NULL, out = stdout()) {
  usage <- "Usage: Rscript scripts/publication.R adopt <sortie> [--dry-run] (from pipeline/)"
  if (!length(args) %in% 2:3 || (length(args) == 3L && !identical(args[[3L]], "--dry-run")))
    stop(usage, call. = FALSE)
  resultat <- adopter_ressources(args[[2L]], dry_run = "--dry-run" %in% args, root = root,
    lock = lock, registre = registre, con = con, receipts_dir = receipts_dir,
    commit_sha = commit_sha, projections = projections, reference = reference,
    digests = digests, metadata_directory = metadata_directory)
  imprimer_adoption(resultat, con = out)
  invisible(resultat)
}

commande_publication_apply <- function(args, root = NULL, lock = NULL, registre = NULL,
                                       con = NULL, receipts_dir = NULL,
                                       commit_sha = Sys.getenv("GITHUB_SHA", unset = ""),
                                       out = stdout()) {
  if (length(args) < 2L)
    stop(paste0("Usage: Rscript scripts/publication.R apply <ids...> ",
      "[--confirm-definition <id>] [--retire <id>] (from pipeline/)"), call. = FALSE)
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
  resultat <- apply_publication(cibles, confirm_definition = confirmer,
    retire = length(retirer) > 0L, root = root, lock = lock, registre = registre, con = con,
    receipts_dir = receipts_dir, commit_sha = commit_sha)
  for (recette in resultat$receipts)
    cat(sprintf("applied %s %s %s -> %s\n", recette$ressource, recette$operation,
                if (is.null(recette$old_version)) "none" else recette$old_version,
                recette$new_version), file = out)
  invisible(resultat)
}

# Dispatcheur UNIQUE : `scripts/publication.R` l'appelle avec commandArgs ; les
# tests l'appellent avec les mêmes arguments et leurs injections.
executer_commande_publication <- function(args, ...) {
  commande <- if (length(args)) args[[1L]] else ""
  fonction <- switch(commande, split = commande_publication_split,
    plan = commande_publication_plan, listing = commande_publication_listing,
    adopt = commande_publication_adopt, apply = commande_publication_apply, NULL)
  if (is.null(fonction)) stop(usage_publication, call. = FALSE)
  fonction(args, ...)
}
