import type { Indicateur, IndicatorPageMetadata, NativeThemeFactContract, Territoire, TerritoireType, Theme } from './types'
import { SIGLES_PROGRAMMES } from './types'
import type { SigleProgramme } from './types'
import { adapterCohorteScalairePourCarte } from './scalarCohort'
import { adapterProfilDeclare } from './profileAcquisition'
import { periodDetailCohortFacts } from './sparseCollectionPage'
import { orderedSeriesAdapterFor, orderedSeriesFacts } from './orderedSeriesAdapter'
import { chargerCatalogueRessources, lireRessourcesBatch } from './semanticResourceClient'
import type { SemanticReadItem, SemanticResourceDeclaration } from './semanticResourceClient'
import { PayloadError } from './validate'

type Row = Record<string, unknown>
const isRecord = (value: unknown): value is Row => typeof value === 'object' && value !== null && !Array.isArray(value)
const text = (value: unknown): value is string => typeof value === 'string' && value.length > 0
const nullableText = (value: unknown): value is string | null => value === null || typeof value === 'string'
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

export interface MapSemanticFacts {
  facts: Indicateur[]
  stories: Array<Record<string, unknown>>
  memberships: Array<{ territoire: string; type: 'commune' | 'epci'; sigle: SigleProgramme;
    availability: 'observed' | 'no_record'; member: boolean | null; rider: string | null;
    relationships: Array<Record<string, unknown>>; summaries: Array<Record<string, unknown>> }>
  grants: Indicateur[]
  declarations: SemanticResourceDeclaration[]
  axes: Record<string, string[]>
  identity: { contentVersion: string; referenceContentVersion: string }
  identities: Record<string, { contentVersion: string; referenceContentVersion: string }>
  /** The validated native scalar descriptors, keyed by indicator and retained
   * independently of the projected observations — a sparse cohort may admit
   * zero rows while keeping its descriptor and publication identity. */
  nativeContracts: Record<string, NativeThemeFactContract>
}

export interface MapReadingBinding {
  /** The producer subgroup identity in axis_values[groupe]. */
  subgroup: string
  /** App-presentation field candidates, later intersected with native fields. */
  fields: readonly string[]
}

function readingGroups(declaration: SemanticResourceDeclaration): string[] {
  return declaration.axis_values?.find(([axis]) => axis === 'groupe')?.[1] ?? []
}

function matchedReadingBindings(declaration: SemanticResourceDeclaration,
  bindings: readonly MapReadingBinding[]): MapReadingBinding[] {
  if (!declaration.shapes.includes('typed_reading')) return []
  const groups = new Set(readingGroups(declaration))
  return bindings.flatMap((binding) => groups.has(binding.subgroup) &&
    binding.fields.some((field) => declaration.fields.includes(field)) ? [binding] : [])
}

function requireRecord(value: unknown, field: string): Row {
  if (!isRecord(value)) throw new Error(`Preuve native de carte invalide : ${field}`)
  return value
}

function sourceEvidence(value: unknown, declaration: SemanticResourceDeclaration) {
  if (!Array.isArray(value) || value.length === 0) throw new Error('Provenance API de carte absente')
  return value.map((candidate) => {
    const source = requireRecord(candidate, 'source')
    if (!text(source.source_id) || !declaration.sources.includes(source.source_id) || !text(source.name) ||
        !text(source.vintage_id) || !text(source.version) || !nullableText(source.reference_date) ||
        !nullableText(source.publication_date)) throw new Error('Provenance API de carte non déclarée ou mal formée')
    return { sourceId: source.source_id, source: source.name, vintageId: source.vintage_id,
      version: source.version, referenceDate: source.reference_date, publicationDate: source.publication_date }
  })
}

