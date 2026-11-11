import { describe, expect, it } from 'vitest'

import { aedarCarAccessOverviewSection, aedarPrototypeSections } from '@/fiche/content/aedarAccessSection'
import type { AedarReferenceEvidence } from '@/fiche/content/aedarAccessSection'
import { AEDAR_AGGREGATE_READING_MEASURES } from '@/fiche/content/aedarTimeRampFacts'
import type { AedarComparisonEvidence } from '@/fiche/content/aedarComparisonClient'
import type { AedarTerritorySummary } from '@/fiche/content/aedarApiClient'
import type { TerritoryIdentity } from '@/fiche/content/territoryFacts'

const territory: TerritoryIdentity = {
  type: 'commune', code: '22001', name: 'Test Commune', department: '22', epci: null,
}

const source = {
  source_id: 'aedar_bretagne', vintage_id: '2026-v1', source_url: 'https://example.test/aedar',
  licence: 'ODbL', attribution: 'AEDAR', reference_date: null, publication_date: '2026-09-30',
}

/** Deliberately independent of the TYPEQU fixture: values are producer-served summary observations. */
function summary(overrides: Record<string, number | null> = {}, territoryId = '22001', territoryType: 'commune' | 'epci' = 'commune') {
  const readings = Object.entries(AEDAR_AGGREGATE_READING_MEASURES).map(([measure, sourceMeasure]) => ({
    measure,
    value: Object.hasOwn(overrides, measure) ? overrides[measure]! : sourceMeasure.endsWith('_share') ? 0.5 : 1,
    status: 'available' as const, n_typequ: 235, n_addresses: 3, n_observed: 2,
    coverage_status: 'covered', statistic: 'direct' as const, ...source,
  }))
  const target: AedarTerritorySummary = {
    territory: { territory_type: territoryType, territory_id: territoryId },
    summaryContentVersion: 'summary-v1', aedarContentVersion: 'aedar-v1', referenceContentVersion: 'reference-v1',
    readings, provenance: { contentVersion: 'aedar-v1', sources: [source] },
  }
  return target
}

function comparison(data: AedarTerritorySummary): AedarComparisonEvidence {
  return {
    label: 'Moyenne de la sélection', contentVersion: data.aedarContentVersion,
    summaryContentVersion: data.summaryContentVersion, aedarContentVersion: data.aedarContentVersion,
    referenceContentVersion: data.referenceContentVersion,
    cells: Object.keys(AEDAR_AGGREGATE_READING_MEASURES).map((measure) => ({
      ...source, typequ: null, measure, group_coverage_status: 'covered', group_n_addresses: 50,
      group_n_observed: 42, group_value: measure.endsWith('Diversity') ? 0.5 : 1,
      statistic: 'pooled' as const, rank: measure === 'meanDiversity' ? 3 : null,
      rank_size: measure === 'meanDiversity' ? 3 : null, rank_ties: measure === 'meanDiversity' ? 1 : null,
      direction: 'high' as const,
    })),
  }
}

function epciReference(data = summary({ meanDiversity: 0.5, meanVolume: 1 }, '200000001', 'epci')): AedarReferenceEvidence {
  return { data, territory: { type: 'epci', id: '200000001' }, label: 'EPCI Test' }
}

