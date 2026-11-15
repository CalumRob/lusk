# PRD — Export PDF d’une section du Cahier

## Statut et portée

Décisions issues du prototype `prototype/cahier-pdf`, validées avec le propriétaire
le 15 novembre 2026. Ce document formalise un futur export produit ; il ne déclare
pas le prototype prêt à fusionner ou à déployer. Aucune implémentation produit,
publication de données, opération sur le Pi ou livraison n’est autorisée par la
seule création de cette spécification.

**Validé :** la présentation sur une feuille, les tableaux de valeurs, la limite
fonctionnelle de trois modes sélectionnables par PDF, les noms de territoire
compacts dans les tableaux et les règles de sources ci-dessous.

**Non validé :** l’emplacement et la présentation des commandes d’export, ainsi que
l’interface de choix des modes. La modale du prototype est un instrument de test,
pas une maquette produit approuvée. Ces choix appartiennent à l’implémentation UI
et doivent être revus avec le propriétaire avant intégration.

## Problème et résultat attendu

Un lecteur veut emporter ou partager une section du Cahier avec son territoire,
ses figures, ses valeurs et ses sources, sans capture d’écran ni perte de la
lecture disponible sur le site. Le PDF doit rester identifiable, fidèle à l’état
sélectionné et exploitable sans survoler des infobulles.

L’unité d’export est **une section**, pas une fiche entière, un chapitre complet
ou tous les équipements. Le premier périmètre prouvé est constitué des cinq
sections Mobilité testées : offre accessible en voiture, perte de diversité sans
voiture, rampes d’accès, profil d’équipements/waffle et bac à sable. Un nouvel
indicateur ou thème ne doit pas être déclaré compatible sans preuve de sa famille
de figures et de son contrat ; ne jamais omettre silencieusement une figure non
prise en charge.

## Parcours

1. Le lecteur demande l’export de la section qu’il consulte.
2. L’export respecte le territoire, la comparaison effectivement affichée,
   l’équipement, l’horizon et les modes retenus pour ce PDF.
3. S’il y a plus de trois modes sélectionnables actifs, le produit doit obtenir
   explicitement un choix de un à trois modes pour le PDF. Aucun mode n’est retiré
   silencieusement ; annuler ne produit aucun fichier. La sélection à l’écran
   n’est pas modifiée durablement ni visiblement pendant l’export.
4. Le navigateur génère le fichier. Aucun service Chromium/headless sur le Pi.

La limite concerne les séries sélectionnables des figures et tableaux concernés,
pas la suppression de panneaux de cartes fixes ou de catégories d’un waffle.
Le bac à sable exporte l’équipement courant, pas l’univers des 235 TYPEQU.

## Contrat de présentation

### Page et identité

- A4 portrait, texte sélectionnable ; figures vectorielles lorsqu’elles le sont
  sur le site. Les fonds/cartes raster existants peuvent rester des images.
- Réutiliser la composition, les proportions, les rôles typographiques, couleurs,
  légendes et styles du Cahier desktop. Ne pas reconstruire une seconde fiche
  factuelle dans un template PDF figé.
- En-tête : marque/hermine Lusk liée à l’accueil, titre de page centré, territoire
  et icône de lien externe vers la page/section vivante ; filet rouge du Cahier.
- Dans la section : territoire en premier, visible et centré, titre de section
  plus discret comme contexte. Le nom complet reste dans l’identité de page et
  le titre/métadonnées du PDF, même lorsque le tableau l’abrège.
- Centrer verticalement le contenu dans l’espace utile de chaque page et
  conserver une numérotation claire ainsi que le lien de retour vers le site.

### Une feuille par défaut, continuation seulement si nécessaire

- **La variante sur une seule feuille est préférée.** Ne pas réserver
  systématiquement une deuxième page aux tableaux.
- Si le contenu ne tient pas à l’échelle de lecture retenue, poursuivre sur une
  page supplémentaire plutôt que réduire globalement tout l’export. Garder les
  figures/blocs cohérents ensemble et répéter l’identité utile sur la continuation.
- Le débordement d’un tableau peut être résolu par des groupes de modes moins
  larges et/ou des blocs de tableau sur la continuation ; conserver toutes les
  valeurs, les en-têtes et les liens entre modes, temps/statistiques et colonnes.
