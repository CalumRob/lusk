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

# fixture_couverture ----------------------------------------------------------
# Un snapshot breton sf minimal pour le diagnostic de couverture (issue #233) :
# une ligne par département, segment horizontal de 0,1° (~7,4 km à 48,5°N en
# EPSG:2154) — les formes que le diagnostic lit.
fixture_couverture <- function() {
  sf::st_sf(
    id_local = c("seg_22", "seg_29", "seg_35", "seg_56"),
    code_com_d = c("22001", "29001", "35001", "56001"),
    code_com_g = c("22001", "29001", "35001", "56001"),
    ame_d = "PISTE CYCLABLE", ame_g = "PISTE CYCLABLE",
    geometry = sf::st_sfc(
      sf::st_linestring(rbind(c(-3.0, 48.5), c(-2.9, 48.5))),
      sf::st_linestring(rbind(c(-4.5, 48.2), c(-4.4, 48.2))),
      sf::st_linestring(rbind(c(-1.5, 48.0), c(-1.4, 48.0))),
      sf::st_linestring(rbind(c(-2.8, 47.7), c(-2.7, 47.7))),
      crs = 4326
    )
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
  # l'issue #233 : le succès porte aussi le diagnostic de couverture — le
  # premier run (sans précédent) compare à NA, jamais un signal inventé
  expect_true("couverture" %in% names(res))
  expect_equal(res$couverture$departement, c("22", "29", "35", "56"))
  expect_equal(res$couverture$lignes_actuel, c(n, 0L, 0L, 0L))
  expect_true(all(is.na(res$couverture$regression)))
  # le dernier bon est en cache, avec SA date
  expect_true(file.exists(sortie))
  cache_table <- readRDS(sortie)
  expect_equal(cache_table$vintage, "2026-08-07")
  expect_equal(nrow(cache_table$table), n)
})

