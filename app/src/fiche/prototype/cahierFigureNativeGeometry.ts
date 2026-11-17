/**
 * Native figure geometry shared by the mounted Cahier figures and the PDF
 * composer (#1024 correction).
 *
 * These functions are the single source of axis domains, tick selection,
 * series paths, bar geometry, stacked comparison segments and waffle flow.
 * The screen components consume them for their SVG/HTML geometry; the PDF
 * composer consumes the same functions and only paints the resulting
 * primitives. No PDF-only bound/rounding/colour policy is allowed here.
 */
import {
  cahierIntegerYAxisScale,
  deriveCahierFigureGeometry,
  valeursGraduationPourDomaine,
} from '@/fiche/cahierFigureGrammaire'
import type { CahierFigureGeometry, CahierFigureAxisTick, CahierGroupedVerticalBarFigureData } from '@/fiche/cahierFigureGrammaire'
import type {
  MobiliteBarCategoryEvidence,
  MobiliteBarsFigureEvidence,
} from '@/fiche/content/themeContent'
import type { NumericFact, TimeRampFigureData, TimeRampPoint } from '@/fiche/content/territoryFacts'
import {
  mobiliteBarReferenceValue,
  mobiliteBarSegmentColor,
  mobiliteBarToneColor,
  mobiliteCurveCoordinateForDetail,
  mobiliteCurveGrid,
  mobiliteFiniteValue,
  mobiliteShareVisibleLabel,
  type CahierMobiliteCurveInput,
} from './cahierMobiliteReadings'
import { formatTimeRampNumber } from './cahierFigureReadings'

export interface RampScale {
  readonly minimum: number
  readonly maximum: number
  readonly ticks: readonly number[]
}

/**
 * Native plot frame of the two AEDAR figure families: the screen SVG's own
 * viewBox and margins (`AccessRampFigureCahier.vue`, shared by
 * `CahierGroupedVerticalBarChart.vue`). The mounted figures and the PDF painter
 * both read this one declaration; the y rail is then measured by the browser
 * (or by the embedded PDF face) through `deriveAedarFigureGeometry`.
 */
export const CAHIER_AEDAR_FIGURE_GEOMETRY = {
  width: 640,
  height: 300,
  margin: { top: 22, right: 68, bottom: 62, left: 64 },
} as const satisfies CahierFigureGeometry

/** Native compared-bars frame, shared by `CahierMobiliteComparisonBars` and the PDF. */
export const CAHIER_MOBILITE_BARS_GEOMETRY = {
  width: 640,
  height: 300,
  margin: { top: 22, right: 24, bottom: 62, left: 68 },
} as const satisfies CahierFigureGeometry

/**
 * Native paired-figure row of `CahierMobiliteSection.vue` (`.mobilite-paired`):
 * `grid-template-columns: repeat(2, minmax(0, 1fr))` and
 * `column-gap: clamp(24px, 4vw, 56px)`.
 *
 * The export reproduces the *desktop* reading layout, never the reader's own
 * window: `desktopViewportPx` is the host width the approved desktop artifacts
 * (and the bounded browser harness) are read at, so the responsive gap is
 * resolved once, from the source clamp, at that named viewport. The screen SFC
 * and this object are kept identical by `cahier-figure-row-grammar.spec.ts`.
 */
export const CAHIER_FIGURE_ROW = {
  columns: 2,
  gap: { minimumPx: 24, viewportVw: 4, maximumPx: 56 },
  desktopViewportPx: 1440,
} as const

export interface FigureRowLayout {
  readonly columns: number
  readonly viewportPx: number
  /** The source clamp resolved at `viewportPx`, in screen CSS pixels. */
  readonly gapPx: number
}

/** Resolve the native paired-row gap from its own clamp at a host width. */
export function figureRowLayout(viewportPx: number = CAHIER_FIGURE_ROW.desktopViewportPx): FigureRowLayout {
  const { columns, gap } = CAHIER_FIGURE_ROW
  const resolved = (gap.viewportVw * viewportPx) / 100
  return {
    columns,
    viewportPx,
    gapPx: Math.min(gap.maximumPx, Math.max(gap.minimumPx, resolved)),
  }
}