/** Validate a bounded native cohort and adapt its producer-declared shape without synthesizing values. */
export function factsCarteDepuisLectureCohorte(declaration: SemanticResourceDeclaration, raw: unknown,
  territories: readonly Territoire[], readingParams: readonly MapReadingBinding[] = [],
  pages?: Partial<Record<string, IndicatorPageMetadata>>): MapSemanticFacts {
  const data = requireRecord(raw, 'response')
  const target = requireRecord(data.target, 'target')
  const cohort = requireRecord(data.cohort, 'cohort')
  if (data.resource !== declaration.resource_id || target.kind !== 'territory_cohort' ||
      !declaration.allowed_levels.includes(target.type as TerritoireType) ||
      cohort.territory_type !== target.type || cohort.department_id !== null || cohort.epci_id !== null ||
      !text(data.content_version) || !text(data.reference_content_version) ||
      cohort.reference_content_version !== data.reference_content_version ||
      !Array.isArray(cohort.members) || cohort.member_count !== cohort.members.length) {
    throw new Error('Identité, population ou publication native de carte incompatible')
  }
  const references = new Map(territories.filter((territory) => territory.type === target.type)
    .map((territory) => [territory.territoire, territory]))
  const members = new Set<string>()
  for (const candidate of cohort.members) {
    const member = requireRecord(candidate, 'cohort member')
    const reference = typeof member.id === 'string' ? references.get(member.id) : undefined
    if (!reference || member.type !== target.type || member.name !== reference.nom || members.has(reference.territoire)) {
      throw new Error('Population native de carte différente du référentiel connu')
    }
    members.add(reference.territoire)
  }
  if (members.size !== references.size || [...references.keys()].some((id) => !members.has(id))) {
    throw new Error('Population native de carte incomplète')
  }
  const shape = declaration.shapes.find((candidate) => candidate === data.shape)
  if (!shape) throw new Error('Forme native de carte non déclarée')
  if (shape === 'scalar') {
    const page = pages?.[declaration.indicator_id]
    const adapted = adapterCohorteScalairePourCarte({ data, declaration, indicator: declaration.indicator_id,
      theme: declaration.theme_id as Theme, page, level: target.type as TerritoireType,
      territories: [...territories] })
    return { facts: adapted.facts, stories: [], memberships: [], grants: [], declarations: [declaration],
      axes: {}, identity: { contentVersion: adapted.identity.contentVersion ?? '',
        referenceContentVersion: adapted.identity.referenceContentVersion ?? '' }, identities: {},
      nativeContracts: { [declaration.indicator_id]: adapted.nativeContract } }
  }
  if (shape === 'declared_profile') {
    const adapted = adapterProfilDeclare({ declaration,
      target: { type: target.type as TerritoireType, department_id: null, epci_id: null },
      territories: [...territories], cohort: data })
    const descriptor = adapted.descriptor
    const detailAxes = descriptor.axes.filter((axis) => axis.name === 'detail')
    return { facts: adapted.facts, stories: [], memberships: [], grants: [], declarations: [declaration],
      axes: { [declaration.indicator_id]: detailAxes.map((axis) => axis.key) },
      identity: { contentVersion: adapted.identity.contentVersion,
        referenceContentVersion: adapted.identity.referenceContentVersion }, identities: {},
      nativeContracts: { [declaration.indicator_id]: {
        label: descriptor.label, unit: descriptor.unit, direction: declaration.direction,
        allowedLevels: descriptor.allowed_levels, shapes: ['declared_profile'],
        axisValues: detailAxes.map((axis) => axis.key),
        axes: descriptor.axes.map((axis) => ({ name: axis.name, key: axis.key, label: axis.label,
          order: axis.order, unit: axis.unit })),
        completeness: descriptor.completeness, descriptorVersion: descriptor.descriptor_version,
        contentVersion: adapted.identity.contentVersion, referenceContentVersion: adapted.identity.referenceContentVersion,
      } } }
  }
  if (shape === 'period_detail') {
    const facts = periodDetailCohortFacts(data, declaration).map((fact) => ({ ...fact, theme: declaration.theme_id as Theme }))
    return { facts, stories: [], memberships: [], grants: [], declarations: [declaration], axes: {}, identity: {
      contentVersion: String(data.content_version), referenceContentVersion: String(data.reference_content_version),
    }, identities: {}, nativeContracts: {} }
  }
  if (shape === 'ordered_series') {
    const adapter = orderedSeriesAdapterFor(declaration.theme_id, declaration.indicator_id, declaration)
    if (!adapter) throw new Error('Adaptateur de série déclarée absent')
    if (!Array.isArray(data.series)) throw new Error('Série de carte absente')
    const wireSeries = requireRecord(data.series[0], 'series')
    if (!isRecord(wireSeries.territory) || !Array.isArray(wireSeries.points)) throw new Error('Série native vide/invalide')
    const rawDescriptor = requireRecord(data.descriptor, 'series descriptor')
    const facts = orderedSeriesFacts({ indicator_id: declaration.indicator_id,
      axis_kind: rawDescriptor.axis_kind as 'year' | 'state_role' | 'declared_detail', unit: String(rawDescriptor.unit),
      territory: wireSeries.territory as Parameters<typeof orderedSeriesFacts>[0]['territory'],
      points: wireSeries.points as Parameters<typeof orderedSeriesFacts>[0]['points'],
      scope_series: data.series.map((candidate: unknown) => {
        const row = requireRecord(candidate, 'series member')
        if (!isRecord(row.territory) || !Array.isArray(row.points)) throw new Error('Series member malformed')
        return { territory: row.territory as unknown as { id: string; type: TerritoireType; name: string },
          points: row.points as unknown as Parameters<typeof orderedSeriesFacts>[0]['points'] }
      }),
      native_descriptor: { label: declaration.label, unit: declaration.unit,
        direction: declaration.direction as 'high' | 'low' | 'none', axis_kind: String(rawDescriptor.axis_kind),
        axis_values: rawDescriptor.axis_values as string[], comparison_point: text(rawDescriptor.comparison_point) ? rawDescriptor.comparison_point : null },
      comparison: null },
      declaration.theme_id as Theme, [...territories], 'detail')
    const grants = declaration.theme_id === 'programmes'
      ? (() => {
        const comparisonPoint = rawDescriptor.comparison_point
        if (!text(comparisonPoint) || !Array.isArray(rawDescriptor.axis_values) ||
            !rawDescriptor.axis_values.includes(comparisonPoint)) {
          throw new Error('Point de comparaison natif des subventions absent ou hors axe')
        }
        return facts.filter((fact) => fact.detail === comparisonPoint)
      })() : []
    return { facts: declaration.theme_id === 'programmes' ? [] : facts,
      stories: [], memberships: [], grants,
      declarations: [declaration], axes: { [declaration.indicator_id]:
        Array.isArray((data.descriptor as Row | undefined)?.axis_values)
          ? (data.descriptor as Row).axis_values as string[] : [] },
      identity: { contentVersion: String(data.content_version), referenceContentVersion: String(data.reference_content_version) },
      identities: {}, nativeContracts: {} }
  }
  const facts: Indicateur[] = []
  const stories: Array<Record<string, unknown>> = []
  const memberships: MapSemanticFacts['memberships'] = []
  const grants: Indicateur[] = []
  if (shape === 'anchored_membership') {
    if (!Array.isArray(data.territories)) throw new Error('Territoires natifs de collection absents')
    for (const candidate of data.territories) {
      const territory = requireRecord(candidate, 'collection territory')
      if (!Array.isArray(territory.entries)) throw new Error('Entrées natives de collection absentes')
      if (shape === 'anchored_membership') {
        if (territory.availability !== 'observed' && territory.availability !== 'no_record') {
          throw new Error('Disponibilité native d’adhésion invalide')
        }
        if (!isRecord(territory.territory) || !members.has(String(territory.territory.id))) {
          throw new Error('Territoire d’adhésion hors population')
        }
        const entries = territory.entries.map((value) => requireRecord(value, 'membership entry'))
        if (!Array.isArray(territory.relationships)) throw new Error('Relations d’ancrage absentes')
        const relationships = territory.relationships.map((value) => requireRecord(value, 'membership relationship'))
        if (!Array.isArray(territory.summaries)) throw new Error('Synthèses d’ancrage absentes')
        const summaries = Array.isArray(territory.summaries)
          ? territory.summaries.map((value) => requireRecord(value, 'membership summary')) : []
        for (const entry of entries) sourceEvidence(entry.sources, declaration)
        for (const relationship of relationships) {
          sourceEvidence(relationship.sources, declaration)
          const anchor = requireRecord(relationship.anchor, 'membership anchor')
          if (!text(anchor.id) || !text(anchor.type) || !text(anchor.name) ||
              !territories.some((reference) => reference.territoire === anchor.id && reference.type === anchor.type && reference.nom === anchor.name)) {
            throw new Error('Territoire ancre hors référentiel natif')
          }
        }
        for (const summary of summaries) {
          if (!text(summary.detail) || !Number.isSafeInteger(summary.anchor_count) || Number(summary.anchor_count) < 0) {
            throw new Error('Synthèse d’ancrage invalide')
          }
        }
        for (const sigle of SIGLES_PROGRAMMES) {
          const entry = entries.find((value) => value.detail === sigle)
          const matchedRelationships = relationships.filter((value) => value.detail === sigle)
          memberships.push({ territoire: String(territory.territory.id),
            type: territory.territory.type as 'commune' | 'epci', sigle,
            availability: territory.availability, member: territory.availability === 'no_record' || !entry ? null : true,
            rider: typeof entry?.rider === 'string' ? entry.rider : null,
            relationships: matchedRelationships, summaries: summaries.filter((value) => value.detail === sigle) })
        }
      }
      for (const entryValue of territory.entries) requireRecord(entryValue, 'collection entry')
    }
  } else if (shape === 'typed_reading') {
    if (!Array.isArray(data.territories)) throw new Error('Lectures typées natives absentes')
    const descriptor = isRecord(data.descriptor) ? data.descriptor : null
    const rateUnit = declaration.resource_id === 'demographie_selected_reading'
      ? descriptor?.rate_unit : undefined
    if (declaration.resource_id === 'demographie_selected_reading' && !text(rateUnit)) {
      throw new Error('Unité native des taux démographiques absente')
    }
    const bindings = matchedReadingBindings(declaration, readingParams)
    const nativeGroups = new Set(readingGroups(declaration))
    for (const candidate of data.territories) {
      const territory = requireRecord(candidate, 'typed-reading territory')
      if (!Array.isArray(territory.facts) || !isRecord(territory.territory)) throw new Error('Faits de lecture typée absents')
      for (const factValue of territory.facts) {
        const fact = requireRecord(factValue, 'typed-reading fact')
        if (!text(fact.groupe) || !nativeGroups.has(fact.groupe)) {
          throw new Error('Groupe de lecture typée hors de l’axe natif déclaré')
        }
        if (!text(fact.story_key)) throw new Error('Identité de lecture typée absente')
        const reading = bindings.find((entry) => entry.subgroup === fact.groupe)
        if (!reading) continue
        if (fact.status !== 'measured' && fact.status !== 'unavailable') {
          throw new Error('Statut natif de lecture typée invalide')
        }
        const source = fact.source ? [fact.source] : []
        const row: Record<string, unknown> = { territoire: territory.territory.id,
          type: territory.territory.type, theme: declaration.theme_id, story_key: fact.story_key,
          groupe: fact.groupe, status: fact.status, mapApiFact: true,
          ...(text(rateUnit) ? { nativeUnits: Object.fromEntries(reading.fields
            .filter((param) => param.startsWith('taux_')).map((param) => [param, rateUnit])) } : {}) }
        for (const param of reading.fields) {
          if (!declaration.fields.includes(param)) continue
          const value = fact[param]
          if (fact.status === 'measured' && finite(value)) {
            row[param] = value
          }
        }
        if (Object.keys(row).length > 4) {
          const primary = sourceEvidence(source, declaration)[0]!
          row.source_id = primary.sourceId
          row.vintage_id = primary.vintageId
          row.vintage_version = primary.version
          row.vintage_source = primary.source
          row.vintage_date_reference = primary.referenceDate
          row.vintage_date_publication = primary.publicationDate
          stories.push(row)
        }
      }
    }
  } else {
    throw new Error(`La forme ${shape} nécessite son adaptateur sémantique dédié`)
  }
  const axes: Record<string, string[]> = {}
  return { facts, stories, memberships, grants, declarations: [declaration], axes, identity: {
    contentVersion: data.content_version, referenceContentVersion: data.reference_content_version,
  }, identities: {}, nativeContracts: {} }
}

