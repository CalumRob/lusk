import {
  MOBILITE_RESEAU_MODE_LABELS,
} from './territoryFacts'
import { comparisonScopeLabel as resolveComparisonScopeLabel } from './comparisonScopeLabel'
import type { ThemeMetadata, TrajectoryMetadata } from '@/payload/types'
import type { AedarFact } from './aedarApiClient'
import type {
  ComparisonScope,
  FactAvailability,
  FactProvenance,
  NumericFact,
  SelectedTrajectoryComparison,
  TerritoryFacts,
  TerritoryIdentity,
} from './territoryFacts'
import { CONTENU_SOUS_GROUPES_FICHE } from './ficheGrammar'

export interface ContentSource {
  id: string
  source: string
  version: string
  referenceDate: string | null
  publicationDate: string | null
}

export interface ExplorationTarget {
  kind: 'indicator'
  theme: 'mobilite'
  key: string
  detail: string | null
  label: string
  territory: TerritoryIdentity
}

export interface ContentFact {
  fact: NumericFact
  label: string
}

export interface ContentIndicator extends ContentFact {}

export interface ComparisonTrajectoryContent {
  statistic: SelectedTrajectoryComparison['statistic']
  scope: SelectedTrajectoryComparison['scope']
  selectedMemberCount: number
  eligibleCount: number
  modelZeroReasonCounts: SelectedTrajectoryComparison['modelZeroReasonCounts']
  points: readonly ContentFact[]
}

export type TextEmphasisTone =
  | 'default'
  | 'theme'
  | 'region'
  | 'car'
  | 'bike'
  | 'foot'
  | 'neutral'

export type TextSegment =
  | { kind: 'text'; value: string }
  | { kind: 'emphasis'; tone: TextEmphasisTone; value: string }
  | { kind: 'mode-emphasis'; mode: AedarRampMode; value: string }
  | { kind: 'link'; href: string; value: string }

export type TextBlock = readonly TextSegment[]

export interface Lecture {
  marelle: string
  prose: readonly TextBlock[]
}

export interface AedarAccessEvidence {
  kind: 'aedar-access'
  territory: { code: string; name: string }
  horizonMinutes: number
  /** Figure title of the blank map slots, owned by the semantic content layer. */
  mapFigureTitle: TextBlock
  ramps: readonly AedarTimeRampEvidence[]
  comparisonLabel: string | null
  sectionProse: readonly TextBlock[]
  diversityGap: { value: number | null; horizonMinutes: number; territoryLead: string; prose: TextBlock | null }
  source: AedarEvidenceSource | null
  availability: FactAvailability
  provenance: readonly string[]
}

export interface AedarCarAccessOverviewScalar {
  key: 'meanDiversity' | 'meanVolume'
  label: string
  value: number | null
  unit: string
  reference: import('./territoryFacts').TerritorialScalarReference
    | { kind: 'selection-mean'; label: string; value: number; unit: string } | null
  rankUnavailableLabel?: string | null
  rank?: number | null
  rankSize?: number | null
  rankTies?: number | null
  comparisonUnavailableLabel?: string | null
  comparisonAccessibleLabel?: string | null
}

export interface AedarCarAccessOverviewEvidence {
  kind: 'aedar-car-overview'
  territory: Pick<TerritoryIdentity, 'type' | 'code' | 'name'>
  horizonMinutes: number
  mapModes: readonly ['car']
  mapFigureTitle: TextBlock
  meanDiversity: number | null
  meanVolume: number | null
  nAddresses: number | null
  scalarFigureTitle: string
  scalars: readonly AedarCarAccessOverviewScalar[]
  comparisonLabel: string | null
  /** Replaces the incumbent building/20-minute introduction in the opt-in unit. */
  unitIntroduction: readonly TextBlock[]
  prose: readonly TextBlock[]
  source: AedarEvidenceSource | null
  availability: FactAvailability
}

export type AedarDiversityLossMapMode = 'walk' | 'transit' | 'bike_lts2' | 'bike_lts4'

export interface AedarDiversityLossMapEvidence {
  mode: AedarDiversityLossMapMode
  label: string
  inlineAvailable: boolean
  inspectionAvailable: boolean
}

export interface AedarDiversityLossLegendEvidence {
  title: string
  colors: readonly string[]
  tickLabels: readonly string[]
  note: string
  ariaLabel: string
}

export interface AedarDiversityLossComparisonGroup {
  key: 'walk-transit' | 'bike-lts2-lts4'
  label: string
  mapModes: readonly [AedarDiversityLossMapMode, AedarDiversityLossMapMode]
  prompt: readonly TextBlock[]
}

export interface AedarDiversityLossEvidence {
  kind: 'aedar-diversity-loss'
  territory: { code: string; name: string }
  source: AedarEvidenceSource | null
  horizonMinutes: number
  mapModes: readonly AedarDiversityLossMapMode[]
  introduction: readonly TextBlock[]
  mapFigureTitle: TextBlock
  maps: readonly AedarDiversityLossMapEvidence[]
  comparisonGroups: readonly AedarDiversityLossComparisonGroup[]
  legend: AedarDiversityLossLegendEvidence | null
  metadataState: 'loading' | 'ready' | 'unavailable'
  metadataNote: string | null
}

