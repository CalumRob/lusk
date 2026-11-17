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
  CAHIER_AEDAR_FIGURE_GEOMETRY,
  CAHIER_FIGURE_STROKE,
  CSS_PX_EN_MM,
  curveGeometry,
  curveSeriesPath,
  cssPxToMm,
  dashArrayMm,
  deriveAedarFigureGeometry,
  mobiliteBarComparisonSegments,
  mobiliteBarGeometry,
  mobiliteBarScale,
  mobiliteBarStackedSegments,
  mobiliteBarTone,
  mobiliteBarXticks,
  mobiliteBarYTicks,
  groupedBarGeometry,
  groupedBarScale,
  groupedBarTickLabel,
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
import type { CahierFigureGeometry, CahierGroupedVerticalBarFigureData } from '@/fiche/cahierFigureGrammaire'
import { CAHIER_FIGURE_AXIS, CAHIER_FIGURE_RAIL, cahierIntegerYAxisScale } from '@/fiche/cahierFigureGrammaire'
import type { MobiliteRaccordementEvidence } from '@/fiche/content/themeContent'
import type { TimeRampPoint } from '@/fiche/content/territoryFacts'
import { AEDAR_TIME_MODE_COLORS, aedarTimeModeColor } from './aedarTimeModeColors'
import { mobiliteBarSegmentColor } from './cahierMobiliteReadings'
import { visibleGroupedBarSeries } from './cahierFigureReadings'
import type { MesureTexte } from './cahierPdfMesure'
import { plierTexte } from './cahierPdfMesure'
import { PALETTE_PDF, couleurPdf, hexVersRgb } from './cahierPdfPalette'
import { POLICE_PDF } from './cahierPdfFonts'
import { CAHIER_TRAVEL_TIME_LABEL } from '@/fiche/content/cahierFigureWording'
import {
  ROLE_PDF,
  RYTHME_PX,
  mmDepuisPt,
  ptDepuisCssPx,
  rythmePt,
} from './cahierPdfGrammaire'

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
  /** Native selected equipment type label: the figcaption's second title line. */
  readonly explorerTypequLabel?: string | null
  /** Native curve model, for the declared grid ticks/axis. */
  readonly modeleCourbe?: MobiliteRaccordementEvidence
  /** Owner-observed served comparative proof for this figure (not capability). */
  readonly comparisonProof?: boolean
}

const TAILLE = {
  titre: ROLE_PDF.titreFigure.taille,
  sousTitre: ROLE_PDF.sousTitreFigure.taille,
  axe: ROLE_PDF.axe.taille,
  tick: ROLE_PDF.tick.taille,
  legende: ROLE_PDF.legende.taille,
  valeur: 14,
  note: 6.2,
} as const

/** Owner mark geometry (`.cahier-figure-legend-mark`, in mm). */
/** Plot bottom → legend row: clears the axis title, then the 10 px legend margin. */
const LEGENDE_APRES_PLOT = mmDepuisPt(16)

const MARQUE = {
  ligneLargeur: mmDepuisPt(ptDepuisCssPx(RYTHME_PX.marqueLargeur)),
  ligneHauteur: mmDepuisPt(ptDepuisCssPx(RYTHME_PX.marqueHauteur)),
  rayon: mmDepuisPt(ptDepuisCssPx(RYTHME_PX.marqueRayon)),
  carre: mmDepuisPt(ptDepuisCssPx(RYTHME_PX.marqueCarre)),
  point: mmDepuisPt(ptDepuisCssPx(RYTHME_PX.marquePoint)),
  trait: mmDepuisPt(ptDepuisCssPx(RYTHME_PX.marqueTraitLargeur)),
  tickLargeur: mmDepuisPt(ptDepuisCssPx(RYTHME_PX.marqueTickLargeur)),
  tickHauteur: mmDepuisPt(ptDepuisCssPx(RYTHME_PX.marqueTickHauteur)),
  gapMarque: mmDepuisPt(rythmePt(RYTHME_PX.legendeGapMarque)),
  gapColonne: mmDepuisPt(rythmePt(RYTHME_PX.legendeGapColonne)),
  gapLigne: mmDepuisPt(rythmePt(RYTHME_PX.legendeGapLigne)),
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
  const espacement = options.espacement ?? 0
  if (!espacement) {
    doc.setCharSpace(0)
    doc.text(texte, x, y, {
      align: options.align ?? 'left',
      baseline: options.baseline ?? 'top',
    })
    return
  }
  // Tracked roles are painted glyph by glyph (the approved generator's own
  // DOM paint), so extraction keeps the word intact and no `Tc` is emitted.
  doc.setCharSpace(0)
  let largeur = 0
  for (const caractere of Array.from(texte)) largeur += doc.getTextWidth(caractere)
  largeur += mmDepuisPt(espacement) * Array.from(texte).length
  const align = options.align ?? 'left'
  // The trailing tracking space after the last glyph is not visible.
  const largeurVisible = Math.max(0, largeur - mmDepuisPt(espacement))
  let cx = align === 'center' ? x - largeurVisible / 2 : align === 'right' ? x - largeurVisible : x
  for (const caractere of Array.from(texte)) {
    doc.text(caractere, cx, y, { baseline: options.baseline ?? 'top' })
    cx += doc.getTextWidth(caractere) + mmDepuisPt(espacement)
  }
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
  if (dash) node.setAttribute('stroke-dasharray', dash)
  if (opacity < 1) node.setAttribute('stroke-opacity', String(opacity))
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
    police: ROLE_PDF.titreFigure.police,
    taillePt: TAILLE.titre,
    largeurMax: width,
    casserMotsLongs: true,
  }).map((ligne) => ligne.texte)
}

function hauteurTitre(projection: CahierFigureProjection, width: number, mesure: MesureTexte): number {
  return titreLignes(projection, width, mesure).length
    * mesure.hauteurLigne(ROLE_PDF.titreFigure.police, TAILLE.titre) * 1.18
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
      police: ROLE_PDF.titreFigure.police,
      taille: TAILLE.titre,
      couleur: PALETTE_PDF.brand700,
      align: 'center',
    })
    cy += mesure.hauteurLigne(ROLE_PDF.titreFigure.police, TAILLE.titre) * 1.18
  }
  return cy - y
}

