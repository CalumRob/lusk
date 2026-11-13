// THROWAWAY. Browser-only pdfmake experiment. No production routes or API.
import { createApp, h, ref, computed, nextTick } from 'vue'
import * as fixtures from '@/payload/fixtures'
import { territoryFactsFor } from '@/fiche/content/territoryFacts'
import { resolveMobiliteThemeContent } from '@/fiche/content/themeContent'
import { formatServedRank } from '@/fiche/figureGrammaire'
import CahierMobiliteComparisonBars from '../CahierMobiliteComparisonBars.vue'
import '@/styles/tokens.css'
import '@fontsource-variable/mozilla-text'
import './prototype.css'

const payload = {
  territoires: fixtures.territoiresFixture, indicateurs: fixtures.indicateursMobiliteFixture,
  histoires: fixtures.histoiresMobiliteFixture, runReport: null, vintages: fixtures.vintagesFixture,
  programmes: null, themeMetadata: { mobilite: fixtures.metadonneesThemesFixtures.mobilite },
}
const content = resolveMobiliteThemeContent(territoryFactsFor(payload, '22001'), payload.themeMetadata.mobilite)
const chapter = content.units.find(unit => unit.key === 'partage-de-lespace-public')
const comparisonLabel = chapter.sections[0].evidence.figure.comparisonLabel
const plain = blocks => blocks.map(block => block.map(segment => segment.value).join('')).join('\n\n')
const items = chapter.sections.flatMap(section => {
  const evidence = section.evidence
  if (evidence.kind === 'mobilite-networks') return [{ heading: section.label, figure: evidence.figure, prose: evidence.prose, sources: evidence.sources }]
  return evidence.columns.map(column => ({ heading: section.label, figure: column.bars, prose: column.prose, sources: column.sources, ratio: column.ratio }))
})

// Freeze semantic information, not scraped HTML. DOM is used only for the
// existing renderer's vector geometry and its computed presentation colours.
function captureSnapshot(showComparison) {
  return JSON.parse(JSON.stringify({
    territory: content.territory, theme: content.label, chapter: { key: chapter.key, label: chapter.label, introduction: chapter.introduction },
    comparison: { visible: showComparison, label: showComparison ? comparisonLabel : 'Aucune comparaison affichée' },
    fixture: true, exportedAt: new Date().toISOString(), items,
  }))
}

function palette() {
  const css = getComputedStyle(document.documentElement)
  return Object.fromEntries(['paper', 'ink', 'muted', 'margin'].map(key => [key, css.getPropertyValue(`--editorial-${key}`).trim()]))
}

function colour(cssColour) {
  if (cssColour === 'none') return 'none'
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  ctx.fillStyle = cssColour; ctx.fillRect(0, 0, 1, 1)
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data
  return `#${[r, g, b].map(value => value.toString(16).padStart(2, '0')).join('')}`
}

function vectorFromRenderer(container) {
  const source = container.querySelector('.mobilite-comparison-bars__svg')
  const clone = source.cloneNode(true)
  const originals = [source, ...source.querySelectorAll('*')]
  const copies = [clone, ...clone.querySelectorAll('*')]
  originals.forEach((element, index) => {
    const style = getComputedStyle(element)
    for (const property of ['fill', 'stroke']) copies[index].setAttribute(property, colour(style[property]))
    for (const property of ['stroke-width', 'stroke-dasharray', 'opacity', 'fill-opacity', 'stroke-opacity']) {
      const value = style.getPropertyValue(property)
      if (value && value !== 'none') copies[index].setAttribute(property, value)
    }
    copies[index].removeAttribute('class')
    copies[index].removeAttribute('style')
  })
  // Cahier's tick labels are HTML outside its SVG. Carry their *positions*
  // into the exported vector; no factual value is parsed from page text.
  const box = source.getBoundingClientRect()
  const view = source.viewBox.baseVal
  container.querySelectorAll('.cahier-figure-tick-label').forEach(label => {
    const rect = label.getBoundingClientRect()
    const text = document.createElementNS('http://www.w3.org/2000/svg', 'text')
    text.setAttribute('x', String((rect.x + rect.width / 2 - box.x) * view.width / box.width))
    text.setAttribute('y', String((rect.y + rect.height * .8 - box.y) * view.height / box.height))
    text.setAttribute('font-family', 'Roboto')
    text.setAttribute('font-size', '12')
    text.setAttribute('text-anchor', 'middle')
    text.setAttribute('fill', palette().muted)
    text.textContent = label.textContent
    clone.appendChild(text)
  })
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  clone.setAttribute('width', String(view.width)); clone.setAttribute('height', String(view.height))
  return new XMLSerializer().serializeToString(clone)
}

