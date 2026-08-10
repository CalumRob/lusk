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
#     territoire) : le scalaire reste la PART de la surface du territoire
#     consommée (jamais les hectares bruts, ADR-0014) ; ses 14 lignes
#     partagent le rang du territoire.
# Les DEUX clés sont low-is-good (ADR-0015 — moins de terre artificialisée par
# habitant, moins de surface consommée : mieux). Les rangs sont des ORDINAUX
# « Xᵉ / Y » (ADR-0021) : une commune se classe dans SON EPCI, un EPCI parmi
# tous les EPCIs bretons, un département parmi les départements. La fenêtre
# (conso_enaf_fenetre) et la trajectoire ZAN (trajectoire_zan) sont mortes
# avec les flux CONSOENAF : leurs rangs quittent le jeu de clés (#63). Le
# fixture est celui du câblage territorial OCS-GE (issue #237, amendé par
# #243) — sept communes, trois EPCIs, quatre départements et la région. Depuis
# l'amendement #243, les états sont des STOCKS : chaque commune a les DEUX
# états strictement positifs. Les valeurs vérifiées à la main (état M3 par
# habitant, m²/hab) — 35001 : 400/5200 · 56001 : 600/3100 · 29001 : 1200/2950
# · 22001 : 1200/2400 · 22002 : 800/1300 · 29002 : 800/910 · 29003 : 700/500.

test_that("artif_par_habitant : classé TEL QUEL sur l'état à M3 (m²/hab, jamais une normalisation de surface)", {
  p <- compute_payload(communes_fixture_milieux_ocsge(), theme = theme_milieux())

  # la valeur publiée EST l'état par habitant (m²/hab) — jamais une part de
  # surface, jamais les hectares bruts
  expect_equal(valeur_payload(p, "22001", "artif_par_habitant", "2021")$value,
               400 / 2200)
  expect_equal(valeur_payload(p, "22001", "artif_par_habitant", "2025")$value,
               1200 / 2400)
  expect_equal(valeur_payload(p, "56001", "artif_par_habitant", "2022")$value,
               800 / 2900)
  expect_equal(valeur_payload(p, "56001", "artif_par_habitant", "2024")$value,
               600 / 3100)
  expect_equal(valeur_payload(p, "29003", "artif_par_habitant", "2024")$value,
               700 / 500)

  # low-is-good : la PLUS PETITE intensité est 1re. Dans l'EPCI X (n = 2) :
  # 22001 (0,5) < 22002 (0,6154) ; dans l'EPCI Y (n = 3) : 29001 (0,4068) <
  # 29002 (0,8791) < 29003 (1,4) ; dans l'EPCI Z (n = 2) : 35001 (0,0769) <
  # 56001 (0,1935). Une commune se classe dans SON EPCI (ADR-0021) — plus
  # aucun rang régional pour elle.
  expect_equal(valeur_payload(p, "22001", "artif_par_habitant", "2025")$rang_epci, 1)
  expect_equal(valeur_payload(p, "22001", "artif_par_habitant", "2025")$rang_epci_n, 2)
  expect_equal(valeur_payload(p, "22002", "artif_par_habitant", "2025")$rang_epci, 2)
  expect_true(is.na(valeur_payload(p, "22001", "artif_par_habitant", "2025")$rang_reg))
  expect_equal(valeur_payload(p, "29001", "artif_par_habitant", "2024")$rang_epci, 1)
  expect_equal(valeur_payload(p, "29002", "artif_par_habitant", "2024")$rang_epci, 2)
  expect_equal(valeur_payload(p, "29003", "artif_par_habitant", "2024")$rang_epci, 3)
  expect_equal(valeur_payload(p, "35001", "artif_par_habitant", "2023")$rang_epci, 1)
  expect_equal(valeur_payload(p, "56001", "artif_par_habitant", "2022")$rang_epci, 2)

  # le point de la spec : le rang suit l'état par habitant TEL QUEL, jamais la
  # part de surface consommée — l'EPCI Z (qui abrite 35001, le plus faible
  # m²/hab) est 1er des EPCIs sur l'intensité alors que sa part de surface
  # consommée le classe DERRIÈRE l'EPCI X (voir le test de la série annuelle)
  expect_equal(valeur_payload(p, "200000003", "artif_par_habitant", "M3")$rang_reg, 1)
  expect_equal(valeur_payload(p, "200000001", "artif_par_habitant", "2025")$rang_reg, 2)
  expect_equal(valeur_payload(p, "200000002", "artif_par_habitant", "2024")$rang_reg, 3)
  expect_equal(valeur_payload(p, "200000003", "artif_par_habitant", "M3")$rang_reg_n, 3)
})

