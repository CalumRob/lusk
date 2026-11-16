/**
 * Pure export projections for the native Cahier figure families (#1022).
 *
 * These adapters consume the frozen capture/request from #1021 and never touch
 * Vue state, the DOM or an acquisition owner. Each family projection reuses the
 * same owner resolver and the same pure readings the mounted figure displays,
 * so a PDF table cannot tell a different story from the screen.
 */
import type { AedarEquipmentHorizon } from '@/fiche/content/aedarEquipmentBuckets'
import { GROUPE_COMPARE_LABEL } from '@/fiche/content/comparisonWording'
import {
  AEDAR_RAMP_MODES,
} from '@/fiche/content/aedarTimeRampFacts'
import type {
  AedarRampMode,
} from '@/fiche/content/themeContent'
import type { ComparisonRank, TimeRampFigureData, TimeRampSeries } from '@/fiche/content/territoryFacts'
import type { CahierGroupedVerticalBarFigureData } from '@/fiche/cahierFigureGrammaire'
import { formatServedRank, formatServedRankAria } from '@/fiche/figureGrammaire'
import type {
  CahierExportCapture,
  CahierExportRequest,
  CahierCaptureFamily,
  CahierCaptureFigure,
} from './cahierExportCapture'
import {
  CAHIER_UNAVAILABLE_LABEL,
  formatTimeRampNumber,
  groupedBarTooltipRows,
  timeRampAccessibleReading,
  timeRampTooltipRows,
} from './cahierFigureReadings'
import {
  mobiliteBarReadings,
  mobiliteBarResourceNotes,
  mobiliteBarsAccessibleLabel,
  mobiliteBarsComparisonStateText,
  mobiliteComparisonAria,
  mobiliteCurveAccessibleLabel,
  mobiliteCurveComparisonStateText,
  mobiliteCurveCoordinateForDetail,
  mobiliteCurveMarkerRankAria,
  mobiliteCurveReadings,
  mobiliteCurveUnavailableNotes,
  mobiliteCurveVisiblePercent,
  mobiliteRatioAriaLabel,
  mobiliteRatioDisplayValue,
  mobiliteRatioNumber,
  mobiliteShareComparisonAria,
  mobiliteShareDisplayUnit,
  mobiliteSharePreciseLabel,
  mobiliteSharePublicationNotes,
  mobiliteShareReference,
  mobiliteShareStateMessage,
  mobiliteShareTerritoryAria,
  mobiliteShareValue,
  mobiliteShareVisibleLabel,
} from './cahierMobiliteReadings'
import {
  aedarExplorerVolumeRamp,
  aedarOverviewScalarAria,
  aedarOverviewScalarDisplayValue,
  aedarRampToTimeRampFigureData,
  aedarOverviewScalarRank,
  aedarQuantileReading,
  aedarWaffleModeRows,
  aedarWaffleReading,
  aedarWaffleShareLabel,
  aedarWaffleShareValue,
} from './aedarFigureReadings'

export interface CahierTableColumn {
  readonly key: string
  readonly label: string
  readonly unit: string | null
  readonly kind: 'focal' | 'comparison' | 'raw'
  readonly seriesKey: string | null
}

export interface CahierTableCell {
  readonly columnKey: string
  /** Exact native value; null is absent, never zero. */
  readonly value: number | null
  readonly display: string
  readonly unit: string | null
  readonly raw: boolean
  readonly rank: ComparisonRank | null
  readonly rankDisplay: string | null
  readonly rankAria: string | null
}

export interface CahierTableRow {
  readonly key: string
  readonly label: string
  readonly cells: readonly CahierTableCell[]
}

export interface CahierFigureTable {
  readonly key: string
  readonly title: string
  readonly columns: readonly CahierTableColumn[]
  readonly rows: readonly CahierTableRow[]
  readonly notes: readonly string[]
  readonly unit: string | null
}

export type CahierUnavailableKind =
  | 'resource'
  | 'comparison'
  | 'map'
  | 'legend'
  | 'values'
  | 'state'

/** Typed owner explanation; never inferred by parsing a French display string. */
export interface CahierUnavailableItem {
  readonly kind: CahierUnavailableKind
  readonly message: string
}

export interface CahierFigureProjectionBase {
  readonly family: CahierCaptureFamily
  readonly slot: string
  readonly title: string
  readonly accessibleLabel: string
  /** All numeric tables of the figure, in the screen's reading order. */
  readonly tables: readonly CahierFigureTable[]
  readonly comparisonDisplayed: boolean
  readonly unavailable: readonly CahierUnavailableItem[]
}

export interface CahierMapItemProjection {
  readonly id: string
  readonly label: string
  readonly declared: boolean
  readonly loaded: boolean
  readonly unavailable: boolean
  /** The actual inline figure asset; null when the owner declared no inline image. */
  readonly inlineUrl: string | null
}

export interface CahierMapsProjection {
  readonly status: 'none' | 'unknown' | 'pending' | 'available' | 'partial' | 'unavailable'
  readonly legend: 'none' | 'unknown' | 'pending' | 'available' | 'unavailable'
  readonly items: readonly CahierMapItemProjection[]
  /** Owner-observed native legend content; null until the legend is actually drawn. */
  readonly legendDetail: {
    readonly title: string
    readonly minimum: number | null
    readonly maximum: number | null
    readonly colors: readonly string[]
    readonly tickLabels: readonly string[]
    readonly note: string
    readonly ariaLabel: string | null
  } | null
  readonly groups: readonly { readonly key: string; readonly label: string }[]
}

export interface CahierRampSeriesProjection {
  readonly key: string
  readonly label: string
  readonly points: readonly {
    readonly cutKey: number
    readonly cutLabel: string
    readonly value: number | null
    readonly display: string
    readonly aria: string
    readonly referenceValue: number | null
    readonly referenceDisplay: string | null
    readonly referenceRank: ComparisonRank | null
    readonly referenceRankDisplay: string | null
    readonly referenceRankAria: string | null
  }[]
}

export interface CahierRampProjection {
  readonly key: string
  readonly title: string
  readonly xAxis: TimeRampFigureData['xAxis']
  readonly yAxis: TimeRampFigureData['yAxis']
  readonly series: readonly CahierRampSeriesProjection[]
}

