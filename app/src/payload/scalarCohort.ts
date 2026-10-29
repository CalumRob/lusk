import type { Indicateur, NativeThemeFactContract, Territoire, TerritoireType, Theme, IndicatorPageMetadata, ThemeMetadata } from './types'
import { PayloadError } from './validate'
import { chargerCatalogueRessources, lireRessourcesBatch } from './semanticResourceClient'
import type { SemanticReadItem, SemanticResourceDeclaration } from './semanticResourceClient'

type Row = Record<string, unknown>

const isRecord = (value: unknown): value is Row => typeof value === 'object' && value !== null && !Array.isArray(value)
const isText = (value: unknown): value is string => typeof value === 'string'
const isNonEmptyText = (value: unknown): value is string => typeof value === 'string' && value.length > 0
const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const isNullableDate = (value: unknown): value is string | null => value === null || isText(value)

function explicationStatutScalaire(status: string): string | null {
  switch (status) {
    case 'suppressed': return 'Valeur masquée selon les règles de diffusion.'
    case 'unsupported': return 'Valeur non prise en charge pour ce territoire.'
    case 'not_available': return 'Valeur non disponible.'
    case 'not_published': return 'Valeur non publiée à ce niveau.'
    default: return null
  }
}

export interface ScalarComparisonRank {
  rank: number
  rankSize: number
  scope: string
  direction: 'high' | 'low'
}

export interface ScalarMemberRank {
  territoryId: string
  rank: number | null
  rankSize: number | null
  rankTies: number | null
}

export interface ScalarComparisonSource {
  sourceId: string
  name: string
  vintageId: string
  version: string
  referenceDate: string | null
  publicationDate: string | null
}

export interface ScalarComparisonEvidence {
  status: 'available' | 'unavailable'
  reason: string | null
  selectedMemberCount: number
  eligibleCount: number
  missingCount: number
  median: number | null
  rank: number | null
  rankSize: number | null
  rankTies: number | null
  focalInSelection: boolean
  memberRanks: ScalarMemberRank[]
  comparisonSources: ScalarComparisonSource[]
  contentVersion: string
  referenceContentVersion: string
  scope: string
  direction: 'high' | 'low'
}

export type ScalarComparisonRequest =
  | { kind: 'fixed'; scope: { kind: 'density_class'; territoryType: 'commune'; densityClassCode: string; memberCount: number; label: string | null } }
  | { kind: 'fixed'; scope: { kind: 'same_level'; territoryType: TerritoireType; memberCount: number; label: string | null } }
  | { kind: 'selected'; members: Array<{ type: TerritoireType; id: string }>; scope: { kind: 'explicit_selection'; territoryType: TerritoireType; memberCount: number; label: string | null } }

interface ScalarIdentity {
  contentVersion?: string
  referenceContentVersion?: string
  descriptorVersion?: string
  comparisonFacet?: string
}

export function scalarCohortEnabled(env: Record<string, string | undefined>): boolean {
  return env.VITE_SCALAR_COHORT_API === '1'
}

/** Registration is producer-owned; a declared page alone does not opt into scalar serving. */
export function indicateursScalairesEnregistres(raw: unknown): string[] {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw) || !('scalar_contracts' in raw)) {
    throw new PayloadError('validation', 'theme metadata', 'Le registre producer-owned scalar_contracts est absent ou mal formé.')
  }
  const declarations = (raw as { scalar_contracts: unknown }).scalar_contracts
  if (Array.isArray(declarations) && declarations.every((item) => typeof item === 'string' && /^[a-z][a-z0-9_]{0,95}$/.test(item)) &&
      new Set(declarations).size === declarations.length) return declarations
  if (typeof declarations === 'object' && declarations !== null && !Array.isArray(declarations) &&
      Object.entries(declarations).every(([key, value]) => /^[a-z][a-z0-9_]{0,95}$/.test(key) && value !== null && value !== false)) return Object.keys(declarations)
  throw new PayloadError('validation', 'theme metadata', 'Le registre producer-owned scalar_contracts est mal formé.')
}

export function validerEnregistrementScalaires(metadata: ThemeMetadata, registered: string[]): void {
  for (const id of registered) {
    const page = metadata.indicator_pages?.[id]
    if (!page || page.indicator !== id || page.family !== 'scalar') {
      throw new PayloadError('validation', 'theme metadata', `Le contrat scalaire « ${id} » n’a pas de page scalaire correspondante.`)
    }
  }
}

/** A producer may publish a scalar observation for an indicator whose fiche page is another family. */
export function pagesScalairesEnregistrees(metadata: ThemeMetadata, registered: string[]): string[] {
  return registered.filter((id) => metadata.indicator_pages?.[id]?.family === 'scalar')
}

export function choisirFocalCohorte(territories: Territoire[], level: TerritoireType,
  selectedId: string | undefined, scope: { department?: string; epci?: string }): Territoire | null {
  const eligible = territories.filter((t) => t.type === level &&
    (!scope.department || t.departement === scope.department) && (!scope.epci || t.epci === scope.epci))
  return eligible.find((t) => t.territoire === selectedId) ?? eligible[0] ?? null
}

export async function chargerCohorteScalaire(indicator: string, theme: Theme, page: IndicatorPageMetadata,
  _focal: Territoire | null, level: TerritoireType, territories: Territoire[], scope: { department?: string; epci?: string },
  identity?: ScalarIdentity,
): Promise<Indicateur[]> {
  const resources = await chargerCatalogueRessources()
  const [data] = await lireRessourcesBatch([itemScalaire(indicator, level, scope)])
  const declaration = resources.find((resource) => resource.resource_id === indicator)
  return adapterCohorteScalaire(data!, declaration, indicator, theme, page, level, territories, scope, identity)
}

/** Read the clicked territory's rank from the exact producer comparison group.
 * Commune groups are explicit selected comparisons; EPCI and département use
 * their producer-published same-level default comparison. Région has no rank. */
