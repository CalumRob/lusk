import {
  MOBILITE_INACCESSIBLE_LABEL,
  MOBILITE_MODE_LABELS,
  MOBILITE_RESEAU_MODE_LABELS,
} from './territoryFacts'
import type { FigureLegendEntry } from '@/fiche/cahierFigureGrammaire'
import type {
  BpeAccessProfileFact,
  ComparisonScope,
  FactAvailability,
  FactProvenance,
  MobiliteAccessMode,
  MobiliteAccessModes,
  MobiliteAccessRamp,
  MobiliteBuildingDistribution,
  MobiliteService,
  MobiliteSummaryFacts,
  NumericFact,
  TerritoryFacts,
  TerritoryIdentity,
} from './territoryFacts'

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

export type TextBlock = readonly TextSegment[]

export interface Lecture {
  marelle: string
  prose: readonly TextBlock[]
}

export interface DistributionEvidence {
  kind: 'distribution'
  buildingDistribution: MobiliteBuildingDistribution | null
  accessRamp: MobiliteAccessRamp | null
  comparisonPopulationLabel: string | null
  buildingDistributionLecture: readonly TextBlock[]
  accessRampLecture: readonly TextBlock[]
}

export interface BpeProfilesEvidence {
  kind: 'bpe-profiles'
  profiles: readonly BpeAccessProfileFact[]
  territoryName: string
  donutTooltipTitle: string
  /** Total canonical BPE types represented by the complete projection. */
  totalTypes: number | null
  /** Human-readable peer-group scope for the compositional reference. */
  comparisonLabel: string | null
  figureLecture: readonly TextBlock[]
}

export type ContentModeFacts = Record<MobiliteAccessMode, ContentFact>

export interface ContentLossFacts {
  walkTransit: ContentFact
  bike: ContentFact
}

export interface SummaryEvidence {
  kind: 'summary'
  legend: readonly FigureLegendEntry[]
  accessibleEquipment: ContentModeFacts
  accessibleTypes: ContentModeFacts
  inaccessibleTypes: ContentFact
  averageLosses: {
    diversity: ContentLossFacts
    total: ContentLossFacts
  }
  typeCount: number | null
  comparisonLabel: string | null
  figureLecture: readonly TextBlock[]
  losses: {
    diversity: {
      walkTransit: ContentFact
      bike: ContentFact
    }
    total: {
      walkTransit: ContentFact
      bike: ContentFact
    }
  }
}

export interface AccessServiceEvidence {
  service: MobiliteService
  label: string
  modes: Record<MobiliteAccessMode, ContentFact>
  carGap: ContentFact
  bikeGain: ContentFact
}

