import type { IndicatorPageMetadata, Indicateur, NativeThemeFactAxis, NativeThemeFactContract,
  Territoire, TerritoireType, Theme } from './types'
import { THEMES_CANONIQUES } from './types'
import type { SemanticResourceDeclaration } from './semanticResourceClient'
import { lireRessourcesBatch } from './semanticResourceClient'
import { PayloadError } from './validate'

type Row = Record<string, unknown>

const isRecord = (value: unknown): value is Row => typeof value === 'object' && value !== null && !Array.isArray(value)
const isText = (value: unknown): value is string => typeof value === 'string'
const isNonEmptyText = (value: unknown): value is string => isText(value) && value.length > 0
const isFinite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const isDate = (value: unknown): value is string | null => value === null || isText(value)
const PROFILE_STATUSES = ['measured', 'not_available', 'suppressed', 'unsupported'] as const
type ProfileStatus = (typeof PROFILE_STATUSES)[number]

export interface ProfileTarget {
  type: TerritoireType
  department_id: string | null
  epci_id: string | null
}

export interface ProfileAxis {
  name: 'detail' | 'sex'
  key: string
  label: string
  order: number
  unit: string | null
}

export interface DeclaredProfileDescriptor {
  indicator: string
  label: string
  unit: string
  allowed_levels: TerritoireType[]
  completeness: 'sparse' | 'dense_complete'
  descriptor_version: string
  denominator_semantics: string
  comparison_scalar: string | null
  required_scalar_version: string | null
  comparison_point: { detail: string; sex: string | null; direction: 'high' | 'low'; unit: string } | null
  axes: ProfileAxis[]
}

export interface ProfilePublicationIdentity {
  contentVersion: string
  referenceContentVersion: string
}

export interface ProfileCohortResult {
  facts: Indicateur[]
  descriptor: DeclaredProfileDescriptor
  identity: ProfilePublicationIdentity
  memberIds: string[]
}

export interface ProfileComparison {
  status: 'available' | 'unavailable'
  reason: string | null
  median: number | null
  rank: number | null
  rankSize: number | null
  rankTies: number | null
  memberRanks: Array<{ territoryId: string; rank: number | null; rankSize: number | null; rankTies: number | null }>
  selectedMemberCount: number
  eligibleCount: number
  missingCount: number | null
  focalInSelection: boolean
  unit: string
  direction: 'high' | 'low'
  facet: { detail: string; sex: string | null } | string
  comparisonSources: Array<{ sourceId: string; name: string; vintageId: string; version: string;
    referenceDate: string | null; publicationDate: string | null }>
  contentVersion: null
  profileContentVersion: string
  referenceContentVersion: string
  scalarContentVersion: string | null
}

export interface ProfilePageBinding {
  page: IndicatorPageMetadata
  detailLabels: Record<string, string>
}

export interface LinkedScalarCohortResult {
  facts: Indicateur[]
  contentVersion: string
  referenceContentVersion: string
  descriptorVersion: string
}

function fail(message: string): never {
  throw new PayloadError('validation', '/api/resources/read-batch', message)
}

function sameNullable(actual: unknown, expected: string | null): boolean {
  return (actual === undefined || actual === null ? null : actual) === expected
}

function expectedTarget(target: ProfileTarget): { type: TerritoireType; department: string | null; epci: string | null } {
  return {
    type: target.type,
    department: target.type === 'commune' ? target.department_id : null,
    epci: target.type === 'commune' ? target.epci_id : null,
  }
}

function sourcesForCell(value: unknown, declaration: SemanticResourceDeclaration) {
  if (!Array.isArray(value) || value.length === 0) fail('La provenance d’une cellule de profil est absente.')
  const allowed = new Set(declaration.sources)
  const seen = new Set<string>()
  const sources = value.map((candidate) => {
    if (!isRecord(candidate) || !isNonEmptyText(candidate.source_id) || !allowed.has(candidate.source_id) ||
        !isNonEmptyText(candidate.vintage_id) || !isNonEmptyText(candidate.name) ||
        !isNonEmptyText(candidate.version) || !isDate(candidate.reference_date) ||
        !isDate(candidate.publication_date)) {
      fail('La provenance d’une cellule de profil ne correspond pas aux sources déclarées.')
    }
    const key = `${candidate.source_id}\u0000${candidate.vintage_id}`
    if (seen.has(key)) fail('La provenance d’une cellule de profil contient une source dupliquée.')
    seen.add(key)
    return {
      sourceId: candidate.source_id,
      source: candidate.name,
      version: candidate.version,
      vintageId: candidate.vintage_id,
      referenceDate: candidate.reference_date,
      publicationDate: candidate.publication_date,
      lineage: { ...candidate },
    }
  })
  return sources
}

