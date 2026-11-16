/**
 * Native-family PDF primitives for the shared Cahier composer (#1024).
 *
 * The correction after independent review: this file no longer owns axis
 * domains, tick selection, series geometry, bar geometry, stacked comparison
 * segments or waffle flow. Those live in `cahierFigureNativeGeometry.ts` and
 * are consumed by the mounted figure components too. This file only paints the
 * resulting native primitives (SVG/rect/line/path + selectable jsPDF text) and
 * keeps native titles, axis labels, units, legends, ranks and colours.
 */
import type { jsPDF } from 'jspdf'

import {
  CURVE_Y_TICKS,
  curveGeometry,
  curveSeriesPath,
  mobiliteBarComparisonSegments,
  mobiliteBarGeometry,
  mobiliteBarScale,
  mobiliteBarStackedSegments,
  mobiliteBarTone,
  mobiliteBarXticks,
  mobiliteBarYTicks,
  groupedBarGeometry,
  groupedBarScale,
  groupedBarTicks,
  rampGeometry,
  rampPaths,
  shareFillPercent,
  visibleCurveTicks,
  waffleGridPosition,
} from './cahierFigureNativeGeometry'
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
import type { CahierGroupedVerticalBarFigureData } from '@/fiche/cahierFigureGrammaire'
import { cahierIntegerYAxisScale } from '@/fiche/cahierFigureGrammaire'
import type { MobiliteRaccordementEvidence } from '@/fiche/content/themeContent'
import type { TimeRampPoint } from '@/fiche/content/territoryFacts'
import { AEDAR_TIME_MODE_COLORS } from './aedarTimeModeColors'
import { mobiliteBarSegmentColor } from './cahierMobiliteReadings'
import { visibleGroupedBarSeries } from './cahierFigureReadings'
import type { MesureTexte } from './cahierPdfMesure'
import { plierTexte } from './cahierPdfMesure'
import { PALETTE_PDF, couleurPdf, hexVersRgb } from './cahierPdfPalette'
import { POLICE_PDF } from './cahierPdfFonts'

export interface ImagePdf {
  readonly dataUrl: string
  readonly width: number
  readonly height: number
}

export class CahierPdfAssetError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CahierPdfAssetError'
  }
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
  /** Native explorer title, never parsed from the combined projection title. */
  readonly distributionTitle?: string
  /** Native distribution value unit for the y-axis title. */
  readonly distributionUnit?: string
  /** Native curve model, for the declared grid ticks/axis. */
  readonly modeleCourbe?: MobiliteRaccordementEvidence
  /** Owner-observed served comparative proof for this figure (not capability). */
  readonly comparisonProof?: boolean
}

const TAILLE = {
  titre: 8.5,
  sousTitre: 7,
  axe: 6,
  tick: 5.6,
  legende: 6.4,
  valeur: 14,
  note: 6.2,
} as const

function rgb(value: string): [number, number, number] {
  return hexVersRgb(value)
}

function setFill(doc: jsPDF, value: string, opacity = 1): void {
  doc.setFillColor(...rgb(value))
  appliquerOpacite(doc, opacity)
}

function setStroke(doc: jsPDF, value: string, opacity = 1): void {
  doc.setDrawColor(...rgb(value))
  doc.setGState(doc.GState({ 'stroke-opacity': opacity }))
}

function appliquerOpacite(doc: jsPDF, opacity: number): void {
  doc.setGState(doc.GState({ opacity }))
}

function resetOpacity(doc: jsPDF): void {
  doc.setGState(doc.GState({ opacity: 1, 'stroke-opacity': 1 }))
}

interface OptionsTexte {
  readonly police: string
  readonly taille: number
  readonly couleur: string
  readonly align?: 'left' | 'center' | 'right'
  readonly baseline?: 'top' | 'middle' | 'alphabetic'
  readonly espacement?: number
}

