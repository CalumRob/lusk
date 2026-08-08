# test-rangs-milieux ------------------------------------------------------------
# Le classement de l'indicateur pivote vers les états OCS-GE (issue #239, spec
# #225, ADR-0017) : le nouveau jeu de clés est « Intensité état · Série
# annuelle » —
#   - artif_par_habitant (l'état artificialisé par habitant, m²/hab, DEUX
#     lignes par territoire — le millésime M2 puis M3) : ÉCHELLE LIBRE par
#     construction (déjà par habitant — aucune normalisation de surface) — le
#     scalaire classé est l'état à M3 lui-même, et les DEUX lignes du
#     territoire partagent le rang de cet état final (le même motif que la
#     série annuelle, qui partage le rang de la fenêtre) ;
#   - conso_enaf_annuel (la série annuelle 2011-2024, 14 lignes par
#     territoire) : INCHANGÉE — le scalaire reste la PART de la surface du
#     territoire consommée (jamais les hectares bruts, ADR-0014) ; ses 14
#     lignes partagent le rang du territoire.
# La fenêtre (conso_enaf_fenetre) et la trajectoire ZAN (trajectoire_zan)
# sont mortes avec les flux CONSOENAF : leurs rangs quittent le jeu de clés
# (#63). Le fixture est celui du câblage territorial OCS-GE (issue #237) —
# sept communes, trois EPCIs, quatre départements et la région — pour que
# l'état par habitant existe et se classe. Les valeurs vérifiées à la main :
#   état M3 par habitant (m²/hab) — 56001 : 0 · 35001 : 400/5200 · 29001 :
#   1200/2950 · 22001 : 1200/2400 · 22002 : 800/1300 · 29002 : 800/910.

test_that("artif_par_habitant : classé TEL QUEL sur l'état à M3 (m²/hab, jamais une normalisation de surface)", {
  p <- compute_payload(communes_fixture_milieux_ocsge(), theme = theme_milieux())

  # la valeur publiée EST l'état par habitant (m²/hab) — jamais une part de
  # surface, jamais les hectares bruts
  expect_equal(valeur_payload(p, "22001", "artif_par_habitant", "2021")$value, 0)
  expect_equal(valeur_payload(p, "22001", "artif_par_habitant", "2025")$value,
               1200 / 2400)
  expect_equal(valeur_payload(p, "56001", "artif_par_habitant", "2022")$value,
               400 / 2900)
  expect_equal(valeur_payload(p, "56001", "artif_par_habitant", "2024")$value, 0)

  # les rangs de région (n = 6 communes à valeur) — les percentiles des
  # valeurs brutes M3 (0 ; 0,0769 ; 0,4068 ; 0,5 ; 0,6154 ; 0,8791), vérifiés
  # à la main : 56001 < 35001 < 29001 < 22001 < 22002 < 29002
  expect_equal(valeur_payload(p, "56001", "artif_par_habitant", "2024")$rang_reg, 0)
  expect_equal(valeur_payload(p, "35001", "artif_par_habitant", "2023")$rang_reg,
               1 / 6)
  expect_equal(valeur_payload(p, "29001", "artif_par_habitant", "2024")$rang_reg,
               2 / 6)
  expect_equal(valeur_payload(p, "22001", "artif_par_habitant", "2025")$rang_reg,
               3 / 6)
  expect_equal(valeur_payload(p, "22002", "artif_par_habitant", "2025")$rang_reg,
               4 / 6)
  expect_equal(valeur_payload(p, "29002", "artif_par_habitant", "2024")$rang_reg,
               5 / 6)
  # dans l'EPCI (n = 2) et dans le département (les mêmes comparaisons)
  expect_equal(valeur_payload(p, "22001", "artif_par_habitant", "2025")$rang_epci, 0)
  expect_equal(valeur_payload(p, "22002", "artif_par_habitant", "2025")$rang_epci, 0.5)
  expect_equal(valeur_payload(p, "29001", "artif_par_habitant", "2024")$rang_epci, 0)
  expect_equal(valeur_payload(p, "29002", "artif_par_habitant", "2024")$rang_epci, 0.5)
  expect_equal(valeur_payload(p, "35001", "artif_par_habitant", "2023")$rang_epci, 0.5)
  expect_equal(valeur_payload(p, "56001", "artif_par_habitant", "2022")$rang_epci, 0)
  expect_equal(valeur_payload(p, "22001", "artif_par_habitant", "2025")$rang_dep, 0)
  expect_equal(valeur_payload(p, "22002", "artif_par_habitant", "2025")$rang_dep, 0.5)

  # le point de la spec : le rang suit l'état par habitant TEL QUEL, jamais la
  # part de surface consommée — 35001 consomme proportionnellement BEAUCOUP
  # plus de surface que 22001, mais son m²/hab est plus faible : il est classé
  # DERRIÈRE
  expect_true(valeur_payload(p, "35001", "artif_par_habitant", "2023")$rang_reg <
                valeur_payload(p, "22001", "artif_par_habitant", "2025")$rang_reg)
})

