import { describe, expect, it } from 'vitest'

import type {
  ComparisonScope,
  FactComparison,
  FactProvenance,
  MobiliteAccessFacts,
  MobiliteAccessModes,
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
    byService: Object.fromEntries(
      services.map((service) => [service, accessModes(1, 0.8, 0.6)]),
    ) as Record<(typeof services)[number], MobiliteAccessModes>,
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
  it('resolves one ordered unit with the three semantic sections and their evidence', () => {
    const content = resolveMobiliteThemeContent(completeFacts)
    const unit = content.units[0]!
    const [diversity, total, essentials] = unit.sections

    expect(content).toMatchObject({
      theme: 'mobilite',
      territory: completeFacts.territory,
      sourceRegister: [{ id: 'mobilite_snapshot', source: 'Snapshot Mobilité' }],
    })
    expect(unit.label).toBe('Accès aux services')
    expect(unit.sections.map((section) => section.label)).toEqual([
      'Perte de diversité',
      'Perte totale d’accès',
      'Services essentiels',
    ])

    expect(diversity.availability).toBe('complete')
    expect(diversity.evidence).toMatchObject({
      kind: 'distribution',
      distribution: { min: 28, max: 47 },
      marks: {
        walkTransit: { fact: { key: 'div_loss_t', value: 38 } },
        bike: { fact: { key: 'div_loss_b', value: 24 } },
      },
    })
    expect(diversity.evidence?.kind === 'distribution' ? diversity.evidence.peers : []).toHaveLength(2)
    expect(diversity.explorationTargets.map((target) => target.key)).toEqual([
      'div_loss_t',
      'div_loss_b',
    ])
    expect(diversity.lecture?.marelle).toBe('Ce que l’on perd sans voiture')
    expect(lectureText(diversity.lecture)).toBe(
      'À Commune A, le bâtiment médian perd accès à 38 types de services à pied + TC en vingt minutes. À vélo + TC, cette perte atteint 24 types de services. La référence est la médiane communes de son EPCI : 31 types de services.',
    )

    expect(total.availability).toBe('complete')
    expect(total.evidence).toMatchObject({
      kind: 'comparison',
      rows: [
        { fact: { key: 'tot_loss_t', value: 4 } },
        { fact: { key: 'tot_loss_b', value: 2 } },
      ],
    })
    expect(total.explorationTargets.map((target) => target.key)).toEqual([
      'tot_loss_t',
      'tot_loss_b',
    ])
    expect(total.lecture?.marelle).toBe('Et en volume ?')
    expect(lectureText(total.lecture)).toBe(
      'À Commune A, la perte totale atteint 4 accès par bâtiment à pied + TC, contre 2 à vélo + TC. La référence est la médiane communes de son EPCI : 6 accès perdus.',
    )

    expect(essentials.availability).toBe('complete')
    expect(essentials.indicators.map((indicator) => indicator.fact.key)).toEqual(
      accessIndicators,
    )
    expect(essentials.evidence).toMatchObject({
      kind: 'access',
      services: expect.arrayContaining([expect.objectContaining({ service: 'administration' })]),
      bpeProfiles: [
        expect.objectContaining({
          profile: 'inaccessible-20-minutes',
          count: 2,
          exemplar: expect.objectContaining({ typequ: 'A128' }),
        }),
      ],
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
    expect(essentials.lecture?.marelle).toBe('Tous les équipements ne se valent pas')
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

    const diversity = resolveMobiliteThemeContent(facts).units[0].sections[0]

    expect(diversity.availability).toBe('incomplete')
    expect(diversity.indicators.map((indicator) => [indicator.fact.key, indicator.fact.value])).toEqual([
      ['div_loss_t', 38],
      ['div_loss_b', 24],
    ])
    expect(diversity.evidence).toBeNull()
    expect(diversity.lecture).toBeNull()
  })

  it('keeps a partial total-loss comparison visible without composing its Lecture', () => {
    const facts = structuredClone(completeFacts)
    facts.mobility.indicators = facts.mobility.indicators.filter(
      (indicator) => indicator.key !== 'tot_loss_b',
    )

    const total = resolveMobiliteThemeContent(facts).units[0].sections[1]

    expect(total.availability).toBe('incomplete')
    expect(total.evidence).toMatchObject({
      kind: 'comparison',
      rows: [{ fact: { key: 'tot_loss_t' } }],
    })
    expect(total.lecture).toBeNull()
    expect(total.explorationTargets.map((target) => target.key)).toEqual(['tot_loss_t'])
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
    expect(first.units[0].sections[1].lecture).not.toBeNull()
    expect(first.units[0].sections[2].lecture).not.toBeNull()
  })

})