/**
 * Apply the native rail rule to an AEDAR frame. `renderedWidth` and
 * `longestLabelWidth` are measured in the same unit; the returned left margin
 * is in native user units, exactly like the mounted figures.
 */
export function deriveAedarFigureGeometry(
  base: CahierFigureGeometry,
  renderedWidth: number,
  longestLabelWidth: number,
): CahierFigureGeometry {
  return deriveCahierFigureGeometry(base, renderedWidth, longestLabelWidth)
}

export interface CurveScale {
  readonly minimum: number
  readonly maximum: number
  readonly ticks: readonly number[]
}

export interface BarScale {
  readonly maximum: number
  readonly ticks: readonly number[]
}

export interface BarGeometry {
  readonly groupWidth: number
  readonly slotCount: number
  readonly barWidth: number
  readonly x: (categoryIndex: number, slot: number) => number
  readonly height: (value: number) => number
}

export interface GroupedBarGeometry {
  readonly groupWidth: number
  readonly seriesCount: number
  readonly barWidth: number
  readonly x: (categoryIndex: number, seriesIndex: number) => number
  readonly height: (value: number) => number
}

export interface RampGeometry {
  readonly yAxis: RampScale
  readonly x: (value: number) => number
  readonly y: (value: number) => number
  readonly xTicks: readonly CahierFigureAxisTick[]
  readonly yTicks: readonly CahierFigureAxisTick[]
}

export interface CurveGeometry {
  readonly scale: CurveScale
  readonly x: (value: number) => number
  readonly y: (value: number) => number
  readonly xTicks: readonly CahierFigureAxisTick[]
  readonly yTicks: readonly CahierFigureAxisTick[]
}

export interface StackedSegment {
  readonly key: string
  readonly label: string
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
  readonly fill: string
}

/** Native AEDAR ramp domain: integer ticks, never a PDF-only decimal axis. */
export function rampScale(
  series: TimeRampFigureData['series'],
  comparisonVisible: boolean,
): RampScale {
  const values = series.flatMap((entry) => entry.points.flatMap((point) => (
    comparisonVisible ? [point.value, point.referenceValue] : [point.value]
  )))
  return cahierIntegerYAxisScale(values)
}

export function rampGeometry(
  points: readonly TimeRampPoint[],
  scale: RampScale,
  geometry: CahierFigureGeometry,
  unit = '',
): RampGeometry {
  const { width, height, margin } = geometry
  const first = points[0]?.xValue ?? 0
  const last = points.at(-1)?.xValue ?? 1
  const plotWidth = width - margin.left - margin.right
  const plotHeight = height - margin.top - margin.bottom
  const x = (value: number) => margin.left
    + ((value - first) / Math.max(1, last - first)) * plotWidth
  const y = (value: number) => margin.top
    + (1 - (value - scale.minimum) / (scale.maximum - scale.minimum)) * plotHeight
  const label = (value: number) => `${formatTimeRampNumber(value)}${unit ? ` ${unit}` : ''}`
  return {
    yAxis: scale,
    x,
    y,
    xTicks: points.map((point) => ({ key: point.xValue, position: x(point.xValue), label: point.xLabel })),
    yTicks: scale.ticks.map((value) => ({ key: value, position: y(value), label: label(value) })),
  }
}

/** Split into segments around absent readings; never join across a gap. */
export function rampPaths(
  points: readonly TimeRampPoint[],
  valueOf: (point: TimeRampPoint) => number | null,
  x: (value: number) => number,
  y: (value: number) => number,
): readonly string[] {
  const paths: string[] = []
  let current: string[] = []
  for (const point of points) {
    const value = valueOf(point)
    if (value === null) {
      if (current.length) paths.push(current.join(' '))
      current = []
    } else {
      current.push(`${current.length ? 'L' : 'M'} ${x(point.xValue).toFixed(2)} ${y(value).toFixed(2)}`)
    }
  }
  if (current.length) paths.push(current.join(' '))
  return paths
}

