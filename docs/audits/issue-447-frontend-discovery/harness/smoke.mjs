#!/usr/bin/env node
/**
 * Loop de fumée navigateur déterministe — audit #447
 * (audit(frontend) : défauts reproductibles hors fiche et figures).
 *
 * Ce que fait la boucle :
 *   1. sert l'app (`npm run dev` dans app/, ou BASE_URL si fourni) ;
 *   2. visite les routes publiques principales à deux largeurs représentatives
 *      (desktop 1440×900, mobile 390×844 — iPhone 14-ish, DPR 2, touch) ;
 *   3. capture par page : erreurs console, pageerror, requêtes échouées,
 *      réponses HTTP ≥ 400, débordement horizontal, h1/landmarks,
 *      contrôles sans nom accessible, images sans alt, tailles de cible ;
 *   4. exécute les scénarios clavier (lien d'évitement, combobox de
 *      recherche, menu Données, overlay Rechercher, tiroir mobile + Escape)
 *      et les états manipulés (territoires.json aborté → état d'erreur ;
 *      recherche sans résultat → état vide) ;
 *   5. écrit evidence/smoke-report.json + des captures PNG dans
 *      evidence/screens/.
 *
 * Usage :
 *   npm install            (une fois, dans ce dossier harness/)
 *   node smoke.mjs                       # démarre vite tout seul
 *   BASE_URL=http://localhost:5173 node smoke.mjs
 *
 * Chrome : CHROME_PATH (défaut C:\Program Files\Google\Chrome\Application\chrome.exe).
 * Aucun navigateur n'est téléchargé : playwright-core pilote le Chrome système.
 */

import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

const ici = dirname(fileURLToPath(import.meta.url))
const racineRepo = resolve(ici, '..', '..', '..', '..')
const dossierApp = resolve(racineRepo, 'app')
const dossierEvidence = resolve(ici, '..', 'evidence')
const dossierCaptures = resolve(dossierEvidence, 'screens')

const CHEMIN_CHROME =
  process.env.CHROME_PATH ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const BASE_URL = process.env.BASE_URL ?? null // sinon : vite démarré ci-dessous
// Port dédié à l'audit (#447) : les couloirs d'audit parallèles gardent 5173,
// et la boucle doit servir LE checkout de CE travail, jamais un autre.
const PORT = Number(process.env.PORT ?? 5447)

/** Les fixtures territoire — stables dans le payload publié (territoires.json). */
const FIXTURES = {
  commune: '35238', // Rennes
  epci: '243500139', // Rennes Métropole
  departement: '35', // Ille-et-Vilaine
  region: '53', // Bretagne
}

/** Les routes publiques principales (site-map). La fiche n'est visitée qu'en
 *  fumée (erreurs runtime / navigation) — sa mise en page relève des couloirs
 *  #445/#446/#448/#449 et n'est pas diagnostiquée ici. */
const ROUTES = [
  { nom: 'accueil', chemin: '/' },
  { nom: 'carte', chemin: '/carte' },
  { nom: 'carte-programmes', chemin: '/carte?onglet=programmes' },
  { nom: 'communes', chemin: '/communes' },
  { nom: 'epcis', chemin: '/epcis' },
  { nom: 'departements', chemin: '/departements' },
  { nom: 'fiche-commune', chemin: `/territoire/commune/${FIXTURES.commune}` },
  { nom: 'fiche-epci', chemin: `/territoire/epci/${FIXTURES.epci}` },
  { nom: 'fiche-departement', chemin: `/territoire/departement/${FIXTURES.departement}` },
  { nom: 'fiche-region', chemin: `/territoire/region/${FIXTURES.region}` },
  { nom: 'indicateur-densite', chemin: '/indicateurs/demographie/densite' },
  { nom: 'indicateur-inconnu', chemin: '/indicateurs/demographie/cle-inexistante' },
  { nom: 'methodologie', chemin: '/methodologie' },
  { nom: 'sources', chemin: '/sources' },
  { nom: 'a-propos', chemin: '/a-propos' },
  { nom: 'route-inexistante', chemin: '/cette-route-nexiste-pas' },
]

const LARGEURS = [
  { nom: 'desktop', viewport: { width: 1440, height: 900 }, mobile: false },
  {
    nom: 'mobile',
    viewport: { width: 390, height: 844 },
    mobile: true,
    dpr: 2,
  },
]