function parseDescriptor(value: unknown, declaration: SemanticResourceDeclaration, level: TerritoireType,
  contentVersion: string, referenceVersion: string): DeclaredProfileDescriptor {
  if (!isRecord(value) || value.indicator !== declaration.indicator_id || !isNonEmptyText(value.label) ||
      !isNonEmptyText(value.unit) || !Array.isArray(value.allowed_levels) ||
      !value.allowed_levels.includes(level) || !['sparse', 'dense_complete'].includes(String(value.completeness)) ||
      !isNonEmptyText(value.descriptor_version) || !isNonEmptyText(value.denominator_semantics) ||
      !(value.comparison_scalar === null || isNonEmptyText(value.comparison_scalar)) ||
      !(value.required_scalar_version === null || isNonEmptyText(value.required_scalar_version)) ||
      !Array.isArray(value.axes)) {
    return fail('Le descripteur natif du profil déclaré est absent ou incompatible.')
  }
  if ((value.comparison_scalar === null) !== (value.required_scalar_version === null)) {
    return fail('La dépendance scalaire du profil déclaré est incomplète.')
  }

  const axes: ProfileAxis[] = []
  const keys = new Set<string>()
  const valuesByAxis = new Map<string, string[]>()
  for (const candidate of value.axes) {
    if (!isRecord(candidate) || (candidate.name !== 'detail' && candidate.name !== 'sex') ||
        !isNonEmptyText(candidate.key) || !isNonEmptyText(candidate.label) ||
        !Number.isSafeInteger(candidate.order) || (candidate.order as number) < 0 ||
        !(candidate.unit === null || isNonEmptyText(candidate.unit))) {
      return fail('Un axe du profil déclaré est mal formé.')
    }
    const identity = `${candidate.name}\u0000${candidate.key}`
    if (keys.has(identity)) return fail('Le profil déclaré contient un axe dupliqué.')
    keys.add(identity)
    const current = valuesByAxis.get(candidate.name) ?? []
    if ((candidate.order as number) !== current.length) return fail('L’ordre natif des axes du profil est discontinu.')
    current.push(candidate.key)
    valuesByAxis.set(candidate.name, current)
    axes.push({ name: candidate.name, key: candidate.key, label: candidate.label,
      order: candidate.order as number, unit: candidate.unit as string | null })
  }
  if (!valuesByAxis.has('detail') || axes.length !== keys.size ||
      axes.some((axis) => !declaration.axes?.includes(axis.name))) {
    return fail('Les axes natifs du profil ne correspondent pas à la déclaration de ressource.')
  }
  for (const [name, values] of declaration.axis_values ?? []) {
    if (JSON.stringify(valuesByAxis.get(name) ?? []) !== JSON.stringify(values)) {
      return fail('Le domaine natif du profil diffère de la déclaration de ressource.')
    }
  }
  if ((declaration.axis_values ?? []).some(([name]) => !valuesByAxis.has(name))) {
    return fail('Un domaine déclaré est absent du descripteur natif du profil.')
  }

  let comparisonPoint: DeclaredProfileDescriptor['comparison_point'] = null
  if (value.comparison_point !== null) {
    const point = value.comparison_point
    if (!isRecord(point) || !isNonEmptyText(point.detail) ||
        !(point.sex === null || isNonEmptyText(point.sex)) ||
        (point.direction !== 'high' && point.direction !== 'low') || !isNonEmptyText(point.unit) ||
        !valuesByAxis.get('detail')?.includes(point.detail) ||
        (valuesByAxis.has('sex') ? !valuesByAxis.get('sex')?.includes(point.sex as string) : point.sex !== null) ||
        axes.find((axis) => axis.name === 'detail' && axis.key === point.detail)?.unit !== point.unit) {
      return fail('La facette de comparaison native du profil est incompatible avec ses axes.')
    }
    comparisonPoint = { detail: point.detail, sex: point.sex as string | null,
      direction: point.direction, unit: point.unit }
  } else if (value.comparison_scalar === null) {
    return fail('Le profil sans facette scalaire ne déclare aucun point de comparaison.')
  }

  if (declaration.target_kinds.includes('territory_cohort') === false ||
      declaration.intents.includes('facts') === false || !declaration.fields.includes('value')) {
    return fail('La ressource du profil ne déclare pas la lecture de faits en cohort.')
  }
  if (!isNonEmptyText(contentVersion) || !isNonEmptyText(referenceVersion)) {
    return fail('Les versions de publication du profil sont absentes.')
  }

  return {
    indicator: declaration.indicator_id,
    label: value.label,
    unit: value.unit,
    allowed_levels: value.allowed_levels as TerritoireType[],
    completeness: value.completeness as DeclaredProfileDescriptor['completeness'],
    descriptor_version: value.descriptor_version,
    denominator_semantics: value.denominator_semantics,
    comparison_scalar: value.comparison_scalar as string | null,
    required_scalar_version: value.required_scalar_version as string | null,
    comparison_point: comparisonPoint,
    axes,
  }
}

function requireProfileDeclaration(declaration: SemanticResourceDeclaration | undefined,
  expected: { theme: string; indicator: string; level: TerritoireType }): SemanticResourceDeclaration {
  if (!declaration || declaration.resource_id !== expected.indicator ||
      declaration.indicator_id !== expected.indicator || declaration.theme_id !== expected.theme ||
      !declaration.shapes.includes('declared_profile') || !declaration.target_kinds.includes('territory_cohort') ||
      !declaration.allowed_levels.includes(expected.level) || !declaration.intents.includes('facts')) {
    return fail('La ressource sémantique ne déclare pas ce profil, ce thème et ce niveau.')
  }
  return declaration
}

function rows(value: unknown): Row[] {
  if (!Array.isArray(value) || value.some((item) => !isRecord(item))) {
    return fail('Les lignes du cohort de profils sont mal formées.')
  }
  return value
}

function nativeFactContract(descriptor: DeclaredProfileDescriptor, identity: ProfilePublicationIdentity): NativeThemeFactContract {
  return {
    label: descriptor.label,
    direction: descriptor.comparison_point?.direction,
    shapes: ['declared_profile'],
    axes: descriptor.axes.map((axis): NativeThemeFactAxis => ({ ...axis })),
    completeness: descriptor.completeness,
    denominatorSemantics: descriptor.denominator_semantics,
    descriptorVersion: descriptor.descriptor_version,
    contentVersion: identity.contentVersion,
    referenceContentVersion: identity.referenceContentVersion,
    comparisonPoint: descriptor.comparison_point,
  }
}

function statusRider(status: ProfileStatus): string | null {
  if (status === 'suppressed') return 'Valeur masquée selon les règles de diffusion.'
  if (status === 'unsupported') return 'Valeur non prise en charge pour ce territoire.'
  if (status === 'not_available') return 'Valeur non disponible.'
  return null
}

