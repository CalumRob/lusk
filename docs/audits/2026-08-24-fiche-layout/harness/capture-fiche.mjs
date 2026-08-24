#!/usr/bin/env node
/**
 * Evidence harness — issue #445 audit(fiche): hiérarchie des sous-groupes et
 * mise en page responsive.
 *
 * Zero-dependency: Node >= 22 (native WebSocket + fetch) plus a local Chrome
 * binary. Drives Chrome headless over the raw DevTools protocol to capture
 * full-page screenshots AND objective DOM/layout measurements of the fiche's
 * theme tabs at mobile / tablet / half-desktop / desktop / wide-desktop
 * widths, against the real committed payload (public/data) served by
 * `npm run dev`.
 *
 * The measurement pass feeds five objective assertions (A1..A5). A1/A2 probe
 * subgroup-boundary ownership, A3 the ~200 px compactness rule (ADR-0023),
 * A4/A5 intra-row card alignment. They are EXPECTED to be able to fail
 * (that is what makes this loop red-capable); failures are reported, never
 * thrown, unless --assert is passed (exit 1 on any RED — CI-ready).
 *
 * Usage:
 *   cd app && npm ci && npm run dev -- --port 5173   # terminal 1
 *   node docs/audits/2026-08-24-fiche-layout/harness/capture-fiche.mjs \
 *        [--base http://localhost:5173] [--out <dir>] [--only name,...]
 *        [--no-shots] [--assert]
 *
 * Outputs per capture: <name>.png + <name>.metrics.json in --out
 * (default: ../evidence relative to this file), then an assertion report.
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'

const HERE = dirname(fileURLToPath(import.meta.url))

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
const args = process.argv.slice(2)
function argValue(flag, fallback) {
  const i = args.indexOf(flag)
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback
}
const BASE = argValue('--base', 'http://localhost:5173')
const OUT = argValue('--out', join(HERE, '..', 'evidence'))
const ONLY = args.includes('--only') ? argValue('--only', '').split(',').filter(Boolean) : null
const SHOTS = !args.includes('--no-shots')
const ASSERT = args.includes('--assert')

// ---------------------------------------------------------------------------
// Capture matrix — representative real-payload fiches.
// Territories: Rennes (commune urbaine, 35238), Allineuc (commune rurale,
// 22001), Rennes Métropole (epci, 243500139), Ille-et-Vilaine (departement,
// 35), Bretagne (region, 53).
// ---------------------------------------------------------------------------
const SPECS = [
  // Theme sweep on one urban commune at desktop width
  { name: 'rennes-mobilite-1440', type: 'commune', id: '35238', theme: 'mobilite', w: 1440, h: 900 },
  { name: 'rennes-demographie-1440', type: 'commune', id: '35238', theme: 'demographie', w: 1440, h: 900 },
  { name: 'rennes-habitat-1440', type: 'commune', id: '35238', theme: 'habitat', w: 1440, h: 900 },
  { name: 'rennes-economie-1440', type: 'commune', id: '35238', theme: 'economie', w: 1440, h: 900 },
  { name: 'rennes-milieux-1440', type: 'commune', id: '35238', theme: 'milieux', w: 1440, h: 900 },
  // Responsive series on the richest tab
  { name: 'rennes-mobilite-375', type: 'commune', id: '35238', theme: 'mobilite', w: 375, h: 740, mobile: true },
  { name: 'rennes-mobilite-768', type: 'commune', id: '35238', theme: 'mobilite', w: 768, h: 900 },
  { name: 'rennes-mobilite-1024', type: 'commune', id: '35238', theme: 'mobilite', w: 1024, h: 800 },
  { name: 'rennes-mobilite-1100', type: 'commune', id: '35238', theme: 'mobilite', w: 1100, h: 800 },
  { name: 'rennes-mobilite-1920', type: 'commune', id: '35238', theme: 'mobilite', w: 1920, h: 1000 },
  // Level + territory variety
  { name: 'epci-rennes-mobilite-1440', type: 'epci', id: '243500139', theme: 'mobilite', w: 1440, h: 900 },
  { name: 'dept35-milieux-1440', type: 'departement', id: '35', theme: 'milieux', w: 1440, h: 900 },
  { name: 'region-economie-1440', type: 'region', id: '53', theme: 'economie', w: 1440, h: 900 },
  { name: 'allineuc-mobilite-1440', type: 'commune', id: '22001', theme: 'mobilite', w: 1440, h: 900 },
]

// ---------------------------------------------------------------------------
// Minimal CDP client over native WebSocket
// ---------------------------------------------------------------------------
class Cdp {
  constructor(ws) {
    this.ws = ws
    this.id = 0
    this.pending = new Map()
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data)
      if (msg.id !== undefined && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id)
        this.pending.delete(msg.id)
        if (msg.error) reject(new Error(`${msg.error.message} (${msg.error.data ?? ''})`))
        else resolve(msg.result)
      }
    })
  }
  static async connect(url) {
    for (let attempt = 0; attempt < 20; attempt++) {
      try {
        const ws = new WebSocket(url)
        await new Promise((res, rej) => {
          ws.addEventListener('open', res, { once: true })
          ws.addEventListener('error', rej, { once: true })
        })
        return new Cdp(ws)
      } catch {
        await new Promise((r) => setTimeout(r, 250))
      }
    }
    throw new Error(`Cannot connect to ${url}`)
  }
  send(method, params = {}) {
    const id = ++this.id
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.ws.send(JSON.stringify({ id, method, params }))
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id)
          reject(new Error(`CDP timeout: ${method}`))
        }
      }, 30_000)
    })
  }
  async evaluate(expression) {
    const res = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    })
    if (res.exceptionDetails) {
      throw new Error(`Page evaluation failed: ${JSON.stringify(res.exceptionDetails).slice(0, 600)}`)
    }
    return res.result.value
  }
}

function findChrome() {
  const candidates = [
    process.env.CHROME,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  ].filter(Boolean)
  return candidates.find((p) => existsSync(p))
}

async function launchChrome() {
  const exe = findChrome()
  if (!exe) throw new Error('Chrome not found; set CHROME=<path>')
  const port = 9223 + Math.floor(Math.random() * 400)
  const profile = join(tmpdir(), `lusk-audit-445-${Date.now()}`)
  const child = spawn(exe, [
    '--headless=new',
    '--remote-debugging-port=' + port,
    '--user-data-dir=' + profile,
    '--no-first-run',
    '--disable-gpu',
    'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] })
  // Wait for the DevTools endpoint
  const t0 = Date.now()
  while (Date.now() - t0 < 15_000) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
      const page = list.find((t) => t.type === 'page')
      if (page) return { child, port, page }
    } catch { /* chrome still starting */ }
    await new Promise((r) => setTimeout(r, 300))
  }
  child.kill()
  throw new Error('Chrome DevTools endpoint did not come up')
}

