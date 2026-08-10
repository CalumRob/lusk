# test-checkpoint ---------------------------------------------------------------
# Le point de contrôle validé (issue #325) : les builders Milieux re-traitaient
# la boucle OCS-GE (~1,7 Go, 30-45 min) à CHAQUE run — les intermédiaires
# (consoenaf_communes.rds, ocsge_communes.rds) étaient écrits mais jamais relus
# (des sorties write-only). La garde : une empreinte qui couvre les ENTRÉES
# (chemin|taille|mtime) ET le CODE producteur (les corps déparsés de la liste
# DÉCLARÉE des fonctions de la couche construire). Un « réutiliser si existe »
# naïf est interdit (le piège de fraîcheur du 08-08 : le code avait changé —
# patch correctif M2, #243 — pas les entrées). Un changement de la couche
# COMPUTE seule (ex. #306) doit garder le point de contrôle valide.
# Tests sur fixtures, jamais de réseau (la convention du pipeline).

# fermeture_appels_pipeline : la fermeture TRANSITIVE des fonctions du package
# appelées depuis des racines — le parcours de codetools::findGlobals. Les
# appels qualifiés (pkg::fun) sont portés par `::` (jamais le nom du package),
# les variables globales (MANIFEST_MILIEUX...) ne sont pas des fonctions : le
# filtre sur les fonctions du namespace du package garde les internes du
# pipeline, rien d'autre.
fermeture_appels_pipeline <- function(noms_racine) {
  ns <- asNamespace("lusk")
  fonctions_package <- ls(ns, all.names = TRUE)
  fonctions_package <- fonctions_package[
    vapply(fonctions_package, function(nm) is.function(get(nm, envir = ns)),
           logical(1))
  ]
  vus <- character(0)
  file <- unique(noms_racine)
  while (length(file) > 0) {
    nm <- file[1]
    file <- file[-1]
    if (nm %in% vus) next
    vus <- c(vus, nm)
    globals <- codetools::findGlobals(get(nm, envir = ns), merge = FALSE)
    internes <- intersect(globals$functions, fonctions_package)
    file <- c(file, setdiff(internes, vus))
  }
  setdiff(vus, noms_racine)
}

# La machinerie du point de contrôle : générique, pas de la couche construire —
# son code ne produit pas la donnée (un changement de la machinerie s'invalide
# LUI-MÊME : la nouvelle empreinte diffère de la stockée -> reconstruction).
# Les ENVELOPPES (construire_donnees_milieux / construire_donnees_ocsge) sont
# de la machinerie : leur câblage (sortie, entrees, fonctions) est l'empreinte
# elle-même — un changement de câblage change l'empreinte et reconstruit.
machinerie_point_de_controle <- c(
  "construire_donnees_milieux", "construire_donnees_ocsge",
  "construire_avec_point_de_controle", "empreinte_checkpoint",
  "empreinte_fonctions", "empreinte_entrees", "lire_et_verifier",
  "entrees_construire_milieux"
)

# La garde de la liste ----------------------------------------------------------
# Le compagnon du critère 7 : chaque fonction de la couche construire appelée
# (transitivement) par les builders enveloppés DOIT être déclarée à
# l'empreinte — une fonction oubliée (un helper nouveau, un refactor) casse ce
# test, JAMAIS la donnée (un corps non déclaré changerait la sortie sans
# invalider le point de contrôle).

