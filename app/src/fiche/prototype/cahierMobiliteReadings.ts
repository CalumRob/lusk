/**
 * Pure Mobilité compared-bar readings (#1022).
 *
 * The compared-bar family is deliberately distinct from the AEDAR grouped-bar
 * family: categories carry segmented territory bars, raw tooltip numerators and
 * one served comparison per value. These builders are the single owner of the
 * rows and accessible text consumed by the live tooltip and the PDF table.
 */
import type {
  CahierTooltipComparison,
  CahierTooltipRow,
  CahierTooltipTone,
} from '@/fiche/cahierFigureGrammaire'
import { GROUPE_COMPARE_LABEL } from '@/fiche/content/comparisonWording'
import type {
  ContentFact,
  MobiliteBarCategoryEvidence,
  MobiliteBarSegmentEvidence,
  MobiliteBarsFigureEvidence,
  MobiliteRatioEvidence,
  MobiliteRaccordementEvidence,
  MobiliteShareEvidence,
} from '@/fiche/content/themeContent'
import type { ComparisonRank, NumericFact } from '@/fiche/content/territoryFacts'
import { formatServedRank, formatServedRankAria, puceRangDirection } from '@/fiche/figureGrammaire'
import { LIBELLES_DIRECTION } from '@/methodes/indicateurs'

export const MOBILITE_UNAVAILABLE_LABEL = 'Indisponible'

export function formatMobiliteBarValue(value: number): string {
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(value)
}

export function mobiliteFiniteValue(value: number | null | undefined): number | null {
  return value === null || value === undefined || !Number.isFinite(value) ? null : value
}

export function mobiliteBarToneColor(tone: MobiliteBarCategoryEvidence['tone']): string {
  return tone === 'c'
    ? 'var(--cahier-mode-car)'
    : tone === 'b'
      ? 'var(--cahier-mode-bike)'
      : tone === 't'
        ? 'var(--cahier-mode-foot)'
        : tone === 'brand'
          // The app's own ink, distinct from every mode colour (#976).
          ? 'var(--brand-500)'
          : 'var(--cahier-theme-strong)'
}

const SEGMENT_COLORS: Readonly<Record<string, string>> = {
  protege_km_1000: 'var(--cahier-cycle-protected, var(--cahier-mode-bike, var(--mode-bike)))',
  partage_km_1000: 'var(--cahier-cycle-shared, #8c4c9e)',
}

export function mobiliteBarSegmentColor(segment: { key: string }): string {
  return SEGMENT_COLORS[segment.key] ?? SEGMENT_COLORS.partage_km_1000!
}

export function mobiliteBarReferenceValue(category: MobiliteBarCategoryEvidence): number | null {
  return mobiliteFiniteValue(category.value.fact.comparison?.reference?.value)
}

type FactComparison = NonNullable<ContentFact['fact']['comparison']>

export function mobiliteComparisonStatistic(comparison: FactComparison | null | undefined): string {
  return comparison?.reference?.kind === 'mean' ? 'moyenne' : 'médiane'
}

export function mobiliteComparisonDirection(comparison: FactComparison | null | undefined): string | null {
  return comparison?.direction ? LIBELLES_DIRECTION[comparison.direction] : null
}

export function mobiliteComparisonScopeOnly(label: string | null): string | null {
  return label?.replace(/^(?:Médiane|Moyenne) des /u, '') ?? null
}

export function mobiliteComparisonDescription(
  comparison: FactComparison | null | undefined,
  scope: string | null,
  unsplitTotal = false,
): string {
  const statistic = mobiliteComparisonStatistic(comparison)
  if (unsplitTotal) {
    const scopeOnly = mobiliteComparisonScopeOnly(scope)
    return `${statistic} du total non segmenté${scopeOnly ? ` — ${scopeOnly}` : ''}`
  }
  return scope ?? statistic
}

export function mobiliteRankPhrase(comparison: FactComparison | null | undefined): string | null {
  if (!comparison) return null
  return puceRangDirection(comparison.rank, comparison.direction)?.phraseAria
    ?? formatServedRankAria(comparison.rank)
}

