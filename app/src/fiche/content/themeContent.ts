import { MOBILITE_MODE_LABELS, nomTerritoirePourAffichage } from './territoryFacts'
import type {
  ComparisonScope,
  FactAvailability,
  FactProvenance,
  MobiliteAccessMode,
  MobiliteDistributionPeer,
  MobiliteDistributionSignature,
  MobiliteService,
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

export type TextSegment =
  | { kind: 'text'; value: string }
  | { kind: 'emphasis'; tone: 'theme' | 'region'; value: string }

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
  distribution: CompleteDistributionSignature
  referenceLabel: string | null
  marks: {
    walkTransit: ContentFact
    bike: ContentFact | null
  }
  peers: readonly MobiliteDistributionPeer[]
}

export interface ComparisonEvidence {
  kind: 'comparison'
  rows: readonly ContentIndicator[]
  scope: ComparisonScope | null
  referenceLabel: string | null
}

export interface AccessServiceEvidence {
  service: MobiliteService
  label: string
  modes: Record<MobiliteAccessMode, ContentFact>
}

export interface AccessEvidence {
  kind: 'access'
  totalBuildings: ContentFact
  totalBrittanyBuildings: ContentFact
  services: readonly AccessServiceEvidence[]
  referenceLabel: string | null
}

export type ContentEvidence = DistributionEvidence | ComparisonEvidence | AccessEvidence

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

export interface PerteDeDiversiteSection
  extends ContentSectionBase<'perte-de-diversite', DistributionEvidence> {
  label: 'Perte de diversité'
}

export interface PerteTotaleSection
  extends ContentSectionBase<'perte-totale-d-acces', ComparisonEvidence> {
  label: 'Perte totale d’accès'
}

export interface ServicesEssentielsSection
  extends ContentSectionBase<'services-essentiels', AccessEvidence> {
  label: 'Services essentiels'
}

export type MobiliteContentSection =
  | PerteDeDiversiteSection
  | PerteTotaleSection
  | ServicesEssentielsSection

export type ContentSection = MobiliteContentSection

export interface MobiliteContentUnit {
  key: 'acces-aux-services'
  label: 'Accès aux services'
  sections: readonly [
    PerteDeDiversiteSection,
    PerteTotaleSection,
    ServicesEssentielsSection,
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

const TOTAL_LOSS_KEYS = ['tot_loss_t', 'tot_loss_b'] as const
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

function complete(fact: NumericFact): fact is NumericFact & { value: number } {
  return fact.availability === 'complete' && fact.value !== null
}

function hasValue(fact: NumericFact): boolean {
  return fact.availability !== 'absent'
}

function contentFact(fact: NumericFact, label: string): ContentFact {
  return { fact, label }
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
    if (section.evidence?.kind === 'access') {
      add(section.evidence.totalBuildings)
      add(section.evidence.totalBrittanyBuildings)
      for (const service of section.evidence.services) {
        for (const mode of Object.values(service.modes)) add(mode)
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

function modeInSentence(mode: MobiliteAccessMode, sentenceStart = false): string {
  const label = MOBILITE_MODE_LABELS[mode]
  return sentenceStart
    ? label
    : label.charAt(0).toLocaleLowerCase('fr-FR') + label.slice(1)
}

function comparisonLabel(comparison: NumericFact['comparison']): string | null {
  if (!comparison?.reference) return null
  switch (comparison.scope.kind) {
    case 'communes-epci':
      return 'la médiane communes de son EPCI'
    case 'communes-bretagne':
      return 'la médiane communes bretonnes'
    case 'epcis-bretagne':
      return 'la médiane EPCI bretons'
    case 'departements-bretagne':
      return 'la médiane départements bretons'
  }
}

function comparisonReferenceLabel(comparison: NumericFact['comparison']): string | null {
  if (!comparison?.reference) return null
  switch (comparison.scope.kind) {
    case 'communes-epci':
      return 'Médiane communes de l’EPCI'
    case 'communes-bretagne':
      return 'Médiane communes bretonnes'
    case 'epcis-bretagne':
      return 'Médiane EPCI bretons'
    case 'departements-bretagne':
      return 'Médiane départements bretons'
  }
}

function formatMillions(value: number): string {
  if (Math.abs(value) < 1_000_000) return formatNumber(value)
  const millions = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 }).format(
    value / 1_000_000,
  )
  return `${millions} millions`
}

function introductionFor(facts: TerritoryFacts): readonly TextBlock[] {
  const territoryName = nomTerritoirePourAffichage(facts.territory)
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
      text(` à ${territoryName}.`),
    ])
  }
  return blocks
}

function lectureDiversite(
  territory: TerritoryIdentity,
  walkTransit: NumericFact,
  bike: NumericFact,
): Lecture | null {
  if (!complete(walkTransit)) return null
  const territoryName = nomTerritoirePourAffichage(territory)
  const prose: TextBlock[] = [
    [
      text('À '),
      emphasis(territoryName),
      text(', le bâtiment médian perd accès à '),
      emphasis(formatNumber(walkTransit.value)),
      text(` types de services ${modeInSentence('walkTransit')} en vingt minutes.`),
    ],
  ]
  if (complete(bike)) {
    prose.push([
      text(`${modeInSentence('bike', true)}, cette perte atteint `),
      emphasis(formatNumber(bike.value)),
      text(' types de services.'),
    ])
  }
  const comparison = comparisonLabel(walkTransit.comparison)
  const reference = walkTransit.comparison?.reference
  if (comparison && reference) {
    prose.push([
      text('La référence est '),
      regionalEmphasis(comparison),
      text(' : '),
      regionalEmphasis(formatNumber(reference.value)),
      text(' types de services.'),
    ])
  }
  return { marelle: 'Ce que l’on perd sans voiture', prose }
}

