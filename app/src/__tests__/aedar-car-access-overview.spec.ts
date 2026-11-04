import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import { aedarCarAccessOverviewSection, aedarPrototypeSections } from '@/fiche/content/aedarAccessSection'
import type { AedarReferenceEvidence } from '@/fiche/content/aedarAccessSection'
import type { AedarFetchResult } from '@/fiche/content/aedarApiClient'
import type { TerritoryIdentity } from '@/fiche/content/territoryFacts'

const territory: TerritoryIdentity = {
  type: 'commune', code: '22001', name: 'Test Commune', department: '22', epci: null,
}

function ready(): Extract<AedarFetchResult, { status: 'ready' }> {
  const [, ...lines] = readFileSync(resolve(process.cwd(), '../pipeline/inst/extdata/aedar-typequ-2025.csv'), 'utf8')
    .trim().split(/\r?\n/)
  const measures = Object.fromEntries([5, 10, 15, 20].flatMap((horizon) =>
    ['walk', 'transit', 'transit_gain', 'bike_lts2', 'bike_lts4', 'car'].flatMap((mode) =>
      ['share', 'min', 'max', ...Array.from({ length: 9 }, (_, index) => `decile${index + 1}`), 'mean']
        .map((statistic) => [`count_${horizon}_${mode}_${statistic}`, 0]),
    ),
  ))
  const facts = lines.map((line) => {
    const match = line.match(/^"([^"]+)","((?:[^"]|"")*)"$/)
    if (!match) throw new Error(`Invalid canonical TYPEQU row: ${line}`)
    return {
      territory_id: territory.code, territory_type: territory.type,
      typequ: match[1]!, typequ_label: match[2]!.replaceAll('""', '"'), identity: {},
      n_addresses: 3, n_observed: 0, coverage_status: 'covered', measures: { ...measures },
      source_id: 'aedar_bretagne', vintage_id: '2026-v1', source_url: 'https://example.test/aedar',
      licence: 'ODbL', attribution: 'AEDAR', reference_date: null, publication_date: '2026-09-30',
    }
  })
  // Three addresses: type 1 counts [0, 1, 3], type 2 counts [2, 0, 1].
  // All other source types have zero access. Address totals are [2, 1, 4];
  // address diversities are [1, 1, 2]. n_observed is not the denominator.
  facts[0]!.n_observed = 2
  facts[0]!.measures.count_15_car_share = 2 / 3
  facts[0]!.measures.count_15_car_mean = 4 / 3
  facts[1]!.n_observed = 2
  facts[1]!.measures.count_15_car_share = 2 / 3
  facts[1]!.measures.count_15_car_mean = 1
  return {
    status: 'ready', contentVersion: 'worked-example', referenceContentVersion: 'reference-example', facts,
    provenance: { contentVersion: 'worked-example', sources: [{
      source_id: 'aedar_bretagne', vintage_id: '2026-v1', source_url: 'https://example.test/aedar',
      licence: 'ODbL', attribution: 'AEDAR', reference_date: null, publication_date: '2026-09-30',
    }] },
  }
}

function epciReference(): AedarReferenceEvidence {
  const data = ready()
  for (const fact of data.facts) {
    fact.territory_type = 'epci'
    fact.territory_id = '200000001'
    fact.n_addresses = 6
    fact.n_observed = 0
    fact.measures.count_15_car_share = 0
    fact.measures.count_15_car_mean = 0
  }
  // Six EPCI addresses: counts [0,0,0,1,0,0] and [0,0,0,0,2,3].
  // Total diversity [0,0,0,1,1,1], total establishments [0,0,0,1,2,3].
  data.facts[0]!.n_observed = 1
  data.facts[0]!.measures.count_15_car_share = 1 / 6
  data.facts[0]!.measures.count_15_car_mean = 1 / 6
  data.facts[1]!.n_observed = 2
  data.facts[1]!.measures.count_15_car_share = 2 / 6
  data.facts[1]!.measures.count_15_car_mean = 5 / 6
  return { data, territory: { type: 'epci', id: '200000001' }, label: 'EPCI Test' }
}

describe('AEDAR car access overview', () => {
  it('lit les cellules de la sélection pour les moyennes et les rampes sans emprunter leurs rangs TYPEQU (#914)', () => {
    const data = ready()
    const comparison = { label: 'Moyenne de la sélection', contentVersion: data.contentVersion,
      referenceContentVersion: data.referenceContentVersion,
      cells: data.facts.flatMap((fact, index) => Object.keys(fact.measures).map((measure) => ({
        ...fact, measure, statistic: 'pooled' as const, group_coverage_status: 'covered',
        group_n_addresses: 50, group_n_observed: 42,
        group_value: index === 0 ? (measure.endsWith('_share') ? 0.5 : 1) : 0,
        rank: 3, rank_size: 3, rank_ties: 1, direction: 'high' as const,
      }))) }
    const sections = aedarPrototypeSections(data, territory, { comparison })
    expect(sections[0].evidence!.scalars.map((s) => s.reference?.value)).toEqual([0.5, 1])
    expect(sections[0].evidence!.scalars[0]!.reference).toMatchObject({ label: 'Moyenne de la sélection' })
    expect(sections[0].evidence!.scalars[0]!.reference).not.toHaveProperty('rank')
    expect(sections[0].evidence!.scalars[0]!.rankUnavailableLabel).toBe('Classement indisponible')
    expect(sections[1].evidence!.ramps[0]!.reference!.car).toEqual([0.5, 0.5, 0.5, 0.5])
    expect(sections[1].evidence!.ramps[1]!.reference!.car).toEqual([1, 1, 1, 1])
    expect(sections[3].evidence!.comparison).toBe(comparison)
    const stale = aedarPrototypeSections(data, territory, { comparison: { ...comparison, contentVersion: 'stale' } })
    expect(stale[0].evidence!.scalars.map((s) => s.reference)).toEqual([null, null])
    expect(stale[1].evidence!.ramps[0]!.reference).toBeNull()
    const partial = aedarPrototypeSections(data, territory, { comparison: { ...comparison,
      cells: comparison.cells.filter((cell, index) => !(index === 0 || cell.typequ === data.facts[0]!.typequ && cell.measure === 'count_15_car_share')) } })
    expect(partial[0].evidence!.scalars[0]!.reference).toBeNull()
    expect(partial[1].evidence!.ramps[0]!.reference!.car).toEqual([0.5, 0.5, null, 0.5])
    const inconsistentWeights = aedarPrototypeSections(data, territory, { comparison: { ...comparison,
      cells: comparison.cells.map((cell) => cell.typequ === data.facts[0]!.typequ ? { ...cell, group_n_addresses: 100 } : cell) } })
    expect(inconsistentWeights[0].evidence!.scalars.map((s) => s.reference)).toEqual([null, null])
  })
  it('keeps the 15-minute time-ramp readings on the overview address means, with independent EPCI denominators', () => {
    const [overview, access] = aedarPrototypeSections(ready(), territory, { reference: epciReference() })
    const [diversity, volume] = access.evidence!.ramps
    expect(diversity!.territory.car[2]).toBeCloseTo(4 / 3)
    expect(volume!.territory.car[2]).toBeCloseTo(7 / 3)
    expect(diversity!.reference!.car[2]).toBeCloseTo(0.5)
    expect(volume!.reference!.car[2]).toBeCloseTo(1)
    expect(overview.evidence!.meanDiversity).toBeCloseTo(4 / 3)
    expect(overview.evidence!.meanVolume).toBeCloseTo(7 / 3)
  })
  it('supplies scalar readings with the named EPCI address mean, not a median or a peer rank', () => {
    const section = aedarCarAccessOverviewSection(ready(), territory, { reference: epciReference() })
    const [diversity, volume] = section.evidence!.scalars
    expect(diversity).toMatchObject({ key: 'meanDiversity', label: 'Types d’équipements' })
    expect(volume).toMatchObject({ key: 'meanVolume', label: 'Établissements' })
    expect(diversity!.value).toBeCloseTo(4 / 3)
    expect(volume!.value).toBeCloseTo(7 / 3)
    expect(diversity!.reference).toMatchObject({
      kind: 'territory-mean', value: 0.5,
      territory: { type: 'epci', id: '200000001', name: 'EPCI Test' },
      label: 'Moyenne — EPCI Test',
    })
    expect(volume!.reference!.value).toBeCloseTo(1)
    expect(diversity!.reference).not.toHaveProperty('rank')
    expect(diversity!.reference).not.toHaveProperty('scope.kind', 'communes-epci')
    expect(section.evidence!.comparisonLabel).toBe('Moyenne de EPCI Test')
  })

  it.each(['partial universe', 'uncovered', 'publication', 'source vintage', 'wrong territory'])('keeps local scalars without borrowing an incompatible EPCI: %s', (kind) => {
    const reference = epciReference()
    if (kind === 'partial universe') reference.data.facts.pop()
    if (kind === 'uncovered') reference.data.facts[0]!.coverage_status = 'uncovered_no_bdnb_residential_origins'
    if (kind === 'publication') {
      reference.data.contentVersion = 'other-version'
      reference.data.provenance.contentVersion = 'other-version'
    }
    if (kind === 'source vintage') {
      reference.data.provenance.sources[0]!.vintage_id = 'other-vintage'
      for (const fact of reference.data.facts) fact.vintage_id = 'other-vintage'
    }
    if (kind === 'wrong territory') reference.territory.id = '999999999'
    const section = aedarCarAccessOverviewSection(ready(), territory, { reference })
    expect(section.availability).toBe('complete')
    expect(section.evidence!.scalars.map((scalar) => scalar.reference)).toEqual([null, null])
    expect(section.evidence!.comparisonLabel).toBeNull()
    expect(section.evidence!.meanVolume).toBeCloseTo(7 / 3)
    if (kind === 'publication') {
      expect(aedarPrototypeSections(ready(), territory, { reference })[3].evidence!.reference).toBeNull()
    }
  })

  it('provides real address means for diversity and total volume at 15 minutes, not mean volume per type', () => {
    const section = aedarCarAccessOverviewSection(ready(), territory)

    expect(section.key).toBe('aedar-car-overview')
    expect(section.evidence).toMatchObject({
      kind: 'aedar-car-overview', horizonMinutes: 15, nAddresses: 3,
      availability: 'complete', mapModes: ['car'],
    })
    expect(section.evidence!.meanDiversity).toBeCloseTo(4 / 3)
    expect(section.evidence!.meanVolume).toBeCloseTo(7 / 3)
    expect(section.evidence!.scalarFigureTitle).toContain('15 minutes (moyenne par adresse)')
    expect(section.evidence!.scalars.map((scalar) => scalar.reference)).toEqual([null, null])
    expect(section.evidence!.comparisonLabel).toBeNull()
  })

  it('does not present a partial TYPEQU universe as a territory mean', () => {
    const data = ready()
    data.facts.pop()
    const section = aedarCarAccessOverviewSection(data, territory)
    expect(section.availability).toBe('incomplete')
    expect(section.evidence!.meanDiversity).toBeNull()
    expect(section.evidence!.meanVolume).toBeNull()
    expect(section.evidence!.prose.flat().map((segment) => segment.value).join('')).toContain('diversité médiane')
  })

  it.each(['pending', 'failed', 'missing-cell'] as const)(
    'retains a scalar unavailable mark during a %s comparison read', (state) => {
      const data = ready()
      const section = aedarCarAccessOverviewSection(data, territory, {
        comparisonRequest: { intent: { kind: 'fixed_comparison', context: 'density_class' }, label: 'Moyenne de la classe de densité' },
        ...(state === 'missing-cell' ? { comparison: { label: 'Moyenne de la classe de densité',
          contentVersion: data.contentVersion, referenceContentVersion: data.referenceContentVersion, cells: [] } } : {}),
      })
      expect(section.evidence!.scalars.map((scalar) => scalar.reference)).toEqual([null, null])
      expect(section.evidence!.scalars.map((scalar) => scalar.comparisonUnavailableLabel)).toEqual([
        'Groupe comparé : Indisponible', 'Groupe comparé : Indisponible',
      ])
      expect(section.evidence!.scalars.map((scalar) => scalar.comparisonAccessibleLabel)).toEqual([
        'Moyenne de la classe de densité', 'Moyenne de la classe de densité',
      ])
    },
  )

  it.each(['addresses', 'territory', 'source', 'coverage', 'duplicate', 'unknown type'])('rejects incompatible %s without producing a fabricated mean', (kind) => {
    const data = ready()
    if (kind === 'addresses') data.facts[1]!.n_addresses = 4
    if (kind === 'territory') data.facts[1]!.territory_id = '99999'
    if (kind === 'source') data.facts[1]!.vintage_id = 'other'
    if (kind === 'coverage') data.facts[1]!.coverage_status = 'uncovered_no_bdnb_residential_origins'
    if (kind === 'duplicate') data.facts[1]!.typequ = data.facts[0]!.typequ
    if (kind === 'unknown type') data.facts[1]!.typequ = 'UNKNOWN'
    const section = aedarCarAccessOverviewSection(data, territory)
    expect(section.availability).toBe('incomplete')
    expect(section.evidence!.meanDiversity).toBeNull()
    expect(section.evidence!.meanVolume).toBeNull()
  })

  it('preserves unknown measures rather than treating them as zero', () => {
    const data = ready()
    data.facts[0]!.measures.count_15_car_share = null
    const section = aedarCarAccessOverviewSection(data, territory)
    expect(section.availability).toBe('incomplete')
    expect(section.evidence!.meanDiversity).toBeNull()
    expect(section.evidence!.meanVolume).toBeCloseTo(7 / 3)
  })

  it('keeps a covered zero-access territory distinct from unavailable evidence', () => {
    const data = ready()
    for (const fact of data.facts) {
      fact.n_observed = 0
      fact.measures.count_15_car_share = 0
      fact.measures.count_15_car_mean = 0
    }
    const section = aedarCarAccessOverviewSection(data, territory)
    expect(section.availability).toBe('complete')
    expect(section.evidence!.meanDiversity).toBe(0)
    expect(section.evidence!.meanVolume).toBe(0)
    expect(section.evidence!.scalars[1]?.value).toBe(0)
  })

  it('does not label means with provenance that differs from the contributing facts', () => {
    const data = ready()
    data.provenance.sources[0]!.vintage_id = 'another-vintage'
    const section = aedarCarAccessOverviewSection(data, territory)
    expect(section.availability).toBe('incomplete')
    expect(section.evidence!.meanDiversity).toBeNull()
    expect(section.evidence!.meanVolume).toBeNull()
    expect(section.evidence!.source).toBeNull()
  })

  it('gives the prototype an address-based introduction using the same population and map horizon as its means', () => {
    const section = aedarCarAccessOverviewSection(ready(), territory)
    const introduction = section.evidence!.unitIntroduction.flat().map((segment) => segment.value).join('')
    expect(introduction).toContain('5, 10, 15 ou 20 minutes')
    expect(introduction).toContain('3 adresses résidentielles')
    expect(introduction).toContain('Test Commune')
    expect(introduction).toContain('Base de données nationale des bâtiments')
  })
})