export interface AedarEquipmentProfileEvidence {
  kind: 'aedar-equipment-profile'
  facts: readonly AedarFact[]
  threshold: number
  initialHorizonMinutes: 5 | 10 | 15 | 20
  figureTitle: string
  /** Prose surrounding the first-mode classification, resolved by theme content. */
  prose: readonly TextBlock[]
  source: AedarEvidenceSource | null
}

export interface AedarEquipmentQuantileStatistic {
  key: string
  label: string
  axisLabel: string
}

export interface AedarEquipmentExplorerEvidence {
  kind: 'aedar-equipment-explorer'
  comparison?: import('./aedarComparisonClient').AedarComparisonEvidence | null
  comparisonRequest?: import('./aedarComparisonClient').AedarComparisonRequest | null
  reference?: import('./aedarAccessSection').AedarReferenceEvidence | null
  contentVersion: string
  referenceContentVersion: string
  facts: readonly AedarFact[]
  initialTypequ: string
  initialHorizonMinutes: 5 | 10 | 15 | 20
  introduction: readonly TextBlock[]
  volumeFigureTitle: string
  volumeYAxisTitle: string
  distributionFigureTitle: string
  distributionStatistics: readonly AedarEquipmentQuantileStatistic[]
  distributionAxisTitle: string
  distributionYAxisTitle: string
  distributionDescription: string
  distributionUnavailableDescription: string
  source: AedarEvidenceSource | null
}

export interface AedarEvidenceSource {
  label: string
  version: string
  url: string
  credit: string | null
}
/** The five normal AEDAR access modes rendered as ramp lines (transit_gain is excluded). */
export type AedarRampMode = 'walk' | 'transit' | 'bike_lts2' | 'bike_lts4' | 'car'

export interface AedarTimeRampEvidence {
  kind: 'aedar-time-ramp'
  rampKey: 'diversity' | 'volume'
  /** Figure title owned by the semantic content layer, never the renderer. */
  figureTitle: string
  xAxis: { values: readonly number[]; labels: readonly string[]; unit: string; label: string }
  yAxis: { label: string; unit: string }
  /** Per-mode territory values aligned with xAxis.values; null stays unavailable, never zero. */
  territory: Readonly<Record<AedarRampMode, readonly (number | null)[]>>
  /** Per-mode reference-territory values, or null when no honest reference evidence exists. */
  reference: Readonly<Record<AedarRampMode, readonly (number | null)[]>> | null
  /** Explicit reference-territory label (e.g. an EPCI or region name), never a fabricated cohort. */
  referenceLabel: string | null
  availability: FactAvailability
  provenance: FactProvenance | null
  sourceCoverage: string
}
export interface NetworkModeEvidence {
  mode: 'walkTransit' | 'bike' | 'car'
  label: string
  length: ContentFact
}

export interface CyclingOfferEvidence {
  kind: 'cycling-offer'
  figureTitle: string
  cyclingReadingsLabel: string
  label: string
  protectedLength: ContentFact
  protectedDensity: ContentFact
  sharedLength: ContentFact
  sharedDensity: ContentFact
  totalLength: ContentFact
  comparisonLabel: string | null
  figureLecture: readonly TextBlock[]
}

export interface SharingNetworksEvidence {
  kind: 'sharing-networks'
  figureTitle: string
  frameTitle: string
  networkReadingsLabel: string
  territoryName: string
  roadSurface: ContentFact
  roadSurfaceLecture: readonly TextBlock[]
  networks: readonly NetworkModeEvidence[]
  absoluteNetworks: readonly ContentFact[]
  comparisonLabel: string | null
  figureLecture: readonly TextBlock[]
}

export interface SharingParkingEvidence {
  kind: 'sharing-parking'
  figureTitle: string
  parkingReadingsLabel: string
  bikeSpaces: ContentFact
  carSpaces: ContentFact
  bikePerCar: ContentFact
  comparisonLabel: string | null
  ratioNote: string | null
  figureLecture: readonly TextBlock[]
}

export type ContentEvidence =
  | AedarCarAccessOverviewEvidence
  | AedarDiversityLossEvidence
  | AedarAccessEvidence
  | AedarEquipmentProfileEvidence
  | AedarEquipmentExplorerEvidence
  | SharingNetworksEvidence
  | CyclingOfferEvidence
  | SharingParkingEvidence
  | { kind: 'motorisation'; composition: readonly ContentFact[]; charging: readonly ContentFact[] }
  | { kind: 'public-transport'; offer: ContentFact | null; trajectory: readonly ContentFact[];
      comparisonTrajectory: ComparisonTrajectoryContent | null; trajectoryMetadata: TrajectoryMetadata | null }

interface ContentSectionBase<Key extends string, Evidence> {
  key: Key
  label: string
  availability: FactAvailability
  indicators: readonly ContentIndicator[]
  evidence: Evidence | null
  provenance: readonly string[]
  lecture: Lecture | null
  explorationTargets: readonly ExplorationTarget[]
}

