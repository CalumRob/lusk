// THROWAWAY narrow DOM paint adapter, NOT a general HTML-to-PDF renderer.
// Browser does layout. Existing DOM supplies text, styles, geometry, SVGs and
// images. No separate chapter template, copied facts or independently drawn waffle.
import { jsPDF } from 'jspdf'
import 'svg2pdf.js'
import { instances, ready } from './rennes'
import { cornerRadii, borderPattern, boxPath } from './paintGeometry'
import { GROUPE_COMPARE_LABEL } from '@/fiche/content/comparisonWording'
import { timeRampTooltipRows } from '../aedarTimeRampTooltip'
import { groupedBarTooltipRows } from '../groupedBarTooltip'
import { nextTick } from 'vue'
import { choosePdfModes } from './modeChoice'

const COMPARISON_MARK = '¹'
const FOOTER_INVITATION = 'Retrouvez les cartes et explorez les données sur'
const valuesHeading = count => count === 1 ? 'Valeurs du graphique' : 'Valeurs des graphiques'

function compactTerritoryHeader(cell, name) {
  cell.textContent = ''
  const label = document.createElement('span')
  label.dataset.pdfCompactTerritory = name
  label.title = name
  label.textContent = name
  label.style.cssText = 'display:block;white-space:normal;overflow-wrap:anywhere;line-height:1.2;'
  cell.append(label)
}
function fitTableLabels(chapter) {
  const compactLabels = []
  chapter.querySelectorAll('[data-pdf-compact-territory]').forEach(label => {
    const full = label.dataset.pdfCompactTerritory
    const range = document.createRange()
    const fits = text => {
      label.textContent = text; range.selectNodeContents(label)
      const lines = new Set([...range.getClientRects()].map(rect => Math.round(rect.top)))
      return lines.size <= 2 && [...range.getClientRects()].every(rect => rect.width <= label.clientWidth + .5)
    }
    if (!fits(full)) {
      const letters = Array.from(full)
      let low = 0, high = letters.length
      while (low < high) {
        const middle = Math.ceil((low + high) / 2)
        if (fits(`${letters.slice(0, middle).join('').trimEnd()}…`)) low = middle
        else high = middle - 1
      }
      label.textContent = `${letters.slice(0, low).join('').trimEnd()}…`
    }
    compactLabels.push({ full, displayed: label.textContent })
  })
  chapter.querySelectorAll('[data-pdf-value]').forEach(cell => {
    if (cell.textContent !== 'Indisponible') return
    const range = document.createRange(); range.selectNodeContents(cell)
    if (range.getBoundingClientRect().width > cell.clientWidth - 4) {
      cell.textContent = 'Indisp.'
      cell.closest('.concept-group').dataset.pdfAbbreviatedUnavailable = 'true'
    }
  })
  chapter.querySelectorAll('[data-pdf-abbreviated-unavailable]').forEach(section => {
    const note = document.createElement('p'); note.textContent = 'Indisp. : valeur indisponible.'
    note.style.cssText = 'font:var(--type-figure-legend);color:var(--muted);margin:8px 0 0;'
    ;(section.querySelector('[data-pdf-tables]') ?? section).append(note)
  })
  return compactLabels
}
function placeSectionSources(chapter) {
  chapter.querySelectorAll('.concept-group').forEach(section => {
    const sources = [...section.querySelectorAll('.cahier-evidence-source')]
    if (!sources.length) return
    const stamp = document.createElement('div')
    stamp.dataset.pdfSectionSources = ''
    copyProperties(sources[0], stamp, ['font-family', 'font-size', 'font-weight', 'font-style', 'line-height', 'letter-spacing', 'color'])
    stamp.style.cssText += ';display:flex;justify-content:flex-end;align-items:baseline;flex-wrap:wrap;gap:4px;text-align:right;margin-top:16px;'
    const prefix = document.createElement('span'); prefix.textContent = 'Source(s) : '
    stamp.append(prefix)
    sources.forEach((source, index) => {
      if (index) stamp.append(document.createTextNode(' · '))
      source.style.cssText += ';display:inline;margin:0;text-align:right;'
      stamp.append(source)
    })
    section.append(stamp)
  })
}

function comparisonReference() {
  const reference = document.createElement('a')
  reference.href = '#pdf-comparison-context'
  reference.dataset.pdfFooterReference = ''
  reference.style.cssText = 'font:inherit;color:inherit;text-decoration:none;'
  reference.textContent = COMPARISON_MARK
  return reference
}

