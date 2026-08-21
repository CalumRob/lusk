import type { ComparisonFacetMetadata, IndicatorPageMetadata, Indicateur, FamilleFigure, Sexe, Territoire, Theme } from '@/payload/types'

export type FamilyStatus = 'ready' | 'unavailable' | 'incomplete' | 'invalid'
export type FamilyName = FamilleFigure
export interface FamilyRendererIdentity { family: FamilyName; component: string; semantics: 'scalar' | 'composition' | 'trajectory' | 'distribution' | 'list' | 'relationship' }

/** One facet contract, shared by Repères, Carte, ranks, extremes and table. */
export interface ComparisonFacet {
  theme: import('@/payload/types').Theme
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
  | { kind: 'trajectory'; rows: readonly Indicateur[]; territories: readonly Territoire[]; endpoints: readonly Indicateur[] }
  | { kind: 'composition'; rows: readonly Indicateur[]; territories: readonly Territoire[]; parts: readonly Indicateur[] }
  | { kind: 'distribution'; rows: readonly Indicateur[]; territories: readonly Territoire[]; distribution: readonly Indicateur[] }
  | { kind: 'profile'; rows: readonly Indicateur[]; territories: readonly Territoire[]; entries: readonly Indicateur[] }
  | { kind: 'list'; rows: readonly Indicateur[]; territories: readonly Territoire[]; entries: readonly Indicateur[] }
  | { kind: 'relationship'; rows: readonly Indicateur[]; territories: readonly Territoire[]; points: readonly Indicateur[] }
  | { kind: 'pyramid'; rows: readonly Indicateur[]; territories: readonly Territoire[]; parts: readonly Indicateur[] }
  | { kind: 'comparison-bars'; rows: readonly Indicateur[]; territories: readonly Territoire[]; parts: readonly Indicateur[] }

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
  profile: { family: 'profile', component: 'ProfileFamilyRenderer', semantics: 'list' },
  list: { family: 'list', component: 'ListFamilyRenderer', semantics: 'list' },
  relationship: { family: 'relationship', component: 'RelationshipFamilyRenderer', semantics: 'relationship' },
  pyramid: { family: 'pyramid', component: 'PyramidFamilyRenderer', semantics: 'composition' },
  'comparison-bars': { family: 'comparison-bars', component: 'ComparisonBarsFamilyRenderer', semantics: 'composition' },
})

function one(value: unknown): string | null { return typeof value === 'string' && value.length > 0 ? value : null }
function declared(value: string | null, allowed: readonly string[] | undefined, fallback: string | null): { value: string | null; valid: boolean } {
  if (allowed === undefined) return { value: fallback, valid: value === null }
  if (value !== null && allowed.includes(value)) return { value, valid: true }
  return { value: fallback, valid: value === null || value === fallback }
}

export function normalizeComparisonFacet(page: IndicatorPageMetadata, requested: object = {}, theme: Theme = 'demographie'): ComparisonFacet {
  const query = requested as Record<string, unknown>
  const comparison: ComparisonFacetMetadata = page.comparison ?? {}
  const requestedDetail = one(query.detail)
  const requestedSex = query.sex === 'F' || query.sex === 'M' ? query.sex as Sexe : null
  const requestedDimension = one(query.dimension)
  const detail = declared(requestedDetail, comparison.details, comparison.detail ?? page.detail ?? null)
  const sexValue = comparison.sexes === undefined || requestedSex !== null && comparison.sexes.includes(requestedSex)
    ? requestedSex ?? comparison.sex ?? null
    : comparison.sex ?? null
  const sex = { value: sexValue as Sexe | null, valid: requestedSex === null || comparison.sexes === undefined || comparison.sexes.includes(requestedSex) }
  const dimension = declared(requestedDimension, comparison.dimensions, comparison.dimension ?? null)
  const requestedIndicator = one(query.facet)
  const indicator = comparison.indicator ?? page.indicator
  const indicatorValid = requestedIndicator === null || requestedIndicator === indicator
  const params = new URLSearchParams({ facet: indicator })
  if (detail.value !== null) params.set('detail', detail.value)
  if (sex.value !== null) params.set('sex', sex.value)
  if (dimension.value !== null) params.set('dimension', dimension.value)
  return { theme, indicator, detail: detail.value, sex: sex.value, dimension: dimension.value, direction: comparison.direction ?? page.direction, unit: comparison.unit ?? page.unit, labels: comparison.labels ?? {}, url: `?${params.toString()}`, valid: indicatorValid && detail.valid && sex.valid && dimension.valid }
}

function representation(family: FamilyName, rows: readonly Indicateur[], territories: readonly Territoire[]): FamilyRepresentation {
  if (family === 'scalar') return { kind: family, rows, territories }
  if (family === 'trajectory') return { kind: family, rows, territories, endpoints: rows }
  if (family === 'composition' || family === 'pyramid' || family === 'comparison-bars') return { kind: family, rows, territories, parts: rows }
  if (family === 'distribution') return { kind: family, rows, territories, distribution: rows }
  if (family === 'relationship') return { kind: family, rows, territories, points: rows }
  return { kind: family, rows, territories, entries: rows }
}

export function dispatchIndicatorFamily(page: IndicatorPageMetadata, input: { theme?: Theme; facts?: readonly Indicateur[]; territories?: readonly Territoire[]; selected?: string; facet?: object } = {}): FamilyDispatch {
  const family = page.family ?? 'scalar'
  const renderer = familyRegistry[family]
  const facet = normalizeComparisonFacet(page, input.facet, input.theme)
  const rows = (input.facts ?? []).filter((fact) => fact.theme === facet.theme && fact.key === facet.indicator && fact.detail === facet.detail && (facet.sex === null || (fact.sex ?? null) === facet.sex) && (facet.dimension === null || (fact as Indicateur & { dimension?: string | null }).dimension === facet.dimension))
  const selected = rows.find((row) => row.territoire === input.selected) ?? null
  const status: FamilyStatus = !facet.valid ? 'invalid' : rows.length === 0 ? 'unavailable' : rows.some((row) => row.value === null) ? 'incomplete' : 'ready'
  return { family, renderer: family, rendererIdentity: renderer, facet, resolvedUrl: facet.url, representation: representation(family, rows, input.territories ?? []), selected, status }
}
