import type { DirectionRang } from '@/methodes/indicateurs'
import { THEMES_METHODES } from '@/methodes/indicateurs'
import { LIBELLES_PROFILS_ACCES_BPE, PROFILS_ACCES_BPE } from '@/payload/types'
import type {
  HistoireMobilite,
  Indicateur,
  Payload,
  ProfilAccesBpe,
  RampeAccesBatimentsRow,
  Territoire,
  TerritoireType,
} from '@/payload/types'

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
  kind: 'mean' | 'median'
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

export const MOBILITE_INACCESSIBLE_LABEL = 'Inaccessible'

export interface MobiliteAccessModes {
  car: NumericFact
  bike: NumericFact
  walkTransit: NumericFact
}

export interface MobiliteAccessGaps {
  carGap: NumericFact
  bikeGain: NumericFact
}

export interface MobiliteAccessFacts {
  availability: FactAvailability
  totalBuildings: NumericFact
  totalBrittanyBuildings: NumericFact
  summary: MobiliteSummaryFacts
  byService: Record<MobiliteService, MobiliteAccessModes>
  gapsByService: Record<MobiliteService, MobiliteAccessGaps>
}

export interface MobiliteSummaryFacts {
  availability: FactAvailability
  accessibleEquipment: MobiliteAccessModes
  accessibleTypes: MobiliteAccessModes
  averageLosses: {
    diversity: {
      walkTransit: NumericFact
      bike: NumericFact
    }
    total: {
      walkTransit: NumericFact
      bike: NumericFact
    }
  }
}

export interface BpeAccessExemplar {
  typequ: string
  label: string
  car: number
  bike: number
  walkTransit: number
}

export interface BpeAccessProfileReference {
  /** The mean keeps the four mutually exclusive profile counts compositional. */
  kind: 'mean'
  value: number
}

export interface BpeAccessProfileComparison {
  scope: ComparisonScope
  direction: DirectionRang
  rank: ComparisonRank | null
  reference: BpeAccessProfileReference | null
}

export interface BpeAccessProfileFact {
  profile: ProfilAccesBpe
  label: string
  count: number
  exemplar: BpeAccessExemplar | null
  comparison: BpeAccessProfileComparison | null
}

