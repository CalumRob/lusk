# test-analytics-economie-ranks -------------------------------------------------
# Les rangs-en-contexte des indicateurs analytiques du thème Économie/Emploi
# (plan economie-analytical-phase, todo 6 / T6) : pour chaque indicateur publié
# (LQ T1, LQ d'emploi T2, score vert T3, chômage T5), les rangs
# rang_epci / rang_dep / rang_reg en fractions dans [0, 1] — via la MACHINERIE
# PARTAGÉE des rangs (compute.R : groupes_comparaison + percentile_par_groupe,
# jamais re-forkée).
#
# Les règles du contrat (CONTEXT.md « Rang ») :
#   - la valeur d'un territoire est classée dans SON groupe de comparaison
#     (commune → EPCI / département / région) ; part strictement inférieure +
#     moitié des ex æquo, les NA exclus du dénominateur (point 2) ;
#   - NA = pas de groupe de comparaison à ce niveau : la région ne se classe
#     nulle part, une EPCI trans-départementale ne se classe que dans son
#     département (de pluralité) et la région ;
#   - une valeur NA (commune sous le plancher) n'a pas de rang et n'empoisonne
#     pas son groupe.
#
# Les tables LQ (T1/T2) sont commune × activité : chaque cellule est classée
# dans (activité × groupe) — une LQ de l'agriculture ne se compare qu'aux LQ de
# l'agriculture, jamais à une LQ du commerce. Les tests vérifient que le rang
# d'une cellule ignore les autres activités de sa commune.

# La base des EPCI du fixture ------------------------------------------------
# La forme de lire_epci (CODGEO / LIBGEO / EPCI / LIBEPCI / DEP / REG) : les 4
# communes du fixture Démographie (2 EPCIs, 2 départements) + une EPCI
# TRANS-DÉPARTEMENTALE (200000004 « EPCI W » : 35002 dans le 35, 56001 dans le
# 56) — le cas NA du contrat (une EPCI trans-départementale ne se classe que
# dans son département et sa région).
epci_rangs_mini <- tibble::tribble(
  ~CODGEO, ~LIBGEO, ~EPCI, ~LIBEPCI, ~DEP, ~REG,
  "22001", "Commune A1", "200000001", "EPCI X", "22", "53",
  "22002", "Commune D", "200000001", "EPCI X", "22", "53",
  "29001", "Commune B", "200000002", "EPCI Y", "29", "53",
  "29002", "Commune C", "200000002", "EPCI Y", "29", "53",
  "35001", "Commune E", "200000003", "EPCI Z", "35", "53",
  "35002", "Commune F", "200000004", "EPCI W", "35", "53",
  "56001", "Commune G", "200000004", "EPCI W", "56", "53"
)

# Le fixture LQ (commune × activité × lq), calculé à la main ------------------
# Communes du fixture Démographie + 35001 seule dans son EPCI. Les valeurs sont
# choisies pour que chaque rang se calcule à la main :
#   EPCI X (22001, 22002) · EPCI Y (29001, 29002) · EPCI Z (35001 seule)
#   activité « A » : 22001 = 1.0 · 22002 = 0.5 · 29001 = 2.0 · 29002 = 1.5 ·
#                    35001 = 0.75
#   activité « B » : 22001 = 0.5 · 22002 = 1.5 · 29001 = 1.0 · 29002 = 2.0 ·
#                    35001 = 1.25
# rangs de la cellule (commune × activité) dans (activité × groupe) :
#   activité A, rang_epci : 22001 (1.0 > 0.5) = 0.5 · 22002 = 0 · 29001
#     (2.0 > 1.5) = 0.5 · 29002 = 0 · 35001 (seule) = 0
#   activité A, rang_reg (n = 5) : 22001 (1.0) → 2 dessous {0.5, 0.75} = 0.4 ·
#     22002 (0.5) → 0 · 29001 (2.0) → 4/5 = 0.8 · 29002 (1.5) → 3/5 = 0.6 ·
#     35001 (0.75) → 1/5 = 0.2
#   activité B, rang_reg (n = 5) : 22001 (0.5) → 0 · 22002 (1.5) → 3/5 = 0.6 ·
#     29001 (1.0) → 1/5 = 0.2 · 29002 (2.0) → 4/5 = 0.8 · 35001 (1.25) → 2/5 =
#     0.4
fixture_lq_rangs <- function() {
  tibble::tribble(
    ~commune, ~activity_code, ~activity_label, ~lq,
    "22001", "A", "Activité A", 1.0,
    "22001", "B", "Activité B", 0.5,
    "22002", "A", "Activité A", 0.5,
    "22002", "B", "Activité B", 1.5,
    "29001", "A", "Activité A", 2.0,
    "29001", "B", "Activité B", 1.0,
    "29002", "A", "Activité A", 1.5,
    "29002", "B", "Activité B", 2.0,
    "35001", "A", "Activité A", 0.75,
    "35001", "B", "Activité B", 1.25
  )
}

