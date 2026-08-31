import type { DirectionRang } from '@/methodes/indicateurs'
import { THEMES_METHODES } from '@/methodes/indicateurs'
import type { HistoireMobilite, Indicateur, Payload, Territoire, TerritoireType } from '@/payload/types'

/** The availability of a normalized fact, independent of how a surface lays it out. */
export type FactAvailability = 'complete' | 'incomplete' | 'absent'

/** The source clock carried by one fact. No payload row is exposed to callers. */
export interface FactProvenance {
  sourceId: string | null
  source: string
  version: string
  referenceDate: string | null
  publicationDate: string | null
}

export type ComparisonScopeKind =
  | 'communes-epci'
  | 'communes-bretagne'
  | 'epcis-bretagne'
  | 'departements-bretagne'

/** The one peer universe used for both a fact's rank and its reference value. */
export interface ComparisonScope {
  kind: ComparisonScopeKind
  territoryIds: readonly string[]
}

export interface ComparisonRank {
  position: number
  size: number
}

export interface ComparisonReference {
  kind: 'median'
  value: number
}

export interface FactComparison {
  direction: DirectionRang
  scope: ComparisonScope
  rank: ComparisonRank | null
  reference: ComparisonReference | null
}

/** A numeric fact normalized away from the payload's row and rank columns. */
export interface NumericFact {
  key: string
  detail: string | null
  /** Payload-owned label when this fact is a published indicator. */
  label?: string | null
  value: number | null
  unit: string
  availability: FactAvailability
  provenance: FactProvenance | null
  comparison: FactComparison | null
  reason: string | null
}

export type MobiliteService =
  | 'administration'
  | 'alimentation'
  | 'sante'
  | 'banque'
  | 'ecole'

export type MobiliteAccessMode = 'car' | 'bike' | 'walkTransit'
type SourceAccessMode = 'c' | 'b' | 't'

/** Canonical labels for the three mobility modes used throughout the fiche. */
export const MOBILITE_MODE_LABELS: Readonly<Record<MobiliteAccessMode, string>> = {
  car: 'Voiture',
  bike: 'À vélo + TC',
  walkTransit: 'À pied + TC',
}

/** The smallest source contract needed by the facts adapter. */
export interface MobiliteAccessSnapshot {
  totalBatimentsBretons: number | null
  batimentsTerritoire: number | null
  parts: Partial<
    Record<MobiliteService, Partial<Record<SourceAccessMode, number | null>>>
  >
  provenance: FactProvenance
}

export type MobiliteAccessReader = (
  territoire: string,
) => MobiliteAccessSnapshot | null

export interface MobiliteAccessModes {
  car: NumericFact
  bike: NumericFact
  walkTransit: NumericFact
}

export interface MobiliteAccessFacts {
  availability: FactAvailability
  totalBuildings: NumericFact
  totalBrittanyBuildings: NumericFact
  byService: Record<MobiliteService, MobiliteAccessModes>
}

export interface MobiliteLossFacts {
  diversityWalkTransit: NumericFact
  diversityBike: NumericFact
  distributionWalkTransit: MobiliteDistributionSignature | null
  distributionPeers: readonly MobiliteDistributionPeer[]
}

/** The normalized building-level signature used by the Mobilité distribution figure. */
export interface MobiliteDistributionSignature {
  densities: readonly (number | null)[]
  quantiles: readonly (number | null)[]
  min: number | null
  max: number | null
}

/** One same-scope walk/transit value for the distribution context cloud. */
export interface MobiliteDistributionPeer {
  territoire: TerritoryIdentity
  value: number
}

export interface TerritoryIdentity {
  code: string
  type: TerritoireType
  name: string
  department: string | null
  epci: string | null
}

/**
 * The source identity remains the legal/reference name. Cahier prose uses the
 * public short name, so an EPCI reads “Lorient Agglomération”, not its legal
 * category prefix.
 */
