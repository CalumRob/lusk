import {
  MOBILITE_INACCESSIBLE_LABEL,
  MOBILITE_MODE_LABELS,
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
  /** Human-readable aggregation method and scope for the compositional reference. */
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

export type ContentEvidence =
  | DistributionEvidence
  | BpeProfilesEvidence
  | SummaryEvidence
  | AccessEvidence

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

export type MobiliteContentSection =
  | ResumeSection
  | ProfilsAccesParModeSection
  | ServicesEssentielsSection
  | DistributionAccesParBatimentSection

export type ContentSection = MobiliteContentSection

export interface MobiliteContentUnit {
  key: 'acces-aux-services'
  label: 'Accès aux services'
  rundown: readonly TextBlock[]
  sections: readonly [
    ResumeSection,
    ProfilsAccesParModeSection,
    ServicesEssentielsSection,
    DistributionAccesParBatimentSection,
  ]
}

export type ContentUnit = MobiliteContentUnit

export interface ThemeContent {
  theme: 'mobilite'
  label: 'Mobilité'
  territory: TerritoryIdentity
  introduction: readonly TextBlock[]
  units: readonly [MobiliteContentUnit]
  sourceRegister: readonly ContentSource[]
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

const ESSENTIAL_COVERAGE_THRESHOLD = 0.75
const ESSENTIAL_GAP_THRESHOLD = 0.25
const ESSENTIAL_PEER_DEVIATION_THRESHOLD = 0.1

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

function absentFact(key: string, unit: string): NumericFact {
  return {
    key,
    detail: null,
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
  if (!comparison?.reference) return null
  switch (comparison.scope.kind) {
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
  return scopeLabel ? `${statistic} des ${scopeLabel}` : null
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

type ComparisonRelation = 'higher' | 'lower' | 'same' | 'unavailable'

function referenceValue(fact: NumericFact): number | null {
  return fact.comparison?.reference?.value ?? null
}

function comparisonRelation(fact: NumericFact): ComparisonRelation {
  const reference = referenceValue(fact)
  if (fact.value === null || reference === null) return 'unavailable'
  if (fact.value > reference) return 'higher'
  if (fact.value < reference) return 'lower'
  return 'same'
}

function comparisonLabelForFacts(
  facts: readonly NumericFact[],
  territory: TerritoryIdentity,
): string | null {
  const comparison = facts.find((fact) => fact.comparison?.reference)?.comparison
  return comparison ? comparisonLabel(comparison, territory) : null
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

function accessQuantity(
  relation: ComparisonRelation,
  kind: 'equipment' | 'types',
): string {
  if (kind === 'equipment') {
    if (relation === 'higher') return 'plus d’équipements au total'
    if (relation === 'lower') return 'moins d’équipements au total'
    if (relation === 'same') return 'autant d’équipements au total'
    return 'd’équipements au total'
  }
  if (relation === 'higher') return 'plus de types d’équipements'
  if (relation === 'lower') return 'moins de types d’équipements'
  if (relation === 'same') return 'autant de types d’équipements'
  return 'types d’équipements'
}

function accessMetricText(
  fact: NumericFact,
  kind: 'equipment' | 'types',
  comparable: boolean,
): TextSegment[] | null {
  if (!complete(fact)) return null
  const relation = comparisonRelation(fact)
  if (!comparable || relation === 'unavailable') {
    return [
      emphasis(formatNumber(fact.value)),
      text(` ${kind === 'equipment' ? 'équipements au total' : 'types d’équipements'}`),
    ]
  }
  return [
    text(`${accessQuantity(relation, kind)} (`),
    emphasis(formatNumber(fact.value)),
    text(' contre '),
    regionalEmphasis(formatNumber(referenceValue(fact)!)),
    text(')'),
  ]
}

function summaryOpening(
  territory: TerritoryIdentity,
  summary: MobiliteSummaryFacts,
  comparisonLabelForText: string | null,
): TextBlock | null {
  const equipment = summary.accessibleEquipment.car
  const types = summary.accessibleTypes.car
  const comparable =
    comparisonLabelForText !== null &&
    referenceValue(equipment) !== null &&
    referenceValue(types) !== null
  const equipmentText = accessMetricText(equipment, 'equipment', comparable)
  const typesText = accessMetricText(types, 'types', comparable)
  if (!equipmentText || !typesText) return null

  if (!comparable) {
    return [
      text(`${territoryLead(territory)}, dans un rayon de 20 minutes en voiture, le bâtiment moyen atteint `),
      ...equipmentText,
      text(' et '),
      ...typesText,
      text('.'),
    ]
  }

  const equipmentRelation = comparisonRelation(equipment)
  const typesRelation = comparisonRelation(types)
  const contrasting =
    (equipmentRelation === 'higher' && typesRelation === 'lower') ||
    (equipmentRelation === 'lower' && typesRelation === 'higher')
  return [
    text(`${territoryLead(territory)}, dans un rayon de 20 minutes en voiture, le bâtiment moyen atteint `),
    ...equipmentText,
    text(contrasting ? ' mais ' : ' et '),
    ...typesText,
    text(' que la '),
    regionalEmphasis(comparisonLabelForText),
    text('.'),
  ]
}

function footOpening(
  carRelation: ComparisonRelation,
  footRelation: ComparisonRelation,
): TextBlock {
  if (footRelation === 'unavailable') {
    return [text('Sans voiture, '), bold('l’accès se réduit'), text('.')]
  }
  if (footRelation === 'lower') {
    if (carRelation === 'lower') {
      return [text('La voiture ouvre peu d’accès, et '), bold('s’en passer a peu d’impact'), text(' sur l’accessibilité.')]
    }
    if (carRelation === 'higher') return [text('L’accès reste '), bold('bien préservé sans voiture'), text('.')]
    if (carRelation === 'same') {
      return [
        text('Le niveau d’accès en voiture est comparable à la moyenne, mais l’accès reste '),
        bold('relativement préservé sans voiture'),
        text('.'),
      ]
    }
    return [text('L’accès reste '), bold('relativement préservé sans voiture'), text('.')]
  }
  if (footRelation === 'higher') {
    if (carRelation === 'lower') {
      return [
        text('Malgré un accès limité en voiture, le bâtiment moyen '),
        bold('dépend de la voiture', 'car'),
        text(' pour de nombreux services.'),
      ]
    }
    if (carRelation === 'higher') {
      return [text('La voiture permet un bon accès, mais elle '), bold('crée une dépendance', 'car'), text(' pour de nombreux services.')]
    }
    if (carRelation === 'same') {
      return [
        text('Le bâtiment moyen '),
        bold('dépend de la voiture', 'car'),
        text(', même si son niveau d’accès en voiture est comparable à la moyenne.'),
      ]
    }
    return [text('La voiture '), bold('crée une dépendance', 'car'), text(' pour de nombreux services.')]
  }
  if (carRelation === 'lower') {
    return [
      text('La voiture ouvre peu d’accès, mais la '),
      bold('perte lorsqu’on s’en passe est comparable'),
      text(' à celle de la moyenne.'),
    ]
  }
  if (carRelation === 'higher') {
    return [
      text('La voiture permet un bon accès, et la '),
      bold('perte lorsqu’on s’en passe est comparable'),
      text(' à celle de la moyenne.'),
    ]
  }
  if (carRelation === 'same') {
    return [
      text('Le niveau d’accès en voiture est comparable à la moyenne, et la '),
      bold('perte lorsqu’on s’en passe l’est aussi'),
      text('.'),
    ]
  }
  return [text('La '), bold('perte lorsqu’on s’en passe reste comparable'), text(' à la moyenne.')]
}

function comparisonSuffix(
  fact: NumericFact,
  comparisonLabelForText: string | null,
  explainReference: boolean,
): TextSegment[] {
  const reference = referenceValue(fact)
  if (reference === null || comparisonLabelForText === null) return [text('.')]
  if (!explainReference) {
    return [
      text(' (groupe comparé : '),
      regionalEmphasis(formatNumber(reference)),
      text(').'),
    ]
  }
  return [
    text(' (la '),
    regionalEmphasis(comparisonLabelForText),
    text(' : '),
    regionalEmphasis(formatNumber(reference)),
    text(').'),
  ]
}

function footNarrative(
  summary: MobiliteSummaryFacts,
  comparisonLabelForText: string | null,
  explainReference: boolean,
): TextBlock | null {
  const carTypes = summary.accessibleTypes.car
  const footLoss = summary.averageLosses.diversity.walkTransit
  if (!complete(footLoss)) return null
  return [
    ...footOpening(comparisonRelation(carTypes), comparisonRelation(footLoss)),
    text(' '),
    text('À pied et/ou en transports en commun, le bâtiment moyen perd l’accès à '),
    emphasis(formatNumber(footLoss.value)),
    text(' types d’équipements'),
    ...comparisonSuffix(footLoss, comparisonLabelForText, explainReference),
  ]
}

function bikeOpening(
  footRelation: ComparisonRelation,
  bikeRelation: ComparisonRelation,
): string {
  if (footRelation === 'lower') {
    if (bikeRelation === 'higher') return 'Le vélo renforce cette situation.'
    if (bikeRelation === 'lower') return 'Le vélo nuance toutefois cette situation.'
    if (bikeRelation === 'same') return 'Le vélo reproduit cette situation.'
    return 'Le vélo apporte une lecture complémentaire.'
  }
  if (footRelation === 'higher') {
    if (bikeRelation === 'higher') return 'Le vélo atténue néanmoins cette difficulté.'
    if (bikeRelation === 'lower') return 'Le vélo n’atténue pas suffisamment cette difficulté.'
    if (bikeRelation === 'same') return 'Le vélo atténue cette difficulté dans des proportions comparables.'
    return 'Le vélo apporte une lecture complémentaire à cette difficulté.'
  }
  if (bikeRelation === 'higher') return 'Le vélo améliore toutefois cette situation.'
  if (bikeRelation === 'lower') return 'Le vélo réduit moins l’écart.'
  if (bikeRelation === 'same') return 'Le vélo réduit l’écart dans des proportions proches de la moyenne.'
  return 'Le vélo apporte une lecture complémentaire.'
}

function bikeNarrative(
  summary: MobiliteSummaryFacts,
  comparisonLabelForText: string | null,
  explainReference: boolean,
): TextBlock | null {
  const footLoss = summary.averageLosses.diversity.walkTransit
  const bikeLoss = summary.averageLosses.diversity.bike
  if (!complete(footLoss) || !complete(bikeLoss)) return null
  const footReference = referenceValue(footLoss)
  const bikeReference = referenceValue(bikeLoss)
  const bikeRelation =
    footReference === null || bikeReference === null
      ? 'unavailable'
      : comparisonRelation({
          ...bikeLoss,
          value: footLoss.value - bikeLoss.value,
          comparison: {
            ...bikeLoss.comparison!,
            reference: {
              kind: bikeLoss.comparison?.reference?.kind ?? 'mean',
              value: footReference - bikeReference,
            },
          },
        })
  return [
    text(`${bikeOpening(comparisonRelation(footLoss), bikeRelation)} `),
    text('Il limite la perte à '),
    emphasis(formatNumber(bikeLoss.value)),
    text(' types d’équipements'),
    ...comparisonSuffix(bikeLoss, comparisonLabelForText, explainReference),
  ]
}

type ProfilesReadingPolarity = 'without-car' | 'limited'

const PROFILE_READING_LABELS: Readonly<Record<BpeAccessProfileFact['profile'], string>> = {
  'acces-pied-tc': 'celui des types accessibles à pied ou en transports en commun',
  'velo-compense': 'celui des types pour lesquels le vélo compense',
  'voiture-requise': 'celui des types pour lesquels la voiture est requise',
  'inaccessible-20-minutes': 'celui des types inaccessibles ou presque',
}

function profileReadingTone(
  profile: BpeAccessProfileFact['profile'],
): Extract<TextEmphasisTone, 'foot' | 'bike' | 'car' | 'neutral'> {
  if (profile === 'acces-pied-tc') return 'foot'
  if (profile === 'velo-compense') return 'bike'
  if (profile === 'voiture-requise') return 'car'
  return 'neutral'
}

function dominantProfile(
  profiles: readonly BpeAccessProfileFact[],
): BpeAccessProfileFact | null {
  if (profiles.length === 0) return null
  const maximum = Math.max(...profiles.map((profile) => profile.count))
  const leaders = profiles.filter((profile) => profile.count === maximum)
  return leaders.length === 1 ? leaders[0]! : null
}

function profilesReadingPolarity(profile: BpeAccessProfileFact): ProfilesReadingPolarity {
  return profile.profile === 'acces-pied-tc' || profile.profile === 'velo-compense'
    ? 'without-car'
    : 'limited'
}

/**
 * The first group's reading is the reference point for this second figure.
 * Use the same two signals as `footOpening`: the loss without a car first,
 * then the car-accessible type count as a tie-breaker. No comparison means no
 * confirmation claim in the second figure.
 */
function previousAccessReadingPolarity(
  summary: MobiliteSummaryFacts,
): ProfilesReadingPolarity | null {
  const footLossRelation = comparisonRelation(summary.averageLosses.diversity.walkTransit)
  if (footLossRelation === 'higher') return 'limited'
  if (footLossRelation === 'lower') return 'without-car'

  const carTypesRelation = comparisonRelation(summary.accessibleTypes.car)
  if (carTypesRelation === 'higher') return 'limited'
  if (carTypesRelation === 'lower') return 'without-car'
  return null
}

function profilesFigureLecture(profiles: readonly BpeAccessProfileFact[]): readonly TextBlock[] {
  const exemplar = dominantProfile(profiles)?.exemplar
  return [[
    text('Pour chaque mode de transport, un type d’équipement entre dans le socle dès lors qu’au moins '),
    bold('un quart des bâtiments'),
    text(' peut l’atteindre. La figure retient ensuite le premier mode qui franchit ce seuil ; si aucun ne l’atteint, le type est classé « inaccessible ou presque ».'),
  ], ...(exemplar ? [[text(`Par exemple, « ${exemplar.label} » est accessible à ${formatNumber(exemplar.walkTransit * 100)} % des bâtiments à pied ou en transports en commun, ${formatNumber(exemplar.bike * 100)} % à vélo avec les transports en commun et ${formatNumber(exemplar.car * 100)} % en voiture. Ces parts expliquent son classement ; le profil compte des types d’équipements, pas des bâtiments.`)]] : [])]
}

function lectureProfils(
  profiles: readonly BpeAccessProfileFact[],
  summary: MobiliteSummaryFacts,
  territory: TerritoryIdentity,
): Lecture {
  const dominant = dominantProfile(profiles)
  const prose: TextBlock[] = []

  if (dominant) {
    const previous = previousAccessReadingPolarity(summary)
    const current = profilesReadingPolarity(dominant)
    const verdict = previous === null ? null : current === previous ? 'confirme' : 'nuance'
    const reading: TextSegment[] = [
      text('Avec ce seuil plus permissif, le profil le plus représenté '),
      text(territoryLead(territory, false)),
      text(' est '),
      bold(PROFILE_READING_LABELS[dominant.profile], profileReadingTone(dominant.profile)),
      text('.'),
    ]
    if (verdict) {
      reading.push(
        text(' Le seuil plus permissif '),
        bold(verdict),
        text(' donc la lecture précédente.'),
      )
    }
    prose.push(reading)
  }

  return { marelle: 'Service minimum ?', prose }
}

function lectureDiversite(
  territory: TerritoryIdentity,
  summary: MobiliteSummaryFacts,
): Lecture | null {
  const footLoss = summary.averageLosses.diversity.walkTransit
  const bikeLoss = summary.averageLosses.diversity.bike
  if (!complete(footLoss) || !complete(bikeLoss)) return null
  const comparisonLabelForText = comparisonLabelForFacts([
    summary.accessibleEquipment.car,
    summary.accessibleTypes.car,
    footLoss,
    bikeLoss,
  ], territory)
  const opening = summaryOpening(territory, summary, comparisonLabelForText)
  const openingExplainsReference =
    opening !== null &&
    comparisonLabelForText !== null &&
    referenceValue(summary.accessibleEquipment.car) !== null &&
    referenceValue(summary.accessibleTypes.car) !== null
  const foot = footNarrative(summary, comparisonLabelForText, !openingExplainsReference)
  const footExplainsReference =
    !openingExplainsReference &&
    foot !== null &&
    comparisonLabelForText !== null &&
    referenceValue(footLoss) !== null
  const bike = bikeNarrative(
    summary,
    comparisonLabelForText,
    !openingExplainsReference && !footExplainsReference,
  )
  const prose = [opening, foot, bike].filter((block): block is TextBlock => block !== null)
  return { marelle: 'Ce que l’on perd sans voiture', prose }
}

function summaryFigureLecture(summary: MobiliteSummaryFacts): readonly TextBlock[] {
  const loss = narrativeValue(summary.averageLosses.diversity.walkTransit)
  return [[
    text('Les valeurs comparent, pour chaque mode, le nombre moyen d’équipements et de types accessibles par bâtiment. Les pertes correspondent à l’écart avec la voiture.'),
  ], ...(loss !== null && loss >= 0 ? [[text(`Ici, la perte moyenne de ${formatNumber(loss)} types à pied ou en transports en commun se lit par rapport à la voiture. Elle ne signifie pas que chaque bâtiment perd exactement ${formatNumber(loss)} types : la figure de distribution décrit séparément les niveaux d’accès.`)]] : [])]
}

const SERVICE_PREPOSITIONS: Readonly<Record<MobiliteService, string>> = {
  administration: 'de l’administration',
  alimentation: 'de l’alimentation',
  sante: 'de la santé',
  banque: 'de la banque',
  ecole: 'de l’école',
}

function joinFrench(values: readonly string[]): string {
  if (values.length === 0) return ''
  if (values.length === 1) return values[0]!
  if (values.length === 2) return `${values[0]} et ${values[1]}`
  return `${values.slice(0, -1).join(', ')} et ${values[values.length - 1]}`
}

function serviceNames(services: readonly AccessServiceEvidence[]): string {
  if (services.length === SERVICE_GRAMMAR.length) return 'les cinq services essentiels'
  return `les services ${joinFrench(services.map(({ service }) => SERVICE_PREPOSITIONS[service]))}`
}

function covered(service: AccessServiceEvidence, mode: MobiliteAccessMode): boolean {
  const value = service.modes[mode].fact.value
  return value !== null && value >= ESSENTIAL_COVERAGE_THRESHOLD
}

function coverageNarrative(
  territory: TerritoryIdentity,
  services: readonly AccessServiceEvidence[],
): TextBlock[] {
  const groups = [
    {
      services: services.filter(
        (service) => covered(service, 'car') && covered(service, 'bike') && covered(service, 'walkTransit'),
      ),
      sentence: (names: string) => `pour ${names}, au moins trois bâtiments sur quatre y ont accès, quel que soit le mode de transport.`,
    },
    {
      services: services.filter(
        (service) => !covered(service, 'car') && covered(service, 'bike') && covered(service, 'walkTransit'),
      ),
      sentence: (names: string) =>
        `pour ${names}, au moins trois bâtiments sur quatre y ont accès à pied ou en transports en commun et à vélo, mais pas en voiture.`,
    },
    {
      services: services.filter(
        (service) => covered(service, 'car') && covered(service, 'bike') && !covered(service, 'walkTransit'),
      ),
      sentence: (names: string) =>
        `pour ${names}, au moins trois bâtiments sur quatre y ont accès à vélo et en voiture, mais pas à pied ou en transports en commun.`,
    },
    {
      services: services.filter(
        (service) => !covered(service, 'car') && covered(service, 'bike') && !covered(service, 'walkTransit'),
      ),
      sentence: (names: string) =>
        `pour ${names}, au moins trois bâtiments sur quatre y ont accès à vélo, mais pas à pied ou en transports en commun ni en voiture.`,
    },
    {
      services: services.filter(
        (service) => covered(service, 'car') && !covered(service, 'bike') && !covered(service, 'walkTransit'),
      ),
      sentence: (names: string) =>
        `pour ${names}, au moins trois bâtiments sur quatre y ont accès en voiture, mais pas avec les autres modes.`,
    },
    {
      services: services.filter(
        (service) => !covered(service, 'car') && !covered(service, 'bike') && !covered(service, 'walkTransit'),
      ),
      sentence: (names: string) =>
        `pour ${names}, aucun mode ne permet à trois bâtiments sur quatre d’y accéder.`,
    },
  ].filter((group) => group.services.length > 0)

  return groups.map((group, index) => [
    text(index === 0 ? `${territoryLead(territory)}, ` : index === 1 ? 'Mais ' : ''),
    text(group.sentence(serviceNames(group.services))),
  ])
}

type GapKey = 'carGap' | 'bikeGain'

function percentagePoints(value: number): string {
  const formatted = formatNumber(value * 100)
  return `${formatted} point${Math.abs(value * 100) > 1 ? 's' : ''} de pourcentage`
}

function strongestGap(
  services: readonly AccessServiceEvidence[],
  key: GapKey,
): { services: AccessServiceEvidence[]; value: number } | null {
  const candidates = services.filter((service) => {
    const value = service[key].fact.value
    return value !== null && value >= ESSENTIAL_GAP_THRESHOLD
  })
  if (candidates.length === 0) return null
  const value = Math.max(...candidates.map((service) => service[key].fact.value!))
  return {
    services: candidates.filter((service) => service[key].fact.value === value),
    value,
  }
}

function gapNarrative(
  services: readonly AccessServiceEvidence[],
  key: GapKey,
): TextBlock {
  const strongest = strongestGap(services, key)
  if (!strongest) {
    return [
      text(
        key === 'carGap'
          ? 'La voiture ne crée pas d’écart marqué entre la part des bâtiments ayant accès à ces services.'
          : 'Le vélo n’apporte pas d’écart marqué entre la part des bâtiments ayant accès à ces services.',
      ),
    ]
  }
  if (key === 'carGap') {
    return [
      text('La voiture crée l’écart le plus marqué pour '),
      bold(serviceNames(strongest.services), 'car'),
      text(` : ${percentagePoints(strongest.value)} séparent la part des bâtiments qui y ont accès en voiture de celle qui y a accès à pied ou en transports en commun.`),
    ]
  }
  return [
    text('Le vélo apporte le plus pour '),
    bold(serviceNames(strongest.services), 'bike'),
    text(` : ${percentagePoints(strongest.value)} de bâtiments supplémentaires y ont accès par rapport à l’accès à pied ou en transports en commun.`),
  ]
}

function strongestPeerDeviation(
  services: readonly AccessServiceEvidence[],
  key: GapKey,
): { services: AccessServiceEvidence[]; difference: number } | null {
  const candidates = services.flatMap((service) => {
    const fact = service[key].fact
    const reference = fact.comparison?.reference?.value
    if (fact.value === null || reference === null || reference === undefined) return []
    const difference = fact.value - reference
    return Math.abs(difference) >= ESSENTIAL_PEER_DEVIATION_THRESHOLD
      ? [{ service, difference }]
      : []
  })
  if (candidates.length === 0) return null
  const strongest = Math.max(...candidates.map(({ difference }) => Math.abs(difference)))
  const selected = candidates.filter(({ difference }) => Math.abs(difference) === strongest)
  return {
    services: selected.map(({ service }) => service),
    difference: selected[0]!.difference,
  }
}

function peerGapNarrative(
  services: readonly AccessServiceEvidence[],
  key: GapKey,
  comparisonLabelForText: string | null,
): TextBlock | null {
  const deviation = strongestPeerDeviation(services, key)
  if (!deviation || !comparisonLabelForText) return null
  const label = key === 'carGap' ? 'L’écart voiture' : 'L’apport du vélo'
  const tone = key === 'carGap' ? 'car' : 'bike'
  const relation = deviation.difference > 0 ? 'plus marqué' : 'moins marqué'
  return [
    text(`${label} est `),
    bold(relation, tone),
    text(' pour '),
    bold(serviceNames(deviation.services), tone),
    text(' que dans la '),
    regionalEmphasis(comparisonLabelForText),
    text(` (${percentagePoints(Math.abs(deviation.difference))}).`),
  ]
}

function lectureEssentiels(
  territory: TerritoryIdentity,
  access: AccessEvidence,
): Lecture | null {
  if (!complete(access.totalBuildings.fact) || !complete(access.totalBrittanyBuildings.fact)) {
    return null
  }
  if (
    access.services.some((service) =>
      Object.values(service.modes).some((mode) => !complete(mode.fact)),
    )
  ) {
    return null
  }
  const peerCar = peerGapNarrative(access.services, 'carGap', access.comparisonLabel)
  const peerBike = peerGapNarrative(access.services, 'bikeGain', access.comparisonLabel)
  return {
    marelle: 'Tous les équipements ne se valent pas...',
    prose: [
      ...coverageNarrative(territory, access.services),
      gapNarrative(access.services, 'carGap'),
      gapNarrative(access.services, 'bikeGain'),
      ...(peerCar ? [peerCar] : []),
      ...(peerBike ? [peerBike] : []),
    ],
  }
}

function essentialsFigureLecture(facts: TerritoryFacts): readonly TextBlock[] {
  const examples = SERVICE_GRAMMAR.flatMap(({ key, label }) => {
    const modes = facts.mobility.access.byService[key]
    const foot = narrativeValue(modes.walkTransit)
    const bike = narrativeValue(modes.bike)
    return foot !== null && bike !== null ? [{ label, foot, bike, gap: Math.abs(bike - foot) }] : []
  })
  const example = examples.reduce<typeof examples[number] | null>((best, item) => !best || item.gap > best.gap ? item : best, null)
  return [[
    text('Chaque anneau montre la part des bâtiments ayant accès à un regroupement de services selon le mode. Étant donné leur importance, on retient un accès large lorsqu’au moins '),
    bold('trois bâtiments sur quatre'),
    text(' peuvent y accéder.'),
  ], ...(example ? [[text(`Ici, pour « ${example.label} », les parts sont de ${formatNumber(example.foot * 100)} % à pied ou en transports en commun et de ${formatNumber(example.bike * 100)} % à vélo avec les transports en commun. ${example.foot < ESSENTIAL_COVERAGE_THRESHOLD && example.bike >= ESSENTIAL_COVERAGE_THRESHOLD ? 'La part à vélo atteint donc ce niveau pour une majorité de bâtiments, contrairement à celle à pied.' : `Chaque part se compare au niveau de ${formatNumber(ESSENTIAL_COVERAGE_THRESHOLD * 100)} %, sans additionner les anneaux : un bâtiment peut être accessible par plusieurs modes.`}`)]] : [])]
}

function buildingDistributionFigureLecture(
  distribution: MobiliteBuildingDistribution | null,
  territory: TerritoryIdentity,
): readonly TextBlock[] {
  const mode = distribution?.modeLabel ?? 'À pied + TC'
  const cells = distribution?.availability === 'complete'
    ? [...distribution.cells].sort((a, b) => b.share - a.share || a.breadthBucket.localeCompare(b.breadthBucket) || a.depthBucket.localeCompare(b.depthBucket)) : []
  const cell = cells[0]
  const breadth = distribution?.breadthBins.find((bin) => bin.key === cell?.breadthBucket)
  const depth = distribution?.depthBins.find((bin) => bin.key === cell?.depthBucket)
  return [[
    text('Chaque case croise le nombre de types et le nombre total d’équipements accessibles en vingt minutes, en mode « '),
    text(mode),
    text(` ». Le triangle bleu représente ${territory.name} ; le triangle vert, le groupe comparé. Dans les deux cas, plus la couleur est soutenue, plus cette situation concerne de bâtiments.`),
  ], ...(cell && cell.share > 0 && breadth && depth ? [[text(`Ici, la case la plus représentée réunit ${formatNumber(cell.share * 100)} % des bâtiments : tranche « ${breadth.label} » pour les types et « ${depth.label} » pour les équipements. Ce sont bien les mêmes bâtiments sur les deux axes${cell.comparisonShare !== null ? ` ; cette case représente ${formatNumber(cell.comparisonShare * 100)} % des bâtiments du groupe comparé` : ''}.`)]] : [])]
}

function accessRampFigureLecture(ramp: MobiliteAccessRamp | null): readonly TextBlock[] {
  const example = ramp?.availability === 'complete' ? ramp.curves.walkTransit.points.find((point) => point.quantile === 0.5) : null
  return [[
    text('Pour chaque mode, les bâtiments sont classés du moins au plus grand nombre de types accessibles. À une position donnée, les courbes ne décrivent donc pas nécessairement les mêmes bâtiments. La courbe du groupe comparé suit les mêmes quantiles, calculés sur l’ensemble de ses bâtiments. Le point à 50 % correspond à sa médiane.'),
  ], ...(example ? [[text(`Ici, à 50 % de la courbe « ${ramp!.curves.walkTransit.modeLabel} », on lit ${formatNumber(example.accessibleTypes)} types : c’est la médiane de l’accès des bâtiments dans ce mode, et non la perte du bâtiment médian par rapport à la voiture.`)]] : [])]
}

function buildingComparisonPopulationLabel(
  rawLabel: string | null,
  territory: TerritoryIdentity,
): string | null {
  if (!rawLabel) return null
  if (territory.type === 'commune' && territory.epciName) {
    return `bâtiments de ${territory.epciName}`
  }
  return 'bâtiments de Bretagne'
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
        comparisonPopulationLabel: buildingComparisonPopulationLabel(rawComparisonLabel, facts.territory),
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
      ? { marelle: '... Toutes les résidences non plus.', prose: [] }
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
            summaryFacts.find((fact) => fact.fact.comparison)?.fact.comparison ?? null,
            facts.territory,
          ),
          figureLecture: summaryFigureLecture(summary),
          losses,
        }
      : null,
    provenance: sourceIdsFor(summaryFacts),
    lecture:
      complete(diversityWalkTransit) && complete(diversityBike)
        ? lectureDiversite(facts.territory, summary)
        : null,
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
    lecture: evidence ? lectureEssentiels(facts.territory, evidence) : null,
    explorationTargets: targetsFor(
      indicators.map((indicator) => indicator.fact),
      facts.territory,
    ),
  }
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
          figureLecture: profilesFigureLecture(availability === 'complete' ? profiles : []),
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
      ? lectureProfils(profiles, facts.mobility.access.summary, facts.territory)
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

function essentialAccessFinding(
  facts: TerritoryFacts,
  anchor: RundownFindingKey,
): TextBlock | null {
  const services = Object.values(facts.mobility.access.byService)
  const coveredBy = (mode: MobiliteAccessMode) => services.filter((service) => {
    const value = narrativeValue(service[mode])
    return value !== null && value >= ESSENTIAL_COVERAGE_THRESHOLD
  })
  const foot = coveredBy('walkTransit').length
  const bike = coveredBy('bike').length
  const car = coveredBy('car').length
  if (anchor === 'hub' || anchor === 'walking') {
    return foot >= 4
      ? [text('Pour les cinq services essentiels, au moins trois bâtiments sur quatre y ont accès à pied ou en transports en commun.')]
      : null
  }
  if (anchor === 'bike-bridge' && bike >= foot + 2) {
    return [bold('Le vélo', 'bike'), text(' permet aussi à au moins trois bâtiments sur quatre d’atteindre certains services essentiels que la marche n’atteint pas.')]
  }
  if (anchor === 'car-dependent' && car === SERVICE_GRAMMAR.length && foot === 0 && bike === 0) {
    return [text('Pour les cinq services essentiels, au moins trois bâtiments sur quatre y ont accès en voiture, mais aucune alternative n’atteint ce niveau.')]
  }
  if (anchor === 'car-dependent' && car >= foot + 2) {
    return [text('Pour les services essentiels, la voiture permet à au moins trois bâtiments sur quatre d’en atteindre davantage que les alternatives.')]
  }
  if (anchor === 'mixed') {
    const total = SERVICE_GRAMMAR.length
    if (car === total && foot === total && bike === total) {
      return [text('Pour les cinq services essentiels, au moins trois bâtiments sur quatre y ont accès quel que soit le mode de transport.')]
    }
    if (car === total && foot === 0 && bike === 0) {
      return [text('Pour les cinq services essentiels, au moins trois bâtiments sur quatre y ont accès en voiture, mais aucune alternative n’atteint ce niveau.')]
    }
    if (car === total && foot === 0 && bike > 0) {
      return [text('Pour les cinq services essentiels, au moins trois bâtiments sur quatre y ont accès en voiture ; le vélo atteint ce niveau pour une partie d’entre eux, mais pas la marche ni les transports en commun.')]
    }
  }
  return null
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
  const essential = essentialAccessFinding(facts, anchor.key)
  if (anchor.key === 'hub' || anchor.key === 'walking') {
    if (distribution) complements.push(distribution)
    if (essential) complements.push(essential)
    if (anchor.key === 'hub') complements.push(hubDepthFinding())
    const bikeVolume = bikeVolumeCompensationFinding(walk, bike, car)
    if (bikeVolume) complements.push(bikeVolume)
  } else if (anchor.key === 'bike-bridge') {
    if (distribution) complements.push(distribution)
    if (essential) complements.push(essential)
    if (spread) complements.push(spread)
  } else if (anchor.key === 'car-dependent') {
    if (distribution) complements.push(distribution)
    if (essential) complements.push(essential)
  } else if (anchor.key === 'limited') {
    if (distribution) complements.push(distribution)
  } else {
    if (essential) complements.push(essential)
    const bikeAggregate = bikeAggregateFinding(walk, bike)
    if (bikeAggregate) complements.push(bikeAggregate)
    if (spread) complements.push(spread)
  }
  return [complements.reduce((prose, complement) => [...prose, text(' '), ...complement], anchor.prose)]
}

export function resolveMobiliteThemeContent(facts: TerritoryFacts): ThemeContent {
  const sections = [
    summarySection(facts),
    profilesSection(facts),
    essentialsSection(facts),
    distributionSection(facts),
  ] as const

  return {
    theme: 'mobilite',
    label: 'Mobilité',
    territory: facts.territory,
    introduction: introductionFor(facts),
    units: [
      {
        key: 'acces-aux-services',
        label: 'Accès aux services',
        rundown: mobiliteRundown(facts),
        sections,
      },
    ],
    sourceRegister: registerFor(sections),
  }
}
