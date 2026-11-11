import { comparisonScopeLabel } from './comparisonScopeLabel'
import { MOBILITE_RESEAU_MODE_LABELS } from './territoryFacts'
import type {
  FactAvailability,
  FactProvenance,
  NumericFact,
  TerritoryFacts,
  TerritoryIdentity,
} from './territoryFacts'
import type { ThemeMetadata } from '@/payload/types'
import type {
  ContentFact,
  ContentIndicator,
  ContentSource,
  ExplorationTarget,
  MobiliteBarCategoryEvidence,
  MobiliteNetworksSection,
  MobilitePairedColumnEvidence,
  MobiliteRatioEvidence,
  MobiliteStationnementRavitaillementSection,
  TextBlock,
  TextSegment,
} from './themeContent'

/**
 * Mobilité section builders (#954).
 *
 * The builders own the section anatomy and editorial copy. Every plotted value,
 * comparison reference, unit, producer identity and millésime still comes from
 * the published facts and the producer metadata; nothing numeric is copied here.
 */

const SOURCE_LABELS: Readonly<Record<string, string>> = {
  reseaux_par_habitant: 'Longueur du réseau par habitant',
  places_stationnement_velo_1000: 'Places de stationnement vélo pour 1 000 hab.',
  places_stationnement_voiture_1000: 'Places de stationnement voiture pour 1 000 hab.',
  stationnement_velo_par_voiture: 'Places de stationnement vélo pour 1 place voiture',
  bornes_recharge: 'Bornes de recharge pour véhicules électriques',
  bornes_recharge_1000: 'Bornes de recharge pour 1 000 hab.',
  stations_service: 'Stations-service',
  stations_service_1000: 'Stations-service pour 1 000 hab.',
  bornes_ev_par_station_service: 'Bornes de recharge par station-service',
}

const DETAIL_LABELS: Readonly<Record<string, string>> = {
  'reseaux_par_habitant:t_km_1000': 'Longueur — à pied',
  'reseaux_par_habitant:b_km_1000': 'Longueur — à vélo',
  'reseaux_par_habitant:c_km_1000': 'Longueur — en voiture',
  'reseaux:t_longueur': 'Longueur — à pied ou en transports en commun',
  'reseaux:b_longueur': 'Longueur — à vélo',
  'reseaux:c_longueur': 'Longueur — en voiture',
  'offre_cyclable:protege_km_1000': 'Protégé',
  'offre_cyclable:partage_km_1000': 'Partagé',
}

const AXIS_LABELS: Readonly<Record<string, string>> = {
  t_km_1000: 'à pied',
  b_km_1000: 'à vélo',
  c_km_1000: 'en voiture',
}

function text(value: string): TextSegment {
  return { kind: 'text', value }
}

function formatNumber(value: number, maximumFractionDigits = 1): string {
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits }).format(value)
}

function numericValue(fact: NumericFact): number | null {
  return fact.availability === 'complete' && fact.value !== null && Number.isFinite(fact.value)
    ? fact.value
    : null
}

function hasValue(fact: NumericFact): boolean {
  return fact.availability !== 'absent'
}

function complete(fact: NumericFact): fact is NumericFact & { value: number } {
  return fact.availability === 'complete' && fact.value !== null
}

function absentFact(key: string, unit: string, detail: string | null = null): NumericFact {
  return {
    key,
    detail,
    label: null,
    value: null,
    unit,
    availability: 'absent',
    provenance: null,
    comparison: null,
    comparisonBasis: 'territory-median',
    reason: null,
  }
}

function indicatorFor(facts: TerritoryFacts, key: string): NumericFact | null {
  return facts.mobility.indicators.find((fact) => fact.key === key) ?? null
}

