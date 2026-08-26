# Audit Repères — grammaire visuelle et analytique des Pages d'indicateur

**Ticket** #479 · **Date** 2026-08-26 · **Commit audité** `c57b737` (origin/main au moment de la passe finale) · **Chrome** headless-new (Windows), pilotage CDP natif · **Branche** `issue/479-indicator-figure-audit`

## 1. Cadre et périmètre

Audit de la grammaire des figures **Repères** sur les **34 Pages d'indicateur publiées** des six thèmes, après les reconstructions #439–#441 et les correctifs ultérieurs (#466, #472, #474, #483/#484, #490). Sont évalués : choix de figure par famille sémantique, honnêteté d'agrégation, facette active, dérivation d'échelles, zone de plot, libellés, unités, extrêmes/égalités/nuls, mise en avant du territoire actif, cohérence figure↔extrêmes↔tableau, comportement responsive et accessibilité ciblée.

La vue **Carte est volontairement exclue** : vide à ce stade, état attendu (`vue-carte-exclude-roadmap` capturé comme preuve positive du shell sans erreur). Aucune modification de production n'est livrée dans ce ticket.

## 2. Méthode — boucle reproductible

Harness zéro-dépendance [`harness/audit.mjs`](harness/audit.mjs) : spawn d'un serveur Vite dev + Chrome headless piloté par CDP (WebSocket natif Node ≥ 22). Pour chaque page publiée (source unique `public/data/theme_*.json`) :

- état par défaut **desktop (1280×900)** + **mobile (390×844, émulation réelle)** ;
- chaque niveau publié (`commune`, `epci`, `departement`) ;
- un territoire mis en avant (rang médian déterministe, `?territoire=…`) ;
- recoupage **contre une réimplémentation indépendante** du modèle (médiane, rangs ex-aequo ADR-0015, extrêmes, périmètre) lue depuis le payload committé ;
- états transversaux : égalités maximales, valeurs incomplètes, territoire hors niveau, vues Carte/L'indicateur ;
- captures JPEG desktop/mobile (`evidence/shots/`, 84 fichiers) et manifest complet (`evidence/manifest.json`, 39 entrées).

```bash
node docs/audits/2026-08-26-indicator-figure-audit/harness/audit.mjs [--no-shots] [--only <theme/key>]
```

### Résultat final (passe de référence)

```
02:13:12 Manifest écrit : 39 entrées.
02:13:12 TOTAL: 4276 vérifications, 8 non passantes
```

Les **8 non-passantes** portent toutes sur `programmes/subventions_par_domaine` et partagent une cause unique (constat P0-1). Les 33 autres pages sont vertes sur tous leurs états.

### Corrections du harness pendant l'audit (v1 → v2)

La première passe complète (4276 vérifs, 188 KO) a été **invalidée puis remplacée** ; le manifeste v1 ayant été écrasé par une exécution de débogage `--only`, seule la passe finale fait foi. Corrections appliquées au harnais — chaque KO v1 a été reclassé *défaut applicatif*, *artefact de mesure* ou *attendu* :