/** Validate and project the actual semantic declared-profile cohort contract. */
export function adapterProfilDeclare(input: {
  declaration?: SemanticResourceDeclaration
  target: ProfileTarget
  territories: Territoire[]
  cohort: unknown
}): ProfileCohortResult {
  const { target, territories } = input
  if (!(THEMES_CANONIQUES as readonly string[]).includes(input.declaration?.theme_id ?? '')) {
    return fail('Le thème de la ressource du profil n’est pas canonique.')
  }
  const declaration = requireProfileDeclaration(input.declaration, {
    theme: input.declaration?.theme_id ?? '', indicator: input.declaration?.indicator_id ?? '', level: target.type,
  })
  const expectedFilters = expectedTarget(target)
  const raw = input.cohort
  if (!isRecord(raw) || raw.resource !== declaration.resource_id || raw.shape !== 'declared_profile' ||
      !isRecord(raw.target) || raw.target.kind !== 'territory_cohort' || raw.target.type !== expectedFilters.type ||
      !sameNullable(raw.target.department_id, expectedFilters.department) ||
      !sameNullable(raw.target.epci_id, expectedFilters.epci) ||
      !isNonEmptyText(raw.content_version) || !isNonEmptyText(raw.reference_content_version) ||
      !isRecord(raw.cohort) || !Array.isArray(raw.profiles)) {
    return fail('L’enveloppe du cohort de profils ne correspond pas à la cible demandée.')
  }
  const cohort = raw.cohort
  if (cohort.territory_type !== target.type || !sameNullable(cohort.department_id, expectedFilters.department) ||
      !sameNullable(cohort.epci_id, expectedFilters.epci) || !Array.isArray(cohort.members) ||
      !Number.isSafeInteger(cohort.member_count) || cohort.member_count !== cohort.members.length ||
      !isNonEmptyText(cohort.reference_content_version) ||
      cohort.reference_content_version !== raw.reference_content_version) {
    return fail('L’identité, les filtres ou la version de référence du cohort de profils sont incompatibles.')
  }

  const descriptor = parseDescriptor(raw.descriptor, declaration, target.type,
    raw.content_version, raw.reference_content_version)
  const refs = new Map(territories.filter((territory) => territory.type === target.type)
    .map((territory) => [`${territory.type}\u0000${territory.territoire}`, territory]))
  const expectedMembers = [...refs.values()].filter((territory) =>
    (!expectedFilters.department || territory.departement === expectedFilters.department) &&
    (!expectedFilters.epci || territory.epci === expectedFilters.epci))
  const members = new Map<string, Territoire>()
  for (const candidate of rows(cohort.members)) {
    if (!isNonEmptyText(candidate.id) || candidate.type !== target.type || !isText(candidate.name)) {
      return fail('Un membre du cohort de profils est mal formé.')
    }
    const identity = `${candidate.type}\u0000${candidate.id}`
    const reference = refs.get(identity)
    if (!reference || reference.nom !== candidate.name || members.has(candidate.id) ||
        (expectedFilters.department && reference.departement !== expectedFilters.department) ||
        (expectedFilters.epci && reference.epci !== expectedFilters.epci)) {
      return fail('Le cohort de profils contient un membre dupliqué, inconnu ou hors filtres.')
    }
    members.set(candidate.id, reference)
  }
  if (members.size !== expectedMembers.length || expectedMembers.some((member) => !members.has(member.territoire))) {
    return fail('Les membres du cohort de profils ne correspondent pas exactement au référentiel et aux filtres.')
  }

  const profileRows = rows(raw.profiles)
  if (profileRows.length !== members.size) return fail('Le cohort de profils ne contient pas un profil par membre.')
  const axisDetails = descriptor.axes.filter((axis) => axis.name === 'detail')
  const axisSexes = descriptor.axes.filter((axis) => axis.name === 'sex')
  const sexKeys = axisSexes.length ? axisSexes.map((axis) => axis.key) : [null]
  const expectedCells = new Set(axisDetails.flatMap((detail) => sexKeys.map((sex) => `${detail.key}\u0000${sex ?? ''}`)))
  if (!expectedCells.size) return fail('Le profil déclaré ne contient aucun détail natif.')
  const identity: ProfilePublicationIdentity = {
    contentVersion: raw.content_version,
    referenceContentVersion: raw.reference_content_version,
  }
  const nativeContract = nativeFactContract(descriptor, identity)
  const facts: Indicateur[] = []
  const seenMembers = new Set<string>()
  for (const profile of profileRows) {
    if (!isRecord(profile.territory) || !isNonEmptyText(profile.territory.id) ||
        profile.territory.type !== target.type || !isText(profile.territory.name) ||
        !Array.isArray(profile.cells)) {
      return fail('Un profil territorial du cohort est mal formé.')
    }
    const territoryId = profile.territory.id
    const territory = members.get(territoryId)
    if (!territory || territory.nom !== profile.territory.name || seenMembers.has(territoryId)) {
      return fail('Un profil territorial est dupliqué ou absent du cohort demandé.')
    }
    seenMembers.add(territoryId)
    const cells = rows(profile.cells)
    const seenCells = new Set<string>()
    for (const cell of cells) {
      const detail = cell.detail
      const sex = cell.sex === undefined ? null : cell.sex
      if (!isNonEmptyText(detail) || !(sex === null || isNonEmptyText(sex)) ||
          !isNonEmptyText(cell.unit) || cell.unit !== axisDetails.find((axis) => axis.key === detail)?.unit ||
          cell.denominator_semantics !== descriptor.denominator_semantics ||
          !PROFILE_STATUSES.includes(cell.status as ProfileStatus) || !('value' in cell)) {
        return fail('Une cellule du profil ne correspond pas aux axes, unités ou statut déclarés.')
      }
      if ((axisSexes.length === 0 && sex !== null) || (axisSexes.length > 0 && !sexKeys.some((key) => key === sex))) {
        return fail('Une cellule du profil porte une coordonnée de sexe non déclarée.')
      }
      const cellKey = `${detail}\u0000${sex ?? ''}`
      const status = cell.status as ProfileStatus
      if (!expectedCells.has(cellKey) || seenCells.has(cellKey) ||
          (status === 'measured' ? !isFinite(cell.value) : cell.value !== undefined && cell.value !== null)) {
        return fail('Une cellule de profil est dupliquée, inconnue ou incompatible avec son statut.')
      }
      seenCells.add(cellKey)
      const provenance = sourcesForCell(cell.sources, declaration)
      const primary = provenance[0]!
      facts.push({
        territoire: territoryId,
        type: target.type,
        theme: declaration.theme_id as Theme,
        key: declaration.indicator_id,
        detail,
        sex: sex as Indicateur['sex'],
        value: status === 'measured' ? cell.value as number : null,
        unit: cell.unit,
        fact_status: status,
        observation_status: status === 'measured' ? 'measured' : 'missing',
        rider: statusRider(status),
        denominator_semantics: descriptor.denominator_semantics,
        nativeContract,
        vintage_source: primary.source,
        vintage_version: primary.version,
        vintage_date_reference: primary.referenceDate,
        vintage_date_publication: primary.publicationDate,
        source_id: primary.sourceId,
        vintage_id: primary.vintageId,
        fact_sources: provenance.map(({ sourceId, source: sourceName, version, vintageId, referenceDate, publicationDate, lineage }) =>
          ({ sourceId, source: sourceName, version, vintageId, referenceDate, publicationDate, lineage })),
        rang_epci: null, rang_epci_n: null, rang_dep: null, rang_dep_n: null, rang_reg: null, rang_reg_n: null,
      })
    }
    if (descriptor.completeness === 'dense_complete' && seenCells.size !== expectedCells.size) {
      return fail('Le profil dense est incomplet : une cellule native manque.')
    }
  }
  if (seenMembers.size !== members.size) return fail('Le cohort de profils omet un membre déclaré.')
  if (descriptor.completeness !== 'sparse' && descriptor.completeness !== 'dense_complete') {
    return fail('La complétude du profil déclaré est inconnue.')
  }
  if (facts.length === 0 && descriptor.completeness === 'dense_complete' && members.size > 0) {
    return fail('Le profil dense ne fournit aucune cellule factuelle.')
  }
  if (facts.some((fact) => !fact.fact_sources?.length)) return fail('Une cellule du profil est dépourvue de provenance.')
  if (declaration.target_kinds.includes('territory') && !declaration.fields.length) {
    return fail('La déclaration des faits du profil est vide.')
  }
  return { facts, descriptor, identity, memberIds: [...members.keys()] }
}