// ---------------------------------------------------------------------------
// In-page measurement (runs inside the browser; serialized via .toString())
// ---------------------------------------------------------------------------
function measurePage() {
  const qa = (s, e = document) => Array.from(e.querySelectorAll(s));
  const q = (s, e = document) => e.querySelector(s);
  const rect = (e) => { const b = e.getBoundingClientRect(); return { x: +b.x.toFixed(1), y: +b.y.toFixed(1), w: +b.width.toFixed(1), h: +b.height.toFixed(1) }; };
  const num = (v) => { const n = parseFloat(v); return isNaN(n) ? null : n; };

  const out = { url: location.href, viewport: { w: innerWidth, h: innerHeight }, content: null, subgroups: [], figureOverCap: [], rowsMisalign: [], accentEdgeNotes: [] };
  const contenu = q('.fiche-contenu');
  if (contenu) {
    const st = getComputedStyle(contenu);
    out.content = { rect: rect(contenu), maxWidthPx: num(st.maxWidth) };
    out.leftoverX = +Math.max(0, (innerWidth - contenu.getBoundingClientRect().width) / 2).toFixed(1);
  }

  let prevBottom = null;
  let prevGaps = null;
  for (const g of qa('.sous-groupe')) {
    const gst = getComputedStyle(g);
    const gr = rect(g);
    const info = {
      key: g.dataset.groupe || null,
      rectTop: gr.y, rectH: gr.h,
      boundary: { borderTopPx: num(gst.borderTopWidth), background: gst.backgroundColor, paddingTopPx: num(gst.paddingTop) },
      gapFromPrevGroup: prevBottom === null ? null : +(gr.y - prevBottom).toFixed(1),
      prevGridGaps: prevGaps,
    };
    prevBottom = gr.y + gr.h;

    const title = q('.sous-groupe-titre', g);
    const cadrage = q('.sous-groupe-cadrage', g);
    if (title && cadrage) info.gapTitleToCadrage = +(rect(cadrage).y - (rect(title).y + rect(title).h)).toFixed(1);

    const lecture = q('.sous-groupe-lecture', g);
    if (lecture) {
      const texte = q('.lecture-texte', lecture);
      const fig = q('.lecture-figure', lecture);
      const canvases = qa('canvas', lecture).map(rect);
      info.lecture = {
        rectH: gr.h,
        lectureCardH: +rect(lecture).h.toFixed(1),
        proseWidth: texte ? rect(texte).w : null,
        proseFontPx: texte ? num(getComputedStyle(texte).fontSize) : null,
        proseChPerLineApprox: texte ? Math.round(rect(texte).w / (num(getComputedStyle(texte).fontSize) * 0.48)) : null,
        figureW: fig ? rect(fig).w : null,
        figureH: fig ? rect(fig).h : null,
        canvasRects: canvases,
      };
      for (const c of canvases) if (c.h > 220) out.figureOverCap.push({ where: info.key + '/lecture-canvas', h: c.h });
    }

    const grid = q('.grille-indicateurs', g);
    if (grid) {
      const gcs = getComputedStyle(grid);
      const cols = gcs.gridTemplateColumns.split(' ').filter((s) => parseFloat(s) > 0).length;
      const colGap = num(gcs.columnGap); const rowGap = num(gcs.rowGap);
      prevGaps = { rowGap, colGap };
      const cells = qa(':scope > *', grid);
      const rowMap = new Map();
      for (const cell of cells) {
        const y = Math.round(rect(cell).y);
        if (!rowMap.has(y)) rowMap.set(y, []);
        rowMap.get(y).push(cell);
      }
      const cards = [];
      let lastRowCount = 0;
      for (const [y, rowCells] of [...rowMap.entries()].sort((a, b) => a[0] - b[0])) {
        lastRowCount = rowCells.length;
        for (const cell of rowCells) {
          const figEl = q('[data-clef]', cell) || cell;
          const fr = rect(cell);
          const fst = getComputedStyle(cell);
          const val = q('.valeur-numerique', cell);
          const lab = q('.figure-indicateur-libelle', cell);
          const chip = q('.puce-rang', cell);
          const vin = q('.estampille-vintage', cell);
          const leafs = qa('*', cell).filter((e) => e.children.length === 0 || ['UL', 'FIGCAPTION', 'P'].includes(e.tagName));
          const contentBottom = leafs.reduce((m, e) => { const b = rect(e); return Math.max(m, b.y + b.h); }, fr.y);
          cards.push({
            clef: figEl.getAttribute('data-clef'),
            famille: cell.dataset.famille || null,
            large: cell.classList.contains('figure-indicateur--large'),
            rect: fr,
            borderLeftPx: parseFloat(fst.borderLeftWidth),
            contentLeftEdge: +(fr.x + parseFloat(fst.borderLeftWidth) + parseFloat(fst.paddingLeft)).toFixed(1),
            insetLeftPx: +(parseFloat(fst.borderLeftWidth) + parseFloat(fst.paddingLeft)).toFixed(1),
            valueTop: val ? +rect(val).y.toFixed(1) : null,
            labelTop: lab ? +rect(lab).y.toFixed(1) : null,
            chipTop: chip ? +rect(chip).y.toFixed(1) : null,
            vintageTop: vin ? +rect(vin).y.toFixed(1) : null,
            fillRatio: +((contentBottom - fr.y) / fr.h).toFixed(2),
          });
        }
        const row = cards.slice(-rowCells.length);
        const delta = (k) => { const vs = row.map((c) => c[k]).filter((v) => v !== null); return vs.length > 1 ? +(Math.max(...vs) - Math.min(...vs)).toFixed(1) : 0; };
        const insets = row.map((c) => c.insetLeftPx);
        const lefts = row.map((c) => c.contentLeftEdge);
        const rowInfo = {
          group: info.key, rowTop: y,
          cards: row.map((c) => c.clef),
          valueTopDelta: delta('valueTop'),
          labelTopDelta: delta('labelTop'),
          chipTopDelta: delta('chipTop'),
          vintageTopDelta: delta('vintageTop'),
          leftEdgeDelta: +(Math.max(...lefts) - Math.min(...lefts)).toFixed(1),
          insetLeftDelta: +(Math.max(...insets) - Math.min(...insets)).toFixed(1),
        };
        if (rowInfo.valueTopDelta > 2 || rowInfo.labelTopDelta > 2 || rowInfo.chipTopDelta > 2 || rowInfo.vintageTopDelta > 2) out.rowsMisalign.push(rowInfo);
        if (rowInfo.insetLeftDelta > 1) out.accentEdgeNotes.push(rowInfo);
      }
      info.grid = {
        columns: cols, columnGap: colGap, rowGap: rowGap,
        cells: cells.length,
        lastRowEmptyCells: cols - lastRowCount,
        gapTitleToGrid: title && cells.length ? +(rect(cells[0]).y - (rect(title).y + rect(title).h)).toFixed(1) : null,
        cards,
      };
      for (const c of cards) if (!c.large && c.rect.h > 220) out.figureOverCap.push({ where: info.key + '/' + c.clef, h: c.rect.h });
    }
    out.subgroups.push(info);
  }
  return out;
}