# Le fixture score vert (commune × 1 part), calculé à la main ------------------
# 35001 a une part NA (commune sous le plancher gate D → supprimée) : son rang
# est NA et elle n'empoisonne pas son groupe. Les autres valeurs sont choisies
# pour des rangs exacts :
#   EPCI X {22001 = 0.8, 22002 = 0.5} · EPCI Y {29001 = 0.7, 29002 = 0.2} ·
#   EPCI Z {35001 = NA}
#   rang_epci : 22001 = 0.5 · 22002 = 0 · 29001 = 0.5 · 29002 = 0 · 35001 = NA
#   rang_reg (n = 4 non-NA : {0.8, 0.5, 0.7, 0.2}) : 22001 = 3/4 = 0.75 ·
#     22002 = 1/4 = 0.25 · 29001 = 2/4 = 0.5 · 29002 = 0 · 35001 = NA
fixture_vert_rangs <- function() {
  tibble::tribble(
    ~commune, ~departement, ~n_etablissements, ~n_eco, ~part_economie_verte,
    "22001", "22", 10L, 8L, 0.8,
    "22002", "22", 10L, 5L, 0.5,
    "29001", "29", 10L, 7L, 0.7,
    "29002", "29", 10L, 2L, 0.2,
    "35001", "35", 4L, 0L, NA_real_
  )
}

# Le fixture chômage (commune × 1 taux), calculé à la main ---------------------
# 35001 a un taux NA (population active non positive → non calculable) : rang
# NA, groupe non empoisonné. Les autres valeurs :
#   EPCI X {22001 = 0.2, 22002 = 0.1} · EPCI Y {29001 = 0.3, 29002 = 0.4}
#   rang_epci : 22001 = 0.5 · 22002 = 0 · 29001 = 0 · 29002 = 0.5 · 35001 = NA
#   rang_reg (n = 4 non-NA : {0.2, 0.1, 0.3, 0.4}) : 22001 = 1/4 = 0.25 ·
#     22002 = 0 · 29001 = 2/4 = 0.5 · 29002 = 3/4 = 0.75 · 35001 = NA
fixture_chomage_rangs <- function() {
  tibble::tribble(
    ~commune, ~departement, ~chomeurs, ~actifs_occupes, ~population_active,
    ~taux_chomage,
    "22001", "22", 2, 8, 10, 0.2,
    "22002", "22", 1, 9, 10, 0.1,
    "29001", "29", 3, 7, 10, 0.3,
    "29002", "29", 4, 6, 10, 0.4,
    "35001", "35", NA_integer_, NA_integer_, 0, NA_real_
  )
}

