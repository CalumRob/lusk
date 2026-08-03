# diff_skip ------------------------------------------------------------------
# Le helper diff-and-skip du workflow (issue #10, ADR-0004) : décider s'il y a
# quelque chose à publier. Le workflow compare le payload frais (nouveau) au
# payload committé (commite) et ne committe que si la donnée a changé —
# « rien à publier » sinon : pas de commits vides hebdomadaires, pas de
# redeploiement Pages pour une donnée identique (ADR-0004).
# Décision PAR CONTENU (empreintes md5), jamais par date : deux runs
# identiques produisent des fichiers identiques — c'est ce qui rend le skip
# possible malgré un rebuild complet à chaque run (un checkout frais n'a pas
# de cache data/raw).
# Le rapport de run (run-report.json) n'entre PAS dans la décision : il porte
# un horodatage par run, il différerait donc toujours — « rien à publier »
# veut dire « la donnée n'a pas changé » ; le rapport est committé avec le
# payload quand celui-ci change.

# detecter_changement : TRUE = « payload changé — à committer » ; FALSE =
# « rien à publier ». Compare par empreinte md5 chaque fichier présent d'un
# côté ou de l'autre ; un fichier absent d'un seul côté est un changement.
# Le home du payload est plat (les tables + les projections + vintages) —
# la comparaison ne descend pas dans les sous-dossiers.
detecter_changement <- function(nouveau, commite) {
  fichiers <- setdiff(
    union(list.files(nouveau), list.files(commite)),
    "run-report.json"
  )
  if (length(fichiers) == 0) return(FALSE)

  empreintes <- function(rep) {
    vapply(fichiers, function(f) {
      chemin <- file.path(rep, f)
      if (!file.exists(chemin)) return(NA_character_)
      unname(tools::md5sum(chemin))
    }, character(1))
  }

  !identical(empreintes(nouveau), empreintes(commite))
}