function pageReady() {
  if (!document.querySelector('.fiche')) return false;
  if (document.querySelector('.fiche[aria-busy="true"]')) return false;
  if (!document.querySelector('.onglet-theme')) return false;
  if (document.fonts && document.fonts.status !== 'loaded') return false;
  return document.querySelectorAll('.grille-indicateurs').length > 0;
}

// ---------------------------------------------------------------------------
// Assertions — the red-capable part
// ---------------------------------------------------------------------------
function assertMetrics(m, findings) {
  const add = (id, ok, detail) => findings.push({ id, verdict: ok ? 'GREEN' : 'RED', detail })

  // A1 — a subgroup boundary must separate more than the grid's own gutters.
  for (const sg of m.subgroups) {
    if (sg.gapFromPrevGroup === null) continue
    const ref = Math.max(sg.prevGridGaps?.rowGap ?? 24, sg.prevGridGaps?.colGap ?? 32)
    add('A1-hierarchy-gap',
      sg.gapFromPrevGroup >= ref + 16,
      `${sg.key}: inter-subgroup ${sg.gapFromPrevGroup}px vs previous grid gutters ${JSON.stringify(sg.prevGridGaps)} (need >= ${ref + 16})`)
  }
  // A2 — the subgroup must OWN its cards with a visible boundary.
  for (const sg of m.subgroups) {
    const b = sg.boundary
    add('A2-boundary-visible',
      b.borderTopPx > 0 || b.paddingTopPx > 0 || (b.background && b.background !== 'rgba(0, 0, 0, 0)' && b.background !== 'transparent'),
      `${sg.key}: border-top=${b.borderTopPx}px padding-top=${b.paddingTopPx}px bg=${b.background}`)
  }
  // A3 — compactness rule (ADR-0023): no grid/reading figure above ~200px (+20 tolerance).
  add('A3-compactness-200px', m.figureOverCap.length === 0,
    m.figureOverCap.length ? `${m.figureOverCap.length} over cap: ${m.figureOverCap.slice(0, 6).map((f) => `${f.where}@${f.h}px`).join(', ')}` : 'all figures <= 220px')
  // A4 — intra-row alignment of card content tops.
  add('A4-row-alignment', m.rowsMisalign.length === 0,
    m.rowsMisalign.length ? `${m.rowsMisalign.length} misaligned rows: ` + m.rowsMisalign.slice(0, 4).map((r) => `${r.group}[${r.cards.join('|')}] vΔ${r.valueTopDelta} lΔ${r.labelTopDelta} cΔ${r.chipTopDelta} vinΔ${r.vintageTopDelta}`).join(' ; ') : 'rows aligned within 2px')
  // A5 — consistent left content inset within a row (the accent's 3px border
  // must not shift content relative to non-accented neighbours).
  add('A5-left-edge-consistency', m.accentEdgeNotes.length === 0,
    m.accentEdgeNotes.length ? `${m.accentEdgeNotes.length} rows with inset mismatch: ` + m.accentEdgeNotes.slice(0, 4).map((r) => `${r.group} Δ${r.insetLeftDelta}px`).join(', ') : 'insets consistent')
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
mkdirSync(OUT, { recursive: true })
const specs = ONLY ? SPECS.filter((s) => ONLY.includes(s.name)) : SPECS

console.log(`#445 evidence harness — base=${BASE} out=${OUT} shots=${SHOTS}`)
const { child, page } = await launchChrome()
try {
  const cdp = await Cdp.connect(page.webSocketDebuggerUrl)
  await cdp.send('Page.enable')
  await cdp.send('Runtime.enable')

  const allFindings = []
  for (const spec of specs) {
    const url = `${BASE}/territoire/${spec.type}/${spec.id}?theme=${spec.theme}`
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: spec.w, height: spec.h, deviceScaleFactor: 1, mobile: Boolean(spec.mobile),
    })
    await cdp.send('Page.navigate', { url })
    const t0 = Date.now()
    for (;;) {
      if (await cdp.evaluate(`(${pageReady.toString()})()`)) break
      if (Date.now() - t0 > 25_000) throw new Error(`timeout waiting for render: ${spec.name}`)
      await new Promise((r) => setTimeout(r, 400))
    }
    await new Promise((r) => setTimeout(r, 1500)) // canvas/font settle

    const metrics = await cdp.evaluate(`(${measurePage.toString()})()`)
    metrics.spec = { width: spec.w, height: spec.h, mobile: Boolean(spec.mobile) }
    writeFileSync(join(OUT, `${spec.name}.metrics.json`), JSON.stringify(metrics, null, 1))

    if (SHOTS) {
      const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })
      writeFileSync(join(OUT, `${spec.name}.png`), Buffer.from(shot.data, 'base64'))
    }
    const findings = []
    assertMetrics(metrics, findings)
    allFindings.push({ spec: spec.name, findings })
    console.log(`captured ${spec.name} — subgroups=${metrics.subgroups.length} figuresOverCap=${metrics.figureOverCap.length} misalignedRows=${metrics.rowsMisalign.length}`)
  }

  // Assertion roll-up across captures
  const rollup = new Map()
  for (const { findings } of allFindings) {
    for (const f of findings) {
      const cur = rollup.get(f.id) ?? { id: f.id, green: 0, red: 0, examples: [] }
      if (f.verdict === 'GREEN') cur.green++
      else { cur.red++; if (cur.examples.length < 3) cur.examples.push(`${f.detail}`) }
      rollup.set(f.id, cur)
    }
  }
  console.log('\n=== assertion roll-up ===')
  let reds = 0
  for (const { id, green, red, examples } of [...rollup.values()].sort((a, b) => a.id.localeCompare(b.id))) {
    console.log(`${red ? 'RED  ' : 'GREEN'} ${id}  (green=${green} red=${red})`)
    for (const ex of examples) console.log(`       · ${ex}`)
    reds += red > 0 ? 1 : 0
  }
  if (ASSERT && reds > 0) {
    console.log(`\n${reds} assertion(s) RED — exiting 1 (--assert)`)
    process.exitCode = 1
  }
} finally {
  child.kill()
}
