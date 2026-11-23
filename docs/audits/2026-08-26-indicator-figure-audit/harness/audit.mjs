#!/usr/bin/env node
/**
 * audit.mjs — audit déterministe de la grammaire Repères des Pages d'indicateur (#479).
 *
 * Zéro dépendance npm : Chrome est piloté par CDP (WebSocket natif de Node ≥ 22),
 * le serveur Vite est spawné par le script. Aucune modification du code produit.
 *
 * Ce que fait la boucle :
 *   1. énumère chaque Page d'indicateur publiée depuis public/data/theme_*.json
 *      (source unique du catalogue) et identifie sa famille sémantique ;
 *   2. pour chaque page : état par défaut + chaque niveau publié + un territoire
 *      mis en avant — mesures DOM objectives + recoupement contre une
 *      réimplémentation INDÉPENDANTE du modèle (médiane, rangs ex-aequo,
 *      extrêmes, périmètre) lue depuis le payload committé ;
 *   3. captures représentatives mobile + desktop ;
 *   4. écrit evidence/manifest.json + evidence/shots/*.jpg.
 *
 * Usage :
 *   node docs/audits/2026-08-26-indicator-figure-audit/harness/audit.mjs [--no-shots] [--only <theme/key>]
 */

import { spawn } from 'node:child_process'
import { execFile } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..')
const APP = path.join(RACINE, 'app')
const PAYLOAD = path.join(RACINE, 'public', 'data')
const EVIDENCE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../evidence')
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'

const ARGS = process.argv.slice(2)
const WITH_SHOTS = !ARGS.includes('--no-shots')
const onlyIndex = ARGS.indexOf('--only')
const ONLY = onlyIndex >= 0 ? ARGS[onlyIndex + 1] : null

const DESKTOP = { name: 'desktop', width: 1280, height: 900, mobile: false }
const MOBILE = { name: 'mobile', width: 390, height: 844, mobile: true }
const THEMES = ['demographie', 'mobilite', 'habitat', 'economie', 'milieux', 'programmes']
const NIVEAUX = ['commune', 'epci', 'departement']

/* ------------------------------------------------------------------ */
/* 1. Énumération du catalogue publié + miroir indépendant du modèle   */
/* ------------------------------------------------------------------ */

function chargerCatalogue() {
  const pages = []
  for (const theme of THEMES) {
    const meta = JSON.parse(readFileSync(path.join(PAYLOAD, `theme_${theme}.json`), 'utf8'))
    for (const [key, page] of Object.entries(meta.indicator_pages ?? {})) {
      pages.push({ theme, key, label: page.label, family: page.family ?? 'scalar', levels: page.levels ?? [], unit: page.unit, direction: page.direction, comparison: page.comparison ?? null, raw: page })
    }
  }
  return pages
}

const territoiresCache = JSON.parse(readFileSync(path.join(PAYLOAD, 'territoires.json'), 'utf8'))
const faitsParTheme = Object.fromEntries(THEMES.map((t) => [t, JSON.parse(readFileSync(path.join(PAYLOAD, `indicateurs_${t}.json`), 'utf8'))]))
const refsParId = new Map(territoiresCache.map((t) => [t.territoire, t]))

/** Le périmètre actif — même prédicat que dansScope (explorationModel.ts). */
function dansScope(t, niveau, departement, epci) {
  return t.type === niveau && (niveau !== 'commune' || ((!departement || t.departement === departement) && (!epci || t.epci === epci)))
}

function mediane(values) {
  if (!values.length) return null
  const tries = [...values].sort((a, b) => a - b)
  const milieu = Math.floor(tries.length / 2)
  return tries.length % 2 ? tries[milieu] : (tries[milieu - 1] + tries[milieu]) / 2
}

/** Rangs directionnels ex-aequo « 1, 1, 3 » (ADR-0015). */
function rangsExAequo(values, direction) {
  const tries = [...values].sort((a, b) => (direction === 'low' ? a - b : b - a))
  const rangParValeur = new Map()
  tries.forEach((value, index) => {
    const precedent = index > 0 ? tries[index - 1] : null
    rangParValeur.set(value, precedent !== null && precedent === value ? rangParValeur.get(precedent) : index + 1)
  })
  return values.map((v) => rangParValeur.get(v))
}

/** Ligne de comparaison par facette au niveau/périmètre donnés — miroir de modeleExploration. */
function lignesFacette(page, etat) {
  const cmp = page.comparison ?? {}
  const indicator = cmp.indicator ?? page.key
  const detail = cmp.detail ?? page.raw.detail ?? null
  const sex = cmp.sex ?? null
  const dimension = cmp.dimension ?? null
  const rows = faitsParTheme[page.theme]
    .filter((f) => f.theme === page.theme && f.key === indicator && f.detail === detail && (f.sex ?? null) === sex && (f.dimension ?? null) === dimension && f.type === etat.niveau && f.value !== null)
    .map((f) => ({ f, t: refsParId.get(f.territoire) }))
    .filter((r) => r.t && dansScope(r.t, etat.niveau, etat.departement, etat.epci))
    .map((r) => ({ id: r.t.territoire, nom: r.t.nom, value: r.f.value }))
  const values = rows.map((r) => r.value)
  const rangs = rangsExAequo(values, cmp.direction ?? page.direction)
  rows.forEach((r, i) => { r.rang = rangs[i] })
  rows.sort((a, b) => a.nom.localeCompare(b.nom, 'fr'))
  const max = values.length ? Math.max(...values) : null
  const min = values.length ? Math.min(...values) : null
  return {
    rows,
    median: mediane(values),
    highCount: max === null ? 0 : values.filter((v) => v === max).length,
    lowCount: min === null ? 0 : values.filter((v) => v === min).length,
    max, min,
  }
}

/** Miroir de normalizeComparisonFacet (familySeam.ts) : résolution + validité
 * de la facette depuis une query URL — mêmes sémantiques d'allow-lists. */
function facetteDepuisQuery(page, query = {}) {
  const cmp = page.comparison ?? {}
  const q = (key) => {
    const v = query[key]
    if (v === undefined) return { value: null, present: false, malformed: false }
    if (typeof v === 'string' && v.length > 0) return { value: v, present: true, malformed: false }
    return { value: null, present: true, malformed: true }
  }
  const resoudre = (r, allowed, fallback) => {
    const valid = !r.malformed && (!r.present || (allowed !== undefined && r.value !== null && allowed.includes(r.value)))
    return { value: valid && r.present ? r.value : fallback, valid }
  }
  const detail = resoudre(q('detail'), cmp.details, cmp.detail ?? page.raw.detail ?? null)
  const sex = resoudre(q('sex'), cmp.sexes, cmp.sex ?? null)
  const dimension = resoudre(q('dimension'), cmp.dimensions, cmp.dimension ?? null)
  return { detail: detail.value, sex: sex.value, dimension: dimension.value, valid: detail.valid && sex.valid && dimension.valid }
}
function queryDeUrl(url) {
  try { return Object.fromEntries(new URL(url).searchParams) } catch { return {} }
}

