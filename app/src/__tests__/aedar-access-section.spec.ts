import { describe, expect, it } from 'vitest'

import { aedarAccessSection, aedarPrototypeSections, AEDAR_PROTOTYPE_HORIZON_MINUTES } from '@/fiche/content/aedarAccessSection'
import { aedarDiversityLossSection } from '@/fiche/content/aedarDiversityLossMaps'
import { AEDAR_RAMP_MODES } from '@/fiche/content/aedarTimeRampFacts'
import { AEDAR_TYPEQU_REGISTRY } from '@/fiche/content/aedarTypequRegistry'
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
    facts: AEDAR_TYPEQU_REGISTRY.map(({ code, label }, index) => ({
      territory_id: territoryId,
      territory_type: territoryType,
      typequ: code,
      typequ_label: label,
      identity: {},
      n_addresses: 100,
      n_observed: 100,
      coverage_status: 'covered',
      measures: Object.fromEntries(Object.entries(measures).map(([key, value]) => [key, index < 10 ? value : 0])),
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
  it('builds the five-section prose from semantic evidence and the live TYPEQU registry', () => {
    const data = aedarReady('22001')
    const sections = aedarPrototypeSections(data, territory)
    const overview = sections[0]!.evidence!
    const profile = sections[2]!
    const explorer = sections[3]!.evidence!
    const overviewText = overview.kind === 'aedar-car-overview'
      ? [...overview.unitIntroduction, ...overview.prose].flat().map((part) => part.value).join(' ')
      : ''
    expect(overviewText).toContain('Base permanente des équipements')
    expect(overviewText).toContain('Base de données nationale des bâtiments')
    expect(overviewText).toContain(`${AEDAR_TYPEQU_REGISTRY.length} catégories recensées`)
    expect(overviewText).toContain('100 adresses résidentielles')
    expect(overviewText).toContain('médiane')
    expect(overviewText).not.toContain('218')
    if (overview.kind === 'aedar-car-overview') {
      expect(overview.unitIntroduction.flat().some((part) => part.kind === 'link' && part.value === 'AEDAR')).toBe(true)
      expect(overview.unitIntroduction.flat().some((part) => part.kind === 'link' && part.value === 'à ce lien')).toBe(true)
      expect(overview.unitIntroduction.flat().map((part) => part.value).join('')).not.toContain('(à ce lien)')
    }
    expect(profile.label).toBe('Au moins un quart des adresses')
    expect(profile.evidence?.kind === 'aedar-equipment-profile' && profile.evidence.figureTitle)
      .toContain('25% des adresses')
    expect(explorer.kind === 'aedar-equipment-explorer' && explorer.introduction.flat().map((part) => part.value).join(' '))
      .toContain('chaque mode de transport (sélectionnable), la distribution temporelle')
  })

  it('owns the loss-map explanation and comparison prompts in semantic evidence', () => {
    const section = aedarDiversityLossSection({ status: 'unavailable', legend: null }, territory)
    expect(section.label).toBe('Et sans voiture alors ?')
    expect(section.evidence?.kind).toBe('aedar-diversity-loss')
    if (section.evidence?.kind !== 'aedar-diversity-loss') return
    expect(section.evidence.introduction.flat().map((part) => part.value).join(' ')).toContain('Quelles mobilités douces remédient à cette perte ?')
    expect(section.evidence.source).toBeNull()
    expect(section.evidence.comparisonGroups[0]?.prompt.flat().map((part) => part.value).join(' ')).toContain('transport à la demande')
    expect(section.evidence.comparisonGroups[1]?.prompt.flat().map((part) => part.value).join(' ')).toContain('50 km/h')
    expect(section.evidence.comparisonGroups[1]?.prompt.flat().filter((part) => part.kind === 'mode-emphasis').map((part) => part.mode)).toEqual(['bike_lts2', 'bike_lts4'])
  })

  it('appends the per-type explorer after the unchanged waffle with B207 as its initial type', () => {
    const sections = aedarPrototypeSections(aedarReady('22001'), territory)

    expect(sections.map((section) => section.key)).toEqual([
      'aedar-car-overview',
      'aedar-access',
      'aedar-equipment-profile',
      'aedar-equipment-explorer',
    ])
    expect(sections[0]?.evidence?.kind).toBe('aedar-car-overview')
    expect(sections[1]?.evidence?.kind).toBe('aedar-access')
    const profile = sections[2]
    expect(profile.evidence?.kind).toBe('aedar-equipment-profile')
    expect(profile.label).toBe('Au moins un quart des adresses')
    expect(profile.evidence?.facts).toHaveLength(235)
    expect(profile.evidence?.threshold).toBe(0.25)
    const threshold = profile.evidence?.prose[0]?.find((segment) => segment.kind === 'emphasis')
    expect(threshold).toMatchObject({ kind: 'emphasis', value: '25%', tone: 'neutral' })
    expect(sections[3]?.evidence).toMatchObject({
      kind: 'aedar-equipment-explorer',
      initialTypequ: 'B207',
      volumeYAxisTitle: 'Volume de l’offre',
      distributionYAxisTitle: 'Nombre d’établissements',
    })
  })

  it('carries the section label without a Lecture block', () => {
    const section = aedarAccessSection(aedarReady('22001'), territory)
    expect(section.key).toBe('aedar-access')
    expect(section.label).toBe('La ville du 1/12, du 1/6, du 1/4 et du 1/3 d’heure')
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
    expect(section.evidence.ramps.map((ramp) => ramp.rampKey)).toEqual(['diversity', 'volume'])
    expect(section.evidence.ramps.map((ramp) => ramp.figureTitle)).toEqual([
      'Diversité de l’offre accessible (moyenne par adresse)',
      'Établissements accessibles (moyenne par adresse)',
    ])
    expect(section.evidence.ramps[0]?.yAxis).toEqual({ label: 'Diversité de l’offre', unit: '' })
    for (const ramp of section.evidence.ramps) {
      expect(Object.keys(ramp.territory).sort()).toEqual([...AEDAR_RAMP_MODES].sort())
      expect(ramp.reference).toBeNull()
      expect(ramp.referenceLabel).toBeNull()
    }
    // Ten types contribute 0.5 each, all remaining types have zero access.
    expect(section.evidence.ramps[0]?.territory.car).toEqual([5, 5, 5, 5])
    expect(section.evidence.ramps[1]?.territory.car).toEqual([5, 5, 5, 5])
    expect(section.evidence.availability).toBe('complete')
    expect(section.availability).toBe('complete')
    expect(section.evidence.provenance).toEqual(['aedar_bretagne'])
    expect(section.provenance).toEqual(['aedar_bretagne'])
    expect(section.evidence.diversityGap).toMatchObject({ value: 0, horizonMinutes: 15, territoryLead: 'à Test Commune' })
    expect(section.evidence.diversityGap.prose?.map((segment) => segment.value).join('')).toContain('à pied qu’en voiture dans la commune de Test Commune en 15 min')
    expect(section.evidence.source).toMatchObject({ label: 'AEDAR', version: '2026-v1', url: 'https://example.com' })
    expect(section.evidence.sectionProse.flat().map((segment) => segment.value).join(' ')).toContain('pour élucider l')
    expect(section.evidence.sectionProse.flat().map((segment) => segment.value).join(' ')).toContain('sélectionnable via la légende')
    expect(section.evidence.sectionProse.flat().map((segment) => segment.value).join(' ')).not.toContain('transit_gain')
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
    // Ten reference types contribute 0.25 each, all remaining types have zero access.
    expect(section.evidence.ramps[0]?.reference?.car).toEqual([2.5, 2.5, 2.5, 2.5])
    expect(section.evidence.ramps[1]?.reference?.walk).toEqual([2.5, 2.5, 2.5, 2.5])
    expect(section.evidence.comparisonLabel).toBe('moyennes des adresses résidentielles de EPCI X')
    expect(section.evidence.availability).toBe('complete')
  })

  it.each(['publication', 'source vintage', 'reference date', 'publication date'])('keeps the focal ramps without an incompatible reference: %s', (kind) => {
    const reference = aedarReady('200000001', 'epci', 0.25)
    if (kind === 'publication') reference.contentVersion = 'other-version'
    for (const fact of reference.facts) {
      if (kind === 'source vintage') fact.vintage_id = 'other-vintage'
      if (kind === 'reference date') fact.reference_date = '2025-01-01'
      if (kind === 'publication date') fact.publication_date = '2025-09-30'
    }
    const section = aedarAccessSection(aedarReady('22001'), territory, {
      reference: { data: reference, territory: referenceTerritory, label: 'EPCI X' },
    })
    const evidence = section.evidence!
    expect(evidence.ramps[1]?.territory.car[2]).toBe(5)
    expect(evidence.ramps.every((ramp) => ramp.reference === null && ramp.referenceLabel === null)).toBe(true)
    expect(evidence.comparisonLabel).toBeNull()
  })

  it('keeps local ramps without calling a partial reference universe a territory mean', () => {
    const reference = aedarReady('200000001', 'epci', 0.25)
    reference.facts.pop()
    const evidence = aedarAccessSection(aedarReady('22001'), territory, {
      reference: { data: reference, territory: referenceTerritory, label: 'EPCI X' },
    }).evidence!
    expect(evidence.ramps[1]?.territory.car[2]).toBe(5)
    expect(evidence.ramps.every((ramp) => ramp.reference === null && ramp.referenceLabel === null)).toBe(true)
    expect(evidence.comparisonLabel).toBeNull()
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
    for (const fact of data.facts.slice(0, 10)) {
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
