# Audit éditorial de la fiche — lectures et prose (#449)

_Date : 24 août 2026 · Périmètre : la prose rendue de la **fiche d'identité** (onglet Aperçu + les cinq thèmes), aux quatre niveaux de territoire · Statut : diagnostic — aucun texte de production modifié._

---

## 1. Méthode et boucle reproductible

Chaque fragment rendu a été extrait du DOM réel (Vite dev + Chrome headless) sur un panel de six territoires × six onglets = 36 pages : Rennes (35238), L'Allineuc (22001), Loudéac Communauté (200067460), Rennes Métropole (243500139), Ille-et-Vilaine (35), Bretagne (53). Chaque fragment est étiqueté par la **couture** (seam) qui possède ses mots. L'inventaire brut committed est `docs/audits/2026-08-24-fiche-prose-inventory.md` ; le JSON (diffable) se régénère.

```powershell
# Terminal 1 — le serveur de dev sert aussi /data/ (middleware Vite)
cd app ; npm run dev -- --port 5199 --strictPort

# Terminal 2 — l'inventaire (~3 min, 36 pages)
node scripts/audit-prose.mjs --out docs/audits
# Variantes : --territoires epci:243500139 --themes mobilite milieux
```

Prérequis : Node ≥ 20, Chrome au chemin standard (`$env:CHROME_PATH` sinon). Le script ne touche qu'à des fichiers de sortie ; il ne lit jamais `pipeline/data` ni ne lance R.

### 1b. La carte des coutures (qui possède quoi)

| Couture | Fichier | Possède |
|---|---|---|
| Gabarit de lecture | `public/data/theme_<theme>.json` → `subgroups[].reading.template` | Les mots fixes de chaque phrase de lecture (AST à cinq nœuds) |
| Paramètres résolus | `public/data/histoires_<theme>.json` | Les valeurs injectées dans le gabarit (formatées app-side) |
| Libellés de classification | `theme_<theme>.json` → `classification_labels` | « attire et se renouvelle », « grandit en se densifiant »… |
| Libellés de sous-groupe | `theme_<theme>.json` → `subgroups[].label/framing` | Titres + cadrages |
| Libellés d'indicateur/détail | `theme_<theme>.json` → `indicator_labels/detail_labels` (#318) | Captions de figures |
| Estampille snapshot | `app/src/payload/selectors.ts` (`estampilleSnapshot`) | « Analyse calculée le … — se rafraîchit sur un rythme lent » |
| Source de lecture | `app/src/fiche/sousGroupes.ts` (`SOURCES_PAR_STORY`, `sourceLecture`) | La ligne « SOURCE » sous chaque lecture |
| Étampilles vintage | `payload` (`vintage_*`) + `formaterVintage` | « INSEE — … · 2023 · réf. … · publ. … » |
| Voix Aperçu/Programmes | `app/src/fiche/apercu.ts` | Badges, voix (lauréate/couverte/porte/compte/ort), montants |
| Copie applicative | vues/composants | États vides, sous-titre de nuage, liens |

---

## 2. Constats classés

Gravité : **P0** = contresens factuel pour le lecteur · P1 = lecture dégradée · P2 = bruit/répétition · P3 = finition.

### F1 — P0 : l'estampille snapshot s'affiche sur TOUS les onglets de thème

Rendu (constaté sur 30 des 36 pages inventoriées, ex. onglet Démographie de Rennes) :

> **Analyse calculée le 6 août 2026 — se rafraîchit sur un rythme lent**

…sous des chiffres INSEE estampillés « publ. 30 juin 2026 » qui, eux, se rafraîchissent chaque semaine. C'est le texte exact cité comme inutile par l'utilisateur — mais le problème est double : **la copie ET sa place**.

- Pourquoi ça échoue : sur quatre onglets sur cinq, l'affirmation est **fausse** — elle contredit la promesse « Alive » (CONTEXT.md) et les étampilles hebdo visibles juste au-dessus. Un lecteur ne peut pas savoir quelle phrase croire.
- Couture : **copie applicative** — `OngletTheme.vue` rend `estampilleSnapshot(payload)` sans garde de thème (l. 276-279) ; `selectors.ts:295` n'a aucune notion du thème appelant. La date vient de `vintages.json` (`mobilite_snapshot.date_publication` = 2026-08-06 ✓).
- Motif : rendre l'estampille **uniquement sur l'onglet Mobilité** (`v-if="theme === 'mobilite'"` ou garde dans le sélecteur). ADR-0012 la définit comme l'estampille du bloc Mobilité, pas celle de la fiche.
- Agent-safe : oui (placement + test). La reformulation du texte lui-même est humaine → F2.

