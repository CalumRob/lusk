import type { Indicateur, Territoire, TerritoireType } from './types'
import { lireRessource } from './semanticResourceClient'
import type { SemanticReadItem, SemanticResourceDeclaration } from './semanticResourceClient'

export interface SparseCollectionPageRead {
  facts: Indicateur[]
  periods: string[]
  availabilityByTerritory: Record<string, 'observed' | 'no_record'>
  identity: { contentVersion: string; referenceContentVersion: string; descriptorVersion: string }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requireText(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value) throw new Error(`Lecture de collection invalide : ${field}`)
  return value
}

export function periodDetailCohortFacts(data: unknown, resource: SemanticResourceDeclaration): Indicateur[] {
  if (!isRecord(data) || data.resource !== resource.resource_id || data.shape !== 'period_detail' ||
      !Array.isArray(data.territories) || !isRecord(data.descriptor) ||
      data.descriptor.kind !== 'period_detail') {
    throw new Error('Lecture native de collection clairsemée invalide')
  }
  const unit = requireText(data.descriptor.unit, 'unit')
  const facts: Indicateur[] = []
  for (const candidate of data.territories) {
    if (!isRecord(candidate) || !isRecord(candidate.territory) || !Array.isArray(candidate.entries)) {
      throw new Error('Territoire de collection invalide')
    }
    if (candidate.completeness !== 'observed_sparse') throw new Error('Complétude de collection invalide')
    const territoryId = requireText(candidate.territory.id, 'territory.id')
    const type = requireText(candidate.territory.type, 'territory.type') as TerritoireType
    if (!['commune', 'epci', 'departement', 'region'].includes(type)) throw new Error('Type de territoire invalide')
    if (candidate.availability === 'no_record') {
      if (candidate.entries.length) throw new Error('Une absence observée ne peut contenir de lignes')
      continue
    }
    if (candidate.availability !== 'observed') throw new Error('Disponibilité de collection invalide')
    for (const raw of candidate.entries) {
      if (!isRecord(raw) || raw.status !== 'measured' || typeof raw.value !== 'number' || !Number.isFinite(raw.value)) {
        throw new Error('Observation de collection mesurée invalide')
      }
      const detail = requireText(raw.detail, 'entry.detail')
      const dimension = requireText(raw.observation_period, 'entry.observation_period')
      if (!Array.isArray(raw.sources) || raw.sources.length === 0) throw new Error('Provenance native absente')
      const sources = raw.sources.flatMap((source) => {
        if (!isRecord(source) || typeof source.source_id !== 'string' || typeof source.name !== 'string' ||
            typeof source.vintage_id !== 'string' || typeof source.version !== 'string') return []
        return [{ sourceId: source.source_id, source: source.name, version: source.version,
          vintageId: source.vintage_id, referenceDate: typeof source.reference_date === 'string' ? source.reference_date : null,
          publicationDate: typeof source.publication_date === 'string' ? source.publication_date : null }]
      })
      if (sources.length !== raw.sources.length) throw new Error('Provenance native invalide')
      const first = raw.sources[0] as Record<string, unknown>
      facts.push({ territoire: territoryId, type, theme: 'programmes', key: resource.indicator_id,
        detail, dimension, value: raw.value, unit, rider: null,
        vintage_source: requireText(first.name, 'source.name'),
        vintage_version: requireText(first.version, 'source.version'),
        vintage_date_reference: typeof first.reference_date === 'string' ? first.reference_date : null,
        vintage_date_publication: typeof first.publication_date === 'string' ? first.publication_date : null,
        fact_sources: sources, rang_epci: null, rang_epci_n: null, rang_dep: null, rang_dep_n: null,
        rang_reg: null, rang_reg_n: null })
    }
  }
  return facts
}

export function periodDetailCohortAvailability(data: unknown,
  resource: SemanticResourceDeclaration): Record<string, 'observed' | 'no_record'> {
  if (!isRecord(data) || data.resource !== resource.resource_id || data.shape !== 'period_detail' ||
      !Array.isArray(data.territories)) throw new Error('Disponibilité native de collection invalide')
  const availability: Record<string, 'observed' | 'no_record'> = {}
  for (const candidate of data.territories) {
    if (!isRecord(candidate) || !isRecord(candidate.territory) || !Array.isArray(candidate.entries) ||
        candidate.completeness !== 'observed_sparse') throw new Error('Territoire de collection invalide')
    const territoryId = requireText(candidate.territory.id, 'territory.id')
    if (Object.hasOwn(availability, territoryId) ||
        (candidate.availability !== 'observed' && candidate.availability !== 'no_record')) {
      throw new Error('Disponibilité territoriale native invalide')
    }
    if (candidate.availability === 'no_record' && candidate.entries.length !== 0) {
      throw new Error('Une absence observée ne peut contenir de lignes')
    }
    availability[territoryId] = candidate.availability
  }
  return availability
}