export interface CahierRampsProjection extends CahierFigureProjectionBase {
  readonly family: 'aedar-ramps'
  readonly ramps: readonly CahierRampProjection[]
  readonly comparisonLabel: string | null
}

export interface CahierOverviewScalarProjection {
  readonly key: string
  readonly label: string
  readonly value: number | null
  readonly unit: string
  readonly display: string
  readonly ariaLabel: string
  readonly reference: {
    readonly label: string | null
    readonly value: number
    readonly unit: string
    readonly display: string
  } | null
  readonly rank: {
    readonly position: number
    readonly size: number
    readonly ties: number | null
    readonly display: string | null
    readonly aria: string | null
  } | null
}

export interface CahierOverviewProjection extends CahierFigureProjectionBase {
  readonly family: 'aedar-car-overview'
  readonly scalars: readonly CahierOverviewScalarProjection[]
  readonly maps: CahierMapsProjection
  readonly comparisonLabel: string | null
}

export interface CahierProfileProjection extends CahierFigureProjectionBase {
  readonly family: 'aedar-equipment-profile'
  readonly horizonMinutes: AedarEquipmentHorizon
  readonly threshold: number
  readonly summary: string
  readonly buckets: readonly {
    readonly key: string
    readonly label: string
    readonly count: number
    readonly types: readonly { readonly typequ: string; readonly label: string }[]
  }[]
  readonly modes: readonly { readonly key: string; readonly label: string }[]
  readonly types: readonly {
    readonly typequ: string
    readonly label: string
    readonly bucket: string
    readonly shares: readonly { readonly mode: string; readonly value: number | null; readonly display: string }[]
  }[]
}

/**
 * The native renderer model plus its visibility props. D consumes this object
 * directly; titles, formatters, colours, icons and ranks are not restated in a
 * second drawing shape.
 */
export interface CahierGroupedBarsProjection {
  readonly figure: CahierGroupedVerticalBarFigureData
  readonly hiddenSeriesKeys: readonly string[]
}

export interface CahierExplorerProjection extends CahierFigureProjectionBase {
  readonly family: 'aedar-equipment-explorer'
  readonly typequ: string
  readonly typequLabel: string | null
  readonly horizonMinutes: AedarEquipmentHorizon | null
  readonly modes: readonly AedarRampMode[]
  readonly volume: CahierRampProjection
  readonly distribution: CahierGroupedBarsProjection
}

export interface CahierBarsProjection extends CahierFigureProjectionBase {
  readonly family: 'mobilite-bars'
  readonly figureTitle: string
  readonly unit: string
  readonly xAxisTitle: string
  readonly yAxisTitle: string
  readonly comparisonLabel: string | null
  /** The actual comparison read state the owner presents. */
  readonly comparisonStatus: 'idle' | 'loading' | 'ready' | 'error' | 'unavailable'
  /** The exact visible state copy, or null when the owner suppresses it. */
  readonly comparisonStateText: string | null
  /** Present for the networks plate; its owner observation is the only proof. */
  readonly maps: CahierMapsProjection | null
  readonly ratio: {
    readonly label: string
    readonly value: number | null
    readonly unit: string
    readonly display: string
    /** The owner's own unavailable-ratio explanation, when it carries one. */
    readonly note: string | null
    readonly ariaLabel: string
    /**
     * The comparison SLOT is rendered, including an explicit unavailable cell;
     * this is not proof that a reference value was served. `comparisonValue`
     * stays null when the slot is unavailable.
     */
    readonly comparisonDisplayed: boolean
    readonly comparisonValue: number | null
    readonly comparisonDisplay: string | null
    readonly comparisonRank: ComparisonRank | null
    readonly comparisonRankDisplay: string | null
    readonly comparisonAria: string | null
  } | null
}

export interface CahierShareProjection extends CahierFigureProjectionBase {
  readonly family: 'mobilite-share'
  readonly figureTitle: string
  readonly territoryName: string
  readonly unit: string
  readonly value: number | null
  readonly display: string
  readonly precise: string
  readonly comparisonDisplayed: boolean
  readonly comparisonValue: number | null
  readonly comparisonDisplay: string | null
  readonly comparisonPrecise: string | null
  readonly comparisonRank: ComparisonRank | null
  readonly comparisonRankDisplay: string | null
  readonly comparisonRankAria: string | null
  readonly comparisonLabel: string | null
  /** The same accessible readings the two mounted tracks render. */
  readonly territoryAria: string
  readonly comparisonAria: string | null
  /** Owner publication explanations, in display order. */
  readonly notes: readonly string[]
  /** Native status message; null when the figure is fully readable. */
  readonly stateMessage: string | null
}

export interface CahierCurveProjection extends CahierFigureProjectionBase {
  readonly family: 'mobilite-curve'
  readonly figureTitle: string
  readonly xAxisTitle: string
  readonly yAxisTitle: string
  /** The actual comparison read state the owner presents. */
  readonly comparisonStatus: 'idle' | 'loading' | 'ready' | 'error' | 'unavailable'
  /** The exact visible/accessible state copy, or null when suppressed. */
  readonly comparisonStateText: string | null
  readonly unit: string
  readonly points: readonly {
    readonly detail: string
    readonly axisValue: number
    readonly label: string
    readonly value: number | null
    readonly display: string
    readonly aria: string
    readonly comparisonValue: number | null
    readonly comparisonDisplay: string | null
    readonly comparisonAria: string | null
    readonly comparisonRank: ComparisonRank | null
    readonly comparisonRankDisplay: string | null
    readonly comparisonRankAria: string | null
  }[]
  readonly marker: {
    readonly detail: string
    readonly label: string
    readonly axisValue: number | null
    readonly value: number | null
    readonly display: string
    readonly rank: ComparisonRank | null
    readonly rankDisplay: string | null
    readonly rankAria: string | null
  } | null
  readonly comparisonLabel: string | null
}

export interface CahierMapsFigureProjection extends CahierFigureProjectionBase {
  readonly family: 'aedar-diversity-loss'
  readonly maps: CahierMapsProjection
}

export type CahierFigureProjection =
  | CahierRampsProjection
  | CahierOverviewProjection
  | CahierProfileProjection
  | CahierExplorerProjection
  | CahierBarsProjection
  | CahierShareProjection
  | CahierCurveProjection
  | CahierMapsFigureProjection

