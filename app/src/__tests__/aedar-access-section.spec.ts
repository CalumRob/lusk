import { describe, expect, it } from 'vitest'

import { aedarAccessSection, aedarPrototypeSections, AEDAR_PROTOTYPE_HORIZON_MINUTES } from '@/fiche/content/aedarAccessSection'
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

describe('aedarAccessSection', () => {
  it('assembles the waffle as a separate section from the access maps and ramps', () => {
    const sections = aedarPrototypeSections(aedarReady('22001'), territory)

    expect(sections.map((section) => section.key)).toEqual(['aedar-access', 'aedar-equipment-profile'])
    expect(sections[0]?.evidence?.kind).toBe('aedar-access')
    expect(sections[1]?.evidence?.kind).toBe('aedar-equipment-profile')
    if (sections[1]?.evidence?.kind !== 'aedar-equipment-profile') return
    expect(sections[1].label).toBe('Types d’équipements par premier mode d’accès')
    expect(sections[1].evidence.facts).toHaveLength(10)
    expect(sections[1].evidence.threshold).toBe(0.25)
    const threshold = sections[1].evidence.prose[0]?.find((segment) => segment.kind === 'emphasis')
    expect(threshold).toMatchObject({ kind: 'emphasis', value: '25%', tone: 'neutral' })
  })

  it('carries the section label without a Lecture block', () => {
    const section = aedarAccessSection(aedarReady('22001'), territory)
    expect(section.key).toBe('aedar-access')
    expect(section.label).toBe('Diversité de l’offre')
    expect(section.lecture).toBeNull()
  })

  it('owns the blank-map title and keeps the provisional horizon', () => {
    const section = aedarAccessSection(aedarReady('22001'), territory)
    expect(section.evidence?.kind).toBe('aedar-access')
    if (section.evidence?.kind !== 'aedar-access') return
    expect(section.evidence.mapFigureTitle.map((segment) => segment.value).join('')).toBe('Quelle diversité de l’offre est accessible en 15 minutes depuis les adresses résidentielles ?')
    expect(section.evidence.mapFigureTitle.find((segment) => segment.kind === 'emphasis')?.value).toBe('15 minutes')
    expect(section.evidence.horizonMinutes).toBe(AEDAR_PROTOTYPE_HORIZON_MINUTES)
  })

  it('derives both ramps for every mode with content-owned figure titles', () => {
    const section = aedarAccessSection(aedarReady('22001'), territory)
    if (section.evidence?.kind !== 'aedar-access') throw new Error('aedar-access evidence expected')
    expect(section.evidence.ramps.map((ramp) => ramp.rampKey)).toEqual(['diversity', 'count-per-type'])
    expect(section.evidence.ramps.map((ramp) => ramp.figureTitle)).toEqual([
      'Diversité de l’offre accessible (moyenne du territoire)',
      'Équipements accessibles par type',
    ])
    expect(section.evidence.ramps[0]?.yAxis).toEqual({ label: 'Diversité de l’offre', unit: '' })
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
    expect(section.evidence.diversityGap).toMatchObject({ value: 0, horizonMinutes: 15, territoryLead: 'à Test Commune' })
    expect(section.evidence.diversityGap.prose?.map((segment) => segment.value).join('')).toContain('à pied qu’en voiture dans la commune de Test Commune en 15 min')
    expect(section.evidence.source).toMatchObject({ label: 'AEDAR', version: '2026-v1', url: 'https://example.com' })
    expect(section.evidence.sectionProse.flat().map((segment) => segment.value).join(' ')).toContain('personnes averses au risque routier')
    expect(section.evidence.sectionProse.flat().map((segment) => segment.value).join(' ')).toContain('personnes tolérantes au risque routier')
    expect(section.evidence.sectionProse.flat().map((segment) => segment.value).join(' ')).toContain('La "diversité" est le nombre de catégories d’équipements accessibles depuis les adresses résidentielles. Cette analyse reprend les catégories de la BPE 2025, qui recense 235 types d\'équipements.')
    expect(section.evidence.sectionProse.flat().map((segment) => segment.value).join(' ')).not.toContain('transit_gain')
    expect(section.evidence.sectionProse.flat().filter((segment) => segment.kind === 'emphasis').map((segment) => segment.tone)).toEqual(['foot', 'foot', 'bike', 'bike', 'bike'])
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
  })

  it('marks the section incomplete when a ramp cannot cover the whole universe', () => {
    const data = aedarReady('22001')
    data.facts[0]!.measures['count_5_car_share'] = null
    const section = aedarAccessSection(data, territory)
    expect(section.availability).toBe('incomplete')
    if (section.evidence?.kind !== 'aedar-access') throw new Error('aedar-access evidence expected')
    expect(section.evidence.availability).toBe('incomplete')
    expect(section.evidence.ramps[0]?.territory.car[0]).toBeNull()
    expect(section.evidence.diversityGap.value).toBe(0)
  })

  it('derives the 15-minute car-minus-walk diversity gap from the territory values', () => {
    const data = aedarReady('22001')
    for (const fact of data.facts) {
      fact.measures['count_15_car_share'] = 0.6
      fact.measures['count_15_walk_share'] = 0.2
    }
    const section = aedarAccessSection(data, territory)
    if (section.evidence?.kind !== 'aedar-access') throw new Error('aedar-access evidence expected')
    expect(section.evidence.diversityGap.value).toBeCloseTo(4)
    expect(section.evidence.diversityGap.horizonMinutes).toBe(15)
  })

  it('keeps the derived diversity gap unavailable if either 15-minute mode value is null', () => {
    const data = aedarReady('22001')
    data.facts[0]!.measures['count_15_walk_share'] = null
    const section = aedarAccessSection(data, territory)
    if (section.evidence?.kind !== 'aedar-access') throw new Error('aedar-access evidence expected')
    expect(section.evidence.diversityGap.value).toBeNull()
  })

  it('uses a generic source link label when attribution metadata is empty, never the internal key', () => {
    const data = aedarReady('22001')
    data.provenance.sources[0]!.attribution = ''
    const section = aedarAccessSection(data, territory)
    if (section.evidence?.kind !== 'aedar-access') throw new Error('aedar-access evidence expected')
    expect(section.evidence.source?.label).toBe('Source')
    expect(section.evidence.source?.label).not.toBe('aedar_bretagne')
    expect(section.evidence.source?.credit).toBeNull()
  })

  it('keeps source attribution compact and metadata-derived', () => {
    const data = aedarReady('22001')
    data.provenance.sources[0]!.attribution = '© OpenStreetMap contributors; données AEDAR — licence ODbL'
    const section = aedarAccessSection(data, territory)
    if (section.evidence?.kind !== 'aedar-access') throw new Error('aedar-access evidence expected')
    expect(section.evidence.source).toMatchObject({ label: 'AEDAR', version: '2026-v1', credit: '© OpenStreetMap contributors' })
  })
})
