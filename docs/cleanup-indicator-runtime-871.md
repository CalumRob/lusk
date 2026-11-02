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

**Règle d'autorité du magasin chaud (revue de #876)** : les métadonnées de
thème déjà chargées dans le magasin partagé (une visite Sources réelle y
charge chaque `theme_<theme>.json`) peuvent **enrichir une page admise, jamais
autoriser une route**. La sélection de présentation (`page` →
`familyDispatch` → `model`) est barrée par `routeAdmise` — le succès de la
classification producteur (profil, scalaire ordinaire, série ordonnée,
collection clairsemée, raccordement). Une URL retirée dont le descripteur
éditorial traîne encore dans le `theme_<theme>.json` commité ne peut donc ni
rendre une page périmée ni faire vivre le pipeline de présentation.

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

### Magasin partagé chaud (trouvé en revue de #876, corrigé)

`SourcesView` pilote le **magasin partagé** de production et y charge chaque
`theme_<theme>.json` — dont le descripteur retiré `iso_alimentation` de
`theme_mobilite.json` commité. La fuite : le computed `page` lisait
`payload.themeMetadata[theme].indicator_pages[indicator]` sans égard à la
classification ; sur une visite ultérieure de
`/indicateurs/mobilite/iso_alimentation`, la page périmée redevenait vivante
— pire, la source `immediate` du watcher de comparaison de profil lisait
`familyDispatch` **pendant le setup**, avant la déclaration de `facts` :
`ReferenceError` (TDZ), composant cassé avant tout rendu. Les deux symptômes
(rendu périmé / crash) partagent la même cause : une route non classée
consommait les métadonnées chaudes.

La clôture `routeAdmise` barre `page` (donc `familyDispatch` et `model`) sur
le succès de la classification producteur — les cinq familles admises
au-dessus. Les métadonnées chaudes ne sont **pas** effacées (Sources,
provenance et pages admises en dépendent) : elles enrichissent une page
admise, n'autorisent jamais une route. Une panne de découverte avec magasin
chaud reste l'erreur relançable (`profileBootstrapError` précède l'état
inconnu dans le rendu).

## Évidence de test

`indicator-read-model-route.spec.ts` (#871) monte **sans chargeur injecté**
(chemin de production : le magasin partagé fetch `territoires.json` et les
fichiers publiés) :

1. route inconnue + manifeste périmé la revendiquant + modèle statique valide
   servi → état inconnu, zéro requête `modeles-lecture` ;
2. manifeste défaillant (HTTP 500) → état inconnu, pas d'erreur de page ;
3. route retirée par le producteur (`mobilite/iso_alimentation`) → état
   inconnu, zéro requête ;
4. panne de découverte → erreur relançable, jamais l'état inconnu, aucun
   repli après retry ;
5. le drapeau retiré `VITE_SCALAR_COHORT_API` ne change aucune sélection de
    lecteur : une route admise rend par le lecteur scalaire ordinaire, une
    route refusée par la grammaire de page n'émet aucune lecture de cohorte ;
6. **magasin chaud** — une vraie visite `SourcesView` (sans chargeur
   injecté) amorce le magasin partagé, puis la route retirée reste inconnue,
   zéro requête manifeste/modèle ;
7. **magasin chaud + panne de découverte** → erreur relançable, jamais l'état
   inconnu ni une page périmée.

Avant le retrait, les tests 1–4 échouaient (RED) : le manifeste était réellement
consulté, son échec produisait une erreur de page, et le couple
manifeste-modèle périmés rendaient une page statique complète avec faits et
rangs. Avant la clôture `routeAdmise`, les tests 6–7 échouaient (RED) : la
route retirée à magasin chaud plantait le composant (TDZ `facts` via
`familyDispatch` pendant le setup) au lieu de rendre l'état inconnu. Les
sentinelles d'injection supprimées sont remplacées par des assertions au
niveau requête (`/data/modeles-lecture/` absent de tous les appels) dans les
spécifications famille (profils, séries, scalaires).

### Limites de preuve honnêtes

- Le test 5 n'**exerce pas** comportementalement l'ancien disjonctif du
  drapeau : celui-ci était structurellement inatteignable (cf. « Drapeau »
  ci-dessus), donc aucun test ne pouvait le distinguer. Le retrait se prouve
  par la suppression du lecteur à la source ; le test épingle le contrat
  résultant pour toute valeur du drapeau, y compris sur une route admise.
  (`vi.stubEnv` met bien à jour `import.meta.env` avant le montage — une
  note antérieure de ce dossier disait le contraire, corrigée.)
- Les batteries navigateur Chromium (`verify:*`) et la suite R ne sont pas
  exécutées ici : aucun fichier R/publisher/artefact n'est touché, et les
  spécifications montées couvrent le comportement changé sur le chemin de
  production.

## Hors périmètre (parents/parallèles actifs)

- Refactor partagé du défaut de magasin de test `usePayload` : #873.
- `SourcesView`, sélecteur/sourceRecords et navigation Sources : #872 (ce
  dossier ne fait que *monter* SourcesView pour amorcer le magasin partagé —
  aucun changement de ces fichiers).
- Champs d'artefact/producteur conservés — le marqueur `read_model` du contrat
  de page (désormais purement informationnel côté navigateur : seuls les
  validateurs d'artefact le préservent), les champs
  `series_dataset_id`/`series_publication`, et les artefacts commités
  `modeles-lecture/**` : leur disposition relève de #874 (audit en lecture
  seule) puis d'une décision du propriétaire producteur — ce n'est **pas** une
  permission pour #873 de changer R.
- Aucune régénération R/schema/API/publisher, aucune opération live ; les
  artefacts commités ne sont ni supprimés ni régénérés.