function detailFactFor(
  facts: TerritoryFacts,
  key: string,
  detail: string,
  unit: string,
  metadata?: ThemeMetadata,
): NumericFact {
  const fact = facts.mobility.indicators.find(
    (candidate) => candidate.key === key && candidate.detail === detail,
  )
  if (!fact) return absentFact(key, unit, detail)
  return {
    ...fact,
    detailLabel:
      fact.detailLabel
      ?? metadata?.detail_labels?.[key]?.[detail]
      ?? DETAIL_LABELS[`${key}:${detail}`]
      ?? detail,
  }
}

function contentFact(fact: NumericFact, fallbackLabel: string): ContentFact {
  return { fact, label: fact.label ?? fallbackLabel }
}

function contentDetailFact(
  facts: TerritoryFacts,
  key: string,
  detail: string,
  unit: string,
  metadata?: ThemeMetadata,
): ContentFact {
  const fact = detailFactFor(facts, key, detail, unit, metadata)
  return {
    fact,
    label: fact.detailLabel ?? fact.label ?? DETAIL_LABELS[`${key}:${detail}`] ?? detail,
  }
}

function contentIndicatorFact(
  facts: TerritoryFacts,
  key: string,
  unit: string,
  label: string,
  metadata?: ThemeMetadata,
): ContentFact {
  const fact = indicatorFor(facts, key) ?? absentFact(key, unit)
  return contentFact(
    { ...fact, label: fact.label ?? metadata?.indicator_labels?.[key] ?? label },
    label,
  )
}

function sourceFrom(provenance: FactProvenance | null, metadata?: ThemeMetadata): ContentSource | null {
  if (!provenance?.sourceId) return null
  const record = metadata?.source_records?.[provenance.sourceId]
  return {
    id: provenance.sourceId,
    source: record?.publisher ?? provenance.source,
    version: provenance.version,
    referenceDate: provenance.referenceDate,
    publicationDate: provenance.publicationDate,
    url: record?.url ?? null,
    licence: record?.licence ?? null,
  }
}

function sourcesFor(values: readonly ContentFact[], metadata?: ThemeMetadata): ContentSource[] {
  const sources = new Map<string, ContentSource>()
  for (const value of values) {
    const source = sourceFrom(value.fact.provenance, metadata)
    if (!source) continue
    const key = [source.id, source.version, source.referenceDate, source.publicationDate].join('\u0000')
    if (!sources.has(key)) sources.set(key, source)
  }
  return [...sources.values()]
}

function sourceIdsFor(values: readonly ContentFact[]): string[] {
  return [
    ...new Set(
      values
        .map((value) => value.fact.provenance?.sourceId)
        .filter((sourceId): sourceId is string => sourceId !== null),
    ),
  ]
}

function targetFor(fact: NumericFact, territory: TerritoryIdentity): ExplorationTarget | null {
  if (!hasValue(fact)) return null
  const label = fact.label ?? fact.detailLabel ?? fact.detail ?? fact.key
  return {
    kind: 'indicator',
    theme: 'mobilite',
    key: fact.key,
    detail: fact.detail,
    label,
    territory,
  }
}

function targetsFor(
  values: readonly ContentFact[],
  territory: TerritoryIdentity,
): ExplorationTarget[] {
  return values
    .map((value) => targetFor(value.fact, territory))
    .filter((target): target is ExplorationTarget => target !== null)
}

function indicatorsFor(facts: TerritoryFacts, keys: readonly string[]): ContentIndicator[] {
  return keys
    .map((key) => indicatorFor(facts, key))
    .filter((fact): fact is NumericFact => fact !== null)
    .map((fact) => contentFact(fact, fact.label ?? fact.key))
}

function comparisonLabelFor(
  values: readonly ContentFact[],
  territory: TerritoryIdentity,
): string | null {
  const comparison = values.find((value) => value.fact.comparison)?.fact.comparison ?? null
  if (!comparison) return null
  const scope = comparisonScopeLabel(
    comparison.scope.kind,
    comparison.scope.label,
    territory.epciName,
  )
  if (!scope) return null
  const statistic = comparison.reference?.kind === 'mean' ? 'Moyenne' : 'Médiane'
  const label = `${statistic} des ${scope}`
  return comparison.reference ? label : `Comparaison indisponible — ${label}`
}