export async function chargerRangScalaire(indicator: string, theme: Theme, page: IndicatorPageMetadata,
  focal: Territoire, territories: Territoire[], identity?: ScalarIdentity): Promise<ScalarComparisonRank | null> {
  const group = groupeRangScalaire(focal, territories)
  if (!group || group.members.length < 2) return null
  const members = group.members.map((member) => ({ type: member.type, id: member.territoire }))
  const request: ScalarComparisonRequest = focal.type === 'commune'
    ? { kind: 'selected', members, scope: { kind: 'explicit_selection', territoryType: focal.type,
        memberCount: members.length, label: group.scope } }
    : { kind: 'fixed', scope: { kind: 'same_level', territoryType: focal.type,
        memberCount: group.members.length, label: group.scope } }
  const ranks = await chargerComparaisonsScalaires([indicator], theme, { [indicator]: page }, focal,
    territories, request, identity)
  return ranks[indicator] ?? null
}

function groupeRangScalaire(focal: Territoire, territories: Territoire[]): { members: Territoire[]; scope: string } | null {
  if (focal.type === 'region') return null
  let members: Territoire[]
  let scope: string
  if (focal.type === 'commune') {
    members = territories.filter((territory) => territory.type === 'commune' &&
      (focal.epci ? territory.epci === focal.epci : territory.epci === null))
    scope = focal.epci ? "dans l'EPCI" : 'parmi les communes sans EPCI'
  } else {
    members = territories.filter((territory) => territory.type === focal.type)
    scope = 'en Bretagne'
  }
  if (!members.some((member) => member.territoire === focal.territoire)) return null
  return { members: members.sort((left, right) => left.territoire.localeCompare(right.territoire)), scope }
}

function itemComparaisonScalaire(indicator: string, focal: Territoire, request: ScalarComparisonRequest,
  includeMemberRanks = false): SemanticReadItem {
  return {
    resource: indicator,
    target: { kind: 'territory', type: focal.type, id: focal.territoire },
    fields: includeMemberRanks
      ? ['median', 'rank', 'rank_size', 'eligible_count',
          'selected_member_count', 'missing_count', 'member_ranks']
      : ['rank', 'rank_size', 'eligible_count', 'selected_member_count', 'missing_count'],
    intent: request.kind === 'fixed'
      ? { kind: 'fixed_comparison', context: 'default' }
      : { kind: 'selected_comparison', members: request.members },
  }
}

function selectionIdentity(value: unknown): Array<{ territory_type: TerritoireType; territory_id: string }> | null {
  if (value === null || value === undefined) return null
  if (!Array.isArray(value)) return null
  const members: Array<{ territory_type: TerritoireType; territory_id: string }> = []
  for (const item of value) {
    if (!isRecord(item) || !['commune', 'epci', 'departement', 'region'].includes(String(item.territory_type)) ||
        !isNonEmptyText(item.territory_id)) return null
    members.push({ territory_type: item.territory_type as TerritoireType, territory_id: item.territory_id })
  }
  return members.sort((left, right) => left.territory_type.localeCompare(right.territory_type) ||
    left.territory_id.localeCompare(right.territory_id))
}

function validateComparisonRequest(request: ScalarComparisonRequest, focal: Territoire, territories?: Territoire[]): void {
  if (request.scope.territoryType !== focal.type || !Number.isSafeInteger(request.scope.memberCount) ||
      request.scope.memberCount < 0) {
    throw new PayloadError('validation', '/api/resources/read-batch', 'Le périmètre scalaire demandé est incohérent avec le territoire focal.')
  }
  if (request.kind === 'selected') {
    const ids = request.members.map((member) => member.id)
    if (request.scope.kind !== 'explicit_selection' || request.members.length !== request.scope.memberCount ||
        request.members.some((member) => member.type !== focal.type || !isNonEmptyText(member.id)) ||
        new Set(ids).size !== ids.length) {
      throw new PayloadError('validation', '/api/resources/read-batch', 'La sélection de comparaison scalaire est mal formée.')
    }
  } else if (request.scope.kind === 'density_class') {
    if (focal.type !== 'commune' || !isNonEmptyText(request.scope.densityClassCode) ||
        focal.classe_densite_code !== request.scope.densityClassCode) {
      throw new PayloadError('validation', '/api/resources/read-batch', 'La classe de densité demandée ne correspond pas au territoire focal.')
    }
  } else if (request.scope.kind !== 'same_level') {
    throw new PayloadError('validation', '/api/resources/read-batch', 'Le contexte de comparaison scalaire est invalide.')
  }
  if (territories) {
    const comparisonScope = request.scope
    const focalReference = territories.find((territory) => territory.territoire === focal.territoire && territory.type === focal.type)
    if (!focalReference) throw new PayloadError('validation', '/api/resources/read-batch', 'Le territoire focal est absent du référentiel de comparaison.')
    let expectedCount: number
    if (request.kind === 'selected') expectedCount = request.members.length
    else if (comparisonScope.kind === 'density_class') {
      expectedCount = territories.filter((territory) => territory.type === 'commune' &&
        territory.classe_densite_code === comparisonScope.densityClassCode).length
    } else expectedCount = territories.filter((territory) => territory.type === comparisonScope.territoryType).length
    if (expectedCount !== comparisonScope.memberCount) {
      throw new PayloadError('validation', '/api/resources/read-batch', 'La taille du périmètre scalaire diffère du référentiel territorial demandé.')
    }
    if (request.kind === 'selected' && request.members.some((member) => {
      const reference = territories.find((territory) => territory.territoire === member.id)
      return !reference || reference.type !== member.type
    })) {
      throw new PayloadError('validation', '/api/resources/read-batch', 'La sélection scalaire ne correspond pas au référentiel territorial.')
    }
  }
}

/** Keep the API's exact scope identity; the rank chip label comes from the fiche's resolved context. */
function adapterComparaisonScalaire(data: Row, indicator: string, page: IndicatorPageMetadata, focal: Territoire,
  request: ScalarComparisonRequest, identity: ScalarIdentity | undefined, includeMemberRanks: true,
  territories: Territoire[], declaredSources?: string[]): ScalarComparisonEvidence
function adapterComparaisonScalaire(data: Row, indicator: string, page: IndicatorPageMetadata, focal: Territoire,
  request: ScalarComparisonRequest, identity?: ScalarIdentity, includeMemberRanks?: false,
  territories?: Territoire[], declaredSources?: string[]): ScalarComparisonRank | null