| Artefact v1 | Cause | Reclassification |
|---|---|---|
| `extremes.valeur-recoupee {rendu:872, attendu:"872"}` | double passage ×100 côté harnais pour `%` + tolérance inadaptée aux arrondis d'affichage | artefact — comparaison formaté↔formaté corrigée |
| `unites.pourcent-echelle-0-100` / `pas-de-fraction-brute` sur `evolution_1968` | bornes 0–100 appliquées à une grandeur signée non bornée (+872 %, −21 % légitimes) | artefact — bornes restreintes aux parts bornées ; mesure `grandeur-signee-relevee` sinon |
| `table.caption-perimetre` / `nb-lignes` / `glyphe-direction` nuls sur pyramid/composition | ces familles ne rendent **pas** le slot partagé (pas de tableau, choix d'implémentation) | reclassé constat produit **P1-2** ; vérification conditionnée + mesure factuelle |
| `pyramide.facette-active-marquee` vrai sans `?territoire=` | la pyramide marque la cellule de la **facette active** (détail+sexe, US28), pas un territoire | artefact — sémantique corrigée dans le check |
| `highlight.ligne-selectionnee` / `marqueur-densite` nuls sur familles sans héros/tableau | checks appliqués à des familles qui ne rendent pas ces surfaces | artefact — gating sur présence |
| `trajectoire.echelle-du-domaine-reel <20 vb` | seuil arbitraire ; le rendu est fidèle au domaine réel (#438) | recomposé en **mesure** `occupation-verticale-relevee` → constat analytique P1-3 |
| états « mobile » mesurés à 1280px | `naviger()` ne déduisait pas les dimensions du drapeau mobile | **corrigé** — émulation 390×844 réelle, captures refaites |
| transversaux ties/incomplets naviguant vers `/indicateurs/undefined/undefined` | `ties.theme` au lieu de `ties.page.theme` (présent depuis v1) | **corrigé** — captures réelles obtenues |

## 3. Matrice des familles auditée

34 pages · famille implicite `scalar*` = `family` absente de la métadonnée (voir P2-4). `tab` = lignes de tableau rendues D/M ; `medPx` = taille de la médiane desktop/mobile.

| Page | Famille | Unité | Sens | Vérifs | KO | medPx D/M | Tableau D/M | Fait saillant |
|---|---|---|---|---:|---:|---:|---:|---|
| demographie/densite | scalar* | hab./km² | ▲ | 153 | 0 | 112/48 | 1202/1202 | contrôle positif complet |
| demographie/structure_age | pyramid | % | ▲ | 94 | 0 | — | 0/0 | facette active marquée ✓, sans chrome partagé (P1-2) |
| demographie/evolution_1968 | scalar* | % | ▲ | 134 | 0 | 112/48 | 1202/1202 | grandeur signée relevée (−21→+287 %) |
| demographie/taille_menages | scalar* | pers./ménage | ▲ | 128 | 0 | 112/48 | 1202/1202 | |
| mobilite/voitures_menage | composition | % | ▲ | 94 | 0 | — | 0/0 | égalité max 3 @commune (ties invisibles ici, P1-2/P2-5) |
| mobilite/offre_cyclable | composition | km | ▲ | 84 | 0 | — | 0/0 | légende + références médianes ✓ |
| mobilite/reseaux | list | km | ▲ | 138 | 0 | 112/48 | 1202/1202 | profil 6 catégories, ordre déclaré ✓ |
| mobilite/offre_tc | scalar | % | ▲ | 135 | 0 | 112/48 | 1200/1200 | incomplets exclus du périmètre ✓ |
| mobilite/bornes_recharge | scalar | bornes | ▲ | 128 | 0 | 112/48 | 1202/1202 | |
| mobilite/places_stationnement_velo_1000 | scalar | places / 1 000 hab | ▲ | 128 | 0 | 112/48 | 1202/1202 | |
| mobilite/places_stationnement_voiture_1000 | scalar | places / 1 000 hab | ▼ | 128 | 0 | 112/48 | 1202/1202 | glyphe ▼ vérifié |
| mobilite/bornes_ev_par_station_service | scalar | bornes / station | ▲ | 128 | 0 | 112/48 | 349/349 | couverture publiée 349 |
| mobilite/stationnement_velo_par_voiture | scalar | places vélo / place voiture | ▲ | 128 | 0 | 112/48 | 103/103 | ratio, médiane ≠ 0 gérée |
| mobilite/tot_loss_t | scalar | accès perdus | ▼ | 153 | 0 | 112/48 | 1200/1200 | |
| mobilite/tot_loss_b | scalar | accès perdus | ▼ | 128 | 0 | 112/48 | 1200/1200 | |
| mobilite/iso_* (5 pages) | scalar | % | ▼ | 135–138 | 0 | 112/48 | 1200/1200 | parts bornées 0–100 ✓ |
| habitat/mix_logements | composition | % | ▲ | 94 | 0 | — | 0/0 | segments + légende contextualisée ✓ |
| habitat/statut | composition | % | ▲ | 94 | 0 | — | 0/0 | |
| habitat/age_du_bati | composition | % | ▼ | 94 | 0 | — | 0/0 | direction ▼ honorée |
| habitat/type | composition | % | ▲ | 94 | 0 | — | 0/0 | |
| habitat/prix_m2 | trajectory | €/m² | ▼ | 148 | 0 | 112/48 | 891/891 | occupation verticale ≈5,7 % @commune (P1-3) |
| habitat/part_passoires | scalar | % | ▼ | 165 | 0 | 112/48 | 1137/1137 | formatage ÷100 ✓ (#466) |
| habitat/distribution_dpe | distribution | % | ▼ | 144 | 0 | — | 1137/1137 | échelle partagée saturée ✓, couleurs officielles ✓ |
| economie/effectifs_salaries | scalar* | salariés | ▲ | 128 | 0 | 112/48 | 1202/1202 | |
| economie/chomage | scalar* | % | ▼ | 165 | 0 | 112/48 | 1202/1202 | |
| economie/eco_activites | scalar* | % | ▲ | 138 | 0 | 112/48 | 1202/1202 | |
| milieux/artif_par_habitant | trajectory | m²/hab | ▼ | 148 | 0 | 112/48 | 344/344 | occupation 97,6 % — contre-modèle positif de P1-3 |
| milieux/conso_enaf_annuel | trajectory | ha | ▼ | 148 | 0 | 112/48 | 1200/1200 | occupation 54,4 % |
| programmes/subventions_annuelles | scalar | € | ▲ | 128 | 0 | 112/48 | 725/725 | |
| programmes/subventions_par_domaine | list | € | ▲ | 24 | **8** | — | 0/0 | **P0-1** — facette invalide dès l'URL canonique |

Agrégats transversaux : accessibilité ciblée **0 violation** (SVG sans label, glyphes sans `title`/`aria`, selects sans label) sur tous les états ; note de contexte nommant le territoire mis en avant **34/34** ; URL `territoire=` conservée **34/34** ; overflow horizontal **0** desktop et mobile (émulation 390px réelle) ; recoupe de formatage cellule↔payload **0 écart**.

## 4. Constats classés

### P0-1 — Aller-retour d'URL casse la facette de `subventions_par_domaine` (seam partagé)

**Quoi.** La page se dégrade en état « facette invalide » dès qu'elle est ouverte via une URL canonique — c'est-à-dire **toujours** après la réécriture canonique de l'app elle-même, y compris depuis un simple clic interne suivi d'un remplacement d'URL. L'alerte `« La facette de cette famille de Repères est invalide. »` remplace la sortie : plus de figure, plus d'extrêmes, plus de tableau (design fail-closed de l'outlet).

**Preuve déterministe.** 8/8 KO (`load.page-trouvee` + `facette.reecriture-canonique-valide` sur defaut_desktop, defaut_mobile, highlight, table). Le dispatch direct (sans query) est `ready` ; le re-dispatch avec la query que l'app vient d'écrire (`?detail=Contractualisation+avec+les+territoires&dimension=2025&niveau=commune`) revient `invalid`.

**Cause racine.** La métadonnée déclare `comparison.dimension: "2025"` **sans** liste allow-list `comparison.dimensions`. Dans `normalizeComparisonFacet` (`app/src/indicateurs/familySeam.ts`, `resolveQuery`), tout paramètre *présent* est jugé invalide quand l'allow-list est `undefined` — or l'écrivain canonique injecte précisément ce paramètre résolu. C'est la seule page du catalogue dans ce cas (vérifié sur les six thèmes).

**Direction de correction (ticket de suivi, pas dans #479).** Soit traiter « valeur présente == défaut déclaré » comme valide en l'absence d'allow-list, soit exiger la déclaration de `dimensions` dès qu'un défaut `dimension` existe (validation payload). Ajouter un verrou routé aller-retour URL (monture → réécriture → re-dispatch → `ready`) contre le payload réel, et un test de parité métadonnée.

### P1-2 — Les familles pyramid / composition / comparison-bars n'ont aucun chrome Repères partagé (question produit)

Mesuré objectivement : `caption` absent, **0 ligne de tableau**, pas d'héros ni d'extrêmes ni de contrôles sur les 11 pages de ces familles, à tous les niveaux et dans les deux viewports. Conséquences analytiques :

- l'US11 (#398, « tableau cherchable/triable ») n'est pas servie pour ces familles ;
- l'US14 (territoire mis en avant) se réduit à la note de contexte — aucune ligne sélectionnée, aucun marqueur possible (les checks dédiés passent par gating « surface absente ») ;
- les égalités sont **invisibles** : l'état transversal `egalite-extremes` capture `voitures_menage@commune` où 3 communes partagent la valeur maximale, mais la page n'offre aucune surface où cette égalité serait énoncée (US9 non exposée ici) ;
- les liens vers fiches (US12) disparaissent de Repères pour ces familles.

Ce n'est **pas une régression** de #439/#441 (les blocs familiaux livrés sont exacts et verts) : c'est un périmètre jamais couvert. La décision (rendre le chrome partagé sous le bloc famille, ou assumer une vue « bloc seul » et amender le PRD) est un arbitrage produit — d'où un brouillon séparé (Draft B), sans changement production ici.

### P1-3 — Trajectoires : la médiane peut être visuellement écrasée par le domaine réel (spécifique famille×indicateur)

L'échelle #438 (« domaine RÉEL du chemin ») est implémentée fidèlement — vérification arithmétique : médianes `prix_m2@commune` 1616→1999 €/m² sur domaine [473–7129] ⇒ 10,93 unités viewBox prédites, **10,91 rendues**. Mais l'honnêteté du tracé souffre quand les extrêmes dominent :

- `prix_m2` @commune : variation **+24 %** de la médiane occupant **≈5,7 %** de la hauteur du plot — la trajectoire paraît plate ;
- contraste : `artif_par_habitant` occupe 97,6 %, `conso_enaf_annuel` 54,4 % (mesures `trajectoire.occupation-verticale-relevee`).

Pistes à instruire dans un ticket dédié (Draft C) : échelle logarithmique pour grandeurs ratio positives, domaine percentilé (p05–p95) documenté en `figcaption`, ou annotation de variation %. Ne rien changer tant que la décision n'est pas prise — l'implémentation actuelle est *correcte*, elle n'est pas *lisible* pour ce sous-cas.

### P2-4 — Six pages sans `family` déclarée

`densite`, `evolution_1968`, `taille_menages`, `effectifs_salaries`, `chomage`, `eco_activites` tombent dans le fallback scalaire implicite (cohérent app/harness). Contre l'intention « metadata declares semantic roles » (#398) : à fermer par un verrou de validation payload (Draft D).

### P2-5 — Égalités massives énoncées mais denses

`offre_tc@commune` : « 386 territoires à égalité » à la borne basse — honnête (zéro lien arbitraire, US9 respectée) mais analytiquement indigeste. Piste : compteur + listing seuillé ou agrégat « N territoires à 0 ». Mineur, à joindre au Draft B si le chrome partagé est retenu.

## 5. Contrôles positifs (à préserver)

- **Héros scalaire** : médiane 112 px desktop / 48 px mobile, courbe de densité avec marqueur de territoire actif (rouge, `aria-label` descriptif), recoupe médiane/extrêmes↔payload systématique — le gabarit densité+médiane est le meilleur atout de Repères.
- **`mobilite/reseaux` [list]** : profil 6 catégories dans l'ordre déclaré, sélecteur « Catégorie comparée » complet, tableau 1202 rangs ex-aequo conformes ADR-0015.
- **Distribution DPE (#474)** : médiane scalaire honnêtement absente ; signature aux **couleurs officielles** (`couleursDpe.ts`, échelle ADEME 2021, dérogation ADR-0023 — rendu RGB vérifié identique à la source) ; échelle partagée signature∪ensemble **saturant 100 %** ; l'ensemble n'est jamais un territoire (aucun nom, lien, rang).
- **Trajectoires (#438)** : chemin interrompu sur valeurs manquantes, libellés d'étapes rendus, détail actif sélectable pilotant carte/extrêmes/tableau sans replier le chemin.
- **Note de contexte permanente (#472)** : nomme le territoire mis en avant 34/34 et décrit le périmètre comparé, vivante aux changements d'URL.
- **Unités & formatage (#466)** : zéro écart de recoupe cellule↔payload sur toutes les unités, parts % rendues ×100 une seule fois, grandeurs signées (% évolution) rendues avec leur signe.
- **Responsive** : zéro overflow-x desktop/mobile, héros réorganisé en colonne sous 700 px.
- **États dégradés honnêtes** : `incomplete` annoncé (`offre_tc`), territoire hors niveau explicitement énoncé (« Allineuc : territoire absent à ce niveau de comparaison »), Carte vide attendue rendue sans erreur.

## 6. Cartographie des tickets #398 / #439–#441 et correctifs ultérieurs

| Ticket | Objet | Statut à l'audit | Preuve |
|---|---|---|---|
| #398 | PRD exploration par indicateur | **Livré** dans sa structure (catalogue, trois vues, état URL, niveaux/scope) ; US11/US12/US14 **partielles** pour pyramid/composition/comparison-bars (P1-2) | matrice §3 |
| #439 | Grammaire profils & listes | **Complet** — `reseaux` vert de bout en bout ; exposition de `subventions_par_domaine` **bloquée** par P0-1 (défaut seam postérieur, pas du renderer) | §3, §4-P0-1 |
| #440 | Grammaire distributions | **Complet** — facette lisant une autre clé, libellé public unique, signature+ensemble | §5 |
| #441 | Grammaire relations | **Roadmap-only** — registry/outlet prêts, **aucune page relation publiée** au catalogue actuel ; rien d'auditable en réel | §3 (0 page) |
| #466 | Formatage unités % centralisé | **Complet** — 0 écart sur 4276 vérifications, y compris % signés | §5 |
| #472 | Note de contexte + composition contextualisée | **Complet** — 34/34, références médianes en légende présentes | §5 |
| #474 | Split DPE / passoires | **Complet** — deux pages distinctes, ensemble de comparaison, échelle partagée saturée | §5 |
| #483/#484, #490 | Correctifs Carte (pyramide F+M, hauteur shell) | Hors périmètre Repères (Carte exclu) — **non régressés** côté Repères (structure_age verte) | §3 |

## 7. Brouillons de suivi (à créer après revue — aucun ouvert par #479)

**Shared / seam :**

1. **[bug][P0] `fix(indicateurs)` — URL canonique invalide pour les facettes à dimension sans allow-list (`subventions_par_domaine`)** : repro harness + spec debug ; correction `resolveQuery` (valeur==défaut valide sans allow-list) *ou* validation payload exigeant `dimensions` ; tests : seam unitaire, routé aller-retour URL contre payload réel, parité métadonnée. Closes the 8/8 KO of this audit.
2. **[hygiène][P2] `chore(payload)` — déclarer `family` explicitement sur les 6 pages implicites + verrou validateur.**
3. **[outil][P3] `test(audit)` — rejouer le harness en nocturne** (déterministe ~9 min, zéro dépendance) pour figer la grammaire Repères contre régressions.

**Family-specific redesign (questions, pas de code) :**

4. **[produit][P1] Chrome partagé pour pyramid/composition/comparison-bars ?** — tableau cherchable, extrêmes/égalités, highlight territoire vs « bloc seul » assumé (amendement PRD US9/11/12/14). Décision avant implémentation.
5. **[design][P1] Lisibilité des trajectoires sous domaine dominé par les extrêmes (`prix_m2`)** — log / percentiles documentés / annotation de variation ; garder #438 sinon.

## 8. Limites, exclusions, anomalies

- Vite **dev** (pas le build prod) : le runtime audité est celui du développement ; aucune mesure de réseau dégradé.
- Payload **committé** au moment de la passe : les effectifs de tableaux (1202 communes, 1137 communes DPE…) reflètent la couverture publiée courante.
- `vuesBoutons` n'est pas projeté dans le détail des états transversaux (limitation harness sans effet).
- Anomalies d'environnement rencontrées puis neutralisées : `origin/main` a avancé pendant la session (PR #490 + rebuild dist) — branche fast-forwarded et passe finale exécutée sur `c57b737` ; fichiers `app/dist/data` modifiés par une session antérieure ont été **restaurés** (drift dist↔public déjà résolu en amont par le commit de build).
- Fichiers de grattage de la session interrompue (`app/src/__tests__/zz-debug-subv.spec.ts`, `app/debug-subv-out.txt`) supprimés après archivage de leur contenu ci-dessous.

### Annexe — preuve de débogage P0-1 (session interrompue, archivée)

```
DISPATCH status=ready facet.valid=true            <- dispatch direct (sans query)
facet.detail="Contractualisation avec les territoires"
facet.dimension="2025"
rows=256
RE-DISPATCH après réécriture: status=invalid valid=false   <- même page, query = celle écrite par l'app
RE-detail="Contractualisation avec les territoires" RE-validDetail=false
ALERTES: ["La facette de cette famille de Repères est invalide."]
ROUTED URL: /indicateurs/programmes/subventions_par_domaine?detail=Contractualisation+avec+les+territoires&dimension=2025&niveau=commune
```
