# Audit #481 — Page d'indicateur : shell, onglets et handoffs depuis la fiche

**Date** : 2026-08-26 · **Branche** : `issue/481-indicator-shell-audit` (base `e35b4b2`)
**Méthode** : boucle navigateur déterministe (`harness/audit.mjs`, Chrome système
headless, `app/dist` de la branche servi localement) — 42 scénarios, **255
assertions dont 9 ROUGE**, preuves JSON + 44 captures dans `evidence/`.
Aucune production code modifiée.

Échantillon : 8 Pages d'indicateur couvrant **chaque famille publiée**
(scalaire, composition, pyramide, distribution, trajectoire, liste + repli
générique) × 4 largeurs (**390 / 1024 / 1440 / 1920**) ; handoffs depuis les
cinq types de territoire (Rennes 35238, Allineuc 22001, Rennes Métropole
243500139, Ille-et-Vilaine 35, Bretagne 53) sur leurs thèmes porteurs.

---

## Verdict (handoff)

**Le contrat #409/#468/#473 tient en production** : chaque ancre est une vraie
ancre routée même-origine vers `/indicateurs/…`, porte `target="_blank"
rel="noopener noreferrer"` (#468), emporte son territoire (+ niveau comparable,
la Région SANS niveau — écrit en retour honnête à l'arrivée), la note de
contexte #472 nomme le territoire à chaque arrivée, les liens inverses
préservent la lentille (`?theme=`). Les défauts trouvés sont des **fuites de
continuité et de seuils tactiles**, pas des ruptures d'architecture :

| # | Sévérité | Constat |
|---|---|---|
| F1 | **Moyen+** | Continuité du territoire perdue sur les trajectoires à millésimes mixtes (`artif_par_habitant`) |
| F2 | Moyen | Page publiée `programmes/subventions_par_domaine` sans aucune passarelle depuis la fiche |
| F3 | Moyen | Cibles tactiles < 24 px partout (passarelles 17 px, onglets `.vues` 20 px) |
| F4 | Moyen | Homonymie « Explorer » : 16 ancres identiques par fiche mobilité (23 ancres, 8 noms uniques) |
| F5 | Faible | Pas de retour au survol sur le site BlocProgrammes (`--passarelle-survol` jamais posée) |
| F6 | Observation | Table générique rendue brute (1 137 lignes communes) — densité mobile |

La vue Carte des Pages d'indicateur testées **rend** (canvas maplibre présent,
y compris multi-détail pyramide) — l'« empty Carte » attendu par #398 ne s'est
présenté nulle part sur l'échantillon ; tout reste de chantier Carte reste la
propriété de #398 et n'est **pas compté comme défaut** ici.

---

## F1 — Continuité perdue : le territoire émetteur disparaît de Repères (Moyen+)

Sur `/indicateurs/milieux/artif_par_habitant`, la passarelle du département 35
arrive avec `?territoire=35&niveau=departement` ; la page résout puis écrit en
retour son détail canon `detail=2025`. Or les millésimes OCS-GE sont par
département (22 : →2025, 29 : →2024, 35 : →2020→2023, 56 : →2024) : à
`detail=2025`, **la table générique ne contient que Côtes-d'Armor** —
Ille-et-Vilaine, le territoire émetteur, a **disparu** sans statut « absent »,
sous une légende qui prétend « Territoires comparables — Bretagne ». La note de
contexte, elle, dit « Votre territoire : Ille-et-Vilaine » : contradiction à
l'écran.

Caractérisation complète (`evidence/diagnostic-selection-trajectoire.json`) :
`detail=2021` → 2 lignes (22, 29), pas de surlignage ; `detail=2023` → 1 ligne,
Ille-et-Vilaine surlignée ; `detail=2025` → 1 ligne, émetteur absent.
Contrôles qui, eux, surlignent correctement : `economie/chomage`,
`demographie/evolution_1968`, `habitat/prix_m2` (trajectoire commune).