/* Familles qui reçoivent le slot partagé (héros, extrêmes, contrôles, tableau)
 * dans RepereFamilyOutlet — pyramid / composition / comparison-bars rendent
 * leur bloc SANS ce chrome (choix d'implémentation mesuré comme tel). */
const FAMILLES_AVEC_SLOT = ['scalar', 'trajectory', 'distribution', 'list', 'relationship']

/* Formatage partagé (#466) — miroir exact de formaterValeur/formaterNombreFR. */
function formaterNombreFR(x, decimalesMax) {
  const fixe = x.toFixed(decimalesMax)
  const [entiers, decPart = ''] = fixe.split('.')
  const decs = decPart.replace(/0+$/, '')
  const groupes = entiers.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
  return decs ? `${groupes},${decs}` : groupes
}
function formaterValeur(value, unit) {
  if (value === null) return null
  const estPourcent = unit === '%'
  return formaterNombreFR(estPourcent ? value * 100 : value, estPourcent ? 0 : 2)
}
function parseFR(texte) {
  return parseFloat(String(texte).replace(/\u202f|\u00a0|\s/g, '').replace(',', '.'))
}

/* ------------------------------------------------------------------ */
/* 2. Mini-client CDP                                                  */
/* ------------------------------------------------------------------ */

class Cdp {
  constructor(ws) {
    this.ws = ws
    this.seq = 0
    this.pending = new Map()
    this.listeners = new Map()
    this.ouvert = new Promise((resolve, reject) => {
      ws.addEventListener('open', () => resolve(), { once: true })
      ws.addEventListener('error', () => reject(new Error('WebSocket CDP fermé à l’ouverture')), { once: true })
    })
    ws.addEventListener('message', (event) => {
      const msg = JSON.parse(event.data)
      if (msg.id !== undefined && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id)
        this.pending.delete(msg.id)
        msg.error ? reject(new Error(`${msg.error.message}: ${msg.error.data ?? ''}`)) : resolve(msg.result)
      } else if (msg.method) {
        for (const fn of this.listeners.get(msg.method) ?? []) fn(msg.params)
      }
    })
  }
  async send(method, params = {}) {
    await this.ouvert
    const id = ++this.seq
    this.ws.send(JSON.stringify({ id, method, params }))
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }))
  }
  on(method, fn) {
    if (!this.listeners.has(method)) this.listeners.set(method, new Set())
    this.listeners.get(method).add(fn)
  }
  close() { this.ws.close() }
}

function portLibre() {
  return new Promise((resolve, reject) => {
    const srv = createServer()
    srv.listen(0, '127.0.0.1', () => { const p = srv.address().port; srv.close(() => resolve(p)) })
    srv.on('error', reject)
  })
}

async function attendreHttp(url, timeoutMs, motif) {
  const debut = Date.now()
  while (Date.now() - debut < timeoutMs) {
    try {
      const res = await fetch(url)
      if (res.ok) return res
    } catch { /* pas prêt */ }
    await new Promise((r) => setTimeout(r, 200))
  }
  throw new Error(`Délai dépassé en attendant ${motif} (${url})`)
}

function tuer(arbre) {
  if (!arbre || arbre.exitCode !== null || arbre.signalCode) return Promise.resolve()
  if (process.platform === 'win32') {
    return new Promise((resolve) => execFile('taskkill', ['/pid', String(arbre.pid), '/T', '/F'], () => resolve()))
  }
  arbre.kill('SIGKILL')
  return Promise.resolve()
}

/* ------------------------------------------------------------------ */
/* 3. Extraction DOM (évaluée dans la page)                            */
/* ------------------------------------------------------------------ */