export interface AccessEvidence {
  kind: 'access'
  legend: readonly FigureLegendEntry[]
  totalBuildings: ContentFact
  totalBrittanyBuildings: ContentFact
  services: readonly AccessServiceEvidence[]
  comparisonLabel: string | null
  figureLecture: readonly TextBlock[]
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
  | DistributionEvidence
  | BpeProfilesEvidence
  | SummaryEvidence
  | AccessEvidence
  | SharingNetworksEvidence
  | CyclingOfferEvidence
  | SharingParkingEvidence

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

export interface ResumeSection extends ContentSectionBase<'resume', SummaryEvidence> {
  label: 'Résumé'
}

export interface ProfilsAccesParModeSection
  extends ContentSectionBase<'profils-acces-par-mode', BpeProfilesEvidence> {
  label: 'Profils d’accès par mode'
}

export interface DistributionAccesParBatimentSection
  extends ContentSectionBase<'distribution-acces-par-batiment', DistributionEvidence> {
  label: "Distribution de l'accès par bâtiment"
}

export interface ServicesEssentielsSection
  extends ContentSectionBase<'services-essentiels', AccessEvidence> {
  label: 'Services essentiels'
}

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

export type MobiliteContentSection =
  | ResumeSection
  | ProfilsAccesParModeSection
  | ServicesEssentielsSection
  | DistributionAccesParBatimentSection
  | ReseauxSection
  | OffreCyclableSection
  | StationnementSection

export type ContentSection = MobiliteContentSection

export interface AccesAuxServicesContentUnit {
  key: 'acces-aux-services'
  label: 'Accès aux services'
  introduction: readonly TextBlock[]
  rundown: readonly TextBlock[]
  sections: readonly [
    ResumeSection,
    ProfilsAccesParModeSection,
    ServicesEssentielsSection,
    DistributionAccesParBatimentSection,
  ]
}

export interface PartageEspacePublicContentUnit {
  key: 'partage-de-lespace-public'
  label: 'Partage de l’espace public'
  introduction: readonly TextBlock[]
  rundown: readonly TextBlock[]
  sections: readonly [ReseauxSection, OffreCyclableSection, StationnementSection]
}

export type MobiliteContentUnit = AccesAuxServicesContentUnit | PartageEspacePublicContentUnit
export type ContentUnit = MobiliteContentUnit

export interface ThemeContent {
  theme: 'mobilite'
  label: 'Mobilité'
  territory: TerritoryIdentity
  introduction: readonly TextBlock[]
  units: readonly [AccesAuxServicesContentUnit, PartageEspacePublicContentUnit]
  sourceRegister: readonly ContentSource[]
}

/** Content shape consumed by one isolated Cahier unit (for prototype variants). */
export type SingleUnitThemeContent = Omit<ThemeContent, 'units'> & {
  units: readonly [ContentUnit]
}

const SERVICE_GRAMMAR: readonly {
  key: MobiliteService
  label: string
}[] = [
  { key: 'administration', label: 'Administration' },
  { key: 'alimentation', label: 'Alimentation' },
  { key: 'sante', label: 'Santé' },
  { key: 'banque', label: 'Banque' },
  { key: 'ecole', label: 'École' },
]

/** Public labels for this grammar's published indicators and content metrics. */
const CONTENT_LABELS: Readonly<Record<string, string>> = {
  avg_tot_car: `Équipements accessibles — ${MOBILITE_MODE_LABELS.car}`,
  avg_tot_b: `Équipements accessibles — ${MOBILITE_MODE_LABELS.bike}`,
  avg_tot_t: `Équipements accessibles — ${MOBILITE_MODE_LABELS.walkTransit}`,
  avg_div_car: `Types d’équipements accessibles — ${MOBILITE_MODE_LABELS.car}`,
  avg_div_b: `Types d’équipements accessibles — ${MOBILITE_MODE_LABELS.bike}`,
  avg_div_t: `Types d’équipements accessibles — ${MOBILITE_MODE_LABELS.walkTransit}`,
  div_loss_t: `Perte de diversité — ${MOBILITE_MODE_LABELS.walkTransit}`,
  div_loss_b: `Perte de diversité — ${MOBILITE_MODE_LABELS.bike}`,
  tot_loss_t: `Perte totale d’accès — ${MOBILITE_MODE_LABELS.walkTransit}`,
  tot_loss_b: `Perte totale d’accès — ${MOBILITE_MODE_LABELS.bike}`,
  share_food_t: `Part des bâtiments avec accès à l’alimentation — ${MOBILITE_MODE_LABELS.walkTransit}`,
  share_food_b: `Part des bâtiments avec accès à l’alimentation — ${MOBILITE_MODE_LABELS.bike}`,
  share_food_c: `Part des bâtiments avec accès à l’alimentation — ${MOBILITE_MODE_LABELS.car}`,
  share_health_t: `Part des bâtiments avec accès à la santé — ${MOBILITE_MODE_LABELS.walkTransit}`,
  share_health_b: `Part des bâtiments avec accès à la santé — ${MOBILITE_MODE_LABELS.bike}`,
  share_health_c: `Part des bâtiments avec accès à la santé — ${MOBILITE_MODE_LABELS.car}`,
  share_admin_t: `Part des bâtiments avec accès aux services administratifs — ${MOBILITE_MODE_LABELS.walkTransit}`,
  share_admin_b: `Part des bâtiments avec accès aux services administratifs — ${MOBILITE_MODE_LABELS.bike}`,
  share_admin_c: `Part des bâtiments avec accès aux services administratifs — ${MOBILITE_MODE_LABELS.car}`,
  share_school_t: `Part des bâtiments avec accès à l’école — ${MOBILITE_MODE_LABELS.walkTransit}`,
  share_school_b: `Part des bâtiments avec accès à l’école — ${MOBILITE_MODE_LABELS.bike}`,
  share_school_c: `Part des bâtiments avec accès à l’école — ${MOBILITE_MODE_LABELS.car}`,
  share_bank_t: `Part des bâtiments avec accès à la banque — ${MOBILITE_MODE_LABELS.walkTransit}`,
  share_bank_b: `Part des bâtiments avec accès à la banque — ${MOBILITE_MODE_LABELS.bike}`,
  share_bank_c: `Part des bâtiments avec accès à la banque — ${MOBILITE_MODE_LABELS.car}`,
  reseaux: 'Réseaux piéton, cyclable et routier',
  reseaux_par_habitant: 'Longueur du réseau par habitant',
  offre_cyclable: 'L’offre cyclable',
  places_stationnement_velo_1000: 'Places de stationnement vélo pour 1 000 hab.',
  places_stationnement_voiture_1000: 'Places de stationnement voiture pour 1 000 hab.',
  stationnement_velo_par_voiture: 'Places de stationnement vélo pour 1 place voiture',
  surface_reseaux_routiers: 'Emprise routière',
}

const CONTENT_DETAIL_LABELS: Readonly<Record<string, string>> = {
  'reseaux_par_habitant:t_km_1000': `Longueur — ${MOBILITE_RESEAU_MODE_LABELS.walkTransit}`,
  'reseaux_par_habitant:b_km_1000': `Longueur — ${MOBILITE_RESEAU_MODE_LABELS.bike}`,
  'reseaux_par_habitant:c_km_1000': `Longueur — ${MOBILITE_RESEAU_MODE_LABELS.car}`,
  'offre_cyclable:protege_longueur': 'Longueur protégée',
  'offre_cyclable:protege_km_1000': 'Protégé — km / 1 000 hab.',
  'offre_cyclable:partage_longueur': 'Longueur partagée',
  'offre_cyclable:partage_km_1000': 'Partagé — km / 1 000 hab.',
  'offre_cyclable:total_longueur': 'Longueur totale',
}

const ESSENTIAL_INDICATOR_KEYS = [
  'share_food_t',
  'share_food_b',
  'share_food_c',
  'share_health_t',
  'share_health_b',
  'share_health_c',
  'share_admin_t',
  'share_admin_b',
  'share_admin_c',
  'share_school_t',
  'share_school_b',
  'share_school_c',
  'share_bank_t',
  'share_bank_b',
  'share_bank_c',
] as const

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

const MOBILITE_ACCESS_LEGEND: readonly FigureLegendEntry[] = [
  { key: 'walkTransit', label: MOBILITE_MODE_LABELS.walkTransit, marker: 'icon', iconKey: 'walkTransit', tone: 't' },
  { key: 'bike', label: MOBILITE_MODE_LABELS.bike, marker: 'icon', iconKey: 'bike', tone: 'b' },
  { key: 'car', label: MOBILITE_MODE_LABELS.car, marker: 'icon', iconKey: 'car', tone: 'c' },
  { key: 'inaccessible', label: MOBILITE_INACCESSIBLE_LABEL, marker: 'slash', tone: 'neutral' },
]

function mobiliteAccessLegend(includeInaccessible: boolean): readonly FigureLegendEntry[] {
  return includeInaccessible ? MOBILITE_ACCESS_LEGEND : MOBILITE_ACCESS_LEGEND.slice(0, 3)
}

function complete(fact: NumericFact): fact is NumericFact & { value: number } {
  return fact.availability === 'complete' && fact.value !== null
}

function hasValue(fact: NumericFact): boolean {
  return fact.availability !== 'absent'
}

function contentFact(fact: NumericFact, label: string): ContentFact {
  return { fact, label }
}

function inaccessibleFact(
  total: number,
  source: NumericFact,
  key: string,
  unit: string,
): ContentFact {
  const remainder = (value: number | null): number | null =>
    value === null ? null : Math.max(0, total - value)
  const comparison = source.comparison
  return contentFact(
    {
      ...source,
      key,
      detail: null,
      label: MOBILITE_INACCESSIBLE_LABEL,
      value: remainder(source.value),
      unit,
      comparison: comparison
        ? {
            ...comparison,
            rank: null,
            reference: comparison.reference
              ? { ...comparison.reference, value: remainder(comparison.reference.value)! }
              : null,
          }
        : null,
    },
    MOBILITE_INACCESSIBLE_LABEL,
  )
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
  const add = (value: ContentFact): void => {
    const source = sourceFrom(value.fact.provenance)
    if (source && !sources.has(source.id)) sources.set(source.id, source)
  }

  for (const section of sections) {
    for (const indicator of section.indicators) add(indicator)
    if (section.evidence?.kind === 'distribution') {
      const buildingSource = sourceFrom(section.evidence.buildingDistribution?.provenance ?? null)
      if (buildingSource && !sources.has(buildingSource.id)) {
        sources.set(buildingSource.id, buildingSource)
      }
      const rampSource = sourceFrom(section.evidence.accessRamp?.provenance ?? null)
      if (rampSource && !sources.has(rampSource.id)) {
        sources.set(rampSource.id, rampSource)
      }
    }
    if (section.evidence?.kind === 'summary') {
      for (const mode of Object.values(section.evidence.accessibleEquipment)) add(mode)
      for (const mode of Object.values(section.evidence.accessibleTypes)) add(mode)
      add(section.evidence.averageLosses.diversity.walkTransit)
      add(section.evidence.averageLosses.diversity.bike)
      add(section.evidence.averageLosses.total.walkTransit)
      add(section.evidence.averageLosses.total.bike)
      add(section.evidence.losses.diversity.walkTransit)
      add(section.evidence.losses.diversity.bike)
      add(section.evidence.losses.total.walkTransit)
      add(section.evidence.losses.total.bike)
    }
    if (section.evidence?.kind === 'access') {
      add(section.evidence.totalBuildings)
      add(section.evidence.totalBrittanyBuildings)
      for (const service of section.evidence.services) {
        for (const mode of Object.values(service.modes)) add(mode)
        add(service.carGap)
        add(service.bikeGain)
      }
    }
    if (section.evidence?.kind === 'sharing-networks') {
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

function text(value: string): TextSegment {
  return { kind: 'text', value }
}

function emphasis(value: string): TextSegment {
  return { kind: 'emphasis', tone: 'theme', value }
}

function regionalEmphasis(value: string): TextSegment {
  return { kind: 'emphasis', tone: 'region', value }
}

function bold(value: string, tone: TextEmphasisTone = 'default'): TextSegment {
  return { kind: 'emphasis', tone, value }
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
  if (comparison.scope.label) return comparison.scope.label
  switch (comparison.scope.kind) {
    case 'communes-densite':
      return null
    case 'communes-epci':
      return territory.epciName
        ? `communes de ${territory.epciName}`
        : 'communes de l’EPCI'
    case 'communes-bretagne':
      return 'communes bretonnes'
    case 'epcis-bretagne':
      return 'EPCI bretons'
    case 'departements-bretagne':
      return 'départements bretons'
  }
}

function comparisonLabel(
  comparison: ComparisonContext | null,
  territory: TerritoryIdentity,
  statistic: 'moyenne' | 'médiane' =
    comparison?.reference?.kind === 'mean' ? 'moyenne' : 'médiane',
): string | null {
  const scopeLabel = comparisonScopeLabel(comparison, territory)
  if (!scopeLabel) return null
  return comparison?.reference
    ? `${statistic} des ${scopeLabel}`
    : `Comparaison indisponible — ${statistic} des ${scopeLabel}`
}

function statisticForFact(fact: NumericFact): 'moyenne' | 'médiane' {
  return fact.key.startsWith('avg_') || fact.comparison?.reference?.kind === 'mean'
    ? 'moyenne'
    : 'médiane'
}

function formatMillions(value: number): string {
  if (Math.abs(value) < 1_000_000) return formatNumber(value)
  const millions = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 }).format(
    value / 1_000_000,
  )
  return `${millions} millions`
}

function introductionFor(facts: TerritoryFacts): readonly TextBlock[] {
  const blocks: TextBlock[] = [
    [
      text('Cette page illustre les différences d’accès aux services selon le mode de déplacement : voiture, vélo et marche, transports en commun inclus. Elle présente les résultats d’une analyse qui cartographie les équipements accessibles en '),
      emphasis('20 minutes'),
      text(' autour de chaque bâtiment résidentiel breton.'),
    ],
  ]
  const total = facts.mobility.access.totalBrittanyBuildings
  const territory = facts.mobility.access.totalBuildings
  if (complete(total) && complete(territory)) {
    blocks.push([
      regionalEmphasis(formatMillions(total.value)),
      text(' de bâtiments sont pris en compte en Bretagne, dont '),
      emphasis(formatNumber(territory.value)),
      text(` ${territoryLead(facts.territory, false)}.`),
    ])
  }
  return blocks
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

function territoryLead(territory: TerritoryIdentity, capitalized = true): string {
  const parts = territoryLeadParts(territory, capitalized)
  return `${parts.lead} ${parts.name}`
}

function profilesFigureLecture(
  profiles: readonly BpeAccessProfileFact[],
  territory: TerritoryIdentity,
): readonly TextBlock[] {
  const example = profiles
    .filter((profile) => profile.comparison?.reference !== null)
    .sort((a, b) => b.count - a.count)[0]
  return [[
    text('Chaque colonne indique le nombre de types d’équipements BPE classés dans un profil d’accès. Les quatre profils sont exclusifs : chaque type n’est compté qu’une seule fois.'),
  ], ...(example?.comparison?.reference ? [[
    text(`Exemple : ${formatNumber(example.count)} types d’équipements sont classés « ${example.label} » dans ${territory.name}, contre ${formatNumber(example.comparison.reference.value)} en moyenne dans le groupe comparé.`),
  ]] : [])]
}

function lectureProfils(): Lecture {
  return {
    marelle: 'Service minimum ?',
    prose: [[
      text('Un profil d’accès regroupe les types d’équipements BPE selon le premier mode qui permet à au moins un quart des bâtiments de les atteindre.'),
    ]],
  }
}

function summaryFigureLecture(summary: MobiliteSummaryFacts): readonly TextBlock[] {
  const loss = narrativeValue(summary.averageLosses.diversity.walkTransit)
  const comparison = summary.averageLosses.diversity.walkTransit.comparison?.reference?.value ?? null
  return [[
    text('La figure compare, pour chaque mode, le nombre moyen d’équipements accessibles par bâtiment et le nombre moyen de types différents. Les pertes sont calculées par rapport à la voiture.'),
  ], ...(loss !== null && loss >= 0 && comparison !== null ? [[
    text(`Exemple : à pied ou en transports en commun, un bâtiment accède en moyenne à ${formatNumber(loss)} types d’équipements de moins qu’en voiture, contre ${formatNumber(comparison)} dans le groupe comparé.`),
  ]] : [])]
}

function lectureEssentiels(): Lecture {
  return {
    marelle: 'Tous les services ne se valent pas...',
    prose: [[
      text('Les services essentiels regroupent des catégories d’équipements issues de la BPE.'),
    ]],
  }
}

function essentialsFigureLecture(facts: TerritoryFacts): readonly TextBlock[] {
  const examples = SERVICE_GRAMMAR.flatMap(({ key, label }) => {
    const fact = facts.mobility.access.byService[key].walkTransit
    const value = narrativeValue(fact)
    const comparison = fact.comparison?.reference?.value ?? null
    return value !== null && comparison !== null
      ? [{ label, value, comparison, gap: Math.abs(value - comparison) }]
      : []
  })
  const example = examples.reduce<typeof examples[number] | null>((best, item) => !best || item.gap > best.gap ? item : best, null)
  return [[
    text('Chaque anneau indique la part des bâtiments qui peuvent atteindre un regroupement de services en vingt minutes, pour chaque mode.'),
  ], ...(example ? [[
    text(`Exemple : à pied ou en transports en commun, ${formatNumber(example.value * 100)} % des bâtiments accèdent au regroupement « ${example.label} », contre ${formatNumber(example.comparison * 100)} % dans le groupe comparé.`),
  ]] : [])]
}

function buildingDistributionFigureLecture(
  distribution: MobiliteBuildingDistribution | null,
  territory: TerritoryIdentity,
): readonly TextBlock[] {
  const cells = distribution?.availability === 'complete'
    ? [...distribution.cells]
      .filter((candidate) => candidate.comparisonShare !== null)
      .sort((a, b) => b.share - a.share || a.breadthBucket.localeCompare(b.breadthBucket) || a.depthBucket.localeCompare(b.depthBucket))
    : []
  const cell = cells[0]
  const breadth = distribution?.breadthBins.find((bin) => bin.key === cell?.breadthBucket)
  const depth = distribution?.depthBins.find((bin) => bin.key === cell?.depthBucket)
  return [[
    text('Chaque case regroupe les bâtiments qui accèdent, en vingt minutes, à une même tranche de types d’équipements et d’équipements au total. Plus la case est foncée, plus leur part est élevée. Les triangles situent le territoire et le groupe comparé.'),
  ], ...(cell && cell.share > 0 && cell.comparisonShare !== null && breadth && depth ? [[
    text(`Exemple : ${formatNumber(cell.share * 100)} % des bâtiments de ${territory.name} accèdent à ${breadth.label} types et ${depth.label} équipements, contre ${formatNumber(cell.comparisonShare * 100)} % des bâtiments du groupe comparé.`),
  ]] : [])]
}

function accessRampFigureLecture(ramp: MobiliteAccessRamp | null): readonly TextBlock[] {
  const example = ramp?.availability === 'complete' ? ramp.curves.walkTransit.points.find((point) => point.quantile === 0.5) : null
  return [[
    text('Pour chaque mode, la courbe classe les bâtiments du moins au plus grand nombre de types accessibles en vingt minutes. Les courbes du territoire et du groupe comparé suivent la même échelle.'),
  ], ...(example?.comparisonAccessibleTypes !== null && example?.comparisonAccessibleTypes !== undefined ? [[
    text(`Exemple : à pied ou en transports en commun, la moitié des bâtiments accèdent à au plus ${formatNumber(example.accessibleTypes)} types, contre ${formatNumber(example.comparisonAccessibleTypes)} dans le groupe comparé.`),
  ]] : [])]
}

function buildingComparisonPopulationLabel(
  rawLabel: string | null,
): string | null {
  if (!rawLabel) return null
  if (rawLabel === 'communes bretonnes') {
    return 'bâtiments de Bretagne'
  }
  if (rawLabel.startsWith('communes de ')) {
    return `bâtiments de ${rawLabel.slice('communes de '.length)}`
  }
  return rawLabel
}

function distributionSection(facts: TerritoryFacts): DistributionAccesParBatimentSection {
  const buildingDistribution = facts.mobility.buildingDistribution
  const accessRamp = facts.mobility.accessRamp
  const rawComparisonLabel = buildingDistribution?.comparisonLabel ?? accessRamp?.comparisonLabel ?? null
  const hasAny = buildingDistribution !== null || accessRamp !== null
  const evidence: DistributionEvidence | null = hasAny
    ? {
        kind: 'distribution',
        buildingDistribution,
        accessRamp,
        comparisonPopulationLabel: buildingComparisonPopulationLabel(rawComparisonLabel),
        buildingDistributionLecture: buildingDistributionFigureLecture(buildingDistribution, facts.territory),
        accessRampLecture: accessRampFigureLecture(accessRamp),
      }
    : null
  const availability: FactAvailability =
    !hasAny
      ? 'absent'
      : evidence !== null &&
          (buildingDistribution === null || buildingDistribution.availability === 'complete') &&
          (accessRamp === null || accessRamp.availability === 'complete')
        ? 'complete'
        : 'incomplete'
  return {
    key: 'distribution-acces-par-batiment',
    label: "Distribution de l'accès par bâtiment",
    availability,
    indicators: [],
    evidence,
    provenance: [
      ...(buildingDistribution?.provenance?.sourceId ? [buildingDistribution.provenance.sourceId] : []),
      ...(accessRamp?.provenance?.sourceId ? [accessRamp.provenance.sourceId] : []),
    ].filter((sourceId, index, sourceIds) => sourceIds.indexOf(sourceId) === index),
    lecture: availability === 'complete'
      ? { marelle: '... Tous les bâtiments non plus', prose: [] }
      : null,
    explorationTargets: [],
  }
}

function contentModes(
  modes: MobiliteAccessModes,
  labels: Record<MobiliteAccessMode, string> = MOBILITE_MODE_LABELS,
): ContentModeFacts {
  return {
    car: contentFact(modes.car, labels.car),
    bike: contentFact(modes.bike, labels.bike),
    walkTransit: contentFact(modes.walkTransit, labels.walkTransit),
  }
}

function summarySection(facts: TerritoryFacts): ResumeSection {
  const summary = facts.mobility.access.summary
  const diversityWalkTransit = facts.mobility.losses.diversityWalkTransit
  const diversityBike = facts.mobility.losses.diversityBike
  const totalWalkTransit = indicatorFor(facts, 'tot_loss_t') ?? absentFact('tot_loss_t', 'accès perdus')
  const totalBike = indicatorFor(facts, 'tot_loss_b') ?? absentFact('tot_loss_b', 'accès perdus')
  const accessibleEquipment = contentModes(summary.accessibleEquipment)
  const accessibleTypes = contentModes(summary.accessibleTypes)
  const typeCount = facts.mobility.bpeAccess.profiles.length > 0
    ? facts.mobility.bpeAccess.profiles.reduce((total, profile) => total + profile.count, 0)
    : null
  const inaccessibleTypes = typeCount === null
    ? contentFact(absentFact('inaccessible_types', 'types d’équipement / bâtiment'), 'Inaccessible')
    : inaccessibleFact(
        typeCount,
        accessibleTypes.car.fact,
        'inaccessible_types',
        'types d’équipement / bâtiment',
      )
  const averageLosses = {
    diversity: {
      walkTransit: contentFact(summary.averageLosses.diversity.walkTransit, 'Perte de diversité — à pied + TC'),
      bike: contentFact(summary.averageLosses.diversity.bike, 'Perte de diversité — à vélo + TC'),
    },
    total: {
      walkTransit: contentFact(summary.averageLosses.total.walkTransit, 'Perte totale d’accès — à pied + TC'),
      bike: contentFact(summary.averageLosses.total.bike, 'Perte totale d’accès — à vélo + TC'),
    },
  }
  const losses = {
    diversity: {
      walkTransit: contentFact(diversityWalkTransit, CONTENT_LABELS.div_loss_t),
      bike: contentFact(diversityBike, CONTENT_LABELS.div_loss_b),
    },
    total: {
      walkTransit: contentFact(totalWalkTransit, CONTENT_LABELS.tot_loss_t),
      bike: contentFact(totalBike, CONTENT_LABELS.tot_loss_b),
    },
  }
  const summaryFacts = [
    ...Object.values(accessibleEquipment),
    ...Object.values(accessibleTypes),
    ...Object.values(averageLosses.diversity),
    ...Object.values(averageLosses.total),
    losses.diversity.walkTransit,
    losses.diversity.bike,
    losses.total.walkTransit,
    losses.total.bike,
  ]
  const comparisonFact = summaryFacts.find((fact) => fact.fact.comparison)
  const completeSummary = summaryFacts.every((value) => complete(value.fact))
  const hasAny = summaryFacts.some((value) => hasValue(value.fact))
  const indicators = [
    ...Object.values(accessibleEquipment),
    ...Object.values(accessibleTypes),
    losses.diversity.walkTransit,
    losses.diversity.bike,
    losses.total.walkTransit,
    losses.total.bike,
  ].filter(({ fact }) => hasValue(fact))
  return {
    key: 'resume',
    label: 'Résumé',
    availability: !hasAny ? 'absent' : completeSummary ? 'complete' : 'incomplete',
    indicators,
    evidence: hasAny
      ? {
          kind: 'summary',
          legend: mobiliteAccessLegend(typeCount !== null),
          accessibleEquipment,
          accessibleTypes,
          inaccessibleTypes,
          averageLosses,
          typeCount,
          comparisonLabel: comparisonLabel(
            comparisonFact?.fact.comparison ?? null,
            facts.territory,
            comparisonFact ? statisticForFact(comparisonFact.fact) : undefined,
          ),
          figureLecture: summaryFigureLecture(summary),
          losses,
        }
      : null,
    provenance: sourceIdsFor(summaryFacts),
    lecture: hasAny ? { marelle: 'Ce que l’on perd sans voiture', prose: [] } : null,
    explorationTargets: targetsFor(indicators.map((indicator) => indicator.fact), facts.territory),
  }
}

function accessEvidence(facts: TerritoryFacts): AccessEvidence | null {
  if (facts.mobility.access.availability === 'absent') return null
  return {
    kind: 'access',
    legend: mobiliteAccessLegend(false),
    totalBuildings: contentFact(
      facts.mobility.access.totalBuildings,
      'Bâtiments du territoire analysés',
    ),
    totalBrittanyBuildings: contentFact(
      facts.mobility.access.totalBrittanyBuildings,
      'Bâtiments bretons analysés',
    ),
    services: SERVICE_GRAMMAR.map(({ key, label }) => ({
      service: key,
      label,
      modes: {
        car: contentFact(facts.mobility.access.byService[key].car, MOBILITE_MODE_LABELS.car),
        bike: contentFact(facts.mobility.access.byService[key].bike, MOBILITE_MODE_LABELS.bike),
        walkTransit: contentFact(
          facts.mobility.access.byService[key].walkTransit,
          MOBILITE_MODE_LABELS.walkTransit,
        ),
      },
      carGap: contentFact(
        facts.mobility.access.gapsByService[key].carGap,
        'Écart voiture',
      ),
      bikeGain: contentFact(
        facts.mobility.access.gapsByService[key].bikeGain,
        'Apport du vélo',
      ),
    })),
    comparisonLabel: comparisonLabel(
      Object.values(facts.mobility.access.byService)
        .flatMap((modes) => Object.values(modes))
        .find((fact) => fact.comparison)?.comparison ?? null,
      facts.territory,
    ),
    figureLecture: essentialsFigureLecture(facts),
  }
}

function essentialsSection(facts: TerritoryFacts): ServicesEssentielsSection {
  const indicators = indicatorsFor(facts, ESSENTIAL_INDICATOR_KEYS)
  const evidence = accessEvidence(facts)
  const allIndicatorsComplete =
    indicators.length === ESSENTIAL_INDICATOR_KEYS.length &&
    indicators.every((indicator) => complete(indicator.fact))
  const allAccessComplete =
    evidence !== null &&
    complete(evidence.totalBuildings.fact) &&
    complete(evidence.totalBrittanyBuildings.fact) &&
    evidence.services.every((service) =>
      [...Object.values(service.modes), service.carGap, service.bikeGain].every((fact) =>
        complete(fact.fact),
      ),
    )
  const hasAny = indicators.length > 0 || evidence !== null
  const availability: FactAvailability =
    !hasAny
      ? 'absent'
      : allIndicatorsComplete && allAccessComplete
        ? 'complete'
        : 'incomplete'
  const contentFacts: ContentFact[] = [...indicators]
  if (evidence) {
    contentFacts.push(evidence.totalBuildings, evidence.totalBrittanyBuildings)
    for (const service of evidence.services) {
      contentFacts.push(...Object.values(service.modes), service.carGap, service.bikeGain)
    }
  }
  return {
    key: 'services-essentiels',
    label: 'Services essentiels',
    availability,
    indicators,
    evidence,
    provenance: sourceIdsFor(contentFacts),
    lecture: availability === 'complete' && evidence ? lectureEssentiels() : null,
    explorationTargets: targetsFor(
      indicators.map((indicator) => indicator.fact),
      facts.territory,
    ),
  }
}

function comparisonLabelForFacts(
  values: readonly ContentFact[],
  territory: TerritoryIdentity,
): string | null {
  const comparison = values.find((value) => value.fact.comparison)?.fact.comparison ?? null
  return comparisonLabel(comparison, territory)
}

function sharingNetworksSection(facts: TerritoryFacts): ReseauxSection {
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
  const allFacts = [...networkFacts, roadSurface]
  const indicators = [
    ...indicatorsFor(facts, SHARING_NETWORK_INDICATOR_KEYS),
    ...indicatorsFor(facts, ['surface_reseaux_routiers']),
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

function profilesSection(facts: TerritoryFacts): ProfilsAccesParModeSection {
  const profiles = facts.mobility.bpeAccess.profiles
  const comparisonLabelForFigure = comparisonLabel(
    profiles.find((profile) => profile.comparison?.reference)?.comparison ?? null,
    facts.territory,
    'moyenne',
  )
  const availability: FactAvailability =
    facts.mobility.bpeAccess.availability === 'incomplete'
      ? 'incomplete'
      : profiles.length > 0
        ? 'complete'
        : 'absent'
  const evidence: BpeProfilesEvidence | null =
    profiles.length > 0
        ? {
           kind: 'bpe-profiles',
          profiles,
          territoryName: facts.territory.name,
          donutTooltipTitle: '% des bâtiments ayant accès',
          totalTypes:
            availability === 'complete'
              ? profiles.reduce((total, profile) => total + profile.count, 0)
              : null,
          comparisonLabel: comparisonLabelForFigure,
           figureLecture: profilesFigureLecture(
             availability === 'complete' ? profiles : [],
             facts.territory,
           ),
        }
      : null
  return {
    key: 'profils-acces-par-mode',
    label: 'Profils d’accès par mode',
    availability,
    indicators: [],
    evidence,
    provenance: [],
    lecture: availability === 'complete'
      ? lectureProfils()
      : null,
    explorationTargets: [],
  }
}

/** Only complete, finite facts can support a narrative claim. */
function narrativeValue(fact: NumericFact): number | null {
  return fact.availability === 'complete' && fact.value !== null && Number.isFinite(fact.value) ? fact.value : null
}

function walkingDistributionFinding(distribution: MobiliteBuildingDistribution | null): TextBlock | null {
  if (distribution?.availability !== 'complete') return null
  const zeroShare = distribution.cells
    .filter((cell) =>
      distribution.breadthBins.some((bin) => bin.key === cell.breadthBucket && bin.min === 0 && bin.max === 0) &&
      distribution.depthBins.some((bin) => bin.key === cell.depthBucket && bin.min === 0 && bin.max === 0),
    )
    .reduce((sum, cell) => sum + cell.share, 0)
  const nonEmptyCells = distribution.cells
    .filter((cell) => cell.share > 0)
    .sort((a, b) => b.share - a.share)
  const top = nonEmptyCells[0]
  if (!top) return null
  const breadthIndex = distribution.breadthBins.findIndex((bin) => bin.key === top.breadthBucket)
  const depthIndex = distribution.depthBins.findIndex((bin) => bin.key === top.depthBucket)
  const highCells = distribution.cells.filter((cell) => {
    const breadth = distribution.breadthBins.findIndex((bin) => bin.key === cell.breadthBucket)
    const depth = distribution.depthBins.findIndex((bin) => bin.key === cell.depthBucket)
    return breadth === distribution.breadthBins.length - 1 && depth >= distribution.depthBins.length - 2
  })
  const highShare = highCells.reduce((sum, cell) => sum + cell.share, 0)
  const lowAccess = breadthIndex <= 1
  if (zeroShare > 0.5) {
    return [text('Pour une majorité des bâtiments, l’accès à pied ou en transports en commun reste très limité.')]
  }
  if (zeroShare > 0.25) {
    return [text('Une part importante des bâtiments reste très limitée dans son accès à pied ou en transports en commun.')]
  }
  if (highShare >= 0.6) {
    return [text('Cette accessibilité à pied est largement partagée entre les bâtiments.')]
  }
  if (lowAccess && top.share >= 0.5) {
    return [text('Pour la plupart des bâtiments, l’accès à pied ou en transports en commun reste cantonné à une offre limitée.')]
  }
  if (breadthIndex >= distribution.breadthBins.length - 2 && depthIndex >= distribution.depthBins.length - 2 && top.share >= 0.4) {
    return [text('Une large part des bâtiments conserve un accès piéton étendu, même si cette situation ne se retrouve pas partout.')]
  }
  if (nonEmptyCells.length >= 2 && top.share >= 0.4) {
    return [text('L’accès à pied ou en transports en commun forme un socle pour une partie des bâtiments, mais ne se retrouve pas partout.')]
  }
  return null
}

// These are semantic bands, not claims shown to the reader. They are deliberately
// not the Services essentiels threshold: retention compares one mode with the
// territory's own car access. Three quarters of the car-accessible range is a
// broad diversity; half of the car-accessible establishments is a broad volume.
// Keeping the dimensions separate is what makes the hub reading possible.
const RUNDOWN_STRONG_DIVERSITY_RETENTION = 0.75
const RUNDOWN_STRONG_VOLUME_RETENTION = 0.5
const RUNDOWN_LOW_RETENTION = 0.5
const RUNDOWN_BIKE_RECOVERY = 0.33
const RUNDOWN_BIKE_GAIN = 0.15
const RUNDOWN_LIMITED_TYPES = 15
const RUNDOWN_LIMITED_EQUIPMENT = 100
const RUNDOWN_BUILDING_SPREAD = 15
const RUNDOWN_CAR_SPREAD_RATIO = 0.5

type AccessDimension = 'types' | 'equipment'
type AccessProfile = Record<AccessDimension, number>

function accessProfile(summary: MobiliteSummaryFacts, mode: MobiliteAccessMode): AccessProfile | null {
  const types = narrativeValue(summary.accessibleTypes[mode])
  const equipment = narrativeValue(summary.accessibleEquipment[mode])
  return types !== null && equipment !== null ? { types, equipment } : null
}

function retention(profile: AccessProfile, car: AccessProfile, dimension: AccessDimension): number {
  return car[dimension] > 0 ? profile[dimension] / car[dimension] : 0
}

function averageRecovery(
  bike: AccessProfile,
  walk: AccessProfile,
  car: AccessProfile,
): number {
  const recoveries = (['types', 'equipment'] as const).flatMap((dimension) => {
    const gap = car[dimension] - walk[dimension]
    return gap > 0 ? [(bike[dimension] - walk[dimension]) / gap] : []
  })
  return recoveries.length > 0 ? recoveries.reduce((sum, value) => sum + value, 0) / recoveries.length : 0
}

function hasStrongWalkingAccess(walk: AccessProfile, car: AccessProfile): boolean {
  return walk.types >= RUNDOWN_LIMITED_TYPES &&
    retention(walk, car, 'types') >= RUNDOWN_STRONG_DIVERSITY_RETENTION &&
    retention(walk, car, 'equipment') >= RUNDOWN_STRONG_VOLUME_RETENTION
}

function hasHubWalkingAccess(walk: AccessProfile, car: AccessProfile): boolean {
  return walk.types >= RUNDOWN_LIMITED_TYPES &&
    retention(walk, car, 'types') >= RUNDOWN_STRONG_DIVERSITY_RETENTION &&
    retention(walk, car, 'equipment') < RUNDOWN_STRONG_VOLUME_RETENTION
}

function hasLimitedAccess(car: AccessProfile, bike: AccessProfile, walk: AccessProfile): boolean {
  return [car, bike, walk].every((profile) =>
    profile.types < RUNDOWN_LIMITED_TYPES && profile.equipment < RUNDOWN_LIMITED_EQUIPMENT,
  )
}

function hasCarDependence(walk: AccessProfile, bike: AccessProfile, car: AccessProfile): boolean {
  return retention(walk, car, 'types') < RUNDOWN_LOW_RETENTION &&
    retention(walk, car, 'equipment') < RUNDOWN_LOW_RETENTION &&
    retention(bike, car, 'types') < RUNDOWN_LOW_RETENTION &&
    retention(bike, car, 'equipment') < RUNDOWN_LOW_RETENTION
}

function hasBikeBridge(walk: AccessProfile, bike: AccessProfile, car: AccessProfile): boolean {
  return averageRecovery(bike, walk, car) >= RUNDOWN_BIKE_RECOVERY &&
    (bike.types - walk.types) / Math.max(car.types, 1) >= RUNDOWN_BIKE_GAIN &&
    (bike.equipment - walk.equipment) / Math.max(car.equipment, 1) >= RUNDOWN_BIKE_GAIN
}

type RundownFindingKey = 'hub' | 'walking' | 'bike-bridge' | 'car-dependent' | 'limited' | 'mixed'

interface RundownFinding {
  key: RundownFindingKey
  priority: number
  prose: TextBlock
}

function hubFinding(territory: TerritoryIdentity): RundownFinding {
  return {
    key: 'hub',
    priority: 100,
    prose: [
      text(`${territoryLead(territory)}, `),
      bold('la marche et les transports en commun', 'foot'),
      text(' donnent accès à une gamme de services déjà diversifiée. Sans voiture, la perte porte surtout sur le choix entre plusieurs établissements de ces mêmes types.'),
    ],
  }
}

function hubDepthFinding(): TextBlock {
  return [text('La voiture apporte donc une plus grande '), bold('profondeur d’offre'), text('.')]
}

function walkingFinding(territory: TerritoryIdentity): RundownFinding {
  return {
    key: 'walking',
    priority: 95,
    prose: [
      text(`${territoryLead(territory)}, `),
      bold('la marche et les transports en commun', 'foot'),
      text(' donnent accès à une gamme de services étendue. La voiture élargit encore l’offre, mais '),
      bold('l’accès sans voiture reste largement possible'),
      text('.'),
    ],
  }
}

function bikeBridgeFinding(territory: TerritoryIdentity): RundownFinding {
  return {
    key: 'bike-bridge',
    priority: 85,
    prose: [
      text(`${territoryLead(territory)}, `),
      bold('le vélo', 'bike'),
      text(' offre un véritable relais entre la marche et la voiture. Il élargit nettement l’offre accessible sans retrouver toute l’amplitude de la '),
      bold('voiture', 'car'),
      text('.'),
    ],
  }
}

function carDependenceFinding(territory: TerritoryIdentity): RundownFinding {
  return {
    key: 'car-dependent',
    priority: 80,
    prose: [
      text(`${territoryLead(territory)}, `),
      bold('la voiture', 'car'),
      text(' structure largement l’accès aux services. Elle donne accès à la fois à une gamme plus large et à davantage d’établissements. Les autres modes ne prennent pas vraiment le relais.'),
    ],
  }
}

function limitedAccessFinding(territory: TerritoryIdentity): RundownFinding {
  return {
    key: 'limited',
    priority: 110,
    prose: [
      text(`${territoryLead(territory)}, `),
      bold('l’offre accessible reste limitée quel que soit le mode'),
      text('. La voiture améliore peu la gamme disponible, ce qui décrit moins une dépendance automobile qu’un faible volume de services atteignables.'),
    ],
  }
}

function mixedFinding(territory: TerritoryIdentity): RundownFinding {
  return {
    key: 'mixed',
    priority: 10,
    prose: [
      text(`${territoryLead(territory)}, les modes ne produisent pas la même forme d’accès. `),
      bold('La voiture', 'car'),
      text(' ouvre l’offre la plus large, tandis que '),
      bold('la marche et les transports en commun', 'foot'),
      text(' conservent une partie de la diversité accessible.'),
    ],
  }
}

function spreadFinding(ramp: MobiliteAccessRamp | null): TextBlock | null {
  if (ramp?.availability !== 'complete') return null
  const readings = (['walkTransit', 'bike', 'car'] as const).map((mode) => {
    const curve = ramp.curves[mode]
    const low = curve.points.find((point) => point.quantile === 0.1)?.accessibleTypes
    const high = curve.points.find((point) => point.quantile === 0.9)?.accessibleTypes
    return { mode, low, high, spread: low !== undefined && high !== undefined ? high - low : 0 }
  })
  const walking = readings.find((reading) => reading.mode === 'walkTransit')!
  const cycling = readings.find((reading) => reading.mode === 'bike')!
  const driving = readings.find((reading) => reading.mode === 'car')!
  if (walking.spread >= RUNDOWN_BUILDING_SPREAD && cycling.spread >= RUNDOWN_BUILDING_SPREAD && driving.spread < RUNDOWN_CAR_SPREAD_RATIO * Math.min(walking.spread, cycling.spread)) {
    return [text('L’accès à pied et à vélo varie fortement selon les bâtiments, alors que la voiture est plus homogène.')]
  }
  const selected = readings.reduce((best, reading) => reading.spread > best.spread ? reading : best)
  if (selected.spread <= 0) return null
  const prose = selected.mode === 'walkTransit'
    ? 'Même cet accès à pied ou en transports en commun varie fortement selon les bâtiments.'
    : selected.mode === 'bike'
      ? 'Le relais du vélo ne produit toutefois pas la même amélioration pour tous les bâtiments.'
      : 'La voiture ne gomme toutefois pas toutes les différences entre les bâtiments.'
  return selected.spread > 0
    ? [text(prose)]
    : null
}

function bikeVolumeCompensationFinding(
  walk: AccessProfile,
  bike: AccessProfile,
  car: AccessProfile,
): TextBlock | null {
  const recoveries = (['types', 'equipment'] as const).map((dimension) => {
    const gap = car[dimension] - walk[dimension]
    return gap > 0 ? (bike[dimension] - walk[dimension]) / gap : 0
  })
  const volumeRecovery = recoveries[1]!
  const volumeGain = (bike.equipment - walk.equipment) / Math.max(car.equipment, 1)
  if (volumeRecovery < 0.25 || volumeGain < 0.15) return null
  return [
    bold('Le vélo', 'bike'),
    text(' compense une partie du volume perdu, sans retrouver toute la profondeur de l’offre.'),
  ]
}

function bikeAggregateFinding(
  walk: AccessProfile,
  bike: AccessProfile,
): TextBlock | null {
  if (bike.types <= walk.types || bike.equipment <= walk.equipment) return null
  return [
    bold('Le vélo', 'bike'),
    text(' élargit l’offre accessible sans voiture, mais reste en dessous de la voiture pour la gamme comme pour le nombre d’établissements.'),
  ]
}

function mobiliteRundown(facts: TerritoryFacts): readonly TextBlock[] {
  const summary = facts.mobility.access.summary
  const car = accessProfile(summary, 'car')
  const bike = accessProfile(summary, 'bike')
  const walk = accessProfile(summary, 'walkTransit')
  if (!car || !bike || !walk) {
    return [[text('Les données disponibles ne permettent pas de dégager une lecture d’ensemble de l’accès aux services.')]]
  }
  const findings: RundownFinding[] = []
  if (hasLimitedAccess(car, bike, walk)) findings.push(limitedAccessFinding(facts.territory))
  if (hasHubWalkingAccess(walk, car)) findings.push(hubFinding(facts.territory))
  if (hasStrongWalkingAccess(walk, car)) findings.push(walkingFinding(facts.territory))
  if (hasBikeBridge(walk, bike, car)) findings.push(bikeBridgeFinding(facts.territory))
  if (hasCarDependence(walk, bike, car)) findings.push(carDependenceFinding(facts.territory))
  if (findings.length === 0) findings.push(mixedFinding(facts.territory))

  const anchor = findings.sort((a, b) => b.priority - a.priority)[0]!
  const distribution = walkingDistributionFinding(facts.mobility.buildingDistribution)
  const spread = spreadFinding(facts.mobility.accessRamp)
  const complements: TextBlock[] = []
  if (anchor.key === 'hub' || anchor.key === 'walking') {
    if (distribution) complements.push(distribution)
    if (anchor.key === 'hub') complements.push(hubDepthFinding())
    const bikeVolume = bikeVolumeCompensationFinding(walk, bike, car)
    if (bikeVolume) complements.push(bikeVolume)
  } else if (anchor.key === 'bike-bridge') {
    if (distribution) complements.push(distribution)
    if (spread) complements.push(spread)
  } else if (anchor.key === 'car-dependent') {
    if (distribution) complements.push(distribution)
  } else if (anchor.key === 'limited') {
    if (distribution) complements.push(distribution)
  } else {
    const bikeAggregate = bikeAggregateFinding(walk, bike)
    if (bikeAggregate) complements.push(bikeAggregate)
    if (spread) complements.push(spread)
  }
  return [complements.reduce((prose, complement) => [...prose, text(' '), ...complement], anchor.prose)]
}

export function resolveMobiliteThemeContent(facts: TerritoryFacts): ThemeContent {
  const accessSections = [
    summarySection(facts),
    profilesSection(facts),
    essentialsSection(facts),
    distributionSection(facts),
  ] as const
  const sharingSections = [
    sharingNetworksSection(facts),
    sharingCyclingOfferSection(facts),
    sharingParkingSection(facts),
  ] as const
  const accessUnit: AccesAuxServicesContentUnit = {
    key: 'acces-aux-services',
    label: 'Accès aux services',
    introduction: introductionFor(facts),
    rundown: mobiliteRundown(facts),
    sections: accessSections,
  }
  const sharingUnit: PartageEspacePublicContentUnit = {
    key: 'partage-de-lespace-public',
    label: 'Partage de l’espace public',
    introduction: sharingIntroduction(),
    rundown: sharingRundown(facts),
    sections: sharingSections,
  }

  return {
    theme: 'mobilite',
    label: 'Mobilité',
    territory: facts.territory,
    introduction: accessUnit.introduction,
    units: [accessUnit, sharingUnit],
    sourceRegister: registerFor([...accessSections, ...sharingSections]),
  }
}