export function textePdf(
  doc: jsPDF,
  texte: string,
  x: number,
  y: number,
  options: OptionsTexte,
): void {
  appliquerOpacite(doc, 1)
  doc.setFont(options.police, 'normal')
  doc.setFontSize(options.taille)
  doc.setTextColor(...rgb(options.couleur))
  doc.setCharSpace(options.espacement ?? 0)
  doc.text(texte, x, y, {
    align: options.align ?? 'left',
    baseline: options.baseline ?? 'top',
  })
  doc.setCharSpace(0)
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
  const lignes = plierTexte(texte, mesure, {
    police: options.police,
    taillePt: options.taille,
    largeurMax: largeur,
    espacementPt: options.espacement,
    casserMotsLongs: true,
  })
  let cy = y
  const hauteur = mesure.hauteurLigne(options.police, options.taille) * 1.18
  const xLigne = options.align === 'center'
    ? x + largeur / 2
    : options.align === 'right'
      ? x + largeur
      : x
  for (const ligne of lignes) {
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

function svgCircle(svg: SVGSVGElement, cx: number, cy: number, r: number, fill: string): void {
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
    svg: (element: Element, options: { x: number; y: number; width: number; height: number }) => Promise<unknown>
  }
  await paint.svg(svg, { x, y, width, height })
}

function couleurSerie(value: string): string {
  return couleurPdf(value)
}

function titreLignes(projection: CahierFigureProjection, width: number, mesure: MesureTexte): string[] {
  return plierTexte(projection.title, mesure, {
    police: POLICE_PDF.bodyStrong,
    taillePt: TAILLE.titre,
    largeurMax: width,
    casserMotsLongs: true,
  }).map((ligne) => ligne.texte)
}

function hauteurTitre(projection: CahierFigureProjection, width: number, mesure: MesureTexte): number {
  return titreLignes(projection, width, mesure).length
    * mesure.hauteurLigne(POLICE_PDF.bodyStrong, TAILLE.titre) * 1.18
}

function dessinerTitre(
  doc: jsPDF,
  mesure: MesureTexte,
  projection: CahierFigureProjection,
  x: number,
  width: number,
  y: number,
): number {
  let cy = y
  for (const ligne of titreLignes(projection, width, mesure)) {
    textePdf(doc, ligne, x + width / 2, cy, {
      police: POLICE_PDF.bodyStrong,
      taille: TAILLE.titre,
      couleur: PALETTE_PDF.ink,
      align: 'center',
    })
    cy += mesure.hauteurLigne(POLICE_PDF.bodyStrong, TAILLE.titre) * 1.18
  }
  return cy - y
}

function legendeLigne(
  doc: jsPDF,
  mesure: MesureTexte,
  elements: readonly { label: string; color: string; dash?: boolean; square?: boolean }[],
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
      doc.rect(cx, cy + hauteur * 0.28, 4.5, element.square ? 3.2 : 1.4, 'F')
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

function hauteurLegende(
  mesure: MesureTexte,
  elements: readonly { label: string }[],
  width: number,
): number {
  if (!elements.length) return 0
  let largeur = 0
  let lignes = 1
  for (const element of elements) {
    const labelWidth = mesure.largeur(element.label, POLICE_PDF.body, TAILLE.legende) + 7
    if (largeur > 0 && largeur + labelWidth > width) {
      lignes += 1
      largeur = 0
    }
    largeur += labelWidth
  }
  return lignes * mesure.hauteurLigne(POLICE_PDF.body, TAILLE.legende) * 1.3
}

function hauteurCartesPdf(maps: CahierMapsProjection | null | undefined, width: number): number {
  if (!maps) return 0
  const items = maps.items.filter((item) => item.declared)
  if (!items.length) return 0
  const columns = items.length <= 3 ? items.length : 2
  const rows = Math.ceil(items.length / columns)
  const gap = 4
  const tileW = (width - gap * (columns - 1)) / columns
  const tileH = Math.max(26, Math.min(39, tileW * 0.62))
  let height = rows * (tileH + 8)
  if (maps.legendDetail) {
    height += 4
    if (maps.legendDetail.title) height += 4
    height += 7
    if (maps.legendDetail.note) height += 4
  }
  return height
}

function titreAvecUnite(titre: string, unite: string): string {
  const value = unite.trim()
  if (!value) return titre
  return titre.includes(value) ? titre : `${titre} (${value})`
}

function dessinerAxes(
  doc: jsPDF,
  mesure: MesureTexte,
  options: {
    x: number
    y: number
    width: number
    height: number
    xTicks: readonly { key: string | number; position: number; label: string | null }[]
    yTicks: readonly { key: string | number; position: number; label: string | null }[]
    xTitle: string
    yTitle: string
    plotLeft: number
    plotBottom: number
    plotWidth: number
    plotHeight: number
    tickRotation?: number
  },
): void {
  const { x, y, height, xTicks, yTicks, xTitle, yTitle, plotLeft, plotBottom, plotWidth, plotHeight } = options
  void plotHeight
  for (const tick of yTicks) {
    if (tick.label === null) continue
    textePdf(doc, tick.label, x + plotLeft - 1.4, y + tick.position - 2, {
      police: POLICE_PDF.meta,
      taille: TAILLE.tick,
      couleur: PALETTE_PDF.muted,
      align: 'right',
    })
  }
  for (const tick of xTicks) {
    if (tick.label === null) continue
    textePdf(doc, tick.label, x + tick.position, y + plotBottom + 1, {
      police: POLICE_PDF.body,
      taille: TAILLE.tick,
      couleur: PALETTE_PDF.muted,
      align: 'center',
    })
  }
  textePdf(doc, xTitle, x + plotLeft + plotWidth / 2, y + plotBottom + 5.2, {
    police: POLICE_PDF.body,
    taille: TAILLE.axe,
    couleur: PALETTE_PDF.muted,
    align: 'center',
  })
  doc.saveGraphicsState()
  // jsPDF's center alignment subtracts half the unrotated width from x before
  // rotation. Center along the rotated baseline instead, keeping the label in
  // its own panel and clear of the neighbouring panel's title.
  const titleWidth = mesure.largeur(yTitle, POLICE_PDF.body, TAILLE.axe)
  const tickWidth = Math.max(0, ...yTicks.map((tick) => mesure.largeur(tick.label ?? '', POLICE_PDF.meta, TAILLE.tick)))
  doc.setFont(POLICE_PDF.body, 'normal')
  doc.setFontSize(TAILLE.axe)
  doc.setTextColor(...rgb(PALETTE_PDF.muted))
  doc.text(yTitle, x + plotLeft - tickWidth - 3.2, y + height / 2 + titleWidth / 2, { angle: 90 })
  doc.restoreGraphicsState()
}

/* ------------------------------------------------------------------ *
 * Native projection adapters (no factual recomputation)
 * ------------------------------------------------------------------ */

function rampPoints(series: CahierRampsProjection['ramps'][number]['series'][number]): TimeRampPoint[] {
  return series.points.map((point) => ({
    xValue: point.cutKey,
    xLabel: point.cutLabel,
    value: point.value,
    referenceValue: point.referenceValue,
  }))
}

function rampLegend(projection: CahierRampsProjection, comparisonProof: boolean) {
  return [
    ...projection.ramps[0]!.series.map((serie) => ({
      label: serie.label,
      color: couleurSerie(AEDAR_TIME_MODE_COLORS[serie.key]!),
    })),
    ...(comparisonProof
      ? [{ label: 'Groupe comparé', color: PALETTE_PDF.muted, dash: true }]
      : []),
  ]
}

async function dessinerRampes(
  options: OptionsFigurePdf,
  projection: CahierRampsProjection,
): Promise<number> {
  const { doc, x, y, width, mesure } = options
  const nombre = Math.max(1, projection.ramps.length)
  const gap = 6
  const panelWidth = (width - gap * (nombre - 1)) / nombre
  const plotHeight = 42
  const panelTitles = projection.ramps.map((ramp) => plierTexte(ramp.title, mesure, {
    police: POLICE_PDF.bodyMedium,
    taillePt: TAILLE.sousTitre,
    largeurMax: panelWidth,
    casserMotsLongs: true,
  }).map((ligne) => ligne.texte))
  const titleHeight = Math.max(...panelTitles.map((lines) => lines.length))
    * mesure.hauteurLigne(POLICE_PDF.bodyMedium, TAILLE.sousTitre) * 1.18
  let bas = y + titleHeight
  for (let index = 0; index < projection.ramps.length; index += 1) {
    const ramp = projection.ramps[index]!
    const px = x + index * (panelWidth + gap)
    let py = y
    for (const ligne of panelTitles[index]!) {
      textePdf(doc, ligne, px + panelWidth / 2, py, {
        police: POLICE_PDF.bodyMedium,
        taille: TAILLE.sousTitre,
        couleur: PALETTE_PDF.ink,
        align: 'center',
      })
      py += mesure.hauteurLigne(POLICE_PDF.bodyMedium, TAILLE.sousTitre) * 1.18
    }
    const panelScale = cahierIntegerYAxisScale(ramp.series.flatMap((serie) =>
      serie.points.flatMap((point) => [point.value, point.referenceValue])))
    const firstSeries = ramp.series[0]!
    const initialGeometry = {
      width: panelWidth,
      height: plotHeight,
      margin: { top: 2, right: 2, bottom: 2, left: 9 },
    } as const
    const initialTicks = rampGeometry(rampPoints(firstSeries), panelScale, initialGeometry, ramp.yAxis.unit).yTicks
    const tickWidth = Math.max(0, ...initialTicks.map((tick) => mesure.largeur(tick.label ?? '', POLICE_PDF.meta, TAILLE.tick)))
    const nativeGeometry = { ...initialGeometry, margin: {
      ...initialGeometry.margin, left: Math.max(initialGeometry.margin.left, tickWidth + 5.3),
    } }
    const geom = rampGeometry(rampPoints(firstSeries), panelScale, nativeGeometry, ramp.yAxis.unit)
    const svg = svgCanvas(panelWidth, plotHeight)
    for (const tick of geom.yTicks) {
      svgLine(svg, nativeGeometry.margin.left, tick.position, panelWidth - nativeGeometry.margin.right, tick.position, PALETTE_PDF.border, 0.2)
    }
    svgLine(
      svg,
      nativeGeometry.margin.left,
      plotHeight - nativeGeometry.margin.bottom,
      panelWidth - nativeGeometry.margin.right,
      plotHeight - nativeGeometry.margin.bottom,
      PALETTE_PDF.ink,
      0.35,
    )
    for (const serie of ramp.series) {
      const color = couleurSerie(AEDAR_TIME_MODE_COLORS[serie.key]!)
      const points = rampPoints(serie)
      for (const path of rampPaths(points, (point) => point.value, geom.x, geom.y)) {
        const node = document.createElementNS('http://www.w3.org/2000/svg', 'path')
        node.setAttribute('d', path)
        node.setAttribute('fill', 'none')
        node.setAttribute('stroke', color)
        node.setAttribute('stroke-width', '0.55')
        node.setAttribute('stroke-linecap', 'round')
        node.setAttribute('stroke-linejoin', 'round')
        svg.append(node)
      }
      for (const path of rampPaths(points, (point) => point.referenceValue, geom.x, geom.y)) {
        const node = document.createElementNS('http://www.w3.org/2000/svg', 'path')
        node.setAttribute('d', path)
        node.setAttribute('fill', 'none')
        node.setAttribute('stroke', color)
        node.setAttribute('stroke-width', '0.5')
        node.setAttribute('stroke-opacity', '0.55')
        node.setAttribute('stroke-dasharray', '2 1.2')
        node.setAttribute('stroke-linecap', 'round')
        svg.append(node)
      }
      for (const point of points) {
        if (point.value !== null) svgCircle(svg, geom.x(point.xValue), geom.y(point.value), 0.8, color)
      }
    }
    await poserSvg(doc, svg, px, py + 2, panelWidth, plotHeight)
    dessinerAxes(doc, mesure, {
      x: px,
      y: py + 2,
      height: plotHeight,
      width: panelWidth,
      xTicks: geom.xTicks,
      yTicks: geom.yTicks,
      xTitle: ramp.xAxis.label,
      yTitle: titreAvecUnite(ramp.yAxis.label, ramp.yAxis.unit),
      plotLeft: nativeGeometry.margin.left,
      plotBottom: plotHeight - nativeGeometry.margin.bottom,
      plotWidth: panelWidth - nativeGeometry.margin.left - nativeGeometry.margin.right,
      plotHeight: plotHeight - nativeGeometry.margin.top - nativeGeometry.margin.bottom,
    })
    const legend = legendeLigne(doc, mesure, rampLegend(projection, Boolean(options.comparisonProof)), px, py + plotHeight + 8, panelWidth)
    bas = Math.max(bas, py + plotHeight + 8 + legend)
  }
  return bas - y
}

async function dessinerCourbe(
  options: OptionsFigurePdf,
  projection: CahierCurveProjection,
): Promise<number> {
  if (!options.modeleCourbe) throw new Error('Modèle natif de courbe manquant pour le PDF.')
  const { doc, x, y, width, mesure } = options
  let cy = y
  cy += dessinerTitre(doc, mesure, projection, x, width, cy)
  const plotHeight = 45
  const plotWidth = width - 11
  const plotX = x + 9
  const plotY = cy + 2
  const nativeGeometry = { width: plotWidth, height: plotHeight, margin: { top: 2, right: 2, bottom: 2, left: 9 } } as const
  const native = options.modeleCourbe
    ? curveGeometry(options.modeleCourbe, nativeGeometry)
    : null
  const scale = native?.scale ?? (projection.axis
    ? { minimum: projection.axis.minimum, maximum: projection.axis.maximum, ticks: [...CURVE_Y_TICKS] }
    : { minimum: 0, maximum: 1, ticks: [...CURVE_Y_TICKS] })
  const xFor = (value: number) => nativeGeometry.margin.left
    + ((value - scale.minimum) / (scale.maximum - scale.minimum)) * (plotWidth - nativeGeometry.margin.left - nativeGeometry.margin.right)
  const yFor = (value: number) => nativeGeometry.margin.top
    + (1 - Math.max(0, Math.min(1, value))) * (plotHeight - nativeGeometry.margin.top - nativeGeometry.margin.bottom)
  const allTicks = native?.xTicks ?? projection.points.map((point) => ({
    key: point.detail,
    position: xFor(point.axisValue),
    label: point.label,
  }))
  const ticks = visibleCurveTicks(
    allTicks,
    plotWidth * 96 / 25.4,
    plotWidth,
    projection.marker?.detail ?? null,
    (label) => mesure.largeur(label ?? '', POLICE_PDF.body, TAILLE.tick) * 96 / 25.4,
    new Set((options.modeleCourbe?.trajectory?.ticks ?? [])
      .filter((tick) => tick.mobile === true)
      .map((tick) => tick.detail)),
  )
  const yTicks = native?.yTicks ?? CURVE_Y_TICKS.map((value) => ({
    key: value,
    position: yFor(value),
    label: `${value * 100} %`,
  }))
  const svg = svgCanvas(plotWidth, plotHeight)
  for (const tick of yTicks) {
    svgLine(svg, nativeGeometry.margin.left, tick.position, plotWidth - nativeGeometry.margin.right, tick.position, PALETTE_PDF.border, 0.2)
  }
  svgLine(svg, nativeGeometry.margin.left, plotHeight - nativeGeometry.margin.bottom, plotWidth - nativeGeometry.margin.right, plotHeight - nativeGeometry.margin.bottom, PALETTE_PDF.ink, 0.35)
  if (options.modeleCourbe && native) {
    const focalPath = curveSeriesPath(options.modeleCourbe.points, options.modeleCourbe, native)
    if (focalPath) {
      const node = document.createElementNS('http://www.w3.org/2000/svg', 'path')
      node.setAttribute('d', focalPath)
      node.setAttribute('fill', 'none')
      node.setAttribute('stroke', PALETTE_PDF.brand500)
      node.setAttribute('stroke-width', '0.55')
      node.setAttribute('stroke-linecap', 'round')
      node.setAttribute('stroke-linejoin', 'round')
      svg.append(node)
    }
    if (options.comparisonProof && options.modeleCourbe.comparison) {
      const referencePath = curveSeriesPath(options.modeleCourbe.comparison.points, options.modeleCourbe, native)
      if (referencePath) {
        const node = document.createElementNS('http://www.w3.org/2000/svg', 'path')
        node.setAttribute('d', referencePath)
        node.setAttribute('fill', 'none')
        node.setAttribute('stroke', PALETTE_PDF.brand200)
        node.setAttribute('stroke-width', '0.5')
        node.setAttribute('stroke-opacity', '0.68')
        node.setAttribute('stroke-dasharray', '2 1.2')
        node.setAttribute('stroke-linecap', 'round')
        svg.append(node)
      }
    }
  }
  if (projection.marker && projection.marker.axisValue !== null) {
    const mx = xFor(projection.marker.axisValue)
    const cssPixel = 25.4 / 96
    svgLine(svg, mx, nativeGeometry.margin.top, mx, plotHeight - nativeGeometry.margin.bottom, PALETTE_PDF.muted, 1.5 * cssPixel, `${3 * cssPixel} ${3 * cssPixel}`)
  }
  await poserSvg(doc, svg, plotX, plotY, plotWidth, plotHeight)
  dessinerAxes(doc, mesure, {
    x: plotX,
    y: plotY,
    height: plotHeight,
    width: plotWidth,
    xTicks: ticks,
    yTicks,
    xTitle: projection.xAxisTitle,
    yTitle: titreAvecUnite(projection.yAxisTitle, projection.unit),
    plotLeft: nativeGeometry.margin.left,
    plotBottom: plotHeight - nativeGeometry.margin.bottom,
    plotWidth: plotWidth - nativeGeometry.margin.left - nativeGeometry.margin.right,
    plotHeight: plotHeight - nativeGeometry.margin.top - nativeGeometry.margin.bottom,
  })
  const legend = [
    { label: 'Valeur du territoire', color: PALETTE_PDF.brand500 },
    ...(options.comparisonProof ? [{ label: 'Groupe comparé', color: PALETTE_PDF.brand200, dash: true }] : []),
  ]
  return plotY + plotHeight + 8 + legendeLigne(doc, mesure, legend, x, plotY + plotHeight + 8, width) - y
}

async function dessinerBarres(
  options: OptionsFigurePdf,
  projection: CahierBarsProjection,
  modele: NonNullable<OptionsFigurePdf['modeleBars']>,
): Promise<number> {
  const { doc, x, y, width, mesure } = options
  let cy = y
  cy += dessinerTitre(doc, mesure, projection, x, width, cy)
  const comparisonAligned = modele.categories.some((category) => category.value.fact.comparison?.reference?.value != null)
    && Boolean(options.comparisonProof)
  const scale = mobiliteBarScale(modele, comparisonAligned)
  const nativeGeometry = { width, height: 48, margin: { top: 2, right: 2, bottom: 2, left: 10 } } as const
  const bar = mobiliteBarGeometry(nativeGeometry, modele.categories.length, scale, comparisonAligned ? 2 : 1)
  const plotBottom = nativeGeometry.height - nativeGeometry.margin.bottom
  const svg = svgCanvas(width, nativeGeometry.height)
  const yTicks = mobiliteBarYTicks(scale, nativeGeometry)
  for (const tick of yTicks) {
    svgLine(svg, nativeGeometry.margin.left, tick.position, width - nativeGeometry.margin.right, tick.position, PALETTE_PDF.border, 0.2)
  }
  svgLine(svg, nativeGeometry.margin.left, plotBottom, width - nativeGeometry.margin.right, plotBottom, PALETTE_PDF.ink, 0.35)
  modele.categories.forEach((category, categoryIndex) => {
    const focalColor = couleurSerie(mobiliteBarTone(category))
    if (!category.segments.length) {
      const value = category.value.fact.value
      if (value !== null && Number.isFinite(value)) {
        svgRect(svg, bar.x(categoryIndex, 0), plotBottom - bar.height(value), bar.barWidth, bar.height(value), focalColor)
      }
    } else {
      for (const segment of mobiliteBarStackedSegments(category, categoryIndex, nativeGeometry, bar)) {
        svgRect(svg, segment.x, segment.y, segment.width, segment.height, couleurSerie(segment.fill))
      }
    }
    if (comparisonAligned) {
      const reference = category.value.fact.comparison?.reference?.value
      const segments = mobiliteBarComparisonSegments(category, categoryIndex, nativeGeometry, bar)
      if (segments.length) {
        for (const segment of segments) {
          svgRect(svg, segment.x, segment.y, segment.width, segment.height, couleurSerie(segment.fill))
        }
      } else if (reference !== null && reference !== undefined && Number.isFinite(reference)) {
        svgRect(svg, bar.x(categoryIndex, 1), plotBottom - bar.height(reference), bar.barWidth, bar.height(reference), couleurSerie(`color-mix(in srgb, ${mobiliteBarTone(category)} 45%, var(--paper))`))
      }
    }
  })
  await poserSvg(doc, svg, x, cy + 2, width, nativeGeometry.height)
  const xTicks = mobiliteBarXticks(modele, nativeGeometry, bar)
  dessinerAxes(doc, mesure, {
    x,
    y: cy + 2,
    height: nativeGeometry.height,
    width,
    xTicks,
    yTicks,
    xTitle: modele.xAxisTitle,
    yTitle: titreAvecUnite(modele.yAxisTitle, modele.unit),
    plotLeft: nativeGeometry.margin.left,
    plotBottom: plotBottom,
    plotWidth: width - nativeGeometry.margin.left - nativeGeometry.margin.right,
    plotHeight: nativeGeometry.height - nativeGeometry.margin.top - nativeGeometry.margin.bottom,
  })
  const legend = [
    ...modele.categories.flatMap((category) => category.segments.map((segment) => ({
      label: segment.legendLabel ?? segment.label,
      color: couleurSerie(mobiliteBarSegmentColor(segment)),
      square: true,
    }))),
    ...(comparisonAligned
      ? [{ label: 'Groupe comparé', color: couleurSerie('color-mix(in srgb, var(--cahier-theme-strong) 45%, var(--paper))'), square: true }]
      : []),
  ]
  const legendHeight = legendeLigne(doc, mesure, legend, x, cy + 2 + nativeGeometry.height + 8, width)
  let bas = cy + 2 + nativeGeometry.height + 8 + legendHeight
  if (projection.maps && projection.maps.status !== 'none') {
    bas += await dessinerCartes(options, projection.maps, bas + 2)
  }
  return bas - y
}

async function dessinerBarresGroupees(
  options: OptionsFigurePdf,
  projection: CahierExplorerProjection,
): Promise<number> {
  const { doc, x, y, width, mesure } = options
  const gap = 6
  const panelWidth = (width - gap) / 2
  const plotHeight = 42
  const leftTitle = plierTexte(projection.volume.title, mesure, {
    police: POLICE_PDF.bodyMedium,
    taillePt: TAILLE.sousTitre,
    largeurMax: panelWidth,
    casserMotsLongs: true,
  }).map((ligne) => ligne.texte)
  const rightTitle = plierTexte(
    options.distributionTitle ?? projection.distribution.figure.xAxisTitle,
    mesure,
    { police: POLICE_PDF.bodyMedium, taillePt: TAILLE.sousTitre, largeurMax: panelWidth, casserMotsLongs: true },
  ).map((ligne) => ligne.texte)
  const drawGrouped = async (originX: number, figure: CahierGroupedVerticalBarFigureData, hidden: readonly string[], titleLines: string[], unit: string) => {
    let cy = y
    for (const line of titleLines) {
      textePdf(doc, line, originX + panelWidth / 2, cy, {
        police: POLICE_PDF.bodyMedium,
        taille: TAILLE.sousTitre,
        couleur: PALETTE_PDF.ink,
        align: 'center',
      })
      cy += mesure.hauteurLigne(POLICE_PDF.bodyMedium, TAILLE.sousTitre) * 1.18
    }
    const visible = visibleGroupedBarSeries(figure, hidden)
    const scale = groupedBarScaleFromFigure(visible)
    const nativeGeometry = { width: panelWidth, height: plotHeight, margin: { top: 2, right: 2, bottom: 2, left: 9 } } as const
    const bar = groupedBarGeometryFromFigure(nativeGeometry, figure.categories.length, visible.length, scale)
    const svg = svgCanvas(panelWidth, plotHeight)
    const ticks = groupedBarTicksFromFigure(figure, nativeGeometry, bar, scale)
    for (const tick of ticks.y) {
      svgLine(svg, nativeGeometry.margin.left, tick.position, panelWidth - nativeGeometry.margin.right, tick.position, PALETTE_PDF.border, 0.2)
    }
    svgLine(svg, nativeGeometry.margin.left, nativeGeometry.height - nativeGeometry.margin.bottom, panelWidth - nativeGeometry.margin.right, nativeGeometry.height - nativeGeometry.margin.bottom, PALETTE_PDF.ink, 0.35)
    visible.forEach((series, seriesIndex) => {
      figure.categories.forEach((_category, categoryIndex) => {
        const value = series.values[categoryIndex]
        if (value === null || value === undefined || !Number.isFinite(value)) return
        svgRect(svg, bar.x(categoryIndex, seriesIndex), Math.min(nativeGeometry.height - nativeGeometry.margin.bottom - bar.height(value), nativeGeometry.height - nativeGeometry.margin.bottom - bar.height(value)), bar.barWidth, bar.height(value), couleurSerie(series.color))
      })
    })
    await poserSvg(doc, svg, originX, cy + 2, panelWidth, plotHeight)
    dessinerAxes(doc, mesure, {
      x: originX,
      y: cy + 2,
      height: plotHeight,
      width: panelWidth,
      xTicks: ticks.x,
      yTicks: ticks.y,
      xTitle: figure.xAxisTitle,
      yTitle: titreAvecUnite(figure.yAxisTitle, unit),
      plotLeft: nativeGeometry.margin.left,
      plotBottom: nativeGeometry.height - nativeGeometry.margin.bottom,
      plotWidth: panelWidth - nativeGeometry.margin.left - nativeGeometry.margin.right,
      plotHeight: plotHeight - nativeGeometry.margin.top - nativeGeometry.margin.bottom,
    })
    const legend = visible.map((series) => ({ label: series.label, color: couleurSerie(series.color) }))
    return cy + 2 + plotHeight + 8 + legendeLigne(doc, mesure, legend, originX, cy + 2 + plotHeight + 8, panelWidth)
  }
  const leftBottom = await (async () => {
    let cy = y
    for (const line of leftTitle) {
      textePdf(doc, line, x + panelWidth / 2, cy, {
        police: POLICE_PDF.bodyMedium,
        taille: TAILLE.sousTitre,
        couleur: PALETTE_PDF.ink,
        align: 'center',
      })
      cy += mesure.hauteurLigne(POLICE_PDF.bodyMedium, TAILLE.sousTitre) * 1.18
    }
    const values = projection.volume.series.flatMap((serie) =>
      serie.points.flatMap((point) => [point.value, point.referenceValue]))
    const scale = cahierIntegerYAxisScale(values)
    const nativeGeometry = { width: panelWidth, height: plotHeight, margin: { top: 2, right: 2, bottom: 2, left: 9 } } as const
    const first = projection.volume.series[0]!
    const points = rampPoints(first)
    const geom = rampGeometry(points, scale, nativeGeometry, projection.volume.yAxis.unit)
    const svg = svgCanvas(panelWidth, plotHeight)
    for (const tick of geom.yTicks) {
      svgLine(svg, nativeGeometry.margin.left, tick.position, panelWidth - nativeGeometry.margin.right, tick.position, PALETTE_PDF.border, 0.2)
    }
    svgLine(svg, nativeGeometry.margin.left, plotHeight - nativeGeometry.margin.bottom, panelWidth - nativeGeometry.margin.right, plotHeight - nativeGeometry.margin.bottom, PALETTE_PDF.ink, 0.35)
    for (const serie of projection.volume.series) {
      const color = couleurSerie(AEDAR_TIME_MODE_COLORS[serie.key]!)
      const seriePoints = rampPoints(serie)
      for (const path of rampPaths(seriePoints, (point) => point.value, geom.x, geom.y)) {
        const node = document.createElementNS('http://www.w3.org/2000/svg', 'path')
        node.setAttribute('d', path)
        node.setAttribute('fill', 'none')
        node.setAttribute('stroke', color)
        node.setAttribute('stroke-width', '0.55')
        node.setAttribute('stroke-linecap', 'round')
        svg.append(node)
      }
      for (const point of seriePoints) {
        if (point.value !== null) svgCircle(svg, geom.x(point.xValue), geom.y(point.value), 0.8, color)
      }
    }
    await poserSvg(doc, svg, x, cy + 2, panelWidth, plotHeight)
    dessinerAxes(doc, mesure, {
      x,
      y: cy + 2,
      height: plotHeight,
      width: panelWidth,
      xTicks: geom.xTicks,
      yTicks: geom.yTicks,
      xTitle: projection.volume.xAxis.label,
      yTitle: titreAvecUnite(projection.volume.yAxis.label, projection.volume.yAxis.unit),
      plotLeft: nativeGeometry.margin.left,
      plotBottom: plotHeight - nativeGeometry.margin.bottom,
      plotWidth: panelWidth - nativeGeometry.margin.left - nativeGeometry.margin.right,
      plotHeight: plotHeight - nativeGeometry.margin.top - nativeGeometry.margin.bottom,
    })
    const legend = projection.volume.series.map((serie) => ({
      label: serie.label,
      color: couleurSerie(AEDAR_TIME_MODE_COLORS[serie.key]!),
    }))
    return cy + 2 + plotHeight + 8 + legendeLigne(doc, mesure, legend, x, cy + 2 + plotHeight + 8, panelWidth)
  })()
  const rightBottom = await drawGrouped(x + panelWidth + gap, projection.distribution.figure, projection.distribution.hiddenSeriesKeys, rightTitle, options.distributionUnit ?? '')
  return Math.max(leftBottom, rightBottom) - y
}

/* The following thin adapters keep the shared native geometry calls typed
 * without duplicating their rules. */
function groupedBarScaleFromFigure(
  visible: readonly { values: readonly (number | null)[] }[],
) {
  return groupedBarScale(visible)
}

function groupedBarGeometryFromFigure(
  geometry: Parameters<typeof groupedBarGeometry>[0],
  categories: number,
  series: number,
  scale: ReturnType<typeof groupedBarScale>,
) {
  return groupedBarGeometry(geometry, categories, series, scale)
}

function groupedBarTicksFromFigure(
  figure: CahierGroupedVerticalBarFigureData,
  geometry: Parameters<typeof groupedBarTicks>[1],
  bar: ReturnType<typeof groupedBarGeometry>,
  scale: ReturnType<typeof groupedBarScale>,
) {
  return groupedBarTicks(figure, geometry, bar, scale, (value) =>
    figure.formatAxisTick?.(value)
    ?? new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 }).format(value))
}