export function mobiliteComparisonAria(
  fact: ContentFact,
  scope: string | null,
  unit: string,
  unsplitTotal = false,
): string {
  const comparison = fact.fact.comparison
  const reference = comparison?.reference
  if (!reference) return `${GROUPE_COMPARE_LABEL} : ${MOBILITE_UNAVAILABLE_LABEL}`
  const value = `${formatMobiliteBarValue(reference.value)} ${unit}`
  const description = mobiliteComparisonDescription(comparison, scope, unsplitTotal)
  const direction = mobiliteComparisonDirection(comparison)
  const rank = mobiliteRankPhrase(comparison)
  return `${GROUPE_COMPARE_LABEL} : ${value} (${description})${rank ? `. Rang ${rank}` : direction ? `. ${direction}` : ''}`
}

export function mobiliteRatioValueLabel(ratio: MobiliteRatioEvidence): string {
  const value = mobiliteFiniteValue(ratio.value.fact.value)
  return value === null
    ? MOBILITE_UNAVAILABLE_LABEL
    : `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 }).format(value)} ${ratio.value.fact.unit}`
}

export interface CahierMobiliteComparisonReading {
  readonly value: number | null
  readonly display: string
  readonly unit: string
  readonly rank: ComparisonRank | null
  readonly rankDisplay: string | null
  readonly rankAria: string | null
  readonly ariaLabel: string
}

export type CahierMobiliteBarReadingKind =
  | 'total'
  | 'segment'
  | 'raw'
  | 'split-note'
  | 'comparison-split-note'

export interface CahierMobiliteBarReading {
  /** Stable identity inside the category, never an array index. */
  readonly key: string
  readonly kind: CahierMobiliteBarReadingKind
  readonly categoryKey: string
  readonly label: string
  readonly value: number | null
  readonly display: string
  readonly unit: string
  readonly raw: boolean
  readonly tone: CahierTooltipTone
  readonly marker?: 'dot' | 'slash'
  readonly markerColor?: string
  readonly ariaLabel: string
  readonly comparison: CahierMobiliteComparisonReading | null
}

function comparisonReading(
  fact: ContentFact,
  scope: string | null,
  unit: string,
  unsplitTotal = false,
): CahierMobiliteComparisonReading | null {
  const comparison = fact.fact.comparison
  const reference = comparison?.reference
  if (!reference) return null
  return {
    value: reference.value,
    // Tooltip values are bare; the accessible label keeps the full unit, scope and rank.
    display: formatMobiliteBarValue(reference.value),
    unit,
    rank: comparison.rank,
    rankDisplay: formatServedRank(comparison.rank),
    rankAria: formatServedRankAria(comparison.rank),
    ariaLabel: mobiliteComparisonAria(fact, scope, unit, unsplitTotal),
  }
}

function totalRowLabel(category: MobiliteBarCategoryEvidence): string {
  return category.key === 'bike' ? 'Total vélo' : category.label
}

/**
 * Every value the compared-bar tooltip / PDF table can show, resolved once.
 * The row order is the product tooltip order: total, split notes, segments,
 * each segment's raw numerator, then the category raw numerator.
 */
