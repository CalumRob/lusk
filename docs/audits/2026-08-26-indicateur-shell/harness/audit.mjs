#!/usr/bin/env node
/**
 * Audit navigateur déterministe — #481 audit(indicateurs) : shell, onglets et
 * handoffs depuis la fiche.
 *
 * Zéro dépendance hors playwright-core : sert `app/dist` (le build de la
 * branche) sur un port dédié (5481 — jamais 5173/5447 des couloirs
 * d'audit parallèles), pilote le Chrome système (aucun navigateur
 * téléchargé) et produit par scénario une preuve JSON objective + une
 * capture PNG dans ../evidence/.
 *
 * Deux familles de scénarios :
 *   A. Shell — Pages d'indicateur représentatives (toutes les familles
 *      publiées) × 4 largeurs (mobile 390, demi-bureau 1024, bureau 1440,
 *      grand bureau 1920) : hiérarchie (sur-titre → h1 → définition), note
 *      de contexte (#472), onglets `.vues` (états actif/hover/focus,
 *      synchronisation ?vue=), identité visuelle (rampe du thème, Manrope/
 *      Newsreader), densité/espacements, débordements responsive, carte
 *      (#398 — constat d'état, JAMAIS comptée comme défaut).
 *   B. Handoffs — fiche × thème (commune urbaine, commune rurale, EPCI,
 *      département, Région) : inventaire exhaustif des ancres
 *      .passarelle-exploration (libellé, href, target/rel, boîte tactile),
 *      sémantique nouvelle fenêtre (#468), contrat d'URL (#409 :
 *      territoire + niveau comparable, la Région SANS niveau), continuité à
 *      l'arrivée (note de contexte nomme le territoire, ligne surlignée),
 *      liens inverses préservant la lentille (?theme=).
 *
 * Les assertions A1..A8 sont capables de ROUGE (--assert : exit 1). Sans
 * --assert le rapport est produit intégralement, défauts compris.
 *
 * Usage :
 *   npm install                      # une fois, ici (isolé de app/)
 *   node audit.mjs [--only <filtre>] [--no-shots] [--assert]
 */
import { createServer } from 'node:http'
import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, normalize, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const { chromium } = await import('playwright-core')

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..', '..', '..', '..')
const DIST = join(REPO, 'app', 'dist')
const EVIDENCE = join(HERE, '..', 'evidence')
const PORT = Number(process.env.PORT || 5481)
const BASE = process.env.BASE_URL || `http://localhost:${PORT}`
const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'

const args = process.argv.slice(2)
const ONLY = args.includes('--only') ? (args[args.indexOf('--only') + 1] || '').split(',').filter(Boolean) : null
const SHOTS = !args.includes('--no-shots')
const ASSERT = args.includes('--assert')

// ---------------------------------------------------------------------------
// Matrice — pages représentatives (chaque famille publiée au moins une fois)
// et handoffs (les cinq types de territoire).
// ---------------------------------------------------------------------------
const PAGES_SHELL = [
  // Les clés publiées d'indicator_pages (jamais les slugs de sous-groupe) —
  // chaque famille de page au moins une fois, plus le repli générique.
  { theme: 'mobilite', indicator: 'offre_tc', famille: 'scalar' },
  { theme: 'habitat', indicator: 'mix_logements', famille: 'composition' },
  { theme: 'demographie', indicator: 'structure_age', famille: 'pyramid' },
  { theme: 'habitat', indicator: 'distribution_dpe', famille: 'distribution' },
  { theme: 'milieux', indicator: 'artif_par_habitant', famille: 'trajectory' },
  { theme: 'mobilite', indicator: 'reseaux', famille: 'list' },
  { theme: 'demographie', indicator: 'evolution_1968', famille: 'generique' },
  { theme: 'economie', indicator: 'chomage', famille: 'generique' },
]

const VIEWPORTS = [
  { nom: 'mobile', width: 390, height: 844 },
  { nom: 'demi-bureau', width: 1024, height: 768 },
  { nom: 'bureau', width: 1440, height: 900 },
  { nom: 'grand-bureau', width: 1920, height: 1080 },
]

