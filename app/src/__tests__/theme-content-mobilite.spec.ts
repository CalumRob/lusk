import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'

import CahierMobiliteSection from '@/fiche/prototype/CahierMobiliteSection.vue'

import type {
  ComparisonScope,
  FactComparison,
  FactProvenance,
  NumericFact,
  TerritoryFacts,
} from '@/fiche/content/territoryFacts'
import { chapterForSectionAnchor, resolveMobiliteThemeContent } from '@/fiche/content/themeContent'
import { buildPartageSubtitle, buildMobiliteRaccordementSection, buildMobiliteShareSection } from '@/fiche/content/mobiliteSections'
import type { ThemeMetadata } from '@/payload/types'
import liveNetworks from './fixtures/rennes-network-live.json'

const provenance = (sourceId: string): FactProvenance => ({
  sourceId,
  source: `Source ${sourceId}`,
  version: '2026-08',
  referenceDate: '2026-08-01',
  publicationDate: '2026-08-02',
})

const scope: ComparisonScope = {
  kind: 'communes-epci',
  label: 'communes de EPCI X',
  territoryIds: ['22001', '22002'],
}

function comparison(value: number, direction: FactComparison['direction'] = 'plus-est-mieux'): FactComparison {
  return {
    direction,
    scope,
    rank: { position: 2, size: 3 },
    reference: { kind: 'median', value },
  }
}

function fact(
  key: string,
  value: number | null,
  unit = '%',
  detail: string | null = null,
  sourceId = 'osm_reseaux',
): NumericFact {
  return {
    key,
    detail,
    value,
    unit,
    availability: value === null ? 'incomplete' : 'complete',
    provenance: provenance(sourceId),
    comparison: comparison(value === null ? 1 : value + 0.5),
    comparisonBasis: 'territory-median',
    reason: null,
  }
}

const metadata = {
  theme: 'mobilite',
  label: 'Mobilité',
  subgroups: [],
  indicator_keys: [],
  sources: {},
  indicator_labels: {},
  detail_labels: {
    reseaux_par_habitant: {
      t_km_1000: 'Longueur — à pied',
      b_km_1000: 'Longueur — à vélo',
      c_km_1000: 'Longueur — en voiture',
    },
    reseaux: {
      t_longueur: 'Longueur — à pied ou en transports en commun',
      b_longueur: 'Longueur — à vélo',
      c_longueur: 'Longueur — en voiture',
    },
    offre_cyclable: {
      protege_km_1000: 'Protégé',
      partage_km_1000: 'Partagé',
    },
  },
  param_labels: {},
  source_records: {
    osm_reseaux: { dataset: 'Réseaux OSM', publisher: 'OpenStreetMap', url: 'https://osm.example/reseaux', licence: 'ODbL', vintage: '2026-08', freshness: '' },
    amenagements_cyclables: { dataset: 'Aménagements cyclables', publisher: 'Geovelo', url: 'https://geovelo.example', licence: 'ODbL', vintage: '2026-08', freshness: '' },
    'stationnement-velo': { dataset: 'Stationnement vélo', publisher: 'Ecolab', url: 'https://ecolab.example', licence: 'ODbL', vintage: '2022-2025', freshness: '' },
    'bornes-recharges': { dataset: 'IRVE', publisher: 'Etalab', url: 'https://etalab.example', licence: 'Licence Ouverte 2.0', vintage: '2026-07', freshness: '' },
    bpe_b316: { dataset: 'BPE B316', publisher: 'INSEE', url: 'https://insee.example', licence: 'Licence Ouverte 2.0', vintage: '2025', freshness: '' },
  },
} as unknown as ThemeMetadata

const territory = {
  code: '22001',
  type: 'commune' as const,
  name: 'Commune A',
  department: '22',
  epci: '200000001',
  epciName: 'EPCI X',
}

function factsWith(indicators: NumericFact[], comparisonStatistic?: 'mean' | 'median'): TerritoryFacts {
  return {
    territory,
    theme: 'mobilite',
    mobility: { namedTrajectoryReferences: [], indicators,
      ...(comparisonStatistic ? { comparisonStatistic } : {}) },
  }
}