/* ------------------------------------------------------------------ */
/* Serveur de dev (si BASE_URL absent)                                 */
/* ------------------------------------------------------------------ */

let processusServeur = null

async function attendreServeur(url, delaiMs = 120_000) {
  const debut = Date.now()
  while (Date.now() - debut < delaiMs) {
    try {
      const r = await fetch(url)
      if (r.ok || r.status === 404) return
    } catch {
      /* pas encore prêt */
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error(`Le serveur de dev n'a répondu à ${url} après ${delaiMs} ms`)
}

function demarrerVite() {
  // Node ≥ 18.20 refuse de spawner des .cmd sans shell (CVE-2024-27980) :
  // on lance l'entrée JS de vite directement avec le node courant.
  const enfant = spawn(
    process.execPath,
    [
      resolve(dossierApp, 'node_modules', 'vite', 'bin', 'vite.js'),
      '--port',
      String(PORT),
      '--strictPort',
    ],
    { cwd: dossierApp, stdio: ['ignore', 'pipe', 'pipe'] },
  )
  enfant.stdout.on('data', () => {})
  enfant.stderr.on('data', (m) => process.stderr.write(`[vite] ${m}`))
  return enfant
}

function arreterServeur() {
  if (!processusServeur) return
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(processusServeur.pid), '/T', '/F'])
    } else {
      processusServeur.kill('SIGTERM')
    }
  } catch {
    /* déjà parti */
  }
}

/* ------------------------------------------------------------------ */
/* Sonde DOM injectée par page                                         */
/* ------------------------------------------------------------------ */

