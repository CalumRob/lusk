# test-theme-metadata-pages-mobilite ---------------------------------------------
# Les Pages d'indicateur scalaires de la Mobilité (issue #461, rétréci par
# #1048 slice 2) : les ONZE indicateurs scalaires encore publiés portent chacun
# leur page scalaire complète — surface_reseaux_routiers, offre_tc,
# bornes_recharge, les deux stationnements, le ratio EV/fuel, le vélo/voiture,
# les trois densités de ravitaillement et raccordement_tc — par des descripteurs
# épinglés → le seam de publication → les artefacts committés. Les 29 pages du
# snapshot porté ont disparu avec le catalogue ; leurs reçus de retrait vivent
# dans scalar_contracts (`serving_disposition`).
#
# L'énumération est le devoir (le même verrou que les trajectoires #438, les
# distributions #440, les listes #439 et les relations #441) : une page ajoutée
# ou retirée échoue ICI — jamais une famille
# scalaire qui gonfle ou fond en silence.

PAGES_SCALAIRES_MOBILITE <- c(
  "surface_reseaux_routiers", "offre_tc", "bornes_recharge",
  "places_stationnement_velo_1000", "places_stationnement_voiture_1000",
  "bornes_ev_par_station_service", "stationnement_velo_par_voiture",
  "stations_service", "stations_service_1000", "bornes_recharge_1000",
  "raccordement_tc"
)

# Le Parquet Mobilité COMMIS porte désormais les trois densités de ravitaillement
# (#953). Toute page déclarée mais encore absente doit être nommée ici ; la liste
# vide signifie que la totalité du périmètre est publiée.
PAGES_SCALAIRES_MOBILITE_EN_ATTENTE_DE_PUBLICATION <- character()

racine_public <- file.path(testthat::test_path("..", "..", ".."), "public", "data")

test_that("le périmètre régional publié reflète le résolveur canonique", {
  meta <- lire_theme_metadata("mobilite")
  reference <- data.frame(territoire = c("22001", "22003"),
                          type = c("commune", "commune"), stringsAsFactors = FALSE)
  resolu <- resoudre_contextes_comparaison(reference, reference[1, ], "commune")$bretagne
  expect_identical(meta$comparison_scopes$bretagne$kind, resolu$kind)
  expect_identical(meta$comparison_scopes$bretagne$label, resolu$label)
})

test_that("le registre de directions d'accès du snapshot retiré a disparu du catalogue (#569, #1048)", {
  meta <- lire_theme_metadata("mobilite")
  # Les 15 clés `share_*` n'étaient que des directions : le slice 2 retire le
  # registre avec les pages. La garde n'est pas une exemption — elle vérifie
  # que R et le canon sont ensemble sur l'absence de ces clés.
  expect_length(meta$indicator_directions, 0L)
  expect_false(any(grepl("^share_", names(meta$indicator_directions))))
  expect_false(any(grepl("^share_", names(DIRECTIONS_MOBILITE))))
  # Le validateur croise toujours les directions déclarées : en réintroduire
  # une échoue FORT au lieu de réapparaître en silence.
  meta$indicator_directions$share_health_t <- "low"
  expect_error(
    valider_theme_metadata(meta, directions_module = DIRECTIONS_MOBILITE),
    "indicator_directions"
  )
})

test_that("l'énumération des pages Mobilité est connue — les pages multi-mesures et les onze scalaires (#461, #1048)", {
  meta <- lire_theme_metadata("mobilite")
  cles <- names(meta$indicator_pages)
  expect_setequal(
    cles,
    c(PAGES_SCALAIRES_MOBILITE, "voitures_menage", "offre_cyclable", "reseaux",
      "reseaux_par_habitant",
      "raccordement_courbe")
  )
  scalaires <- cles[vapply(meta$indicator_pages, function(p)
    identical(p$family, "scalar"), logical(1L))]
  expect_setequal(scalaires, PAGES_SCALAIRES_MOBILITE)
  expect_false(any(INDICATEURS_MOBILITE_RETIRES %in% cles))
})

test_that("les thèmes sans lecture ne déclarent ni histoire ni lecture dans leur catalogue (#1048)", {
  # Un seul prédicat nommé porte l'exemption #312/#1048 — aucun test ne
  # recopie `if (theme == "mobilite")`.
  for (theme in THEMES_METADATA) {
    meta <- lire_theme_metadata(theme)
    if (theme_sans_lecture(theme)) {
      expect_identical(length(unlist(meta$story_keys, use.names = FALSE)), 0L,
                       info = theme)
      expect_false(any(vapply(meta$subgroups, function(g) !is.null(g$reading),
                              logical(1L))), info = theme)
    } else {
      expect_true(length(unlist(meta$story_keys, use.names = FALSE)) > 0L,
                  info = theme)
    }
  }
})