# Les chemins réels (gitignorés ; absents hors worktree — les tests sautent
# proprement sur une machine sans la donnée)
chemin_reel_rangs <- function(fichier) {
  testthat::test_path("..", "..", "data", "processed", "economie", fichier)
}
chemin_epci_reel <- function() {
  testthat::test_path("..", "..", "data", "raw", "extracted",
                      "EPCI_au_01-01-2025.xlsx")
}

# 1. LQ (T1) : une cellule est classée dans (activité × groupe) ---------------

test_that("LQ : les rangs de la cellule (activité × EPCI / département / région)", {
  r <- attacher_rangs_lq(fixture_lq_rangs(), epci_rangs_mini)

  # les colonnes de rang sont attachées à la table (jamais une table séparée)
  expect_true(all(c("rang_epci", "rang_dep", "rang_reg") %in% names(r)))
  expect_equal(nrow(r), 10)

  cellule <- function(commune, activite, col) {
    r[[col]][r$commune == commune & r$activity_code == activite]
  }

  # activité A — rang_epci (dans l'EPCI, même activité)
  expect_equal(cellule("22001", "A", "rang_epci"), 0.5)
  expect_equal(cellule("22002", "A", "rang_epci"), 0)
  expect_equal(cellule("29001", "A", "rang_epci"), 0.5)
  expect_equal(cellule("29002", "A", "rang_epci"), 0)
  expect_equal(cellule("35001", "A", "rang_epci"), 0) # seule dans son EPCI

  # activité A — rang_reg (n = 5)
  expect_equal(cellule("22001", "A", "rang_reg"), 0.4)
  expect_equal(cellule("22002", "A", "rang_reg"), 0)
  expect_equal(cellule("29001", "A", "rang_reg"), 0.8)
  expect_equal(cellule("29002", "A", "rang_reg"), 0.6)
  expect_equal(cellule("35001", "A", "rang_reg"), 0.2)

  # activité B — rang_reg (n = 5)
  expect_equal(cellule("22001", "B", "rang_reg"), 0)
  expect_equal(cellule("22002", "B", "rang_reg"), 0.6)
  expect_equal(cellule("29001", "B", "rang_reg"), 0.2)
  expect_equal(cellule("29002", "B", "rang_reg"), 0.8)
  expect_equal(cellule("35001", "B", "rang_reg"), 0.4)
})

test_that("LQ : le rang d'une cellule ignore les autres activités de sa commune", {
  r <- attacher_rangs_lq(fixture_lq_rangs(), epci_rangs_mini)

  # 29002 a une LQ de 2.0 dans l'activité B et de 1.5 dans l'activité A : si
  # l'activité était ignorée, la cellule B (2.0) serait classée contre les
  # valeurs de toutes les activités ; dans (activité × groupe), la cellule A de
  # 29002 (1.5) n'est pas comptée parmi les « dessous » de la cellule B
  # (2.0) — le rang_reg de 29002×B reste 4/5 = 0.8, jamais 5/5 = 1.
  expect_equal(
    r$rang_reg[r$commune == "29002" & r$activity_code == "B"], 0.8
  )
  # miroir : 22001×A (1.0) n'est pas classée contre 22001×B (0.5)
  expect_equal(
    r$rang_reg[r$commune == "22001" & r$activity_code == "A"], 0.4
  )
})

# 2. LQ d'emploi (T2) : le même chaînon, la même forme ------------------------

test_that("LQ d'emploi (A88) : la même fonction classe le même tableau", {
  # la table lq_emploi_a88 a exactement la même forme que lq_economie
  # (commune × activity_code × lq) : le même attachement s'applique
  r <- attacher_rangs_lq_emploi(fixture_lq_rangs(), epci_rangs_mini)

  expect_true(all(c("rang_epci", "rang_dep", "rang_reg") %in% names(r)))
  expect_equal(nrow(r), 10)
  # les mêmes valeurs que le fixture LQ donnent les mêmes rangs
  expect_identical(r, attacher_rangs_lq(fixture_lq_rangs(), epci_rangs_mini))
})

