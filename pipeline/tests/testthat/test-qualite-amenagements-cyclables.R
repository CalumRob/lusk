# test-qualite-amenagements-cyclables.R -----------------------------------------
# Le lecteur + normaliseur + porte de qualité du snapshot Geovelo (issue #222,
# ticket #229) : la source du mode `b` de `reseaux`.
#   - lire_amenagements_cyclables : le lecteur du parquet (nanoparquet + WKB ->
#     sf, CRS 4326 depuis les métadonnées du fichier — le WKB ne porte pas le
#     CRS). Non testé dans la boucle (la convention du pipeline) ; la forme
#     réelle est vérifiée par le normaliseur sur les fixtures.
#   - normaliser_amenagements_cyclables : PUR — colonnes requises présentes,
#     fichier non vide, filtre Bretagne (code_com_d ∈ 22/29/35/56, un côté —
#     ADR-0016), mapping COG 2022→2025 (passage_cog, #227 — un code non mappé
#     est une erreur dure). Sortie : la table de calcul (sf, bretonne, clés
#     COG 2025).
#   - verifier_qualite_amenagements : PUR — la porte de qualité à DEUX niveaux
#     (l'incident 2026-08-01, un FeatureCollection vide à 169 octets, exige la
#     garde) : France entière nrow > 10 000 + colonnes requises (attrape le
#     snapshot vide ET le parquet à schéma géométrie-seule du 01/08) ; après
#     filtre, Bretagne nrow > 0 (attrape un filtre cassé ou un snapshot cassé
#     seulement en Bretagne). Des modes d'échec distincts, des messages
#     distincts.
#   - construire_amenagements_cyclables : l'orchestrateur du REPLI — lit le
#     parquet frais, normalise, passe la porte. Succès : la table normalisée
#     est mise en cache comme `dernier_bon` (+ la date du snapshot), la table +
#     le vintage sont retournés. Échec : le `dernier_bon` du cache est lu — s'il
#     est absent, erreur dure ; sinon la table + SON vintage (la date du dernier
#     bon, jamais celle du cassé, jamais « aujourd'hui ») sont retournés.
# Les fixtures sont construites inline (la convention du pipeline — le réseau
# n'entre jamais dans la boucle de test).

# mappe_test ---------------------------------------------------------------------
# La table de passage COG 2022 → 2025 en forme réelle : la fusion vérifiée Le
# Cambout (22027) + Coëtlogon (22043) → Plumieux (22241), les identités. La
# même forme que la sortie de construire_passage_cog (#227).
mappe_test <- function() {
  tibble::tribble(
    ~code_2022, ~code_2025,
    "22001", "22001",
    "22027", "22241",   # Le Cambout → Plumieux (fusion vérifiée)
    "22241", "22241"
  )
}

# normaliser_amenagements_cyclables ----------------------------------------------

test_that("normaliser_amenagements_cyclables : la forme réelle → la table de calcul bretonne", {
  # une forme RÉDUITE mais fidèle du parquet LU (le sf du lecteur) : les
  # colonnes du calcul + la géométrie, une ligne hors Bretagne
  brut <- sf::st_sf(
    id_local = c("geovelo_1_22001", "geovelo_2_22027", "geovelo_3_50123"),
    code_com_d = c("22001", "22027", "50123"),  # Le Cambout (22027, fusionné → 22241)
    code_com_g = c("22001", "22027", "50123"),
    ame_d = c("PISTE CYCLABLE", "BANDE CYCLABLE", "PISTE CYCLABLE"),
    ame_g = c("PISTE CYCLABLE", "AUCUN", "PISTE CYCLABLE"),
    geometry = sf::st_sfc(
      sf::st_linestring(rbind(c(-1.5, 48.5), c(-1.49, 48.5))),
      sf::st_linestring(rbind(c(-2.5, 48.2), c(-2.48, 48.2))),
      sf::st_linestring(rbind(c(-1.0, 49.0), c(-0.99, 49.0))),
      crs = 4326
    )
  )

  table <- normaliser_amenagements_cyclables(brut, mappe_test())

  # la table est sf, bretonne, triée, aux clés COG 2025 (22027 → 22241 via
  # passage_cog — le mapping réel vérifié sur la table INSEE)
  expect_s3_class(table, "sf")
  expect_equal(nrow(table), 2L)  # la ligne 50123 (Manche) tombe
  expect_true(all(table$code_com_d %in% c("22001", "22241")))
  expect_true(all(table$code_com_g %in% c("22001", "22241")))
  expect_equal(sf::st_crs(table)$input, "EPSG:4326")
})

