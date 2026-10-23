# Audit de la provenance rendue — densité, répétition, emplacement (#480)

_Date : 26 août 2026 · Périmètre : toute matière **source/vintage** rendue par la **Fiche d'identité** (les six onglets), aux quatre niveaux de territoire · Statut : diagnostic — aucune copie de production ni contrat de données modifié._

---

## 1. Méthode et boucle reproductible

Chaque fragment de provenance a été mesuré **dans le DOM réel** (Vite dev + Chrome headless, la boucle d'#449) sur le panel de six territoires × six onglets = 36 pages : Rennes (35238), L'Allineuc (22001), Loudéac Communauté (200067460), Rennes Métropole (243500139), Ille-et-Vilaine (35), Bretagne (53). Pour chaque page : hauteur rendue de chaque étampille/ligne source, position absolue, sous-groupe et carte porteurs ; puis agrégats — part du corps occupée par la provenance, groupes de répétition verbatim (dates neutralisées pour grouper les millésimes), gâchis en px.

```powershell
# Une commande — le script démarre `npm run dev` dans app/ (port 5199,
# strictPort) et l'arrête à la fin ; s'il trouve déjà un serveur, il le
# réutilise. Node ≥ 20, Chrome au chemin standard ($env:CHROME_PATH sinon).
node scripts/audit-provenance.mjs
```

Détail d'environnement (Windows) : vite lie `localhost` et peut ne servir que la pile IPv6 — le harnais sonde les deux piles et bascule sa base sur celle qui répond (`→ http://127.0.0.1:5199 ne répond pas mais http://[::1]:5199 oui — base basculée`). C'est ainsi que CE run a réutilisé le serveur orphelin ([::1]:5199) laissé par la tentative interrompue, sans redémarrage.

Sorties commises : `docs/audits/provenance-inventory.json` (diffable, se régénère) et `docs/audits/provenance-inventory.md` (lisible). Le harnais ne lit jamais `pipeline/data`, ne lance jamais R, n'écrit que sous `docs/audits/` (+ un harnais HTML éphémère dans `app/`, supprimé en sortie).

### 1b. La carte des coutures de provenance (qui possède quoi)

| Couture | Fichier | Possède | Mesuré (pannel) |
|---|---|---|---|
| Éstampilles vintage par figure | payload (`vintage_*`, règle de la source de référence ADR-0005) + `formaterVintage` (`selectors.ts:661`) rendues par `IndicatorFigure.vue` et les figures dédiées | « INSEE — … · 2023 · réf. … · publ. … » | 192 fragments, 8 668,8 px |
| Source de lecture | `sousGroupes.ts:463` (`SOURCES_PAR_STORY`, sinon `histoire.vintage_source`) → `.lecture-source` (`OngletTheme.vue:247`) | La ligne « SOURCE » sous chaque lecture (#74) | 23 fragments, 1 210,5 px |
| Éstampille snapshot | `estampilleSnapshot` (`selectors.ts:296`), rendue sans garde par `OngletTheme.vue:329` | « Analyse calculée le … — se rafraîchit sur un rythme lent » (ADR-0012) | 30 fragments, 1 410 px |
| Vintage programmes/subventions | lignes payload `programmes*` formatées dans `selectors.ts:1283..1414` → `BlocProgrammes.vue` | « ANCT — … · 2025 · réf. … », « Région Bretagne — SCDL… » | 6+6 fragments, 352,8 px |
| Provenance subvention (méthode de somme) | `BlocProgrammes.vue:203` | « Somme des subventions attribuées aux communes du département » + lien portail | 4 fragments, 84 px |
| Ligne de fraîcheur de pied | `ligneFraicheur` (`selectors.ts:122`) → `AppFooter.vue` (hors onglets) | « Actualisation partielle du 23 août 2026 — 1 source à traiter à la main » | 36 pages, 16,8 px/page — couture **#203**, exclue des agrégats d'onglet |

Toute la provenance rendue se ramène à ces cinq coutures in-onglet + la ligne de pied. Rien n'est inventé à l'affichage : chaque chaîne remonte à une ligne de `vintages.json` (63 lignes) ou à une colonne `vintage_*` du payload.

---

## 2. Constats quantifiés

Gravité : **D0** = contresens factuel · D1 = coût de lecture massif · D2 = bruit/répétition systémique · D3 = finition structurelle.

### D1 — D1 : la Mobilité consacre ~31 % de son corps à la provenance (1 039,7 px / onglet)

Part médiane du corps occupée par la provenance, par thème (36 pages mesurées, largeur 1440 px) :

| Thème | Fragments (méd.) | Provenance (méd.) | Part du corps (méd.) | Extrêmes |
|---|---|---|---|---|
| Programmes et subventions | 4 | 71,4 px | 7,2 % | 3,9–8,2 % |
| Démographie | 6 | 182,9 px | 12,3 % | 11,8–12,8 % |
| Habitat | 8 | 231,8 px | 11,9 % | 11,7–12,0 % |
| Économie/Emploi | 5 | 182,9 px | 15,8 % | 15,8–19,5 % |
| Milieux | 4 | 250,1 px | 20,0 % | uniforme |
| **Mobilité** | **18** | **1 039,7 px** | **30,3–33,4 %** | toutes fiches identiques |

Vue fiche entière (somme des six onglets) : **~1 920–2 010 px de provenance par territoire, soit ~19 % de tout ce qui est rendu** — avant la ligne de fraîcheur de pied. Le lecteur qui traverse les six thèmes rencontre ~115 fragments de provenance pour ~40 figures.

Le cas Mobilité est structurel, pas éditorial : 16 étampilles de figure pour **8 identités uniques** (Lusk analyse d'accessibilité, OSM réseaux, Geovelo, Ecolab, INSEE RP exploitations, Etalab bornes IRVE, BPE25, Korrigo GTFS), chacune sur deux lignes (identité + réf./publ.), plus la ligne SOURCE de lecture, plus l'étampille snapshot.

### D2 — D0 : l'étampille snapshot se répète au pied de CHAQUE onglet — 30 occurrences par panel

Confirmé à l'échelle du panel (première vague #449-F1, maintenant chiffrée) : « Analyse calculée le 6 août 2026 — se rafraîchit sur un rythme lent » se rend sur **30 des 36 pages** — les cinq onglets thématiques de chaque fiche, y compris là où elle contredit les étampilles hebdo « publ. 30 juin 2026 » visibles au-dessus (D0 : faux sur quatre onglets sur cinq, promesse « Alive »).

Nuance de placement que la première vague ne voyait pas : l'étampille est **déjà en pied de bloc** (`OngletTheme.vue:329`, après la boucle des sous-groupes) — le problème n'est pas sa place dans l'onglet mais sa répétition **par onglet** : 5 × 47 px par fiche visitée, 1 410 px par panel, pour un fait unique par fiche. Couture : `OngletTheme.vue` (garde de thème manquante) — c'est le brouillon **T-1** de la première vague, inchangé.

### D3 — D1 : la ligne SOURCE de Milieux cite neuf lignes de vintage — 102,3 px, dont les millésimes des autres départements

Sous la lecture Milieux de **Rennes** :

> Source INSEE — Série historique du recensement · 2023 · IGN — OCS GE « surfaces artificialisées » v2.0 (Nouvelle Génération) — Côtes-d'Armor (22), millésime 2021 · 2021 · IGN — OCS GE … (22), millésime 2025 · … Finistère (29) ×2 · Ille-et-Vilaine (35) ×2 · Morbihan (56) ×2 …

Trois lignes rendues (102,3 px) citant `serie_historique` + **les huit millésimes OCS-GE des quatre départements**, quelle que soit la fiche. La règle du **millésime OCS-GE** (CONTEXT.md, ADR-0017) demande la paire M2→M3 *du territoire* ; ici Rennes cite le Morbihan. Couture : `SOURCES_PAR_STORY` (`sousGroupes.ts:164-174`) cite exhaustivement au lieu de filtrer — première vague F8.1 confirmée, avec la mesure : ce seul défaut coûte ~85 px/fiche (une ligne au lieu de trois). Même famille : l'étampille CONSOENAF passe sur deux lignes (67,2 px) à cause des codes internes (« (Fichiers Fonciers) », « indicateurs communaux »).

### D4 — D2 : l'étampille d'analyse Mobilité se répète ×7 par onglet (+ la ligne SOURCE qui la redite)

Sur CHAQUE onglet Mobilité :

> Lusk — analyse d'accessibilité « Vingt minutes sans voiture » (analyse portée, BPE 2024 · OSM 02-2026 · BDNB 2025-07) · 2026-02 · réf. 28 févr. 2026 · publ. 6 août 2026

…sous la lecture ET sous chacune des six figures d'isolement — **×7 par onglet, 201,6 px de gâchis**, ×42 occurrences sur les six pages du panel ; la ligne SOURCE de lecture répète une huitième fois la même identité (35,1 px). Même motif, moindre ampleur : OSM réseaux ×3 (67,2 px). Le gâchis de répétition intra-onglet du panel s'élève à **2 217,6 px**, dont **1 612,8 px portés par la seule Mobilité** ; l'Habitat ajoute 403,2 px (« INSEE — Logements (dossier complet) » ×4/onglet, « ADEME — Observatoire DPE » ×2) et la Démographie 201,6 px (« Série historique du recensement » ×2). Toutes fiches confondues, **35 % des pixels de provenance (4 132,8 / 11 726,1) sont du verbatim déjà présent sur le même onglet**. Couture : `vintages.json` (chaînes `source`) + le rendu par-figure d'`IndicatorFigure.vue` sans déduplication par sous-groupe — F8.3 de la première vague, passé de ×6 à ×7 depuis qu'une figure a grossi.

### D5 — D2 : les dates exactes réf./publ. doublent la hauteur de chaque étampille près de la preuve

Une étampille une ligne (« INSEE — Population par sexe et âge (PRINC) · 2023 ») mesure 16,8 px ; ajouter « réf. 1 janv. 2023 · publ. 30 juin 2026 » la porte à 33,6 px — **+100 % sur ~190 fragments**. Or ces dates servent à *vérifier*, pas à *lire* : elles appartiennent au registre (Sources page, L'indicateur), pas au moment de lecture. Les fenêtres qui portent du sens de lecture (les Trois horloges de Milieux, la période RP des axes) sont déjà rendues ailleurs — titres d'axes, libellés de période — et restent nécessaires **près de la figure**.

### D6 — D3 : la provenance est bien locale (192 fragments sur 270 dans la carte de la figure) — le problème est la granularité, pas l'emplacement

192 des 270 fragments in-onglet vivent **dans la carte de leur figure** : l'affordance « près de la preuve » est déjà la bonne architecture. Ce qui pèse est la granulométrie (identité complète + deux dates + codes internes, répétée par figure) et les trois couches de fraîcheur empilées sur certains onglets (étampilles hebdo + snapshot + pied de fiche) sans hiérarchie visible. La Région montre la voie du silence honnête : son onglet Économie, sans lecture LQ, ne rend aucune ligne source (23 lignes SOURCE sur 24 onglets attendus).

### D7 — D3 : évolution depuis la première vague — les liens « Sources et méthodes » ont disparu du rendu

La première vague (#449-F11.1) comptait 5 liens « Sources et méthodes » par fiche vers `/methodologie#…`. Sur le main actuel (post-#473/#477) ils ne subsistent que dans les fixtures et specs ; les lectures ferment désormais sur les **passarelles** « Explorer les indicateurs de cette lecture » (#473) et chaque carte porte « Explorer cet indicateur » (#409/#468). Conséquence directe pour cet audit : **la destination post-fiche existe déjà dans le DOM** — l'affordance de renvoi vers le registre est en place, il lui manque un enregistrement exhaustif à montrer (voir §4, #398).

---

## 3. Évaluation : compact près de la preuve vs consolidation en pied de fiche

### Ce qui doit rester auprès de la figure (besoin au moment de lire)

1. **L'identité courte de la source** (« BPE 2024 », « RP 2023 », « OCS-GE 2020→2023 (35) ») : c'est ce qui permet de comparer deux cartes voisines d'un coup d'œil et d'appliquer la règle des **Trois horloges** sans scroll — les horloges doivent rester nommées là où leurs chiffres divergent.
2. **Le signal de fraîcheur relative** quand elle diffère du voisin (CONSOENAF délibérément plus fraîche que l'état OCS-GE).
3. **Le lien profond** vers l'enregistrement complet (l'ancre `#source-<id>` survit côté Sources, ADR-0022).

### Ce qui relève du registre consolidé (besoin de vérification)

Les dates exactes réf./publ., les noms longs avec codes internes (B316, DS_RP_*, v0.3.5, « analyse portée »), les énumérations multi-millésimes, et toute répétition verbatim entre cartes sœurs. Aucun de ces éléments n'informe la lecture ; tous servent la vérification a posteriori — exactement la mission des Pages d'indicateur (**L'indicateur**) et de la page **Sources** (#398, granularité jeu de données + millésimes imbriqués, ADR-0022).

### L'option « une fois, en pied de fiche » — jugée sur pièces

**Ce qui joue pour** : emplacement borné et prévisible ; cohérent avec la retraite de Méthodes (le pied de fiche devient le seuil vers le registre) ; accessible si le bloc est du vrai texte dans l'ordre du DOM (pas un survol) ; la ligne de fraîcheur (`ligneFraicheur`, #203) vit déjà là — fusionner les deux voix de fraîcheur supprime la superposition signalée en D2/D6.

**Ce qui limite** : la fiche est **ongletée** — « une fois par fiche » ne peut pas vivre dans un bloc de thème, sinon il dégénère en « une fois par onglet ». La preuve empirique existe : l'étampille snapshot EST un pied-de-bloc, et elle coûte quand même 5 × 47 px par fiche (D2). Un vrai pied de fiche unique doit donc se placer **hors des six blocs** (chrome de fiche, au niveau de `TerritoireView`), zone aujourd'hui vide entre le dernier onglet et le pied global. Deuxième limite : découvrabilité — une citation que personne ne voit est une citation morte ; le remède est le maillage des liens profonds (D7 : les passarelles existent), pas le retour des rangées exhaustives inline. Troisième limite : ADR-0005 reste intact — la source de référence par indicateur continue d'être *déclarée et vérifiable* ; seul son *rendu* se compacte.

### Verdict et motifs de remédiation (ordre décroissant de gain)

| # | Motif | Effet mesuré attendu |
|---|---|---|
| R1 | **Dédupliquer par sous-groupe** : une étampille d'identité par (carte, identité) — les figures sœurs héritent silencieusement | −201,6 px/onglet Mobilité (×7→×1), −67,2 px OSM ; Habitat ×4→×1, Démographie ×2→×1 ; ~19 % du gâchis de provenance du panel |
| R2 | **Compacter l'étampille près de la preuve** : identité seule une ligne (16,8 px), dates réf./publ. déportées au registre | ~−17 px × ~190 fragments ≈ −3 200 px de panel |
| R3 | **Un pied de fiche unique hors onglets** : snapshot Mobilité + ligne de fraîcheur consolidés à un endroit borné (fusion avec la couture #203) | −188 px/fiche (snapshot ×5→×1), supprime la double voix de fraîcheur |
| R4 | **Milieux : citer le(s) millésime(s) du territoire**, pas les huit (règle du millésime OCS-GE) | −68 px/fiche Milieux, corrige un contre-sens géographique |
| R5 | **Mailler chaque affordance compacte vers le registre** (L'indicateur / Sources, ancres ADR-0022) | ne réduit rien — condition de découvrabilité de tout le reste |

Ordre de grandeur combiné R1-R4 : la provenance passerait de ~30 % du corps Mobilité à ~10-12 %, et de ~19 % de la fiche entière à **~8-10 %** (estimation, à re-mesurer avec le même harnais — c'est son rôle).

---

## 4. Mapping des tickets existants

| Ticket / livraison | Statut au regard de CET audit | Frontière exacte |
|---|---|---|
| **#74** (Stories sourcées) | **Couvert — livré** | Les 24 lectures attendues portent leur ligne SOURCE (23 mesurées ; la Région Économie en est honnêtement absente). Le résidu bruyant (D3/D4) est un défaut de *contenu* des lignes, pas d'*existence* — traité par T-6 de la première vague. |
| **#203** (fraîcheur = dernier nouveau point de donnée) | **Partiel — couture voisine, confortée** | #203 corrige la *sémantique* de `ligneFraicheur` (pied de page/Accueil). Cet audit ajoute (a) la mesure : 16,8 px/page, hors onglets, seule voix vraiment unique par fiche ; (b) l'argument d'architecture : c'est LE point d'ancrage naturel du futur pied consolidé (R3) — à coordonner, pas à doubler. Le contenu constaté (« 1 source à traiter à la main » — jargon pipeline en pied de page publique) alimente directement son périmètre éditorial. |
| **#398** (Pages d'indicateur / catalogue) | **Partiel — la destination, pas encore le trafic** | L'indicateur doit porter définition, unité, source, vintage, caveats ; la page Sources porte les jeux de données à granularité ADR-0022. Cet audit fournit la quantification de la demande (D5/D7) et le motif R5 (maillage des affordances compactes vers ces pages) — non spécifié dans #398, proposé ci-dessous (P-4). |
| **#449 / PR #452 — F8** (provenance bruyante, codes internes, répétition) | **Couvert — confirmé et chiffré** | ×6→×7 pour l'étampille analyse (D4), 102,3 px pour la ligne Milieux (D3), snapshot ×30 (D2). Les correctifs restent les brouillons T-6/T-1 de cette vague — aucun nouveau ticket concurrent créé ici. |
| **#449 / PR #452 — F11.1** (liens « Sources et méthodes » ×5/fiche vers /methodologie) | **Contré — obsolète sur main** | Post-#473, les lectures ferment sur les passarelles et le lien Méthodes n'existe plus qu'en fixtures (D7). La première vague observait une branche antérieure ; sa recommandation de retargeting tombe. |
| **#449 / PR #452 — F1/F2** (snapshot sur tous les onglets, promesse de rythme) | **Couvert — inchangé** | D2 apporte la mesure de placement (pied de bloc, ×5/fiche). T-1/T-8 de la première vague restent les bons vecteurs. |
| ADR-0005 (source de référence par indicateur) | **Respecté — non remis en cause** | Toutes les étampilles mesurées nomment la source déclarée ; R2 compacte le rendu, jamais la déclaration. |
| ADR-0017 (Trois horloges) | **Respecté — contraint R2/R4** | Les fenêtres nommées restent près des figures qui les lisent ; seule l'énumération exhaustive descend au registre. |
| ADR-0022 (granularité jeu de données, ancres par vintage) | **Étendu côté fiche** | Il organise déjà la page Sources ; R5 propose d'en faire la destination des liens profonds issus de la fiche. |

Aucun constat de ce rapport ne crée un ticket synonyme : les nouveautés sont strictement les brouillons P-1..P-4 ci-dessous, tracés comme non-couverts par la première vague.

---

## 5. Brouillons de tickets prêts à filet (non couverts ailleurs)

**P-1 · fix(fiche): une étampille d'identité par sous-groupe, héritée par les figures sœurs** *(agent-safe)*
`IndicatorFigure.vue`/figures dédiées + `OngletTheme.vue` : rendre l'étampille complet sous la PREMIÈRE figure d'une identité, les suivantes portant l'identité courte (ou rien si identique au niveau du sous-groupe). Tests : l'étampille longue ×1 max par (sous-groupe, texte normalisé) sur les onglets réels Mobilité (« Lusk — analyse… » ×7→×1), Habitat (« Logements (dossier complet) » ×4→×1) et Démographie (« Série historique » ×2→×1). Réfs : D4, #480-R1 ; borne : ne touche ni `vintages.json` ni ADR-0005.

**P-2 · feat(fiche): étampille compacte une ligne — identité près de la preuve, dates au registre** *(décision produit légère puis agent-safe)*
`formaterVintage` gagne un mode compact (identité + version, sans réf./publ.) utilisé dans les cartes ; les dates restent sur les destinations registre (L'indicateur/Sources). Test : hauteur ≤ 1 ligne, présence des dates côté registre. Réfs : D5, #480-R2 ; dépend fonctionnellement de P-4 pour la découvrabilité, techniquement de rien.

**P-3 · feat(fiche): pied de fiche unique « Sources & fraîcheur » hors onglets** *(design d'abord — mainteneur)*
Dans `TerritoireView`, sous le bloc d'onglets : UNE zone bornée fusionnant l'étampille snapshot (garde Mobilité, cf. T-1) et `ligneFraicheur` (#203), avec lien vers la page Sources. Test : présence ×1 par fiche, absence de tout `.estampille-snapshot` dans les onglets non-Mobilité. Réfs : D2/D6, #480-R3 ; coordonner avec #203 et T-8 (formulation de la promesse de rythme — humain).

**P-4 · feat(indicateurs): maillage registre — chaque affordance de provenance deep-link son enregistrement** *(agent-safe après que #398 publie les cibles)*
Passer les ancres ADR-0022 (`#source-<id>`) aux étampilles/lignes SOURCE (RouterLink vers la Page d'indicateur L'indicateur ou la page Sources selon la couture). Test : chaque `.estampille-vintage`/`.lecture-source` expose un lien dont la cible existe (assertion bilatérale). Réfs : D7, #480-R5 ; bloqué par la publication des cibles #398 — sinon premier agent-safe dès la page Sources existe.

Ordre proposé : P-1 → P-2 → P-3 (design) ∥ P-4 (dès #398 le permet). P-1 et P-2 capturent ~80 % du gâchis mesuré sans aucune décision de fond.

---

## 6. Ce que cet audit ne fait pas

Aucun texte de production, contrat de payload, ni `.gitignore` modifié : `theme_*.json`, `selectors.ts`, `sousGroupes.ts`, `OngletTheme.vue`, `BlocProgrammes.vue` sont intacts sur cette branche ; le harnais n'écrit que ses sorties d'audit. Les motifs R1-R5 et les brouillons P-1..P-4 sont des propositions à valider, pas des correctifs livrés ; tout ce qui engage la voix (promesse de rythme, libellés sources) reste explicitement côté tickets humains (T-8/#158 de la première vague).
