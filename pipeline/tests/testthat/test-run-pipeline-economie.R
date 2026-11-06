# test-run-pipeline-economie -----------------------------------------------------
# run_pipeline(theme = theme_economie()) — T8 : la publication du payload
# Économie/Emploi (plan economie-analytical-phase, todo 8). Le run complet de
# bout en bout, à étapes mockées : le réseau et les vrais fichiers n'entrent
# jamais dans la boucle de test. Le seam de publication du thème
# (publier_economie, câblé par T8) est RÉEL — ce qui est testé est ce qui
# part : le payload Économie complet (territoires référence, indicateurs avec
# rangs T6 + estampilles T7, histoires avec story_key ADR-0002), les fichiers
# par thème, la référence partagée, les vintages et le rapport de run.
#
# La couture analytique (construire_analytiques_economie — T1→T6) est MOCKÉE :
# les fixtures des tests analytiques (test-analytics-economie-*.R) sont le
# seam d'entrée de la chaîne ; ici on lui substitue des tables classées
# déjà calculées (la forme exacte des artefacts *_rangs.rds) pour verrouiller
# la publication elle-même. lire_epci (la base des EPCI partagée) est mockée —
# la même référence que les tests de rangs. publier_geometrie est mockée —
# jamais de WFS dans la boucle de test.

# statuts du run Économie — une ligne par source du manifeste, dans son ordre
statuts_economie <- function(status = "frais") {
  tibble::tibble(
    id = MANIFEST_ECONOMIE$id,
    mode = MANIFEST_ECONOMIE$mode,
    status = rep(status, nrow(MANIFEST_ECONOMIE))
  )
}