function adapterComparaisonScalaire(data: Row, indicator: string, page: IndicatorPageMetadata, focal: Territoire,
  request: ScalarComparisonRequest, identity?: ScalarIdentity, includeMemberRanks = false,
  territories?: Territoire[], declaredSources: string[] = []): ScalarComparisonEvidence | ScalarComparisonRank | null {
  const path = '/api/resources/read-batch'
  validateComparisonRequest(request, focal)
  const expectedSelection = request.kind === 'selected'
    ? request.members.map(({ type, id }) => ({ territory_type: type, territory_id: id }))
    : null
  const actualSelection = selectionIdentity(data.selection)
  const expectedSelectionIdentity = expectedSelection?.map((member) => ({ ...member }))
    .sort((left, right) => left.territory_type.localeCompare(right.territory_type) || left.territory_id.localeCompare(right.territory_id)) ?? null
  const scope = data.scope
  const result = isRecord(data.result) ? data.result : null
  const rank = result?.rank
  const rankSize = result?.rank_size
  const eligible = result?.eligible_count
  const selectedCount = result?.selected_member_count
  const missing = result?.missing_count
  const medianValue = result?.median
  const rankTies = result?.rank_ties
  const memberRanksRaw = result?.member_ranks
  const comparisonSourcesRaw = result?.comparison_sources
  const focalInSelection = result?.focal_in_selection
  const expectedDirection = page.comparison?.direction ?? page.direction
  const direction = result?.direction
  const facet = page.comparison?.indicator ?? indicator
  const expectedFacet = identity?.comparisonFacet ?? facet
  const scopeIdentityValid = isRecord(scope) && scope.kind === request.scope.kind &&
    scope.member_count === request.scope.memberCount &&
    (request.scope.kind === 'explicit_selection'
      ? scope.territory_type === undefined || scope.territory_type === focal.type
      : scope.territory_type === request.scope.territoryType) &&
    (request.scope.kind !== 'density_class' || scope.density_class_code === request.scope.densityClassCode)
  const countsValid = Number.isSafeInteger(selectedCount) && selectedCount === request.scope.memberCount &&
    Number.isSafeInteger(eligible) && (eligible as number) >= 0 &&
    Number.isSafeInteger(missing) && (missing as number) >= 0 &&
    (eligible as number) + (missing as number) === request.scope.memberCount
  const rankValid = rank === null
    ? rankSize === null
    : Number.isSafeInteger(rank) && Number.isSafeInteger(rankSize) && (rank as number) >= 1 &&
       (rank as number) <= (rankSize as number) && (rankSize as number) >= 1 && rankSize === eligible && result?.status === 'available'
  if (data.contract !== 'indicator-comparison-v1' || data.indicator_id !== indicator || data.shape !== 'scalar' ||
      !isNonEmptyText(data.content_version) || !isNonEmptyText(data.reference_content_version) ||
      (identity?.contentVersion !== undefined && data.content_version !== identity.contentVersion) ||
      (identity?.referenceContentVersion !== undefined && data.reference_content_version !== identity.referenceContentVersion) ||
      !isRecord(data.target) || data.target.kind !== 'territory' || data.target.type !== focal.type || data.target.id !== focal.territoire ||
      JSON.stringify(actualSelection) !== JSON.stringify(expectedSelectionIdentity) || !scopeIdentityValid ||
      !result || result.indicator_id !== indicator || !['available', 'unavailable'].includes(String(result.status)) ||
      result.unit !== page.unit || direction !== expectedDirection ||
      (direction !== 'high' && direction !== 'low') || result.source_facet !== expectedFacet ||
      !isNonEmptyText(result.descriptor_version) ||
      (identity?.descriptorVersion !== undefined && result.descriptor_version !== identity.descriptorVersion) || !countsValid ||
      (result.status === 'unavailable' && (rank !== null || rankSize !== null)) || !rankValid ||
      (rank !== null && !isNonEmptyText(request.scope.label))) {
    throw new PayloadError('validation', path, 'La comparaison scalaire ne reflète pas la ressource, le territoire ou le groupe demandé.')
  }
  if (includeMemberRanks) {
    const expectedMembers = request.kind === 'selected'
      ? request.members.map((member) => member.id)
      : territories?.filter((territory) => territory.type === request.scope.territoryType &&
          (request.scope.kind !== 'density_class' || territory.classe_densite_code === request.scope.densityClassCode))
        .map((territory) => territory.territoire) ?? []
    const expectedIds = new Set(expectedMembers)
    const apiRanks = Array.isArray(memberRanksRaw) ? memberRanksRaw : []
    const parsedRanks: ScalarMemberRank[] = []
    const seenRankIds = new Set<string>()
    for (const item of apiRanks) {
      if (!isRecord(item) || !isNonEmptyText(item.territory_id) || seenRankIds.has(item.territory_id) ||
          !expectedIds.has(item.territory_id)) {
        throw new PayloadError('validation', path, 'La publication des rangs scalaires ne correspond pas aux membres attendus.')
      }
      const rowRank = item.rank
      const rowSize = item.rank_size
      const rowTies = item.rank_ties
      const missingRow = rowRank === null && rowSize === null && rowTies === null
      const measuredRow = Number.isSafeInteger(rowRank) && Number.isSafeInteger(rowSize) &&
        Number.isSafeInteger(rowTies) && (rowRank as number) >= 1 && (rowSize as number) === eligible &&
        (rowTies as number) >= 1 && (rowTies as number) <= (rowSize as number) &&
        (rowRank as number) + (rowTies as number) <= (rowSize as number) + 1
      if (!missingRow && !measuredRow) {
        throw new PayloadError('validation', path, 'Un rang membre scalaire est hors contrat.')
      }
      seenRankIds.add(item.territory_id)
      parsedRanks.push({ territoryId: item.territory_id,
        rank: missingRow ? null : rowRank as number,
        rankSize: missingRow ? null : rowSize as number,
        rankTies: missingRow ? null : rowTies as number })
    }
    const idsMatch = seenRankIds.size === expectedIds.size && [...expectedIds].every((id) => seenRankIds.has(id))
    const ranked = parsedRanks.filter((item) => item.rank !== null)
    const expectedRanked = (eligible as number) >= 1 ? eligible as number : 0
    const nativeSources: ScalarComparisonSource[] = []
    const allowedSources = new Set(declaredSources)
    if (Array.isArray(comparisonSourcesRaw)) {
      for (const source of comparisonSourcesRaw) {
        if (!isRecord(source) || !isNonEmptyText(source.source_id) || !allowedSources.has(source.source_id) ||
            !isNonEmptyText(source.name) ||
            !isNonEmptyText(source.vintage_id) || !isNonEmptyText(source.version) ||
            !isNullableDate(source.reference_date) || !isNullableDate(source.publication_date)) {
          throw new PayloadError('validation', path, 'La provenance de comparaison scalaire est mal formée.')
        }
        nativeSources.push({ sourceId: source.source_id, name: source.name, vintageId: source.vintage_id,
          version: source.version, referenceDate: source.reference_date, publicationDate: source.publication_date })
      }
    }
    const focalMemberRank = parsedRanks.find((item) => item.territoryId === focal.territoire)
    const focalMember = expectedIds.has(focal.territoire)
    const nativeFocalTies = focalMemberRank?.rankTies ?? null
    if (!idsMatch || ranked.length !== expectedRanked || !Array.isArray(comparisonSourcesRaw) ||
        typeof focalInSelection !== 'boolean' || focalInSelection !== focalMember ||
        (rank !== null && (!focalMemberRank || focalMemberRank.rank !== rank ||
          focalMemberRank.rankSize !== rankSize || (rankTies !== undefined && focalMemberRank.rankTies !== rankTies))) ||
        (focalMember && rank === null && focalMemberRank?.rank !== null) ||
        ((eligible as number) === 0 ? medianValue !== null : !isFiniteNumber(medianValue)) ||
        ((eligible as number) > 0 && nativeSources.length === 0) ||
        new Set(nativeSources.map((source) => `${source.sourceId}\u0000${source.vintageId}`)).size !== nativeSources.length ||
        (rankTies !== undefined && rankTies !== null &&
          (!Number.isSafeInteger(rankTies) || (rankTies as number) < 1)) ||
        (rankTies !== undefined && rankTies !== nativeFocalTies)) {
      throw new PayloadError('validation', path, 'Les rangs, le statut ou la provenance scalaire ne se réconcilient pas.')
    }
    return { status: result.status as ScalarComparisonEvidence['status'],
      reason: isText(result.reason) || result.reason === null ? result.reason as string | null : null,
      selectedMemberCount: selectedCount as number, eligibleCount: eligible as number,
      missingCount: missing as number,
      median: medianValue as number | null, rank: rank as number | null,
      rankSize: rankSize as number | null, rankTies: nativeFocalTies,
      focalInSelection, memberRanks: parsedRanks, comparisonSources: nativeSources,
      contentVersion: data.content_version as string, referenceContentVersion: data.reference_content_version as string,
      scope: request.scope.label ?? '', direction }
  }
  return rank === null ? null : { rank: rank as number, rankSize: rankSize as number,
    scope: request.scope.label!, direction }
}

