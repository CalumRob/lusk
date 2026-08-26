# Audit — figures de la fiche : lisibilité, hiérarchie visuelle et grammaire réelle

**Issue #448 · 2026-08-24 · diagnostic, aucune modification de production.**
Branche `issue/448-figure-grammar-audit`. Périmètre : la grammaire des figures de la fiche (ADR-0023, DESIGN.md §9) confrontée au payload réel et à la lecture réelle, sur fiche rendue dans Chrome.

---

## 1. Méthode — la boucle de preuve reproductible

Un harnais CDP (Chrome DevTools Protocol) zéro-dépendance (`harness.mjs`, Node ≥ 21, WebSocket natif) pilote le Chrome local, ouvre chaque route de fiche, attend le rendu Vue + ECharts, puis extrait **boîtes de layout, styles calculés, textes rendus** (`evidence/*.json`) et **captures pleine page** (`evidence/*.png`).

```powershell
# 1. dépendances + serveur de dev
npm ci --prefix app
Start-Process cmd '/c npm run dev -- --port 5173 --strictPort > ..\..\dev-server.log 2>&1' -WorkingDirectory app -WindowStyle Hidden
# 2. la boucle — 21 routes (3 communes × thèmes, EPCI, département, région)
node docs/audits/2026-08-24-figure-grammar/harness.mjs --base http://localhost:5173
# 3. capture ciblée — la commune à saillance vélo maximale (Kernilis 29093, Δ = 31)
node docs/audits/2026-08-24-figure-grammar/capture-velo.mjs
```

Sortie (exécuté le 2026-08-24, payload commité `public/data/`, build Vite dev) :

```
→ commune-rennes-mobilite … → region-bretagne-milieux   (21 routes, ~75 s)
OK — evidence in docs/audits/2026-08-24-figure-grammar/evidence
```

**Routes / territoires utilisés** : Rennes (35238), Concarneau (29039), Plouray (56170, rural), Kernilis (29093, saillance vélo max), Lorient Agglomération (200042174), Finistère (29), Bretagne (53) — × les cinq thèmes. Familles atteintes : scalar, composition (héritée + DPE), trajectory, comparison-bars (déclarée), pyramid (déclarée), list (lecture LQ), distribution + nuages (lectures). Aucune donnée R/renv ni `pipeline/data` utilisés — le payload commité suffit.

---

## 2. Constat d'ensemble