test_that("valider_theme_metadata : le canon Mobilité épinglé porte ses onze pages scalaires complètes (#461, #1048)", {
  meta <- lire_theme_metadata("mobilite")
  expect_no_error(valider_theme_metadata(meta))
  expect_true("region" %in% unlist(meta$indicator_pages$voitures_menage$levels))
  expect_true("region" %in% unlist(meta$indicator_pages$raccordement_courbe$levels))
  expect_identical(unlist(meta$profile_contracts$voitures_menage$detail_units),
    c(sans_voiture = "%", une_voiture = "%", deux_plus = "%"))
})

test_that("le ratio bornes par station-service déclare ses deux sources (#900 : plus de marqueur read_model)", {
  meta <- lire_theme_metadata("mobilite")
  page <- meta$indicator_pages$bornes_ev_par_station_service

  expect_null(page$read_model)
  expect_identical(
    unlist(page$sources, use.names = FALSE),
    c("bpe_b316", "bornes-recharges")
  )
})

test_that("les densités de ravitaillement déclarent leur page, source et contrat scalaire (#953)", {
  meta <- lire_theme_metadata("mobilite")
  attendu <- list(
    stations_service = list(
      label = "Stations-service", unit = "stations", source = "bpe_b316"),
    stations_service_1000 = list(
      label = "Stations-service pour 1 000 hab.",
      unit = "stations / 1 000 hab", source = "bpe_b316"),
    bornes_recharge_1000 = list(
      label = "Bornes de recharge pour 1 000 hab.",
      unit = "bornes / 1 000 hab", source = "bornes-recharges")
  )
  groupes <- stats::setNames(
    lapply(meta$subgroups, `[[`, "indicators"),
    vapply(meta$subgroups, `[[`, character(1L), "key")
  )
  # le regroupement de fiche documenté : les trois densités vivent avec le
  # couple motorisation / ravitaillement (CONTEXT.md « L'offre de mobilité
  # alternative »), jamais dans l'accès aux services
  expect_true(all(names(attendu) %in% groupes[["motorisation"]]))
  expect_false(any(names(attendu) %in% groupes[["acces-aux-services"]]))

  for (cle in names(attendu)) {
    spec <- attendu[[cle]]
    page <- meta$indicator_pages[[cle]]
    expect_identical(page$family, "scalar", info = cle)
    expect_identical(page$label, spec$label, info = cle)
    expect_identical(page$unit, spec$unit, info = cle)
    expect_identical(page$direction, "high", info = cle)
    expect_identical(unlist(page$levels, use.names = FALSE),
                     c("commune", "epci", "departement"), info = cle)
    expect_identical(unlist(page$sources, use.names = FALSE), spec$source,
                     info = cle)
    expect_identical(meta$sources[[cle]], spec$source, info = cle)
    expect_identical(meta$indicator_labels[[cle]], spec$label, info = cle)
    # Un scalaire ne porte AUCUNE coordonnée de profil : la facette de
    # comparaison vit dans scalar_contracts (comparison_facet = la clé), jamais
    # dans indicator_pages.comparison. Un comparison.detail inventé ferait
    # filtrer les faits scalaires (detail = NULL) par l'app et rendrait la page
    # indisponible (#953, familySeam/correspondFait).
    expect_null(page$comparison, info = cle)
    expect_null(page$detail, info = cle)
    expect_true(nzchar(page$definition), info = cle)
    contract <- meta$scalar_contracts[[cle]]
    expect_identical(unlist(contract$allowed_levels, use.names = FALSE),
                     c("commune", "epci", "departement", "region"), info = cle)
    expect_identical(contract$comparison_facet, cle, info = cle)
    expect_identical(contract$missing_status, "not_available", info = cle)
  }
  # la preuve de contrat : la page producteur RÉELLE valide, sources croisées
  # contre les vintages du thème et directions contre le registre des rangs
  expect_no_error(valider_theme_metadata(meta, vintages = vintages_mobilite(),
                                        directions_module = DIRECTIONS_MOBILITE))
})

