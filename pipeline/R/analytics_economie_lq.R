# analytics_economie_lq --------------------------------------------------------
# L'analyse LQ continue du thème Économie/Emploi (plan economie-analytical-phase,
# todo 1 — gates C/D/E verrouillées 2026-08-05 ; docs/themes/economie-emploi.md
# §Story pool : la LQ est l'Histoire par défaut « ce que la commune sait
# faire »). Le chaînon analytique qui transforme la table normalisée
# `sirene_snapshot` (commune × code APE × tranche d'effectifs → nombre
# d'établissements ACTIFS) en cinq artefacts sous data/processed/economie/ :
#
#   1. `agreger_sirene_par_activite`  — regroupement de la dimension tranche :
#      somme de `value` par commune × code APE. La table long et creuse du
#      contrat (une ligne par cellule observée commune × APE × tranche, la
#      taille reste une valeur atomique par ligne) redevient le comptage du
#      grain fin commune × activité.
#   1bis. `mapper_activites_a17`     — le MAPPING A17 (issue #427, parent #154 :
#      le grain sous-classe est trop fin pour la LQ — décision de bascule sur
#      A17) : la jointure EXACTE à l'artefact épinglé #426 (sous_classe =
#      activity_code — jamais un préfixe de chaîne), le RE-SOMME des n par
#      commune × A17, les libellés A17 OFFICIELS portés par la table. Les codes
#      sans correspondance (« 00.00Z » dans le snapshot réel, exactement 1
#      établissement) sont EXCLUS du calcul et RAPPORTÉS dans un rapport
#      persisté — jamais silencieux.
#   2. `appliquer_plancher_communes`  — le plancher de commune gate D : une
#      commune n'entre dans le calcul analytique que si son TOTAL
#      d'établissements actifs (somme de ligne sur tous les codes APE) ≥ 5.
#      Les communes sous le plancher sont SUPPRIMÉES et COMPTÉES dans un
#      rapport de suppression (jamais écartées en silence) — la preuve réelle
#      (181 481 lignes, 1202 communes) supprime 0 commune (min = 10
#      établissements), la fixture analytique exerce la règle.
#   3. `calculer_lq_balassa`          — la LQ de Balassa CONTINUE par commune ×
#      code APE 5 chiffres vs la moyenne bretonne (gate E — référence
#      Bretagne seule, jamais France entière) :
#          LQ_ca = (n_ca / n_c.) / (n_.a / n_..)
#      avec n_ca = établissements de la commune c dans l'activité a, n_c. =
#      total de la commune, n_.a = total de l'activité sur la Bretagne retenue,
#      n_.. = total général. Les colonnes de transparence n_c / n_a / n sont
#      persistées à côté de la LQ. La LQ reste CONTINUE : aucun seuillage
#      (gate C — le seuil n'existe pas dans cette phase, la matrice binaire
#      part dans le sidecar M).
#   4. `calculer_histoires_lq`        — l'Histoire « ce que la commune abrite » :
#      les TOP_N_SPECIALISATIONS_LQ (top-5, décision 2026-08-06) par LQ,
#      valeurs CONTINUES uniquement, `n` conservé (issue #131). Une entrée
#      binaire (une matrice M 0/1 passée par erreur) échoue bruyamment —
#      l'Histoire ne se seuille jamais (gate C). Sélection déterministe
#      (ADR-0002) : tri par LQ décroissante puis code APE croissant — même
#      entrée → même Histoire, pour toujours.
#   4bis. `calculer_lq_par_niveau`   — la LQ à RÉFÉRENCE MÊME-ÉCHELLE (issue
#      #131, décision 2026-08-06) : la même formule de Balassa, paramétrée par
#      le niveau d'agrégat — un EPCI se compare aux autres EPCIs, un
#      département aux autres départements (jamais vs la moyenne bretonne des
#      communes). La matière des lignes d'Histoire des agrégats.
#   4ter. `calculer_presence_bretagne` — la lecture régionale « Ce que la
#      Bretagne abrite » (issue #131) : le top-N par PRÉSENCE (n + part du
#      parc) — la région n'a pas de Story LQ (sa LQ est dégénérée).
#   5. `calculer_matrice_m`           — le sidecar M : la matrice d'incidence
#      binaire (LQ ≥ 1, commune × activité) comme artefact SÉPARÉ pour la
#      relatedness future (gate F — docs/research/relatedness.md §5 Layer 1 :
#      « entry = 1 if the commune's LQ ≥ 1 »). L'Histoire ne l'utilise jamais.
#
# `construire_analytique_lq_economie` enchaîne les six étapes et persiste les
# cinq artefacts sous la localisation dédiée Économie/Emploi des données
# processées (data/processed/economie/). Idempotent et déterministe (les
# tibbles sont triés, les écritures relisent l'identique) — relancer produit
# les mêmes artefacts, octet-pour-octet. Aucun payload de fiche ici : les
# preuves vivent sous pipeline/data/ (gitignoré), jamais sous public/.
# Aucun appel réseau dans la boucle de test : la fixture analytique
# (test-analytics-economie-lq.R) est le seam d'entrée, la vraie table est
# lue quand elle est présente.