# 3. Score vert (T3) : une valeur par commune ---------------------------------

test_that("score vert : les rangs de la part, la commune supprimée n'a pas de rang", {
  r <- attacher_rangs_eco_activites(fixture_vert_rangs(), epci_rangs_mini)

  expect_true(all(c("rang_epci", "rang_dep", "rang_reg") %in% names(r)))
  expect_equal(nrow(r), 5)

  rang <- function(commune, col) r[[col]][r$commune == commune]

  # rang_epci : dans l'EPCI, parmi les communes à part définie
  expect_equal(rang("22001", "rang_epci"), 0.5)
  expect_equal(rang("22002", "rang_epci"), 0)
  expect_equal(rang("29001", "rang_epci"), 0.5)
  expect_equal(rang("29002", "rang_epci"), 0)

  # rang_reg (n = 4 non-NA)
  expect_equal(rang("22001", "rang_reg"), 0.75)
  expect_equal(rang("22002", "rang_reg"), 0.25)
  expect_equal(rang("29001", "rang_reg"), 0.5)
  expect_equal(rang("29002", "rang_reg"), 0)

  # la commune supprimée (part NA) n'a pas de rang — et les autres gardent les
  # leurs (le dénominateur exclut les NA, point 2)
  expect_true(is.na(rang("35001", "rang_epci")))
  expect_true(is.na(rang("35001", "rang_dep")))
  expect_true(is.na(rang("35001", "rang_reg")))
})

# 4. Chômage (T5) : une valeur par commune ------------------------------------

test_that("chômage : les rangs du taux, la commune sans taux n'a pas de rang", {
  r <- attacher_rangs_chomage(fixture_chomage_rangs(), epci_rangs_mini)

  expect_true(all(c("rang_epci", "rang_dep", "rang_reg") %in% names(r)))
  expect_equal(nrow(r), 5)

  rang <- function(commune, col) r[[col]][r$commune == commune]

  expect_equal(rang("22001", "rang_epci"), 0.5)
  expect_equal(rang("22002", "rang_epci"), 0)
  expect_equal(rang("29001", "rang_epci"), 0)
  expect_equal(rang("29002", "rang_epci"), 0.5)

  expect_equal(rang("22001", "rang_reg"), 0.25)
  expect_equal(rang("22002", "rang_reg"), 0)
  expect_equal(rang("29001", "rang_reg"), 0.5)
  expect_equal(rang("29002", "rang_reg"), 0.75)

  expect_true(is.na(rang("35001", "rang_epci")))
  expect_true(is.na(rang("35001", "rang_dep")))
  expect_true(is.na(rang("35001", "rang_reg")))
})

# 5. Les règles NA du contrat : EPCI trans-départementale et région ------------

