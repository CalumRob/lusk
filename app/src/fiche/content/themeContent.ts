import type { ThemeMetadata, TrajectoryMetadata } from '@/payload/types'
import type { AedarFact } from './aedarApiClient'
import type {
  ComparisonRank,
  FactAvailability,
  FactProvenance,
  NumericFact,
  SelectedTrajectoryComparison,
  TerritoryFacts,
  TerritoryIdentity,
} from './territoryFacts'
import { CONTENU_SOUS_GROUPES_FICHE } from './ficheGrammar'
import {
  buildMobiliteNetworksSection,
  buildMobiliteRaccordementSection,
  buildMobiliteShareSection,
  buildMobiliteStationnementRavitaillementSection,
  buildPartageSubtitle,
} from './mobiliteSections'

export interface ContentSource {
  id: string
  source: string
  version: string
  referenceDate: string | null
  publicationDate: string | null
  /**
   * App-owned compact-stamp precision (#1006). Set when the served version is
   * an opaque dataset token and the stamp states the month of the actual
   * source clock instead; `version` and both dates stay the producer's facts.
   */
  displayVersion?: string
  /** Producer-owned public URL of the source record, when published. */
  url?: string | null
  /** Producer-owned licence wording of the source record, when published. */
  licence?: string | null
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
  rankDirection?: 'high' | 'low' | null
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
  reference?: import('./aedarAccessSection').AedarEquipmentReferenceTarget | null
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
  /** Display noun for the distribution's count values (accessible readings only; the producer declares no unit). */
  distributionValueUnit: string
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
  /** Producer-served ordinal per mode and horizon for the compared reading; never derived locally. */
  referenceRanks?: Readonly<Record<AedarRampMode, readonly (ComparisonRank | null)[]>> | null
  /** Explicit reference-territory label (e.g. an EPCI or region name), never a fabricated cohort. */
  referenceLabel: string | null
  availability: FactAvailability
  provenance: FactProvenance | null
  sourceCoverage: string
}
/** Semantic inks a Mobilité bar category may draw with. */
export type MobiliteBarTone = 't' | 'b' | 'c' | 'neutral' | 'brand'

export interface MobiliteBarSegmentEvidence {
  key: string
  label: string
  /**
   * App-owned legend identity of the drawn segment, when the legend must name it
   * in full rather than repeat the producer's tooltip label (#974).
   */
  legendLabel?: string
  /** Per-segment density; its sum is the category total by producer contract. */
  value: ContentFact
  /** Published raw segment length carried in the tooltip only, when declared. */
  rawValue: ContentFact | null
}

export interface MobiliteBarCategoryEvidence {
  key: string
  label: string
  /** Short producer-derived axis label (for example « à pied »). */
  axisLabel: string
  tone: MobiliteBarTone
  /** The plotted /1 000 hab (or per-unit) value. */
  value: ContentFact
  /** Published raw value carried in the tooltip only, never in the plotted axis. */
  rawValue: ContentFact | null
  /** Optional partition of the category bar; absent means an unsegmented bar. */
  segments: readonly MobiliteBarSegmentEvidence[]
  /** Honest note when a declared split cannot be drawn as a partition. */
  splitNote: string | null
  /**
   * #997 — the compared bar is drawn as the same protected/shared stack because
   * the served means share one eligible population and recompose the total.
   */
  comparisonSplit?: boolean
  /** Honest note when a served mean split cannot be drawn as one partition. */
  comparisonSplitNote?: string | null
}

export interface MobiliteBarsFigureEvidence {
  figureTitle: string
  unit: string
  xAxisTitle: string
  yAxisTitle: string
  categories: readonly MobiliteBarCategoryEvidence[]
  /** Resolved statistic + scope label of the compared group, never a generic peer. */
  comparisonLabel: string | null
  /** Declared publications whose focal value could not be read for this figure. */
  unavailableResources?: readonly string[]
  /** Declared comparisons whose bounded read failed or could not be bound. */
  unavailableComparisons?: readonly string[]
}

export interface MobiliteRatioEvidence {
  label: string
  value: ContentFact
  /** Honest unavailable explanation when the ratio cannot be computed. */
  note: string | null
}

export interface MobiliteNetworksEvidence {
  kind: 'mobilite-networks'
  territory: { code: string; name: string }
  territoryName: string
  mapFigureTitle: string
  figure: MobiliteBarsFigureEvidence
  prose: readonly TextBlock[]
  sources: readonly ContentSource[]
}

export interface MobilitePairedColumnEvidence {
  key: 'stationnement' | 'ravitaillement'
  prose: readonly TextBlock[]
  sources: readonly ContentSource[]
  bars: MobiliteBarsFigureEvidence
  ratio: MobiliteRatioEvidence
}

export interface MobiliteStationnementRavitaillementEvidence {
  kind: 'mobilite-stationnement-ravitaillement'
  columns: readonly [MobilitePairedColumnEvidence, MobilitePairedColumnEvidence]
}

