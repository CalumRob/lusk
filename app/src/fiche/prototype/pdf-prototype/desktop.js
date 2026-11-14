// THROWAWAY narrow DOM paint adapter, NOT a general HTML-to-PDF renderer.
// Browser does layout. Existing DOM supplies text, styles, geometry, SVGs and
// images. No separate chapter template, copied facts or independently drawn waffle.
import { jsPDF } from 'jspdf'
import 'svg2pdf.js'
import { instances, ready } from './rennes'
import { cornerRadii, borderPattern, boxPath } from './paintGeometry'
import { GROUPE_COMPARE_LABEL } from '@/fiche/content/comparisonWording'

const COMPARISON_MARK = '¹'
const FOOTER_INVITATION = 'Retrouvez les cartes et explorez les données sur'

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
function prepare(publicPageUrl) {
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
  const textWalker = document.createTreeWalker(chapter, NodeFilter.SHOW_TEXT)
  const comparisonLabels = []
  while (textWalker.nextNode()) {
    const node = textWalker.currentNode
    if (node.parentElement.closest('.cahier-figure-legend-label, .cahier-comparison-value__reference') && node.data.includes(GROUPE_COMPARE_LABEL)) comparisonLabels.push(node)
  }
  comparisonLabels.forEach(node => {
    const tail = node.splitText(node.data.indexOf(GROUPE_COMPARE_LABEL) + GROUPE_COMPARE_LABEL.length)
    const reference = document.createElement('a')
    reference.href = '#pdf-comparison-context'
    reference.dataset.pdfFooterReference = ''
    reference.style.cssText = 'font:inherit;color:inherit;text-decoration:none;'
    reference.textContent = COMPARISON_MARK
    node.parentNode.insertBefore(document.createTextNode(' '), tail)
    node.parentNode.insertBefore(reference, tail)
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
  const main = chapter.querySelector('.page-main')
  header.style.width = `${main.getBoundingClientRect().width}px`
  header.style.borderBottom = getComputedStyle(originalChapter.querySelector('.page-heading')).borderBottom
  main.appendChild(header)
  return { source, clone, chapter, main, header, removed }
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

export async function exportDesktop({ sectionKey } = {}) {
  if (!ready()) throw new Error('Cahier not ready')
  await document.fonts.ready
  const start = performance.now()
  const root = instances()[0]
  const content = root.props.content.units[0]
  const selectedSection = sectionKey ? content.sections.find(section => section.key === sectionKey) : null
  if (sectionKey && !selectedSection) throw new Error(`Unknown section: ${sectionKey}`)
  const publicPageUrl = new URL(window.desktopPublicPageUrl)
  if (sectionKey) publicPageUrl.hash = `section-${sectionKey}`
  const ui = prepare(publicPageUrl.href)
  try {
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    const overview = root.props.content.units[0].sections[0].evidence
    const pdf = new jsPDF({ unit: 'pt', format: 'a4', compress: true, putOnlyUsedFonts: true })
    const fontFor = await loadFonts(pdf)
    const sectionBlocks = [...ui.chapter.querySelectorAll('.concept-group')]
    const blocks = sectionKey ? sectionBlocks.filter(block => block.dataset.section === sectionKey)
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
      if (!page || page.used + height + gap > capacity) { page = { used: 0, items: [] }; pages.push(page) }
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
      const y = top + (capacity - pages[index].used) / 2
      for (const item of pages[index].items) await paint(pdf, item.block, { x, y: y + item.offset, scale }, fontFor, stats)
      const footerStyle = getComputedStyle(ui.chapter.querySelector('.cahier-evidence-source') ?? ui.chapter.querySelector('p'))
      pdf.setFont(fontFor(footerStyle), 'normal'); pdf.setFontSize(7)
      pdf.setTextColor(...rgba(p.getPropertyValue('--muted')).slice(0, 3))
      pdf.text(`${COMPARISON_MARK} ${GROUPE_COMPARE_LABEL} : ${overview.comparisonLabel}`, left, H - 35)
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
      pages: pages.map(page => ({ occupiedHeight: page.used, centeringInset: (capacity - page.used) / 2, sections: page.items.map(item => item.key) })),
      sectionSizes: sizes, url: publicPageUrl.href, sectionKey: sectionKey ?? null, sectionLabel: selectedSection?.label ?? null }
  } finally { ui.clone.remove() }
}