/** One CSS pixel in millimetres, for print reproduction of the screen metrics. */
export const CSS_PX_EN_MM = 25.4 / 96

/**
 * Native figure stroke grammar, in screen CSS pixels. The mounted figures
 * receive these values as injected CSS custom properties at runtime (the same
 * screen-grammar mechanism as `CAHIER_COLOR_ROLES`); the PDF painter converts
 * the identical object instead of carrying parallel millimetre literals.
 */
export interface CahierFigureStroke {
  readonly widthPx: number
  readonly comparisonWidthPx: number
  readonly comparisonDashPx: readonly number[]
  readonly comparisonOpacity: number
  readonly markerWidthPx: number
  readonly markerDashPx: readonly number[]
  readonly gridWidthPx: number
  readonly axisWidthPx: number
  readonly linecap: 'butt' | 'round' | 'square'
  readonly linejoin: 'bevel' | 'miter' | 'round'
}

export const CAHIER_FIGURE_STROKE = {
  widthPx: 2.5,
  comparisonWidthPx: 2.5,
  comparisonDashPx: [10, 6] as const,
  comparisonOpacity: 0.68,
  markerWidthPx: 1.5,
  markerDashPx: [3, 3] as const,
  gridWidthPx: 1,
  axisWidthPx: 1.5,
  linecap: 'round',
  linejoin: 'round',
} as const satisfies CahierFigureStroke

/**
 * CSS custom properties carrying the grammar into a mounted native figure.
 * Callers pass the owner object explicitly so a single owner substitution
 * reaches both the screen binding and the PDF painter.
 *
 * The `--cahier-figure-stroke-*` namespace is deliberately distinct from
 * `CAHIER_FIGURE_AXIS.width`'s legacy `--cahier-figure-axis-width` (1 CSS px,
 * consumed by `CahierFigureAxes.vue`/`cahierFigure.css`). Two grammars, two
 * variable scopes: nesting the figures cannot silently promote the native
 * 1.5 px stroke to the axis geometry width or the reverse.
 */
export function cahierFigureStrokeVars(
  stroke: CahierFigureStroke = CAHIER_FIGURE_STROKE,
): Record<string, string> {
  return {
    '--cahier-figure-stroke-series-width': `${stroke.widthPx}px`,
    '--cahier-figure-stroke-series-cap': stroke.linecap,
    '--cahier-figure-stroke-series-join': stroke.linejoin,
    '--cahier-figure-stroke-comparison-width': `${stroke.comparisonWidthPx}px`,
    '--cahier-figure-stroke-comparison-dash': stroke.comparisonDashPx.join(' '),
    '--cahier-figure-stroke-comparison-opacity': String(stroke.comparisonOpacity),
    '--cahier-figure-stroke-marker-width': `${stroke.markerWidthPx}px`,
    '--cahier-figure-stroke-marker-dash': stroke.markerDashPx.join(' '),
    '--cahier-figure-stroke-grid-width': `${stroke.gridWidthPx}px`,
    '--cahier-figure-stroke-axis-width': `${stroke.axisWidthPx}px`,
  }
}

/** CSS pixels to millimetres, rounded to a stable six-decimal value. */
export function cssPxToMm(px: number): number {
  return Number((px * CSS_PX_EN_MM).toFixed(6))
}

export function dashArrayMm(values: readonly number[]): string {
  return values.map(cssPxToMm).join(' ')
}

/** Native curve fixed percent axis, shared by screen and PDF. */
export const CURVE_Y_TICKS = [0, 0.25, 0.5, 0.75, 1] as const

export function curveScale(figure: CahierMobiliteCurveInput): CurveScale {
  const axis = figure.axis
  return axis
    ? { minimum: axis.minimum, maximum: axis.maximum, ticks: [...CURVE_Y_TICKS] }
    : { minimum: 0, maximum: 1, ticks: [...CURVE_Y_TICKS] }
}

