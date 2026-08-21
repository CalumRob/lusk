import type { ComparisonFacetMetadata, IndicatorPageMetadata, Indicateur, FamilleFigure, Sexe, Territoire, Theme, TrajectoryMetadata, CompositionMetadata, DistributionMetadata, RelationshipMetadata, ListMetadata, PyramidMetadata, ComparisonBarsMetadata } from '@/payload/types'

export type FamilyStatus = 'ready' | 'unavailable' | 'incomplete' | 'invalid'
export type FamilyName = FamilleFigure
export interface FamilyRendererIdentity { family: FamilyName; component: string; semantics: 'scalar' | 'composition' | 'trajectory' | 'distribution' | 'list' | 'relationship' }

/** One facet contract, shared by Repères, Carte, ranks, extremes and table. */
export interface ComparisonFacet {
  theme: import('@/payload/types').Theme
  levels: readonly import('@/payload/types').TerritoireType[]
  indicator: string
  detail: string | null
  sex: Sexe | null
  dimension: string | null
  direction: 'high' | 'low'
  unit: string
  labels: Record<string, string>
  url: string
  valid: boolean
}

export type FamilyRepresentation =
  | { kind: 'scalar'; rows: readonly Indicateur[]; territories: readonly Territoire[] }
  | { kind: 'trajectory'; rows: readonly Indicateur[]; territories: readonly Territoire[]; endpoints: readonly Indicateur[]; extension: TrajectoryMetadata }
  | { kind: 'composition'; rows: readonly Indicateur[]; territories: readonly Territoire[]; parts: readonly Indicateur[]; extension: CompositionMetadata }
  | { kind: 'distribution'; rows: readonly Indicateur[]; territories: readonly Territoire[]; distribution: readonly Indicateur[]; extension: DistributionMetadata }
  | { kind: 'list'; rows: readonly Indicateur[]; territories: readonly Territoire[]; entries: readonly Indicateur[]; extension: ListMetadata }
  | { kind: 'relationship'; rows: readonly Indicateur[]; territories: readonly Territoire[]; points: readonly Indicateur[]; extension: RelationshipMetadata }
  | { kind: 'pyramid'; rows: readonly Indicateur[]; territories: readonly Territoire[]; parts: readonly Indicateur[]; extension: PyramidMetadata }
  | { kind: 'comparison-bars'; rows: readonly Indicateur[]; territories: readonly Territoire[]; parts: readonly Indicateur[]; extension: ComparisonBarsMetadata }

export interface FamilyDispatch {
  family: FamilyName
  /** Stable family renderer key; identity metadata is adjacent for the outlet. */
  renderer: FamilyName
  rendererIdentity: FamilyRendererIdentity
  facet: ComparisonFacet
  resolvedUrl: string
  representation: FamilyRepresentation
  selected: Indicateur | null
  status: FamilyStatus
}

/** Explicit registry: pyramid and comparison-bars share composition mechanics,
 * but retain their own family identity and renderer extension point. */
export const familyRegistry: Readonly<Record<FamilyName, FamilyRendererIdentity>> = Object.freeze({
  scalar: { family: 'scalar', component: 'ScalarFamilyRenderer', semantics: 'scalar' },
  trajectory: { family: 'trajectory', component: 'TrajectoryFamilyRenderer', semantics: 'trajectory' },
  composition: { family: 'composition', component: 'CompositionFamilyRenderer', semantics: 'composition' },
  distribution: { family: 'distribution', component: 'DistributionFamilyRenderer', semantics: 'distribution' },
  list: { family: 'list', component: 'ListFamilyRenderer', semantics: 'list' },
  relationship: { family: 'relationship', component: 'RelationshipFamilyRenderer', semantics: 'relationship' },
  pyramid: { family: 'pyramid', component: 'PyramidFamilyRenderer', semantics: 'composition' },
  'comparison-bars': { family: 'comparison-bars', component: 'ComparisonBarsFamilyRenderer', semantics: 'composition' },
})

function queryValue(value: unknown): { value: string | null; present: boolean; malformed: boolean } {
  if (value === undefined) return { value: null, present: false, malformed: false }
  if (typeof value === 'string' && value.length > 0) return { value, present: true, malformed: false }
  return { value: null, present: true, malformed: true }
}
function resolveQuery(value: { value: string | null; present: boolean; malformed: boolean }, allowed: readonly string[] | undefined, fallback: string | null): { value: string | null; valid: boolean } {
  const valid = !value.malformed && (!value.present || (allowed !== undefined && value.value !== null && allowed.includes(value.value)))
  return { value: valid && value.present ? value.value : fallback, valid }
}

