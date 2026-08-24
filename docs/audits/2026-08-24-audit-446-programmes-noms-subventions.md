# Audit #446 — Programmes et subventions : noms développés et détail des subventions

**Date** : 2026-08-24 · **Branche** : `issue/446-programmes-audit` · **Portée** : diagnostic bout-en-bout de l'élément « Programmes et subventions » aux niveaux commune et EPCI — *aucune* modification produit ou pipeline dans ce ticket.

---

## 1. Objet et méthode

L'issue demande d'établir **où** les noms complets des programmes devraient remplacer les seuls sigles, **pourquoi** le détail des subventions manque de substance, et **à quelle couture** l'information disparaît : payload publié, validation/types, sélecteurs, ou rendu. L'audit croise trois sources :

1. **Le payload publié** (`public/data/programmes.json`, commité — 253 lignes d'adhésion, 2 444 lignes de subventions, année de référence 2025) ;
2. **La chaîne applicative réelle** (`payload/types.ts` → `validate.ts` → `selectors.programmesPourTerritoire` → `ApercuOnglet.vue` + `carte/programmesCouches.ts`) ;
3. **La source amont** (l'export SCDL de la Région Bretagne, schéma vérifié sur le catalogue data.bretagne.bzh le 2026-08-24).

Chaque constat ci-dessous est **exécutable** : le harnais `app/src/__tests__/audit-446-programmes.spec.ts` (22 tests) charge le payload commité par le loader réel et épingle l'état publié, la sortie du sélecteur et le DOM rendu.

**Rejouer l'audit** :

```
cd app
npm ci
npx vitest run src/__tests__/audit-446-programmes.spec.ts
# Test Files  1 passed · Tests  22 passed
```

## 2. Exemples répétables sur données réelles

Tous les états du produit existent dans les données publiées et sont verrouillés par le harnais :

| Exemple | Code | État constaté (rendu actuel) |
|---|---|---|
| **Lorient** (commune riche) | 56121 | badges `ACV` lauréate **+ rider « convention valant ORT »**, `CRTE`, `Territoires d'industrie` couverte (EPCI nommé) ; subventions **33 domaines**, total 14 675 127,59 €, pli top-5 + « Voir les 28 autres domaines », part de contexte EPCI |
| **Hennebont** (PVD + convention valant ORT) | 56083 | badges `PVD` (rider), `CRTE`, `TI` ; 13 domaines, total 2 339 392,53 € |
| **Lanvallay** (ORT, non labellisée) | 22118 | badges `CRTE`, `TI` couverte puis badge-outil `ORT` (voix « Dans le périmètre… ») ; jamais double-badge |
| **Aucaleuc** (absence partielle) | 22003 | aucun badge propre ; seulement la couverture descendante de Dinan Agglomération ; **aucune figure de subventions** (rien d'inventé) |
| **Lanildut / Plourin / Trébabu** (état vide réel) | 29112 · 29208 · 29282 | les **trois seules** fiches qui rendent « Aucun programme référencé. » — communes du Pays d'Iroise sans badge propre, sans couverture (l'EPCI ne porte aucun contrat) et sans subvention |
| **Lorient Agglomération** (EPCI complet) | 200042174 | `CRTE` + `TI` couverte, portage nommé **ACV (Lorient)** et **PVD (Hennebont, Languidic, Plouay)** ; subventions : **total seul** 25 245 637,55 € (aucune ventilation), part de région, provenance « communes de l'EPCI » |
| **Dinan Agglomération** (tous programmes) | 200068989 | `CRTE` + `TI` + portage PVD (5 communes) + `ORT` autonome nommant ses 4 communes en périmètre ; cohérent avec la règle anti double-badge (Dinan porte son ORT sur son rider PVD) |
| **Le Pays d'Iroise** (portage sans contrat) | 242900074 | aucune ligne d'adhésion propre ; portage `PVD` (Ploudalmézeau, Saint-Renan) + total 1 033 606,98 € |
| **Cap Atlantique** (zéro badge) | 244400610 | aucun badge de aucune voix ; total seul 153 350 € — la liste de puces rend **vide** (constat DOM §4.2) |
| **Département 22** (agrégat) | 22 | cinq badges « compte » nommés : 11 CRTE, 7 TI, 2 ACV, 26 PVD, 4 ORT ; total sans ventilation |

Couverture d'inventaire : ACV 11 communes · PVD 135 communes · CRTE 58 EPCIs · Territoires d'industrie 32 EPCIs · ORT 11 communes + 6 EPCIs ; subventions 2 378 lignes communales ventilées (39 domaines) + 61 totaux EPCI + 4 départements + 1 région, tous `programme_libl` null hors commune.

## 3. Constat A — les noms développés : perdus au RENDU, pas au payload

### 3.1 Inventaire des sigles rendus → noms officiels

| Sigle affiché | Nom français officiel (autorité : ANCT/DGALN, cf. CONTEXT.md) | Où il apparaît aujourd'hui |
|---|---|---|
| ACV | Action Cœur de Ville | aria-label seul (+ Méthodes) |
| PVD | Petites Villes de Demain | aria-label seul (+ Méthodes) |
| CRTE | Contrat de Relance et de Transition Écologique | aria-label seul (+ Méthodes) |
| Territoires d'industrie | *(officiellement sans acronyme)* | identique visible et accessible — cas sain |
| ORT | Opération de revitalisation de territoire | aria-label seul (+ Méthodes) |

### 3.2 La couture exacte

- **Payload** : les lignes d'adhésion portent le sigle seul (`MembreProgramme` : territoire/type/sigle/drapeau/vintage — types.ts L353). Le fichier `programmes.json` **ne contient aucun nom développé** (assertion du harnais ; seuls les titres de jeux de données apparaissent dans les estampilles vintage). C'est **voulu** : ADR-0013 — « les mots sont l'app ».
- **App** : le vocabulaire complet existe, en DEUX exemplaires bit-à-bit identiques — `NOMS_PROGRAMMES` (`fiche/apercu.ts` L81) et `VOCABULAIRE_PROGRAMMES` (`methodes/programmes.ts` L139). Un correctif de nom doit donc atterrir deux fois (assertion d'égalité dans le harnais).
- **Sélecteur** : `programmesPourTerritoire` propage le sigle et la voix ; rien n'y perd le nom (il n'y entre jamais).
- **Rendu — LA FUITE** :
  - Fiche : `ApercuOnglet.vue` L109-111 — la puce visible rend `{{ badge.sigle }}` seul ; l'expansion complète n'existe que dans `aria-label` (via `libelleBadge`) ; l'attribut `title` **répète le sigle** — le survol n'aide pas ;
  - Carte : `couchesProgrammes` (`carte/programmesCouches.ts` L69) fabrique les couches avec `libelle: sigle` — la barre latérale, la légende et le popup n'ont accès qu'à l'acronyme ;
  - `/methodologie` : le vocabulaire complet est affiché (`MethodesProgrammes.vue`) — **seul endroit visible du site**.

Un visiteur voyant ne rencontre donc jamais « Action Cœur de Ville » sur une fiche ; un lecteur d'écran, toujours. Les tests existants (`apercu.spec.ts`, `apercu-onglet.spec.ts`) épinglent ce partage sigle-visible / nom-accessible sans le questionner.

### 3.3 Traitement recommandé (respectueux des règles établies)

Rendre le nom développé **visible** à côté du sigle — « ACV — Action Cœur de Ville » — en conservant l'aria-label complet existant ; même traitement pour les libellés de couches carte. « Territoires d'industrie » reste tel quel (pas d'acronyme officiel, PRD #162). Le rider « convention valant ORT » et les voix restent inchangés. Aucune règle CONTEXT.md n'impose le sigle nu : la règle du rang (« le glyph ne porte jamais le sens seul », #367) plaide même pour l'inverse.

## 4. Constat B — le détail des subventions : trois réductions successives

### 4.1 La chaîne de réduction

1. **Ingestion (pipeline, `normaliser_subventions_scdl`)** — l'export SCDL porte par convention `objet`, `nomBeneficiaire`, `idBeneficiaire`, `referenceDecision`, `nature`, `conditionsVersement`, `programme_code`, `programme_axe` (schéma catalogue vérifié 2026-08-24) ; le normaliseur n'en garde que **quatre colonnes** (commune, année, `programme_libl`, montant). Tout détail **par convention** disparaît ici, par conception (ADR-0013 : agrégats précomputés, jamais les 101k lignes).
   Note : `programme_libl` est la **nomenclature stratégique par programme (NSP) de la Région Bretagne** — ce sont les domaines d'intervention régionaux, sans lien avec les programmes ANCT badgés à côté.
2. **Publication (pipeline, `calculer_subventions_agregats`)** — ventilation complète par domaine **au niveau communal seulement** ; EPCI/département/région = **total annuel unique** (`programme_libl` null), décision documentée #305 (médiane 13 domaines/EPCI-an jugée illisible).
3. **Rendu (app)** — commune : tri descendant, pli top-5 + révélation (fonctionne : Lorient 33 domaines, bouton « Voir les 28 autres domaines » → « Masquer ») ; agrégats : total + part de contexte + lien de provenance + portail Région. Conforme au contrat #305.

### 4.2 Réponse à la question de l'issue

- **Commune** : le détail existe dans le payload et arrive intact jusqu'au rendu — **rien n'est perdu** entre sélection et affichage (le pli top-5 est une décision d'affichage assumée, révélable).
- **EPCI / département / région** : le détail par domaine **n'existe pas dans le payload publié**. Ce n'est donc pas une perte côté app : le publier exige un changement **pipeline/contrat** (lignes agrégées `programme_libl` non null), qui contredirait explicitement la décision #305 — toute évolution passe par un verdict produit, pas par un ticket technique.
- **Plus fin que le domaine** (projet, bénéficiaire, dispositif) : exige de rouvrir l'**ingestion** (colonnes SCDL actuellement jetées) — changement pipeline majeur, indépendant de #408.

**État vide réel** : l'état « Aucun programme référencé. » n'est atteint que par 3 communes sur 1 202 (§2) ; Cap Atlantique montre le cas intermédiaire — zéro badge mais un total — et rend alors une `<ul>` de puces vide avant la figure (DOM observé ; cosmétique, à noter pour le composant post-#408).

## 5. Articulation avec #408 (architecture active)

#408 est **OPEN** ; ses bloqueurs : #400 CLOSED (verdict **Remove** — les ancres d'identité disparaissent entièrement, pas d'en-tête persistant), #401 CLOSED (page d'indicateur scalaire livrée), **#405 OPEN** (grammaire Repères des profils et listes) — #408 reste donc bloqué par #405 seul.

**Déjà couvert par #408 — ne pas re-ticketner** :
- fiche : premier onglet = Programmes et subventions, retrait d'Aperçu et de sa table d'ancres (`ThemeTabs`, `onglets.ts`, `ApercuOnglet.vue` sont la surface à migrer) ;
- promotion en sixième thème : `theme_programmes.json` devra être accepté — le garde-fou actuel `validerThemeMetadata` (**validate.ts** L1706) **rejette** expressément `theme === 'programmes'` (« jamais un thème ») ; cet amendement fait partie du chantier #408, ce n'est pas un défaut ;
- indicateurs numériques de subventions publiés via les familles scalaires/profil-liste (#405) ;
- le verdict d'en-tête #400 est déjà intégré au CONTEXT.md (statuts 2026-08-21).

**Ce qui survit tel quel à la migration** : ADR-0013 (lignes d'ancrage + jointure app) et ADR-0020, qui liste `programmes` parmi les **tables partagées** lisibles par un thème hermétique — la migration n'impose aucune refonte du payload des badges.

**Non couvert par #408** (= les défauts de ce rapport) : visibilité des noms développés (fiche + carte), duplication du vocabulaire, qualification « Subventions de la Région » (§4.1).

## 6. Cartographie issues ↔ constats

| Constat | Statut | Issue |
|---|---|---|
| Implémentation adhésions + échelle + subventions (sélecteur, rendu, carte, Méthodes) | Livré (#175–#181, #305) — comportement conforme au contrat | — |
| Noms développés invisibles (puces fiche + couches carte) | Défaut de présentation **non couvert** | draft F1 ci-dessous |
| Duplication `NOMS_PROGRAMMES` / `VOCABULAIRE_PROGRAMMES` | Dette **non couverte** | draft F2 |
| « Subventions » = attributions Région (NSP) juxtaposées aux badges ANCT sans qualificatif | Question de formulation **non couverte** (jamais un défaut de données) | draft F3 |
| Détail par domaine aux niveaux agrégés / par convention | Contre-décision assumée (#305 / ADR-0013) — ne pas rouvrir sans verdict produit | — |
| Sixième thème, premier onglet, `theme_programmes.json`, retrait d'Aperçu | Spécifié, bloqué par #405 | #408 |

## 7. Suivis proposés (drafts, prêts à ticketner)

- **F1 — fix(programmes) : rendre le nom développé des badges et des couches visible.** Non bloqué, petit : `ApercuOnglet.vue` (puce : « SIGLE — Nom » visible, title = nom développé), `programmesCouches.ts` (`libelle: nomProgramme(sigle)`), légende/popup si nécessaire ; tests miroir des assertions D du harnais. Si #408 atterrit d'abord, cibler le composant de bloc thème issu de la migration (la couture vocabulaire reste valide).
- **F2 — refactor(programmes) : un registre unique sigle → nom.** Fusionner `VOCABULAIRE_PROGRAMMES` sur `NOMS_PROGRAMMES` (module partagé `fiche/apercu.ts` importé par Méthodes) ; garde : l'assertion d'égalité du harnais devient un import unique.
- **F3 — docs(programmes) : qualifier la figure de subventions.** Décider avec le propriétaire produit si l'intitulé porte « Subventions de la Région » (les données sont exclusivement régionales, cadrage NSP) — alignement CONTEXT.md ; zéro changement pipeline.

*Aucun draft* pour un détail agrégé par domaine ou par convention : contre-décision documentée (voir §4.2).

## 8. Environnement

Worktree propre sur `issue/446-programmes-audit`, aucun incident. `docs/research/` est absent du worktree (notes locales du checkout principal — non citées). Ni R/renv, ni `pipeline/data` sollicités ; aucune donnée inventée — chaque chiffre du rapport provient du payload commité ou du schéma public vérifié.