test_that("regional refuelling facts do not admit regional indicator pages (#1032)", {
  meta <- lire_theme_metadata("mobilite")
  ids <- c("stations_service", "stations_service_1000", "bornes_recharge_1000",
           "bornes_ev_par_station_service")
  for (id in ids) {
    expect_identical(unlist(meta$scalar_contracts[[id]]$allowed_levels,
                            use.names = FALSE),
                     c("commune", "epci", "departement", "region"), info = id)
    expect_false("region" %in% unlist(meta$indicator_pages[[id]]$levels),
                 info = id)
  }
})

test_that("aucune page scalaire Mobilité ne porte de coordonnée de profil (#953)", {
  meta <- lire_theme_metadata("mobilite")
  scalaires <- names(meta$indicator_pages)[vapply(
    meta$indicator_pages,
    function(page) identical(page$family %||% "scalar", "scalar"),
    logical(1L))]
  expect_true(all(c("stations_service", "stations_service_1000",
                    "bornes_recharge_1000") %in% scalaires))
  for (cle in scalaires) {
    page <- meta$indicator_pages[[cle]]
    expect_null(page$comparison,
                info = paste(cle, ": comparison est une coordonnée de profil"))
    expect_true(is.null(page$list) && is.null(page$composition) &&
                  is.null(page$trajectory) && is.null(page$distribution),
                info = paste(cle, ": extension de profil sur un scalaire"))
  }
})

test_that("les deux copies de métadonnées portent les mêmes entrées de ravitaillement (#953)", {
  skip_if_not(dir.exists(racine_public), "public/data absent — la racine du dépôt est introuvable")
  canon <- lire_theme_metadata("mobilite")
  public <- jsonlite::fromJSON(file.path(racine_public, "theme_mobilite.json"),
                               simplifyVector = FALSE)
  cles <- c("stations_service", "stations_service_1000", "bornes_recharge_1000")
  expect_identical(canon$indicator_labels[cles], public$indicator_labels[cles])
  expect_identical(canon$sources[cles], public$sources[cles])
  expect_identical(canon$indicator_pages[cles], public$indicator_pages[cles])
  expect_true(all(cles %in% unlist(public$indicator_keys)))
  groupe <- Filter(function(g) identical(g$key, "motorisation"),
                   public$subgroups)[[1L]]
  expect_true(all(cles %in% unlist(groupe$indicators)))
  # la projection navigateur garde son contrat : aucun champ producteur servi
  expect_false("scalar_contracts" %in% names(public))
})

test_that("public/data/theme_mobilite.json est EXACTEMENT la projection navigateur du canon épinglé (#953)", {
  skip_if_not(dir.exists(racine_public), "public/data absent — la racine du dépôt est introuvable")
  canon <- lire_theme_metadata("mobilite")
  sortie <- tempfile("mobilite-projection-")
  dir.create(sortie)
  on.exit(unlink(sortie, recursive = TRUE), add = TRUE)
  # le seam RÉEL de publication, avec les vintages et le registre des
  # directions du thème — jamais une copie éditée à la main
  expect_no_error(publier_theme_metadata(
    canon, sortie = sortie, vintages = vintages_mobilite(),
    theme_attendu = "mobilite", directions_module = DIRECTIONS_MOBILITE
  ))
  republie <- file.path(sortie, "theme_mobilite.json")
  commis <- file.path(racine_public, "theme_mobilite.json")
  octets <- function(chemin) {
    taille <- file.info(chemin)$size
    brut <- readBin(chemin, "raw", n = taille)
    brut[brut != as.raw(0x0d)]
  }
  expect_identical(
    octets(republie), octets(commis),
    info = paste0("public/data/theme_mobilite.json n'est pas la projection ",
                  "du canon épinglé : régénérer par publier_theme_metadata")
  )
  # la parité STRUCTURELLE complète, pas seulement les trois nouvelles clés :
  # le fichier commis est le list() que projette le seam, champ pour champ
  expect_identical(
    projection_navigateur(canon),
    jsonlite::fromJSON(commis, simplifyVector = FALSE)
  )
  publie <- jsonlite::fromJSON(commis, simplifyVector = FALSE)
  producteur_seulement <- c(
    "semantic_resources", "story_keys", "observed_collection_contracts",
    "indicator_directions", "comparison_scopes",
    "building_comparison", "service_share_scalar", "distribution_contracts",
    "scalar_contracts", "profile_contracts", "map_layers", "owned_series_routes"
  )
  expect_false(any(producteur_seulement %in% names(publie)))
  # les enregistrements de source et les libellés de trajectoire suivent le
  # canon COURANT (la dérive BPE 2024 / matrice_temps_mairies est morte)
  expect_identical(publie$source_records, projection_navigateur(canon)$source_records)
  expect_identical(publie$indicator_labels$raccordement_tc,
                   "Population bretonne jointe en 90 minutes en transports en commun")
  expect_identical(publie$sources$raccordement_tc,
                   "raccordement_gtfs_national")
  expect_length(publie$detail_labels$raccordement_courbe, 73L)
})

