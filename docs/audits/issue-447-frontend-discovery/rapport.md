# Audit frontend découverte — défauts reproductibles hors fiche et figures (#447)

*Audit du 24 août 2026 · branche `issue/447-frontend-discovery-audit` · app Vue 3 + Vite sur le payload publié (`public/data/`, run du 23 août 2026).*

## Périmètre

Couloir **généraliste** du lot d'audits : tout ce que les quatre couloirs focalisés ne couvrent pas —
navigation, accueil, listes, carte (en tant que page, pas comme grammaire de couches), pages
Méthodes/Sources/À propos, pages d'indicateur (comportement général), états de chargement/vide/erreur,
accessibilité clavier et sémantique, erreurs runtime, cohérence inter-routes, aux deux largeurs
représentatives (desktop 1440×900, mobile 390×844 DPR 2 touch).

**Hors périmètre (couloirs parallèles, non dupliqués)** : hiérarchie/mise en page de la fiche
(#445), noms et détail des subventions (#446), grammaire des figures (#448), prose éditoriale (#449).
La fiche n'est visitée qu'en fumée (navigation, erreurs runtime, onglets) ; les pages d'indicateur ne
sont diagnostiquées que sur leurs états et leur comportement général, leur reconstruction étant déjà
ticketée (#439–#441).

## Comment rejouer

```powershell
# une fois
cd docs\audits\issue-447-frontend-discovery\harness
npm install

# la boucle complète (démarre vite toute seule sur le port dédié 5447,
# visite 16 routes × 2 largeurs, 7 scénarios, écrit evidence/smoke-report.json
# + les captures PNG) — ~3 min
node smoke.mjs

# diagnostics ciblés (voir la section Preuves)
node diagnostic-carte-affame.mjs      # la carte grise : réseau CDP + chronométrage
node diagnostic-tiroir-verrou.mjs     # le verrou de défilement du tiroir mobile (geste utilisateur)
node diagnostic-repro-minimal.mjs     # maplibre seul + le style de l'app : la tuile part immédiatement
```

Chrome système piloté par `playwright-core` (`CHROME_PATH`, défaut
`C:\Program Files\Google\Chrome\Application\chrome.exe`) ; aucun navigateur téléchargé. Le port
**5447** est dédié à cette boucle : les couloirs d'audit parallèles gardent 5173, et la boucle doit
servir **le checkout de ce travail**, jamais un autre.

Dernière exécution (celle de `evidence/smoke-report.json`) : 32 visites, 7 scénarios,
**0 erreur console, 0 pageerror, 0 requête échouée, 0 HTTP ≥ 400** hors manipulations volontaires ;
`debordeX = 0` sur les 16 routes aux deux largeurs ; tous les scénarios `OK`.

## Ce qui est sain (contrôles positifs)

Utile pour ne pas re-auditer : ces points ont été vérifiés et **passent**.

- **Stabilité runtime** : zéro erreur console/pageerror sur les 16 routes publiques aux deux largeurs (les seuls signaux capturés proviennent des manipulations volontaires : abort de `territoires.json`, 404 simulé de `indicateurs_milieux.json`).
- **Pas de débordement horizontal** (`scrollWidth ≤ clientWidth`) sur aucune route à 390 px ni 1440 px.
- **Lien d'évitement** : premier Tab le focalise, il devient visible (`top ≥ 0`, outline), la cible `#contenu-principal` existe.
- **Focus visible** (WCAG 2.2 AA) : l'anneau global `:focus-visible` (2 px `--brand-500`) se vérifie sur le parcours clavier ; l'unique stop sans outline propre est l'input de recherche, dont l'anneau est porté par la barre parente (`:focus-within`, box-shadow 2 px) — vérifié visuellement, faux positif de la sonde.
- **Tiroir mobile** : ouverture, focus piégé dans le tiroir, Escape ferme et rend le focus au burger, la navigation referme le tiroir, et le **verrou de défilement tient au geste utilisateur** (molette bloquée ; `html.tiroir-verrouille { overflow: clip }` → viewport `hidden`). Piège de mesure documenté : le scroll *programmatique* (`window.scrollTo`) reste possible avec `overflow: hidden` sur le viewport — la boucle mesure donc au geste, jamais au `scrollTo`.
- **Combobox de recherche** (pattern WAI-ARIA) : « renn » → 4 options, ↓ + Entrée ouvre `/territoire/commune/35238` ; état vide honnête (« Aucun résultat trouvé. »).
- **Divulgation « Données »** : clic ouvre, Escape (sur le bouton) ferme, le sous-menu navigue.
- **États d'erreur** : `territoires.json` aborté → « Impossible de charger les données. » + bouton Réessayer, en-tête restant utilisable (accueil) ; mêmes états typés présents dans listes, carte, sources, fiche, indicateur.
- **États vides** : recherche sans résultat ; liste filtrée sans ligne (« Aucune commune. Élargissez votre recherche ou retirez les filtres. », vérifié sur `/communes?departement=99`).
- **Thème absent** : `indicateurs_milieux.json` en 404 → l'onglet Milieux disparaît honnêtement de la fiche, sans crash (contrat « 404 = thème absent »).
- **Indicateur inconnu** : `/indicateurs/demographie/cle-inexistante` → « Indicateur introuvable. » en `role="alert"`.
- **Landmarks** (`header`/`nav`/`main`/`footer`), `lang="fr"`, zéro image sans alt, sur toutes les pages.
- **ThemeTabs** implémente le pattern ARIA tabs (roving tabindex, flèches, Home/End, `aria-selected`).
- **`prefers-reduced-motion`** couvert globalement (`base.css`).

## Défets classés

Chaque défet : reproduction, impact, preuve, couture propriétaire, sévérité/confiance, couverture.
Classement par sévérité décroissante.

---

### D1 — /carte : le fond de carte reste un rectangle gris 16–35+ s, affamé par le payload eager (~75 Mo)

**Sévérité HAUTE · confiance haute (local) / moyenne (amplification production).**

- **Reproduction** — Visiter `/carte` (cache vidé). Le canvas reste un gris uniforme pendant que
  `usePayload` télécharge **en parallèle et en avance de phase** la totalité du payload :
  `indicateurs_mobilite.json` 22,4 Mo + `indicateurs_habitat.json` 19,7 Mo + `indicateurs_milieux.json`
  13,2 Mo + `indicateurs_demographie.json` 11,9 Mo + histoires + programmes + apercu ≈ **75,4 Mo**.
  La première requête de tuile (`planet-vector/*.pbf`) ne part qu'après ce drain : **16,5 s** puis
  **> 35 s** selon les runs sur localhost. En bloquant les JSON lourds (`ctx.route('**/data/indicateurs_*.json' → abort)`),
  la tuile part **immédiatement** — preuve par intervention.
- **Impact utilisateur** — La carte est **le point d'entrée du produit** (ADR-0019) : un visiteur
  arrive sur un rectangle gris sans aucun indicateur de chargement (le squelette ne couvre que la
  géométrie, pas les tuiles). Sur une connexion mobile réelle, le délai se compte en minutes —
  et **chaque page du site** (l'accueil inclus) déclenche silencieusement ce téléchargement de
  75 Mo en arrière-plan : coût de données et d'énergie pour un site public.
- **Preuve** — `node diagnostic-carte-affame.mjs` (CDP Network : zéro requête
  `openmaptiles.data.gouv.fr` pendant la fenêtre ; le TileJSON et les sprites partent, les `.pbf`
  non) ; `evidence/screens/carte-desktop.png` et `carte-mobile.png` (canvas gris) ;
  `carte-desktop-apres-35s.png` (la carte finit par se dessiner parfaitement : c'est un délai, pas
  une casse) ; le canvas grisé est exactement `rgb(242,243,240)` — la couleur `background` **du
  style**, preuve que le style est appliqué et seules les tuiles manquent ;
  `diagnostic-repro-minimal.mjs` (maplibre seul + le même style sur le même serveur : tuiles
  immédiates) écarte la bibliothèque, le style et l'environnement.
- **Couture propriétaire** — `usePayload.demarrer()` (le magasin à avance de phase de #296/#298,
  ADR-0003) : le *wait-set* gouverne le **rendu**, jamais la **priorité de fetch** ; la carte
  (`MapExplorer` + `useGeometrie`) n'a aucun moyen de passer devant. Le serveur de dev (HTTP/1.1,
  6 connexions/hôte, JSON non compressés) amplifie ; Vercel multiplexe en HTTP/2 mais le poids
  reste. Les frères `.parquet` (10× plus petits) existent dans le payload sans être consommés.
- **Couverture** — #296/#298 (wait-set de rendu), #303 (carte neutre d'abord) ne traitent pas la
  priorisation des fetch. **Non couvert** → ticket draft T-1.

---

### D2 — Aucune route 404 : une URL inconnue rend un `main` vide (HTTP 200)

**Sévérité HAUTE · confiance haute.**

- **Reproduction** — Visiter `/cette-route-nexiste-pas` : en-tête + pied de page normaux,
  `<main>` **vide** (7 caractères d'espacement), aucun message, aucun titre, statut 200
  (fallback SPA). La console enregistre l'avertissement `VUE_ROUTER_R0004` (« No match found »).
- **Impact utilisateur** — Tout lien périmé ou mal saisi atterrit sur une page blanche inexpliquée,
  sans proposition de retour : pire qu'une 404, une *absence* de page.
- **Preuve** — `smoke-report.json` (route `route-inexistante` : `h1: []`, main vide) ;
  `evidence/screens/route-inexistante-desktop.png` et `-mobile.png`.
- **Couture** — `app/src/router/index.ts` : pas de route catch-all (`/:pathMatch(.*)*`) ni de vue
  `Introuvable`.
- **Couverture** — Aucune issue ouverte ne la couvre. **Non couvert** → ticket draft T-2 (lot avec D3/D5).

---

### D3 — `document.title` identique sur toutes les routes (WCAG 2.4.2 « Page Titled », niveau A)

**Sévérité MOYENNE · confiance haute.**

- **Reproduction** — Naviguer sur n'importe quelle route : le titre de l'onglet reste
  « Lusk — Observatoire des territoires bretons » partout (16/16 routes dans `smoke-report.json`).
  Le routeur **définit** `meta.title` pour chaque route mais rien ne l'applique
  (`document.title` et `meta.title` : zéro occurrence dans `app/src` hors la déclaration).
- **Impact utilisateur** — Historique, onglets, favoris et lecteurs d'écran ne distinguent pas
  « Les communes » de « Rennes » de « Sources » ; un utilisateur avec 3 fiches ouvertes ne sait
  plus laquelle est laquelle.
- **Preuve** — `smoke-report.json` (champ `titre` par route, identique) ; `grep document.title` vide.
- **Couture** — `router.afterEach` (ou un `watch` dans `App.vue`) écrivant `document.title` depuis
  `to.meta.title` (+ nom du territoire pour les fiches).
- **Couverture** — Non couvert → ticket draft T-2 (lot avec D2/D5).

---

### D4 — Contraste des tokens de texte sous le seuil AA (WCAG 1.4.3)

**Sévérité MOYENNE · confiance haute (math statique sur les tokens).**

- **Reproduction** — Calcul WCAG sur les valeurs de `tokens.css` :
  - `--text-secondary #718096` sur blanc : **4,02:1** (seuil 4,5:1 pour texte < 24 px non gras) —
    et 3,86:1 sur `--surface-secondary`, 3,67:1 sur `--surface-tertiary`. Porté par du texte réel :
    sous-titre de l'accueil (`--text-body-lg`), intro de Sources, liens du pied de page
    (`.pied-liens a`, 14 px), attribution du pied.
  - `--text-tertiary #A0AEC0` sur blanc : **2,26:1** — porte des **informations et des actions** :
    la ligne de fraîcheur de l'accueil (`accueil-fraicheur`, **un lien**), le lien de fraîcheur du
    pied (`pied-fraicheur`), l'eyebrow « Jeu de données » de /sources, les placeholders.
- **Impact utilisateur** — Lecture dégradée pour malvoyants et en plein soleil ; la **promesse de
  fraîcheur** — l'argument de confiance du produit — est le texte le moins lisible du site.
- **Preuve** — Calculs reproductibles (script dans l'historique de l'audit ; ratios ci-dessus) ;
  `evidence/screens/accueil-desktop.png` (ligne de fraîcheur quasi illisible sous « La carte
  interactive »).
- **Couture** — `app/src/styles/tokens.css` : la valeur des deux tokens (DESIGN.md §2 ; la note
  « unverified » de DESIGN.md ne vise que les steps 300/600/700/900 de la rampe marque, pas les
  tokens de texte). Correction **un-hex par token**, puis balayage des usages.
- **Couverture** — Aucune issue ouverte. **Non couvert** → ticket draft T-3.

---

### D5 — L'accueil et /carte n'ont pas de `h1`

**Sévérité MOYENNE-FAIBLE · confiance haute.**

- **Reproduction** — `smoke-report.json` : `h1: []` sur `accueil`, `carte`, `carte-programmes`
  (et sur `route-inexistante`/`indicateur-inconnu`, voir D2). L'accroche de l'accueil
  « Intelligence territoriale en Bretagne » est un `<p>` stylé `--text-display` ; la carte n'a
  qu'une tablist.
- **Impact utilisateur** — La navigation par titres (lecteurs d'écran) et la structure du document
  sont rompues sur les **deux pages les plus importantes** ; incohérent avec les 12 autres routes
  qui ont toutes un h1.
- **Preuve** — `smoke-report.json` ; `evidence/screens/accueil-desktop.png`.
- **Couture** — `AccueilView.vue` (promouvoir l'accroche en h1), `CarteView.vue` (h1 masqué
  visuellement « Carte interactive » ou titre d'onglet actif).
- **Couverture** — Non couvert → ticket draft T-2 (lot avec D2/D3).

---

### D6 — « Explorer sur la carte » des listes ne porte pas le territoire (remise morte)

**Sévérité MOYENNE · confiance haute.**

- **Reproduction** — Sur `/communes` (idem `/epcis`, `/departements`), chaque ligne propose
  « Explorer sur la carte » → `RouterLink to="/carte"` **sans aucun paramètre** ; or `CarteView`
  ne lit que `?theme=`, `?onglet=`, `?programme=` — **aucun état URL de territoire n'existe**.
  Cliquer « Explorer sur la carte » pour Lorient livre la carte neutre de la Bretagne.
- **Impact utilisateur** — La promesse de l'action n'est pas tenue : l'utilisateur doit
  rechercher à nouveau le territoire qu'il avait sous la souris. Remise fiche↔carte cassée dans
  le sens listes→carte (le sens fiche→carte via la recherche fonctionne, lui).
- **Preuve** — `ListeTerritoires.vue` (lien `to="/carte"` nu) ; lecture de `route.query` dans
  `CarteView.vue` (aucun `territoire`) ; scénario de navigation du smoke (menu Données OK, mais
  aucune remise de territoire testable — le paramètre n'existe pas).
- **Couture** — `ListeTerritoires.vue` (action) + `CarteView.vue` (état `?territoire=<code>` à
  créer : zoom + popup, comme la recherche interne le fait déjà en mémoire).
- **Couverture** — #276 (spec carte miroir) et #282 (onglet programmes) ne couvrent pas la remise
  listes→carte. **Non couvert** → ticket draft T-4.

---

### D7 — Densité de tabulation : 3 628 stops clavier sur /communes (1 202 lignes × 3 liens), aucune pagination

**Sévérité MOYENNE-FAIBLE · confiance haute (mesuré).**

- **Reproduction** — `smoke-report.json` : `focusables = 3628` sur `/communes` (chaque ligne porte
  le lien du nom + « Voir la fiche » + « Explorer sur la carte »), 204 sur `/epcis`, **2428** sur
  la page d'indicateur `densite` (table complète des 1 202 communes, 2 stops/ligne). Le parcours
  Tab de la boucle s'arrête au plafond des 40 presses sans avoir quitté le tiers supérieur de la
  page.
- **Impact utilisateur** — Au clavier ou avec une loupe d'écran, atteindre la 900ᵉ commune ou
  simplement le pied de page exige des centaines de Tab ; pas de pagination, pas de regroupement,
  pas de raccourci. Poids DOM conséquent (rendu mobile inclus).
- **Preuve** — `smoke-report.json` (champ `focusables` par route) ; `ListeTerritoires.vue`
  (3 RouterLink par ligne, aucune pagination) ; `IndicateurPage.vue` (table complète).
- **Couture** — `ListeTerritoires.vue` (pagination ou regroupement par département) ; la table des
  pages d'indicateur est en reconstruction (#439–#441) — lui signaler l'exigence.
- **Couverture** — Partiel : #439–#441 pour les tables d'indicateurs ; **les listes ne sont
  couvertes nulle part** → ticket draft T-5.

---

### D8 — Cibles tactiles < 24 px sur des contrôles non-lien (WCAG 2.5.8)

**Sévérité FAIBLE · confiance haute (mesuré).**

- **Reproduction** — `smoke-report.json` (`ciblesTropPetites`) : boutons de tri d'en-tête des
  listes **h = 21 px** (`Nom`, `Code`, `EPCI`) ; sur la page d'indicateur, boutons de vues
  **h = 20 px** et boutons de tri/table **h = 17 px** ; sur la fiche, `subvention-reveler`
  h = 21 px (→ couloir #446). Les liens texte inline (h = 14–21 px) sont exemptés
  (exception WCAG des liens dans le texte).
- **Impact utilisateur** — Erreurs de toucher sur mobile pour les tri de listes et les contrôles
  d'indicateur.
- **Preuve** — Mesures DOM par la boucle (champ `ciblesTropPetites`, filtrage des liens inline).
- **Couture** — `ListeTerritoires.vue` (padding des `.entete-tri`) ; `IndicateurPage.vue`
  (cross-ref #439+).
- **Couverture** — Partielle (#439+ pour l'indicateur) → lot T-5.

---

### D9 — Escape ne ferme le menu « Données » que depuis le bouton

**Sévérité FAIBLE · confiance haute (vérifié en direct).**

- **Reproduction** — Ouvrir « Données » au clavier, Tab dans le sous-menu, presser Escape :
  le menu **reste ouvert** (l'écouteur `@keydown.escape` est posé sur le bouton uniquement).
- **Impact** — Incohérence de clavier mineure ; le menu se ferme à la sélection ou au clic hors menu.
- **Preuve** — Vérification en direct (script de l'audit) : « NON (défectueux) ».
- **Couture** — `AppHeader.vue` (écouteur au niveau du conteneur `.nav-item`, ou `focusout`).
- **Couverture** — Non couvert → micro-lot T-6.

---

### D10 — `aria-current="page"` absent de la navigation active

**Sévérité FAIBLE · confiance haute.**

- **Reproduction** — L'état actif de l'en-tête et du tiroir est porté par la seule classe
  `.nav-lien--actif` (soulignement 2 px + couleur) ; aucun `aria-current="page"` sur les
  RouterLink de navigation (bureau comme tiroir).
- **Impact** — Un lecteur d'écran ne sait pas quelle section est active ; l'information reste
  purement visuelle.
- **Preuve** — `AppHeader.vue` (liaisons de classe sans `aria-current`) ; sonde DOM (aucun
  `aria-current` hors le fil d'Ariane des listes, qui le porte correctement).
- **Couture** — `AppHeader.vue`.
- **Couverture** — Non couvert → micro-lot T-6.

---

### Observés mais DÉJÀ couverts (non dupliqués)

- **La fiche ouvre encore sur « Aperçu »** (premier onglet), sans le sixième thème « Programmes et
  subventions » ni Milieux absent-manipulé : c'est l'état courant **avant** la migration déjà
  ticketée (#408, #410). Constaté lors du scénario thème-absent ; aucune action ici.
- **La rudesse des pages d'indicateur** (tables denses, cibles 17–20 px, états terses) : la
  reconstruction est en cours (#439, #440, #441) — l'exigence de densité clavier (D7) et de cibles
  (D8) leur est signalée en cross-ref.
- **La ligne de fraîcheur « Actualisation partielle … 1 source à traiter à la main »** : fond
  éditorial → couloir #449 (le contraste, lui, est D4).

## Preuves (répertoire `evidence/`)

- `smoke-report.json` — le rapport machine complet de la dernière boucle (32 visites × sondes +
  7 scénarios).
- `screens/` — captures représentatives (le jeu complet se régénère par `node smoke.mjs`) :
  carte grise desktop/mobile, carte après 35 s, carte headed (anti-artefact headless), accueil,
  fiche commune, route inexistante (desktop/mobile), états erreur/vide/thème-absent, indicateur
  inconnu.

## Caveats de la boucle

1. **Port dédié 5447** — un autre serveur de dev (couloir parallèle) occupait 5173 ; la boucle
   démarre sa propre instance de CE checkout et échoue si le port est pris (`--strictPort`).
2. **Verrou de défilement** — `overflow: clip` sur la racine devient `hidden` sur le viewport
   (CSS Overflow §3.3) : le scroll programmatique reste possible alors que les gestes sont bloqués.
   Toute mesure de verrou doit se faire au geste (`page.mouse.wheel`), sinon faux positif —
   piège documenté dans `smoke.mjs`.
3. **Lecture pixel du canvas WebGL** impossible (`preserveDrawingBuffer` off) : la preuve du rendu
   passe par les captures d'écran et la couleur exacte du fond.
4. **D1 en production** — le mécanisme mesuré ici (pool HTTP/1.1 du serveur de dev) sera différent
   sur Vercel (HTTP/2+) et sur le Pi ; le poids de 75 Mo et l'absence d'indicateur de chargement,
   eux, sont identiques. Une mesure production est à ajouter au ticket T-1.
5. **La fiche n'est pas auditée ici** (couloirs #445/#446/#448/#449) — les fiches ne servent que de
   contrôles de fumée (navigation, erreurs, onglets).

## Tickets prêts à déposer (drafts, avec dépendances)

- **T-1 — fix(carte): ne pas affamer les tuiles derrière le payload eager (~75 Mo)** — priorité
  haute. Options à trancher à la couture #296 : fetch des paires de thème à la demande (route-
  driven), `fetchpriority`/différé des JSON hors wait-set, ou bascule vers les `.parquet` publiés ;
  + indicateur de chargement visible sur le canvas tant que les tuiles ne sont pas prêtes.
  Dépend : architecture #296/#298 ; à mesurer aussi sur Vercel/Pi.
- **T-2 — fix(router): route 404 + `document.title` par route + h1 accueil/carte** — lot D2+D3+D5,
  petit et autonome (catch-all `/:pathMatch(.*)*` + vue Introuvable, `afterEach` titre, h1).
- **T-3 — fix(tokens): contraste AA de `--text-secondary` et `--text-tertiary`** — un hex par
  token + balayage des usages (fraîcheur accueil/pied, eyebrow Sources, liens pied). Interagit avec
  DESIGN.md §2 (à amender si les valeurs changent).
- **T-4 — feat(carte): état `?territoire=` + remise « Explorer sur la carte » des listes** —
  dépend de rien ; s'aligne sur la recherche interne déjà présente dans CarteView.
- **T-5 — feat(listes): pagination/regroupement + cibles tactiles ≥ 24 px** — D7+D8 ; signaler
  l'exigence équivalente aux tickets #439–#441 pour les tables d'indicateurs.
- **T-6 — fix(a11y): micro-lot navigation** — Escape du menu Données depuis le sous-menu (D9) +
  `aria-current="page"` (D10).
