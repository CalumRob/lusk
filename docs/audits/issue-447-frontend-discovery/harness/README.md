# Harness — boucle de fumée navigateur (#447)

Pilote le Chrome système (`playwright-core`, aucun navigateur téléchargé) contre le serveur de dev
Vite de l'app, sur un **port dédié (5447)** pour ne jamais croiser un autre serveur (couloirs
d'audit parallèles sur 5173).

## Boucle complète

```powershell
npm install          # une fois (dépendances isolées de app/ — package-lock de l'app intact)
node smoke.mjs       # ~3 min : 16 routes × 2 largeurs + 7 scénarios → ../evidence/
```

La boucle démarre vite toute seule (ou `BASE_URL=http://…` pour cibler un serveur existant).
Sorties : `../evidence/smoke-report.json` + `../evidence/screens/*.png`.

## Diagnostics ciblés

| Script | Ce qu'il prouve |
|---|---|
| `diagnostic-carte-affame.mjs` | D1 : les tuiles de /carte ne partent qu'après le drain du payload (~75 Mo) — réseau CDP + chronométrage |
| `diagnostic-tiroir-verrou.mjs` | Contrôle positif : le verrou de défilement du tiroir tient **au geste** (molette), pas au `scrollTo` |
| `diagnostic-repro-minimal.mjs` | D1 : maplibre seul + le style de l'app sur le même serveur → tuiles immédiates (écarte bibliothèque/style/environnement) ; copie temporairement deux fichiers dans `app/public/` puis les supprime |

`repro-carte.html` sert au diagnostic minimal (page autonome maplibre + `positron-nolabels.json`).

## Variables

`CHROME_PATH` (défaut `C:\Program Files\Google\Chrome\Application\chrome.exe`), `BASE_URL`,
`PORT` (défaut 5447), `ATTENTE_MS` (diagnostic carte, défaut 35 000).
