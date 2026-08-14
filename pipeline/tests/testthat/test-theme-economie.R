# test-theme-economie -----------------------------------------------------------
# Le descripteur du thème Économie/Emploi (issue #96, gate A) : la même forme de
# contrat que theme_demographie() / theme_habitat() — tout ce que la machinerie
# partagée doit savoir pour faire tourner Économie sans jamais nommer le thème :
# le manifeste concaténé (SIRENE + Flores A38/A88 + RP Emploi + RP Chômage), les
# builders de données (les builders de sources + les builders analytiques T1-T6),
# les vintages par source (jamais alignés) et le seam de calcul/publication de
# T8. L'assembleur ne CALCULE rien (les indicateurs vivent dans les T1-T5) et ne
# PUBLIE rien (T8 le fait) : il lie les pièces existantes.

test_that("MANIFEST_ECONOMIE : les quatre fragments concaténés, une ligne par source", {
  m <- MANIFEST_ECONOMIE

  # la concaténation des fragments Économie, une ligne par source, jamais de
  # doublon de cache
  expect_s3_class(m, "tbl_df")
  expect_equal(nrow(m), 5L)
  expect_equal(nrow(m), length(unique(m$id)))
  expect_equal(anyDuplicated(m$fichier), 0L)
  expect_setequal(m$id, c("sirene_snapshot", "flores_a38", "flores_a88",
                          "rp_emploi", "rp_chomage"))

  # les 11 colonnes standard du manifeste (Démographie / DVF / Habitat)
  expect_true(all(c("id", "source", "url", "fichier", "vintage",
                    "date_reference", "date_publication", "licence",
                    "note", "mode", "type") %in% names(m)))

  # chaque source garde SON vintage : aucune colonne d'alignement de date
  expect_false(any(grepl("align", tolower(names(m)))))

  # la concaténation est EXACTEMENT les fragments, dans l'ordre du contrat
  attendu <- dplyr::bind_rows(MANIFEST_ECONOMIE_SIRENE, MANIFEST_ECONOMIE_FLORES,
                              MANIFEST_ECONOMIE_RP, MANIFEST_ECONOMIE_CHOMAGE)
  expect_identical(m, attendu)
})

test_that("theme_economie : le descripteur porte les membres requis du contrat", {
  th <- theme_economie()

  # la forme du contrat : les membres requis dans l'ordre — `directions`
  # (issue #368 : chaque clé classée déclare SA direction) est un membre
  # REQUIS, pas une option
  expect_named(th, MEMBRES_DESCRIPTEUR_ECONOMIE)
  expect_equal(th$theme, "economie")
  expect_identical(th$manifest, MANIFEST_ECONOMIE)
  # les trois pièces que run_pipeline(theme = theme_economie()) consomme
  expect_true(is.function(th$vintages))
  expect_true(is.function(th$construire_donnees))
  # le seam de calcul (T8) et le seam de publication (T8) sont exposés
  expect_true(is.function(th$construire_analytiques))
  expect_true(is.function(th$publier))

  # le descripteur réel passe sa propre validation de forme
  expect_true(verifier_descripteur_economie(th))
})

test_that("verifier_descripteur_economie : un membre requis manquant échoue bruyamment", {
  th <- theme_economie()

  # chaque membre requis est indispensable : retirer n'importe lequel échoue en
  # NOMmant le membre fautif (jamais un échec silencieux)
  for (membre in MEMBRES_DESCRIPTEUR_ECONOMIE) {
    defectueux <- th[setdiff(names(th), membre)]
    expect_error(verifier_descripteur_economie(defectueux), membre, info = membre)
  }

  # un descripteur vide échoue aussi
  expect_error(verifier_descripteur_economie(list()), "manquant")

  # le cas nommé de l'audit ordinal (issue #368) : un descripteur SANS la
  # déclaration des directions échoue FORT — jamais le défaut high-is-good
  # silencieux de la machinerie
  sans_directions <- th[setdiff(names(th), "directions")]
  expect_error(verifier_descripteur_economie(sans_directions), "directions")
})