test_that("garde de la liste : la fermeture construire des builders enveloppés est DÉCLARÉE", {
  internes <- fermeture_appels_pipeline(
    c("construire_donnees_milieux_interne", "construire_donnees_ocsge_interne")
  )
  oubliees <- setdiff(internes, c(FONCTIONS_CONSTRIRE_MILIEUX,
                                  machinerie_point_de_controle))
  expect_true(length(oubliees) == 0L, info = paste0(
    "Fonctions de la couche construire non déclarées au point de contrôle : ",
    paste(oubliees, collapse = ", ")))

  # les racines enveloppées sont déclarées par construction (elles sont les
  # ancres de l'empreinte — un retrait accidentel de l'une casse le test, la
  # garde n'est pas contournable en sortant la racine de la fermeture)
  expect_true(all(c("construire_donnees_milieux_interne",
                    "construire_donnees_ocsge_interne") %in%
                    FONCTIONS_CONSTRIRE_MILIEUX))

  # la chaîne est vivante : le parcours atteint la machinerie (les builders
  # enveloppés l'appellent) — la garde ne tourne pas à vide. La seconde
  # enveloppe (construire_donnees_milieux) n'est pas atteinte depuis les
  # racines internes (l'interne l'appelle, jamais l'inverse) — elle n'est
  # exclue que par défense.
  expect_true(all(c(
    "construire_donnees_ocsge", "construire_avec_point_de_controle",
    "empreinte_checkpoint", "empreinte_fonctions", "empreinte_entrees",
    "lire_et_verifier", "entrees_construire_milieux"
  ) %in% internes))

  # le point de conception #306 : la couche compute n'entre JAMAIS dans la
  # liste déclarée — un changement compute seul garde le point de contrôle
  # valide (le cas chirurgical)
  expect_false("compute_histoires_milieux" %in% FONCTIONS_CONSTRIRE_MILIEUX)

  # les helpers de manifeste sont déclarés : le fichier épinglé (le nom des
  # archives OCS-GE / patchs, construit par ces fonctions au chargement) fait
  # partie de la donnée construite
  expect_true(all(c("ligne_ocsge_etat", "ligne_ocsge_patch") %in%
                    FONCTIONS_CONSTRIRE_MILIEUX))
})

# empreinte_fonctions -----------------------------------------------------------

test_that("empreinte_fonctions : stable, sensible au corps, aux formals et à l'ordre", {
  noms <- c("lire_consoenaf", "normaliser_consoenaf")
  e1 <- empreinte_fonctions(noms)
  e2 <- empreinte_fonctions(noms)
  expect_identical(e1, e2)  # déterministe

  # un corps différent -> empreinte différente (le cœur de la garde)
  lire_origine <- lire_consoenaf
  local_mocked_bindings(
    lire_consoenaf = function(chemin) lire_origine(chemin),
    .package = "lusk"
  )
  e3 <- empreinte_fonctions(noms)
  expect_false(identical(e1, e3))

  # des formals différents -> empreinte différente (même corps)
  local_mocked_bindings(
    lire_consoenaf = function(chemin, extra = TRUE) lire_origine(chemin),
    .package = "lusk"
  )
  e4 <- empreinte_fonctions(noms)
  expect_false(identical(e1, e4))

  # l'ordre compte (la liste est hachée avec l'ordre de ses noms)
  expect_false(identical(e1, empreinte_fonctions(rev(noms))))

  # une fonction déclarée ABSENTE du package échoue bruyamment (un nom qui
  # disparaît doit être visible, jamais un hash qui change en silence)
  expect_error(empreinte_fonctions(c("lire_consoenaf", "n_existe_pas")),
               "n_existe_pas")
})

test_that("empreinte_fonctions : une fonction NON déclarée n'entre pas dans l'empreinte (le cas #306)", {
  e1 <- empreinte_fonctions(FONCTIONS_CONSTRIRE_MILIEUX)
  local_mocked_bindings(
    compute_histoires_milieux = function(territoires) territoires,
    .package = "lusk"
  )
  e2 <- empreinte_fonctions(FONCTIONS_CONSTRIRE_MILIEUX)
  expect_identical(e1, e2)
})

# empreinte_entrees -------------------------------------------------------------

