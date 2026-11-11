import { describe, expect, it } from 'vitest'

import { aedarAccessSection, aedarPendingPrototypeSections, aedarPrototypeSections, AEDAR_CAR_OVERVIEW_SCALAR_READINGS, AEDAR_PROTOTYPE_HORIZON_MINUTES } from '@/fiche/content/aedarAccessSection'
import { aedarDiversityLossSection } from '@/fiche/content/aedarDiversityLossMaps'
import { AEDAR_AGGREGATE_READING_MEASURES, AEDAR_RAMP_MODES } from '@/fiche/content/aedarTimeRampFacts'
import { AEDAR_TYPEQU_REGISTRY } from '@/fiche/content/aedarTypequRegistry'
import type { AedarFetchResult, AedarTerritorySummary } from '@/fiche/content/aedarApiClient'
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
    referenceContentVersion: 'test-reference-version',
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

/** Independent summary fixture: expected values are published readings, never TYPEQU-derived in the test. */
function aedarSummary(territoryId: string, territoryType: 'commune' | 'epci' = 'commune', value = 5): AedarTerritorySummary {
  const source = { source_id: 'aedar_bretagne', vintage_id: '2026-v1', source_url: 'https://example.com',
    licence: 'Licence Ouverte', attribution: 'AEDAR', reference_date: '2026-01-01', publication_date: '2026-09-30' }
  return {
    territory: { territory_type: territoryType, territory_id: territoryId },
    summaryContentVersion: 'summary-v1', aedarContentVersion: 'test-version', referenceContentVersion: 'test-reference-version',
    readings: Object.entries(AEDAR_AGGREGATE_READING_MEASURES).map(([measure, sourceMeasure]) => ({
      measure, value: sourceMeasure.endsWith('_share') ? value : value,
      status: 'available' as const, n_typequ: AEDAR_TYPEQU_REGISTRY.length, n_addresses: 100, n_observed: 100,
      coverage_status: 'covered', statistic: 'direct' as const, ...source,
    })),
    provenance: { contentVersion: 'test-version', sources: [source] },
  }
}