# SEUIL_PLANCHER_COMMUNES_LQ ---------------------------------------------------
# Le plancher de commune gate D (décision 2026-08-05) : une commune entre dans
# le calcul analytique si son TOTAL d'établissements actifs (somme de ligne
# sur tous les codes APE) est ≥ 5. Verrouillé sur la preuve réelle : min = 10
# établissements/commune → 0 commune supprimée ; la fixture analytique
# (56001, total 3) exerce la règle de suppression+comptage.
SEUIL_PLANCHER_COMMUNES_LQ <- 5

# TOP_N_SPECIALISATIONS_LQ -----------------------------------------------------
# La profondeur de l'Histoire « ce que la commune abrite » (issue #131,
# décision 2026-08-06 — portée de top-3 à top-5) : les top-5 spécialisations
# par LQ. La 4e/5e place est encore une LQ énorme (loin au-dessus du p90 de la
# distribution des cellules) et apporte de la diversité sectorielle à la
# lecture. Le plan (economie-analytical-phase, todo 1) laissait le choix
# top-3/top-5 au build ; top-5 est retenu, aligné sur la profondeur de la
# lecture régionale (TOP_N_PRESENCE_REGION = 5, même constante).
TOP_N_SPECIALISATIONS_LQ <- 5

# TOP_N_PRESENCE_REGION ---------------------------------------------------------
# La profondeur de la lecture régionale « Ce que la Bretagne abrite » (issue
# #131, décision 2026-08-06) : le top-5 des types d'établissements les plus
# présents dans le parc breton (NAF-5, n + part du parc). La région n'a pas de
# Story LQ (sa LQ est dégénérée — le territoire EST la référence, toutes les
# LQ ≡ 1) : la lecture est une lecture de STRUCTURE, miroir de la profondeur
# top-5 de la Story des autres territoires (même constante = 5).
TOP_N_PRESENCE_REGION <- 5

# agreger_sirene_par_activite --------------------------------------------------
# Le regroupement de la dimension tranche (étape 1) : somme de `value` par
# commune × code APE, le libellé d'activité conservé (premier non manquant).
# La table doit porter les colonnes du contrat commune / activity_code /
# value (une valeur par ligne, positive) — la forme de normaliser_sirene_
# snapshot. Déterministe : triée par commune puis code APE.
agreger_sirene_par_activite <- function(snapshot) {
  manquantes <- setdiff(c("commune", "activity_code", "value"), names(snapshot))
  if (length(manquantes) > 0) {
    stop("Analyse LQ — le snapshot doit porter les colonnes commune, ",
         "activity_code et value (manquantes : ",
         paste(manquantes, collapse = ", "), ").", call. = FALSE)
  }
  if (any(is.na(snapshot$commune) | is.na(snapshot$activity_code))) {
    stop("Analyse LQ — commune ou activity_code manquant dans le snapshot.",
         call. = FALSE)
  }
  if (any(is.na(snapshot$value) | snapshot$value <= 0)) {
    stop("Analyse LQ — value doit être positive (le snapshot ne porte que des ",
         "cellules observées).", call. = FALSE)
  }

  snapshot %>%
    dplyr::group_by(commune, activity_code) %>%
    dplyr::summarise(
      activity_label = premier_libelle(activity_label),
      n = sum(value),
      .groups = "drop"
    ) %>%
    dplyr::arrange(commune, activity_code)
}