### F2 — P1 : même là où elle est vraie, la promesse de fraîcheur n'aide pas le lecteur

Sur l'onglet Mobilité, « se rafraîchit sur un rythme lent » ne dit ni le rythme, ni la prochaine mise à jour, ni ce que ça change pour la décision. Le lecteur veut : *de quand c'est, quand est-ce que ça bougera*. La clause actuelle est une méta-promise pipeline (le cron lent), pas une information de fiche.

- Couture : copie applicative (`selectors.ts`) + fait produit (le rythme réel n'est pas tranché).
- Motif : soit **supprimer la seconde clause** (les étampilles « réf./publ. » sous chaque figure portent déjà la fraîcheur — redondance), soit la remplacer par le fait daté (« recalculée à chaque collecte BPE/OSM, environ deux fois par an » — cadence à verrouiller).
- **Humain** : la promesse de rythme engage le produit (voir le brouillon T-8). #203 traite la ligne de pied de page (`ligneFraicheur`) — couture différente, complémentaire.

### F3 — P0 : « La commune se spécialise dans… » sur toutes les fiches, tous niveaux

Constats exacts :

> La commune se spécialise dans Information et communication (rang 1 du top 5). *(EPCI Rennes Métropole)*
> La commune se spécialise dans Agriculture, sylviculture et pêche (rang 1 du top 5). *(commune L'Allineuc, département Ille-et-Vilaine)*

Deux défauts dans une phrase :

1. **Sujet faux** hors commune — « La commune » est codé en dur dans le gabarit (`theme_economie.json`) alors que la lecture est publiée aux communes, EPCI **et départements** (la Région n'en a pas, correctement absent).
2. **« rang 1 du top 5 »** est du scoreboard : rang de quoi, parmi qui ? Le lecteur a la liste top-5 sous les yeux (figure LQ) — la parenthèse n'apporte rien et masque la matière réelle (le LQ vs la moyenne bretonne, cf. CONTEXT.md « Location quotient »).

- Couture : **gabarit payload-side** (`theme_economie.json` — édition pipeline + tests de parité).
- Motif de remplacement : sujet neutre via nœud `territoire` (« <Territoire> se spécialise dans **X** »), supprimer « (rang N du top 5) ». Qualifier par l'intensité du LQ serait un plus (esprit #265) mais peut rester humain.
- Agent-safe après validation de la formulation.

### F4 — P1 : Milieux fusionne deux horloges sous un seul « Entre … et », et parle jargon

> Entre 2017-2023 et 2020-2023, Rennes grandit en se densifiant (trajectoire 0,94 par habitant).
> Entre 2017-2023 et 2021-2025 (22) → 2021-2024 (29) → 2020-2023 (35) → 2022-2024 (56), Bretagne grandit en se densifiant…

Trois problèmes :

1. **Grammaire cassée** : « Entre X et Y » avec deux fenêtres — le lecteur croit à un span unique 2017→2023+2020-2023. La règle des **Trois horloges** (CONTEXT.md, ADR-0017) impose des horloges *nommées séparément, jamais collapsées* ; la phrase les collapse.
2. **La Région** rend une chaîne de quatre fenêtres fléchées à l'intérieur du « Entre…et » — illisible.
3. **« trajectoire 0,94 par habitant »** : vocabulaire interne (`Trajectoire par habitant`, le ratio M3/M2) rendu brut, sans unité ni sens (« par habitant » se rapporte aux états, pas à la trajectoire). Le lecteur ne peut rien en faire.

- Couture : gabarit `theme_milieux.json` + formatage des paramètres (app).
- Motif : la phrase porte la classification + les deux forces en clair (« la population recule pendant que la part par habitant progresse ») ; les fenêtres vont **à leur place**, nommées une par une (population 2017→2023 · état OCS-GE 2020→2023 — déjà rendues par la figure quadrant `periodePop`/`periodeArtif`). Le ratio disparaît de la prose ou devient une comparaison (« la terre artificialisée par habitant a baissé de 6 % »).
- **Humain** pour la formulation (liens : #265 intensité, #388 période dérivée des millésimes). Structure agent-safe.

### F5 — P1 : l'élision des noms de territoire est cassée partout

> la population de **Allineuc** se vide… · Sans voiture, 38 types… de **Allineuc**
> la population de **Ille-et-Vilaine**… · Le parc de **Ille-et-Vilaine** est performant

Chaque gabarit concatène « de » fixe + nœud `territoire`. Aucune élision devant voyelle, et le nom payload (« Allineuc ») a perdu son article officiel (« L'Allineuc », INSEE). Touché à chaque phrase de lecture aux niveaux commune/département ; « de Bretagne » passe par chance.

- Couture : gabarits (texte fixe « de ») + noms payload (`territoires.json`). Deux motifs possibles, non exclusifs : (a) élision déterministe au rendu du nœud `territoire` (NoeudLecture : « de » → « d' » devant voyelle — agent-safe, testable) ; (b) articles portés par les noms payload (pipeline). La préposition complète (à/en/au selon le type) est un choix éditorial humain.
- Note data : « Allineuc » → renommer côté pipeline (source INSEE) — brouillon T-5.

### F6 — P1 : des lectures publient des nombres sans unités

> …attire et se renouvelle : **4,99** par an (naturel), **5,49** (migratoire). *(‰/an — absent)*
> Le parc de Bretagne est intermédiaire : **8,7** de passoires thermiques. *(% — absent)*

Le formateur (`CLEFS_POURCENT`, `sousGroupes.ts`) convertit sciemment 0,054 → « 5,4 » et laisse le gabarit porter l'unité — mais les gabarits ne la portent pas. « 4,99 par an » pourrait être des habitants ; « 8,7 de passoires » n'est pas du français. Asymétrie bonus : le premier taux est glossé « (naturel) », le second juste « (migratoire) », et « par an » ne figure qu'une fois.

- Couture : gabarits (`theme_demographie.json`, `theme_habitat.json`) — unités dans les textes fixes (« ‰ par an », « % des logements diagnostiqués »).
- Agent-safe (ajout d'unités + mise à jour des specs de rendu existantes).

### F7 — P2 : la salience vélo change le graphique mais jamais la phrase (139 fiches)

Le payload résout `ce-que-le-velo-preserve` pour **139 territoires** (ex. Laignelet 35138 : div_loss_t 41 vs div_loss_b 12). Vérifié rendu :

> Sans voiture, 41 types de services disparaissent de l'accès quotidien de Laignelet.

La phrase reste celle du défaut (`vingt-minutes-sans-voiture`) : le contrat actuel ne déclare **qu'un template par sous-groupe** (`subgroups[].reading.template`), et `lecturePour()` ignore `histoire.story_key` pour choisir la prose. Le delta vélo — parfois 29 types de services sauvés — n'existe que dans les marques du graphe. CONTEXT.md décrit pourtant « Ce que le vélo préserve » comme une lecture qui raconte le réalisé cyclable.

- Couture : contrat metadata (`theme_mobilite.json`) + `sousGroupes.ts`. Décision nécessaire : pool de templates par story_key (miroir prose de la sélection pipeline, ADR-0002) ou rider ajouté quand la salience tire.
- Brouillon T-4 (design avant code).

### F8 — P2 : provenance bruyante et codes internes dans les étampilles

1. **Huit millésimes OCS-GE cités partout** : la ligne SOURCE de Milieux liste les jeux des quatre départements quelle que soit la fiche — Rennes cite les millésimes du Morbihan et des Côtes-d'Armor. Couture : `SOURCES_PAR_STORY` (app-side, `sousGroupes.ts`) cite exhaustivement au lieu de filtrer par territoire. Motif : citer les millésimes **utilisés** (celui du département du territoire, la paire M2→M3 — la règle du **millésime OCS-GE**) ou une ligne unique « IGN OCS-GE (millésimes 22·29·35·56) ».
2. **Codes internes rendus aux lecteurs** : « licence ODbL 1.0 (**ADR-0001**) », « filtre analytique **B316** », « le jeu **DS_RP_LOGEMENT_PRINC**, la dimension **CARS** », « schéma national **v0.3.5** », « analyse **portée** ». Ce sont des références repo/pipeline, pas des faits de source. Couture : chaînes `source` de `vintages.json` (pipeline) — garder les codes pour la page **Sources**, pas pour la fiche.
3. **Répétition verbatim** : la longue étampille Mobilité se répète **six fois** sur l'onglet (lecture + 5 figures d'isolement). Motif : une fois par sous-groupe suffit.
- Agent-safe pour (1) et (3) ; (2) est une rédaction de libellés sources (humain léger). Frère carte de ce défaut : #293 (unités absentes des couches Story).

### F9 — P2 : le sous-titre de nuage est un fragment orphelin

> de Rennes et des communes de Rennes Métropole

Ligne autonome entre la lecture et le graphique, commencant par une préposition (`descriptionNuage` fournit `prepositionCourant: 'de'`, collée au nom par `OngletTheme`). Seule la variante Région (« de la Bretagne et de ses communes ») tombe debout.

- Couture : `selectors.ts` + composition `OngletTheme`.
- Motif : phrase complète — « Comparaison : Rennes et les communes de Rennes Métropole » — ou absorption dans la légende du graphe. Agent-safe.

### F10 — P3 : les dénominateurs de rang changent sans prévenir

> Bornes de recharge par station-service : **7e/23 de l'EPCI** *(voisines : 1er/**43** de l'EPCI)*
> Places vélo ÷ voiture : **14e/43 de la région** *(voisine : 4e/**61** de la région)*

Les puces de rang disent toujours « de l'EPCI / de la région » (ADR-0021 ✓) mais le N varie silencieusement quand le ratio n'est publié que là où le dénominateur existe (fuel > 0). Le lecteur ne sait pas pourquoi 23 et pas 43.

- Couture : aria/texte de la puce (`puceRangDirection`, `detailsRangEnContexte`).
- Motif : nommer le filtre (« parmi les 23 communes avec station-service ») — cohérent avec la règle « the rendered label names the actual scope » (CONTEXT.md Rang). Agent-safe.

### F11 — Répétitions systémiques (motifs de suppression)

1. **« Sources et méthodes » clôture chaque lecture** (5× par fiche, un lien par thème) et pointe `/methodologie#<thème>` — page déclarée retirée par CONTEXT.md (statut 2026-08-21) tant que #410 n'a pas basculé. Motif : un lien par bloc suffit, ou le déplacer dans la ligne SOURCE déjà présente ; retarget vers la destination post-#410.
2. **Framings qui paraphrasent le titre** : « L'état énergétique du parc » → cadrage « L'état énergétique du parc : la distribution… ». Le cadrage doit ajouter (périmètre, tension), pas répéter. Suppression pure quand il n'apporte rien (ex. « La structure verte » : « La place des établissements verts dans le tissu productif » ≈ titre).
3. **Qualificateur de mode répété 5×** : « Part des bâtiments sans accès à l'alimentation **(à pied ou en transports en commun)** » ×5 sur un onglet — le qualifier vit une fois par sous-groupe (le gabarit de lecture le porte déjà implicitement).
- Couture : metadata payload (framing, indicator_labels) + gabarits. Agent-safe, mais triage mot à mot recommandé (humain léger).

### F12 — Lectures trop plates pour porter leur tension (fond, pas forme)

- **Habitat** : « Le parc de Rennes est intermédiaire » n'explique ni le seuil ni l'enjeu ; la tension énergétique vieux bâti ↔ passoires (déjà indicée par Âge du bâti sur la même fiche) n'est pas tirée. → **#210** (existe).
- **Mobilité** : « 38 types de services disparaissent » sans dénominateur (combien de types suivis ?) ni contre-ancre dans la prose — le nuage porte la comparaison mais la phrase n'a pas de prise. Petit ticket éditorial (T-7).
- **À garder comme ancrage de style** : les classifications Démographie (« attire, mais se meurt ») et les voix Programmes (« Compte 40 communes lauréates · Bégard ») font exactement ce que CONTEXT.md demande — honnêtes, tendues, sans jargon.

---

## 3. Vocabulaire : conforme et dérives

Conforme : « lecture » partout (plus personne ne dit Story côté produit), rangs ordinaux directionnels avec phrase accessible, étampilles réf./publ., voix portage/compte des badges, honest absence (« La lecture de ce sous-groupe n'est pas disponible »).

Dérives (à mapper, pas à corriger ici) :

| Dérive constatée | Référence |
|---|---|
| L'Aperçu reste premier onglet rendu alors que CONTEXT.md le déclare retiré (2026-08-21) au profit de « Programmes et subventions » sixième thème | **#408** (travail spécifié, ouvert) |
| Chaque lecture lie « Sources et méthodes » → `/methodologie#…`, page en cours de remplacement | **#410** / #126 |
| « Part des 65 ans et plus » encore rendue à l'Aperçu | **#387** (ouverte) |
| Commentaire de code ThemeTabs obsolète (« Programmes & financements » — le rendu réel dit bien « Programmes et subventions ») | mineur — nettoyage opportuniste |

---

## 4. Mapping des tickets existants

| Ticket | Lien avec cet audit |
|---|---|
| **#158** (réécriture voix Méthodes, ready-for-human) | Couvre le registre Méthodes (`methodes/*.ts`), PAS les lectures de fiche — les F3/F4/F6 sont un périmètre nouveau ; les ancrages de style produits là-bas serviront aux deux |
| **#203** (fraîcheur = dernier point de donnée) | Pied de page/Accueil (`ligneFraicheur`) — F1/F2 concernent l'estampille snapshot, autre couture, même famille éditoriale |
| **#265** (vocabulaire d'intensité des Stories) | Le lieu naturel des qualifications F3/F4 (légèrement/marqué) |
| **#210** (approfondir la Story Habitat) | Reçoit F12-Habitat tel quel |
| **#388** (période dérivée des millésimes source) | Conditionne le rendu des fenêtres de F4/F6 |
| **#293** (unités des couches Story carte) | Frère carte de F6 |
| **#74** (Stories sourcées) | Livré ; F8 = bruit résiduel du mécanisme |
| **#123** (QA humain fiches Économie) | Recevra F3 comme input constaté |
| **#408 / #446** (sixième thème / audit programmes) | Hors périmètre ici (badges/subventions couverts par #446) ; F1 survit à la migration (vit dans OngletTheme) |

Aucun constat de ce rapport ne duplique un ticket ouvert : les plus proches (#158, #203, #265, #210) sont cités ci-dessus avec la frontière exacte.

---

## 5. Brouillons de tickets prêt à filet

**T-1 · fix(app): estampille snapshot limitée à l'onglet Mobilité** *(agent-ready)*
`OngletTheme.vue` (+ garde sélecteur), test : l'estampille absente des quatre autres onglets, présente sur mobilité. Ne reformule pas le texte (T-8). Refs : ADR-0012, #449-F1.

**T-2 · fix(pipeline): élision du nœud « territoire » dans les lectures** *(agent-ready)*
NoeudLecture (ou résolution au niveau du gabarit) : « de » → « d' » devant voyelle ; cas « Allineuc » → nom INSEE « L'Allineuc » côté `territoires.json`. Tests sur Allineuc/Ille-et-Vilaine/Bretagne. Refs : #449-F5.

**T-3 · fix(pipeline): unités dans les gabarits de lecture** *(agent-ready)*
`‰ par an` (Démographie), `% des logements diagnostiqués` (Habitat) dans les textes fixes ; specs de rendu mises à jour. Refs : #449-F6, #293.

**T-4 · feat(pipeline): la prose suit le story_key résolu (salience vélo)** *(design d'abord — mainteneur)*
Décider : templates multiples par sous-groupe indexés par story_key, ou rider salience. Contrat metadata + parité + tests Laignelet-class. Refs : #449-F7, ADR-0002, #194.

**T-5 · fix(data): noms de territoires — article officiel** *(agent-ready, data-only)*
Audit des noms perdant leur article (L'Allineuc…) contre la source INSEE ; correction pipeline. Dépend T-2 pour le rendu. Refs : #449-F5.

**T-6 · chore(app): provenance des lectures — pertinente et débarrassée des codes internes** *(agent-ready pour le filtrage ; léger humain pour les libellés)*
Milieux : citer le(s) millésime(s) du territoire, pas les huit ; dédupliquer l'étampille Mobilité par sous-groupe ; déplacer « ADR-0001/B316/DS_RP… » vers la page Sources. Refs : #449-F8, #74, #293.

**T-7 · docs(fiche): compléter les lectures plates (dénominateurs, comparaison)** *(humain léger)*
Mobilité : « sur les N types suivis » ; formulation unique du mode t/b par sous-groupe ; suppression des framings-paraphrases. Refs : #449-F11/F12.

**T-8 · décision(product): la promesse de fraîcheur de l'estampille** *(humain)*
Trancher cadence réelle du snapshot Mobilité puis reformuler/supprimer la clause « se rafraîchit sur un rythme lent » ; aligner #203 (même famille). Refs : #449-F1/F2.

Ordre proposé : T-1 → T-2/T-3 (parallèles) → T-5 → T-6 → T-8 (décision) → T-4 (design).

---

## 6. Ce que cet audit ne fait pas

Aucun texte de production modifié : les gabarits `theme_*.json`, `selectors.ts`, `apercu.ts` et consorts sont intacts sur cette branche. Les formulations proposées sont des **motifs** (patterns) à valider, pas des remplacements livrés ; tout ce qui engage la voix (F2, F4, T-4, T-8) est explicitement laissé aux tickets humains (#158 en est le modèle).