const sharingFacts = (): NumericFact[] => [
  fact('voitures_menage', 0.05, '%', 'sans_voiture', 'rp_logement_princ'),
  fact('voitures_menage', 0.45, '%', 'une_voiture', 'rp_logement_princ'),
  fact('voitures_menage', 0.5, '%', 'deux_plus', 'rp_logement_princ'),
  fact('surface_reseaux_routiers', 0.12, '%', null, 'ocsge_reseaux_routiers'),
  fact('reseaux_par_habitant', 12, 'km / 1 000 hab.', 't_km_1000'),
  fact('reseaux_par_habitant', 8, 'km / 1 000 hab.', 'b_km_1000'),
  fact('reseaux_par_habitant', 80, 'km / 1 000 hab.', 'c_km_1000'),
  fact('reseaux', 10, 'km', 't_longueur'),
  fact('reseaux', 6, 'km', 'b_longueur'),
  fact('reseaux', 30, 'km', 'c_longueur'),
  fact('offre_cyclable', 5, 'km / 1 000 hab.', 'protege_km_1000', 'amenagements_cyclables'),
  fact('offre_cyclable', 3, 'km / 1 000 hab.', 'partage_km_1000', 'amenagements_cyclables'),
  fact('offre_cyclable', 4, 'km', 'protege_longueur', 'amenagements_cyclables'),
  fact('offre_cyclable', 2, 'km', 'partage_longueur', 'amenagements_cyclables'),
  fact('places_stationnement_velo_1000', 5, 'places / 1 000 hab', null, 'stationnement-velo'),
  fact('places_stationnement_voiture_1000', 25, 'places / 1 000 hab'),
  fact('stationnement_velo_par_voiture', 0.2, 'places vélo / place voiture'),
  fact('bornes_recharge', 7, 'bornes', null, 'bornes-recharges'),
  fact('bornes_recharge_1000', 0.4, 'bornes / 1 000 hab', null, 'bornes-recharges'),
  fact('stations_service', 2, 'stations', null, 'bpe_b316'),
  fact('stations_service_1000', 0.1, 'stations / 1 000 hab', null, 'bpe_b316'),
  fact('bornes_ev_par_station_service', 3.5, 'bornes / station', null, 'bpe_b316'),
]