const rgbCanvas = document.createElement('canvas')
rgbCanvas.width = rgbCanvas.height = 1
const rgbContext = rgbCanvas.getContext('2d', { willReadFrequently: true })
function rgba(value) {
  rgbContext.clearRect(0, 0, 1, 1)
  rgbContext.fillStyle = value; rgbContext.fillRect(0, 0, 1, 1)
  return [...rgbContext.getImageData(0, 0, 1, 1).data]
}
function visible(element) {
  const style = getComputedStyle(element)
  const box = element.getBoundingClientRect()
  return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) !== 0
    && box.width > 1 && box.height > 1 && style.clipPath !== 'inset(50%)'
    && !/^rect\(0px,? 0px,? 0px,? 0px\)$/.test(style.clip)
}
function fontsOf(style) {
  return { family: style.fontFamily.split(',')[0].replaceAll(/["']/g, '').trim(), weight: Number(style.fontWeight), style: style.fontStyle }
}
function copyProperties(from, to, properties) {
  const style = getComputedStyle(from)
  for (const property of properties) to.style.setProperty(property, style.getPropertyValue(property))
}
function prepare(publicPageUrl, { territoryFirst = false } = {}) {
  const source = document.querySelector('.cahier')
  const clone = source.cloneNode(true)
  const width = source.getBoundingClientRect().width
  clone.style.cssText += `;position:absolute;left:-20000px;top:0;width:${width}px;max-width:none;pointer-events:none;`
  source.parentElement.appendChild(clone)
  const chapter = clone.querySelector('#figure-lecture')
  const originalChapter = source.querySelector('#figure-lecture')
  const removed = []
  chapter.querySelectorAll('[aria-pressed="false"]').forEach(button => {
    removed.push(button.getAttribute('aria-label') ?? button.textContent.trim())
    ;(button.closest('.cahier-figure-legend-item') ?? button).remove()
  })
  chapter.querySelectorAll('[role="tooltip"], .cahier-figure-tooltip, .aedar-waffle-explore, .aedar-equipment-explorer-change, .cahier-section-footer, .aedar-comparison-retry-slot, .aedar-waffle-tile-tooltip').forEach(element => element.remove())
  chapter.querySelectorAll('.argument-copy').forEach(copy => {
    if (copy.matches('.cahier-evidence-source')) return
    copy.querySelectorAll('.cahier-evidence-source').forEach(source => copy.before(source))
    copy.remove()
  })
  const textWalker = document.createTreeWalker(chapter, NodeFilter.SHOW_TEXT)
  const comparisonLabels = []
  while (textWalker.nextNode()) {
    const node = textWalker.currentNode
    if (node.parentElement.closest('.cahier-figure-legend-label, .cahier-comparison-value__reference') && node.data.includes(GROUPE_COMPARE_LABEL)) comparisonLabels.push(node)
  }
  comparisonLabels.forEach(node => {
    const tail = node.splitText(node.data.indexOf(GROUPE_COMPARE_LABEL) + GROUPE_COMPARE_LABEL.length)
    node.parentNode.insertBefore(document.createTextNode(' '), tail)
    node.parentNode.insertBefore(comparisonReference(), tail)
  })
  clone.querySelectorAll('.page-heading').forEach(element => { element.style.position = 'static' })

  const header = document.createElement('div')
  header.style.cssText = 'display:grid;grid-template-columns:1fr auto 1fr;align-items:center;column-gap:20px;padding-bottom:12px;'
  const brand = document.querySelector('.en-tete .lusk-marque').cloneNode(true)
  const home = document.createElement('a')
  home.href = new URL('/', publicPageUrl).href
  home.style.cssText = 'display:inline-flex;justify-self:start;align-items:center;text-decoration:none;color:inherit;'
  home.appendChild(brand)
  const title = originalChapter.querySelector('.page-heading h2').cloneNode(true)
  copyProperties(originalChapter.querySelector('.page-heading h2'), title, ['font-family', 'font-size', 'font-weight', 'font-style', 'line-height', 'letter-spacing', 'color'])
  title.style.cssText += ';margin:0;text-align:center;white-space:nowrap;'
  const right = document.createElement('a')
  right.style.cssText = 'display:flex;align-items:center;justify-self:end;gap:8px;text-decoration:none;'
  const territory = originalChapter.querySelector('.page-heading-territory').cloneNode(true)
  const link = document.querySelector('.bouton-contact svg').cloneNode(true)
  copyProperties(document.querySelector('.bouton-contact svg'), link, ['width', 'height', 'color', 'stroke-width'])
  link.style.color = getComputedStyle(originalChapter.querySelector('.page-heading-territory')).color
  right.append(territory, link)
  right.href = publicPageUrl
  header.append(home, title, right)
  chapter.querySelectorAll('.concept-group').forEach(section => {
    const sectionHeading = section.querySelector('.concept-group-heading')
    const sectionTitle = sectionHeading?.querySelector('h3')
    if (!sectionHeading || !sectionTitle) return
    const identity = right.cloneNode(true)
    identity.classList.add('pdf-section-territory')
    identity.style.cssText = 'display:flex;align-items:center;justify-content:center;max-width:100%;text-decoration:none;margin:0;'
    identity.querySelector('svg')?.remove()
    const name = identity.querySelector('.page-heading-territory')
    name.style.cssText = 'font:var(--text-page-heading);color:var(--editorial-muted);letter-spacing:var(--text-overline-tracking);text-transform:uppercase;text-align:center;white-space:normal;overflow:visible;text-overflow:clip;'
    const sectionUrl = new URL(publicPageUrl)
    sectionUrl.hash = `section-${section.dataset.section}`
    identity.href = sectionUrl.href
    sectionHeading.style.cssText += ';display:flex;flex-direction:column;align-items:center;justify-content:center;gap:var(--space-3);'
    if (territoryFirst) {
      sectionTitle.style.cssText += ';font:var(--type-figure-title);color:var(--muted);'
      sectionHeading.prepend(identity)
    } else sectionHeading.appendChild(identity)
  })
  const main = chapter.querySelector('.page-main')
  header.style.width = `${main.getBoundingClientRect().width}px`
  header.style.borderBottom = getComputedStyle(originalChapter.querySelector('.page-heading')).borderBottom
  main.appendChild(header)
  return { source, clone, chapter, main, header, removed }
}

function appendTimeRampTables(ui, territoryName) {
  const section = [...ui.chapter.querySelectorAll('.concept-group')].find(block => block.dataset.section === 'aedar-access')
  const heading = document.createElement('p')
  heading.style.cssText = 'font:var(--type-figure-title);color:var(--ink);margin:24px 0 12px;text-align:center;'
  const panel = document.createElement('div')
  panel.style.cssText = 'display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:24px;'
  const models = []
  const ramps = instances().filter(instance => instance.type.__name === 'AccessRampFigureCahier'
    && instance.vnode.el?.closest?.('.concept-group')?.dataset.section === 'aedar-access')
  for (const instance of ramps) {
    const data = instance.props.timeRamp
    const series = instance.setupState.visibleTimeSeries
    const hasComparison = Boolean(instance.setupState.comparisonLayerSupported && instance.setupState.comparisonVisible)
    const cuts = instance.setupState.timePoints
    const rows = cuts.flatMap(cut => timeRampTooltipRows(data, series, cut, territoryName, hasComparison)
      .map(row => ({ cut: cut.xLabel, ...row })))
    const sourceCaption = instance.vnode.el.closest('figure').querySelector('figcaption')
    const group = document.createElement('div')
    const caption = sourceCaption.cloneNode(true)
    copyProperties(sourceCaption, caption, ['font-family', 'font-size', 'font-weight', 'line-height', 'letter-spacing', 'color'])
    caption.style.cssText += ';margin:0 0 8px;text-align:center;'
    const table = document.createElement('table')
    table.style.cssText = 'width:100%;table-layout:fixed;border-collapse:collapse;font:var(--type-figure-mode);color:var(--ink);'
    const columns = hasComparison ? ['14%', '32%', '18%', '18%', '18%'] : ['18%', '46%', '36%']
    const colgroup = document.createElement('colgroup')
    columns.forEach(width => { const col = document.createElement('col'); col.style.width = width; colgroup.appendChild(col) })
    table.appendChild(colgroup)
    const thead = table.createTHead(), headerRow = thead.insertRow()
    const headers = ['Temps', 'Mode', territoryName, ...(hasComparison ? [GROUPE_COMPARE_LABEL, 'Rang'] : [])]
    headers.forEach(label => {
      const th = document.createElement('th')
      th.textContent = label
      th.style.cssText = 'font-weight:600;text-align:left;vertical-align:bottom;padding:6px 4px;border-bottom:1px solid var(--editorial-margin-soft);overflow-wrap:anywhere;'
      if (label === territoryName) compactTerritoryHeader(th, territoryName)
      if (label === GROUPE_COMPARE_LABEL) th.append(' ', comparisonReference())
      headerRow.appendChild(th)
    })
    const tbody = table.createTBody()
    rows.forEach(row => {
      const tr = tbody.insertRow()
      const values = [row.cut, row.label, row.value, ...(hasComparison ? [row.comparison.value, row.comparison.rank ?? '—'] : [])]
      values.forEach((value, index) => {
        const td = tr.insertCell()
        td.textContent = value
        if (index >= 2) td.dataset.pdfValue = ''
        td.style.cssText = 'padding:5px 4px;border-bottom:1px solid var(--border-default);vertical-align:top;'
        if (index >= 2) td.style.font = 'var(--type-figure-legend)'
        if (index === 1) td.style.color = row.markerColor
      })
    })
    group.append(caption, table); panel.appendChild(group)
    models.push({ title: sourceCaption.textContent.trim(), unit: data.yAxis.unit, hasComparison,
      selectedModes: series.map(series => series.key), cutCount: cuts.length,
      rows: rows.map(({ cut, label, value, comparison }) => ({ cut, label, value, comparison })) })
  }
  if (!models.length) throw new Error('No rendered time ramps to export')
  heading.textContent = valuesHeading(models.length)
  const tables = document.createElement('div'); tables.dataset.pdfTables = ''
  tables.append(heading, panel); section.append(tables)
  return models
}

function appendSandboxTables(ui, territoryName) {
  const key = 'aedar-equipment-explorer'
  const section = [...ui.chapter.querySelectorAll('.concept-group')].find(block => block.dataset.section === key)
  const components = instances().filter(instance => instance.vnode.el?.closest?.('.concept-group')?.dataset.section === key)
  const ramp = components.find(instance => instance.type.__name === 'AccessRampFigureCahier')
  const bars = components.find(instance => instance.type.__name === 'CahierGroupedVerticalBarChart')
  const explorer = components.find(instance => instance.type.__name === 'AedarEquipmentExplorerCahier')
  if (!ramp || !bars || !explorer) throw new Error('Sandbox figures are not rendered')
  const sourceCaption = instance => instance.vnode.el.closest('figure').querySelector('figcaption')
  const rampData = ramp.props.timeRamp
  const rampSeries = ramp.setupState.visibleTimeSeries
  const rampComparison = Boolean(ramp.setupState.comparisonLayerSupported && ramp.setupState.comparisonVisible)
  const barFigure = { ...bars.props.figure, series: bars.setupState.visibleSeries }
  const primaryBars = barFigure.series.filter(series => !series.comparisonFor)
  const orderedBars = [
    ...rampSeries.flatMap(series => primaryBars.filter(bar => bar.key === series.key)),
    ...primaryBars.filter(bar => !rampSeries.some(series => series.key === bar.key)),
  ]
  const models = [
    {
      caption: sourceCaption(ramp), axisLabel: 'Temps', hasComparison: rampComparison,
      columns: rampSeries.map(series => ({ key: series.key, label: series.label, color: ramp.setupState.timeLegendMarkColors[series.key] })),
      records: ramp.setupState.timePoints.map(cut => ({ label: cut.xLabel,
        cells: timeRampTooltipRows(rampData, rampSeries, cut, territoryName, rampComparison) })),
    },
    {
      caption: sourceCaption(bars), axisLabel: 'Statistique', hasComparison: barFigure.series.some(series => series.comparisonFor),
      columns: orderedBars.map(series => ({ key: series.key, label: series.label, color: series.color })),
      records: barFigure.categories.map((category, index) => ({ label: category.label, cells: groupedBarTooltipRows(barFigure, index) })),
    },
  ]
  const heading = document.createElement('p')
  heading.textContent = valuesHeading(models.length)
  heading.style.cssText = 'font:var(--type-figure-title);color:var(--ink);margin:24px 0 12px;text-align:center;'
  const tables = document.createElement('div'); tables.dataset.pdfTables = ''
  tables.append(heading); section.append(tables)
  for (const model of models) {
    const caption = model.caption.cloneNode(true)
    copyProperties(model.caption, caption, ['font-family', 'font-size', 'font-weight', 'line-height', 'letter-spacing', 'color'])
    caption.style.cssText += ';margin:0 0 8px;text-align:center;'
    const table = document.createElement('table')
    table.style.cssText = 'width:100%;table-layout:fixed;border-collapse:collapse;font:var(--type-figure-mode);color:var(--ink);margin-bottom:20px;'
    const count = model.hasComparison ? 3 : 1
    const colgroup = document.createElement('colgroup')
    const axisCol = document.createElement('col'); axisCol.style.width = '14%'; colgroup.appendChild(axisCol)
    model.columns.forEach(() => {
      for (let index = 0; index < count; index++) {
        const col = document.createElement('col'); col.style.width = `${86 / (model.columns.length * count)}%`; colgroup.appendChild(col)
      }
    })
    table.appendChild(colgroup)
    const head = table.createTHead(), modeRow = head.insertRow(), labelRow = head.insertRow()
    const th = (row, label) => {
      const cell = document.createElement('th'); cell.textContent = label
      cell.style.cssText = 'padding:4px;font-weight:600;text-align:left;vertical-align:bottom;border-bottom:1px solid var(--editorial-margin-soft);overflow-wrap:anywhere;'
      row.appendChild(cell); return cell
    }
    th(modeRow, model.axisLabel).rowSpan = 2
    model.columns.forEach((column, columnIndex) => {
      const cell = th(modeRow, column.label); cell.colSpan = count; cell.style.color = column.color
      if (columnIndex > 0) cell.style.borderLeft = '1px solid var(--editorial-muted)'
      for (const [labelIndex, label] of [territoryName, ...(model.hasComparison ? [GROUPE_COMPARE_LABEL, 'Rang'] : [])].entries()) {
        const cell = th(labelRow, label === GROUPE_COMPARE_LABEL ? 'Groupe' : label)
        cell.style.cssText += ';font:var(--type-figure-legend);font-weight:600;white-space:nowrap;overflow-wrap:normal;padding:4px 2px;'
        if (labelIndex === 0) compactTerritoryHeader(cell, territoryName)
        if (columnIndex > 0 && labelIndex === 0) cell.style.borderLeft = '1px solid var(--editorial-muted)'
        if (label === GROUPE_COMPARE_LABEL) { cell.title = GROUPE_COMPARE_LABEL; cell.append(comparisonReference()) }
      }
    })
    const body = table.createTBody()
    model.records.forEach(record => {
      const row = body.insertRow()
      const cell = value => {
        const td = row.insertCell(); td.textContent = value
        if (row.cells.length > 1) td.dataset.pdfValue = ''
        td.style.cssText = 'padding:4px 2px;border-bottom:1px solid var(--border-default);vertical-align:top;'
        if (row.cells.length > 1) td.style.font = 'var(--type-figure-legend)'
      }
      cell(record.label)
      model.columns.forEach((column, columnIndex) => {
        const value = record.cells.find(value => value.seriesKey === column.key)
        cell(value?.value ?? '—')
        if (columnIndex > 0) row.cells[row.cells.length - 1].style.borderLeft = '1px solid var(--editorial-muted)'
        if (model.hasComparison) { cell(value?.comparison?.value ?? '—'); cell(value?.comparison?.rank ?? '—') }
      })
    })
    tables.append(caption, table)
  }
  return models.map(model => ({
    title: model.caption.innerText.trim(), tableLayout: 'grouped-modes', hasComparison: model.hasComparison,
    selectedModes: model.columns.map(column => column.key), cutCount: model.records.length,
    rows: model.records.flatMap(record => record.cells.map(({ seriesKey, label, value, comparison }) => ({ cut: record.label, seriesKey, label, value, comparison }))),
    equipment: { typequ: explorer.setupState.selectedTypequ, label: explorer.setupState.selectedTypeFigureLabel, horizonMinutes: explorer.setupState.horizonMinutes },
  }))
}
function freezeSvg(element) {
  const clone = element.cloneNode(true)
  const targets = [clone, ...clone.querySelectorAll('*')]
  ;[element, ...element.querySelectorAll('*')].forEach((source, index) => {
    const style = getComputedStyle(source)
    for (const property of ['fill', 'stroke']) {
      const value = style.getPropertyValue(property)
      if (value === 'none') targets[index].setAttribute(property, 'none')
      else {
        const [r, g, b, a] = rgba(value)
        targets[index].setAttribute(property, `rgb(${r},${g},${b})`)
        targets[index].setAttribute(`${property}-opacity`, String(a / 255 * Number(style.getPropertyValue(`${property}-opacity`) || 1)))
      }
    }
    for (const property of ['stroke-width', 'stroke-dasharray', 'stroke-linecap', 'stroke-linejoin', 'opacity']) {
      const value = style.getPropertyValue(property)
      if (value && value !== 'none') targets[index].setAttribute(property, value.replaceAll('px', ''))
    }
    targets[index].removeAttribute('style'); targets[index].removeAttribute('class')
  })
  return clone
}

async function loadFonts(pdf) {
  const manifest = await (await fetch('/prototype-pdf-fonts/manifest.json')).json()
  for (const face of manifest) {
    const bytes = new Uint8Array(await (await fetch(face.url)).arrayBuffer())
    let binary = ''
    for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192))
    pdf.addFileToVFS(`${face.key}.ttf`, btoa(binary))
    pdf.addFont(`${face.key}.ttf`, face.key, 'normal')
  }
  return style => {
    const spec = fontsOf(style)
    const face = manifest.find(face => face.family === spec.family && face.weight === spec.weight && face.style === spec.style)
    if (!face) throw new Error(`Unmapped site font, refusing substitution: ${JSON.stringify(spec)}`)
    return face.key
  }
}

function textRuns(node) {
  const style = getComputedStyle(node.parentElement)
  const measure = document.createElement('canvas').getContext('2d')
  measure.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
  const ascent = measure.measureText('Hg').fontBoundingBoxAscent ?? parseFloat(style.fontSize) * .8
  const range = document.createRange()
  const matrix = style.transform === 'none' ? null : new DOMMatrixReadOnly(style.transform)
  if (matrix && Math.abs(matrix.a) < .001 && matrix.b < -.99) {
    const start = node.data.search(/\S/), end = node.data.trimEnd().length
    if (start < 0) return []
    range.setStart(node, start); range.setEnd(node, end)
    const rect = range.getBoundingClientRect()
    let text = node.data.slice(start, end)
    if (style.textTransform === 'uppercase') text = text.toLocaleUpperCase('fr-FR')
    return [{ x: rect.x + ascent, y: rect.bottom, text, angle: 90 }]
  }
  const runs = []
  for (let index = 0; index < node.length; index++) {
    range.setStart(node, index); range.setEnd(node, index + 1)
    const rect = range.getBoundingClientRect()
    if (rect.width < .01 || rect.height < 1 || node.data[index] === '\n') continue
    // Use the browser's glyph positions, including kerning and word gaps.
    // PDF shaping must not let text drift across adjacent styled/link spans.
    runs.push({ x: rect.x, y: rect.y + ascent, text: node.data[index] })
  }
  return runs.map(run => ({ ...run, text: style.textTransform === 'uppercase' ? run.text.toLocaleUpperCase('fr-FR') : run.text }))
}

async function paint(pdf, element, placement, fontFor, stats) {
  const origin = element.getBoundingClientRect()
  const { x, y, scale } = placement
  const map = rect => ({ x: x + (rect.x - origin.x) * scale, y: y + (rect.y - origin.y) * scale, w: rect.width * scale, h: rect.height * scale })
  const fill = (color, draw) => {
    const [r, g, b, a] = rgba(color)
    if (!a) return
    pdf.saveGraphicsState(); pdf.setGState(new pdf.GState({ opacity: a / 255 }))
    pdf.setFillColor(r, g, b); pdf.setDrawColor(r, g, b); draw(); pdf.restoreGraphicsState()
  }
  async function visit(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      if (!node.textContent.trim()) return
      const style = getComputedStyle(node.parentElement)
      pdf.setFont(fontFor(style), 'normal'); pdf.setFontSize(parseFloat(style.fontSize) * scale)
      const [r, g, b] = rgba(style.color); pdf.setTextColor(r, g, b)
      pdf.setCharSpace((parseFloat(style.letterSpacing) || 0) * scale)
      for (const run of textRuns(node)) {
        pdf.text(run.text, x + (run.x - origin.x) * scale, y + (run.y - origin.y) * scale, run.angle ? { angle: run.angle } : {})
        stats.textRuns++
      }
      pdf.setCharSpace(0)
      return
    }
    if (node.nodeType !== Node.ELEMENT_NODE || !visible(node)) return
    const rect = node.getBoundingClientRect(), box = map(rect), style = getComputedStyle(node)
    if (node instanceof SVGElement) {
      await pdf.svg(freezeSvg(node), { x: box.x, y: box.y, width: box.w, height: box.h })
      stats.svgs++
      return
    }
    const corners = cornerRadii(style, box.w, box.h, scale)
    fill(style.backgroundColor, () => { pdf.path(boxPath(box, corners)).fill() })
    const uniformBorder = corners.some(corner => corner.some(value => value > 0)) && ['Right', 'Bottom', 'Left'].every(edge => style[`border${edge}Width`] === style.borderTopWidth && style[`border${edge}Color`] === style.borderTopColor)
    if (uniformBorder && parseFloat(style.borderTopWidth)) fill(style.borderTopColor, () => {
      pdf.setLineWidth(parseFloat(style.borderTopWidth) * scale)
      pdf.path(boxPath(box, corners)).stroke()
    })
    for (const edge of uniformBorder ? [] : ['Top', 'Right', 'Bottom', 'Left']) {
      const width = parseFloat(style[`border${edge}Width`])
      if (!width || style[`border${edge}Style`] === 'none') continue
      fill(style[`border${edge}Color`], () => {
        pdf.setLineWidth(width * scale)
        pdf.setLineDashPattern(borderPattern(style[`border${edge}Style`], width * scale), 0)
        if (edge === 'Top') pdf.line(box.x, box.y, box.x + box.w, box.y)
        if (edge === 'Bottom') pdf.line(box.x, box.y + box.h, box.x + box.w, box.y + box.h)
        if (edge === 'Left') pdf.line(box.x, box.y, box.x, box.y + box.h)
        if (edge === 'Right') pdf.line(box.x + box.w, box.y, box.x + box.w, box.y + box.h)
      })
    }
    if (node instanceof HTMLImageElement && node.currentSrc) {
      const image = await createImageBitmap(await (await fetch(node.currentSrc)).blob())
      const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height
      const context = canvas.getContext('2d')
      if (getComputedStyle(node.parentElement).borderRadius === '50%') { context.beginPath(); context.arc(canvas.width / 2, canvas.height / 2, canvas.width / 2, 0, Math.PI * 2); context.clip() }
      context.drawImage(image, 0, 0); image.close()
      pdf.addImage(canvas.toDataURL('image/png'), 'PNG', box.x, box.y, box.w, box.h)
      stats.images++
      return
    }
    const clipsChildren = ['hidden', 'clip'].includes(style.overflowX) || ['hidden', 'clip'].includes(style.overflowY)
    if (clipsChildren) {
      pdf.saveGraphicsState()
      pdf.path(boxPath(box, corners))
      pdf.clip(); pdf.discardPath()
    }
    for (const child of node.childNodes) await visit(child)
    if (clipsChildren) pdf.restoreGraphicsState()
    if (node instanceof HTMLAnchorElement && node.href) {
      pdf.link(box.x, box.y, box.w, box.h, node.hasAttribute('data-pdf-footer-reference')
        ? { pageNumber: pdf.internal.getCurrentPageInfo().pageNumber, top: pdf.internal.pageSize.getHeight() - 38 }
        : { url: node.href })
      stats.links++
    }
  }
  await visit(element)
}

