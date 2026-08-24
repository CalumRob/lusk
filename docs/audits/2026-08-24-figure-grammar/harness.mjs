#!/usr/bin/env node
/**
 * Audit harness — issue #448 (audit figures : lisibilité, hiérarchie, grammaire).
 *
 * Zero-dependency Chrome DevTools Protocol driver: launches the local Chrome,
 * opens each audited fiche route, waits for the Vue app + ECharts canvases to
 * settle, then extracts layout evidence (bounding boxes, computed styles,
 * rendered text) and a full-page screenshot per route.
 *
 * Usage:
 *   node docs/audits/2026-08-24-figure-grammar/harness.mjs --base http://localhost:5173
 *
 * Output: docs/audits/2026-08-24-figure-grammar/evidence/<slug>.json + .png
 */

import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const CHROME = process.env.CHROME_PATH ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const PORT = 9223
const ROOT = join(dirname(fileURLToPath(import.meta.url)))
const OUT = join(ROOT, 'evidence')

const args = process.argv.slice(2)
const baseIdx = args.indexOf('--base')
const BASE = baseIdx >= 0 ? args[baseIdx + 1] : 'http://localhost:5173'

/** The audited routes — representative real-data fiches × every reachable figure family. */
export const ROUTES = [
  // commune with strong salience + vélo story candidate (Rennes)
  { slug: 'commune-rennes-mobilite', url: '/territoire/commune/35238?theme=mobilite' },
  { slug: 'commune-rennes-demographie', url: '/territoire/commune/35238?theme=demographie' },
  { slug: 'commune-rennes-habitat', url: '/territoire/commune/35238?theme=habitat' },
  { slug: 'commune-rennes-economie', url: '/territoire/commune/35238?theme=economie' },
  { slug: 'commune-rennes-milieux', url: '/territoire/commune/35238?theme=milieux' },
  // mid-size coastal commune (Concarneau — the #194 example)
  { slug: 'commune-concarneau-mobilite', url: '/territoire/commune/29039?theme=mobilite' },
  { slug: 'commune-concarneau-economie', url: '/territoire/commune/29039?theme=economie' },
  // rural commune (small payload coverage)
  { slug: 'commune-plouray-mobilite', url: '/territoire/commune/56170?theme=mobilite' },
  { slug: 'commune-plouray-habitat', url: '/territoire/commune/56170?theme=habitat' },
  { slug: 'commune-plouray-economie', url: '/territoire/commune/56170?theme=economie' },
  { slug: 'commune-plouray-milieux', url: '/territoire/commune/56170?theme=milieux' },
  // EPCI level
  { slug: 'epci-lorient-mobilite', url: '/territoire/epci/200042174?theme=mobilite' },
  { slug: 'epci-lorient-demographie', url: '/territoire/epci/200042174?theme=demographie' },
  { slug: 'epci-lorient-habitat', url: '/territoire/epci/200042174?theme=habitat' },
  { slug: 'epci-lorient-economie', url: '/territoire/epci/200042174?theme=economie' },
  { slug: 'epci-lorient-milieux', url: '/territoire/epci/200042174?theme=milieux' },
  // département + région (the degenerate LQ case lives here)
  { slug: 'departement-finistere-economie', url: '/territoire/departement/29?theme=economie' },
  { slug: 'departement-finistere-demographie', url: '/territoire/departement/29?theme=demographie' },
  { slug: 'region-bretagne-demographie', url: '/territoire/region/53?theme=demographie' },
  { slug: 'region-bretagne-economie', url: '/territoire/region/53?theme=economie' },
  { slug: 'region-bretagne-milieux', url: '/territoire/region/53?theme=milieux' },
]