async function dessinerPart(
  options: OptionsFigurePdf,
  projection: CahierShareProjection,
): Promise<number> {
  const { doc, x, y, width, mesure } = options
  let cy = y
  cy += dessinerTitre(doc, mesure, projection, x, width, cy)
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
    const pct = shareFillPercent(value, projection.unit)
    if (value !== null) {
      setFill(doc, color)
      doc.rect(trackX, yy, trackW * (pct / 100), trackHeight, 'F')
      textePdf(doc, label === 'Groupe comparé' ? (projection.comparisonDisplay ?? 'Indisponible') : projection.display, trackX + trackW + 1.5, yy + 0.6, {
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
  drawTrack(projection.territoryName, projection.value, PALETTE_PDF.brand500, cy)
  cy += 9
  if (options.comparisonProof) {
    drawTrack('Groupe comparé', projection.comparisonValue, PALETTE_PDF.brand200, cy, true)
    cy += 9
  }
  if (projection.stateMessage) {
    cy += dessinerTextePlie(doc, mesure, projection.stateMessage, x, cy, width, {
      police: POLICE_PDF.body,
      taille: TAILLE.note,
      couleur: PALETTE_PDF.muted,
    })
  }
  for (const note of projection.notes) {
    cy += dessinerTextePlie(doc, mesure, note, x, cy + 1, width, {
      police: POLICE_PDF.body,
      taille: TAILLE.note,
      couleur: PALETTE_PDF.muted,
    })
  }
  return cy - y
}

async function dessinerProfil(
  options: OptionsFigurePdf,
  projection: CahierProfileProjection,
): Promise<number> {
  const { doc, x, y, width, mesure } = options
  let cy = y
  cy += dessinerTitre(doc, mesure, projection, x, width, cy)
  if (!projection.types.length) return cy - y
  const count = projection.types.length
  const colonnes = Math.ceil(count / 5)
  const tile = Math.min((width - 4) / colonnes, 6)
  const gridW = tile * colonnes
  const gridH = tile * 5
  const gridX = x + (width - gridW) / 2
  const svg = svgCanvas(gridW, gridH)
  projection.types.forEach((type, index) => {
    const position = waffleGridPosition(index)
    const color = couleurSerie(AEDAR_TIME_MODE_COLORS[type.bucket] ?? (type.bucket === 'inaccessible' ? PALETTE_PDF.textTertiary : PALETTE_PDF.muted))
    svgRect(svg, position.column * tile + 0.4, position.row * tile + 0.4, tile - 0.8, tile - 0.8, color)
  })
  await poserSvg(doc, svg, gridX, cy, gridW, gridH)
  cy += gridH + 2
  const elements = projection.buckets.map((bucket) => ({
    label: `${bucket.label} (${bucket.count})`,
    color: couleurSerie(AEDAR_TIME_MODE_COLORS[bucket.key] ?? (bucket.key === 'inaccessible' ? PALETTE_PDF.textTertiary : PALETTE_PDF.muted)),
    square: true,
  }))
  cy += legendeLigne(doc, mesure, elements, x, cy, width)
  return cy - y
}

async function dessinerCartes(
  options: OptionsFigurePdf,
  projection: CahierMapsProjection,
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
      throw new CahierPdfAssetError(`Carte indisponible pour le PDF : ${item.label}`)
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
      setFill(doc, couleurSerie(color))
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
  return cy - y
}

async function dessinerApercu(
  options: OptionsFigurePdf,
  projection: CahierOverviewProjection,
): Promise<number> {
  const { doc, x, y, width, mesure } = options
  let cy = y
  cy += dessinerTitre(doc, mesure, projection, x, width, cy)
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
  if (projection.maps.status !== 'none') cy += await dessinerCartes(options, projection.maps, cy)
  return cy - y
}

async function dessinerPerteDiversite(
  options: OptionsFigurePdf,
  projection: CahierMapsFigureProjection,
): Promise<number> {
  const { doc, x, y, width, mesure } = options
  let cy = y
  cy += dessinerTitre(doc, mesure, projection, x, width, cy)
  cy += await dessinerCartes(options, projection.maps, cy)
  return cy - y
}

export function hauteurFigurePdf(
  projection: CahierFigureProjection,
  width: number,
  mesure: MesureTexte,
  options?: Pick<OptionsFigurePdf, 'comparisonProof' | 'distributionTitle'>,
): number {
  const titre = hauteurTitre(projection, width, mesure)
  switch (projection.family) {
    case 'aedar-ramps': {
      const panelWidth = width / Math.max(1, projection.ramps.length)
      const titles = Math.max(...projection.ramps.map((ramp) => plierTexte(ramp.title, mesure, {
        police: POLICE_PDF.bodyMedium, taillePt: TAILLE.sousTitre, largeurMax: panelWidth, casserMotsLongs: true,
      }).length))
      const legend = hauteurLegende(mesure, rampLegend(projection, Boolean(options?.comparisonProof)), panelWidth)
      return titles * mesure.hauteurLigne(POLICE_PDF.bodyMedium, TAILLE.sousTitre) * 1.18 + 2 + 42 + 8 + legend
    }
    case 'aedar-equipment-explorer': {
      const panelWidth = width / 2
      const rightTitle = options?.distributionTitle ?? projection.distribution.figure.xAxisTitle
      const titles = Math.max(
        plierTexte(projection.volume.title, mesure, { police: POLICE_PDF.bodyMedium, taillePt: TAILLE.sousTitre, largeurMax: panelWidth, casserMotsLongs: true }).length,
        plierTexte(rightTitle, mesure, { police: POLICE_PDF.bodyMedium, taillePt: TAILLE.sousTitre, largeurMax: panelWidth, casserMotsLongs: true }).length,
      )
      return titles * mesure.hauteurLigne(POLICE_PDF.bodyMedium, TAILLE.sousTitre) * 1.18 + 2 + 42 + 8 + 8
    }
    case 'aedar-car-overview': {
      const scalars = Math.ceil(Math.max(1, projection.scalars.length) / 2) * 22
      const maps = hauteurCartesPdf(projection.maps, width)
      return titre + scalars + maps + 8
    }
    case 'aedar-diversity-loss': return titre + hauteurCartesPdf(projection.maps, width) + 8
    case 'aedar-equipment-profile': {
      if (!projection.types.length) return titre + 4
      const colonnes = Math.ceil(projection.types.length / 5)
      const tile = Math.min((width - 4) / colonnes, 6)
      const legend = hauteurLegende(mesure, projection.buckets.map((bucket) => ({ label: `${bucket.label} (${bucket.count})` })), width)
      return titre + tile * 5 + 8 + legend
    }
    case 'mobilite-bars': {
      const maps = hauteurCartesPdf(projection.maps, width)
      return titre + 2 + 48 + 8 + 8 + maps
    }
    case 'mobilite-share': {
      const lines = projection.notes.length + (projection.stateMessage ? 1 : 0)
      return titre + 40 + lines * 3
    }
    case 'mobilite-curve': return titre + 2 + 45 + 8 + 8
  }
}

export async function dessinerFigurePdf(
  options: OptionsFigurePdf,
  projection: CahierFigureProjection,
): Promise<number> {
  switch (projection.family) {
    case 'aedar-ramps': return dessinerRampes(options, projection)
    case 'aedar-car-overview': return dessinerApercu(options, projection)
    case 'aedar-diversity-loss': return dessinerPerteDiversite(options, projection)
    case 'aedar-equipment-profile': return dessinerProfil(options, projection)
    case 'aedar-equipment-explorer': return dessinerBarresGroupees(options, projection)
    case 'mobilite-bars': {
      if (!options.modeleBars) throw new Error('Modèle natif des barres manquant pour le PDF.')
      return dessinerBarres(options, projection, options.modeleBars)
    }
    case 'mobilite-share': return dessinerPart(options, projection)
    case 'mobilite-curve': return dessinerCourbe(options, projection)
  }
}