test_that("construire_amenagements_cyclables : le succès diagnostique le frais vs le PRÉCÉDENT (le signal, jamais le cache écrasé)", {
  cache <- tempfile("cache-")
  sortie <- tempfile("dernier-bon-")
  dir.create(cache, recursive = TRUE)

  # un dernier bon du mois précédent, riche en 22 (11 lignes bretonnes)
  precedent <- list(
    vintage = "2026-07-01",
    table = dplyr::bind_rows(
      fixture_couverture(),
      sf::st_sf(
        id_local = paste0("extra_22_", 1:10),
        code_com_d = rep("22002", 10), code_com_g = rep("22002", 10),
        ame_d = "BANDE CYCLABLE", ame_g = "AUCUN",
        geometry = sf::st_sfc(lapply(seq(-3.0, -2.0, length.out = 10), function(lon) {
          sf::st_linestring(rbind(c(lon, 48.6), c(lon + 0.01, 48.6)))
        })),
        crs = 4326
      )
    )
  )
  readr::write_rds(precedent, sortie)

  # le frais : 22 est retombé à une seule ligne (la porte France entière
  # passe largement — le signal est invisible pour la porte, visible pour le
  # diagnostic)
  n <- 12000
  frais <- sf::st_sf(
    id_local = c(sprintf("geovelo_%d_22001", seq_len(n))),
    code_com_d = rep("22001", n),
    code_com_g = rep("22001", n),
    ame_d = rep("PISTE CYCLABLE", n), ame_g = rep("PISTE CYCLABLE", n),
    geometry = sf::st_sfc(lapply(seq_len(n), function(i) {
      sf::st_linestring(rbind(c(-1.5, 48.5), c(-1.5 + i / 1e6, 48.5)))
    }), crs = 4326)
  )
  readr::write_rds(frais, file.path(cache, "frais.rds"))

  res <- construire_amenagements_cyclables(
    file.path(cache, "frais.rds"), sortie = sortie, vintage = "2026-08-07",
    mappe = mappe_test(), lire = function(chemin) readRDS(chemin)
  )

  # le diagnostic a été calculé AVANT l'écrasement du cache : 29/35/56 ont
  # disparu du frais (0 ligne) — un signal de régression par département,
  # alors que la porte d'ensemble ne dit rien ; 22 a grandi, aucun signal
  expect_equal(res$couverture$regression, c(FALSE, TRUE, TRUE, TRUE))
  expect_equal(res$couverture$lignes_actuel,
               c(n, 0L, 0L, 0L))
  expect_equal(res$couverture$lignes_precedent,
               c(11L, 1L, 1L, 1L))
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
  # l'issue #233 : le repli porte aussi le diagnostic — le publié est comparé
  # à lui-même (la couverture publiée ne bouge pas) : aucun signal, jamais un
  # crash ; la trace du repli reste celle du vintage retourné
  expect_true("couverture" %in% names(res))
  expect_false(any(res$couverture$regression))
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

# diagnostic_couverture_amenagements --------------------------------------------
# Le diagnostic de couverture par département (issue #233) : pour chaque
# département breton, les LIGNES et les KM du snapshot COURANT vs le PRÉCÉDENT
# (le dernier bon du cache) — le signal de régression DISTINCT de la porte de
# qualité : la porte vérifie la forme d'ENSEMBLE (France entière, Bretagne non
# vide) et s'arrête bruyamment ; le diagnostic regarde CHAQUE département — une
# chute nette (lignes ou km qui s'effondrent) est un signal pour l'humain,
# jamais un crash.

test_that("diagnostic_couverture_amenagements : lignes + km par département, courant vs précédent — stable = aucun signal", {
  stable <- fixture_couverture()
  diag <- diagnostic_couverture_amenagements(stable, stable)

  # les QUATRE départements bretons, triés — jamais une ligne manquante
  expect_equal(diag$departement, c("22", "29", "35", "56"))
  # chaque département porte ses lignes et ses km, courant et précédent
  expect_equal(diag$lignes_actuel, c(1L, 1L, 1L, 1L))
  expect_equal(diag$lignes_precedent, c(1L, 1L, 1L, 1L))
  expect_true(all(diag$km_actuel > 0))
  expect_equal(diag$km_actuel, diag$km_precedent)
  # aucun signal quand rien ne bouge
  expect_false(any(diag$regression))
})

test_that("diagnostic_couverture_amenagements : une chute nette des LIGNES d'un département est un signal, pas un crash", {
  precedent <- dplyr::bind_rows(
    fixture_couverture(),
    # dix lignes de plus en 22 — le snapshot précédent était bien fourni là
    sf::st_sf(
      id_local = paste0("extra_22_", 1:10),
      code_com_d = rep("22002", 10), code_com_g = rep("22002", 10),
      ame_d = "BANDE CYCLABLE", ame_g = "AUCUN",
      geometry = sf::st_sfc(lapply(seq(-3.0, -2.0, length.out = 10), function(lon) {
        sf::st_linestring(rbind(c(lon, 48.6), c(lon + 0.01, 48.6)))
      })),
      crs = 4326
    )
  )
  actuel <- fixture_couverture()  # 22 retombe à UNE ligne

  diag <- diagnostic_couverture_amenagements(actuel, precedent)

  # le département 22 a perdu 11/12 de ses lignes — le signal est levé
  expect_equal(diag$lignes_actuel[diag$departement == "22"], 1L)
  expect_equal(diag$lignes_precedent[diag$departement == "22"], 11L)
  expect_true(diag$regression[diag$departement == "22"])
  # les autres départements, inchangés — aucun signal
  expect_false(any(diag$regression[diag$departement != "22"]))
})

test_that("diagnostic_couverture_amenagements : une chute nette des KM d'un département est un signal, jamais un crash", {
  # le même nombre de lignes en 35, mais des segments dix fois plus courts
  precedent <- fixture_couverture()
  actuel <- fixture_couverture()
  i35 <- which(actuel$code_com_d == "35001")
  sf::st_geometry(actuel)[i35] <- sf::st_sfc(
    sf::st_linestring(rbind(c(-1.5, 48.0), c(-1.499, 48.0)))
  )

  diag <- diagnostic_couverture_amenagements(actuel, precedent)

  expect_equal(diag$lignes_actuel[diag$departement == "35"], 1L)
  expect_true(diag$km_actuel[diag$departement == "35"] <
                SEUIL_REGRESSION_COUVERTURE * diag$km_precedent[diag$departement == "35"])
  expect_true(diag$regression[diag$departement == "35"])
  expect_false(any(diag$regression[diag$departement != "35"]))
})

test_that("diagnostic_couverture_amenagements : un département ABSENT du courant porte 0 et le signal — jamais une ligne manquante", {
  precedent <- fixture_couverture()
  actuel <- fixture_couverture()
  actuel <- actuel[actuel$code_com_d != "56001", ]  # 56 disparaît du courant

  diag <- diagnostic_couverture_amenagements(actuel, precedent)

  expect_equal(nrow(diag), 4L)  # les quatre départements restent
  expect_equal(diag$lignes_actuel[diag$departement == "56"], 0L)
  expect_equal(diag$lignes_precedent[diag$departement == "56"], 1L)
  expect_true(diag$regression[diag$departement == "56"])
})

test_that("diagnostic_couverture_amenagements : le PREMIER run (sans précédent) porte le courant et NA — un signal est impossible sans base", {
  diag <- diagnostic_couverture_amenagements(fixture_couverture())

  expect_equal(diag$departement, c("22", "29", "35", "56"))
  expect_equal(diag$lignes_actuel, c(1L, 1L, 1L, 1L))
  expect_true(all(is.na(diag$lignes_precedent)))
  expect_true(all(is.na(diag$km_precedent)))
  expect_true(all(is.na(diag$regression)))
})

test_that("diagnostic_couverture_amenagements : un input non-sf s'arrête bruyamment", {
  expect_error(diagnostic_couverture_amenagements(tibble::tibble(code_com_d = "22001")),
               "sf")
  expect_error(diagnostic_couverture_amenagements(fixture_couverture(),
                                                  tibble::tibble(code_com_d = "22001")),
               "sf")
})