export interface AedarAccessSection extends ContentSectionBase<'aedar-access', AedarAccessEvidence> { label: string }
export interface AedarCarAccessOverviewSection extends ContentSectionBase<'aedar-car-overview', AedarCarAccessOverviewEvidence> { label: string }
export interface AedarDiversityLossSection extends ContentSectionBase<'aedar-diversity-loss', AedarDiversityLossEvidence> { label: string }
export interface AedarEquipmentProfileSection extends ContentSectionBase<'aedar-equipment-profile', AedarEquipmentProfileEvidence> { label: string }
export interface AedarEquipmentExplorerSection extends ContentSectionBase<'aedar-equipment-explorer', AedarEquipmentExplorerEvidence> { label: string }
export interface ReseauxSection
  extends ContentSectionBase<'reseaux', SharingNetworksEvidence> {
  label: 'Réseaux'
}

export interface OffreCyclableSection
  extends ContentSectionBase<'offre-cyclable', CyclingOfferEvidence> {
  label: 'Offre cyclable'
}

export interface StationnementSection
  extends ContentSectionBase<'stationnement', SharingParkingEvidence> {
  label: 'Stationnement'
}

export interface MotorisationSection extends ContentSectionBase<'motorisation', Extract<ContentEvidence, {kind:'motorisation'}>> { label: string }
export interface OffreTransportsSection extends ContentSectionBase<'offre-transports-commun', Extract<ContentEvidence, {kind:'public-transport'}>> { label: string }

export type MobiliteContentSection =
  | AedarCarAccessOverviewSection
  | AedarDiversityLossSection
  | AedarAccessSection
  | AedarEquipmentProfileSection
  | AedarEquipmentExplorerSection
  | ReseauxSection
  | OffreCyclableSection
  | StationnementSection
  | MotorisationSection
  | OffreTransportsSection

export type ContentSection = MobiliteContentSection

export interface AccesAuxServicesContentUnit {
  key: 'acces-aux-services'
  label: string
  introduction: readonly TextBlock[]
  rundown: readonly TextBlock[]
  /** The production AEDAR sections own this unit's content when ready. */
  sections: readonly MobiliteContentSection[]
}

export interface PartageEspacePublicContentUnit {
  key: 'partage-de-lespace-public'
  label: string
  introduction: readonly TextBlock[]
  rundown: readonly TextBlock[]
  sections: readonly [ReseauxSection, OffreCyclableSection, StationnementSection]
}

export interface MotorisationContentUnit { key: 'motorisation'; label: string; introduction: readonly TextBlock[]; rundown: readonly TextBlock[]; sections: readonly [MotorisationSection] }
export interface OffreTransportsContentUnit { key: 'offre-transports-commun'; label: string; introduction: readonly TextBlock[]; rundown: readonly TextBlock[]; sections: readonly [OffreTransportsSection] }

export type MobiliteContentUnit = AccesAuxServicesContentUnit | PartageEspacePublicContentUnit | MotorisationContentUnit | OffreTransportsContentUnit
export type ContentUnit = MobiliteContentUnit

export interface ThemeContent {
  theme: 'mobilite'
  label: 'Mobilité'
  territory: TerritoryIdentity
  introduction: readonly TextBlock[]
  units: readonly [AccesAuxServicesContentUnit, PartageEspacePublicContentUnit, MotorisationContentUnit, OffreTransportsContentUnit]
  sourceRegister: readonly ContentSource[]
}

/** Content shape consumed by one isolated Cahier unit (for prototype variants). */
export type SingleUnitThemeContent = Omit<ThemeContent, 'units'> & {
  units: readonly [ContentUnit]
}
/** Public labels for this grammar's published indicators and content metrics. */
const CONTENT_LABELS: Readonly<Record<string, string>> = {
  reseaux: 'Réseaux piéton, cyclable et routier',
  reseaux_par_habitant: 'Longueur du réseau par habitant',
  offre_cyclable: 'L’offre cyclable',
  places_stationnement_velo_1000: 'Places de stationnement vélo pour 1 000 hab.',
  places_stationnement_voiture_1000: 'Places de stationnement voiture pour 1 000 hab.',
  stationnement_velo_par_voiture: 'Places de stationnement vélo pour 1 place voiture',
  surface_reseaux_routiers: 'Emprise routière',
}

const CONTENT_DETAIL_LABELS: Readonly<Record<string, string>> = {
  'voitures_menage:sans_voiture': 'Ménages sans voiture',
  'voitures_menage:une_voiture': 'Ménages avec 1 voiture',
  'voitures_menage:deux_plus': 'Ménages avec 2 voitures ou plus',
  'reseaux_par_habitant:t_km_1000': `Longueur — ${MOBILITE_RESEAU_MODE_LABELS.walkTransit}`,
  'reseaux_par_habitant:b_km_1000': `Longueur — ${MOBILITE_RESEAU_MODE_LABELS.bike}`,
  'reseaux_par_habitant:c_km_1000': `Longueur — ${MOBILITE_RESEAU_MODE_LABELS.car}`,
  'offre_cyclable:protege_longueur': 'Longueur protégée',
  'offre_cyclable:protege_km_1000': 'Protégé — km / 1 000 hab.',
  'offre_cyclable:partage_longueur': 'Longueur partagée',
  'offre_cyclable:partage_km_1000': 'Partagé — km / 1 000 hab.',
  'offre_cyclable:total_longueur': 'Longueur totale',
}
const SHARING_NETWORK_INDICATOR_KEYS = ['reseaux_par_habitant'] as const
const SHARING_CYCLING_OFFER_INDICATOR_KEYS = ['offre_cyclable'] as const
const SHARING_PARKING_INDICATOR_KEYS = [
  'places_stationnement_velo_1000',
  'places_stationnement_voiture_1000',
  'stationnement_velo_par_voiture',
] as const

