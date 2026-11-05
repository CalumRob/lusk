# Harness — audit navigateur #481 (shell de la Page d'indicateur + passarelles fiche)

Pilote le Chrome système (`playwright-core`, aucun navigateur téléchargé) contre
**`app/dist` de la branche**, servi par un serveur statique SPA interne sur un
**port dédié (5481)** — jamais 5173/5447 des couloirs d'audit parallèles.

## Boucle complète

```powershell
npm install          # une fois (dépendances isolées de app/ — package-lock de l'app intact)
node audit.mjs       # ~7 min : 42 scénarios → ../evidence/ (*.metrics.json + *.png)
```

Options : `--only <sous-chaîne,...>` (filtrer des scénarios), `--no-shots`,
`--assert` (exit 1 si une assertion est ROUGE — CI-ready).

## Scénarios

- **Shell** (`shell-<thème>-<indicateur>-<largeur>`): 8 Pages d'indicateur
  représentatives — chaque famille publiée au moins une fois (scalaire,
  composition, pyramide, distribution, trajectoire, liste + le repli générique)
  × 4 largeurs (mobile 390 · demi-bureau 1024 · bureau 1440 · grand bureau
  1920). Mesure la hiérarchie (sur-titre → h1 → définition), la note de
  contexte (#472), les onglets `.vues` (états actif/focus, synchronisation
  `?vue=`), l'identité visuelle (rampe du thème, Manrope/Newsreader), les
  débordements responsive, et l'état de la vue Carte (#398 — constat d'état,
  jamais un défaut).
- **Handoffs** (`handoff-<type>-<id>-<thème>`): les cinq types de territoire
  (commune urbaine Rennes, commune rurale Allineuc, EPCI Rennes Métropole,
  département 35, Région 53) × leurs thèmes porteurs. Inventaire exhaustif des
  ancres `.passarelle-exploration` (libellé, href, target/rel, boîte tactile),
  sémantique nouvelle fenêtre (#468), contrat d'URL (#409 : territoire +
  niveau comparable, la Région SANS niveau), continuité à l'arrivée (note de
  contexte, ligne surlignée), liens inverses préservant la lentille (`?theme=`).
- **Tactile mobile**: mesures des cibles des passarelles à 390 px.
- **Interaction vues** (`*-interaction`): clic Repères → Carte → L'indicateur →
  Repères avec vérification d'URL à chaque pas (distribution ET pyramide
  multi-détail).

## Diagnostics ciblés

| Script | Ce qu'il prouve |
|---|---|
| `inventory.mjs` | Inventaire déterministe des sites de handoff par sous-groupe/famille, depuis le payload publié (35 sites, 34 avec page) |
| `diagnostic-selection-trajectoire.mjs` | F1 : sur `milieux/artif_par_habitant`, le territoire émetteur disparaît de la table générique selon le détail millésime résolu — contrôles scalaire/générique/prix_m2 qui, eux, surlignent correctement |

## Variables

`CHROME_PATH` (défaut `C:\Program Files\Google\Chrome\Application\chrome.exe`),
`BASE_URL`, `PORT` (défaut 5481).

## Pré-requis

`app/dist` doit être le build de la branche auditée (`npm run build` à la
racine) — le serveur ne sert QUE ce dossier. Ne JAMAIS committer `app/dist`
(precedent #468/#472/#473).
