import type { ComparisonFacetMetadata, IndicatorPageMetadata, Indicateur, FamilleFigure, Sexe, Territoire, Theme, TrajectoryMetadata, CompositionMetadata, DistributionMetadata, RelationshipMetadata, ListMetadata, PyramidMetadata, ComparisonBarsMetadata } from '@/payload/types'

export type FamilyStatus = 'ready' | 'unavailable' | 'incomplete' | 'invalid'
export type FamilyName = FamilleFigure
export type FamilyRendererIdentity = { [F in FamilyName]: { family: F; component: string; semantics: 'scalar' | 'composition' | 'trajectory' | 'distribution' | 'list' | 'relationship' } }[FamilyName]

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
  /** The single public label used by comparison surfaces and map layers. */
  label: string
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

type FamilyDispatchBase = { facet: ComparisonFacet; resolvedUrl: string; selected: Indicateur | null; status: FamilyStatus }
export type FamilyDispatch = {
  [F in FamilyName]: FamilyDispatchBase & {
    family: F
    renderer: F
    rendererIdentity: Extract<FamilyRendererIdentity, { family: F }>
    representation: Extract<FamilyRepresentation, { kind: F }>
  }
}[FamilyName]

/** Explicit registry: pyramid and comparison-bars share composition mechanics,
 * but retain their own family identity and renderer extension point. */
export const familyRegistry = Object.freeze({
  scalar: { family: 'scalar', component: 'ScalarFamilyRenderer', semantics: 'scalar' },
  trajectory: { family: 'trajectory', component: 'TrajectoryFamilyRenderer', semantics: 'trajectory' },
  composition: { family: 'composition', component: 'CompositionFamilyRenderer', semantics: 'composition' },
  distribution: { family: 'distribution', component: 'DistributionFamilyRenderer', semantics: 'distribution' },
  list: { family: 'list', component: 'ListFamilyRenderer', semantics: 'list' },
  relationship: { family: 'relationship', component: 'RelationshipFamilyRenderer', semantics: 'relationship' },
  pyramid: { family: 'pyramid', component: 'PyramidFamilyRenderer', semantics: 'composition' },
  'comparison-bars': { family: 'comparison-bars', component: 'ComparisonBarsFamilyRenderer', semantics: 'composition' },
}) satisfies Readonly<Record<FamilyName, FamilyRendererIdentity>>

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
  const labels = comparison.labels ?? {}
  return { theme, levels: page.levels, indicator, detail: detail.value, sex: sex.value as Sexe | null, dimension: dimension.value, direction: comparison.direction ?? page.direction, unit: comparison.unit ?? page.unit, label: detail.value !== null && labels[detail.value] ? labels[detail.value] : page.label, labels, url: params.toString() ? `?${params.toString()}` : '', valid: indicatorValid && detail.valid && sex.valid && dimension.valid }
}

function statusFor(facet: ComparisonFacet, rows: readonly Indicateur[], extensionMissing: boolean): FamilyStatus {
  return !facet.valid || extensionMissing ? 'invalid' : rows.length === 0 ? 'unavailable' : rows.some((row) => row.value === null) ? 'incomplete' : 'ready'
}

export function dispatchIndicatorFamily(page: IndicatorPageMetadata, input: { theme?: Theme; facts?: readonly Indicateur[]; territories?: readonly Territoire[]; selected?: string; facet?: object } = {}): FamilyDispatch {
  const facet = normalizeComparisonFacet(page, input.facet, input.theme)
  const rows = (input.facts ?? []).filter((fact) => fact.theme === facet.theme && fact.key === facet.indicator && fact.detail === facet.detail && (facet.sex === null || (fact.sex ?? null) === facet.sex) && (facet.dimension === null || (fact as Indicateur & { dimension?: string | null }).dimension === facet.dimension))
  const selected = rows.find((row) => row.territoire === input.selected) ?? null
  const territories = input.territories ?? []
  const common = { facet, resolvedUrl: facet.url, selected }
  switch (page.family) {
    case 'trajectory': return { ...common, family: 'trajectory', renderer: 'trajectory', rendererIdentity: familyRegistry.trajectory, representation: { kind: 'trajectory', rows, territories, endpoints: rows, extension: page.trajectory }, status: statusFor(facet, rows, page.trajectory === undefined) }
    case 'composition': return { ...common, family: 'composition', renderer: 'composition', rendererIdentity: familyRegistry.composition, representation: { kind: 'composition', rows, territories, parts: rows, extension: page.composition }, status: statusFor(facet, rows, page.composition === undefined) }
    case 'distribution': return { ...common, family: 'distribution', renderer: 'distribution', rendererIdentity: familyRegistry.distribution, representation: { kind: 'distribution', rows, territories, distribution: rows, extension: page.distribution }, status: statusFor(facet, rows, page.distribution === undefined) }
    case 'list': return { ...common, family: 'list', renderer: 'list', rendererIdentity: familyRegistry.list, representation: { kind: 'list', rows, territories, entries: rows, extension: page.list }, status: statusFor(facet, rows, page.list === undefined) }
    case 'relationship': return { ...common, family: 'relationship', renderer: 'relationship', rendererIdentity: familyRegistry.relationship, representation: { kind: 'relationship', rows, territories, points: rows, extension: page.relationship }, status: statusFor(facet, rows, page.relationship === undefined) }
    case 'pyramid': return { ...common, family: 'pyramid', renderer: 'pyramid', rendererIdentity: familyRegistry.pyramid, representation: { kind: 'pyramid', rows, territories, parts: rows, extension: page.pyramid }, status: statusFor(facet, rows, page.pyramid === undefined) }
    case 'comparison-bars': return { ...common, family: 'comparison-bars', renderer: 'comparison-bars', rendererIdentity: familyRegistry['comparison-bars'], representation: { kind: 'comparison-bars', rows, territories, parts: rows, extension: page.comparisonBars }, status: statusFor(facet, rows, page.comparisonBars === undefined) }
    default: return { ...common, family: 'scalar', renderer: 'scalar', rendererIdentity: familyRegistry.scalar, representation: { kind: 'scalar', rows, territories }, status: statusFor(facet, rows, false) }
  }
}