const NETWORK_MODES = [
  { mode: 'walkTransit' as const, label: MOBILITE_RESEAU_MODE_LABELS.walkTransit, length: 't_km_1000' },
  { mode: 'bike' as const, label: MOBILITE_RESEAU_MODE_LABELS.bike, length: 'b_km_1000' },
  { mode: 'car' as const, label: MOBILITE_RESEAU_MODE_LABELS.car, length: 'c_km_1000' },
] as const
function complete(fact: NumericFact): fact is NumericFact & { value: number } {
  return fact.availability === 'complete' && fact.value !== null
}

function hasValue(fact: NumericFact): boolean {
  return fact.availability !== 'absent'
}

function contentFact(fact: NumericFact, label: string): ContentFact {
  return { fact, label }
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

function labelFor(key: string): string | null {
  return CONTENT_LABELS[key] ?? null
}

function contentIndicator(fact: NumericFact): ContentIndicator | null {
  const label = fact.label ?? labelFor(fact.key)
  return label ? contentFact(fact, label) : null
}

function indicatorFor(facts: TerritoryFacts, key: string): NumericFact | null {
  return facts.mobility.indicators.find((fact) => fact.key === key) ?? null
}

function detailFactFor(
  facts: TerritoryFacts,
  key: string,
  detail: string,
  unit: string,
): NumericFact {
  return facts.mobility.indicators.find(
    (fact) => fact.key === key && fact.detail === detail,
  ) ?? absentFact(key, unit, detail)
}

function detailLabelFor(key: string, detail: string): string {
  return CONTENT_DETAIL_LABELS[`${key}:${detail}`] ?? detail
}

function contentDetailFact(
  facts: TerritoryFacts,
  key: string,
  detail: string,
  unit: string,
): ContentFact {
  return contentFact(detailFactFor(facts, key, detail, unit), detailLabelFor(key, detail))
}

function indicatorsFor(facts: TerritoryFacts, keys: readonly string[]): ContentIndicator[] {
  return keys
    .map((key) => indicatorFor(facts, key))
    .filter((fact): fact is NumericFact => fact !== null)
    .map(contentIndicator)
    .filter((indicator): indicator is ContentIndicator => indicator !== null)
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

function sourceFrom(provenance: FactProvenance | null): ContentSource | null {
  if (!provenance?.sourceId) return null
  return {
    id: provenance.sourceId,
    source: provenance.source,
    version: provenance.version,
    referenceDate: provenance.referenceDate,
    publicationDate: provenance.publicationDate,
  }
}

function registerFor(sections: readonly MobiliteContentSection[]): ContentSource[] {
  const sources = new Map<string, ContentSource>()
  const sourceKey = (source: ContentSource): string =>
    [source.id, source.version, source.referenceDate, source.publicationDate].join('\u0000')
  const add = (value: ContentFact | null | undefined): void => {
    if (!value?.fact) return
    const source = sourceFrom(value.fact.provenance)
    if (source && !sources.has(sourceKey(source))) sources.set(sourceKey(source), source)
  }

  for (const section of sections) {
    for (const indicator of section.indicators) add(indicator)
    if (section.evidence?.kind === 'sharing-networks') {
      for (const fact of section.evidence.absoluteNetworks) add(fact)
      for (const network of section.evidence.networks) {
        add(network.length)
      }
      add(section.evidence.roadSurface)
    }
    if (section.evidence?.kind === 'cycling-offer') {
      add(section.evidence.protectedLength)
      add(section.evidence.protectedDensity)
      add(section.evidence.sharedLength)
      add(section.evidence.sharedDensity)
      add(section.evidence.totalLength)
    }
    if (section.evidence?.kind === 'sharing-parking') {
      add(section.evidence.bikeSpaces)
      add(section.evidence.carSpaces)
      add(section.evidence.bikePerCar)
    }
    if (section.evidence?.kind === 'motorisation') {
      for (const fact of [...section.evidence.composition, ...section.evidence.charging]) add(fact)
    }
    if (section.evidence?.kind === 'public-transport') {
      add(section.evidence.offer)
      for (const fact of section.evidence.trajectory) add(fact)
    }
  }
  return [...sources.values()]
}

function targetFor(
  fact: NumericFact,
  territory: TerritoryIdentity,
): ExplorationTarget | null {
  if (!hasValue(fact)) return null
  const label = fact.label ?? labelFor(fact.key)
  if (!label) return null
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
  facts: readonly NumericFact[],
  territory: TerritoryIdentity,
): ExplorationTarget[] {
  return facts
    .map((fact) => targetFor(fact, territory))
    .filter((target): target is ExplorationTarget => target !== null)
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 }).format(value)
}

export function text(value: string): TextSegment {
  return { kind: 'text', value }
}

