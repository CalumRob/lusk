# checkpoint -------------------------------------------------------------------
# Le point de contrôle validé (issue #325) : les intermédiaires des builders
# (data/processed/milieux/consoenaf_communes.rds, ocsge_communes.rds) étaient
# des sorties write-only — écrits à chaque run, jamais relus. Pour Milieux,
# c'est la boucle des HUIT archives OCS-GE (~1,7 Go, 30-45 min) re-traitée à
# chaque régénération de payload, même quand rien n'a changé dans la couche
# construite.
# La GARDE : une empreinte qui couvre les ENTRÉES (chemin|taille|mtime) ET le
# CODE PRODUCTEUR (les corps + formals déparsés d'une liste DÉCLARÉE de
# fonctions de la couche construire). Un « réutiliser si existe » naïf est
# interdit — le piège de fraîcheur du 08-08 : les intermédiaires du checkout
# principal étaient périmés parce que le CODE avait changé (patch correctif
# M2, #243), pas les entrées. Un contrôle sur les seuls mtime des entrées
# aurait servi des états pré-patch comme frais.
# Le périmètre de la liste déclarée EST la couche construire (jamais la couche
# compute — le cas #306 : un changement compute seul, ex. publier
# taux_variation_population sur l'histoire, garde le point de contrôle valide).
# Un fichier ancien sans empreinte, ou corrompu, n'est JAMAIS servi : il est
# reconstruit (le miroir de verifier_fichier, download.R — un .rds corrompu
# n'est pas traité comme complet pour toujours).

# empreinte_fonctions ----------------------------------------------------------
# L'empreinte du CODE producteur : le hash des corps + formals (deparse) d'une
# liste DÉCLARÉE de fonctions du package (l'ordre et les noms comptent — le
# vecteur est haché avec eux). Une fonction déclarée ABSENTE du package échoue
# bruyamment (un nom qui disparaît doit être visible, jamais un hash qui change
# en silence). L'empreinte lit le namespace VIVANT : un mock de test (ou un
# rechargement de code) qui remplace le corps d'une fonction déclarée change
# l'empreinte — c'est le levier des tests du critère 3. Le hash rlang est
# stable entre sessions pour le même objet (vérifié — c'est la condition du
# skip d'un run à l'autre).
empreinte_fonctions <- function(noms, env = asNamespace("lusk")) {
  corps <- vapply(noms, function(nm) {
    objet <- get(nm, envir = env)
    if (is.function(objet)) {
      paste(deparse(body(objet)), collapse = "\n")
    } else {
      # une constante déclarée (rare) : son VALEUR déparsée compte — le même
      # mécanisme que les fonctions, rien de spécial à apprendre
      paste(deparse(objet), collapse = "\n")
    }
  }, character(1))
  formes <- vapply(noms, function(nm) {
    objet <- get(nm, envir = env)
    if (is.function(objet)) {
      paste(deparse(formals(objet)), collapse = "\n")
    } else {
      ""
    }
  }, character(1))
  rlang::hash(list(corps = corps, formes = formes))
}

# empreinte_entrees ------------------------------------------------------------
# L'empreinte des ENTRÉES : le hash (chemin|taille|mtime) de chaque fichier —
# l'heure en UTC (la même chaîne sur toutes les machines), la taille et le
# mtime. Un fichier ABSENT est marqué « ABSENT » (stable) : l'apparition d'un
# fichier change l'empreinte, sa disparition aussi — l'empreinte couvre toute
# la durée de vie du cache, pas seulement ce qui existe aujourd'hui. Le chemin
# compte : deux caches différents ne croisent jamais leurs empreintes.
empreinte_entrees <- function(chemins) {
  empreintes <- vapply(chemins, function(chemin) {
    if (!file.exists(chemin)) return("ABSENT")
    paste0(
      chemin, "|", file.size(chemin), "|",
      format(file.mtime(chemin), tz = "UTC", usetz = TRUE)
    )
  }, character(1))
  rlang::hash(empreintes)
}

# empreinte_checkpoint ---------------------------------------------------------
# L'empreinte COMBINÉE du point de contrôle : entrées ET code producteur — les
# deux volets de la garde, hachés ensemble. C'est cette chaîne qui est tamponnée
# sur l'intermédiaire.
empreinte_checkpoint <- function(entrees, fonctions) {
  rlang::hash(c(
    entrees = empreinte_entrees(entrees),
    fonctions = empreinte_fonctions(fonctions)
  ))
}

# lire_et_verifier -------------------------------------------------------------
# La relecture GARDÉE d'un intermédiaire : le fichier est servi SEULEMENT s'il
# existe et porte l'empreinte COURANTE (fraîche). NULL sinon — le signal
# « reconstruire ». Le miroir de verifier_fichier (download.R) : un .rds
# corrompu (readRDS en erreur), vide ou absent n'est jamais servi en silence —
# il est reconstruit. Un fichier valide mais SANS l'empreinte (un intermédiaire
# d'un build pré-checkpoint) est traité comme périmé : reconstruit, jamais
# servi.
lire_et_verifier <- function(sortie, empreinte) {
  if (!file.exists(sortie)) return(NULL)
  x <- tryCatch(readRDS(sortie), error = function(e) NULL)
  if (is.null(x)) return(NULL)  # corrompu — jamais servi
  if (!identical(attr(x, "empreinte"), empreinte)) return(NULL)
  x
}

# construire_avec_point_de_controle --------------------------------------------
# Le helper GÉNÉRIQUE du point de contrôle (réutilisable par les autres thèmes
# dans des issues ultérieures) : enveloppe un construire() lourd.
#   - sortie    : le chemin de l'intermédiaire (.rds) ;
#   - entrees   : les chemins des fichiers d'entrée (empreinte_entrees) ;
#   - fonctions : la liste DÉCLARÉE des fonctions productrices (la couche
#     construire — jamais la couche compute) ;
#   - construire: la closure du passage lourd.
# Si sortie existe ET porte l'empreinte courante -> readRDS et retour (le
# passage lourd est SAUTÉ — la régénération chirurgicale). Sinon construire(),
# tamponner attr(x, "empreinte"), écrire, retourner. Un fichier ancien sans
# empreinte ou corrompu -> reconstruire, jamais servi en silence. L'idempotence
# est préservée : le chemin skip relit exactement ce que le chemin frais a
# écrit (table identique, .rds byte-égal).
# Le tampon vit DANS le fichier, jamais sur la table retournée : le attr est
# posé avant l'écriture (il voyage avec la donnée — une restauration d'un
# .rds ancien ne peut pas désynchroniser l'empreinte du fichier) puis retiré
# avant le retour (le tampon est de la machinerie, pas de la donnée — il ne
# doit pas polluer les tables qui descendent dans le payload).
construire_avec_point_de_controle <- function(sortie, entrees, fonctions,
                                              construire) {
  empreinte <- empreinte_checkpoint(entrees, fonctions)
  relu <- lire_et_verifier(sortie, empreinte)
  if (!is.null(relu)) {
    attr(relu, "empreinte") <- NULL
    return(relu)
  }

  x <- construire()
  attr(x, "empreinte") <- empreinte
  if (!dir.exists(dirname(sortie))) dir.create(dirname(sortie), recursive = TRUE)
  readr::write_rds(x, sortie)
  attr(x, "empreinte") <- NULL
  x
}
