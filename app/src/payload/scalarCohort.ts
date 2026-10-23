import type { Indicateur, Territoire, TerritoireType, Theme, IndicatorPageMetadata, ThemeMetadata } from './types'
import { PayloadError } from './validate'
import { chargerCatalogueRessources, lireRessourcesBatch } from './semanticResourceClient'
import type { SemanticReadItem, SemanticResourceDeclaration } from './semanticResourceClient'

type Row = Record<string, unknown>

const isRecord = (value: unknown): value is Row => typeof value === 'object' && value !== null && !Array.isArray(value)
const isText = (value: unknown): value is string => typeof value === 'string'
const isNonEmptyText = (value: unknown): value is string => typeof value === 'string' && value.length > 0
const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const isNullableDate = (value: unknown): value is string | null => value === null || isText(value)

interface ScalarIdentity { contentVersion?: string; referenceContentVersion?: string }

export interface ScalarComparisonRank {
  rank: number
  rankSize: number
  scope: string
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
  focal: Territoire, level: TerritoireType, territories: Territoire[], scope: { department?: string; epci?: string },
  identity?: ScalarIdentity,
): Promise<Indicateur[]> {
  const resources = await chargerCatalogueRessources()
  const [data] = await lireRessourcesBatch([itemScalaire(indicator, level, scope)])
  const declaration = resources.find((resource) => resource.resource_id === indicator)
  return adapterCohorteScalaire(data!, declaration, indicator, theme, page, focal, level, territories, scope, identity)
}

/** Read the clicked territory's rank from the exact producer comparison group.
 * Commune groups are explicit selected comparisons; EPCI and département use
 * their producer-published same-level default comparison. Région has no rank. */