test_that("artif_par_habitant : les DEUX lignes du territoire partagent le rang de l'état à M3", {
  p <- compute_payload(communes_fixture_milieux_ocsge(), theme = theme_milieux())

  # 56001 : M2 vaut 800/2900, M3 vaut 600/3100 — les VALEURS diffèrent, les
  # RANGS sont ceux de l'état final (M3), identiques sur les deux lignes
  m2 <- valeur_payload(p, "56001", "artif_par_habitant", "2022")
  m3 <- valeur_payload(p, "56001", "artif_par_habitant", "2024")
  expect_true(m2$value != m3$value)
  expect_equal(m2$rang_epci, m3$rang_epci)
  expect_equal(m2$rang_epci, 2)

  # 22001 : M2 = 400/2200, M3 = 0,5 — même rang partagé (1er de l'EPCI X)
  expect_equal(valeur_payload(p, "22001", "artif_par_habitant", "2021")$rang_epci,
               valeur_payload(p, "22001", "artif_par_habitant", "2025")$rang_epci)

  # chaque territoire publie EXACTEMENT deux lignes, qui partagent le rang (le
  # motif multi-détails de la machinerie — commune, EPCI, département)
  for (code in c("22001", "29001", "35001", "200000001", "200000003", "22")) {
    lignes <- p$indicateurs[p$indicateurs$territoire == code &
                              p$indicateurs$key == "artif_par_habitant", ]
    expect_equal(nrow(lignes), 2L, info = code)
    expect_equal(length(unique(lignes$rang_epci)), 1L, info = code)
  }

  # les agrégats et les départements se classent dans LEURS groupes : les
  # EPCIs entre eux (n = 3 — low-is-good : 0,1205 < 0,5405 < 0,6193), les
  # départements entre eux (n = 4 : 0,0769 < 0,1935 < 0,5405 < 0,6193)
  expect_equal(valeur_payload(p, "200000001", "artif_par_habitant", "2025")$rang_reg, 2)
  expect_equal(valeur_payload(p, "200000002", "artif_par_habitant", "2024")$rang_reg, 3)
  expect_equal(valeur_payload(p, "200000003", "artif_par_habitant", "M3")$rang_reg, 1)
  expect_equal(valeur_payload(p, "22", "artif_par_habitant", "2025")$rang_reg, 3)
  expect_equal(valeur_payload(p, "29", "artif_par_habitant", "2024")$rang_reg, 4)
  expect_equal(valeur_payload(p, "35", "artif_par_habitant", "2023")$rang_reg, 1)
  expect_equal(valeur_payload(p, "56", "artif_par_habitant", "2024")$rang_reg, 2)
})

test_that("la série annuelle : 14 lignes, le rang de la part de surface consommée (low-is-good)", {
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
  # low-is-good : la PLUS PETITE part est 1re. Dans l'EPCI X (n = 2) : 22001 <
  # 22002 ; dans l'EPCI Y (n = 2, 29003 NA) : 29002 < 29001 ; dans l'EPCI Z
  # (n = 2) : 35001 < 56001.
  annuel <- valeur_payload(p, "22001", "conso_enaf_annuel")
  expect_equal(nrow(annuel), 14L)
  expect_equal(length(unique(annuel$rang_epci)), 1L)
  expect_equal(unique(annuel$rang_epci), 1)
  expect_equal(unique(valeur_payload(p, "22002", "conso_enaf_annuel")$rang_epci), 2)
  expect_equal(unique(valeur_payload(p, "29002", "conso_enaf_annuel")$rang_epci), 1)
  expect_equal(unique(valeur_payload(p, "29001", "conso_enaf_annuel")$rang_epci), 2)
  expect_equal(unique(valeur_payload(p, "35001", "conso_enaf_annuel")$rang_epci), 1)
  expect_equal(unique(valeur_payload(p, "56001", "conso_enaf_annuel")$rang_epci), 2)

  # les agrégats : les EPCIs entre eux (X 0,00496 < Z 0,0333 — Y NA, la part de
  # 29003 manque), les départements entre eux (22 < 35 < 56 — 29 NA)
  expect_equal(unique(valeur_payload(p, "200000001", "conso_enaf_annuel")$rang_reg), 1)
  expect_equal(unique(valeur_payload(p, "200000003", "conso_enaf_annuel")$rang_reg), 2)
  expect_true(all(is.na(valeur_payload(p, "200000002", "conso_enaf_annuel")$rang_reg)))
  expect_equal(unique(valeur_payload(p, "22", "conso_enaf_annuel")$rang_reg), 1)
  expect_equal(unique(valeur_payload(p, "35", "conso_enaf_annuel")$rang_reg), 2)
  expect_equal(unique(valeur_payload(p, "56", "conso_enaf_annuel")$rang_reg), 3)
  expect_true(all(is.na(valeur_payload(p, "29", "conso_enaf_annuel")$rang_reg)))
})

test_that("un territoire à la série annuelle incomplète n'a pas de rang de série (l'état, lui, est là)", {
  p <- compute_payload(communes_fixture_milieux_ocsge(), theme = theme_milieux())

  # 29003 : la série annuelle CONSOENAF est NA (le fixture laisse la
  # consommation vide) -> la part de surface est NA -> aucun rang de série.
  # Depuis l'amendement #243, l'ÉTAT OCS-GE de 29003, lui, EXISTE — le rang
  # d'état est là, les DEUX lignes publiées.
  annuel <- valeur_payload(p, "29003", "conso_enaf_annuel")
  expect_equal(nrow(annuel), 14L)
  expect_true(all(is.na(annuel$value)))
  expect_true(all(is.na(annuel$rang_epci)))
  e <- valeur_payload(p, "29003", "artif_par_habitant")
  expect_equal(nrow(e), 2L)
  expect_false(any(is.na(e$value)))
  expect_equal(unique(e$rang_epci), 3)
  expect_equal(unique(e$rang_epci_n), 3)
})