function availabilityFor(values: readonly ContentFact[]): FactAvailability {
  const present = values.filter((value) => hasValue(value.fact))
  if (!present.length) return 'absent'
  return present.every((value) => complete(value.fact)) ? 'complete' : 'incomplete'
}

function percentOf(fact: NumericFact): string | null {
  const value = numericValue(fact)
  return value === null ? null : formatNumber(value * 100)
}

/**
 * C2 — one grammatical paragraph for the shared-public-space page.
 * Each clause is published from the facts and stays silent when its part is
 * missing; the second clause keeps its own subject when the first is silent.
 */
export function buildPartageSubtitle(facts: TerritoryFacts): readonly TextBlock[] {
  const uneVoiture = facts.mobility.indicators.find(
    (fact) => fact.key === 'voitures_menage' && fact.detail === 'une_voiture',
  ) ?? null
  const deuxPlus = facts.mobility.indicators.find(
    (fact) => fact.key === 'voitures_menage' && fact.detail === 'deux_plus',
  ) ?? null
  const une = uneVoiture ? numericValue(uneVoiture) : null
  const deux = deuxPlus ? numericValue(deuxPlus) : null
  const surface = percentOf(indicatorFor(facts, 'surface_reseaux_routiers') ?? absentFact('surface_reseaux_routiers', '%'))
  const clauses: string[] = []
  if (une !== null && deux !== null) {
    clauses.push(
      `${formatNumber((une + deux) * 100)} % des ménages ont au moins une voiture`,
    )
  }
  if (deux !== null) {
    clauses.push(une !== null
      ? `${formatNumber(deux * 100)} % en ont deux ou plus`
      : `${formatNumber(deux * 100)} % des ménages ont deux voitures ou plus`)
  }
  if (surface !== null) {
    clauses.push(`L’emprise routière couvre ${surface} % de la surface du territoire`)
  }
  return clauses.length ? [[text(`${clauses.join('. ')}.`)]] : []
}

function networkProse(): readonly TextBlock[] {
  return [
    [text('Trois réseaux sont rapportés à 1 000 habitants : voies vraisemblablement praticables à pied, aménagements cyclables et voirie vraisemblablement accessible en voiture. Les longueurs brutes sont disponibles dans les infobulles.')],
    [text('Le vélo distingue les aménagements protégés du trafic motorisé et les aménagements partagés avec lui, selon la classification Geovelo. Leurs longueurs forment le total cyclable.')],
  ]
}

function stationnementProse(): readonly TextBlock[] {
  return [[text('Les places vélo proviennent du hub Ecolab, à partir d’OpenStreetMap. Les places voiture sont estimées depuis les surfaces de parkings et le stationnement linéaire cartographié ; ce ne sont pas des places comptées. Les barres rapportent les deux offres à 1 000 habitants.')]]
}

function ravitaillementProse(): readonly TextBlock[] {
  return [[text('Les bornes de recharge (IRVE) et les stations-service (BPE, INSEE) sont rapportées à 1 000 habitants. Le rapport indique le nombre de bornes par station-service ; il reste indisponible là où aucune station n’est recensée.')]]
}

function parkingRatioNote(
  bikeSpaces: ContentFact,
  carSpaces: ContentFact,
  bikePerCar: ContentFact,
): string | null {
  if (bikePerCar.fact.value !== null) return null
  if (carSpaces.fact.value === 0) {
    return 'Rapport non calculé : aucune place de stationnement voiture estimée ne fournit un dénominateur positif.'
  }
  if (bikeSpaces.fact.value !== null || carSpaces.fact.value !== null) {
    return 'Rapport indisponible : les deux mesures de stationnement sont nécessaires pour le calculer.'
  }
  return null
}