describe('resolveMobiliteThemeContent — #954 page 2 contract', () => {
  it('publishes three units in order and removes the motorisation unit', () => {
    const content = resolveMobiliteThemeContent(factsWith(sharingFacts()), metadata)
    expect(content.units.map((unit) => [unit.key, unit.label])).toEqual([
      ['acces-aux-services', 'L’accès aux services'],
      ['partage-de-lespace-public', 'Le partage de l’espace public'],
      ['offre-transports-commun', 'L’offre de transports en commun'],
    ])
    expect(JSON.stringify(content)).not.toContain('motorisation')
    expect(JSON.stringify(content)).not.toContain('offre-cyclable')
  })

  it('builds the single grammatical subtitle from published parts', () => {
    const subtitle = buildPartageSubtitle(factsWith(sharingFacts())).flat().map((segment) => segment.value).join('')
    expect(subtitle).toBe(
      '95 % des ménages ont au moins une voiture. 50 % en ont deux ou plus. L’emprise routière couvre 12 % de la surface du territoire.',
    )
    const unit = resolveMobiliteThemeContent(factsWith(sharingFacts()), metadata).units[1]
    expect(unit.introduction.flat().map((segment) => segment.value).join('')).toBe(subtitle)
    expect(unit.rundown).toBeUndefined()
    expect(unit).not.toHaveProperty('rundown')
  })

  it('proves the published car-owner share equals both 1 − sans_voiture and une_voiture + deux_plus', () => {
    const indicators = sharingFacts()
    const valueOf = (detail: string) => indicators.find((candidate) => candidate.key === 'voitures_menage' && candidate.detail === detail)!.value
    const sans = valueOf('sans_voiture')!
    const une = valueOf('une_voiture')!
    const deux = valueOf('deux_plus')!
    expect(une + deux).toBeCloseTo(1 - sans, 10)
    expect(une + deux).toBeCloseTo(0.95, 10)
  })

  it('keeps each subtitle clause grammatical and silent in the incomplete states', () => {
    const base = sharingFacts()
    const without = (detail: string) => base.filter((candidate) =>
      !(candidate.key === 'voitures_menage' && candidate.detail === detail),
    )

    expect(buildPartageSubtitle(factsWith(without('sans_voiture'))).flat().map((s) => s.value).join(''))
      .toBe('95 % des ménages ont au moins une voiture. 50 % en ont deux ou plus. L’emprise routière couvre 12 % de la surface du territoire.')

    const noUne = buildPartageSubtitle(factsWith(without('une_voiture'))).flat().map((s) => s.value).join('')
    expect(noUne).toBe('50 % des ménages ont deux voitures ou plus. L’emprise routière couvre 12 % de la surface du territoire.')

    const noDeux = buildPartageSubtitle(factsWith(without('deux_plus'))).flat().map((s) => s.value).join('')
    expect(noDeux).toBe('L’emprise routière couvre 12 % de la surface du territoire.')

    const noSurface = buildPartageSubtitle(factsWith(base.filter((candidate) => candidate.key !== 'surface_reseaux_routiers')))
      .flat().map((s) => s.value).join('')
    expect(noSurface).toBe('95 % des ménages ont au moins une voiture. 50 % en ont deux ou plus.')
  })

  it('resolves the Réseaux section with published densities, bike segments and raw tooltip facts', () => {
    const content = resolveMobiliteThemeContent(factsWith(sharingFacts()), metadata)
    const section = content.units[1].sections[0]

    expect([section.key, section.label]).toEqual(['reseaux', 'Réseaux'])
    expect(section.lecture).toBeNull()
    expect(section.evidence?.kind).toBe('mobilite-networks')
    if (section.evidence?.kind !== 'mobilite-networks') throw new Error('Réseaux evidence expected')
    const evidence = section.evidence

    expect(evidence.mapFigureTitle).toBe('Cartes des réseaux de mobilité, par mode')
    expect(evidence.figure.figureTitle).toBe('Longueur du réseau par habitant')
    expect(evidence.figure.unit).toBe('km / 1 000 hab.')
    expect(evidence.figure.xAxisTitle).toBe('Réseau')
    expect(evidence.figure.yAxisTitle).toBe('km / 1 000 hab.')
    expect(evidence.figure.comparisonLabel).toBe('Médiane des communes de EPCI X')

    const [walk, bike, car] = evidence.figure.categories
    expect([walk!.key, walk!.axisLabel, walk!.value.fact.value]).toEqual(['walkTransit', 'à pied', 12])
    expect([bike!.key, bike!.axisLabel, bike!.value.fact.value]).toEqual(['bike', 'à vélo', 8])
    expect([car!.key, car!.axisLabel, car!.value.fact.value]).toEqual(['car', 'en voiture', 80])

    expect(bike!.segments.map((segment) => [segment.label, segment.value.fact.value])).toEqual([
      ['Protégé', 5],
      ['Partagé', 3],
    ])
    expect(bike!.segments.map((segment) => segment.rawValue?.fact)).toEqual([
      expect.objectContaining({ key: 'offre_cyclable', detail: 'protege_longueur', value: 4, unit: 'km' }),
      expect.objectContaining({ key: 'offre_cyclable', detail: 'partage_longueur', value: 2, unit: 'km' }),
    ])
    expect(bike!.segments.reduce((sum, segment) => sum + (segment.value.fact.value ?? 0), 0)).toBe(bike!.value.fact.value)
    expect(walk!.segments).toEqual([])
    expect(car!.segments).toEqual([])

    expect(walk!.rawValue?.fact).toMatchObject({ key: 'reseaux', detail: 't_longueur', value: 10, unit: 'km' })
    expect(bike!.rawValue?.fact).toMatchObject({ key: 'reseaux', detail: 'b_longueur', value: 6, unit: 'km' })
    expect(car!.rawValue?.fact).toMatchObject({ key: 'reseaux', detail: 'c_longueur', value: 30, unit: 'km' })
    // App-owned raw row wording overrides the stale producer alias: the new
    // page says walking only, while the fact identity and unit stay published.
    expect(walk!.rawValue?.label).toBe('Longueur brute — à pied')
    expect(walk!.rawValue?.label).not.toContain('transports en commun')
    expect(bike!.rawValue?.label).toBe('Longueur brute — à vélo')
    expect(car!.rawValue?.label).toBe('Longueur brute — en voiture')

    expect(evidence.sources.map((source) => [source.id, source.source, source.url, source.licence])).toEqual([
      ['osm_reseaux', 'OpenStreetMap', 'https://osm.example/reseaux', 'ODbL'],
      ['amenagements_cyclables', 'Geovelo', 'https://geovelo.example', 'ODbL'],
    ])
    expect(evidence.prose.flat().map((segment) => segment.value).join(' '))
      .toContain('vraisemblablement praticables à pied')
    expect(evidence.prose.flat().map((segment) => segment.value).join(' '))
      .not.toContain('transports en commun')
    expect(section.explorationTargets.some((target) => target.key === 'reseaux_par_habitant')).toBe(true)
  })

  it('resolves the paired parking/refuelling section with its two ratio lines', () => {
    const content = resolveMobiliteThemeContent(factsWith(sharingFacts()), metadata)
    const section = content.units[1].sections[1]

    expect([section.key, section.label]).toEqual(['stationnement-ravitaillement', 'Se garer et se ravitailler'])
    expect(section.lecture).toBeNull()
    expect(section.evidence?.kind).toBe('mobilite-stationnement-ravitaillement')
    if (section.evidence?.kind !== 'mobilite-stationnement-ravitaillement') throw new Error('Paired evidence expected')

    const [parking, refuelling] = section.evidence.columns
    expect(parking!.key).toBe('stationnement')
    expect(parking!.bars.figureTitle).toBe('Stationnement vélo et voiture')
    expect(parking!.bars.unit).toBe('places / 1 000 hab')
    expect(parking!.bars.categories.map((category) => [category.label, category.value.fact.value, category.rawValue])).toEqual([
      ['Vélo', 5, null],
      ['Voiture', 25, null],
    ])
    expect(parking!.ratio.value.fact).toMatchObject({ key: 'stationnement_velo_par_voiture', value: 0.2 })
    expect(parking!.ratio.note).toBeNull()
    expect(parking!.sources.map((source) => source.source)).toEqual(['Ecolab', 'OpenStreetMap'])

    expect(refuelling!.key).toBe('ravitaillement')
    expect(refuelling!.bars.figureTitle).toBe('Bornes de recharge et station-services')
    expect(refuelling!.bars.unit).toBe('équipements / 1 000 hab.')
    expect(refuelling!.bars.categories.map((category) => [category.label, category.value.fact.value, category.rawValue?.fact.value])).toEqual([
      ['Bornes de recharge', 0.4, 7],
      ['Stations-service', 0.1, 2],
    ])
    expect(refuelling!.ratio.value.fact).toMatchObject({ key: 'bornes_ev_par_station_service', value: 3.5 })
    expect(refuelling!.sources.map((source) => source.source)).toEqual(['Etalab', 'INSEE'])
    expect(refuelling!.prose.flat().map((segment) => segment.value).join(' ')).toContain('aucune station n’est recensée')
  })

  // #976 — the owner asked for a distinct colour for the charging category.
  // Charging keeps the app's brand ink; the fuel-station category takes the
  // existing car ink its fuel meaning already carries. Neither category
  // identity changes.
  it('gives the charging bar the brand tone and the fuel-station bar the car tone', () => {
    const content = resolveMobiliteThemeContent(factsWith(sharingFacts()), metadata)
    const section = content.units[1].sections[1]
    if (section.evidence?.kind !== 'mobilite-stationnement-ravitaillement') throw new Error('Paired evidence expected')
    const refuelling = section.evidence.columns[1]!

    expect(refuelling.bars.categories.map(({ key, tone }) => ({ key, tone }))).toEqual([
      { key: 'charging', tone: 'brand' },
      { key: 'fuel-stations', tone: 'c' },
    ])
    // The factual labels, values and raw counts stay untouched.
    expect(refuelling.bars.categories.map((category) => category.label)).toEqual([
      'Bornes de recharge',
      'Stations-service',
    ])
    expect(refuelling.bars.categories.map((category) => category.value.fact.key)).toEqual([
      'bornes_recharge_1000',
      'stations_service_1000',
    ])
  })

  // #974 — the ratio captions are app presentation, and the value keeps the
  // producer's own scale: the owner's `%VALUE%` placeholder is this raw number.
  it('captions the two ratios without re-basing their producer scale', () => {
    const content = resolveMobiliteThemeContent(factsWith(sharingFacts()), metadata)
    const section = content.units[1].sections[1]
    if (section.evidence?.kind !== 'mobilite-stationnement-ravitaillement') throw new Error('Paired evidence expected')
    const [parking, refuelling] = section.evidence.columns

    expect(parking!.ratio.label).toBe('places de stationnement vélo pour 1 place voiture')
    expect(parking!.ratio.value.fact.value).toBe(0.2)
    expect(parking!.ratio.value.fact.unit).toBe('places vélo / place voiture')
    expect(refuelling!.ratio.label).toBe('Bornes de recharge par station-service')
    expect(refuelling!.ratio.value.fact.value).toBe(3.5)
  })

  it('keeps ratios honest: zero car denominator and zero stations never fabricate a ratio', () => {
    const indicators = sharingFacts().map((candidate) => {
      if (candidate.key === 'places_stationnement_voiture_1000') return { ...candidate, value: 0 }
      if (candidate.key === 'stationnement_velo_par_voiture') return { ...candidate, value: null, availability: 'incomplete' as const }
      if (candidate.key === 'stations_service') return { ...candidate, value: 0 }
      if (candidate.key === 'stations_service_1000') return { ...candidate, value: 0 }
      if (candidate.key === 'bornes_ev_par_station_service') return { ...candidate, value: null, availability: 'incomplete' as const }
      return candidate
    })
    const content = resolveMobiliteThemeContent(factsWith(indicators), metadata)
    const section = content.units[1].sections[1]
    if (section.evidence?.kind !== 'mobilite-stationnement-ravitaillement') throw new Error('Paired evidence expected')
    const [parking, refuelling] = section.evidence.columns
    expect(parking!.ratio.note).toContain('aucune place de stationnement voiture')
    expect(refuelling!.ratio.note).toContain('aucune station-service')
  })

  it('keeps the captured live Rennes bike partition coherent', () => {
    const indicators = sharingFacts().map((candidate) => {
      const capture = candidate.key === 'reseaux_par_habitant'
        ? liveNetworks.reseauxParHabitant
        : candidate.key === 'reseaux'
          ? liveNetworks.reseaux
          : candidate.key === 'offre_cyclable'
            ? liveNetworks.offreCyclable
            : null
      const value = capture && candidate.detail ? capture[candidate.detail as keyof typeof capture] : null
      return typeof value === 'number' ? { ...candidate, value, availability: 'complete' as const } : candidate
    })
    const content = resolveMobiliteThemeContent(factsWith(indicators), metadata)
    const section = content.units[1].sections[0]
    if (section.evidence?.kind !== 'mobilite-networks') throw new Error('Réseaux evidence expected')
    const bike = section.evidence.figure.categories.find((category) => category.key === 'bike')!
    expect(bike.splitNote).toBeNull()
    expect(bike.value.fact.value).toBeCloseTo(liveNetworks.reseauxParHabitant.b_km_1000, 12)
    expect(bike.segments.reduce((sum, segment) => sum + (segment.value.fact.value ?? 0), 0))
      .toBeCloseTo(liveNetworks.reseauxParHabitant.b_km_1000, 12)
    expect(bike.rawValue?.fact.value).toBeCloseTo(liveNetworks.reseaux.b_longueur, 9)
    expect(bike.segments.reduce((sum, segment) => sum + (segment.rawValue?.fact.value ?? 0), 0))
      .toBeCloseTo(liveNetworks.reseaux.b_longueur, 9)
  })

  it('drops an inconsistent bike split rather than drawing a tiny fake partition', () => {
    const indicators = sharingFacts().map((candidate) => {
      if (candidate.key === 'reseaux_par_habitant' && candidate.detail === 'b_km_1000') return { ...candidate, value: 39 }
      if (candidate.key === 'reseaux' && candidate.detail === 'b_longueur') return { ...candidate, value: 39 }
      if (candidate.key === 'offre_cyclable' && candidate.detail === 'protege_km_1000') return { ...candidate, value: 0.01 }
      if (candidate.key === 'offre_cyclable' && candidate.detail === 'partage_km_1000') return { ...candidate, value: 0.03 }
      if (candidate.key === 'offre_cyclable' && candidate.detail === 'protege_longueur') return { ...candidate, value: 0.01 }
      if (candidate.key === 'offre_cyclable' && candidate.detail === 'partage_longueur') return { ...candidate, value: 0.03 }
      return candidate
    })
    const content = resolveMobiliteThemeContent(factsWith(indicators), metadata)
    const section = content.units[1].sections[0]
    if (section.evidence?.kind !== 'mobilite-networks') throw new Error('Réseaux evidence expected')
    const bike = section.evidence.figure.categories.find((category) => category.key === 'bike')!
    expect(bike.value.fact.value).toBe(39)
    expect(bike.segments).toEqual([])
    expect(bike.splitNote).toContain('ne recomposent pas le total')
  })

  it('keeps the sections honest when their facts are absent', () => {
    const content = resolveMobiliteThemeContent(factsWith([]), metadata)
    const unit = content.units[1]
    expect(unit.sections.map((section) => [section.key, section.availability, section.evidence]))
      .toEqual([
        ['reseaux', 'absent', null],
        ['stationnement-ravitaillement', 'absent', null],
      ])
  })
})