export function emphasis(value: string, tone: TextEmphasisTone = 'theme'): TextSegment {
  return { kind: 'emphasis', tone, value }
}

export function modeEmphasis(value: string, mode: AedarRampMode): TextSegment {
  return { kind: 'mode-emphasis', mode, value }
}

export function link(value: string, href: string): TextSegment {
  return { kind: 'link', href, value }
}
type ComparisonContext = {
  scope: ComparisonScope
  reference: { kind: 'mean' | 'median'; value: number } | null
}

function comparisonScopeLabel(
  comparison: ComparisonContext | null,
  territory: TerritoryIdentity,
): string | null {
  if (!comparison) return null
  return resolveComparisonScopeLabel(comparison.scope.kind, comparison.scope.label, territory.epciName)
}

function comparisonLabel(
  comparison: ComparisonContext | null,
  territory: TerritoryIdentity,
): string | null {
  const scopeLabel = comparisonScopeLabel(comparison, territory)
  if (!scopeLabel) return null
  // Le kind est adapté du statistic servi, pas inféré de la famille visuelle.
  const statistic = comparison?.reference?.kind === 'mean' ? 'Moyenne' : 'Médiane'
  const label = `${statistic} des ${scopeLabel}`
  return comparison?.reference ? label : `Comparaison indisponible — ${label}`
}

function sharingIntroduction(): readonly TextBlock[] {
  return [[
    text('Cette page met en regard les réseaux qui organisent les déplacements et les places qui leur sont réservées dans l’espace public. Elle distingue les aménagements cyclables, les réseaux par mode et les estimations de stationnement.'),
  ]]
}

interface TerritoryLeadParts {
  lead: string
  name: string
}

function territoryLeadParts(
  territory: TerritoryIdentity,
  capitalized = true,
): TerritoryLeadParts {
  const name = territory.name.trim()
  const parts = (() => {
    switch (territory.type) {
      case 'commune':
        if (/^Le\s+/iu.test(name)) return { lead: 'au', name: name.replace(/^Le\s+/iu, '') }
        if (/^Les\s+/iu.test(name)) return { lead: 'aux', name: name.replace(/^Les\s+/iu, '') }
        return { lead: 'à', name }
      case 'epci':
        return /^(?:CA|CC)(?:\s|$)/iu.test(name)
          ? { lead: 'à la', name }
          : { lead: 'à', name }
      case 'departement': {
        const apostropheNormalisee = name.replace(/’/gu, "'")
        if (apostropheNormalisee === "Côtes-d'Armor") return { lead: 'dans les', name }
        if (name === 'Ille-et-Vilaine') return { lead: 'en', name }
        return { lead: 'dans le', name }
      }
      case 'region':
        return { lead: 'en', name }
    }
  })()
  return {
    lead: capitalized ? parts.lead[0]!.toUpperCase() + parts.lead.slice(1) : parts.lead,
    name: parts.name,
  }
}

export function territoryLead(territory: TerritoryIdentity, capitalized = true): string {
  const parts = territoryLeadParts(territory, capitalized)
  return `${parts.lead} ${parts.name}`
}

/** Full, type-aware territory label for prose that needs to name the administrative unit. */
export function territoryTypeLabel(territory: TerritoryIdentity): string {
  const name = territory.name.trim()
  const designation = {
    commune: 'la commune',
    epci: 'l’EPCI',
    departement: 'le département',
    region: 'la région',
  }[territory.type]
  const connector = /^[aeiouyàâäéèêëîïôöùûü]/iu.test(name) ? 'd’' : 'de '
  return `${designation} ${connector}${name}`
}
function comparisonLabelForFacts(
  values: readonly ContentFact[],
  territory: TerritoryIdentity,
): string | null {
  const comparedFact = values.find((value) => value.fact.comparison)?.fact ?? null
  return comparisonLabel(
    comparedFact?.comparison ?? null,
    territory,
  )
}