/** Validate a bounded focal-only profile read when the URL focal is outside its comparison cohort. */
export function adapterProfilFocalDeclare(input: {
  declaration: SemanticResourceDeclaration
  descriptor: DeclaredProfileDescriptor
  identity: ProfilePublicationIdentity
  focal: { type: TerritoireType; id: string }
  territories: Territoire[]
  result: unknown
}): Indicateur[] {
  const { declaration, descriptor, identity, focal } = input
  const territory = input.territories.find((candidate) => candidate.type === focal.type && candidate.territoire === focal.id)
  const raw = input.result
  if (!territory || !declaration.target_kinds.includes('territory') ||
      !declaration.intents.includes('facts') || !declaration.fields.includes('value') ||
      !isRecord(raw) || raw.resource !== declaration.resource_id || !isRecord(raw.target) ||
      raw.target.kind !== 'territory' || raw.target.type !== focal.type || raw.target.id !== focal.id ||
      raw.content_version !== identity.contentVersion || raw.reference_content_version !== identity.referenceContentVersion ||
      !isRecord(raw.descriptor) || !Array.isArray(raw.observations)) {
    return fail('La lecture focale du profil ne correspond pas au territoire ou à la publication du cohort.')
  }
  const focalDescriptor = parseDescriptor({ ...raw.descriptor, completeness: descriptor.completeness },
    declaration, focal.type, identity.contentVersion, identity.referenceContentVersion)
  if (JSON.stringify(focalDescriptor) !== JSON.stringify(descriptor)) {
    return fail('Le descripteur de la lecture focale diffère du cohort de profils acquis.')
  }
  const member = { id: focal.id, type: focal.type, name: territory.nom }
  const cohort = {
    resource: declaration.resource_id,
    shape: 'declared_profile',
    target: { kind: 'territory_cohort', type: focal.type, department_id: null, epci_id: null },
    content_version: identity.contentVersion,
    reference_content_version: identity.referenceContentVersion,
    descriptor: { ...raw.descriptor, completeness: descriptor.completeness },
    cohort: { territory_type: focal.type, department_id: null, epci_id: null,
      member_count: 1, members: [member], reference_content_version: identity.referenceContentVersion },
    profiles: [{ territory: { id: focal.id, type: focal.type, name: territory.nom }, cells: raw.observations }],
  }
  return adapterProfilDeclare({ declaration, target: { type: focal.type, department_id: null, epci_id: null },
    territories: [territory], cohort }).facts
}

/** One focal read is allowed when the requested territory is not a cohort member; no per-member fan-out. */
export async function chargerFaitFocalProfilDeclare(input: {
  declaration: SemanticResourceDeclaration
  descriptor: DeclaredProfileDescriptor
  identity: ProfilePublicationIdentity
  focal: { type: TerritoireType; id: string }
  territories: Territoire[]
}): Promise<Indicateur[]> {
  const { declaration, focal, territories } = input
  const resource = requireProfileDeclaration(declaration, {
    theme: declaration.theme_id, indicator: declaration.indicator_id, level: focal.type,
  })
  if (!resource.target_kinds.includes('territory')) return fail('La ressource du profil ne déclare pas de lecture focale.')
  const [data] = await lireRessourcesBatch([{
    resource: resource.resource_id,
    target: { kind: 'territory', type: focal.type, id: focal.id },
    fields: ['value'], intent: { kind: 'facts' },
  }])
  return adapterProfilFocalDeclare({ ...input, territories, result: data })
}

function selectionIdentity(value: unknown): string[] {
  if (!Array.isArray(value)) return fail('La sélection de comparaison du profil est absente.')
  const identities = value.map((member) => {
    if (!isRecord(member) || member.territory_type === undefined || !isNonEmptyText(member.territory_id)) {
      return fail('Un membre de la comparaison du profil est mal formé.')
    }
    return `${member.territory_type}\u0000${member.territory_id}`
  })
  if (new Set(identities).size !== identities.length) return fail('La sélection de comparaison du profil est dupliquée.')
  return identities.sort()
}

function comparisonSources(value: unknown, declaration: SemanticResourceDeclaration) {
  if (!Array.isArray(value)) return fail('La provenance de la comparaison du profil est mal formée.')
  const allowed = new Set(declaration.sources)
  const seen = new Set<string>()
  return value.map((candidate) => {
    if (!isRecord(candidate) || !isNonEmptyText(candidate.source_id) || !allowed.has(candidate.source_id) ||
        !isNonEmptyText(candidate.name) || !isNonEmptyText(candidate.vintage_id) ||
        !isNonEmptyText(candidate.version) || !isDate(candidate.reference_date) ||
        !isDate(candidate.publication_date)) {
      return fail('La provenance de la comparaison ne correspond pas aux ressources déclarées.')
    }
    const key = `${candidate.source_id}\u0000${candidate.vintage_id}`
    if (seen.has(key)) return fail('La provenance de la comparaison contient une source dupliquée.')
    seen.add(key)
    return { sourceId: candidate.source_id, name: candidate.name, vintageId: candidate.vintage_id,
      version: candidate.version, referenceDate: candidate.reference_date,
      publicationDate: candidate.publication_date }
  })
}