# mapper_activites_a17 ----------------------------------------------------------
# Le MAPPING A17 (issue #427, parent #154 — la bascule du grain LQ décidée par
# le parent : la sous-classe est trop fine, les cellules n=1 fabriquent des LQ
# bruit) : les sous-classes APET de la table agrégée remontent aux postes A17
# de la nomenclature agrégée par l'ARTEFACT ÉPINGLÉ (#426). La règle de
# jointure est celle de l'artefact : EXACTE, sous_classe = activity_code —
# jamais un préfixe de chaîne, jamais un repli heuristique. Le contrat de la
# correspondance est vérifié AVANT tout calcul (le même ordre que le score vert
# et son artefact EGSS) : une table corrompue s'arrête ici, bruyamment.
#
#   - la re-somme : les sous-classes qui remontent au MÊME poste fusionnent en
#     UNE cellule commune × A17 (la somme des n est conservée à travers la
#     jointure) ;
#   - les libellés : activity_label devient le libellé A17 OFFICIEL porté par
#     la table (verrouillé par VOCABULAIRE_NA17_OFFICIEL) — jamais le libellé
#     APET d'entrée ;
#   - les codes SANS correspondance sont EXCLUS du calcul et RAPPORTÉS — dans
#     le snapshot réel exactement « 00.00Z » (l'inconnue n'est pas une activité
#     NAF officielle, son absence de la table est ATTENDUE), mais LE RAPPORT
#     EST LE MÉCANISME : tout code absent de la table sort du calcul et entre
#     au rapport, quel qu'il soit — jamais silencieux.
#
# Retourne la liste {mappe, exclusions} :
#   - mappe      : la table commune × A17 × libellé officiel × n — LA MÊME
#     FORME que la sortie d'agreger_sirene_par_activite : le plancher, la
#     Balassa, l'Histoire et la matrice M consomment sans changement de
#     contrat ;
#   - exclusions : LE rapport d'exclusion — une ligne par code non mappable,
#     avec son n total, ses communes concernées et le motif qui nomme
#     l'artefact. Déterministe : trié par code.
mapper_activites_a17 <- function(agrege, correspondance = artefact_naf_a17()) {
  manquantes <- setdiff(c("commune", "activity_code", "activity_label", "n"),
                        names(agrege))
  if (length(manquantes) > 0) {
    stop("Mapping A17 — la table agrégée doit porter les colonnes commune, ",
         "activity_code, activity_label et n (manquantes : ",
         paste(manquantes, collapse = ", "), ").", call. = FALSE)
  }

  verifier_contrat_naf_a17(correspondance)

  jointe <- agrege %>%
    dplyr::left_join(
      correspondance$table[c("sous_classe", "na17_code", "na17_libelle")],
      by = c("activity_code" = "sous_classe")
    )

  list(
    mappe = jointe %>%
      dplyr::filter(!is.na(na17_code)) %>%
      dplyr::group_by(commune, na17_code) %>%
      dplyr::summarise(
        activity_label = premier_libelle(na17_libelle),
        n = sum(n),
        .groups = "drop"
      ) %>%
      dplyr::rename(activity_code = na17_code) %>%
      dplyr::select(commune, activity_code, activity_label, n) %>%
      dplyr::arrange(commune, activity_code),
    exclusions = jointe %>%
      dplyr::filter(is.na(na17_code)) %>%
      dplyr::group_by(activity_code) %>%
      dplyr::summarise(
        n = sum(n),
        n_communes = dplyr::n_distinct(commune),
        communes = paste(sort(unique(commune)), collapse = ", "),
        motif = sprintf(
          paste0(
            "code absent de la correspondance officielle NAF rév. 2 → A17 ",
            "(artefact %s) : exclu du calcul, rapporté ici."
          ),
          correspondance$id
        ),
        .groups = "drop"
      ) %>%
      dplyr::select(activity_code, n, n_communes, communes, motif) %>%
      dplyr::arrange(activity_code)
  )
}

