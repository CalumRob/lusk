# test-rangs-milieux ------------------------------------------------------------
# Le classement de l'indicateur « Consommation d'ENAF » (issue #172, ADR-0014) :
# le scalaire classé est la PART de la surface du territoire consommée sur la
# fenêtre 2021-2025 — jamais les hectares bruts (une grande commune a plus de
# terre : la comparaison se fait à surface égale). Les valeurs vérifiées à la
# main (le fixture) :
#   part = naf21art25 (ha) x 10 000 / surfcom2025 (m²)
#     22001 : 233202 / 50311729 ≈ 0,00463   (23,3 ha sur une grande surface)
#     22002 : 100000 / 15000000 ≈ 0,00667   (10 ha sur une petite surface)
#     29001 : 150000 / 20000000 = 0,0075
#     29002 : 25000 / 9000000 ≈ 0,00278
# L'ordre des parts (29002 < 22001 < 22002 < 29001) DIFFÈRE de l'ordre des
# hectares bruts (29002 < 22002 < 29001 < 22001) : 22001 consomme le PLUS de
# terre mais sa part est plus faible que celle de 22002 — le point de la spec.

test_that("la fenêtre est classée sur la part de surface, jamais sur les hectares bruts", {
  p <- compute_payload(communes_fixture_milieux(), theme = theme_milieux())

  # la publication reste en hectares (la part n'est QUE le scalaire classé)
  expect_equal(valeur_payload(p, "22001", "conso_enaf_fenetre")$value,
               233202 / 10000)
  # les rangs de région (n = 4 communes) — l'ordre des parts vérifié à la main
  expect_equal(valeur_payload(p, "29002", "conso_enaf_fenetre")$rang_reg, 0)
  expect_equal(valeur_payload(p, "22001", "conso_enaf_fenetre")$rang_reg, 0.25)
  expect_equal(valeur_payload(p, "22002", "conso_enaf_fenetre")$rang_reg, 0.5)
  expect_equal(valeur_payload(p, "29001", "conso_enaf_fenetre")$rang_reg, 0.75)
  # dans l'EPCI (n = 2) et dans le département (les mêmes comparaisons)
  expect_equal(valeur_payload(p, "22001", "conso_enaf_fenetre")$rang_epci, 0)
  expect_equal(valeur_payload(p, "22002", "conso_enaf_fenetre")$rang_epci, 0.5)
  expect_equal(valeur_payload(p, "29002", "conso_enaf_fenetre")$rang_epci, 0)
  expect_equal(valeur_payload(p, "29001", "conso_enaf_fenetre")$rang_epci, 0.5)
  expect_equal(valeur_payload(p, "22001", "conso_enaf_fenetre")$rang_dep, 0)
  expect_equal(valeur_payload(p, "22002", "conso_enaf_fenetre")$rang_dep, 0.5)

  # le point de la spec : 22001 consomme PLUS de terre (23,3 ha > 10 ha) mais
  # sa PART est plus faible — il est classé derrière 22002
  expect_true(valeur_payload(p, "22001", "conso_enaf_fenetre")$value >
                valeur_payload(p, "22002", "conso_enaf_fenetre")$value)
  expect_true(valeur_payload(p, "22001", "conso_enaf_fenetre")$rang_reg <
                valeur_payload(p, "22002", "conso_enaf_fenetre")$rang_reg)

  # une EPCI : classée parmi les EPCIs de la région (l'autre est incomplète NA)
  expect_equal(valeur_payload(p, "200000001", "conso_enaf_fenetre")$rang_reg, 0)
})

test_that("la série annuelle porte le même rang que la fenêtre (la part de surface)", {
  p <- compute_payload(communes_fixture_milieux(), theme = theme_milieux())

  # les 14 lignes annuelles d'un territoire portent le MÊME rang — celui de la
  # part de surface consommée de SON territoire (le scalaire de la clé)
  annuel <- valeur_payload(p, "22001", "conso_enaf_annuel")
  expect_equal(nrow(annuel), 14L)
  expect_equal(length(unique(annuel$rang_reg)), 1L)
  expect_equal(unique(annuel$rang_reg), 0.25)
  expect_equal(unique(valeur_payload(p, "29001", "conso_enaf_annuel")$rang_reg),
               0.75)
  expect_equal(unique(valeur_payload(p, "29002", "conso_enaf_annuel")$rang_reg),
               0)
})

test_that("un territoire sans donnée (ou au total incomplet) n'a pas de rang", {
  p <- compute_payload(communes_fixture_milieux(), theme = theme_milieux())

  # 29003 : consommation NA -> fenêtre NA -> aucun rang (le NA n'empoisonne
  # pas le groupe — les autres communes gardent leurs rangs, testé ci-dessus)
  f <- valeur_payload(p, "29003", "conso_enaf_fenetre")
  expect_true(is.na(f$value))
  expect_true(is.na(f$rang_epci))
  expect_true(is.na(f$rang_dep))
  expect_true(is.na(f$rang_reg))
  # l'EPCI Y : total incomplet (membre 29003 NA) -> NA
  e <- valeur_payload(p, "200000002", "conso_enaf_fenetre")
  expect_true(is.na(e$value))
  expect_true(is.na(e$rang_reg))
  # la série annuelle de la commune sans donnée : 14 lignes, aucune rang
  expect_true(all(is.na(valeur_payload(p, "29003", "conso_enaf_annuel")$rang_reg)))
})