/** The DOM evidence collected on every route — layout numbers, not impressions. */
const COLLECT_JS = `
(() => {
  const box = (el) => {
    if (!el) return null
    const r = el.getBoundingClientRect()
    const cs = getComputedStyle(el)
    return {
      x: Math.round(r.x + window.scrollX), y: Math.round(r.y + window.scrollY),
      width: Math.round(r.width), height: Math.round(r.height),
      fontSizePx: cs.fontSize, fontFamily: cs.fontFamily.split(',')[0],
      fontWeight: cs.fontWeight, color: cs.color,
      overflows200: r.height > 201,
    }
  }
  const texte = (el) => el ? el.textContent.replace(/\\s+/g, ' ').trim() : null

  const out = {
    viewport: { w: innerWidth, h: innerHeight, dpr: devicePixelRatio },
    lecture: [],
    figuresGrille: [],
    figuresCompactes: [],
    canvases: [],
    titres: [],
  }

  document.querySelectorAll('.sous-groupe').forEach((g) => {
    const gk = g.getAttribute('data-groupe')
    out.titres.push({ groupe: gk, titre: texte(g.querySelector('.sous-groupe-titre')) })
    const lec = g.querySelector('.sous-groupe-lecture')
    if (lec) {
      const ligne = lec.querySelector('.lecture-ligne')
      const fig = lec.querySelector('.lecture-figure')
      const canvas = lec.querySelector('canvas')
      const liste = lec.querySelector('.figure-liste-lq')
      const absent = lec.querySelector('.lecture-absent')
      out.lecture.push({
        groupe: gk,
        present: true,
        indisponible: !!absent,
        absentTexte: texte(absent),
        prose: texte(lec.querySelector('.lecture-texte')),
        proseBox: box(lec.querySelector('.lecture-texte')),
        contexte: texte(lec.querySelector('.lecture-contexte')),
        source: texte(lec.querySelector('.lecture-source')),
        ligneBox: box(ligne),
        colonneFigureBox: box(fig),
        canvasBox: canvas ? { ...box(canvas), cssHeight: getComputedStyle(canvas.parentElement).height } : null,
        listeLQ: liste ? {
          box: box(liste),
          entetes: texte(liste.querySelector('.entetes')),
          lignes: [...liste.querySelectorAll('li')].map((li) => ({
            rang: texte(li.querySelector('.rang')),
            activite: texte(li.querySelector('.activite')),
            activiteOverflow: li.querySelector('.activite').scrollWidth > li.querySelector('.activite').clientWidth,
            lq: texte(li.querySelector('.lq')),
          })),
        } : null,
      })
    }
    const compacteWrap = g.querySelector('.figure-compacte')
    if (compacteWrap) {
      const compacte = compacteWrap.firstElementChild
      out.figuresCompactes.push({
        groupe: gk,
        famille: compacteWrap.getAttribute('data-famille'),
        clef: compacte?.getAttribute('data-clef') ?? null,
        tag: compacte?.tagName ?? null,
        box: box(compacte),
        valeur: texte(compacte?.querySelector('.valeur-numerique')),
        unite: texte(compacte?.querySelector('.valeur-unite')),
        libelle: texte(compacte?.querySelector('.figure-indicateur-libelle')),
        puce: compacte?.querySelector('.puce-rang') ? {
          texte: texte(compacte.querySelector('.puce-rang')),
          aria: compacte.querySelector('.puce-rang').getAttribute('aria-label'),
        } : null,
        tranches: [...compacte.querySelectorAll('.tranche')].map((t) => ({
          libelle: texte(t.querySelector('.tranche-libelle')),
          valeur: texte(t.querySelector('.tranche-valeur')),
          unite: texte(t.querySelector('.tranche-unite')),
        })),
        vintage: texte(compacte?.querySelector('.estampille-vintage')),
      })
    }
    g.querySelectorAll('.grille-indicateurs > .figure-indicateur').forEach((f) => {
      out.figuresGrille.push({
        groupe: gk,
        clef: f.getAttribute('data-clef'),
        accentClasse: [...f.classList].find((c) => c.startsWith('carte-figure--accent')) ?? null,
        box: box(f),
        valeur: texte(f.querySelector('.valeur-numerique')),
        valeurBox: box(f.querySelector('.valeur-numerique')),
        unite: texte(f.querySelector('.valeur-unite')),
        libelle: texte(f.querySelector('.figure-indicateur-libelle')),
        puce: f.querySelector('.puce-rang') ? {
          texte: texte(f.querySelector('.puce-rang')),
          aria: f.querySelector('.puce-rang').getAttribute('aria-label'),
        } : null,
        tranches: [...f.querySelectorAll('.tranche')].map((t) => ({
          libelle: texte(t.querySelector('.tranche-libelle')),
          valeur: texte(t.querySelector('.tranche-valeur')),
          unite: texte(t.querySelector('.tranche-unite')),
        })),
        vintage: texte(f.querySelector('.estampille-vintage')),
      })
    })
  })

  document.querySelectorAll('canvas').forEach((c) => out.canvases.push({ ...box(c), parentClass: c.parentElement.className }))
  out.titrePage = document.title
  return out
})()
`

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