describe('AEDAR summary-driven car access overview', () => {
  it('uses independent published readings for the focal overview and all ramp values', () => {
    const focal = summary({ meanDiversity: 4 / 3, meanVolume: 7 / 3, car15Diversity: 4 / 3, car15Volume: 7 / 3 })
    const [overview, access] = aedarPrototypeSections(focal, null, territory)
    expect(overview.evidence).toMatchObject({ kind: 'aedar-car-overview', nAddresses: 3, meanDiversity: 4 / 3, meanVolume: 7 / 3 })
    expect(overview.evidence?.kind === 'aedar-car-overview' && overview.evidence.scalars.map(({ value }) => value))
      .toEqual([4 / 3, 7 / 3])
    expect(access.evidence?.kind).toBe('aedar-access')
    if (access.evidence?.kind !== 'aedar-access') throw new Error('Expected AEDAR ramp evidence')
    expect(access.evidence.ramps[0]?.territory.car[2]).toBe(4 / 3)
    expect(access.evidence.ramps[1]?.territory.car[2]).toBe(7 / 3)
    expect(access.evidence.availability).toBe('complete')
    // No typed detail was supplied: the waffle and sandbox remain honestly unavailable.
    expect(aedarPrototypeSections(focal, null, territory)[2]?.evidence).toBeNull()
    expect(aedarPrototypeSections(focal, null, territory)[3]?.evidence).toBeNull()
  })

  it('uses summary-clock-bound group values and ranks; rejects each stale summary/source/reference clock', () => {
    const focal = summary({ meanDiversity: 4 / 3, meanVolume: 7 / 3 })
    const current = comparison(focal)
    const currentSections = aedarPrototypeSections(focal, null, territory, { comparison: current,
      comparisonRequest: { intent: { kind: 'fixed_comparison', context: 'density_class' }, label: 'Classe de densité' } })
    const overview = currentSections[0].evidence
    if (overview?.kind !== 'aedar-car-overview') throw new Error('Expected overview evidence')
    expect(overview.scalars.map(({ reference }) => reference?.value)).toEqual([0.5, 1])
    expect(overview.scalars[0]).toMatchObject({ rank: 3, rankSize: 3, rankTies: 1, rankDirection: 'high' })
    expect(currentSections[1].evidence?.kind === 'aedar-access' && currentSections[1].evidence.ramps[0]?.reference?.car)
      .toEqual([0.5, 0.5, 0.5, 0.5])

    for (const stale of [
      { ...current, summaryContentVersion: 'old-summary' },
      { ...current, aedarContentVersion: 'old-source' },
      { ...current, referenceContentVersion: 'old-reference' },
    ]) {
      const sections = aedarPrototypeSections(focal, null, territory, { comparison: stale })
      const staleOverview = sections[0].evidence
      if (staleOverview?.kind !== 'aedar-car-overview') throw new Error('Expected overview evidence')
      expect(staleOverview.scalars.map(({ reference }) => reference)).toEqual([null, null])
      expect(sections[1].evidence?.kind === 'aedar-access' && sections[1].evidence.ramps[0]?.reference).toBeNull()
    }
  })

  it('uses EPCI summary readings as direct references only under matching publication clocks', () => {
    const focal = summary({ meanDiversity: 4 / 3, meanVolume: 7 / 3 })
    const reference = epciReference()
    const section = aedarCarAccessOverviewSection(focal, territory, { reference })
    expect(section.evidence?.kind === 'aedar-car-overview' && section.evidence.scalars.map(({ reference }) => reference?.value))
      .toEqual([0.5, 1])
    expect(section.evidence?.kind === 'aedar-car-overview' && section.evidence.scalars[0]?.reference)
      .toMatchObject({ kind: 'territory-mean', value: 0.5, territory: { type: 'epci', id: '200000001', name: 'EPCI Test' } })
    const stale = epciReference({ ...reference.data, summaryContentVersion: 'other-summary' })
    const staleSection = aedarCarAccessOverviewSection(focal, territory, { reference: stale })
    expect(staleSection.evidence?.kind === 'aedar-car-overview' && staleSection.evidence.scalars.map(({ reference }) => reference))
      .toEqual([null, null])
  })

  it('keeps unavailable summary values null instead of rebuilding them from any typed facts', () => {
    const focal = summary({ meanDiversity: null, meanVolume: 7 / 3, car5Diversity: null })
    const missingDiversity = focal.readings.find(({ measure }) => measure === 'meanDiversity')!
    missingDiversity.status = 'unavailable'; missingDiversity.n_typequ = null; missingDiversity.coverage_status = null
    const missingRamp = focal.readings.find(({ measure }) => measure === 'car5Diversity')!
    missingRamp.status = 'unavailable'; missingRamp.n_typequ = null; missingRamp.coverage_status = null
    const [overview, access] = aedarPrototypeSections(focal, null, territory)
    expect(overview.evidence?.kind === 'aedar-car-overview' && overview.evidence.scalars.map(({ value }) => value))
      .toEqual([null, 7 / 3])
    expect(access.evidence?.kind === 'aedar-access' && access.evidence.ramps[0]?.territory.car[0]).toBeNull()
    expect(overview.availability).toBe('incomplete')
  })

  it('keeps typed rank-null values distinct from unavailable values', () => {
    const focal = summary({ meanDiversity: 4 / 3, meanVolume: 7 / 3 })
    const emptyRank = comparison(focal)
    emptyRank.cells = emptyRank.cells.map((cell) => cell.measure === 'meanDiversity'
      ? { ...cell, rank: null, rank_size: null, rank_ties: null } : cell)
    const sections = aedarPrototypeSections(focal, null, territory, { comparison: emptyRank })
    const overview = sections[0].evidence
    if (overview?.kind !== 'aedar-car-overview') throw new Error('Expected overview evidence')
    expect(overview.scalars[0]?.value).toBe(4 / 3)
    expect(overview.scalars[0]?.rank).toBeNull()
    expect(overview.scalars[0]?.reference?.value).toBe(0.5)
  })

  it('attache le rang servi à chaque point des deux rampes, tous modes et horizons confondus', () => {
    const focal = summary({ meanDiversity: 4 / 3, meanVolume: 7 / 3 })
    const ranked = comparison(focal)
    // One served ordinal per aggregate reading, deliberately not derivable from
    // the focal or reference values (ties on the first measure).
    ranked.cells = Object.keys(AEDAR_AGGREGATE_READING_MEASURES).map((measure, index) => ({
      ...ranked.cells[0]!, measure, group_value: 1,
      rank: index + 1, rank_size: 41, rank_ties: index === 0 ? 3 : 1,
    }))
    const sections = aedarPrototypeSections(focal, null, territory, {
      comparison: ranked,
      comparisonRequest: { intent: { kind: 'fixed_comparison', context: 'density_class' }, label: 'Classe de densité' },
    })
    const access = sections[1].evidence
    if (access?.kind !== 'aedar-access') throw new Error('Expected AEDAR ramp evidence')
    for (const ramp of access.ramps) {
      const statistic = ramp.rampKey === 'diversity' ? 'share' : 'mean'
      for (const mode of ['car', 'bike_lts2', 'bike_lts4', 'transit', 'walk'] as const) {
        expect(ramp.referenceRanks?.[mode]).toHaveLength(4)
        ramp.xAxis.values.forEach((horizon, index) => {
          const measure = Object.entries(AEDAR_AGGREGATE_READING_MEASURES)
            .find(([, sourceMeasure]) => sourceMeasure === `count_${horizon}_${mode}_${statistic}`)![0]
          const served = ranked.cells.find((candidate) => candidate.measure === measure)!
          expect(ramp.referenceRanks?.[mode]?.[index]).toEqual({
            position: served.rank, size: served.rank_size, ties: served.rank_ties,
          })
        })
      }
    }
  })

  it('laisse chaque rampe sans rang quand la comparaison ne sert que des valeurs', () => {
    const focal = summary({ meanDiversity: 4 / 3, meanVolume: 7 / 3 })
    const unranked = comparison(focal)
    unranked.cells = unranked.cells.map((cell) => ({ ...cell, rank: null, rank_size: null, rank_ties: null }))
    const access = aedarPrototypeSections(focal, null, territory, {
      comparison: unranked,
      comparisonRequest: { intent: { kind: 'fixed_comparison', context: 'density_class' }, label: 'Classe de densité' },
    })[1].evidence
    if (access?.kind !== 'aedar-access') throw new Error('Expected AEDAR ramp evidence')
    for (const ramp of access.ramps) {
      expect(ramp.reference).not.toBeNull()
      for (const mode of ['car', 'bike_lts2', 'bike_lts4', 'transit', 'walk'] as const) {
        expect(ramp.referenceRanks?.[mode]).toEqual([null, null, null, null])
      }
    }
  })
})