export type MarqueLegende = 'line' | 'dash' | 'square' | 'dot' | 'tick' | 'slash'

export interface ElementLegende {
  readonly label: string
  /** Series colour of the owner mark; unused by the pure height measure. */
  readonly color?: string
  readonly marker?: MarqueLegende
  /** Legacy callers describe the native mark with a boolean. */
  readonly dash?: boolean
  readonly square?: boolean
}

function marqueDe(element: ElementLegende): MarqueLegende {
  if (element.marker) return element.marker
  if (element.dash) return 'dash'
  if (element.square) return 'square'
  return 'line'
}

function largeurMarque(marker: MarqueLegende): number {
  switch (marker) {
    case 'line':
    case 'dash': return MARQUE.ligneLargeur
    case 'square':
    case 'dot': return MARQUE.carre
    case 'tick': return MARQUE.tickLargeur
    case 'slash': return MARQUE.trait
  }
}

function hauteurMarque(marker: MarqueLegende): number {
  switch (marker) {
    case 'line':
    case 'dash': return MARQUE.ligneHauteur
    case 'square':
    case 'dot': return MARQUE.carre
    case 'tick': return MARQUE.tickHauteur
    case 'slash': return MARQUE.trait
  }
}

function largeurElementLegende(mesure: MesureTexte, element: ElementLegende): number {
  return largeurMarque(marqueDe(element))
    + MARQUE.gapMarque
    + mesure.largeur(element.label, ROLE_PDF.legende.police, TAILLE.legende)
}

function dessinerMarqueLegende(
  doc: jsPDF,
  element: ElementLegende,
  x: number,
  centreY: number,
): void {
  const marker = marqueDe(element)
  const largeur = largeurMarque(marker)
  const hauteur = hauteurMarque(marker)
  const y = centreY - hauteur / 2
  const couleur = element.color ?? PALETTE_PDF.editorialMuted
  switch (marker) {
    case 'line':
      setFill(doc, couleur)
      doc.roundedRect(x, y, largeur, hauteur, MARQUE.rayon, MARQUE.rayon, 'F')
      break
    case 'dash':
      doc.setLineDashPattern([ptDepuisCssPx(3), ptDepuisCssPx(2)].map((pt) => mmDepuisPt(pt)), 0)
      setStroke(doc, couleur)
      doc.setLineWidth(mmDepuisPt(ptDepuisCssPx(2)))
      doc.line(x, centreY, x + largeur, centreY)
      doc.setLineDashPattern([], 0)
      break
    case 'square':
      setFill(doc, couleur)
      doc.rect(x, y, largeur, hauteur, 'F')
      break
    case 'dot':
      setFill(doc, couleur)
      doc.circle(x + largeur / 2, centreY, largeur / 2, 'F')
      break
    case 'tick':
      setStroke(doc, couleur)
      doc.setLineWidth(largeur)
      doc.line(x + largeur / 2, y, x + largeur / 2, y + hauteur)
      break
    case 'slash':
      setStroke(doc, couleur)
      doc.setLineWidth(mmDepuisPt(ptDepuisCssPx(2)))
      doc.circle(x + largeur / 2, centreY, largeur / 2.4, 'S')
      doc.line(x + 1, centreY + hauteur / 2 - 1, x + largeur - 1, centreY - hauteur / 2 + 1)
      break
  }
  resetOpacity(doc)
}

/**
 * The figure's one centred legend row (or centred wrapped rows), as
 * `.cahier-figure-legend { display:flex; flex-wrap:wrap; justify-content:center;
 * gap:8px 18px; font:var(--text-caption) }`. Labels use the metadata face and
 * the muted legend colour; the owner mark keeps the series colour.
 */
function dessinerLegendeFigure(
  doc: jsPDF,
  mesure: MesureTexte,
  elements: readonly ElementLegende[],
  x: number,
  y: number,
  width: number,
): number {
  if (!elements.length) return 0
  const ligneTexte = mesure.hauteurLigne(ROLE_PDF.legende.police, TAILLE.legende) * 1.35
  const hauteurLigne = Math.max(ligneTexte, hauteurMarque('tick'))
  const lignes: ElementLegende[][] = []
  let courant: ElementLegende[] = []
  let largeur = 0
  for (const element of elements) {
    const largeurElement = largeurElementLegende(mesure, element)
    if (courant.length > 0 && largeur + MARQUE.gapColonne + largeurElement > width) {
      lignes.push(courant)
      courant = []
      largeur = 0
    }
    largeur += (courant.length ? MARQUE.gapColonne : 0) + largeurElement
    courant.push(element)
  }
  if (courant.length) lignes.push(courant)

  let cy = y
  for (const [ligneIndex, ligne] of lignes.entries()) {
    const largeurLigne = ligne.reduce((total, element, index) => (
      total + (index ? MARQUE.gapColonne : 0) + largeurElementLegende(mesure, element)
    ), 0)
    // `.cahier-figure-legend` centres the row; the owner marks hang to the left
    // of their label, so centre the *labels* block (the readable row) rather
    // than letting the first mark shift every label right.
    const decalageMarque = largeurMarque(marqueDe(ligne[0]!)) + MARQUE.gapMarque
    let cx = x + (width - largeurLigne) / 2 - decalageMarque / 2
    const centreY = cy + hauteurLigne / 2
    for (const element of ligne) {
      dessinerMarqueLegende(doc, element, cx, centreY)
      textePdf(doc, element.label, cx + largeurMarque(marqueDe(element)) + MARQUE.gapMarque, centreY, {
        police: ROLE_PDF.legende.police,
        taille: TAILLE.legende,
        couleur: PALETTE_PDF.editorialMuted,
        baseline: 'middle',
      })
      cx += largeurElementLegende(mesure, element) + MARQUE.gapColonne
    }
    cy += hauteurLigne + (ligneIndex < lignes.length - 1 ? MARQUE.gapLigne : 0)
  }
  return cy - y
}