describe('aedarAccessSection', () => {
  it('builds the five-section prose from semantic evidence and the live TYPEQU registry', () => {
    const data = aedarReady('22001')
    const sections = aedarPrototypeSections(aedarSummary('22001'), data, territory)
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
    const sections = aedarPrototypeSections(aedarSummary('22001'), aedarReady('22001'), territory)

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
      distributionValueUnit: 'établissement',
    })
  })

  it('carries the section label without a Lecture block', () => {
    const section = aedarAccessSection(aedarSummary('22001'), territory)
    expect(section.key).toBe('aedar-access')
    expect(section.label).toBe('La ville du 1/12, du 1/6, du 1/4 et du 1/3 d’heure')
    expect(section.lecture).toBeNull()
  })

  it('owns the blank-map title and keeps the provisional horizon', () => {
    const section = aedarAccessSection(aedarSummary('22001'), territory)
    expect(section.evidence?.kind).toBe('aedar-access')
    if (section.evidence?.kind !== 'aedar-access') return
    expect(section.evidence.mapFigureTitle.map((segment) => segment.value).join('')).toBe('Quelle diversité de l’offre est accessible en 15 minutes depuis les adresses résidentielles ?')
    expect(section.evidence.mapFigureTitle.find((segment) => segment.kind === 'emphasis')?.value).toBe('15 minutes')
    expect(section.evidence.horizonMinutes).toBe(AEDAR_PROTOTYPE_HORIZON_MINUTES)
  })

  it('derives both ramps for every mode with content-owned figure titles', () => {
    const section = aedarAccessSection(aedarSummary('22001'), territory)
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
    const section = aedarAccessSection(aedarSummary('22001'), territory, {
      reference: { data: aedarSummary('200000001', 'epci', 2.5), territory: referenceTerritory, label: 'EPCI X' },
    })
    if (section.evidence?.kind !== 'aedar-access') throw new Error('aedar-access evidence expected')
    for (const ramp of section.evidence.ramps) {
      expect(ramp.referenceLabel).toBe('Moyenne de EPCI X')
      expect(Object.keys(ramp.reference ?? {}).sort()).toEqual([...AEDAR_RAMP_MODES].sort())
    }
    // Ten reference types contribute 0.25 each, all remaining types have zero access.
    expect(section.evidence.ramps[0]?.reference?.car).toEqual([2.5, 2.5, 2.5, 2.5])
    expect(section.evidence.ramps[1]?.reference?.walk).toEqual([2.5, 2.5, 2.5, 2.5])
    expect(section.evidence.comparisonLabel).toBe('Moyenne de EPCI X')
    expect(section.evidence.availability).toBe('complete')
  })

  it.each(['publication', 'reference publication', 'source vintage', 'reference date', 'publication date'])('keeps the focal ramps without an incompatible reference: %s', (kind) => {
    const reference = aedarSummary('200000001', 'epci', 2.5)
    if (kind === 'publication') reference.summaryContentVersion = 'other-summary-version'
    if (kind === 'reference publication') reference.referenceContentVersion = 'other-reference-version'
    for (const reading of reference.readings) {
      if (kind === 'source vintage') reading.vintage_id = 'other-vintage'
      if (kind === 'reference date') reading.reference_date = '2025-01-01'
      if (kind === 'publication date') reading.publication_date = '2025-09-30'
    }
    for (const source of reference.provenance.sources) {
      if (kind === 'source vintage') source.vintage_id = 'other-vintage'
      if (kind === 'reference date') source.reference_date = '2025-01-01'
      if (kind === 'publication date') source.publication_date = '2025-09-30'
    }
    const section = aedarAccessSection(aedarSummary('22001'), territory, {
      reference: { data: reference, territory: referenceTerritory, label: 'EPCI X' },
    })
    const evidence = section.evidence!
    expect(evidence.ramps[1]?.territory.car[2]).toBe(5)
    expect(evidence.ramps.every((ramp) => ramp.reference === null && ramp.referenceLabel === null)).toBe(true)
    expect(evidence.comparisonLabel).toBeNull()
  })

  it('keeps a missing reference reading null instead of reconstructing it from typed detail', () => {
    const reference = aedarSummary('200000001', 'epci', 2.5)
    reference.readings = reference.readings.filter(({ measure }) => measure !== 'meanDiversity')
    const evidence = aedarAccessSection(aedarSummary('22001'), territory, {
      reference: { data: reference, territory: referenceTerritory, label: 'EPCI X' },
    }).evidence!
    expect(evidence.ramps[1]?.territory.car[2]).toBe(5)
    expect(evidence.ramps[0]?.reference?.car[2]).toBeNull()
    expect(evidence.ramps[0]?.referenceLabel).toBe('Moyenne de EPCI X')
  })

  it('marks the section incomplete when a ramp cannot cover the whole universe', () => {
    const data = aedarSummary('22001')
    const reading = data.readings.find(({ measure }) => measure === 'car5Diversity')!
    reading.value = null
    reading.status = 'unavailable'
    reading.n_typequ = null
    reading.coverage_status = null
    const section = aedarAccessSection(data, territory)
    expect(section.availability).toBe('incomplete')
    if (section.evidence?.kind !== 'aedar-access') throw new Error('aedar-access evidence expected')
    expect(section.evidence.availability).toBe('incomplete')
    expect(section.evidence.ramps[0]?.territory.car[0]).toBeNull()
    expect(section.evidence.diversityGap.value).toBe(0)
  })

  it('derives the 15-minute car-minus-walk diversity gap from the territory values', () => {
    const data = aedarSummary('22001')
    data.readings.find(({ measure }) => measure === 'meanDiversity')!.value = 6
    data.readings.find(({ measure }) => measure === 'walk15Diversity')!.value = 2
    const section = aedarAccessSection(data, territory)
    if (section.evidence?.kind !== 'aedar-access') throw new Error('aedar-access evidence expected')
    expect(section.evidence.diversityGap.value).toBeCloseTo(4)
    expect(section.evidence.diversityGap.horizonMinutes).toBe(15)
  })

  it('keeps the derived diversity gap unavailable if either 15-minute mode value is null', () => {
    const data = aedarSummary('22001')
    const reading = data.readings.find(({ measure }) => measure === 'walk15Diversity')!
    reading.value = null
    reading.status = 'unavailable'
    reading.n_typequ = null
    reading.coverage_status = null
    const section = aedarAccessSection(data, territory)
    if (section.evidence?.kind !== 'aedar-access') throw new Error('aedar-access evidence expected')
    expect(section.evidence.diversityGap.value).toBeNull()
  })

  it('uses a generic source link label when attribution metadata is empty, never the internal key', () => {
    const data = aedarSummary('22001')
    data.provenance.sources[0]!.attribution = ''
    const section = aedarAccessSection(data, territory)
    if (section.evidence?.kind !== 'aedar-access') throw new Error('aedar-access evidence expected')
    expect(section.evidence.source?.label).toBe('Source')
    expect(section.evidence.source?.label).not.toBe('aedar_bretagne')
    expect(section.evidence.source?.credit).toBeNull()
  })

  it('keeps source attribution compact and metadata-derived', () => {
    const data = aedarSummary('22001')
    data.provenance.sources[0]!.attribution = '© OpenStreetMap contributors; données AEDAR - licence ODbL'
    const section = aedarAccessSection(data, territory)
    if (section.evidence?.kind !== 'aedar-access') throw new Error('aedar-access evidence expected')
    expect(section.evidence.source).toMatchObject({ label: 'AEDAR', version: '2026-v1', credit: '© OpenStreetMap contributors' })
  })
})