test_that("run_pipeline(theme = theme_economie()) : le run Économie complet, de bout en bout", {
  cible <- tempfile("pub-economie-")
  on.exit(unlink(cible, recursive = TRUE))
  cache <- tempfile("cache-economie-")
  dir.create(cache)
  on.exit(unlink(cache, recursive = TRUE))

  # les étapes réseau / fichiers lourds sont mockées ; le seam de publication
  # (publier_economie — T8) est RÉEL : ce qui est testé est ce qui part
  local_mocked_bindings(
    download_sources = function(manifest, cache, mode) statuts_economie(),
    construire_donnees_economie = function(cache) list(
      sirene_snapshot = tibble::tibble(x = 1),
      flores_a38 = tibble::tibble(x = 2),
      flores_a88 = tibble::tibble(x = 3),
      rp_emploi = tibble::tibble(x = 4),
      rp_chomage = tibble::tibble(x = 5)
    ),
    construire_analytiques_economie = function(donnees, base_epci, artefact, sortie) {
      fixture_analytiques_economie()
    },
    lire_epci = function(chemin) base_epci_economie,
    publier_geometrie = function(cible = "public/data", fetch = NULL) invisible(NULL),
    .package = "lusk"
  )

  payload <- run_pipeline(theme = theme_economie(), cache = cache, sortie = cible,
                          noms_epci_geo_api = NULL)

  scalar_artifact <- read_scalar_serving_artifact(file.path(cible, "scalar-serving", "economie"))
  expect_setequal(scalar_artifact$descriptors$indicator_id,
                  c("effectifs_salaries", "chomage", "eco_activites"))
  expect_true(all(scalar_artifact$facts$indicator_id %in% scalar_artifact$descriptors$indicator_id))

  # le payload complet du thème : les quatre tables du contrat
  expect_named(payload, c("indicateurs", "histoires", "territoires", "apercu"))
  expect_true(all(payload$indicateurs$theme == "economie"))
  # les trois indicateurs publiés (issue #131) — `lq` et `lq_emploi` QUITTENT
  # le bloc (la matrice reste interne, jamais publiée) ; le dortoir est parked
  expect_setequal(unique(payload$indicateurs$key),
                  c("effectifs_salaries", "chomage", "eco_activites"))
  # une ligne par territoire (commune / EPCI / département / région) — les
  # agrégats sont RECALCULÉS depuis les parties (jamais une moyenne de parts)
  expect_equal(nrow(payload$indicateurs),
               nrow(payload$territoires) * 3)
  # le chômage d'un EPCI à deux communes est le recalcul pondéré : EPCI X =
  # (2 + 1) / (10 + 10) = 0,15 — jamais la moyenne des taux (0,15 ici aussi
  # par hasard de la fixture : la valeur agrégée est celle des numérateurs)
  expect_equal(
    payload$indicateurs$value[payload$indicateurs$territoire == "200000001" &
                                payload$indicateurs$key == "chomage"],
    3 / 20
  )
  # les rangs-en-contexte sont portés par les lignes (ordinal directionnel —
  # entier >= 1, 1 = meilleur ; la taille du groupe à côté, ADR-0015)
  expect_true(all(c("rang_epci", "rang_dep", "rang_reg") %in%
                    names(payload$indicateurs)))
  expect_true(all(c("rang_epci_n", "rang_dep_n", "rang_reg_n") %in%
                    names(payload$indicateurs)))
  rangs <- unlist(payload$indicateurs[c("rang_epci", "rang_dep", "rang_reg")])
  expect_true(all(is.na(rangs) | (rangs >= 1 & rangs == floor(rangs))))
  # les estampilles T7 : chaque indicateur porte le vintage de SA source de
  # référence — effectifs sur Flores A88, chômage sur RP chômage, éco-activités
  # sur SIRENE (aucun alignement de dates)
  src_par_cle <- stats::setNames(
    c("flores_a88", "rp_chomage", "sirene_snapshot"),
    c("effectifs_salaries", "chomage", "eco_activites")
  )
  vintages <- vintages_economie()
  for (cle in names(src_par_cle)) {
    attendu <- vintages$source[vintages$id == src_par_cle[[cle]]]
    expect_true(all(payload$indicateurs$vintage_source[
      payload$indicateurs$key == cle] == attendu),
      info = cle)
  }

  # les histoires : une lecture RÉSOLUE par (territoire, groupe) (issue #312) —
  # le top-5 « ce que la commune abrite » replié en paramètres plats
  # (top1_*..top5_*, la matière de la lecture, jamais les lignes du top-5 comme
  # autant de lectures) pour les communes / EPCIs / départements ; plus JAMAIS
  # de Story dortoir (parked) ; issue #370 : la lecture régionale
  # « ce que la Bretagne abrite » a QUITTÉ la fiche (la région rend ses
  # indicateurs seuls — sa LQ est dégénérée)
  expect_true(all(payload$histoires$theme == "economie"))
  expect_true(all(c("groupe", "story_key", "salience_reason",
                    "top1_activity_code", "top1_activity_label", "top1_lq",
                    "top1_n", "top5_part_parc") %in% names(payload$histoires)))
  expect_true(all(payload$histoires$salience_reason == "defaut"))
  expect_true(all(payload$histoires$story_key[
    payload$histoires$territoire == "22001"] ==
    "ce-que-la-commune-abrite"))
  expect_false(any(payload$histoires$story_key == "ce-que-la-bretagne-abrite"))
  expect_false("53" %in% payload$histoires$territoire)
  # le groupe de fiche est EXPLICITE (US10, #308) : la spécialisation vit dans
  # sante-et-taille
  expect_true(all(payload$histoires$groupe[
    payload$histoires$story_key == "ce-que-la-commune-abrite"] ==
    "sante-et-taille"))
  # l'identité (territoire × groupe) est UNIQUE — le top-5 n'est plus 5 lignes
  expect_false(any(duplicated(payload$histoires[c("territoire", "groupe")])))
  # la commune dortoir-profond ne porte plus AUCUNE colonne dortoir
  expect_false(any(c("classification", "ratio", "workplace", "resident", "rang",
                     "activity_code", "activity_label") %in%
                     names(payload$histoires)))
  # les Stories portent le vintage de leur source de référence (SIRENE pour
  # l'unique lecture — issue #74)
  expect_true(all(payload$histoires$vintage_source ==
                    vintages$source[vintages$id == "sirene_snapshot"]))

  # la référence des territoires : le squelette partagé (communes + EPCIs +
  # départements + région), les noms réels, l'EPCI de chaque commune
  expect_setequal(unique(payload$territoires$type),
                  c("commune", "epci", "departement", "region"))
  expect_equal(
    payload$territoires$nom[payload$territoires$territoire == "22001"],
    "Commune A1"
  )
  expect_equal(
    payload$territoires$epci[payload$territoires$territoire == "22001"],
    "200000001"
  )

  # la référence partagée + vintages + rapport ; les projections de faits
  # numériques sont retirées et le payload reste disponible en mémoire.
  # Issue #116 : l'Aperçu d'un run Économie est vide par design — le fichier
  # partagé apercu n'est NI écrit NI écrasé par un thème sans aperçu (seul
  # Démographie le peuple). Issue #311 : les métadonnées du thème partent
  # avec le run (theme_economie.json).
  for (f in c("territoires.parquet", "territoires.json",
              "vintages.parquet", "run-report.json",
              "theme_economie.json")) {
    expect_true(file.exists(file.path(cible, f)), info = f)
  }
  expect_false(file.exists(file.path(cible, "indicateurs_economie.json")))
  expect_false(file.exists(file.path(cible, "histoires_economie.json")))
  # #757 : le parquet par-thème est retiré pour les cinq thèmes non-mobilité
  expect_false(file.exists(file.path(cible, "indicateurs_economie.parquet")))
  expect_false(file.exists(file.path(cible, "histoires_economie.parquet")))
  expect_false(file.exists(file.path(cible, "apercu.parquet")))
  expect_false(file.exists(file.path(cible, "apercu.json")))

  # Les contrats de faits s'attachent aux sorties producteur en mémoire, pas
  # à une projection JSON retirée. La ressource partagée garde sa parité.
  expect_true(all(payload$indicateurs$theme == "economie"))
  expect_setequal(unique(payload$indicateurs$key),
    c("effectifs_salaries", "chomage", "eco_activites"))
  pq <- nanoparquet::read_parquet(file.path(cible, "territoires.parquet"))
  js <- jsonlite::fromJSON(file.path(cible, "territoires.json"))
  verifier_non_derivee(pq, js, "territoires")

  # vintages.parquet : une ligne par source du manifeste Économie (les 5)
  vint <- nanoparquet::read_parquet(file.path(cible, "vintages.parquet"))
  expect_equal(nrow(vint), nrow(MANIFEST_ECONOMIE))
  expect_setequal(vint$id, MANIFEST_ECONOMIE$id)

  # le rapport de run : mode full, une ligne par source
  rapport <- jsonlite::fromJSON(file.path(cible, "run-report.json"))
  expect_equal(rapport$mode, "full")
  expect_equal(rapport$statuts$id, MANIFEST_ECONOMIE$id)
})

