# ADR-0031 : Publier un modèle de lecture par territoire et par indicateur

- **Statut :** accepté
- **Date :** 2026-09-15

## Contexte

Lusk publie aujourd'hui ses faits sous forme de grandes tables JSON qui
reproduisent les frontières internes de la pipeline : une paire par thème,
complétée pour Mobilité par des tables auxiliaires de profils et de
distributions. Le navigateur lance le chargement de tous ces fichiers, puis les
parse, les valide et les réunit dans un état réactif global. Les wait-sets par
route retardent le rendu, mais ne rendent pas le chargement sélectif.

Cette organisation était adaptée lorsque le payload complet était estimé à
quelques mégaoctets (ADR-0003 et ADR-0004). Cette hypothèse ne tient plus : le
seul fichier `indicateurs_mobilite.json` dépasse 52 Mo non compressés, et ses
tables auxiliaires ajoutent des dizaines de mégaoctets. La compression réduit
fortement le transfert, mais pas le coût de décompression, de parsing, de
validation, de copie ni la mémoire du navigateur.

Une fiche doit apparaître avec un contenu complet et stable. Ses sections ne
doivent pas s'ajouter progressivement à mesure que des tables auxiliaires
arrivent. Les Pages d'indicateur ont un autre besoin : elles suivent un
indicateur à travers les territoires et n'ont pas à charger les autres faits du
thème.

## Décision

La pipeline publie deux familles de **modèles de lecture** statiques :

- un artefact complet par **Territoire**, réunissant les faits nécessaires pour
  résoudre le `ThemeContent` de chacun de ses thèmes ;
- un artefact complet par **Indicateur**, réunissant les faits nécessaires à sa
  Page d'indicateur pour tous ses niveaux et détails publiés.

Le navigateur charge à la demande le modèle correspondant à la surface visitée.
Une fiche valide d'abord l'artefact du territoire, résout son `ThemeContent`,
puis affiche le contenu atomiquement. Elle ne révèle pas des sections au fil de
chargements indépendants. Une Page d'indicateur charge son propre artefact sans
charger le thème entier.

Les tables Parquet restent les artefacts canoniques et téléchargeables. Les
modèles de lecture JSON sont des projections générées depuis les mêmes sorties
de pipeline ; leur duplication est intentionnelle. Des tests de contrat doivent
prouver leur cohérence avec le canon et leur complétude pour chaque surface.

Les frontières utiles à la pipeline ne deviennent plus automatiquement des
frontières de chargement du navigateur. Les profils BPE, distributions de
bâtiments, rampes d'accès et futures formes d'évidence peuvent rester des tables
analytiques séparées en amont, mais leurs lignes utiles sont intégrées au modèle
du territoire ou de l'indicateur qui les consomme.

R, SQL ou DuckDB peuvent servir à matérialiser ces projections au build. Aucun
de ces outils ne devient une dépendance du navigateur. Cette décision
n'introduit ni API, ni base de données à l'exécution, ni HTML pré-rendu. Le
renderer reste découplé des tables analytiques derrière le seam sémantique
`ThemeContent`.

## Conséquences

- Le chargement devient piloté par la surface visitée plutôt que par la liste
  des tables produites par la pipeline.
- Une navigation entre les thèmes d'un territoire est immédiate après le
  chargement de son unique artefact.
- Un même fait peut être publié dans un modèle de territoire et un modèle
  d'indicateur. Cette duplication de lecture est acceptée ; la logique métier et
  la propriété du fait ne sont jamais dupliquées.
- Le nombre de fichiers générés et le churn des rafraîchissements augmentent,
  mais restent bornés par le nombre de territoires et d'indicateurs, plutôt que
  par leur produit avec les thèmes.
- Les petits index partagés — recherche des territoires, catalogue des
  indicateurs, sources et fraîcheur — restent des artefacts distincts lorsqu'une
  route en a besoin sans ouvrir une fiche ou une Page d'indicateur.
- Le nommage, la politique de cache, la compression et la stratégie de migration
  doivent être validés par #532, sans rouvrir la forme générale décidée ici.

Cette décision conserve le principe static-first de l'ADR-0003 et le canon
Parquet de l'ADR-0004, mais remplace leur projection JSON par grandes tables côté
navigateur.