test_that("vintages_economie : chaque source porte SA référence et SA publication", {
  v <- vintages_economie()

  expect_equal(nrow(v), nrow(MANIFEST_ECONOMIE))
  expect_named(v, c("id", "source", "version", "licence",
                    "date_reference", "date_publication"))
  expect_true(all(v$licence == "lov2"))

  # SIRENE : millésime 2026-04, référence = dernier jour du mois PRÉCÉDENT
  # (l'image du répertoire à fin mars), publication = la mise en ligne ODS
  expect_equal(v$version[v$id == "sirene_snapshot"], "2026-04")
  expect_equal(v$date_reference[v$id == "sirene_snapshot"], "2026-03-31")
  expect_equal(v$date_publication[v$id == "sirene_snapshot"], "2026-05-01")

  # Flores A38/A88 : millésime 2024 (fin d'année), parution 31/03/2026 — les
  # deux nomenclatures partagent le vintage de la SOURCE Flores, pas celui de
  # SIRENE ni du RP
  for (id in c("flores_a38", "flores_a88")) {
    expect_equal(v$version[v$id == id], "2024", info = id)
    expect_equal(v$date_reference[v$id == id], "2024-12-31", info = id)
    expect_equal(v$date_publication[v$id == id], "2026-03-31", info = id)
  }

  # RP Emploi : millésime 2023 (au 1er janvier), publié avec la vague RP 2023
  expect_equal(v$version[v$id == "rp_emploi"], "2023")
  expect_equal(v$date_reference[v$id == "rp_emploi"], "2023-01-01")
  expect_equal(v$date_publication[v$id == "rp_emploi"], "2026-06-30")

  # RP Chômage : le MÊME millésime RP 2023 que rp_emploi mais SA publication à
  # lui (2026-07-15 — la ressource DS_RP_EMPLOI_LR_PRINC, émise plus tard que
  # la vague ACT4/ACT5) : chaque source garde SES dates, jamais un tampon commun
  expect_equal(v$version[v$id == "rp_chomage"], "2023")
  expect_equal(v$date_reference[v$id == "rp_chomage"], "2023-01-01")
  expect_equal(v$date_publication[v$id == "rp_chomage"], "2026-07-15")
})

test_that("vintages_economie : les dates ne sont JAMAIS alignées entre sources", {
  v <- vintages_economie()

  # les deux sources sœurs du RP partagent le millésime mais PAS la publication :
  # rp_chomage (2026-07-15) est publié APRÈS rp_emploi (2026-06-30) — aucune
  # source n'est écrasée par un tampon de thème
  expect_false(identical(v$date_publication[v$id == "rp_chomage"],
                         v$date_publication[v$id == "rp_emploi"]))

  # les 5 dates de publication ne sont pas uniformes (SIRENE 05-01, Flores
  # 03-31, RP 06-30, chômage 07-15) — l'absence d'alignement est la règle
  expect_true(dplyr::n_distinct(v$date_publication) > 1)
  # les références non plus : SIRENE 2026-03-31 ≠ RP 2023-01-01 ≠ Flores
  # 2024-12-31 — chaque source garde la sienne
  expect_true(dplyr::n_distinct(v$date_reference) >= 3)

  # chaque version est celle de SA source (millésimes 2023 / 2024 / 2026-04)
  expect_true(all(v$version %in% c("2023", "2024", "2026-04")))
})

test_that("construire_donnees_economie : assemble les tables des quatre sources", {
  # la couture : les quatre builders de sources MOCKÉS — le seam d'entrée du
  # run réel (jamais de réseau, jamais de fichiers réels dans la boucle de
  # test, docs/architecture.md §Testing)
  table_sirene <- tibble::tibble(commune = "22001", value = 1)
  table_a38 <- tibble::tibble(commune = "22001", value = 2)
  table_a88 <- tibble::tibble(commune = "22001", value = 3)
  table_rp <- tibble::tibble(commune = "22001", value = 4)
  table_chomage <- tibble::tibble(commune = "22001", value = 5)
  appels <- new.env()

  local_mocked_bindings(
    construire_sirene_normalise = function(cache) {
      appels$sirene <- cache
      table_sirene
    },
    construire_donnees_brut_flores = function(cache) {
      appels$flores <- (if (is.null(appels$flores)) 0L else appels$flores) + 1L
      list(flores_a38 = list(table = table_a38),
           flores_a88 = list(table = table_a88))
    },
    construire_donnees_brut_emploi_rp = function(cache) {
      appels$rp <- cache
      list(table = table_rp)
    },
    construire_donnees_brut_chomage = function(cache) {
      appels$chomage <- cache
      list(table = table_chomage)
    },
    .package = "lusk"
  )

  donnees <- construire_donnees_economie(cache = "cache-test")

  # la liste nommée des tables normalisées, dans l'ordre du contrat
  expect_named(donnees, c("sirene_snapshot", "flores_a38", "flores_a88",
                          "rp_emploi", "rp_chomage"))
  expect_identical(donnees$sirene_snapshot, table_sirene)
  expect_identical(donnees$flores_a38, table_a38)
  expect_identical(donnees$flores_a88, table_a88)
  expect_identical(donnees$rp_emploi, table_rp)
  expect_identical(donnees$rp_chomage, table_chomage)

  # chaque builder reçoit le cache ; le builder Flores (deux tables) n'est
  # appelé QU'UNE fois — l'assembleur ne duplique aucune lecture
  expect_equal(appels$sirene, "cache-test")
  expect_equal(appels$rp, "cache-test")
  expect_equal(appels$chomage, "cache-test")
  expect_equal(appels$flores, 1L)
})

