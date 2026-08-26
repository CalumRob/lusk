# test-sources-raccordement -------------------------------------------------------
# Les trois sources du raccordement (issue #485, parent #482) dans le
# manifeste Mobilité :
#   - le RE-PIN Korrigo : le millésime périmé (v80223, février 2026 — douze
#     réseaux sombres sur une date de septembre) cède la place au millésime
#     frais v80335 vérifié pendant la recherche ; ce pin partagé alimente
#     AUSSI l'indicateur offre_tc — son premier passage à la fraîcheur est
#     DOCUMENTÉ dans la note du fragment (le journal des millésimes de la
#     source), jamais tu dans le silence ;
#   - SNCF Voyageurs : l'export GTFS national (« Réseau SNCF TGV, Intercités
#     et TER »), l'AUTORITÉ FERROVIAIRE SEULE — le TGV n'existe pas dans
#     l'agrégat Korrigo ; licence ODbL CONSTATÉE sur les portails (la LO-2.0
#     attendue par la recherche est RÉFUTÉE, voir note et PR) ;
#   - DILA « Base de données locales » : l'archive v4 du géocodage des mairies,
#     Licence Ouverte 2.0 (constatée sur la page du jeu).
#
# Les deux nouveaux fragments suivent la convention des fragments (#13) : les
# 11 colonnes standard, une ligne par source, SON vintage, SA référence et SA
# publication, un contrat qui refuse tout écart en nommant le champ fautif.

test_that("MANIFEST_MOBILITE_KORRIGO : re-pinné sur le millésime frais v80335", {
  frag <- MANIFEST_MOBILITE_KORRIGO

  expect_equal(nrow(frag), 1L)
  expect_equal(frag$id, "korrigo")
  expect_equal(frag$fichier, "korrigo-gtfs.zip")
  expect_equal(frag$licence, "odbl")
  expect_equal(frag$mode, "cron")
  expect_equal(frag$type, "fichier")

  # LE re-pin (#485) : le millésime frais de la recherche (feed_version
  # « 80335 », validité 2025-12-14 → 2034-01-20, acquisition vérifiée du
  # 2026-08-25) remplace le cache périmé de février
  expect_equal(frag$vintage, "2026-08")
  expect_equal(frag$date_reference, "2026-08-25")
  expect_equal(frag$date_publication, "2026-08-25")

  # le JOURNAL DU MILLÉSIME (le changelog de la source) vit dans la note :
  # l'ancien millésime, le nouveau, l'empreinte du zip frais, ET le fait que
  # offre_tc lit CE pin — son premier passage à la fraîcheur déplacera ses
  # valeurs publiées (verrous données réelles à réétalonner au run frais)
  expect_match(frag$note, "80335", fixed = TRUE)
  expect_match(frag$note, "offre_tc", fixed = TRUE)
  expect_match(frag$note, "premier passage", fixed = TRUE)
  expect_match(frag$note, "663d7db6", fixed = TRUE)

  expect_true(verifier_contrat_mobilite_korrigo(frag))
})

test_that("MANIFEST_MOBILITE_SNCF_VOYAGEURS : l'autorité ferroviaire seule, ODbL constaté", {
  frag <- MANIFEST_MOBILITE_SNCF_VOYAGEURS

  expect_equal(nrow(frag), 1L)
  expect_equal(frag$id, "sncf_voyageurs")
  # l'export GTFS national exact (jamais NeTEx, jamais un flux temps réel)
  expect_equal(frag$fichier, "sncf-national.zip")
  expect_equal(
    frag$url,
    "https://eu.ftp.opendatasoft.com/sncf/plandata/Export_OpenData_SNCF_GTFS_NewTripId.zip")
  expect_equal(frag$vintage, "2026-08")
  expect_equal(frag$date_reference, "2026-08-24") # feed_start_date du fichier épinglé
  expect_equal(frag$date_publication, "2026-08-25") # l'acquisition vérifiée (research §5a)
  # licence ODbL — CONSTATÉE sur transport.data.gouv.fr ET data.gouv.fr (la
  # page SNCF Open Data renvoie elle-même sa FAQ/Licence ODbL) : l'attente
  # « Licence Ouverte 2.0 » de la recherche est réfutée, documentée pas devinée
  expect_equal(frag$licence, "odbl")
  # pin-on-acquisition (research §3a) : un export roulant ~quotidien ne se
  # ré-télécharge PAS tout seul — chaque millésime est ré-épinglé à la main
  expect_equal(frag$mode, "manuel")
  expect_equal(frag$type, "fichier")
  # la note porte la décision de source (l'autorité ferroviaire seule, le TGV
  # absent de Korrigo) et le constat de licence
  expect_match(frag$note, "TGV", fixed = TRUE)
  expect_match(frag$note, "ODbL", fixed = TRUE)
  expect_match(frag$note, "816d172f", fixed = TRUE)
  expect_true(verifier_contrat_mobilite_sncf_voyageurs(frag))
})