function displayNumber(value: number | null): string {
  return value === null ? CAHIER_UNAVAILABLE_LABEL : formatTimeRampNumber(value)
}

function layerDisplayed(capture: CahierExportCapture, slot: string): boolean {
  // The owner's published observation is the only proof it actually draws the
  // layer; the capture absence enum is never a second renderer predicate.
  return capture.comparison.display.layers.some((layer) => layer.slot === slot && layer.displayed)
}

function requestedModes(
  figureModes: readonly AedarRampMode[],
  request: CahierExportRequest,
): readonly AedarRampMode[] {
  if (request.modeIds.length === 0) return figureModes
  const selected = new Set(request.modeIds)
  return figureModes.filter((mode) => selected.has(mode))
}

function cell(options: {
  columnKey: string
  value: number | null
  display: string
  unit: string | null
  raw?: boolean
  rank?: ComparisonRank | null
  rankDisplay?: string | null
  rankAria?: string | null
}): CahierTableCell {
  return {
    columnKey: options.columnKey,
    value: options.value,
    display: options.display,
    unit: options.unit,
    raw: options.raw === true,
    rank: options.rank ?? null,
    rankDisplay: options.rankDisplay ?? null,
    rankAria: options.rankAria ?? null,
  }
}


function rampTable(options: {
  key: string
  title: string
  timeRamp: TimeRampFigureData
  series: readonly TimeRampSeries[]
  territoryName: string
  comparisonDisplayed: boolean
}): CahierFigureTable {
  const { key, title, timeRamp, series, territoryName, comparisonDisplayed } = options
  const cuts = series[0]?.points ?? []
  const columns: CahierTableColumn[] = [
    ...series.map((entry) => ({
      key: entry.key,
      label: entry.label,
      unit: timeRamp.yAxis.unit || null,
      kind: 'focal' as const,
      seriesKey: entry.key,
    })),
    ...(comparisonDisplayed
      ? series.map((entry) => ({
        key: `${entry.key}:comparison`,
        label: `${GROUPE_COMPARE_LABEL} — ${entry.label}`,
        unit: timeRamp.yAxis.unit || null,
        kind: 'comparison' as const,
        seriesKey: entry.key,
      }))
      : []),
  ]
  const rows = cuts.map((cut) => {
    const readings = timeRampTooltipRows({
      timeRamp,
      series,
      cut,
      territoryName,
      comparisonLayerSupported: comparisonDisplayed,
    })
    const bySeries = new Map(readings.map((reading) => [reading.seriesKey, reading]))
    return {
      key: `${key}:cut:${cut.xValue}`,
      label: cut.xLabel,
      cells: [
        ...series.map((entry) => {
          const reading = bySeries.get(entry.key)
          return cell({
            columnKey: entry.key,
            value: reading?.numericValue ?? null,
            display: reading?.value ?? CAHIER_UNAVAILABLE_LABEL,
            unit: timeRamp.yAxis.unit || null,
          })
        }),
        ...(comparisonDisplayed ? series.map((entry) => {
          const reading = bySeries.get(entry.key)
          return cell({
            columnKey: `${entry.key}:comparison`,
            value: reading?.referenceValue ?? null,
            display: reading?.comparison?.value ?? CAHIER_UNAVAILABLE_LABEL,
            unit: timeRamp.yAxis.unit || null,
            rank: reading?.referenceRank ?? null,
            rankDisplay: reading?.comparison?.rank ?? null,
            rankAria: reading?.comparison?.rankAria ?? null,
          })
        }) : []),
      ],
    }
  })
  return { key, title, columns, rows, notes: [], unit: timeRamp.yAxis.unit || null }
}

/* ------------------------------------------------------------------ *
 * Family adapters
 * ------------------------------------------------------------------ */

export function projectRamps(
  capture: CahierExportCapture,
  figure: Extract<CahierCaptureFigure, { family: 'aedar-ramps' }>,
  request: CahierExportRequest,
): CahierRampsProjection {
  // The access section publishes its shared reference layer under `comparison`.
  const comparisonDisplayed = layerDisplayed(capture, 'comparison')
  const modes = requestedModes(AEDAR_RAMP_MODES, request)
  const ramps = figure.model.ramps.map((ramp) => {
    const timeRamp = aedarRampToTimeRampFigureData(ramp, comparisonDisplayed)
    const series = timeRamp.series.filter((entry) => modes.includes(entry.key as AedarRampMode))
    return {
      key: ramp.rampKey,
      title: ramp.figureTitle,
      xAxis: timeRamp.xAxis,
      yAxis: timeRamp.yAxis,
      series: series.map((entry) => ({
        key: entry.key,
        label: entry.label,
        points: entry.points.map((point) => {
          const reading = timeRampTooltipRows({
            timeRamp, series: [entry], cut: point, territoryName: capture.identity.territory.name,
            comparisonLayerSupported: comparisonDisplayed,
          })[0]
          return {
            cutKey: point.xValue,
            cutLabel: point.xLabel,
            value: point.value,
            display: reading?.value ?? displayNumber(point.value),
            aria: reading?.ariaLabel ?? '',
            referenceValue: comparisonDisplayed ? point.referenceValue : null,
            referenceDisplay: reading?.comparison?.value ?? null,
            referenceRank: comparisonDisplayed ? point.referenceRank ?? null : null,
            referenceRankDisplay: reading?.comparison?.rank ?? null,
            referenceRankAria: reading?.comparison?.rankAria ?? null,
          }
        }),
      })),
    }
  })
  const tables = ramps.map((ramp, index) => {
    const timeRamp = aedarRampToTimeRampFigureData(figure.model.ramps[index]!, comparisonDisplayed)
    const series = timeRamp.series.filter((entry) => modes.includes(entry.key as AedarRampMode))
    return rampTable({
      key: ramp.key,
      title: ramp.title,
      timeRamp,
      series,
      territoryName: capture.identity.territory.name,
      comparisonDisplayed,
    })
  })
  const accessibleLabel = ramps.map((_ramp, index) => {
    const timeRamp = aedarRampToTimeRampFigureData(figure.model.ramps[index]!, comparisonDisplayed)
    return timeRampAccessibleReading({
      timeRamp,
      series: timeRamp.series.filter((entry) => modes.includes(entry.key as AedarRampMode)),
      territoryName: capture.identity.territory.name,
      comparisonLayerSupported: comparisonDisplayed,
    })
  }).join(' ')
  return {
    family: 'aedar-ramps',
    slot: figure.slot,
    title: ramps.map((ramp) => ramp.title).join(' / '),
    accessibleLabel,
    tables,
    comparisonDisplayed,
    unavailable: capture.comparison.display.reason === 'error'
      ? [{ kind: 'comparison', message: 'Comparaison indisponible' }]
      : [],
    ramps,
    comparisonLabel: comparisonDisplayed ? figure.model.comparisonLabel : null,
  }
}

