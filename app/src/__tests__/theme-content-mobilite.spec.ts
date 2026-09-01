import { describe, expect, it } from 'vitest'

import type {
  ComparisonScope,
  FactComparison,
  FactProvenance,
  MobiliteAccessFacts,
  MobiliteAccessModes,
  MobiliteSummaryFacts,
  NumericFact,
  TerritoryFacts,
} from '@/fiche/content/territoryFacts'
import { resolveMobiliteThemeContent } from '@/fiche/content/themeContent'
import type { Lecture } from '@/fiche/content/themeContent'

const provenance: FactProvenance = {
  sourceId: 'mobilite_snapshot',
  source: 'Snapshot Mobilité',
  version: '2026-02',
  referenceDate: '2026-02-01',
  publicationDate: '2026-02-15',
}

const scope: ComparisonScope = {
  kind: 'communes-epci',
  territoryIds: ['22001', '22002'],
}

function comparison(
  value: number,
  direction: FactComparison['direction'] = 'moins-est-mieux',
): FactComparison {
  return {
    direction,
    scope,
    rank: { position: 1, size: 2 },
    reference: { kind: 'median', value },
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
  return {
    availability: 'complete',
    totalBuildings: fact('access.totalBuildings', 100, 'bâtiments', null),
    totalBrittanyBuildings: fact('access.totalBrittanyBuildings', 1000, 'bâtiments', null),
    summary: summaryFacts(),
    byService: Object.fromEntries(
      services.map((service) => [service, accessModes(1, 0.8, 0.6)]),
    ) as Record<(typeof services)[number], MobiliteAccessModes>,
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
  }
}

const completeFacts: TerritoryFacts = {
  territory: {
    code: '22001',
    type: 'commune',
    name: 'Commune A',
    department: '22',
    epci: '200000001',
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
        },
      ],
    },
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
      sourceRegister: [{ id: 'mobilite_snapshot', source: 'Snapshot Mobilité' }],
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
    expect(profiles.lecture?.marelle).toBe('Service minimum assuré?')

    expect(distribution.availability).toBe('complete')
    expect(distribution.evidence).toMatchObject({
      kind: 'distribution',
      distribution: { min: 28, max: 47 },
      marks: {
        walkTransit: { fact: { key: 'div_loss_t', value: 38 } },
        bike: { fact: { key: 'div_loss_b', value: 24 } },
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
      'À Commune A, le bâtiment médian perd accès à 38 types de services à pied + TC en vingt minutes. À vélo + TC, cette perte atteint 24 types de services. La référence est la médiane communes de son EPCI : 31 types de services.',
    )

    expect(essentials.availability).toBe('complete')
    expect(essentials.indicators.map((indicator) => indicator.fact.key)).toEqual(
      accessIndicators,
    )
    expect(essentials.evidence).toMatchObject({
      kind: 'access',
      services: expect.arrayContaining([expect.objectContaining({ service: 'administration' })]),
    })
    if (essentials.evidence?.kind === 'access') {
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
    expect(lectureText(essentials.lecture)).toBe(
      'À Commune A, les cinq types de services sont accessibles en voiture depuis tous les bâtiments analysés.',
    )
    expect(JSON.stringify(content)).not.toContain('story_key')
    expect(JSON.stringify(content)).not.toContain('salience')
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
    }
    facts.mobility.bpeAccess = { availability: 'absent', profiles: [] }

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
    for (const indicator of facts.mobility.indicators) indicator.comparison = null
    for (const service of Object.values(facts.mobility.access.byService)) {
      for (const mode of Object.values(service)) mode.comparison = null
    }

    const first = resolveMobiliteThemeContent(facts)
    const second = resolveMobiliteThemeContent(facts)

    expect(first).toEqual(second)
    expect(JSON.stringify(first)).not.toContain('médiane')
    expect(first.units[0].sections[0].lecture).not.toBeNull()
    expect(first.units[0].sections[1].lecture?.marelle).toBe('Service minimum assuré?')
    expect(first.units[0].sections[2].lecture).not.toBeNull()
    expect(first.units[0].sections[3].lecture?.marelle).toBe('... Tous les bâtiments non plus')
  })

})
