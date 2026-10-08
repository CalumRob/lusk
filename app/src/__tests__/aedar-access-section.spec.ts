import { describe, expect, it } from 'vitest'

import { aedarAccessSection, AEDAR_PROTOTYPE_HORIZON_MINUTES } from '@/fiche/content/aedarAccessSection'
import type { AedarFetchResult } from '@/fiche/content/aedarApiClient'
import type { TerritoryIdentity } from '@/fiche/content/territoryFacts'

const territory: TerritoryIdentity = {
  code: '22001',
  type: 'commune',
  name: 'Test Commune',
  department: '22',
  epci: null,
}

function aedarReady(): Extract<AedarFetchResult, { status: 'ready' }> {
  const measures = Object.fromEntries(
    [5, 10, 15, 20].flatMap((duration) =>
      ['walk', 'transit', 'transit_gain', 'bike_lts2', 'bike_lts4', 'car'].flatMap((mode) =>
        ['share', 'min', 'max', ...Array.from({ length: 9 }, (_, i) => `decile${i + 1}`), 'mean']
          .map((stat) => [`count_${duration}_${mode}_${stat}`, 0.5]),
      ),
    ),
  )
  return {
    status: 'ready',
    facts: Array.from({ length: 10 }, (_, index) => ({
      territory_id: '22001',
      territory_type: 'commune' as const,
      typequ: `TYPEQU${index}`,
      typequ_label: `Type ${index}`,
      identity: {},
      n_addresses: 100,
      n_observed: 100,
      coverage_status: 'covered',
      measures,
      source_id: 'aedar_bretagne',
      vintage_id: '2026-v1',
      source_url: 'https://example.com',
      licence: 'Licence Ouverte',
      attribution: 'AEDAR',
      reference_date: '2026-01-01',
      publication_date: '2026-09-30',
    })),
    contentVersion: 'test-version',
    provenance: {
      contentVersion: 'test-version',
      sources: [{
        source_id: 'aedar_bretagne',
        vintage_id: '2026-v1',
        source_url: 'https://example.com',
        licence: 'Licence Ouverte',
        attribution: 'AEDAR',
        reference_date: '2026-01-01',
        publication_date: '2026-09-30',
      }],
    },
  }
}

describe('aedarAccessSection', () => {
  it('carries the section label and a lecture so the shared heading primitive applies', () => {
    const section = aedarAccessSection(aedarReady(), territory)
    expect(section.key).toBe('aedar-access')
    expect(section.label).toBe('Accès aux services')
    expect(section.lecture).not.toBeNull()
    expect(section.lecture?.marelle).toBe('Prototype AEDAR : l’accès depuis les adresses résidentielles')
    expect(section.lecture?.prose.length).toBeGreaterThan(0)
  })

  it('owns the map figure title and the honest empty-state lecture', () => {
    const section = aedarAccessSection(aedarReady(), territory)
    expect(section.evidence?.kind).toBe('aedar-access')
    if (section.evidence?.kind !== 'aedar-access') return
    expect(section.evidence.mapFigureTitle).toBe('Cartes d’accès aux services, par mode')
    expect(section.evidence.mapLecture.length).toBeGreaterThan(0)
    expect(section.evidence.mapLecture.map((block) => block.map((segment) => segment.value).join('')).join(' ')).toContain(`${AEDAR_PROTOTYPE_HORIZON_MINUTES} minutes`)
    expect(section.evidence.horizonMinutes).toBe(AEDAR_PROTOTYPE_HORIZON_MINUTES)
  })

  it('derives both ramps with content-owned figure titles and the section availability', () => {
    const section = aedarAccessSection(aedarReady(), territory)
    if (section.evidence?.kind !== 'aedar-access') throw new Error('aedar-access evidence expected')
    expect(section.evidence.ramps.map((ramp) => ramp.rampKey)).toEqual(['diversity', 'count-per-type'])
    expect(section.evidence.ramps.map((ramp) => ramp.figureTitle)).toEqual([
      'Diversité des types d’équipements',
      'Équipements accessibles par type',
    ])
    expect(section.evidence.ramps.every((ramp) => ramp.modeLabel === 'Voiture')).toBe(true)
    expect(section.evidence.availability).toBe('complete')
    expect(section.availability).toBe('complete')
    expect(section.evidence.provenance).toEqual(['aedar_bretagne'])
    expect(section.provenance).toEqual(['aedar_bretagne'])
  })

  it('marks the section incomplete when a ramp cannot cover the whole universe', () => {
    const data = aedarReady()
    data.facts[0]!.measures['count_5_car_share'] = null
    const section = aedarAccessSection(data, territory)
    expect(section.availability).toBe('incomplete')
    if (section.evidence?.kind !== 'aedar-access') throw new Error('aedar-access evidence expected')
    expect(section.evidence.availability).toBe('incomplete')
    expect(section.evidence.ramps[0]?.series.territory[0]).toBeNull()
  })
})