function cohortItem(resource: string, departmentId?: string, epciId?: string): SemanticReadItem {
  return { resource, target: { kind: 'territory_cohort', type: 'commune',
    ...(departmentId ? { department_id: departmentId } : {}), ...(epciId ? { epci_id: epciId } : {}) },
    intent: { kind: 'facts' }, fields: ['value'] }
}

function comparisonItem(resource: string, focal: Territoire, members: readonly Territoire[], detail: string,
  period: string): SemanticReadItem {
  return { resource, target: { kind: 'territory', type: 'commune', id: focal.territoire },
    intent: { kind: 'selected_comparison', members: members.map(({ territoire }) => ({ type: 'commune', id: territoire })) },
      coordinates: { detail: [detail], period: [period] }, fields: ['status', 'reason', 'median', 'rank', 'rank_size',
      'eligible_count', 'missing_count', 'selected_member_count'] }
}

function identity(data: Record<string, unknown>, resource: SemanticResourceDeclaration) {
  const descriptor = data.descriptor
  if (!isRecord(descriptor) || descriptor.indicator_id !== resource.resource_id) throw new Error('Descripteur de collection incompatible')
  return { contentVersion: requireText(data.content_version, 'content_version'),
    referenceContentVersion: requireText(data.reference_content_version, 'reference_content_version'),
    descriptorVersion: requireText(descriptor.descriptor_version, 'descriptor_version') }
}

export async function acquireSparseCollectionFacts(resource: SemanticResourceDeclaration,
  options: { departmentId?: string; epciId?: string }): Promise<SparseCollectionPageRead> {
  const factsRead = await lireRessource(cohortItem(resource.resource_id, options.departmentId, options.epciId))
  const factIdentity = identity(factsRead, resource)
  const facts = periodDetailCohortFacts(factsRead, resource)
  const availabilityByTerritory = periodDetailCohortAvailability(factsRead, resource)
  const periods = [...new Set(facts.map(({ dimension }) => dimension).filter((value): value is string => Boolean(value)))].sort()
  return { facts, periods, availabilityByTerritory, identity: factIdentity }
}

export async function reacquireSparseCollectionComparison(resource: SemanticResourceDeclaration,
  options: { focal: Territoire; members: readonly Territoire[]; detail: string; period: string;
    identity: SparseCollectionPageRead['identity'] }): Promise<Record<string, unknown>> {
  const data = await lireRessource(comparisonItem(resource.resource_id, options.focal, options.members,
    options.detail, options.period))
  const result = data.result
  const expectedTarget = { kind: 'territory', type: 'commune', id: options.focal.territoire }
  const expectedMembers = options.members.map(({ territoire }) => `commune\u0000${territoire}`).sort()
  const selection = data.selection
  const actualMembers = Array.isArray(selection) ? selection.flatMap((member) =>
    isRecord(member) && member.territory_type === 'commune' && typeof member.territory_id === 'string'
      ? [`commune\u0000${member.territory_id}`] : []) : []
  const scope = data.scope
  if (data.resource !== resource.resource_id || !isRecord(data.target) ||
      data.target.kind !== expectedTarget.kind || data.target.type !== expectedTarget.type ||
      data.target.id !== expectedTarget.id || expectedMembers.length !== options.members.length ||
      !Array.isArray(selection) || actualMembers.length !== selection.length || actualMembers.length !== expectedMembers.length ||
      actualMembers.sort().some((member, index) => member !== expectedMembers[index]) ||
      !isRecord(scope) || scope.kind !== 'explicit_selection' || scope.member_count !== expectedMembers.length ||
      data.content_version !== options.identity.contentVersion ||
      data.reference_content_version !== options.identity.referenceContentVersion || !isRecord(result) ||
      result.descriptor_version !== options.identity.descriptorVersion || !isRecord(result.source_facet) ||
      result.source_facet.detail !== options.detail || result.source_facet.observation_period !== options.period ||
      result.selected_member_count !== expectedMembers.length || typeof result.unit !== 'string' || !result.unit) {
    throw new Error('La comparaison native ne correspond plus aux faits conservés')
  }
  return result
}