/** Validate the API-owned comparison for exactly the selected profile coordinate and cohort. */
export function adapterProfilComparaison(input: {
  declaration: SemanticResourceDeclaration
  descriptor: DeclaredProfileDescriptor
  identity: ProfilePublicationIdentity
  focal: { type: TerritoireType; id: string }
  memberIds: string[]
  coordinate: { detail: string; sex: string | null } | null
  comparison: unknown
  scalarDeclaration?: SemanticResourceDeclaration
}): ProfileComparison {
  const { declaration, descriptor, identity, focal, memberIds, coordinate, scalarDeclaration } = input
  const raw = input.comparison
  if (!isRecord(raw) || raw.resource !== declaration.resource_id ||
      raw.contract !== 'indicator-comparison-v1' || raw.indicator_id !== declaration.indicator_id ||
      raw.shape !== 'profile' || !(raw.content_version === null || isNonEmptyText(raw.content_version)) ||
      raw.profile_content_version !== identity.contentVersion ||
      raw.reference_content_version !== identity.referenceContentVersion ||
      !isRecord(raw.target) || raw.target.kind !== 'territory' || raw.target.type !== focal.type ||
      raw.target.id !== focal.id || !isRecord(raw.scope) || raw.scope.kind !== 'explicit_selection' ||
      raw.scope.member_count !== memberIds.length) {
    return fail('La ressource ou les versions de la comparaison du profil ne correspondent pas aux faits acquis.')
  }
  const selected = selectionIdentity(raw.selection)
  const expectedSelection = memberIds.map((id) => `${focal.type}\u0000${id}`).sort()
  if (JSON.stringify(selected) !== JSON.stringify(expectedSelection)) {
    return fail('La sélection de comparaison ne correspond pas exactement au cohort de profils.')
  }
  const result = isRecord(raw.result) ? raw.result : null
  if (!result || result.indicator_id !== declaration.indicator_id ||
      (result.status !== 'available' && result.status !== 'unavailable') ||
      !(result.reason === null || isText(result.reason)) || result.statistic !== 'median' ||
      result.profile_descriptor_version !== descriptor.descriptor_version ||
      result.denominator_semantics !== descriptor.denominator_semantics ||
      result.focal_in_selection !== memberIds.includes(focal.id) ||
      !Number.isSafeInteger(result.selected_member_count) || result.selected_member_count !== memberIds.length ||
      !Number.isSafeInteger(result.eligible_count) || (result.eligible_count as number) < 0 ||
      (result.eligible_count as number) > memberIds.length ||
      !(result.missing_count === undefined || (Number.isSafeInteger(result.missing_count) &&
        result.missing_count === memberIds.length - (result.eligible_count as number)))) {
    return fail('Les effectifs ou l’état de la comparaison du profil sont incompatibles avec la sélection.')
  }

  let facet: ProfileComparison['facet']
  let unit: string
  let direction: 'high' | 'low'
  let sourceDeclaration = declaration
  if (descriptor.comparison_scalar) {
    if (coordinate !== null || !scalarDeclaration ||
        scalarDeclaration.resource_id !== descriptor.comparison_scalar ||
        scalarDeclaration.indicator_id !== descriptor.comparison_scalar ||
        scalarDeclaration.theme_id !== declaration.theme_id || !scalarDeclaration.shapes.includes('scalar') ||
        !scalarDeclaration.allowed_levels.includes(focal.type) ||
        !scalarDeclaration.intents.includes('selected_comparison') ||
        !scalarDeclaration.target_kinds.includes('territory') ||
        result.source_facet !== descriptor.comparison_scalar ||
        result.source_facet_indicator_id !== descriptor.comparison_scalar ||
        result.source_facet_label !== scalarDeclaration.label ||
        raw.scalar_content_version !== descriptor.required_scalar_version ||
        result.required_scalar_version !== descriptor.required_scalar_version ||
        !isNonEmptyText(result.scalar_descriptor_version)) {
      return fail('La facette scalaire liée au profil ne correspond pas à sa dépendance publiée.')
    }
    facet = descriptor.comparison_scalar
    unit = scalarDeclaration.unit
    direction = scalarDeclaration.direction as 'high' | 'low'
    sourceDeclaration = scalarDeclaration
  } else {
    const point = descriptor.comparison_point
    if (raw.scalar_content_version !== null || !coordinate || !point ||
        !descriptor.axes.some((axis) => axis.name === 'detail' && axis.key === coordinate.detail) ||
        (descriptor.axes.some((axis) => axis.name === 'sex')
          ? !descriptor.axes.some((axis) => axis.name === 'sex' && axis.key === coordinate.sex)
          : coordinate.sex !== null) ||
        !isRecord(result.source_facet) || result.source_facet.detail !== coordinate.detail ||
        !sameNullable(result.source_facet.sex, coordinate.sex) ||
        result.source_facet_indicator_id !== undefined ||
        result.unit !== descriptor.axes.find((axis) => axis.name === 'detail' && axis.key === coordinate.detail)?.unit ||
        result.direction !== point.direction) {
      return fail('La facette comparative ne correspond pas au détail et au sexe sélectionnés.')
    }
    facet = { ...coordinate }
    unit = result.unit as string
    direction = result.direction as 'high' | 'low'
  }
  if ((direction !== 'high' && direction !== 'low') || result.unit !== unit || !isNonEmptyText(unit) ||
      result.direction !== direction || !isNonEmptyText(result.source_facet_label ?? declaration.label)) {
    return fail('L’unité ou la direction de la comparaison ne correspond pas à sa facette native.')
  }

  const median = result.median
  const rank = result.rank
  const rankSize = result.rank_size
  const rankTies = result.rank_ties
  const available = result.status === 'available'
  if (result.missing_count !== undefined && result.missing_count !== memberIds.length - (result.eligible_count as number) ||
      (available ? !isFinite(median) || (result.eligible_count as number) < 2 : median !== null) ||
       (rank === null ? rankSize !== null || rankTies !== null
         : !Number.isSafeInteger(rank) || !Number.isSafeInteger(rankSize) || !Number.isSafeInteger(rankTies) ||
           (rank as number) < 1 || (rank as number) > (rankSize as number) ||
           rankSize !== result.eligible_count || (rankTies as number) < 1 ||
           (rankTies as number) > (rankSize as number) ||
           (rank as number) + (rankTies as number) > (rankSize as number) + 1)) {
    return fail('La médiane ou le rang de comparaison du profil est incohérent.')
  }
  if (!Array.isArray(result.member_ranks)) return fail('Les rangs des membres du cohort sont absents de la comparaison native.')
  const memberRanks = result.member_ranks.map((candidate) => {
    if (!isRecord(candidate) || !isNonEmptyText(candidate.territory_id) ||
        !(candidate.rank === null || Number.isSafeInteger(candidate.rank)) ||
        !(candidate.rank_size === null || Number.isSafeInteger(candidate.rank_size)) ||
        !(candidate.rank_ties === null || Number.isSafeInteger(candidate.rank_ties)) ||
        (candidate.rank === null
          ? candidate.rank_size !== null || candidate.rank_ties !== null
           : (candidate.rank as number) < 1 || candidate.rank_size !== result.eligible_count ||
             (candidate.rank_ties as number) < 1 || (candidate.rank as number) > (candidate.rank_size as number) ||
             (candidate.rank_ties as number) > (candidate.rank_size as number) ||
             (candidate.rank as number) + (candidate.rank_ties as number) > (candidate.rank_size as number) + 1)) {
      return fail('Un rang individuel de comparaison est mal formé ou incohérent avec les effectifs.')
    }
    return { territoryId: candidate.territory_id, rank: candidate.rank as number | null,
      rankSize: candidate.rank_size as number | null, rankTies: candidate.rank_ties as number | null }
  })
  if (new Set(memberRanks.map(({ territoryId }) => territoryId)).size !== memberRanks.length ||
      JSON.stringify(memberRanks.map(({ territoryId }) => territoryId).sort()) !== JSON.stringify([...memberIds].sort())) {
    return fail('Les rangs individuels ne couvrent pas exactement les membres sélectionnés.')
  }
  if (!Array.isArray(result.comparison_sources) || (available && result.comparison_sources.length === 0)) {
    return fail('La provenance de la comparaison publiée est absente.')
  }
  const sources = comparisonSources(result.comparison_sources, sourceDeclaration)
  const pointFacet = typeof facet === 'string' ? facet : facet.detail
  return {
    status: result.status,
    reason: result.reason as string | null,
    median: median === null ? null : median as number,
    rank: rank === null ? null : rank as number,
    rankSize: rankSize === null ? null : rankSize as number,
    rankTies: rankTies === null ? null : rankTies as number,
    memberRanks,
    selectedMemberCount: result.selected_member_count as number,
    eligibleCount: result.eligible_count as number,
    missingCount: result.missing_count === undefined ? null : result.missing_count as number,
    focalInSelection: result.focal_in_selection,
    unit,
    direction,
    facet: typeof facet === 'string' ? facet : { detail: pointFacet, sex: facet.sex },
    comparisonSources: sources,
    contentVersion: null,
    profileContentVersion: raw.profile_content_version,
    referenceContentVersion: raw.reference_content_version,
    scalarContentVersion: raw.scalar_content_version === null || raw.scalar_content_version === undefined
      ? null : raw.scalar_content_version as string,
  }
}

