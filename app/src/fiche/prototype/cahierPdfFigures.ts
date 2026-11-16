/**
 * Native-family figure primitives for the shared Cahier PDF (#1024).
 *
 * Each drawing consumes the frozen #1022 projection (and, for the bars, the
 * frozen native `MobiliteBarsFigureEvidence` it projects) — never a screen
 * component, the DOM, an acquisition or a recomputed fact. Geometry and text
 * are redrawn in the same desktop grammar: mode colours, axes, ticks, legends,
 * ranks and the figure's own titles. SVG carries vector marks; jsPDF carries
 * selectable text and links.
 */
import type { jsPDF } from 'jspdf'

import type { CahierFigureProjection } from './cahierExportAdapters'
import type {
  CahierBarsProjection,
  CahierCurveProjection,
  CahierExplorerProjection,
  CahierMapsFigureProjection,
  CahierMapsProjection,
  CahierOverviewProjection,
  CahierProfileProjection,
  CahierRampsProjection,
  CahierShareProjection,
} from './cahierExportAdapters'
import type { CahierCaptureFigure } from './cahierExportCapture'
import type { MesureTexte } from './cahierPdfMesure'
import { plierTexte } from './cahierPdfMesure'
import { COULEURS_MODES_PDF, COULEURS_TONS_PDF, PALETTE_PDF, couleurPdf, hexVersRgb } from './cahierPdfPalette'
import { POLICE_PDF } from './cahierPdfFonts'

export interface ImagePdf {
  readonly dataUrl: string
  readonly width: number
  readonly height: number
}

export type ChargeurImagePdf = (
  url: string,
  options: { readonly signal: AbortSignal },
) => Promise<ImagePdf>

export interface OptionsFigurePdf {
  readonly doc: jsPDF
  readonly mesure: MesureTexte
  readonly x: number
  readonly y: number
  readonly width: number
  readonly signal: AbortSignal
  readonly chargerImage: ChargeurImagePdf
  /** Native bars model for a `mobilite-bars` projection, from the same capture. */
  readonly modeleBars?: Extract<CahierCaptureFigure, { family: 'mobilite-bars' }>['model']['figure']
  /** Owner-observed served comparative proof for this figure (not mere capability). */
  readonly comparisonProof?: boolean
  /** Used by tests/offline SSR; production loads the actual inline asset. */
  readonly carteFallback?: ImagePdf | null
}

const TAILLE = {
  titre: 8.5,
  sousTitre: 7,
  axe: 6,
  tick: 5.6,
  legende: 6.4,
  valeur: 14,
  valeurPetite: 11,
  note: 6.2,
} as const

function rgb(value: string): [number, number, number] {
  return hexVersRgb(value)
}

function setFill(doc: jsPDF, value: string, opacity = 1): void {
  const [r, g, b] = rgb(value)
  doc.setFillColor(r, g, b)
  if (opacity < 1) appliquerOpacite(doc, opacity)
}

function setStroke(doc: jsPDF, value: string, opacity = 1): void {
  const [r, g, b] = rgb(value)
  doc.setDrawColor(r, g, b)
  if (opacity < 1) appliquerOpacite(doc, opacity)
}

function appliquerOpacite(doc: jsPDF, opacity: number): void {
  const withGState = doc as jsPDF & { GState: new (options: { opacity: number }) => unknown }
  doc.setGState(new withGState.GState({ opacity }) as never)
}

function resetOpacity(doc: jsPDF): void {
  appliquerOpacite(doc, 1)
}

interface OptionsTexte {
  readonly police: string
  readonly taille: number
  readonly couleur: string
  readonly align?: 'left' | 'center' | 'right'
  readonly baseline?: 'top' | 'middle' | 'alphabetic'
  readonly espacement?: number
  readonly opacite?: number
}

export function textePdf(
  doc: jsPDF,
  texte: string,
  x: number,
  y: number,
  options: OptionsTexte,
): void {
  doc.setFont(options.police, 'normal')
  doc.setFontSize(options.taille)
  const [r, g, b] = rgb(options.couleur)
  doc.setTextColor(r, g, b)
  doc.setCharSpace(options.espacement ?? 0)
  if (options.opacite !== undefined) doc.setGState(doc.GState({ opacity: options.opacite }))
  doc.text(texte, x, y, {
    align: options.align ?? 'left',
    baseline: options.baseline ?? 'top',
  })
  doc.setCharSpace(0)
  if (options.opacite !== undefined) resetOpacity(doc)
}

export function hauteurTexte(
  texte: string,
  mesure: MesureTexte,
  police: string,
  taille: number,
  largeur: number,
  espacement = 0,
): number {
  const lignes = plierTexte(texte, mesure, { police, taillePt: taille, largeurMax: largeur, espacementPt: espacement })
  return lignes.length * mesure.hauteurLigne(police, taille) * 1.18
}

function dessinerTextePlie(
  doc: jsPDF,
  mesure: MesureTexte,
  texte: string,
  x: number,
  y: number,
  largeur: number,
  options: OptionsTexte,
): number {
  const reelles = plierTexte(texte, mesure, {
    police: options.police,
    taillePt: options.taille,
    largeurMax: largeur,
    espacementPt: options.espacement,
  })
  let cy = y
  const hauteur = mesure.hauteurLigne(options.police, options.taille) * 1.18
  const xLigne = options.align === 'center'
    ? x + largeur / 2
    : options.align === 'right'
      ? x + largeur
      : x
  for (const ligne of reelles) {
    textePdf(doc, ligne.texte, xLigne, cy, options)
    cy += hauteur
  }
  return cy - y
}

