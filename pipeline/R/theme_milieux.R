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

# La construction de la table des territoires du thème -------------------------
# Le squelette partagé (squelette_territoires, compute.R) fournit les codes,
# les vrais noms, la hiérarchie et la règle de pluralité départementale ; le
# thème ajoute SES colonnes d'agrégation : les consommations d'ENAF (toutes les
# colonnes du reshape, déjà en hectares), sommées par niveau de territoire.

# agreger_territoires_milieux : la part du thème — les colonnes de consommation
# (le motif conso_en_m2 — la même source de vérité que le reshape), agrégées
# par niveau de territoire (une ligne par commune = ses propres valeurs ; EPCI
# / département / région = la somme des lignes de leurs communes), rejointes
# sur le squelette partagé par code. La somme est naïve (comme Démographie/
# Habitat) : une commune à consommation NA rend le total de son niveau NA — un
# total incomplet n'est JAMAIS publié comme s'il était complet (le fichier
# Cerema remplit 0,0 — le NA est l'exception honnête, jamais un 0 inventé).
agreger_territoires_milieux <- function(communes, squelette) {
  base <- communes %>%
    dplyr::mutate(dplyr::across(c(departement, epci), as.character))
  colonnes_conso <- conso_en_m2(names(base))

  mesures <- dplyr::bind_rows(
    base[c("code", colonnes_conso)],
    base %>%
      dplyr::group_by(epci) %>%
      dplyr::summarise(
        dplyr::across(dplyr::all_of(colonnes_conso), sum),
        .groups = "drop"
      ) %>%
      dplyr::rename(code = epci),
    base %>%
      dplyr::group_by(departement) %>%
      dplyr::summarise(
        dplyr::across(dplyr::all_of(colonnes_conso), sum),
        .groups = "drop"
      ) %>%
      dplyr::rename(code = departement),
    base %>%
      dplyr::summarise(
        dplyr::across(dplyr::all_of(colonnes_conso), sum),
        .groups = "drop"
      ) %>%
      dplyr::mutate(code = "53")
  )

  dplyr::left_join(squelette, mesures, by = "code")
}

# construire_territoires_milieux -----------------------------------------------
# Une ligne par territoire (communes + agrégats EPCI / département / région),
# mêmes colonnes partout : le squelette partagé + les colonnes d'agrégation du
# thème. Le POIDS de la pluralité départementale est la consommation totale
# d'ENAF 2011-2025 (comme Démographie pèse par la population et Habitat par
# les logements, Milieux pèse par les hectares consommés) — coalescée à 0 pour
# la seule règle mécanique d'attribution (une commune à consommation inconnue
# ne pèse pas ; sa consommation publiée, elle, garde son NA).
construire_territoires_milieux <- function(donnees) {
  communes <- donnees %>%
    dplyr::mutate(conso_poids = dplyr::coalesce(naf11art25, 0))
  squelette <- squelette_territoires(communes, poids = "conso_poids")
  agreger_territoires_milieux(communes, squelette)
}

# INDICATEURS_MILIEUX -----------------------------------------------------------
# La table déclarative des indicateurs du thème (issue #9) : chaque clé du
# payload y est déclarée avec sa source de référence (l'id du manifeste qui
# l'estampille — les vintages) et sa multiplicité. Le TRACEUR (issue #171)
# déclare UNE clé squelettique : conso_enaf — la consommation totale d'ENAF
# 2011-2025 en hectares (le champ natif naf11art25 du fichier, converti m² ->
# ha au reshape), une ligne PAR TERRITOIRE. La fenêtre 2021-2025, la série
# annuelle et le classement sur la part de surface arrivent avec l'indicateur
# livré (#172) ; la trajectoire ZAN au #173.
INDICATEURS_MILIEUX <- tibble::tibble(
  key = "conso_enaf",
  libelle = "Consommation d'espaces naturels, agricoles et forestiers (ENAF) 2011-2025 — total, en hectares",
  sources = list("consoenaf"),
  source_reference = "consoenaf",
  multiplicite = 1L
)

# APERCU_MILIEUX ----------------------------------------------------------------
# La table déclarative des clés de l'Aperçu du thème (issue #32, ADR-0007) :
# VIDE — le gating par thème. Milieux ne déclare aucune clé aujourd'hui (la
# spec #165 exclut l'Aperçu du v1), la table `apercu` du payload d'un run
# Milieux est présente mais vide (jamais un « under construction »).
APERCU_MILIEUX <- tibble::tibble(
  key = character(),
  libelle = character(),
  multiplicite = integer()
)

# Les constructeurs d'indicateurs ----------------------------------------------
# Mêmes entrées (la table des territoires), mêmes sorties : une table longue
# code, key, detail, value, unit. Le TRACEUR ne publie que la clé squelettique
# conso_enaf — la valeur est la consommation totale 2011-2025 (déjà en
# hectares), NA pour un territoire au total incomplet.
construire_indicateurs_milieux <- function(territoires) {
  list(
    conso_enaf = tibble::tibble(
      code = territoires$code,
      key = "conso_enaf",
      detail = NA_character_,
      value = territoires$naf11art25,
      unit = "ha"
    )
  )
}

