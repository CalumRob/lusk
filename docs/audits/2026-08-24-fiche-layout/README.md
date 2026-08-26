# Audit #445 — Fiche : hiérarchie des sous-groupes et mise en page responsive

*Audit de diagnostic browser-evidenced — aucun changement d'UI de production dans ce ticket.*
*Branche `issue/445-fiche-layout-audit` · 2026-08-24 · payload réel committé (`public/data`).*

---

## 1. Boucle de preuve reproductible

Terminal 1 — servir l'app sur le payload réel :

```
cd app && npm ci && npm run dev -- --port 5173 --strictPort
```

Terminal 2 — capturer + mesurer + assertiver (zéro dépendance : Node ≥ 22 + Chrome local) :

```
node docs/audits/2026-08-24-fiche-layout/harness/capture-fiche.mjs [--assert]
```

Le harnais pilote Chrome headless via le protocole DevTools brut et produit, par
capture : une **capture pleine page PNG** + un **JSON de mesures DOM** (rects,
gaps calculés, deltas d'alignement) + un **rapport d'assertions** A1–A5.
`--assert` fait échouer (exit 1) si une assertion est rouge — la boucle est
**rouge-capable** : au premier lancement, les 5 familles d'assertions sont
rouges sur données réelles (29 constats A1, 43 A2, 11 captures A3, 10 A4,
13 A5 — passage complet du 2026-08-24, 14 captures).

**Assertions objectives** (seuils volontairement conservateurs) :

| ID | Question #445 | Seuil rouge |
|----|---------------|-------------|
| A1 | les sous-groupes possèdent-ils leurs cartes ? | écart inter-sous-groupes < gutters de grille + 16 px |
| A2 | une frontière de sous-groupe est-elle visible ? | ni bordure, ni fond, ni padding sur `.sous-groupe` |
| A3 | règle de compacité ~200 px (ADR-0023) | toute figure de grille > 220 px |
| A4 | alignement intra-ligne des cartes | Δy > 2 px sur valeur/libellé/puce/vintage dans une ligne |
| A5 | inset gauche homogène dans une ligne | Δ inset > 1 px (accent 3 px vs 1 px, coquilles imbriquées) |

**Matrice de captures (14)** — Rennes (35238) tous thèmes @1440 ; série
responsive Mobilité @375/768/1024/1100/1920 ; EPCI Rennes Métropole
(243500139) Mobilité ; Ille-et-Vilaine (35) Milieux ; Bretagne (53) Économie
(état sans lecture) ; Allineuc (22001, commune rurale) Mobilité.

Sorties committées : 6 PNG représentatifs + les 14 JSON de mesures dans
`evidence/`. Les 8 PNG restants se régénèrent par la commande ci-dessus.

---

## 2. Constats classés

### F1 — P0 · Les sous-groupes ne possèdent pas visuellement leurs cartes
**Mesures (A1/A2, 14/14 captures rouges).** L'écart vertical entre deux
sous-groupes est **32 px** (`--space-8`), identique au gutter de colonnes de la
grille (32 px) et à peine supérieur au gutter de lignes (24 px). Le
`.sous-groupe` n'a **ni bordure, ni fond, ni padding** : 0 frontière visible
sur les 39 sous-groupes capturés. La page se lit comme un flux continu de
cartes ; le titre serif et le cadrage flottent sans ancre.

**Cause racine (contrat).** `OngletTheme.vue` L284–321 : `.onglet-theme`
empile les `<section class="sous-groupe">` avec `gap: var(--space-8)` ;
`.sous-groupe` est une colonne flex nue. Le conteneur de sous-groupe n'est
**spécifié nulle part** : DESIGN.md §5 (ThemeBlock) décrit overline → lecture →
grille mais pas l'enveloppe de sous-groupe ; ADR-0023 verrouille la coquille de
CARTE, pas celle du groupe. Le contrat de hiérarchie manque — c'est le cœur du
constat #445 « les frontières de sous-groupes ne possèdent pas leurs cartes ».

**Classification :** défaut d'implémentation **+** problème de conception non
couvert (aucune spécification à violer). **Couverture : non couvert** → brouillon **T1**.

### F2 — P0 · Couplage de hauteurs de ligne : les cartes scalaires gonflent au vide
**Mesures (A3 + fill ratio).** `align-items: stretch` (défaut grille) force
toutes les cartes d'une ligne à la hauteur de la plus haute :

| Ligne mixte | Carte dense | Carte étirée | Remplissage |
|---|---|---|---|
| Démographie `structure_age` (327 px) | 0,95 | `densite` 327 px | **0,50** — moitié de la carte est du vide |
| Milieux `conso_enaf_annuel` (528 px) | 0,97 | `artif_par_habitant` 528 px | **0,33** — deux tiers de vide |

C'est la source principale de l'« espace excessif » perçu : une valeur scalaire
unique (« 4 582,06 hab/km² ») centrée sous 160 px de vide.

**Cause racine (contrat).** La grille n'a aucune stratégie d'alignement
inter-anatomies : l'anatomie carte (IndicatorFigure L116–159 : valeur →
libellé → rider → puce → vintage en flux) n'a pas de variante « compacte »
quand la ligne est étirée, et rien ne plafonne la hauteur d'une ligne par la
règle de compacité (qui ne s'applique qu'aux figures, pas aux cartes).