const page3Metadata = {
  ...metadata,
  indicator_labels: {
    ...metadata.indicator_labels,
    offre_tc: 'Part des bâtiments près d’un arrêt (à 500 m)',
    raccordement_courbe: 'Courbe de population bretonne jointe selon le temps de trajet',
    raccordement_tc: 'Population bretonne jointe en 90 minutes en transports en commun',
  },
  indicator_pages: {
    raccordement_courbe: {
      family: 'trajectory',
      trajectory: {
        endpoints: ['t0000', 't0360'],
        axis: 'numeric',
        axisLabels: { x: 'Temps de trajet (minutes)', y: 'Population joignable (%)' },
        ticks: [{ detail: 't0000', label: '0' }, { detail: 't0090', label: '1 h 30' }, { detail: 't0360', label: '6 h' }],
        marker: { detail: 't0090', label: '1 h 30 (90 min)' },
      },
    },
  },
  source_records: {
    ...metadata.source_records,
    korrigo: { dataset: 'Korrigo', publisher: 'Bretagne Mobilité', url: 'https://korrigo.example', licence: 'ODbL', vintage: '2026-02', freshness: '' },
    raccordement_gtfs_national: { dataset: 'GTFS national', publisher: 'Lusk', url: 'https://github.com/CalumRob/lusk', licence: 'ODbL', vintage: '2026-10', freshness: '' },
  },
} as unknown as ThemeMetadata