- Ne pas couper arbitrairement une figure ou une ligne de tableau entre pages.
- Le waffle artificiellement répété six fois est un test de limite, **pas une
  section réelle problématique ni une priorité de conception**. Ne pas organiser
  le produit autour de ce cas synthétique.

### Valeurs et contrôles

- Pas d’infobulles interactives dans cette première version ; leurs valeurs
  deviennent des tableaux sélectionnables sur la page.
- Titre : « Valeurs du graphique » ou « Valeurs des graphiques » selon le nombre
  de graphiques exportés.
- Réutiliser les mêmes modèles purs de valeurs/formatage que les infobulles du
  site, y compris la référence et le rang lorsqu’ils sont réellement affichés.
- Dans le bac à sable, conserver les coupures temporelles et les statistiques
  déclarées (dont minimum, déciles et maximum), sans interpolation ni reconstruction
  d’une politique ou d’un ordre factuel dans le renderer.
- Séparateurs **verticaux entre groupes de modes** ; filets horizontaux légers.
- Nom de territoire dans un en-tête compact : retour naturel à la ligne, deux
  lignes maximum, puis ellipse selon la largeur réellement disponible — pas un
  nombre fixe de caractères. Ne raccourcir que la présentation de ce tableau.
- « Indisponible » peut devenir « Indisp. » si la cellule est trop étroite ; dans
  ce cas l’expliquer une fois sous les tableaux. Ne jamais tronquer ou abréger un
  nombre, transformer l’inconnu en zéro ou inventer un rang.
- Inclure les contrôles/états actifs qui expliquent la lecture ; omettre les
  choix inactifs et les affordances purement interactives.
- Omettre la prose explicative, conserver les titres de figures, axes, unités,
  légendes et précautions factuelles nécessaires à une lecture honnête.

### Sources et comparaison

- Déplacer les sources existantes en **bas à droite de la section**, précédées
  de **« Source(s) : »**. Conserver leur texte, les versions, attributions et
  liens existants ; ne pas fabriquer un nouveau registre de sources pour le PDF.
- Répéter les sources utiles sur les continuations. Elles appartiennent à la
  section, pas au pied de page global ni au-dessus des figures.
- Le contexte de comparaison en pied de page est présent uniquement si la page
  montre effectivement de la preuve comparative. Les cartes/waffles autonomes
  sans comparaison ne reçoivent pas ce contexte.
- Les libellés compacts « Groupe¹ » peuvent renvoyer à ce contexte explicite.
  Pas de colonnes, de rangs ou de mentions comparatives résiduels si la comparaison
  est masquée ou réellement indisponible.

## Frontières techniques et propriété des faits

- Génération dans le navigateur. Le prototype `jsPDF` + `svg2pdf` fondé sur la
  géométrie DOM rendue est la preuve de faisabilité retenue, pas l’obligation de
  conserver son introspection privée Vue en production.
- Les sources producteur/API restent propriétaires des valeurs, unités, axes,
  éligibilité, références, rangs, statut et provenance. Pas de faits Rennes/EPCI,
  TYPEQU, univers ou règles de calcul recopiés dans le PDF.
- Le contenu éditorial stable et la présentation d’export appartiennent à l’app ;
  aucun changement R/publication n’est requis pour une simple décision de mise en
  page. Aucun nouveau service, framework de métadonnées, version globale ou second
  runtime numérique navigateur.
- Extraire une frontière explicite de capture d’export : état résolu cohérent,
  modèles de tableaux partagés, composition/pagination et sérialisation du fichier.
  La forme exacte des modules reste un choix d’implémentation ; ne pas promouvoir
  le renderer DOM expérimental en moteur HTML-vers-PDF généraliste.
- Les modules `aedarTimeRampTooltip.ts` et `groupedBarTooltip.ts` montrent le partage
  de formatage écran/PDF. Garder les tests de comportement des composants existants.

## Acceptation et validation à conserver

- [ ] Exporter chacune des cinq sections pilotes avec des données réelles et les
  identités/sources/liens corrects, sans texte aplati en image.
- [ ] La présentation courte reste sur une feuille ; une continuation n’apparaît
  qu’en cas de débordement et ne provoque ni données perdues ni réduction globale
  illisible. La pagination des tableaux doit être implémentée réellement, pas
  déduite du seul succès de l’option manuelle du prototype.
