# PROTOTYPE #499/#511 — Architectures de lecture et identité Cahier (jetable)

**Statut : prototype jetable de DÉCISION — ne jamais fusionner.** Le gagnant,
s'il existe, devra être réécrit sous TDD sur une branche propre (aucun de ce
code n'est prêt pour la production : pas de tests, pas d'accessibilité
complète, duplications locales assumées).

## La question

> Quelle structure de fiche rend **la propriété des sous-groupes, les
> lectures, les nombres importants, les passarelles Explorer et la
> provenance** lisibles **sans** la grille de cartes rigide et le blanc
> excessif de la coquille actuelle ?

Construite sur les quatre audits : #445/PR#455 (frontières de sous-groupe,
grille rigide), #448/PR#451 (lectures trop petites, hiérarchie des nombres
absente, unités mal placées), #449/PR#452 (prose et provenance), #480/PR#491
(densité des sources — 30–33 % du corps Mobilité, estampille snapshot
répétée ×7, verdict « hybride : compact près de la preuve + consolidé en
bas »).

## Lancer

```powershell
cd app
npm ci
npm run dev -- --port 5173 --strictPort
```

Puis toute URL de fiche avec `?variant=A|B|C|D` (le commutateur fixe du bas
n'existe qu'en développement — vérifié absent du bundle de production).

## URLs de revue directe

Représentants : **Rennes** (commune, 35238) et **Lorient Agglomération**
(EPCI, 200042174), payload réel committé.

| Variante | Territoire · thème | URL |
|---|---|---|
| A · Journal | Rennes · Mobilité | `/territoire/commune/35238?theme=mobilite&variant=A` |
| A · Journal | Lorient Agglo · Démographie (mobile) | `/territoire/epci/200042174?theme=demographie&variant=A` |
| B · Cahier | Lorient Agglo · Mobilité | `/territoire/epci/200042174?theme=mobilite&variant=B` |
| B · Cahier | Rennes · Économie/Emploi (mobile) | `/territoire/commune/35238?theme=economie&variant=B` |
| C · Fil | Rennes · Mobilité | `/territoire/commune/35238?theme=mobilite&variant=C` |
| C · Fil | Lorient Agglo · Démographie (mobile) | `/territoire/epci/200042174?theme=demographie&variant=C` |
| D · Cahier libre | Lorient Agglo · Mobilité | `/territoire/epci/200042174?theme=mobilite&variant=D` |
| D · Cahier libre | Rennes · Économie/Emploi (mobile) | `/territoire/commune/35238?theme=economie&variant=D` |
| Référence | design actuel (sans `variant`) | `/territoire/commune/35238?theme=mobilite` |

Le commutateur : clic sur A/B/C/D **ou** flèches ← / → (boucle ; jamais
interceptées dans un champ éditable) ; `?theme=` et les autres paramètres
sont conservés ; rechargement/partage stables.

## Les quatre variantes

### A — « Le journal » (`VarianteJournal.vue`)

**Rejette frontalement l'anatomie en grille de cartes** : zéro boîte.
Chaque sous-groupe est une section de rapport numérotée, séparée par un
filet. La lecture porte la voix récit à taille display, suivie de son nombre
en héros (~56 px) et d'une figure élargie (~300 px). Les indicateurs
deviennent un **registre typographique** (pointillés de conduite, rang en
puce après la valeur, chaque détail avec SON rang). Provenance : appels de
note superscript près de chaque nombre + registre complet consolidé une fois
en bas de thème.

### B — « Le cahier » (`VarianteCahier.vue`)

La **propriété du sous-groupe** est l'idée structurante : une double-page
pleine largeur (bordure de thème, lavis alterné) avec un **rail latéral
collant** (numéro, titre, cadrage, lecture en récit, Explorer empilé) et un
tapis de **tuiles inégales** — lecture pleine largeur ~320 px, multi-détails
en dalles, scalaires en tiers. Présentation **rang-d'abord** : chaque tuile
scalaire ouvre sur son classement avant sa valeur. Provenance :
micro-estampille dans chaque pied de tuile + ligne « Preuves de la section »
dédupliquée + registre complet une fois.

### C — « Le fil » (`VarianteFil.vue`)

La structure est **navigationnelle** : un sommaire collant de puces-ancre
donne au sous-groupe une propriété par saut. Chaque sous-groupe devient un
moment prioritaire : LE nombre en très grand (~72 px), la phrase récit, la
figure élargie (~360 px), puis un **bandeau horizontal de chiffres** (densité
anti-carte : rangs en tête, unités attachées, filets verticaux, défilement
latéral mobile). Provenance presque entièrement consolidée : `<details>`
« Preuves & détails » par moment, registre exhaustif une fois en bas.