**Classification :** défaut d'implémentation. **Couverture : non couvert**
(#367 plafonne la hauteur des *figures*, pas le couplage de ligne) → brouillon **T4**.

### F3 — P0 · La grammaire des figures n'est câblée que pour la figure compacte déclarée
**Mesures.**
- `iso_alimentation` — famille déclarée **comparison-bars** — rend un **scalaire
  « 0 % » en dalle de 768–992 px de large** (le corps comparison-bars n'existe
  pas : `FigureCompacte.vue` L51–65 retombe sur `heritier`).
- `artif_par_habitant` — comparison-bars déclaré — rend une barre segmentée +
  table 2 lignes (pas les barres M2→M3 vs médiane EPCI/région).
- `conso_enaf_annuel` — indicateur de grille (hors figure compacte) — rend la
  **table des 14 millésimes** : carte de **528,1 px**, **2,6× le plafond
  ~200 px** d'ADR-0023. La « ligne + moyenne EPCI/région » (#367) n'existe pas.
- Les 8 corps de famille ne s'appliquent qu'au champ `figure` du sous-groupe ;
  tout autre indicateur passe par IndicatorFigure (OngletTheme L264–274) —
  scalaire ou table multi-détails, jamais sa famille.

**Classification :** défaut d'implémentation du contrat #367/ADR-0023.
**Couverture : partiellement couvert** — l'épic #367 déclare ces figures dans
sa décomposition, mais aucun ticket ouvert ne les planifie (#372 couvre
distribution/nuages/liste top-5/plot vélo/aria, pas comparison-bars ni la
ligne conso_enaf) → brouillon **T2**.

### F4 — P1 · `evolution_1968` rend sans aucune valeur (perte de contenu)
**Mesures.** La carte « Évolution de la population depuis 1968 » (Démographie,
tous territoires) n'affiche **que libellé + vintage** (h = 92 px, aucun
chiffre, aucune ligne). Payload : une ligne unique, `detail: null`,
`value: 0,276 %`.

**Cause racine.** `FigureTrajectoire.vue` L36–49 : `points` filtre
`detail !== null` **et** détail numérique → 0 point → pas de SVG, pas de liste,
et le corps ne rend **jamais** la valeur scalaire (le drapeau `signe` d'IndicatorFigure
est perdu dans la délégation). L'indicateur est invisible pour l'élu.

**Classification :** défaut d'implémentation. **Couverture : non couvert** → brouillon **T3**.

### F5 — P1 · Rigidité de la grille : dalles par rôle, lignes à trous, paliers fixes
**Mesures.**
- La figure compacte spanne **inconditionnellement 2 colonnes** (`OngletTheme`
  L437–439), même quand c'est un scalaire : `offre_tc` « 100 % » en dalle de
  **992 px** @1024 ; `effectifs_salaries` et `eco_activites` en dalles de
  768 px @1440. À 1024–1100 px (3 colonnes de ~330 px), les libellés longs
  gonflent les cartes à 235–256 px (12 hors-plafond @1100).