function hauteurLegende(
  mesure: MesureTexte,
  elements: readonly ElementLegende[],
  width: number,
): number {
  if (!elements.length) return 0
  const ligneTexte = mesure.hauteurLigne(ROLE_PDF.legende.police, TAILLE.legende) * 1.35
  const hauteurLigne = Math.max(ligneTexte, hauteurMarque('tick'))
  let largeur = 0
  let lignes = 1
  for (const element of elements) {
    const largeurElement = largeurElementLegende(mesure, element)
    if (largeur > 0 && largeur + MARQUE.gapColonne + largeurElement > width) {
      lignes += 1
      largeur = 0
    }
    largeur += (largeur > 0 ? MARQUE.gapColonne : 0) + largeurElement
  }
  return lignes * hauteurLigne + (lignes - 1) * MARQUE.gapLigne
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

/**
 * Native `.cahier-grouped-vertical-bar-chart__bar { fill-opacity: .78 }`.
 * The painter keeps the series ink and sets the native shape alpha, so the
 * grid beneath the bar shows through exactly as it does on screen.
 */
const OPACITE_BARRES_GROUPEES = 0.78

/**
 * Native plot box of the two AEDAR families, read from the shared owner that
 * both mounted components import. The PDF maps this box to the panel width and
 * reads every stroke and label position from it, instead of a parallel
 * 96 dpi millimetre policy.
 */
const GEOMETRIE_NATIVE_AEDAR = CAHIER_AEDAR_FIGURE_GEOMETRY

/** Native label offset of the AEDAR figures (`CahierFigureAxisLabels`, 8 px). */
const DECALAGE_ETIQUETTE_X = 8

/**
 * Measured gap between two side-by-side AEDAR panels. The painter's single
 * source for panel width, consumed by the native-paint geometry test.
 */
export const GAP_PANNEAUX_FIGURE_MM = 6

/** Native x-axis title baseline: plot bottom + this role offset (`-0.6`). */
export const AXE_TITRE_BAS_MM = 0.6

function hauteurPanneauAedar(largeurPanneau: number): number {
  return largeurPanneau * GEOMETRIE_NATIVE_AEDAR.height / GEOMETRIE_NATIVE_AEDAR.width
}

/**
 * The native y rail measured with the embedded face. `deriveAedarFigureGeometry`
 * is the same rule the browser applies (`useMeasuredCahierFigureGeometry`):
 * title lane + longest rendered label + label gap, in native user units.
 */
function geometrieAedarMesuree(
  panelWidth: number,
  labels: readonly (string | null)[],
  mesure: MesureTexte,
): CahierFigureGeometry {
  const largeurMm = Math.max(0, ...labels
    .filter((label): label is string => label !== null)
    .map((label) => mesure.largeur(
      label,
      ROLE_PDF.tick.police,
      TAILLE.tick,
      TAILLE.tick * ROLE_PDF.tick.espacementEm,
    )))
  // The native rule counts the title lane and the label gap in the same user
  // units as the viewBox: convert the embedded-face label width to user units
  // and apply the shared derivation at the native 640-unit width.
  const largeurUser = largeurMm * GEOMETRIE_NATIVE_AEDAR.width / panelWidth
  return deriveAedarFigureGeometry(GEOMETRIE_NATIVE_AEDAR, GEOMETRIE_NATIVE_AEDAR.width, largeurUser)
}

/**
 * Axis labels/titles of one AEDAR panel, placed from the native viewBox.
 *
 * The `.type-figure-label` role uppercases its text (`text-transform`) and adds
 * 0.08em of tracking; both are painted here because a PDF has no CSS cascade.
 * Sizes stay at the document role scale (they do not shrink with the panel);
 * only positions follow the figure's own transform.
 */
function dessinerAxesAedar(
  doc: jsPDF,
  mesure: MesureTexte,
  options: {
    x: number
    y: number
    panelWidth: number
    geometry: CahierFigureGeometry
    xTicks: readonly { key: string | number; position: number; label: string | null }[]
    yTicks: readonly { key: string | number; position: number; label: string | null }[]
    xTitle: string
    yTitle: string
  },
): void {
  const { x, y, panelWidth, xTicks, yTicks, xTitle, yTitle } = options
  const native = options.geometry
  const echelle = panelWidth / native.width
  const u = (value: number) => value * echelle
  const tickSpace = ROLE_PDF.tick.taille * ROLE_PDF.tick.espacementEm
  for (const tick of yTicks) {
    if (tick.label === null) continue
    // `CahierFigureAxisLabels`: the y label's right edge sits on the measured
    // rail (`margin.left`) and its line box is centred on the tick + 4 px.
    textePdf(doc, tick.label, x + u(native.margin.left), y + u(tick.position + CAHIER_FIGURE_AXIS.yLabelBaseline), {
      police: ROLE_PDF.tick.police,
      taille: TAILLE.tick,
      couleur: PALETTE_PDF.editorialMuted,
      align: 'right',
      baseline: 'middle',
      espacement: tickSpace,
    })
  }
  const xLabelY = y + u(native.height - native.margin.bottom + DECALAGE_ETIQUETTE_X)
  for (const tick of xTicks) {
    if (tick.label === null) continue
    textePdf(doc, tick.label, x + u(tick.position), xLabelY, {
      police: ROLE_PDF.tick.police,
      taille: TAILLE.tick,
      couleur: PALETTE_PDF.editorialMuted,
      align: 'center',
      espacement: tickSpace,
    })
  }
  // `.cahier-figure-axis-title`: font `--type-figure-label`, uppercase, 0.08em.
  const titreX = xTitle.toLocaleUpperCase('fr-FR')
  textePdf(doc, titreX, x + u(native.margin.left) + (
    u(native.width - native.margin.left - native.margin.right) / 2
  ), y + u(native.height) - AXE_TITRE_BAS_MM, {
    police: ROLE_PDF.axe.police,
    taille: TAILLE.axe,
    couleur: PALETTE_PDF.editorialMuted,
    align: 'center',
    baseline: 'alphabetic',
    espacement: TAILLE.axe * ROLE_PDF.axe.espacementEm,
  })
  const titreY = yTitle.toLocaleUpperCase('fr-FR')
  const titreWidth = mesure.largeur(
    titreY,
    ROLE_PDF.axe.police,
    TAILLE.axe,
    TAILLE.axe * ROLE_PDF.axe.espacementEm,
  )
  const plotMilieu = u(native.margin.top + (native.height - native.margin.top - native.margin.bottom) / 2)
  doc.saveGraphicsState()
  doc.setFont(ROLE_PDF.axe.police, 'normal')
  doc.setFontSize(TAILLE.axe)
  doc.setTextColor(...rgb(PALETTE_PDF.editorialMuted))
  doc.setCharSpace(mmDepuisPt(TAILLE.axe * ROLE_PDF.axe.espacementEm))
  // The native run is centred in the 16 px title lane (`left: 0 + 8px;
  // translate(-50%, -50%) rotate(-90deg)`), so its rotated alphabetic baseline
  // sits on the lane's outer edge: R1 measures ink 39.08–46.65 for a panel at
  // 38.84 (lane 16 px), which this anchor reproduces.
  doc.text(titreY, x + u(CAHIER_FIGURE_RAIL.titleLane), y + plotMilieu + titreWidth / 2, { angle: 90 })
  doc.setCharSpace(0)
  doc.restoreGraphicsState()
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
  const tickSpace = ROLE_PDF.tick.taille * ROLE_PDF.tick.espacementEm
  for (const tick of yTicks) {
    if (tick.label === null) continue
    textePdf(doc, tick.label, x + plotLeft - 1.4, y + tick.position - 2, {
      police: ROLE_PDF.tick.police,
      taille: TAILLE.tick,
      couleur: PALETTE_PDF.editorialMuted,
      align: 'right',
      espacement: tickSpace,
    })
  }
  for (const tick of xTicks) {
    if (tick.label === null) continue
    textePdf(doc, tick.label, x + tick.position, y + plotBottom + 1, {
      police: ROLE_PDF.tick.police,
      taille: TAILLE.tick,
      couleur: PALETTE_PDF.editorialMuted,
      align: 'center',
      espacement: tickSpace,
    })
  }
  textePdf(doc, xTitle, x + plotLeft + plotWidth / 2, y + plotBottom + 5.2, {
    police: ROLE_PDF.axe.police,
    taille: TAILLE.axe,
    couleur: PALETTE_PDF.editorialMuted,
    align: 'center',
    espacement: TAILLE.axe * ROLE_PDF.axe.espacementEm,
  })
  doc.saveGraphicsState()
  // jsPDF's center alignment subtracts half the unrotated width from x before
  // rotation. Center along the rotated baseline instead, keeping the label in
  // its own panel and clear of the neighbouring panel's title.
  const titleWidth = mesure.largeur(
    yTitle,
    ROLE_PDF.axe.police,
    TAILLE.axe,
    TAILLE.axe * ROLE_PDF.axe.espacementEm,
  )
  const tickWidth = Math.max(0, ...yTicks.map((tick) => mesure.largeur(tick.label ?? '', ROLE_PDF.tick.police, TAILLE.tick, TAILLE.tick * ROLE_PDF.tick.espacementEm)))
  doc.setFont(ROLE_PDF.axe.police, 'normal')
  doc.setFontSize(TAILLE.axe)
  doc.setTextColor(...rgb(PALETTE_PDF.editorialMuted))
  // The approved vertical axis title is one rotated run (desktop.js), so a
  // reader keeps the whole role name; char space is converted to the document
  // unit (jsPDF's `Tc` takes the doc unit, the role owns points).
  doc.setCharSpace(mmDepuisPt(TAILLE.axe * ROLE_PDF.axe.espacementEm))
  doc.text(yTitle, x + plotLeft - tickWidth - 3.2, y + height / 2 + titleWidth / 2, { angle: 90 })
  doc.setCharSpace(0)
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
      color: couleurSerie(aedarTimeModeColor(serie.key)),
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
  const gap = GAP_PANNEAUX_FIGURE_MM
  const panelWidth = (width - gap * (nombre - 1)) / nombre
  const panelHeight = hauteurPanneauAedar(panelWidth)
  const panelTitles = projection.ramps.map((ramp) => plierTexte(ramp.title, mesure, {
    police: ROLE_PDF.sousTitreFigure.police,
    taillePt: TAILLE.sousTitre,
    largeurMax: panelWidth,
    casserMotsLongs: true,
  }).map((ligne) => ligne.texte))
  const titleHeight = Math.max(...panelTitles.map((lines) => lines.length))
    * mesure.hauteurLigne(ROLE_PDF.sousTitreFigure.police, TAILLE.sousTitre) * 1.18
  let bas = y + titleHeight
  for (let index = 0; index < projection.ramps.length; index += 1) {
    const ramp = projection.ramps[index]!
    const px = x + index * (panelWidth + gap)
    let py = y
    for (const ligne of panelTitles[index]!) {
      textePdf(doc, ligne, px + panelWidth / 2, py, {
        police: ROLE_PDF.sousTitreFigure.police,
        taille: TAILLE.sousTitre,
        couleur: PALETTE_PDF.brand700,
        align: 'center',
      })
      py += mesure.hauteurLigne(ROLE_PDF.sousTitreFigure.police, TAILLE.sousTitre) * 1.18
    }
    const panelScale = cahierIntegerYAxisScale(ramp.series.flatMap((serie) =>
      serie.points.flatMap((point) => [point.value, point.referenceValue])))
    const firstSeries = ramp.series[0]!
    // Measure the native rail with the embedded face before placing the plot:
    // long unit labels (`40 établissements`) widen the left margin exactly as
    // `AccessRampFigureCahier` does in the browser.
    const plentyTicks = rampGeometry(
      rampPoints(firstSeries), panelScale, GEOMETRIE_NATIVE_AEDAR, ramp.yAxis.unit,
    ).yTicks
    const native = geometrieAedarMesuree(panelWidth, plentyTicks.map((tick) => tick.label), mesure)
    const geom = rampGeometry(rampPoints(firstSeries), panelScale, native, ramp.yAxis.unit)
    const plotBottom = native.height - native.margin.bottom
    const plotRight = native.width - native.margin.right
    const svg = svgCanvas(native.width, native.height)
    for (const tick of geom.yTicks) {
      svgLine(svg, native.margin.left, tick.position, plotRight, tick.position, PALETTE_PDF.figureGrid, CAHIER_FIGURE_STROKE.gridWidthPx)
    }
    // Native access-ramp grid draws one vertical line per time cut on both axes.
    for (const tick of geom.xTicks) {
      svgLine(svg, tick.position, native.margin.top, tick.position, plotBottom, PALETTE_PDF.figureGrid, CAHIER_FIGURE_STROKE.gridWidthPx)
    }
    svgLine(
      svg,
      native.margin.left,
      plotBottom,
      plotRight,
      plotBottom,
      PALETTE_PDF.figureAxis,
      CAHIER_FIGURE_STROKE.axisWidthPx,
    )
    for (const serie of ramp.series) {
      const color = couleurSerie(aedarTimeModeColor(serie.key))
      const points = rampPoints(serie)
      for (const path of rampPaths(points, (point) => point.value, geom.x, geom.y)) {
        const node = document.createElementNS('http://www.w3.org/2000/svg', 'path')
        node.setAttribute('d', path)
        node.setAttribute('fill', 'none')
        node.setAttribute('stroke', color)
        node.setAttribute('stroke-width', String(CAHIER_FIGURE_STROKE.widthPx))
        node.setAttribute('stroke-linecap', CAHIER_FIGURE_STROKE.linecap)
        node.setAttribute('stroke-linejoin', CAHIER_FIGURE_STROKE.linejoin)
        svg.append(node)
      }
      for (const path of rampPaths(points, (point) => point.referenceValue, geom.x, geom.y)) {
        const node = document.createElementNS('http://www.w3.org/2000/svg', 'path')
        node.setAttribute('d', path)
        node.setAttribute('fill', 'none')
        node.setAttribute('stroke', color)
        node.setAttribute('stroke-width', String(CAHIER_FIGURE_STROKE.comparisonWidthPx))
        node.setAttribute('stroke-opacity', String(CAHIER_FIGURE_STROKE.comparisonOpacity))
        node.setAttribute('stroke-dasharray', CAHIER_FIGURE_STROKE.comparisonDashPx.join(' '))
        node.setAttribute('stroke-linecap', CAHIER_FIGURE_STROKE.linecap)
        node.setAttribute('stroke-linejoin', CAHIER_FIGURE_STROKE.linejoin)
        svg.append(node)
      }
      // The native ramp paints paths only: no invented point marker.
    }
    await poserSvg(doc, svg, px, py + 2, panelWidth, panelHeight)
    dessinerAxesAedar(doc, mesure, {
      x: px,
      y: py + 2,
      panelWidth,
      geometry: native,
      xTicks: geom.xTicks,
      yTicks: geom.yTicks,
      xTitle: ramp.xAxis.label,
      yTitle: titreAvecUnite(ramp.yAxis.label, ramp.yAxis.unit),
    })
    bas = Math.max(bas, py + 2 + panelHeight)
  }
  // One centred legend for the whole figure, not one per panel.
  const legend = dessinerLegendeFigure(
    doc,
    mesure,
    rampLegend(projection, Boolean(options.comparisonProof)),
    x,
    bas + LEGENDE_APRES_PLOT,
    width,
  )
  return bas + LEGENDE_APRES_PLOT + legend - y
}

async function dessinerCourbe(
  options: OptionsFigurePdf,
  projection: CahierCurveProjection,
): Promise<number> {
  if (!options.modeleCourbe) throw new Error('Modèle natif de courbe manquant pour le PDF.')
  const modeleCourbe = options.modeleCourbe
  const { doc, x, y, width, mesure } = options
  let cy = y
  cy += dessinerTitre(doc, mesure, projection, x, width, cy)
  const plotHeight = 45
  const plotWidth = width - 11
  const plotX = x + 9
  const plotY = cy + 2
  const nativeGeometry = { width: plotWidth, height: plotHeight, margin: { top: 2, right: 2, bottom: 2, left: 9 } } as const
  // After the guard the native curve model is the only axis owner: no parallel
  // scale, tick or projection fallback may exist in the painter.
  const native = curveGeometry(modeleCourbe, nativeGeometry)
  const ticks = visibleCurveTicks(
    native.xTicks,
    plotWidth / CSS_PX_EN_MM,
    plotWidth,
    projection.marker?.detail ?? null,
    (label) => mesure.largeur(label ?? '', ROLE_PDF.tick.police, TAILLE.tick, TAILLE.tick * ROLE_PDF.tick.espacementEm) / CSS_PX_EN_MM,
    new Set((modeleCourbe.trajectory?.ticks ?? [])
      .filter((tick) => tick.mobile === true)
      .map((tick) => tick.detail)),
  )
  const yTicks = native.yTicks
  const svg = svgCanvas(plotWidth, plotHeight)
  for (const tick of yTicks) {
    svgLine(svg, nativeGeometry.margin.left, tick.position, plotWidth - nativeGeometry.margin.right, tick.position, PALETTE_PDF.figureGrid, cssPxToMm(CAHIER_FIGURE_STROKE.gridWidthPx))
  }
  // Native curve grid keeps every declared x tick as a vertical gridline.
  for (const tick of native.xTicks) {
    svgLine(svg, tick.position, nativeGeometry.margin.top, tick.position, plotHeight - nativeGeometry.margin.bottom, PALETTE_PDF.figureGrid, cssPxToMm(CAHIER_FIGURE_STROKE.gridWidthPx))
  }
  svgLine(svg, nativeGeometry.margin.left, plotHeight - nativeGeometry.margin.bottom, plotWidth - nativeGeometry.margin.right, plotHeight - nativeGeometry.margin.bottom, PALETTE_PDF.figureAxis, cssPxToMm(CAHIER_FIGURE_STROKE.axisWidthPx))
  const focalPath = curveSeriesPath(modeleCourbe.points, modeleCourbe, native)
  if (focalPath) {
    const node = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    node.setAttribute('d', focalPath)
    node.setAttribute('fill', 'none')
    node.setAttribute('stroke', PALETTE_PDF.brand500)
    node.setAttribute('stroke-width', String(cssPxToMm(CAHIER_FIGURE_STROKE.widthPx)))
    node.setAttribute('stroke-linecap', CAHIER_FIGURE_STROKE.linecap)
    node.setAttribute('stroke-linejoin', CAHIER_FIGURE_STROKE.linejoin)
    svg.append(node)
  }
  if (options.comparisonProof && modeleCourbe.comparison) {
    const referencePath = curveSeriesPath(modeleCourbe.comparison.points, modeleCourbe, native)
    if (referencePath) {
      const node = document.createElementNS('http://www.w3.org/2000/svg', 'path')
      node.setAttribute('d', referencePath)
      node.setAttribute('fill', 'none')
      node.setAttribute('stroke', PALETTE_PDF.brand200)
      node.setAttribute('stroke-width', String(cssPxToMm(CAHIER_FIGURE_STROKE.comparisonWidthPx)))
      node.setAttribute('stroke-opacity', String(CAHIER_FIGURE_STROKE.comparisonOpacity))
      node.setAttribute('stroke-dasharray', dashArrayMm(CAHIER_FIGURE_STROKE.comparisonDashPx))
      node.setAttribute('stroke-linecap', CAHIER_FIGURE_STROKE.linecap)
      node.setAttribute('stroke-linejoin', CAHIER_FIGURE_STROKE.linejoin)
      svg.append(node)
    }
  }
  if (projection.marker && projection.marker.axisValue !== null) {
    // The declared marker is placed by the same native curve projection as the
    // series and grid, never by a second recomputed axis mapping.
    const mx = native.x(projection.marker.axisValue)
    svgLine(
      svg,
      mx,
      nativeGeometry.margin.top,
      mx,
      plotHeight - nativeGeometry.margin.bottom,
      PALETTE_PDF.muted,
      cssPxToMm(CAHIER_FIGURE_STROKE.markerWidthPx),
      dashArrayMm(CAHIER_FIGURE_STROKE.markerDashPx),
    )
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
    { label: 'Valeur du territoire', color: PALETTE_PDF.brand500, marker: 'line' as const },
    ...(options.comparisonProof ? [{ label: 'Groupe comparé', color: PALETTE_PDF.brand200, marker: 'dash' as const }] : []),
  ]
  const legendY = plotY + plotHeight + LEGENDE_APRES_PLOT
  return legendY + dessinerLegendeFigure(doc, mesure, legend, x, legendY, width) - y
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
    svgLine(svg, nativeGeometry.margin.left, tick.position, width - nativeGeometry.margin.right, tick.position, PALETTE_PDF.figureGrid, cssPxToMm(CAHIER_FIGURE_STROKE.gridWidthPx))
  }
  svgLine(svg, nativeGeometry.margin.left, plotBottom, width - nativeGeometry.margin.right, plotBottom, PALETTE_PDF.figureAxis, cssPxToMm(CAHIER_FIGURE_STROKE.axisWidthPx))
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
      marker: 'square' as const,
    }))),
    ...(comparisonAligned
      ? [{ label: 'Groupe comparé', color: couleurSerie('color-mix(in srgb, var(--cahier-theme-strong) 45%, var(--paper))'), marker: 'square' as const }]
      : []),
  ]
  const legendY = cy + 2 + nativeGeometry.height + LEGENDE_APRES_PLOT
  const legendHeight = dessinerLegendeFigure(doc, mesure, legend, x, legendY, width)
  let bas = legendY + legendHeight
  if (projection.maps && projection.maps.status !== 'none') {
    bas += await dessinerCartes(options, projection.maps, bas + 2)
  }
  return bas - y
}