const SCRIPT_EXTRACTION = `(() => {
  const racine = document.querySelector('.indicateur-page')
  if (!racine) return { present: false }
  const texteDe = (el) => el ? el.textContent.replace(/\\s+/g, ' ').trim() : null
  const alertes = [...racine.querySelectorAll('[role="alert"]')].map(texteDe)
  const statuts = [...racine.querySelectorAll('[role="status"]')].map(texteDe)
  const notes = [...racine.querySelectorAll('[role="note"]')].map(texteDe)
  const rendererEl = racine.querySelector('[data-renderer].family-renderer') ?? racine.querySelector('[data-renderer]')
  const noteContexte = texteDe(racine.querySelector('[data-testid="note-contexte"]'))
  const medianStrong = racine.querySelector('.hero article.median strong')
  const mediane = medianStrong ? {
    nombre: texteDe(medianStrong.childNodes[0]),
    unit: texteDe(medianStrong.querySelector('small')),
    scope: texteDe(racine.querySelector('.hero article.median p')),
  } : null
  const densitySvg = racine.querySelector('svg.density')
  const densityPath = densitySvg ? densitySvg.querySelector('path') : null
  const marker = densitySvg ? densitySvg.querySelector('circle.point-highlight') : null
  const heroPresent = Boolean(racine.querySelector('.hero'))
  const extremes = [...racine.querySelectorAll('.extremes article')].map((a) => ({
    titre: texteDe(a.querySelector('h2')),
    egalite: texteDe(a.querySelector('span')),
    liens: [...a.querySelectorAll('a')].map((x) => ({ texte: texteDe(x), href: x.getAttribute('href') })),
  }))
  const controles = [...racine.querySelectorAll('.controls label')].map((l) => ({
    libelle: texteDe(l.childNodes[0]),
    type: l.querySelector('select') ? 'select' : l.querySelector('input') ? 'input' : '?',
    valeur: l.querySelector('select') ? l.querySelector('select').value : l.querySelector('input')?.value ?? null,
    options: l.querySelector('select') ? [...l.querySelectorAll('option')].map((o) => o.value) : undefined,
  }))
  const table = racine.querySelector('main table')
  const enteteDirection = table ? (() => { const s = [...table.querySelectorAll('thead th span')].pop(); return s ? { texte: texteDe(s), title: s.getAttribute('title'), aria: s.getAttribute('aria-label') } : null })() : null
  const lignesTable = table ? [...table.querySelectorAll('tbody tr')].map((tr) => {
    const lien = tr.querySelector('td a')
    const cellules = [...tr.querySelectorAll('td')]
    return {
      href: lien?.getAttribute('href') ?? null,
      nom: texteDe(lien),
      valeur: texteDe(cellules[1]),
      rang: texteDe(cellules[2]?.querySelector('span')) ?? texteDe(cellules[2]),
      selection: tr.className.includes('selection'),
    }
  }) : []
  const caption = table ? texteDe(table.querySelector('caption')) : null

  // --- extras par famille ---
  const extra = {}
  const signatureBloc = racine.querySelector('[data-testid="signature-distribution"]')
  if (signatureBloc) {
    extra.signature = {
      barres: [...signatureBloc.querySelectorAll('.signature-barre')].map((b) => ({
        detail: b.dataset.detail,
        valeur: texteDe(b.querySelector('.signature-valeur')),
        libelle: texteDe(b.querySelector('.signature-libelle')),
        hauteur: b.querySelector('.barre')?.style.height ?? null,
        fond: b.querySelector('.barre') ? getComputedStyle(b.querySelector('.barre')).backgroundColor : null,
      })),
      message: texteDe(signatureBloc.querySelector('[role="status"]')),
    }
  }
  const ensembleBloc = racine.querySelector('[data-testid="ensemble-comparaison"]')
  if (ensembleBloc) {
    extra.ensemble = {
      portee: ensembleBloc.dataset.portee,
      avecDonnees: ensembleBloc.dataset.avecDonnees,
      sansDonnees: ensembleBloc.dataset.sansDonnees,
      barres: [...ensembleBloc.querySelectorAll('.signature-barre')].map((b) => ({
        detail: b.dataset.detail,
        valeur: texteDe(b.querySelector('.signature-valeur')),
        libelle: texteDe(b.querySelector('.signature-libelle')),
        hauteur: b.querySelector('.barre')?.style.height ?? null,
      })),
    }
  }
  const profilBloc = racine.querySelector('[data-testid="profil-liste"]')
  if (profilBloc) {
    extra.profil = {
      nom: texteDe(profilBloc.querySelector('h2')),
      lignes: [...profilBloc.querySelectorAll('.profil-ligne')].map((l) => ({
        detail: l.dataset.ligneProfil,
        libelle: texteDe(l.querySelector('.profil-libelle')),
        valeur: texteDe(l.querySelector('.profil-valeur')),
        active: l.className.includes('active'),
      })),
      notes: [...profilBloc.querySelectorAll('[role="note"], [role="status"]')].map(texteDe),
    }
  }
  const compositionBloc = racine.querySelector('[data-testid="composition-contextualisee"]')
  if (compositionBloc) {
    extra.composition = {
      titre: texteDe(compositionBloc.querySelector('[data-testid="composition-provenance"]')),
      segments: [...compositionBloc.querySelectorAll('.composition-bar span')].map((s) => ({ largeur: s.style.width, titre: s.getAttribute('title'), active: s.className.includes('active') })),
      legende: [...compositionBloc.querySelectorAll('.composition-legend li')].map((li) => ({
        label: texteDe(li.querySelector('span')).replace(/\\s+/g, ' '),
        valeur: texteDe(li.querySelector('strong')),
        active: li.className.includes('active'),
      })),
      messages: [...compositionBloc.querySelectorAll('[role="status"], .composition-vide, .composition-note')].map(texteDe),
    }
  }
  const pyramide = racine.querySelector('[data-renderer="pyramid"]')
  if (pyramide) {
    extra.pyramide = {
      aria: pyramide.querySelector('.pyramid')?.getAttribute('aria-label') ?? null,
      lignes: [...pyramide.querySelectorAll('.pyramid-row')].map((r) => ({
        label: texteDe(r.querySelector('span')),
        valeurs: [...r.querySelectorAll('i')].map((i) => ({ texte: texteDe(i), selected: i.className.includes('selected') })),
      })),
      figcaption: texteDe(pyramide.querySelector('figcaption')),
    }
  }
  const trajectoire = racine.querySelector('[data-renderer="trajectory"] svg')
  if (trajectoire) {
    extra.trajectoire = {
      viewBox: trajectoire.getAttribute('viewBox'),
      rectW: trajectoire.getBoundingClientRect().width,
      rectH: trajectoire.getBoundingClientRect().height,
      etapes: [...trajectoire.querySelectorAll('g[data-etape]')].map((g) => {
        const point = g.querySelector('circle.trajectoire-mediane-point')
        const ligne = g.querySelector('line.trajectoire-etalement')
        const label = g.querySelector('text')
        return {
          detail: g.dataset.etape,
          etat: g.dataset.etat,
          cx: point?.getAttribute('cx') ?? null,
          cy: point?.getAttribute('cy') ?? null,
          y1: ligne?.getAttribute('y1') ?? null,
          y2: ligne?.getAttribute('y2') ?? null,
          labelX: label?.textContent ?? null,
        }
      }),
      cheminMediane: trajectoire.querySelector('path.trajectoire-mediane')?.getAttribute('d') ?? null,
      cheminTerritoire: trajectoire.querySelector('path.trajectoire-territoire')?.getAttribute('d') ?? null,
      figcaption: texteDe(racine.querySelector('[data-renderer="trajectory"] figcaption')),
    }
  }
  const relation = racine.querySelector('[data-renderer="relationship"]')
  if (relation) {
    extra.relation = {
      points: [...relation.querySelectorAll('circle.relation-point')].map((c) => ({ cx: c.getAttribute('cx'), cy: c.getAttribute('cy'), data: c.dataset.pointRelation, selection: c.className.includes('selection') })),
      messages: [...relation.querySelectorAll('[role="note"], [role="status"]')].map(texteDe),
    }
  }

  // --- accessibilité ciblée ---
  const a11y = {
    svgsSansLabel: [...racine.querySelectorAll('svg')].filter((s) => s.getAttribute('role') === 'img' && !(s.getAttribute('aria-label') ?? '').trim()).length,
    glyphesSansTitre: [...racine.querySelectorAll('main th span, main td span')].filter((s) => /[▲▼]/.test(s.textContent) && !s.getAttribute('title')).length,
    selectsSansLabel: [...racine.querySelectorAll('.controls select')].filter((s) => { const l = s.closest('label'); return !l || texteDe(l).length < 2 }).length,
    captionAbsente: table && !caption ? true : false,
  }

  // --- mise en page ---
  const rectDe = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top + window.scrollY) } }
  const miseEnPage = {
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
    overflowX: document.documentElement.scrollWidth > window.innerWidth + 1,
    renderer: rendererEl ? { kind: rendererEl.dataset.renderer, state: rendererEl.dataset.state, rect: rectDe(rendererEl) } : null,
    density: densitySvg ? { viewBox: densitySvg.getAttribute('viewBox'), rect: rectDe(densitySvg), pathOk: Boolean(densityPath && densityPath.getBBox().width > 1), markerCx: marker?.getAttribute('cx') ?? null, markerCy: marker?.getAttribute('cy') ?? null } : null,
    hero: heroPresent ? rectDe(racine.querySelector('.hero')) : null,
    medianFontPx: medianStrong ? parseFloat(getComputedStyle(medianStrong).fontSize) : null,
    tableRect: rectDe(table),
    controlsRect: rectDe(racine.querySelector('.controls')),
  }
  const fuiteCleBrute = (() => {
    const figuresTexte = [...racine.querySelectorAll('[data-renderer]')].map((f) => f.innerText ?? '')
    const suspects = ['_longueur', '_densite', 'sans_voiture', 'deux_plus', 'une_voiture', 'loge_gratuit', 'locataire_prive', 'lt1919', '1946_1970', 'protege_', 'partage_', 'total_longueur']
    return suspects.filter((k) => figuresTexte.some((t) => t.includes(k)))
  })()

  return {
    present: true,
    url: location.href,
    h1: texteDe(racine.querySelector('h1')),
    surTitre: texteDe(racine.querySelector('.sur-titre')),
    definition: texteDe(racine.querySelector('header p:nth-of-type(2)')),
    alertes, statuts, notes, noteContexte,
    mediane, heroPresent,
    density: miseEnPage.density,
    extremes, controles, enteteDirection, lignesTable, caption,
    vuesBoutons: [...racine.querySelectorAll('.vues button')].map((b) => ({ texte: texteDe(b), active: b.className.includes('active') })),
    extra,
    a11y,
    miseEnPage,
    fuiteCleBrute,
  }
})()`