function sharingNetworksSection(facts: TerritoryFacts): ReseauxSection {
  const absoluteNetworks = ['t_longueur', 'b_longueur', 'c_longueur'].map((detail) => {
    const fact = facts.mobility.indicators.find((candidate) => candidate.key === 'reseaux' && candidate.detail === detail) ?? absentFact('reseaux', 'km', detail)
    return contentFact(fact, fact.label ?? detail)
  })
  const networks = NETWORK_MODES.map(({ mode, label, length }) => ({
    mode,
    label,
    length: contentDetailFact(facts, 'reseaux_par_habitant', length, 'km / 1 000 hab.'),
  }))
  const roadSurface = contentFact(
    indicatorFor(facts, 'surface_reseaux_routiers') ?? absentFact('surface_reseaux_routiers', '%'),
    CONTENT_LABELS.surface_reseaux_routiers,
  )
  const networkFacts = networks.map((network) => network.length)
  const allFacts = [...networkFacts, roadSurface, ...absoluteNetworks]
  const indicators = [
    ...indicatorsFor(facts, SHARING_NETWORK_INDICATOR_KEYS),
    ...indicatorsFor(facts, ['surface_reseaux_routiers', 'reseaux']),
  ]
  const hasAny = allFacts.some((value) => hasValue(value.fact))
  const availability: FactAvailability = !hasAny
    ? 'absent'
    : allFacts.every((value) => complete(value.fact)) && indicators.length === SHARING_NETWORK_INDICATOR_KEYS.length + 1
      ? 'complete'
      : 'incomplete'
  const evidence: SharingNetworksEvidence | null = hasAny
      ? {
        kind: 'sharing-networks',
        territoryName: facts.territory.name,
        networks,
        absoluteNetworks,
        roadSurface,
        roadSurfaceLecture: [[
          text("L'emprise routière décrit la part de la surface totale du territoire qui est dédiée aux Réseaux routiers (code d'usage 4.1.1)."),
        ]],
        figureTitle: 'Cartes des réseaux de mobilité, par mode',
        frameTitle: 'Réseaux',
        networkReadingsLabel: 'Longueur du réseau par habitant',
        comparisonLabel: comparisonLabelForFacts(allFacts, facts.territory),
        figureLecture: [[
          text('Chaque repère indique la longueur du réseau rapportée à 1 000 habitants, séparément pour les trois modes.'),
        ]],
      }
    : null
  return {
    key: 'reseaux',
    label: 'Réseaux',
    availability,
    indicators,
    evidence,
    provenance: sourceIdsFor(allFacts),
    lecture: availability === 'complete' ? { marelle: 'Trois réseaux, trois empreintes', prose: [] } : null,
    explorationTargets: targetsFor(allFacts.map((value) => value.fact), facts.territory),
  }
}

function sharingCyclingOfferSection(facts: TerritoryFacts): OffreCyclableSection {
  const cyclingOffer: CyclingOfferEvidence = {
    kind: 'cycling-offer',
    figureTitle: 'Offre cyclable',
    cyclingReadingsLabel: 'Répartition de l’offre cyclable',
    label: 'Offre cyclable',
    protectedLength: contentDetailFact(facts, 'offre_cyclable', 'protege_longueur', 'km'),
    protectedDensity: contentDetailFact(facts, 'offre_cyclable', 'protege_km_1000', 'km / 1 000 hab'),
    sharedLength: contentDetailFact(facts, 'offre_cyclable', 'partage_longueur', 'km'),
    sharedDensity: contentDetailFact(facts, 'offre_cyclable', 'partage_km_1000', 'km / 1 000 hab'),
    totalLength: contentDetailFact(facts, 'offre_cyclable', 'total_longueur', 'km'),
    comparisonLabel: null,
    figureLecture: [[
      text('La barre montre comment la longueur cyclable se répartit entre aménagements protégés et partagés. Les valeurs en kilomètres par 1 000 habitants donnent une seconde lecture, rapportée à la population.'),
    ]],
  }
  const allFacts = [
    cyclingOffer.protectedLength,
    cyclingOffer.protectedDensity,
    cyclingOffer.sharedLength,
    cyclingOffer.sharedDensity,
    cyclingOffer.totalLength,
  ]
  cyclingOffer.comparisonLabel = comparisonLabelForFacts(allFacts, facts.territory)
  const indicators = indicatorsFor(facts, SHARING_CYCLING_OFFER_INDICATOR_KEYS)
  const hasAny = allFacts.some((value) => hasValue(value.fact))
  const availability: FactAvailability = !hasAny
    ? 'absent'
    : allFacts.every((value) => complete(value.fact)) && indicators.length === 1
      ? 'complete'
      : 'incomplete'
  return {
    key: 'offre-cyclable',
    label: 'Offre cyclable',
    availability,
    indicators,
    evidence: hasAny ? cyclingOffer : null,
    provenance: sourceIdsFor(allFacts),
    lecture: availability === 'complete' ? { marelle: 'Une piste ne suffit pas', prose: [] } : null,
    explorationTargets: targetsFor(allFacts.map((value) => value.fact), facts.territory),
  }
}

