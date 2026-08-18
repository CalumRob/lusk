# test-resoudre-histoires ------------------------------------------------------
# Issue #312 : la RÉSOLUTION des histoires remonte dans le pipeline — une
# lecture RÉSOLUE par (territoire, groupe) de fiche, avec la clé choisie
# (story_key), la raison de saillance (salience_reason), la matière de la
# lecture et les faits de fraîcheur applicables. Le pool de candidats est de
# la logique de pipeline, JAMAIS des lignes par territoire dans le payload
# (parent #308, ADR-0002) : là où la saillance tire, la lecture saillante
# REMPLACE le défaut — le payload porte la lecture choisie, jamais le pool.
#
# Le SEAM : resoudre_histoires(candidats, theme) — les lignes candidates du
# thème (une par territoire × story_key) entrent, les lignes résolues
# (une par territoire × groupe) sortent. Le registre partagé
# (STORIES_RESOLUES_PAR_THEME, theme_metadata.R) déclare le groupe de fiche
# de chaque story, l'ordre dans le pool (1 = le défaut toujours allumé) et la
# raison de saillance des candidats. La validation
# (valider_histoires_resolues, compute.R) échoue FORT sur une lecture en
# double, un groupe inconnu, une story hors registre ou une raison incohérente.

test_that("le registre couvre les cinq thèmes et déclare les groupes de fiche", {
  expect_setequal(names(STORIES_RESOLUES_PAR_THEME),
                  c("mobilite", "demographie", "habitat", "economie", "milieux"))
  # une story du thème est déclarée EXACTEMENT une fois (le groupe de la fiche)
  for (theme in names(STORIES_RESOLUES_PAR_THEME)) {
    registre <- STORIES_RESOLUES_PAR_THEME[[theme]]
    expect_equal(anyDuplicated(registre$story_key), 0L, info = theme)
    # le pool de Mobilité partage SON groupe (les deux candidats du même slot
    # de lecture) ; les autres thèmes ont un groupe par story
    if (theme != "mobilite") {
      expect_equal(anyDuplicated(registre$groupe), 0L, info = theme)
    }
    # le pool s'ouvre sur le défaut (ordre 1) et chaque story appartient au
    # registre des histoires du thème (le miroir de CLES_HISTOIRES_PAR_THEME)
    expect_true(all(registre$story_key %in% CLES_HISTOIRES_PAR_THEME[[theme]]),
                info = theme)
  }
})

test_that("Démographie : chaque lecture résolue porte son groupe et « defaut »", {
  p <- compute_payload(load_fixture())
  h <- p$histoires

  expect_named(h, c(
    "territoire", "type", "theme", "groupe", "story_key", "salience_reason",
    "periode", "solde_naturel", "solde_migratoire",
    "taux_solde_naturel", "taux_solde_migratoire", "classification"
  ))
  # issue #370 : la lecture vit dans le sous-groupe « trajectoire-demographique »
  # (la décomposition) — jamais dans « etat-de-la-population » qui ne déclare
  # pas de lecture
  expect_true(all(h$groupe == "trajectoire-demographique"))
  expect_true(all(h$salience_reason == "defaut"))
  expect_true(all(h$story_key == "trajectoire-demographique"))
  # une lecture par (territoire, groupe) — jamais deux
  expect_false(any(duplicated(h[c("territoire", "groupe")])))
  # la matière de la lecture est inchangée (les soldes et les taux du contrat)
  h22001 <- h[h$territoire == "22001", ]
  expect_equal(h22001$solde_naturel, 70)
  expect_equal(h22001$taux_solde_migratoire, 30 / 6 / 1950 * 1000)
})

test_that("Habitat : chaque lecture résolue porte son groupe et « defaut »", {
  p <- compute_payload(load_fixture_habitat(), theme = theme_habitat())
  h <- p$histoires

  # issue #370 : la lecture vit dans le sous-groupe « etat-energetique-du-parc »
  # (la décomposition) — jamais dans « composition-du-parc » ni « marche »
  expect_true(all(h$groupe == "etat-energetique-du-parc"))
  expect_true(all(h$salience_reason == "defaut"))
  expect_false(any(duplicated(h[c("territoire", "groupe")])))
  expect_setequal(unique(h$story_key), "etat-energetique-du-parc")
})

test_that("Milieux : chaque lecture résolue porte son groupe et « defaut »", {
  p <- compute_payload(communes_fixture_milieux_ocsge(), theme = theme_milieux())
  h <- p$histoires

  expect_true(all(h$groupe == "artificialisation"))
  expect_true(all(h$salience_reason == "defaut"))
  expect_false(any(duplicated(h[c("territoire", "groupe")])))
  expect_setequal(unique(h$story_key), "se-densifier-setaler-ou-sen-aller")
  # la matière de la lecture passe la résolution intacte — dont la force
  # population en taux annuel pour mille (#306, amendement d'ADR-0017) : le
  # signe du taux égale le signe du delta brut quand il est défini
  expect_true("taux_variation_population" %in% names(h))
  definis <- !is.na(h$taux_variation_population)
  expect_true(all(definis == !is.na(h$delta_population)))
  expect_true(all(sign(h$taux_variation_population[definis]) ==
                    sign(h$delta_population[definis])))
})