export function curveGeometry(
  figure: CahierMobiliteCurveInput,
  geometry: CahierFigureGeometry,
): CurveGeometry {
  const scale = curveScale(figure)
  const { width, height, margin } = geometry
  const plotWidth = width - margin.left - margin.right
  const plotHeight = height - margin.top - margin.bottom
  const x = (value: number) => margin.left
    + ((value - scale.minimum) / (scale.maximum - scale.minimum)) * plotWidth
  const y = (value: number) => margin.top
    + (1 - Math.max(0, Math.min(1, value))) * plotHeight
  return {
    scale,
    x,
    y,
    xTicks: mobiliteCurveGrid(figure).map((tick) => ({
      key: tick.detail,
      label: tick.label,
      position: x(tick.axisValue),
    })),
    yTicks: CURVE_Y_TICKS.map((value) => ({
      key: value,
      label: `${value * 100} %`,
      position: y(value),
    })),
  }
}

/**
 * Native curve tick-density rule. The screen measures approximate label widths;
 * the PDF passes its measured width. Endpoints and the declared marker are
 * protected; remaining declared ticks fill in metadata order.
 */
export function visibleCurveTicks(
  ticks: readonly CahierFigureAxisTick[],
  renderedWidth: number,
  geometryWidth: number,
  markerKey: string | null,
  labelWidth: (label: string | null) => number,
  mobileKeys: ReadonlySet<string> = new Set(),
): readonly CahierFigureAxisTick[] {
  if (!renderedWidth || ticks.length < 2) return ticks
  const pixelsPerUnit = renderedWidth / geometryWidth
  const selected: CahierFigureAxisTick[] = []
  const fits = (tick: CahierFigureAxisTick): boolean => {
    const x = tick.position * pixelsPerUnit
    const half = labelWidth(tick.label) / 2
    return selected.every((other) => {
      const otherX = other.position * pixelsPerUnit
      const otherHalf = labelWidth(other.label) / 2
      return Math.abs(x - otherX) >= half + otherHalf + 10
    })
  }
  const add = (tick: CahierFigureAxisTick | undefined) => {
    if (tick && !selected.includes(tick) && fits(tick)) selected.push(tick)
  }
  add(ticks[0])
  add(ticks.find((tick) => markerKey !== null && String(tick.key) === markerKey))
  add(ticks.at(-1))
  for (const tick of ticks.filter((tick) => mobileKeys.has(String(tick.key)))) add(tick)
  for (const tick of ticks) add(tick)
  return [...selected].sort((left, right) => left.position - right.position)
}

export function curveSeriesPath(
  points: readonly { fact: NumericFact }[],
  figure: CahierMobiliteCurveInput,
  geometry: CurveGeometry,
): string {
  let started = false
  return points.map((point) => {
    const value = point.fact.value
    const axis = mobiliteCurveCoordinateForDetail(figure, point.fact.detail)
    if (value === null || !Number.isFinite(value) || axis === null) {
      started = false
      return ''
    }
    const command = `${started ? 'L' : 'M'}${geometry.x(axis).toFixed(2)},${geometry.y(value).toFixed(2)}`
    started = true
    return command
  }).filter(Boolean).join(' ')
}

/** Native compared-bars domain: rounded graduation headroom, never raw max. */
export function mobiliteBarScale(figure: MobiliteBarsFigureEvidence, comparisonAligned: boolean): BarScale {
  const finite = figure.categories.flatMap((category) => {
    const values = [mobiliteFiniteValue(category.value.fact.value)]
    if (comparisonAligned) values.push(mobiliteBarReferenceValue(category))
    return values.filter((value): value is number => value !== null)
  })
  const maximum = Math.max(0, ...finite)
  if (maximum <= 0) return { maximum: 1, ticks: [0, 1] }
  const ticks = valeursGraduationPourDomaine(maximum)
  const step = ticks.length > 1 ? ticks[1]! - ticks[0]! : maximum
  const roundedMaximum = Math.max(step, Math.ceil(maximum / step) * step)
  return { maximum: roundedMaximum, ticks: valeursGraduationPourDomaine(roundedMaximum) }
}

