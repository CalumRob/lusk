# test-download-dpe ------------------------------------------------------------
# Le manifeste Habitat DPE et le pull data-fair (issue #16) — testés pour
# l'intégrité et la mockabilité, JAMAIS contre le réseau (spec #12, décision
# de test : « download exclu par construction ») :
#   - le manifeste déclare une source api manuel par département breton, avec
#     sa fonction de pull (une closure par ligne) ;
#   - le pull est exercé à travers le seam httr2 (page_dpe mockée) : pagination
#     par curseur `after`, sélection large des champs, filtre défensif par
#     département, garde-fou anti-boucle ;
#   - download_sources met le résultat en cache (.rds par département) et
#     re-tire jamais une source déjà en cache (idempotence).

# manifeste_dpe_factice --------------------------------------------------------
# Le manifeste DPE avec des pulls de FAUX (jamais de réseau) — chaque pull
# enregistre son département dans `tire` et renvoie une ligne synthétique.
manifeste_dpe_factice <- function(tire = new.env()) {
  m <- MANIFEST_HABITAT_DPE
  m$pull <- lapply(m$id, function(id) {
    dep <- sub("dpe_", "", id)
    force(dep)
    function() {
      tire$vu <- c(tire$vu, dep)
      tibble::tibble(
        numero_dpe = paste0("DPE-", dep),
        numero_dpe_remplace = NA_character_,
        numero_dpe_immeuble_associe = NA_character_,
        date_etablissement_dpe = "2024-01-01",
        date_derniere_modification_dpe = NA_character_,
        version_dpe = "2.1",
        etiquette_dpe = "F",
        etiquette_ges = "F",
        type_batiment = "maison",
        nombre_appartement = NA_real_,
        position_logement_dans_immeuble = NA_character_,
        code_insee_ban = paste0(dep, "001"),
        code_departement_ban = dep,
        id_rnb = paste0("RNB-", dep)
      )
    }
  })
  m
}

test_that("le manifeste Habitat DPE liste les 4 départements bretons en api manuel", {
  expect_s3_class(MANIFEST_HABITAT_DPE, "tbl_df")
  expect_true(all(c("id", "source", "url", "fichier", "vintage",
                    "date_reference", "date_publication", "licence", "note",
                    "mode", "type", "pull") %in% names(MANIFEST_HABITAT_DPE)))

  expect_equal(nrow(MANIFEST_HABITAT_DPE), 4)
  expect_setequal(MANIFEST_HABITAT_DPE$id, c("dpe_22", "dpe_29", "dpe_35", "dpe_56"))
  expect_equal(MANIFEST_HABITAT_DPE$fichier,
               c("dpe_22.rds", "dpe_29.rds", "dpe_35.rds", "dpe_56.rds"))

  # type api, mode manuel — les premiers runs sont lourds (ADR-0004), jamais
  # touchés par le cron
  expect_true(all(MANIFEST_HABITAT_DPE$type == "api"))
  expect_true(all(MANIFEST_HABITAT_DPE$mode == "manuel"))

  expect_true(all(startsWith(MANIFEST_HABITAT_DPE$url, "https://")))
  expect_true(all(MANIFEST_HABITAT_DPE$licence == "lov2"))
  expect_true(all(!is.na(MANIFEST_HABITAT_DPE$note)))

  # la colonne pull porte une fonction par source (une closure par département)
  expect_true(is.list(MANIFEST_HABITAT_DPE$pull))
  expect_true(all(vapply(MANIFEST_HABITAT_DPE$pull, is.function, logical(1))))
})

test_that("download_sources : les pulls DPE sont appelés, mis en cache (.rds), et re-tirés jamais", {
  cache <- tempfile("cache-")
  dir.create(cache)
  on.exit(unlink(cache, recursive = TRUE))

  tire <- new.env()
  manifest <- manifeste_dpe_factice(tire)

  statuts <- download_sources(manifest, cache)

  # les 4 départements ont été tirés, chacun dans son .rds
  expect_equal(sort(tire$vu), c("22", "29", "35", "56"))
  expect_true(all(file.exists(file.path(cache, manifest$fichier))))
  expect_equal(readRDS(file.path(cache, "dpe_22.rds"))$code_departement_ban, "22")
  expect_equal(statuts$id, manifest$id)
  expect_equal(statuts$mode, rep("manuel", 4))
  expect_equal(statuts$status, rep("frais", 4))

  # idempotent : un second run ne re-tire rien (les caches sont intacts)
  tire$vu <- character(0)
  statuts2 <- download_sources(manifest, cache)
  expect_equal(tire$vu, character(0))
  expect_equal(statuts2$status, rep("frais", 4))
})