/** Acquire focal comparison ranks as one bounded semantic batch. */
export function chargerComparaisonsScalaires(indicators: string[], theme: Theme,
  pages: Record<string, IndicatorPageMetadata>, focal: Territoire, territories: Territoire[],
  request: ScalarComparisonRequest, identity: ScalarIdentity | undefined, includeMemberRanks: true,
  catalogue?: SemanticResourceDeclaration[]):
  Promise<Record<string, ScalarComparisonEvidence | null>>
export function chargerComparaisonsScalaires(indicators: string[], theme: Theme,
  pages: Record<string, IndicatorPageMetadata>, focal: Territoire, territories: Territoire[],
  request: ScalarComparisonRequest, identity?: ScalarIdentity, includeMemberRanks?: false,
  catalogue?: SemanticResourceDeclaration[]):
  Promise<Record<string, ScalarComparisonRank | null>>
export async function chargerComparaisonsScalaires(indicators: string[], theme: Theme,
  pages: Record<string, IndicatorPageMetadata>, focal: Territoire, territories: Territoire[],
  request: ScalarComparisonRequest, identity?: ScalarIdentity, includeMemberRanks = false,
  catalogueOverride?: SemanticResourceDeclaration[]):
  Promise<Record<string, ScalarComparisonEvidence | ScalarComparisonRank | null>> {
  const path = '/api/resources/read-batch'
  validateComparisonRequest(request, focal, territories)
  if (!indicators.length) return {}
  if (indicators.length > 12 || new Set(indicators).size !== indicators.length) {
    throw new PayloadError('validation', path, 'Le lot de comparaisons scalaires doit contenir au plus 12 ressources distinctes.')
  }
  if (request.scope.memberCount < 2 && !includeMemberRanks) {
    return Object.fromEntries(indicators.map((indicator) => [indicator, null]))
  }
  const resources = catalogueOverride ?? await chargerCatalogueRessources()
  const items = indicators.map((indicator) => {
    const page = pages[indicator]
    const resource = resources.find((candidate) => candidate.resource_id === indicator)
    const intent = request.kind === 'fixed' ? 'fixed_comparison' : 'selected_comparison'
    if (!page || !resource || resource.indicator_id !== indicator || resource.theme_id !== theme ||
        !resource.shapes.includes('scalar') || !resource.target_kinds.includes('territory') ||
        !resource.allowed_levels.includes(focal.type) || !resource.intents.includes(intent)) {
      throw new PayloadError('validation', path, 'La ressource scalaire ne déclare pas cette comparaison territoriale.')
    }
    return itemComparaisonScalaire(indicator, focal, request, includeMemberRanks)
  })
  const data = await lireRessourcesBatch(items)
  return Object.fromEntries(indicators.map((indicator, index) => [indicator, includeMemberRanks
    ? adapterComparaisonScalaire(data[index]!, indicator, pages[indicator]!, focal, request,
        identity, true, territories, resources.find((resource) => resource.resource_id === indicator)?.sources)
    : adapterComparaisonScalaire(data[index]!, indicator, pages[indicator]!, focal, request, identity)]))
}

function itemScalaire(indicator: string, level: TerritoireType,
  scope: { department?: string; epci?: string }, countsAvailable = true): SemanticReadItem {
  return { resource: indicator,
    target: { kind: 'territory_cohort', type: level,
      department_id: level === 'commune' ? scope.department ?? null : null,
      epci_id: level === 'commune' ? scope.epci ?? null : null },
    fields: countsAvailable ? ['value', 'support_count', 'denominator_count'] : ['value'],
    intent: { kind: 'facts' } }
}