export interface MobiliteBpeAccessFacts {
  availability: FactAvailability
  profiles: readonly BpeAccessProfileFact[]
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

export interface MobiliteDistributionBin {
  key: string
  min: number
  max: number | null
  label: string
}

export interface MobiliteBuildingDistributionCell {
  breadthBucket: string
  depthBucket: string
  buildingCount: number
  share: number
}

/** Normalized compact same-building breadth × depth facts for the Cahier. */
export interface MobiliteBuildingDistribution {
  availability: FactAvailability
  mode: 't'
  modeLabel: string
  breadthAxisLabel: string
  depthAxisLabel: string
  breadthBins: readonly MobiliteDistributionBin[]
  depthBins: readonly MobiliteDistributionBin[]
  cells: readonly MobiliteBuildingDistributionCell[]
  totalBuildings: number
  provenance: FactProvenance | null
  comparisonLabel: string | null
}

export interface MobiliteAccessRampPoint {
  quantile: number
  quantileLabel: string
  accessibleTypes: number
}

export interface MobiliteAccessRampCurve {
  mode: MobiliteAccessMode
  modeLabel: string
  points: readonly MobiliteAccessRampPoint[]
}

/** Normalized three-mode marginal access ramp for the Cahier. */
export interface MobiliteAccessRamp {
  availability: FactAvailability
  xAxisLabel: string
  yAxisLabel: string
  curves: Readonly<Record<MobiliteAccessMode, MobiliteAccessRampCurve>>
  totalBuildings: number
  provenance: FactProvenance | null
  comparisonLabel: string | null
}

export interface TerritoryIdentity {
  code: string
  type: TerritoireType
  name: string
  department: string | null
  epci: string | null
  /** The published EPCI name for a commune's comparison context, when available. */
  epciName?: string | null
}

export interface MobilityFacts {
  indicators: readonly NumericFact[]
  access: MobiliteAccessFacts
  bpeAccess: MobiliteBpeAccessFacts
  losses: MobiliteLossFacts
  buildingDistribution: MobiliteBuildingDistribution | null
  accessRamp: MobiliteAccessRamp | null
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

const SUMMARY_FACT_KEYS: Readonly<{
  accessibleEquipment: Record<MobiliteAccessMode, string>
  accessibleTypes: Record<MobiliteAccessMode, string>
}> = {
  accessibleEquipment: {
    car: 'avg_tot_car',
    bike: 'avg_tot_b',
    walkTransit: 'avg_tot_t',
  },
  accessibleTypes: {
    car: 'avg_div_car',
    bike: 'avg_div_b',
    walkTransit: 'avg_div_t',
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

function identityOf(territoire: Territoire, epciName: string | null = null): TerritoryIdentity {
  return {
    code: territoire.territoire,
    type: territoire.type,
    name: territoire.nom,
    department: territoire.departement,
    epci: territoire.epci,
    ...(epciName ? { epciName } : {}),
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

function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null
  return values.reduce((total, value) => total + value, 0) / values.length
}

function weightedMean(
  values: readonly number[],
  weights: readonly (number | null)[] | undefined,
): number | null {
  if (!weights || values.length === 0 || values.length !== weights.length) return null
  let total = 0
  let weightTotal = 0
  for (const [index, value] of values.entries()) {
    const weight = weights[index]
    if (weight === null || weight === undefined || !Number.isFinite(weight) || weight < 0) {
      return null
    }
    total += value * weight
    weightTotal += weight
  }
  return weightTotal === 0 ? null : total / weightTotal
}

function rankOf(
  value: number | null,
  values: readonly number[],
  direction: DirectionRang,
): ComparisonRank | null {
  if (value === null || values.length === 0) return null
  return {
    position:
      1 +
      values.filter((candidate) =>
        direction === 'moins-est-mieux' ? candidate < value : candidate > value,
      ).length,
    size: values.length,
  }
}

type ComparisonStatistic = 'mean' | 'median'

function comparisonOf(options: {
  scope: ComparisonScope | null
  direction: DirectionRang
  value: number | null
  values: readonly number[]
  statistic?: ComparisonStatistic
  weights?: readonly (number | null)[]
}): FactComparison | null {
  if (!options.scope || options.values.length === 0) return null

  const statistic = options.statistic ?? 'median'
  const referenceValue = statistic === 'mean'
    ? weightedMean(options.values, options.weights)
    : median(options.values)
  const rank = rankOf(options.value, options.values, options.direction)

  return {
    direction: options.direction,
    scope: options.scope,
    rank,
    reference: referenceValue === null ? null : { kind: statistic, value: referenceValue },
  }
}

function sourceIdForIndicator(payload: Payload, key: string): string | null {
  return (
    payload.themeMetadata?.mobilite?.sources[key] ??
    THEMES_METHODES.mobilite.indicateurs[key]?.sourceId ??
    null
  )
}

function buildingCountValueOf(payload: Payload, territoire: string): number | null {
  return payload.indicateurs.find(
    (row) =>
      row.theme === 'mobilite' &&
      row.territoire === territoire &&
      row.key === 'nb_buildings' &&
      (row.detail ?? null) === null,
  )?.value ?? null
}

function directionForIndicator(key: string): DirectionRang | null {
  return THEMES_METHODES.mobilite.indicateurs[key]?.direction ?? null
}

function indicatorComparison(
  payload: Payload,
  scope: ComparisonScope | null,
  row: Indicateur,
  direction: DirectionRang,
  statistic: ComparisonStatistic = 'median',
): FactComparison | null {
  const observations = payload.indicateurs
    .filter(
      (candidate) =>
        candidate.theme === 'mobilite' &&
        candidate.key === row.key &&
        candidate.detail === row.detail &&
        (candidate.sex ?? null) === (row.sex ?? null) &&
        (candidate.dimension ?? null) === (row.dimension ?? null) &&
        scope !== null && scope.territoryIds.includes(candidate.territoire),
    )
    .flatMap((candidate) =>
      candidate.value === null
        ? []
        : [{ value: candidate.value, weight: buildingCountValueOf(payload, candidate.territoire) }],
    )

  return comparisonOf({
    scope,
    direction,
    value: row.value,
    values: observations.map(({ value }) => value),
    weights: observations.map(({ weight }) => weight),
    statistic,
  })
}

function statisticForIndicator(key: string): ComparisonStatistic {
  return key.startsWith('avg_') ? 'mean' : 'median'
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
          ? indicatorComparison(payload, scope, row, direction, statisticForIndicator(row.key))
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
): MobiliteAccessFacts {
  const buildingCountFor = (territoire: string): Indicateur | null =>
    payload.indicateurs.find(
      (row) =>
        row.theme === 'mobilite' &&
        row.territoire === territoire &&
        row.key === 'nb_buildings' &&
        (row.detail ?? null) === null,
    ) ?? null
  const territoryBuildingCount = buildingCountFor(target.territoire)
  const brittanyBuildingCount = buildingCountFor('53')
  const rowForTerritory = (
    territoire: string,
    service: MobiliteService,
    mode: MobiliteAccessMode,
  ): Indicateur | null =>
    payload.indicateurs.find(
      (row) =>
        row.theme === 'mobilite' &&
        row.territoire === territoire &&
        row.key === ACCESS_INDICATOR_KEYS[service][ACCESS_MODES[mode]] &&
        (row.detail ?? null) === null,
    ) ?? null

  const rowFor = (service: MobiliteService, mode: MobiliteAccessMode): Indicateur | null =>
    rowForTerritory(target.territoire, service, mode)

  const comparisonFor = (
    row: Indicateur | null,
  ): FactComparison | null => {
    if (!scope) return null
    return row ? indicatorComparison(payload, scope, row, 'plus-est-mieux') : null
  }

  const summaryRowForTerritory = (territoire: string, key: string): Indicateur | null =>
    payload.indicateurs.find(
      (row) =>
        row.theme === 'mobilite' &&
        row.territoire === territoire &&
        row.key === key &&
        (row.detail ?? null) === null,
    ) ?? null

  const summaryRowFor = (key: string): Indicateur | null =>
    summaryRowForTerritory(target.territoire, key)

  const summaryModeFacts = (
    kind: keyof typeof SUMMARY_FACT_KEYS,
    unit: string,
  ): MobiliteAccessModes => {
    const modeFact = (mode: MobiliteAccessMode): NumericFact => {
      const row = summaryRowFor(SUMMARY_FACT_KEYS[kind][mode])
      const direction = row ? directionForIndicator(row.key) : null
      return accessFact(
        SUMMARY_FACT_KEYS[kind][mode],
        null,
        row?.value,
        unit,
        row !== null,
        row ? provenanceFromRow(row, sourceIdForIndicator(payload, row.key)) : null,
        row && direction ? indicatorComparison(payload, scope, row, direction, 'mean') : null,
      )
    }
    return {
      car: modeFact('car'),
      bike: modeFact('bike'),
      walkTransit: modeFact('walkTransit'),
    }
  }

  const accessibleEquipment = summaryModeFacts(
    'accessibleEquipment',
    'équipements / bâtiment',
  )
  const accessibleTypes = summaryModeFacts(
    'accessibleTypes',
    'types d’équipement / bâtiment',
  )
  const averageLossesFor = (
    kind: 'total' | 'diversity',
    values: MobiliteAccessModes,
    unit: string,
  ): { walkTransit: NumericFact; bike: NumericFact } => {
    const sourceKeys = kind === 'total'
      ? { car: 'avg_tot_car', bike: 'avg_tot_b', walkTransit: 'avg_tot_t' }
      : { car: 'avg_div_car', bike: 'avg_div_b', walkTransit: 'avg_div_t' }
    const lossFact = (mode: 'walkTransit' | 'bike'): NumericFact => {
      const car = values.car
      const current = values[mode]
      const value = car.value === null || current.value === null ? null : Math.max(0, car.value - current.value)
       const peerObservations = scope
        ? scope.territoryIds.flatMap((territoire) => {
            const peerCar = summaryRowForTerritory(territoire, sourceKeys.car)?.value
            const peerCurrent = summaryRowForTerritory(territoire, sourceKeys[mode])?.value
            const peerWeight = buildingCountValueOf(payload, territoire)
            return peerCar === null || peerCar === undefined || peerCurrent === null || peerCurrent === undefined
              ? []
              : [{ value: Math.max(0, peerCar - peerCurrent), weight: peerWeight }]
          })
        : []
      return factOf({
        key: kind === 'total' ? `avg_loss_tot_${mode === 'bike' ? 'b' : 't'}` : `avg_loss_div_${mode === 'bike' ? 'b' : 't'}`,
        value,
        unit,
        present: car.availability !== 'absent' && current.availability !== 'absent',
        provenance: current.provenance ?? car.provenance,
        comparison: comparisonOf({
          scope,
          direction: 'moins-est-mieux',
          value,
          values: peerObservations.map(({ value: peerValue }) => peerValue),
          weights: peerObservations.map(({ weight }) => weight),
          statistic: 'mean',
        }),
      })
    }
    return { walkTransit: lossFact('walkTransit'), bike: lossFact('bike') }
  }
  const averageLosses = {
    diversity: averageLossesFor('diversity', accessibleTypes, 'types d’équipement / bâtiment'),
    total: averageLossesFor('total', accessibleEquipment, 'équipements / bâtiment'),
  }
  const summaryFacts = [...Object.values(accessibleEquipment), ...Object.values(accessibleTypes)]
  const summaryCompleteCount = summaryFacts.filter((fact) => fact.availability === 'complete').length
  const summaryPresentCount = summaryFacts.filter((fact) => fact.availability !== 'absent').length
  const summary: MobiliteSummaryFacts = {
    availability:
      summaryPresentCount === 0
        ? 'absent'
        : summaryCompleteCount === summaryFacts.length
          ? 'complete'
          : 'incomplete',
    accessibleEquipment,
    accessibleTypes,
    averageLosses,
  }

  const byService = Object.fromEntries(
    SERVICES.map((service) => {
      const modeFact = (mode: MobiliteAccessMode): NumericFact => {
        const row = rowFor(service, mode)
        const value = row?.value
        return accessFact(
          `access.${service}`,
          mode,
          value,
          '%',
          row !== null,
          row ? provenanceFromRow(row, sourceIdForIndicator(payload, row.key)) : null,
          comparisonFor(row),
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

  const differenceFact = (
    service: MobiliteService,
    key: 'carGap' | 'bikeGain',
    minuendMode: MobiliteAccessMode,
    subtrahendMode: MobiliteAccessMode,
    direction: DirectionRang,
  ): NumericFact => {
    const minuend = byService[service][minuendMode]
    const subtrahend = byService[service][subtrahendMode]
    const value =
      minuend.value === null || subtrahend.value === null
        ? null
        : minuend.value - subtrahend.value
    const peerValues = scope
      ? scope.territoryIds.flatMap((territoire) => {
          const peerMinuend = rowForTerritory(territoire, service, minuendMode)?.value
          const peerSubtrahend = rowForTerritory(territoire, service, subtrahendMode)?.value
          return peerMinuend === null || peerMinuend === undefined ||
            peerSubtrahend === null || peerSubtrahend === undefined
            ? []
            : [peerMinuend - peerSubtrahend]
        })
      : []
    const comparison = comparisonOf({
      scope,
      direction,
      value,
      values: peerValues,
    })
    return factOf({
      key: `access.${service}.${key}`,
      value,
      unit: '%',
      present: minuend.availability !== 'absent' && subtrahend.availability !== 'absent',
      provenance: minuend.provenance ?? subtrahend.provenance,
      comparison: comparison ? { ...comparison, rank: null } : null,
    })
  }

  const gapsByService = Object.fromEntries(
    SERVICES.map((service) => [
      service,
      {
        carGap: differenceFact(service, 'carGap', 'car', 'walkTransit', 'moins-est-mieux'),
        bikeGain: differenceFact(service, 'bikeGain', 'bike', 'walkTransit', 'plus-est-mieux'),
      },
    ]),
  ) as Record<MobiliteService, MobiliteAccessGaps>

  const totalBuildings = accessFact(
    'access.totalBuildings',
    null,
    territoryBuildingCount?.value,
    'bâtiments',
    territoryBuildingCount !== null,
    territoryBuildingCount
      ? provenanceFromRow(territoryBuildingCount, sourceIdForIndicator(payload, territoryBuildingCount.key))
      : null,
    null,
  )
  const totalBrittanyBuildings = accessFact(
    'access.totalBrittanyBuildings',
    null,
    brittanyBuildingCount?.value,
    'bâtiments',
    brittanyBuildingCount !== null,
    brittanyBuildingCount
      ? provenanceFromRow(brittanyBuildingCount, sourceIdForIndicator(payload, brittanyBuildingCount.key))
      : null,
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
    summary,
    byService,
    gapsByService,
  }
}

function bpeAccessOf(payload: Payload, target: Territoire): MobiliteBpeAccessFacts {
  const allRows = payload.profilsAccesBpe ?? []
  const rowsForTerritory = (territoire: string) =>
    allRows.filter((row) => row.territoire === territoire)
  const rows = rowsForTerritory(target.territoire)
  const scope = scopeFor(payload, target)
  const directions: Readonly<Record<ProfilAccesBpe, DirectionRang>> = {
    'acces-pied-tc': 'plus-est-mieux',
    'velo-compense': 'plus-est-mieux',
    'voiture-requise': 'moins-est-mieux',
    'inaccessible-20-minutes': 'moins-est-mieux',
  }
  if (rows.length === 0) return { availability: 'absent', profiles: [] }

  return {
    availability: 'complete',
    profiles: PROFILS_ACCES_BPE.map((profile) => {
      const row = rows.find((candidate) => candidate.profil === profile)
      const peerValues = scope?.territoryIds.flatMap((territoire) => {
        const peerRows = rowsForTerritory(territoire)
        if (peerRows.length === 0) return []
        return [peerRows.find((candidate) => candidate.profil === profile)?.nombre_typequ ?? 0]
      }) ?? []
      // A profile is a composition: each peer contributes the same closed
      // universe of service types. The mean therefore preserves the 53-type
      // total, while four independent medians do not.
      const reference = mean(peerValues)
      const direction = directions[profile]
      return {
        profile,
        label: row?.profil_libelle ?? LIBELLES_PROFILS_ACCES_BPE[profile],
        count: row?.nombre_typequ ?? 0,
        exemplar: row
          ? {
              typequ: row.exemplar_typequ,
              label: row.exemplar_libelle,
              car: row.exemplar_c,
              bike: row.exemplar_b,
              walkTransit: row.exemplar_t,
            }
          : null,
        comparison:
          scope && reference !== null
            ? {
                scope,
                direction,
                rank: rankOf(row?.nombre_typequ ?? 0, peerValues, direction),
                reference: { kind: 'mean', value: reference },
              }
            : null,
      }
    }),
  }
}

function buildingDistributionOf(
  payload: Payload,
  target: Territoire,
): MobiliteBuildingDistribution | null {
  const rows = (payload.distributionAccesBatiments ?? []).filter(
    (row) => row.territoire === target.territoire,
  )
  const first = rows[0]
  if (!first) return null

  const breadthBins = rows
    .filter((row) => row.breadth_bucket !== null)
    .map((row) => ({
      key: row.breadth_bucket!,
      min: row.breadth_min!,
      max: row.breadth_max,
      label: row.breadth_label!,
    }))
    .filter((bin, index, bins) => bins.findIndex((candidate) => candidate.key === bin.key) === index)
    .sort((left, right) => left.min - right.min)
  const depthBins = rows
    .filter((row) => row.depth_bucket !== null)
    .map((row) => ({
      key: row.depth_bucket!,
      min: row.depth_min!,
      max: row.depth_max,
      label: row.depth_label!,
    }))
    .filter((bin, index, bins) => bins.findIndex((candidate) => candidate.key === bin.key) === index)
    .sort((left, right) => left.min - right.min)
  const cells = rows
    .filter(
      (row) => row.breadth_bucket !== null && row.depth_bucket !== null && row.building_count !== null && row.share !== null,
    )
    .map((row) => ({
      breadthBucket: row.breadth_bucket!,
      depthBucket: row.depth_bucket!,
      buildingCount: row.building_count!,
      share: row.share!,
    }))

  return {
    availability: first.availability,
    mode: first.mode,
    modeLabel: first.mode_label,
    breadthAxisLabel: first.breadth_axis_label,
    depthAxisLabel: first.depth_axis_label,
    breadthBins,
    depthBins,
    cells,
    totalBuildings: first.total_buildings,
    provenance: {
      sourceId: first.source_id,
      source: first.source,
      version: first.version,
      referenceDate: first.date_reference,
      publicationDate: first.date_publication,
    },
    comparisonLabel: first.comparison_label,
  }
}

function accessRampOf(payload: Payload, target: Territoire): MobiliteAccessRamp | null {
  const rows = (payload.rampeAccesBatiments ?? []).filter(
    (row) => row.territoire === target.territoire,
  )
  const first = rows[0]
  if (!first) return null

  const modeNames: Readonly<Record<RampeAccesBatimentsRow['mode'], MobiliteAccessMode>> = {
    c: 'car',
    b: 'bike',
    t: 'walkTransit',
  }
  const curves = Object.fromEntries(
    (Object.keys(modeNames) as RampeAccesBatimentsRow['mode'][]).map((mode) => {
      const modeRows = rows
        .filter((row) => row.mode === mode && row.quantile !== null && row.quantile_label !== null && row.accessible_types !== null)
        .sort((left, right) => (left.quantile ?? 0) - (right.quantile ?? 0))
      const normalizedMode = modeNames[mode]
      return [normalizedMode, {
        mode: normalizedMode,
        modeLabel: rows.find((row) => row.mode === mode)?.mode_label ?? '',
        points: modeRows.map((row) => ({
          quantile: row.quantile!,
          quantileLabel: row.quantile_label!,
          accessibleTypes: row.accessible_types!,
        })),
      }]
    }),
  ) as unknown as Record<MobiliteAccessMode, MobiliteAccessRampCurve>

  return {
    availability: first.availability,
    xAxisLabel: first.x_axis_label,
    yAxisLabel: first.y_axis_label,
    curves,
    totalBuildings: first.total_buildings,
    provenance: {
      sourceId: first.source_id,
      source: first.source,
      version: first.version,
      referenceDate: first.date_reference,
      publicationDate: first.date_publication,
    },
    comparisonLabel: first.comparison_label,
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
): TerritoryFacts | null {
  const target = payload.territoires.find((candidate) => candidate.territoire === territoire)
  if (!target) return null

  const scope = scopeFor(payload, target)
  const epciName = target.epci
    ? payload.territoires.find(
        (candidate) => candidate.type === 'epci' && candidate.territoire === target.epci,
      )?.nom ?? null
    : null
  return {
    territory: identityOf(target, epciName),
    theme: 'mobilite',
    mobility: {
      indicators: indicatorsOf(payload, target, scope),
      access: accessOf(payload, target, scope),
      bpeAccess: bpeAccessOf(payload, target),
      losses: lossesOf(payload, target, scope),
      buildingDistribution: buildingDistributionOf(payload, target),
      accessRamp: accessRampOf(payload, target),
    },
  }
}
