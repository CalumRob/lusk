# theme_milieux ---------------------------------------------------------------
# Le module du thème Milieux (issue #171, ADR-0014) : le cinquième bloc de la
# fiche, l'axe terre. Ce ticket est le TRACEUR — le plus mince chemin complet
# qui prouve que la machinerie partagée (download/compute/publish) marche pour
# Milieux : l'ingestion CONSOENAF (le manifeste, le reshape m² -> ha, le filtre
# Bretagne), la table des territoires via le squelette partagé, et un payload
# squelettique (une seule clé d'indicateur — la consommation totale 2011-2025
# en hectares — qui rend le payload publiable et validable) qui passe les
# validateurs génériques. Les indicateurs proprement dits (la fenêtre 2021-2025
# et la série annuelle, #172 ; la trajectoire ZAN, #173) et l'Histoire
# (#174) arrivent dans les tickets suivants.
#
# Ce qui vit ici, ce qui ne vit pas ici :
#   - le manifeste CONCATÉNÉ du thème (manifest_milieux.R) : la source
#     CONSOENAF + la base des EPCI partagée ;
#   - la construction des données : le lecteur du CSV (lire_consoenaf), le
#     reshape (normaliser_consoenaf — l'anomalie d'unité m²/ha, le filtre
#     Bretagne) et l'assembleur (construire_donnees_milieux — la jointure
#     d'identité sur la base des EPCI partagée) ;
#   - la table des territoires du thème : le squelette PARTAGÉ (squelette_
#     territoires, compute.R) avec le poids du thème — la consommation totale
#     d'ENAF (comme Démographie pèse par la population et Habitat par les
#     logements, Milieux pèse par les hectares consommés) ;
#   - la table déclarative INDICATEURS_MILIEUX (la clé squelettique conso_enaf)
#     et l'APERCU_<theme> vide (le gating par thème, ADR-0007).
# Ce qui N'y vit PAS : aucun calcul d'indicateur livré (#172/#173), aucune
# Histoire (#174), aucune modification de la machinerie partagée.

# lire_consoenaf ---------------------------------------------------------------
# Le lecteur du CSV CONSOENAF (conso_com.csv) : tout est lu en chaînes — les
# codes (idcom, iddep, epci25) ne sont jamais des nombres (le 0 de tête des
# codes < 10000), les champs texte du fichier (scot, libdens_aav, littoral,
# abc...) portent des valeurs non numériques (« NC », « out »). La conversion
# des champs de consommation en double se fait au reshape, pas à la lecture.
lire_consoenaf <- function(chemin) {
  readr::read_csv(
    chemin,
    col_types = readr::cols(.default = readr::col_character()),
    show_col_types = FALSE, progress = FALSE
  )
}

# conso_en_m2 -----------------------------------------------------------------
# Le motif des colonnes de consommation diffusées en m² (l'anomalie d'unité,
# ADR-0014) : les annuels naf{AA}art{AA+1} / art{AA}{dest}{AA+1} et les totaux
# de période naf{AA}art{BB} / art{AA}{dest}{BB} (AA, BB = les deux chiffres de
# l'année — 11..25). Les DÉCORS du fichier sont exclus, jamais convertis :
#   - artpop{AA}{BB} / mepart{AA}{BB} / menhab{AA}{BB} : des ratios déjà en
#     ha/hab ou en ha-1 — leur nom commence par « art »/« me » mais ce ne sont
#     pas des consommations en m² ;
#   - artcom1125 : la part de surface communale consommée (un %) ;
#   - surfcom2025 : la surface de la commune (en m² — une mesure du référentiel,
#     jamais divisée) ;
#   - pop*/men*/emp* : les populations/ménages/emplois RP embarqués (jamais
#     convertis — la règle de source de population d'ADR-0014).
conso_en_m2 <- function(noms) {
  noms[grepl("^(naf|art)[0-9]{2}(art|hab|act|mix|rou|fer|inc)[0-9]{2}$", noms)]
}

# normaliser_consoenaf ----------------------------------------------------------
# LE reshape CONSOENAF : renomme l'identité (idcom -> code, idcomtxt -> nom,
# iddep -> departement, epci25 -> epci, epci25txt -> nom_epci), convertit les
# champs de consommation de m² en hectares (÷ 10 000 — le fichier distribue des
# m², le dictionnaire dit hectares ; la conversion est testée, jamais
# silencieusement trustée) et filtre la Bretagne (22/29/35/56). Une valeur de
# consommation vide reste NA — jamais un 0 inventé. Les décors (ratios, parts,
# surfaces, populations embarquées) passent intacts.
normaliser_consoenaf <- function(table_conso) {
  m2 <- conso_en_m2(names(table_conso))
  table_conso %>%
    dplyr::rename(
      code = idcom, nom = idcomtxt, departement = iddep,
      epci = epci25, nom_epci = epci25txt
    ) %>%
    dplyr::mutate(dplyr::across(dplyr::all_of(m2), ~ as.double(.x) / 10000)) %>%
    filter_bretagne()
}

# construire_donnees_milieux ---------------------------------------------------
# L'acte « trouver la donnée » du thème : lit le CSV CONSOENAF dans le cache,
# le reshape (m² -> ha + Bretagne), puis JOINT l'identité sur la base des EPCI
# partagée (lire_epci — le référentiel commun des noms réels LIBGEO/LIBEPCI et
# de l'appartenance EPCI/département ; la même règle que Démographie/Habitat :
# l'identité vient du référentiel partagé, jamais des champs embarqués du
# fichier). Persiste la table des communes sous data/processed/milieux/
# (idempotent, comme les builders des sources) et la retourne — la forme que
# construire_territoires_milieux consomme.
construire_donnees_milieux <- function(cache = "data/raw",
                                       sortie = "data/processed/milieux/consoenaf_communes.rds") {
  extrait <- file.path(cache, "extracted")
  if (!dir.exists(extrait)) dir.create(extrait, recursive = TRUE)

  # la base des EPCI est partagée entre les thèmes : le manifeste du thème la
  # télécharge, on l'extrait ici (idempotent) pour lire l'identité des communes
  zip_epci <- MANIFEST_MILIEUX$fichier[MANIFEST_MILIEUX$id == "epci"]
  suppressWarnings(
    utils::unzip(file.path(cache, zip_epci), exdir = extrait, overwrite = FALSE)
  )

  conso <- normaliser_consoenaf(
    lire_consoenaf(file.path(cache, "conso-com.csv"))
  )
  base_epci <- lire_epci(file.path(extrait, "EPCI_au_01-01-2025.xlsx"))

  communes <- conso %>%
    dplyr::inner_join(base_epci, by = c("code" = "CODGEO")) %>%
    dplyr::transmute(
      code = code,
      nom = LIBGEO,
      departement = DEP,
      epci = EPCI,
      nom_epci = LIBEPCI,
      dplyr::across(dplyr::all_of(conso_en_m2(names(conso))), ~ .x)
    )

  if (!dir.exists(dirname(sortie))) dir.create(dirname(sortie), recursive = TRUE)
  readr::write_rds(communes, sortie)
  communes
}
