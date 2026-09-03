/**
 * La grammaire visuelle partagée des figures du Cahier. Le SVG de distribution
 * est la référence ; les adaptateurs SVG consomment cette interface
 * au lieu de recopier dimensions, marges, types et tooltips.
 */

export type CahierFigureGeometry = {
  readonly width: number
  readonly height: number
  readonly margin: {
    readonly top: number
    readonly right: number
    readonly bottom: number
    readonly left: number
  }
}

/** Cadre de lecture commun aux figures du Cahier. */
export const CAHIER_FIGURE_GEOMETRY = {
  width: 820,
  height: 340,
  margin: { top: 38, right: 26, bottom: 58, left: 88 },
} as const

/** Summary plots reserve a wider left rail for readable group labels. */
export const CAHIER_SUMMARY_PLOT_FRAME = {
  width: CAHIER_FIGURE_GEOMETRY.width,
  margin: { top: 38, right: 26, bottom: 58, left: 220 },
} as const

function percent(value: number, total: number): string {
  return `${((value / total) * 100).toFixed(2)}%`
}

/** Grille ECharts équivalente au viewBox du Cahier. */
export const CAHIER_FIGURE_GRID = {
  left: percent(CAHIER_FIGURE_GEOMETRY.margin.left, CAHIER_FIGURE_GEOMETRY.width),
  right: percent(CAHIER_FIGURE_GEOMETRY.margin.right, CAHIER_FIGURE_GEOMETRY.width),
  top: percent(CAHIER_FIGURE_GEOMETRY.margin.top, CAHIER_FIGURE_GEOMETRY.height),
  bottom: percent(CAHIER_FIGURE_GEOMETRY.margin.bottom, CAHIER_FIGURE_GEOMETRY.height),
} as const

/** Variables CSS du cadre — les adaptateurs n'ont pas à recopier le viewBox. */
export const CAHIER_FIGURE_STYLE = {
  '--cahier-figure-width': `${CAHIER_FIGURE_GEOMETRY.width}px`,
  '--cahier-figure-height': `${CAHIER_FIGURE_GEOMETRY.height}px`,
  '--cahier-figure-aspect-ratio': `${CAHIER_FIGURE_GEOMETRY.width} / ${CAHIER_FIGURE_GEOMETRY.height}`,
  '--cahier-figure-grid-left': CAHIER_FIGURE_GRID.left,
  '--cahier-figure-grid-right': CAHIER_FIGURE_GRID.right,
  '--cahier-figure-grid-top': CAHIER_FIGURE_GRID.top,
  '--cahier-figure-grid-bottom': CAHIER_FIGURE_GRID.bottom,
  '--cahier-figure-axis-title-x-left': percent(
    (CAHIER_FIGURE_GEOMETRY.margin.left +
      (CAHIER_FIGURE_GEOMETRY.width - CAHIER_FIGURE_GEOMETRY.margin.left - CAHIER_FIGURE_GEOMETRY.margin.right) / 2),
    CAHIER_FIGURE_GEOMETRY.width,
  ),
  '--cahier-figure-axis-title-y-left': percent(22, CAHIER_FIGURE_GEOMETRY.width),
  '--cahier-figure-axis-title-y-top': percent(
    (CAHIER_FIGURE_GEOMETRY.margin.top +
      CAHIER_FIGURE_GEOMETRY.height - CAHIER_FIGURE_GEOMETRY.margin.bottom) / 2,
    CAHIER_FIGURE_GEOMETRY.height,
  ),
} as const

/** Mesures communes des axes SVG et ECharts. */
export const CAHIER_FIGURE_AXIS = {
  width: 1,
  tickLength: 7,
  xLabelOffset: 22,
  yLabelOffset: 12,
  yLabelBaseline: 4,
} as const

export interface CahierFigureAxisTick {
  key: string | number
  position: number
  label: string | null
}

export interface CahierFigureTickOptions {
  grading?:
    | { kind: 'adaptive'; targetCount?: number }
    | { kind: 'fixed'; step: number; maximumGap?: number }
  labels?: {
    avoidValues?: readonly number[]
    minimumGap?: number
  }
}

function graduationStep(maximum: number, count: number): number {
  const roughStep = maximum / Math.max(1, count - 1)
  const magnitude = 10 ** Math.floor(Math.log10(roughStep))
  const normalized = roughStep / magnitude
  const factor = [1, 2, 2.5, 5, 10].reduce((nearest, candidate) =>
    Math.abs(candidate - normalized) < Math.abs(nearest - normalized) ? candidate : nearest,
  )
  return factor * magnitude
}

/** Return numeric tick values without extending a data-derived domain. */
export function valeursGraduationPourDomaine(
  maximum: number,
  options: CahierFigureTickOptions = {},
): readonly number[] {
  const safeMaximum = Math.max(0, maximum)
  if (safeMaximum === 0) {
    return [0]
  }

  const grading = options.grading ?? { kind: 'adaptive' as const, targetCount: 6 }
  if (grading.kind === 'fixed' && grading.step > 0) {
    const values: number[] = [0]
    const lastInteriorValue = Math.max(0, safeMaximum - (grading.maximumGap ?? 0))
    for (let value = grading.step; value < lastInteriorValue; value += grading.step) values.push(value)
    values.push(safeMaximum)
    return values
  }

  const count = Math.max(2, Math.round(grading.kind === 'adaptive' ? grading.targetCount ?? 6 : 6))
  const step = graduationStep(safeMaximum, count)
  const values: number[] = [0]
  for (let value = step; value < safeMaximum; value += step) values.push(value)
  values.push(safeMaximum)
  return values
}