/* ------------------------------------------------------------------ */
/* 4. Boucle principale                                                */
/* ------------------------------------------------------------------ */

const log = (...args) => console.log(new Date().toISOString().slice(11, 19), ...args)

async function main() {
  mkdirSync(EVIDENCE, { recursive: true })
  mkdirSync(path.join(EVIDENCE, 'shots'), { recursive: true })
  const pages = chargerCatalogue().filter((p) => !ONLY || `${p.theme}/${p.key}` === ONLY)
  log(`Catalogue publié : ${chargerCatalogue().length} pages ; audit de ${pages.length}.`)

  // --- serveur vite dev ---
  const portApp = await portLibre()
  const serveur = spawn(process.execPath, [path.join(APP, 'node_modules', 'vite', 'bin', 'vite.js'), '--port', String(portApp), '--strictPort', '--host', '127.0.0.1'], { cwd: APP, stdio: ['ignore', 'pipe', 'pipe'] })
  let sortieServeur = ''
  serveur.stdout.on('data', (d) => { sortieServeur += d }); serveur.stderr.on('data', (d) => { sortieServeur += d })
  let chrome = null; let cdp = null; let profilTmp = null
  const manifest = { genere: new Date().toISOString(), chrome: CHROME, appPort: portApp, pages: [] }

  try {
    await attendreHttp(`http://127.0.0.1:${portApp}/`, 30000, 'vite dev')

    // --- chrome headless ---
    const portCdp = await portLibre()
    profilTmp = mkdtempSync(path.join(tmpdir(), 'lusk-audit-chrome-'))
    chrome = spawn(CHROME, [
      '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
      `--remote-debugging-port=${portCdp}`, `--user-data-dir=${profilTmp}`,
      '--window-size=1400,1000', 'about:blank',
    ], { stdio: ['ignore', 'ignore', 'pipe'] })
    let errChrome = ''; chrome.stderr.on('data', (d) => { errChrome += d })
    const version = await attendreHttp(`http://127.0.0.1:${portCdp}/json/version`, 30000, 'CDP')
    const { webSocketDebuggerUrl } = await version.json()
    const liste = await (await fetch(`http://127.0.0.1:${portCdp}/json/list`)).json()
    const pageWs = liste.find((t) => t.type === 'page').webSocketDebuggerUrl
    cdp = new Cdp(new WebSocket(pageWs))
    await cdp.send('Page.enable'); await cdp.send('Runtime.enable'); await cdp.send('Log.enable'); await cdp.send('Network.enable')
    await cdp.send('Log.enable').catch(() => {})

    /** Événements de chargement collectés par navigation courante. */
    let evenements = []
    cdp.on('Runtime.consoleAPICalled', (p) => { if (['error'].includes(p.type)) evenements.push({ kind: 'console', texte: (p.args ?? []).map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 400) }) })
    cdp.on('Log.entryAdded', (p) => { if (p.entry.level === 'error') evenements.push({ kind: 'log', texte: `${p.entry.text} ${p.entry.url ?? ''}`.slice(0, 400) }) })
    cdp.on('Network.loadingFailed', (p) => evenements.push({ kind: 'network', texte: `loadingFailed ${p.errorText} ${p.type}` }))
    cdp.on('Network.responseReceived', (p) => { const s = p.response.status; if (s >= 400) evenements.push({ kind: 'http', texte: `${s} ${p.response.url}` }) })

    async function evaluer(expression) {
      const r = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
      if (r.exceptionDetails) throw new Error('Eval exception: ' + JSON.stringify(r.exceptionDetails).slice(0, 500))
      return r.result.value
    }
    async function naviger(url, { largeur = DESKTOP.width, hauteur = DESKTOP.height, mobile = false } = {}) {
      evenements = []
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: largeur, height: hauteur, deviceScaleFactor: 1, mobile })
      await cdp.send('Storage.clearDataForOrigin', { origin: `http://127.0.0.1:${portApp}`, storageTypes: 'local_storage' })
      await cdp.send('Page.navigate', { url })
      const debut = Date.now()
      while (Date.now() - debut < 25000) {
        const etat = await evaluer(`(() => { const r = document.querySelector('.indicateur-page'); if (!r) return {pret:false}; const charge = [...r.querySelectorAll('[role=status]')].some(s=>/Chargement/.test(s.textContent)); return { pret: !charge, alerte: r.querySelector('[role=alert]')?.textContent ?? null } })()`).catch(() => ({ pret: false }))
        if (etat.pret) break
        await new Promise((r) => setTimeout(r, 150))
      }
      await evaluer('document.fonts ? document.fonts.ready.then(() => "ok") : "ok"').catch(() => {})
      await new Promise((r) => setTimeout(r, 350))
      // La réécriture canonique du niveau (#472) — attendue avant mesure.
      for (let i = 0; i < 12; i++) {
        const u = await evaluer('location.search')
        if (/[?&]niveau=/.test(u)) break
        await new Promise((r) => setTimeout(r, 150))
      }
      return JSON.parse(JSON.stringify(await evaluer(SCRIPT_EXTRACTION)))
    }
    async function capture(nomFichier, clipHauteurMax) {
      const { width } = await evaluer('({width: window.innerWidth})')
      const { scrollH } = await evaluer('({scrollH: document.documentElement.scrollHeight})')
      const clip = { x: 0, y: 0, width, height: Math.min(scrollH, clipHauteurMax ?? 1750), scale: 1 }
      const shot = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 70, clip, captureBeyondViewport: true })
      writeFileSync(path.join(EVIDENCE, 'shots', nomFichier), Buffer.from(shot.data, 'base64'))
      return `shots/${nomFichier}`
    }

    /* ---- cibles spéciales déterministes (ties / incomplets / absent) ---- */
    function trouverTies() {
      for (const page of pages) {
        for (const niveau of page.levels) {
          const miroir = lignesFacette(page, { niveau })
          if (miroir.rows.length >= 3 && (miroir.highCount > 1 || miroir.lowCount > 1)) return { page, niveau, count: Math.max(miroir.highCount, miroir.lowCount) }
        }
      }
      return null
    }
    function trouverIncomplets() {
      for (const page of pages) {
        const cmp = page.comparison ?? {}
        const indicator = cmp.indicator ?? page.key
        for (const niveau of page.levels) {
          const bruts = faitsParTheme[page.theme].filter((f) => f.key === indicator && f.detail === (cmp.detail ?? page.raw.detail ?? null) && (f.sex ?? null) === (cmp.sex ?? null) && (f.dimension ?? null) === (cmp.dimension ?? null) && f.type === niveau)
          if (bruts.some((f) => f.value === null) && bruts.some((f) => f.value !== null)) return { page, niveau }
        }
      }
      return null
    }

    const ties = trouverTies()
    const incomplets = trouverIncomplets()
    log(`Ties max détectées : ${ties ? `${ties.page.theme}/${ties.page.key}@${ties.niveau} (${ties.count})` : 'aucune'} ; incomplètes : ${incomplets ? `${incomplets.page.theme}/${incomplets.page.key}@${incomplets.niveau}` : 'aucune'}`)

    const SHOTS_HIGHLIGHT = new Set(['demographie/densite', 'habitat/distribution_dpe', 'habitat/prix_m2', 'mobilite/reseaux', 'mobilite/voitures_menage', 'demographie/structure_age'])
    const SHOTS_TABLE = new Set(['demographie/densite', 'mobilite/tot_loss_t', 'economie/chomage', 'programmes/subventions_par_domaine', 'habitat/part_passoires'])

    for (const page of pages) {
      const urlBase = `http://127.0.0.1:${portApp}/indicateurs/${page.theme}/${page.key}`
      const entree = { page: `${page.theme}/${page.key}`, famille: page.family, niveauxPublies: page.levels, unit: page.unit, direction: page.direction, etats: {} }

      async function mesurerEtat(nom, url, { shots = [], niveauAttendu = null, miroirNiveau = null, mobile = false } = {}) {
        // l'émulation mobile doit PORTER la fenêtre 390×844 — naviger ne
        // déduit pas les dimensions du drapeau (défaut historique : desktop)
        const dom = await naviger(url, mobile ? { largeur: MOBILE.width, hauteur: MOBILE.height, mobile: true } : {})
        const etat = { nom, url: dom.url, checks: [], dom }
        const ajouter = (id, passe, detail) => etat.checks.push({ id, passe, detail })

        // -- santé du chargement --
        ajouter('load.sans-erreur-console', evenements.filter((e) => e.kind === 'console' || e.kind === 'log').length === 0, evenements.slice(0, 5))
        ajouter('load.reseau-ok', evenements.filter((e) => e.kind === 'http' || e.kind === 'network').length === 0, evenements.filter((e) => e.kind === 'http' || e.kind === 'network').slice(0, 5))
        ajouter('load.page-trouvee', dom.present && dom.alertes.length === 0, { h1: dom.h1, alertes: dom.alertes })

        // -- aller-retour de facette : l'URL canonique réécrite par l'app doit
        // rester VALIDE pour sa propre normalizeComparisonFacet (#440/#472). --
        if (dom.present) {
          const facette = facetteDepuisQuery(page, queryDeUrl(dom.url))
          ajouter('facette.reecriture-canonique-valide', facette.valid, { url: dom.url, facette })
        }

        if (dom.present && !dom.alertes.length) {
          const cmp = page.comparison ?? {}
          const miroir = miroirNiveau ?? lignesFacette(page, { niveau: niveauAttendu ?? 'commune' })

          // -- famille rendue --
          ajouter('famille.renderer-present', dom.miseEnPage.renderer?.kind === page.family, { rendu: dom.miseEnPage.renderer?.kind ?? null, attendu: page.family })
          const etatsLegaux = ['ready', 'incomplete']
          ajouter('famille.etat-honnete', etatsLegaux.includes(dom.miseEnPage.renderer?.state), { state: dom.miseEnPage.renderer?.state, statuts: dom.statuts })

          // -- médiane (hors distribution, #474) --
          if (page.family === 'distribution') {
            ajouter('distribution.sans-mediane-scalaire', !dom.heroPresent, { heroPresent: dom.heroPresent })
            ajouter('distribution.ensemble-present', Boolean(dom.extra.ensemble), { avecDonnees: dom.extra.ensemble?.avecDonnees, sansDonnees: dom.extra.ensemble?.sansDonnees })
            // Échelle PARTAGÉE (#474) : hauteurMax couvre signature ∪ ensemble —
            // la plus haute barre des DEUX blocs doit saturer le track (~100 %).
            // Chaque bloc seul peut culmer plus bas : c'est la preuve du partage,
            // pas un défaut d'échelle.
            const barresPartagees = [...(dom.extra.signature?.barres ?? []), ...(dom.extra.ensemble?.barres ?? [])]
            const hauteursPartagees = barresPartagees.map((b) => parseFR(b.hauteur ?? '')).filter(Number.isFinite)
            if (hauteursPartagees.length) {
              const maxH = Math.max(...hauteursPartagees)
              ajouter('distribution.echelle-partagee-saturee', maxH > 99.9 && maxH <= 100.01, { max: maxH, blocs: { signature: dom.extra.signature?.barres?.length ?? 0, ensemble: dom.extra.ensemble?.barres?.length ?? 0 } })
              // Valeurs affichées parsables + libellés présents (sans
              // ré-échelonnage harness : le formatage % est déjà verrouillé
              // par les tests #474 côté app).
              ajouter('ensemble.barres-parsables', barresPartagees.every((b) => Number.isFinite(parseFR(b.valeur ?? '')) && (b.libelle ?? '').length > 0), { n: barresPartagees.length })
            }
          } else if (dom.mediane) {
            const rendu = parseFR(dom.mediane.nombre)
            const attendu = miroir.median
            const okRendu = Number.isFinite(rendu) && Math.abs(rendu - (attendu === null ? NaN : (page.unit === '%' ? attendu * 100 : attendu))) <= Math.max(0.51, Math.abs(rendu) * 0.002)
            ajouter('median.recoupe-payload', okRendu, { rendu: dom.mediane.nombre, attendu: formaterValeur(attendu, page.unit) })
            ajouter('median.scope-etiquete', Boolean(dom.mediane.scope), { scope: dom.mediane.scope })
            ajouter('median.unite-coherente', (dom.mediane.unit ?? '').trim() === page.unit, { rendu: dom.mediane.unit, attendu: page.unit })
          }

          // -- densité (héros scalaire partagé) --
          if (dom.heroPresent && dom.density) {
            ajouter('trace.courbe-presente', dom.density.pathOk === true, { viewBox: dom.density.viewBox, rect: dom.density.rect })
            if (dom.density.markerCx !== null && miroir.rows.length) {
              // le marqueur n'existe qu'en état highlight ; sinon il doit être absent
            }
            if (dom.density.markerCx === null) ajouter('trace.marqueur-absent-sans-selection', true, {})
          }

          // -- extrêmes --
          const [hautArticle, basArticle] = dom.extremes
          if (hautArticle) {
            const sensHaut = hautArticle.titre?.includes('hautes')
            const count = sensHaut ? miroir.highCount : miroir.lowCount
            const egaliteOk = count > 1 ? (hautArticle.egalite ?? '').includes(String(count)) && hautArticle.liens.length === 0 : hautArticle.liens.length === 1
            ajouter('extremes.egalite-honnete', egaliteOk, { count, egalite: hautArticle.egalite, liens: hautArticle.liens.length })
            if (count === 1) {
              const attenduNum = sensHaut ? miroir.max : miroir.min
              const renduTxt = hautArticle.liens[0] ? hautArticle.liens[0].texte.split('·')[1] ?? null : null
              const attenduTxt = formaterValeur(attenduNum, page.unit)
              // comparaison formaté↔formaté : la valeur affichée doit être
              // l'arrondi exact du payload via le formatage partagé (#466)
              ajouter('extremes.valeur-recoupee', renduTxt !== null && attenduTxt !== null && parseFR(renduTxt) === parseFR(attenduTxt), { rendu: renduTxt, attendu: attenduTxt })
            }
          }

          // -- tableau (familles AVEC slot partagé uniquement — pyramid,
          // composition et comparison-bars ne rendent pas ce chrome) --
          const avecSlot = FAMILLES_AVEC_SLOT.includes(page.family ?? 'scalar')
          if (!avecSlot) {
            ajouter('table.hors-champ-famille-sans-tableau', dom.caption === null && dom.lignesTable.length === 0, { famille: page.family ?? 'scalar', caption: dom.caption, lignes: dom.lignesTable.length })
          } else {
          ajouter('table.caption-perimetre', typeof dom.caption === 'string' && dom.caption.includes('—'), { caption: dom.caption })
          ajouter('table.nb-lignes', dom.lignesTable.length === miroir.rows.length, { rendu: dom.lignesTable.length, attendu: miroir.rows.length })
          const glyph = dom.enteteDirection
          const glyphAttendu = (cmp.direction ?? page.direction) === 'low' ? '▼' : '▲'
          ajouter('table.glyphe-direction', Boolean(glyph && glyph.texte.includes(glyphAttendu) && glyph.title && glyph.aria), glyph)
          let rangsOk = 0; let rangsTotal = 0; const rangsErreurs = []
          const miroirParId = new Map(miroir.rows.map((r) => [r.id, r]))
          for (const ligne of dom.lignesTable) {
            const ref = ligne.href?.match(/\/territoire\/[^/]+\/([^?]+)/)?.[1]
            const attendu = ref ? miroirParId.get(ref) : null
            if (!attendu) continue
            rangsTotal++
            const mRang = /^(\d+)(?:er|e)?\s*\/\s*(\d+)$/.exec((ligne.rang ?? '').trim())
            const rangRendu = mRang ? parseInt(mRang[1], 10) : NaN
            const rangTailleRendu = mRang ? parseInt(mRang[2], 10) : NaN
            if (rangRendu === attendu.rang && rangTailleRendu === miroir.rows.length) rangsOk++
            else if (rangsErreurs.length < 5) rangsErreurs.push({ nom: ligne.nom, rendu: ligne.rang, attendu: attendu.rang })
          }
          ajouter('table.rangs-exaequo', rangsTotal === 0 || rangsOk === rangsTotal, { verifiés: rangsTotal, ok: rangsOk, erreurs: rangsErreurs })

          // -- recoupe du formatage cellule↔payload sur un échantillon (#466) --
          let fmtOk = 0; let fmtTotal = 0; const fmtErreurs = []
          for (const ligne of dom.lignesTable.slice(0, 40)) {
            const ref = ligne.href?.match(/\/territoire\/[^/]+\/([^?]+)/)?.[1]
            const attendu = ref ? miroirParId.get(ref) : null
            if (!attendu) continue
            fmtTotal++
            const renduCellule = (ligne.valeur ?? '').trim()
            const attenduCellule = `${formaterValeur(attendu.value, page.unit)} ${page.unit}`
            if (renduCellule === attenduCellule) fmtOk++
            else if (fmtErreurs.length < 4) fmtErreurs.push({ nom: ligne.nom, rendu: renduCellule, attendu: attenduCellule })
          }
          ajouter('unites.formatage-recoupe', fmtTotal === 0 || fmtOk === fmtTotal, { verifies: fmtTotal, ok: fmtOk, erreurs: fmtErreurs })
          }

          // -- unités & échelle % (#466) --
          const cellulesValeur = dom.lignesTable.slice(0, 40).map((l) => l.valeur ?? '')
          const uniteOk = cellulesValeur.every((v) => v.endsWith(page.unit))
          ajouter('unites.cellule-termine-par-unite', uniteOk, { unit: page.unit, exemplesManquants: cellulesValeur.filter((v) => !v.endsWith(page.unit)).slice(0, 3) })
          if (page.unit === '%') {
            const facetteEtat = facetteDepuisQuery(page, queryDeUrl(dom.url))
            const qEtat = queryDeUrl(dom.url)
            const etatNiveau = ['commune', 'epci', 'departement'].includes(qEtat.niveau) ? qEtat.niveau : 'commune'
            const cleFacette = cmp.indicator ?? page.key
            const bruts = faitsParTheme[page.theme].filter((f) => f.key === cleFacette && f.type === etatNiveau && f.detail === facetteEtat.detail && (f.sex ?? null) === facetteEtat.sex && (f.dimension ?? null) === facetteEtat.dimension)
            const valsBruts = bruts.map((f) => f.value).filter((v) => typeof v === 'number')
            // La borne 0–100 n'a de sens que pour une part bornée ; une mesure
            // signée ou non bornée (évolution %) est relevée, pas jugée.
            const partBornee = valsBruts.length > 0 && Math.max(...valsBruts.map(Math.abs)) <= 1.001
            if (partBornee) {
              const horsEchelle = dom.lignesTable.map((l) => parseFR(l.valeur ?? '')).filter(Number.isFinite).filter((v) => v < -0.01 || v > 100.01)
              ajouter('unites.pourcent-echelle-0-100', horsEchelle.length === 0, { horsEchelle: horsEchelle.slice(0, 5) })
              const brutMax = Math.max(...valsBruts, 0)
              ajouter('unites.pas-de-fraction-brute', brutMax <= 1.001, { brutMax })
            } else {
              ajouter('unites.grandeur-signee-relevee', valsBruts.length > 0 && valsBruts.every((v) => Number.isFinite(v)), { n: valsBruts.length, min: valsBruts.length ? Math.min(...valsBruts) : null, max: valsBruts.length ? Math.max(...valsBruts) : null })
            }
          }

          // -- fuites de clés brutes (ADR-0023) --
          ajouter('semantique.aucune-cle-brute', dom.fuiteCleBrute.length === 0, dom.fuiteCleBrute)

          // -- accessibilité ciblée --
          ajouter('a11y.svg-label', dom.a11y.svgsSansLabel === 0, { svgsSansLabel: dom.a11y.svgsSansLabel })
          ajouter('a11y.glyphe-jamais-seul', dom.a11y.glyphesSansTitre === 0, { glyphesSansTitre: dom.a11y.glyphesSansTitre })
          ajouter('a11y.select-label', dom.a11y.selectsSansLabel === 0, { selectsSansLabel: dom.a11y.selectsSansLabel })

          // -- responsive --
          ajouter(mobile ? 'layout.mobile-sans-overflow-x' : 'layout.desktop-sans-overflow-x', !dom.miseEnPage.overflowX, { scrollWidth: dom.miseEnPage.scrollWidth, innerWidth: dom.miseEnPage.innerWidth })

          // -- extras par famille --
          if (dom.extra.profil) {
            const categories = page.raw.list?.categories ?? []
            const rendus = dom.extra.profil.lignes.map((l) => l.detail)
            const ordreOk = categories.filter((c, i) => rendus[i] === c).length === rendus.length
            ajouter('liste.profil-ordre-declare', ordreOk, { rendus, categories })
            const selecteur = dom.controles.find((c) => c.libelle?.includes('Catégorie comparée'))
            ajouter('liste.facette-visible', Boolean(selecteur && selecteur.options?.length === categories.length), { selecteur: selecteur?.valeur ?? null })
          }
          if (dom.extra.composition) {
            const parties = page.raw.composition?.parts ?? []
            const legendeOk = dom.extra.composition.legende.length === parties.filter(Boolean).length
            ajouter('composition.legende-complete', legendeOk || Boolean(dom.extra.composition.messages.length), { legende: dom.extra.composition.legende.length, parties: parties.length, messages: dom.extra.composition.messages })
            const refsLegende = dom.extra.composition.legende.map((li) => { const m = /médiane :\s*([\d\s\u202f\u00a0,-]+)/.exec(li.label); return m ? parseFR(m[1]) : null })
            ajouter('composition.references-medians-presentes', refsLegende.every((r) => r !== null) , refsLegende)
          }
          if (dom.extra.trajectoire) {
            const selecteurDetail = dom.controles.find((c) => c.libelle?.includes('Détail'))
            ajouter('trajectoire.detail-actif-selectable', Boolean(selecteurDetail), { detail: selecteurDetail?.valeur ?? null })
            ajouter('trajectoire.chemin-rendu', Boolean(dom.extra.trajectoire.cheminMediane), { longueurChemin: (dom.extra.trajectoire.cheminMediane ?? '').length })
            const cyNums = dom.extra.trajectoire.etapes.map((e) => parseFloat(e.cy)).filter(Number.isFinite)
            if (cyNums.length >= 2) {
              // MESURE (non jugée) : occupation verticale du chemin médian dans
              // le plot [Y_HAUT=14 .. Y_BAS=204] sous l'échelle domaine-réel
              // (#438). Un domaine dominé par les extrêmes compresse la médiane
              // — le pourcentage alimente le constat analytique du rapport.
              const etendue = Math.max(...cyNums) - Math.min(...cyNums)
              ajouter('trajectoire.occupation-verticale-relevee', true, { etendueViewBox: +etendue.toFixed(2), partHauteurPourcent: +((etendue / 190) * 100).toFixed(1), points: cyNums.length })
            }
            const labelsEtape = dom.extra.trajectoire.etapes.map((e) => e.labelX)
            ajouter('trajectoire.libelles-etapes-rendus', labelsEtape.every(Boolean), labelsEtape)
          }
          if (dom.extra.signature) {
            const libellesRendus = dom.extra.signature.barres.map((b) => b.libelle)
            ajouter('distribution.libelles-signature', libellesRendus.every(Boolean) && !libellesRendus.some((l) => /^[A-G]$/.test(l) === false && l === l.toLowerCase()), libellesRendus)
            // Palette officielle DPE — miroir de app/src/fiche/couleursDpe.ts
            // (COULEURS_DPE, échelle ADEME 2021, dérogation ADR-0023) :
            // A #008659, G #9B134C.
            const dpeOfficiels = { A: 'rgb(0, 134, 89)', G: 'rgb(155, 19, 76)' }
            const fondA = dom.extra.signature.barres.find((b) => b.detail === 'A')?.fond
            const fondG = dom.extra.signature.barres.find((b) => b.detail === 'G')?.fond
            ajouter('distribution.couleurs-officielles-dpe', fondA === dpeOfficiels.A || fondA == null ? true : false, { fondA, fondG, attenduA: dpeOfficiels.A })
          }
          if (dom.extra.pyramide) {
            ajouter('pyramide.lignes-rendues', dom.extra.pyramide.lignes.length > 0, { lignes: dom.extra.pyramide.lignes.length })
            // La cellule marquée est la facette ACTIVE (détail + sexe, #398 US28)
            // — avec ou sans territoire mis en avant ; le territoire change les
            // VALEURS, jamais la sélection de facette.
            const fp = facetteDepuisQuery(page, queryDeUrl(dom.url))
            const labelsPyramide = page.comparison?.labels ?? {}
            const sel = []
            dom.extra.pyramide.lignes.forEach((l) => l.valeurs.forEach((v, i) => { if (v.selected) sel.push(`${l.label}#${i}`) }))
            const attenduSel = fp.detail === null ? [] : [`${labelsPyramide[fp.detail] ?? fp.detail}#${fp.sex === 'M' ? 1 : 0}`]
            ajouter('pyramide.facette-active-marquee', JSON.stringify(sel.sort()) === JSON.stringify([...attenduSel].sort()), { sel, attenduSel })
          }
        }

        // captures
        if (WITH_SHOTS) {
          for (const shot of shots) {
            if (shot === 'top') etat.shotTop = await capture(`${page.theme}__${page.key}__${nom}__${mobile ? 'mobile' : 'desktop'}.jpg`, mobile ? 2100 : 1800)
            if (shot === 'table') {
              await evaluer("document.querySelector('.extremes')?.scrollIntoView()")
              await new Promise((r) => setTimeout(r, 200))
              etat.shotTable = await capture(`${page.theme}__${page.key}__${nom}__${mobile ? 'mobile' : 'desktop'}-extremes.jpg`, mobile ? 2200 : 1600)
            }
          }
        }
        etat.checks.push({ id: 'meta.evenements', passe: true, detail: evenements.slice(0, 8) })
        return etat
      }

      try {
        // état par défaut — desktop + mobile
        const defautDesktop = await mesurerEtat('defaut', urlBase, { shots: WITH_SHOTS ? ['top'] : [] })
        entree.etats.defaut_desktop = defautDesktop
        const defautMobile = await mesurerEtat('defaut', urlBase, { mobile: true, shots: WITH_SHOTS ? ['top'] : [] })
        entree.etats.defaut_mobile = defautMobile

        // chaque niveau publié (mesure desktop seule)
        for (const niveau of page.levels) {
          if (niveau === 'commune') continue // = défaut résolu déjà mesuré
          entree.etats[`niveau_${niveau}`] = await mesurerEtat(`niveau-${niveau}`, `${urlBase}?niveau=${niveau}`, { niveauAttendu: niveau })
        }

        // territoire mis en avant — rang médian déterministe au niveau communal
        const miroirCommune = lignesFacette(page, { niveau: 'commune' })
        if (miroirCommune.rows.length > 6) {
          const cible = miroirCommune.rows[Math.floor(miroirCommune.rows.length / 2)]
          const urlHighlight = `${urlBase}?territoire=${cible.id}`
          const hl = await mesurerEtat('highlight', urlHighlight, { shots: WITH_SHOTS && SHOTS_HIGHLIGHT.has(`${page.theme}/${page.key}`) ? ['top'] : [] })
          const rowSelection = hl.dom.lignesTable.find((l) => l.selection)
          // la ligne sélectionnée n'existe que si le tableau partagé est rendu
          hl.checks.push({ id: 'highlight.ligne-selectionnee', passe: hl.dom.lignesTable.length > 0 ? Boolean(rowSelection && rowSelection.nom === cible.nom) : true, detail: { nom: rowSelection?.nom ?? null, attendu: cible.nom, tableauAbsent: hl.dom.lignesTable.length === 0 } })
          hl.checks.push({ id: 'highlight.note-contexte-nomme', passe: (hl.dom.noteContexte ?? '').includes(cible.nom), detail: { note: hl.dom.noteContexte } })
          const marqueur = hl.dom.density?.markerCx
          // le marqueur de densité n'existe que si le héros densité est rendu
          hl.checks.push({ id: 'highlight.marqueur-densite', passe: hl.dom.density ? (marqueur !== null && marqueur !== undefined) : true, detail: { markerCx: marqueur ?? null, herosDensiteAbsent: !hl.dom.density } })
          hl.checks.push({ id: 'highlight.url-conservee', passe: hl.dom.url.includes(`territoire=${cible.id}`), detail: { url: hl.dom.url } })
          entree.etats.highlight_commune = hl
        }

        if (SHOTS_TABLE.has(`${page.theme}/${page.key}`)) {
          entree.etats.table_desktop = await mesurerEtat('table', urlBase, { shots: ['table'] })
        }
      } catch (err) {
        entree.erreur = String(err).slice(0, 500)
        log(`ERREUR ${page.theme}/${page.key}:`, entree.erreur)
      }
      manifest.pages.push(entree)
      const nbChecks = Object.values(entree.etats).flatMap((e) => e.checks ?? []).length
      const nbKo = Object.values(entree.etats).flatMap((e) => e.checks ?? []).filter((c) => c.passe === false).length
      log(`${page.theme}/${page.key} [${page.family}] — ${nbChecks} vérifs, ${nbKo} KO`)
    }

    /* ---- états transversaux : ties, incomplets, absent, vues ---- */
    async function etatTransversal(nom, url, page, options = {}) {
      const dom = await naviger(url)
      const etat = { nom, url: dom.url, checks: [{ id: 'meta.dom', passe: true, detail: { noteContexte: dom.noteContexte, statuts: dom.statuts, notes: dom.notes, alertes: dom.alertes, extremes: dom.extremes, extra: dom.extra, mediane: dom.mediane, renderer: dom.miseEnPage.renderer, url: dom.url } }] }
      if (WITH_SHOTS && options.shot) {
        await new Promise((r) => setTimeout(r, 150))
        etat.shotTop = await capture(`${nom.replace(/[^a-z0-9-]/gi, '_')}__desktop.jpg`, 1900)
      }
      manifest.pages.push({ page: `transversal/${nom}`, famille: page?.family ?? null, etats: { [nom]: etat } })
      log(`transversal/${nom} capturé`)
    }
    if (ties) await etatTransversal('egalite-extremes', `http://127.0.0.1:${portApp}/indicateurs/${ties.page.theme}/${ties.page.key}?niveau=${ties.niveau}`, ties.page, { shot: true })
    if (incomplets) await etatTransversal('valeurs-incompletes', `http://127.0.0.1:${portApp}/indicateurs/${incomplets.page.theme}/${incomplets.page.key}?niveau=${incomplets.niveau}`, incomplets.page, { shot: true })
    await etatTransversal('absent-hors-niveau', `http://127.0.0.1:${portApp}/indicateurs/habitat/distribution_dpe?niveau=epci&territoire=22001`, null, { shot: true })
    await etatTransversal('vue-carte-exclude-roadmap', `http://127.0.0.1:${portApp}/indicateurs/demographie/densite?vue=carte`, null, { shot: true })
    await etatTransversal('vue-indicateur', `http://127.0.0.1:${portApp}/indicateurs/habitat/distribution_dpe?vue=indicateur`, null, { shot: true })

    writeFileSync(path.join(EVIDENCE, 'manifest.json'), JSON.stringify(manifest, null, 1))
    log(`Manifest écrit : ${manifest.pages.length} entrées.`)
  } finally {
    try { cdp?.close() } catch {}
    await tuer(chrome); await tuer(serveur)
    if (profilTmp) {
      for (let i = 0; i < 5; i++) {
        try { rmSync(profilTmp, { recursive: true, force: true }); break } catch { await new Promise((r) => setTimeout(r, 400)) }
      }
    }
    if (sortieServeur && !sortieServeur.includes('ready in')) log('[vite]', sortieServeur.slice(-600))
  }

  // Résumé console
  const tous = manifest.pages.flatMap((p) => Object.values(p.etats ?? {}).flatMap((e) => e.checks ?? []))
  const ko = tous.filter((c) => c.passe === false)
  log(`TOTAL: ${tous.length} vérifications, ${ko.length} non passantes`)
  for (const c of ko.slice(0, 40)) log(`  KO ${c.id} :: ${JSON.stringify(c.detail).slice(0, 240)}`)
}

main().catch((err) => { console.error(err); process.exitCode = 1 })