test_that("normaliser_amenagements_cyclables : une colonne requise manquante s'arrête bruyamment", {
  brut <- sf::st_sf(
    id_local = "geovelo_1_22001",
    code_com_d = "22001",
    ame_d = "PISTE CYCLABLE",
    geometry = sf::st_sfc(sf::st_linestring(rbind(c(-1.5, 48.5), c(-1.49, 48.5))), crs = 4326)
  )
  expect_error(normaliser_amenagements_cyclables(brut, mappe_test()), "ame_g")
})

test_that("normaliser_amenagements_cyclables : un fichier vide s'arrête bruyamment", {
  brut <- sf::st_sf(
    id_local = character(0), code_com_d = character(0), code_com_g = character(0),
    ame_d = character(0), ame_g = character(0),
    geometry = sf::st_sfc(crs = 4326)
  )
  expect_error(normaliser_amenagements_cyclables(brut, mappe_test()), "aucune ligne")
})

test_that("normaliser_amenagements_cyclables : un code COG non mappé (2022 → 2025) est une erreur dure", {
  # 22999 : un préfixe breton (22) qui survit au filtre, mais qui ne mappe
  # vers AUCUN code 2025 (absent des deux côtés de la table de passage)
  brut <- sf::st_sf(
    id_local = "geovelo_x_22999",
    code_com_d = "22999",
    code_com_g = "22999",
    ame_d = "PISTE CYCLABLE",
    ame_g = "PISTE CYCLABLE",
    geometry = sf::st_sfc(sf::st_linestring(rbind(c(-1.5, 48.5), c(-1.49, 48.5))), crs = 4326)
  )
  expect_error(normaliser_amenagements_cyclables(brut, mappe_test()), "22999")
})

test_that("normaliser_amenagements_cyclables : le côté NON-breton d'un segment de frontière traverse (lénient)", {
  # un segment de frontière 22/44 : code_com_d breton (mappé), code_com_g
  # 44006 (Loire-Atlantique — pas une clé de territoire, ne sert qu'à la règle
  # d'attribution par le côté porteur) traverse tel quel
  brut <- sf::st_sf(
    id_local = "geovelo_1_22001",
    code_com_d = "22001",
    code_com_g = "44006",
    ame_d = "PISTE CYCLABLE",
    ame_g = "AUCUN",
    geometry = sf::st_sfc(sf::st_linestring(rbind(c(-1.5, 48.5), c(-1.49, 48.5))), crs = 4326)
  )
  table <- normaliser_amenagements_cyclables(brut, mappe_test())
  expect_equal(table$code_com_d, "22001")
  expect_equal(table$code_com_g, "44006")  # le côté non-breton traverse
})

# verifier_qualite_amenagements ---------------------------------------------------

test_that("verifier_qualite_amenagements : la France entière au-dessus du seuil, Bretagne non vide — passe", {
  brut <- tibble::tibble(
    code_com_d = paste0("2", sprintf("%04d", 1:20000)),
    code_com_g = paste0("2", sprintf("%04d", 1:20000)),
    ame_d = "PISTE CYCLABLE", ame_g = "PISTE CYCLABLE"
  )
  expect_true(verifier_qualite_amenagements(brut))
})

test_that("verifier_qualite_amenagements : un snapshot vide (le 169 octets du 01/08) échoue", {
  brut <- tibble::tibble(
    code_com_d = character(0), code_com_g = character(0),
    ame_d = character(0), ame_g = character(0)
  )
  expect_error(verifier_qualite_amenagements(brut), "seuil")
})

test_that("verifier_qualite_amenagements : un parquet à schéma géométrie-seule (le 01/08) échoue", {
  brut <- tibble::tibble(geometry = list())
  expect_error(verifier_qualite_amenagements(brut), "colonne")
})

test_that("verifier_qualite_amenagements : la Bretagne vide après filtre échoue (filtre cassé ou snapshot breton cassé)", {
  brut <- tibble::tibble(
    code_com_d = paste0("7", sprintf("%04d", 1:20000)),  # aucune ligne bretonne
    code_com_g = paste0("7", sprintf("%04d", 1:20000)),
    ame_d = "PISTE CYCLABLE", ame_g = "PISTE CYCLABLE"
  )
  expect_error(verifier_qualite_amenagements(brut), "Bretagne")
})

# construire_amenagements_cyclables ------------------------------------------------

