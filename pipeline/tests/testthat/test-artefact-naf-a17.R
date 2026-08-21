# test-artefact-naf-a17 ----------------------------------------------------------
# L'artefact de correspondance NAF rév. 2 → NA A17 (issue #426, parent #154) :
# la table de passage officielle INSEE épinglée comme ARTEFACT DE CODE — le même
# pattern que l'artefact EGSS (test-analytics-economie-green.R §1).
#
# Le contrat (issue #426) :
#   - le CSV épinglé inst/extdata/table_naf2_na17.csv — une transcription UNE FOIS
#     du fichier officiel INSEE table_NAF2-NA.xls (feuille « Version avec niveau
#     A 17 »), une ligne par sous-classe NAF rév. 2 avec son code A17 et son
#     libellé A17 officiels ; JAMAIS un téléchargement à l'exécution ;
#   - le lecteur tout en caractères — les zéros de tête des codes (« 01.11Z »,
#     « 06.10Z ») ne sont JAMAIS devinés numériques ;
#   - l'enveloppe métadonnées id / source / url / vintage / licence / note ;
#   - le vérificateur qui échoue FORT en nommant l'artefact ET la règle de
#     jointure (§2 du fichier).
#
# La RÈGLE DE JOINTURE (épinglée ici, vérifiée par verifier_contrat_naf_a17) :
# l'APET SIRENE est « NN.NN(L) » (6 caractères, NAF rév. 2) ; la jointure au
# grain sous-classe est EXACTE : sous_classe = activity_code, et le code A17
# remonte à la sous-classe entière. « 00.00Z » (inconnue) n'est pas une activité
# NAF officielle : son ABSENCE de la table est ATTENDUE — son exclusion est le
# travail du consommateur (ticket #427), jamais de l'artefact.
#
# Aucun appel réseau dans la boucle de test : tout part du CSV épinglé ou de
# copies corrompues écrites dans tempdir().

# 1. L'artefact NAF → A17 : versionné, épinglé, lu tout en caractères -------------

test_that("l'artefact NAF→A17 est versionné : id, source, url, vintage, licence, note, table", {
  art <- artefact_naf_a17()

  # l'enveloppe du contrat : id, source, url, vintage, licence, note, table
  expect_true(all(c("id", "source", "url", "vintage", "licence", "note",
                    "table") %in% names(art)))
  expect_equal(art$id, "naf2_na17_2008")
  expect_match(art$source, "INSEE")
  expect_match(art$url, "table_NAF2-NA.xls")
  expect_equal(art$vintage, "2008")
  expect_true(nzchar(art$licence))
  expect_true(nzchar(art$note))

  # la table épinglée : les colonnes du contrat, une ligne par sous-classe
  expect_named(art$table, c("sous_classe", "na17_code", "na17_libelle"))
  expect_equal(nrow(art$table), 732)
  expect_equal(anyDuplicated(art$table$sous_classe), 0L)

  # le vocabulaire FERMÉ des 17 postes A17 : aucun code hors vocabulaire, et
  # chaque libellé porté est exactement le libellé officiel de son code
  expect_setequal(unique(art$table$na17_code), names(VOCABULAIRE_NA17_OFFICIEL))
  expect_identical(unname(art$table$na17_libelle),
                   unname(VOCABULAIRE_NA17_OFFICIEL[art$table$na17_code]))

  # « 00.00Z » (inconnue) n'est pas une activité NAF officielle : son absence
  # de la correspondance est ATTENDUE — documentée, jamais corrigée ici
  expect_false("00.00Z" %in% art$table$sous_classe)
})

test_that("le lecteur lit tout en caractères : les zéros de tête ne sont jamais devinés numériques", {
  d <- lire_naf_a17()

  expect_true(all(vapply(d, is.character, logical(1))))
  expect_named(d, c("sous_classe", "na17_code", "na17_libelle"))
  # le format sous-classe NN.NNL tient sur TOUTES les lignes — un code lu
  # numérique (« 06.1 » au lieu de « 06.10Z ») casserait ce verrou
  expect_true(all(grepl("^[0-9]{2}\\.[0-9]{2}[A-Z]$", d$sous_classe)))
  # un code à zéro de tête réel, lu tel quel
  expect_equal(d$na17_code[d$sous_classe == "06.10Z"], "DE")
})

test_that("le lecteur échoue FORT quand le CSV épinglé est introuvable", {
  expect_error(lire_naf_a17(chemin = file.path(tempdir(), "introuvable.csv")),
               "table_naf2_na17\\.csv")
  expect_error(lire_naf_a17(chemin = file.path(tempdir(), "introuvable.csv")),
               "jointure")
})