/** Acquire facts for one selected profile resource and bounded territory cohort. */
export async function chargerCohorteProfilDeclare(declaration: SemanticResourceDeclaration,
  target: ProfileTarget, territories: Territoire[]): Promise<ProfileCohortResult> {
  const resource = requireProfileDeclaration(declaration, {
    theme: declaration.theme_id, indicator: declaration.indicator_id, level: target.type,
  })
  const filters = expectedTarget(target)
  const [data] = await lireRessourcesBatch([{
    resource: resource.resource_id,
    target: { kind: 'territory_cohort', type: target.type,
      department_id: filters.department, epci_id: filters.epci },
    fields: ['value'], intent: { kind: 'facts' },
  }])
  return adapterProfilDeclare({ declaration: resource, target, territories, cohort: data })
}

/** Read a producer-declared scalar companion (for example DPE passoires) without
 * making it part of the profile-bin facts or tying it to the scalar rollout flag. */
export async function chargerCohorteScalaireLiee(input: {
  profileDeclaration: SemanticResourceDeclaration
  declaration: SemanticResourceDeclaration
  target: ProfileTarget
  territories: Territoire[]
  profileDescriptor: DeclaredProfileDescriptor
  profileIdentity: ProfilePublicationIdentity
}): Promise<LinkedScalarCohortResult> {
  const { profileDeclaration, declaration, target, territories, profileDescriptor, profileIdentity } = input
  const resource = declaration
  if (!profileDescriptor.comparison_scalar || resource.resource_id !== profileDescriptor.comparison_scalar ||
      resource.indicator_id !== profileDescriptor.comparison_scalar || resource.theme_id !== profileDeclaration.theme_id ||
      !profileDeclaration.shapes.includes('declared_profile') || profileDeclaration.indicator_id !== profileDescriptor.indicator ||
      !resource.shapes.includes('scalar') || !resource.target_kinds.includes('territory_cohort') ||
      !resource.allowed_levels.includes(target.type) || !resource.intents.includes('facts') ||
      !['value', 'support_count', 'denominator_count'].every((field) => resource.fields.includes(field))) {
    return fail('La ressource scalaire liée au profil n’est pas déclarée pour cette lecture.')
  }
  const filters = expectedTarget(target)
  const [data] = await lireRessourcesBatch([{
    resource: resource.resource_id,
    target: { kind: 'territory_cohort', type: target.type,
      department_id: filters.department, epci_id: filters.epci },
    fields: ['value', 'support_count', 'denominator_count'], intent: { kind: 'facts' },
  }])
  const raw = data!
  if (raw.resource !== resource.resource_id || raw.shape !== 'scalar' || !isRecord(raw.target) ||
      raw.target.kind !== 'territory_cohort' || raw.target.type !== target.type ||
      !sameNullable(raw.target.department_id, filters.department) || !sameNullable(raw.target.epci_id, filters.epci) ||
      !isRecord(raw.cohort) || raw.cohort.territory_type !== target.type ||
      !sameNullable(raw.cohort.department_id, filters.department) || !sameNullable(raw.cohort.epci_id, filters.epci) ||
      !Array.isArray(raw.cohort.members) || !Number.isSafeInteger(raw.cohort.member_count) ||
      raw.cohort.member_count !== raw.cohort.members.length || !isNonEmptyText(raw.content_version) ||
      raw.content_version !== profileDescriptor.required_scalar_version ||
      raw.reference_content_version !== profileIdentity.referenceContentVersion ||
      raw.cohort.reference_content_version !== raw.reference_content_version ||
      !isRecord(raw.descriptor) || raw.descriptor.indicator_id !== resource.indicator_id ||
      raw.descriptor.theme_id !== resource.theme_id || !isNonEmptyText(raw.descriptor.unit) ||
      !isNonEmptyText(raw.descriptor.label) || !isNonEmptyText(raw.descriptor.descriptor_version) ||
      raw.descriptor.unit !== resource.unit || raw.descriptor.direction !== resource.direction ||
      raw.descriptor.comparison_facet !== resource.indicator_id || !Array.isArray(raw.descriptor.allowed_levels) ||
      !raw.descriptor.allowed_levels.includes(target.type) || !['sparse', 'dense_complete'].includes(String(raw.descriptor.completeness)) ||
      !isNonEmptyText(raw.descriptor.denominator_semantics) || !Array.isArray(raw.observations)) {
    return fail('La publication ou le cohort de la ressource scalaire liée est incompatible avec le profil.')
  }
  const scalarDescriptor = raw.descriptor as Row
  const references = new Map(territories.filter((territory) => territory.type === target.type)
    .map((territory) => [territory.territoire, territory]))
  const expectedMembers = [...references.values()].filter((territory) =>
    (!filters.department || territory.departement === filters.department) &&
    (!filters.epci || territory.epci === filters.epci))
  const memberIds = new Set<string>()
  for (const candidate of rows(raw.cohort.members)) {
    if (!isNonEmptyText(candidate.id) || candidate.type !== target.type || !isText(candidate.name) ||
        memberIds.has(candidate.id) || references.get(candidate.id)?.nom !== candidate.name) {
      return fail('Un membre de la ressource scalaire liée est absent, dupliqué ou inconnu.')
    }
    const reference = references.get(candidate.id)!
    if ((filters.department && reference.departement !== filters.department) ||
        (filters.epci && reference.epci !== filters.epci)) return fail('Le cohort scalaire lié contient un membre hors filtres.')
    memberIds.add(candidate.id)
  }
  if (memberIds.size !== expectedMembers.length || expectedMembers.some((territory) => !memberIds.has(territory.territoire))) {
    return fail('Le cohort scalaire lié ne correspond pas exactement au référentiel filtré.')
  }
  const seen = new Set<string>()
  const allowedSources = new Set(resource.sources)
  const statusValues = ['measured', 'suppressed', 'unsupported', 'not_available', 'not_published']
  const facts = rows(raw.observations).map((observation): Indicateur => {
    if (!isRecord(observation) || !isRecord(observation.territory) ||
        !isNonEmptyText(observation.territory.id) || observation.territory.type !== target.type ||
        !isText(observation.territory.name) || !memberIds.has(observation.territory.id) ||
        references.get(observation.territory.id)?.nom !== observation.territory.name ||
        seen.has(observation.territory.id) || !statusValues.includes(String(observation.status)) ||
        !('value' in observation) || (observation.status === 'measured'
          ? !isFinite(observation.value) : observation.value !== null) ||
        !(observation.support_count === null || (Number.isSafeInteger(observation.support_count) &&
          (observation.support_count as number) >= 0)) ||
        !(observation.denominator_count === null || (Number.isSafeInteger(observation.denominator_count) &&
          (observation.denominator_count as number) >= 0))) {
      return fail('Une observation de la ressource scalaire liée est incohérente.')
    }
    const provenance = sourcesForCell(observation.sources, resource)
    seen.add(observation.territory.id)
    const primary = provenance[0]!
    return {
      territoire: observation.territory.id, type: target.type, theme: resource.theme_id as Theme,
      key: resource.indicator_id, detail: null,
      value: observation.status === 'measured' ? observation.value as number : null,
      unit: scalarDescriptor.unit as string,
      fact_status: observation.status as Indicateur['fact_status'],
      observation_status: observation.status === 'measured' ? 'measured' : 'missing',
      rider: observation.status === 'suppressed' ? 'Valeur masquée selon les règles de diffusion.'
        : observation.status === 'unsupported' ? 'Valeur non prise en charge pour ce territoire.'
          : observation.status === 'not_available' ? 'Valeur non disponible.'
            : observation.status === 'not_published' ? 'Valeur non publiée à ce niveau.' : null,
      support_count: observation.support_count as number | null,
      denominator_count: observation.denominator_count as number | null,
      nativeContract: { label: scalarDescriptor.label as string, direction: resource.direction,
        shapes: ['scalar'], descriptorVersion: scalarDescriptor.descriptor_version as string,
        contentVersion: raw.content_version as string, referenceContentVersion: raw.reference_content_version as string },
      vintage_source: primary.source, vintage_version: primary.version,
      vintage_date_reference: primary.referenceDate, vintage_date_publication: primary.publicationDate,
      source_id: primary.sourceId, vintage_id: primary.vintageId,
      fact_sources: provenance.map(({ sourceId, source: name, version, vintageId, referenceDate, publicationDate, lineage }) =>
        ({ sourceId, source: name, version, vintageId, referenceDate, publicationDate, lineage })),
      rang_epci: null, rang_epci_n: null, rang_dep: null, rang_dep_n: null, rang_reg: null, rang_reg_n: null,
    }
  })
  if (seen.size !== memberIds.size || facts.length !== memberIds.size ||
      (scalarDescriptor.completeness === 'dense_complete' && seen.size !== memberIds.size)) {
    return fail('La ressource scalaire dense ne couvre pas tous les membres du cohort.')
  }
  if (!allowedSources.size) return fail('La ressource scalaire liée ne déclare aucune provenance.')
  return { facts, contentVersion: raw.content_version, referenceContentVersion: raw.reference_content_version,
    descriptorVersion: scalarDescriptor.descriptor_version as string }
}