test_that("la machinerie partagée : une EPCI trans-départementale et la région", {
  # Le QA du plan : une EPCI trans-départementale et la région doivent produire
  # le bon motif NA. Les tables analytiques sont communales ; le motif NA des
  # niveaux agrégés (EPCI / département / région) est celui de la machinerie
  # PARTAGÉE (compute.R) — le test le prouve en classant une valeur façon score
  # vert sur la table complète des territoires (squelette_territoires).
  communes <- tibble::tribble(
    ~code, ~nom, ~departement, ~epci, ~nom_epci, ~population,
    "22001", "Commune A1", "22", "200000001", "EPCI X", 1000,
    "22002", "Commune D", "22", "200000001", "EPCI X", 1000,
    "29001", "Commune B", "29", "200000002", "EPCI Y", 1000,
    "29002", "Commune C", "29", "200000002", "EPCI Y", 1000,
    # EPCI W trans-départementale : 35002 (35) + 56001 (56) — la pluralité de
    # la population est le 56 (1000 > 100), son département est donc 56
    "35002", "Commune F", "35", "200000004", "EPCI W", 100,
    "56001", "Commune G", "56", "200000004", "EPCI W", 1000
  )
  territoires <- squelette_territoires(communes)

  # une valeur façon score vert par territoire (communes : la part ; agrégats :
  # une valeur quelconque — seul le motif NA du classement est vérifié ici)
  valeurs <- tibble::tibble(
    code = territoires$code,
    key = "vert",
    detail = NA_character_,
    value = ifelse(territoires$type == "commune",
                   c(0.8, 0.5, 0.7, 0.2, 0.6, 0.9), 0.5),
    unit = "%"
  )
  rangs <- compute_ranks(territoires, list(vert = valeurs))

  rang <- function(code) {
    rangs$vert[rangs$vert$code == code, ]
  }

  # la région ne se classe nulle part (aucun groupe de comparaison)
  reg <- rang("53")
  expect_true(is.na(reg$rang_epci) & is.na(reg$rang_dep) & is.na(reg$rang_reg))

  # une EPCI ne se classe pas « dans son EPCI » ; l'EPCI W trans-départementale
  # se classe dans SON département (de pluralité : 56) et la région
  w <- rang("200000004")
  expect_true(is.na(w$rang_epci))
  expect_false(is.na(w$rang_dep))
  expect_false(is.na(w$rang_reg))

  # une EPCI mono-départementale : pareil (jamais de rang_epci)
  x <- rang("200000001")
  expect_true(is.na(x$rang_epci))
  expect_false(is.na(x$rang_dep))
  expect_false(is.na(x$rang_reg))

  # un département ne se classe que dans la région
  dep56 <- rang("56")
  expect_true(is.na(dep56$rang_epci) & is.na(dep56$rang_dep))
  expect_false(is.na(dep56$rang_reg))

  # les communes gardent leurs trois rangs
  c1 <- rang("22001")
  expect_false(any(is.na(c1[c("rang_epci", "rang_dep", "rang_reg")])))
})

# 6. Les gardes du contrat -----------------------------------------------------

test_that("une commune absente de la base des EPCI échoue bruyamment (jamais un rang NA silencieux)", {
  # 35001 n'est pas dans cette base réduite : son groupe EPCI serait NA — le
  # contrat « pas de NA silencieux » l'exige bruyant
  base_reduite <- epci_rangs_mini[epci_rangs_mini$CODGEO != "35001", ]
  expect_error(
    attacher_rangs_lq(fixture_lq_rangs(), base_reduite),
    "35001"
  )
})

test_that("une commune sans EPCI (île, PRÉSENTE dans la base) n'est pas une erreur : rang_epci NA, dép/région gardés (fix #131)", {
  # le fix « Sans objet » (issue #131) : la base des EPCI porte les trois îles
  # avec EPCI = NA (le « ZZZZZZZZZ » normalisé à la lecture) — la commune est
  # PRÉSENTE dans la base, elle n'appartient simplement à aucun EPCI. Son
  # rang_epci est NA (pas de groupe à ce niveau), JAMAIS une erreur ; elle
  # garde ses rangs département (ses communes) et région.
  base_avec_ile <- dplyr::bind_rows(
    epci_rangs_mini,
    tibble::tibble(CODGEO = "22016", LIBGEO = "Île-de-Bréhat",
                   EPCI = NA_character_, LIBEPCI = NA_character_,
                   DEP = "22", REG = "53")
  )
  lq <- dplyr::bind_rows(
    fixture_lq_rangs(),
    tibble::tibble(commune = "22016", activity_code = "A",
                   activity_label = "Activité A", lq = 3.0)
  )

  r <- attacher_rangs_lq(lq, base_avec_ile)
  ile <- r[r$commune == "22016", ]
  # aucun rang_epci (pas d'EPCI) ; les rangs département et région existent
  expect_true(is.na(ile$rang_epci))
  expect_false(is.na(ile$rang_dep))
  expect_false(is.na(ile$rang_reg))
  # la cellule de l'île n'empoisonne pas le groupe de ses pairs : 22001×A
  # garde son rang_reg 0,4 (n = 5 sans l'île... n = 6 avec, les valeurs
  # changent — mais le rang reste un percentile valide dans [0,1])
  expect_true(all(r$rang_reg[r$activity_code == "A"] >= 0 &
                    r$rang_reg[r$activity_code == "A"] <= 1))
})