La coquille de carte (label payload-owned, estampille, voix récit) et les cartes **scalaires** sont le point fort : aucune clé brute ne rend nulle part (contrat #318/#362 tenu), les valeurs sont proéminentes (32 px Manrope 600), les puces de rang portent le glyphe ET la phrase accessible, l'accent de position est discret et sans couleur de statut. Le DPE porte les couleurs officielles A→G (le carve-out ADR-0023 est réel).

Mais **quatre des huit familles de la grammaire n'ont pas de corps de rendu atteignable**, la règle de compacité n'est appliquée nulle part (pire carte : 528 px), la puce de rang **disparaît de toute figure multi-détails**, la liste top-5 Économie est tronquée et illisible, et la story vélo — résolue par le pipeline — ne rend jamais sa prose. Le détail, famille par famille, en §4.

---

## 3. Causes racines au contrat partagé (figure/carte)

### A1 — Le vocabulaire des familles est déclaré mais pas dispatché : 4 familles sur 8 se dégradent silencieusement en corps hérité

`FAMILLES_FIGURE` (`app/src/payload/types.ts`) autorise huit familles ; le validateur les accepte toutes ; la métadonnée commitée déclare `comparison-bars` (Mobilité · iso_alimentation, Milieux · artif_par_habitant), `pyramid` (structure_age), `composition` (×4), `scalar` (×3), `trajectory` (×3). Or `FigureCompacte.corps()` ne branche que sur `scalar` (+ offre_cyclable), `composition` (+ DPE, + pyramide) et `trajectory` — **tout le reste tombe dans `heritier`** (IndicatorFigure segmentée) :

- **`pyramid` → corps hérité** : la vraie pyramide deux côtés EXISTE (`FigureCompositionPyramide.vue`, testée verte) mais est **inatteignable en production** : le branchement exige `famille === 'composition' && clef === 'structure_age'` alors que `theme_demographie.json` déclare `"family": "pyramid"`. Code mort. Preuve : `commune-rennes-demographie.png` — structure_age rend une barre segmentée + **14 tranches aux libellés dupliqués** (« Moins de 15 ans » ×2, sans nom de sexe), 768×327 px.
- **`comparison-bars` → corps hérité** : la figure promise (#367 : barres verticales non empilées + médiane EPCI/région) n'existe pas. Les cinq iso_\* rendent comme **cinq cartes scalaires séparées** ; artif_par_habitant rend M2|M3 comme **une barre empilée à deux segments** — deux états sommés comme des parts d'un tout (166,57 + 156,86 m²/hab), sémantiquement faux. Preuve : `commune-rennes-milieux.png`, JSON `figuresCompactes`.
- **Les tests masquent la faille** : `figure-compacte.spec.ts` monte structure_age avec `famille: 'composition'` et artif_par_habitant avec `famille: 'trajectory'` — **des noms de famille qui ne sont pas ceux de la métadonnée livrée**. Les fixtures et le payload n'ont jamais partagé le même vocabulaire ; les tests passent, la production diverge. C'est la couture exacte : **le sélecteur de corps et la métadonnée ne sont liés par aucun test de parité**.

### A2 — La règle de compacité n'est appliquée nulle part, et elle mesure le mauvais élément

- **Aucun clamp** : seul `FigureListeLQ` porte `max-height: var(--figure-compact-max-height)` (200 px). Rien n'empêche conso_enaf_annuel à **368×528 px** (2,6× la règle), structure_age 327 px, statut 303 px, âge_du_bati 286 px, tot_loss_b 256 px. La règle « aucune figure ne dépasse ~200 px » (ADR-0023, DESIGN.md §9) est une aspiration, pas un mécanisme.
- **Le plafond s'applique à la carte entière, pas à la surface de tracé** : les lectures ECharts rendent dans un canvas de 200×180 px (`--figure-compact-height`), mais la config `grid { left: 56, right: 24, top: 32, bottom: 44 }` (identique dans les trois graphiques) laisse **120×104 px de zone de tracé**. Les noms d'axes (11 px) et graduations (10 px) se partagent ces 120 px : la distribution Mobilité de Rennes se réduit à une tache (preuve : `commune-rennes-mobilite.png`), les libellés d'axes du quadrant Milieux sont coupés (« …ion de population 2017-2023 (‰/an) »).
- **Le slot de lecture se dépasse lui-même** : contexte + canvas s'empilent à **243 px (Rennes) et 285 px (Kernilis, nom d'EPCI long sur 4 lignes)** — la colonne de lecture viole la règle qu'elle est censée illustrer.

### A3 — La coquille de carte n'est pas partagée : puce et accent disparaissent dès qu'une figure est multi-détails

`IndicatorFigure` rend `PuceRang` sous `v-if="puce && !multi"` — **toute clé multi-détails perd sa puce ET son accent** (l'accent exige la puce) : voitures_menage, statut, type, mix_logements, âge_du_bati, structure_age, reseaux, artif_par_habitant, conso_enaf_annuel, prix_m2, distribution_dpe. Or le payload porte les rangs (artif rang_epci = 1/43 pour Rennes — invisible). Le #200 (« la puce lit le scalaire classé, pas la première ligne ») reste **entièrement à faire** : quand l'accent rend, il lit `lignes[0]` (statut → le rang de « proprietaire », pas celui de HLM, le détail classé déclaré).

`FigureTrajectoire` et `FigureListeLQ` n'ont ni puce ni accent par construction ; `FigureTrajectoire` perd en plus le drapeau signe (evolution_1968) et **exclut la ligne à détail null — la médiane poolée classée de prix_m2 (rang 43/43) ne rend jamais** ; seuls les millésimes annuels s'affichent.

**L'estampille vintage domine la carte** : 2 à 4 lignes de légende par carte (« INSEE — Population active et chômage (dossier complet, principaux indicateurs, exploitation principale) · 2023 · réf. … · publ. … »). Sur la lecture Milieux, la ligne Source concatène **9 citations OCS-GE — 959 caractères**, plus haute que la prose + figure réunies (preuve : `region-bretagne-milieux.png`). La fraîcheur noie la valeur.

### A4 — La précision affichée est fausse partout où l'unité n'est pas « % »

`formaterValeur` garde 2 décimales hors « % » : **« 4 582,06 hab/km² »** (densité de Rennes), **« 166,57 m²/hab »**, **« 3 731,87 €/m² »**, **« 13,76 places / 1 000 hab »**. Pire : la médiane pondérée d'un compte produit **« 783,5 accès perdus »** (tot_loss_b, EPCI Lorient) — un demi-accès. La hiérarchie « chiffre important » en souffre : un nombre à 2 décimales se lit comme un calcul, pas comme un fait.

---

## 4. Évaluation famille par famille (preuves : `evidence/*.json|png`)

| Famille | Déclarée où | Rend réellement | Verdict |
|---|---|---|---|
| **scalar** | ×3 (offre_tc, effectifs, éco_activites) | valeur 32 px + unité + puce + accent | **Fonctionne** — le contrôle positif non-scatter. Résidus : précision 2-déc., « 1er/1 » (Concarneau, stationnement vélo/voiture — un groupe de un n'est pas un rang), zéro-trou-de-donnée classé meilleur (Plouray/Kernilis « 0 places / 1 000 hab ▼ 1er » — l'absence de cartographie OSM lue comme excellence) |
| **composition** | ×4 (mix, statut, type, voitures, +DPE) | barre segmentée **monochrome** + liste de tranches (DPE : couleurs officielles ✓) | **Faible** — une seule teinte (`--couleur-strong`) pour toutes les parts : le #202 (une couleur par part) n'est jamais sorti ; la grammaire promet des barres non empilées. voitures_menage : l'ordre payload `deux_plus → sans_voiture → une_voiture` met la part classée (sans voiture, la « une » du #367) en **deuxième** position |
| **trajectory** | ×3 (evolution_1968, prix_m2, conso_enaf) | sparkline 40 px + liste d'années en flux | **Faible à cassé** — evolution_1968 = **carte vide** (une seule ligne scalaire, zéro point traçable, 768×92 px) ; conso_enaf = **table de 14 années, 528 px**, sans la moyenne EPCI/région promise ; prix_m2 perd sa médiane classée (A3) ; pas de puce, pas de signe |
| **comparison-bars** | ×2 (iso_alimentation, artif_par_habitant) | **n'existe pas** → corps hérité (A1) | **Contradictoire** — la figure « matière » du sous-groupe accès aux services ne rend jamais ; les 5 iso_\* sont 5 scalaires séparés ; artif M2→M3 est une barre empilée d'états (sens absurde) |
| **pyramid** | ×1 (structure_age) | **inatteignable** → corps hérité 14 tranches (A1) | **Contradictoire** — le corps deux côtés existe, testé, jamais rendu |
| **distribution** (lecture) | story_key vingt-minutes/vélo | courbe de densité + nuage + 2 médianes en 200×180 (tracé 120×104) | **Trop petit** — illisible sur Rennes (tache), tenable sur Kernilis ; la marque vélo est présente ✓ (#194 plot restauré) |
| **relationship/cloud** (lectures) | soldes, quadrant | nuage quadrant en 200×180 | **Contrôle positif scatter** — le seul type qui survit à 200×180 (un nuage se dégrade en forme) ; axes coupés mais lecture du point possible |
| **list** (lecture) | Économie LQ | table 200×200, `overflow: hidden` | **Cassé** — voir §5 |

**La rangée de lecture** : prose Newsreader 18 px ✓ (la voix est bonne), mais la carte de lecture est ~60 % de vide au niveau commune (1 ligne de prose contre une colonne de 200 px) ; la lecture Habitat est **texte pur** (bandeau de 29 px, la figure DPE qu'elle raconte reste dans la grille en dessous — déconnectés) ; les unités manquent dans les phrases payload-owned : « **4,99 par an** (naturel) » sans ‰/an (Démographie), « **5,4 de passoires thermiques** » sans % (Habitat) ; et la copie Économie dit « La **commune** se spécialise » **sur les fiches EPCI et département** (template hardcodé, `theme_economie.json`).

---

## 5. La liste top-5 Économie (l'échec nommé par l'issue)

Preuve : `commune-rennes-economie.png` + JSON `listeLQ` (toutes fiches Économie).

1. **Tronquée** : `max-height: 200px` + `overflow: hidden` — le **rang 5 est clippé** (4 lignes visibles sur 5, partout : Rennes, Concarneau, Plouray, Lorient, Finistère).
2. **Illisible** : `white-space: nowrap` + ellipsis dans 200 px — **5/5 noms d'activité tronqués** (« Activités scien… », « Autres activité… »). « Activités scientifiques et techniques ; services administratifs et de soutien » ne peut pas être lu, jamais.
3. **L'en-tête wrappe sur 3 lignes** (« Rang / Activité dominante / Location quotient (LQ) ») dans les 200 px.
4. **La prose ne nomme que le rang 1** ; la liste montre 5 — phrase et figure ne coopèrent pas.
5. **« Location quotient (LQ) »** — l'anglais fuit dans l'UI (le libellé produit est « Spécialisation des établissements », CONTEXT.md).
6. Le grain A17 (#154/#428) fonctionne ✓ — plus de bruit à établissement unique (LQ 2,1 / 1,9 / 1,4 sur Rennes).

La liste ne « lit pas comme une liste » parce qu'elle est rendue comme une **colonne de lecture de 200 px** — le conteneur d'une figure nuage, pas d'un tableau de 5 rangées de texte.

---

## 6. Verdict : la règle des ~200 px est-elle mal implémentée ou mauvaise ?

**Mal implémentée, d'abord ; à amender, ensuite — pas à rouvrir.**

1. **Mal implémentée** (factuel) : aucun mécanisme ne l'applique (A2) — les pires contre-exemples (528 px, 327 px) ne sont même pas des figures ECharts mais des listes de tranches non bornées ; et là où elle s'applique (lectures), elle plafonne la carte entière alors que les insets ECharts fixes (156 px sur 380) mangent plus de la moitié de la surface — le « trop petit » ressenti est un **plafond appliqué au mauvais élément**.
2. **Le contrôle positif scatter tranche le doute** : le nuage quadrant et le soldes restent lisibles à 200×180 parce qu'un nuage porte sa forme ; la distribution à deux médianes ne l'est pas (10 points de densité + nuage + 2 marques dans 120×104 px). La règle n'a pas besoin d'être abandonnée, elle a besoin d'un **plancher de surface de tracé par famille** (ex. : nuage ≥ 120×104 ok ; distribution ≥ ~300 px de large ou marques simplifiées) et d'un **clamp réel** sur les corps de grille.
3. **Conflit produit réel, unique** : ADR-0023 dit « seule la prose est pleine largeur ; la dalle pleine largeur est retirée » — l'app garde `reseaux` et `structure_age` en `figureLarge()` (1168 px de large). Deux dalles survivent **par décision app-side non enregistrée dans l'ADR**. À trancher : amender l'ADR (exceptions listées) ou supprimer `figureLarge()`.
4. **Conflits ADR ↔ app à enregistrer** : « toute figure de grille partage la coquille (label + puce + vintage) » est contredit par la suppression `!multi` (A3) et par l'absence de puce dans trajectory/liste ; la promesse comparison-bars « + médiane EPCI/région » n'a aucun corps. Ce sont des **écarts d'implémentation** à l'ADR, pas des réfutations — l'ADR reste bon.

---

## 7. Cartographie des issues existantes

| Issue | État au vu de l'audit | Preuve |
|---|---|---|
| **#194** (story Mobilité, plot vélo, sous-titre « à », nom coloré) | **Partielle** — le plot est restauré (Kernilis : la distribution à deux médianes rend ✓) mais **la prose vélo ne rend jamais** : la ligne resolved `story_key = ce-que-le-velo-preserve` (Δ = 31, la plus forte de Bretagne) rend le template par défaut « Sans voiture, 38 types… » — `lecturePour` lit le template de la métadonnée, jamais le `story_key` de la ligne pour la copie. Le sous-titre dit toujours « **de** Kernilis et des communes de… » (le « à » décidé n'est pas livré). | `commune-guipavas-velo.png`, `histoires_mobilite.json` |
| **#200** (Habitat : libellés, chips sur scalaire classé, arrondi) | **Partielle** — libellés ✓ (aucune clé brute, partout) ; **chips absentes de toute figure multi-détails** (statut, âge, type, mix) et le pointeur reste la première ligne, pas le scalaire classé (HLM) ; arrondi « plus grande reste » non vérifiable côté UI (le payload somme juste). | `commune-rennes-habitat.png` |
| **#202** (palettes catégorielles — jamais deux clés de la même couleur) | **Non couverte** — toutes les barres segmentées restent monochromes (`--couleur-strong`) : mix, statut, type, voitures, artif. Le carve-out DPE (couleurs officielles) est le seul multi-teintes. | idem |
| **#293** (carte : unités des couches Story) | **Non apparentée** (côté carte, pas fiche) — ouverte, rien de commun avec les seams de cette audit ; à traiter séparément. | — |
| **#367** (épic follow-up UI) | **Partielle** — la machinerie (métadonnée → mapper partagé → coquille) est livrée et propre ; mais 4/8 familles sans corps, compacité inappliquée, chips supprimées en multi, iso_\* sans figure de comparaison, pyramide morte, moyenne EPCI/région absente des trajectoires. | §3–§4 |
| **#372** (lectures compactes : distribution, nuages, liste top-5, plot vélo, aria) | **Partielle/contradictoire** — distribution + nuages rendent compacts ✓, plot vélo ✓, aria résolus ✓ (aucune clé brute) ; mais **la liste top-5 est l'échec nommé, toujours là** (§5), la prose vélo manque, le « rien ne dépasse ~200 px dans la rangée de lecture » est faux (243–285 px), la lecture Habitat est texte pur sans carte compacte à ses côtés. | §5, A2 |

**Travail non couvert par aucune issue** : le dispatch de familles (A1), le clamp de compacité + plancher de tracé (A2), la puce multi-détails + pointeur scalaire classé (A3, débordement de #200/#367), la précision des nombres (A4), le poids des estampilles (A3), « 1er/1 » et zéro-trou-de-donnée classé meilleur (§4 scalar), « La commune » sur fiches EPCI/département (§4), unités manquantes dans les prose (§4).

---

## 8. Brouillons de tickets de suivi (ordre de dépendance)

1. **fix(figures) : dispatcher les huit familles — `comparison-bars` et `pyramid` atteignables** (P0). Brancher `FigureCompacte` sur les familles déclarées ; corps comparison-bars (barres verticales + médiane) ; test de parité **métadonnée livrée ↔ sélecteur de corps** (monter depuis `theme_*.json`, plus jamais depuis des familles de fixture). Débloque 2, 4, 8.
2. **fix(lecture) : la prose lit le `story_key` de la ligne ; sous-titre « à »** (P0, reste de #194). Le vélo doit produire SA phrase (les deux marques nommées) ; « de » → « à » dans `descriptionNuage`.
3. **fix(liste-LQ) : la top-5 lit comme une liste** (P0, l'échec nommé). Sortir la liste de la colonne 200 px (pleine largeur de la rangée de lecture ou carte dédiée), wrapper les libellés, 5/5 rangées visibles, libellé FR, « Le territoire se spécialise » (neutraliser « La commune »).
4. **fix(coquille) : puce + accent sur toute figure classée, pointeur = scalaire classé** (P1, reste #200/#367). Retirer `!multi`, lire le détail classé déclaré (statut→HLM, mix→principales…).
5. **chore(compactité) : appliquer la règle — clamp réel + plancher de surface de tracé par famille** (P1). Amender ADR-0023 (ou ADR-0024) : le plafond s'applique au bloc figure, la distribution exige ≥ ~300 px de tracé ou des marques simplifiées ; trancher les deux dalles `figureLarge()` (reseaux, structure_age).
6. **fix(format) : précision honnête** (P1). Entiers pour les comptes (pas de « 783,5 accès »), 0 décimale pour densité/prix/places, unité dans la prose (‰/an, %).
7. **fix(estampille) : une ligne par carte** (P2) — source court + millésime ; la citation exhaustive reste en Méthodes/Sources. La lecture Milieux cite 9 OCS-GE (959 car.) aujourd'hui.
8. **feat(composition) : une couleur par part** (P2, #202) — palette catégorielle par thème, DPE inchangé.
9. **fix(données-UI) : les trous de données ne classent pas « 1er »** (P2) — zéro-non-cartographié ≠ excellence ; « 1er/1 » se supprime (groupe de un, pas un rang).

---

## 9. Inventaire des preuves

- `harness.mjs` — la boucle (21 routes, CDP zéro-dépendance) ; `capture-velo.mjs` — la capture ciblée vélo.
- `evidence/*.json` (22) — layout DOM : boîtes, polices, puces (texte + aria), tranches, canvas, listes LQ par route.
- `evidence/*.png` (9 représentatives) : `commune-rennes-{demographie,mobilite,habitat,economie,milieux}`, `commune-guipavas-velo` (saillance vélo max), `commune-plouray-milieux` (rural, conso_enaf 528 px), `epci-lorient-economie` (« La commune » sur EPCI), `region-bretagne-milieux` (source 959 car.).