describe('aedarPendingPrototypeSections (#769 layout stability)', () => {
  const lossMapMetadata = { status: 'loading', legend: null } as const

  it('mirrors the hydrated order and labels exactly, with the loss map at its final position', () => {
    const ready = aedarPrototypeSections(aedarSummary('22001'), aedarReady('22001'), territory, { lossMapMetadata })
    const pending = aedarPendingPrototypeSections(territory, { lossMapMetadata })
    expect(pending.map((section) => section.key)).toEqual(ready.map((section) => section.key))
    expect(pending.map((section) => section.key)).toEqual([
      'aedar-car-overview', 'aedar-diversity-loss', 'aedar-access', 'aedar-equipment-profile', 'aedar-equipment-explorer',
    ])
    expect(pending.map((section) => section.label)).toEqual(ready.map((section) => section.label))
    expect(pending[1]?.evidence?.kind).toBe('aedar-diversity-loss')
    expect(pending[1]?.label).toBe('Et sans voiture alors ?')
  })

  it('keeps every numeric reading null and carries no fabricated fallback while pending', () => {
    const pending = aedarPendingPrototypeSections(territory, { lossMapMetadata })
    const overview = pending[0]
    expect(overview.evidence?.kind).toBe('aedar-car-overview')
    if (overview.evidence?.kind !== 'aedar-car-overview') return
    expect(overview.evidence.meanDiversity).toBeNull()
    expect(overview.evidence.meanVolume).toBeNull()
    expect(overview.evidence.nAddresses).toBeNull()
    expect(overview.evidence.source).toBeNull()
    expect(overview.evidence.comparisonLabel).toBeNull()
    expect(overview.evidence.scalars.map((scalar) => [scalar.key, scalar.value, scalar.reference])).toEqual([
      ['meanDiversity', null, null],
      ['meanVolume', null, null],
    ])
    // The pending introduction keeps the same prose but drops the address-count
    // clause instead of inventing a number: "(BDNB)." closes directly.
    const introduction = overview.evidence.unitIntroduction.flat().map((segment) => segment.value).join('')
    expect(introduction).toContain('Base permanente des équipements')
    expect(introduction).toContain('(BDNB).')
    expect(introduction).not.toMatch(/\(BDNB, /u)
    // Static section prose is shared verbatim with the hydrated overview.
    const readyOverview = aedarPrototypeSections(aedarSummary('22001'), aedarReady('22001'), territory, { lossMapMetadata })[0]
    if (readyOverview.evidence?.kind === 'aedar-car-overview') {
      expect(overview.evidence.prose).toEqual(readyOverview.evidence.prose)
      expect(overview.evidence.mapFigureTitle).toEqual(readyOverview.evidence.mapFigureTitle)
    }
  })

  it('marks the sections below the loss map as honest placeholders (evidence null, incomplete)', () => {
    const pending = aedarPendingPrototypeSections(territory, { lossMapMetadata })
    for (const section of pending.slice(2)) {
      expect(section.evidence).toBeNull()
      expect(section.availability).toBe('incomplete')
      expect(section.lecture).toBeNull()
      expect(section.provenance).toEqual([])
    }
    expect(pending[0].availability).toBe('incomplete')
  })

  it('consumes the single shared scalar descriptor set in both builders, with pending values null (#889 review)', () => {
    // The AEDAR producer/API contract declares only measure column names — no
    // display units — so key/label/unit are app-owned descriptors, exported
    // once and consumed by BOTH the hydrated and the pending builders.
    const descriptors = AEDAR_CAR_OVERVIEW_SCALAR_READINGS.map(({ key, label, unit }) => ({ key, label, unit }))
    expect(descriptors).toEqual([
      { key: 'meanDiversity', label: 'Types d’équipements', unit: 'types / adresse' },
      { key: 'meanVolume', label: 'Établissements', unit: 'établissements / adresse' },
    ])
    const ready = aedarPrototypeSections(aedarSummary('22001'), aedarReady('22001'), territory, { lossMapMetadata })[0]
    const pending = aedarPendingPrototypeSections(territory, { lossMapMetadata })[0]
    if (ready.evidence?.kind !== 'aedar-car-overview' || pending.evidence?.kind !== 'aedar-car-overview') {
      throw new Error('aedar-car-overview evidence expected')
    }
    const shapeOf = (scalars: readonly { key: string; label: string; unit: string }[]) =>
      scalars.map(({ key, label, unit }) => ({ key, label, unit }))
    // Both builders take the descriptors from the same exported set: pending
    // facts cannot drift from the hydrated presentation.
    expect(shapeOf(ready.evidence.scalars)).toEqual(descriptors)
    expect(shapeOf(pending.evidence.scalars)).toEqual(descriptors)
    // Ready readings carry real numbers from the fixture; pending stay null
    // (rendered '—') — no fabricated fallback.
    expect(ready.evidence.scalars.map((scalar) => typeof scalar.value)).toEqual(['number', 'number'])
    expect(pending.evidence.scalars.map((scalar) => [scalar.value, scalar.reference])).toEqual([[null, null], [null, null]])
    // The remaining overview presentation (map title, scalar figure title) is
    // shared verbatim between pending and hydrated too.
    expect(pending.evidence.mapFigureTitle).toEqual(ready.evidence.mapFigureTitle)
    expect(pending.evidence.scalarFigureTitle).toEqual(ready.evidence.scalarFigureTitle)
  })
})
