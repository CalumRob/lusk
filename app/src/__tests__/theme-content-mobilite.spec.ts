import { describe, expect, it } from 'vitest'

import type {
  ComparisonScope,
  FactComparison,
  FactProvenance,
  MobiliteAccessFacts,
  MobiliteAccessGaps,
  MobiliteAccessModes,
  MobiliteBuildingDistribution,
  MobiliteSummaryFacts,
  NumericFact,
  TerritoryFacts,
} from '@/fiche/content/territoryFacts'
import { resolveMobiliteThemeContent } from '@/fiche/content/themeContent'
import type { Lecture } from '@/fiche/content/themeContent'

const provenance: FactProvenance = {
  sourceId: 'mobilite_snapshot',
  source: 'Lusk — analyse d\'accessibilité « Vingt minutes sans voiture » (analyse portée, BPE 2024 · OSM 02-2026 · BDNB 2025-07)',
  version: '2026-02',
  referenceDate: '2026-02-28',
  publicationDate: '2026-08-06',
}

const scope: ComparisonScope = {
  kind: 'communes-epci',
  territoryIds: ['22001', '22002'],
}

function comparison(
  value: number,
  direction: FactComparison['direction'] = 'moins-est-mieux',
  kind: 'mean' | 'median' = 'median',
): FactComparison {
  return {
    direction,
    scope,
    rank: { position: 1, size: 2 },
    reference: { kind, value },
  }
}

function fact(
  key: string,
  value: number | null,
  unit = '%',
  factComparison: FactComparison | null = comparison(0.5),
): NumericFact {
  return {
    key,
    detail: null,
    value,
    unit,
    availability: value === null ? 'incomplete' : 'complete',
    provenance,
    comparison: factComparison,
    reason: null,
  }
}

function absentFact(key: string, unit = '%'): NumericFact {
  return {
    ...fact(key, null, unit, null),
    availability: 'absent',
    provenance: null,
  }
}

function accessModes(car: number, bike: number, walkTransit: number): MobiliteAccessModes {
  return {
    car: fact('access.administration', car, '%', comparison(0.75, 'plus-est-mieux')),
    bike: fact('access.administration', bike, '%', comparison(0.6, 'plus-est-mieux')),
    walkTransit: fact(
      'access.administration',
      walkTransit,
      '%',
      comparison(0.45, 'plus-est-mieux'),
    ),
  }
}

