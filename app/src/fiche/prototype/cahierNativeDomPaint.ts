import type { jsPDF } from 'jspdf'
import { POLICES_PDF } from './cahierPdfFonts'

/** Paint the browser-resolved boxes. The section, not this adapter, lays them out. */
export async function paintCahierNativeDom(doc: jsPDF, roots: HTMLElement | readonly HTMLElement[],
  placement: { x: number; y: number; scale: number }, signal: AbortSignal): Promise<void> {
  const list = Array.isArray(roots) ? [...roots] : [roots as HTMLElement]
  if (!list.length) return
  const boxes = list.map((root) => root.getBoundingClientRect())
  const origin = {
    x: Math.min(...boxes.map((r) => r.x)),
    y: Math.min(...boxes.map((r) => r.y)),
  }
  const { x, y, scale } = placement
  const box = (r: DOMRect) => ({ x: x + (r.x - origin.x) * scale, y: y + (r.y - origin.y) * scale, w: r.width * scale, h: r.height * scale })
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 1
  const measure = canvas.getContext('2d', { willReadFrequently: true })!
  const range = document.createRange()
  const rgba = (value: string): [number, number, number, number] => {
    measure.clearRect(0, 0, 1, 1)
    measure.fillStyle = 'transparent'
    measure.fillStyle = value
    measure.fillRect(0, 0, 1, 1)
    const pixel = measure.getImageData(0, 0, 1, 1).data
    return [pixel[0]!, pixel[1]!, pixel[2]!, pixel[3]!]
  }
  /** Nearest embedded static instance of the screen's variable face. */
  function facePour(style: CSSStyleDeclaration) {
    const family = style.fontFamily.split(',')[0]?.replace(/["']/g, '').trim().replace(/ Variable$/, '')
    const weight = Number(style.fontWeight)
    const withinStyle = POLICES_PDF.filter((face) => face.family === family && face.style === style.fontStyle)
    const candidates = withinStyle.length ? withinStyle : POLICES_PDF.filter((face) => face.family === family)
    const face = candidates.length
      ? candidates.reduce((best, candidate) => Math.abs(candidate.weight - weight) < Math.abs(best.weight - weight) ? candidate : best)
      : undefined
    if (!face) throw Error(`Police native non prise en charge : ${style.fontFamily} ${style.fontWeight} ${style.fontStyle}`)
    return face
  }
  function fill(color: string, draw: () => void) {
    const [r, g, b, a] = rgba(color)
    if (!a) return
    doc.saveGraphicsState()
    doc.setGState(doc.GState({ opacity: a / 255, 'stroke-opacity': a / 255 }))
    doc.setFillColor(r, g, b).setDrawColor(r, g, b)
    draw()
    doc.restoreGraphicsState()
  }
  function path(b: ReturnType<typeof box>, style: CSSStyleDeclaration) {
    const radii = [style.borderTopLeftRadius, style.borderTopRightRadius, style.borderBottomRightRadius, style.borderBottomLeftRadius]
    if (radii.every((r) => r === '50%')) return doc.ellipse(b.x + b.w / 2, b.y + b.h / 2, b.w / 2, b.h / 2, null)
    const radius = parseFloat(radii[0]!) * scale
    return radius > 0 ? doc.roundedRect(b.x, b.y, b.w, b.h, radius, radius, null) : doc.rect(b.x, b.y, b.w, b.h, null)
  }
  async function visit(node: Node, parentStyle?: CSSStyleDeclaration): Promise<void> {
    signal.throwIfAborted()
    if (node instanceof Text && node.data.trim() && parentStyle) {
      const s = parentStyle
      // A rotated axis title has a non-identity CSS transform on its element.
      // Painting its glyphs one by one from unrotated Range boxes produces a
      // vertical column of characters; emit one rotated run instead.
      if (s.transform && s.transform !== 'none') {
        const matrix = new DOMMatrixReadOnly(s.transform)
        const cssAngle = Math.atan2(matrix.b, matrix.a) * 180 / Math.PI
        if (Math.abs(cssAngle) > 1 && node.parentElement) {
          const text = s.textTransform === 'uppercase' ? node.data.toLocaleUpperCase('fr-FR') : node.data
          // `getBoundingClientRect()` already includes the browser's full
          // transform (rotation about transform-origin plus the translate). Use
          // that mounted screen box directly — it sits in the figure's native
          // left gutter beside the SVG ticks. Do not re-anchor to other boxes.
          const titleRect = node.parentElement.getBoundingClientRect()
          const pos = box({
            x: titleRect.x + titleRect.width / 2,
            y: titleRect.y + titleRect.height / 2,
            width: 0, height: 0,
          } as DOMRect)
          const face = facePour(s)
          const [r, g, b] = rgba(s.color)
          doc.setFont(face.id, 'normal').setFontSize(parseFloat(s.fontSize) * scale * doc.internal.scaleFactor).setTextColor(r, g, b)
          // jsPDF's `align:'center'` on a rotated run shifts the anchor by half
          // the unrotated text width, which threw the title into the margin.
          // Draw from the run's start and offset y by half its measured length
          // so the visual line is centred on the native box's centre.
          const runLength = doc.getTextWidth(text)
          doc.text(text, pos.x, pos.y + runLength / 2, { angle: -cssAngle, baseline: 'middle' })
          return
        }
      }
      const face = facePour(s)
      measure.font = `${s.fontStyle} ${s.fontWeight} ${s.fontSize} ${s.fontFamily}`
      const ascent = measure.measureText('Hg').fontBoundingBoxAscent
      const [r, g, b] = rgba(s.color)
      doc.setFont(face.id, 'normal').setFontSize(parseFloat(s.fontSize) * scale * doc.internal.scaleFactor).setTextColor(r, g, b)
      let i = 0
      for (const char of node.data) {
        range.setStart(node, i)
        i += char.length
        range.setEnd(node, i)
        const rect = range.getBoundingClientRect()
        if (rect.width < .01 || rect.height < 1 || /[\n\r]/.test(char)) continue
        const pos = box(rect)
        doc.text(s.textTransform === 'uppercase' ? char.toLocaleUpperCase('fr-FR') : char, pos.x, pos.y + ascent * scale)
      }
      return
    }
    if (!(node instanceof Element)) return
    const style = getComputedStyle(node)
    if (style.display === 'none' || style.visibility === 'hidden' || +style.opacity === 0 || style.clipPath === 'inset(50%)') return
    const b = box(node.getBoundingClientRect())
    // Native legend swatches are CSS boxes: a dashed `border-top` on a
    // zero-height `<i>` (peer/comparison) or a small filled square/dot. The
    // dashed mark is thinner than the generic size floor, so handle it before
    // that guard; a one-sided border must be drawn explicitly (the generic
    // path only handles four equal borders).
    if (node instanceof HTMLElement && node.classList.contains('cahier-figure-legend-mark')) {
      const dashed = style.borderTopStyle === 'dashed' && parseFloat(style.borderTopWidth) > 0
      const tall = style.borderInlineStartStyle === 'solid' && parseFloat(style.borderInlineStartWidth) > 0
      if (dashed || tall) {
        const color = dashed ? style.borderTopColor : style.borderInlineStartColor
        const width = parseFloat(dashed ? style.borderTopWidth : style.borderInlineStartWidth) * scale
        fill(color, () => {
          doc.setLineWidth(width)
          if (dashed) (doc as any).setLineDashPattern([width * 2, width * 1.4], 0)
          if (dashed) doc.line(b.x, b.y + b.h / 2, b.x + b.w, b.y + b.h / 2)
          else doc.line(b.x + b.w / 2, b.y, b.x + b.w / 2, b.y + b.h)
          if (dashed) (doc as any).setLineDashPattern([], 0)
        })
        return
      }
      fill(style.backgroundColor, () => path(b, style).fill())
      return
    }
    if (b.w < .5 || b.h < .5) return
    if (node instanceof SVGSVGElement) {
      const svg = node.cloneNode(true) as SVGSVGElement
      const targets = [svg, ...svg.querySelectorAll('*')]
      ;[node, ...node.querySelectorAll('*')].forEach((source, i) => {
        const resolved = getComputedStyle(source), target = targets[i]!
        target.removeAttribute('style'); target.removeAttribute('class')
        for (const prop of ['fill', 'stroke']) {
          const value = resolved.getPropertyValue(prop)
          const [r, g, b, alpha] = rgba(value)
          if (value === 'none') {
            target.setAttribute(prop, 'none')
            // A "none" paint must not emit a zero alpha: svg2pdf carries the
            // last stroke-alpha state forward, which made later series paths
            // invisible even though their own colour was correct.
            target.removeAttribute(`${prop}-opacity`)
            continue
          }
          target.setAttribute(prop, `rgb(${r},${g},${b})`)
          const opacity = alpha / 255 * Number(resolved.getPropertyValue(`${prop}-opacity`))
          if (opacity < 1) target.setAttribute(`${prop}-opacity`, String(opacity))
          else target.removeAttribute(`${prop}-opacity`)
        }
        for (const prop of ['stroke-width', 'stroke-dasharray', 'stroke-linecap', 'stroke-linejoin', 'opacity']) {
          const value = resolved.getPropertyValue(prop)
          if (value) target.setAttribute(prop, value.replaceAll('px', ''))
        }
      })
      await doc.svg(svg, { x: b.x, y: b.y, width: b.w, height: b.h })
      return
    }
    if (style.backgroundImage !== 'none') {
      // Gradient fills carry real ink. jsPDF has no gradient primitive here:
      // paint the first resolved colour stop (or fail loudly if none exists)
      // instead of silently dropping the background.
      const firstColor = /rgba?\([^)]+\)/.exec(style.backgroundImage)?.[0]
      if (firstColor) fill(firstColor, () => doc.rect(b.x, b.y, b.w, b.h, 'F'))
      else throw Error(`Paint source non prise en charge : ${style.backgroundImage.slice(0, 60)}`)
    }
    fill(style.backgroundColor, () => path(b, style).fill())
    // Generated content is real ink on screen: paint its box rather than
    // silently dropping the mark (legend ticks, separators, badges).
    for (const pseudo of ['::before', '::after'] as const) {
      const generated = getComputedStyle(node, pseudo)
      const content = generated.content
      if (!content || content === 'none' || content === 'normal') continue
      fill(generated.backgroundColor, () => {
        const insetX = parseFloat(generated.left ?? '0') || 0
        const insetY = parseFloat(generated.top ?? '0') || 0
        const width = parseFloat(generated.width) || b.w
        const height = parseFloat(generated.height) || b.h
        doc.rect(b.x + insetX, b.y + insetY, Math.min(width, b.w), Math.min(height, b.h), 'F')
      })
    }
    if (node instanceof HTMLImageElement) {
      if (!node.complete || !node.naturalWidth || style.objectFit !== 'cover' || style.objectPosition !== '50% 50%') throw Error('Image native non prête ou cadrage non pris en charge.')
      const image = document.createElement('canvas')
      image.width = node.naturalWidth
      image.height = node.naturalHeight
      image.getContext('2d')!.drawImage(node, 0, 0)
      const fit = Math.max(b.w / image.width, b.h / image.height), w = image.width * fit, h = image.height * fit
      doc.saveGraphicsState()
      path(b, style).clip().discardPath()
      doc.addImage(image.toDataURL('image/png'), 'PNG', b.x + (b.w - w) / 2, b.y + (b.h - h) / 2, w, h)
      doc.restoreGraphicsState()
      return
    }
    if (['hidden', 'clip'].some((v) => v === style.overflowX || v === style.overflowY)) {
      doc.saveGraphicsState()
      path(b, style).clip().discardPath()
      for (const child of node.childNodes) await visit(child, style)
      doc.restoreGraphicsState()
    } else for (const child of node.childNodes) await visit(child, style)
    if (node instanceof HTMLAnchorElement && /^https?:/.test(node.href)) doc.link(b.x, b.y, b.w, b.h, { url: node.href })
    if (parseFloat(style.borderTopWidth) && style.borderTopWidth === style.borderRightWidth
      && style.borderTopWidth === style.borderBottomWidth && style.borderTopWidth === style.borderLeftWidth) {
      fill(style.borderTopColor, () => { doc.setLineWidth(parseFloat(style.borderTopWidth) * scale); path(b, style).stroke() })
    }
  }
  for (const root of list) await visit(root)
}
