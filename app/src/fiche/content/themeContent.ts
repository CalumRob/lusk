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
  MobiliteDistributionPeer,
  MobiliteDistributionSignature,
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

export interface CompleteDistributionSignature {
  densities: readonly number[]
  quantiles: readonly number[]
  min: number
  max: number
}

export interface DistributionEvidence {
  kind: 'distribution'
  legend: readonly FigureLegendEntry[]
  distribution: CompleteDistributionSignature
  comparisonLabel: string | null
  marks: {
    walkTransit: ContentFact
    bike: ContentFact | null
  }
  peers: readonly MobiliteDistributionPeer[]
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

const DISTRIBUTION_LEGEND: readonly FigureLegendEntry[] = [
  { key: 'territory', label: 'Distribution du territoire', marker: 'line', tone: 'territory' },
  { key: 'peers', label: 'Territoires comparables', marker: 'dot', tone: 'peer' },
  { key: 'reference', label: 'Médianes', marker: 'dash', tone: 'reference' },
]

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
      add(section.evidence.marks.walkTransit)
      if (section.evidence.marks.bike) add(section.evidence.marks.bike)
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

function completeDistribution(
  signature: MobiliteDistributionSignature | null,
): CompleteDistributionSignature | null {
  if (!signature) return null
  if (signature.densities.length !== 10 || signature.quantiles.length !== 10) return null
  const numbersOnly = (values: readonly (number | null)[]): values is readonly number[] =>
    values.every((value): value is number => value !== null)
  if (!numbersOnly(signature.densities) || !numbersOnly(signature.quantiles)) {
    return null
  }
  if (signature.min === null || signature.max === null) {
    return null
  }
  return {
    densities: signature.densities,
    quantiles: signature.quantiles,
    min: signature.min,
    max: signature.max,
  }
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

function lectureProfils(
  profiles: readonly BpeAccessProfileFact[],
  summary: MobiliteSummaryFacts,
  territory: TerritoryIdentity,
): Lecture {
  const dominant = dominantProfile(profiles)
  const prose: TextBlock[] = [
    [
      text('Ici et pour chaque mode de transport, on cherche à définir un socle des types d’équipements accessibles. Un type d’équipement est retenu dès lors qu’au moins '),
      bold('un quart'),
      text(' des bâtiments peut l’atteindre. On regarde ensuite le premier mode qui franchit ce seuil. Si aucun mode ne l’atteint, il est classé « inaccessible ou presque ».'),
    ],
  ]

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
      sentence: (names: string) => `${names} sont couverts quel que soit le mode de transport.`,
    },
    {
      services: services.filter(
        (service) => !covered(service, 'car') && covered(service, 'bike') && covered(service, 'walkTransit'),
      ),
      sentence: (names: string) =>
        `${names} sont couverts à pied ou en transports en commun et à vélo, mais pas en voiture.`,
    },
    {
      services: services.filter(
        (service) => covered(service, 'car') && covered(service, 'bike') && !covered(service, 'walkTransit'),
      ),
      sentence: (names: string) =>
        `${names} sont couverts à vélo et en voiture, mais pas à pied ou en transports en commun.`,
    },
    {
      services: services.filter(
        (service) => !covered(service, 'car') && covered(service, 'bike') && !covered(service, 'walkTransit'),
      ),
      sentence: (names: string) =>
        `${names} sont couverts à vélo, mais pas à pied ou en transports en commun ni en voiture.`,
    },
    {
      services: services.filter(
        (service) => covered(service, 'car') && !covered(service, 'bike') && !covered(service, 'walkTransit'),
      ),
      sentence: (names: string) => `${names} ne sont couverts qu’en voiture.`,
    },
    {
      services: services.filter(
        (service) => !covered(service, 'car') && !covered(service, 'bike') && !covered(service, 'walkTransit'),
      ),
      sentence: (names: string) => `${names} ne sont couverts par aucun mode de transport.`,
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
          ? 'La voiture ne crée pas d’écart de couverture marqué entre ces services.'
          : 'Le vélo n’apporte pas d’écart de couverture marqué entre ces services.',
      ),
    ]
  }
  if (key === 'carGap') {
    return [
      text('La voiture crée l’écart de couverture le plus marqué pour '),
      bold(serviceNames(strongest.services), 'car'),
      text(` : ${percentagePoints(strongest.value)} séparent l’accès en voiture de l’accès à pied ou en transports en commun.`),
    ]
  }
  return [
    text('Le vélo apporte le plus pour '),
    bold(serviceNames(strongest.services), 'bike'),
    text(` : ${percentagePoints(strongest.value)} de couverture en plus par rapport à l’accès à pied ou en transports en commun.`),
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
      [
        text('Cette partie présente cinq regroupements de services essentiels. Étant donné leur importance, ils sont dits couverts lorsqu’au moins '),
        bold('trois bâtiments sur quatre'),
        text(' peuvent y accéder.'),
      ],
      ...coverageNarrative(territory, access.services),
      gapNarrative(access.services, 'carGap'),
      gapNarrative(access.services, 'bikeGain'),
      ...(peerCar ? [peerCar] : []),
      ...(peerBike ? [peerBike] : []),
    ],
  }
}

function distributionSection(facts: TerritoryFacts): DistributionAccesParBatimentSection {
  const walkTransit = facts.mobility.losses.diversityWalkTransit
  const bike = facts.mobility.losses.diversityBike
  const walkDistribution = completeDistribution(
    facts.mobility.losses.distributionWalkTransit,
  )
  const evidence: DistributionEvidence | null = walkDistribution
      ? {
        kind: 'distribution',
        legend: DISTRIBUTION_LEGEND,
        distribution: walkDistribution,
        comparisonLabel: comparisonLabel(walkTransit.comparison, facts.territory),
        marks: {
          walkTransit: contentFact(walkTransit, CONTENT_LABELS.div_loss_t),
          bike: complete(bike) ? contentFact(bike, CONTENT_LABELS.div_loss_b) : null,
        },
        peers: facts.mobility.losses.distributionPeers,
      }
    : null
  const hasAny = [walkTransit, bike].some(hasValue) || evidence !== null
  const availability: FactAvailability =
    !hasAny ? 'absent' : complete(walkTransit) && evidence !== null ? 'complete' : 'incomplete'
  const targets = targetsFor(
    [walkTransit, bike].filter((fact): fact is NumericFact => hasValue(fact)),
    facts.territory,
  )
  const sectionFacts = [
    contentFact(walkTransit, CONTENT_LABELS.div_loss_t),
    contentFact(bike, CONTENT_LABELS.div_loss_b),
  ]
  const indicators = sectionFacts.filter(({ fact }) => hasValue(fact))
  return {
    key: 'distribution-acces-par-batiment',
    label: "Distribution de l'accès par bâtiment",
    availability,
    indicators,
    evidence,
    provenance: sourceIdsFor(sectionFacts),
    lecture: availability === 'complete'
      ? { marelle: '... Tous les bâtiments non plus', prose: [] }
      : null,
    explorationTargets: targets,
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
        sections,
      },
    ],
    sourceRegister: registerFor(sections),
  }
}