function approximateLabelWidth(label: string): number {
  return Math.max(24, label.length * 7)
}

/** Suppress only labels whose occupied box collides with protected positions. */
export function etiquettesGraduationSansChevauchement(
  ticks: readonly CahierFigureAxisTick[],
  protectedPositions: readonly number[],
  minimumGap = 8,
): readonly CahierFigureAxisTick[] {
  const preserved = ticks.filter((_, index) => index === 0 || index === ticks.length - 1)
  const isTooClose = (tick: CahierFigureAxisTick, otherPosition: number): boolean =>
    Math.abs(tick.position - otherPosition) < approximateLabelWidth(tick.label ?? '') / 2 + minimumGap
  const isTooCloseToTick = (tick: CahierFigureAxisTick, other: CahierFigureAxisTick): boolean =>
    Math.abs(tick.position - other.position) <
      (approximateLabelWidth(tick.label ?? '') + approximateLabelWidth(other.label ?? '')) / 2 + minimumGap

  const visible = [...preserved]
  return ticks.map((tick, index) => {
    if (tick.label === null || index === 0 || index === ticks.length - 1) return tick
    const collidesWithProtected = protectedPositions.some((position) => isTooClose(tick, position))
    const collidesWithPreserved = preserved.some((other) => other !== tick && isTooCloseToTick(tick, other))
    const collidesWithVisible = visible.some((other) => other !== tick && isTooCloseToTick(tick, other))
    if (collidesWithProtected || collidesWithPreserved || collidesWithVisible) {
      return { ...tick, label: null }
    }
    visible.push(tick)
    return tick
  })
}

/** Build positioned, formatted ticks for a figure geometry. */
export function graduationsPourDomaine(
  maximum: number,
  geometry: CahierFigureGeometry = CAHIER_FIGURE_GEOMETRY,
  options?: CahierFigureTickOptions,
): readonly CahierFigureAxisTick[] {
  const safeMaximum = Math.max(0, maximum)
  const values = valeursGraduationPourDomaine(safeMaximum, options)
  if (safeMaximum === 0) {
    return [{ key: 0, position: geometry.margin.left, label: '0' }]
  }

  const plotWidth = geometry.width - geometry.margin.left - geometry.margin.right
  const formatter = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 })
  const ticks = values.map((value, index) => ({
    key: index === values.length - 1 ? 'maximum' : value,
    position: geometry.margin.left + (value / safeMaximum) * plotWidth,
    label: formatter.format(value),
  }))
  const protectedPositions = options?.labels?.avoidValues?.map((value) =>
    geometry.margin.left + (Math.max(0, Math.min(value, safeMaximum)) / safeMaximum) * plotWidth,
  ) ?? []
  return etiquettesGraduationSansChevauchement(ticks, protectedPositions, options?.labels?.minimumGap)
}

export type CahierSummaryPlotLayout = {
  readonly geometry: CahierFigureGeometry
  readonly groupCenters: readonly number[]
  readonly rowPitch: number
  readonly barHeight: number
}

const SUMMARY_PLOT_BAR_HEIGHT = 22
const SUMMARY_PLOT_ROW_PITCH = 30
const SUMMARY_PLOT_GROUP_GAP = 32
const SUMMARY_PLOT_OUTER_PADDING = 24

/** Build an intrinsic summary-plot geometry from its group and row counts. */
export function layoutCahierSummaryPlot(groupCount: number, rowCount: number): CahierSummaryPlotLayout {
  const safeGroupCount = Math.max(1, Math.floor(groupCount))
  const safeRowCount = Math.max(1, Math.floor(rowCount))
  const { margin, width } = CAHIER_SUMMARY_PLOT_FRAME
  const groupHeight = SUMMARY_PLOT_BAR_HEIGHT + (safeRowCount - 1) * SUMMARY_PLOT_ROW_PITCH
  const contentHeight = SUMMARY_PLOT_OUTER_PADDING * 2 +
    safeGroupCount * groupHeight + (safeGroupCount - 1) * SUMMARY_PLOT_GROUP_GAP
  const height = margin.top + contentHeight + margin.bottom
  const firstGroupTop = margin.top + SUMMARY_PLOT_OUTER_PADDING
  const groupCenters = Array.from({ length: safeGroupCount }, (_, index) =>
    firstGroupTop + groupHeight / 2 + index * (groupHeight + SUMMARY_PLOT_GROUP_GAP),
  )

  return {
    geometry: { width, height, margin },
    groupCenters,
    rowPitch: SUMMARY_PLOT_ROW_PITCH,
    barHeight: SUMMARY_PLOT_BAR_HEIGHT,
  }
}

/** A semantic legend entry declared by evidence and rendered by a figure. */
export type FigureLegendMarker = 'icon' | 'line' | 'dot' | 'dash' | 'square' | 'slash'

export interface FigureLegendEntry {
  key: string
  label: string
  marker: FigureLegendMarker
  iconKey?: string
  tone?: string
}

/** Les tons des lignes de détail partagées par tous les tooltips du Cahier. */
export type CahierTooltipTone = 't' | 'b' | 'c' | 'neutral'

export interface CahierTooltipRow {
  label: string
  value: string
  tone?: CahierTooltipTone
  icon?: Component
  markerColor?: string
  marker?: 'dot' | 'slash'
  note?: string
}

/** A shared HTML tooltip anchor, expressed in its containing figure's space. */
export interface CahierFigureTooltipAnchor {
  x: string
  y?: string
}
import type { Component } from 'vue'