const HANDOFFS = [
  { type: 'commune', id: '35238', nom: 'Rennes', themes: ['mobilite', 'habitat', 'demographie'] },
  { type: 'commune', id: '22001', nom: 'Allineuc', themes: ['mobilite'] },
  { type: 'epci', id: '243500139', nom: 'Rennes Métropole', themes: ['mobilite', 'programmes'] },
  { type: 'departement', id: '35', nom: 'Ille-et-Vilaine', themes: ['milieux'] },
  // La Région : exclue de la comparaison data-first — son handoff porte le
  // territoire SANS niveau (contrat explorationHandoff).
  { type: 'region', id: '53', nom: 'Bretagne', themes: ['economie'], sansNiveau: true },
]

// ---------------------------------------------------------------------------
// Serveur statique SPA (app/dist) — zéro dépendance.
// ---------------------------------------------------------------------------
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.geojson': 'application/geo+json',
  '.parquet': 'application/octet-stream',
}
function startServeur() {
  const serveur = createServer((req, res) => {
    const cheminBrut = decodeURIComponent(new URL(req.url, BASE).pathname)
    let fichier = normalize(join(DIST, cheminBrut))
    if (!fichier.startsWith(DIST)) {
      res.writeHead(403); res.end(); return
    }
    if (!existsSync(fichier)) fichier = join(DIST, 'index.html') // repli SPA
    try {
      const corps = readFileSync(fichier)
      res.writeHead(200, { 'content-type': MIME[fichier.slice(fichier.lastIndexOf('.'))] || 'application/octet-stream' })
      res.end(corps)
    } catch {
      res.writeHead(404); res.end()
    }
  })
  return new Promise((resoudre) => serveur.listen(PORT, () => resoudre(serveur)))
}

// ---------------------------------------------------------------------------
// Collecte DOM — un seul evaluateur partagé pour le shell.
// ---------------------------------------------------------------------------
async function mesurerShell(page) {
  return page.evaluate(() => {
    const $ = (s) => document.querySelector(s)
    const $$ = (s) => [...document.querySelectorAll(s)]
    const cs = (el) => (el ? getComputedStyle(el) : null)
    const section = $('.indicateur-page')
    const h1s = $$('h1')
    const h1 = h1s[0]
    const surTitre = $('.sur-titre')
    const note = $('[data-testid="note-contexte"]')
    const vuesNav = $('nav.vues')
    const boutons = vuesNav ? $$('nav.vues button').map((b) => {
      const c = cs(b)
      return {
        libelle: b.textContent.trim(),
        actif: b.classList.contains('active'),
        hauteur: Math.round(b.getBoundingClientRect().height),
        largeur: Math.round(b.getBoundingClientRect().width),
        borderBottomWidth: c.borderBottomWidth,
        borderBottomColor: c.borderBottomColor,
        fontWeight: c.fontWeight,
        color: c.color,
      }
    }) : []
    const heroMedian = $('.median strong')
    const densitySvg = $('svg.density')
    const extremesLiens = $$('.extremes a').slice(0, 4).map((a) => a.getAttribute('href'))
    const table = $('table')
    const tableWrap = table ? table.parentElement : null
    const selectNiveau = $('label select')
    const headerEl = $('header')
    return {
      titre: document.title,
      h1Count: h1s.length,
      h1Texte: h1?.textContent.trim() ?? null,
      h1FontSize: h1 ? cs(h1).fontSize : null,
      h1FontFamily: h1 ? cs(h1).fontFamily.split(',')[0] : null,
      headerOrdre: headerEl ? [...headerEl.children].map((e) => e.className || e.tagName) : [],
      surTitreTexte: surTitre?.textContent.trim() ?? null,
      surTitreCouleur: surTitre ? cs(surTitre).color : null,
      definitionPresente: Boolean($('header p:not(.sur-titre)')?.textContent.trim()),
      noteContexte: note?.textContent.trim() ?? null,
      vuesAriaLabel: vuesNav?.getAttribute('aria-label') ?? null,
      vuesBoutons: boutons,
      heroPresent: Boolean($('.hero')),
      medianFontFamily: heroMedian ? cs(heroMedian).fontFamily.split(',')[0] : null,
      medianFontSizePx: heroMedian ? cs(heroMedian).fontSize : null,
      densitySvgPresente: Boolean(densitySvg),
      extremesLiens,
      tableLignes: table ? table.querySelectorAll('tbody tr').length : 0,
      tableLigneSelection: $('.selection td')?.textContent.trim().slice(0, 80) ?? null,
      tableScrollW: table?.scrollWidth ?? null,
      tableClientW: table?.clientWidth ?? null,
      tableParentOverflowX: tableWrap ? cs(tableWrap).overflowX : null,
      controlsFlexWrap: $('.controls') ? cs($('.controls')).flexWrap : null,
      paddingGaucheSection: section ? cs(section).paddingLeft : null,
      paddingDroiteSection: section ? cs(section).paddingRight : null,
      contentMaxWidth: section ? Math.round(section.getBoundingClientRect().width) : null,
      innerW: window.innerWidth,
      docScrollW: document.documentElement.scrollWidth,
      accentVar: section ? cs(section).getPropertyValue('--indicateur-accent').trim() : null,
      manropeChargee: document.fonts.check("16px 'Manrope Variable'"),
      newsreaderChargee: document.fonts.check("16px 'Newsreader Variable'"),
      selectNiveauOptions: selectNiveau ? [...selectNiveau.options].map((o) => o.value) : [],
    }
  })
}