function contractCountsAvailable(metadata: ThemeMetadata, indicator: string): boolean {
  const declaration = isRecord(metadata.scalar_contracts) ? metadata.scalar_contracts[indicator] : undefined
  if (!isRecord(declaration) || typeof declaration.counts_available !== 'boolean') {
    throw new PayloadError('validation', 'theme metadata', `La disponibilité des comptes de « ${indicator} » est mal déclarée.`)
  }
  return declaration.counts_available
}

function requireScalarResource(resource: SemanticResourceDeclaration | undefined, indicator: string,
  theme: Theme, level: TerritoireType,
  fields: string[] = ['value', 'support_count', 'denominator_count']): SemanticResourceDeclaration {
  if (!resource || resource.resource_id !== indicator || resource.indicator_id !== indicator || resource.theme_id !== theme ||
      !resource.shapes.includes('scalar') || !resource.target_kinds.includes('territory_cohort') ||
      !resource.allowed_levels.includes(level) || !resource.intents.includes('facts') ||
      !fields.every((field) => resource.fields.includes(field))) {
    throw new PayloadError('validation', indicator, 'La ressource scalaire déclarée n’est pas compatible avec cette lecture.')
  }
  return resource
}

function sameFilters(actual: unknown, expected: string | null): boolean {
  return actual === undefined || actual === null ? expected === null : actual === expected
}

function adapterCohorteScalaire(data: Row, declaration: SemanticResourceDeclaration | undefined,
  indicator: string, theme: Theme, page: IndicatorPageMetadata, level: TerritoireType,
  territories: Territoire[], scope: { department?: string; epci?: string }, identity?: ScalarIdentity,
  countsAvailable = true, nativePageDescriptor = false,
  onNativeContract?: (contract: NativeThemeFactContract) => void): Indicateur[] {
  const path = '/api/resources/read-batch'
  const requestedFields = countsAvailable ? ['value', 'support_count', 'denominator_count'] : ['value']
  const resource = requireScalarResource(declaration, indicator, theme, level, requestedFields)
  const department = level === 'commune' ? scope.department ?? null : null
  const epci = level === 'commune' ? scope.epci ?? null : null
  const target = data.target
  const cohort = data.cohort
  const descriptor = data.descriptor
  if (data.resource !== indicator || data.shape !== 'scalar' || !isRecord(target) || target.kind !== 'territory_cohort' ||
      target.type !== level || !sameFilters(target.department_id, department) || !sameFilters(target.epci_id, epci) ||
      !isRecord(cohort) || cohort.territory_type !== level || !sameFilters(cohort.department_id, department) ||
      !sameFilters(cohort.epci_id, epci) || !Number.isInteger(cohort.member_count) || !Array.isArray(cohort.members) ||
      cohort.member_count !== cohort.members.length || !isNonEmptyText(cohort.reference_content_version) ||
      !isNonEmptyText(data.content_version) || !isNonEmptyText(data.reference_content_version) ||
       data.reference_content_version !== cohort.reference_content_version || !isRecord(descriptor) ||
       descriptor.indicator_id !== indicator || descriptor.theme_id !== theme || !isNonEmptyText(descriptor.label) ||
        descriptor.unit !== (nativePageDescriptor ? resource.unit : page.unit) ||
        descriptor.direction !== (nativePageDescriptor ? resource.direction : (page.comparison?.direction ?? page.direction)) ||
        descriptor.comparison_facet !== (nativePageDescriptor ? indicator : (page.comparison?.indicator ?? indicator)) ||
        (nativePageDescriptor && !['high', 'low'].includes(String(descriptor.direction))) ||
       !Array.isArray(descriptor.allowed_levels) || !descriptor.allowed_levels.includes(level) ||
       !['sparse', 'dense_complete'].includes(String(descriptor.completeness)) ||
       (!nativePageDescriptor && !isNonEmptyText(descriptor.denominator_semantics)) ||
       !isNonEmptyText(descriptor.descriptor_version) ||
       !Array.isArray(data.observations)) {
    throw new PayloadError('validation', path, 'Le descripteur ou l’enveloppe du cohort scalaire est incompatible.')
  }
  const nativeContract: NativeThemeFactContract | undefined = nativePageDescriptor ? {
    label: descriptor.label as string, unit: descriptor.unit as string,
    direction: descriptor.direction as string, comparisonFacet: descriptor.comparison_facet as string,
    allowedLevels: descriptor.allowed_levels as string[], completeness: descriptor.completeness as string,
    descriptorVersion: descriptor.descriptor_version as string,
    contentVersion: data.content_version as string,
    referenceContentVersion: data.reference_content_version as string,
    ...(isNonEmptyText(descriptor.denominator_semantics)
      ? { denominatorSemantics: descriptor.denominator_semantics } : {}),
  } : undefined
  if (nativeContract) onNativeContract?.(nativeContract)
  const allowedSources = new Set(resource.sources)
  const refs = new Map(territories.filter((territory) => territory.type === level).map((territory) => [territory.territoire, territory]))
  const expectedMembers = [...refs.values()].filter((territory) =>
    (!department || territory.departement === department) && (!epci || territory.epci === epci))
  const memberIds = new Set<string>()
  for (const member of cohort.members) {
    if (!isRecord(member) || !isNonEmptyText(member.id) || member.type !== level || !isText(member.name) || memberIds.has(member.id)) {
      throw new PayloadError('validation', path, 'Identité de membre du cohort scalaire invalide.')
    }
    const reference = refs.get(member.id)
    if (!reference || reference.nom !== member.name || (department && reference.departement !== department) ||
        (epci && reference.epci !== epci)) {
      throw new PayloadError('validation', path, 'Le cohort scalaire ne correspond pas au référentiel territorial ou à ses filtres.')
    }
    memberIds.add(member.id)
  }
  if (memberIds.size !== expectedMembers.length || expectedMembers.some((member) => !memberIds.has(member.territoire))) {
    throw new PayloadError('validation', path, 'Le cohort scalaire ne couvre pas exactement le périmètre publié demandé.')
  }
  if (identity) {
    identity.contentVersion = data.content_version
    identity.referenceContentVersion = data.reference_content_version
    if (nativePageDescriptor) {
      identity.descriptorVersion = descriptor.descriptor_version as string
      identity.comparisonFacet = descriptor.comparison_facet as string
    }
  }

  const seen = new Set<string>()
  const facts = data.observations.map((candidate): Indicateur => {
    if (!isRecord(candidate) || !isRecord(candidate.territory) || !isNonEmptyText(candidate.territory.id) ||
        candidate.territory.type !== level || !isText(candidate.territory.name) || !isNonEmptyText(candidate.status) ||
        !Array.isArray(candidate.sources)) {
      throw new PayloadError('validation', path, 'Observation native du cohort scalaire mal formée.')
    }
    const territoryId = candidate.territory.id
    const reference = refs.get(territoryId)
    if (!reference || !memberIds.has(territoryId) || reference.nom !== candidate.territory.name || seen.has(territoryId)) {
      throw new PayloadError('validation', path, 'Observation scalaire hors cohort, dupliquée ou différente du référentiel.')
    }
    const status = candidate.status
    const value = candidate.value
    const support = candidate.support_count
    const denominator = candidate.denominator_count
    const statuses = ['measured', 'suppressed', 'unsupported', 'not_available', 'not_published']
    const validCount = (count: unknown) => count === null || (Number.isSafeInteger(count) && (count as number) >= 0)
    const countsValid = countsAvailable
      ? 'support_count' in candidate && 'denominator_count' in candidate && validCount(support) && validCount(denominator)
      : (!('support_count' in candidate) && !('denominator_count' in candidate)) ||
        (validCount(support) && validCount(denominator))
    if (!statuses.includes(status) || (status === 'measured' ? !isFiniteNumber(value) : value !== null) ||
        !countsValid || candidate.sources.length === 0) {
      throw new PayloadError('validation', path, 'Valeur, statut ou support de l’observation scalaire invalide.')
    }
    const sources = candidate.sources.map((source) => {
      if (!isRecord(source) || !isNonEmptyText(source.source_id) || !allowedSources.has(source.source_id) ||
          !isNonEmptyText(source.name) || !isNonEmptyText(source.vintage_id) || !isNonEmptyText(source.version) ||
          !isNullableDate(source.reference_date) || !isNullableDate(source.publication_date)) {
        throw new PayloadError('validation', path, 'La provenance d’une observation scalaire ne correspond pas aux sources déclarées.')
      }
      return { sourceId: source.source_id, source: source.name, version: source.version,
        referenceDate: source.reference_date, publicationDate: source.publication_date,
        vintageId: source.vintage_id, lineage: { ...source } }
    })
    if (new Set(sources.map((source) => `${source.sourceId}\u0000${source.vintageId}`)).size !== sources.length) {
      throw new PayloadError('validation', path, 'La provenance scalaire contient des sources dupliquées.')
    }
    seen.add(territoryId)
      const primary = sources[0]!
      return { territoire: territoryId, type: level, theme, key: indicator, detail: null,
        value: status === 'measured' ? value as number : null, unit: descriptor.unit as string,
      ...(nativeContract ? { nativeContract } : {}),
      rider: status === 'measured' ? null : explicationStatutScalaire(status),
      observation_status: status === 'measured' ? 'measured' : 'missing',
      fact_status: status as Indicateur['fact_status'],
      ...(countsAvailable ? { support_count: support as number | null, denominator_count: denominator as number | null } : {}),
      vintage_source: primary.source, vintage_version: primary.version,
      vintage_date_reference: primary.referenceDate, vintage_date_publication: primary.publicationDate,
      source_id: primary.sourceId, vintage_id: primary.vintageId,
      fact_sources: sources.map(({ sourceId, source: sourceName, version, referenceDate, publicationDate, lineage }) =>
        ({ sourceId, source: sourceName, version, referenceDate, publicationDate, lineage })),
      rang_epci: null, rang_epci_n: null, rang_dep: null, rang_dep_n: null, rang_reg: null, rang_reg_n: null }
  })
  if (descriptor.completeness === 'dense_complete' && seen.size !== memberIds.size) {
    throw new PayloadError('validation', path, 'Le cohort scalaire dense ne contient pas une observation par membre.')
  }
  return facts
}