test_that("empreinte_entrees : (chemin|taille|mtime) — sensible au contenu et au mtime seul", {
  rep <- tempfile("entrees-")
  dir.create(rep)
  on.exit(unlink(rep, recursive = TRUE))
  f <- file.path(rep, "a.csv")
  writeLines("x", f)
  e1 <- empreinte_entrees(f)
  expect_identical(e1, empreinte_entrees(f))  # déterministe

  # le contenu change (la taille) -> empreinte différente
  writeLines("xy", f)
  e2 <- empreinte_entrees(f)
  expect_false(identical(e1, e2))

  # le mtime SEUL change -> empreinte différente (le fichier est re-touché)
  Sys.setFileTime(f, file.mtime(f) + 5)
  e3 <- empreinte_entrees(f)
  expect_false(identical(e2, e3))

  # un fichier absent est toléré (marqueur stable — l'empreinte couvre aussi
  # les entrées absentes du cache : leur apparition change l'empreinte)
  absent <- file.path(rep, "absent.7z")
  expect_identical(empreinte_entrees(absent), empreinte_entrees(absent))
  expect_false(identical(empreinte_entrees(absent), e1))
})

# construire_avec_point_de_controle (unité) -------------------------------------
# Le helper générique, prouvé sur un construire trivial avec un compteur
# espion : frais -> skip quand entrées + code inchangés, reconstruction sur
# entrée touchée, sur fichier sans empreinte et sur fichier corrompu.

test_that("construire_avec_point_de_controle : frais puis SKIP (table identique, rds byte-égal)", {
  rep <- tempfile("checkpoint-")
  dir.create(rep)
  on.exit(unlink(rep, recursive = TRUE))
  sortie <- file.path(rep, "out.rds")
  entree <- file.path(rep, "in.csv")
  writeLines("a", entree)
  compteur <- 0L
  construire <- function() {
    compteur <<- compteur + 1L
    tibble::tibble(x = 1:3, y = letters[1:3])
  }

  premier <- construire_avec_point_de_controle(
    sortie, entree, c("lire_consoenaf"), construire)
  expect_equal(compteur, 1L)
  # l'empreinte courante est tamponnée DANS le fichier (le point de contrôle),
  # jamais sur la table retournée (le tampon n'est pas de la donnée)
  expect_identical(attr(premier, "empreinte"), NULL)
  expect_identical(attr(readr::read_rds(sortie), "empreinte"),
                   empreinte_checkpoint(entree, c("lire_consoenaf")))

  second <- construire_avec_point_de_controle(
    sortie, entree, c("lire_consoenaf"), construire)
  expect_equal(compteur, 1L)          # le passage lourd a été SAUTÉ
  expect_identical(second, premier)   # la même table (critère 8)
  # le fichier relu par le skip est exactement celui écrit par le frais
  # (rds byte-égal, critère 1) : même tampon, même contenu
  expect_identical(attr(readr::read_rds(sortie), "empreinte"),
                   empreinte_checkpoint(entree, c("lire_consoenaf")))
})

test_that("construire_avec_point_de_controle : une entrée touchée force la reconstruction", {
  rep <- tempfile("checkpoint-")
  dir.create(rep)
  on.exit(unlink(rep, recursive = TRUE))
  sortie <- file.path(rep, "out.rds")
  entree <- file.path(rep, "in.csv")
  writeLines("a", entree)
  compteur <- 0L
  construire <- function() {
    compteur <<- compteur + 1L
    tibble::tibble(x = 1:3)
  }

  construire_avec_point_de_controle(sortie, entree, c("lire_consoenaf"), construire)
  Sys.setFileTime(entree, file.mtime(entree) + 5)  # toucher une entrée
  construire_avec_point_de_controle(sortie, entree, c("lire_consoenaf"), construire)
  expect_equal(compteur, 2L)  # reconstruit
})