const services = ['administration', 'alimentation', 'sante', 'banque', 'ecole'] as const
const accessIndicators = [
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

function lectureText(lecture: Lecture | null): string {
  return lecture?.prose.map((block) => block.map((segment) => segment.value).join('')).join(' ') ?? ''
}

function accessFacts(): MobiliteAccessFacts {
  const gapsByService = Object.fromEntries(
    services.map((service) => [
      service,
      {
        carGap: fact(`access.${service}.carGap`, 0.4, '%', comparison(0.3, 'moins-est-mieux')),
        bikeGain: fact(`access.${service}.bikeGain`, 0.2, '%', comparison(0.15, 'plus-est-mieux')),
      },
    ]),
  ) as Record<(typeof services)[number], MobiliteAccessGaps>
  return {
    availability: 'complete',
    totalBuildings: fact('access.totalBuildings', 100, 'bâtiments', null),
    totalBrittanyBuildings: fact('access.totalBrittanyBuildings', 1000, 'bâtiments', null),
    summary: summaryFacts(),
    byService: Object.fromEntries(
      services.map((service) => [service, accessModes(1, 0.8, 0.6)]),
    ) as Record<(typeof services)[number], MobiliteAccessModes>,
    gapsByService,
  }
}

function summaryFacts(): MobiliteSummaryFacts {
  return {
    availability: 'complete',
    accessibleEquipment: {
      car: fact('avg_tot_car', 100, 'équipements / bâtiment', null),
      bike: fact('avg_tot_b', 70, 'équipements / bâtiment', null),
      walkTransit: fact('avg_tot_t', 40, 'équipements / bâtiment', null),
    },
      accessibleTypes: {
        car: fact('avg_div_car', 50, 'types d’équipement / bâtiment', null),
        bike: fact('avg_div_b', 35, 'types d’équipement / bâtiment', null),
        walkTransit: fact('avg_div_t', 20, 'types d’équipement / bâtiment', null),
      },
      averageLosses: {
        diversity: {
          walkTransit: fact(
            'avg_loss_div_t',
            30,
            'types d’équipement / bâtiment',
            comparison(20, 'moins-est-mieux', 'mean'),
          ),
          bike: fact(
            'avg_loss_div_b',
            15,
            'types d’équipement / bâtiment',
            comparison(10, 'moins-est-mieux', 'mean'),
          ),
        },
        total: {
          walkTransit: fact(
            'avg_loss_tot_t',
            60,
            'équipements / bâtiment',
            comparison(30, 'moins-est-mieux', 'mean'),
          ),
          bike: fact(
            'avg_loss_tot_b',
            30,
            'équipements / bâtiment',
            comparison(20, 'moins-est-mieux', 'mean'),
          ),
        },
      },
  }
}

const buildingBreadthBins = [
  { key: '0', min: 0, max: 0, label: '0 type' },
  { key: '1-9', min: 1, max: 9, label: '1 à 9 types' },
  { key: '10-24', min: 10, max: 24, label: '10 à 24 types' },
  { key: '25-39', min: 25, max: 39, label: '25 à 39 types' },
  { key: '40-53', min: 40, max: 53, label: '40 à 53 types' },
]
const buildingDepthBins = [
  { key: '0', min: 0, max: 0, label: '0 équipement' },
  { key: '1-9', min: 1, max: 9, label: '1 à 9 équipements' },
  { key: '10-49', min: 10, max: 49, label: '10 à 49 équipements' },
  { key: '50-199', min: 50, max: 199, label: '50 à 199 équipements' },
  { key: '200-499', min: 200, max: 499, label: '200 à 499 équipements' },
  { key: '500+', min: 500, max: null, label: '500 équipements ou plus' },
]
const buildingDistribution: MobiliteBuildingDistribution = {
  availability: 'complete',
  mode: 't',
  modeLabel: 'À pied + TC',
  breadthAxisLabel: 'types d’équipements accessibles',
  depthAxisLabel: 'équipements accessibles',
  breadthBins: buildingBreadthBins,
  depthBins: buildingDepthBins,
  cells: buildingBreadthBins.flatMap((breadth, breadthIndex) =>
    buildingDepthBins.map((depth, depthIndex) => {
      const buildingCount = breadthIndex === 1 && depthIndex === 1
        ? 40
        : breadthIndex === 2 && depthIndex === 2
          ? 60
          : 0
      return {
        breadthBucket: breadth.key,
        depthBucket: depth.key,
        buildingCount,
        share: buildingCount / 100,
      }
    }),
  ),
  totalBuildings: 100,
  provenance,
  comparisonLabel: null,
}

const completeFacts: TerritoryFacts = {
  territory: {
    code: '22001',
    type: 'commune',
    name: 'Commune A',
    department: '22',
    epci: '200000001',
    epciName: 'EPCI X',
  },
  theme: 'mobilite',
  mobility: {
    indicators: [
      fact('tot_loss_t', 4, 'accès perdus', comparison(6)),
      fact('tot_loss_b', 2, 'accès perdus', comparison(3)),
      ...accessIndicators.map((key) => fact(key, 0.8, '%', comparison(0.6, 'plus-est-mieux'))),
    ],
    losses: {
      diversityWalkTransit: fact('div_loss_t', 38, 'types de services', comparison(31)),
      diversityBike: fact('div_loss_b', 24, 'types de services', comparison(22)),
      distributionWalkTransit: {
        densities: [0.01, 0.02, 0.03, 0.04, 0.05, 0.06, 0.07, 0.08, 0.09, 0.1],
        quantiles: [30, 32, 34, 35, 37, 38, 39, 41, 44, 47],
        min: 28,
        max: 47,
      },
      distributionPeers: [
        {
          territoire: {
            code: '22001',
            type: 'commune',
            name: 'Commune A',
            department: '22',
            epci: '200000001',
          },
          value: 38,
        },
        {
          territoire: {
            code: '22002',
            type: 'commune',
            name: 'Commune B',
            department: '22',
            epci: '200000001',
          },
          value: 24,
        },
      ],
    },
    access: accessFacts(),
    bpeAccess: {
      availability: 'complete',
      profiles: [
        {
          profile: 'inaccessible-20-minutes',
          label: 'Inaccessible ou presque en 20 minutes',
          count: 2,
          exemplar: {
            typequ: 'A128',
            label: 'France services',
            car: 0.9,
            bike: 0.1,
            walkTransit: 0.1,
          },
          comparison: null,
        },
      ],
    },
    buildingDistribution,
    accessRamp: null,
  },
}

describe('resolveMobiliteThemeContent', () => {
  it('resolves one ordered unit with the four semantic sections and their evidence', () => {
    const content = resolveMobiliteThemeContent(completeFacts)
    const unit = content.units[0]!
    const [summary, profiles, essentials, distribution] = unit.sections

    expect(content).toMatchObject({
      theme: 'mobilite',
      territory: completeFacts.territory,
      sourceRegister: expect.arrayContaining([
        expect.objectContaining({ id: 'mobilite_snapshot', source: provenance.source }),
      ]),
    })
    expect(content.sourceRegister).toHaveLength(1)
    expect(content.sourceRegister[0]).toMatchObject({
      id: 'mobilite_snapshot',
      source: provenance.source,
      version: '2026-02',
      referenceDate: '2026-02-28',
      publicationDate: '2026-08-06',
    })
    expect(unit.label).toBe('Accès aux services')
    expect(unit.sections.map((section) => section.label)).toEqual([
      'Résumé',
      'Profils d’accès par mode',
      'Services essentiels',
      "Distribution de l'accès par bâtiment",
    ])

    expect(summary.availability).toBe('complete')
    expect(summary.evidence).toMatchObject({
      kind: 'summary',
      accessibleEquipment: {
        car: { fact: { key: 'avg_tot_car', value: 100 } },
        bike: { fact: { key: 'avg_tot_b', value: 70 } },
        walkTransit: { fact: { key: 'avg_tot_t', value: 40 } },
      },
      accessibleTypes: {
        car: { fact: { key: 'avg_div_car', value: 50 } },
        bike: { fact: { key: 'avg_div_b', value: 35 } },
        walkTransit: { fact: { key: 'avg_div_t', value: 20 } },
      },
      inaccessibleTypes: { fact: { key: 'inaccessible_types', value: 0 }, label: 'Inaccessible' },
      typeCount: 2,
      losses: {
        diversity: {
          walkTransit: { fact: { key: 'div_loss_t', value: 38 } },
          bike: { fact: { key: 'div_loss_b', value: 24 } },
        },
        total: {
          walkTransit: { fact: { key: 'tot_loss_t', value: 4 } },
          bike: { fact: { key: 'tot_loss_b', value: 2 } },
        },
      },
      legend: [
        { key: 'walkTransit', label: 'À pied + TC', marker: 'icon', iconKey: 'walkTransit', tone: 't' },
        { key: 'bike', label: 'À vélo + TC', marker: 'icon', iconKey: 'bike', tone: 'b' },
        { key: 'car', label: 'Voiture', marker: 'icon', iconKey: 'car', tone: 'c' },
        { key: 'inaccessible', label: 'Inaccessible', marker: 'slash', tone: 'neutral' },
      ],
    })
    expect(summary.explorationTargets.map((target) => target.key)).toEqual([
      'avg_tot_car',
      'avg_tot_b',
      'avg_tot_t',
      'avg_div_car',
      'avg_div_b',
      'avg_div_t',
      'div_loss_t',
      'div_loss_b',
      'tot_loss_t',
      'tot_loss_b',
    ])
    expect(summary.lecture).not.toBeNull()

    expect(profiles.availability).toBe('complete')
    expect(profiles.evidence).toMatchObject({
      kind: 'bpe-profiles',
      profiles: [
        expect.objectContaining({
          profile: 'inaccessible-20-minutes',
          count: 2,
          exemplar: expect.objectContaining({ typequ: 'A128' }),
        }),
      ],
    })
    expect(profiles.lecture?.marelle).toBe('Service minimum ?')
    expect(lectureText(profiles.lecture)).toContain(
      'profil le plus représenté à Commune A est',
    )
    expect(profiles.lecture?.prose[1]).toContainEqual({
      kind: 'emphasis',
      tone: 'neutral',
      value: 'celui des types inaccessibles ou presque',
    })
    expect(profiles.lecture?.prose[1]).toContainEqual({
      kind: 'emphasis',
      tone: 'default',
      value: 'confirme',
    })

    expect(distribution.availability).toBe('complete')
    expect(distribution.evidence).toMatchObject({
      kind: 'distribution',
      distribution: { min: 28, max: 47 },
      marks: {
        walkTransit: { fact: { key: 'div_loss_t', value: 38 } },
        bike: { fact: { key: 'div_loss_b', value: 24 } },
      },
      buildingDistribution: {
        availability: 'complete',
        mode: 't',
        totalBuildings: 100,
        breadthAxisLabel: 'types d’équipements accessibles',
        depthAxisLabel: 'équipements accessibles',
        cells: expect.arrayContaining([
          { breadthBucket: '1-9', depthBucket: '1-9', buildingCount: 40, share: 0.4 },
        ]),
      },
    })
    expect(distribution.evidence?.kind === 'distribution' ? distribution.evidence.peers : []).toHaveLength(2)
    expect(distribution.explorationTargets.map((target) => target.key)).toEqual([
      'div_loss_t',
      'div_loss_b',
    ])
    expect(distribution.lecture?.marelle).toBe('... Tous les bâtiments non plus')
    expect(summary.lecture?.marelle).toBe('Ce que l’on perd sans voiture')
    expect(lectureText(summary.lecture)).toBe(
      'À Commune A, dans un rayon de 20 minutes en voiture, le bâtiment moyen atteint 100 équipements au total et 50 types d’équipements. La voiture crée une dépendance pour de nombreux services. À pied et/ou en transports en commun, le bâtiment moyen perd l’accès à 30 types d’équipements (la moyenne des communes de EPCI X : 20). Le vélo atténue néanmoins cette difficulté. Il limite la perte à 15 types d’équipements (groupe comparé : 10).',
    )
    expect(summary.lecture?.prose[1]).toContainEqual({
      kind: 'emphasis',
      tone: 'car',
      value: 'crée une dépendance',
    })

    expect(essentials.availability).toBe('complete')
    expect(essentials.indicators.map((indicator) => indicator.fact.key)).toEqual(
      accessIndicators,
    )
    expect(essentials.evidence).toMatchObject({
      kind: 'access',
      services: expect.arrayContaining([expect.objectContaining({ service: 'administration' })]),
      legend: [
        { key: 'walkTransit', label: 'À pied + TC', marker: 'icon', iconKey: 'walkTransit', tone: 't' },
        { key: 'bike', label: 'À vélo + TC', marker: 'icon', iconKey: 'bike', tone: 'b' },
        { key: 'car', label: 'Voiture', marker: 'icon', iconKey: 'car', tone: 'c' },
      ],
    })
    if (essentials.evidence?.kind === 'access') {
      expect(essentials.evidence.services[0]?.carGap).toMatchObject({
        label: 'Écart voiture',
        fact: { value: 0.4 },
      })
      expect(essentials.evidence.services[0]?.bikeGain).toMatchObject({
        label: 'Apport du vélo',
        fact: { value: 0.2 },
      })
      for (const service of essentials.evidence.services) {
        for (const mode of Object.values(service.modes)) {
          expect(mode.fact.comparison?.rank).toEqual({ position: 1, size: 2 })
        }
      }
    }
    expect(essentials.explorationTargets.map((target) => target.key)).toEqual(
      accessIndicators,
    )
    expect(essentials.lecture?.marelle).toBe('Tous les équipements ne se valent pas...')
    expect(lectureText(essentials.lecture)).toContain(
      'Cette partie présente cinq regroupements de services essentiels.',
    )
    expect(lectureText(essentials.lecture)).toContain(
      'À Commune A, les cinq services essentiels sont couverts à vélo et en voiture, mais pas à pied ou en transports en commun.',
    )
    expect(completeFacts.mobility.access.totalBuildings.value).toBe(100)
    expect(content.introduction[1]?.map((segment) => segment.value).join('')).toContain(
      'dont 100 à Commune A.',
    )
    expect(JSON.stringify(content)).not.toContain('story_key')
    expect(JSON.stringify(content)).not.toContain('salience')
  })

  it('uses the 75% threshold and renders every supported coverage pattern', () => {
    const cases = [
      {
        values: [0.75, 0.75, 0.75],
        expected: 'sont couverts quel que soit le mode de transport.',
      },
      {
        values: [0.74, 0.75, 0.75],
        expected: 'sont couverts à pied ou en transports en commun et à vélo, mais pas en voiture.',
      },
      {
        values: [0.75, 0.75, 0.74],
        expected: 'sont couverts à vélo et en voiture, mais pas à pied ou en transports en commun.',
      },
      {
        values: [0.74, 0.75, 0.74],
        expected: 'sont couverts à vélo, mais pas à pied ou en transports en commun ni en voiture.',
      },
      {
        values: [0.75, 0.74, 0.74],
        expected: 'ne sont couverts qu’en voiture.',
      },
      {
        values: [0.74, 0.74, 0.74],
        expected: 'ne sont couverts par aucun mode de transport.',
      },
    ] as const

    for (const testCase of cases) {
      const facts = structuredClone(completeFacts)
      for (const service of services) {
        facts.mobility.access.byService[service] = accessModes(
          testCase.values[0],
          testCase.values[1],
          testCase.values[2],
        )
      }

      const lecture = resolveMobiliteThemeContent(facts).units[0]!.sections[2]!.lecture

      expect(lectureText(lecture)).toContain(`À Commune A, les cinq services essentiels ${testCase.expected}`)
    }
  })

  it('bolds the coverage definition and keeps peer gap readings above the 10-point threshold', () => {
    const essentials = resolveMobiliteThemeContent(completeFacts).units[0]!.sections[2]!
    const lecture = essentials.lecture!

    expect(lecture.prose[0]).toContainEqual({
      kind: 'emphasis',
      tone: 'default',
      value: 'trois bâtiments sur quatre',
    })
    expect(lectureText(lecture)).toContain(
      'L’écart voiture est plus marqué pour les cinq services essentiels que dans la médiane des communes de EPCI X (10 points de pourcentage).',
    )
    expect(lectureText(lecture)).not.toContain('L’apport du vélo est')
  })

  it('bolds a nuanced profile reading', () => {
    const facts = structuredClone(completeFacts)
    facts.mobility.bpeAccess.profiles = [
      {
        profile: 'acces-pied-tc',
        label: 'Accès à pied ou en TC possible',
        count: 3,
        exemplar: null,
        comparison: null,
      },
    ]

    const lecture = resolveMobiliteThemeContent(facts).units[0]?.sections[1]?.lecture

    expect(lecture?.prose[1]).toContainEqual({
      kind: 'emphasis',
      tone: 'default',
      value: 'nuance',
    })
    expect(lecture?.prose[1]).toContainEqual({
      kind: 'emphasis',
      tone: 'foot',
      value: 'celui des types accessibles à pied ou en transports en commun',
    })
  })

  it('uses the bike color for the bike profile reading', () => {
    const facts = structuredClone(completeFacts)
    facts.mobility.bpeAccess.profiles = [
      {
        profile: 'velo-compense',
        label: 'Le vélo compense',
        count: 3,
        exemplar: null,
        comparison: null,
      },
    ]

    const lecture = resolveMobiliteThemeContent(facts).units[0]?.sections[1]?.lecture

    expect(lecture?.prose[1]).toContainEqual({
      kind: 'emphasis',
      tone: 'bike',
      value: 'celui des types pour lesquels le vélo compense',
    })
  })

  it('uses the correct preposition for a department in the subtitle and prose', () => {
    const facts = structuredClone(completeFacts)
    facts.territory = {
      ...facts.territory,
      code: '35',
      type: 'departement',
      name: 'Ille-et-Vilaine',
      department: '35',
      epci: null,
    }

    const content = resolveMobiliteThemeContent(facts)
    const introduction = content.introduction.map((block) => block.map((segment) => segment.value).join('')).join(' ')
    const summary = content.units[0]!.sections[0]!
    const essentials = content.units[0]!.sections[2]!

    expect(introduction).toContain('dont 100 en Ille-et-Vilaine.')
    expect(lectureText(summary.lecture)).toContain('En Ille-et-Vilaine')
    expect(lectureText(essentials.lecture)).toContain('En Ille-et-Vilaine')
    expect(introduction).not.toContain('Dans Ille-et-Vilaine')
    expect(lectureText(summary.lecture)).not.toContain('Dans Ille-et-Vilaine')

    const epciFacts = structuredClone(completeFacts)
    epciFacts.territory = {
      ...epciFacts.territory,
      code: '200000001',
      type: 'epci',
      name: 'CA Lorient Agglomération',
      epci: '200000001',
    }
    const epciContent = resolveMobiliteThemeContent(epciFacts)
    const epciIntroduction = epciContent.introduction.map((block) => block.map((segment) => segment.value).join('')).join(' ')

    expect(epciIntroduction).toContain('dont 100 à la CA Lorient Agglomération.')
    expect(lectureText(epciContent.units[0]!.sections[0]!.lecture)).toContain('À la CA Lorient Agglomération')
  })

  it('handles articles and number in territorial prepositions', () => {
    const cases = [
      { type: 'commune' as const, name: 'Le Havre', expected: 'au Havre' },
      { type: 'commune' as const, name: 'Les Ulis', expected: 'aux Ulis' },
      { type: 'commune' as const, name: 'La Rochelle', expected: 'à La Rochelle' },
      { type: 'epci' as const, name: 'CC de la Presqu’île', expected: 'à la CC de la Presqu’île' },
      { type: 'departement' as const, name: 'Côtes-d’Armor', expected: 'dans les Côtes-d’Armor' },
      { type: 'departement' as const, name: 'Morbihan', expected: 'dans le Morbihan' },
      { type: 'departement' as const, name: 'Finistère', expected: 'dans le Finistère' },
    ]

    for (const territoryCase of cases) {
      const facts = structuredClone(completeFacts)
      facts.territory = {
        ...facts.territory,
        type: territoryCase.type,
        name: territoryCase.name,
      }
      const content = resolveMobiliteThemeContent(facts)
      const introduction = content.introduction
        .map((block) => block.map((segment) => segment.value).join(''))
        .join(' ')

      expect(introduction).toContain(`dont 100 ${territoryCase.expected}.`)
    }
  })

  it('bolds a car-independent loss without applying the car color', () => {
    const facts = structuredClone(completeFacts)
    facts.mobility.access.summary.averageLosses.diversity.walkTransit = {
      ...facts.mobility.access.summary.averageLosses.diversity.walkTransit,
      value: 10,
    }
    facts.mobility.access.summary.averageLosses.diversity.bike = {
      ...facts.mobility.access.summary.averageLosses.diversity.bike,
      value: 5,
    }

    const summary = resolveMobiliteThemeContent(facts).units[0]!.sections[0]!

    expect(summary.lecture?.prose[1]).toContainEqual({
      kind: 'emphasis',
      tone: 'default',
      value: 'relativement préservé sans voiture',
    })
  })

  it('keeps partial access evidence but marks the section incomplete and removes its Lecture', () => {
    const facts = structuredClone(completeFacts)
    facts.mobility.access.availability = 'incomplete'
    facts.mobility.access.byService.administration.walkTransit = {
      ...facts.mobility.access.byService.administration.walkTransit,
      value: null,
      availability: 'incomplete',
      comparison: null,
    }

    const essentials = resolveMobiliteThemeContent(facts).units[0].sections[2]

    expect(essentials.availability).toBe('incomplete')
    expect(essentials.evidence?.kind).toBe('access')
    if (essentials.evidence?.kind === 'access') {
      expect(essentials.evidence.services[0]?.modes.walkTransit.fact).toMatchObject({
        value: null,
        availability: 'incomplete',
      })
    }
    expect(essentials.lecture).toBeNull()
  })

  it('does not expose an incomplete distribution as evidence or Lecture', () => {
    const facts = structuredClone(completeFacts)
    facts.mobility.losses.distributionWalkTransit = {
      ...facts.mobility.losses.distributionWalkTransit!,
      densities: [null, ...facts.mobility.losses.distributionWalkTransit!.densities.slice(1)],
    }

    const distribution = resolveMobiliteThemeContent(facts).units[0].sections[3]

    expect(distribution.availability).toBe('incomplete')
    expect(distribution.indicators.map((indicator) => [indicator.fact.key, indicator.fact.value])).toEqual([
      ['div_loss_t', 38],
      ['div_loss_b', 24],
    ])
    expect(distribution.evidence).toBeNull()
    expect(distribution.lecture).toBeNull()
  })

  it('keeps a partial summary visible without composing its Lecture', () => {
    const facts = structuredClone(completeFacts)
    facts.mobility.indicators = facts.mobility.indicators.filter(
      (indicator) => indicator.key !== 'tot_loss_b',
    )

    const summary = resolveMobiliteThemeContent(facts).units[0].sections[0]

    expect(summary.availability).toBe('incomplete')
    expect(summary.evidence).toMatchObject({
      kind: 'summary',
      losses: {
        total: {
          walkTransit: { fact: { key: 'tot_loss_t', value: 4 } },
          bike: { fact: { key: 'tot_loss_b', availability: 'absent' } },
        },
      },
    })
    expect(summary.lecture).not.toBeNull()
    expect(summary.explorationTargets.map((target) => target.key)).toEqual([
      'avg_tot_car',
      'avg_tot_b',
      'avg_tot_t',
      'avg_div_car',
      'avg_div_b',
      'avg_div_t',
      'div_loss_t',
      'div_loss_b',
      'tot_loss_t',
    ])
  })

  it('represents absent sections without manufacturing indicators, evidence, Lectures, or targets', () => {
    const facts = structuredClone(completeFacts)
    facts.mobility.indicators = []
    facts.mobility.losses = {
      diversityWalkTransit: absentFact('div_loss_t', 'types de services'),
      diversityBike: absentFact('div_loss_b', 'types de services'),
      distributionWalkTransit: null,
      distributionPeers: [],
    }
    facts.mobility.access = {
      availability: 'absent',
      totalBuildings: absentFact('access.totalBuildings', 'bâtiments'),
      totalBrittanyBuildings: absentFact('access.totalBrittanyBuildings', 'bâtiments'),
      summary: {
        availability: 'absent',
        accessibleEquipment: {
          car: absentFact('avg_tot_car', 'équipements / bâtiment'),
          bike: absentFact('avg_tot_b', 'équipements / bâtiment'),
          walkTransit: absentFact('avg_tot_t', 'équipements / bâtiment'),
        },
      accessibleTypes: {
        car: absentFact('avg_div_car', 'types d’équipement / bâtiment'),
        bike: absentFact('avg_div_b', 'types d’équipement / bâtiment'),
        walkTransit: absentFact('avg_div_t', 'types d’équipement / bâtiment'),
      },
      averageLosses: {
        diversity: {
          walkTransit: absentFact('avg_loss_div_t', 'types d’équipement / bâtiment'),
          bike: absentFact('avg_loss_div_b', 'types d’équipement / bâtiment'),
        },
        total: {
          walkTransit: absentFact('avg_loss_tot_t', 'équipements / bâtiment'),
          bike: absentFact('avg_loss_tot_b', 'équipements / bâtiment'),
        },
      },
      },
      byService: Object.fromEntries(
        services.map((service) => [
          service,
          {
            car: absentFact(`access.${service}`, '%'),
            bike: absentFact(`access.${service}`, '%'),
            walkTransit: absentFact(`access.${service}`, '%'),
          },
        ]),
      ) as Record<(typeof services)[number], MobiliteAccessModes>,
      gapsByService: Object.fromEntries(
        services.map((service) => [
          service,
          {
            carGap: absentFact(`access.${service}.carGap`, '%'),
            bikeGain: absentFact(`access.${service}.bikeGain`, '%'),
          },
        ]),
      ) as Record<(typeof services)[number], MobiliteAccessGaps>,
    }
    facts.mobility.bpeAccess = { availability: 'absent', profiles: [] }
    facts.mobility.buildingDistribution = null
    facts.mobility.accessRamp = null

    const sections = resolveMobiliteThemeContent(facts).units[0].sections

    expect(sections.map((section) => section.availability)).toEqual([
      'absent',
      'absent',
      'absent',
      'absent',
    ])
    for (const section of sections) {
      expect(section.evidence).toBeNull()
      expect(section.lecture).toBeNull()
      expect(section.explorationTargets).toEqual([])
    }
  })

  it('keeps fact-based Lectures deterministic when comparison context is unsupported', () => {
    const facts = structuredClone(completeFacts)
    facts.mobility.losses.diversityWalkTransit.comparison = null
    facts.mobility.losses.diversityBike.comparison = null
    facts.mobility.access.summary.averageLosses.diversity.walkTransit.comparison = null
    facts.mobility.access.summary.averageLosses.diversity.bike.comparison = null
    facts.mobility.access.summary.averageLosses.total.walkTransit.comparison = null
    facts.mobility.access.summary.averageLosses.total.bike.comparison = null
    for (const indicator of facts.mobility.indicators) indicator.comparison = null
    for (const service of Object.values(facts.mobility.access.byService)) {
      for (const mode of Object.values(service)) mode.comparison = null
    }

    const first = resolveMobiliteThemeContent(facts)
    const second = resolveMobiliteThemeContent(facts)

    expect(first).toEqual(second)
    expect(JSON.stringify(first)).not.toContain('médiane')
    expect(first.units[0].sections[0].lecture).not.toBeNull()
    expect(first.units[0].sections[1].lecture?.marelle).toBe('Service minimum ?')
    expect(first.units[0].sections[2].lecture).not.toBeNull()
    expect(first.units[0].sections[3].lecture?.marelle).toBe('... Tous les bâtiments non plus')
  })

})
