import { describe, expect, it } from 'vitest'

import type {
  ComparisonScope,
  FactComparison,
  FactProvenance,
  NumericFact,
  TerritoryFacts,
} from '@/fiche/content/territoryFacts'
import { resolveMobiliteThemeContent } from '@/fiche/content/themeContent'

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
    comparisonBasis: factComparison?.reference?.kind === 'mean'
      ? 'building-weighted-mean' : 'territory-median',
    reason: null,
  }
}
// #627 - the « Mobilité page rundown » describe retired with the legacy
// snapshot surface: the acces-aux-services unit keeps only its structural
// identity (see the #627 regression below) and the production AEDAR
// evidence owns the accessibility copy (production-mobilite-aedar.spec.ts).

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
    namedTrajectoryReferences: [],
    indicators: [],
  },
}

function sharingIndicator(
  key: string,
  detail: string | null,
  value: number | null,
  unit: string,
): NumericFact {
  return { ...fact(key, value, unit, comparison(0.5, 'plus-est-mieux')), detail }
}

describe('resolveMobiliteThemeContent', () => {
  it('#627 retirement: renders the acces-aux-services unit without the legacy placeholder body', () => {
    // The production AEDAR evidence owns the accessibility surface; while it
    // loads (or fails) the unit keeps only its structural identity — the four
    // legacy snapshot sections, their introduction and their rundown no
    // longer render as « Contenu indisponible » placeholders.
    const content = resolveMobiliteThemeContent(completeFacts)
    const unit = content.units[0]
    expect(unit.key).toBe('acces-aux-services')
    expect(unit.label).toBe('L’accès aux services')
    expect(unit.sections).toEqual([])
    expect(unit.introduction).toEqual([])
    expect(unit.rundown).toEqual([])
  })
  it('orders all four published Mobilité subgroup units and carries their published facts', () => {
    const facts = structuredClone(completeFacts)
    facts.mobility.indicators = [
      ...facts.mobility.indicators,
      sharingIndicator('reseaux', 't_longueur', 10, 'km'),
      sharingIndicator('reseaux', 'b_longueur', 20, 'km'),
      sharingIndicator('reseaux', 'c_longueur', 30, 'km'),
      sharingIndicator('bornes_recharge', null, 7, 'bornes'),
    ]
    const content = resolveMobiliteThemeContent(facts)
    expect(content.units.map((unit) => unit.key)).toEqual([
      'acces-aux-services', 'partage-de-lespace-public', 'motorisation', 'offre-transports-commun',
    ])
    const networks = content.units[1].sections[0].evidence
    expect(networks?.kind).toBe('sharing-networks')
    if (networks?.kind === 'sharing-networks') {
      expect(networks.absoluteNetworks.map((fact) => fact.fact.value)).toEqual([10, 20, 30])
    }
    expect(content.units[2].sections[0].availability).toBe('complete')
    expect(content.units[2].sections[0].evidence?.kind).toBe('motorisation')
    if (content.units[2].sections[0].evidence?.kind === 'motorisation') {
      expect(content.units[2].sections[0].evidence.charging).toHaveLength(1)
    }
    expect(content.units[3].sections[0].availability).toBe('absent')
  })

  it('resolves the public-space sharing unit into ordered network, cycling-offer, and parking sections', () => {
    const facts = structuredClone(completeFacts)
    facts.mobility.indicators = [
      ...facts.mobility.indicators,
      sharingIndicator('reseaux_par_habitant', 't_km_1000', 12, 'km / 1 000 hab.'),
      sharingIndicator('reseaux_par_habitant', 'b_km_1000', 8, 'km / 1 000 hab.'),
      sharingIndicator('reseaux_par_habitant', 'c_km_1000', 80, 'km / 1 000 hab.'),
      sharingIndicator('surface_reseaux_routiers', null, 0.12, '%'),
      sharingIndicator('offre_cyclable', 'protege_longueur', 5, 'km'),
      sharingIndicator('offre_cyclable', 'protege_km_1000', 0.4, 'km / 1 000 hab'),
      sharingIndicator('offre_cyclable', 'partage_longueur', 7, 'km'),
      sharingIndicator('offre_cyclable', 'partage_km_1000', 0.6, 'km / 1 000 hab'),
      sharingIndicator('offre_cyclable', 'total_longueur', 12, 'km'),
      sharingIndicator('places_stationnement_velo_1000', null, 5, 'places / 1 000 hab'),
      sharingIndicator('places_stationnement_voiture_1000', null, 25, 'places / 1 000 hab'),
      sharingIndicator('stationnement_velo_par_voiture', null, 0.2, 'places vélo / place voiture'),
    ]

    const content = resolveMobiliteThemeContent(facts)
    const sharing = content.units.find((unit) => unit.key === 'partage-de-lespace-public')

    expect(content.units.map((unit) => unit.key)).toEqual([
      'acces-aux-services',
      'partage-de-lespace-public',
      'motorisation',
      'offre-transports-commun',
    ])
    expect(sharing).toBeDefined()
    expect(sharing?.label).toBe('Le partage de l’espace public')
    expect(sharing?.sections.map((section) => [section.key, section.label])).toEqual([
      ['reseaux', 'Réseaux'],
      ['offre-cyclable', 'Offre cyclable'],
      ['stationnement', 'Stationnement'],
    ])
    expect(sharing?.sections[0]?.indicators.map((indicator) => indicator.fact.key)).toEqual([
      'reseaux_par_habitant',
      'surface_reseaux_routiers',
    ])
    expect(sharing?.sections[0]?.evidence).toMatchObject({
      territoryName: 'Commune A',
      roadSurface: { label: 'Emprise routière' },
      roadSurfaceLecture: [[
        { kind: 'text', value: "L'emprise routière décrit la part de la surface totale du territoire qui est dédiée aux Réseaux routiers (code d'usage 4.1.1)." },
      ]],
      networks: [
        { label: 'Réseau piéton' },
        { label: 'Réseau cyclable' },
        { label: 'Réseau automobile' },
      ],
    })
    expect(sharing?.sections[1]?.indicators.map((indicator) => indicator.fact.key)).toEqual([
      'offre_cyclable',
    ])
    expect(sharing?.sections[2]?.indicators.map((indicator) => indicator.fact.key)).toEqual([
      'places_stationnement_velo_1000',
      'places_stationnement_voiture_1000',
      'stationnement_velo_par_voiture',
    ])
    expect(JSON.stringify(sharing)).not.toContain('TC')
  })

  it('keeps the parking section incomplete when only the published bike parking fact exists', () => {
    const facts = structuredClone(completeFacts)
    facts.mobility.indicators = [
      ...facts.mobility.indicators,
      sharingIndicator('places_stationnement_velo_1000', null, 0, 'places / 1 000 hab'),
    ]
    const content = resolveMobiliteThemeContent(facts)
    const parking = content.units[1]!.sections[2]!

    expect(parking.availability).toBe('incomplete')
    expect(parking.evidence).toMatchObject({
      kind: 'sharing-parking',
      bikeSpaces: { fact: { key: 'places_stationnement_velo_1000', value: 0 } },
      carSpaces: { fact: { key: 'places_stationnement_voiture_1000', availability: 'absent' } },
      bikePerCar: { fact: { key: 'stationnement_velo_par_voiture', availability: 'absent' } },
    })
    expect(parking.lecture).toBeNull()
  })

  it('explains an unavailable parking ratio when the car denominator is zero', () => {
    const facts = structuredClone(completeFacts)
    facts.mobility.indicators = [
      ...facts.mobility.indicators,
      sharingIndicator('places_stationnement_velo_1000', null, 5, 'places / 1 000 hab'),
      sharingIndicator('places_stationnement_voiture_1000', null, 0, 'places / 1 000 hab'),
      sharingIndicator('stationnement_velo_par_voiture', null, null, 'places vélo / place voiture'),
    ]

    const parking = resolveMobiliteThemeContent(facts).units[1]!.sections[2]!

    expect(parking.evidence?.figureLecture.flat().flat()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'text',
          value: expect.stringContaining('aucune place de stationnement voiture'),
        }),
      ]),
    )
  })

})