/** L'état de la vue Carte après délai — constat d'état #398, jamais un défaut. */
async function mesurerVueCarte(page) {
  return page.evaluate(() => {
    const wrap = document.querySelector('.map-wrap')
    const chargement = document.querySelector('.carte-indicateur [role="status"]')
    const canvas = wrap ? wrap.querySelectorAll('canvas').length : 0
    const svgTuiles = wrap ? wrap.querySelectorAll('.maplibregl-canvas').length : 0
    return { wrapPresent: Boolean(wrap), canvas, maplibreCanvas: svgTuiles, enChargement: Boolean(chargement), texteChargement: chargement?.textContent ?? null }
  })
}

/** Focus clavier sur les boutons d'onglets — outline visible ? */
async function focusVisibleVues(page) {
  await page.evaluate(() => document.querySelector('nav.vues button')?.focus())
  await page.keyboard.press('Tab')
  return page.evaluate(() => {
    const actif = document.activeElement
    const c = actif ? getComputedStyle(actif) : null
    return {
      element: actif?.textContent?.trim()?.slice(0, 30) ?? null,
      outlineStyle: c?.outlineStyle ?? null,
      outlineWidth: c?.outlineWidth ?? null,
      boxShadow: c?.boxShadow === 'none' ? null : c?.boxShadow,
    }
  })
}

// ---------------------------------------------------------------------------
// Collecte DOM — inventaire des passarelles d'une fiche.
// ---------------------------------------------------------------------------
async function inventorierPassarelles(page) {
  return page.evaluate(() => {
    const ancreInfo = (a) => {
      const r = a.getBoundingClientRect()
      const nav = a.closest('nav.lecture-passarelles')
      return {
        libelle: a.textContent.trim(),
        accessibleName: (a.getAttribute('aria-label') || a.textContent.trim()).trim(),
        href: a.getAttribute('href'),
        target: a.getAttribute('target'),
        rel: a.getAttribute('rel'),
        largeur: Math.round(r.width),
        hauteur: Math.round(r.height),
        fontSize: getComputedStyle(a).fontSize,
        dansNavLecture: Boolean(nav),
        etiquetteGroupe: nav?.querySelector('.lecture-passarelles-etiquette')?.textContent ?? null,
        couleurRepos: getComputedStyle(a).color,
        textDecoration: getComputedStyle(a).textDecorationLine,
      }
    }
    const ancres = [...document.querySelectorAll('a.passarelle-exploration')].map(ancreInfo)
    const navLectures = [...document.querySelectorAll('nav.lecture-passarelles')].map((n) => ({
      ariaLabel: n.getAttribute('aria-label'),
      etiquettes: [...n.querySelectorAll('.lecture-passarelles-etiquette')].map((e) => e.textContent),
      liens: [...n.querySelectorAll('a')].map((a) => a.textContent.trim()),
    }))
    const grilleGroupes = [...document.querySelectorAll('.sous-groupe')].map((g) => ({
      groupe: g.dataset.groupe,
      passarelles: [...g.querySelectorAll('a.passarelle-exploration')].map((a) => ({ href: a.getAttribute('href'), libelle: a.textContent.trim(), lecture: Boolean(a.closest('nav.lecture-passarelles')) })),
    }))
    return { total: ancres.length, ancres, navLectures, grilleGroupes }
  })
}

