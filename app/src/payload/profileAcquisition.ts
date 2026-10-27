import type { Indicateur, NativeThemeFactAxis, NativeThemeFactContract, Territoire, TerritoireType, Theme } from './types'
import { THEMES_CANONIQUES } from './types'
import type { SemanticResourceDeclaration } from './semanticResourceClient'
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