function ravitaillementRatioNote(
  bornes: ContentFact,
  stations: ContentFact,
  ratio: ContentFact,
): string | null {
  if (ratio.fact.value !== null) return null
  if (stations.fact.value === 0) {
    return 'Rapport non calculé : le territoire ne compte aucune station-service.'
  }
  if (bornes.fact.value !== null || stations.fact.value !== null) {
    return 'Rapport indisponible : les deux dénombrements sont nécessaires pour le calculer.'
  }
  return null
}

function commonUnit(values: readonly ContentFact[], fallback: string): string {
  const units = [...new Set(values.map((value) => value.fact.unit).filter((unit) => unit.trim().length > 0))]
  return units.length === 1 ? units[0]! : fallback
}

/** Machine-float partition check: no policy threshold, only round-off slack. */
function isPartition(
  parts: readonly (number | null)[],
  total: number | null,
): boolean {
  if (total === null || parts.some((part) => part === null || !Number.isFinite(part))) return false
  const sum = (parts as number[]).reduce((value, part) => value + part, 0)
  const scale = Math.max(1, Math.abs(total), ...parts.map((part) => Math.abs(part as number)))
  return Math.abs(sum - total) <= Number.EPSILON * scale * 64
}

function partitionValues(values: readonly ContentFact[]): (number | null)[] {
  return values.map((value) => value.fact.value)
}

export function buildMobiliteNetworksSection(
  facts: TerritoryFacts,
  metadata?: ThemeMetadata,
): MobiliteNetworksSection {
  const networkModes = [
    { mode: 'walkTransit' as const, tone: 't' as const, density: 't_km_1000', raw: 't_longueur' },
    { mode: 'bike' as const, tone: 'b' as const, density: 'b_km_1000', raw: 'b_longueur' },
    { mode: 'car' as const, tone: 'c' as const, density: 'c_km_1000', raw: 'c_longueur' },
  ]
  const bikeSegments = [
    {
      key: 'protege_km_1000',
      value: contentDetailFact(facts, 'offre_cyclable', 'protege_km_1000', 'km / 1 000 hab.', metadata),
      rawValue: contentDetailFact(facts, 'offre_cyclable', 'protege_longueur', 'km', metadata),
    },
    {
      key: 'partage_km_1000',
      value: contentDetailFact(facts, 'offre_cyclable', 'partage_km_1000', 'km / 1 000 hab.', metadata),
      rawValue: contentDetailFact(facts, 'offre_cyclable', 'partage_longueur', 'km', metadata),
    },
  ] as const
  const categories: MobiliteBarCategoryEvidence[] = networkModes.map((definition) => {
    const value = contentDetailFact(
      facts,
      'reseaux_par_habitant',
      definition.density,
      'km / 1 000 hab.',
      metadata,
    )
    const rawValue = contentDetailFact(facts, 'reseaux', definition.raw, 'km', metadata)
    const normalizedSplit = isPartition(partitionValues(bikeSegments.map((segment) => segment.value)), value.fact.value)
    const rawSplit = isPartition(
      partitionValues(bikeSegments.map((segment) => segment.rawValue)),
      rawValue.fact.value,
    )
    const segments = definition.mode === 'bike' && normalizedSplit
      ? bikeSegments.map((segment) => ({
        key: segment.key,
        label: segment.value.label,
        value: segment.value,
        rawValue: rawSplit ? segment.rawValue : null,
      }))
      : []
    const splitNote = definition.mode === 'bike' && !normalizedSplit
      ? 'Répartition Protégé/Partagé indisponible : les deux parties publiées ne recomposent pas le total.'
      : null
    return {
      key: definition.mode,
      label: MOBILITE_RESEAU_MODE_LABELS[definition.mode],
      axisLabel: value.fact.detailLabel?.split(' — ').at(-1) ?? AXIS_LABELS[definition.density] ?? definition.density,
      tone: definition.tone,
      value,
      rawValue,
      segments,
      splitNote,
    }
  })
  const allFacts = [
    ...categories.map((category) => category.value),
    ...categories.flatMap((category) => category.segments.flatMap((segment) =>
      segment.rawValue ? [segment.value, segment.rawValue] : [segment.value])),
    ...categories.flatMap((category) => category.rawValue ? [category.rawValue] : []),
  ]
  const hasAny = allFacts.some((value) => hasValue(value.fact))
  const densityFacts = categories.map((category) => category.value)
  const figureUnit = commonUnit(densityFacts, 'km / 1 000 hab.')
  const evidence = hasAny
    ? {
      kind: 'mobilite-networks' as const,
      territory: { code: facts.territory.code, name: facts.territory.name },
      territoryName: facts.territory.name,
      mapFigureTitle: 'Cartes des réseaux de mobilité, par mode',
      figure: {
        figureTitle: 'Longueur du réseau par habitant',
        unit: figureUnit,
        xAxisTitle: 'Réseau',
        yAxisTitle: figureUnit,
        categories,
        comparisonLabel: comparisonLabelFor(densityFacts, facts.territory),
      },
      prose: networkProse(),
      sources: sourcesFor(allFacts, metadata),
    }
    : null
  return {
    key: 'reseaux',
    label: 'Réseaux',
    availability: availabilityFor(allFacts),
    indicators: indicatorsFor(facts, ['reseaux_par_habitant', 'offre_cyclable', 'reseaux']),
    evidence,
    provenance: sourceIdsFor(allFacts),
    // The AEDAR section contract deliberately carries no Marelle (`lecture`).
    lecture: null,
    explorationTargets: targetsFor(allFacts, facts.territory),
  }
}