// ---------------------------------------------------------------------------
// Assertions capables de ROUGE — chaque entrée : {id, ok, detail}.
// ---------------------------------------------------------------------------
function verifier(preuve) {
  const R = []
  const add = (id, ok, detail) => R.push({ id, ok, detail })

  if (preuve.genre === 'shell') {
    const m = preuve.mesures
    add('A1-hierarchie', m.h1Count === 1 && Boolean(m.surTitreTexte) && m.definitionPresente,
      `h1×${m.h1Count} « ${m.h1Texte} » ; sur-titre « ${m.surTitreTexte} » ; définition ${m.definitionPresente}`)
    add('A1-note-contexte', typeof m.noteContexte === 'string' && m.noteContexte.length > 10,
      `${m.noteContexte}`)
    const actifs = m.vuesBoutons.filter((b) => b.actif)
    add('A2-onglets-etat-actif', m.vuesBoutons.length === 3 && actifs.length === 1 &&
      parseInt(actifs[0]?.borderBottomWidth) >= 3 && parseInt(actifs[0]?.fontWeight) >= 700,
      `boutons=${m.vuesBoutons.map((b) => b.libelle).join('|')} ; actifs=${actifs.length} ; border=${actifs[0]?.borderBottomWidth}/${actifs[0]?.borderBottomColor} ; weight=${actifs[0]?.fontWeight}`)
    add('A2-vues-nommees', m.vuesAriaLabel !== null && m.vuesBoutons.length === 3,
      `aria-label nav « ${m.vuesAriaLabel} »`)
    add('A6-responsive-hero', m.heroColonneUnique === undefined || m.heroColonneUnique === null ||
      preuve.viewport.nom !== 'mobile' || m.heroColonneUnique === true,
      `colonnes hero à ${preuve.viewport.nom} : ${m.heroColonnes ?? 'n/a'}`)
    add('A7-focus-visible', preuve.focus && (preuve.focus.outlineStyle !== 'none' || preuve.focus.boxShadow),
      `élément « ${preuve.focus?.element} » outline=${preuve.focus?.outlineStyle}/${preuve.focus?.outlineWidth} shadow=${Boolean(preuve.focus?.boxShadow)}`)
    if (preuve.viewport.nom === 'mobile') {
      add('A5-sans-debordement-mobile', m.docScrollW <= m.innerW + 1,
        `docScrollW=${m.docScrollW} vs innerW=${m.innerW}`)
    }
  }

  if (preuve.genre === 'handoff') {
    const inv = preuve.inventaire
    const mauvaisHref = inv.ancres.filter((a) => !(a.href || '').startsWith('/indicateurs/'))
    add('A3-anciennes-internes', inv.total > 0 && mauvaisHref.length === 0,
      `${inv.total} passarelles, ${mauvaisHref.length} hors /indicateurs/`)
    const sansBlank = inv.ancres.filter((a) => a.target !== '_blank')
    const sansRel = inv.ancres.filter((a) => !((a.rel || '').includes('noopener') && (a.rel || '').includes('noreferrer')))
    add('A8-nouvelle-fenetre', sansBlank.length === 0 && sansRel.length === 0,
      `${inv.total} ancres : ${sansBlank.length} sans target=_blank, ${sansRel.length} sans rel noopener/noreferrer`)
    const mauvaisTerritoire = inv.ancres.filter((a) => !(a.href || '').includes(`territoire=${preuve.spec.id}`))
    const niveauAttendu = preuve.spec.sansNiveau ? null : preuve.spec.type
    const mauvaisNiveau = niveauAttendu
      ? inv.ancres.filter((a) => !(a.href || '').includes(`niveau=${niveauAttendu}`))
      : inv.ancres.filter((a) => /(niveau=)/.test(a.href || ''))
    add('A3-contrat-url', mauvaisTerritoire.length === 0 && mauvaisNiveau.length === 0,
      `${mauvaisTerritoire.length} sans territoire=${preuve.spec.id} ; ${mauvaisNiveau.length} niveau incorrect (attendu: ${niveauAttendu ?? 'ABSENT — Région'})`)
    const arrivee = preuve.arrivee
    // Continuité minimale (#409) : l'URL d'arrivée porte le territoire émetteur,
    // la note de contexte le NOMME, même origine. Le surlignage de ligne ne
    // concerne QUE les pages qui rendent la table générique (les sorties par
    // famille — composition/pyramide/trajectoire/distribution — la remplacent)
    // et un territoire DANS le périmètre (la Région est honnêtement « hors
    // périmètre comparé », sans jamais apparaître dans les rangs).
    add('A3-continuite-arrivee', Boolean(arrivee) && arrivee.noteContientNom &&
      arrivee.queryTerritoire === preuve.spec.id && arrivee.memeOrigine,
      `URL ${arrivee?.url ?? '?'} ; note contient « ${preuve.spec.nom} »=${arrivee?.noteContientNom} ; territoire conservé=${arrivee?.queryTerritoire === preuve.spec.id}`)
    if (arrivee?.tablePresente && !preuve.spec.sansNiveau) {
      add('A3b-ligne-surlignee', arrivee.ligneSurlignee,
        `table générique présente ; ligne .selection au nom du territoire=${arrivee.ligneSurlignee}`)
    }
    const inverses = preuve.inversesEchantillon || []
    if (inverses.length === 0) {
      R.push({ id: 'A4-liens-inverses-lentille', ok: true, detail: 'aucun lien inverse sur cette famille (ni extrêmes ni table) — critère non applicable ici' })
    } else {
      const inversesOk = inverses.every((h) => (h || '').includes(`theme=${preuve.theme}`))
      add('A4-liens-inverses-lentille', inversesOk,
        `${inverses.length} liens inverses échantillonnés, tous avec ?theme=${preuve.theme} : ${inversesOk}`)
    }
    const minH = Math.min(...inv.ancres.map((a) => a.hauteur), Infinity)
    add('A10-cible-tactile-24px', minH >= 24, `hauteur minimale d'ancre = ${minH}px (seuil WCAG 2.5.8 AA = 24px ; repère confort 44px)`)
  }

  if (preuve.genre === 'interaction-vues') {
    const i = preuve.interaction
    add('A2-sync-url-vues',
      i.apresCarte.urlContientVueCarte === true &&
      i.apresIndicateur.urlContientVueIndicateur === true &&
      i.retourRepere.urlSansVue === true,
      `?vue=carte:${i.apresCarte.urlContientVueCarte} ; ?vue=indicateur:${i.apresIndicateur.urlContientVueIndicateur} ; retour sans vue:${i.retourRepere.urlSansVue}`)
  }

  return R
}