/** Gap between the selected-horizon caption and the panel titles. */
const APRES_HORIZON_MM = 2

/**
 * Selected-horizon caption of the equipment explorer. It states the captured
 * horizon (`projection.horizonMinutes`) independently of the x-axis ticks; the
 * label is the mounted `CahierTravelTimeLabel` wording and the value is the
 * capture's own served horizon, never a recomputation or a fixed `15`.
 */
function dessinerHorizonExplorer(
  doc: jsPDF,
  mesure: MesureTexte,
  horizonMinutes: number | null,
  x: number,
  y: number,
  width: number,
): number {
  if (horizonMinutes === null) return 0
  const label = CAHIER_TRAVEL_TIME_LABEL.toLocaleUpperCase('fr-FR')
  const value = `${horizonMinutes} min`
  const tracking = TAILLE.axe * ROLE_PDF.axe.espacementEm
  const labelWidth = mesure.largeur(label, ROLE_PDF.axe.police, TAILLE.axe, tracking)
  const valueWidth = mesure.largeur(value, POLICE_PDF.bodyStrong, TAILLE.axe)
  const gap = mmDepuisPt(rythmePt(8))
  const start = x + width / 2 - (labelWidth + gap + valueWidth) / 2
  textePdf(doc, label, start, y, {
    police: ROLE_PDF.axe.police,
    taille: TAILLE.axe,
    couleur: PALETTE_PDF.editorialMuted,
    espacement: tracking,
  })
  textePdf(doc, value, start + labelWidth + gap, y, {
    police: POLICE_PDF.bodyStrong,
    taille: TAILLE.axe,
    couleur: PALETTE_PDF.ink,
  })
  return mesure.hauteurLigne(ROLE_PDF.axe.police, TAILLE.axe) * 1.18 + APRES_HORIZON_MM
}