function stationnementColumn(facts: TerritoryFacts, metadata?: ThemeMetadata): MobilitePairedColumnEvidence {
  const bikeSpaces = contentIndicatorFact(
    facts,
    'places_stationnement_velo_1000',
    'places / 1 000 hab',
    SOURCE_LABELS.places_stationnement_velo_1000,
    metadata,
  )
  const carSpaces = contentIndicatorFact(
    facts,
    'places_stationnement_voiture_1000',
    'places / 1 000 hab',
    SOURCE_LABELS.places_stationnement_voiture_1000,
    metadata,
  )
  const ratioFact = contentIndicatorFact(
    facts,
    'stationnement_velo_par_voiture',
    'places vélo / place voiture',
    SOURCE_LABELS.stationnement_velo_par_voiture,
    metadata,
  )
  const allFacts = [bikeSpaces, carSpaces, ratioFact]
  const ratio: MobiliteRatioEvidence = {
    label: ratioFact.label,
    value: ratioFact,
    note: parkingRatioNote(bikeSpaces, carSpaces, ratioFact),
  }
  return {
    key: 'stationnement',
    prose: stationnementProse(),
    sources: sourcesFor(allFacts, metadata),
    bars: {
      figureTitle: 'Stationnement vélo et voiture',
      unit: commonUnit([bikeSpaces, carSpaces], 'places / 1 000 hab.'),
      xAxisTitle: 'Mode',
      yAxisTitle: commonUnit([bikeSpaces, carSpaces], 'places / 1 000 hab.'),
      categories: [
        {
          key: 'bike-parking',
          label: 'Vélo',
          axisLabel: 'Vélo',
          tone: 'b',
          value: bikeSpaces,
          rawValue: null,
          segments: [],
          splitNote: null,
        },
        {
          key: 'car-parking',
          label: 'Voiture',
          axisLabel: 'Voiture',
          tone: 'c',
          value: carSpaces,
          rawValue: null,
          segments: [],
          splitNote: null,
        },
      ],
      comparisonLabel: comparisonLabelFor(allFacts, facts.territory),
    },
    ratio,
  }
}