test_that("la trajectoire raccordement déclare exactement la grille publiée et ses repères humains", {
  meta <- lire_theme_metadata("mobilite")
  page <- meta$indicator_pages$raccordement_courbe
  expect_identical(
    unlist(page$comparison$details, use.names = FALSE),
    paste0("t", sprintf("%04d", seq.int(0L, 360L, by = 5L)))
  )
  expect_identical(unlist(page$trajectory$endpoints, use.names = FALSE),
                   c("t0000", "t0360"))
  expect_identical(page$trajectory$axis, "numeric")
  expect_identical(unlist(page$levels, use.names = FALSE),
                   c("commune", "epci", "departement", "region"))
  expect_identical(vapply(page$trajectory$ticks, `[[`, character(1L), "label"),
                   c("0", "15", "30", "45", "1 h", "1 h 30", "2 h",
                     "3 h", "4 h", "5 h", "6 h"))
  expect_no_error(valider_theme_metadata(meta))
  ordinal <- meta
  ordinal$indicator_pages$raccordement_courbe$trajectory$axis <- "ordinal"
  expect_error(valider_theme_metadata(ordinal), "numeric")
})

test_that("map_layers déclare les faits cartographiables sans exposer les séries composées (#487)", {
  meta <- lire_theme_metadata("mobilite")
  expect_identical(meta$map_layers, list(
    offre_tc = TRUE,
    raccordement_tc = TRUE,
    raccordement_courbe = FALSE,
    raccordement_reference = FALSE
  ))

  inconnu <- meta
  inconnu$map_layers$fantome <- TRUE
  expect_error(valider_theme_metadata(inconnu), "indicateur")

  invalide <- meta
  invalide$map_layers$raccordement_tc <- "oui"
  expect_error(valider_theme_metadata(invalide), "booléen")

  vide <- meta
  vide$map_layers <- list()
  expect_no_error(valider_theme_metadata(vide))
})

test_that("les profils Mobilité Bretagne sont déclarés complets pour les agrégats producteurs", {
  meta <- lire_theme_metadata("mobilite")
  profils <- c("reseaux", "reseaux_par_habitant", "offre_cyclable")
  for (indicateur in profils) {
    expect_true("region" %in% unlist(meta$indicator_pages[[indicateur]]$levels,
                                    use.names = FALSE), info = indicateur)
  }
  expect_true("region" %in% unlist(meta$profile_contracts$reseaux$allowed_levels,
                                  use.names = FALSE))
  expect_true("region" %in% unlist(meta$profile_contracts$offre_cyclable$allowed_levels,
                                  use.names = FALSE))
  expect_true("region" %in% unlist(meta$scalar_contracts$stationnement_velo_par_voiture$allowed_levels,
                                  use.names = FALSE))
})

test_that("publier_theme_metadata : les onze pages passent le seam et survivent au round-trip (#461, #1048)", {
  meta <- lire_theme_metadata("mobilite")
  sortie <- file.path(tempdir(), "pages-scalaires-mobilite")
  dir.create(sortie, showWarnings = FALSE)
  on.exit(unlink(sortie, recursive = TRUE), add = TRUE)

  expect_no_error(publier_theme_metadata(meta, sortie, theme_attendu = "mobilite"))
  relu <- jsonlite::fromJSON(file.path(sortie, "theme_mobilite.json"),
                             simplifyVector = FALSE)
  for (cle in PAGES_SCALAIRES_MOBILITE) {
    page <- relu$indicator_pages[[cle]]
    expect_identical(page$family, "scalar", info = cle)
    expect_true(page$direction %in% c("high", "low"), info = cle)
  }
  # #1048 : 11 contrats de page retenus + 29 reçus de retrait (dont les 15
  # `share_*` qui n'ont jamais eu de page scalaire).
  expect_length(meta$scalar_contracts,
                length(PAGES_SCALAIRES_MOBILITE) + length(INDICATEURS_MOBILITE_RETIRES))
  expect_setequal(
    setdiff(names(meta$scalar_contracts), INDICATEURS_MOBILITE_RETIRES),
    PAGES_SCALAIRES_MOBILITE)
  expect_length(meta$profile_contracts, 4L)
  expect_identical(meta$map_layers, list(
    offre_tc = TRUE,
    raccordement_tc = TRUE,
    raccordement_courbe = FALSE,
    raccordement_reference = FALSE
  ))
  expect_false(any(c("scalar_contracts", "profile_contracts", "map_layers") %in% names(relu)))
  expect_identical(relu$indicator_pages, meta$indicator_pages)
  checked_in <- jsonlite::fromJSON(file.path(racine_public, "theme_mobilite.json"),
                                   simplifyVector = FALSE)
  expect_false(any(c("scalar_contracts", "profile_contracts", "map_layers") %in% names(checked_in)))
  expect_true("raccordement_tc" %in% names(checked_in$indicator_pages))
  expect_identical(unlist(checked_in$indicator_pages$raccordement_tc$levels,
                          use.names = FALSE),
                   c("commune", "epci", "departement", "region"))
})