# appliquer_plancher_communes --------------------------------------------------
# Le plancher de commune gate D (étape 2) : le total par commune (la somme de
# ligne sur tous les codes APE) détermine l'entrée dans le calcul. Retourne
# la liste {retenu, suppression} :
#   - retenu     : les lignes commune × activité des communes ≥ seuil ;
#   - suppression : LE rapport de suppression — une ligne par commune écartée
#     avec son total (n_total) et son nombre d'activités (n_activites), plus
#     le seuil appliqué. JAMAIS une suppression silencieuse : le rapport est
#     un artefact persisté, vide quand aucune commune n'est écartée.
# Le seuil est nommé (SEUIL_PLANCHER_COMMUNES_LQ) et paramétrable — la
# fixture l'exerce ; la vraie table supprime 0 commune.
appliquer_plancher_communes <- function(agrege, seuil = SEUIL_PLANCHER_COMMUNES_LQ) {
  totaux <- agrege %>%
    dplyr::group_by(commune) %>%
    dplyr::summarise(
      n_total = sum(n),
      n_activites = dplyr::n(),
      .groups = "drop"
    )

  retenues <- totaux$commune[totaux$n_total >= seuil]

  list(
    retenu = agrege %>%
      dplyr::filter(commune %in% retenues) %>%
      dplyr::arrange(commune, activity_code),
    suppression = totaux %>%
      dplyr::filter(commune %in% setdiff(totaux$commune, retenues)) %>%
      dplyr::mutate(seuil_commune = seuil) %>%
      dplyr::arrange(commune)
  )
}

# calculer_lq_balassa_noyau -----------------------------------------------------
# Le noyau COMMUN des deux LQ de Balassa du thème (calculer_lq_balassa — la
# commune vs la moyenne bretonne, gate E ; calculer_lq_par_niveau — un agrégat
# vs SES pairs, référence même-échelle, issue #131) : les totaux par groupe
# (n_g), les totaux par activité (n_a), le total général et la formule
#   LQ = (n / n_g) / (n_a / total)
# `groupe` nomme la colonne du territoire (commune, EPCI, DEP...). Un total
# général nul est un calcul sans référence — une erreur bruyante, jamais une
# LQ inventée. Déterministe : les totaux ne dépendent que de la table.
calculer_lq_balassa_noyau <- function(table, groupe) {
  totaux_groupe <- table %>%
    dplyr::group_by(.data[[groupe]]) %>%
    dplyr::summarise(n_g = sum(n), .groups = "drop")
  totaux_activite <- table %>%
    dplyr::group_by(activity_code) %>%
    dplyr::summarise(n_a = sum(n), .groups = "drop")
  total_general <- sum(table$n)

  if (total_general <= 0) {
    stop("Analyse LQ — total général nul : aucun établissement à la référence.",
         call. = FALSE)
  }

  table %>%
    dplyr::left_join(totaux_groupe, by = groupe) %>%
    dplyr::left_join(totaux_activite, by = "activity_code") %>%
    dplyr::mutate(lq = (n / n_g) / (n_a / total_general))
}

# calculer_lq_balassa ----------------------------------------------------------
# La LQ de Balassa continue (étape 3) : par cellule commune × activité, le
# noyau commun paramétré par la commune. Les colonnes de transparence du
# contrat sont persistées : n (la cellule n_ca), n_c (le total de la commune —
# renommée depuis n_g), n_a (le total de l'activité sur la Bretagne retenue).
# Déterministe : trié par commune puis code APE.
calculer_lq_balassa <- function(retenu) {
  calculer_lq_balassa_noyau(retenu, "commune") %>%
    dplyr::rename(n_c = n_g) %>%
    dplyr::select(commune, activity_code, activity_label, lq, n, n_c, n_a) %>%
    dplyr::arrange(commune, activity_code)
}