test_that("artif_par_habitant : les DEUX lignes du territoire partagent le rang de l'état à M3", {
  p <- compute_payload(communes_fixture_milieux_ocsge(), theme = theme_milieux())

  # 56001 : M2 vaut 400/2900, M3 vaut 0 — les VALEURS diffèrent, les RANGS
  # sont ceux de l'état final (M3), identiques sur les deux lignes
  m2 <- valeur_payload(p, "56001", "artif_par_habitant", "2022")
  m3 <- valeur_payload(p, "56001", "artif_par_habitant", "2024")
  expect_true(m2$value != m3$value)
  expect_equal(m2$rang_reg, m3$rang_reg)
  expect_equal(m2$rang_epci, m3$rang_epci)
  expect_equal(m2$rang_dep, m3$rang_dep)
  expect_equal(m2$rang_reg, 0)  # l'état final (0 m²/hab) est le plus faible

  # 22001 : M2 nul, M3 = 0,5 — même rang partagé (3/6 en région)
  expect_equal(valeur_payload(p, "22001", "artif_par_habitant", "2021")$rang_reg,
               valeur_payload(p, "22001", "artif_par_habitant", "2025")$rang_reg)
  expect_equal(valeur_payload(p, "22001", "artif_par_habitant", "2025")$rang_reg,
               3 / 6)

  # chaque territoire publie EXACTEMENT deux lignes, qui partagent le rang (le
  # motif multi-détails de la machinerie — commune, EPCI, département)
  for (code in c("22001", "29001", "35001", "200000001", "200000003", "22")) {
    lignes <- p$indicateurs[p$indicateurs$territoire == code &
                              p$indicateurs$key == "artif_par_habitant", ]
    expect_equal(nrow(lignes), 2L, info = code)
    expect_equal(length(unique(lignes$rang_reg)), 1L, info = code)
  }

  # les agrégats et les départements se classent dans LEURS groupes :
  # EPCI X (0,5405) et EPCI Z (0,0482) parmi les EPCIs de la région (n = 2),
  # les départements 22 (0,5405) / 35 (0,0769) / 56 (0) entre eux (n = 3)
  expect_equal(valeur_payload(p, "200000001", "artif_par_habitant", "2025")$rang_reg,
               0.5)
  expect_equal(valeur_payload(p, "200000003", "artif_par_habitant", "M3")$rang_reg,
               0)
  expect_equal(valeur_payload(p, "22", "artif_par_habitant", "2025")$rang_reg, 2 / 3)
  expect_equal(valeur_payload(p, "35", "artif_par_habitant", "2023")$rang_reg, 1 / 3)
  expect_equal(valeur_payload(p, "56", "artif_par_habitant", "2022")$rang_reg, 0)
})

test_that("la série annuelle est inchangée : 14 lignes, le rang de la part de surface consommée", {
  p <- compute_payload(communes_fixture_milieux_ocsge(), theme = theme_milieux())

  # les 14 lignes annuelles d'un territoire portent le MÊME rang — celui de la
  # part de surface consommée de SON territoire (le scalaire de la clé, jamais
  # les hectares bruts — ADR-0014). Parts vérifiées à la main :
  #   part = naf21art25 (ha) x 10 000 / surfcom2025 (m²)
  #     22001 : 233202 / 50311729 ≈ 0,004635
  #     29002 : 25000 / 9000000 ≈ 0,002778
  #     22002 : 100000 / 15000000 ≈ 0,006667
  #     29001 : 150000 / 20000000 = 0,0075
  #     35001 : 233202 / 8000000 ≈ 0,02915
  #     56001 : 233202 / 6000000 ≈ 0,038867
  # l'ordre des parts (29002 < 22001 < 22002 < 29001 < 35001 < 56001) — les
  # rangs de région (n = 6 communes) : 0 ; 1/6 ; 2/6 ; 0,5 ; 4/6 ; 5/6
  annuel <- valeur_payload(p, "22001", "conso_enaf_annuel")
  expect_equal(nrow(annuel), 14L)
  expect_equal(length(unique(annuel$rang_reg)), 1L)
  expect_equal(unique(annuel$rang_reg), 1 / 6)
  expect_equal(unique(valeur_payload(p, "29002", "conso_enaf_annuel")$rang_reg), 0)
  expect_equal(unique(valeur_payload(p, "22002", "conso_enaf_annuel")$rang_reg), 2 / 6)
  expect_equal(unique(valeur_payload(p, "29001", "conso_enaf_annuel")$rang_reg), 0.5)
  expect_equal(unique(valeur_payload(p, "35001", "conso_enaf_annuel")$rang_reg), 4 / 6)
  expect_equal(unique(valeur_payload(p, "56001", "conso_enaf_annuel")$rang_reg), 5 / 6)
})

test_that("un territoire sans donnée (ou au total incomplet) n'a pas de rang", {
  p <- compute_payload(communes_fixture_milieux_ocsge(), theme = theme_milieux())

  # 29003 : état OCS-GE NA -> l'état par habitant est NA -> aucun rang (le NA
  # n'empoisonne pas le groupe — les autres communes gardent leurs rangs,
  # testé ci-dessus). Les DEUX lignes restent publiées, jamais un trou.
  e <- valeur_payload(p, "29003", "artif_par_habitant")
  expect_equal(nrow(e), 2L)
  expect_true(all(is.na(e$value)))
  expect_true(all(is.na(e$rang_epci)))
  expect_true(all(is.na(e$rang_dep)))
  expect_true(all(is.na(e$rang_reg)))
  # l'EPCI Y : total incomplet (membre 29003 NA) -> NA
  expect_true(all(is.na(valeur_payload(p, "200000002", "artif_par_habitant")$value)))
  expect_true(all(is.na(valeur_payload(p, "200000002", "artif_par_habitant")$rang_reg)))
  # la série annuelle de la commune sans donnée : 14 lignes, aucune rang
  expect_true(all(is.na(valeur_payload(p, "29003", "conso_enaf_annuel")$rang_reg)))
})