- Lignes incomplètes : 1 à 2 cellules vides en fin de grille (motorisation,
  offre TC, structure verte, marché) — `lastRowEmptyCells` = 2 sur 6 grilles @1440.
- Paliers fixes 3/2/1 colonnes à 1024/640 px, sans régime intermédiaire :
  le « demi-desktop » (1000–1280 px) empile soit 3 colonnes serrées, soit
  2 colonnes + dalles pleine largeur.
- Point positif mesuré : à 1920 px le contenu reste plafonné à 1200 px
  (cartes identiques à 1440) — le shell respecte DESIGN.md §4.

**Cause racine (contrat).** Le span est attribué par **rôle** (compacte = 2,
large = full), jamais par **famille ou contenu** ; aucune largeur intrinsèque
n'est déclarée pour les scalaires.

**Classification :** problème de conception non couvert (décision de grille à
prendre côté produit) **+** défaut d'application. **Couverture : non couvert**
(ADR-0023 plafonne la hauteur, pas la largeur ; #195 ne parle que du bloc
lecture) → brouillon **T4**.

### F6 — P1 · Carte de lecture : prose sur-mesure et vide central
**Mesures.** `.lecture-ligne` = `minmax(0,1fr) × minmax(180px,200px)` :
- Desktop : colonne prose de **902 px ≈ 104 caractères/ligne** (confort
  45–75) pour 1–2 lignes de texte ; la figure compacte (180–243 px) colle au
  bord droit ; le centre de la carte (297–344 px de haut) est **vide à ~70 %**
  (Économie, Démographie, Mobilité, Milieux).
- **Habitat : la lecture n'a pas de figure** (le genre `distribution_dpe`
  rend en grille, pas dans le slot lecture) → carte pleine largeur quasi vide
  (« Le parc de Rennes est intermédiaire… », ~70 px pour 1168 px de large).
- Mobile 375 : la carte passe à 472 px (prose au-dessus de la figure) —
  comportement sain.

**Cause racine (contrat).** ADR-0023 : « la prose seule est pleine largeur,
la figure compacte à côté de la prose ». L'implémentation donne à la **carte**
toute la largeur et fixe la figure à 180–200 px, sans mesure de ligne maximale
pour la prose ; le cas « lecture = la figure compacte du sous-groupe »
(Habitat) n'est pas traité.

**Classification :** défaut d'application d'une décision **existante**
(ADR-0023/#367) — pas de décision à rouvrir, la règle suffit si elle était
appliquée (mesure prose ~65–75ch, figure de lecture réellement à côté).
**Couverture : partiellement couverte** — **#195** (« réduire la taille des
blocs Story, tous thèmes ») porte la réduction ; le présent audit lui fournit
des cibles objectives (104ch → ≤75ch ; hauteur de carte 297–344 → ~200 px) ;
le cas Habitat n'est couvert par aucun ticket → repris dans **T2**.

### F7 — P2 · Alignement intra-ligne : puces, vintages et insets désalignés
**Mesures (A4/A5, 9 et 12 captures rouges).**
- Puces de rang décalées de **21–42 px** au sein d'une ligne (présence/absence
  de rider + longueurs de libellé variables) ; vintages Δ21–42 px.
- Lignes mixtes scalaire/figure : libellés Δ**200,3 px** et vintages Δ**163,5 px**
  (`structure_age` × `densite`).
- **Inset gauche** : l'accent de position (border-left **3 px**) décale le
  contenu de **2 px** vs voisines non accentuées (1 px) — mesuré sur 5 lignes ;
  et la figure compacte imbrique sa coquille un niveau sous le wrapper
  `.figure-compacte` (inset apparent 0 vs 17 px pour les cartes directes) —
  incohérence structurelle du contrat de grille (inoffensive à l'œil, piégeuse
  en test).