test_that("construire_avec_point_de_controle : un fichier ancien SANS empreinte n'est jamais servi", {
  rep <- tempfile("checkpoint-")
  dir.create(rep)
  on.exit(unlink(rep, recursive = TRUE))
  sortie <- file.path(rep, "out.rds")
  entree <- file.path(rep, "in.csv")
  writeLines("a", entree)
  compteur <- 0L
  construire <- function() {
    compteur <<- compteur + 1L
    tibble::tibble(x = 1:3)
  }

  construire_avec_point_de_controle(sortie, entree, c("lire_consoenaf"), construire)
  # simuler un intermédiaire écrit par un build pré-checkpoint : l'empreinte
  # est retirée du fichier
  x <- readRDS(sortie)
  attr(x, "empreinte") <- NULL
  readr::write_rds(x, sortie)
  construire_avec_point_de_controle(sortie, entree, c("lire_consoenaf"), construire)
  expect_equal(compteur, 2L)  # reconstruit — jamais servi en silence
})

test_that("construire_avec_point_de_controle : un .rds corrompu n'est jamais servi — reconstruction", {
  rep <- tempfile("checkpoint-")
  dir.create(rep)
  on.exit(unlink(rep, recursive = TRUE))
  sortie <- file.path(rep, "out.rds")
  entree <- file.path(rep, "in.csv")
  writeLines("a", entree)
  compteur <- 0L
  construire <- function() {
    compteur <<- compteur + 1L
    tibble::tibble(x = 1:3)
  }

  construire_avec_point_de_controle(sortie, entree, c("lire_consoenaf"), construire)
  writeBin(as.raw(c(0xde, 0xad, 0xbe)), sortie)  # corrompu (3 octets)
  second <- construire_avec_point_de_controle(
    sortie, entree, c("lire_consoenaf"), construire)
  expect_equal(compteur, 2L)   # reconstruit — le corrompu n'a pas été lu
  frais <- readr::read_rds(sortie)
  attr(frais, "empreinte") <- NULL  # le tampon n'est pas de la donnée
  expect_identical(frais, second)   # le fichier est réécrit frais
})

# Les critères d'acceptation au niveau des builders -----------------------------
# Prouvés sur le cache du fixture OCS-GE complet (cache_ocsge_milieux) avec un
# compteur espion sur lire_ocsge_artificialisation : chaque build frais lit les
# HUIT archives (le passage lourd), un skip n'en lit AUCUNE.

test_that("AC1 : second run (entrées + code inchangés) SAUTE le passage lourd et retourne la même table", {
  cache <- cache_ocsge_milieux()
  on.exit(unlink(cache, recursive = TRUE))
  sortie <- tempfile(fileext = ".rds")
  on.exit(unlink(sortie))
  compteur <- 0L
  lire_origine <- lire_ocsge_artificialisation
  local_mocked_bindings(
    lire_epci = function(chemin) base_epci_milieux_ocsge,
    lire_ocsge_artificialisation = function(chemin,
                                            couche = COUCHE_OCSGE_ARTIFICIALISATION) {
      compteur <<- compteur + 1L
      lire_origine(chemin, couche)
    },
    .package = "lusk"
  )

  premier <- construire_donnees_milieux(cache = cache, sortie = sortie)
  premier_nb <- compteur
  expect_gt(premier_nb, 0L)  # le passage lourd a tourné (les huit archives)

  second <- construire_donnees_milieux(cache = cache, sortie = sortie)
  expect_identical(compteur, premier_nb)  # SAUTÉ — aucune archive relue
  expect_identical(second, premier)       # la même table (critère 8)
  # le .rds servi par le skip porte le tampon COURANT (le point de contrôle
  # est valide — rds byte-égal, critère 1)
  expect_identical(attr(readr::read_rds(sortie), "empreinte"),
                   empreinte_checkpoint(entrees_construire_milieux(cache),
                                        FONCTIONS_CONSTRIRE_MILIEUX))
})