test_that("un re-run Économie écrase sans dupliquer (upsert, idempotence)", {
  cible <- tempfile("pub-economie-")
  on.exit(unlink(cible, recursive = TRUE))
  cache <- tempfile("cache-economie-")
  dir.create(cache)
  on.exit(unlink(cache, recursive = TRUE))

  local_mocked_bindings(
    download_sources = function(manifest, cache, mode) statuts_economie(),
    construire_donnees_economie = function(cache) list(
      sirene_snapshot = tibble::tibble(x = 1),
      flores_a38 = tibble::tibble(x = 2),
      flores_a88 = tibble::tibble(x = 3),
      rp_emploi = tibble::tibble(x = 4),
      rp_chomage = tibble::tibble(x = 5)
    ),
    construire_analytiques_economie = function(donnees, base_epci, artefact, sortie) {
      fixture_analytiques_economie()
    },
    lire_epci = function(chemin) base_epci_economie,
    publier_geometrie = function(cible = "public/data", fetch = NULL) invisible(NULL),
    .package = "lusk"
  )

  premier <- run_pipeline(theme = theme_economie(), cache = cache, sortie = cible,
                          noms_epci_geo_api = NULL)
  second <- run_pipeline(theme = theme_economie(), cache = cache, sortie = cible,
                         noms_epci_geo_api = NULL)

  # le payload EST l'état complet : relancer écrase, ne duplique jamais —
  # aucune ligne en double, les comptes du premier run sont conservés
  # Les tables de faits restent en mémoire et le writer ne crée pas de projection
  # numérique ; les répétitions n'introduisent aucune duplication.
  ind <- second$indicateurs
  ref <- nanoparquet::read_parquet(file.path(cible, "territoires.parquet"))
  # 9 territoires (4 communes + 2 EPCIs + 2 départements + la région) ×
  # 3 clés (effectifs_salaries · chomage · eco_activites) — une ligne chacun
  expect_equal(nrow(ind), 9 * 3)
  expect_equal(anyDuplicated(ind[c("territoire", "key", "detail")]), 0L)
  expect_identical(second$indicateurs, premier$indicateurs)
  expect_false(file.exists(file.path(cible, "indicateurs_economie.json")))
  expect_false(file.exists(file.path(cible, "histoires_economie.json")))
  expect_equal(nrow(ref), 4 + 2 + 2 + 1) # communes + EPCIs + départements + région
})