const number = value => value === null ? 'Indisponible' : new Intl.NumberFormat('fr-FR', { maximumSignificantDigits: 4 }).format(value)
function documentDefinition(snapshot, vectors) {
  const p = palette()
  const paragraph = blocks => blocks.map(block => ({
    text: block.map(segment => ({ text: segment.value, bold: segment.kind === 'emphasis' || segment.kind === 'mode-emphasis', ...(segment.kind === 'link' ? { link: segment.href } : {}) })),
    margin: [0, 0, 0, 9], lineHeight: 1.3,
  }))
  const body = [
    { text: 'CAHIER TERRITORIAL · MOBILITÉ', color: p.margin, fontSize: 9, characterSpacing: 1.2, margin: [0, 0, 0, 12] },
    { text: snapshot.territory.name, fontSize: 29, bold: true, margin: [0, 0, 0, 6] },
    { text: snapshot.chapter.label, fontSize: 20, bold: true, margin: [0, 0, 0, 15] },
    { text: 'PROTOTYPE — DONNÉES SYNTHÉTIQUES · Ne pas utiliser comme diagnostic territorial.', color: p.margin, fontSize: 8, margin: [0, 0, 0, 12] },
    ...paragraph(snapshot.chapter.introduction),
  ]
  snapshot.items.forEach((item, index) => {
    // Subject boundaries are intentional; overflow inside each subject remains
    // automatic. This tests repeated header/footer with no fixed-height clipping.
    body.push({ text: `${String(index + 1).padStart(2, '0')}  ${item.figure.figureTitle}`, fontSize: 17, bold: true, color: p.ink, margin: [0, 18, 0, 12], ...(index ? { pageBreak: 'before' } : {}) })
    body.push(...paragraph(item.prose))
    body.push({ text: item.figure.yAxisTitle, fontSize: 9, color: p.muted, margin: [0, 6, 0, 0] })
    body.push({ svg: vectors[index], width: 410, margin: [0, 0, 0, 8] })
    body.push({ text: snapshot.comparison.visible ? `Barres pleines : ${snapshot.territory.name} · Barres pâles : groupe comparé.` : `Barres pleines : ${snapshot.territory.name}. Aucune comparaison affichée.`, fontSize: 8, color: p.muted, margin: [0, 0, 0, 12] })
    body.push({ table: {
      headerRows: 1, widths: ['*', 75, ...(snapshot.comparison.visible ? [75, 44] : [])],
      body: [
        [{ text: item.figure.unit, bold: true }, { text: snapshot.territory.name, bold: true }, ...(snapshot.comparison.visible ? [{ text: 'Groupe comparé', bold: true }, { text: 'Rang', bold: true }] : [])],
        ...item.figure.categories.map(category => [category.label, number(category.value.fact.value), ...(snapshot.comparison.visible ? [number(category.value.fact.comparison?.reference?.value ?? null), formatServedRank(category.value.fact.comparison?.rank) ?? '—'] : [])]),
      ],
    }, layout: 'lightHorizontalLines', fontSize: 9, margin: [0, 0, 0, 12] })
    for (const category of item.figure.categories) {
      if (category.splitNote) body.push({ text: category.splitNote, fontSize: 8, color: p.muted, margin: [0, 0, 0, 8] })
    }
    if (item.ratio) body.push({ text: `${item.ratio.label} : ${number(item.ratio.value.fact.value)}${item.ratio.note ? `\n${item.ratio.note}` : ''}`, fontSize: 9, margin: [0, 0, 0, 12] })
    body.push({ text: `Sources : ${item.sources.map(source => source.id).join(' · ')}. Détail en fin de document.`, color: p.muted, fontSize: 8, margin: [0, 0, 0, 8] })
  })
  body.push({ text: 'Carnet des sources', pageBreak: 'before', fontSize: 20, bold: true, margin: [0, 0, 0, 18] })
  const sources = [...new Map(snapshot.items.flatMap(item => item.sources).map(source => [source.id, source])).values()]
  for (const source of sources) body.push({ unbreakable: true, stack: [{ text: source.id, bold: true, fontSize: 10, margin: [0, 0, 0, 5] }, { text: `${source.source}\nVersion ${source.version} · Observation : ${source.referenceDate ?? 'non précisée'} · Publication : ${source.publicationDate ?? 'non précisée'}`, color: p.muted, fontSize: 9, lineHeight: 1.3, ...(source.url ? { link: source.url } : {}) }], margin: [0, 0, 0, 18] })
  return {
    pageSize: 'A4', pageMargins: [60, 88, 60, 78],
    info: { title: `${snapshot.territory.name} — ${snapshot.chapter.label}`, author: 'Lusk · prototype', subject: snapshot.comparison.label },
    defaultStyle: { font: 'Roboto', fontSize: 10, color: p.ink },
    background: (_page, size) => ({ canvas: [
      { type: 'rect', x: 0, y: 0, w: size.width, h: size.height, color: p.paper },
      { type: 'line', x1: 42, y1: 80, x2: 42, y2: size.height - 68, lineWidth: .7, lineColor: p.margin },
    ] }),
    header: { margin: [60, 28, 60, 0], stack: [
      { columns: [{ text: 'Lusk', bold: true, fontSize: 19 }, { text: `${snapshot.territory.name} · ${snapshot.theme}`, alignment: 'right', fontSize: 9, margin: [0, 8, 0, 0] }] },
      { text: snapshot.chapter.label, color: p.muted, fontSize: 8, margin: [0, 4, 0, 0] },
    ] },
    footer: (currentPage, pageCount) => ({ margin: [60, 14, 60, 0], stack: [
      { text: snapshot.comparison.label, fontSize: 8, color: p.ink, margin: [0, 0, 0, 5] },
      { columns: [{ text: `PROTOTYPE · Export du ${snapshot.exportedAt.slice(0, 10)}`, fontSize: 7, color: p.muted }, { text: `${currentPage} / ${pageCount}`, alignment: 'right', fontSize: 8, color: p.margin }] },
    ] }),
    content: body,
  }
}