function sondePage() {
  const visuel = (el) => {
    const st = getComputedStyle(el)
    const r = el.getBoundingClientRect()
    if (st.display === 'none' || st.visibility === 'hidden') return false
    if (st.opacity === '0') return false
    return r.width > 0 && r.height > 0
  }
  const nomAccessible = (el) => {
    const al = el.getAttribute('aria-label')
    if (al && al.trim()) return al
    const alby = el.getAttribute('aria-labelledby')
    if (alby) {
      const t = alby
        .split(/\s+/)
        .map((id) => document.getElementById(id)?.textContent ?? '')
        .join(' ')
        .trim()
      if (t) return t
    }
    if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement) {
      if (el.id) {
        const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`)
        if (l?.textContent?.trim()) return l.textContent.trim()
      }
      const englobe = el.closest('label')
      if (englobe?.textContent?.trim()) return englobe.textContent.trim()
      return el.placeholder || el.title || ''
    }
    return (el.textContent || '').trim() || el.title || ''
  }

  const res = {}
  res.titre = document.title
  res.langue = document.documentElement.lang || null
  res.h1 = [...document.querySelectorAll('h1')].map((h) => h.textContent.trim())
  res.jalons = {
    header: !!document.querySelector('header'),
    nav: !!document.querySelector('nav'),
    main: !!document.querySelector('main'),
    footer: !!document.querySelector('footer'),
  }

  const interactifs = [
    ...document.querySelectorAll(
      'button, a[href], input:not([type="hidden"]), select, textarea, [role="button"], summary',
    ),
  ].filter((el) => visuel(el) && el.getAttribute('aria-hidden') !== 'true')
  res.controlesSansNom = interactifs
    .filter((el) => !nomAccessible(el).trim())
    .slice(0, 12)
    .map((el) => ({
      tag: el.tagName.toLowerCase(),
      classe: String(el.className).slice(0, 80),
      html: el.outerHTML.replace(/\s+/g, ' ').slice(0, 160),
    }))
  res.imagesSansAlt = [...document.querySelectorAll('img')].filter(
    (i) => i.getAttribute('alt') === null,
  ).length

  // Débordement horizontal (la page défile-t-elle latéralement ?)
  const doc = document.scrollingElement
  res.debordeX = doc ? doc.scrollWidth - doc.clientWidth : 0
  if (res.debordeX > 1) {
    const vw = window.innerWidth
    res.elementsHorsEcran = [...document.querySelectorAll('body *')]
      .filter((el) => {
        const st = getComputedStyle(el)
        if (st.position === 'fixed' || st.position === 'absolute') return false
        const r = el.getBoundingClientRect()
        return r.right > vw + 1 && r.width > 8 && st.display !== 'none'
      })
      .slice(0, 6)
      .map((el) => ({
        tag: el.tagName.toLowerCase(),
        classe: String(el.className).slice(0, 80),
        droite: Math.round(el.getBoundingClientRect().right),
        largeur: Math.round(el.getBoundingClientRect().width),
      }))
  }

  // Tailles de cible (WCAG 2.5.8 : min 24×24) — signal brut, exceptions possibles.
  res.ciblesTropPetites = interactifs
    .map((el) => {
      const r = el.getBoundingClientRect()
      return { el, w: Math.round(r.width), h: Math.round(r.height) }
    })
    .filter(({ w, h }) => w > 0 && h > 0 && (w < 24 || h < 24))
    .slice(0, 10)
    .map(({ el, w, h }) => ({
      tag: el.tagName.toLowerCase(),
      classe: String(el.className).slice(0, 60),
      texte: (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 40),
      w,
      h,
    }))

  // Nombre de focusables (ordre clavier parcouru séparément au clavier réel).
  res.focusables = [
    ...document.querySelectorAll('a[href], button:not([disabled]), input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'),
  ].filter((el) => visuel(el)).length

  return res
}

/* ------------------------------------------------------------------ */
/* Boucle principale                                                   */
/* ------------------------------------------------------------------ */

const rapport = {
  meta: {
    date: new Date().toISOString(),
    chrome: CHEMIN_CHROME,
    baseUrl: null,
    largeurs: LARGEURS.map((l) => `${l.nom} ${l.viewport.width}x${l.viewport.height}`),
    fixtures: FIXTURES,
  },
  pages: [],
  scenarios: [],
}

function journaliseEvenements(page, entree) {
  page.on('console', (msg) => {
    const type = msg.type()
    if (type === 'error' || type === 'warning') {
      entree.console.push({
        niveau: type,
        texte: msg.text().slice(0, 400),
      })
    }
  })
  page.on('pageerror', (err) => {
    entree.pageerrors.push(String(err?.stack ?? err).slice(0, 600))
  })
  page.on('requestfailed', (req) => {
    entree.requetesEchecs.push({
      url: req.url().slice(0, 200),
      erreur: req.failure()?.errorText,
    })
  })
  page.on('response', (rep) => {
    if (rep.status() >= 400) {
      entree.http.push({ statut: rep.status(), url: rep.url().slice(0, 200) })
    }
  })
}

async function visite(page, route, largeur, entree) {
  await page.goto(BASE_URL_LOCAL + route.chemin, { waitUntil: 'load' })
  try {
    await page.waitForLoadState('networkidle', { timeout: 15_000 })
  } catch {
    /* les tuiles carte peuvent rester actives — pas bloquant */
  }
  await page.waitForTimeout(largeur.mobile ? 600 : 400)
  entree.probe = await page.evaluate(sondePage)
  entree.captures = `${route.nom}-${largeur.nom}.png`
  await page.screenshot({
    path: resolve(dossierCaptures, entree.captures),
    fullPage: route.nom !== 'carte' && route.nom !== 'carte-programmes',
  })

  // Parcours clavier : jusqu'à 40 Tab, on enregistre l'ordre et le focus visible.
  await page.evaluate(() => document.activeElement?.blur())
  const parcours = []
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press('Tab')
    const stop = await page.evaluate(() => {
      const el = document.activeElement
      if (!el || el === document.body) return null
      const st = getComputedStyle(el)
      return {
        tag: el.tagName.toLowerCase(),
        classe: String(el.className).slice(0, 50),
        nom: ((el.getAttribute('aria-label') ?? '') || (el.textContent || '')).trim().slice(0, 40),
        outline: st.outlineStyle !== 'none' && parseFloat(st.outlineWidth) > 0,
        ombre: st.boxShadow !== 'none',
      }
    })
    if (!stop) break
    parcours.push(stop)
    if (i === 0) {
      entree.premierTab = stop
    }
  }
  entree.parcoursClavier = parcours.length
  entree.stopsSansIndicateurFocus = parcours.filter((s) => !s.outline && !s.ombre)
}

/* ---------------- scénarios ---------------- */

async function scenarioComboboxRecherche(contexte, resultat) {
  const page = await contexte.newPage()
  journaliseEvenements(page, resultat)
  await page.goto(`${BASE_URL_LOCAL}/`, { waitUntil: 'load' })
  await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {})
  const champ = page.locator('.accueil-recherche input[role="combobox"]')
  await champ.click()
  await champ.fill('renn')
  await page.waitForTimeout(450) // debounce 250 ms
  const optionsOuvertes = await page.locator('#gsb-resultats [role="option"]').count()
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(700)
  resultat.urlApresEntree = page.url()
  resultat.optionsProposees = optionsOuvertes
  resultat.succes = page.url().includes('/territoire/')
  await page.close()
}

async function scenarioMenuDonnees(contexte, resultat) {
  const page = await contexte.newPage()
  journaliseEvenements(page, resultat)
  await page.goto(`${BASE_URL_LOCAL}/`, { waitUntil: 'load' })
  await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {})
  const bouton = page.locator('.nav-bureau button', { hasText: 'Données' })
  await bouton.click()
  resultat.ouvertAuClic = await page.locator('.sous-nav').isVisible()
  // Atteignable au clavier ? le bouton est focusable, Escape doit fermer.
  await page.keyboard.press('Escape')
  resultat.fermeParEscape = !(await page.locator('.sous-nav').isVisible())
  // Le lien du sous-menu navigue-t-il ?
  await bouton.click()
  await page.locator('.sous-nav a', { hasText: 'Les communes' }).click()
  await page.waitForTimeout(500)
  resultat.navigationSousMenu = page.url()
  resultat.succes =
    resultat.ouvertAuClic && resultat.fermeParEscape && resultat.navigationSousMenu.includes('/communes')
  await page.close()
}

async function scenarioOverlayRecherche(contexte, resultat) {
  const page = await contexte.newPage()
  journaliseEvenements(page, resultat)
  await page.goto(`${BASE_URL_LOCAL}/communes`, { waitUntil: 'load' })
  await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {})
  await page.locator('.bouton-recherche').click()
  resultat.panneauVisible = await page.locator('#recherche-superposee').isVisible()
  resultat.focusDansChamp = await page.evaluate(
    () => document.activeElement?.getAttribute('role') === 'combobox',
  )
  await page.keyboard.press('Escape')
  await page.waitForTimeout(150)
  resultat.fermeParEscape = !(await page.locator('#recherche-superposee').isVisible().catch(() => false))
  resultat.focusRenduAuBouton = await page.evaluate(
    () => document.activeElement?.classList?.contains('bouton-recherche') ?? false,
  )
  resultat.succes = resultat.panneauVisible && resultat.focusDansChamp && resultat.fermeParEscape && resultat.focusRenduAuBouton
  await page.close()
}

async function scenarioTiroirMobile(contexte, resultat) {
  const page = await contexte.newPage()
  journaliseEvenements(page, resultat)
  await page.goto(`${BASE_URL_LOCAL}/`, { waitUntil: 'load' })
  await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {})
  await page.locator('.bouton-menu').click()
  await page.waitForTimeout(400)
  resultat.tiroirOuvert = await page.evaluate(() =>
    document.getElementById('menu-mobile')?.classList.contains('tiroir--ouvert'),
  )
  resultat.focusDansTiroir = await page.evaluate(() =>
    document.getElementById('menu-mobile')?.contains(document.activeElement),
  )
  // Verrou de défilement par GESTE UTILISATEUR — jamais window.scrollTo :
  // html.tiroir-verrouille { overflow: clip } devient overflow:hidden sur le
  // viewport (spec CSS Overflow §3.3), qui bloque les gestes mais laisse le
  // défilement programmatique — scrollTo donnerait un faux positif.
  const yAvant = await page.evaluate(() => window.scrollY)
  await page.mouse.move(195, 400)
  await page.mouse.wheel(0, 600)
  await page.waitForTimeout(250)
  const yApres = await page.evaluate(() => window.scrollY)
  resultat.pageDefileDerriere = yApres !== yAvant
  // Naviguer depuis le tiroir doit le refermer (#61).
  await page.locator('#menu-mobile a', { hasText: 'Les départements' }).click()
  await page.waitForTimeout(400)
  resultat.fermeApresNavigation = await page.evaluate(
    () => !document.getElementById('menu-mobile')?.classList.contains('tiroir--ouvert'),
  )
  resultat.urlFinale = page.url()
  // Réouverture puis Escape.
  await page.locator('.bouton-menu').click()
  await page.waitForTimeout(250)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(250)
  resultat.fermeParEscape = await page.evaluate(
    () => !document.getElementById('menu-mobile')?.classList.contains('tiroir--ouvert'),
  )
  resultat.succes =
    resultat.tiroirOuvert &&
    resultat.focusDansTiroir &&
    !resultat.pageDefileDerriere &&
    resultat.fermeApresNavigation &&
    resultat.fermeParEscape
  await page.close()
}

async function scenarioEtatErreurTerritoires(navigateur, resultat) {
  const contexte = await navigateur.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await contexte.newPage()
  journaliseEvenements(page, resultat)
  await contexte.route('**/data/territoires.json*', (routeAb) => routeAb.abort('failed'))
  await page.goto(`${BASE_URL_LOCAL}/`, { waitUntil: 'load' })
  await page.waitForTimeout(1500)
  resultat.messageErreurVisible = await page
    .getByText('Impossible de charger les données.')
    .isVisible()
    .catch(() => false)
  resultat.boutonReessayer = await page.getByRole('button', { name: 'Réessayer' }).isVisible().catch(() => false)
  resultat.enTeteUtilisable = await page.locator('.en-tete').isVisible()
  resultat.capture = 'etat-erreur-accueil.png'
  await page.screenshot({ path: resolve(dossierCaptures, 'etat-erreur-accueil.png') })
  await contexte.close()
  resultat.succes = resultat.messageErreurVisible && resultat.boutonReessayer
}

async function scenarioRechercheVide(contexte, resultat) {
  const page = await contexte.newPage()
  journaliseEvenements(page, resultat)
  await page.goto(`${BASE_URL_LOCAL}/`, { waitUntil: 'load' })
  await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {})
  const champ = page.locator('.accueil-recherche input[role="combobox"]')
  await champ.click()
  await champ.fill('qzzzwwxx')
  await page.waitForTimeout(450)
  resultat.etatVideVisible = await page.getByText('Aucun résultat trouvé.').isVisible().catch(() => false)
  await page.screenshot({ path: resolve(dossierCaptures, 'etat-vide-recherche.png') })
  resultat.succes = resultat.etatVideVisible
  await page.close()
}

async function scenarioFicheAbsenteTheme(navigateur, resultat) {
  // Manipulation de requête : indicateurs_milieux.json en 404 → le thème doit
  // disparaître honnêtement de la fiche (état « thème absent »), jamais planter.
  const contexte = await navigateur.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await contexte.newPage()
  journaliseEvenements(page, resultat)
  await contexte.route('**/data/indicateurs_milieux.json*', (routeAb) =>
    routeAb.fulfill({ status: 404, body: 'Payload introuvable' }),
  )
  await page.goto(`${BASE_URL_LOCAL}/territoire/commune/${FIXTURES.commune}`, { waitUntil: 'load' })
  await page.waitForTimeout(2500)
  resultat.pageerrors = resultat.pageerrors ?? []
  resultat.ongletsPresents = await page.evaluate(() =>
    [...document.querySelectorAll('[role="tab"], .theme-tabs button, [class*="onglet"] button')].map(
      (b) => b.textContent.trim(),
    ),
  )
  resultat.milieuAbsent = !resultat.ongletsPresents.some((t) => /milieux/i.test(t))
  await page.screenshot({ path: resolve(dossierCaptures, 'theme-absent-fiche.png'), fullPage: false })
  await contexte.close()
  resultat.succes = resultat.milieuAbsent
}

/* ------------------------------------------------------------------ */
/* Exécution                                                           */
/* ------------------------------------------------------------------ */

if (!existsSync(CHEMIN_CHROME)) {
  console.error(`Chrome introuvable à ${CHEMIN_CHROME} (CHROME_PATH pour surcharger).`)
  process.exit(1)
}

mkdirSync(dossierCaptures, { recursive: true })

let codeSortie = 0
try {
  if (!BASE_URL) {
    console.log('Démarrage de `npm run dev` dans app/ …')
    processusServeur = demarrerVite()
  }
  const base = BASE_URL ?? `http://localhost:${PORT}`
  globalThis.BASE_URL_LOCAL = base
  rapport.meta.baseUrl = base
  await attendreServeur(base)

  const navigateur = await chromium.launch({
    executablePath: CHEMIN_CHROME,
    headless: true,
  })

  for (const largeur of LARGEURS) {
    const contexte = await navigateur.newContext({
      viewport: largeur.viewport,
      deviceScaleFactor: largeur.dpr ?? 1,
      isMobile: largeur.mobile,
      hasTouch: largeur.mobile,
      locale: 'fr-FR',
    })
    const page = await contexte.newPage()

    for (const route of ROUTES) {
      const entree = {
        route: route.nom,
        url: base + route.chemin,
        largeur: largeur.nom,
        console: [],
        pageerrors: [],
        requetesEchecs: [],
        http: [],
      }
      journaliseEvenements(page, entree)
      try {
        await visite(page, route, largeur, entree)
      } catch (e) {
        entree.erreurBoucle = String(e).slice(0, 300)
        codeSortie = 2
      }
      rapport.pages.push(entree)
      const problemes =
        entree.pageerrors.length +
        entree.console.filter((c) => c.niveau === 'error').length +
        entree.http.length
      console.log(
        `[${largeur.nom}] ${route.nom} — ${problemes} signal(s), debordeX=${entree.probe?.debordeX ?? '?'}`,
      )
    }

    // Scénarios par largeur
    if (!largeur.mobile) {
      for (const [nom, fn] of [
        ['combobox-recherche', scenarioComboboxRecherche],
        ['menu-donnees', scenarioMenuDonnees],
        ['overlay-rechercher', scenarioOverlayRecherche],
      ]) {
        const resultat = { scenario: nom, largeur: largeur.nom, pageerrors: [], console: [], requetesEchecs: [], http: [] }
        try {
          await fn(contexte, resultat)
        } catch (e) {
          resultat.erreurBoucle = String(e).split('\n')[0].slice(0, 300)
        }
        rapport.scenarios.push(resultat)
        console.log(`scénario ${nom} → ${resultat.succes === true ? 'OK' : resultat.succes === false ? 'ÉCHEC' : resultat.erreurBoucle}`)
      }
    } else {
      const resultat = { scenario: 'tiroir-mobile', largeur: 'mobile', pageerrors: [], console: [], requetesEchecs: [], http: [] }
      try {
        await scenarioTiroirMobile(contexte, resultat)
      } catch (e) {
        resultat.erreurBoucle = String(e).split('\n')[0].slice(0, 300)
      }
      rapport.scenarios.push(resultat)
      console.log(`scénario tiroir-mobile → ${resultat.succes === true ? 'OK' : 'À VÉRIFIER'}`)
    }

    await contexte.close()
  }

  // États manipulés (contextes dédiés)
  const rErreur = { scenario: 'etat-erreur-territoires-abortes', pageerrors: [], console: [], requetesEchecs: [], http: [] }
  await scenarioEtatErreurTerritoires(navigateur, rErreur)
  rapport.scenarios.push(rErreur)
  console.log(`scénario état-erreur → ${rErreur.succes === true ? 'OK' : 'ÉCHEC'}`)

  const cVide = await navigateur.newContext({ viewport: { width: 1440, height: 900 } })
  const rVide = { scenario: 'recherche-sans-resultat', pageerrors: [], console: [], requetesEchecs: [], http: [] }
  await scenarioRechercheVide(cVide, rVide)
  rapport.scenarios.push(rVide)
  console.log(`scénario recherche vide → ${rVide.succes === true ? 'OK' : 'ÉCHEC'}`)
  await cVide.close()

  const rThemeAbsent = { scenario: 'theme-milieux-absent-404', pageerrors: [], console: [], requetesEchecs: [], http: [] }
  await scenarioFicheAbsenteTheme(navigateur, rThemeAbsent)
  rapport.scenarios.push(rThemeAbsent)
  console.log(`scénario thème absent → ${rThemeAbsent.succes === true ? 'OK' : 'ÉCHEC'}`)

  await navigateur.close()
} finally {
  arreterServeur()
}

writeFileSync(resolve(dossierEvidence, 'smoke-report.json'), JSON.stringify(rapport, null, 2))

// Résumé console
const signaux = rapport.pages.reduce((n, p) => {
  const k =
    p.pageerrors.length +
    p.console.filter((c) => c.niveau === 'error').length +
    p.http.length +
    p.requetesEchecs.filter((r) => !String(r.url).includes('/@vite/') && !String(r.url).includes('/@fs/')).length
  return n + k
}, 0)
console.log(`\nTerminé : ${rapport.pages.length} visites, ${rapport.scenarios.length} scénarios.`)
console.log(`Signaux bruts (console error/pageerror/http≥400/requêtes échouées hors vite) : ${signaux}`)
console.log(`Rapport : ${resolve(dossierEvidence, 'smoke-report.json')}`)
process.exit(codeSortie)