/** Page 3 — the 0–100 % share track of « Couverture du territoire ». */
export interface MobiliteShareEvidence {
  kind: 'mobilite-share'
  /** The full published indicator label, including its proximity threshold. */
  figureTitle: string
  /** The validated territory display identity, used as the focal row's name. */
  territoryName: string
  value: ContentFact
  unit: string
  /** Resolved statistic + scope of the active header comparison (ARIA only). */
  comparisonLabel: string | null
  prose: readonly TextBlock[]
  sources: readonly ContentSource[]
  unavailableResources?: readonly string[]
  unavailableComparisons?: readonly string[]
}

/** Producer-declared numeric trajectory axis; never inferred from detail names. */
export interface MobiliteTrajectoryAxis {
  values: readonly { detail: string; numericValue: number }[]
  minimum: number
  maximum: number
}

/** Page 3 — the cumulative raccordement curve of « Visiter la Bretagne ». */
export interface MobiliteRaccordementEvidence {
  kind: 'mobilite-raccordement'
  figureTitle: string
  /** App-owned x-axis title; the tick labels carry the minute unit themselves. */
  xAxisTitle: string
  territoryName: string
  level: TerritoryIdentity['type']
  /** Focal cumulative curve, one fact per published duration grid point. */
  points: readonly ContentFact[]
  /** Active header comparison mean curve; null means no reference is shown. */
  comparison: ComparisonTrajectoryContent | null
  trajectory: TrajectoryMetadata | null
  /** Declared numeric positions from the producer descriptor, when valid. */
  axis: MobiliteTrajectoryAxis | null
  /** Published scalar at the trajectory marker, used in prose and the marker tooltip only. */
  markerValue: ContentFact | null
  comparisonLabel: string | null
  prose: readonly TextBlock[]
  sources: readonly ContentSource[]
  unavailableResources?: readonly string[]
  unavailableComparisons?: readonly string[]
}

export type ContentEvidence =
  | AedarCarAccessOverviewEvidence
  | AedarDiversityLossEvidence
  | AedarAccessEvidence
  | AedarEquipmentProfileEvidence
  | AedarEquipmentExplorerEvidence
  | MobiliteNetworksEvidence
  | MobiliteStationnementRavitaillementEvidence
  | MobiliteShareEvidence
  | MobiliteRaccordementEvidence

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
export interface MobiliteNetworksSection
  extends ContentSectionBase<'reseaux', MobiliteNetworksEvidence> {
  label: 'Réseaux'
}

export interface MobiliteStationnementRavitaillementSection
  extends ContentSectionBase<'stationnement-ravitaillement', MobiliteStationnementRavitaillementEvidence> {
  label: 'Se garer et se ravitailler'
}

export interface MobiliteShareSection
  extends ContentSectionBase<'couverture-du-territoire', MobiliteShareEvidence> {
  label: 'Couverture du territoire'
}

export interface MobiliteRaccordementSection
  extends ContentSectionBase<'visiter-la-bretagne', MobiliteRaccordementEvidence> {
  label: 'Visiter la Bretagne'
}

export type MobiliteContentSection =
  | AedarCarAccessOverviewSection
  | AedarDiversityLossSection
  | AedarAccessSection
  | AedarEquipmentProfileSection
  | AedarEquipmentExplorerSection
  | MobiliteNetworksSection
  | MobiliteStationnementRavitaillementSection
  | MobiliteShareSection
  | MobiliteRaccordementSection

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
  /** Page 1 keeps its historical (empty) rundown block; the migrated page 2
   * deliberately omits the property so no empty block shifts the AEDAR flow. */
  rundown?: readonly TextBlock[]
  sections: readonly [MobiliteNetworksSection, MobiliteStationnementRavitaillementSection]
}

export interface OffreTransportsContentUnit { key: 'offre-transports-commun'; label: string; introduction: readonly TextBlock[]; rundown: readonly TextBlock[]; sections: readonly [MobiliteShareSection, MobiliteRaccordementSection] }

export type MobiliteContentUnit = AccesAuxServicesContentUnit | PartageEspacePublicContentUnit | OffreTransportsContentUnit
export type ContentUnit = MobiliteContentUnit

export interface ThemeContent {
  theme: 'mobilite'
  label: 'Mobilité'
  territory: TerritoryIdentity
  introduction: readonly TextBlock[]
  units: readonly [AccesAuxServicesContentUnit, PartageEspacePublicContentUnit, OffreTransportsContentUnit]
  sourceRegister: readonly ContentSource[]
}

/** Content shape consumed by one isolated Cahier unit (for prototype variants). */
export type SingleUnitThemeContent = Omit<ThemeContent, 'units'> & {
  units: readonly [ContentUnit]
}

/** The typed unit/section hierarchy a rendered section fragment can address. */
export interface SectionAnchorHierarchy {
  units: readonly { key: string; sections: readonly { key: string }[] }[]
}