test_that("AC2 : toucher un fichier d'entrée force la reconstruction", {
  cache <- cache_ocsge_milieux()
  on.exit(unlink(cache, recursive = TRUE))
  sortie <- tempfile(fileext = ".rds")
  on.exit(unlink(sortie))
  compteur <- 0L
  lire_origine <- lire_ocsge_artificialisation
  local_mocked_bindings(
    lire_epci = function(chemin) base_epci_milieux_ocsge,
    lire_ocsge_artificialisation = function(chemin,
                                            couche = COUCHE_OCSGE_ARTIFICIALISATION) {
      compteur <<- compteur + 1L
      lire_origine(chemin, couche)
    },
    .package = "lusk"
  )

  premier <- construire_donnees_milieux(cache = cache, sortie = sortie)
  premier_nb <- compteur

  conso <- file.path(cache, "conso-com.csv")
  write("\n", conso, append = TRUE)  # toucher le CSV d'entrée (taille)

  second <- construire_donnees_milieux(cache = cache, sortie = sortie)
  expect_gt(compteur, premier_nb)  # reconstruit — le passage lourd a re-tourné
})

test_that("AC3 : éditer le corps d'une fonction construire DÉCLARÉE force la reconstruction", {
  cache <- cache_ocsge_milieux()
  on.exit(unlink(cache, recursive = TRUE))
  sortie <- tempfile(fileext = ".rds")
  on.exit(unlink(sortie))
  compteur <- 0L
  lire_origine <- lire_ocsge_artificialisation
  normaliser_origine <- normaliser_consoenaf
  local_mocked_bindings(
    lire_epci = function(chemin) base_epci_milieux_ocsge,
    lire_ocsge_artificialisation = function(chemin,
                                            couche = COUCHE_OCSGE_ARTIFICIALISATION) {
      compteur <<- compteur + 1L
      lire_origine(chemin, couche)
    },
    .package = "lusk"
  )

  premier <- construire_donnees_milieux(cache = cache, sortie = sortie)
  premier_nb <- compteur

  # simuler un patch de la couche construire : le corps d'une fonction
  # DÉCLARÉE change (le même comportement, un corps différent)
  local_mocked_bindings(
    normaliser_consoenaf = function(table_conso) normaliser_origine(table_conso),
    .package = "lusk"
  )

  second <- construire_donnees_milieux(cache = cache, sortie = sortie)
  expect_gt(compteur, premier_nb)  # reconstruit — l'empreinte du code a changé
})

test_that("AC4 : éditer compute_histoires_milieux (NON déclarée) garde le point de contrôle valide — SKIP (#306)", {
  cache <- cache_ocsge_milieux()
  on.exit(unlink(cache, recursive = TRUE))
  sortie <- tempfile(fileext = ".rds")
  on.exit(unlink(sortie))
  compteur <- 0L
  lire_origine <- lire_ocsge_artificialisation
  local_mocked_bindings(
    lire_epci = function(chemin) base_epci_milieux_ocsge,
    lire_ocsge_artificialisation = function(chemin,
                                            couche = COUCHE_OCSGE_ARTIFICIALISATION) {
      compteur <<- compteur + 1L
      lire_origine(chemin, couche)
    },
    .package = "lusk"
  )

  premier <- construire_donnees_milieux(cache = cache, sortie = sortie)
  premier_nb <- compteur

  # simuler le patch #306 : un changement de la couche COMPUTE seule
  local_mocked_bindings(
    compute_histoires_milieux = function(territoires) territoires,
    .package = "lusk"
  )

  second <- construire_donnees_milieux(cache = cache, sortie = sortie)
  expect_identical(compteur, premier_nb)  # TOUJOURS skip — le cas chirurgical
  expect_identical(second, premier)       # la même table (critère 8)
})