### D — « Le Cahier libre » (`VarianteCahierLibre.vue`)

Une itération #511 reconstruite indépendamment de la coquille visuelle actuelle.
La tranche actuelle ne rend volontairement que le premier sous-groupe Mobilité,
afin de tester l'architecture des figures avant de la généraliser. Chaque
composition alterne la position de l'argument et de la preuve.
Chaque sous-groupe est une **page de cahier distincte**, avec son propre papier,
sa ligne de marge rouge, son réglage horizontal inspiré du Seyès, son titre,
sa lecture, ses preuves et son pied de page. Un sommaire collant joue le rôle
de tranche du cahier sur desktop et devient un menu repliable sur mobile.

La direction reprend le vocabulaire du cahier français comme une grammaire
visuelle — alignement, réglure, marge, annotations sobres — sans spirale,
papier déchiré, texture lourde ni cursive généralisée. Elle possède aussi un
en-tête local : le prototype peut donc être jugé sans le header/footer de la
coquille actuelle. Marelle n'est pas utilisée dans cette itération.

## Arbitrages neutres (aucun vainqueur choisi)

| Axe | A · Journal | B · Cahier | C · Fil |
|---|---|---|---|
| Propriété du sous-groupe | numérotation + filets (typographique) | bande possédée + rail collant (spatiale, la plus explicite) | sommaire par saut + moments (navigationnelle) |
| Taille de lecture | récit display + figure ~300 px | figure ~320 px pleine largeur, récit dans le rail | héros ~72 px + figure ~360 px (le plus grand) |
| Hiérarchie des nombres | un héros + registre à conduites (lecture verticale) | rang-d'abord sur chaque tuile (le classement domine) | héros géant + bandeau dense (le plus « chiffres d'abord ») |
| Cartes | **aucune** (rejet total de la grille) | oui, mais inégales et possédées (pas de rangées forcées) | non-cartes denses (bandeaux), un seul panneau final |
| Explorer | liens de texte en fin de ligne/registre | empilés dans le rail + pied de tuile | cluster groupé par moment |
| Provenance | notes superscript locales + bas de thème | micro-stamp par tuile + ligne de section + bas | `<details>` par moment + registre exhaustif (le plus consolidé) |
| Blanc | rythme typographique serré | cadres de bande structurent l'espace | minimal, densité horizontale |
| Risques | registre long sans repères visuels ; moins « produit » | rail + tuiles = le plus proche de la coquille actuelle (changement perçu plus faible) | héros sans phrase d'accompagnement peut sur-promettre ; bandeau scrollable cache des colonnes |

**Ce que les trois partagent** (réponses directes aux audits) : figure de
lecture élargie (contre ~200 px, #448), unités attachées aux valeurs,
rang visible sur chaque détail (contre la puce perdue, #448 F3), estampille
snapshot **une seule fois** par thème (contre ×7, #480), vintages dédupliqués
dans une consolidation bas-de-thème (le motif hybride du verdict #491).

## Périmètre et limites assumées

- L'onglet **« Programmes et subventions »** garde sa présentation propre
  (BlocProgrammes) dans toutes les variantes : le prototype explore les cinq
  thèmes éditoriaux, il ne réécrit pas les badges à trois voix.
- Les graphiques ECharts et la liste LQ sont les composants existants, rendus
  plus grands par héritage de `--figure-compact-height` ; la liste LQ est
  déplafonnée (`--figure-compact-max-height: none` — le clipping du rang 5,
  #448 F4, disparaît).
- Duplications jetables assumées dans `matiere.ts` (unités des paramètres,
  `SOURCES_PAR_STORY`) — à réconcilier côté pipeline/contrat lors d'une
  éventuelle réécriture TDD.
- Le commutateur est monté sur toute fiche en dev (même sans `?variant=`)
  pour rendre la revue aisée ; il n'existe pas hors développement.
- Sur capture pleine page, le commutateur fixe apparaît « en milieu de page »
  (artefact du `captureBeyondViewport` ; en live il reste en bas de
  l'écran).

## Captures (commises)

`captures/` — 7 PNG pleine page : 2 par variante (desktop commune/EPCI +
mobile) et la référence du design actuel. Noms explicites
(`A-journal-desktop-commune-mobilite.png`, …).