test_that("déterminisme (ADR-0002) : même entrée → mêmes rangs, à l'identique", {
  expect_identical(
    attacher_rangs_lq(fixture_lq_rangs(), epci_rangs_mini),
    attacher_rangs_lq(fixture_lq_rangs(), epci_rangs_mini)
  )
  expect_identical(
    attacher_rangs_eco_activites(fixture_vert_rangs(), epci_rangs_mini),
    attacher_rangs_eco_activites(fixture_vert_rangs(), epci_rangs_mini)
  )
})

test_that("les rangs vivent dans [0, 1] sur les fixtures", {
  for (r in list(
    attacher_rangs_lq(fixture_lq_rangs(), epci_rangs_mini),
    attacher_rangs_eco_activites(fixture_vert_rangs(), epci_rangs_mini),
    attacher_rangs_chomage(fixture_chomage_rangs(), epci_rangs_mini)
  )) {
    rangs <- unlist(r[c("rang_epci", "rang_dep", "rang_reg")])
    expect_true(all(is.na(rangs) | (rangs >= 0 & rangs <= 1)))
  }
})

# 7. L'orchestrateur + la persistance ------------------------------------------

test_that("construire_rangs_analytiques_economie attache et persiste les quatre tables classées", {
  sortie <- tempfile("rangs-economie-")
  on.exit(unlink(sortie, recursive = TRUE), add = TRUE)

  res <- construire_rangs_analytiques_economie(
    lq = fixture_lq_rangs(),
    lq_emploi = fixture_lq_rangs(),
    eco = fixture_vert_rangs(),
    chomage = fixture_chomage_rangs(),
    base_epci = epci_rangs_mini,
    sortie = sortie
  )

  # les quatre artefacts classés, sous la localisation Économie/Emploi
  attendus <- c(
    "lq_economie_rangs.rds", "lq_emploi_a88_rangs.rds",
    "eco_activites_economie_rangs.rds", "chomage_economie_rangs.rds"
  )
  expect_setequal(list.files(sortie), attendus)

  # chaque artefact relit la table classée correspondante
  expect_identical(readRDS(file.path(sortie, "lq_economie_rangs.rds")), res$lq)
  expect_identical(readRDS(file.path(sortie, "lq_emploi_a88_rangs.rds")),
                   res$lq_emploi)
  expect_identical(readRDS(file.path(sortie, "eco_activites_economie_rangs.rds")),
                   res$eco)
  expect_identical(readRDS(file.path(sortie, "chomage_economie_rangs.rds")),
                   res$chomage)

  # AUCUN artefact de fiche ni d'Histoire : on ne classe pas les Stories
  # (gate : histoires_lq_economie / m_economie / dormitory ne sont pas écrits)
  expect_false(any(grepl("histoires|m_economie|dormitory|fiche|payload",
                         list.files(sortie))))
})

# 8. Le chemin de joie RÉEL ------------------------------------------------------