test_that("construire_amenagements_cyclables : le succès met la table en cache (dernier_bon) et retourne la table + le vintage", {
  # un cache temporaire
  cache <- tempfile("cache-")
  sortie <- tempfile("dernier-bon-")
  dir.create(cache, recursive = TRUE)

  # le « parquet frais » : un .rds sf écrit par le lecteur (le seam — la
  # lecture n'entre pas dans la boucle, l'orchestrateur reçoit le sf lu).
  # Assez de lignes pour passer la porte France entière (> 10 000).
  n <- 12000
  frais <- sf::st_sf(
    id_local = sprintf("geovelo_%d_22001", seq_len(n)),
    code_com_d = rep("22001", n),
    code_com_g = rep("22001", n),
    ame_d = rep(c("PISTE CYCLABLE", "BANDE CYCLABLE"), length.out = n),
    ame_g = rep(c("PISTE CYCLABLE", "AUCUN"), length.out = n),
    geometry = sf::st_sfc(lapply(seq_len(n), function(i) {
      sf::st_linestring(rbind(c(-1.5, 48.5), c(-1.5 + i / 1e6, 48.5)))
    }), crs = 4326)
  )
  readr::write_rds(frais, file.path(cache, "frais.rds"))

  # le lecteur injecté (la convention du pipeline — le réseau n'entre jamais
  # dans la boucle) : lit la fixture .rds comme le lecteur réel lit le parquet
  lire_fixture <- function(chemin) readRDS(chemin)

  res <- construire_amenagements_cyclables(
    file.path(cache, "frais.rds"), sortie = sortie, vintage = "2026-08-07",
    mappe = mappe_test(), lire = lire_fixture
  )

  expect_equal(res$vintage, "2026-08-07")
  expect_s3_class(res$table, "sf")
  # le dernier bon est en cache, avec SA date
  expect_true(file.exists(sortie))
  cache_table <- readRDS(sortie)
  expect_equal(cache_table$vintage, "2026-08-07")
  expect_equal(nrow(cache_table$table), n)
})

test_that("construire_amenagements_cyclables : l'échec de la porte → repli sur le dernier bon, avec SON vintage", {
  cache <- tempfile("cache-")
  sortie <- tempfile("dernier-bon-")
  dir.create(cache, recursive = TRUE)

  # un dernier bon en cache, daté du mois précédent
  dernier_bon <- list(
    vintage = "2026-07-01",
    table = sf::st_sf(
      id_local = "geovelo_1_22001",
      code_com_d = "22001", code_com_g = "22001",
      ame_d = "PISTE CYCLABLE", ame_g = "PISTE CYCLABLE",
      geometry = sf::st_sfc(sf::st_linestring(rbind(c(-1.5, 48.5), c(-1.49, 48.5))), crs = 4326)
    )
  )
  readr::write_rds(dernier_bon, sortie)

  # le « frais » est vide (le snapshot cassé — la porte de qualité échoue)
  vide <- sf::st_sf(
    id_local = character(0), code_com_d = character(0), code_com_g = character(0),
    ame_d = character(0), ame_g = character(0),
    geometry = sf::st_sfc(crs = 4326)
  )
  readr::write_rds(vide, file.path(cache, "frais.rds"))

  lire_fixture <- function(chemin) readRDS(chemin)

  res <- construire_amenagements_cyclables(
    file.path(cache, "frais.rds"), sortie = sortie, vintage = "2026-08-07",
    mappe = mappe_test(), lire = lire_fixture
  )

  expect_equal(res$vintage, "2026-07-01")  # le vintage du DERNIER BON, jamais celui du cassé
  expect_equal(nrow(res$table), 1L)
})

test_that("construire_amenagements_cyclables : l'échec SANS dernier bon en cache est une erreur dure", {
  cache <- tempfile("cache-")
  sortie <- tempfile("absent-")
  dir.create(cache, recursive = TRUE)

  vide <- sf::st_sf(
    id_local = character(0), code_com_d = character(0), code_com_g = character(0),
    ame_d = character(0), ame_g = character(0),
    geometry = sf::st_sfc(crs = 4326)
  )
  readr::write_rds(vide, file.path(cache, "frais.rds"))

  lire_fixture <- function(chemin) readRDS(chemin)

  expect_error(
    construire_amenagements_cyclables(file.path(cache, "frais.rds"),
                                      sortie = sortie, vintage = "2026-08-07",
                                      mappe = mappe_test(), lire = lire_fixture),
    "aucun dernier bon"
  )
})