**Cause racine.** L'anatomie carte est un flux vertical sans slots épinglés ;
l'accent porte sur la bordure au lieu d'un pseudo-élément en gouttière.

**Classification :** défaut d'implémentation. **Couverture : non couvert** → **T4**.

### F8 — P2 · L'estampille snapshot du flagship fuit sur les cinq onglets
**Mesures.** « Analyse calculée le 6 août 2026 — se rafraîchit sur un rythme
lent » se rend sur Mobilité **et** Démographie, Habitat, Économie (y compris
région), Milieux. CONTEXT.md (« Alive ») et ADR-0012 la réservent à l'analyse
flagship Mobilité ; le commentaire de `estampilleSnapshot` (`selectors.ts`
L293) dit « Mobilité at all ». `OngletTheme` L279 la rend sans garde par thème.

**Classification :** défaut d'implémentation (une garde `theme === 'mobilite'`
manque). **Couverture : non couvert** → brouillon **T5** (ticket minime).

### F9 — P3 · Mobile : la longueur des libellés pilote la hauteur des cartes
**Mesures.** @375 : cartes scalaires de 214 à 256 px (libellés payload-owned
longs sur 3 lignes + source 4–5 lignes) ; aucune rupture de layout (colonne
unique propre, tabs scrollables, lecture empilée saine). La règle de compacité
est dépassée par le **texte**, pas par les figures.

**Classification :** pression éditoriale plus que défaut de layout.
**Couverture : partiellement couverte** — #200 (spec de présentation Habitat :
libellés, chips, arrondi) pour Habitat ; la voix des libellés relève de l'audit
sœur **#449**. Pas de nouveau ticket ; les cibles de T4 incluent un plafond de
hauteur mobile.

### F10 — P3 · Adjacent (hors périmètre #445) : lisibilité des figures compactes
Axes tronqués/chevauchés à 200 px et 768 px (histogramme Mobilité « Types de
services pe… » coupé ; quadrant Milieux « tion de population » rogné) ; ligne
prix_m2 plate illisible. **Couvert par l'audit sœur #448** (lisibilité des
figures) — preuves PNG transmises dans `evidence/`, aucun ticket rédigé ici.

### Vérifications positives (périmètre sain)
Couleurs officielles DPE A→G rendues (le carve-out ADR-0023 fonctionne) ;
glyphes de direction ▲/▼ présents sur les puces ; états sans lecture honnêtes
(Économie région, structure verte) ; filigrane discret ; plafond 1200 px tenu
à 1920 ; mobile sans débordement horizontal.

---

## 3. Décisions confirmées — à ne PAS rouvrir