function sharingParkingSection(facts: TerritoryFacts): StationnementSection {
  const bikeSpaces = contentFact(
    indicatorFor(facts, 'places_stationnement_velo_1000') ?? absentFact('places_stationnement_velo_1000', 'places / 1 000 hab'),
    'Places vélo / 1 000 hab.',
  )
  const carSpaces = contentFact(
    indicatorFor(facts, 'places_stationnement_voiture_1000') ?? absentFact('places_stationnement_voiture_1000', 'places / 1 000 hab'),
    'Places voiture / 1 000 hab.',
  )
  const bikePerCar = contentFact(
    indicatorFor(facts, 'stationnement_velo_par_voiture') ?? absentFact('stationnement_velo_par_voiture', 'places vélo / place voiture'),
    'Places vélo / places voiture',
  )
  const allFacts = [bikeSpaces, carSpaces, bikePerCar]
  const indicators = indicatorsFor(facts, SHARING_PARKING_INDICATOR_KEYS)
  const hasAny = allFacts.some((value) => hasValue(value.fact))
  const availability: FactAvailability = !hasAny
    ? 'absent'
    : allFacts.every((value) => complete(value.fact)) && indicators.length === SHARING_PARKING_INDICATOR_KEYS.length
      ? 'complete'
      : 'incomplete'
  const evidence: SharingParkingEvidence | null = hasAny
    ? {
        kind: 'sharing-parking',
        figureTitle: 'Stationnement vélo et voiture',
        parkingReadingsLabel: 'Stationnement par mode',
        bikeSpaces,
        carSpaces,
         bikePerCar,
         comparisonLabel: comparisonLabelForFacts(allFacts, facts.territory),
         ratioNote: parkingRatioNote(bikeSpaces, carSpaces, bikePerCar),
         figureLecture: parkingFigureLecture(bikeSpaces, carSpaces, bikePerCar),
      }
    : null
  return {
    key: 'stationnement',
    label: 'Stationnement',
    availability,
    indicators,
    evidence,
    provenance: sourceIdsFor(allFacts),
    lecture: availability === 'complete' ? { marelle: 'Quelle place pour chaque mode ?', prose: [] } : null,
    explorationTargets: targetsFor(allFacts.map((value) => value.fact), facts.territory),
  }
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

function parkingFigureLecture(
  bikeSpaces: ContentFact,
  carSpaces: ContentFact,
  bikePerCar: ContentFact,
): readonly TextBlock[] {
  const blocks: TextBlock[] = [[
    text('Les deux barres se lisent dans la même unité : des places pour 1 000 habitants. Le rapport « places vélo / places voiture » est une lecture séparée, calculée seulement quand le dénominateur voiture est positif.'),
  ]]
  const ratioNote = parkingRatioNote(bikeSpaces, carSpaces, bikePerCar)
  if (ratioNote) {
    blocks.push([text(ratioNote)])
  }
  return blocks
}

function sideOfReference(fact: NumericFact): -1 | 0 | 1 | null {
  const reference = fact.comparison?.reference?.value
  const value = narrativeValue(fact)
  if (reference === undefined || value === null) return null
  return value === reference ? 0 : value > reference ? 1 : -1
}

function sharingRundown(facts: TerritoryFacts): readonly TextBlock[] {
  const network = sharingNetworksSection(facts)
  const cyclingOffer = sharingCyclingOfferSection(facts)
  const parking = sharingParkingSection(facts)
  if (!network.evidence || !cyclingOffer.evidence || !parking.evidence) {
    return [[text('Les données disponibles ne permettent pas encore de dégager une lecture commune des réseaux et du stationnement.')]]
  }

  const offer = cyclingOffer.evidence
  const bikeNetwork = network.evidence.networks.find((mode) => mode.mode === 'bike')
  const total = narrativeValue(offer.totalLength.fact)
  const protectedLength = narrativeValue(offer.protectedLength.fact)
  const sharedLength = narrativeValue(offer.sharedLength.fact)
  const bikeSpaces = narrativeValue(parking.evidence.bikeSpaces.fact)
  const carSpaces = narrativeValue(parking.evidence.carSpaces.fact)
  const bikePerCar = narrativeValue(parking.evidence.bikePerCar.fact)
  const parts: TextSegment[] = [text(`${territoryLead(facts.territory)}, `)]
  if (total !== null && protectedLength !== null && sharedLength !== null) {
     parts.push(
       text(`le réseau cyclable totalise ${formatNumber(total)} km, dont ${formatNumber(protectedLength)} km protégés et ${formatNumber(sharedLength)} km partagés. `),
     )
  } else {
    parts.push(text('le réseau cyclable et son offre d’aménagement restent partiellement documentés. '))
  }
  if (bikeSpaces !== null && carSpaces !== null && bikePerCar !== null) {
    parts.push(text(`Le stationnement compte ${formatNumber(bikeSpaces)} places vélo pour 1 000 habitants contre ${formatNumber(carSpaces)} places voiture, soit ${formatNumber(bikePerCar)} place vélo pour une place voiture. `))
  } else {
    parts.push(text('Le stationnement ne dispose pas encore de ses trois mesures comparables. '))
  }

  const networkSide = sideOfReference(bikeNetwork?.length.fact ?? absentFact('b_km_1000', 'km / 1 000 hab.'))
  const parkingSide = sideOfReference(parking.evidence.bikeSpaces.fact)
  if (networkSide !== null && parkingSide !== null && networkSide !== 0 && networkSide === parkingSide) {
    parts.push(text('Le réseau cyclable et le stationnement vélo se situent du même côté de leur groupe comparé.'))
  } else if (networkSide !== null && parkingSide !== null && networkSide !== 0 && parkingSide !== 0) {
    parts.push(text('Le réseau cyclable et le stationnement vélo ne se situent pas du même côté de leur groupe comparé : c’est le point de tension de la lecture.'))
  }
  return [parts]
}
/** Only complete, finite facts can support a narrative claim. */
function narrativeValue(fact: NumericFact): number | null {
  return fact.availability === 'complete' && fact.value !== null && Number.isFinite(fact.value) ? fact.value : null
}
export function resolveMobiliteThemeContent(facts: TerritoryFacts, metadata?: ThemeMetadata): ThemeContent {
  // #627 legacy accessibility retirement: the acces-aux-services unit keeps
  // only its structural identity (the pagination/AEDAR binding). The retired
  // snapshot sections, their introduction and their rundown no longer render
  // as « Contenu indisponible » placeholders while AEDAR loads or fails — the
  // production AEDAR sections own the surface and replace this unit's content
  // as soon as their evidence is ready.
  const accessSections: readonly MobiliteContentSection[] = []
  const sharingSections = [
    sharingNetworksSection(facts),
    sharingCyclingOfferSection(facts),
    sharingParkingSection(facts),
  ] as const
  const factFor = (key: string): ContentFact | null => {
    const fact = indicatorFor(facts, key)
    return fact ? contentFact(fact, fact.label ?? key) : null
  }
  const subgroupLabel = (key: keyof typeof CONTENU_SOUS_GROUPES_FICHE.mobilite, fallback: string): string =>
    CONTENU_SOUS_GROUPES_FICHE.mobilite[key] ?? fallback
  const composition = facts.mobility.indicators.filter((fact) => fact.key === 'voitures_menage')
    .map((fact) => contentFact(fact, fact.detailLabel ??
      metadata?.detail_labels.voitures_menage?.[fact.detail ?? ''] ??
      (fact.detail ? detailLabelFor('voitures_menage', fact.detail) : fact.label ?? 'Fait disponible')))
  const charging = ['bornes_recharge', 'bornes_ev_par_station_service'].flatMap((key) => {
    const fact = factFor(key)
    return fact ? [fact] : []
  })
  const motorFacts = [...composition, ...charging]
  const motorEvidence = motorFacts.length ? {
    kind: 'motorisation' as const, composition, charging,
  } : null
  const motorSection: MotorisationSection = {
    key: 'motorisation', label: subgroupLabel('motorisation', 'Motorisation'), indicators: indicatorsFor(facts, ['voitures_menage', 'bornes_recharge', 'bornes_ev_par_station_service']),
    availability: !motorEvidence ? 'absent' : motorFacts.every(({fact}) => complete(fact)) ? 'complete' : 'incomplete',
    evidence: motorEvidence, provenance: sourceIdsFor(motorFacts), lecture: null,
    explorationTargets: targetsFor(motorFacts.map(({fact}) => fact), facts.territory),
  }
  const curve = facts.mobility.indicators.filter((fact) => fact.key === 'raccordement_courbe').map((fact) => contentFact(fact, fact.label ?? fact.detail ?? fact.key))
  const selectedComparison = facts.mobility.selectedTrajectoryComparison
  const comparisonTrajectory: ComparisonTrajectoryContent | null = selectedComparison ? {
    statistic: selectedComparison.statistic, scope: selectedComparison.scope,
    selectedMemberCount: selectedComparison.selectedMemberCount, eligibleCount: selectedComparison.eligibleCount,
    modelZeroReasonCounts: selectedComparison.modelZeroReasonCounts,
    points: selectedComparison.points.map((fact) => contentFact(fact, fact.detail ?? fact.key)),
  } : null
  // A selected peer mean is independent from the global national reference.
  const offer = factFor('offre_tc')
  const transitFacts = [...(offer ? [offer] : []), ...curve]
  const transitEvidence = transitFacts.length ? {
    kind: 'public-transport' as const, offer, trajectory: curve, comparisonTrajectory,
    trajectoryMetadata: metadata?.indicator_pages?.raccordement_courbe?.family === 'trajectory'
      ? metadata.indicator_pages.raccordement_courbe.trajectory : null,
  } : null
  const transitSection: OffreTransportsSection = {
    key: 'offre-transports-commun', label: subgroupLabel('offre-transports-commun', 'Offre de transports en commun'), indicators: indicatorsFor(facts, ['offre_tc', 'raccordement_courbe']),
    availability: !transitEvidence ? 'absent' : transitFacts.every(({fact}) => complete(fact)) ? 'complete' : 'incomplete',
    evidence: transitEvidence, provenance: sourceIdsFor(transitFacts), lecture: null,
    explorationTargets: targetsFor(transitFacts.map(({fact}) => fact), facts.territory),
  }
  const accessUnit: AccesAuxServicesContentUnit = {
    key: 'acces-aux-services',
    label: subgroupLabel('acces-aux-services', 'Accès aux services'),
    introduction: [],
    rundown: [],
    sections: accessSections,
  }
  const sharingUnit: PartageEspacePublicContentUnit = {
    key: 'partage-de-lespace-public',
    label: subgroupLabel('partage-de-lespace-public', 'Partage de l’espace public'),
    introduction: sharingIntroduction(),
    rundown: sharingRundown(facts),
    sections: sharingSections,
  }
  const motorLabel = subgroupLabel('motorisation', 'Motorisation')
  const transitLabel = subgroupLabel('offre-transports-commun', 'Offre de transports en commun')
  motorSection.label = motorLabel
  transitSection.label = transitLabel
  const motorUnit: MotorisationContentUnit = { key: 'motorisation', label: motorLabel, introduction: [], rundown: [], sections: [motorSection] }
  const transitUnit: OffreTransportsContentUnit = { key: 'offre-transports-commun', label: transitLabel, introduction: [], rundown: [], sections: [transitSection] }

  return {
    theme: 'mobilite',
    label: 'Mobilité',
    territory: facts.territory,
    introduction: accessUnit.introduction,
    units: [accessUnit, sharingUnit, motorUnit, transitUnit],
    sourceRegister: registerFor([...accessSections, ...sharingSections, motorSection, transitSection]),
  }
}