async function dessinerBarresGroupees(
  options: OptionsFigurePdf,
  projection: CahierExplorerProjection,
): Promise<number> {
  const { doc, x, y, width, mesure } = options
  const gap = GAP_PANNEAUX_FIGURE_MM
  const panelWidth = (width - gap) / 2
  const panelHeight = hauteurPanneauAedar(panelWidth)
  const subtitle = options.explorerTypequLabel ?? null
  const horizonHeight = dessinerHorizonExplorer(doc, mesure, projection.horizonMinutes, x, y, width)
  const panelsY = y + horizonHeight
  const plierTitre = (title: string) => plierTexte(title, mesure, {
    police: ROLE_PDF.sousTitreFigure.police,
    taillePt: TAILLE.sousTitre,
    largeurMax: panelWidth,
    casserMotsLongs: true,
  }).map((ligne) => ligne.texte)
  const avecSousTitre = (lines: string[]) => [
    ...lines,
    ...(subtitle ? plierTitre(subtitle) : []),
  ]
  // Native figcaption: two stacked spans (figure title + selected equipment type).
  const leftTitle = avecSousTitre(plierTitre(projection.volume.title))
  const rightTitle = avecSousTitre(plierTitre(
    options.distributionTitle ?? projection.distribution.figure.xAxisTitle,
  ))
  const dessinerTitres = (lines: readonly string[], originX: number, originY: number): number => {
    let cy = originY
    for (const line of lines) {
      textePdf(doc, line, originX + panelWidth / 2, cy, {
        police: ROLE_PDF.sousTitreFigure.police,
        taille: TAILLE.sousTitre,
        couleur: PALETTE_PDF.brand700,
        align: 'center',
      })
      cy += mesure.hauteurLigne(ROLE_PDF.sousTitreFigure.police, TAILLE.sousTitre) * 1.18
    }
    return cy
  }
  const drawGrouped = async (
    originX: number,
    figure: CahierGroupedVerticalBarFigureData,
    hidden: readonly string[],
    titleLines: readonly string[],
    unit: string,
  ) => {
    const cy = dessinerTitres(titleLines, originX, panelsY)
    const visible = visibleGroupedBarSeries(figure, hidden)
    const scale = groupedBarScaleFromFigure(visible)
    const tickLabels = scale.ticks.map((value) => groupedBarTickLabel(figure, value))
    const native = geometrieAedarMesuree(panelWidth, tickLabels, mesure)
    const plotBottom = native.height - native.margin.bottom
    const plotRight = native.width - native.margin.right
    const bar = groupedBarGeometryFromFigure(native, figure.categories.length, visible.length, scale)
    const ticks = groupedBarTicksFromFigure(figure, native, bar, scale)
    const svg = svgCanvas(native.width, native.height)
    for (const tick of ticks.y) {
      svgLine(svg, native.margin.left, tick.position, plotRight, tick.position, PALETTE_PDF.figureGrid, CAHIER_FIGURE_STROKE.gridWidthPx)
    }
    svgLine(svg, native.margin.left, plotBottom, plotRight, plotBottom, PALETTE_PDF.figureAxis, CAHIER_FIGURE_STROKE.axisWidthPx)
    const yFor = (value: number) => native.margin.top
      + (1 - (value - scale.minimum) / (scale.maximum - scale.minimum))
      * (native.height - native.margin.top - native.margin.bottom)
    visible.forEach((series, seriesIndex) => {
      figure.categories.forEach((_category, categoryIndex) => {
        const value = series.values[categoryIndex]
        if (value === null || value === undefined || !Number.isFinite(value)) return
        svgRect(
          svg,
          bar.x(categoryIndex, seriesIndex),
          Math.min(yFor(value), yFor(0)),
          bar.barWidth,
          bar.height(value),
          // Native `.cahier-grouped-vertical-bar-chart__bar { fill-opacity: .78 }`:
          // the bar keeps its own ink and the grid beneath shows through.
          couleurSerie(series.color),
          OPACITE_BARRES_GROUPEES,
        )
      })
    })
    await poserSvg(doc, svg, originX, cy + 2, panelWidth, panelHeight)
    dessinerAxesAedar(doc, mesure, {
      x: originX,
      y: cy + 2,
      panelWidth,
      geometry: native,
      xTicks: ticks.x,
      yTicks: ticks.y,
      xTitle: figure.xAxisTitle,
      yTitle: titreAvecUnite(figure.yAxisTitle, unit),
    })
    // The native grouped chart has no legend of its own; the explorer's one
    // shared mode legend is painted once under the whole figure below.
    return cy + 2 + panelHeight
  }
  const leftBottom = await (async () => {
    const cy = dessinerTitres(leftTitle, x, panelsY)
    const values = projection.volume.series.flatMap((serie) =>
      serie.points.flatMap((point) => [point.value, point.referenceValue]))
    const scale = cahierIntegerYAxisScale(values)
    const first = projection.volume.series[0]!
    const points = rampPoints(first)
    const libelles = rampGeometry(points, scale, GEOMETRIE_NATIVE_AEDAR, projection.volume.yAxis.unit)
      .yTicks.map((tick) => tick.label)
    const native = geometrieAedarMesuree(panelWidth, libelles, mesure)
    const geom = rampGeometry(points, scale, native, projection.volume.yAxis.unit)
    const plotBottom = native.height - native.margin.bottom
    const plotRight = native.width - native.margin.right
    const svg = svgCanvas(native.width, native.height)
    for (const tick of geom.yTicks) {
      svgLine(svg, native.margin.left, tick.position, plotRight, tick.position, PALETTE_PDF.figureGrid, CAHIER_FIGURE_STROKE.gridWidthPx)
    }
    // The volume ramp is the same native ramp grammar: vertical grid per cut.
    for (const tick of geom.xTicks) {
      svgLine(svg, tick.position, native.margin.top, tick.position, plotBottom, PALETTE_PDF.figureGrid, CAHIER_FIGURE_STROKE.gridWidthPx)
    }
    svgLine(svg, native.margin.left, plotBottom, plotRight, plotBottom, PALETTE_PDF.figureAxis, CAHIER_FIGURE_STROKE.axisWidthPx)
    for (const serie of projection.volume.series) {
      const color = couleurSerie(aedarTimeModeColor(serie.key))
      const seriePoints = rampPoints(serie)
      for (const path of rampPaths(seriePoints, (point) => point.value, geom.x, geom.y)) {
        const node = document.createElementNS('http://www.w3.org/2000/svg', 'path')
        node.setAttribute('d', path)
        node.setAttribute('fill', 'none')
        node.setAttribute('stroke', color)
        node.setAttribute('stroke-width', String(CAHIER_FIGURE_STROKE.widthPx))
        node.setAttribute('stroke-linecap', CAHIER_FIGURE_STROKE.linecap)
        node.setAttribute('stroke-linejoin', CAHIER_FIGURE_STROKE.linejoin)
        svg.append(node)
      }
      // The native volume ramp draws its displayed reference layer as dashed
      // paths in the series colour, exactly like the access ramps.
      for (const path of rampPaths(seriePoints, (point) => point.referenceValue, geom.x, geom.y)) {
        const node = document.createElementNS('http://www.w3.org/2000/svg', 'path')
        node.setAttribute('d', path)
        node.setAttribute('fill', 'none')
        node.setAttribute('stroke', color)
        node.setAttribute('stroke-width', String(CAHIER_FIGURE_STROKE.comparisonWidthPx))
        node.setAttribute('stroke-opacity', String(CAHIER_FIGURE_STROKE.comparisonOpacity))
        node.setAttribute('stroke-dasharray', CAHIER_FIGURE_STROKE.comparisonDashPx.join(' '))
        node.setAttribute('stroke-linecap', CAHIER_FIGURE_STROKE.linecap)
        node.setAttribute('stroke-linejoin', CAHIER_FIGURE_STROKE.linejoin)
        svg.append(node)
      }
      // No invented point markers on the native ramp.
    }
    await poserSvg(doc, svg, x, cy + 2, panelWidth, panelHeight)
    dessinerAxesAedar(doc, mesure, {
      x,
      y: cy + 2,
      panelWidth,
      geometry: native,
      xTicks: geom.xTicks,
      yTicks: geom.yTicks,
      xTitle: projection.volume.xAxis.label,
      yTitle: titreAvecUnite(projection.volume.yAxis.label, projection.volume.yAxis.unit),
    })
    return cy + 2 + panelHeight
  })()
  const rightBottom = await drawGrouped(x + panelWidth + gap, projection.distribution.figure, projection.distribution.hiddenSeriesKeys, rightTitle, options.distributionUnit ?? '')
  const legend = [
    ...projection.volume.series.map((serie) => ({
      label: serie.label,
      color: couleurSerie(aedarTimeModeColor(serie.key)),
      marker: 'line' as const,
    })),
    ...(options.comparisonProof
      ? [{ label: 'Groupe comparé', color: PALETTE_PDF.editorialMuted, marker: 'dash' as const }]
      : []),
  ]
  const legendY = Math.max(leftBottom, rightBottom) + LEGENDE_APRES_PLOT
  return legendY + dessinerLegendeFigure(doc, mesure, legend, x, legendY, width) - y
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
    groupedBarTickLabel(figure, value))
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
    marker: 'square' as const,
  }))
  cy += dessinerLegendeFigure(doc, mesure, elements, x, cy, width)
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
  options?: Pick<OptionsFigurePdf, 'comparisonProof' | 'distributionTitle' | 'modeleBars' | 'explorerTypequLabel'>,
): number {
  const titre = hauteurTitre(projection, width, mesure)
  const gapLegende = LEGENDE_APRES_PLOT
  switch (projection.family) {
    case 'aedar-ramps': {
      const gap = GAP_PANNEAUX_FIGURE_MM
      const nominal = Math.max(1, projection.ramps.length)
      const panelWidth = (width - gap * (nominal - 1)) / nominal
      const titles = Math.max(...projection.ramps.map((ramp) => plierTexte(ramp.title, mesure, {
        police: ROLE_PDF.sousTitreFigure.police, taillePt: TAILLE.sousTitre, largeurMax: panelWidth, casserMotsLongs: true,
      }).length))
      const legend = hauteurLegende(mesure, rampLegend(projection, Boolean(options?.comparisonProof)), width)
      return titles * mesure.hauteurLigne(ROLE_PDF.sousTitreFigure.police, TAILLE.sousTitre) * 1.18
        + 2 + hauteurPanneauAedar(panelWidth) + gapLegende + legend
    }
    case 'aedar-equipment-explorer': {
      const gap = GAP_PANNEAUX_FIGURE_MM
      const panelWidth = (width - gap) / 2
      const rightTitle = options?.distributionTitle ?? projection.distribution.figure.xAxisTitle
      const subtitleLines = options?.explorerTypequLabel
        ? plierTexte(options.explorerTypequLabel, mesure, {
          police: ROLE_PDF.sousTitreFigure.police, taillePt: TAILLE.sousTitre, largeurMax: panelWidth, casserMotsLongs: true,
        }).length
        : 0
      const titles = Math.max(
        plierTexte(projection.volume.title, mesure, { police: ROLE_PDF.sousTitreFigure.police, taillePt: TAILLE.sousTitre, largeurMax: panelWidth, casserMotsLongs: true }).length,
        plierTexte(rightTitle, mesure, { police: ROLE_PDF.sousTitreFigure.police, taillePt: TAILLE.sousTitre, largeurMax: panelWidth, casserMotsLongs: true }).length,
      ) + subtitleLines
      const horizon = projection.horizonMinutes === null
        ? 0
        : mesure.hauteurLigne(ROLE_PDF.axe.police, TAILLE.axe) * 1.18 + APRES_HORIZON_MM
      const legend = hauteurLegende(mesure, [
        ...projection.volume.series.map((serie) => ({ label: serie.label, color: couleurSerie(aedarTimeModeColor(serie.key)) })),
        ...(options?.comparisonProof ? [{ label: 'Groupe comparé', color: PALETTE_PDF.editorialMuted, dash: true }] : []),
      ], width)
      return horizon + titles * mesure.hauteurLigne(ROLE_PDF.sousTitreFigure.police, TAILLE.sousTitre) * 1.18
        + 2 + hauteurPanneauAedar(panelWidth) + gapLegende + legend
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
      return titre + tile * 5 + 2 + legend
    }
    case 'mobilite-bars': {
      const maps = hauteurCartesPdf(projection.maps, width)
      const modele = options?.modeleBars
      const legend = modele
        ? hauteurLegende(mesure, modele.categories.flatMap((category) => [
          ...category.segments.map((segment) => ({ label: segment.legendLabel ?? segment.label })),
          ...(category.segments.length ? [] : [{ label: category.label }]),
        ]), width)
        : 8
      return titre + 2 + 48 + gapLegende + legend + maps
    }
    case 'mobilite-share': {
      const lines = projection.notes.length + (projection.stateMessage ? 1 : 0)
      return titre + 40 + lines * 3
    }
    case 'mobilite-curve': {
      const legend = hauteurLegende(mesure, [
        { label: 'Valeur du territoire' },
        ...(options?.comparisonProof ? [{ label: 'Groupe comparé' }] : []),
      ], width)
      return titre + 2 + 45 + gapLegende + legend
    }
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