export function mobiliteBarReadings(options: {
  figure: MobiliteBarsFigureEvidence
  category: MobiliteBarCategoryEvidence
  showComparison: boolean
}): readonly CahierMobiliteBarReading[] {
  const { figure, category, showComparison } = options
  const unit = figure.unit
  const total = mobiliteFiniteValue(category.value.fact.value)
  const readings: CahierMobiliteBarReading[] = [{
    key: `${category.key}:total`,
    kind: 'total',
    categoryKey: category.key,
    label: totalRowLabel(category),
    value: total,
    display: total === null ? MOBILITE_UNAVAILABLE_LABEL : formatMobiliteBarValue(total),
    unit,
    raw: false,
    tone: 'neutral',
    markerColor: mobiliteBarToneColor(category.tone),
    ariaLabel: `${totalRowLabel(category)} : ${total === null ? MOBILITE_UNAVAILABLE_LABEL : `${formatMobiliteBarValue(total)} ${unit}`}`,
    comparison: showComparison
      ? comparisonReading(category.value, figure.comparisonLabel,
        unit, category.segments.length > 0 && !category.comparisonSplit)
      : null,
  }]
  if (category.splitNote) {
    readings.push({
      key: `${category.key}:split-note`,
      kind: 'split-note',
      categoryKey: category.key,
      label: 'Répartition Protégé/Partagé',
      value: null,
      display: MOBILITE_UNAVAILABLE_LABEL,
      unit: '',
      raw: false,
      tone: 'neutral',
      marker: 'slash',
      ariaLabel: category.splitNote,
      comparison: null,
    })
  }
  if (showComparison && category.comparisonSplitNote) {
    readings.push({
      key: `${category.key}:comparison-split-note`,
      kind: 'comparison-split-note',
      categoryKey: category.key,
      label: 'Répartition comparée Protégé/Partagé',
      value: null,
      display: MOBILITE_UNAVAILABLE_LABEL,
      unit: '',
      raw: false,
      tone: 'neutral',
      marker: 'slash',
      ariaLabel: category.comparisonSplitNote,
      comparison: null,
    })
  }
  for (const segment of category.segments) {
    readings.push(...segmentReadings({ figure, categoryKey: category.key, segment, showComparison, unit }))
  }
  if (category.rawValue) {
    const raw = mobiliteFiniteValue(category.rawValue.fact.value)
    const rawUnit = category.rawValue.fact.unit
    readings.push({
      key: `${category.key}:raw`,
      kind: 'raw',
      categoryKey: category.key,
      label: category.rawValue.label,
      value: raw,
      display: raw === null ? MOBILITE_UNAVAILABLE_LABEL : formatMobiliteBarValue(raw),
      unit: rawUnit,
      raw: true,
      tone: 'neutral',
      marker: 'slash',
      ariaLabel: `${category.rawValue.label} : ${raw === null ? MOBILITE_UNAVAILABLE_LABEL : `${formatMobiliteBarValue(raw)} ${rawUnit}`} (valeur brute)`,
      comparison: showComparison
        ? comparisonReading(category.rawValue, figure.comparisonLabel, rawUnit)
        : null,
    })
  }
  return readings
}

function segmentReadings(options: {
  figure: MobiliteBarsFigureEvidence
  categoryKey: string
  segment: MobiliteBarSegmentEvidence
  showComparison: boolean
  unit: string
}): readonly CahierMobiliteBarReading[] {
  const { figure, categoryKey, segment, showComparison, unit } = options
  const segmentValue = mobiliteFiniteValue(segment.value.fact.value)
  const readings: CahierMobiliteBarReading[] = [{
    key: `${categoryKey}:segment:${segment.key}`,
    kind: 'segment',
    categoryKey,
    label: segment.label,
    value: segmentValue,
    display: segmentValue === null ? MOBILITE_UNAVAILABLE_LABEL : formatMobiliteBarValue(segmentValue),
    unit,
    raw: false,
    tone: 'b',
    marker: 'dot',
    markerColor: mobiliteBarSegmentColor(segment),
    ariaLabel: `${segment.label} : ${segmentValue === null ? MOBILITE_UNAVAILABLE_LABEL : `${formatMobiliteBarValue(segmentValue)} ${unit}`}`,
    comparison: showComparison
      ? comparisonReading(segment.value, figure.comparisonLabel, unit)
      : null,
  }]
  if (segment.rawValue) {
    const raw = mobiliteFiniteValue(segment.rawValue.fact.value)
    const rawUnit = segment.rawValue.fact.unit
    readings.push({
      key: `${categoryKey}:segment:${segment.key}:raw`,
      kind: 'raw',
      categoryKey,
      label: segment.rawValue.label,
      value: raw,
      display: raw === null ? MOBILITE_UNAVAILABLE_LABEL : formatMobiliteBarValue(raw),
      unit: rawUnit,
      raw: true,
      tone: 'neutral',
      marker: 'slash',
      ariaLabel: `${segment.rawValue.label} : ${raw === null ? MOBILITE_UNAVAILABLE_LABEL : `${formatMobiliteBarValue(raw)} ${rawUnit}`} (valeur brute)`,
      comparison: showComparison
        ? comparisonReading(segment.rawValue, figure.comparisonLabel, rawUnit)
        : null,
    })
  }
  return readings
}