function lectureTotale(
  territory: TerritoryIdentity,
  walkTransit: NumericFact,
  bike: NumericFact,
): Lecture | null {
  if (!complete(walkTransit) || !complete(bike)) return null
  const territoryName = nomTerritoirePourAffichage(territory)
  const prose: TextBlock[] = [
    [
      text('À '),
      emphasis(territoryName),
      text(', la perte totale atteint '),
      emphasis(formatNumber(walkTransit.value)),
      text(` accès par bâtiment ${modeInSentence('walkTransit')}, contre `),
      emphasis(formatNumber(bike.value)),
      text(` ${modeInSentence('bike')}.`),
    ],
  ]
  const comparison = comparisonLabel(walkTransit.comparison)
  const reference = walkTransit.comparison?.reference
  if (comparison && reference) {
    prose.push([
      text('La référence est '),
      regionalEmphasis(comparison),
      text(' : '),
      regionalEmphasis(formatNumber(reference.value)),
      text(' accès perdus.'),
    ])
  }
  return { marelle: 'Et en volume ?', prose }
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
  const voitureComplete = access.services.every(
    (service) => service.modes.car.fact.value === 1,
  )
  return {
    marelle: 'Tous les équipements ne se valent pas',
    prose: [
      voitureComplete
        ? [
            text('À '),
            emphasis(nomTerritoirePourAffichage(territory)),
            text(', les cinq types de services sont accessibles en voiture depuis tous les bâtiments analysés.'),
          ]
          : [
              text('À '),
            emphasis(nomTerritoirePourAffichage(territory)),
              text(', l’accès aux services essentiels varie selon le mode de déplacement.'),
            ],
    ],
  }
}

function diversitySection(facts: TerritoryFacts): PerteDeDiversiteSection {
  const walkTransit = facts.mobility.losses.diversityWalkTransit
  const bike = facts.mobility.losses.diversityBike
  const walkDistribution = completeDistribution(
    facts.mobility.losses.distributionWalkTransit,
  )
  const evidence: DistributionEvidence | null = walkDistribution
    ? {
        kind: 'distribution',
        distribution: walkDistribution,
        referenceLabel: comparisonReferenceLabel(walkTransit.comparison),
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
    key: 'perte-de-diversite',
    label: 'Perte de diversité',
    availability,
    indicators,
    evidence,
    provenance: sourceIdsFor(sectionFacts),
    lecture: availability === 'complete' ? lectureDiversite(facts.territory, walkTransit, bike) : null,
    explorationTargets: targets,
  }
}

function totalSection(facts: TerritoryFacts): PerteTotaleSection {
  const rawIndicators = TOTAL_LOSS_KEYS
    .map((key) => indicatorFor(facts, key))
    .filter((fact): fact is NumericFact => fact !== null)
  const indicators = rawIndicators
    .map(contentIndicator)
    .filter((indicator): indicator is ContentIndicator => indicator !== null)
  const walkTransit = rawIndicators.find((fact) => fact.key === 'tot_loss_t')
  const bike = rawIndicators.find((fact) => fact.key === 'tot_loss_b')
  const hasAny = rawIndicators.some(hasValue)
  const availability: FactAvailability =
    !hasAny
      ? 'absent'
      : walkTransit && bike && complete(walkTransit) && complete(bike)
        ? 'complete'
        : 'incomplete'
  const evidence: ComparisonEvidence | null =
    indicators.length === 0
      ? null
      : {
          kind: 'comparison',
          rows: indicators,
           scope:
             indicators.find((indicator) => indicator.fact.comparison)?.fact.comparison?.scope ??
             null,
           referenceLabel: comparisonReferenceLabel(
             indicators.find((indicator) => indicator.fact.comparison)?.fact.comparison ?? null,
           ),
         }
  return {
    key: 'perte-totale-d-acces',
    label: 'Perte totale d’accès',
    availability,
    indicators,
    evidence,
    provenance: sourceIdsFor(indicators),
    lecture:
      walkTransit && bike ? lectureTotale(facts.territory, walkTransit, bike) : null,
    explorationTargets: targetsFor(rawIndicators, facts.territory),
  }
}

function accessEvidence(facts: TerritoryFacts): AccessEvidence | null {
  if (facts.mobility.access.availability === 'absent') return null
  return {
    kind: 'access',
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
    })),
    referenceLabel: comparisonReferenceLabel(
      Object.values(facts.mobility.access.byService)
        .flatMap((modes) => Object.values(modes))
        .find((fact) => fact.comparison)?.comparison ?? null,
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
      Object.values(service.modes).every((mode) => complete(mode.fact)),
    )
  const hasAny = indicators.length > 0 || evidence !== null
  const availability: FactAvailability =
    !hasAny ? 'absent' : allIndicatorsComplete && allAccessComplete ? 'complete' : 'incomplete'
  const contentFacts: ContentFact[] = [...indicators]
  if (evidence) {
    contentFacts.push(evidence.totalBuildings, evidence.totalBrittanyBuildings)
    for (const service of evidence.services) contentFacts.push(...Object.values(service.modes))
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

export function resolveMobiliteThemeContent(facts: TerritoryFacts): ThemeContent {
  const sections = [
    diversitySection(facts),
    totalSection(facts),
    essentialsSection(facts),
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
