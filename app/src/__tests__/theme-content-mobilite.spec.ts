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

function blocksText(blocks: readonly (readonly { value: string }[])[]): string {
  return blocks.map((block) => block.map((segment) => segment.value).join('')).join(' ')
}

describe('Mobilité page rundown', () => {
  it('grounds figure-reading examples in the current distribution and summary', () => {
    const content = resolveMobiliteThemeContent(completeFacts)
    const summary = content.units[0].sections[0].evidence!
    const distribution = content.units[0].sections[3].evidence!
    expect(blocksText(summary.figureLecture)).toContain('Ici,')
    expect(blocksText(summary.figureLecture)).toContain('30')
    expect(blocksText(distribution.buildingDistributionLecture)).toContain('60 %')
    expect(blocksText(distribution.buildingDistributionLecture)).toContain('10–24')
    expect(blocksText(content.units[0].sections[1].evidence!.figureLecture)).toContain('France services')
    expect(blocksText(content.units[0].sections[2].evidence!.figureLecture)).toContain('La part à vélo atteint donc ce niveau')
    const changed = structuredClone(completeFacts)
    changed.mobility.access.summary.averageLosses.diversity.walkTransit.value = 12
    expect(blocksText(resolveMobiliteThemeContent(changed).units[0].sections[0].evidence!.figureLecture)).toContain('12')
  })

  it('resolves the current territory as a bike bridge without turning the rundown into a figure reading', () => {
    const content = resolveMobiliteThemeContent(completeFacts)
    const rundown = content.units[0].rundown
    expect(rundown).toHaveLength(1)
    expect(blocksText(rundown)).toContain('vélo')
    expect(blocksText(rundown)).toContain('voiture')
    expect(blocksText(rundown)).not.toContain(';')
    expect(blocksText(rundown)).toContain('services essentiels')
    expect(rundown[0]).toContainEqual(expect.objectContaining({ kind: 'emphasis', tone: 'bike' }))
    expect(rundown[0]).toContainEqual(expect.objectContaining({ kind: 'emphasis', tone: 'car' }))
    expect(content.units[0].sections[0].lecture?.prose.length).toBeGreaterThan(0)
    expect(resolveMobiliteThemeContent(completeFacts).units[0].rundown).toEqual(rundown)
  })

  it('reads a hub as broad walking diversity with greater car depth', () => {
    const facts = structuredClone(completeFacts)
    facts.mobility.access.summary.accessibleTypes.walkTransit.value = 40
    facts.mobility.access.summary.accessibleEquipment.walkTransit.value = 40
    const paragraph = blocksText(resolveMobiliteThemeContent(facts).units[0].rundown)
    expect(paragraph).toContain('gamme de services déjà diversifiée')
    expect(paragraph).toContain('choix entre plusieurs établissements')
    expect(paragraph).toContain('profondeur d’offre')
    expect(paragraph).toContain('compense une partie du volume perdu')
    expect(paragraph).not.toContain('dépend')
    expect(resolveMobiliteThemeContent(facts).units[0].rundown[0]).toContainEqual(expect.objectContaining({ kind: 'emphasis', tone: 'foot' }))
    const tones = resolveMobiliteThemeContent(facts).units[0].rundown[0]
      .filter((segment) => segment.kind === 'emphasis')
      .map((segment) => segment.tone)
    expect(tones).toEqual(['foot', 'default', 'bike'])
  })

  it('does not call a high-access concentration uneven', () => {
    const facts = structuredClone(completeFacts)
    facts.mobility.access.summary.accessibleTypes.walkTransit.value = 40
    facts.mobility.access.summary.accessibleEquipment.walkTransit.value = 40
    facts.mobility.buildingDistribution!.cells = facts.mobility.buildingDistribution!.cells.map((cell, index) => ({
      ...cell,
      buildingCount: cell.breadthBucket === '40-53' && cell.depthBucket === '500+' ? 88 : index === 0 ? 12 : 0,
      share: cell.breadthBucket === '40-53' && cell.depthBucket === '500+' ? 0.88 : index === 0 ? 0.12 : 0,
    }))
    const paragraph = blocksText(resolveMobiliteThemeContent(facts).units[0].rundown)
    expect(paragraph).not.toContain('socle pour une partie')
    expect(paragraph).not.toContain('très limité')
  })

  it('reads strong walking access positively', () => {
    const facts = structuredClone(completeFacts)
    facts.mobility.access.summary.accessibleTypes.walkTransit.value = 40
    facts.mobility.access.summary.accessibleEquipment.walkTransit.value = 70
    const paragraph = blocksText(resolveMobiliteThemeContent(facts).units[0].rundown)
    expect(paragraph).toContain('marche et les transports en commun')
    expect(paragraph).toContain('accès sans voiture reste largement possible')
    expect(paragraph).not.toContain('profondeur d’offre')
    const tones = resolveMobiliteThemeContent(facts).units[0].rundown[0]
      .filter((segment) => segment.kind === 'emphasis')
      .map((segment) => segment.tone)
    expect(tones).toEqual(['foot', 'default'])
  })

  it('does not mistake similar low access across modes for walkability', () => {
    const facts = structuredClone(completeFacts)
    for (const mode of Object.values(facts.mobility.access.summary.accessibleTypes)) mode.value = 8
    for (const mode of Object.values(facts.mobility.access.summary.accessibleEquipment)) mode.value = 20
    const paragraph = blocksText(resolveMobiliteThemeContent(facts).units[0].rundown)
    expect(paragraph).toContain('offre accessible reste limitée quel que soit le mode')
    expect(paragraph).not.toContain('accès sans voiture reste largement possible')
  })

  it('does not use BPE profile classifications as average access narrative', () => {
    const facts = structuredClone(completeFacts)
    facts.mobility.access.summary.accessibleTypes.bike.value = 20
    facts.mobility.access.summary.accessibleEquipment.bike.value = 40
    facts.mobility.access.summary.accessibleTypes.walkTransit.value = 20
    facts.mobility.access.summary.accessibleEquipment.walkTransit.value = 40
    const profile = completeFacts.mobility.bpeAccess.profiles[0]!
    facts.mobility.bpeAccess.profiles = [
      { ...profile, profile: 'voiture-requise', count: 8 },
      { ...profile, profile: 'inaccessible-20-minutes', count: 4 },
      { ...profile, profile: 'acces-pied-tc', count: 2 },
    ]
    const paragraph = blocksText(resolveMobiliteThemeContent(facts).units[0].rundown)
    expect(paragraph).toContain('structure largement')
    expect(paragraph).not.toContain('uniquement en voiture')
  })

  it('reads broad car advantage as dependence only when both dimensions and both alternatives fall behind', () => {
    const facts = structuredClone(completeFacts)
    facts.mobility.access.summary.accessibleTypes.bike.value = 24
    facts.mobility.access.summary.accessibleEquipment.bike.value = 45
    facts.mobility.access.summary.accessibleTypes.walkTransit.value = 20
    facts.mobility.access.summary.accessibleEquipment.walkTransit.value = 40
    const paragraph = blocksText(resolveMobiliteThemeContent(facts).units[0].rundown)
    expect(paragraph).toContain('voiture')
    expect(paragraph).toContain('structure largement')
    expect(paragraph).not.toContain('vélo')
    expect(paragraph).toContain('socle pour une partie')
    expect(resolveMobiliteThemeContent(facts).units[0].rundown[0]).toContainEqual(expect.objectContaining({ kind: 'emphasis', tone: 'car' }))
  })

  it('reads a meaningful bike recovery with both bike and car emphasis', () => {
    const facts = structuredClone(completeFacts)
    facts.mobility.access.summary.accessibleTypes.bike.value = 38
    facts.mobility.access.summary.accessibleEquipment.bike.value = 75
    const paragraph = blocksText(resolveMobiliteThemeContent(facts).units[0].rundown)
    expect(paragraph).toContain('vélo')
    expect(paragraph).toContain('véritable relais')
    expect(resolveMobiliteThemeContent(facts).units[0].rundown[0]).toContainEqual(expect.objectContaining({ kind: 'emphasis', tone: 'bike' }))
    expect(resolveMobiliteThemeContent(facts).units[0].rundown[0]).toContainEqual(expect.objectContaining({ kind: 'emphasis', tone: 'car' }))
  })

  it('keeps mixed territories mixed when no mode signature clears the branch', () => {
    const facts = structuredClone(completeFacts)
    facts.mobility.access.summary.accessibleTypes.bike.value = 38
    facts.mobility.access.summary.accessibleEquipment.bike.value = 80
    facts.mobility.access.summary.accessibleTypes.walkTransit.value = 35
    facts.mobility.access.summary.accessibleEquipment.walkTransit.value = 50
    const paragraph = blocksText(resolveMobiliteThemeContent(facts).units[0].rundown)
    expect(paragraph).toContain('ne produisent pas la même forme d’accès')
    expect(paragraph).toContain('Le vélo élargit l’offre accessible sans voiture')
    expect(resolveMobiliteThemeContent(facts).units[0].rundown[0]).toContainEqual(expect.objectContaining({ kind: 'emphasis', tone: 'car' }))
    expect(resolveMobiliteThemeContent(facts).units[0].rundown[0]).toContainEqual(expect.objectContaining({ kind: 'emphasis', tone: 'foot' }))
  })

  it('makes a genuinely uneven walking distribution a distinct second reading', () => {
    const facts = structuredClone(completeFacts)
    facts.mobility.access.summary.accessibleTypes.walkTransit.value = 40
    facts.mobility.access.summary.accessibleEquipment.walkTransit.value = 40
    facts.mobility.buildingDistribution!.cells = facts.mobility.buildingDistribution!.cells.map((cell) => ({
      ...cell,
      buildingCount: cell.breadthBucket === '0' && cell.depthBucket === '0' ? 60 : 0,
      share: cell.breadthBucket === '0' && cell.depthBucket === '0' ? 0.6 : 0,
    }))
    const paragraph = blocksText(resolveMobiliteThemeContent(facts).units[0].rundown)
    expect(paragraph).toContain('Pour une majorité des bâtiments')
    expect(paragraph).not.toContain('socle pour une partie')
  })

  it('keeps the incomplete state honest instead of classifying a mode', () => {
    const facts = structuredClone(completeFacts)
    for (const modes of [facts.mobility.access.summary.accessibleTypes, facts.mobility.access.summary.accessibleEquipment]) {
      for (const mode of Object.values(modes)) {
        mode.value = null
        mode.availability = 'absent'
      }
    }
    const paragraph = blocksText(resolveMobiliteThemeContent(facts).units[0].rundown)
    expect(paragraph).toContain('ne permettent pas de dégager une lecture d’ensemble')
    expect(paragraph).not.toContain('voiture')
  })
})

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
  { key: '0', min: 0, max: 0, label: '0' },
  { key: '1-9', min: 1, max: 9, label: '1–9' },
  { key: '10-24', min: 10, max: 24, label: '10–24' },
  { key: '25-39', min: 25, max: 39, label: '25–39' },
  { key: '40-53', min: 40, max: 53, label: '40–53' },
]
const buildingDepthBins = [
  { key: '0', min: 0, max: 0, label: '0' },
  { key: '1-9', min: 1, max: 9, label: '1–9' },
  { key: '10-49', min: 10, max: 49, label: '10–49' },
  { key: '50-199', min: 50, max: 199, label: '50–199' },
  { key: '200-499', min: 200, max: 499, label: '200–499' },
  { key: '500+', min: 500, max: null, label: '500 ou +' },
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
        comparisonBuildingCount: buildingCount,
        comparisonShare: buildingCount / 100,
      }
    }),
  ),
  totalBuildings: 100,
  provenance,
  comparisonLabel: 'communes de l’EPCI',
  comparisonTotalBuildings: 100,
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
    expect(profiles.lecture?.prose[0]).toContainEqual({
      kind: 'emphasis',
      tone: 'neutral',
      value: 'celui des types inaccessibles ou presque',
    })
    expect(profiles.lecture?.prose[0]).toContainEqual({
      kind: 'emphasis',
      tone: 'default',
      value: 'confirme',
    })

    expect(distribution.availability).toBe('complete')
    expect(distribution.evidence).toMatchObject({
      kind: 'distribution',
      buildingDistribution: {
        availability: 'complete',
        mode: 't',
        totalBuildings: 100,
        breadthAxisLabel: 'types d’équipements accessibles',
        depthAxisLabel: 'équipements accessibles',
      },
      comparisonPopulationLabel: 'bâtiments de EPCI X',
      buildingDistributionLecture: expect.any(Array),
      accessRampLecture: expect.any(Array),
    })
    expect(
      distribution.evidence?.kind === 'distribution'
        ? distribution.evidence.buildingDistribution?.cells
        : [],
    ).toContainEqual(expect.objectContaining({
      breadthBucket: '1-9',
      depthBucket: '1-9',
      buildingCount: 40,
      share: 0.4,
      comparisonBuildingCount: 40,
      comparisonShare: 0.4,
    }))
    expect(distribution.explorationTargets).toEqual([])
    expect(distribution.lecture).toEqual({
      marelle: '... Toutes les résidences non plus.',
      prose: [],
    })
    expect(summary.lecture?.marelle).toBe('Ce que l’on perd sans voiture')
    expect(summary.evidence?.kind === 'summary' ? blocksText(summary.evidence.figureLecture) : '').toContain('Les valeurs comparent, pour chaque mode')
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
    expect(lectureText(essentials.lecture)).not.toContain(
      'Cette partie présente cinq regroupements de services essentiels.',
    )
    expect(essentials.evidence?.kind === 'access' ? blocksText(essentials.evidence.figureLecture) : '').toContain('trois bâtiments sur quatre')
    expect(lectureText(essentials.lecture)).toContain(
      'À Commune A, pour les cinq services essentiels, au moins trois bâtiments sur quatre y ont accès à vélo et en voiture, mais pas à pied ou en transports en commun.',
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
        expected: 'pour les cinq services essentiels, au moins trois bâtiments sur quatre y ont accès, quel que soit le mode de transport.',
      },
      {
        values: [0.74, 0.75, 0.75],
        expected: 'pour les cinq services essentiels, au moins trois bâtiments sur quatre y ont accès à pied ou en transports en commun et à vélo, mais pas en voiture.',
      },
      {
        values: [0.75, 0.75, 0.74],
        expected: 'pour les cinq services essentiels, au moins trois bâtiments sur quatre y ont accès à vélo et en voiture, mais pas à pied ou en transports en commun.',
      },
      {
        values: [0.74, 0.75, 0.74],
        expected: 'pour les cinq services essentiels, au moins trois bâtiments sur quatre y ont accès à vélo, mais pas à pied ou en transports en commun ni en voiture.',
      },
      {
        values: [0.75, 0.74, 0.74],
        expected: 'pour les cinq services essentiels, au moins trois bâtiments sur quatre y ont accès en voiture, mais pas avec les autres modes.',
      },
      {
        values: [0.74, 0.74, 0.74],
        expected: 'pour les cinq services essentiels, aucun mode ne permet à trois bâtiments sur quatre d’y accéder.',
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

       expect(lectureText(lecture)).toContain(`À Commune A, ${testCase.expected}`)
    }
  })

  it('bolds the coverage definition and keeps peer gap readings above the 10-point threshold', () => {
    const essentials = resolveMobiliteThemeContent(completeFacts).units[0]!.sections[2]!
    const lecture = essentials.lecture!

    expect(essentials.evidence?.kind === 'access' ? essentials.evidence.figureLecture[0] : []).toContainEqual({
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

    expect(lecture?.prose[0]).toContainEqual({
      kind: 'emphasis',
      tone: 'default',
      value: 'nuance',
    })
    expect(lecture?.prose[0]).toContainEqual({
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

    expect(lecture?.prose[0]).toContainEqual({
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

  it('keeps an incomplete building distribution visible without a Lecture', () => {
    const facts = structuredClone(completeFacts)
    facts.mobility.buildingDistribution!.availability = 'incomplete'

    const distribution = resolveMobiliteThemeContent(facts).units[0].sections[3]

    expect(distribution.availability).toBe('incomplete')
    expect(distribution.indicators).toEqual([])
    expect(distribution.evidence?.kind).toBe('distribution')
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
    }
    facts.mobility.buildingDistribution = null
    facts.mobility.accessRamp = null
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
    expect(JSON.stringify(first.units[0].sections.map((section) => section.lecture))).not.toContain('médiane')
    expect(first.units[0].sections[0].lecture).not.toBeNull()
    expect(first.units[0].sections[1].lecture?.marelle).toBe('Service minimum ?')
    expect(first.units[0].sections[2].lecture).not.toBeNull()
    expect(first.units[0].sections[3].lecture).toEqual({
      marelle: '... Toutes les résidences non plus.',
      prose: [],
    })
  })

})
