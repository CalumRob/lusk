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
  fullyIsolatedShare: NumericFact
}

export interface TerritoryIdentity {
  code: string
  type: TerritoireType
  name: string
  department: string | null
  epci: string | null
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
  fullyIsolatedShare: {
    key: 'pct_iso_full_t',
    unit: '%',
    read: (histoire: HistoireMobilite) => histoire.pct_iso_full_t,
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

function absentAccessFact(
  key: string,
  detail: string | null,
  unit: string,
): NumericFact {
  return factOf({ key, detail, value: null, unit, present: false })
}

function accessFact(
  key: string,
  detail: string | null,
  value: number | null | undefined,
  unit: string,
  present: boolean,
  provenance: FactProvenance | null,
): NumericFact {
  return factOf({
    key,
    detail,
    value: value ?? null,
    unit,
    present,
    provenance,
  })
}

function accessOf(target: Territoire, reader: MobiliteAccessReader): MobiliteAccessFacts {
  const snapshot = reader(target.territoire)
  if (!snapshot) {
    const missingModes = Object.fromEntries(
      SERVICES.map((service) => [
        service,
        {
          car: absentAccessFact(`access.${service}`, 'car', '%'),
          bike: absentAccessFact(`access.${service}`, 'bike', '%'),
          walkTransit: absentAccessFact(`access.${service}`, 'walkTransit', '%'),
        },
      ]),
    ) as Record<MobiliteService, MobiliteAccessModes>

    return {
      availability: 'absent',
      totalBuildings: absentAccessFact('access.totalBuildings', null, 'bâtiments'),
      totalBrittanyBuildings: absentAccessFact(
        'access.totalBrittanyBuildings',
        null,
        'bâtiments',
      ),
      byService: missingModes,
    }
  }

  const provenance = snapshot.provenance
  const byService = Object.fromEntries(
    SERVICES.map((service) => {
      const parts = snapshot.parts[service]
      const modes: MobiliteAccessModes = {
        car: accessFact(
          `access.${service}`,
          'car',
          parts?.[ACCESS_MODES.car],
          '%',
          parts?.[ACCESS_MODES.car] !== undefined,
          provenance,
        ),
        bike: accessFact(
          `access.${service}`,
          'bike',
          parts?.[ACCESS_MODES.bike],
          '%',
          parts?.[ACCESS_MODES.bike] !== undefined,
          provenance,
        ),
        walkTransit: accessFact(
          `access.${service}`,
          'walkTransit',
          parts?.[ACCESS_MODES.walkTransit],
          '%',
          parts?.[ACCESS_MODES.walkTransit] !== undefined,
          provenance,
        ),
      }
      return [service, modes]
    }),
  ) as Record<MobiliteService, MobiliteAccessModes>

  const totalBuildings = accessFact(
    'access.totalBuildings',
    null,
    snapshot.batimentsTerritoire,
    'bâtiments',
    true,
    provenance,
  )
  const totalBrittanyBuildings = accessFact(
    'access.totalBrittanyBuildings',
    null,
    snapshot.totalBatimentsBretons,
    'bâtiments',
    true,
    provenance,
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
    fullyIsolatedShare: makeLossFact('fullyIsolatedShare'),
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
      access: accessOf(target, accessReader),
      losses: lossesOf(payload, target, scope),
    },
  }
}