| Décision | Verdict de l'audit |
|---|---|
| ADR-0023 — plafond ~200 px des figures | **Confirmé** ; c'est l'implémentation qui le viole (F2/F3), pas la règle |
| ADR-0023 — prose pleine largeur, figure à côté | **Confirmé** ; l'application manque (mesure de ligne, cas Habitat — F6) |
| ADR-0023 — coquille de carte unique, accent-position, glyphe jamais seul | **Confirmé** ; rendu observé conforme (l'accent 3 px crée le Δ2 px, F7) |
| ADR-0023 — carve-out DPE | **Confirmé** ; couleurs officielles observées |
| #367 — décomposition en sous-groupes payload-owned | **Confirmée** ; le contrat métadonnée fonctionne (14 captures, 39 sous-groupes, zéro clé brute rendue) |

---

## 4. Couverture par les tickets existants

| Constat | #367 | #372 | #195 | #199/#390 | #200 | #448 | #449 | Verdict |
|---|---|---|---|---|---|---|---|---|
| F1 hiérarchie sous-groupes | décomposition seule | — | — | — | — | — | — | **non couvert** → T1 |
| F2 couplage de hauteurs | — | — | — | — | — | — | — | **non couvert** → T4 |
| F3 corps comparison-bars / conso_enaf | déclaré, non planifié | non inclus | — | — | — | — | — | **partiel** → T2 |
| F4 evolution_1968 sans valeur | mention | — | — | — | — | — | — | **non couvert** → T3 |
| F5 rigidité de grille / dalles | hauteur seule | — | — | — | — | — | — | **non couvert** → T4 |
| F6 lecture : mesure + Habitat | règle seule | partiel (autres genres) | **couvre la réduction** | — | — | — | — | **partiel** → cibles #195 + T2 |
| F7 alignement intra-ligne | — | — | — | — | — | — | — | **non couvert** → T4 |
| F8 estampille hors Mobilité | — | — | — | — | — | — | — | **non couvert** → T5 |
| F9 libellés longs mobile | possède les libellés | — | — | pyramide | Habitat seul | — | voix éditoriale | partiel — pas de ticket |
| F10 lisibilité figures compactes | — | — | — | — | — | **couvert (sœur)** | — | pas de ticket |

---

## 5. Brouillons de tickets de suivi (ready-to-file)

### T1 — feat(fiche): le sous-groupe possède visuellement ses cartes (P0)
**Problème.** `.sous-groupe` est une section nue ; l'écart inter-groupes
(32 px) ≤ gutters internes (24/32 px) : la hiérarchie s'inverse (A1/A2 rouges
sur 14/14 captures).
**Changement demandé (décision + implémentation).** Spécifier l'enveloppe de
sous-groupe dans DESIGN.md §5 (sur-titre + règle d'ancrage du titre, p. ex.
filet `-line` du thème ou fond `-soft` léger) puis l'implémenter dans
`OngletTheme.vue` : séparation inter-groupes ≥ 48 px **ou** frontière visible
par groupe.
**Critères testables.** (1) Le harnais #445 passe A1/A2 sur les 14 captures
(`--assert` exit 0). (2) `onglet-theme.spec.ts` : chaque `.sous-groupe` porte
la classe/le décor de frontière ; l'écart inter-groupes mesuré ≥ 48 px ou
frontière présente. (3) Aucune régression `sous-groupes.spec.ts`.
**Hors périmètre.** Le contenu des cartes (T2/T4).

### T2 — feat(fiche): corps de figures manquants de la grammaire (P0)
**Problème.** comparison-bars n'a pas de corps (iso_* → dalle scalaire ;
artif M2→M3 → barre segmentée) ; conso_enaf rend une table 14 lignes de
**528 px** (2,6× le plafond ADR-0023) au lieu de la « ligne + moyenne
EPCI/région » ; la lecture Habitat (état énergétique) n'a pas de figure à
côté de la prose.
**Changement demandé.** Étendre `FigureCompacte` : corps `comparison-bars`
(barres verticales non empilées + médiane EPCI/région, iso_* et artif M2→M3) ;
appliquer la famille `trajectory` (ligne + moyenne) à `conso_enaf_annuel` en
grille ; rendre la figure compacte du sous-groupe DANS le slot lecture quand
la lecture est celle du sous-groupe (Habitat). Plafond ~200 px partout.
**Critères testables.** (1) `figure-compacte.spec.ts`/`onglet-theme-*.spec.ts` :
iso_alimentation rend des barres comparatives avec référence médiane ;
conso_enaf rend un SVG ≤ 200 px + série accessible ; Habitat : la figure DPE
est dans `.sous-groupe-lecture`. (2) Le harnais #445 : zéro figure > 220 px
sur Rennes/Allineuc/EPCI/dépt (A3 vert). (3) Parité métadonnée inchangée
(`theme-metadata.spec.ts`).
**Hors périmètre.** Les corps déjà livrés (DPE, pyramide, trajectoire prix).

### T3 — fix(fiche): evolution_1968 doit rendre sa valeur signée (P1)
**Problème.** FigureTrajectoire exige des détails numériques ; la ligne unique
`detail: null` de `evolution_1968` produit une carte sans valeur ni figure —
l'indicateur est invisible (tous territoires, onglet Démographie).
**Changement demandé.** Rendre la valeur signée (`+0,3 %`) quand `< 2` points
(repli scalaire, drapeau `signe` conservé) ; garder la ligne pour les séries
multi-millésimes (prix_m2).
**Critères testables.** `figure-grammaire.spec.ts` (ou nouveau spec
trajectoire) : payload réel Rennes → la carte `evolution_1968` expose une
valeur commençant par « + » ; payload prix_m2 → SVG présent. Zéro régression
`onglet-theme.spec.ts`.