/** The tooltip row shape, preserving the current visible order and labels. */
export function mobiliteBarTooltipRows(
  readings: readonly CahierMobiliteBarReading[],
): readonly CahierTooltipRow[] {
  return readings.map((reading): CahierTooltipRow => ({
    label: reading.label,
    value: reading.display,
    tone: reading.tone,
    ...(reading.marker ? { marker: reading.marker } : {}),
    ...(reading.markerColor ? { markerColor: reading.markerColor } : {}),
    ariaLabel: reading.ariaLabel,
    ...(reading.comparison
      ? {
          comparison: {
            value: reading.comparison.display,
            rank: reading.comparison.rankDisplay,
            rankEvidence: reading.comparison.rank,
            rankAria: reading.comparison.rankAria,
            ariaLabel: reading.comparison.ariaLabel,
          } satisfies CahierTooltipComparison,
        }
      : {}),
  }))
}

/** The category's complete accessible reading, built from the same values. */
export function mobiliteBarCategoryAria(options: {
  figure: MobiliteBarsFigureEvidence
  category: MobiliteBarCategoryEvidence
  showComparison: boolean
}): string {
  const { figure, category, showComparison } = options
  const unit = figure.unit
  const total = mobiliteFiniteValue(category.value.fact.value)
  const parts = [`${totalRowLabel(category)} : ${total === null ? MOBILITE_UNAVAILABLE_LABEL : `${formatMobiliteBarValue(total)} ${unit}`}`]
  if (category.splitNote) parts.push(category.splitNote)
  for (const segment of category.segments) {
    const segmentValue = mobiliteFiniteValue(segment.value.fact.value)
    parts.push(`${segment.label} : ${segmentValue === null ? MOBILITE_UNAVAILABLE_LABEL : `${formatMobiliteBarValue(segmentValue)} ${unit}`}`)
    if (showComparison) {
      const comparison = segment.value.fact.comparison
      const reference = comparison?.reference
      if (reference) {
        const rank = mobiliteRankPhrase(comparison)
        const direction = mobiliteComparisonDirection(comparison)
        const description = mobiliteComparisonDescription(comparison, figure.comparisonLabel)
        parts.push(`${GROUPE_COMPARE_LABEL} ${segment.label} : ${formatMobiliteBarValue(reference.value)} ${unit} (${description})${rank ? ` — rang ${rank}` : direction ? ` — ${direction}` : ''}`)
      }
    }
  }
  if (showComparison) {
    const reference = mobiliteBarReferenceValue(category)
    if (reference !== null) {
      const comparison = category.value.fact.comparison!
      const unsplit = category.segments.length > 0 && !category.comparisonSplit
      const description = mobiliteComparisonDescription(comparison, figure.comparisonLabel, unsplit)
      const rank = mobiliteRankPhrase(comparison)
      const direction = mobiliteComparisonDirection(comparison)
      parts.push(`${GROUPE_COMPARE_LABEL} : ${formatMobiliteBarValue(reference)} ${unit} (${description})${rank ? ` — rang ${rank}` : direction ? ` — ${direction}` : ''}`)
    } else {
      parts.push(`${GROUPE_COMPARE_LABEL} : ${MOBILITE_UNAVAILABLE_LABEL}`)
    }
    if (category.comparisonSplitNote) parts.push(category.comparisonSplitNote)
  }
  return parts.join(' ; ')
}

export function mobiliteBarResourceNotes(options: {
  figure: MobiliteBarsFigureEvidence
  comparisonNone?: boolean
}): readonly string[] {
  const { figure, comparisonNone = false } = options
  const notes: string[] = []
  if (figure.unavailableResources?.length) {
    notes.push(`Publication indisponible : ${figure.unavailableResources.join(', ')}`)
  }
  if (!comparisonNone && figure.unavailableComparisons?.length) {
    notes.push(`Comparaison indisponible : ${figure.unavailableComparisons.join(', ')}`)
  }
  return notes
}

export function mobiliteBarsAccessibleLabel(options: {
  figure: MobiliteBarsFigureEvidence
  showComparison: boolean
}): string {
  const { figure, showComparison } = options
  const readings = figure.categories
    .map((category) => mobiliteBarCategoryAria({ figure, category, showComparison }))
    .join(' ; ')
  const notes = mobiliteBarResourceNotes({ figure }).join(' ')
  return `${figure.figureTitle}. Barres verticales groupées par ${figure.xAxisTitle.toLocaleLowerCase('fr-FR')}, en ${figure.unit}. ${readings}. Axe horizontal : ${figure.xAxisTitle}. Axe vertical : ${figure.yAxisTitle}.${notes ? ` ${notes}` : ''}`
}