export function projectOverview(
  capture: CahierExportCapture,
  figure: Extract<CahierCaptureFigure, { family: 'aedar-car-overview' }>,
): CahierOverviewProjection {
  const comparisonDisplayed = layerDisplayed(capture, 'comparison')
  const scalars = figure.model.scalars.map((scalar) => {
    const rank = aedarOverviewScalarRank(scalar)
    return {
      key: scalar.key,
      label: scalar.label,
      value: scalar.value,
      unit: scalar.unit,
      display: aedarOverviewScalarDisplayValue(scalar),
      ariaLabel: aedarOverviewScalarAria(
        { scalarFigureTitle: figure.model.scalarFigureTitle },
        scalar,
        comparisonDisplayed,
      ),
      reference: comparisonDisplayed && scalar.reference
        ? {
          label: scalar.reference.label,
          value: scalar.reference.value,
          unit: scalar.reference.unit,
          display: `${formatTimeRampNumber(scalar.reference.value)} ${scalar.reference.unit}`,
        }
        : null,
      rank: comparisonDisplayed && rank
        ? {
          position: rank.position,
          size: rank.size,
          ties: rank.ties ?? null,
          display: formatServedRank(rank),
          aria: formatServedRankAria(rank),
        }
        : null,
    }
  })
  const columns: CahierTableColumn[] = [
    { key: 'value', label: figure.model.scalarFigureTitle, unit: null, kind: 'focal', seriesKey: null },
    ...(comparisonDisplayed ? [{
      key: 'comparison', label: GROUPE_COMPARE_LABEL, unit: null, kind: 'comparison' as const, seriesKey: null,
    }] : []),
  ]
  const rows = scalars.map((scalar) => ({
    key: scalar.key,
    label: scalar.label,
    cells: [
      cell({ columnKey: 'value', value: scalar.value, display: scalar.display, unit: scalar.unit }),
      ...(comparisonDisplayed
        ? [cell({
          columnKey: 'comparison',
          value: scalar.reference?.value ?? null,
          display: scalar.reference
            ? formatTimeRampNumber(scalar.reference.value)
            : CAHIER_UNAVAILABLE_LABEL,
          unit: scalar.reference?.unit ?? scalar.unit,
          rank: scalar.rank
            ? { position: scalar.rank.position, size: scalar.rank.size, ties: scalar.rank.ties }
            : null,
          rankDisplay: scalar.rank?.display ?? null,
          rankAria: scalar.rank?.aria ?? null,
        })]
        : []),
    ],
  }))
  const table: CahierFigureTable = {
    key: figure.slot,
    title: figure.model.scalarFigureTitle,
    columns,
    rows,
    notes: [],
    unit: null,
  }
  return {
    family: 'aedar-car-overview',
    slot: figure.slot,
    title: figure.model.scalarFigureTitle,
    accessibleLabel: scalars.map((scalar) => scalar.ariaLabel).join(' '),
    tables: [table],
    comparisonDisplayed,
    unavailable: [],
    scalars,
    maps: mapProjection(capture),
    comparisonLabel: comparisonDisplayed ? figure.model.comparisonLabel : null,
  }
}

function mapProjection(
  capture: CahierExportCapture,
  groups: readonly { key: string; label: string }[] = [],
): CahierMapsProjection {
  return {
    status: capture.capabilities.maps.status,
    legend: capture.capabilities.maps.legend,
    items: capture.capabilities.maps.items.map((item) => ({
      id: item.id,
      label: item.label,
      declared: item.declared,
      loaded: item.loaded,
      unavailable: item.unavailable,
      // Asset URL and loaded state stay distinct; the owner supplies the actual URL.
      inlineUrl: item.inlineUrl,
    })),
    legendDetail: capture.capabilities.maps.legendDetail,
    groups,
  }
}

export function projectProfile(
  _capture: CahierExportCapture,
  figure: Extract<CahierCaptureFigure, { family: 'aedar-equipment-profile' }>,
): CahierProfileProjection {
  const horizonMinutes = figure.effective.horizonMinutes ?? figure.model.initialHorizonMinutes
  const reading = aedarWaffleReading({
    facts: figure.model.facts,
    threshold: figure.model.threshold,
    horizonMinutes,
  })
  const modes = aedarWaffleModeRows()
  const buckets = (reading.profile?.buckets ?? []).map((bucket) => ({
    key: bucket.key,
    label: bucket.label,
    count: bucket.count,
    types: bucket.types.map((type) => ({ typequ: type.typequ, label: type.label })),
  }))
  const types = (reading.profile?.buckets ?? []).flatMap((bucket) =>
    bucket.types.map((type) => ({
      typequ: type.typequ,
      label: type.label,
      bucket: bucket.key,
      shares: modes.map((mode) => ({
        mode: mode.key,
        value: aedarWaffleShareValue(figure.model.facts, horizonMinutes, type.typequ, mode.key),
        display: aedarWaffleShareLabel(figure.model.facts, horizonMinutes, type.typequ, mode.key),
      })),
    })))
  const columns: CahierTableColumn[] = [
    ...modes.map((mode) => ({
      key: mode.key,
      label: mode.label,
      unit: '%',
      kind: 'focal' as const,
      seriesKey: null,
    })),
  ]
  const rows = types.map((type) => ({
    key: type.typequ,
    label: `${type.label} (${type.typequ})`,
    cells: type.shares.map((share) => cell({
      columnKey: share.mode,
      value: share.value,
      display: share.display,
      unit: '%',
    })),
  }))
  return {
    family: 'aedar-equipment-profile',
    slot: figure.slot,
    title: figure.model.figureTitle,
    accessibleLabel: reading.summary,
    tables: [{
      key: figure.slot,
      title: figure.model.figureTitle,
      columns,
      rows,
      notes: [reading.summary],
      unit: '%',
    }],
    comparisonDisplayed: false,
    unavailable: reading.profile?.status === 'complete'
      ? []
      : [{ kind: 'values', message: reading.summary }],
    horizonMinutes,
    threshold: figure.model.threshold,
    summary: reading.summary,
    buckets,
    modes,
    types,
  }
}