Le contrat #409 promet que le territoire « stays highlighted across Repères and
Carte until cleared » ; le principe d'honnêteté (#439/#440) exige un état
nommé (« absent », « incomplet »), jamais une disparition silencieuse. Le choix
du détail par défaut (le M3 le plus récent — celui d'un seul département)
décide seul de qui existe.

**Piste** : sur les familles multi-détails à horloges par territoire, garder
toutes les lignes du périmètre et marquer « absent au détail actif », ou
résoudre le détail par défaut dans le millésime du territoire émetteur.
À arbitrer avec le modèle par détail (#438) et ADR-0017.

## F2 — `programmes/subventions_par_domaine` publiée mais sans porte depuis la fiche (Moyen)

`theme_programmes.json` publie la page (l'inventaire déterministe confirme :
34 sites sur 35 ont leur page) et le catalogue `/indicateurs` la liste. Mais
`BlocProgrammes.vue` ne rend qu'une passarelle (`subventions_annuelles`) et son
commentaire affirme encore que « subventions_par_domaine n'a pas de page » —
règle d'honnêteté écrite avant la publication, jamais retournée. Résultat :
une page publiée que la fiche n'atteint jamais, l'inverse exact du lien mort
que la règle interdit.

**Piste** : passer `subventions_par_domaine` par `handoffExploration` dans le
bloc (le sélecteur top-5/revelation est son site naturel) et supprimer le
commentaire stale. Un test routé suffit.

## F3 — Cibles tactiles sous le minimum WCAG 2.5.8 (Moyen)

Mesuré partout (9 flows RED, mobile inclus) :

- `.passarelle-exploration` : **17 px de haut** (66–90 px de large),
  `font-size: 12px` (`--text-caption`) ;
- boutons d'onglets `.vues` : **20 px de haut**.

WCAG 2.5.8 AA exige 24×24 CSS px (le repère produit des onglets de fiche est
44 px — ThemeTabs respecte `min-height:52px`). Les deux cibles premières de la
navigation data-first sont sous le plancher d'accessibilité (ROUGE sur les 8
flows de handoff).

**Piste** : étendre la surface cliquable par padding inline-block (sans toucher
à la typo caption) viser ≥ 24 px minimum, 44 px visé.

## F4 — Homonymie « Explorer » : 16 ancres identiques par fiche (Moyen)

Inventaire rendu (par flow, `evidence/handoff-*.metrics.json`) :

| Fiche × thème | Ancres | Dont nav de lecture (#473) | Noms uniques | Homonymes « Explorer » |
|---|---|---|---|---|
| Rennes × mobilité | 23 | 7 nommées | 8 | **16** |
| Allineuc × mobilité | 23 | 7 nommées | 8 | **16** |
| Rennes Métropole × mobilité | 23 | 7 nommées | 8 | **16** |
| Rennes × habitat | 7 | 0 | 1 | 7 |
| Rennes × démographie | 4 | 0 | 1 | 4 |
| Bretagne × économie | 3 | 0 | 1 | 3 |
| Dép. 35 × milieux | 3 | 1 nommée | 2 | 2 |
| RM × programmes | 1 | 0 | 1 | 0 |

La grande lecture nomme correctement ses passarelles (libellés publiés
#473/#318), mais **la grille répète les mêmes cibles** juste en dessous sous le
libellé générique : sur un sous-groupe « accès aux services », `tot_loss_t`
est atteint par deux ancres à quelques dizaines de pixels l'une de l'autre.
Une liste de liens de lecteur d'écran lit 16 « Explorer » indiscernables
(WCAG 2.4.4 hors contexte) et la densité de cartes répétées dilue l'affordance.

**Piste** : quand une lecture du sous-groupe expose déjà un constituant, ne pas
répéter la passarelle grille pour la même clé (la règle « figure compacte ne
rend jamais deux fois » a son miroir exact côté handoffs).

## F5 — Pas de retour au survol sur le site Programmes (Faible)

`OngletTheme.vue` pose `--passarelle-survol: var(--couleur-nuage)` ; 
`BlocProgrammes.vue` pose `--passarelle-couleur` mais jamais `--passarelle-survol`
→ repli sur la couleur de repos : **aucun changement au survol** (mesuré :
`survol.change=false`, contre `true` sur tous les autres sites). Incohérence
d'identité de composant, pas de parcours.

## F6 — Table brute de 1 137 lignes (Observation)

À `niveau=commune` sur les pages génériques/scalaires, la table rend toutes les
communes bretonnes sans regroupement ni fenêtrage ; à 390 px elle tient dans
la page (pas de débordement mesuré — voir plus bas) mais la densité est
difficile. Candidat naturel pour un ticket UX #398-sibling ; non compté comme
défaut bloquant.

---

## Évaluation : icône SVG + info-bulle accessible contre libellé « Explorer »

Proposée par le ticket : remplacer l'affordance actuelle (texte « Explorer » +
flèche lucide 12 px, soulignée, couleur de rampe) par une icône seule avec
info-bulle accessible près du titre de la figure. Évaluation contre les quatre
exigences demandées :

| Critère | Libellé texte actuel | Icône + tooltip seule |
|---|---|---|
| Nom accessible | Le texte EST le nom — toujours correct | Exige `aria-label` correct sur CHAQUE site (35+) ; risque de drift libellé/nom |
| Découvrabilité | Souligné + couleur de thème : convention lien respectée | Une icône flèche seule se fond dans les figures ; la découvrabilité repose entièrement sur le hover — absent au tactile |
| Tactile | 17 px aujourd'hui (F3), mais la cible texte est large (66–90 px) | Icône 12–18 px = cible pire encore sans padding dédié |
| Densité répétée | F4 : le mot répété 16× fatigue | Réduirait le bruit visuel MAIS aggraverait l'homonymie si l'icône ne porte pas le nom de l'indicateur |
| Info-bulle | n/a | WCAG 1.4.13 : tooltip au hover/focus seulement — **jamais au tactile**, où le besoin existe le plus |

**Verdict** : rejeter l'icône SEULE comme remplacement. L'information porteuse
est le NOM de l'indicateur exploré (déjà démontré par la nav de lecture #473,
seule variante sans défaut d'homonymie dans nos mesures). L'évolution qui
répond à la fois à F3/F4 : **libellé publié court + icône**, cible élargie,
et déduplication des sites doublons. L'icône seule peut rester acceptable pour
un site unique non répété (le total BlocProgrammes), jamais dans la grille.

---

## Ce qui tient (preuves positives)

- **Hiérarchie** : sur-titre overline (thème, `--indicateur-strong` oklab) → h1
  unique Manrope 32 px → définition → note de contexte #472 — ordre stable sur
  32 chargements, toutes familles, toutes largeurs.
- **Onglets** : aria-label « Vues de l'indicateur », état actif distinct
  (border-bottom 3px de la rampe du thème — ex. rgb(201,143,110) terracotta
  habitat — + gras 700), synchronisation `?vue=` complète et retour propre
  (paramètre retiré sur Repères).
- **Continuité d'origine** : note de contexte vivante nommant le territoire à
  chaque arrivée de passarelle ; Région honnêtement « hors périmètre comparé »
  (#472) ; niveau écrit en retour dans l'URL conformément au contrat.
- **Nouvelle fenêtre** (#468) : `target="_blank" rel="noopener noreferrer"`
  sur 100 % des ancres inventoriées, vraies ancres routées même-origine
  (`href="/indicateurs/…"` — zéro domaine externe).
- **Liens inverses** : extrêmes/table → fiche préservent la lentille
  (`?theme=<thème>`), vérifié sur les familles qui les rendent.
- **Focus/hover** : focus clavier visible (outline solid 2px) sur onglets et
  passarelles ; survol recoloré par la rampe sur tous les sites sauf F5.
- **Identité visuelle** : Manrope (UI) / Newsreader serif (médiane 112px) —
  polices variable chargées et appliquées ; rampe par thème résolue
  (`--indicateur-accent` → ancre du thème) ; surfaces/bords conformes tokens.
- **Responsive** : aucun débordement horizontal mesuré à 390 px
  (`docScrollW == innerW == 390` sur 8 pages) ; hero/extremes passent en une
  colonne ≤700 px ; controls en flex-wrap.
- **Vue Carte** : rend maplibre sur distribution ET pyramide multi-détail
  (`vue=carte` URL-backée) — l'état « empty Carte » attendu par #398 n'a pas
  été observé sur l'échantillon.

## Mapping issues

| Issue | Lien avec l'audit |
|---|---|
| #398 (parent PRD, ouverte) | Propriétaire du chantier Carte restant et de toute refonte du shell — F6 lui est naturellement rattaché ; « empty Carte » exclu du compte des défauts |
| #409 (fermée) | Contrat de handoff (territoire+niveau en URL, liens inverses) — **vérifié conforme**, sauf F1 (continuité perdue sur trajectoire millésimée) et F2 (page sans porte) |
| #468 (fermée) | Affordance compacte + nouvelle fenêtre — conforme ; ses cibles tactiles tombent sous 2.5.8 (F3) |
| #472 (fermée) | Note de contexte permanente — conforme et décisive pour rendre F1 visible (contradiction note/table) |
| #473 (fermée) | Passarelles de lecture nommées — conforme ; révèle F4 par contraste avec la grille |

## Brouillons de tickets (classés, dépendances explicites)

1. **fix(indicateurs): le territoire émetteur reste visible sur les Repères multi-détails** (F1, Moyen+) —
   dépend : rien ; à coordonner avec le propriétaire de #438/#398 sur la
   sémantique « absent au détail ». Acceptation : sur `artif_par_habitant`
   dép. 35, la table montre les 4 départements ou marque explicitement
   l'absence ; l'émetteur jamais silencieusement absent ; verrou routé sur les
   trois détails millésimes.
2. **fix(fiche): passerelle vers subventions_par_domaine + commentaire à jour** (F2, Moyen) —
   dépend : rien. Acceptation : une passarelle BlocProgrammes de plus, test
   routé href+target.
3. **a11y(indicateurs): cibles ≥24px sur passarelles et onglets .vues** (F3, Moyen) —
   dépend : rien. Acceptation : mesures DOM ≥24px (viser 44px), snapshot test.
4. **ux(fiche): dédupliquer les passarelles grille vs lecture nommée** (F4, Moyen) —
   dépend : décision produit légère (quelle variante disparaît) ;
   acceptation : zéro homonyme « Explorer » répétant une cible déjà nommée
   dans la même carte.
5. **polish(fiche): --passarelle-survol posée sur BlocProgrammes** (F5, Faible) —
   dépend : rien ; peut voyager avec 2.
6. *(vers #398)* **fenêtrage/regroupement de la table générique** (F6) — à
   prioriser par le parent.

---

*Preuves brutes : `harness/inventory.mjs` (sites payload), `evidence/*.metrics.json`,
`evidence/diagnostic-selection-trajectoire.json`, captures `evidence/*.png`.
Reproductibilité : `harness/README.md`.*