# Les scalaires de classement du thème -----------------------------------------
# Le scalaire classé par indicateur : la valeur elle-même pour la clé
# squelettique (un scalaire — l'héritage du compute_ranks). La règle du
# classement livré (la part de la surface consommée, jamais les hectares bruts)
# arrive avec l'indicateur #172.
scalaires_milieux <- list()

# compute_histoires_milieux -----------------------------------------------------
# L'Histoire du thème : VIDE pour le traceur — les quatre lectures « Se
# densifier, s'étaler, ou s'en aller » arrivent avec le ticket #174. La table
# reste présente avec la forme du contrat (territoire | type | theme |
# story_key), sans aucune ligne : jamais un « under construction », juste
# l'absence de Story.
compute_histoires_milieux <- function(territoires) {
  tibble::tibble(
    territoire = character(),
    type = character(),
    theme = character(),
    story_key = character()
  )
}

# construire_apercu_milieux -----------------------------------------------------
# Les stats de base de l'onglet Aperçu (ADR-0007) : AUCUNE aujourd'hui — le
# gating par thème (APERCU_MILIEUX vide). Retourne la liste vide ; la table
# `apercu` du payload reste présente et vide (la forme du contrat).
construire_apercu_milieux <- function(territoires) {
  list()
}

# validations_milieux -----------------------------------------------------------
# Les vérifications de valeur propres au thème (point 7) : déclarées ici,
# exécutées par validate_payload() après ses vérifications génériques.
validations_milieux <- list(
  # la consommation d'ENAF est un total non négatif (une valeur NA — commune
  # sans donnée, total de niveau incomplet — est un cas légitime, jamais une
  # corruption ; une valeur négative est un fichier qui dérive)
  function(payload) {
    conso <- payload$indicateurs$value[
      payload$indicateurs$key == "conso_enaf"]
    if (any(!is.na(conso) & conso < 0)) {
      stop("Payload invalide : une consommation d'ENAF négative.",
           call. = FALSE)
    }
    invisible(payload)
  }
)

# vintages_milieux --------------------------------------------------------------
# Le builder de vintages du thème : la projection générique depuis le manifeste
# (vintages_depuis_manifest, vintage.R) — chaque source garde SA référence et
# SA publication, aucun alignement.
vintages_milieux <- function() {
  vintages_depuis_manifest(MANIFEST_MILIEUX)
}

# MEMBRES_DESCRIPTEUR_MILIEUX ---------------------------------------------------
# Les membres requis du descripteur — le contrat de FORME du thème (ce que la
# machinerie partagée consomme : theme, manifest, indicateurs, apercu,
# vintages, construire_donnees, construire_territoires, construire_indicateurs,
# construire_apercu, scalaires, compute_histoires, validations). La même idée
# que verifier_contrat_milieux : un descripteur incomplet échoue FORT, en
# nommant le membre fautif.
MEMBRES_DESCRIPTEUR_MILIEUX <- c(
  "theme", "manifest", "indicateurs", "apercu", "vintages",
  "construire_donnees", "construire_territoires", "construire_indicateurs",
  "construire_apercu", "scalaires", "compute_histoires", "validations"
)

# verifier_descripteur_milieux --------------------------------------------------
# La validation de FORME du descripteur : tout membre requis manquant fait
# échouer la validation bruyamment, en nommant le membre fautif. Exécutée par
# theme_milieux() sur son propre résultat (la construction échoue si le
# descripteur est cassé) et par les tests sur des fixtures négatives.
verifier_descripteur_milieux <- function(descripteur) {
  manquants <- setdiff(MEMBRES_DESCRIPTEUR_MILIEUX, names(descripteur))
  if (length(manquants) > 0) {
    stop("Descripteur Milieux invalide — membre(s) requis manquant(s) : ",
         paste(manquants, collapse = ", "), ".", call. = FALSE)
  }
  invisible(TRUE)
}

# theme_milieux ---------------------------------------------------------------
# Le descripteur du thème Milieux : la même forme de contrat que
# theme_demographie() / theme_habitat(), avec les pièces du thème. Le
# descripteur est validé à la construction (verifier_descripteur_milieux) :
# un membre manquant échoue là où il est construit, jamais plus tard dans la
# machinerie.
theme_milieux <- function() {
  descripteur <- list(
    theme = "milieux",
    manifest = MANIFEST_MILIEUX,
    indicateurs = INDICATEURS_MILIEUX,
    apercu = APERCU_MILIEUX,
    vintages = vintages_milieux,
    construire_donnees = construire_donnees_milieux,
    construire_territoires = construire_territoires_milieux,
    construire_indicateurs = construire_indicateurs_milieux,
    construire_apercu = construire_apercu_milieux,
    scalaires = scalaires_milieux,
    compute_histoires = compute_histoires_milieux,
    validations = validations_milieux
  )
  verifier_descripteur_milieux(descripteur)
  descripteur
}