function freezeGroupedBarsProjection(
  figure: CahierGroupedVerticalBarFigureData,
  hiddenSeriesKeys: readonly string[],
): CahierGroupedBarsProjection {
  const categories = Object.freeze(figure.categories.map((category) => Object.freeze({ ...category })))
  const series = Object.freeze(figure.series.map((entry) => Object.freeze({
    ...entry,
    values: Object.freeze([...entry.values]),
    ...(entry.ranks ? { ranks: Object.freeze([...entry.ranks]) } : {}),
  })))
  return Object.freeze({
    figure: Object.freeze({ ...figure, categories, series }),
    hiddenSeriesKeys: Object.freeze([...hiddenSeriesKeys]),
  })
}

export function projectExplorer(
  capture: CahierExportCapture,
  figure: Extract<CahierCaptureFigure, { family: 'aedar-equipment-explorer' }>,
  request: CahierExportRequest,
): CahierExplorerProjection {
  const model = figure.model
  const modes = requestedModes(figure.effective.modes, request)
  const typequ = figure.effective.typequ
  const selectedDetail = figure.effective.selectedDetail
  const baseFact = model.facts.find((fact) => fact.typequ === typequ) ?? null
  const fact = baseFact && selectedDetail?.typequ === baseFact.typequ
    ? { ...baseFact, measures: { ...baseFact.measures, ...selectedDetail.measures } }
    : baseFact
  const comparison = figure.effective.comparison
  const volumeDisplayed = layerDisplayed(capture, 'comparison')
  const distributionDisplayed = layerDisplayed(capture, 'distribution')
  const volumeInput = {
    fact,
    baseFact,
    comparison,
    referenceDetail: figure.effective.referenceDetail,
    comparisonRequestPresent: model.comparisonRequestLabel !== null,
    comparisonLabel: model.comparisonRequestLabel ?? model.referenceLabel,
    // Owner capability (eligibility), not a layer's observed display state.
    comparisonLayerSupported: capture.comparison.eligible,
    volumeYAxisTitle: figure.model.volumeYAxisTitle,
  }
  const volumeRamp = aedarExplorerVolumeRamp(volumeInput)
  const volumeSeries = volumeRamp.series.filter((series) => modes.includes(series.key as AedarRampMode))
  const volume: CahierRampProjection = {
    key: 'volume',
    title: figure.model.volumeFigureTitle,
    xAxis: volumeRamp.xAxis,
    yAxis: volumeRamp.yAxis,
    series: volumeSeries.map((series) => ({
      key: series.key,
      label: series.label,
      points: series.points.map((point) => {
        const reading = timeRampTooltipRows({
          timeRamp: volumeRamp,
          series: [series],
          cut: point,
          territoryName: figure.effective.typequLabel ?? typequ,
          comparisonLayerSupported: volumeDisplayed,
        })[0]
        return {
          cutKey: point.xValue,
          cutLabel: point.xLabel,
          value: point.value,
          display: reading?.value ?? displayNumber(point.value),
          aria: reading?.ariaLabel ?? '',
          referenceValue: volumeDisplayed ? point.referenceValue : null,
          referenceDisplay: reading?.comparison?.value ?? null,
          referenceRank: volumeDisplayed ? point.referenceRank ?? null : null,
          referenceRankDisplay: reading?.comparison?.rank ?? null,
          referenceRankAria: reading?.comparison?.rankAria ?? null,
        }
      }),
    })),
  }
  const quantile = aedarQuantileReading({
    fact,
    horizonMinutes: figure.effective.horizonMinutes ?? figure.model.initialHorizonMinutes,
    selectedModes: modes,
    evidence: model,
    comparison,
    referenceFact: figure.effective.referenceDetail,
    comparisonLabel: volumeInput.comparisonLabel,
    comparisonVisible: distributionDisplayed,
    // The native model keeps its supported reference series; only drawing/table
    // visibility is governed by the owner-observed layer.
    comparisonLayerSupported: capture.comparison.eligible,
  })
  const distFigure = quantile.figure
  const distribution = freezeGroupedBarsProjection(distFigure, quantile.hiddenSeriesKeys)
  const comparisonVisible = distributionDisplayed
    && distFigure.series.some((series) => series.comparisonFor)
  const distributionColumns: CahierTableColumn[] = distFigure.categories.flatMap((category) => [
    {
      key: category.key,
      label: category.axisLabel,
      unit: model.distributionValueUnit,
      kind: 'focal' as const,
      seriesKey: null,
    },
    ...(comparisonVisible ? [{
      key: `${category.key}:comparison`,
      label: `${GROUPE_COMPARE_LABEL} — ${category.axisLabel}`,
      unit: model.distributionValueUnit,
      kind: 'comparison' as const,
      seriesKey: null,
    }] : []),
  ])
  const distributionRows = distFigure.series
    .filter((series) => !series.comparisonFor && !quantile.hiddenSeriesKeys.includes(series.key))
    .map((series) => ({
      key: series.key,
      label: series.label,
      cells: distFigure.categories.flatMap((category, categoryIndex) => {
        const reading = groupedBarTooltipRows(
          distFigure,
          categoryIndex,
          quantile.hiddenSeriesKeys,
        ).find((candidate) => candidate.seriesKey === series.key)
        const focal = cell({
          columnKey: category.key,
          value: reading?.numericValue ?? null,
          display: reading?.value ?? CAHIER_UNAVAILABLE_LABEL,
          unit: model.distributionValueUnit,
        })
        if (!comparisonVisible) return [focal]
        return [focal, cell({
          columnKey: `${category.key}:comparison`,
          value: reading?.comparisonValue ?? null,
          display: reading?.comparison?.value ?? CAHIER_UNAVAILABLE_LABEL,
          unit: model.distributionValueUnit,
          rank: reading?.comparisonRank ?? null,
          rankDisplay: reading?.comparison?.rank ?? null,
          rankAria: reading?.comparison?.rankAria ?? null,
        })]
      }),
    }))
  const distributionTable: CahierFigureTable = {
    key: 'distribution',
    title: figure.model.distributionFigureTitle,
    columns: distributionColumns,
    rows: distributionRows,
    notes: [distFigure.description],
    unit: model.distributionValueUnit,
  }
  const volumeTable = rampTable({
    key: 'volume',
    title: figure.model.volumeFigureTitle,
    timeRamp: volumeRamp,
    series: volumeSeries,
    territoryName: figure.effective.typequLabel ?? typequ,
    comparisonDisplayed: volumeDisplayed,
  })
  return {
    family: 'aedar-equipment-explorer',
    slot: figure.slot,
    title: `${figure.model.volumeFigureTitle} / ${figure.model.distributionFigureTitle}`,
    accessibleLabel: [
      timeRampAccessibleReading({
        timeRamp: volumeRamp,
        series: volumeSeries,
        territoryName: figure.effective.typequLabel ?? typequ,
        comparisonLayerSupported: volumeDisplayed,
      }),
      distFigure.description,
    ].join(' '),
    tables: [volumeTable, distributionTable],
    comparisonDisplayed: volumeDisplayed || distributionDisplayed,
    unavailable: [
      ...(figure.effective.detailStatus === 'error'
        ? [{ kind: 'values' as const, message: 'Valeurs indisponibles pour ce type d’équipement' }]
        : []),
      ...((figure.effective.comparisonError && figure.effective.comparisonStatus === 'error')
        ? [{ kind: 'comparison' as const, message: `Comparaison indisponible : ${figure.effective.comparisonError}` }]
        : []),
    ],
    typequ,
    typequLabel: figure.effective.typequLabel,
    horizonMinutes: figure.effective.horizonMinutes ?? figure.model.initialHorizonMinutes,
    modes,
    volume,
    distribution,
  }
}