/** A comparison retry re-reads only this selected comparison, never profile facts. */
export async function chargerComparaisonProfilDeclare(input: {
  declaration: SemanticResourceDeclaration
  descriptor: DeclaredProfileDescriptor
  identity: ProfilePublicationIdentity
  focal: { type: TerritoireType; id: string }
  memberIds: string[]
  coordinate: { detail: string; sex: string | null } | null
  scalarDeclaration?: SemanticResourceDeclaration
}): Promise<ProfileComparison> {
  const { declaration, descriptor, focal, memberIds, coordinate, scalarDeclaration } = input
  if (!declaration.target_kinds.includes('territory') || !declaration.intents.includes('selected_comparison') ||
      !declaration.allowed_levels.includes(focal.type) || declaration.shapes.includes('declared_profile') === false ||
      (descriptor.comparison_scalar ? !scalarDeclaration : Boolean(scalarDeclaration))) {
    return fail('La ressource du profil ne déclare pas la comparaison demandée.')
  }
  const coordinates = coordinate === null ? undefined : {
    detail: [coordinate.detail],
    ...(coordinate.sex === null ? {} : { sex: [coordinate.sex] }),
  }
  const [data] = await lireRessourcesBatch([{
    resource: declaration.resource_id,
    target: { kind: 'territory', type: focal.type, id: focal.id },
    ...(coordinates ? { coordinates } : {}),
    fields: ['median', 'rank', 'rank_size', 'rank_ties', 'selected_member_count', 'eligible_count', 'missing_count', 'member_ranks'],
    intent: { kind: 'selected_comparison', members: memberIds.map((id) => ({ type: focal.type, id })) },
  }])
  return adapterProfilComparaison({ ...input, comparison: data })
}