export function mobiliteBarGeometry(
  geometry: CahierFigureGeometry,
  categoryCount: number,
  scale: BarScale,
  slotCount: number,
): BarGeometry {
  const plotWidth = geometry.width - geometry.margin.left - geometry.margin.right
  const plotHeight = geometry.height - geometry.margin.top - geometry.margin.bottom
  const groupWidth = plotWidth / Math.max(1, categoryCount)
  const available = groupWidth * 0.72 - (slotCount - 1) * 3
  const barWidth = Math.max(4, Math.min(20, available / slotCount))
  const yFor = (value: number) => geometry.margin.top
    + (1 - Math.max(0, value) / scale.maximum) * plotHeight
  return {
    groupWidth,
    slotCount,
    barWidth,
    x: (categoryIndex, slot) => geometry.margin.left + categoryIndex * groupWidth
      + (groupWidth - (barWidth * slotCount + 3 * (slotCount - 1))) / 2
      + slot * (barWidth + 3),
    height: (value) => Math.max(0, Math.abs(yFor(value) - yFor(0))),
  }
}

export function mobiliteBarXticks(
  figure: MobiliteBarsFigureEvidence,
  geometry: CahierFigureGeometry,
  bar: BarGeometry,
): readonly CahierFigureAxisTick[] {
  return figure.categories.map((category, index) => ({
    key: category.key,
    position: geometry.margin.left + (index + 0.5) * bar.groupWidth,
    label: category.axisLabel,
  }))
}

export function mobiliteBarYTicks(
  scale: BarScale,
  geometry: CahierFigureGeometry,
): readonly CahierFigureAxisTick[] {
  const plotHeight = geometry.height - geometry.margin.top - geometry.margin.bottom
  return scale.ticks.map((value) => ({
    key: value,
    position: geometry.margin.top + (1 - Math.max(0, value) / scale.maximum) * plotHeight,
    label: new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(value),
  }))
}

/** Native focal stacked segments (Protégé/Partagé), exact role colours. */
export function mobiliteBarStackedSegments(
  category: MobiliteBarCategoryEvidence,
  categoryIndex: number,
  geometry: CahierFigureGeometry,
  bar: BarGeometry,
): readonly StackedSegment[] {
  const total = mobiliteFiniteValue(category.value.fact.value)
  if (total === null || total <= 0) return []
  const segments = category.segments.map((segment) => ({
    ...segment,
    numeric: mobiliteFiniteValue(segment.value.fact.value),
  }))
  if (!segments.length || segments.some((segment) => segment.numeric === null)) return []
  const plotBottom = geometry.margin.top + geometry.height - geometry.margin.top - geometry.margin.bottom
  let offset = 0
  return segments.map((segment) => {
    const value = segment.numeric as number
    const height = (Math.max(0, value) / total) * bar.height(total)
    const y = plotBottom - offset - height
    offset += height
    return {
      key: segment.key,
      label: segment.label,
      x: bar.x(categoryIndex, 0),
      y,
      width: bar.barWidth,
      height,
      fill: mobiliteBarSegmentColor(segment),
    }
  })
}

/** Native compared stack (when the owner declares a split that recomposes). */
export function mobiliteBarComparisonSegments(
  category: MobiliteBarCategoryEvidence,
  categoryIndex: number,
  geometry: CahierFigureGeometry,
  bar: BarGeometry,
): readonly StackedSegment[] {
  if (!category.comparisonSplit) return []
  const total = mobiliteBarReferenceValue(category)
  if (total === null || total < 0) return []
  const segments = category.segments.map((segment) => ({
    ...segment,
    numeric: mobiliteFiniteValue(segment.value.fact.comparison?.reference?.value),
  }))
  if (!segments.length || segments.some((segment) => segment.numeric === null)) return []
  const plotBottom = geometry.margin.top + geometry.height - geometry.margin.top - geometry.margin.bottom
  let offset = 0
  return segments.map((segment) => {
    const value = segment.numeric as number
    const height = total > 0 ? (Math.max(0, value) / total) * bar.height(total) : 0
    const y = plotBottom - offset - height
    offset += height
    return {
      key: segment.key,
      label: segment.label,
      x: bar.x(categoryIndex, 1),
      y,
      width: bar.barWidth,
      height,
      fill: `color-mix(in srgb, ${mobiliteBarSegmentColor(segment)} 45%, var(--paper))`,
    }
  })
}