test_that("Mobilité : la saillance REMPLACE le défaut — une lecture par territoire", {
  # le pool (vingt-minutes toujours allumé + vélo quand le delta est réel) se
  # résout en UNE lecture par territoire : la story saillante là où elle tire,
  # le défaut ailleurs. Jamais les deux lignes du pool dans le payload.
  vingt <- tibble::tibble(
    territoire = c("22001", "22002", "29001"),
    type = "commune",
    theme = "mobilite",
    story_key = "vingt-minutes-sans-voiture",
    div_loss_t = c(8, 5, 6),
    div_loss_b = c(1, 2, 3),
    delta = c(7, 3, 3),
    pct_iso_full_t = c(0.1, 0.2, 0.15),
    classification_saillance = c("saillant", "defaut", "defaut")
  )
  velo <- tibble::tibble(
    territoire = "22001",
    type = "commune",
    theme = "mobilite",
    story_key = "ce-que-le-velo-preserve",
    div_loss_t = 8,
    div_loss_b = 1,
    delta = 7,
    classification_saillance = "saillant"
  )
  resolues <- resoudre_histoires(dplyr::bind_rows(vingt, velo), "mobilite")

  # une ligne par territoire, jamais deux
  expect_false(any(duplicated(resolues$territoire)))
  expect_equal(nrow(resolues), 3)
  # 22001 : la saillance tire -> la story vélo, avec la raison de saillance
  h22001 <- resolues[resolues$territoire == "22001", ]
  expect_equal(h22001$groupe, "acces-aux-services")
  expect_equal(h22001$story_key, "ce-que-le-velo-preserve")
  expect_equal(h22001$salience_reason, "delta-velo-saillant")
  # 22002/29001 : pas de saillance -> le défaut, raison « defaut »
  expect_true(all(resolues$story_key[resolues$territoire != "22001"] ==
                    "vingt-minutes-sans-voiture"))
  expect_true(all(resolues$salience_reason[resolues$territoire != "22001"] ==
                    "defaut"))
})

test_that("Mobilité : la lecture résolue garde la matière du défaut quand elle ne tire pas", {
  # quand le défaut est choisi, sa matière (div_loss_t/b, delta, la profondeur
  # et la signature) reste portée par la ligne résolue — la même forme qu'avant
  vingt <- tibble::tibble(
    territoire = "22001",
    type = "commune",
    theme = "mobilite",
    story_key = "vingt-minutes-sans-voiture",
    div_loss_t = 8, div_loss_b = 1, delta = 7, pct_iso_full_t = 0.1,
    classification_saillance = "defaut"
  )
  resolue <- resoudre_histoires(vingt, "mobilite")
  expect_equal(resolue$div_loss_t, 8)
  expect_equal(resolue$salience_reason, "defaut")
})

test_that("Économie : chaque lecture résolue porte son groupe (la story unique #370)", {
  # issue #370 : `ce-que-la-bretagne-abrite` a QUITTÉ la fiche — la seule story
  # d'Économie est la lecture de spécialisation « ce que la commune abrite »,
  # qui vit dans le groupe sante-et-taille (le groupe est EXPLICITE, l'app
  # n'infère plus la relation — US10, #308)
  communes <- tibble::tibble(
    territoire = c("22001", "200000001", "22"),
    type = c("commune", "epci", "departement"),
    theme = "economie",
    story_key = "ce-que-la-commune-abrite",
    top1_activity_code = "A01.11Z", top1_activity_label = "Cultures de céréales",
    top1_lq = 8.5, top1_n = 120, top1_part_parc = NA_real_,
    top2_activity_code = NA_character_, top2_activity_label = NA_character_,
    top2_lq = NA_real_, top2_n = NA_real_, top2_part_parc = NA_real_
  )
  resolues <- resoudre_histoires(communes, "economie")

  expect_equal(
    resolues$groupe[resolues$story_key == "ce-que-la-commune-abrite"],
    rep("sante-et-taille", 3)
  )
  expect_true(all(resolues$salience_reason == "defaut"))
  expect_false(any(duplicated(resolues[c("territoire", "groupe")])))
})

test_that("une story candidate inconnue du registre échoue FORT", {
  mauvaises <- tibble::tibble(
    territoire = "22001", type = "commune", theme = "demographie",
    story_key = "story-fantome"
  )
  expect_error(resoudre_histoires(mauvaises, "demographie"),
               "inconnue.*registre")

  # issue #370 : `ce-que-la-bretagne-abrite` est retirée du registre — une
  # candidate qui la porte est désormais hors contrat, comme toute story inconnue
  bretagne <- tibble::tibble(
    territoire = "53", type = "region", theme = "economie",
    story_key = "ce-que-la-bretagne-abrite"
  )
  expect_error(resoudre_histoires(bretagne, "economie"),
               "inconnue.*registre")
})

test_that("un thème sans registre échoue FORT", {
  expect_error(resoudre_histoires(
    tibble::tibble(territoire = "22001", story_key = "x"), "programmes"),
    "sans registre")
})

test_that("la validation échoue FORT sur une lecture en double (territoire × groupe)", {
  p <- compute_payload(load_fixture())
  h <- p$histoires
  h2 <- dplyr::bind_rows(h, h[1, ])   # 22001 en double
  expect_error(valider_histoires_resolues(h2, "demographie"),
               "en double")
})

test_that("la validation échoue FORT sur une raison de saillance incohérente", {
  p <- compute_payload(load_fixture())
  h <- p$histoires
  h$salience_reason[1] <- "delta-velo-saillant"   # incohérent pour le défaut
  expect_error(valider_histoires_resolues(h, "demographie"),
               "salience_reason")
})

test_that("la validation échoue FORT sur une story hors registre ou un groupe inconnu", {
  p <- compute_payload(load_fixture())
  h <- p$histoires
  h$story_key[1] <- "story-fantome"
  expect_error(valider_histoires_resolues(h, "demographie"), "registre")
  h2 <- p$histoires
  h2$groupe[1] <- "groupe-fantome"
  expect_error(valider_histoires_resolues(h2, "demographie"), "groupe")
})

test_that("la validation accepte les histoires résolues valides", {
  p <- compute_payload(load_fixture())
  expect_no_error(valider_histoires_resolues(p$histoires, "demographie"))
})
