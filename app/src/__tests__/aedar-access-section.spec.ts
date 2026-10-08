import { describe, expect, it } from 'vitest'

import { aedarAccessSection, AEDAR_PROTOTYPE_HORIZON_MINUTES } from '@/fiche/content/aedarAccessSection'
import { AEDAR_RAMP_MODES } from '@/fiche/content/aedarTimeRampFacts'
import type { AedarFetchResult } from '@/fiche/content/aedarApiClient'
import type { TerritoryIdentity } from '@/fiche/content/territoryFacts'

const territory: TerritoryIdentity = {
  code: '22001',
  type: 'commune',
  name: 'Test Commune',
  department: '22',
  epci: null,
}

const referenceTerritory = { type: 'epci', id: '200000001' }

function aedarReady(territoryId: string, territoryType: 'commune' | 'epci' = 'commune', share = 0.5): Extract<AedarFetchResult, { status: 'ready' }> {
  const measures = Object.fromEntries(
    [5, 10, 15, 20].flatMap((duration) =>
      ['walk', 'transit', 'transit_gain', 'bike_lts2', 'bike_lts4', 'car'].flatMap((mode) =>
        ['share', 'min', 'max', ...Array.from({ length: 9 }, (_, i) => `decile${i + 1}`), 'mean']
          .map((stat) => [`count_${duration}_${mode}_${stat}`, share]),
      ),
    ),
  )
  return {
    status: 'ready',
    facts: Array.from({ length: 10 }, (_, index) => ({
      territory_id: territoryId,
      territory_type: territoryType,
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

function blocksText(blocks: readonly (readonly { value: string }[])[]): string {
  return blocks.map((block) => block.map((segment) => segment.value).join('')).join(' ')
}

describe('aedarAccessSection', () => {
  it('carries the section label and a lecture so the shared heading primitive applies', () => {
    const section = aedarAccessSection(aedarReady('22001'), territory)
    expect(section.key).toBe('aedar-access')
    expect(section.label).toBe('Accès aux services')
    expect(section.lecture).not.toBeNull()
    expect(section.lecture?.marelle).toBe('Prototype AEDAR : l’accès depuis les adresses résidentielles')
    expect(section.lecture?.prose.length).toBeGreaterThan(0)
  })

  it('owns the map figure title and the honest empty-state lecture', () => {
    const section = aedarAccessSection(aedarReady('22001'), territory)
    expect(section.evidence?.kind).toBe('aedar-access')
    if (section.evidence?.kind !== 'aedar-access') return
    expect(section.evidence.mapFigureTitle).toBe('Cartes d’accès aux services, par mode')
    expect(section.evidence.mapLecture.length).toBeGreaterThan(0)
    expect(blocksText(section.evidence.mapLecture)).toContain(`${AEDAR_PROTOTYPE_HORIZON_MINUTES} minutes`)
    expect(section.evidence.horizonMinutes).toBe(AEDAR_PROTOTYPE_HORIZON_MINUTES)
  })

  it('derives both ramps for every mode with content-owned figure titles', () => {
    const section = aedarAccessSection(aedarReady('22001'), territory)
    if (section.evidence?.kind !== 'aedar-access') throw new Error('aedar-access evidence expected')
    expect(section.evidence.ramps.map((ramp) => ramp.rampKey)).toEqual(['diversity', 'count-per-type'])
    expect(section.evidence.ramps.map((ramp) => ramp.figureTitle)).toEqual([
      'Diversité des types d’équipements',
      'Équipements accessibles par type',
    ])
    for (const ramp of section.evidence.ramps) {
      expect(Object.keys(ramp.territory).sort()).toEqual([...AEDAR_RAMP_MODES].sort())
      expect(ramp.reference).toBeNull()
      expect(ramp.referenceLabel).toBeNull()
    }
    // 10 types at 0.5 share: diversity sums to 5, count-per-type averages to 0.5.
    expect(section.evidence.ramps[0]?.territory.car).toEqual([5, 5, 5, 5])
    expect(section.evidence.ramps[1]?.territory.car).toEqual([0.5, 0.5, 0.5, 0.5])
    expect(section.evidence.availability).toBe('complete')
    expect(section.availability).toBe('complete')
    expect(section.evidence.provenance).toEqual(['aedar_bretagne'])
    expect(section.provenance).toEqual(['aedar_bretagne'])
  })

  it('merges per-mode reference-territory values and labels them explicitly', () => {
    const section = aedarAccessSection(aedarReady('22001'), territory, {
      reference: { data: aedarReady('200000001', 'epci', 0.25), territory: referenceTerritory, label: 'EPCI X' },
    })
    if (section.evidence?.kind !== 'aedar-access') throw new Error('aedar-access evidence expected')
    for (const ramp of section.evidence.ramps) {
      expect(ramp.referenceLabel).toBe('EPCI X')
      expect(Object.keys(ramp.reference ?? {}).sort()).toEqual([...AEDAR_RAMP_MODES].sort())
    }
    // 10 reference types at 0.25 share: diversity sums to 2.5, count-per-type averages to 0.25.
    expect(section.evidence.ramps[0]?.reference?.car).toEqual([2.5, 2.5, 2.5, 2.5])
    expect(section.evidence.ramps[1]?.reference?.walk).toEqual([0.25, 0.25, 0.25, 0.25])
    expect(section.evidence.availability).toBe('complete')
    const lecture = blocksText(section.evidence.figureLecture)
    expect(lecture).toContain('EPCI X')
    expect(lecture).toContain('territoire de référence')
    expect(lecture).not.toContain('cohorte de communes :')
  })

  it('marks the section incomplete when a ramp cannot cover the whole universe', () => {
    const data = aedarReady('22001')
    data.facts[0]!.measures['count_5_car_share'] = null
    const section = aedarAccessSection(data, territory)
    expect(section.availability).toBe('incomplete')
    if (section.evidence?.kind !== 'aedar-access') throw new Error('aedar-access evidence expected')
    expect(section.evidence.availability).toBe('incomplete')
    expect(section.evidence.ramps[0]?.territory.car[0]).toBeNull()
  })

  it('states honestly when the comparison is a cohort or the reference is unusable', () => {
    const cohort = aedarAccessSection(aedarReady('22001'), territory, { comparisonUnavailable: 'cohort' })
    if (cohort.evidence?.kind !== 'aedar-access') throw new Error('aedar-access evidence expected')
    expect(blocksText(cohort.evidence.figureLecture)).toContain('cohorte de communes')

    const error = aedarAccessSection(aedarReady('22001'), territory, { comparisonUnavailable: 'error' })
    if (error.evidence?.kind !== 'aedar-access') throw new Error('aedar-access evidence expected')
    expect(blocksText(error.evidence.figureLecture)).toContain('territoire de référence')
    expect(blocksText(error.evidence.figureLecture)).not.toContain('cohorte de communes')

    const loading = aedarAccessSection(aedarReady('22001'), territory)
    if (loading.evidence?.kind !== 'aedar-access') throw new Error('aedar-access evidence expected')
    expect(loading.evidence.ramps.every((ramp) => ramp.reference === null)).toBe(true)
    expect(blocksText(loading.evidence.figureLecture)).not.toContain('cohorte')
  })
})