export function projectBars(
  capture: CahierExportCapture,
  figure: Extract<CahierCaptureFigure, { family: 'mobilite-bars' }>,
): CahierBarsProjection {
  const evidence = figure.model.figure
  // The section owner's exact predicate, never an inference from the
  // capture absence enum: no control and explicit empty are distinct facts.
  const comparisonNone = capture.comparison.none === true
  const comparisonStateText = mobiliteBarsComparisonStateText({
    status: capture.comparison.status,
    error: capture.comparison.error ?? undefined,
    comparisonNone,
  })
  const showComparison = !comparisonNone && layerDisplayed(capture, figure.slot)
  const rows: CahierTableRow[] = []
  const notes: string[] = [...mobiliteBarResourceNotes({
    figure: evidence,
    comparisonNone,
  })]
  for (const category of evidence.categories) {
    const readings = mobiliteBarReadings({ figure: evidence, category, showComparison })
    for (const reading of readings) {
      if (reading.kind === 'split-note' || reading.kind === 'comparison-split-note') {
        notes.push(reading.ariaLabel)
        continue
      }
      const cells: CahierTableCell[] = [cell({
        columnKey: 'focal',
        value: reading.value,
        display: reading.display,
        unit: reading.unit,
        raw: reading.raw,
      })]
      if (showComparison) {
        cells.push(cell({
          columnKey: 'comparison',
          value: reading.comparison?.value ?? null,
          display: reading.comparison?.display ?? CAHIER_UNAVAILABLE_LABEL,
          unit: reading.comparison?.unit ?? reading.unit,
          raw: reading.raw,
          rank: reading.comparison?.rank ?? null,
          rankDisplay: reading.comparison?.rankDisplay ?? null,
          rankAria: reading.comparison?.rankAria ?? null,
        }))
      }
      rows.push({
        key: reading.key,
        label: `${category.label} — ${reading.label}${reading.raw ? ' (valeur brute)' : ''}`,
        cells,
      })
    }
  }
  if (comparisonStateText) notes.push(comparisonStateText)
  const ratioReference = figure.model.ratio?.value.fact.comparison?.reference ?? null
  const ratioStatus = capture.comparison.status
  // The scalar always renders a reference slot unless comparisonNone; a ready
  // selected group with no served reference visibly says "Indisponible". That
  // observed absence is not the same fact as an intentionally hidden proof.
  // Without any owner observation there is no presented surface to project.
  const ratioOwnerObserved = capture.comparison.none !== null
    || capture.comparison.display.layers.some((layer) => layer.slot === 'ratios')
  const ratioPresented = Boolean(figure.model.ratio)
    && ratioOwnerObserved
    && !comparisonNone
    && (ratioReference !== null
      || ratioStatus === 'ready'
      || ratioStatus === 'loading'
      || ratioStatus === 'error')
  const ratioRankCandidate = ratioPresented && ratioReference
    ? figure.model.ratio?.value.fact.comparison?.rank ?? null
    : null
  const ratioRank = formatServedRank(ratioRankCandidate) ? ratioRankCandidate : null
  const ratioAria = figure.model.ratio
    ? mobiliteRatioAriaLabel({
      ratio: figure.model.ratio,
      scope: evidence.comparisonLabel,
      status: ratioStatus,
      error: capture.comparison.error ?? undefined,
      comparisonNone,
    })
    : null
  const ratio = figure.model.ratio
    ? {
      label: figure.model.ratio.label,
      value: figure.model.ratio.value.fact.value,
      unit: figure.model.ratio.value.fact.unit,
      display: mobiliteRatioDisplayValue(figure.model.ratio),
      note: figure.model.ratio.note,
      ariaLabel: ratioAria ?? '',
      comparisonDisplayed: ratioPresented,
      comparisonValue: ratioPresented ? ratioReference?.value ?? null : null,
      comparisonDisplay: ratioPresented && ratioReference
        ? mobiliteRatioNumber(ratioReference.value)
        : null,
      comparisonRank: ratioRank,
      comparisonRankDisplay: formatServedRank(ratioRank),
      comparisonAria: ratioPresented
        ? mobiliteComparisonAria(
          figure.model.ratio.value,
          evidence.comparisonLabel,
          figure.model.ratio.value.fact.unit,
        )
        : null,
    }
    : null
  if (ratio?.note) notes.push(ratio.note)
  if (ratio) {
    rows.push({
      key: `${figure.slot}:ratio`,
      label: ratio.label,
      cells: [
        cell({ columnKey: 'focal', value: ratio.value, display: ratio.display, unit: ratio.unit }),
        ...(ratio.comparisonDisplayed
          ? [cell({
            columnKey: 'comparison',
            value: ratio.comparisonValue,
            display: ratio.comparisonDisplay ?? CAHIER_UNAVAILABLE_LABEL,
            unit: ratio.unit,
            rank: ratio.comparisonRank,
            rankDisplay: ratio.comparisonRankDisplay,
            rankAria: formatServedRankAria(ratio.comparisonRank),
          })]
          : []),
      ],
    })
  }
  const columns: CahierTableColumn[] = [
    { key: 'focal', label: evidence.xAxisTitle, unit: evidence.unit, kind: 'focal', seriesKey: null },
    ...(showComparison || ratio?.comparisonDisplayed
      ? [{
        key: 'comparison', label: GROUPE_COMPARE_LABEL, unit: evidence.unit, kind: 'comparison' as const, seriesKey: null,
      }]
      : []),
  ]
  return {
    family: 'mobilite-bars',
    slot: figure.slot,
    title: evidence.figureTitle,
    accessibleLabel: mobiliteBarsAccessibleLabel({
      figure: evidence,
      showComparison,
      comparisonNone,
    }),
    tables: [{
      key: figure.slot,
      title: evidence.figureTitle,
      columns,
      rows,
      notes,
      unit: evidence.unit,
    }],
    comparisonDisplayed: showComparison || (ratio?.comparisonDisplayed ?? false),
    unavailable: [
      ...(evidence.unavailableResources ?? []).map((label) => ({
        kind: 'resource' as const,
        message: `Publication indisponible : ${label}`,
      })),
      ...(comparisonNone
        ? []
        : (evidence.unavailableComparisons ?? []).map((label) => ({
          kind: 'comparison' as const,
          message: `Comparaison indisponible : ${label}`,
        }))),
    ],
    figureTitle: evidence.figureTitle,
    unit: evidence.unit,
    xAxisTitle: evidence.xAxisTitle,
    yAxisTitle: evidence.yAxisTitle,
    comparisonLabel: showComparison || (ratio?.comparisonDisplayed ?? false)
      ? evidence.comparisonLabel
      : null,
    comparisonStatus: capture.comparison.status,
    comparisonStateText,
    maps: capture.capabilities.maps.status === 'none'
      ? null
      : mapProjection(capture),
    ratio,
  }
}