class Cdp {
  constructor(wsUrl) {
    this.wsUrl = wsUrl
    this.id = 0
    this.pending = new Map()
  }

  async connect() {
    this.ws = new WebSocket(this.wsUrl)
    await new Promise((resolve, reject) => {
      this.ws.onopen = resolve
      this.ws.onerror = reject
    })
    this.ws.onmessage = (event) => {
      const msg = JSON.parse(event.data)
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id)
        this.pending.delete(msg.id)
        if (msg.error) reject(new Error(msg.error.message))
        else resolve(msg.result)
      }
    }
  }

  send(method, params = {}, sessionId) {
    const id = ++this.id
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }))
    })
  }
}

async function main() {
  mkdirSync(join(OUT), { recursive: true })
  const profile = join(OUT, '.chrome-profile')
  const chrome = spawn(CHROME, [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    '--window-size=1440,2400',
    '--disable-gpu',
    '--no-first-run',
    'about:blank',
  ], { stdio: 'ignore' })
  process.on('exit', () => chrome.kill())

  try {
    // wait for the DevTools endpoint
    let targets = null
    for (let i = 0; i < 40; i++) {
      await sleep(250)
      try {
        const res = await fetch(`http://127.0.0.1:${PORT}/json/list`)
        targets = await res.json()
        if (targets.length) break
      } catch { /* retry */ }
    }
    const page = targets.find((t) => t.type === 'page')
    const cdp = new Cdp(page.webSocketDebuggerUrl)
    await cdp.connect()
    await cdp.send('Page.enable')
    await cdp.send('Runtime.enable')
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 2400, deviceScaleFactor: 1, mobile: false })

    for (const route of ROUTES) {
      const url = BASE + route.url
      process.stderr.write(`→ ${route.slug} ${url}\n`)
      await cdp.send('Page.navigate', { url })
      // wait for load + Vue render + ECharts mount + resize settle
      await sleep(3500)

      const evalRes = await cdp.send('Runtime.evaluate', {
        expression: COLLECT_JS,
        returnByValue: true,
      })
      let evidence = evalRes.result?.value ?? { error: 'evaluate failed' }

      // scroll through the page so lazy content settles, then re-measure
      await cdp.send('Runtime.evaluate', { expression: 'window.scrollTo(0, document.body.scrollHeight)' })
      await sleep(700)
      await cdp.send('Runtime.evaluate', { expression: 'window.scrollTo(0, 0)' })
      await sleep(400)
      const reEval = await cdp.send('Runtime.evaluate', { expression: COLLECT_JS, returnByValue: true })
      if (reEval.result?.value) evidence = reEval.result.value

      writeFileSync(join(OUT, `${route.slug}.json`), JSON.stringify(evidence, null, 2))

      const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })
      writeFileSync(join(OUT, `${route.slug}.png`), Buffer.from(shot.data, 'base64'))
    }
    process.stdout.write(`OK — evidence in ${OUT}\n`)
  } finally {
    chrome.kill()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
