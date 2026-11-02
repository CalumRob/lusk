# Disposition des lecteurs de la Page d'indicateur — #871

Date : 2026-11-02 · Branche : `issue/871-browser-model-cleanup-20261102` ·
Base : `4a40156d` (#870 fusionné). Parent actif : #619 ; parents liés : #827,
#627. Ce document enregistre la traçabilité de dernier appelleur et la
disposition de chaque lecteur numérique du runtime navigateur de la Page
d'indicateur (`/indicateurs/:theme/:indicator`), pour la revue Standards/Spec
avant fusion.

## Décision

Après #871, chaque route d'indicateur classifie **uniquement** par la
découverte producteur `GET /api/resources`. Aucune route ne consulte le
manifeste des modèles de lecture (`/data/modeles-lecture/manifest.json`) ni
ne charge un modèle par indicateur : les URL inconnues ou retirées par le
producteur rendent l'état « Indicateur introuvable. » existant, avec **zéro
requête** `modeles-lecture`, y compris si ces fichiers existeraient, seraient
défaillants ou porteraient une route périmée. Une panne de découverte reste une
erreur de page relançable — jamais un état inconnu, jamais un repli statique.

## Preuves de dernier appelleur

### Manifeste et modèle par indicateur (retirés du navigateur)

`chargerManifesteModelesLecture`, `chargerModeleIndicateur`, les clés
d'injection `INDICATOR_READ_MODEL_*_CHARGER_KEY` et la projection
`payloadDepuisModeleIndicateur` n'avaient qu'un consommateur de production :
`IndicateurPage.vue`. La trace :

- `resolveProfileRoute` consultait le manifeste uniquement pour les routes
  NON classifiées (inconnues ou retirées) — les deux entrées commitées
  (`demographie/densite`, `mobilite/bornes_ev_par_station_service`) sont des
  pages scalaires API déjà classifiées avant. La requête résiduelle était donc
  une dépendance d'échec réelle pour chaque URL inconnue : un manifeste en
  panne (HTTP 500) transformait l'état inconnu en erreur de page, et un
  manifeste périmé + un modèle statique valide **rendaient une page numérique
  complète depuis des faits statiques** (prouvé RED avant retrait, cf.
  « Évidence de test »).
- Le chargeur de modèle n'était atteint que depuis cette consultation.

Retenu : `validerManifesteModelesLecture` et `validerModeleIndicateur` restent
les **validateurs de schéma des artefacts** commités (manifeste + modèles) ;
`indicator-read-model.spec.ts` les exerce désormais contre les fichiers
publiés réels. Les artefacts eux-mêmes (`public/data/modeles-lecture/**`) ne
sont PAS supprimés : ils restent des actifs producteur de
publication/recovery, servis par l'hôte statique (`vercel.json` inchangé).

### Drapeau `VITE_SCALAR_COHORT_API` (retiré)

`scalarCohortEnabled` ne restait lu que par `IndicateurPage.vue`
(`scalaireApiAuMontage`, `scalaireApiOptionnelle`) ; la fiche a arrêté de le
lire en #868, la carte en #627. La traçabilité prouve en plus que la
sélection de second runtime était **structurellement inatteignable** :

- `metadataScalaireApi` n'est assigné qu'avec `pageScalaireApiActive` (branche
  scalaire ordinaire réussie) ;
- `IndicateurView` remonte `IndicateurPage` par `:key` de route, donc chaque
  changement de route repart d'un état vierge ;
- le second disjoncteur de `scalaireApi`
  (`scalaireApiOptionnelle && indicateursScalairesCourants.includes(...)`)
  exigeait donc `metadataScalaireApi` déjà posé avec
  `pageScalaireApiActive` vrai — le premier disjoncteur était alors déjà vrai.

Le lecteur `chargerCohorteScalaire` (l'ancien lecteur de cohorte réservé)
n'avait plus d'appel de production atteignable ; il **reste dans
`scalarCohort.ts`** avec les autres aides natives
(`chargerCohortesScalaires*`, `chargerRangScalaire`,
`chargerComparaisonsScalaires`, `remplacerFaitsScalaires`), exercés par leurs
spécifications — les aides natives ne meurent pas avec leur ancienne porte
(directive #871). `chargerRangScalaire` garde son consommateur carte vivant.

### Stubs owned-series (retirés)

`OrderedSeriesAdapter.datasetId`/`publicationMode` (extraits de
`series_dataset_id`/`series_publication`) n'étaient lus nulle part ;
`mergeOrderedSeriesFacts` n'avait plus de consommateur hors sa propre
spécification. Les champs de contrat `series_dataset_id`/`series_publication`
restent validés par `validate.ts` (miroir R) et leurs tests de contrat sont
intacts : le producteur les publie toujours ; seule la liaison morte du
navigateur disparaît.

## Familles conservées et leurs propriétaires

| Famille | Lecteur numérique | Présentation / métadonnées |
|---|---|---|
| Scalaire ordinaire (15 pages) | `chargerCohortePageScalaire` + `chargerFaitFocalPageScalaire` + comparaison publiée | `theme_<theme>.json` (enveloppe éditoriale) |
| Profil déclaré (10 pages) | `profileAcquisition` (`chargerCohorteProfilDeclare`, focal, scalaire liée) | page liée au descripteur API |
| Série ordonnée (4 pages partagées) | `seriesSemanticAcquisition` (lot sémantique borné, `axis_comparisons`, `scalar_facet` pour `prix_m2`) | `theme_<theme>.json` |
| `raccordement_courbe` | acquisition thème Mobilité + projection `raccordementSemanticProjection` (référence nommée indépendante) | catalogue `theme_mobilite` |
| Collection clairsemée (`subventions_par_domaine`) | `sparseCollectionPage` | `theme_programmes.json` |

Comportements intacts : retry comparaison-seule, incompatibilité de
publication (échec fermé), no-record vs absent vs zéro, horloges
source/unité/axes propriétaires, clôtures de réponses périmées,
déduplication de requêtes, AEDAR, pages Mobilité retenues, dénominateur B316,
référence nommée, géométrie, référence territoriale compacte.

## Évidence de test

`indicator-read-model-route.spec.ts` (#871) monte **sans chargeur injecté**
(chemin de production : le magasin partagé fetch `territoires.json`) :

1. route inconnue + manifeste périmé la revendiquant + modèle statique valide
   servi → état inconnu, zéro requête `modeles-lecture` ;
2. manifeste défaillant (HTTP 500) → état inconnu, pas d'erreur de page ;
3. route retirée par le producteur (`mobilite/iso_alimentation`) → état
   inconnu, zéro requête ;
4. panne de découverte → erreur relançable, jamais l'état inconnu, aucun
   repli après retry ;
5. `VITE_SCALAR_COHORT_API='1'` ne sélectionne aucun second runtime pour une
   route dont la grammaire de page refuse la classification scalaire.

Avant le retrait, les tests 1–4 échouaient (RED) : le manifeste était réellement
consulté, son échec produisait une erreur de page, et le couple
manifeste-modèle périmés rendaient une page statique complète avec faits et
rangs. Les sentinelles d'injection supprimées sont remplacées par des
assertions au niveau requête (`/data/modeles-lecture/` absent de tous les
appels) dans les spécifications famille (profils, séries, scalaires).

## Hors périmètre (parents/parallèles actifs)

- Refactor partagé du défaut de magasin de test `usePayload` : #873.
- `SourcesView`, sélecteur/sourceRecords et navigation Sources : #872.
- Aucune régénération R/schema/API/publisher, aucune opération live ; les
  artefacts commités ne sont ni supprimés ni régénérés.