export function projectShare(
  capture: CahierExportCapture,
  figure: Extract<CahierCaptureFigure, { family: 'mobilite-share' }>,
): CahierShareProjection {
  const evidence = figure.model
  const status = capture.comparison.status
  const comparisonNone = capture.comparison.none === true
  const displayed = layerDisplayed(capture, 'share') && status === 'ready' && !comparisonNone
  const value = mobiliteShareValue(evidence)
  const reference = mobiliteShareReference({ figure: evidence, status, comparisonNone })
  const comparison = evidence.value.fact.comparison
  // The shared rank contract suppresses a singleton (1/1) in every projection.
  const candidateRank = displayed ? comparison?.rank ?? null : null
  const rank = formatServedRank(candidateRank) ? candidateRank : null
  const rankDisplay = formatServedRank(rank)
  const rankAria = formatServedRankAria(rank)
  const notes = mobiliteSharePublicationNotes({ figure: evidence, comparisonNone })
  const stateMessage = mobiliteShareStateMessage({
    figure: evidence,
    status,
    error: capture.comparison.error ?? undefined,
    comparisonNone,
  })
  const territoryAria = mobiliteShareTerritoryAria(evidence)
  const comparisonAria = displayed
    ? mobiliteShareComparisonAria({ figure: evidence, status, comparisonNone })
    : null
  const rows: CahierTableRow[] = [{
    key: 'territory',
    label: evidence.territoryName,
    cells: [
      cell({
        columnKey: 'focal', value, display: mobiliteShareVisibleLabel(value, evidence),
        unit: mobiliteShareDisplayUnit(evidence),
      }),
      ...(displayed
        ? [cell({
          columnKey: 'comparison', value: reference,
          display: mobiliteShareVisibleLabel(reference, evidence),
          unit: mobiliteShareDisplayUnit(evidence),
          rank, rankDisplay, rankAria,
        })]
        : []),
    ],
  }]
  return {
    family: 'mobilite-share',
    slot: figure.slot,
    title: evidence.figureTitle,
    accessibleLabel: comparisonAria ? `${territoryAria} ${comparisonAria}` : territoryAria,
    tables: [{
      key: 'share',
      title: evidence.figureTitle,
      columns: [
        { key: 'focal', label: evidence.territoryName, unit: mobiliteShareDisplayUnit(evidence), kind: 'focal', seriesKey: null },
        ...(displayed ? [{
          key: 'comparison', label: GROUPE_COMPARE_LABEL, unit: mobiliteShareDisplayUnit(evidence),
          kind: 'comparison' as const, seriesKey: null,
        }] : []),
      ],
      rows,
      notes,
      unit: mobiliteShareDisplayUnit(evidence),
    }],
    comparisonDisplayed: displayed,
    unavailable: [
      ...(evidence.unavailableResources ?? []).map((label) => ({
        kind: 'resource' as const,
        message: `Publication indisponible : ${label}`,
      })),
      ...(comparisonNone
        ? []
        : (evidence.unavailableComparisons ?? []).map((label) => ({
          kind: 'comparison' as const,
          message: `Comparaison indisponible : ${label}`,
        }))),
    ],
    figureTitle: evidence.figureTitle,
    territoryName: evidence.territoryName,
    unit: mobiliteShareDisplayUnit(evidence),
    value,
    display: mobiliteShareVisibleLabel(value, evidence),
    precise: mobiliteSharePreciseLabel(value, evidence),
    comparisonValue: reference,
    comparisonDisplay: reference === null ? null : mobiliteShareVisibleLabel(reference, evidence),
    comparisonPrecise: reference === null ? null : mobiliteSharePreciseLabel(reference, evidence),
    comparisonRank: rank,
    comparisonRankDisplay: rankDisplay,
    comparisonRankAria: rankAria,
    comparisonLabel: displayed ? evidence.comparisonLabel : null,
    territoryAria,
    comparisonAria,
    notes,
    stateMessage,
  }
}