export async function exportDesktop({ sectionKey, includeTooltipTables = false, territoryFirst = false, pdfModes, tablesOnSecondPage = false } = {}) {
  if (!ready()) throw new Error('Cahier not ready')
  await document.fonts.ready
  const start = performance.now()
  const root = instances()[0]
  const modeCandidates = [...new Map(instances().filter(instance => instance.type.__name === 'AccessRampFigureCahier'
    && (!sectionKey || instance.vnode.el?.closest?.('.concept-group')?.dataset.section === sectionKey))
    .flatMap(instance => instance.setupState.visibleTimeSeries).map(series => [series.key, { key: series.key, label: series.label }])).values()]
  let exportModes = pdfModes
  if (!exportModes && modeCandidates.length > 3) {
    exportModes = await choosePdfModes(modeCandidates)
    if (!exportModes) return { cancelled: true }
  }
  exportModes ??= modeCandidates.map(mode => mode.key)
  if (modeCandidates.length && (!exportModes.length || exportModes.length > 3 || new Set(exportModes).size !== exportModes.length
    || exportModes.some(key => !modeCandidates.some(mode => mode.key === key)))) throw new Error('Choose one to three currently selected modes for the PDF')
  const content = root.props.content.units[0]
  const selectedSection = sectionKey ? content.sections.find(section => section.key === sectionKey) : null
  if (sectionKey && !selectedSection) throw new Error(`Unknown section: ${sectionKey}`)
  if (includeTooltipTables && !['aedar-access', 'aedar-equipment-explorer'].includes(sectionKey)) throw new Error('Unsupported section for tooltip tables')
  const publicPageUrl = new URL(window.desktopPublicPageUrl)
  if (sectionKey) publicPageUrl.hash = `section-${sectionKey}`
  // Vue flushes are microtasks. Clone the chosen figure state and restore the
  // reader's state before the next paint; no clicks, persistence or API reads.
  const screenModes = [...root.setupState.aedarAccessSelectedModes]
  const changedModes = modeCandidates.length && (exportModes.length !== screenModes.length || !exportModes.every(mode => screenModes.includes(mode)))
  let ui, tooltipTables
  try {
    if (changedModes) root.setupState.aedarAccessSelectedModes = [...exportModes]
    await nextTick()
    ui = prepare(publicPageUrl.href, { territoryFirst })
    tooltipTables = includeTooltipTables ? (sectionKey === 'aedar-access'
      ? appendTimeRampTables(ui, root.props.content.territory.name)
      : appendSandboxTables(ui, root.props.content.territory.name)) : []
  } catch (error) { ui?.clone.remove(); throw error }
  finally {
    if (changedModes) {
      root.setupState.aedarAccessSelectedModes = screenModes
      await nextTick()
    }
  }
  try {
    if (tablesOnSecondPage) {
      ui.chapter.querySelectorAll('[data-pdf-tables]').forEach(tables => {
        const section = tables.closest('.concept-group')
        const continuation = document.createElement('section')
        continuation.className = section.className
        continuation.dataset.section = `${section.dataset.section}-values`
        continuation.dataset.pdfPageBreakBefore = 'true'
        const heading = section.querySelector('.concept-group-heading').cloneNode(true)
        const subtitle = heading.querySelector('h3'); subtitle.textContent += ' — Valeurs'
        continuation.append(heading)
        const identity = section.querySelector('.aedar-equipment-explorer-type-selection')
        if (identity) {
          const copy = identity.cloneNode(true); copy.querySelectorAll('button').forEach(button => button.remove()); continuation.append(copy)
        }
        section.querySelectorAll('.cahier-evidence-source').forEach(source => continuation.append(source.cloneNode(true)))
        tables.querySelectorAll('td, th').forEach(cell => {
          cell.style.padding = '8px 4px'
          cell.style.font = 'var(--type-figure-mode)'
          if (cell.tagName === 'TH') cell.style.fontWeight = '600'
        })
        continuation.append(tables); section.after(continuation)
      })
    }
    const compactLabels = fitTableLabels(ui.chapter)
    placeSectionSources(ui.chapter)
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    const overview = root.props.content.units[0].sections[0].evidence
    const pdf = new jsPDF({ unit: 'pt', format: 'a4', compress: true, putOnlyUsedFonts: true })
    const fontFor = await loadFonts(pdf)
    const sectionBlocks = [...ui.chapter.querySelectorAll('.concept-group')]
    const blocks = sectionKey ? sectionBlocks.filter(block => block.dataset.section === sectionKey || block.dataset.section === `${sectionKey}-values`)
      : [ui.chapter.querySelector('.page-copy'), ...sectionBlocks]
    if (!blocks.length) throw new Error('Requested section has no rendered content')
    const bounds = blocks.map(block => block.getBoundingClientRect())
    const sizes = blocks.map((block, index) => ({ key: block.dataset.section ?? 'introduction', height: bounds[index].height,
      precedingGap: index ? Math.max(0, bounds[index].top - bounds[index - 1].bottom) : 0 }))
    const W = pdf.internal.pageSize.getWidth(), H = pdf.internal.pageSize.getHeight()
    const left = 32, top = 72, bottom = 46, capacity = H - top - bottom
    const desktopWidth = ui.main.getBoundingClientRect().width
    const scale = Math.min((W - 2 * left) / desktopWidth, capacity / Math.max(...sizes.map(size => size.height)))
    const pages = []
    blocks.forEach((block, index) => {
      const height = sizes[index].height * scale
      const gap = sizes[index].precedingGap * scale
      let page = pages.at(-1)
      if (!page || block.dataset.pdfPageBreakBefore || page.used + height + gap > capacity) { page = { used: 0, items: [] }; pages.push(page) }
      if (page.items.length) page.used += gap
      page.items.push({ block, height, offset: page.used, key: sizes[index].key })
      page.used += height
    })
    const p = getComputedStyle(ui.source)
    const paper = p.getPropertyValue('--paper').trim()
    const stats = { textRuns: 0, svgs: 0, images: 0, links: 0 }
    for (let index = 0; index < pages.length; index++) {
      if (index) pdf.addPage()
      const [r, g, b] = rgba(paper); pdf.setFillColor(r, g, b); pdf.rect(0, 0, W, H, 'F')
      const x = (W - desktopWidth * scale) / 2
      await paint(pdf, ui.header, { x, y: 24, scale }, fontFor, stats)
      const y = top + Math.max(0, (capacity - pages[index].used) / 2)
      for (const item of pages[index].items) await paint(pdf, item.block, { x, y: y + item.offset, scale }, fontFor, stats)
      const footerStyle = getComputedStyle(ui.chapter.querySelector('.cahier-evidence-source') ?? ui.chapter.querySelector('p'))
      pdf.setFont(fontFor(footerStyle), 'normal'); pdf.setFontSize(7)
      pdf.setTextColor(...rgba(p.getPropertyValue('--muted')).slice(0, 3))
      const showsComparisonContext = pages[index].items.some(item => [...item.block.querySelectorAll('[data-pdf-footer-reference]')].some(visible))
      pages[index].showsComparisonContext = showsComparisonContext
      if (showsComparisonContext) pdf.text(`${COMPARISON_MARK} ${GROUPE_COMPARE_LABEL} : ${overview.comparisonLabel}`, left, H - 35)
      const invitation = `${FOOTER_INVITATION} ${publicPageUrl.hostname}`
      pdf.text(invitation, left, H - 23)
      pdf.link(left, H - 31, pdf.getTextWidth(invitation), 11, { url: new URL('/', publicPageUrl).href })
      pdf.text(`${index + 1} / ${pages.length}`, W - left, H - 24, { align: 'right' })
    }
    pdf.setProperties({ title: `${root.props.content.territory.name} — ${content.label}${selectedSection ? ` — ${selectedSection.label}` : ''}`, subject: overview.comparisonLabel, author: 'Lusk · desktop PDF prototype' })
    const blob = pdf.output('blob')
    const link = document.createElement('a'); const url = URL.createObjectURL(blob)
    link.href = url; link.download = sectionKey ? `cahier-${root.props.content.territory.code}-${sectionKey}.pdf` : 'rennes-desktop-epci.pdf'; link.click()
    setTimeout(() => URL.revokeObjectURL(url), 30000)
    return { bytes: blob.size, totalMs: performance.now() - start, ...stats, scale,
      desktopWidth, pageContentHeight: capacity, removedInactiveControls: ui.removed,
      pages: pages.map(page => ({ occupiedHeight: page.used, centeringInset: Math.max(0, (capacity - page.used) / 2), sections: page.items.map(item => item.key), showsComparisonContext: page.showsComparisonContext })),
      sectionSizes: sizes, url: publicPageUrl.href, sectionKey: sectionKey ?? null, sectionLabel: selectedSection?.label ?? null, tooltipTables, territoryFirst,
      exportModes, screenModes, compactLabels, tablesOnSecondPage }
  } finally { ui.clone.remove() }
}