test_that("AC5 : un intermédiaire ancien SANS empreinte n'est jamais servi — reconstruction", {
  # le cache simple (sans archives OCS-GE) : la reconstruction de l'enveloppe
  # se prouve sur lire_consoenaf (appelée une fois par build frais) — le point
  # de contrôle INTERNE ne vient pas brouiller le compteur
  cache <- tempfile("cache-milieux-")
  dir.create(cache)
  on.exit(unlink(cache, recursive = TRUE))
  file.copy(
    testthat::test_path("fixtures", "consoenaf-fixture.csv"),
    file.path(cache, "conso-com.csv"), overwrite = TRUE
  )
  copier_fixture_serie_historique(cache)
  sortie <- tempfile(fileext = ".rds")
  on.exit(unlink(sortie))
  compteur <- 0L
  lire_origine <- lire_consoenaf
  local_mocked_bindings(
    lire_epci = function(chemin) base_epci_milieux,
    lire_consoenaf = function(chemin) {
      compteur <<- compteur + 1L
      lire_origine(chemin)
    },
    .package = "lusk"
  )

  premier <- construire_donnees_milieux(cache = cache, sortie = sortie)
  expect_equal(compteur, 1L)
  expect_false(is.null(attr(readRDS(sortie), "empreinte")))

  # l'intermédiaire d'un build pré-checkpoint : la table sans empreinte
  x <- readRDS(sortie)
  attr(x, "empreinte") <- NULL
  readr::write_rds(x, sortie)

  second <- construire_donnees_milieux(cache = cache, sortie = sortie)
  expect_equal(compteur, 2L)          # reconstruit — jamais servi
  expect_identical(second, premier)
})

test_that("AC6 : un intermédiaire CORROMPU n'est jamais servi en silence — reconstruction", {
  cache <- tempfile("cache-milieux-")
  dir.create(cache)
  on.exit(unlink(cache, recursive = TRUE))
  file.copy(
    testthat::test_path("fixtures", "consoenaf-fixture.csv"),
    file.path(cache, "conso-com.csv"), overwrite = TRUE
  )
  copier_fixture_serie_historique(cache)
  sortie <- tempfile(fileext = ".rds")
  on.exit(unlink(sortie))
  compteur <- 0L
  lire_origine <- lire_consoenaf
  local_mocked_bindings(
    lire_epci = function(chemin) base_epci_milieux,
    lire_consoenaf = function(chemin) {
      compteur <<- compteur + 1L
      lire_origine(chemin)
    },
    .package = "lusk"
  )

  premier <- construire_donnees_milieux(cache = cache, sortie = sortie)
  expect_equal(compteur, 1L)

  writeBin(as.raw(c(0xde, 0xad, 0xbe, 0xef)), sortie)  # .rds corrompu

  second <- construire_donnees_milieux(cache = cache, sortie = sortie)
  expect_equal(compteur, 2L)          # reconstruit — le corrompu n'a pas été lu
  expect_identical(second, premier)
})

test_that("le point de contrôle interne (ocsge_communes.rds) : un sortie ocsge fraîche est réutilisée quand la sortie principale a disparu", {
  cache <- cache_ocsge_milieux()
  on.exit(unlink(cache, recursive = TRUE))
  sortie <- tempfile(fileext = ".rds")
  on.exit(unlink(sortie))
  ocsge_sortie <- file.path(dirname(sortie), "ocsge_communes.rds")
  on.exit(unlink(ocsge_sortie))
  compteur <- 0L
  lire_origine <- lire_ocsge_artificialisation
  local_mocked_bindings(
    lire_epci = function(chemin) base_epci_milieux_ocsge,
    lire_ocsge_artificialisation = function(chemin,
                                            couche = COUCHE_OCSGE_ARTIFICIALISATION) {
      compteur <<- compteur + 1L
      lire_origine(chemin, couche)
    },
    .package = "lusk"
  )

  premier <- construire_donnees_milieux(cache = cache, sortie = sortie)
  premier_nb <- compteur
  expect_true(file.exists(ocsge_sortie))  # le point de contrôle interne est écrit

  # la sortie principale disparaît (un nettoyage partiel), l'intermédiaire
  # ocsge reste FRAIS : la reconstruction du builder re-saute la boucle GPKG
  unlink(sortie)
  second <- construire_donnees_milieux(cache = cache, sortie = sortie)
  expect_identical(compteur, premier_nb)  # le passage lourd est resté sauté
  expect_identical(second, premier)
})