export function projectCurve(
  capture: CahierExportCapture,
  figure: Extract<CahierCaptureFigure, { family: 'mobilite-curve' }>,
): CahierCurveProjection {
  const evidence = figure.model
  const displayed = layerDisplayed(capture, 'curve')
  const comparisonNone = capture.comparison.none === true
  const readings = mobiliteCurveReadings({ figure: evidence, showComparison: displayed })
  const unit = evidence.points[0]?.fact.unit ?? '%'
  const unavailable: readonly CahierUnavailableItem[] = mobiliteCurveUnavailableNotes({
    figure: evidence,
    comparisonNone,
  })
  const comparisonStateText = mobiliteCurveComparisonStateText({
    figure: evidence,
    status: capture.comparison.status,
    error: capture.comparison.error ?? undefined,
    comparisonNone,
  })
  const marker = evidence.trajectory?.marker
  const markerReading = marker
    ? readings.find((reading) => reading.detail === marker.detail) ?? null
    : null
  const markerValue = evidence.markerValue
  const candidateMarkerRank = displayed && markerValue?.fact.detail === marker?.detail
    ? markerValue?.fact.comparison?.rank ?? null
    : null
  const markerRank = formatServedRank(candidateMarkerRank) ? candidateMarkerRank : null
  const markerRankDisplay = formatServedRank(markerRank)
  const markerRankAria = mobiliteCurveMarkerRankAria({ figure: evidence, showComparison: displayed })
  const rows = readings.map((reading) => ({
    key: reading.detail,
    label: reading.label,
    cells: [
      cell({ columnKey: 'focal', value: reading.value, display: reading.display, unit }),
      ...(displayed
        ? [cell({
          columnKey: 'comparison',
          value: reading.comparisonValue,
          display: reading.comparisonDisplay ?? CAHIER_UNAVAILABLE_LABEL,
          unit,
          rank: reading.comparisonRank,
          rankDisplay: reading.comparisonRankDisplay,
          rankAria: reading.comparisonRankAria,
        })]
        : []),
    ],
  }))
  return {
    family: 'mobilite-curve',
    slot: figure.slot,
    title: evidence.figureTitle,
    accessibleLabel: mobiliteCurveAccessibleLabel({
      figure: evidence,
      showComparison: displayed,
      notes: [
        ...unavailable.map((item) => item.message),
        ...(comparisonStateText ? [comparisonStateText] : []),
      ],
    }),
    tables: [{
      key: 'curve',
      title: evidence.figureTitle,
      columns: [
        { key: 'focal', label: evidence.territoryName, unit, kind: 'focal', seriesKey: null },
        ...(displayed ? [{
          key: 'comparison', label: GROUPE_COMPARE_LABEL, unit, kind: 'comparison' as const, seriesKey: null,
        }] : []),
      ],
      rows,
      notes: [
        ...unavailable.map((item) => item.message),
        ...(comparisonStateText ? [comparisonStateText] : []),
      ],
      unit,
    }],
    comparisonDisplayed: displayed,
    unavailable,
    figureTitle: evidence.figureTitle,
    xAxisTitle: evidence.xAxisTitle,
    yAxisTitle: evidence.trajectory?.axisLabels?.y ?? 'population joignable (%)',
    comparisonStatus: capture.comparison.status,
    comparisonStateText,
    unit,
    points: readings,
    marker: marker ? {
      detail: marker.detail,
      label: marker.label,
      axisValue: mobiliteCurveCoordinateForDetail(evidence, marker.detail),
      value: markerValue?.fact.detail === marker.detail
        ? markerValue.fact.value
        : markerReading?.value ?? null,
      display: markerValue?.fact.detail === marker.detail
        ? mobiliteCurveVisiblePercent(markerValue.fact.value)
        : markerReading?.display ?? CAHIER_UNAVAILABLE_LABEL,
      rank: markerRank,
      rankDisplay: markerRankDisplay,
      rankAria: markerRankAria,
    } : null,
    comparisonLabel: displayed ? evidence.comparisonLabel : null,
  }
}

export function projectMaps(
  capture: CahierExportCapture,
  figure: Extract<CahierCaptureFigure, { family: 'aedar-diversity-loss' }>,
): CahierMapsFigureProjection {
  const legend = figure.model.legend
  return {
    family: 'aedar-diversity-loss',
    slot: figure.slot,
    title: figure.model.mapFigureTitle.map((segment) => segment.value).join(''),
    accessibleLabel: legend?.ariaLabel ?? figure.model.mapFigureTitle.map((segment) => segment.value).join(''),
    tables: [],
    comparisonDisplayed: false,
    unavailable: figure.model.metadataState === 'unavailable'
      ? [{ kind: 'legend', message: 'Légende indisponible' }]
      : figure.model.metadataState === 'loading'
        ? [{ kind: 'legend', message: 'Légende en chargement' }]
        : [],
    maps: mapProjection(capture, figure.model.comparisonGroups),
  }
}

export function projeterFigureExport(
  capture: CahierExportCapture,
  figure: CahierCaptureFigure,
  request: CahierExportRequest,
): CahierFigureProjection {
  switch (figure.family) {
    case 'aedar-ramps': return projectRamps(capture, figure, request)
    case 'aedar-car-overview': return projectOverview(capture, figure)
    case 'aedar-diversity-loss': return projectMaps(capture, figure)
    case 'aedar-equipment-profile': return projectProfile(capture, figure)
    case 'aedar-equipment-explorer': return projectExplorer(capture, figure, request)
    case 'mobilite-bars': return projectBars(capture, figure)
    case 'mobilite-share': return projectShare(capture, figure)
    case 'mobilite-curve': return projectCurve(capture, figure)
  }
}

/** One frozen request -> every figure/table projection of its section. */
export function projeterRequeteExportFigures(
  request: CahierExportRequest,
): readonly CahierFigureProjection[] {
  const capture = request.capture
  return capture.figures.map((figure) => projeterFigureExport(capture, figure, request))
}

/** Convenience for tests/consumers that hold a capture without mode projection. */
export function projeterCaptureExportFigures(
  capture: CahierExportCapture,
): readonly CahierFigureProjection[] {
  return projeterRequeteExportFigures(
    Object.freeze({ capture, modes: Object.freeze([]), modeIds: Object.freeze([]) }),
  ) as readonly CahierFigureProjection[]
}