export async function chargerRangScalaire(indicator: string, theme: Theme, page: IndicatorPageMetadata,
  focal: Territoire, territories: Territoire[], identity?: ScalarIdentity): Promise<ScalarComparisonRank | null> {
  const group = groupeRangScalaire(focal, territories)
  if (!group || group.members.length < 2) return null
  const path = '/api/resources/read-batch'
  const resources = await chargerCatalogueRessources()
  const resource = resources.find((candidate) => candidate.resource_id === indicator)
  const intent = group.members[0]?.type === 'commune'
    ? 'selected_comparison'
    : 'fixed_comparison'
  if (!resource || resource.indicator_id !== indicator || resource.theme_id !== theme ||
      !resource.shapes.includes('scalar') || !resource.target_kinds.includes('territory') ||
      !resource.allowed_levels.includes(focal.type) || !resource.intents.includes(intent) ||
      page.sources.some((source) => !resource.sources.includes(source))) {
    throw new PayloadError('validation', path, 'La ressource scalaire ne déclare pas cette comparaison territoriale.')
  }
  const selectedMembers = group.members.map((member) => ({ type: member.type, id: member.territoire }))
  const item: SemanticReadItem = {
    resource: indicator,
    target: { kind: 'territory', type: focal.type, id: focal.territoire },
    fields: ['rank', 'rank_size', 'eligible_count', 'selected_member_count', 'missing_count'],
    intent: intent === 'selected_comparison'
      ? { kind: 'selected_comparison', members: selectedMembers }
      : { kind: 'fixed_comparison', context: 'default' },
  }
  const [data] = await lireRessourcesBatch([item])
  const expectedSelection = intent === 'selected_comparison'
    ? selectedMembers.map(({ type, id }) => ({ territory_type: type, territory_id: id }))
    : null
  const scope = data!.scope
  const expectedScopeKind = intent === 'selected_comparison' ? 'explicit_selection' : 'same_level'
  // The indicator-scoped comparison API returns one `result` object (the
  // theme-scoped endpoint is the one that returns a `results` array).
  const result = isRecord(data!.result) ? data!.result : null
  const rank = result?.rank
  const rankSize = result?.rank_size
  const eligible = result?.eligible_count
  const selectedCount = result?.selected_member_count
  const missing = result?.missing_count
  const expectedDirection = page.comparison?.direction ?? page.direction
  const expectedFacet = page.comparison?.indicator ?? indicator
  if (data!.contract !== 'indicator-comparison-v1' || data!.indicator_id !== indicator || data!.shape !== 'scalar' ||
       !isNonEmptyText(data!.content_version) || !isNonEmptyText(data!.reference_content_version) ||
       (identity?.contentVersion !== undefined && data!.content_version !== identity.contentVersion) ||
      (identity?.referenceContentVersion !== undefined && data!.reference_content_version !== identity.referenceContentVersion) ||
      !isRecord(data!.target) || data!.target.kind !== 'territory' || data!.target.type !== focal.type || data!.target.id !== focal.territoire ||
      JSON.stringify(data!.selection ?? null) !== JSON.stringify(expectedSelection) || !isRecord(scope) ||
      scope.kind !== expectedScopeKind || scope.member_count !== group.members.length ||
      !result || result.indicator_id !== indicator || result.status !== 'available' && result.status !== 'unavailable' ||
      result.unit !== page.unit || result.direction !== expectedDirection || result.source_facet !== expectedFacet ||
      !isNonEmptyText(result.descriptor_version) || !Number.isSafeInteger(selectedCount) ||
      selectedCount !== group.members.length || !Number.isSafeInteger(eligible) || !Number.isSafeInteger(missing) ||
      (eligible as number) + (missing as number) !== group.members.length ||
      (rank === null ? rankSize !== null : !Number.isSafeInteger(rank) || !Number.isSafeInteger(rankSize) ||
        (rank as number) < 1 || (rank as number) > (rankSize as number) || (rankSize as number) < 2 || rankSize !== eligible)) {
    throw new PayloadError('validation', path, 'La comparaison scalaire ne reflète pas la ressource, le territoire ou le groupe déclaré.')
  }
  return rank === null ? null : { rank: rank as number, rankSize: rankSize as number, scope: group.scope }
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

function itemScalaire(indicator: string, level: TerritoireType,
  scope: { department?: string; epci?: string }): SemanticReadItem {
  return { resource: indicator,
    target: { kind: 'territory_cohort', type: level,
      department_id: level === 'commune' ? scope.department ?? null : null,
      epci_id: level === 'commune' ? scope.epci ?? null : null },
    fields: ['value', 'support_count', 'denominator_count'], intent: { kind: 'facts' } }
}

function requireScalarResource(resource: SemanticResourceDeclaration | undefined, indicator: string,
  theme: Theme, level: TerritoireType, page: IndicatorPageMetadata): SemanticResourceDeclaration {
  if (!resource || resource.resource_id !== indicator || resource.indicator_id !== indicator || resource.theme_id !== theme ||
      !resource.shapes.includes('scalar') || !resource.target_kinds.includes('territory_cohort') ||
      !resource.allowed_levels.includes(level) || !resource.intents.includes('facts') ||
      !['value', 'support_count', 'denominator_count'].every((field) => resource.fields.includes(field)) ||
      page.sources.some((source) => !resource.sources.includes(source))) {
    throw new PayloadError('validation', indicator, 'La ressource scalaire déclarée n’est pas compatible avec cette lecture.')
  }
  return resource
}

function sameFilters(actual: unknown, expected: string | null): boolean {
  return actual === undefined || actual === null ? expected === null : actual === expected
}

function adapterCohorteScalaire(data: Row, declaration: SemanticResourceDeclaration | undefined,
  indicator: string, theme: Theme, page: IndicatorPageMetadata, focal: Territoire, level: TerritoireType,
  territories: Territoire[], scope: { department?: string; epci?: string }, identity?: ScalarIdentity): Indicateur[] {
  const path = '/api/resources/read-batch'
  const resource = requireScalarResource(declaration, indicator, theme, level, page)
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
      descriptor.unit !== page.unit || descriptor.direction !== (page.comparison?.direction ?? page.direction) ||
      descriptor.comparison_facet !== (page.comparison?.indicator ?? indicator) ||
      !Array.isArray(descriptor.allowed_levels) || !descriptor.allowed_levels.includes(level) ||
      !['sparse', 'dense_complete'].includes(String(descriptor.completeness)) ||
      !isNonEmptyText(descriptor.denominator_semantics) || !isNonEmptyText(descriptor.descriptor_version) ||
      !Array.isArray(data.observations)) {
    throw new PayloadError('validation', path, 'Le descripteur ou l’enveloppe du cohort scalaire est incompatible.')
  }
  const allowedSources = new Set([...page.sources, ...resource.sources])
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
  if (memberIds.size !== expectedMembers.length || expectedMembers.some((member) => !memberIds.has(member.territoire)) ||
      !memberIds.has(focal.territoire)) {
    throw new PayloadError('validation', path, 'Le cohort scalaire ne couvre pas exactement le périmètre publié demandé.')
  }
  if (identity) {
    identity.contentVersion = data.content_version
    identity.referenceContentVersion = data.reference_content_version
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
    if (!statuses.includes(status) || (status === 'measured' ? !isFiniteNumber(value) : value !== null) ||
        !('support_count' in candidate) || !('denominator_count' in candidate) ||
        !validCount(support) || !validCount(denominator) || candidate.sources.length === 0) {
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
      rider: status === 'measured' ? null : status,
      observation_status: status === 'measured' ? 'measured' : 'missing',
      fact_status: status as Indicateur['fact_status'],
      support_count: support as number | null, denominator_count: denominator as number | null,
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

/** Acquire the producer-registered scalar facts for one selected theme together.
 * Requests are deduplicated by the caller's registration contract and run in
 * parallel; this deliberately remains one bounded cohort request per key. */
export async function chargerCohortesScalaires(
  indicators: string[], theme: Theme, metadata: ThemeMetadata, focal: Territoire,
  level: TerritoireType, territories: Territoire[], scope: { department?: string; epci?: string },
): Promise<Indicateur[]> {
  validerEnregistrementScalaires(metadata, indicators)
  const path = '/api/resources/read-batch'
  if (indicators.length > 12) throw new PayloadError('validation', path, 'Le lot scalaire dépasse la limite de 12 ressources.')
  const catalogue = await chargerCatalogueRessources()
  const identities: ScalarIdentity[] = []
  const pages = indicators.map((indicator) => {
    const page = metadata.indicator_pages?.[indicator]
    if (!page) throw new PayloadError('validation', 'theme metadata', `Page scalaire « ${indicator} » absente.`)
    const identity: ScalarIdentity = {}
    identities.push(identity)
    return { page, identity, declaration: catalogue.find((resource) => resource.resource_id === indicator) }
  })
  const items = indicators.map((indicator) => itemScalaire(indicator, level, scope))
  const data = indicators.length ? await lireRessourcesBatch(items) : []
  const cohorts = data.map((read, index) => adapterCohorteScalaire(read, pages[index]!.declaration, indicators[index]!,
    theme, pages[index]!.page, focal, level, territories, scope, pages[index]!.identity))
  const versions = new Set(identities.map((identity) => identity.contentVersion ?? ''))
  const territoryVersions = new Set(identities.map((identity) => identity.referenceContentVersion ?? ''))
  if (versions.size > 1 || versions.has('') || territoryVersions.size > 1 || territoryVersions.has('')) {
    throw new PayloadError('validation', 'indicator cohorts', 'Les cohortes ne partagent pas la même version de publication et de référentiel territorial.')
  }
  return cohorts.flat()
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
    // Scalar cohorts replace numeric observations, not content-owned riders
    // such as "no service station on this territory" from the published row.
    rider: row.rider ?? originalBySignature.get(signature(row))?.rider ?? null,
  }))
  return [...themeRows.filter((row) => !(row.theme === replacement[0]?.theme && keys.has(row.key))), ...replacementsWithRiders]
}