export function normalizeComparisonFacet(page: IndicatorPageMetadata, requested: object = {}, theme: Theme = 'demographie'): ComparisonFacet {
  const query = requested as Record<string, unknown>
  const comparison: ComparisonFacetMetadata = page.comparison ?? {}
  const requestedDetail = queryValue(query.detail)
  const requestedSex = queryValue(query.sex)
  const requestedDimension = queryValue(query.dimension)
  const detail = resolveQuery(requestedDetail, comparison.details, comparison.detail ?? page.detail ?? null)
  const sex = resolveQuery(requestedSex, comparison.sexes, comparison.sex ?? null)
  const dimension = resolveQuery(requestedDimension, comparison.dimensions, comparison.dimension ?? null)
  const requestedIndicator = queryValue(query.facet)
  const indicator = comparison.indicator ?? page.indicator
  const indicatorValid = !requestedIndicator.malformed && (!requestedIndicator.present || requestedIndicator.value === indicator)
  const params = new URLSearchParams()
  if (detail.value !== null) params.set('detail', detail.value)
  if (sex.value !== null) params.set('sex', sex.value)
  if (dimension.value !== null) params.set('dimension', dimension.value)
  return { theme, levels: page.levels, indicator, detail: detail.value, sex: sex.value as Sexe | null, dimension: dimension.value, direction: comparison.direction ?? page.direction, unit: comparison.unit ?? page.unit, labels: comparison.labels ?? {}, url: params.toString() ? `?${params.toString()}` : '', valid: indicatorValid && detail.valid && sex.valid && dimension.valid }
}

function representation(page: IndicatorPageMetadata, family: FamilyName, rows: readonly Indicateur[], territories: readonly Territoire[]): FamilyRepresentation {
  if (family === 'scalar') return { kind: family, rows, territories }
  const extension = (page as unknown as Record<string, unknown>)[family === 'comparison-bars' ? 'comparisonBars' : family]
  if (family === 'trajectory') return { kind: family, rows, territories, endpoints: rows, extension: extension as TrajectoryMetadata }
  if (family === 'composition') return { kind: family, rows, territories, parts: rows, extension: extension as CompositionMetadata }
  if (family === 'pyramid') return { kind: family, rows, territories, parts: rows, extension: extension as PyramidMetadata }
  if (family === 'comparison-bars') return { kind: family, rows, territories, parts: rows, extension: extension as ComparisonBarsMetadata }
  if (family === 'distribution') return { kind: family, rows, territories, distribution: rows, extension: extension as DistributionMetadata }
  if (family === 'relationship') return { kind: family, rows, territories, points: rows, extension: extension as RelationshipMetadata }
  return { kind: family, rows, territories, entries: rows, extension: extension as ListMetadata }
}

export function dispatchIndicatorFamily(page: IndicatorPageMetadata, input: { theme?: Theme; facts?: readonly Indicateur[]; territories?: readonly Territoire[]; selected?: string; facet?: object } = {}): FamilyDispatch {
  const family = page.family ?? 'scalar'
  const renderer = familyRegistry[family]
  const facet = normalizeComparisonFacet(page, input.facet, input.theme)
  const rows = (input.facts ?? []).filter((fact) => fact.theme === facet.theme && fact.key === facet.indicator && fact.detail === facet.detail && (facet.sex === null || (fact.sex ?? null) === facet.sex) && (facet.dimension === null || (fact as Indicateur & { dimension?: string | null }).dimension === facet.dimension))
  const selected = rows.find((row) => row.territoire === input.selected) ?? null
  const extensionKey = family === 'comparison-bars' ? 'comparisonBars' : family
  const extensionMissing = family !== 'scalar' && !(page as unknown as Record<string, unknown>)[extensionKey]
  const status: FamilyStatus = !facet.valid || extensionMissing ? 'invalid' : rows.length === 0 ? 'unavailable' : rows.some((row) => row.value === null) ? 'incomplete' : 'ready'
  return { family, renderer: family, rendererIdentity: renderer, facet, resolvedUrl: facet.url, representation: representation(page, family, rows, input.territories ?? []), selected, status }
}