test_that("en mode cron, les sources DPE manuel sont sautées sans être touchées", {
  cache <- tempfile("cache-")
  dir.create(cache)
  on.exit(unlink(cache, recursive = TRUE))

  tire <- new.env()
  statuts <- download_sources(manifeste_dpe_factice(tire), cache, mode = "cron")

  expect_null(tire$vu)  # aucun pull n'a jamais été appelé
  expect_false(any(file.exists(file.path(cache, "dpe_22.rds"))))
  expect_equal(statuts$status, rep("à traiter à la main", 4))
})

test_that("la closure de pull du manifeste capture le département de sa ligne", {
  vu <- character(0)
  local_mocked_bindings(
    pull_departement = function(departement, ...) {
      vu <<- c(vu, departement)
      tibble::tibble(departement = departement)
    },
    .package = "lusk"
  )

  res <- MANIFEST_HABITAT_DPE$pull[[2]]()   # la ligne dpe_29
  expect_equal(vu, "29")
  expect_equal(res$departement, "29")
})

test_that("pull_departement pagine avec le curseur after et sélectionne les champs larges", {
  urls <- character(0)
  local_mocked_bindings(
    page_dpe = function(url) {
      urls <<- c(urls, url)
      if (length(urls) == 1) {
        list(
          results = list(
            list(numero_dpe = "A1", etiquette_dpe = "F", code_departement_ban = "22",
                 code_insee_ban = "22001"),
            list(numero_dpe = "A2", etiquette_dpe = "D", code_departement_ban = "22",
                 code_insee_ban = "22002")
          ),
          `next` = "https://data.ademe.fr/data-fair/api/v1/datasets/dpe03existant/lines?size=1000&qs=code_departement_ban:22&select=numero_dpe&after=abc123"
        )
      } else {
        list(
          results = list(
            list(numero_dpe = "A3", etiquette_dpe = "C", code_departement_ban = "22",
                 code_insee_ban = "22003")
          ),
          `next` = NULL
        )
      }
    },
    .package = "lusk"
  )

  res <- pull_departement("22", delai = 0)

  expect_equal(res$numero_dpe, c("A1", "A2", "A3"))

  # la première URL : filtre par département + sélection LARGE des champs
  expect_match(urls[1], "qs=code_departement_ban:22")
  params <- strsplit(sub(".*\\?", "", urls[1]), "&")[[1]]
  select <- sub("^select=", "", params[grep("^select=", params)])
  expect_equal(select, paste(CHAMPS_DPE, collapse = ","))

  # le curseur after est repris du champ `next` de la page précédente
  expect_match(urls[2], "after=abc123")
})

test_that("pull_departement ignore l'artefact `_score` de l'API et porte les valeurs manquantes en NA", {
  # Le premier run réel (#22) a fait échouer le pull : l'API data-fair ajoute
  # `_score` (pertinence de recherche, hors CHAMPS_DPE) à chaque ligne — NULL
  # sur les requêtes par filtre qs — et tibble::as_tibble() refuse une colonne
  # NULL. La forme réelle (vérifiée en direct le 2026-08-04) : `_score` NULL
  # sur TOUTES les lignes, et des champs déclarés (nombre_appartement) NULL
  # ligne à ligne. Seuls les champs DÉCLARÉS entrent dans le cache, les valeurs
  # manquantes sont portées en NA.
  local_mocked_bindings(
    page_dpe = function(url) {
      list(
        results = list(
          list(numero_dpe = "A1", etiquette_dpe = "F",
               code_departement_ban = "22", code_insee_ban = "22001",
               nombre_appartement = NULL, `_score` = NULL),
          list(numero_dpe = "A2", etiquette_dpe = "D",
               code_departement_ban = "22", code_insee_ban = "22002",
               nombre_appartement = 3, `_score` = NULL)
        ),
        `next` = NULL
      )
    },
    .package = "lusk"
  )

  res <- pull_departement("22", delai = 0)

  # aucune colonne _score dans la table (l'artefact n'est pas une donnée DPE)
  expect_false("_score" %in% names(res))
  # les lignes passent, dans l'ordre, avec les valeurs portées
  expect_equal(res$numero_dpe, c("A1", "A2"))
  # une valeur absente de l'API est NA, jamais une colonne NULL
  expect_true(is.na(res$nombre_appartement[1]))
  expect_equal(res$nombre_appartement[2], 3)
  # le filtre défensif par département continue de fonctionner
  expect_setequal(res$code_departement_ban, "22")
})