# 2. Le vérificateur de contrat : l'intégrité de l'artefact ----------------------

test_that("le vérificateur accepte l'artefact épinglé (silencieux, invisible(TRUE))", {
  expect_silent(verifie <- verifier_contrat_naf_a17(artefact_naf_a17()))
  expect_true(verifie)
})

test_that("un artefact corrompu (format sous-classe invalide) échoue FORT en nommant l'artefact et la règle de jointure", {
  # le QA du plan : corrompre l'artefact -> échec bruyant qui nomme l'artefact
  # ET la règle de jointure — jamais un échec silencieux
  corrompu <- artefact_naf_a17()
  corrompu$table$sous_classe[1] <- "01.11"  # la lettre finale manque (5 caractères)

  expect_error(verifier_contrat_naf_a17(corrompu), "naf2_na17_2008")
  expect_error(verifier_contrat_naf_a17(corrompu), "jointure")

  # une forme numérique (silencieuse, elle détruirait les zéros de tête) est
  # elle aussi une corruption : « 6.1Z » n'est pas un APET NAF rév. 2 valide
  numerique <- corrompu
  numerique$table$sous_classe[1] <- "6.1Z"
  expect_error(verifier_contrat_naf_a17(numerique), "naf2_na17_2008")
})

test_that("une copie corrompue sur disque (via le lecteur) échoue au moment où elle est consommée", {
  # la table relue depuis un fichier corrompu porte la corruption jusqu'au
  # vérificateur : le contrat tient du disque à la consommation
  copie <- file.path(tempdir(), "table_naf2_na17_corrompue.csv")
  on.exit(unlink(copie), add = TRUE)
  d <- lire_naf_a17()
  d$sous_classe[1] <- "01.11ZZ"  # 7 caractères : pas un APET NN.NNL
  readr::write_csv(d, copie, eol = "\n")

  corrompu <- artefact_naf_a17()
  corrompu$table <- lire_naf_a17(copie)
  expect_error(verifier_contrat_naf_a17(corrompu), "naf2_na17_2008")
})

test_that("un code A17 hors vocabulaire officiel échoue FORT", {
  inconnu <- artefact_naf_a17()
  inconnu$table$na17_code[1] <- "XX"
  expect_error(verifier_contrat_naf_a17(inconnu), "naf2_na17_2008")
  expect_error(verifier_contrat_naf_a17(inconnu), "XX")
})

test_that("un libellé A17 qui s'écarte du libellé officiel de son code échoue FORT", {
  # le XLS ne porte pas les libellés : un libellé réécrit (même pour un code
  # juste) est une transcription corrompue — le vocabulaire fermé le refuse
  relibelle <- artefact_naf_a17()
  relibelle$table$na17_libelle[1] <- "agriculture"
  expect_error(verifier_contrat_naf_a17(relibelle), "naf2_na17_2008")
})

test_that("une sous-classe dupliquée échoue FORT", {
  dupliquee <- artefact_naf_a17()
  dupliquee$table$sous_classe[2] <- dupliquee$table$sous_classe[1]
  expect_error(verifier_contrat_naf_a17(dupliquee), "naf2_na17_2008")
  expect_error(verifier_contrat_naf_a17(dupliquee), "doubl")
})

test_that("une colonne manquante échoue FORT en nommant la colonne", {
  sans_colonne <- artefact_naf_a17()
  sans_colonne$table$na17_code <- NULL
  expect_error(verifier_contrat_naf_a17(sans_colonne), "na17_code")
  expect_error(verifier_contrat_naf_a17(sans_colonne), "naf2_na17_2008")
})

test_that("l'artefact refuse aussi une métadonnée manquante ou vide", {
  sans_id <- artefact_naf_a17()
  sans_id$id <- NA_character_
  expect_error(verifier_contrat_naf_a17(sans_id), "id")
  sans_source <- artefact_naf_a17()
  sans_source$source <- ""
  expect_error(verifier_contrat_naf_a17(sans_source), "source")
  sans_vintage <- artefact_naf_a17()
  sans_vintage$vintage <- NULL
  expect_error(verifier_contrat_naf_a17(sans_vintage), "vintage")
  sans_url <- artefact_naf_a17()
  sans_url$url <- ""
  expect_error(verifier_contrat_naf_a17(sans_url), "url")
  sans_note <- artefact_naf_a17()
  sans_note$note <- NA_character_
  expect_error(verifier_contrat_naf_a17(sans_note), "note")
})