/* ------------------------------------------------------------------ *
 * Coverage share track (#1006) — the two-row 0-100 % figure
 * ------------------------------------------------------------------ */

/** The published share only when the fact is complete; null stays absent. */
export function mobiliteShareValue(figure: MobiliteShareEvidence): number | null {
  const fact = figure.value.fact
  return fact.availability === 'complete' && fact.value !== null && Number.isFinite(fact.value)
    ? fact.value
    : null
}

/** A served reference is drawn only for a ready comparison with an explicit row. */
export function mobiliteShareReference(options: {
  figure: MobiliteShareEvidence
  status: 'idle' | 'loading' | 'ready' | 'error' | 'unavailable'
  comparisonNone?: boolean
}): number | null {
  const { figure, status, comparisonNone = false } = options
  if (comparisonNone || status !== 'ready') return null
  const fact = figure.value.fact.comparison
  if (!fact?.reference || !Number.isFinite(fact.reference.value)) return null
  return fact.reference.value
}

function shareScaledValue(figure: MobiliteShareEvidence, value: number): number {
  return figure.unit.trim() === '%' ? value * 100 : value
}

/** The served unit, never an invented percentage. */
export function mobiliteShareDisplayUnit(figure: MobiliteShareEvidence): string {
  return figure.unit.trim() || '%'
}

/** Visible label: one decimal, the same precision for both rows. */
export function mobiliteShareVisibleLabel(value: number | null, figure: MobiliteShareEvidence): string {
  return value === null
    ? MOBILITE_UNAVAILABLE_LABEL
    : `${new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
      .format(shareScaledValue(figure, value))} ${mobiliteShareDisplayUnit(figure)}`
}

/** Accessible reading keeps the served value's actual precision. */
export function mobiliteSharePreciseLabel(value: number | null, figure: MobiliteShareEvidence): string {
  return value === null
    ? MOBILITE_UNAVAILABLE_LABEL
    : `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 4 })
      .format(shareScaledValue(figure, value))} ${mobiliteShareDisplayUnit(figure)}`
}

export interface CahierMobiliteShareDetail {
  readonly statistic: 'Moyenne' | 'Médiane'
  readonly rank: string | null
  readonly direction: string | null
}

export function mobiliteShareComparisonDetail(
  figure: MobiliteShareEvidence,
): CahierMobiliteShareDetail | null {
  const comparison = figure.value.fact.comparison
  if (!comparison) return null
  return {
    statistic: comparison.reference?.kind === 'mean' ? 'Moyenne' : 'Médiane',
    rank: formatServedRankAria(comparison.rank),
    direction: LIBELLES_DIRECTION[comparison.direction] ?? null,
  }
}

export function mobiliteSharePublicationNotes(options: {
  figure: MobiliteShareEvidence
  comparisonNone?: boolean
}): readonly string[] {
  const { figure, comparisonNone = false } = options
  return [
    ...(figure.unavailableResources ?? []).map((label) => `Publication indisponible : ${label}`),
    ...(comparisonNone
      ? []
      : (figure.unavailableComparisons ?? []).map((label) => `Comparaison indisponible : ${label}`)),
  ]
}

export const MOBILITE_SHARE_REMAINDER_READING =
  'Barre de 0 à 100 % ; le reste de la barre est le complément de la part publiée.'

export function mobiliteShareTerritoryAria(figure: MobiliteShareEvidence): string {
  return [
    figure.figureTitle,
    `${figure.territoryName} : ${mobiliteSharePreciseLabel(mobiliteShareValue(figure), figure)}`,
    MOBILITE_SHARE_REMAINDER_READING,
    ...(figure.unavailableResources ?? []).map((label) => `Publication indisponible : ${label}`),
  ].join('. ')
}