/** Bind API-owned profile facts and facets to the retained app presentation family. */
export function adapterPageProfilDeclare(page: IndicatorPageMetadata,
  declaration: SemanticResourceDeclaration, descriptor: DeclaredProfileDescriptor,
  scalarDeclaration?: SemanticResourceDeclaration,
  selectedFacet: { detail?: string | null; sex?: string | null } = {}): ProfilePageBinding {
  if (page.indicator !== descriptor.indicator || declaration.indicator_id !== page.indicator ||
      !['composition', 'distribution', 'list', 'pyramid'].includes(page.family) ||
      !descriptor.allowed_levels.length) {
    return fail('La page éditoriale n’est pas compatible avec le profil déclaré par l’API.')
  }
  const levels = page.levels.filter((level) => descriptor.allowed_levels.includes(level))
  if (!levels.length) return fail('La page ne partage aucun niveau publié avec le profil déclaré.')
  const details = descriptor.axes.filter((axis) => axis.name === 'detail')
  const sexes = descriptor.axes.filter((axis) => axis.name === 'sex')
  const detailLabels = Object.fromEntries(details.map((axis) => [axis.key, axis.label]))
  const point = descriptor.comparison_point
  let comparison: IndicatorPageMetadata['comparison']
  if (descriptor.comparison_scalar) {
    if (!scalarDeclaration || scalarDeclaration.resource_id !== descriptor.comparison_scalar ||
        scalarDeclaration.theme_id !== declaration.theme_id || !scalarDeclaration.shapes.includes('scalar') ||
        !scalarDeclaration.target_kinds.includes('territory_cohort') ||
        !scalarDeclaration.allowed_levels.some((level) => levels.includes(level)) ||
        (scalarDeclaration.direction !== 'high' && scalarDeclaration.direction !== 'low')) {
      return fail('La facette scalaire liée au profil n’est pas déclarée pour sa page.')
    }
    comparison = {
      indicator: scalarDeclaration.indicator_id,
      label: scalarDeclaration.label,
      detail: null,
      sex: null,
      direction: scalarDeclaration.direction,
      unit: scalarDeclaration.unit,
    }
  } else {
    if (!point || (point.sex !== null && point.sex !== 'F' && point.sex !== 'M') ||
        (sexes.some((axis) => axis.key !== 'F' && axis.key !== 'M'))) {
      return fail('La facette du profil ne correspond pas aux dimensions de page actuellement prises en charge.')
    }
    const selectedDetail = selectedFacet.detail && details.some((axis) => axis.key === selectedFacet.detail)
      ? selectedFacet.detail : point.detail
    const selectedSex = selectedFacet.sex && sexes.some((axis) => axis.key === selectedFacet.sex)
      ? selectedFacet.sex : point.sex
    const selectedUnit = details.find((axis) => axis.key === selectedDetail)?.unit
    if (!selectedUnit) return fail('L’unité de la facette sélectionnée est absente du descripteur natif.')
    comparison = {
      indicator: declaration.indicator_id,
      detail: selectedDetail,
      details: details.map((axis) => axis.key),
      sex: selectedSex as 'F' | 'M' | null,
      sexes: sexes.length ? sexes.map((axis) => axis.key as 'F' | 'M') : undefined,
      direction: point.direction,
      unit: selectedUnit,
      labels: detailLabels,
    }
  }

  let adaptedPage: IndicatorPageMetadata = {
    ...page,
    label: descriptor.label,
    unit: point?.unit ?? scalarDeclaration?.unit ?? descriptor.unit,
    direction: point?.direction ?? (scalarDeclaration?.direction as 'high' | 'low'),
    levels,
    sources: [...declaration.sources],
    comparison,
  }
  switch (page.family) {
    case 'composition': {
      const parts = page.composition.parts
      if (parts.some((detail) => !details.some((axis) => axis.key === detail))) {
        return fail('La présentation de composition référence une catégorie absente du profil natif.')
      }
      adaptedPage = { ...adaptedPage, family: 'composition', composition: { parts: [...parts] } }
      break
    }
    case 'distribution':
      adaptedPage = { ...adaptedPage, family: 'distribution', distribution: { signature: details.map((axis) => axis.key) } }
      break
    case 'list':
      adaptedPage = { ...adaptedPage, family: 'list', list: { categories: details.map((axis) => axis.key) } }
      break
    case 'pyramid':
      adaptedPage = { ...adaptedPage, family: 'pyramid', pyramid: { dimensions: descriptor.axes.map((axis) => axis.name) } }
      break
    default:
      return fail('Famille de présentation non prise en charge pour un profil déclaré.')
  }
  return { page: adaptedPage, detailLabels }
}