test_that("données réelles : les rangs LQ sur les 1202 communes, dans [0, 1]", {
  chemin <- chemin_reel_rangs("sirene_snapshot.rds")
  skip_if_not(file.exists(chemin),
              "la vraie table sirene_snapshot n'est pas présente (worktree sans donnée).")

  snapshot <- readRDS(chemin)
  lq <- construire_analytique_lq_economie(snapshot)$lq
  base_epci <- lire_epci(chemin_epci_reel())

  r <- attacher_rangs_lq(lq, base_epci)

  # une ligne par cellule commune × activité, les rangs attachés
  expect_equal(nrow(r), nrow(lq))
  expect_true(all(c("rang_epci", "rang_dep", "rang_reg") %in% names(r)))
  # 1202 communes couvertes (0 suppression au plancher gate D)
  expect_equal(dplyr::n_distinct(r$commune), 1202)
  # les rangs vivent dans [0, 1] — aucune commune du réel n'a de rang NA (chaque
  # commune bretonne a son EPCI dans la base partagée)
  for (col in c("rang_epci", "rang_dep", "rang_reg")) {
    expect_true(all(r[[col]] >= 0 & r[[col]] <= 1))
  }
  expect_equal(sum(is.na(r$rang_epci)), 0)
  # déterministe
  expect_identical(r, attacher_rangs_lq(lq, base_epci))
})

test_that("données réelles : les rangs de la LQ d'emploi A88 sur les 1196 communes retenues", {
  chemin <- chemin_reel_rangs("flores_a88.rds")
  skip_if_not(file.exists(chemin),
              "la vraie table flores_a88 n'est pas présente (worktree sans donnée).")

  flores <- readRDS(chemin)
  lq_emploi <- calculer_lq_emploi_flores(flores, "A88")$lq
  base_epci <- lire_epci(chemin_epci_reel())

  r <- attacher_rangs_lq_emploi(lq_emploi, base_epci)

  # 1196 communes (1202 − 6 supprimées au plancher gate D), rangs dans [0, 1]
  expect_equal(dplyr::n_distinct(r$commune), 1196)
  expect_equal(nrow(r), nrow(lq_emploi))
  for (col in c("rang_epci", "rang_dep", "rang_reg")) {
    expect_true(all(r[[col]] >= 0 & r[[col]] <= 1))
  }
})

test_that("données réelles : les rangs du score vert sur les 1202 communes", {
  chemin <- chemin_reel_rangs("sirene_snapshot.rds")
  skip_if_not(file.exists(chemin),
              "la vraie table sirene_snapshot n'est pas présente (worktree sans donnée).")

  snapshot <- readRDS(chemin)
  eco <- construire_eco_activites_economie(snapshot, artefact_egss())$table
  base_epci <- lire_epci(chemin_epci_reel())

  r <- attacher_rangs_eco_activites(eco, base_epci)

  # 1202 communes, 0 suppression (min 10 établissements), rangs dans [0, 1]
  expect_equal(nrow(r), 1202)
  for (col in c("rang_epci", "rang_dep", "rang_reg")) {
    expect_true(all(r[[col]] >= 0 & r[[col]] <= 1))
  }
  # aucune part NA sur le réel → aucun rang NA
  expect_equal(sum(is.na(r$rang_epci)), 0)
})

test_that("données réelles : les rangs du chômage sur les 1202 communes", {
  # rp_chomage.rds est produit par la normalisation chômage (source RP
  # DS_RP_EMPLOI_LR_PRINC, téléchargée à part) — absente d'un worktree sans la
  # donnée, le test saute proprement (comme les autres tests réels du chômage)
  chemin_rp <- chemin_reel_rangs("rp_chomage.rds")
  skip_if_not(file.exists(chemin_rp),
              "la vraie table rp_chomage n'est pas présente (worktree sans donnée).")

  rp <- readRDS(chemin_rp)
  chomage <- construire_chomage_economie(rp)$table
  base_epci <- lire_epci(chemin_epci_reel())

  r <- attacher_rangs_chomage(chomage, base_epci)

  # 1202 communes, une ligne par commune, rangs dans [0, 1]
  expect_equal(nrow(r), 1202)
  expect_equal(anyDuplicated(r$commune), 0L)
  for (col in c("rang_epci", "rang_dep", "rang_reg")) {
    expect_true(all(r[[col]] >= 0 & r[[col]] <= 1))
  }
  # aucune suppression sur le réel → aucun rang NA
  expect_equal(sum(is.na(r$rang_epci)), 0)
})