- [ ] Vérifier séparément un et trois modes, comparaison visible/masquée,
  équipement et horizon modifiés, noms longs, valeurs larges, zéro et manque de
  données. Les cellules restent dans le bon groupe/temps/statistique/colonne.
- [ ] Vérifier numériquement le PDF extrait contre les modèles de valeurs
  partagés ; des assertions de non-chevauchement complètent une revue visuelle.
- [ ] Les sources sont en bas à droite, avec le préfixe approuvé, sans perte de
  provenance ni de liens. Le pied de comparaison est conditionnel par page.
- [ ] L’interface produit d’export et de choix des modes est revue avec le
  propriétaire ; le comportement limite à trois, sans suppression silencieuse,
  est testé. La modale expérimentale ne vaut pas validation de cette interface.
- [ ] Annulation, répétition, erreurs de génération et capture de sélection ne
  laissent ni changement de sélection, ni état visuel transitoire, ni clone/orphelin.
- [ ] Tests des composants, typecheck, vérification des figures, contrôle de design
  et revue Standards/Spec avant intégration ; rapporter le baseline de design
  existant sans le qualifier de scan global propre.

Frontières de validation éprouvées : modèles de valeurs partagés → cellules du
PDF ; état rendu résolu → figures/identité/sources ; génération → document A4,
liens, pagination et intégrité de l’écran. Ne pas tester les détails privés Vue
comme un contrat produit. Les mocks/synthèses doivent être explicitement marqués
et ne remplacent pas la validation de plusieurs sections réelles.

## Preuves et limites du prototype

- Campagne v1 : 24 exports, 21 réussites d’audit et trois échecs synthétiques du
  bac à sable (nombres larges, « Indisponible », noms longs en en-tête de tableau).
  Le chapitre complet de quatre pages est une preuve de pagination, **pas** un
  engagement produit d’export du chapitre ni une preuve avec tous ses tableaux.
- Campagne v2 : 25 exports, états DOM et sélection échantillonnée à chaque frame
  conservés ; annulation sans téléchargement et refus explicite de quatre modes
  vérifiés. Le vérificateur autonome confirme 135 cellules valeur/référence/rang
  pour un bac à sable à trois modes sur une feuille. L’audit indépendant v2 a
  ensuite été relancé par l’orchestrateur : **25 réussites, zéro échec**, une seule
  observation pour la réduction du waffle synthétique. Les trois cas de
  débordement de tableaux de v1 passent désormais. « Indisp. » n’est pas exercé
  dans cette campagne : le mot complet tient dans les colonnes à trois modes.
- La dernière variation de sources a été régénérée et vérifiée sur le bac à sable
  (135 cellules, une feuille A4, sans réduction supplémentaire). Cela ne remplace
  pas une nouvelle campagne de toutes les sections sur cette variation.
- La continuation de tableaux existe comme option manuelle expérimentale avec
  répétition d’identité. La détection et le traitement automatiques du débordement
  sont encore du travail produit, non une capacité validée du prototype.
- Les noms/classes privés du runtime de développement Vue, les mutations de
  fixtures résolues et les scripts Python/Playwright sont des outils de preuve,
  non des dépendances de l’interface produit ou de son serveur.
- Les artefacts locaux se trouvent dans `E:/Temp/opencode/cahier-pdf-stress/`,
  `cahier-pdf-stress-v2/` et `cahier-sandbox-pdf/`. La branche et ses scripts sont
  la source durable reproductible ; ces chemins locaux ne sont pas des pièces
  jointes publiques accessibles depuis GitHub.

Commandes depuis `app/` : `npm run prototype:sandbox-pdf`,
`python scripts/verify-prototype-sandbox-pdf.py`,
`npm run prototype:stress-pdf`,
`python scripts/audit-prototype-pdf-stress.py E:/Temp/opencode/cahier-pdf-stress-v2/cases.json`.

## Hors périmètre

- Infobulles PDF, export de tous les équipements, export automatique de tous les
  thèmes/chapitres, changements de faits ou d’acquisition, nouvelles publications
  R/DB/API, service headless sur le Pi, déploiement et fusion du prototype en main.
- La mise en page de la modale expérimentale, une deuxième page systématique et
  l’optimisation autour du waffle répété six fois ne sont pas des décisions produit.