export function mobiliteShareComparisonAria(options: {
  figure: MobiliteShareEvidence
  status: 'idle' | 'loading' | 'ready' | 'error' | 'unavailable'
  comparisonNone?: boolean
}): string {
  const { figure, status, comparisonNone = false } = options
  if (status === 'loading') {
    return `${figure.figureTitle}. ${GROUPE_COMPARE_LABEL} : chargement en cours.`
  }
  const reference = mobiliteShareReference({ figure, status, comparisonNone })
  const detail = mobiliteShareComparisonDetail(figure)
  if (reference === null || !detail) {
    return [
      figure.figureTitle,
      `${GROUPE_COMPARE_LABEL} : indisponible`,
      ...(comparisonNone
        ? []
        : (figure.unavailableComparisons ?? []).map((label) => `Comparaison indisponible : ${label}`)),
    ].join('. ')
  }
  return [
    figure.figureTitle,
    `${GROUPE_COMPARE_LABEL} : ${mobiliteSharePreciseLabel(reference, figure)}`,
    figure.comparisonLabel ?? `${detail.statistic} du groupe comparé`,
    detail.rank ? `Rang ${detail.rank}` : detail.direction,
    MOBILITE_SHARE_REMAINDER_READING,
    ...(comparisonNone
      ? []
      : (figure.unavailableComparisons ?? []).map((label) => `Comparaison indisponible : ${label}`)),
  ].filter(Boolean).join('. ')
}

export function mobiliteShareStateMessage(options: {
  figure: MobiliteShareEvidence
  status: 'idle' | 'loading' | 'ready' | 'error' | 'unavailable'
  error?: string
  comparisonNone?: boolean
}): string | null {
  const { figure, status, error, comparisonNone = false } = options
  if (comparisonNone) return null
  if (status === 'loading') return 'Chargement du groupe comparé…'
  if (status === 'error') {
    return figure.unavailableComparisons?.length ? null : error ?? 'Groupe comparé indisponible.'
  }
  if (status === 'unavailable') return 'Groupe comparé indisponible pour cette sélection.'
  if (status === 'idle') return 'Aucune comparaison active : aucun repère de groupe comparé n’est affiché.'
  if (mobiliteShareReference({ figure, status }) === null
    && (figure.unavailableComparisons?.length ?? 0) === 0) {
    return 'Aucun repère de groupe comparé disponible pour cette sélection.'
  }
  return null
}

/* ------------------------------------------------------------------ *
 * Raccordement curve — declared grid, points and published marker
 * ------------------------------------------------------------------ */

export function mobiliteCurvePercent(value: number): number {
  return Math.max(0, Math.min(100, value * 100))
}

export function mobiliteCurveVisiblePercent(value: number | null): string {
  return value === null
    ? MOBILITE_UNAVAILABLE_LABEL
    : new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 }).format(mobiliteCurvePercent(value))
}

export function mobiliteCurveAriaPercent(value: number | null, unit: string): string {
  return value === null
    ? MOBILITE_UNAVAILABLE_LABEL
    : `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 }).format(mobiliteCurvePercent(value))} ${unit}`
}

export function mobiliteCurveTickLabel(tick: { label: string }, axisValue: number): string {
  if (axisValue > 0 && axisValue < 60 && !/min/iu.test(tick.label)) {
    return `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(axisValue)} min`
  }
  return tick.label
}

export function mobiliteCurveAxisForDetail(
  figure: MobiliteRaccordementEvidence,
  detail: string | null,
): number | null {
  if (!detail) return null
  const declared = figure.axis?.values.find((value) => value.detail === detail)?.numericValue
  return declared !== undefined && Number.isFinite(declared) ? declared : null
}

function mobiliteCurveAxisForFact(
  figure: MobiliteRaccordementEvidence,
  fact: NumericFact,
): number | null {
  if (typeof fact.axisValue === 'number' && Number.isFinite(fact.axisValue)) return fact.axisValue
  return mobiliteCurveAxisForDetail(figure, fact.detail)
}

function mobiliteCurvePointAt(
  points: readonly { fact: NumericFact }[],
  detail: string,
): NumericFact | null {
  return points.find((point) => point.fact.detail === detail)?.fact ?? null
}

export interface CahierCurveReading {
  readonly detail: string
  readonly axisValue: number
  readonly label: string
  /** Exact native share; null stays absent. */
  readonly value: number | null
  readonly display: string
  readonly aria: string
  readonly comparisonValue: number | null
  readonly comparisonDisplay: string | null
  readonly comparisonAria: string | null
  readonly comparisonRank: ComparisonRank | null
  readonly comparisonRankDisplay: string | null
  readonly comparisonRankAria: string | null
}

/**
 * Every declared grid point, joined by its detail identity. Values are the
 * producer's shares; nothing is smoothed, resampled or re-based.
 */