test_that("MANIFEST_MOBILITE_DILA_BDL : l'archive des mairies, Licence Ouverte 2.0", {
  frag <- MANIFEST_MOBILITE_DILA_BDL

  expect_equal(nrow(frag), 1L)
  expect_equal(frag$id, "dila_bdl")
  expect_equal(frag$fichier, "all_latest.tar.bz2")
  expect_equal(
    frag$url,
    "https://lecomarquage.service-public.gouv.fr/donnees_locales_v4/all_latest.tar.bz2")
  expect_equal(frag$vintage, "2026-08")
  expect_equal(frag$date_reference, "2026-08-25") # l'édition téléchargée (last-modified serveur)
  expect_equal(frag$date_publication, "2026-08-25")
  expect_equal(frag$licence, "lov2")   # constatée sur la page data.gouv du jeu
  # ~348 Mo, reconstruite presque chaque jour : horloge lente, jamais un cron
  expect_equal(frag$mode, "manuel")
  expect_equal(frag$type, "fichier")
  # la note porte la discipline d'attribution (paternité DILA + URL + nom du
  # fichier + date) et la couverture empirique (1 213 entrées bretonnes,
  # aucune des 1 202 communes COG 2025 manquante)
  expect_match(frag$note, "DILA", fixed = TRUE)
  expect_match(frag$note, "1213", fixed = TRUE)
  expect_match(frag$note, "1202", fixed = TRUE)
  expect_match(frag$note, "54da4f0b", fixed = TRUE)
  expect_true(verifier_contrat_mobilite_dila_bdl(frag))
})

# --- les contrats refusent les écarts -------------------------------------------

test_that("TRIPWIRE — les contrats des nouvelles sources refusent les corruptions", {
  # korrigo : revenir au millésime périmé est un échec (le contrat épingle le
  # re-pin frais — un retour en arrière doit être un changement EXPLICITE du
  # contrat, jamais un silence)
  perime <- MANIFEST_MOBILITE_KORRIGO
  perime$vintage <- "2026-02"
  expect_error(verifier_contrat_mobilite_korrigo(perime), "vintage")

  # sncf : la licence attendue est ODbL — une autre licence est refusée, et le
  # mode cron aussi (pin-on-acquisition : jamais de re-téléchargement muet)
  faux_sncf <- MANIFEST_MOBILITE_SNCF_VOYAGEURS
  faux_sncf$licence <- "lov2"
  expect_error(verifier_contrat_mobilite_sncf_voyageurs(faux_sncf), "licence")
  faux_sncf <- MANIFEST_MOBILITE_SNCF_VOYAGEURS
  faux_sncf$mode <- "cron"
  expect_error(verifier_contrat_mobilite_sncf_voyageurs(faux_sncf), "mode")

  # dila : publication antérieure à la référence — dates incohérentes refusées
  faux_dila <- MANIFEST_MOBILITE_DILA_BDL
  faux_dila$date_publication <- "2026-08-24"
  expect_error(verifier_contrat_mobilite_dila_bdl(faux_dila), "dates")

  # dila : un autre fichier que l'archive v4 est refusé
  faux_dila <- MANIFEST_MOBILITE_DILA_BDL
  faux_dila$fichier <- "all_latest.zip"
  expect_error(verifier_contrat_mobilite_dila_bdl(faux_dila), "fichier")
})

test_that("le manifeste concaténé porte les TREIZE sources du thème", {
  m <- MANIFEST_MOBILITE
  expect_s3_class(m, "tbl_df")
  expect_equal(nrow(m), 13L)
  expect_equal(nrow(m), length(unique(m$id)))
  expect_setequal(m$id, c("mobilite_snapshot", "rp_logement_princ",
                          "osm_reseaux", "amenagements_cyclables",
                          "communes_limites", "korrigo",
                          "batiments_residentiels", "bornes-recharges",
                          "stationnement-velo", "bpe_b316", "cog_passage",
                          "sncf_voyageurs", "dila_bdl"))
  expect_true(verifier_contrat_manifest_mobilite(m))

  # amputer une source reste un échec bruyant — maintenant TREIZE
  defectueux <- m[m$id != "batiments_residentiels", ]
  expect_error(verifier_contrat_manifest_mobilite(defectueux), "TREIZE")
})