test_that("pull_departement filtre défensivement sur le département (qs ignoré)", {
  local_mocked_bindings(
    page_dpe = function(url) {
      list(
        results = list(
          list(numero_dpe = "H1", etiquette_dpe = "F",
               code_departement_ban = "75", code_insee_ban = "75056"),
          list(numero_dpe = "H2", etiquette_dpe = "D",
               code_departement_ban = NA_character_, code_insee_ban = "22001"),
          list(numero_dpe = "H3", etiquette_dpe = "C",
               code_departement_ban = "22", code_insee_ban = "22002")
        ),
        `next` = NULL
      )
    },
    .package = "lusk"
  )

  res <- pull_departement("22", delai = 0)

  # H1 (75) retiré ; H2 retenu par le repli code_insee_ban ; H3 par le code
  # département
  expect_equal(res$numero_dpe, c("H2", "H3"))
})

test_that("pull_departement s'arrête si le curseur after ne se termine pas", {
  local_mocked_bindings(
    page_dpe = function(url) {
      list(
        results = list(list(numero_dpe = "X", code_departement_ban = "22")),
        `next` = "https://data.ademe.fr/data-fair/api/v1/datasets/dpe03existant/lines?size=1000&qs=code_departement_ban:22&select=numero_dpe&after=loop"
      )
    },
    .package = "lusk"
  )

  expect_error(
    pull_departement("22", delai = 0, max_pages = 3),
    "Pagination DPE interrompue"
  )
})

test_that("lire_dpe_caches combine les caches .rds du manifeste", {
  cache <- tempfile("cache-")
  dir.create(cache)
  on.exit(unlink(cache, recursive = TRUE))

  for (f in MANIFEST_HABITAT_DPE$fichier) {
    dep <- sub("\\.rds$", "", sub("dpe_", "", f))
    readr::write_rds(
      tibble::tibble(numero_dpe = paste0("DPE-", dep), code_departement_ban = dep),
      file.path(cache, f)
    )
  }

  res <- lire_dpe_caches(cache)
  expect_equal(nrow(res), 4)
  expect_setequal(res$code_departement_ban, c("22", "29", "35", "56"))
})

test_that("lire_dpe_caches échoue si un cache département manque", {
  cache <- tempfile("cache-")
  dir.create(cache)
  on.exit(unlink(cache, recursive = TRUE))

  readr::write_rds(tibble::tibble(x = 1), file.path(cache, "dpe_22.rds"))

  expect_error(lire_dpe_caches(cache), "Cache DPE absent")
})

test_that("construire_dpe_processe enchaîne download (faux pulls) et nettoyage", {
  cache <- tempfile("cache-")
  dir.create(cache)
  on.exit(unlink(cache, recursive = TRUE))

  tire <- new.env()
  download_sources(manifeste_dpe_factice(tire), cache)

  processe <- construire_dpe_processe(cache)

  # un DPE maison par département, actif : une ligne par département,
  # étiquette normalisée, code commune 5 chiffres porté
  expect_equal(nrow(processe), 4)
  expect_setequal(processe$code_departement_ban, c("22", "29", "35", "56"))
  expect_true(all(processe$etiquette_dpe == "F"))
  expect_true(all(nchar(processe$code_insee_ban) == 5))
  expect_true(all(processe$poids == 1))
})