function withTerritory(facts: TerritoryFacts, type: TerritoryFacts['territory']['type']): TerritoryFacts {
  return { ...facts, territory: { ...facts.territory, type } }
}

describe('Couverture du territoire + Visiter la Bretagne — #955 content contract', () => {
  it('builds the share gauge from the published offre_tc fact and keeps zero as a valid share', () => {
    const complete = buildMobiliteShareSection(factsWith([
      fact('offre_tc', 0.573, '%', null, 'korrigo'),
    ]), page3Metadata)
    expect(complete.key).toBe('couverture-du-territoire')
    expect(complete.label).toBe('Couverture du territoire')
    if (complete.evidence?.kind !== 'mobilite-share') throw new Error('Share evidence expected')
    expect(complete.evidence.figureTitle).toContain('500 m')
    expect(complete.evidence.value.fact.value).toBe(0.573)
    expect(complete.evidence.comparisonLabel).toContain('Médiane des communes de EPCI X')
    expect(complete.evidence.sources[0]).toMatchObject({
      id: 'korrigo', source: 'Bretagne Mobilité', url: 'https://korrigo.example',
    })
    expect(complete.availability).toBe('complete')

    const zero = buildMobiliteShareSection(factsWith([fact('offre_tc', 0, '%', null, 'korrigo')]), page3Metadata)
    expect(zero.availability).toBe('complete')
    if (zero.evidence?.kind !== 'mobilite-share') throw new Error('Zero share evidence expected')
    expect(zero.evidence.value.fact.value).toBe(0)

    const incomplete = buildMobiliteShareSection(factsWith([fact('offre_tc', null, '%', null, 'korrigo')]), page3Metadata)
    expect(incomplete.availability).toBe('incomplete')
    if (incomplete.evidence?.kind !== 'mobilite-share') throw new Error('Incomplete share evidence expected')
    expect(incomplete.evidence.value.fact.value).toBeNull()

    const absent = buildMobiliteShareSection(factsWith([]), page3Metadata)
    expect(absent.availability).toBe('absent')
    expect(absent.evidence).toBeNull()
  })

  it('builds the cumulative curve from the active comparison and silences the missing marker sentence', () => {
    const facts = factsWith([
      fact('raccordement_courbe', 0.2, '%', 't0090', 'raccordement_gtfs_national'),
      fact('raccordement_tc', 0.2, '%', null, 'raccordement_gtfs_national'),
    ])
    const section = buildMobiliteRaccordementSection(facts, page3Metadata)
    expect(section.key).toBe('visiter-la-bretagne')
    expect(section.label).toBe('Visiter la Bretagne')
    if (section.evidence?.kind !== 'mobilite-raccordement') throw new Error('Curve evidence expected')
    const prose = section.evidence.prose.flat().map((segment) => segment.value).join(' ')
    expect(prose).toContain('À 1 h 30 (90 min), 20 % de la population bretonne est joignable depuis les arrêts du territoire.')
    expect(prose).not.toContain('Le pointillé représente la moyenne du groupe comparé.')
    expect(prose).toContain('zéros du modèle inclus.')
    expect(section.evidence.sources[0].id).toBe('raccordement_gtfs_national')
    expect(section.evidence).not.toHaveProperty('namedReference')

    const missingMarker = buildMobiliteRaccordementSection(factsWith([
      fact('raccordement_courbe', 0.2, '%', 't0090', 'raccordement_gtfs_national'),
    ]), page3Metadata)
    if (missingMarker.evidence?.kind !== 'mobilite-raccordement') throw new Error('Curve without marker evidence expected')
    const silentProse = missingMarker.evidence.prose.flat().map((segment) => segment.value).join(' ')
    expect(missingMarker.evidence.markerValue).toBeNull()
    expect(silentProse).not.toContain('À 1 h 30')
    expect(silentProse).not.toMatch(/undefined|NaN/u)
    expect(silentProse).toContain('Les parts portent sur toute la population bretonne')

    const aggregate = buildMobiliteRaccordementSection(withTerritory(facts, 'epci'), page3Metadata)
    if (aggregate.evidence?.kind !== 'mobilite-raccordement') throw new Error('Aggregate curve evidence expected')
    expect(aggregate.evidence.prose.flat().map((segment) => segment.value).join(' '))
      .toContain('les communes du territoire permettent de rejoindre en moyenne 20 % de la population bretonne')

    const absent = buildMobiliteRaccordementSection(factsWith([]), page3Metadata)
    expect(absent.availability).toBe('absent')
    expect(absent.evidence).toBeNull()
  })

  it('keeps a missing source URL as a visible text stamp instead of dropping the source', () => {
    const section = buildMobiliteShareSection(factsWith([
      fact('offre_tc', 0.4, '%', null, 'korrigo'),
    ]), page3Metadata)
    if (section.evidence?.kind !== 'mobilite-share') throw new Error('Share evidence expected')
    section.evidence.sources = section.evidence.sources.map((source) => ({ ...source, url: null }))
    const wrapper = mount(CahierMobiliteSection, {
      props: {
        section,
        unit: { key: 'offre-transports-commun', label: 'L’offre de transports en commun' },
        comparison: { status: 'ready' },
      },
    })
    expect(wrapper.text()).toContain('Bretagne Mobilité')
    expect(wrapper.find('[data-source-url-missing]').exists()).toBe(true)
    expect(wrapper.find('.cahier-evidence-source a').exists()).toBe(false)
    wrapper.unmount()
  })
})