export function mobiliteCurveReadings(options: {
  figure: MobiliteRaccordementEvidence
  showComparison: boolean
}): readonly CahierCurveReading[] {
  const { figure, showComparison } = options
  const unit = figure.points[0]?.fact.unit ?? '%'
  const declared = figure.trajectory?.ticks ?? []
  const rows = declared.length
    ? declared.flatMap((tick) => {
      const axisValue = mobiliteCurveAxisForDetail(figure, tick.detail)
      return axisValue === null ? [] : [{ detail: tick.detail, axisValue, label: mobiliteCurveTickLabel(tick, axisValue) }]
    })
    : figure.points.flatMap((point) => {
      const axis = mobiliteCurveAxisForFact(figure, point.fact)
      return axis === null || !point.fact.detail
        ? []
        : [{ detail: point.fact.detail, axisValue: axis, label: point.fact.detail }]
    })
  return rows.map((row) => {
    const value = mobiliteCurvePointAt(figure.points, row.detail)?.value ?? null
    const comparison = showComparison && figure.comparison
      ? mobiliteCurvePointAt(figure.comparison.points, row.detail)
      : null
    // A rank is comparison evidence: it disappears with the hidden layer.
    const rank = showComparison && figure.markerValue?.fact.detail === row.detail
      ? figure.markerValue.fact.comparison?.rank ?? null
      : null
    const comparisonDisplay = comparison ? mobiliteCurveVisiblePercent(comparison.value) : null
    return {
      detail: row.detail,
      axisValue: row.axisValue,
      label: row.label,
      value,
      display: mobiliteCurveVisiblePercent(value),
      aria: mobiliteCurveAriaPercent(value, unit),
      comparisonValue: comparison?.value ?? null,
      comparisonDisplay,
      comparisonAria: comparison
        ? mobiliteCurveAriaPercent(comparison.value, unit)
        : null,
      comparisonRank: rank,
      comparisonRankDisplay: formatServedRank(rank),
      comparisonRankAria: formatServedRankAria(rank),
    }
  })
}

export interface CahierCurveComparisonDetail {
  readonly statistic: 'Moyenne' | 'Médiane'
  readonly label: string
}

export function mobiliteCurveComparisonDetail(
  figure: MobiliteRaccordementEvidence,
): CahierCurveComparisonDetail | null {
  if (!figure.comparison) return null
  const scope = figure.comparison.scope.label
    ?? figure.comparisonLabel?.replace(/^(?:Moyenne|Médiane) des /u, '')
    ?? 'groupe comparé'
  return {
    statistic: figure.comparison.statistic === 'mean' ? 'Moyenne' : 'Médiane',
    label: scope,
  }
}

export function mobiliteCurveComparisonTooltip(options: {
  figure: MobiliteRaccordementEvidence
  reading: CahierCurveReading
}): CahierTooltipComparison | undefined {
  const { figure, reading } = options
  const detail = mobiliteCurveComparisonDetail(figure)
  if (!detail || reading.comparisonAria === null) return undefined
  return {
    value: reading.comparisonDisplay ?? MOBILITE_UNAVAILABLE_LABEL,
    rank: reading.comparisonRankDisplay,
    rankEvidence: reading.comparisonRank,
    rankAria: reading.comparisonRankAria,
    ariaLabel: `${GROUPE_COMPARE_LABEL} : ${reading.comparisonAria} (${detail.statistic} des ${detail.label})${reading.comparisonRankAria ? `. Rang ${reading.comparisonRankAria}` : ''}`,
  }
}

export function mobiliteCurveTooltipRows(options: {
  figure: MobiliteRaccordementEvidence
  reading: CahierCurveReading
  showComparison: boolean
}): readonly CahierTooltipRow[] {
  const { figure, reading, showComparison } = options
  const unit = figure.points[0]?.fact.unit ?? '%'
  return [{
    label: 'Territoire',
    value: reading.display,
    tone: 't',
    marker: 'dot',
    markerColor: 'var(--brand-500)',
    ariaLabel: `Territoire : ${mobiliteCurveAriaPercent(reading.value, unit)}`,
    comparison: showComparison
      ? mobiliteCurveComparisonTooltip({ figure, reading })
      : undefined,
  }]
}