// ---------------------------------------------------------------------------
// Scénarios
// ---------------------------------------------------------------------------
function ecrire(nom, donnees) {
  writeFileSync(join(EVIDENCE, nom), JSON.stringify(donnees, null, 2))
}
async function capture(page, nom) {
  if (!SHOTS) return
  await page.screenshot({ path: join(EVIDENCE, `${nom}.png`), fullPage: false })
}

const resultats = []
let serveur

async function scenarioShell(browser, page_def, viewport, contexte) {
  const nom = `shell-${page_def.theme}-${page_def.indicator}-${viewport.width}`
  if (ONLY && !ONLY.some((f) => nom.includes(f))) return
  const page = await contexte.newPage()
  const url = `${BASE}/indicateurs/${page_def.theme}/${page_def.indicator}`
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('.indicateur-page header h1, [role="alert"]', { timeout: 90_000 })
    await page.waitForTimeout(400)

    const mesures = await mesurerShell(page)
    mesures.heroColonnes = await page.evaluate(() => {
      const hero = document.querySelector('.hero')
      return hero ? getComputedStyle(hero).gridTemplateColumns : null
    })
    if (mesures.heroColonnes) mesures.heroColonneUnique = !mesures.heroColonnes.includes(' ')

    // Interaction onglets + états focus (une fois par chargement — léger)
    const focus = await focusVisibleVues(page)

    const preuve = { genre: 'shell', url, viewport: { ...viewport }, famille: page_def.famille, mesures, focus }
    resultats.push({ nom, ...preuve, assertions: verifier(preuve) })
    await capture(page, nom)

    // Interaction des vues : distribution (famille à ensemble) ET pyramide
    // (multi-détail — la carte la plus risquée), au bureau seulement.
    if ((page_def.famille === 'distribution' || page_def.famille === 'pyramid') && viewport.nom === 'bureau') {
      const interaction = {}
      await page.click('nav.vues button:nth-child(2)')
      await page.waitForTimeout(600)
      interaction.apresCarte = {
        url: page.url(),
        urlContientVueCarte: page.url().includes('vue=carte'),
        etat: await mesurerVueCarte(page),
      }
      await page.waitForTimeout(6000) // latence masques/tuiles — constat d'état
      interaction.apresCarte.etat = await mesurerVueCarte(page)
      await capture(page, `${nom}-carte`)

      await page.click('nav.vues button:nth-child(3)')
      await page.waitForTimeout(600)
      interaction.apresIndicateur = {
        url: page.url(),
        urlContientVueIndicateur: page.url().includes('vue=indicateur'),
        asideTitre: await page.evaluate(() => document.querySelector('aside h2')?.textContent ?? null),
      }
      await capture(page, `${nom}-indicateur`)

      await page.click('nav.vues button:nth-child(1)')
      await page.waitForTimeout(600)
      interaction.retourRepere = { url: page.url(), urlSansVue: !page.url().includes('vue=') }
      const pInter = { genre: 'interaction-vues', interaction }
      resultats.push({ nom: `${nom}-interaction`, ...pInter, assertions: verifier(pInter) })
      ecrire(`${nom}-interaction.metrics.json`, pInter)
    }

    ecrire(`${nom}.metrics.json`, preuve)
  } catch (err) {
    resultats.push({ nom, genre: 'erreur', url, erreur: String(err) })
    ecrire(`${nom}.ERREUR.json`, { erreur: String(err) })
  } finally {
    await page.close()
  }
}