describe('compared protected/shared means — #997', () => {
  const members = ['22001', '22002']
  function meanComparison(value: number, eligibleMembers: readonly string[] = members): FactComparison {
    return {
      direction: 'plus-est-mieux',
      scope,
      rank: { position: 1, size: 2 },
      reference: { kind: 'mean', value, eligibleMembers },
    }
  }
  function meanFact(
    key: string,
    value: number,
    unit: string,
    detail: string,
    eligibleMembers: readonly string[] = members,
    sourceId = 'osm_reseaux',
  ): NumericFact {
    return { ...fact(key, value, unit, detail, sourceId), comparison: meanComparison(value, eligibleMembers),
      comparisonBasis: 'territory-mean' }
  }
  function networkFacts(): NumericFact[] {
    const indicators = sharingFacts().filter((candidate) => ![
      'reseaux_par_habitant', 'reseaux', 'offre_cyclable',
    ].includes(candidate.key))
    return [
      ...indicators,
      meanFact('reseaux_par_habitant', 12, 'km / 1 000 hab.', 't_km_1000'),
      meanFact('reseaux_par_habitant', 8, 'km / 1 000 hab.', 'b_km_1000'),
      meanFact('reseaux_par_habitant', 80, 'km / 1 000 hab.', 'c_km_1000'),
      meanFact('reseaux', 10, 'km', 't_longueur'),
      meanFact('reseaux', 6, 'km', 'b_longueur'),
      meanFact('reseaux', 30, 'km', 'c_longueur'),
      meanFact('offre_cyclable', 5, 'km / 1 000 hab.', 'protege_km_1000', members, 'amenagements_cyclables'),
      meanFact('offre_cyclable', 3, 'km / 1 000 hab.', 'partage_km_1000', members, 'amenagements_cyclables'),
      meanFact('offre_cyclable', 4, 'km', 'protege_longueur', members, 'amenagements_cyclables'),
      meanFact('offre_cyclable', 2, 'km', 'partage_longueur', members, 'amenagements_cyclables'),
    ]
  }
  function bike(indicators: NumericFact[], comparisonStatistic: 'mean' | 'median' = 'mean') {
    const content = resolveMobiliteThemeContent(factsWith(indicators, comparisonStatistic), metadata)
    const section = content.units.find((unit) => unit.key === 'partage-de-lespace-public')!
      .sections.find((candidate) => candidate.key === 'reseaux')!
    if (section.evidence?.kind !== 'mobilite-networks') throw new Error('Réseaux evidence expected')
    return section.evidence.figure.categories.find((category) => category.key === 'bike')!
  }

  it('draws the compared bike stack only when the served means share one population and recompose the total', () => {
    const category = bike(networkFacts())
    expect(category.comparisonSplit).toBe(true)
    expect(category.comparisonSplitNote).toBeUndefined()
    expect(category.value.fact.comparison?.reference).toMatchObject({ kind: 'mean', value: 8,
      eligibleMembers: members })
    expect(category.value.fact.comparison?.scope.label).toBe('communes de EPCI X')
    // Every other network reference is a mean too, while the motorisation
    // profile keeps its own median contract.
    expect(category.rawValue?.fact.comparison?.reference?.kind).toBe('mean')
  })

  it('does not call a legitimate median fixed comparison a missing mean', () => {
    const category = bike(sharingFacts(), 'median')
    expect(category.value.fact.comparison?.reference?.kind).toBe('median')
    expect(category.comparisonSplit).toBeUndefined()
    expect(category.comparisonSplitNote).toBeUndefined()
  })

  it('does not blame the compared means when the focal partition is missing', () => {
    const indicators = networkFacts().map((candidate) =>
      candidate.key === 'reseaux_par_habitant' && candidate.detail === 'b_km_1000'
        ? { ...candidate, value: 39 } : candidate)
    const category = bike(indicators)
    expect(category.segments).toEqual([])
    expect(category.splitNote).toContain('ne recomposent pas le total')
    expect(category.comparisonSplit).toBeUndefined()
    expect(category.comparisonSplitNote).toBeUndefined()
  })

  it('refuses a split when equal eligible counts name different communes', () => {
    const indicators = networkFacts().map((candidate) => candidate.key === 'offre_cyclable' &&
      candidate.detail === 'partage_km_1000'
      ? { ...candidate, comparison: meanComparison(3, ['22001', '22003']) } : candidate)
    const category = bike(indicators)
    expect(category.comparisonSplit).toBeUndefined()
    expect(category.comparisonSplitNote).toContain('ne portent pas les mêmes communes')
  })

  it('refuses a split when the served partition does not recompose the total', () => {
    const indicators = networkFacts().map((candidate) => candidate.key === 'offre_cyclable' &&
      candidate.detail === 'protege_km_1000'
      ? { ...candidate, comparison: meanComparison(4) } : candidate)
    const category = bike(indicators)
    expect(category.comparisonSplit).toBeUndefined()
    expect(category.comparisonSplitNote).toContain('ne recomposent pas la moyenne du total')
  })

  it('refuses a split when a segment mean is missing rather than shrinking the stack', () => {
    const indicators = networkFacts().map((candidate) => candidate.key === 'offre_cyclable' &&
      candidate.detail === 'partage_km_1000'
      ? { ...candidate, comparison: comparison(3) } : candidate)
    const category = bike(indicators)
    expect(category.comparisonSplit).toBeUndefined()
    expect(category.comparisonSplitNote).toContain('une moyenne servie est incomplète')
  })

  it('keeps a real zero as a valid mean partition', () => {
    const indicators = networkFacts().map((candidate) => {
      if (candidate.key === 'reseaux_par_habitant' && candidate.detail === 'b_km_1000') {
        return { ...candidate, comparison: meanComparison(0) }
      }
      if (candidate.key === 'offre_cyclable' && (candidate.detail === 'protege_km_1000' ||
          candidate.detail === 'partage_km_1000')) {
        return { ...candidate, comparison: meanComparison(0) }
      }
      if (candidate.key === 'reseaux' && candidate.detail === 'b_longueur') {
        return { ...candidate, comparison: meanComparison(0) }
      }
      if (candidate.key === 'offre_cyclable' && (candidate.detail === 'protege_longueur' ||
          candidate.detail === 'partage_longueur')) {
        return { ...candidate, comparison: meanComparison(0) }
      }
      return candidate
    })
    const category = bike(indicators)
    expect(category.comparisonSplit).toBe(true)
    expect(category.comparisonSplitNote).toBeUndefined()
    expect(category.value.fact.comparison?.reference?.value).toBe(0)
  })

  it('refuses a raw split that does not recompose the raw total', () => {
    const indicators = networkFacts().map((candidate) => candidate.key === 'offre_cyclable' &&
      candidate.detail === 'partage_longueur'
      ? { ...candidate, comparison: meanComparison(1) } : candidate)
    const category = bike(indicators)
    expect(category.comparisonSplit).toBeUndefined()
    expect(category.comparisonSplitNote).toContain('moyennes brutes servies ne recomposent pas')
  })

  it('refuses a split that mixes units', () => {
    const indicators = networkFacts().map((candidate) => candidate.key === 'offre_cyclable' &&
      candidate.detail === 'protege_km_1000'
      ? { ...candidate, unit: '%', comparison: meanComparison(5) } : candidate)
    const category = bike(indicators)
    expect(category.comparisonSplit).toBeUndefined()
    expect(category.comparisonSplitNote).toContain('ne partagent pas la même unité')
  })
})

describe('chapterForSectionAnchor - #1010 typed section hierarchy', () => {
  it('resolves every rendered section id through its owning unit, including non-AEDAR', () => {
    const content = resolveMobiliteThemeContent(factsWith(sharingFacts()), metadata)
    for (const unit of content.units) {
      for (const section of unit.sections) {
        expect(chapterForSectionAnchor(content, `#section-${section.key}`)).toBe(unit.key)
      }
    }
    expect(chapterForSectionAnchor(content, '#section-does-not-exist')).toBeUndefined()
    expect(chapterForSectionAnchor(content, '#figure-lecture')).toBeUndefined()
    expect(chapterForSectionAnchor(null, '#section-aedar-car-overview')).toBeUndefined()
  })
})
