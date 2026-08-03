# Le SEAM du thème Habitat : la forme tabulaire du payload (issue #17). Même
# contrat que Démographie — deux tables de faits + la référence — PLUS la
# colonne nullable `n` sur indicateurs (le nombre d'observations des
# indicateurs d'échantillon) et une table d'histoires au schéma de l'état
# énergétique du parc (stub, issue #18).

test_that("le payload couvre chaque territoire du fixture", {
  p <- payload_habitat()
  territoires_attendus <- c(
    "22001", "22002", "29001", "29002", # communes
    "200000001", "200000002",           # EPCIs
    "22", "29",                         # départements
    "53"                                # région Bretagne
  )
  expect_setequal(unique(p$indicateurs$territoire), territoires_attendus)
  expect_setequal(unique(p$histoires$territoire), territoires_attendus)
  expect_setequal(unique(p$territoires$territoire), territoires_attendus)
})

test_that("chaque territoire porte les 5 clés avec leur multiplicité", {
  p <- payload_habitat()
  attentes <- c(mix_logements = 3, statut_anciennete_taille = 14,
                prix_m2 = 1L + length(ANNEE_DVF), part_passoires = 1,
                distribution_dpe = 7)
  for (code in unique(p$indicateurs$territoire)) {
    tab <- p$indicateurs[p$indicateurs$territoire == code, , drop = FALSE]
    for (cle in names(attentes)) {
      expect_equal(sum(tab$key == cle), attentes[[cle]], info = paste(code, cle))
    }
  }
})

test_that("la forme des trois tables est le contrat (avec la colonne n)", {
  p <- payload_habitat()
  expect_named(p, c("indicateurs", "histoires", "territoires"))
  # Démographie n'a pas de n ; Habitat le publie — la colonne est là
  expect_named(p$indicateurs, c(
    "territoire", "type", "theme", "key", "detail", "value", "unit",
    "rang_epci", "rang_dep", "rang_reg",
    "vintage_source", "vintage_version",
    "vintage_date_reference", "vintage_date_publication",
    "n"
  ))
  expect_named(p$histoires, c(
    "territoire", "type", "theme", "story_key",
    "classification", "part_passoires", "part_abc", "n_dpe"
  ))
  expect_named(p$territoires, c("territoire", "type", "nom", "departement"))
  expect_true(all(p$indicateurs$theme == "habitat"))
  expect_true(all(p$histoires$theme == "habitat"))
})

test_that("la colonne n : publiée pour DVF/DPE, NA pour les stocks", {
  p <- payload_habitat()
  tab <- p$indicateurs
  # les indicateurs d'échantillon portent leur nombre d'observations
  expect_true(all(!is.na(tab$n[tab$key == "prix_m2"])))
  expect_true(all(!is.na(tab$n[tab$key == "part_passoires"])))
  expect_true(all(!is.na(tab$n[tab$key == "distribution_dpe"])))
  # les indicateurs de stock n'ont pas d'échantillon
  expect_true(all(is.na(tab$n[tab$key == "mix_logements"])))
  expect_true(all(is.na(tab$n[tab$key == "statut_anciennete_taille"])))
})

test_that("les histoires sont le stub de schéma (toutes valeurs NA, issue #18)", {
  p <- payload_habitat()
  expect_true(all(p$histoires$story_key == "etat-energetique-du-parc"))
  expect_true(all(is.na(p$histoires$classification)))
  expect_true(all(is.na(p$histoires$part_passoires)))
  expect_true(all(is.na(p$histoires$part_abc)))
  expect_true(all(is.na(p$histoires$n_dpe)))
})

test_that("la table de référence porte les noms réels", {
  p <- payload_habitat()
  tr <- p$territoires
  expect_equal(tr$nom[tr$territoire == "22001"], "Commune A1")
  expect_equal(tr$nom[tr$territoire == "200000001"], "EPCI X")
  expect_setequal(tr$nom[tr$type == "departement"], c("Département 22",
                                                      "Département 29"))
  expect_equal(tr$nom[tr$type == "region"], "Bretagne")
  # le département d'appartenance (pluralité par le stock de logements)
  expect_equal(tr$departement[tr$territoire == "22001"], "22")
  expect_true(is.na(tr$departement[tr$territoire == "53"]))
})

test_that("chaque indicateur est estampillé depuis sa source de référence", {
  p <- payload_habitat()
  # RP : mix et statut/ancienneté/taille
  for (cle in c("mix_logements", "statut_anciennete_taille")) {
    src <- unique(p$indicateurs$vintage_source[p$indicateurs$key == cle])
    expect_equal(src, "INSEE — Logements (dossier complet)", info = cle)
    expect_equal(unique(p$indicateurs$vintage_date_publication[
      p$indicateurs$key == cle]), "2026-06-30", info = cle)
  }
  # DVF : le millésime le plus récent de la fenêtre (le composant signature
  # de la série poolée)
  expect_equal(
    unique(p$indicateurs$vintage_source[p$indicateurs$key == "prix_m2"]),
    "Etalab — DVF géolocalisées"
  )
  expect_equal(
    unique(p$indicateurs$vintage_version[p$indicateurs$key == "prix_m2"]),
    "2025"
  )
  expect_equal(
    unique(p$indicateurs$vintage_date_publication[
      p$indicateurs$key == "prix_m2"]),
    "2026-05-18"
  )
  # DPE : la base roulante — pas encore de date de pull dans les tests
  for (cle in c("part_passoires", "distribution_dpe")) {
    expect_equal(
      unique(p$indicateurs$vintage_source[p$indicateurs$key == cle]),
      "ADEME — Observatoire DPE, logements existants (dpe03existant)",
      info = cle
    )
    expect_true(all(is.na(p$indicateurs$vintage_date_publication[
      p$indicateurs$key == cle])), info = cle)
  }
})

test_that("le payload du fixture est valide (validation générique + thème)", {
  p <- payload_habitat()
  expect_no_error(validate_payload(
    p, indicateurs = INDICATEURS_HABITAT, vintages = vintages_habitat(),
    validations = validations_habitat
  ))
})
