# test-amenagements-cyclables.R ------------------------------------------------
# Le fragment AMENAGEMENTS CYCLABLES (issue #222, ticket #228) : le manifeste
# Mobilité remplace la source du mode `b` (vélo) de `reseaux` — du raw OSM
# (pbf Geofabrik, mode `manuel`) au jeu Geovelo « Aménagements cyclables
# France Métropolitaine » (snapshot parquet mensuel, mode `cron`, ODbL —
# ADR-0001). `osm_reseaux` RESTE le fragment des modes `t`/`c` (le pbf n'est
# pas retiré : les modes à pied/voiture et le dénominateur routier de la
# figure « L'offre cyclable » le consomment toujours). Le contrat
# `verifier_contrat_mobilite_demande_reseaux` est réécrit pour épingler les
# DEUX fragments : `osm_reseaux` (t/c, manuel, pbf) et `amenagements_cyclables`
# (b, cron, parquet mensuel).
#
# Vérifié sur le jeu réel (research note §4, 2026-08-08) : chaque snapshot est
# UNE ressource distincte (pas d'alias « latest » stable — le champ `latest`
# de l'API se référence soi-même), le manifeste épingle donc un snapshot
# précis (france-20260807.parquet, 64,5 Mo, 412 681 lignes) ; la mise à jour
# mensuelle du pin est le travail du Watchdog (la même discipline que les
# autres sources épinglées). Le vintage est la date du snapshot (2026-08),
# jamais « aujourd'hui ».

# le fragment dans le manifeste concaténé -------------------------------------

test_that("MANIFEST_MOBILITE : le fragment amenagements_cyclables — Geovelo, cron mensuel, ODbL", {
  frag <- MANIFEST_MOBILITE[MANIFEST_MOBILITE$id == "amenagements_cyclables", ]

  expect_equal(nrow(frag), 1L)
  expect_equal(frag$fichier, "france-20260807.parquet")
  expect_equal(frag$vintage, "2026-08")
  expect_equal(frag$licence, "odbl")
  expect_equal(frag$mode, "cron")
  expect_equal(frag$type, "fichier")
  # la référence est la date du snapshot (2026-08-07), la publication la mise
  # en ligne (même jour) — la publication jamais antérieure à la référence
  expect_equal(frag$date_reference, "2026-08-07")
  expect_false(frag$date_publication < frag$date_reference)
})

test_that("MANIFEST_MOBILITE : osm_reseaux reste le fragment des modes t/c (le pbf n'est pas retiré)", {
  frag <- MANIFEST_MOBILITE[MANIFEST_MOBILITE$id == "osm_reseaux", ]

  expect_equal(nrow(frag), 1L)
  expect_equal(frag$fichier, "bretagne-latest.osm.pbf")
  expect_equal(frag$mode, "manuel")
  expect_equal(frag$licence, "odbl")
})

# verifier_contrat_mobilite_demande_reseaux -------------------------------------

test_that("verifier_contrat_mobilite_demande_reseaux : les deux fragments épinglés (osm t/c, amenagements b)", {
  expect_true(verifier_contrat_mobilite_demande_reseaux(MANIFEST_MOBILITE))

  osm <- MANIFEST_MOBILITE[MANIFEST_MOBILITE$id == "osm_reseaux", ]
  expect_true(verifier_contrat_mobilite_demande_reseaux(
    dplyr::bind_rows(osm,
                     MANIFEST_MOBILITE[MANIFEST_MOBILITE$id == "amenagements_cyclables", ],
                     MANIFEST_MOBILITE[MANIFEST_MOBILITE$id == "rp_logement_princ", ],
                     MANIFEST_MOBILITE[MANIFEST_MOBILITE$id == "communes_limites", ])))
})

test_that("verifier_contrat_mobilite_demande_reseaux : amenagements_cyclables hors contrat (mauvais fichier) échoue", {
  # le contrat épingle le snapshot parquet mensuel — jamais le geojson (305 Mo)
  # ni un autre millésime
  defectueux <- MANIFEST_MOBILITE
  i <- which(defectueux$id == "amenagements_cyclables")
  defectueux$fichier[i] <- "france-20260807.geojson"
  expect_error(verifier_contrat_mobilite_demande_reseaux(defectueux), "parquet")
})

test_that("verifier_contrat_mobilite_demande_reseaux : le mode de amenagements_cyclables est cron (jamais manuel)", {
  defectueux <- MANIFEST_MOBILITE
  i <- which(defectueux$id == "amenagements_cyclables")
  defectueux$mode[i] <- "manuel"
  expect_error(verifier_contrat_mobilite_demande_reseaux(defectueux), "cron")
})

test_that("verifier_contrat_mobilite_demande_reseaux : osm_reseaux reste manuel (le pbf, jamais un cron)", {
  defectueux <- MANIFEST_MOBILITE
  i <- which(defectueux$id == "osm_reseaux")
  defectueux$mode[i] <- "cron"
  expect_error(verifier_contrat_mobilite_demande_reseaux(defectueux), "manuel")
})

test_that("verifier_contrat_mobilite_demande_reseaux : le vintage de amenagements_cyclables est le mois du snapshot", {
  defectueux <- MANIFEST_MOBILITE
  i <- which(defectueux$id == "amenagements_cyclables")
  defectueux$vintage[i] <- "2026"
  expect_error(verifier_contrat_mobilite_demande_reseaux(defectueux), "vintage")
})

# la source de référence de l'indicateur reseaux ---------------------------------

test_that("INDICATEURS_MOBILITE : reseaux référence amenagements_cyclables (le mode b, sa composante signature)", {
  # la règle du « Reference source » (CONTEXT.md) : la source de la composante
  # SIGNATURE de l'indicateur — pour `reseaux`, le mode b (vélo) est la raison
  # d'être du bloc Mobilité ; la fraîcheur mensuelle du jeu Geovelo est ce que
  # l'indicateur promet. osm_reseaux (t/c) reste une source de l'indicateur,
  # mais la référence est amenagements_cyclables.
  ind <- INDICATEURS_MOBILITE[INDICATEURS_MOBILITE$key == "reseaux", ]
  expect_true("amenagements_cyclables" %in% unlist(ind$sources))
  expect_equal(ind$source_reference, "amenagements_cyclables")
})