test_that("vintages : un run Démographie puis un run Économie laissent l'union (issue #124)", {
  # La table des vintages est PARTAGÉE (pas par-thème) : un run Économie doit
  # FUSIONNER ses sources dans la table déjà sur disque — jamais l'écraser avec
  # ses seules sources (last-writer-wins par thème, le bug que #116 a corrigé
  # pour apercu). Sinon le Story Démographie (serie_historique + epci cités
  # depuis la table partagée) perd sa ligne de source après un run Économie.
  cible <- tempfile("pub-vintages-")
  dir.create(cible, recursive = TRUE)
  on.exit(unlink(cible, recursive = TRUE))
  cache <- tempfile("cache-vintages-")
  on.exit(unlink(cache, recursive = TRUE))

  # les étapes réseau / couture analytique sont mockées ; les builders de
  # vintages des thèmes (des projections pures du manifeste) et l'écriture des
  # fichiers parquet + JSON sont RÉELS : ce qui est testé est ce qui part.
  local_mocked_bindings(
    download_sources = function(manifest, cache, mode) tibble::tibble(
      id = manifest$id[manifest$id != MANIFEST_CLASSES_DENSITE$id[[1L]]],
      mode = manifest$mode[manifest$id != MANIFEST_CLASSES_DENSITE$id[[1L]]],
      status = "frais"
    ),
    construire_donnees_brut = function(cache) load_fixture(),
    construire_donnees_economie = function(cache) list(
      sirene_snapshot = tibble::tibble(x = 1),
      flores_a38 = tibble::tibble(x = 2),
      flores_a88 = tibble::tibble(x = 3),
      rp_emploi = tibble::tibble(x = 4),
      rp_chomage = tibble::tibble(x = 5)
    ),
    construire_analytiques_economie = function(donnees, base_epci, artefact, sortie) {
      fixture_analytiques_economie()
    },
    lire_epci = function(chemin) base_epci_economie,
    compute_payload = function(data, theme = NULL, vintages = NULL) {
      list(indicateurs = data.frame(x = 1),
           histoires = data.frame(y = 2),
           territoires = data.frame(territoire = "53", nom = "Bretagne"))
    },
    publish = function(payload, cible, backend = "static") invisible(payload),
    publier_geometrie = function(cible = "public/data", fetch = NULL) invisible(NULL),
    ecrire_rapport_run = function(statuts, mode, cible, timestamp = NULL,
                                  couverture = NULL)
      invisible(NULL),
    materialize_theme_scalar_artifact = function(...) invisible(NULL),
    materialize_theme_profile_artifacts = function(...) invisible(NULL),
    # le payload stubé ci-dessus ne porte pas les faits de lecture sélectionnés :
    # la matérialisation du grain de lecture est hors boucle, comme le scalar.
    materialize_theme_typed_reading_artifacts = function(...) invisible(NULL),
    .package = "lusk"
  )

  # 1) un run Démographie écrit SA table (les 4 sources)
  run_pipeline(cache = cache, sortie = cible, noms_epci_geo_api = NULL)
  vint <- nanoparquet::read_parquet(file.path(cible, "vintages.parquet"))
  expect_equal(nrow(vint), nrow(MANIFEST_DEMOGRAPHIE))
  expect_setequal(vint$id, MANIFEST_DEMOGRAPHIE$id)

  # 2) un run Économie ensuite FUSIONNE ses 5 sources dans la table partagée —
  # l'union des deux thèmes, serie_historique et epci TOUJOURS présents
  run_pipeline(theme = theme_economie(), cache = cache, sortie = cible,
               noms_epci_geo_api = NULL)

  vint <- nanoparquet::read_parquet(file.path(cible, "vintages.parquet"))
  expect_equal(nrow(vint), nrow(MANIFEST_DEMOGRAPHIE) + nrow(MANIFEST_ECONOMIE))
  expect_true(all(c("serie_historique", "epci") %in% vint$id))
  expect_setequal(vint$id, c(MANIFEST_DEMOGRAPHIE$id, MANIFEST_ECONOMIE$id))

  # le JSON projeté porte la MÊME union — ce que l'app lit pour la ligne de
  # source du Story (jamais un fichier écrasé par le dernier thème)
  vj <- jsonlite::fromJSON(file.path(cible, "vintages.json"))
  expect_equal(nrow(vj), nrow(vint))
  expect_true(all(c("serie_historique", "epci") %in% vj$id))

  # 3) relancer Économie ne duplique pas : la dédupe par id est un upsert
  run_pipeline(theme = theme_economie(), cache = cache, sortie = cible,
               noms_epci_geo_api = NULL)
  vint <- nanoparquet::read_parquet(file.path(cible, "vintages.parquet"))
  expect_equal(nrow(vint), nrow(MANIFEST_DEMOGRAPHIE) + nrow(MANIFEST_ECONOMIE))
})

