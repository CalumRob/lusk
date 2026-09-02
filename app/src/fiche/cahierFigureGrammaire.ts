/**
 * La grammaire visuelle partagée des figures du Cahier. Le SVG de distribution
 * est la référence ; les adaptateurs SVG consomment cette interface
 * au lieu de recopier dimensions, marges, types et tooltips.
 */

/** Cadre de lecture commun aux figures du Cahier. */
export const CAHIER_FIGURE_GEOMETRY = {
  width: 820,
  height: 340,
  margin: { top: 38, right: 26, bottom: 58, left: 88 },
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

export interface CahierDonutParts {
  walkTransit: number
  bike: number
  car: number
}

/** Clamp cumulative access shares once so the ring and its labels cannot drift. */
export function normaliserPartsDonut(values: CahierDonutParts): CahierDonutParts {
  const walkTransit = Math.max(0, Math.min(1, values.walkTransit))
  const bike = Math.max(walkTransit, Math.min(1, values.bike))
  const car = Math.max(bike, Math.min(1, values.car))
  return { walkTransit, bike, car }
}

export interface CahierFigureAxisTick {
  key: string | number
  position: number
  label: string | null
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
  markerColor?: string
  marker?: 'dot' | 'slash'
  note?: string
}

/** A shared HTML tooltip anchor, expressed in its containing figure's space. */
export interface CahierFigureTooltipAnchor {
  x: string
  y?: string
}