async function scenarioHandoff(browser, spec, theme, contexte) {
  const nom = `handoff-${spec.type}-${spec.id}-${theme}`
  if (ONLY && !ONLY.some((f) => nom.includes(f))) return
  const page = await contexte.newPage()
  try {
    const ficheUrl = `${BASE}/territoire/${spec.type}/${spec.id}?theme=${theme}`
    await page.goto(ficheUrl, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('.passarelle-exploration, .onglet-theme', { timeout: 90_000 })
    // attendre que TOUTES les passarelles soient posées (stabilisation)
    await page.waitForFunction(() => document.querySelectorAll('a.passarelle-exploration').length > 0, { timeout: 60_000 }).catch(() => {})
    await page.waitForTimeout(500)

    const inventaire = await inventorierPassarelles(page)

    // hover — la couleur doit bouger vers --passarelle-survol
    let survol = null
    if (inventaire.total > 0) {
      const premiere = page.locator('a.passarelle-exploration').first()
      const avant = await premiere.evaluate((el) => getComputedStyle(el).color)
      await premiere.hover()
      await page.waitForTimeout(250)
      const apres = await premiere.evaluate((el) => getComputedStyle(el).color)
      survol = { avant, apres, change: avant !== apres }
      // focus clavier — outline visible ?
      await premiere.focus()
      const focus = await premiere.evaluate((el) => {
        const c = getComputedStyle(el)
        return { outlineStyle: c.outlineStyle, outlineWidth: c.outlineWidth, boxShadow: c.boxShadow === 'none' ? null : c.boxShadow }
      })
      survol.focus = focus
    }

    // suivre la première passarelle (simule ce qu'ouvre le nouvel onglet)
    let arrivee = null
    let inversesEchantillon = []
    if (inventaire.total > 0) {
      const href = inventaire.ancres[0].href
      await page.goto(`${BASE}${href}`, { waitUntil: 'domcontentloaded' })
      await page.waitForSelector('[data-testid="note-contexte"], [role="alert"]', { timeout: 90_000 })
      await page.waitForSelector('table tbody tr', { timeout: 60_000 }).catch(() => {})
      await page.waitForTimeout(500)
      arrivee = await page.evaluate((nomT) => {
        const note = document.querySelector('[data-testid="note-contexte"]')?.textContent ?? ''
        const selection = document.querySelector('.selection td')?.textContent ?? ''
        const u = new URL(location.href)
        return {
          url: location.href,
          queryTerritoire: u.searchParams.get('territoire'),
          queryNiveau: u.searchParams.get('niveau'),
          note: note.trim(),
          noteContientNom: note.includes(nomT),
          horsPerimetre: note.includes('hors périmètre'),
          tablePresente: Boolean(document.querySelector('table tbody')),
          ligneSurlignee: Boolean(document.querySelector('.selection')) && selection.includes(nomT),
          memeOrigine: true,
        }
      }, spec.nom)
      // Échantillon de liens inverses : les extrêmes d'abord, sinon la table.
      inversesEchantillon = await page.evaluate(() => {
        const extremes = [...document.querySelectorAll('.extremes a')].slice(0, 3).map((a) => a.getAttribute('href'))
        if (extremes.length > 0) return extremes
        return [...document.querySelectorAll('table tbody tr td:first-child a')].slice(0, 3).map((a) => a.getAttribute('href'))
      })
      await capture(page, `${nom}-arrivee`)
    }

    const preuve = { genre: 'handoff', ficheUrl, theme, spec: { type: spec.type, id: spec.id, nom: spec.nom, sansNiveau: Boolean(spec.sansNiveau) }, inventaire, survol, arrivee, inversesEchantillon }
    resultats.push({ nom, ...preuve, assertions: verifier(preuve) })
    ecrire(`${nom}.metrics.json`, preuve)
  } catch (err) {
    resultats.push({ nom, genre: 'erreur', erreur: String(err) })
    ecrire(`${nom}.ERREUR.json`, { erreur: String(err) })
  } finally {
    await page.close()
  }
}

/** Passarelles à la largeur mobile — mesure tactile dédiée (Rennes × mobilité). */
async function scenarioTactileMobile(contexte) {
  const nom = 'tactile-handoff-rennes-mobilite-390'
  if (ONLY && !ONLY.some((f) => nom.includes(f))) return
  const page = await contexte.newPage()
  try {
    await page.goto(`${BASE}/territoire/commune/35238?theme=mobilite`, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('a.passarelle-exploration', { timeout: 90_000 })
    await page.waitForTimeout(500)
    const ancres = await page.evaluate(() =>
      [...document.querySelectorAll('a.passarelle-exploration')].map((a) => {
        const r = a.getBoundingClientRect()
        return { libelle: a.textContent.trim(), largeur: Math.round(r.width), hauteur: Math.round(r.height), fontSize: getComputedStyle(a).fontSize }
      }))
    const preuve = { genre: 'tactile-mobile', viewport: 390, ancres, minHauteur: Math.min(...ancres.map((a) => a.hauteur)), minLargeur: Math.min(...ancres.map((a) => a.largeur)) }
    resultats.push({ nom, ...preuve })
    ecrire(`${nom}.metrics.json`, preuve)
    await capture(page, nom)
  } catch (err) {
    resultats.push({ nom, genre: 'erreur', erreur: String(err) })
  } finally {
    await page.close()
  }
}

// ---------------------------------------------------------------------------
// Boucle principale
// ---------------------------------------------------------------------------
const serveurInstancie = await startServeur()
console.log(`[serve] app/dist sur ${BASE} (port dédié ${PORT})`)
console.log(`[chrome] ${CHROME} présent : ${existsSync(CHROME)}`)
mkdirSync(EVIDENCE, { recursive: true })

const browser = await chromium.launch({ executablePath: CHROME, headless: true })
try {
  for (const viewport of VIEWPORTS) {
    const contexte = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height } })
    for (const pageDef of PAGES_SHELL) await scenarioShell(browser, pageDef, viewport, contexte)
    if (viewport.nom === 'mobile') await scenarioTactileMobile(contexte)
    await contexte.close()
  }
  const contexteBureau = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  for (const spec of HANDOFFS) for (const theme of spec.themes) await scenarioHandoff(browser, spec, theme, contexteBureau)
  await contexteBureau.close()

  // Résumé + verdict des assertions
  const toutesAssertions = resultats.flatMap((r) => r.assertions || [])
  const rouges = toutesAssertions.filter((a) => !a.ok)
  const resume = {
    date: new Date().toISOString(),
    base: BASE,
    dist: DIST,
    scenarios: resultats.length,
    assertions: { total: toutesAssertions.length, rouges: rouges.length },
    rougeDetails: rouges,
    scenarios_en_erreur: resultats.filter((r) => r.genre === 'erreur').map((r) => r.nom),
  }
  ecrire('resume.json', { resume, resultats: resultats.map(({ nom, genre, assertions }) => ({ nom, genre, assertions })) })
  console.log('\n==== RÉSUMÉ ====')
  console.log(JSON.stringify(resume, null, 2))
  if (ASSERT && rouges.length > 0) {
    console.error(`\n[ASSERT] ${rouges.length} assertion(s) ROUGE`)
    process.exitCode = 1
  }
} finally {
  await browser.close()
  serveurInstancie.close()
}