test_that("construire_analytiques_economie : le seam de calcul de T8 enchaîne les builders T1-T6", {
  donnees <- list(
    sirene_snapshot = tibble::tibble(commune = "22001", value = 1),
    flores_a38 = tibble::tibble(commune = "22001", value = 2),
    flores_a88 = tibble::tibble(commune = "22001", value = 3),
    rp_emploi = tibble::tibble(commune = "22001", value = 4),
    rp_chomage = tibble::tibble(commune = "22001", value = 5)
  )
  base_epci <- tibble::tibble(CODGEO = "22001", EPCI = "200000001", DEP = "22")
  artefact <- tibble::tibble(nace_code = "38.1", flag = "h")
  suivi <- new.env()
  suivi$ordre <- character()
  pousser <- function(etape) {
    suivi$ordre <- c(suivi$ordre, etape)
  }

  local_mocked_bindings(
    construire_analytique_lq_economie = function(snapshot, sortie) {
      pousser("lq")
      list(lq = tibble::tibble(x = 1), histoires = tibble::tibble(x = 2),
           m = tibble::tibble(x = 3), suppression = tibble::tibble())
    },
    construire_analytique_lq_flores = function(flores, grain, sortie) {
      pousser(paste0("lq_flores_", grain))
      list(lq = tibble::tibble(y = if (grain == "A88") 1 else 2))
    },
    construire_eco_activites_economie = function(snapshot, artefact) {
      pousser("eco")
      list(table = tibble::tibble(z = 3), suppression = tibble::tibble())
    },
    persister_eco_activites_economie = function(resultat, sortie) invisible(resultat),
    construire_dortoir_economie = function(flores_a88, rp_emploi) {
      pousser("dortoir")
      # la table porte la perspective lieu de travail (commune, workplace) —
      # la matière de l'indicateur « Taille » (issue #131)
      list(table = tibble::tibble(commune = "22001", workplace = 3, w = 4),
           suppression = tibble::tibble())
    },
    persister_dortoir_economie = function(resultat, sortie) invisible(resultat),
    construire_chomage_economie = function(rp_chomage) {
      pousser("chomage")
      list(table = tibble::tibble(v = 5), suppression = tibble::tibble())
    },
    persister_chomage_economie = function(resultat, sortie) invisible(resultat),
    construire_rangs_analytiques_economie = function(lq, lq_emploi, eco, chomage,
                                                    base_epci, sortie) {
      pousser("rangs")
      list(lq = tibble::tibble(r = 1), lq_emploi = tibble::tibble(r = 2),
           eco = tibble::tibble(r = 3), chomage = tibble::tibble(r = 4))
    },
    # l'agrégation au niveau des territoires (issue #131) — le seam que le
    # chaînon appelle après T6 pour bâtir le payload agrégé
    construire_territoires_agregats_economie = function(effectifs, eco, chomage,
                                                        lq, base_epci) {
      pousser("agregats")
      list(effectifs = tibble::tibble(e = 1), chomage = tibble::tibble(c = 2),
           eco = tibble::tibble(g = 3), histoires = tibble::tibble(h = 4))
    },
    .package = "lusk"
  )

  res <- construire_analytiques_economie(donnees, base_epci, artefact,
                                         sortie = "sortie-test")

  # le chaînon T1 → T6, dans l'ordre (les rangs puis l'agrégation territoire
  # en dernier — le seam ne calcule RIEN lui-même, il enchaîne les builders)
  expect_equal(suivi$ordre, c("lq", "lq_flores_A88", "lq_flores_A38", "eco",
                              "dortoir", "chomage", "rangs", "agregats"))

  # les tables analytiques exposées : les artefacts T6 classés, les tables de
  # support, l'effectif communal et les tables agrégées du payload
  expect_named(res, c("lq", "histoires_lq", "m", "lq_emploi_a88",
                      "lq_emploi_a38", "eco_activites", "dortoir", "chomage",
                      "effectifs", "effectifs_territoires", "chomage_territoires",
                      "eco_territoires", "histoires"))
  expect_equal(res$lq$r, 1)
  expect_equal(res$lq_emploi_a88$r, 2)
  expect_equal(res$eco_activites$r, 3)
  expect_equal(res$chomage$r, 4)
  # l'effectif communal est dérivé de la perspective lieu de travail du dortoir
  expect_equal(res$effectifs$effectifs_salaries, 3)
  expect_equal(res$effectifs_territoires$e, 1)
  expect_equal(res$chomage_territoires$c, 2)
  expect_equal(res$eco_territoires$g, 3)
  expect_equal(res$histoires$h, 4)
})

test_that("publier_economie : le seam de publication de T8 est câblé (plus un stub)", {
  # T8 câble la publication du payload Économie — le stub qui échouait avec
  # « câblé par T8 » est remplacé par la publication réelle : un appel sans
  # données échoue désormais pour une raison de DONNÉES (cache absent), jamais
  # sur un message de stub.
  expect_false(grepl("T8", tryCatch(
    publier_economie(list()),
    error = function(e) conditionMessage(e)
  )))
})