test_that("parité pages scalaires ↔ Parquet Mobilité conservé : niveaux, unité et direction (#461)", {
  skip_if_not(dir.exists(racine_public), "public/data absent — la racine du dépôt est introuvable")
  meta <- lire_theme_metadata("mobilite")
  faits <- nanoparquet::read_parquet(file.path(racine_public, "indicateurs_mobilite.parquet"))
  # L'artefact COMMIS porte les trois densités de ravitaillement (#953). La
  # parité couvre toutes les clés déclarées, et tout diff restant doit être
  # explicitement nommé — jamais une clé oubliée derrière un filtre.
  cles_publiees <- intersect(PAGES_SCALAIRES_MOBILITE, unique(faits$key))
  expect_setequal(
    setdiff(PAGES_SCALAIRES_MOBILITE, cles_publiees),
    PAGES_SCALAIRES_MOBILITE_EN_ATTENTE_DE_PUBLICATION
  )
  for (cle in cles_publiees) {
    page <- meta$indicator_pages[[cle]]
    lignes <- faits[faits$key == cle, ]
    expect_true(nrow(lignes) > 0L, info = cle)
    # la page ne déclare un niveau comparable que si les faits le publient
    for (niveau in unlist(page$levels, use.names = FALSE)) {
      expect_true(sum(lignes$type == niveau) > 0L, info = paste(cle, niveau, sep = " · "))
    }
    # l'unité déclarée est EXACTEMENT celle des faits publiés — jamais une unité qui ment
    expect_identical(page$unit, unique(lignes$unit), info = cle)
    # la direction de page est celle du calcul des rangs (DIRECTIONS_MOBILITE,
    # ADR-0015 — une seule source pour la désirabilité)
    expect_identical(page$direction, DIRECTIONS_MOBILITE[[cle]], info = cle)
  }
})

test_that("les artefacts modeles-lecture sont retirés de public/data et app/dist/data (#900)", {
  skip_if_not(dir.exists(racine_public), "public/data absent — la racine du dépôt est introuvable")
  racine_repo <- testthat::test_path("..", "..", "..")
  for (racine in c(racine_public, file.path(racine_repo, "app", "dist", "data"))) {
    expect_false(file.exists(file.path(racine, "modeles-lecture")),
                 info = racine)
    expect_false(file.exists(file.path(racine, "modeles-lecture", "manifest.json")),
                 info = racine)
  }
})

test_that("la provenance B316 et IRVE publiée suit les manifests canoniques", {
  metadata <- jsonlite::fromJSON(
    testthat::test_path("..", "..", "inst", "extdata", "theme-metadata", "theme_mobilite.json"),
    simplifyVector = FALSE
  )

  bpe <- metadata$source_records$bpe_b316$vintages[[1]]
  irve <- metadata$source_records[["bornes-recharges"]]$vintages[[1]]
  bpe_manifest <- MANIFEST_MOBILITE_BPE_B316[1, ]
  irve_manifest <- MANIFEST_MOBILITE_BORNES[1, ]

  expect_identical(bpe$version, as.character(bpe_manifest$vintage))
  expect_identical(bpe$dateReference, as.character(bpe_manifest$date_reference))
  expect_identical(bpe$datePublication, as.character(bpe_manifest$date_publication))
  expect_identical(irve$version, as.character(irve_manifest$vintage))
  expect_identical(irve$dateReference, as.character(irve_manifest$date_reference))
  expect_identical(irve$datePublication, as.character(irve_manifest$date_publication))
})