export function nomTerritoirePourAffichage(territory: TerritoryIdentity): string {
  if (territory.type !== 'epci') return territory.name
  return territory.name
    .replace(/^CA\s+/i, '')
    .replace(/^Communauté d['’]agglomération\s+/i, '')
    .replace(/^Communauté de communes\s+/i, '')
    .replace(/^Métropole\s+/i, '')
    .trim()
}

export interface MobilityFacts {
  indicators: readonly NumericFact[]
  access: MobiliteAccessFacts
  losses: MobiliteLossFacts
}

/**
 * The target-scoped, presentation-neutral Mobilité facts result. The public
 * shape contains normalized facts only: no payload row, story-selection field,
 * or Vue presentation type crosses this seam.
 */
export interface TerritoryFacts {
  territory: TerritoryIdentity
  theme: 'mobilite'
  mobility: MobilityFacts
}

const SERVICES: readonly MobiliteService[] = [
  'administration',
  'alimentation',
  'sante',
  'banque',
  'ecole',
]

const ACCESS_MODES: Readonly<Record<MobiliteAccessMode, SourceAccessMode>> = {
  car: 'c',
  bike: 'b',
  walkTransit: 't',
}

const ACCESS_INDICATOR_KEYS: Readonly<
  Record<MobiliteService, Record<SourceAccessMode, string>>
> = {
  administration: {
    c: 'share_admin_c',
    b: 'share_admin_b',
    t: 'share_admin_t',
  },
  alimentation: {
    c: 'share_food_c',
    b: 'share_food_b',
    t: 'share_food_t',
  },
  sante: {
    c: 'share_health_c',
    b: 'share_health_b',
    t: 'share_health_t',
  },
  banque: {
    c: 'share_bank_c',
    b: 'share_bank_b',
    t: 'share_bank_t',
  },
  ecole: {
    c: 'share_school_c',
    b: 'share_school_b',
    t: 'share_school_t',
  },
}

const STORY_METRICS = {
  diversityWalkTransit: {
    key: 'div_loss_t',
    unit: 'types de services',
    read: (histoire: HistoireMobilite) => histoire.div_loss_t,
  },
  diversityBike: {
    key: 'div_loss_b',
    unit: 'types de services',
    read: (histoire: HistoireMobilite) => histoire.div_loss_b,
  },
} as const

function identityOf(territoire: Territoire): TerritoryIdentity {
  return {
    code: territoire.territoire,
    type: territoire.type,
    name: territoire.nom,
    department: territoire.departement,
    epci: territoire.epci,
  }
}

function availabilityOf(value: number | null, present: boolean): FactAvailability {
  if (!present) return 'absent'
  return value === null ? 'incomplete' : 'complete'
}

function factOf(options: {
  key: string
  detail?: string | null
  label?: string | null
  value: number | null
  unit: string
  present: boolean
  provenance?: FactProvenance | null
  comparison?: FactComparison | null
  reason?: string | null
}): NumericFact {
  return {
    key: options.key,
    detail: options.detail ?? null,
    label: options.label ?? null,
    value: options.value,
    unit: options.unit,
    availability: availabilityOf(options.value, options.present),
    provenance: options.present ? options.provenance ?? null : null,
    comparison: options.comparison ?? null,
    reason: options.reason ?? null,
  }
}

function provenanceFromRow(row: Indicateur, sourceId: string | null): FactProvenance {
  return {
    sourceId,
    source: row.vintage_source,
    version: row.vintage_version,
    referenceDate: row.vintage_date_reference,
    publicationDate: row.vintage_date_publication,
  }
}

function scopeFor(payload: Payload, target: Territoire): ComparisonScope | null {
  switch (target.type) {
    case 'commune': {
      if (target.epci) {
        return {
          kind: 'communes-epci',
          territoryIds: payload.territoires
            .filter((candidate) => candidate.type === 'commune' && candidate.epci === target.epci)
            .map((candidate) => candidate.territoire),
        }
      }
      return {
        kind: 'communes-bretagne',
        territoryIds: payload.territoires
          .filter((candidate) => candidate.type === 'commune')
          .map((candidate) => candidate.territoire),
      }
    }
    case 'epci':
      return {
        kind: 'epcis-bretagne',
        territoryIds: payload.territoires
          .filter((candidate) => candidate.type === 'epci')
          .map((candidate) => candidate.territoire),
      }
    case 'departement':
      return {
        kind: 'departements-bretagne',
        territoryIds: payload.territoires
          .filter((candidate) => candidate.type === 'departement')
          .map((candidate) => candidate.territoire),
      }
    case 'region':
      return null
  }
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 1) return sorted[middle] ?? null
  const lower = sorted[middle - 1]
  const upper = sorted[middle]
  return lower === undefined || upper === undefined ? null : (lower + upper) / 2
}

function comparisonOf(options: {
  scope: ComparisonScope | null
  direction: DirectionRang
  value: number | null
  values: readonly number[]
}): FactComparison | null {
  if (!options.scope) return null

  const referenceValue = median(options.values)
  const rank =
    options.value === null || options.values.length === 0
      ? null
      : {
          position:
            1 +
            options.values.filter((candidate) =>
              options.direction === 'moins-est-mieux'
                ? candidate < options.value!
                : candidate > options.value!,
            ).length,
          size: options.values.length,
        }

  return {
    direction: options.direction,
    scope: options.scope,
    rank,
    reference: referenceValue === null ? null : { kind: 'median', value: referenceValue },
  }
}

function sourceIdForIndicator(payload: Payload, key: string): string | null {
  return (
    payload.themeMetadata?.mobilite?.sources[key] ??
    THEMES_METHODES.mobilite.indicateurs[key]?.sourceId ??
    null
  )
}

function directionForIndicator(key: string): DirectionRang | null {
  return THEMES_METHODES.mobilite.indicateurs[key]?.direction ?? null
}

function indicatorComparison(
  payload: Payload,
  scope: ComparisonScope | null,
  row: Indicateur,
  direction: DirectionRang,
): FactComparison | null {
  const values = payload.indicateurs
    .filter(
      (candidate) =>
        candidate.theme === 'mobilite' &&
        candidate.key === row.key &&
        candidate.detail === row.detail &&
        (candidate.sex ?? null) === (row.sex ?? null) &&
        (candidate.dimension ?? null) === (row.dimension ?? null) &&
        scope !== null && scope.territoryIds.includes(candidate.territoire),
    )
    .flatMap((candidate) => (candidate.value === null ? [] : [candidate.value]))

  return comparisonOf({ scope, direction, value: row.value, values })
}

function storyComparison(
  payload: Payload,
  scope: ComparisonScope | null,
  key: keyof typeof STORY_METRICS,
  value: number | null,
  direction: DirectionRang,
): FactComparison | null {
  const values = payload.histoires
    .filter(
      (candidate): candidate is HistoireMobilite =>
        candidate.theme === 'mobilite' &&
        scope !== null &&
        scope.territoryIds.includes(candidate.territoire),
    )
    .flatMap((candidate) => {
      const candidateValue = STORY_METRICS[key].read(candidate)
      return candidateValue === null ? [] : [candidateValue]
    })

  return comparisonOf({ scope, direction, value, values })
}

function indicatorsOf(
  payload: Payload,
  target: Territoire,
  scope: ComparisonScope | null,
): readonly NumericFact[] {
  return payload.indicateurs
    .filter((row) => row.theme === 'mobilite' && row.territoire === target.territoire)
    .map((row) => {
      const direction = directionForIndicator(row.key)
      const sourceId = sourceIdForIndicator(payload, row.key)
      return factOf({
        key: row.key,
        detail: row.detail,
        label: payload.themeMetadata?.mobilite?.indicator_labels[row.key] ?? null,
        value: row.value,
        unit: row.unit,
        present: true,
        provenance: provenanceFromRow(row, sourceId),
        comparison: direction
          ? indicatorComparison(payload, scope, row, direction)
          : null,
        reason: row.rider ?? null,
      })
    })
}

function accessFact(
  key: string,
  detail: string | null,
  value: number | null | undefined,
  unit: string,
  present: boolean,
  provenance: FactProvenance | null,
  comparison: FactComparison | null,
): NumericFact {
  return factOf({
    key,
    detail,
    value: value ?? null,
    unit,
    present,
    provenance,
    comparison,
  })
}

function accessOf(
  payload: Payload,
  target: Territoire,
  scope: ComparisonScope | null,
  reader: MobiliteAccessReader,
): MobiliteAccessFacts {
  const snapshots = new Map<string, MobiliteAccessSnapshot | null>()
  const read = (territoire: string): MobiliteAccessSnapshot | null => {
    if (snapshots.has(territoire)) return snapshots.get(territoire) ?? null
    const snapshot = reader(territoire)
    snapshots.set(territoire, snapshot)
    return snapshot
  }

  const snapshot = read(target.territoire)
  const rowFor = (service: MobiliteService, mode: MobiliteAccessMode): Indicateur | null =>
    payload.indicateurs.find(
      (row) =>
        row.theme === 'mobilite' &&
        row.territoire === target.territoire &&
        row.key === ACCESS_INDICATOR_KEYS[service][ACCESS_MODES[mode]] &&
        (row.detail ?? null) === null,
    ) ?? null

  const comparisonFor = (
    service: MobiliteService,
    mode: MobiliteAccessMode,
    value: number | null | undefined,
    row: Indicateur | null,
  ): FactComparison | null => {
    if (!scope) return null
    if (row) return indicatorComparison(payload, scope, row, 'plus-est-mieux')
    const values = scope.territoryIds.flatMap((territoire) => {
      const peer = read(territoire)
      const peerValue = peer?.parts[service]?.[ACCESS_MODES[mode]]
      return typeof peerValue === 'number' ? [peerValue] : []
    })
    if (values.length === 0) return null
    return comparisonOf({
      scope,
      direction: 'plus-est-mieux',
      value: value ?? null,
      values,
    })
  }

  const byService = Object.fromEntries(
    SERVICES.map((service) => {
      const modeFact = (mode: MobiliteAccessMode): NumericFact => {
        const row = rowFor(service, mode)
        const legacyValue = snapshot?.parts[service]?.[ACCESS_MODES[mode]]
        const value = row ? row.value : legacyValue
        return accessFact(
          `access.${service}`,
          mode,
          value,
          '%',
          row !== null || legacyValue !== undefined,
          row ? provenanceFromRow(row, sourceIdForIndicator(payload, row.key)) : snapshot?.provenance ?? null,
          comparisonFor(service, mode, value, row),
        )
      }
      const modes: MobiliteAccessModes = {
        car: modeFact('car'),
        bike: modeFact('bike'),
        walkTransit: modeFact('walkTransit'),
      }
      return [service, modes]
    }),
  ) as Record<MobiliteService, MobiliteAccessModes>

  const totalBuildings = accessFact(
    'access.totalBuildings',
    null,
    snapshot?.batimentsTerritoire,
    'bâtiments',
    snapshot !== null,
    snapshot?.provenance ?? null,
    null,
  )
  const totalBrittanyBuildings = accessFact(
    'access.totalBrittanyBuildings',
    null,
    snapshot?.totalBatimentsBretons,
    'bâtiments',
    snapshot !== null,
    snapshot?.provenance ?? null,
    null,
  )
  const allFacts = [
    totalBuildings,
    totalBrittanyBuildings,
    ...SERVICES.flatMap((service) => Object.values(byService[service])),
  ]
  const completeCount = allFacts.filter((fact) => fact.availability === 'complete').length
  const presentCount = allFacts.filter((fact) => fact.availability !== 'absent').length

  return {
    availability:
      presentCount === 0
        ? 'absent'
        : completeCount === allFacts.length
          ? 'complete'
          : 'incomplete',
    totalBuildings,
    totalBrittanyBuildings,
    byService,
  }
}

function lossesOf(
  payload: Payload,
  target: Territoire,
  scope: ComparisonScope | null,
): MobiliteLossFacts {
  const histoire = payload.histoires.find(
    (candidate): candidate is HistoireMobilite =>
      candidate.theme === 'mobilite' && candidate.territoire === target.territoire,
  )
  const direction: DirectionRang = 'moins-est-mieux'
  const makeLossFact = (key: keyof typeof STORY_METRICS): NumericFact => {
    const metric = STORY_METRICS[key]
    const value = histoire ? metric.read(histoire) : null
    return factOf({
      key: metric.key,
      value,
      unit: metric.unit,
      present: histoire !== undefined,
      provenance: histoire
        ? {
            sourceId: 'mobilite_snapshot',
            source: histoire.vintage_source,
            version: histoire.vintage_version,
            referenceDate: histoire.vintage_date_reference,
            publicationDate: histoire.vintage_date_publication,
          }
        : null,
      comparison: histoire
        ? storyComparison(payload, scope, key, value, direction)
        : null,
    })
  }

  return {
    diversityWalkTransit: makeLossFact('diversityWalkTransit'),
    diversityBike: makeLossFact('diversityBike'),
    distributionWalkTransit: histoire
      ? {
          densities: [
            histoire.dens_1,
            histoire.dens_2,
            histoire.dens_3,
            histoire.dens_4,
            histoire.dens_5,
            histoire.dens_6,
            histoire.dens_7,
            histoire.dens_8,
            histoire.dens_9,
            histoire.dens_10,
          ],
          quantiles: [
            histoire.dec_1,
            histoire.dec_2,
            histoire.dec_3,
            histoire.dec_4,
            histoire.dec_5,
            histoire.dec_6,
            histoire.dec_7,
            histoire.dec_8,
            histoire.dec_9,
            histoire.dec_10,
          ],
          min: histoire.dens_min,
          max: histoire.dens_max,
        }
      : null,
    distributionPeers: scope
      ? scope.territoryIds.flatMap((territoire) => {
          const peer = payload.histoires.find(
            (candidate): candidate is HistoireMobilite =>
              candidate.theme === 'mobilite' && candidate.territoire === territoire,
          )
          const reference = payload.territoires.find(
            (candidate) => candidate.territoire === territoire,
          )
          if (!peer || !reference) return []
          return [{ territoire: identityOf(reference), value: peer.div_loss_t }]
        })
      : [],
  }
}

/** Build Mobilité facts for one target. Unknown targets stay honestly absent. */
export function territoryFactsFor(
  payload: Payload,
  territoire: string,
  accessReader: MobiliteAccessReader,
): TerritoryFacts | null {
  const target = payload.territoires.find((candidate) => candidate.territoire === territoire)
  if (!target) return null

  const scope = scopeFor(payload, target)
  return {
    territory: identityOf(target),
    theme: 'mobilite',
    mobility: {
      indicators: indicatorsOf(payload, target, scope),
      access: accessOf(payload, target, scope, accessReader),
      losses: lossesOf(payload, target, scope),
    },
  }
}