function ravitaillementColumn(facts: TerritoryFacts, metadata?: ThemeMetadata): MobilitePairedColumnEvidence {
  const bornes = contentIndicatorFact(
    facts,
    'bornes_recharge_1000',
    'bornes / 1 000 hab',
    SOURCE_LABELS.bornes_recharge_1000,
    metadata,
  )
  const stations = contentIndicatorFact(
    facts,
    'stations_service_1000',
    'stations / 1 000 hab',
    SOURCE_LABELS.stations_service_1000,
    metadata,
  )
  const bornesRaw = contentIndicatorFact(
    facts,
    'bornes_recharge',
    'bornes',
    SOURCE_LABELS.bornes_recharge,
    metadata,
  )
  const stationsRaw = contentIndicatorFact(
    facts,
    'stations_service',
    'stations',
    SOURCE_LABELS.stations_service,
    metadata,
  )
  const ratioFact = contentIndicatorFact(
    facts,
    'bornes_ev_par_station_service',
    'bornes / station',
    SOURCE_LABELS.bornes_ev_par_station_service,
    metadata,
  )
  const allFacts = [bornes, stations, bornesRaw, stationsRaw, ratioFact]
  const ratio: MobiliteRatioEvidence = {
    label: ratioFact.label,
    value: ratioFact,
    note: ravitaillementRatioNote(bornesRaw, stationsRaw, ratioFact),
  }
  return {
    key: 'ravitaillement',
    prose: ravitaillementProse(),
    sources: sourcesFor(allFacts, metadata),
    bars: {
      figureTitle: 'Bornes de recharge et station-services',
      // The two facts keep their native numerators (bornes / stations); the
      // shared axis is the approved common denominator with a neutral noun.
      unit: commonUnit([bornes, stations], 'équipements / 1 000 hab.'),
      xAxisTitle: 'Équipement',
      yAxisTitle: commonUnit([bornes, stations], 'équipements / 1 000 hab.'),
      categories: [
        {
          key: 'charging',
          label: 'Bornes de recharge',
          axisLabel: 'Bornes',
          tone: 'c',
          value: bornes,
          rawValue: bornesRaw,
          segments: [],
          splitNote: null,
        },
        {
          key: 'fuel-stations',
          label: 'Stations-service',
          axisLabel: 'Stations-service',
          tone: 'neutral',
          value: stations,
          rawValue: stationsRaw,
          segments: [],
          splitNote: null,
        },
      ],
      comparisonLabel: comparisonLabelFor(allFacts, facts.territory),
    },
    ratio,
  }
}

export function buildMobiliteStationnementRavitaillementSection(
  facts: TerritoryFacts,
  metadata?: ThemeMetadata,
): MobiliteStationnementRavitaillementSection {
  const columns = [
    stationnementColumn(facts, metadata),
    ravitaillementColumn(facts, metadata),
  ] as const
  const allFacts = columns.flatMap((column) => [
    ...column.bars.categories.map((category) => category.value),
    ...column.bars.categories.flatMap((category) => category.rawValue ? [category.rawValue] : []),
    column.ratio.value,
  ])
  const hasAny = allFacts.some((value) => hasValue(value.fact))
  return {
    key: 'stationnement-ravitaillement',
    label: 'Se garer et se ravitiller',
    availability: availabilityFor(allFacts),
    indicators: indicatorsFor(facts, [
      'places_stationnement_velo_1000',
      'places_stationnement_voiture_1000',
      'stationnement_velo_par_voiture',
      'bornes_recharge',
      'bornes_recharge_1000',
      'stations_service',
      'stations_service_1000',
      'bornes_ev_par_station_service',
    ]),
    evidence: hasAny ? { kind: 'mobilite-stationnement-ravitaillement', columns } : null,
    provenance: sourceIdsFor(allFacts),
    lecture: null,
    explorationTargets: targetsFor(allFacts, facts.territory),
  }
}