test_that("une dérive de valeur du payload Économie échoue bruyamment", {
  cible <- tempfile("pub-economie-")
  on.exit(unlink(cible, recursive = TRUE))
  cache <- tempfile("cache-economie-")
  dir.create(cache)
  on.exit(unlink(cache, recursive = TRUE))

  # la couture analytique renvoie une table corrompue : un taux de chômage
  # hors de [0, 1] pour un territoire — la validation de VALEUR du thème
  # détecte la dérive et le run s'arrête FORT, jamais un chiffre faux publié
  # silencieusement
  local_mocked_bindings(
    download_sources = function(manifest, cache, mode) statuts_economie(),
    construire_donnees_economie = function(cache) list(
      sirene_snapshot = tibble::tibble(x = 1),
      flores_a38 = tibble::tibble(x = 2),
      flores_a88 = tibble::tibble(x = 3),
      rp_emploi = tibble::tibble(x = 4),
      rp_chomage = tibble::tibble(x = 5)
    ),
    construire_analytiques_economie = function(donnees, base_epci, artefact, sortie) {
      fx <- fixture_analytiques_economie()
      fx$chomage_territoires$value[1] <- 1.5  # hors [0, 1] : une dérive de schéma
      fx
    },
    lire_epci = function(chemin) base_epci_economie,
    publier_geometrie = function(cible = "public/data", fetch = NULL) invisible(NULL),
    .package = "lusk"
  )

  # la validation de valeur (validations_economie) l'attrape bruyamment
  expect_error(
    run_pipeline(theme = theme_economie(), cache = cache, sortie = cible,
                 noms_epci_geo_api = NULL),
    "chômage"
  )
})

test_that("un payload avec `lq` encore dans les indicateurs échoue la validation (QA issue #131)", {
  # la matrice LQ ne doit JAMAIS repartir dans le bloc : une clé `lq` n'est
  # pas déclarée dans INDICATEURS_ECONOMIE — la validation générique la
  # rejette bruyamment (le reshape interdit la régression du payload 80 Mo)
  cible <- tempfile("pub-economie-")
  on.exit(unlink(cible, recursive = TRUE))
  cache <- tempfile("cache-economie-")
  dir.create(cache)
  on.exit(unlink(cache, recursive = TRUE))

  local_mocked_bindings(
    download_sources = function(manifest, cache, mode) statuts_economie(),
    construire_donnees_economie = function(cache) list(
      sirene_snapshot = tibble::tibble(x = 1),
      flores_a38 = tibble::tibble(x = 2),
      flores_a88 = tibble::tibble(x = 3),
      rp_emploi = tibble::tibble(x = 4),
      rp_chomage = tibble::tibble(x = 5)
    ),
    construire_analytiques_economie = function(donnees, base_epci, artefact, sortie) {
      fixture_analytiques_economie()
    },
    lire_epci = function(chemin) base_epci_economie,
    publier_geometrie = function(cible = "public/data", fetch = NULL) invisible(NULL),
    .package = "lusk"
  )

  # un run sain, puis le payload corrompu : une ligne `lq` réintroduite
  payload <- run_pipeline(theme = theme_economie(), cache = cache, sortie = cible,
                          noms_epci_geo_api = NULL)
  payload$indicateurs <- dplyr::bind_rows(
    payload$indicateurs,
    tibble::tibble(
      territoire = "22001", type = "commune", theme = "economie",
      key = "lq", detail = "A", value = 1.5, unit = "",
      rang_epci = 0.5, rang_dep = 0.5, rang_reg = 0.5,
      vintage_source = "x", vintage_version = "y",
      vintage_date_reference = "2026-01-01",
      vintage_date_publication = "2026-01-01"
    )
  )

  # la clé fantôme n'est pas déclarée dans INDICATEURS_ECONOMIE → erreur forte
  expect_error(
    validate_payload(payload, indicateurs = INDICATEURS_ECONOMIE,
                     vintages = vintages_economie(),
                     validations = validations_economie,
                     apercu = APERCU_ECONOMIE),
    "non déclarée"
  )
})
