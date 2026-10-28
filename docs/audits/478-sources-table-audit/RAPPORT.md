# Audit de la page Sources — retour à une table bornée et attributions fiables (#478)

_Date : 26 août 2026 · Périmètre : `/sources` (les cartes une-fiche-par-source), la table historique de l'onglet Méthodes · Sources (comparaison d'histoire du dépôt et témoin routé sur `/methodologie`), et les fiches de source embarquées des Pages d'indicateur (« L'indicateur », `?vue=indicateur`) · Statut : **diagnostic** — aucune copie de production modifiée ; le verdict produit est posé, l'implémentation appartient aux suivis._

---

## 0. Verdict produit

**Les cartes une-fiche-par-source sont rejetées.** La présentation antérieure — la table de l'onglet Sources de Méthodes (granularité jeu de données d'ADR-0022, millésimes imbriqués, matrice indicateur ↔ source #336) — est la direction préférée, à moderniser sans recréer ses défauts (cellules de matrice non bornées, colonnes clippées 768–1530 px, noms-prose). Le conflit de décision avec #398 est acté au §8 : le verdict de l'utilisateur prime sur l'hypothèse de présentation du PRD ; la migration de fond (#410) reste valide, c'est sa *forme d'arrivée* qui était fausse.

---

## 1. Méthode et boucle reproductible

Chaque surface a été mesurée **dans le DOM réel** (build existant + `vite preview` + Chrome headless piloté par CDP, aucune modification de code). Largeurs : 375 (mobile), 768 (md), 1024 (demi-desktop), 1440 (desktop), 1920 (wide). Attente par sondage du sélecteur prêt, cache réseau désactivé, profil Chrome jetable, captures pleine page.

```powershell
# Une commande — build prérequis : npm run build dans app/.
# Démarre le serveur, régénère expected-associations.json + toutes métriques
# + captures + sweep, arrête le serveur.
powershell -File docs/audits/478-sources-table-audit/harness/run-audit.ps1
```

Sortie type (extrait) :

```
✓ sources @mobile — bleed=0px cartes=21 lignes=0
✓ methodes-mobilite @md-768 — bleed=0px cartes=0 lignes=11
        methodes-mobilite  scrollDoc=1024 table=1348px coquille=992px tableDébordeCoquille=356px
w= 320  sources  scrollDoc=320 coquilleDroite=320 maxDroite=374 (article.source-record) débordeCoquilleDe=54px
Sweep écrit dans …\evidence\sweep-bleed.json
```

**Déterminisme prouvé** : deux exécutions complètes consécutives produisent des octets identiques pour `summary.json`, `sweep-bleed.json`, `expected-associations.json` (SHA-256 `9B8AC09A…`, `92B503DB…`, `309DE245…` à chaque run).

Sondes ponctuelles (mécanismes fins) : `harness/probe-debordement-mobile.mjs` (anatomie du débordement <375 px, serveur déjà lancé requis).

Sorties commises : `evidence/summary.json`, `evidence/sweep-bleed.json`, `evidence/expected-associations.json` (jointure publiée), `evidence/associations-verite.json` (fusion rendu × autorité, générée par `harness/associations-verite.mjs`), `metrics.json` par page × largeur, et un sous-ensemble de captures PNG représentatives (le jeu complet — 83 Mo — se régénère par la boucle ; voir §9).

Note d'environnement : deux processus `node` orphelins tournaient sur cette machine au démarrage (port 5199, worktree `issue-480` — le serveur de dev du travail parallèle #480). Ils n'ont pas été touchés ; aucun conflit de port avec cette boucle (4173/9777–9783).

### 1b. La carte des coutures (qui possède quoi)