function svgCanvas(width: number, height: number): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`)
  svg.setAttribute('width', String(width))
  svg.setAttribute('height', String(height))
  return svg
}

function svgRect(
  svg: SVGSVGElement,
  x: number,
  y: number,
  width: number,
  height: number,
  fill: string,
  opacity = 1,
): void {
  const node = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
  node.setAttribute('x', String(x))
  node.setAttribute('y', String(y))
  node.setAttribute('width', String(Math.max(0, width)))
  node.setAttribute('height', String(Math.max(0, height)))
  node.setAttribute('fill', fill)
  if (opacity < 1) node.setAttribute('fill-opacity', String(opacity))
  svg.append(node)
}

function svgLine(
  svg: SVGSVGElement,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  stroke: string,
  width = 0.6,
  dash?: string,
  opacity = 1,
): void {
  const node = document.createElementNS('http://www.w3.org/2000/svg', 'line')
  node.setAttribute('x1', String(x1))
  node.setAttribute('y1', String(y1))
  node.setAttribute('x2', String(x2))
  node.setAttribute('y2', String(y2))
  node.setAttribute('stroke', stroke)
  node.setAttribute('stroke-width', String(width))
  node.setAttribute('stroke-linecap', 'round')
  if (dash) node.setAttribute('stroke-dasharray', dash)
  if (opacity < 1) node.setAttribute('stroke-opacity', String(opacity))
  svg.append(node)
}

function svgCircle(
  svg: SVGSVGElement,
  cx: number,
  cy: number,
  r: number,
  fill: string,
): void {
  const node = document.createElementNS('http://www.w3.org/2000/svg', 'circle')
  node.setAttribute('cx', String(cx))
  node.setAttribute('cy', String(cy))
  node.setAttribute('r', String(r))
  node.setAttribute('fill', fill)
  svg.append(node)
}

async function poserSvg(
  doc: jsPDF,
  svg: SVGSVGElement,
  x: number,
  y: number,
  width: number,
  height: number,
): Promise<void> {
  const paint = doc as jsPDF & {
    svg: (element: Element, options: {
      x: number
      y: number
      width: number
      height: number
    }) => Promise<unknown>
  }
  await paint.svg(svg, { x, y, width, height })
}

function formatsTitre(
  projection: CahierFigureProjection,
  width: number,
  mesure: MesureTexte,
): readonly string[] {
  const lignes = plierTexte(projection.title, mesure, {
    police: POLICE_PDF.bodyStrong,
    taillePt: TAILLE.titre,
    largeurMax: width,
  })
  return lignes.map((ligne) => ligne.texte)
}

function dessinerTitre(
  doc: jsPDF,
  mesure: MesureTexte,
  projection: CahierFigureProjection,
  x: number,
  width: number,
  y: number,
): number {
  const lignes = formatsTitre(projection, width, mesure)
  const hauteur = mesure.hauteurLigne(POLICE_PDF.bodyStrong, TAILLE.titre) * 1.18
  let cy = y
  for (const ligne of lignes) {
    textePdf(doc, ligne, x + width / 2, cy, {
      police: POLICE_PDF.bodyStrong,
      taille: TAILLE.titre,
      couleur: PALETTE_PDF.ink,
      align: 'center',
    })
    cy += hauteur
  }
  return cy - y
}

function legendeLigne(
  doc: jsPDF,
  mesure: MesureTexte,
  elements: readonly { label: string; color: string; dash?: boolean }[],
  x: number,
  y: number,
  width: number,
): number {
  const hauteur = mesure.hauteurLigne(POLICE_PDF.body, TAILLE.legende) * 1.3
  let cx = x
  let cy = y
  for (const element of elements) {
    const labelWidth = mesure.largeur(element.label, POLICE_PDF.body, TAILLE.legende) + 7
    if (cx > x && cx + labelWidth > x + width) {
      cx = x
      cy += hauteur
    }
    if (element.dash) {
      doc.setLineDashPattern([1, 1], 0)
      setStroke(doc, element.color)
      doc.setLineWidth(0.25)
      doc.line(cx, cy + hauteur * 0.45, cx + 4.5, cy + hauteur * 0.45)
      doc.setLineDashPattern([], 0)
    } else {
      setFill(doc, element.color)
      doc.rect(cx, cy + hauteur * 0.28, 4.5, 1.4, 'F')
    }
    textePdf(doc, element.label, cx + 5.6, cy + hauteur * 0.04, {
      police: POLICE_PDF.body,
      taille: TAILLE.legende,
      couleur: PALETTE_PDF.ink,
    })
    cx += labelWidth
    resetOpacity(doc)
  }
  return cy + hauteur - y
}

function bornesValeurs(values: readonly (number | null)[]): { min: number; max: number } {
  const finis = values.filter((value): value is number => value !== null && Number.isFinite(value))
  if (!finis.length) return { min: 0, max: 1 }
  const max = Math.max(...finis)
  const min = Math.min(0, ...finis)
  return { min, max: max === min ? min + 1 : max }
}

function graduation(values: readonly (number | null)[], count = 4): number[] {
  const { min, max } = bornesValeurs(values)
  const ticks: number[] = []
  for (let index = 0; index <= count; index += 1) {
    ticks.push(min + ((max - min) * index) / count)
  }
  return ticks
}

function formatTick(value: number): string {
  const absolu = Math.abs(value)
  if (absolu >= 1000) return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(value)
  if (absolu >= 10) return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(value)
  if (absolu >= 1) return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 }).format(value)
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(value)
}

async function dessinerRampes(
  options: OptionsFigurePdf,
  projection: CahierRampsProjection,
): Promise<number> {
  const { doc, x, y, width } = options
  let cy = y
  const nombre = Math.max(1, projection.ramps.length)
  const gap = 6
  const panelWidth = (width - gap * (nombre - 1)) / nombre
  const plotHeight = 43
  const tousPoints = projection.ramps.flatMap((ramp) => ramp.series.flatMap((serie) =>
    serie.points.flatMap((point) => [point.value, point.referenceValue])))
  const ticks = graduation(tousPoints, 3)
  const yMin = Math.min(...ticks)
  const yMax = Math.max(...ticks)
  const panelTop = cy
  let basPanneau = cy
  for (let index = 0; index < projection.ramps.length; index += 1) {
    const ramp = projection.ramps[index]!
    const px = x + index * (panelWidth + gap)
    // Panel title (native ramp title), wrapping without shrinking.
    let py = panelTop
    py += dessinerTextePlie(doc, options.mesure, ramp.title, px, py, panelWidth, {
      police: POLICE_PDF.bodyMedium,
      taille: TAILLE.sousTitre,
      couleur: PALETTE_PDF.ink,
      align: 'center',
    })
    const plotX = px + 9
    const plotW = panelWidth - 10
    const plotY = py + 3
    const svg = svgCanvas(plotW, plotHeight)
    // Grid + axes.
    for (const tick of ticks) {
      const gy = plotHeight - ((tick - yMin) / (yMax - yMin)) * (plotHeight - 4)
      svgLine(svg, 0, gy, plotW, gy, PALETTE_PDF.border, 0.2)
      textePdf(doc, formatTick(tick), plotX - 1.5, plotY + gy - 2, {
        police: POLICE_PDF.meta,
        taille: TAILLE.tick,
        couleur: PALETTE_PDF.muted,
        align: 'right',
      })
    }
    svgLine(svg, 0, plotHeight - 4, plotW, plotHeight - 4, PALETTE_PDF.ink, 0.35)
    const xValues = ramp.series[0]?.points.map((point) => point.cutKey) ?? []
    const xMin = Math.min(...xValues)
    const xMax = Math.max(...xValues)
    const toX = (value: number) => xMax === xMin ? plotW / 2 : ((value - xMin) / (xMax - xMin)) * (plotW - 2)
    const toY = (value: number) => plotHeight - 4 - ((value - yMin) / (yMax - yMin)) * (plotHeight - 4)
    for (const serie of ramp.series) {
      const color = couleurPdf(COULEURS_MODES_PDF[serie.key] ?? PALETTE_PDF.ink)
      const focal = serie.points.filter((point) => point.value !== null)
      for (let i = 1; i < focal.length; i += 1) {
        svgLine(svg, toX(focal[i - 1]!.cutKey), toY(focal[i - 1]!.value!), toX(focal[i]!.cutKey), toY(focal[i]!.value!), color, 0.55)
      }
      for (const point of focal) svgCircle(svg, toX(point.cutKey), toY(point.value!), 0.9, color)
      const reference = serie.points.filter((point) => point.referenceValue !== null)
      if (reference.length) {
        for (let i = 1; i < reference.length; i += 1) {
          svgLine(svg, toX(reference[i - 1]!.cutKey), toY(reference[i - 1]!.referenceValue!), toX(reference[i]!.cutKey), toY(reference[i]!.referenceValue!), color, 0.5, '2 1.2', 0.55)
        }
      }
    }
    await poserSvg(doc, svg, plotX, plotY, plotW, plotHeight)
    // X tick labels, all cuts.
    const labels = ramp.series[0]?.points.map((point) => point.cutLabel) ?? []
    const pas = Math.max(1, Math.ceil((labels.length * 1) / Math.max(1, Math.floor(plotW / 9))))
    for (let i = 0; i < labels.length; i += pas) {
      const point = ramp.series[0]!.points[i]!
      textePdf(doc, labels[i]!, plotX + toX(point.cutKey), plotY + plotHeight + 1, {
        police: POLICE_PDF.body,
        taille: TAILLE.tick,
        couleur: PALETTE_PDF.muted,
        align: 'center',
      })
    }
    textePdf(doc, ramp.xAxis.label, plotX + plotW / 2, plotY + plotHeight + 5.5, {
      police: POLICE_PDF.body,
      taille: TAILLE.axe,
      couleur: PALETTE_PDF.muted,
      align: 'center',
    })
    doc.saveGraphicsState()
    doc.setFont(POLICE_PDF.body, 'normal')
    doc.setFontSize(TAILLE.axe)
    doc.setTextColor(...rgb(PALETTE_PDF.muted))
    doc.text(ramp.yAxis.label, plotX - 5.5, plotY + plotHeight / 2, { angle: 90, align: 'center' })
    doc.restoreGraphicsState()
    const legend = [
      ...ramp.series.map((serie) => ({
        label: serie.label,
        color: couleurPdf(COULEURS_MODES_PDF[serie.key] ?? PALETTE_PDF.ink),
      })),
      ...(options.comparisonProof
        ? [{ label: 'Groupe comparé', color: PALETTE_PDF.muted, dash: true }]
        : []),
    ]
    const bas = plotY + plotHeight + 8 + legendeLigne(doc, options.mesure, legend, px, plotY + plotHeight + 8, panelWidth)
    basPanneau = Math.max(basPanneau, bas)
  }
  return basPanneau - y
}

function couleurSerie(color: string, fallback: string = PALETTE_PDF.ink): string {
  try {
    return couleurPdf(color)
  } catch {
    return fallback
  }
}

async function dessinerBarresGroupees(
  options: OptionsFigurePdf,
  projection: CahierExplorerProjection,
): Promise<number> {
  const { doc, x, y, width } = options
  let cy = y
  const gap = 6
  const panelWidth = (width - gap) / 2
  const plotHeight = 42
  // Volume ramp
  let leftY = cy
  leftY += dessinerTextePlie(doc, options.mesure, projection.volume.title, x, leftY, panelWidth, {
    police: POLICE_PDF.bodyMedium,
    taille: TAILLE.sousTitre,
    couleur: PALETTE_PDF.ink,
    align: 'center',
  })
  const rampX = x + 8
  const rampW = panelWidth - 8
  const rampY = leftY + 2
  const toutesRampes = projection.volume.series.flatMap((serie) =>
    serie.points.flatMap((point) => [point.value, point.referenceValue]))
  const rampTicks = graduation(toutesRampes, 3)
  const rampMin = Math.min(...rampTicks)
  const rampMax = Math.max(...rampTicks)
  const rampeSvg = svgCanvas(rampW, plotHeight)
  for (const tick of rampTicks) {
    const gy = plotHeight - 4 - ((tick - rampMin) / (rampMax - rampMin)) * (plotHeight - 4)
    svgLine(rampeSvg, 0, gy, rampW, gy, PALETTE_PDF.border, 0.2)
    textePdf(doc, formatTick(tick), rampX - 1.5, rampY + gy - 2, {
      police: POLICE_PDF.meta,
      taille: TAILLE.tick,
      couleur: PALETTE_PDF.muted,
      align: 'right',
    })
  }
  svgLine(rampeSvg, 0, plotHeight - 4, rampW, plotHeight - 4, PALETTE_PDF.ink, 0.35)
  const cuts = projection.volume.series[0]?.points ?? []
  const xMin = Math.min(...cuts.map((point) => point.cutKey))
  const xMax = Math.max(...cuts.map((point) => point.cutKey))
  const toX = (value: number) => xMax === xMin ? rampW / 2 : ((value - xMin) / (xMax - xMin)) * (rampW - 2)
  const toY = (value: number) => plotHeight - 4 - ((value - rampMin) / (rampMax - rampMin)) * (plotHeight - 4)
  for (const serie of projection.volume.series) {
    const color = couleurPdf(COULEURS_MODES_PDF[serie.key] ?? PALETTE_PDF.ink)
    const focal = serie.points.filter((point) => point.value !== null)
    for (let i = 1; i < focal.length; i += 1) {
      svgLine(rampeSvg, toX(focal[i - 1]!.cutKey), toY(focal[i - 1]!.value!), toX(focal[i]!.cutKey), toY(focal[i]!.value!), color, 0.55)
    }
    for (const point of focal) svgCircle(rampeSvg, toX(point.cutKey), toY(point.value!), 0.9, color)
    const reference = serie.points.filter((point) => point.referenceValue !== null)
    for (let i = 1; i < reference.length; i += 1) {
      svgLine(rampeSvg, toX(reference[i - 1]!.cutKey), toY(reference[i - 1]!.referenceValue!), toX(reference[i]!.cutKey), toY(reference[i]!.referenceValue!), color, 0.5, '2 1.2', 0.55)
    }
  }
  await poserSvg(doc, rampeSvg, rampX, rampY, rampW, plotHeight)
  for (const point of cuts) {
    textePdf(doc, point.cutLabel, rampX + toX(point.cutKey), rampY + plotHeight + 1, {
      police: POLICE_PDF.body,
      taille: TAILLE.tick,
      couleur: PALETTE_PDF.muted,
      align: 'center',
    })
  }
  textePdf(doc, projection.volume.xAxis.label, rampX + rampW / 2, rampY + plotHeight + 5.5, {
    police: POLICE_PDF.body,
    taille: TAILLE.axe,
    couleur: PALETTE_PDF.muted,
    align: 'center',
  })

  // Distribution grouped bars
  const rightX = x + panelWidth + gap
  let rightY = cy
  const distributionTitle = projection.title.split(' / ')[1] ?? projection.distribution.figure.xAxisTitle
  rightY += dessinerTextePlie(doc, options.mesure, distributionTitle, rightX, rightY, panelWidth, {
    police: POLICE_PDF.bodyMedium,
    taille: TAILLE.sousTitre,
    couleur: PALETTE_PDF.ink,
    align: 'center',
  })
  const distX = rightX + 8
  const distW = panelWidth - 8
  const distY = rightY + 2
  const visibleSeries = projection.distribution.figure.series.filter(
    (serie) => !projection.distribution.hiddenSeriesKeys.includes(serie.key),
  )
  const valeurs = visibleSeries.flatMap((serie) => serie.values)
  const distTicks = graduation(valeurs, 3)
  const distMin = Math.min(...distTicks)
  const distMax = Math.max(...distTicks)
  const distSvg = svgCanvas(distW, plotHeight)
  for (const tick of distTicks) {
    const gy = plotHeight - 4 - ((tick - distMin) / (distMax - distMin)) * (plotHeight - 4)
    svgLine(distSvg, 0, gy, distW, gy, PALETTE_PDF.border, 0.2)
    textePdf(doc, formatTick(tick), distX - 1.5, distY + gy - 2, {
      police: POLICE_PDF.meta,
      taille: TAILLE.tick,
      couleur: PALETTE_PDF.muted,
      align: 'right',
    })
  }
  svgLine(distSvg, 0, plotHeight - 4, distW, plotHeight - 4, PALETTE_PDF.ink, 0.35)
  const categories = projection.distribution.figure.categories
  const bande = distW / Math.max(1, categories.length)
  const barWidth = Math.max(1.2, (bande * 0.7) / Math.max(1, visibleSeries.length))
  for (let catIndex = 0; catIndex < categories.length; catIndex += 1) {
    const catX = catIndex * bande + (bande - barWidth * visibleSeries.length) / 2
    visibleSeries.forEach((serie, serieIndex) => {
      const value = serie.values[catIndex]
      if (value === null || !Number.isFinite(value)) return
      const height = ((value - distMin) / (distMax - distMin)) * (plotHeight - 4)
      svgRect(distSvg, catX + serieIndex * barWidth, plotHeight - 4 - height, barWidth * 0.85, height, couleurSerie(serie.color))
    })
    textePdf(doc, categories[catIndex]!.axisLabel, distX + catIndex * bande + bande / 2, distY + plotHeight + 1, {
      police: POLICE_PDF.body,
      taille: TAILLE.tick,
      couleur: PALETTE_PDF.muted,
      align: 'center',
    })
  }
  await poserSvg(doc, distSvg, distX, distY, distW, plotHeight)
  textePdf(doc, projection.distribution.figure.xAxisTitle, distX + distW / 2, distY + plotHeight + 5.5, {
    police: POLICE_PDF.body,
    taille: TAILLE.axe,
    couleur: PALETTE_PDF.muted,
    align: 'center',
  })
  const legend = visibleSeries.map((serie) => ({ label: serie.label, color: couleurSerie(serie.color) }))
  const distLegendHeight = legendeLigne(doc, options.mesure, legend, rightX, distY + plotHeight + 8, panelWidth)
  const leftLegend = legendeLigne(doc, options.mesure, projection.volume.series.map((serie) => ({
    label: serie.label,
    color: couleurPdf(COULEURS_MODES_PDF[serie.key] ?? PALETTE_PDF.ink),
  })), x, rampY + plotHeight + 8, panelWidth)
  return Math.max(rampY + plotHeight + 8 + leftLegend, distY + plotHeight + 8 + distLegendHeight) - y
}

async function dessinerBarres(
  options: OptionsFigurePdf,
  projection: CahierBarsProjection,
  modele: Extract<CahierCaptureFigure, { family: 'mobilite-bars' }>['model']['figure'],
): Promise<number> {
  const { doc, x, y, width } = options
  let cy = y
  cy += dessinerTitre(doc, options.mesure, projection, x, width, cy)
  const plotHeight = 46
  const plotX = x + 10
  const plotW = width - 11
  const plotY = cy + 2
  const valeurs = modele.categories.flatMap((categorie) => [
    categorie.value.fact.value,
    categorie.value.fact.comparison?.reference?.value ?? null,
  ])
  const ticks = graduation(valeurs, 3)
  const min = Math.min(...ticks)
  const max = Math.max(...ticks)
  const svg = svgCanvas(plotW, plotHeight)
  for (const tick of ticks) {
    const gy = plotHeight - 6 - ((tick - min) / (max - min)) * (plotHeight - 6)
    svgLine(svg, 0, gy, plotW, gy, PALETTE_PDF.border, 0.2)
    textePdf(doc, formatTick(tick), plotX - 1.5, plotY + gy - 2, {
      police: POLICE_PDF.meta,
      taille: TAILLE.tick,
      couleur: PALETTE_PDF.muted,
      align: 'right',
    })
  }
  svgLine(svg, 0, plotHeight - 6, plotW, plotHeight - 6, PALETTE_PDF.ink, 0.35)
  const bande = plotW / Math.max(1, modele.categories.length)
  const largeurBarre = Math.min(10, bande * 0.28)
  modele.categories.forEach((categorie, index) => {
    const value = categorie.value.fact.value
    const comparison = categorie.value.fact.comparison?.reference?.value ?? null
    const baseX = index * bande + bande / 2
    const tone = couleurSerie(COULEURS_TONS_PDF[categorie.tone] ?? PALETTE_PDF.ink)
    if (value !== null && Number.isFinite(value)) {
      const height = ((value - min) / (max - min)) * (plotHeight - 6)
      svgRect(svg, baseX - largeurBarre - 0.6, plotHeight - 6 - height, largeurBarre, height, tone)
      // Declared partition, when the producer says it sums to the total.
      if (categorie.segments.length > 1) {
        let cumul = 0
        categorie.segments.forEach((segment, segmentIndex) => {
          const part = segment.value.fact.value
          if (part === null || !Number.isFinite(part)) return
          const segmentHeight = (part / value) * height
          svgRect(svg, baseX - largeurBarre - 0.6, plotHeight - 6 - cumul - segmentHeight, largeurBarre, segmentHeight, tone, 0.85 - segmentIndex * 0.18)
          cumul += segmentHeight
        })
      }
    }
    if (options.comparisonProof && comparison !== null && Number.isFinite(comparison)) {
      const height = ((comparison - min) / (max - min)) * (plotHeight - 6)
      svgRect(svg, baseX + 0.6, plotHeight - 6 - height, largeurBarre, height, PALETTE_PDF.brand200, 0.55)
    }
    const label = categorie.axisLabel
    const lignes = plierTexte(label, options.mesure, {
      police: POLICE_PDF.body,
      taillePt: TAILLE.tick,
      largeurMax: bande - 0.5,
      casserMotsLongs: true,
    })
    lignes.forEach((ligne, ligneIndex) => {
      textePdf(doc, ligne.texte, baseX, plotY + plotHeight + 1 + ligneIndex * 2.4, {
        police: POLICE_PDF.body,
        taille: TAILLE.tick,
        couleur: PALETTE_PDF.muted,
        align: 'center',
      })
    })
  })
  await poserSvg(doc, svg, plotX, plotY, plotW, plotHeight)
  const maxLabelLines = Math.max(1, ...modele.categories.map((categorie) => plierTexte(categorie.axisLabel, options.mesure, {
    police: POLICE_PDF.body,
    taillePt: TAILLE.tick,
    largeurMax: bande - 0.5,
    casserMotsLongs: true,
  }).length))
  textePdf(doc, modele.xAxisTitle, plotX + plotW / 2, plotY + plotHeight + 3 + maxLabelLines * 2.4, {
    police: POLICE_PDF.body,
    taille: TAILLE.axe,
    couleur: PALETTE_PDF.muted,
    align: 'center',
  })
  const legend = [
    { label: 'Valeur du territoire', color: PALETTE_PDF.ink },
    ...(options.comparisonProof ? [{ label: 'Groupe comparé', color: PALETTE_PDF.brand200, dash: true }] : []),
  ]
  const legendHeight = legendeLigne(doc, options.mesure, legend, x, plotY + plotHeight + 8 + maxLabelLines * 2.4, width)
  let bas = plotY + plotHeight + 8 + maxLabelLines * 2.4 + legendHeight
  if (projection.maps && projection.maps.status !== 'none') {
    bas += await dessinerCartes(options, projection.maps, projection.title, bas + 2)
  }
  return bas - y
}

async function dessinerCourbe(
  options: OptionsFigurePdf,
  projection: CahierCurveProjection,
): Promise<number> {
  const { doc, x, y, width } = options
  let cy = y
  cy += dessinerTitre(doc, options.mesure, projection, x, width, cy)
  const plotHeight = 48
  const plotX = x + 10
  const plotW = width - 11
  const plotY = cy + 2
  const valeurs = projection.points.flatMap((point) => [point.value, point.comparisonValue])
  const ticks = graduation(valeurs, 3)
  const min = Math.min(...ticks)
  const max = Math.max(...ticks)
  const svg = svgCanvas(plotW, plotHeight)
  for (const tick of ticks) {
    const gy = plotHeight - 7 - ((tick - min) / (max - min)) * (plotHeight - 7)
    svgLine(svg, 0, gy, plotW, gy, PALETTE_PDF.border, 0.2)
    textePdf(doc, formatTick(tick), plotX - 1.5, plotY + gy - 2, {
      police: POLICE_PDF.meta,
      taille: TAILLE.tick,
      couleur: PALETTE_PDF.muted,
      align: 'right',
    })
  }
  svgLine(svg, 0, plotHeight - 7, plotW, plotHeight - 7, PALETTE_PDF.ink, 0.35)
  const axisValues = projection.points.map((point) => point.axisValue)
  const xMin = Math.min(...axisValues)
  const xMax = Math.max(...axisValues)
  const toX = (value: number) => xMax === xMin ? plotW / 2 : ((value - xMin) / (xMax - xMin)) * (plotW - 2)
  const toY = (value: number) => plotHeight - 7 - ((value - min) / (max - min)) * (plotHeight - 7)
  const points = projection.points.filter((point) => point.value !== null)
  for (let i = 1; i < points.length; i += 1) {
    svgLine(svg, toX(points[i - 1]!.axisValue), toY(points[i - 1]!.value!), toX(points[i]!.axisValue), toY(points[i]!.value!), PALETTE_PDF.modeFoot, 0.55)
  }
  for (const point of points) svgCircle(svg, toX(point.axisValue), toY(point.value!), 0.8, PALETTE_PDF.modeFoot)
  const reference = projection.points.filter((point) => point.comparisonValue !== null)
  for (let i = 1; i < reference.length; i += 1) {
    svgLine(svg, toX(reference[i - 1]!.axisValue), toY(reference[i - 1]!.comparisonValue!), toX(reference[i]!.axisValue), toY(reference[i]!.comparisonValue!), PALETTE_PDF.brand200, 0.5, '2 1.2', 0.7)
  }
  if (projection.marker && projection.marker.axisValue !== null && projection.marker.value !== null) {
    const mx = toX(projection.marker.axisValue)
    svgLine(svg, mx, 0, mx, plotHeight - 7, PALETTE_PDF.margin, 0.4, '2 1.2')
    svgCircle(svg, mx, toY(projection.marker.value), 1.3, PALETTE_PDF.margin)
  }
  await poserSvg(doc, svg, plotX, plotY, plotW, plotHeight)
  for (const point of projection.points) {
    textePdf(doc, point.label, plotX + toX(point.axisValue), plotY + plotHeight + 1, {
      police: POLICE_PDF.body,
      taille: TAILLE.tick,
      couleur: PALETTE_PDF.muted,
      align: 'center',
    })
  }
  textePdf(doc, projection.xAxisTitle, plotX + plotW / 2, plotY + plotHeight + 5.5, {
    police: POLICE_PDF.body,
    taille: TAILLE.axe,
    couleur: PALETTE_PDF.muted,
    align: 'center',
  })
  const legend = [
    { label: 'Valeur du territoire', color: PALETTE_PDF.modeFoot },
    ...(options.comparisonProof ? [{ label: 'Groupe comparé', color: PALETTE_PDF.brand200, dash: true }] : []),
  ]
  const legendHeight = legendeLigne(doc, options.mesure, legend, x, plotY + plotHeight + 8, width)
  return plotY + plotHeight + 8 + legendHeight - y
}

async function dessinerPart(
  options: OptionsFigurePdf,
  projection: CahierShareProjection,
): Promise<number> {
  const { doc, x, y, width } = options
  let cy = y
  cy += dessinerTitre(doc, options.mesure, projection, x, width, cy)
  const trackHeight = 5
  const trackX = x + 32
  const trackW = width - 40
  const drawTrack = (label: string, value: number | null, color: string, yy: number, dashed = false) => {
    textePdf(doc, label, x, yy + 0.6, {
      police: POLICE_PDF.body,
      taille: TAILLE.legende,
      couleur: PALETTE_PDF.ink,
    })
    setFill(doc, PALETTE_PDF.paperDeep)
    doc.rect(trackX, yy, trackW, trackHeight, 'F')
    if (value !== null && Number.isFinite(value)) {
      const pct = Math.max(0, Math.min(1, value))
      setFill(doc, color)
      doc.rect(trackX, yy, trackW * pct, trackHeight, 'F')
      textePdf(doc, `${formatTick(value * 100)} %`, trackX + trackW + 1.5, yy + 0.6, {
        police: POLICE_PDF.metaMedium,
        taille: TAILLE.legende,
        couleur: PALETTE_PDF.ink,
      })
    } else {
      textePdf(doc, 'Indisponible', trackX + 1.5, yy + 1.2, {
        police: POLICE_PDF.meta,
        taille: TAILLE.legende,
        couleur: PALETTE_PDF.muted,
      })
    }
    if (dashed) {
      doc.setLineDashPattern([1, 1], 0)
      setStroke(doc, PALETTE_PDF.brand200)
      doc.setLineWidth(0.25)
      doc.rect(trackX, yy, trackW, trackHeight, 'S')
      doc.setLineDashPattern([], 0)
    }
    resetOpacity(doc)
  }
  drawTrack(projection.territoryName, projection.value, PALETTE_PDF.modeFoot, cy)
  cy += 9
  if (options.comparisonProof) {
    drawTrack('Groupe comparé', projection.comparisonValue, PALETTE_PDF.brand200, cy, true)
    cy += 9
  }
  if (projection.stateMessage) {
    cy += dessinerTextePlie(doc, options.mesure, projection.stateMessage, x, cy, width, {
      police: POLICE_PDF.body,
      taille: TAILLE.note,
      couleur: PALETTE_PDF.muted,
    })
  }
  if (projection.notes.length) {
    for (const note of projection.notes) {
      cy += dessinerTextePlie(doc, options.mesure, note, x, cy + 1, width, {
        police: POLICE_PDF.body,
        taille: TAILLE.note,
        couleur: PALETTE_PDF.muted,
      })
    }
  }
  return cy - y
}

async function dessinerProfil(
  options: OptionsFigurePdf,
  projection: CahierProfileProjection,
): Promise<number> {
  const { doc, x, y, width } = options
  let cy = y
  cy += dessinerTitre(doc, options.mesure, projection, x, width, cy)
  if (!projection.types.length) {
    return cy - y
  }
  const count = projection.types.length
  const colonnes = Math.min(12, Math.ceil(Math.sqrt(count * 2)))
  const lignes = Math.ceil(count / colonnes)
  const tile = Math.min((width - 4) / colonnes, 7)
  const gridW = tile * colonnes
  const gridH = tile * lignes
  const gridX = x + (width - gridW) / 2
  const svg = svgCanvas(gridW, gridH)
  projection.types.forEach((type, index) => {
    const col = index % colonnes
    const row = Math.floor(index / colonnes)
    const color = COULEURS_MODES_PDF[type.bucket] ?? (type.bucket === 'inaccessible' ? PALETTE_PDF.textTertiary : PALETTE_PDF.muted)
    svgRect(svg, col * tile + 0.4, row * tile + 0.4, tile - 0.8, tile - 0.8, color)
  })
  await poserSvg(doc, svg, gridX, cy, gridW, gridH)
  cy += gridH + 2
  const elements = projection.buckets.map((bucket) => ({
    label: `${bucket.label} (${bucket.count})`,
    color: COULEURS_MODES_PDF[bucket.key] ?? (bucket.key === 'inaccessible' ? PALETTE_PDF.textTertiary : PALETTE_PDF.muted),
  }))
  cy += legendeLigne(doc, options.mesure, elements, x, cy, width)
  return cy - y
}

async function dessinerCartes(
  options: OptionsFigurePdf,
  projection: CahierMapsProjection,
  title: string,
  y: number,
): Promise<number> {
  const { doc, x, width, signal, chargerImage } = options
  let cy = y
  const items = projection.items.filter((item) => item.declared)
  if (!items.length) return 0
  const columns = items.length <= 3 ? items.length : 2
  const lignes = Math.ceil(items.length / columns)
  const gap = 4
  const tileW = (width - gap * (columns - 1)) / columns
  const tileH = Math.max(26, Math.min(39, tileW * 0.62))
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index]!
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
    if (!item.loaded || item.unavailable || !item.inlineUrl) {
      throw new Error(`Carte indisponible pour le PDF : ${item.label}`)
    }
    const image = await chargerImage(item.inlineUrl, { signal })
    const col = index % columns
    const row = Math.floor(index / columns)
    const px = x + col * (tileW + gap)
    const py = cy + row * (tileH + 8)
    doc.addImage(image.dataUrl, 'PNG', px, py, tileW, tileH)
    textePdf(doc, item.label, px + tileW / 2, py + tileH + 1.2, {
      police: POLICE_PDF.body,
      taille: TAILLE.tick,
      couleur: PALETTE_PDF.muted,
      align: 'center',
    })
  }
  cy += lignes * (tileH + 8)
  if (projection.legendDetail) {
    const detail = projection.legendDetail
    const legendW = Math.min(width, 120)
    const x0 = x + (width - legendW) / 2
    if (detail.title) {
      textePdf(doc, detail.title, x0, cy, {
        police: POLICE_PDF.bodyMedium,
        taille: TAILLE.legende,
        couleur: PALETTE_PDF.ink,
        align: 'center',
      })
      cy += 4
    }
    const swatchW = legendW / Math.max(1, detail.colors.length)
    detail.colors.forEach((color, index) => {
      setFill(doc, couleurSerie(color, PALETTE_PDF.muted))
      doc.rect(x0 + index * swatchW, cy, swatchW, 3, 'F')
    })
    resetOpacity(doc)
    detail.tickLabels.forEach((label, index) => {
      textePdf(doc, label, x0 + (index / Math.max(1, detail.tickLabels.length - 1)) * legendW, cy + 3.6, {
        police: POLICE_PDF.meta,
        taille: TAILLE.tick,
        couleur: PALETTE_PDF.muted,
        align: index === 0 ? 'left' : index === detail.tickLabels.length - 1 ? 'right' : 'center',
      })
    })
    cy += 7
    if (detail.note) {
      cy += dessinerTextePlie(doc, options.mesure, detail.note, x, cy, width, {
        police: POLICE_PDF.body,
        taille: TAILLE.note,
        couleur: PALETTE_PDF.muted,
        align: 'center',
      })
    }
  }
  void title
  return cy - y
}

async function dessinerApercu(
  options: OptionsFigurePdf,
  projection: CahierOverviewProjection,
): Promise<number> {
  const { doc, x, y, width } = options
  let cy = y
  cy += dessinerTitre(doc, options.mesure, projection, x, width, cy)
  const columns = Math.min(2, Math.max(1, projection.scalars.length))
  const gap = 8
  const cardW = (width - gap * (columns - 1)) / columns
  const cardH = 22
  for (let index = 0; index < projection.scalars.length; index += 1) {
    const scalar = projection.scalars[index]!
    const col = index % columns
    const row = Math.floor(index / columns)
    const px = x + col * (cardW + gap)
    const py = cy + row * cardH
    setFill(doc, PALETTE_PDF.paperDeep)
    doc.rect(px, py, cardW, cardH - 2, 'F')
    resetOpacity(doc)
    textePdf(doc, scalar.label, px + 3, py + 2.5, {
      police: POLICE_PDF.bodyMedium,
      taille: TAILLE.sousTitre,
      couleur: PALETTE_PDF.muted,
    })
    textePdf(doc, scalar.display, px + 3, py + 7, {
      police: POLICE_PDF.valueStrong,
      taille: TAILLE.valeur,
      couleur: PALETTE_PDF.ink,
    })
    let infoY = py + 15
    if (scalar.unit) {
      textePdf(doc, scalar.unit, px + 3, infoY, {
        police: POLICE_PDF.body,
        taille: TAILLE.tick,
        couleur: PALETTE_PDF.muted,
      })
      infoY += 3
    }
    if (scalar.reference) {
      textePdf(doc, `Groupe comparé : ${scalar.reference.display} ${scalar.reference.unit}`.trim(), px + 3, infoY, {
        police: POLICE_PDF.meta,
        taille: TAILLE.tick,
        couleur: PALETTE_PDF.muted,
      })
      infoY += 3
    }
    if (scalar.rank?.display) {
      textePdf(doc, scalar.rank.display, px + cardW - 3, py + 15, {
        police: POLICE_PDF.meta,
        taille: TAILLE.tick,
        couleur: PALETTE_PDF.brand200,
        align: 'right',
      })
    }
  }
  cy += Math.ceil(projection.scalars.length / columns) * cardH + 3
  if (projection.maps.status !== 'none') {
    cy += await dessinerCartes(options, projection.maps, projection.title, cy)
  }
  return cy - y
}

async function dessinerPerteDiversite(
  options: OptionsFigurePdf,
  projection: CahierMapsFigureProjection,
): Promise<number> {
  const { doc, x, y, width } = options
  let cy = y
  cy += dessinerTitre(doc, options.mesure, projection, x, width, cy)
  cy += await dessinerCartes(options, projection.maps, projection.title, cy)
  return cy - y
}

async function dessinerExplorateur(
  options: OptionsFigurePdf,
  projection: CahierExplorerProjection,
): Promise<number> {
  return dessinerBarresGroupees(options, projection)
}

/** Deterministic height used by page flow; drawing returns the same height. */
export function hauteurFigurePdf(
  projection: CahierFigureProjection,
  width: number,
  mesure: MesureTexte,
): number {
  const titre = formatsTitre(projection, width, mesure).length * 3.6
  switch (projection.family) {
    case 'aedar-ramps': return 78
    case 'aedar-equipment-explorer': return 78
    case 'aedar-car-overview': {
      const scalars = Math.ceil(Math.max(1, projection.scalars.length) / 2) * 22
      const maps = projection.maps.status !== 'none' ? 82 : 0
      return titre + scalars + maps + 8
    }
    case 'aedar-diversity-loss': return titre + 96
    case 'aedar-equipment-profile': return projection.types.length ? titre + 66 : titre + 18
    case 'mobilite-bars': {
      const maps = projection.maps?.items.some((item) => item.declared) ? 62 : 0
      return titre + 76 + maps
    }
    case 'mobilite-share': return titre + 40
    case 'mobilite-curve': return titre + 74
  }
}

export async function dessinerFigurePdf(
  options: OptionsFigurePdf,
  projection: CahierFigureProjection,
): Promise<number> {
  switch (projection.family) {
    case 'aedar-ramps':
      return dessinerRampes(options, projection)
    case 'aedar-car-overview':
      return dessinerApercu(options, projection)
    case 'aedar-diversity-loss':
      return dessinerPerteDiversite(options, projection)
    case 'aedar-equipment-profile':
      return dessinerProfil(options, projection)
    case 'aedar-equipment-explorer':
      return dessinerExplorateur(options, projection)
    case 'mobilite-bars': {
      const modele = options.modeleBars
      if (!modele) throw new Error('Modèle natif des barres manquant pour le PDF.')
      return dessinerBarres(options, projection, modele)
    }
    case 'mobilite-share':
      return dessinerPart(options, projection)
    case 'mobilite-curve':
      return dessinerCourbe(options, projection)
  }
}