# calculer_histoires_lq --------------------------------------------------------
# L'Histoire « ce que la commune abrite » (étape 4) : les top-N
# spécialisations par LQ, valeurs CONTINUES uniquement. Une colonne lq
# binaire (toutes valeurs dans {0, 1}) est REFUSÉE — l'Histoire ne se
# seuille jamais (gate C), la matrice M n'est pas un Story driver. La
# sélection est déterministe (ADR-0002) : tri par lq décroissante puis code
# APE croissant (l'ex æquo déterministe — même entrée, même Histoire, pour
# toujours). Une commune avec moins de top_n activités reçoit toutes ses
# activités (le rang suit le nombre d'activités, jamais de padding). Issue
# #131 : `n` (la cellule n_ca, colonne de transparence de calculer_lq_balassa)
# est CONSERVÉ par l'Histoire — l'app reçoit le nombre derrière la LQ.
calculer_histoires_lq <- function(lq, top_n = TOP_N_SPECIALISATIONS_LQ) {
  if (!"lq" %in% names(lq)) {
    stop("Analyse LQ — l'Histoire exige une colonne lq.", call. = FALSE)
  }
  if (any(is.na(lq$lq))) {
    stop("Analyse LQ — lq manquant : la LQ doit être calculée avant l'Histoire.",
         call. = FALSE)
  }
  if (all(lq$lq %in% c(0, 1))) {
    stop("Analyse LQ — l'Histoire exige une LQ continue : l'entrée est binaire ",
         "(la matrice M ne pilote jamais l'Histoire, gate C).", call. = FALSE)
  }

  lq %>%
    dplyr::group_by(commune) %>%
    dplyr::arrange(dplyr::desc(lq), activity_code, .by_group = TRUE) %>%
    dplyr::slice_head(n = top_n) %>%
    dplyr::mutate(rang = dplyr::row_number()) %>%
    dplyr::ungroup() %>%
    dplyr::select(commune, rang, activity_code, activity_label, lq, n) %>%
    dplyr::arrange(commune, rang)
}

# calculer_lq_par_niveau -------------------------------------------------------
# La LQ de Balassa à RÉFÉRENCE MÊME-ÉCHELLE (issue #131, décision 2026-08-06) :
# la même formule que calculer_lq_balassa (le noyau commun), mais paramétrée
# par le niveau d'agrégat — les totaux de référence (n_.a par activité, n_..
# général) se calculent sur le TOTAL du niveau, jamais sur les communes. Un
# EPCI se compare donc aux AUTRES EPCIs, un département aux AUTRES départements
# (le découpage régional SIRENE interdit une référence France entière — gate
# E ; la référence même-échelle est la lecture décidée 2026-08-06).
# `groupe` nomme la colonne du territoire dans la table (ex. « EPCI ») ; la
# table doit porter les colonnes <groupe>, activity_code, activity_label et n
# (n = les établissements actifs agrégés au niveau). Déterministe : trié par
# niveau puis code APE.
calculer_lq_par_niveau <- function(table, groupe) {
  manquantes <- setdiff(c(groupe, "activity_code", "n"), names(table))
  if (length(manquantes) > 0) {
    stop("LQ par niveau — la table doit porter les colonnes ",
         paste(c(groupe, "activity_code", "n"), collapse = ", "),
         " (manquantes : ", paste(manquantes, collapse = ", "), ").",
         call. = FALSE)
  }

  calculer_lq_balassa_noyau(table, groupe) %>%
    dplyr::select(dplyr::all_of(c(groupe, "activity_code", "activity_label",
                                  "lq", "n"))) %>%
    dplyr::arrange(.data[[groupe]], activity_code)
}

# calculer_presence_bretagne ---------------------------------------------------
# La lecture régionale « Ce que la Bretagne abrite » (issue #131, décision
# 2026-08-06) : le top-N des types d'établissements les PLUS PRÉSENTS du parc
# breton retenu (par nombre d'établissements actifs n), avec leur part du
# parc (n / total). La LQ de la région est dégénérée (le territoire EST la
# référence : toutes les LQ ≡ 1) — la région n'a donc pas de Story de
# spécialisation ; elle reçoit une lecture de STRUCTURE, portée par la même
# machinerie d'Histoire. Sélection déterministe (ADR-0002) : tri par n
# décroissant puis code APE croissant (l'ex æquo déterministe). Un parc avec
# moins de top_n activités reçoit toutes ses activités (jamais de padding).
calculer_presence_bretagne <- function(lq, top_n = TOP_N_PRESENCE_REGION) {
  if (!"n" %in% names(lq)) {
    stop("Analyse LQ — la présence régionale exige une colonne n.", call. = FALSE)
  }
  total_bretagne <- sum(lq$n)
  if (total_bretagne <= 0) {
    stop("Analyse LQ — parc breton nul : aucune présence régionale calculable.",
         call. = FALSE)
  }

  lq %>%
    dplyr::group_by(activity_code) %>%
    dplyr::summarise(
      activity_label = premier_libelle(activity_label),
      n = sum(n),
      .groups = "drop"
    ) %>%
    dplyr::mutate(part_parc = n / total_bretagne) %>%
    dplyr::arrange(dplyr::desc(n), activity_code) %>%
    dplyr::slice_head(n = top_n) %>%
    dplyr::mutate(rang = dplyr::row_number()) %>%
    dplyr::transmute(
      territoire = "53", type = "region",
      story_key = "ce-que-la-bretagne-abrite",
      rang, activity_code, activity_label,
      lq = NA_real_, n, part_parc
    ) %>%
    dplyr::arrange(rang)
}