/**
 * #1010 — the owning unit of a rendered `section-<section.key>` fragment.
 *
 * The id is the same one the Cahier renders (`section-${section.key}`); the
 * owner is found by walking the existing ThemeContent unit/section hierarchy,
 * never by a theme-specific id list or an arbitrary hash prefix.
 */
export function chapterForSectionAnchor(
  content: SectionAnchorHierarchy | null | undefined,
  hash: string | undefined,
): string | undefined {
  const anchor = (hash ?? '').replace(/^#/, '')
  if (!anchor || !content) return undefined
  for (const unit of content.units) {
    if (unit.sections.some((section) => `section-${section.key}` === anchor)) return unit.key
  }
  return undefined
}
/** Public labels for this grammar's published indicators and content metrics. */
function sourceFrom(provenance: FactProvenance | null, metadata?: ThemeMetadata): ContentSource | null {
  if (!provenance?.sourceId) return null
  const record = metadata?.source_records?.[provenance.sourceId]
  return {
    id: provenance.sourceId,
    // The producer record owns the public producer name, URL and licence; the
    // fact provenance owns the millésime when no record is published.
    source: record?.publisher ?? provenance.source,
    version: provenance.version,
    referenceDate: provenance.referenceDate,
    publicationDate: provenance.publicationDate,
    ...(record ? { url: record.url, licence: record.licence } : {}),
  }
}

function registerFor(sections: readonly MobiliteContentSection[], metadata?: ThemeMetadata): ContentSource[] {
  const sources = new Map<string, ContentSource>()
  const sourceKey = (source: ContentSource): string =>
    [source.id, source.version, source.referenceDate, source.publicationDate].join('\u0000')
  const add = (value: ContentFact | null | undefined): void => {
    if (!value?.fact) return
    const source = sourceFrom(value.fact.provenance, metadata)
    if (source && !sources.has(sourceKey(source))) sources.set(sourceKey(source), source)
  }

  for (const section of sections) {
    for (const indicator of section.indicators) add(indicator)
    if (section.evidence?.kind === 'mobilite-networks') {
      for (const category of section.evidence.figure.categories) {
        add(category.value)
        if (category.rawValue) add(category.rawValue)
        for (const segment of category.segments) {
          add(segment.value)
          if (segment.rawValue) add(segment.rawValue)
        }
      }
    }
    if (section.evidence?.kind === 'mobilite-stationnement-ravitaillement') {
      for (const column of section.evidence.columns) {
        for (const category of column.bars.categories) {
          add(category.value)
          if (category.rawValue) add(category.rawValue)
          for (const segment of category.segments) {
          add(segment.value)
          if (segment.rawValue) add(segment.rawValue)
        }
        }
        add(column.ratio.value)
      }
    }
    if (section.evidence?.kind === 'mobilite-share') {
      add(section.evidence.value)
    }
    if (section.evidence?.kind === 'mobilite-raccordement') {
      for (const fact of section.evidence.points) add(fact)
      if (section.evidence.markerValue) add(section.evidence.markerValue)
      if (section.evidence.comparison) {
        for (const fact of section.evidence.comparison.points) add(fact)
      }
    }
  }
  return [...sources.values()]
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
export function resolveMobiliteThemeContent(facts: TerritoryFacts, metadata?: ThemeMetadata): ThemeContent {
  // #627 legacy accessibility retirement: the acces-aux-services unit keeps
  // only its structural identity (the pagination/AEDAR binding). The production
  // AEDAR evidence owns the surface and replaces this unit's content as soon as
  // its evidence is ready.
  const accessSections: readonly MobiliteContentSection[] = []
  const sharingSections = [
    buildMobiliteNetworksSection(facts, metadata),
    buildMobiliteStationnementRavitaillementSection(facts, metadata),
  ] as const
  const subgroupLabel = (key: keyof typeof CONTENU_SOUS_GROUPES_FICHE.mobilite, fallback: string): string =>
    CONTENU_SOUS_GROUPES_FICHE.mobilite[key] ?? fallback
  const transitSections = [
    buildMobiliteShareSection(facts, metadata),
    buildMobiliteRaccordementSection(facts, metadata),
  ] as const
  const transitLabel = subgroupLabel('offre-transports-commun', 'Offre de transports en commun')
  const transitUnit: OffreTransportsContentUnit = {
    key: 'offre-transports-commun',
    label: transitLabel,
    introduction: [],
    rundown: [],
    sections: transitSections,
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
    // C2 — one grammatical paragraph replaces the retired introduction and rundown.
    introduction: buildPartageSubtitle(facts),
    sections: sharingSections,
  }

  return {
    theme: 'mobilite',
    label: 'Mobilité',
    territory: facts.territory,
    introduction: accessUnit.introduction,
    units: [accessUnit, sharingUnit, transitUnit],
    sourceRegister: registerFor([...accessSections, ...sharingSections, ...transitSections], metadata),
  }
}