| Couture | Fichier | Possède |
|---|---|---|
| Autorité publiée (source_records, sources, indicator_pages) | `public/data/theme_<theme>.json` (pipeline) | Quels jeux existent, quels indicateurs les citent (primaire ∪ secondaire), horloges, millésimes |
| Jointure rendue | `app/src/payload/selectors.ts` (`sourceRecords`, l. 741–891) | Regroupement par jeu (`datasetDeSource`), consommateurs, repli ADR-0022, filtre `consumers.length > 0` |
| Registre éditorial | `app/src/methodes/sources.ts` | Noms/éditeur/URL/thèmes par ligne vintage ; familles générées DVF/DPE/OCS-GE |
| Page Sources | `app/src/views/SourcesView.vue` | Une carte par jeu filtré ; ne rend NI thèmes, NI jeux sans consommateur |
| Ancienne table | `app/src/methodes/SourcesTable.vue` + `MethodesSources.vue` | Table bornée historique (en-têtes de jeu + lignes vintage + matrice #336, `includeUnpublished`) |
| Fiches embarquées | `IndicateurPage.vue` (vue `L'indicateur`) | `.source-card` par source déclarée de la page |

---

## 2. Ancienne table vs page actuelle

Historique : table créée comme vraie page (#128, 2026-08-06), restructurée en granularité jeu + composant partagé (ADR-0022, #333/#350, 2026-08-11) ; puis `/sources` créée **en cartes** par #417 (2026-08-21) pendant que la branche de bascule #410 (`issue/410-cutover`, non fusionnée à ce jour) **supprime purement et simplement** `SourcesTable.vue` et `MethodesSources.vue` (−3379 l., commit `f4e6fe3`). À ce jour, main garde encore les deux surfaces ; cette branche d'audit (5 commits derrière main, uniquement des fixes carte #483/#484/#490 sans impact Sources) est donc le dernier état où l'ancienne table est vivante — elle sert de témoin mesuré.

| Capacité | Table ancienne (Méthodes · Sources) | Cartes actuelles (/sources) | Verdict |
|---|---|---|---|
| Unité visuelle | 1 en-tête de jeu + millésimes imbriqués (ADR-0022) | 1 carte par jeu, même repli ADR-0022 | Équivalent en principe ; la carte éclate l'information verticalement |
| Scanabilité (comparer fraîcheurs/licences) | Colonnes alignées, `tabular-nums` | Champs dispersés par carte, scan œil-tendu | **Table gagne** |
| « Thèmes utilisés » | Puces par thème (multi-thèmes visibles : série historique → Démographie · Milieux) | **Non rendu** (`record.themes` calculé, jamais affiché) | **Régression carte** |
| Jeux sans indicateur cité | Affichés (`includeUnpublished`), « Aucun indicateur ne cite ce jeu » honnête | **Filtrés silencieusement** (`consumers.length > 0`) — 9 jeux disparaissent | **Régression carte** |
| Consommateurs | Matrice #336 liée aux ancres de documentation de la même page | Liens RouterLink vers les Pages d'indicateur (lien mort possible — §3-F1) | Carte gagne le principe (liens réels), perd la fiabilité |
| Hauteur des cellules consommateurs | Colonne matrice NON bornée : 7 puces empilées → **cellule 948 px, ligne 973 px** | Liste par carte, mais cartes de **1 115 px (desktop) à 3 147 px (mobile)** pour 1–2 consommateurs | Les DEUX sont pathologiques (defauts distincts) |
| Largeur | 9 colonnes `nowrap` → table 1348 px dans une coquille de 736–1168 px, **clippée** (§3-F6) | Coquille respectée ≥375 px ; **clippée 320–360 px** (§3-F5) | Les DEUX fuient leur cadre |
| Noms de jeu | Rend le `nom` du registre **tel quel** — jusqu'à **355 caractères** de prose Cerema | Rend le `dataset` court du payload quand il existe (dérive de nommage, §3-F8) | Ni l'un ni l'autre : nom court + prose déplacée en limite |
| Mobile <768 | Empilement CSS éprouvé (mêmes cellules, data-label) | Cartes empilées nativement | Équivalent |
| Horloges de mise à jour | Absentes de la table | Section dédiée par carte (jusqu'à 5 horloges × prose) | Apport réel des cartes à préserver |

---

## 3. Constats quantifiés (classés)

Gravité : **D0** = contresens/mensonge rendu · **D1** = coût de lecture ou perte d'information massif · **D2** = bruit/défaut systémique · **D3** = finition structurelle (à ne pas recréer).

### F1 — D0 : un consommateur rendu mène à « Indicateur introuvable »

La carte `acv` rend « Couverture programmatique · programmes » lié vers `/indicateurs/programmes/couverture_programmes`. Cette clé figure dans `theme_programmes.json` → `sources` mais **pas dans `indicator_pages`** (seules `subventions_annuelles` et `subventions_par_domaine` y sont, cf. #467 qui n'a rattrapé qu'elles). La route rend `role="alert"` « Indicateur introuvable ». **Première couture incorrecte : le descripteur publié** (`sources` déclare un consommateur sans page publiée) — pas le jointeur, qui fait exactement ce que l'autorité dit. Test d'un côté ET de l'autre exigé au suivi : toute clé de `sources` doit exister dans `indicator_pages`, ou ne pas être rendue comme lien.

### F2 — D0 : « INSEE — Série historique du recensement » n'affiche aucun consommateur Milieux

Le jeu porte pourtant l'autorité des deux thèmes : `theme_milieux.json` publie `source_records.serie_historique` (l'horloge Population, RP 2017→2023 — les trois horloges d'ADR-0017) et le registre déclare `themes: ['demographie', 'milieux']`. Mais la jointure ne rend que les **pages** qui citent le jeu : côté Milieux, aucune — `indicator_pages.artif_par_habitant.sources = ["ocsge_artificialisation_22_2025"]` seulement. Or « Intensité état » est un ratio **par habitant** dont le dénominateur vient TOUJOURS de la série historique (règle ADR-0014 citée dans `sources.ts` lui-même : « la population vient TOUJOURS de là, jamais des champs embarqués de CONSOENAF »). **Première couture incorrecte : la déclaration secondaire manquante dans le descripteur**, pas l'UI. Même motif, moindre visibilité : `places_stationnement_velo_1000` et `places_stationnement_voiture_1000` (pour 1 000 hab.) ne déclarent pas davantage leur dénominateur de population — alors que le produit déclare bien ses dénominateurs thématiques ailleurs (`bornes_ev_par_station_service` cite BPE B316 **et** IRVE). Seconde couture, documentée : les lectures/Stories (`taux_variation_population`, la force démographique du récit Milieux) n'ont **aucun emplacement dans le contrat** consommateur — ADR-0022 l'acte (« stories have no source field yet — gated on #74/#308 ») ; c'est un trou de contrat assumé, à traiter là-bas, pas par une refonte du domaine ici.

### F3 — D1 : neuf jeux d'autorité disparaissent silencieusement de la page

Le filtre `consumers.length > 0` (SourcesView l. 11) éjecte **9 jeux** : `pvd`, `crte`, `territoires_industrie` (publiés par le payload avec horloges et millésimes propres — et réellement consommés dans les faits par l'élément Couverture programmatique, qui lit ACV·PVD·CRTE·TI), `epci`, puis côté registre-seul `flores_a38`, `rp_emploi`, `cog_passage`, `communes_limites`, `batiments_residentiels`. L'ancienne table, elle, montrait tout avec un état vide honnête. Trois lectures possibles (page complète, section « référentiels/plomberie », suppression assumée) — la décision appartient au suivi ; ce qui est défaut aujourd'hui c'est la **disparition sans trace** d'une provenance publiée.

### F4 — D1 : régression « Thèmes utilisés » — l'attribution thématique n'est plus visible

`sourceRecords()` calcule `record.themes` (la série historique → `['demographie','milieux']`) et la page ne le rend jamais. C'est précisément le signal qui aurait rendu F2 visible pour le lecteur : la carte dit « je n'ai pas de Milieux » alors que l'autorité dit « Milieux me porte ». Restauration peu coûteuse (chips de l'ancienne table, `NOMS_THEMES` existe).

### F5 — D1 : cartes pathologiques — 1 115 px au desktop, 3 147 px au mobile, pour 1–2 consommateurs

Mesuré sur /sources : hauteur de page **31 693 px @375** (15 014 px @1440+) pour 21 cartes. Pires cartes @375 : `bornes-recharges` **3 147 px** (2 consommateurs), `korrigo` **2 903 px** (1 consommateur), `rp_logement_princ` **2 857 px** (1 consommateur), `ocsge_artificialisation` 2 409 px (seule carte dépliée : **11 lignes de millésimes** rendues d'un bloc). Causes : jusqu'à 5 horloges × prose, noms longs, listes non bornées. Le contenu existe (fraîcheur honnête), la **présentation** n'est pas bornée.

### F6 — D2 : fuite hors coquille — clippée, pas scrollable

- **Cartes, <375 px** : à 320/340/360 px, `article.source-record` atteint 374 px de droite (54/34/14 px au-delà du viewport) tandis que `scrollWidth == clientWidth` — `html,body { overflow-x: clip }` (base.css l. 19–24) **coupe le contenu sans ascenseur**. Mécanisme (sonde) : la piste auto du grille `.source-records` se dimensionne au max-content d'un texte d'une ligne (~300 px) + 50 px de chrome de carte ; la piste ne se replie pas, le document clippe. Correctif candidat : piste bornée `grid-template-columns: minmax(0, 1fr)` (testable : `doc.scrollWidth == doc.clientWidth` à 320 px).
- **Ancienne table, 768–1530 px** (témoin, à NE PAS recréer) : table figée à 1348 px dans une coquille de 736/992/1168 px → **612/356/180 px de colonnes droites (fraîcheur, licence, lien) clippés et inaccessibles** — vérifié par chaîne de computed styles : aucun conteneur `overflow-x: auto` entre la table et `body{clip}` ; l'empilement <768 px masquait le problème en dessous, rien ne le couvre entre 768 et ~1530 px.

### F7 — D2 : vingt têtes de section fantômes + antipattern Vue

« Millésimes et fraîcheur » (h3 inconditionnel) s'affiche **au-dessus d'une liste vide sur 20 des 21 cartes, à toutes les largeurs** (les `<li>` portent `v-if="!source.replie"`, l. 47 — v-if couplé à v-for sur le même élément, en plus). La ligne résumé (`source-record__summary`) porte déjà l'information repliée : le h3 doit suivre le même garde.

### F8 — D2 : noms-prose et double nommage registre × payload

Le registre rend son `nom` tel quel — inventaire mesuré : CONSOENAF **355 caractères** (l'anomalie d'unité hectares/m² du dictionnaire Cerema est enchâssée dans le NOM), Korrigo 201 (les 24+ réseaux énumérés), LOG T12 180, Ecolab 177, BDNB 158, OSM réseaux 136 (la licence dans le nom)… Pendant ce temps /sources affiche le `dataset` court du **payload** quand il existe : deux noms pour un même jeu selon la surface (dérive garantie à chaque ajout). Décision à prendre une fois : nom court partout, la prose migre dans un champ `caveat`/description dédié (la limite unitaire Cerema est une excellente caveat, un très mauvais titre), avec test de parité (longueur plafonnée).

### F9 — D2 : thème brut en libellé de consommateur

Les consommateurs rendent `· demographie`, `· programmes` (slug brut) là où le produit parle « Démographie », « Programmes et subventions » (`NOMS_THEMES` existe et servait aux chips).

### F10 — D3 (latent) : fiches « L'indicateur » — liste de millésimes non bornée en ligne

Captures comblées au run 2 (`?vue=indicateur`, absentes du run 1) : conso_enaf_annuel → 1 fiche (225–545 px), tot_loss_t → 1 fiche (313–676 px). Risque latent : `.source-card` rend ses `vintages` **sans repli** — une page déclarant OCS-GE enlinerait 11 lignes de millésimes dans la page d'indicateur. À borner au même geste que la table.

### F11 — D3 : défauts de l'ancienne table à ne pas transplanter

Cellule matrice non bornée (7 puces empilées → 948 px, ligne 973 px, Mobilité) ; colonnes clippées 768–1530 px (F6) ; noms-prose (F8). Ce sont ces trois-là — pas sa structure — qui avaient justifié l'écartement de la table.

---

## 4. Table de vérité des associations (rendu vs autorité)

Constat structural d'abord : **le rendu coïncide toujours avec la jointure publiée** (21/21 jeux, zéro écart cartographique) — le jointeur `sourceRecords()` est fidèle. Tous les défauts d'attribution vivent EN AMONT (déclarations du descripteur) ou AU CONTRAT (filtre, thèmes non rendus, lien sans page). Détail complet : `evidence/associations-verite.json` ; résumé :

| Jeu rendu (/sources) | Thèmes d'autorité | Consommateurs rendus | Verdict |
|---|---|---|---|
| rp_logement_princ | mobilité | voitures_menage | conforme autorité (carte 2857 px — F5) |
| amenagements_cyclables | mobilité | reseaux | conforme |
| korrigo | mobilité | offre_tc | conforme (carte 2903 px — F5) |
| bornes-recharges | mobilité | bornes_recharge, bornes_ev_par_station_service | conforme (carte 3147 px — F5) |
| stationnement-velo | mobilité | places_stationnement_velo_1000, stationnement_velo_par_voiture | conforme autorité ; dénominateur pop. non déclaré (F2, motif) |
| osm_reseaux | mobilité | places_stationnement_voiture_1000, stationnement_velo_par_voiture, offre_cyclable | conforme autorité ; idem F2 |
| mobilite_snapshot | mobilité | tot_loss_t/b, iso_alimentation/sante/administration/ecole/banque | conforme |
| bpe_b316 | mobilité | bornes_ev_par_station_service | conforme |
| **serie_historique** | **démographie + milieux** | densite, evolution_1968 **uniquement** | **déclaration Milieux manquante (F2)** — artif_par_habitant devrait citer le jeu en secondaire |
| age_detail | démographie | structure_age | conforme |
| menages | démographie | taille_menages | conforme |
| logements | habitat | mix_logements, statut, age_du_bati, type | conforme |
| dvf | habitat | prix_m2 | conforme (20 lignes repliées, ADR-0022) |
| dpe | habitat | part_passoires, distribution_dpe | conforme |
| flores_a88 | économie | effectifs_salaries | conforme |
| rp_chomage | économie | chomage | conforme |
| sirene_snapshot | économie | eco_activites | conforme |
| consoenaf | milieux | conso_enaf_annuel | conforme (nom-prose 355 car. — F8) |
| ocsge_artificialisation | milieux | artif_par_habitant | conforme (11 millésimes dépliés — F5/F10) |
| acv | programmes | **couverture_programmes → « Indicateur introuvable »** | **lien mort (F1)** |
| subventions_scdl | programmes | subventions_annuelles, subventions_par_domaine | conforme |

Hors page (filtrés, F3) : `pvd`, `crte`, `territoires_industrie`, `epci` (payload) + `flores_a38`, `rp_emploi`, `cog_passage`, `communes_limites`, `batiments_residentiels` (registre seul).

---

## 5. Prose : garder / raccourcir / déplacer

| Nom (registre) | Long. | Décision | Pourquoi |
|---|---|---|---|
| Cerema CONSOENAF « … le dictionnaire annonce les consommations "en hectares", le fichier les distribue en mètres carrés… » | 355 | **Déplacer** | Excellente **limite de source** (caveat), mensongère comme titre ; nom : « Cerema — Consommation d'ENAF (CONSOENAF) 2011-2025 » |
| Korrigo « … les 24+ réseaux : BreizhGo TER/car/maritime + STAR, Bibus… » | 201 | **Supprimer** de la table (déjà documenté dans la fiche/lecture) ; garder « Bretagne Mobilité — Korrigo (GTFS) » | L'énumération n'aide à aucun choix de lecture |
| INSEE RP exploitations « … tableau LOG T12 "Équipement automobile…" (jeu DS_RP_LOGEMENT_PRINC…) » | 180 | **Raccourcir** : « INSEE — Recensement de la population, logements (LOG T12) » (le payload l'a déjà fait — aligner le registre) | L'id d'artefact vit dans l'URL, jamais dans le nom (principe déjà écrit dans sources.ts) |
| Ecolab « (hub d'indicateurs territoriaux… ; source OSM : Base Nationale…) » | 177 | **Raccourcir** + caveat « agrégé depuis OSM par Ecolab » | Provenance secondaire ≠ identité du jeu |
| BDNB « (geom_adresse POINT EPSG:2154, code_commune_insee) » | 158 | **Supprimer** la parenthèse technique | Détail de schéma, pas d'éditorial |
| OSM réseaux « — © OpenStreetMap contributors, licence ODbL 1.0 (ADR-0001) » | 136 | **Déplacer** vers la colonne Licence (déjà rendue) | Doublon de colonne |
| Geovelo « (schéma national v0.3.5, ODbL…) » / Etalab IRVE « schéma 2.2.0 » / BPE25 « fichier détail… filtre analytique B316 » | 117–126 | **Raccourcir** ; version/filtre → ligne vintage ou caveat | La colonne Version existe précisément pour ça |

Règle proposée (testable) : `nom ≤ 80 caractères`, prose migrée en `caveat`/description, parité registre ↔ payload sur le nom court.

---

## 6. Recommandation : la table bornée modernisée

Repartir de **`SourcesTable.vue`** (composant partagé, éprouvé, déjà conforme ADR-0022) comme rendeur de `/sources`, avec quatre bornes testables :

1. **Bornage vertical de la matrice** — les consommateurs passent en chips **enroulées** (`flex-wrap`), plafonnées visuellement (ordre du payload) derrière un divulgateur « +N autres » (`<details>`/bouton, second rang si préféré) : plus aucune cellule ne croît avec le nombre d'indicateurs. Test : avec une fixture à 16 consommateurs, hauteur de cellule ≤ ~120 px à 375/768/1440, et le divulgateur expose la liste complète au clavier.
2. **Bornage horizontal** — aucune piste auto au max-content : colonnes en `minmax(0, …)`, la cellule Source et la Licence se plient (déjà le cas), et garde-fou honnête : enveloppe `overflow-x: auto` autour de la table pour que, si ça dépasse encore, ce soit **scrollable et visible** — jamais clippé. Tests doubles : `document.scrollWidth == clientWidth` à 320 px ET `wrapper.scrollWidth ≤ wrapper.clientWidth + 1` à 768/1024/1440 (croix-reference des deux côtés, cf. piège classique du select sans option).
3. **Hiérarchie conservée** — en-têtes de jeu + lignes vintage imbriquées, repli ADR-0022 inchangé (DVF replié, OCS-GE visible : 11 lignes restent des enfants bornés de leur en-tête), ancres `#source-*` préservées (les liens profonds des fiches continuent de mordre), URL sur l'en-tête seul, empilement CSS <768 px conservé.
4. **Attributions réparées en amont** (sans quoi la meilleure table mentira pareil) — publier ou délier `couverture_programmes` (F1) ; déclarer `serie_historique` en secondaire d'`artif_par_habitant` et trancher la politique dénominateur-population (F2) ; rendre les chips « Thèmes utilisés » (F4) ; décider du sort des 9 jeux filtrés avec un état vide honnête plutôt que la disparition (F3). L'emplacement consommateurs-des-Stories reste chez #74/#308 — pas de refonte du domaine ici, l'évidence ne l'exige pas.

Ce que la modernisation garde des cartes (apports réels) : les liens RouterLink vers les Pages d'indicateur (la matrice #336 ne liait que des ancres locales), la section Horloges (en version compacte, repliable), et le titre de page « Sources ».

---

## 7. Ce qui ne va PAS dans les suivis (non-défauts vérifiés)

- Le jointeur `sourceRecords()` : fidèle à l'autorité publiée (§4) — les specs `sources-authority.spec.ts` verrouillent d'ailleurs ce comportement (filtrage compris).
- Le repli ADR-0022 : DVF/DPE repliés, OCS-GE visible — conforme à la règle d'honnêteté.
- La granularité jeu de données : correcte des deux côtés (20 lignes DVF → 1 jeu).
- La jointure #467 (programmes dans l'autorité commune) : fonctionne ; seule la page manquante (F1) casse la main.

## 8. Cartographie #398 / #410 et suivi

- **#398 (PRD, ouvert)** — story 38 : « a top-level **Sources catalogue**, so that I can browse datasets and see which indicators consume them » ; décision : « Standalone Carte and Méthodes are retired. Source-specific content moves to Sources ». **Conflit de décision acté** : le PRD supposait qu'une page catalogue remplacerait le contenu de Méthodes ; #417 l'a réalisée en cartes ; le verdict utilisateur (#478) rejette cette forme et désigne la table de l'onglet Méthodes comme direction. C'est l'*hypothèse de présentation* de #398 qui est supplantée — pas l'architecture (Pages d'indicateur, sixième thème, retrait de Méthodes comme destination explicative restent valides).
- **#410 (bascule, branche `issue/410-cutover`, non fusionnée)** — `f4e6fe3` supprime `MethodologieView.vue`, `MethodesSources.vue`, `SourcesTable.vue`, etc. **Si la branche fusionne telle quelle, le motif de table bornée disparaît du dépôt** alors même que #478 le désigne comme cible. Suivi demandé : soit #410 conserve le couple `SourcesTable`/table (réutilisé par /sources), soit l'accepte et le suivi #478-le-restore — dans les deux cas, la suppression et la résurrection ne doivent pas se croiser en silence.
- **Suivis draftés (UI/UX uniquement)** :
  1. `feat(sources): la table bornée remplace les cartes` — §6-1/2/3 + tests de bornage ;
  2. `fix(payload): attributions de sources — série historique × milieux, couverture_programmes` — F1/F2 (descripteurs) ;
  3. `fix(sources): coquille bornée <375 px, h3 fantôme, thèmes rendus, slugs de thème` — F4/F5-partiel/F7/F9 ;
  4. `refactor(registre): noms courts ≤80 car., prose migrée en caveat, parité registre×payload` — F8 ;
  5. (chez #74/#308) emplacement contrat pour les consommateurs-Stories — F2 seconde couture.

## 9. Limites de cette audit

- Branche d'audit 5 commits derrière origin/main (#483/#484/#490, carte uniquement) — aucun impact sur les surfaces auditées ; l'ancienne table y est encore présente (main aussi : #410 non fusionné).
- Captures : le jeu complet (50 PNG, 83 Mo) reste local et se régénère par la boucle ; sont commités les JSON intégraux + les captures représentatives (sources mobile/desktop, témoin table desktop, fiches L'indicateur). `app/dist` modifié localement par le build de la boucle n'est **pas** commité (aucune copie de production dans ce ticket).
- Les mesures « L'indicateur » du run 1 étaient vides (onglet non ouvert) ; comblées au run 2 par les pages `?vue=indicateur`.
