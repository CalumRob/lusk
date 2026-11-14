import { describe, expect, it } from 'vitest'

import type {
  FactProvenance,
  NumericFact,
  TerritoryFacts,
} from '@/fiche/content/territoryFacts'
import {
  buildMobiliteNetworksSection,
  buildMobiliteRaccordementSection,
  buildMobiliteShareSection,
} from '@/fiche/content/mobiliteSections'
import type { ThemeMetadata } from '@/payload/types'

/**
 * #1006 — la page 3 approuvée : les faits restent ceux du producteur, la
 * présentation (titre de figure, libellé d'axe, précision du crédit compact)
 * appartient à la couche de contenu app, et l'identité du territoire vient de
 * l'identité validée, jamais d'un libellé générique.
 */

function provenance(sourceId: string, overrides: Partial<FactProvenance> = {}): FactProvenance {
  return {
    sourceId,
    source: 'Lusk',
    version: 'national-gtfs-outbound-v1',
    referenceDate: '2026-10-10',
    publicationDate: '2026-10-10',
    ...overrides,
  }
}

function fact(
  key: string,
  value: number | null,
  detail: string | null,
  provenanceOverride?: FactProvenance,
): NumericFact {
  return {
    key,
    detail,
    axisValue: detail === null ? undefined : Number(detail.slice(1)),
    value,
    unit: '%',
    availability: value === null ? 'incomplete' : 'complete',
    provenance: provenanceOverride ?? provenance('raccordement_gtfs_national'),
    comparison: null,
    comparisonBasis: 'territory-median',
    reason: null,
  }
}

const territory = {
  code: '35238',
  type: 'commune' as const,
  name: 'Rennes',
  department: '35',
  epci: '243500139',
  epciName: 'Rennes Métropole',
}

function factsWith(indicators: NumericFact[]): TerritoryFacts {
  return { territory, theme: 'mobilite', mobility: { namedTrajectoryReferences: [], indicators } }
}

const metadata = {
  theme: 'mobilite',
  label: 'Mobilité',
  subgroups: [],
  indicator_keys: [],
  sources: {},
  indicator_labels: {
    offre_tc: 'Part des bâtiments près d’un arrêt (à 500 m)',
    raccordement_courbe: 'Courbe de population bretonne jointe selon le temps de trajet',
  },
  detail_labels: {},
  indicator_pages: {
    raccordement_courbe: {
      family: 'trajectory',
      trajectory: {
        endpoints: ['t0000', 't0360'],
        axis: 'numeric',
        axisLabels: { x: 'Temps de trajet (minutes)', y: 'Population joignable (%)' },
        ticks: [{ detail: 't0000', label: '0' }, { detail: 't0090', label: '1 h 30' }],
        marker: { detail: 't0090', label: '1 h 30 (90 min)' },
      },
    },
  },
  source_records: {
    raccordement_gtfs_national: {
      dataset: 'Matrice nationale GTFS',
      publisher: 'Lusk',
      url: 'https://github.com/CalumRob/lusk',
      licence: 'ODbL – © OpenStreetMap contributors (GTFS SNCF/Korrigo)',
      vintage: 'Mesure du 2026-10-21 ; flux acquis le 2026-10-10',
      freshness: '10 octobre 2026',
    },
  },
} as unknown as ThemeMetadata

describe('page 3 approuvée — présentation app-owned, faits producteur (#1006)', () => {
  it('names the focal row with the validated territory identity, never a generic label', () => {
    const section = buildMobiliteShareSection(factsWith([fact('offre_tc', 0.9957355031616097, null)]), metadata)
    if (section.evidence?.kind !== 'mobilite-share') throw new Error('Share evidence expected')
    expect(section.evidence.territoryName).toBe(territory.name)
    // The published label (with its proximity threshold) stays the figure title.
    expect(section.evidence.figureTitle).toBe(metadata.indicator_labels!.offre_tc)
  })

  it('owns the curve title and x-axis label without rewriting a producer descriptor', () => {
    const section = buildMobiliteRaccordementSection(factsWith([
      fact('raccordement_courbe', 0.42, 't0000'),
      fact('raccordement_courbe', 0.61, 't0090'),
      fact('raccordement_courbe', 0.88, 't0360'),
    ]), metadata)
    if (section.evidence?.kind !== 'mobilite-raccordement') throw new Error('Curve evidence expected')
    expect(section.evidence.figureTitle).toBe('Population bretonne joignable selon le temps de trajet')
    expect(section.evidence.xAxisTitle).toBe('Temps de trajet')
    // The factual y axis label still comes from the producer descriptor.
    expect(section.evidence.trajectory?.axisLabels?.y).toBe('Population joignable (%)')
    // The published grid and its numeric axis are untouched by presentation.
    expect(section.evidence.axis?.maximum).toBe(360)
  })

  it('states the compact stamp month from the actual source clock, not a literal', () => {
    const october = buildMobiliteShareSection(factsWith([fact('offre_tc', 0.5, null)]), metadata)
    if (october.evidence?.kind !== 'mobilite-share') throw new Error('Share evidence expected')
    expect(october.evidence.sources[0]).toMatchObject({
      id: 'raccordement_gtfs_national',
      source: 'Lusk',
      version: 'national-gtfs-outbound-v1',
      displayVersion: '2026-10',
      referenceDate: '2026-10-10',
      publicationDate: '2026-10-10',
      licence: 'ODbL – © OpenStreetMap contributors (GTFS SNCF/Korrigo)',
    })

    // Moving the served reference clock moves the compact month: no literal.
    const november = buildMobiliteShareSection(factsWith([
      fact('offre_tc', 0.5, null, provenance('raccordement_gtfs_national', {
        referenceDate: '2026-11-30', publicationDate: '2026-12-02',
      })),
    ]), metadata)
    if (november.evidence?.kind !== 'mobilite-share') throw new Error('Share evidence expected')
    expect(november.evidence.sources[0]!.displayVersion).toBe('2026-11')
    // The factual clocks stay whole: only the display precision is compact.
    expect(november.evidence.sources[0]!.referenceDate).toBe('2026-11-30')
    expect(november.evidence.sources[0]!.publicationDate).toBe('2026-12-02')
  })

  it('keeps a period-shaped served millésime verbatim in the compact stamp', () => {
    const section = buildMobiliteShareSection(factsWith([
      fact('offre_tc', 0.5, null, provenance('korrigo', {
        source: 'Bretagne Mobilité', version: '2026-02', referenceDate: '2026-02-28',
      })),
    ]), metadata)
    if (section.evidence?.kind !== 'mobilite-share') throw new Error('Share evidence expected')
    expect(section.evidence.sources[0]).toMatchObject({ version: '2026-02' })
    expect(section.evidence.sources[0]!.displayVersion).toBeUndefined()
  })

  it('never blanket-formats the other Mobilité sources', () => {
    const networks = buildMobiliteNetworksSection(factsWith([
      fact('reseaux_par_habitant', 12, 't_km_1000', provenance('osm_reseaux', {
        source: 'OpenStreetMap', version: '2026-08', referenceDate: '2026-08-05',
      })),
    ]), metadata)
    if (networks.evidence?.kind !== 'mobilite-networks') throw new Error('Networks evidence expected')
    expect(networks.evidence.sources.length).toBeGreaterThan(0)
    expect(networks.evidence.sources.every((source) => source.displayVersion === undefined)).toBe(true)
  })
})