# calculer_matrice_m -----------------------------------------------------------
# Le sidecar M (étape 5) : la matrice d'incidence binaire commune × activité,
# m = 1 si LQ ≥ 1, 0 sinon (le seuil 1.0 appartient à la spécialisation —
# LQ ≥ 1, jamais LQ > 1). Artefact SÉPARÉ : le CROISEMENT COMPLET commune ×
# activité (l'univers des activités de la Bretagne retenue) — une ligne par
# cellule de la matrice, les zéros explicites compris — exactement la forme
# que docs/research/relatedness.md §7 attend (M : regions × industries, 0/1,
# LQ ≥ 1 ; colSums(M) = ubiquité). L'Histoire n'y touche jamais. Déterministe :
# trié par commune puis code APE.
calculer_matrice_m <- function(lq) {
  croise <- tidyr::crossing(
    commune = sort(unique(lq$commune)),
    activity_code = sort(unique(lq$activity_code))
  )

  croise %>%
    dplyr::left_join(
      lq[c("commune", "activity_code", "lq")],
      by = c("commune", "activity_code")
    ) %>%
    dplyr::mutate(m = as.integer(!is.na(lq) & lq >= 1)) %>%
    dplyr::select(commune, activity_code, m) %>%
    dplyr::arrange(commune, activity_code)
}

# construire_analytique_lq_economie --------------------------------------------
# L'acte « calculer » du chaînon : le snapshot normalisé (lignes
# commune × APE × tranche) vers les cinq artefacts analytiques, persistés
# sous la localisation Économie/Emploi des données processées (défaut :
# data/processed/economie/). Retourne la liste {lq, histoires, m, suppression,
# exclusions} — la forme de test. Le paramètre `snapshot` permet aux tests de
# passer la fixture directement (le même chemin de code que la vraie table) ;
# le paramètre `correspondance` (issue #427 — la même philosophie que l'artefact
# EGSS injecté dans T3) permet aux tests de passer une copie corrompue, et
# DÉFAUT à l'artefact épinglé réel : les appelants existants ne changent pas.
# L'ordre du chaînon est celui de la bascule A17 : agrégation APET → mapping
# A17 (+ rapport d'exclusion) → plancher → Balassa → histoires → M. Idempotent
# (les écritures écrasent) et déterministe (les tibbles retournés relisent
# l'identique des fichiers persistés).
construire_analytique_lq_economie <- function(snapshot,
                                              sortie = "data/processed/economie",
                                              correspondance = artefact_naf_a17()) {
  agrege <- agreger_sirene_par_activite(snapshot)
  a17 <- mapper_activites_a17(agrege, correspondance)
  plancher <- appliquer_plancher_communes(a17$mappe)
  lq <- calculer_lq_balassa(plancher$retenu)
  histoires <- calculer_histoires_lq(lq)
  m <- calculer_matrice_m(lq)

  if (!dir.exists(sortie)) dir.create(sortie, recursive = TRUE)
  readr::write_rds(lq, file.path(sortie, "lq_economie.rds"))
  readr::write_rds(histoires, file.path(sortie, "histoires_lq_economie.rds"))
  readr::write_rds(m, file.path(sortie, "m_economie.rds"))
  readr::write_rds(plancher$suppression,
                   file.path(sortie, "suppression_lq_economie.rds"))
  readr::write_rds(a17$exclusions,
                   file.path(sortie, "exclusions_lq_economie.rds"))

  list(lq = lq, histoires = histoires, m = m,
       suppression = plancher$suppression,
       exclusions = a17$exclusions)
}