### T4 — feat(fiche): anatomie de grille — largeurs, lignes, alignement (P1, décision produit)
**Problème.** Trois défauts couplés : (a) span-2 inconditionnel → dalles
scalaires de 768–992 px et lignes à 1–2 cellules vides ; (b) `stretch` →
cartes scalaires gonflées au vide (densite fill 0,50 ; artif fill 0,33) ;
(c) puces/vintages/insets désalignés (Δ21–42 px ; Δ2 px d'accent).
**Décision produit à trancher** (options chiffrées par le harnais) : largeur
des scalaires (1 colonne fixe vs `minmax` intrinsèque vs span par famille) ;
stratégie de ligne (aligner en haut + plafonner la ligne vs masonry) ; slots
épinglés (puce/vintage alignés par ligne) ; accent en pseudo-élément (gouttière
au lieu de border).
**Critères testables (indépendants de l'option).** (1) Aucune carte scalaire
> 260 px de haut ni > 600 px de large sur les captures de référence ;
`lastRowEmptyCells` documenté/accepté par thème. (2) A4/A5 du harnais verts
(Δ ≤ 2 px). (3) `indicateur-figure.spec.ts` : la puce et le vintage portent des
classes testables ; l'accent n'altère pas l'insert du contenu.
**Hors périmètre.** Les corps de figures (T2), la carte de lecture (#195).

### T5 — fix(fiche): l'estampille snapshot ne se rend que sur Mobilité (P2, minime)
**Problème.** `estampilleSnapshot` (réservée flagship Mobilité — ADR-0012,
CONTEXT.md « Alive ») se rend sur les cinq onglets.
**Changement demandé.** Garde `theme === 'mobilite'` dans `OngletTheme` (ou
paramètre thème dans le sélecteur).
**Critères testables.** `onglet-theme.spec.ts` : estampille présente sur
mobilite, absente sur les quatre autres thèmes (payload réel).

---

## Annexe A — Chiffres clés (extrait des 14 JSON de mesures)

| Capture | Sous-groupes | Figures > 220 px | Lignes désalignées | Dalle compacte max | Lecture : prose / hauteur |
|---|---|---|---|---|---|
| rennes-mobilite-1440 | 4 | 10 (max 256 px) | 3 | 768 px | 902 px ≈ 104 ch / 340 px |
| rennes-demographie-1440 | 2 | 2 (327 px, fill 0,50) | 1 | 768 px | 902 px / 340 px |
| rennes-habitat-1440 | 3 | 3 (302 px) | 2 | 768 px | **sans figure** / ~70 px |
| rennes-milieux-1440 | 1 | 2 (**528 px**, fill 0,33) | 1 | 768 px | 902 px / 344 px |
| rennes-mobilite-1024 | 4 | 0 | 0 | **992 px** | 726 px ≈ 84 ch |
| rennes-mobilite-1100 | 4 | 12 (235–256 px) | 3 | 691 px | 812 px |
| rennes-mobilite-768 | 4 | 9 | 3 | 736 px | 470 px ≈ 54 ch |
| rennes-mobilite-375 | 4 | 13 | 0 | 343 px | 293 px ≈ 34 ch / 472 px |
| rennes-mobilite-1920 | 4 | 10 | 3 | 768 px (plafond 1200 tenu) | 902 px |
| region-economie-1440 | 2 (sans lecture) | 0 | 0 | 768 px | — |

## Annexe B — Fichiers

- `harness/capture-fiche.mjs` — harnais (zéro dépendance, assertions A1–A5).
- `evidence/*.metrics.json` — les 14 mesures ; `evidence/*.png` — 6 captures
  citées (les autres se régénèrent).
- Captures citées : `rennes-mobilite-1440`, `rennes-demographie-1440`,
  `rennes-habitat-1440`, `rennes-milieux-1440`, `rennes-mobilite-1024`,
  `region-economie-1440`.