export function mobiliteBarTone(category: MobiliteBarCategoryEvidence): string {
  return mobiliteBarToneColor(category.tone)
}

/** Native grouped-bar domain and geometry (AEDAR distribution). */
export function groupedBarScale(
  visibleSeries: readonly { values: readonly (number | null)[] }[],
): RampScale {
  const values = visibleSeries.flatMap((series) => series.values.flatMap((value) =>
    value === null || !Number.isFinite(value) ? [] : [value]))
  return cahierIntegerYAxisScale(values)
}

export function groupedBarGeometry(
  geometry: CahierFigureGeometry,
  categoryCount: number,
  seriesCount: number,
  scale: RampScale,
): GroupedBarGeometry {
  const plotWidth = geometry.width - geometry.margin.left - geometry.margin.right
  const plotHeight = geometry.height - geometry.margin.top - geometry.margin.bottom
  const groupWidth = plotWidth / Math.max(1, categoryCount)
  const available = groupWidth * 0.84 - (seriesCount - 1) * 2
  const barWidth = seriesCount === 0 ? 0 : Math.max(1.5, Math.min(12, available / seriesCount))
  const yFor = (value: number) => geometry.margin.top
    + (1 - (value - scale.minimum) / (scale.maximum - scale.minimum)) * plotHeight
  return {
    groupWidth,
    seriesCount,
    barWidth,
    x: (categoryIndex, seriesIndex) => geometry.margin.left + categoryIndex * groupWidth
      + (groupWidth - (barWidth * seriesCount + 2 * (seriesCount - 1))) / 2
      + seriesIndex * (barWidth + 2),
    height: (value) => Math.max(1, Math.abs(yFor(value) - yFor(0))),
  }
}

/**
 * One formatter owner for the grouped-bar y labels: the mounted chart and the
 * PDF painter both measure and paint the exact same string.
 */
export function groupedBarTickLabel(
  figure: CahierGroupedVerticalBarFigureData,
  value: number,
): string {
  return figure.formatAxisTick?.(value)
    ?? new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 }).format(value)
}

export function groupedBarTicks(
  figure: CahierGroupedVerticalBarFigureData,
  geometry: CahierFigureGeometry,
  bar: GroupedBarGeometry,
  scale: RampScale,
  formatAxisTick: (value: number) => string,
): { readonly x: readonly CahierFigureAxisTick[]; readonly y: readonly CahierFigureAxisTick[] } {
  const plotHeight = geometry.height - geometry.margin.top - geometry.margin.bottom
  return {
    x: figure.categories.map((category, index) => ({
      key: category.key,
      position: geometry.margin.left + (index + 0.5) * bar.groupWidth,
      label: category.axisLabel,
    })),
    y: scale.ticks.map((value) => ({
      key: value,
      position: geometry.margin.top + (1 - (value - scale.minimum) / (scale.maximum - scale.minimum)) * plotHeight,
      label: formatAxisTick(value),
    })),
  }
}

/**
 * Native waffle flow: five fixed rows, filled column by column
 * (`grid-template-rows: repeat(5, 1fr); grid-auto-flow: column`).
 */
export function waffleGridPosition(index: number): { readonly row: number; readonly column: number } {
  return { row: index % 5, column: Math.floor(index / 5) }
}

/** Native share label/unit; the served fraction is never blindly ×100. */
export function shareVisibleLabel(
  value: number | null,
  figure: Parameters<typeof mobiliteShareVisibleLabel>[1],
): string {
  return mobiliteShareVisibleLabel(value, figure)
}

export function shareFillPercent(
  value: number | null,
  unit: string,
): number {
  if (value === null) return 0
  const scaled = unit.trim() === '%' ? value * 100 : value
  return Math.max(0, Math.min(100, scaled))
}