/** Producer-discovered cohort reads are budgeted by the API, not client chunks. */
export async function acquireMapThemeFacts(theme: Theme, level: TerritoireType,
  territories: readonly Territoire[], layerIndicatorIds: readonly string[],
  readingParams: readonly MapReadingBinding[] = [],
  onDiscovered?: (declarations: SemanticResourceDeclaration[]) => void,
  pages?: Partial<Record<string, IndicatorPageMetadata>>): Promise<MapSemanticFacts> {
  const catalogue = await chargerCatalogueRessources()
  const candidates = catalogue.filter((resource) => resource.theme_id === theme &&
    ((resource.resource_id === resource.indicator_id && layerIndicatorIds.includes(resource.resource_id)) ||
      matchedReadingBindings(resource, readingParams).length > 0 ||
      resource.shapes.includes('anchored_membership') || (theme === 'programmes' && resource.shapes.includes('ordered_series'))) &&
    resource.allowed_levels.includes(level) &&
    resource.target_kinds.includes('territory_cohort') && resource.intents.includes('facts') &&
      (resource.shapes.some((shape) => ['scalar', 'declared_profile', 'period_detail', 'anchored_membership', 'typed_reading', 'ordered_series'].includes(shape))))
    .filter((resource) => {
      // Selected-reading fields have their own declared numeric bindings. Map
      // policy applies to indicator resources, not to these semantic groups.
      if (resource.shapes.includes('typed_reading')) {
        if (!matchedReadingBindings(resource, readingParams).length) return false
        if (!readingGroups(resource).length || !resource.fields.length) {
          throw new PayloadError('validation', '/api/resources', `Les axes de lecture typée de « ${resource.resource_id} » sont mal déclarés.`)
        }
        return true
      }
      if (typeof resource.map_eligible !== 'boolean') {
        throw new PayloadError('validation', '/api/resources', `L’éligibilité carte de « ${resource.resource_id} » est mal déclarée.`)
      }
      return resource.map_eligible
    })
  onDiscovered?.(candidates)
  const output: MapSemanticFacts = { facts: [], stories: [], memberships: [], grants: [], declarations: [], axes: {},
    identity: { contentVersion: '', referenceContentVersion: '' }, identities: {}, nativeContracts: {} }
  if (!candidates.length) return output
  {
    const declarations = candidates
    const items: SemanticReadItem[] = declarations.map((resource) => ({ resource: resource.resource_id,
      // The standalone map reads the full all-Bretagne cohort: the filters are
      // declared explicitly null, mirroring the page-side scalar cohort reads
      // (itemScalaire) — never omitted.
      target: { kind: 'territory_cohort', type: level, department_id: null, epci_id: null },
      ...(resource.shapes.includes('anchored_membership') ? { fields: ['detail', 'label', 'rider', 'anchor_count', 'availability'] }
          : resource.shapes.includes('declared_profile') ? { fields: ['value'] }
          : resource.shapes.includes('typed_reading') ? { fields: resource.fields,
            coordinates: { groupe: matchedReadingBindings(resource, readingParams).map((binding) => binding.subgroup) } }
            : { fields: ['value'] }),
      intent: { kind: 'facts' } }))
    const responses = await lireRessourcesBatch(items)
    for (let index = 0; index < declarations.length; index++) {
      const admitted = factsCarteDepuisLectureCohorte(declarations[index]!, responses[index], territories, readingParams, pages)
      output.facts.push(...admitted.facts)
      output.stories.push(...admitted.stories)
      output.memberships.push(...admitted.memberships)
      output.grants.push(...admitted.grants)
      Object.assign(output.axes, admitted.axes)
      output.declarations.push(declarations[index]!)
      output.identities[declarations[index]!.indicator_id] = admitted.identity
      Object.assign(output.nativeContracts, admitted.nativeContracts)
      if (output.identity.referenceContentVersion && output.identity.referenceContentVersion !== admitted.identity.referenceContentVersion) {
        throw new Error('Les ressources natives de la carte utilisent des référentiels différents')
      }
      output.identity.referenceContentVersion = admitted.identity.referenceContentVersion
      output.identity.contentVersion += `${output.identity.contentVersion ? ',' : ''}${declarations[index]!.resource_id}:${admitted.identity.contentVersion}`
    }
  }
  return output
}