/** Reuse the published scalar cohort validator/adapter for map cohort reads. */
export function adapterCohorteScalairePourCarte(input: {
  data: unknown
  declaration: SemanticResourceDeclaration
  indicator: string
  theme: Theme
  page: IndicatorPageMetadata
  level: TerritoireType
  territories: Territoire[]
}): { facts: Indicateur[]; identity: ScalarIdentity } {
  const identity: ScalarIdentity = {}
  if (!isRecord(input.data)) throw new PayloadError('validation', '/api/resources/read-batch', 'Cohorte scalaire de carte invalide.')
  const facts = adapterCohorteScalaire(input.data, input.declaration, input.indicator, input.theme,
    input.page, input.level, input.territories, {}, identity, false, true)
  return { facts, identity }
}

/** Producer registration may be level-specific; unsupported levels stay on the incumbent path. */
export function indicateursScalairesPourNiveau(raw: unknown, level: TerritoireType): string[] {
  const registered = indicateursScalairesEnregistres(raw)
  const declarations = (raw as { scalar_contracts: unknown }).scalar_contracts
  if (Array.isArray(declarations)) return registered
  return registered.filter((indicator) => {
    const contract = (declarations as Record<string, unknown>)[indicator]
    if (typeof contract !== 'object' || contract === null || !('allowed_levels' in contract) ||
        !Array.isArray(contract.allowed_levels) || !contract.allowed_levels.every((value) =>
          value === 'commune' || value === 'epci' || value === 'departement' || value === 'region')) {
      throw new PayloadError('validation', 'theme metadata', `Les niveaux autorisés de « ${indicator} » sont mal formés.`)
    }
    return contract.allowed_levels.includes(level)
  })
}

export interface ScalarCohortsWithComparisons {
  facts: Indicateur[]
  comparisons: Record<string, ScalarComparisonRank | null>
  identity: { contentVersion: string; referenceContentVersion: string; descriptorVersion?: string; comparisonFacet?: string }
  nativeContracts: Record<string, NativeThemeFactContract>
  declarations: SemanticResourceDeclaration[]
}