createApp({
  setup() {
    const selection = ref('visible')
    const busy = ref(false)
    const result = ref('Le PDF est généré dans votre navigateur. Aucun service Chromium côté serveur.')
    const visible = computed(() => selection.value === 'visible')
    async function download() {
      busy.value = true
      try {
        await nextTick(); await document.fonts.ready
        const snapshot = captureSnapshot(visible.value)
        const vectors = [...document.querySelectorAll('.prototype-figure')].map(vectorFromRenderer)
        window.prototypeSnapshot = snapshot
        const start = performance.now()
        const [{ default: pdfMake }, { default: vfs }] = await Promise.all([import('pdfmake/build/pdfmake'), import('pdfmake/build/vfs_fonts')])
        pdfMake.addVirtualFileSystem(vfs)
        const pdf = pdfMake.createPdf(documentDefinition(snapshot, vectors))
        const blob = await pdf.getBlob()
        const url = URL.createObjectURL(blob)
        const link = document.createElement('a'); link.href = url; link.download = 'lusk-cahier-prototype.pdf'; link.click()
        setTimeout(() => URL.revokeObjectURL(url), 30000)
        result.value = `${(blob.size / 1024).toFixed(0)} Ko · ${(performance.now() - start).toFixed(0)} ms (chargement PDF inclus) · ${snapshot.comparison.label}`
      } catch (error) { result.value = String(error); console.error(error) }
      finally { busy.value = false }
    }
    window.prototypeReady = true
    return () => h('main', { class: 'pdf-prototype' }, [
      h('aside', { class: 'prototype-toolbar' }, [
        h('strong', 'Essai PDF · données synthétiques'),
        h('label', ['Comparaison ', h('select', { id: 'comparison', value: selection.value, disabled: busy.value, onChange: event => { selection.value = event.target.value } }, [h('option', { value: 'visible' }, comparisonLabel), h('option', { value: 'none' }, 'Aucune comparaison affichée')])]),
        h('button', { id: 'export', disabled: busy.value, onClick: download }, busy.value ? 'Génération…' : 'Télécharger le PDF A4'),
        h('p', { id: 'result', role: 'status' }, result.value),
      ]),
      h('article', { class: 'prototype-paper' }, [
        h('p', { class: 'prototype-index' }, `Lusk · ${content.label} · ${content.territory.name}`),
        h('h1', chapter.label), h('p', plain(chapter.introduction)),
        ...items.map((item, index) => h('section', [
          h('h2', `${String(index + 1).padStart(2, '0')}  ${item.figure.figureTitle}`),
          h('p', plain(item.prose)),
          h('div', { class: 'prototype-figure', inert: true, key: `${index}-${selection.value}` }, [h(CahierMobiliteComparisonBars, { figure: item.figure, comparison: { status: visible.value ? 'ready' : 'unavailable' }, ratio: item.ratio })]),
        ])),
      ]),
    ])
  },
}).mount('#prototype')