async function chargerCohortesEtComparaisonsScalaires(
  indicators: string[], theme: Theme, metadata: ThemeMetadata, focal: Territoire | null,
  level: TerritoireType, territories: Territoire[], scope: { department?: string; epci?: string },
  comparison?: ScalarComparisonRequest, projectProducerCounts = false,
  catalogueOverride?: SemanticResourceDeclaration[],
): Promise<ScalarCohortsWithComparisons> {
  validerEnregistrementScalaires(metadata, indicators)
  const path = '/api/resources/read-batch'
  if (indicators.length > 12) throw new PayloadError('validation', path, 'Le lot scalaire dépasse la limite de 12 ressources.')
  if (comparison && !focal) throw new PayloadError('validation', path, 'Une comparaison scalaire nécessite un territoire focal publié.')
  if (comparison && focal) validateComparisonRequest(comparison, focal, territories)
  const comparisonRead = comparison && comparison.scope.memberCount >= 2 ? comparison : undefined
  if (comparisonRead && indicators.length * 2 > 12) {
    throw new PayloadError('validation', path, 'Le lot scalaire et ses comparaisons dépasse la limite de 12 lectures.')
  }
  if (!indicators.length) return { facts: [], comparisons: {}, nativeContracts: {}, declarations: [],
    identity: { contentVersion: '', referenceContentVersion: '' } }
  const catalogue = catalogueOverride ?? await chargerCatalogueRessources()
  const identities: ScalarIdentity[] = []
  const pages = indicators.map((indicator) => {
    const page = metadata.indicator_pages?.[indicator]
    if (!page) throw new PayloadError('validation', 'theme metadata', `Page scalaire « ${indicator} » absente.`)
    const identity: ScalarIdentity = {}
    identities.push(identity)
    return { page, identity, declaration: catalogue.find((resource) => resource.resource_id === indicator) }
  })
  if (comparisonRead && pages.some(({ declaration }) => !declaration?.target_kinds.includes('territory') ||
      !declaration.intents.includes(comparisonRead.kind === 'fixed' ? 'fixed_comparison' : 'selected_comparison'))) {
    throw new PayloadError('validation', path, 'La ressource scalaire ne déclare pas cette comparaison territoriale.')
  }
  const countsByIndicator = new Map(indicators.map((indicator) => [indicator,
    projectProducerCounts ? contractCountsAvailable(metadata, indicator) : true] as const))
  const items = indicators.flatMap((indicator) => [itemScalaire(indicator, level, scope, countsByIndicator.get(indicator)),
    ...(comparisonRead ? [itemComparaisonScalaire(indicator, focal!, comparisonRead)] : [])])
  const data = await lireRessourcesBatch(items)
  const cohorts: Indicateur[][] = []
  const comparisons: Record<string, ScalarComparisonRank | null> = {}
  const nativeContracts: Record<string, NativeThemeFactContract> = {}
  indicators.forEach((indicator, index) => {
    const factIndex = comparisonRead ? index * 2 : index
    cohorts.push(adapterCohorteScalaire(data[factIndex]!, pages[index]!.declaration, indicator,
      theme, pages[index]!.page, level, territories, scope, pages[index]!.identity,
      countsByIndicator.get(indicator), projectProducerCounts,
      projectProducerCounts ? (contract) => { nativeContracts[indicator] = contract } : undefined))
    if (comparison) comparisons[indicator] = comparisonRead
      ? adapterComparaisonScalaire(data[factIndex + 1]!, indicator, pages[index]!.page, focal!,
          comparisonRead, pages[index]!.identity)
      : null
  })
  const versions = new Set(identities.map((identity) => identity.contentVersion ?? ''))
  const territoryVersions = new Set(identities.map((identity) => identity.referenceContentVersion ?? ''))
  if (versions.size > 1 || versions.has('') || territoryVersions.size > 1 || territoryVersions.has('')) {
    throw new PayloadError('validation', 'indicator cohorts', 'Les cohortes ne partagent pas la même version de publication et de référentiel territorial.')
  }
  return { facts: cohorts.flat(), comparisons, nativeContracts,
    declarations: pages.map(({ declaration }) => declaration!),
    identity: { contentVersion: [...versions][0]!, referenceContentVersion: [...territoryVersions][0]!,
      ...(identities[0]?.descriptorVersion ? { descriptorVersion: identities[0].descriptorVersion } : {}),
      ...(identities[0]?.comparisonFacet ? { comparisonFacet: identities[0].comparisonFacet } : {}) } }
}

/** Acquire the producer-registered scalar facts for one selected theme together. */
export async function chargerCohortesScalaires(
  indicators: string[], theme: Theme, metadata: ThemeMetadata, focal: Territoire,
  level: TerritoireType, territories: Territoire[], scope: { department?: string; epci?: string },
): Promise<Indicateur[]> {
  return (await chargerCohortesEtComparaisonsScalaires(indicators, theme, metadata, focal, level, territories, scope)).facts
}

/** First fiche load pairs facts and their resolved comparison in one read snapshot. */
export async function chargerCohortesScalairesAvecComparaisons(
  indicators: string[], theme: Theme, metadata: ThemeMetadata, focal: Territoire,
  level: TerritoireType, territories: Territoire[], scope: { department?: string; epci?: string },
  comparison: ScalarComparisonRequest | null,
): Promise<ScalarCohortsWithComparisons> {
  return chargerCohortesEtComparaisonsScalaires(indicators, theme, metadata, focal, level, territories, scope,
    comparison ?? undefined)
}

/** API-only indicator pages pair native scalar facts with their publication identity. */
export async function chargerCohortePageScalaire(
  indicator: string, theme: Theme, metadata: ThemeMetadata, focal: Territoire | null,
  level: TerritoireType, territories: Territoire[], scope: { department?: string; epci?: string },
  catalogue?: SemanticResourceDeclaration[],
): Promise<{ facts: Indicateur[]; identity: ScalarCohortsWithComparisons['identity'];
  contract: NativeThemeFactContract; declaration: SemanticResourceDeclaration }> {
  const result = await chargerCohortesEtComparaisonsScalaires([indicator], theme, metadata,
    focal, level, territories, scope, undefined, true, catalogue)
  const contract = result.nativeContracts[indicator]
  const declaration = result.declarations[0]
  if (!contract || !declaration) throw new PayloadError('validation', '/api/resources/read-batch', 'Le descripteur scalaire natif est absent.')
  return { facts: result.facts, identity: result.identity, contract, declaration }
}

/** Read the selected territory separately when it is outside the page's bounded cohort. */
export async function chargerFaitFocalPageScalaire(
  declaration: SemanticResourceDeclaration, indicator: string, theme: Theme, metadata: ThemeMetadata,
  focal: Territoire, territories: Territoire[], identity: ScalarCohortsWithComparisons['identity'],
  contract: NativeThemeFactContract,
): Promise<Indicateur | null> {
  const path = '/api/resources/read-batch'
  const countsAvailable = contractCountsAvailable(metadata, indicator)
  const fields = countsAvailable ? ['value', 'support_count', 'denominator_count'] : ['value']
  if (declaration.resource_id !== indicator || declaration.indicator_id !== indicator || declaration.theme_id !== theme ||
      declaration.shapes.length !== 1 || declaration.shapes[0] !== 'scalar' ||
      !declaration.target_kinds.includes('territory') || !declaration.intents.includes('facts') ||
      !declaration.allowed_levels.includes(focal.type) || !fields.every((field) => declaration.fields.includes(field))) {
    throw new PayloadError('validation', path, 'La ressource scalaire ne déclare pas la lecture focale demandée.')
  }
  const reference = territories.find((territory) => territory.type === focal.type && territory.territoire === focal.territoire)
  if (!reference || reference.nom !== focal.nom) {
    throw new PayloadError('validation', path, 'Le territoire focal est absent du référentiel natif.')
  }
  let data: Row
  try {
    const [read] = await lireRessourcesBatch([{ resource: indicator,
      target: { kind: 'territory', type: focal.type, id: focal.territoire }, fields,
      intent: { kind: 'facts' } }])
    if (!read) throw new PayloadError('validation', path, 'La lecture focale scalaire est absente du lot.')
    data = read
  } catch (cause) {
    // A missing scalar row is sparse absence, not a failed cohort publication.
    if (cause instanceof PayloadError && cause.status === 404) return null
    throw cause
  }
  const status = data.status
  const value = data.value
  const validStatuses = ['measured', 'suppressed', 'unsupported', 'not_available', 'not_published']
  const validCount = (count: unknown) => count === null || (Number.isSafeInteger(count) && (count as number) >= 0)
  const support = data.support_count
  const denominator = data.denominator_count
  const countsValid = countsAvailable
    ? 'support_count' in data && 'denominator_count' in data && validCount(support) && validCount(denominator)
    : !('support_count' in data) && !('denominator_count' in data)
  if (data.indicator_id !== indicator || data.territory_id !== focal.territoire || data.territory_type !== focal.type ||
      data.label !== contract.label || data.unit !== contract.unit || data.direction !== contract.direction ||
      data.descriptor_version !== contract.descriptorVersion || data.comparison_facet !== contract.comparisonFacet ||
      data.content_version !== identity.contentVersion ||
      data.content_version !== contract.contentVersion ||
      data.reference_content_version !== identity.referenceContentVersion ||
      data.reference_content_version !== contract.referenceContentVersion || !isNonEmptyText(data.label) ||
      !isNonEmptyText(data.unit) || !['high', 'low'].includes(String(data.direction)) ||
      !isNonEmptyText(data.descriptor_version) || !validStatuses.includes(String(status)) ||
      (status === 'measured' ? !isFiniteNumber(value) : value !== null) || !countsValid ||
      !Array.isArray(data.sources) || data.sources.length === 0) {
    throw new PayloadError('validation', path, 'Les faits natifs du territoire focal ne correspondent pas à la publication scalaire.')
  }
  const allowedSources = new Set(declaration.sources)
  const sources = data.sources.map((source) => {
    if (!isRecord(source) || !isNonEmptyText(source.source_id) || !allowedSources.has(source.source_id) ||
        !isNonEmptyText(source.name) || !isNonEmptyText(source.vintage_id) || !isNonEmptyText(source.version) ||
        !isNullableDate(source.reference_date) || !isNullableDate(source.publication_date)) {
      throw new PayloadError('validation', path, 'La provenance du territoire focal ne correspond pas aux sources déclarées.')
    }
    return { sourceId: source.source_id, source: source.name, version: source.version,
      referenceDate: source.reference_date, publicationDate: source.publication_date,
      vintageId: source.vintage_id, lineage: { ...source } }
  })
  if (new Set(sources.map((source) => `${source.sourceId}\u0000${source.vintageId}`)).size !== sources.length) {
    throw new PayloadError('validation', path, 'La provenance du territoire focal contient des sources dupliquées.')
  }
  const primary = sources[0]!
  return { territoire: focal.territoire, type: focal.type, theme, key: indicator, detail: null,
    value: status === 'measured' && isFiniteNumber(value) ? value : null, unit: contract.unit!,
    nativeContract: contract,
    rider: status === 'measured' ? null : explicationStatutScalaire(status as string),
    observation_status: status === 'measured' ? 'measured' : 'missing',
    fact_status: status as Indicateur['fact_status'],
    ...(countsAvailable ? { support_count: support as number | null, denominator_count: denominator as number | null } : {}),
    vintage_source: primary.source, vintage_version: primary.version,
    vintage_date_reference: primary.referenceDate, vintage_date_publication: primary.publicationDate,
    source_id: primary.sourceId, vintage_id: primary.vintageId,
    fact_sources: sources.map(({ sourceId, source: sourceName, version, referenceDate, publicationDate, lineage }) =>
      ({ sourceId, source: sourceName, version, referenceDate, publicationDate, lineage })),
    rang_epci: null, rang_epci_n: null, rang_dep: null, rang_dep_n: null, rang_reg: null, rang_reg_n: null }
}

/** Replace only registered facts in a selected theme; all other payload data is untouched. */
export function remplacerFaitsScalaires(themeRows: Indicateur[], replacement: Indicateur[], registered: string[]): Indicateur[] {
  const keys = new Set(registered)
  const signature = (row: Indicateur) => JSON.stringify([
    row.territoire, row.theme, row.key, row.detail ?? null, row.sex ?? null, row.dimension ?? null,
  ])
  const originalBySignature = new Map(
    themeRows
      .filter((row) => row.theme === replacement[0]?.theme && keys.has(row.key) && row.rider)
      .map((row) => [signature(row), row]),
  )
  const replacementsWithRiders = replacement.map((row) => ({
    ...row,
    // Semantic scalar status explanations are app-owned French copy. A static
    // rider may encode a source-state assertion (e.g. no station existed), so
    // it must not outlive the API observation that replaces that fact.
    rider: row.fact_status ? row.rider ?? null : row.rider ?? originalBySignature.get(signature(row))?.rider ?? null,
  }))
  return [...themeRows.filter((row) => !(row.theme === replacement[0]?.theme && keys.has(row.key))), ...replacementsWithRiders]
}
