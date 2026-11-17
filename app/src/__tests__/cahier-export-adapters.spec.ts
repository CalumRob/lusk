import { describe, expect, it } from 'vitest'

import type { AedarFact } from '@/fiche/content/aedarApiClient'
import type { AedarComparisonCell } from '@/fiche/content/aedarComparisonClient'
import { AEDAR_EQUIPMENT_QUANTILE_STATISTICS } from '@/fiche/content/aedarTimeRampFacts'
import { GROUPE_COMPARE_LABEL } from '@/fiche/content/comparisonWording'
import type {
  AedarEquipmentExplorerEvidence,
  ContentSection,
  MobiliteBarsFigureEvidence,
  MobiliteRaccordementEvidence,
  MobiliteShareEvidence,
} from '@/fiche/content/themeContent'
import type { NumericFact } from '@/fiche/content/territoryFacts'
import {
  captureCahierSection,
  projeterRequeteExport,
} from '@/fiche/prototype/cahierExportCapture'
import type {
  CahierExportCapture,
  CahierExportPublication,
  CahierSectionCaptureInput,
} from '@/fiche/prototype/cahierExportCapture'
import {
  projeterRequeteExportFigures,
} from '@/fiche/prototype/cahierExportAdapters'
import {
  cahierExportFixture,
  readyLossMetadata,
  sectionOf,
} from './helpers/cahierExportFixtures'
import type { CahierExportFixture } from './helpers/cahierExportFixtures'

const unit = { key: 'acces-aux-services', label: 'Accès aux services' }
const aedarState = {
  modes: ['car', 'walk', 'transit'] as const,
  horizonMinutes: 15 as const,
  comparisonVisible: true,
  comparisonEligible: true,
  chapterActive: true,
}

function inputFor(
  fixture: CahierExportFixture,
  section: ContentSection,
  publications: readonly CahierExportPublication[] = [],
  options: Partial<CahierSectionCaptureInput> = {},
): CahierSectionCaptureInput {
  return {
    section,
    unit,
    territory: fixture.content.territory,
    readiness: { status: 'ready', reason: 'evidence-ready', availability: section.availability },
    comparisonEligible: true,
    comparisonStatus: 'ready',
    comparisonError: null,
    control: fixture.control,
    aedar: aedarState,
    publications,
    ...options,
  }
}

function requestFor(capture: CahierExportCapture, modes: readonly string[] = []) {
  const projection = projeterRequeteExport(capture, modes)
  if (projection.status !== 'ready') throw new Error(`Invalid projection: ${projection.reason}`)
  return projection.request
}

function layer(
  slot: string,
  state: Partial<{ toggle: boolean | null; referenceAvailable: boolean; visibleReferenceAvailable: boolean; displayed: boolean }> = {},
  owner: 'aedar-comparison-layer' | 'mobilite-comparison-bars' | 'mobilite-raccordement-curve' | 'mobilite-share-track' = 'aedar-comparison-layer',
): CahierExportPublication {
  return {
    slot,
    state: {
      owner,
      state: {
        toggle: true,
        referenceAvailable: true,
        visibleReferenceAvailable: true,
        displayed: true,
        ...state,
      },
    },
  }
}

/** One owner publication from the mobilite section's public state seam. */
function mobileSectionState(overrides: Partial<{
  comparisonStatus: 'idle' | 'loading' | 'ready' | 'error' | 'unavailable'
  comparisonError: string | null
  comparisonNone: boolean
  ratioReferenceAvailable: boolean
  ratioReferenceDisplayed: boolean
}> = {}): CahierExportPublication {
  return {
    slot: 'mobilite-section-state',
    state: {
      owner: 'mobilite-section',
      state: {
        comparisonStatus: 'ready',
        comparisonError: null,
        comparisonNone: false,
        ratioReferenceAvailable: false,
        ratioReferenceDisplayed: false,
        ...overrides,
      },
    },
  }
}

function cloneSection(
  fixture: CahierExportFixture,
  key: ContentSection['key'],
  mutate: (section: any) => void,
): ContentSection {
  const section = JSON.parse(JSON.stringify(sectionOf(fixture.content, key))) as any
  mutate(section)
  return section as ContentSection
}

function fact(
  key: string,
  detail: string | null,
  value: number | null,
  unitValue: string,
  reference: number | null = null,
  rank: { position: number; size: number; ties?: number } | null = null,
): { label: string; fact: NumericFact } {
  return {
    label: detail ?? key,
    fact: {
      key,
      detail,
      value,
      unit: unitValue,
      availability: 'complete',
      provenance: null,
      comparison: reference === null ? null : {
        direction: 'plus-est-mieux',
        scope: { kind: 'communes-epci', label: 'communes de EPCI X' },
        reference: { kind: 'median', value: reference },
        rank,
      },
      comparisonBasis: 'territory-median',
      reason: null,
    },
  }
}

function aedarFact(): AedarFact {
  return {
    territory_id: '22001',
    territory_type: 'commune',
    typequ: 'B207',
    typequ_label: 'Boulangerie (B207)',
    identity: {},
    n_addresses: 100,
    n_observed: 100,
    coverage_status: 'covered',
    measures: {
      count_15_car_min: 0,
      count_15_car_decile1: 0.04,
      count_15_car_decile2: 2,
      count_15_car_decile3: 3,
      count_15_car_decile4: 4,
      count_15_car_decile5: 5,
      count_15_car_decile6: 6,
      count_15_car_decile7: 7,
      count_15_car_decile8: 8,
      count_15_car_decile9: 9,
      count_15_car_max: 10,
      count_15_car_mean: 4,
      count_5_car_mean: 1,
      count_10_car_mean: 2,
      count_20_car_mean: 6,
    },
    source_id: 'aedar_bretagne',
    vintage_id: '2026-v1',
    source_url: 'https://example.test/aedar',
    licence: 'ODbL',
    attribution: 'AEDAR',
    reference_date: null,
    publication_date: null,
  }
}

function explorerEvidence(): AedarEquipmentExplorerEvidence {
  return {
    kind: 'aedar-equipment-explorer',
    contentVersion: 'facts-v1',
    referenceContentVersion: 'reference-v1',
    facts: [],
    initialTypequ: 'B207',
    initialHorizonMinutes: 15,
    introduction: [],
    volumeFigureTitle: 'Établissements accessibles',
    volumeYAxisTitle: 'Volume de l’offre',
    distributionFigureTitle: 'Distribution des établissements accessibles par décile',
    distributionStatistics: AEDAR_EQUIPMENT_QUANTILE_STATISTICS,
    distributionAxisTitle: 'Décile',
    distributionYAxisTitle: 'Nombre d’établissements',
    distributionValueUnit: 'établissement',
    distributionDescription: 'Les barres montrent les valeurs des seuils publiés.',
    distributionUnavailableDescription: 'Distribution indisponible.',
    source: null,
  }
}

function explorerPublication(fact: AedarFact, comparison: AedarComparisonCell[] | null): CahierExportPublication {
  return {
    slot: 'aedar-equipment',
    state: {
      owner: 'aedar-equipment-explorer',
      state: {
        typequ: fact.typequ,
        typequLabel: fact.typequ_label,
        selectedDetail: fact,
        detailStatus: 'ready',
        comparisonStatus: comparison ? 'ready' : 'idle',
        comparisonError: null,
        comparison: comparison ? {
          label: 'Classe de densité', contentVersion: 'facts-v1', referenceContentVersion: 'reference-v1',
          cells: comparison,
        } : null,
        referenceDetail: null,
      },
    },
  }
}

describe('Cahier export adapters — nine-section admission and request immutability (#1022)', () => {
  it('projects every registered section through the family adapters, not a section registry', () => {
    const fixture = cahierExportFixture()
    const families = new Set<string>()
    for (const section of fixture.sections) {
      const capture = captureCahierSection(inputFor(fixture, section))
      const projections = projeterRequeteExportFigures(requestFor(
        capture,
        capture.capabilities.selectedSeries.length
          ? capture.capabilities.selectedSeries
          : [],
      ))
      expect(projections.length).toBe(capture.figures.length)
      for (const projection of projections) {
        expect(projection.slot).toBeTruthy()
        expect(projection.title).toBeTruthy()
        expect(projection.accessibleLabel).toBeTruthy()
        for (const table of projection.tables) {
          for (const row of table.rows) {
            expect(row.cells.map((cell) => cell.columnKey))
              .toEqual(table.columns.map((column) => column.key))
          }
        }
        families.add(projection.family)
      }
    }
    expect(families).toEqual(new Set([
      'aedar-car-overview', 'aedar-diversity-loss', 'aedar-ramps', 'aedar-equipment-profile',
      'aedar-equipment-explorer', 'mobilite-bars', 'mobilite-share', 'mobilite-curve',
    ]))
  })

  it('projects a mode subset without mutating the frozen capture or request', () => {
    const fixture = cahierExportFixture()
    const capture = captureCahierSection(inputFor(fixture, sectionOf(fixture.content, 'aedar-access'), [
      layer('comparison'),
    ]))
    const before = JSON.stringify(capture)
    const request = requestFor(capture, ['walk'])
    const requestBefore = JSON.stringify(request)
    const projections = projeterRequeteExportFigures(request)
    expect(JSON.stringify(capture)).toBe(before)
    expect(JSON.stringify(request)).toBe(requestBefore)
    expect(Object.isFrozen(request.capture)).toBe(true)
    const ramps = projections[0]!
    if (ramps.family !== 'aedar-ramps') throw new Error('ramps expected')
    expect(ramps.ramps[0]?.series.map((series) => series.key)).toEqual(['walk'])
    // Approved flat shape A: one row per cut × mode, five fixed columns.
    expect(ramps.tables[0]?.columns.map((column) => column.key)).toEqual(['mode', 'territory', 'groupe'])
    expect(ramps.tables[0]?.rowHeader).toBe('Temps')
    expect(ramps.tables[0]?.rows.map((row) => row.label)).toEqual(['5 min', '10 min', '15 min', '20 min'])
    expect(ramps.tables[0]?.rows[0]?.cells[0]).toMatchObject({ display: 'À pied', raw: true })
  })
})

describe('Cahier export adapters — AEDAR families (#1022)', () => {
  it('projects the two access ramps with producer values, explicit absence and literal table cells', () => {
    const fixture = cahierExportFixture()
    const section = sectionOf(fixture.content, 'aedar-access')
    const capture = captureCahierSection(inputFor(fixture, section, [layer('comparison')]))
    const imports = projeterRequeteExportFigures(requestFor(capture, ['walk', 'transit']))
    const projection = imports[0]!
    if (projection.family !== 'aedar-ramps') throw new Error('ramps expected')
    expect(projection.ramps).toHaveLength(2)
    expect(projection.ramps[0]?.title).toBe(section.evidence?.kind === 'aedar-access'
      ? section.evidence.ramps[0]!.figureTitle : '')
    const walk = projection.ramps[0]?.series.find((series) => series.key === 'walk')!
    expect(walk.key).toBe('walk')
    expect(walk.points.map((point) => [point.cutKey, point.cutLabel, point.value, point.display]))
      .toEqual([
        [5, '5 min', 5, '5'],
        [10, '10 min', 5, '5'],
        [15, '15 min', 5, '5'],
        [20, '20 min', 5, '5'],
      ])
    expect(walk.points[0]?.referenceValue).toBeNull()
    expect(walk.points[0]?.referenceDisplay).toBe('Indisponible')
    const table = projection.tables[0]!
    // Flat approved shape A: Temps (row dimension) | Mode | territory | Groupe.
    expect(table.rowHeader).toBe('Temps')
    expect(table.columns.map((column) => [column.key, column.kind])).toEqual([
      ['mode', 'raw'], ['territory', 'focal'], ['groupe', 'comparison'],
    ])
    expect(table.rows).toHaveLength(8)
    // One row per cut × mode: the 15 min cut still carries its two modes.
    expect(table.rows[4]).toMatchObject({ key: 'diversity:cut:15:mode:transit', label: '15 min' })
    expect(table.rows[4]?.cells[0]).toMatchObject({ display: 'Transports en commun', raw: true })
    expect(table.rows[4]?.cells[1]).toMatchObject({ value: 5, display: '5', unit: null })
    expect(table.rows[4]?.cells[2]).toMatchObject({ rank: null, raw: false })
    expect(table.rows[5]).toMatchObject({ key: 'diversity:cut:15:mode:walk', label: '15 min' })
  })

  it('projects the car-overview scalars and their served direct reference', () => {
    const fixture = cahierExportFixture({ aedarReference: 'sparse-car' })
    const capture = captureCahierSection(inputFor(fixture, sectionOf(fixture.content, 'aedar-car-overview'), [
      layer('comparison'),
      {
        slot: 'maps',
        state: {
          owner: 'map-availability',
          state: {
            legend: 'none',
            maps: [{
              id: 'car', label: 'Voiture', declared: true, loaded: true, unavailable: false,
              inlineUrl: 'https://images.calumrobertson.fr/maps/aedar/v1/22001-car-inline.webp',
            }],
          },
        },
      },
    ]))
    const projections = projeterRequeteExportFigures(requestFor(capture))
    const projection = projections[0]!
    if (projection.family !== 'aedar-car-overview') throw new Error('overview expected')
    expect(projection.scalars).toHaveLength(2)
    expect(projection.scalars.map((scalar) => [scalar.key, scalar.value, scalar.display, scalar.reference?.value]))
      .toEqual([
        ['meanDiversity', 5, '5', 5],
        ['meanVolume', 5, '5', 5],
      ])
    expect(projection.tables[0]?.rows.map((row) => [
      row.key, row.cells[0]?.display, row.cells[0]?.unit, row.cells[1]?.display,
    ]))
      .toEqual([
        ['meanDiversity', '5', 'types / adresse', '5'],
        ['meanVolume', '5', 'établissements / adresse', '5'],
      ])
    expect(projection.maps.status).toBe('available')
    expect(projection.maps.items[0]?.inlineUrl).toBe(
      'https://images.calumrobertson.fr/maps/aedar/v1/22001-car-inline.webp',
    )

    const hidden = captureCahierSection(inputFor(
      fixture,
      sectionOf(fixture.content, 'aedar-car-overview'),
    ))
    const hiddenProjection = projeterRequeteExportFigures(requestFor(hidden))[0]!
    if (hiddenProjection.family !== 'aedar-car-overview') throw new Error('overview expected')
    expect(hiddenProjection.comparisonDisplayed).toBe(false)
    expect(hiddenProjection.comparisonLabel).toBeNull()
    expect(hiddenProjection.scalars.every((scalar) => scalar.reference === null && scalar.rank === null))
      .toBe(true)
    expect(hiddenProjection.tables[0]?.columns.map((column) => column.kind)).toEqual(['focal'])
  })

  it('projects the diversity maps and legend from their owner observations, never from pixels', () => {
    const fixture = cahierExportFixture({ lossMetadata: readyLossMetadata() })
    const section = sectionOf(fixture.content, 'aedar-diversity-loss')
    const unknown = captureCahierSection(inputFor(fixture, section))
    const unknownProjection = projeterRequeteExportFigures(requestFor(unknown))[0]!
    if (unknownProjection.family !== 'aedar-diversity-loss') throw new Error('maps expected')
    expect(unknownProjection.maps).toMatchObject({
      status: 'unknown',
      legend: 'unknown',
      items: [],
      legendDetail: null,
    })
    expect(unknownProjection.tables).toEqual([])

    const observed = captureCahierSection(inputFor(fixture, section, [{
      slot: 'maps',
      state: {
        owner: 'map-availability',
        state: {
          legend: 'available',
          legendDetail: {
            title: 'Types d’équipements perdus par rapport à la voiture',
            minimum: null,
            maximum: null,
            colors: ['#f1f2ec', '#9db7ad', '#3f6f63'],
            tickLabels: ['0', '1', '2+'],
            note: 'Lecture de la perte de diversité.',
            ariaLabel: 'Types d’équipements perdus par rapport à la voiture',
          },
          maps: [
            {
              id: 'walk', label: 'À pied', declared: true, loaded: true, unavailable: false,
              inlineUrl: 'https://images.calumrobertson.fr/maps/aedar/v1/22001-walk-inline.webp',
            },
            {
              id: 'transit', label: 'Transports en commun', declared: true, loaded: false, unavailable: true,
              inlineUrl: 'https://images.calumrobertson.fr/maps/aedar/v1/22001-transit-inline.webp',
            },
            {
              id: 'bike_lts2', label: 'Vélo (LTS2)', declared: false, loaded: false, unavailable: true,
              inlineUrl: null,
            },
          ],
        },
      },
    }]))
    const projection = projeterRequeteExportFigures(requestFor(observed))[0]!
    if (projection.family !== 'aedar-diversity-loss') throw new Error('maps expected')
    expect(projection.maps.status).toBe('partial')
    expect(projection.maps.legend).toBe('available')
    expect(projection.maps.legendDetail).toMatchObject({
      title: 'Types d’équipements perdus par rapport à la voiture',
      tickLabels: ['0', '1', '2+'],
    })
    expect(projection.maps.items.map((item) => [item.id, item.loaded, item.unavailable]))
      .toEqual([['walk', true, false], ['transit', false, true], ['bike_lts2', false, true]])
    expect(projection.maps.items[0]?.inlineUrl).toBe(
      'https://images.calumrobertson.fr/maps/aedar/v1/22001-walk-inline.webp',
    )
    expect(projection.maps.items[1]?.inlineUrl).toContain('22001-transit-inline.webp')
    expect(projection.maps.items[2]?.inlineUrl).toBeNull()
  })

  it('projects the current waffle horizon with every declared mode share', () => {
    const fixture = cahierExportFixture()
    const section = cloneSection(fixture, 'aedar-equipment-profile', (entry) => {
      entry.evidence.facts = [
        {
          ...aedarFact(),
          measures: {
            count_15_walk_share: 0.5, count_15_transit_share: 0.1,
            count_15_bike_lts2_share: 0.1, count_15_bike_lts4_share: 0.1, count_15_car_share: 0.1,
            count_20_walk_share: 0.6, count_20_transit_share: 0.1,
            count_20_bike_lts2_share: 0.1, count_20_bike_lts4_share: 0.1, count_20_car_share: 0.1,
          },
        },
        {
          ...aedarFact(), typequ: 'B202', typequ_label: 'Équipement bis',
          measures: {
            count_15_walk_share: 0.1, count_15_transit_share: 0.1,
            count_15_bike_lts2_share: 0.3, count_15_bike_lts4_share: 0.1, count_15_car_share: 0.1,
            count_20_walk_share: 0.05, count_20_transit_share: 0.05,
            count_20_bike_lts2_share: 0.05, count_20_bike_lts4_share: 0.05, count_20_car_share: 0.4,
          },
        },
      ]
    })
    const capture = captureCahierSection(inputFor(fixture, section, [], {
      aedar: { ...aedarState, horizonMinutes: 20 },
    }))
    const projections = projeterRequeteExportFigures(requestFor(capture))
    const projection = projections[0]!
    if (projection.family !== 'aedar-equipment-profile') throw new Error('profile expected')
    expect(projection.horizonMinutes).toBe(20)
    expect(projection.summary).toBe('Répartition des 2 types d’équipements à 20 minutes. À pied : 1. Transports en commun : 0. Vélo (LTS2) : 0. Vélo (LTS4) : 0. Voiture : 1. Inaccessible : 0.')
    expect(projection.types.map((type) => [type.typequ, type.shares[0]?.value, type.shares[0]?.display]))
      .toEqual([['B207', 0.6, '60\u00a0%'], ['B202', 0.05, '5\u00a0%']])
    expect(projection.tables[0]?.columns.map((column) => column.key))
      .toEqual(['walk', 'transit', 'bike_lts2', 'bike_lts4', 'car'])
    expect(projection.tables[0]?.rows.map((row) => row.key)).toEqual(['B207', 'B202'])
  })

  it('projects the distribution min/deciles/max with served ranks and hides a masked comparison', () => {
    const fixture = cahierExportFixture()
    const model = explorerEvidence()
    const fact = aedarFact()
    const comparison = [
      {
        typequ: 'B207', measure: 'count_15_car_min', group_value: 7.4,
        group_coverage_status: 'covered', group_n_addresses: 50, group_n_observed: 42,
        statistic: 'pooled', source_id: 'aedar_bretagne', vintage_id: '2026-v1',
        reference_date: null, publication_date: null, rank: 1, rank_size: 3, rank_ties: 2,
      },
      {
        typequ: 'B207', measure: 'count_15_car_max', group_value: 9.1,
        group_coverage_status: 'covered', group_n_addresses: 50, group_n_observed: 42,
        statistic: 'pooled', source_id: 'aedar_bretagne', vintage_id: '2026-v1',
        reference_date: null, publication_date: null, rank: 2, rank_size: 3, rank_ties: 1,
      },
    ] as AedarComparisonCell[]
    model.facts = [fact]
    const section = cloneSection(fixture, 'aedar-equipment-explorer', (entry) => {
      entry.evidence.facts = [fact]
    })
    section.evidence = model as never
    const capture = captureCahierSection(inputFor(fixture, section, [
      explorerPublication(fact, comparison),
      layer('comparison'),
      layer('distribution'),
    ]))
    const projections = projeterRequeteExportFigures(requestFor(capture, ['car']))
    const projection = projections[0]!
    if (projection.family !== 'aedar-equipment-explorer') throw new Error('explorer expected')
    expect(projection.distribution.figure.categories.map((category) => category.key)).toEqual([
      'min', 'decile1', 'decile2', 'decile3', 'decile4', 'decile5',
      'decile6', 'decile7', 'decile8', 'decile9', 'max',
    ])
    // The projection carries the native renderer model, not a reduced drawing shape.
    expect(projection.distribution.figure.xAxisTitle).toBe(model.distributionAxisTitle)
    expect(projection.distribution.figure.yAxisTitle).toBe(model.distributionYAxisTitle)
    expect(projection.distribution.figure.formatValue).toBeTypeOf('function')
    expect(projection.distribution.figure.formatAriaValue).toBeTypeOf('function')
    expect(projection.distribution.figure.formatAxisTick).toBeTypeOf('function')
    expect(projection.distribution.figure.series[0]?.color).toBe('var(--cahier-mode-car)')
    expect(projection.distribution.figure.series[0]?.icon).toBeTruthy()
    expect(projection.distribution.figure.series[1]?.ranks?.[0]).toEqual({ position: 1, size: 3, ties: 2 })
    expect(Object.isFrozen(projection.distribution.figure)).toBe(true)
    expect(Object.isFrozen(projection.distribution.figure.series)).toBe(true)
    expect(Object.isFrozen(projection.distribution.figure.series[0]?.values)).toBe(true)
    const distributionTable = projection.tables.find((table) => table.key === 'distribution')!
    // Approved shape B: rows are the published categories, columns are one
    // [territory | Groupe] group per visible mode.
    expect(distributionTable.rowHeader).toBe('Statistique')
    expect(distributionTable.columns.map((column) => column.key))
      .toEqual(['mode:car', 'mode:car:comparison'])
    expect(distributionTable.columns[0]).toMatchObject({ label: 'Commune A1', kind: 'focal', groupLabel: 'Voiture' })
    expect(distributionTable.columns[1]).toMatchObject({ label: 'Groupe', kind: 'comparison', groupLabel: 'Voiture' })
    expect(distributionTable.rows.map((row) => row.key)).toEqual([
      'min', 'decile1', 'decile2', 'decile3', 'decile4', 'decile5',
      'decile6', 'decile7', 'decile8', 'decile9', 'max',
    ])
    expect(distributionTable.rows[0]?.cells[0]).toMatchObject({ columnKey: 'mode:car', value: 0, display: '0' })
    expect(distributionTable.rows[0]?.cells[1]).toMatchObject({
      columnKey: 'mode:car:comparison',
      value: 7.4, display: '7,4', rank: { position: 1, size: 3, ties: 2 }, rankDisplay: '=1er/3',
    })
    expect(distributionTable.rows[10]?.cells[1]).toMatchObject({
      value: 9.1, rank: { position: 2, size: 3, ties: 1 }, rankDisplay: '2e/3',
    })

    const hidden = captureCahierSection(inputFor(fixture, section, [
      explorerPublication(fact, comparison),
      layer('comparison', { displayed: false, toggle: false }),
      layer('distribution', { displayed: false, toggle: false }),
    ]))
    const hiddenProjection = projeterRequeteExportFigures(requestFor(hidden, ['car']))[0]!
    if (hiddenProjection.family !== 'aedar-equipment-explorer') throw new Error('explorer expected')
    const hiddenTable = hiddenProjection.tables.find((table) => table.key === 'distribution')!
    expect(hiddenTable.columns).toHaveLength(1)
    expect(hiddenTable.columns.every((column) => column.kind === 'focal')).toBe(true)
    expect(hiddenTable.rows).toHaveLength(11)
    expect(hiddenTable.rows[0]?.cells).toHaveLength(1)
    expect(hiddenProjection.distribution.figure.series.map((series) => series.key))
      .toEqual(['car', 'car-reference'])
    expect(hiddenProjection.distribution.hiddenSeriesKeys).toEqual(['car-reference'])
    expect(hiddenProjection.accessibleLabel).not.toContain('Groupe comparé')
  })
})

describe('Cahier export adapters — Mobilité families (#1022)', () => {
  it('projects compared bars with segments, raw numerators, served ranks and a hidden layer', () => {
    const fixture = cahierExportFixture()
    const figure: MobiliteBarsFigureEvidence = {
      figureTitle: 'Longueur du réseau par habitant',
      unit: 'km / 1 000 hab.',
      xAxisTitle: 'Réseau',
      yAxisTitle: 'km / 1 000 hab.',
      comparisonLabel: 'Médiane des communes de EPCI X',
      categories: [{
        key: 'bike', label: 'Réseau cyclable', axisLabel: 'à vélo', tone: 'b',
        value: fact('reseaux_par_habitant', 'b_km_1000', 8, 'km / 1 000 hab.', 6, { position: 1, size: 3, ties: 2 }),
        rawValue: fact('reseaux', 'b_longueur', 20, 'km'),
        segments: [
          {
            key: 'protege_km_1000', label: 'Protégé',
            value: fact('offre_cyclable', 'protege_km_1000', 5, 'km / 1 000 hab.', 4, { position: 1, size: 4 }),
            rawValue: fact('offre_cyclable', 'protege_longueur', 4, 'km'),
          },
          {
            key: 'partage_km_1000', label: 'Partagé',
            value: fact('offre_cyclable', 'partage_km_1000', 3, 'km / 1 000 hab.'),
            rawValue: null,
          },
        ],
        splitNote: null,
      }],
    }
    const section = cloneSection(fixture, 'reseaux', (entry) => {
      entry.evidence.figure = figure
    })
    const capture = captureCahierSection(inputFor(fixture, section, [
      layer('bars', {}, 'mobilite-comparison-bars'),
      {
        slot: 'maps',
        state: {
          owner: 'map-availability',
          state: {
            legend: 'none',
            maps: [{
              id: 'car', label: 'Voiture', declared: true, loaded: true, unavailable: false,
              inlineUrl: 'https://images.calumrobertson.fr/maps/v1/22001-car-inline.webp',
            }],
          },
        },
      },
    ]))
    const projection = projeterRequeteExportFigures(requestFor(capture))[0]!
    if (projection.family !== 'mobilite-bars') throw new Error('bars expected')
    const table = projection.tables[0]!
    expect(table.columns.map((column) => [column.key, column.kind])).toEqual([
      ['focal', 'focal'], ['comparison', 'comparison'],
    ])
    expect(table.columns[1]?.label).toBe(GROUPE_COMPARE_LABEL)
    expect(table.columns[0]?.label).toBe(figure.xAxisTitle)
    expect(table.rows.map((row) => [row.key, row.cells[0]?.display, row.cells[0]?.unit, row.cells[0]?.raw]))
      .toEqual([
        ['bike:total', '8', 'km / 1 000 hab.', false],
        ['bike:segment:protege_km_1000', '5', 'km / 1 000 hab.', false],
        ['bike:segment:protege_km_1000:raw', '4', 'km', true],
        ['bike:segment:partage_km_1000', '3', 'km / 1 000 hab.', false],
        ['bike:raw', '20', 'km', true],
      ])
    expect(table.rows[0]?.cells[1]).toMatchObject({
      value: 6, display: '6', rank: { position: 1, size: 3, ties: 2 }, rankDisplay: '=1er/3',
    })
    expect(table.rows[2]?.cells[1]).toMatchObject({ value: null, display: 'Indisponible', raw: true })
    expect(table.rows[4]?.cells[1]).toMatchObject({ value: null, display: 'Indisponible', raw: true })
    expect(projection.maps?.status).toBe('available')
    expect(projection.maps?.items[0]?.inlineUrl).toContain('22001-car-inline.webp')

    const hidden = captureCahierSection(inputFor(fixture, section, [
      layer('bars', { displayed: false, toggle: false }, 'mobilite-comparison-bars'),
    ]))
    const hiddenTable = projeterRequeteExportFigures(requestFor(hidden))[0]!
    if (hiddenTable.family !== 'mobilite-bars') throw new Error('bars expected')
    expect(hiddenTable.tables[0]?.columns.map((column) => column.key)).toEqual(['focal'])
    expect(hiddenTable.tables[0]?.rows.every((row) => row.cells.length === 1)).toBe(true)
    expect(hiddenTable.comparisonLabel).toBeNull()
    expect(hiddenTable.accessibleLabel).not.toContain('Groupe comparé')

    const sparse = cloneSection(fixture, 'reseaux', (entry) => {
      entry.evidence.figure = figure
      entry.evidence.figure.unavailableResources = ['Ressource test']
      entry.evidence.figure.unavailableComparisons = ['Comparaison test']
    })
    const empty = captureCahierSection(inputFor(fixture, sparse, [
      layer('bars', {}, 'mobilite-comparison-bars'),
      mobileSectionState({ comparisonNone: true }),
    ], { control: { ...fixture.control, selection: { etat: 'vide' } } }))
    const emptyProjection = projeterRequeteExportFigures(requestFor(empty))[0]!
    if (emptyProjection.family !== 'mobilite-bars') throw new Error('bars expected')
    expect(emptyProjection.tables[0]?.notes).toEqual(['Publication indisponible : Ressource test'])
    expect(emptyProjection.unavailable.map((item) => item.kind)).toEqual(['resource'])
    expect(emptyProjection.tables[0]?.columns.map((column) => column.key)).toEqual(['focal'])
    expect(emptyProjection.accessibleLabel).not.toContain('Comparaison indisponible')
  })

  it('keeps the paired ratio reference independent from the hidden bars layer', () => {
    const fixture = cahierExportFixture()
    const section = cloneSection(fixture, 'stationnement-ravitaillement', (entry) => {
      // A drawn ratio, whose reference is served by the comparison owner.
      entry.evidence.columns[0].ratio.value.fact.value = 1.2
      entry.evidence.columns[0].ratio.value.fact.comparison = {
        direction: 'plus-est-mieux',
        scope: { kind: 'communes-epci', label: 'communes de EPCI X' },
        reference: { kind: 'median', value: 0.3 },
        rank: { position: 2, size: 3 },
      }
    })
    const capture = captureCahierSection(inputFor(fixture, section, [
      layer('stationnement', { displayed: false, toggle: false }, 'mobilite-comparison-bars'),
      layer('ravitaillement', { displayed: false, toggle: false }, 'mobilite-comparison-bars'),
      {
        slot: 'ratios',
        state: {
          owner: 'mobilite-section',
          state: {
            comparisonStatus: 'ready', comparisonError: null, comparisonNone: false,
            ratioReferenceAvailable: true, ratioReferenceDisplayed: true,
          },
        },
      },
    ]))
    const projection = projeterRequeteExportFigures(requestFor(capture))[0]!
    if (projection.family !== 'mobilite-bars') throw new Error('bars expected')
    expect(projection.ratio).toMatchObject({
      label: 'places de stationnement vélo pour 1 place voiture',
      comparisonDisplayed: true,
      comparisonValue: 0.3,
      comparisonRankDisplay: '2e/3',
    })
    expect(projection.ratio?.ariaLabel).toContain('Référence')
    const ratioRow = projection.tables[0]?.rows.find((row) => row.key.endsWith(':ratio'))
    expect(ratioRow?.cells[1]).toMatchObject({ value: 0.3, display: '0,3' })
    expect(projection.tables[0]?.columns.map((column) => column.key)).toEqual(['focal', 'comparison'])

    const hiddenRatioCapture = captureCahierSection(inputFor(fixture, section, [
      layer('stationnement', { displayed: false, toggle: false }, 'mobilite-comparison-bars'),
      layer('ravitaillement', { displayed: false, toggle: false }, 'mobilite-comparison-bars'),
      mobileSectionState({
        comparisonNone: true,
        ratioReferenceAvailable: true,
        ratioReferenceDisplayed: false,
      }),
    ]))
    const hiddenRatio = projeterRequeteExportFigures(requestFor(hiddenRatioCapture))[0]!
    if (hiddenRatio.family !== 'mobilite-bars' || !hiddenRatio.ratio) throw new Error('ratio expected')
    expect(hiddenRatio.ratio.comparisonDisplayed).toBe(false)
    expect(hiddenRatio.ratio.ariaLabel).not.toContain('Référence')
  })

  it('projects the two-line coverage figure and suppresses an empty comparison', () => {
    const fixture = cahierExportFixture()
    const section = cloneSection(fixture, 'couverture-du-territoire', (entry) => {
      const share = entry.evidence as MobiliteShareEvidence
      share.value.fact.value = 0.9957355031616097
      share.value.fact.availability = 'complete'
      share.value.fact.comparison = {
        direction: 'plus-est-mieux',
        scope: { kind: 'communes-densite', label: 'communes de la classe de densité' },
        reference: { kind: 'median', value: 0.5 },
        rank: { position: 1, size: 1 },
      }
    })
    const capture = captureCahierSection(inputFor(fixture, section, [
      layer('share', {}, 'mobilite-share-track'),
    ]))
    const projection = projeterRequeteExportFigures(requestFor(capture))[0]!
    if (projection.family !== 'mobilite-share') throw new Error('share expected')
    expect(projection.display).toBe('99,6 %')
    expect(projection.precise).toBe('99,5736 %')
    expect(projection.comparisonValue).toBe(0.5)
    expect(projection.comparisonDisplay).toBe('50,0 %')
    expect(projection.comparisonRank).toBeNull()
    expect(projection.comparisonRankDisplay).toBeNull()
    expect(projection.tables[0]?.rows).toHaveLength(1)
    expect(projection.tables[0]?.rows[0]?.cells).toHaveLength(2)
    expect(projection.comparisonLabel).toBeTruthy()
    expect(projection.territoryAria).toContain(`${projection.territoryName} : 99,5736 %`)
    expect(projection.comparisonAria).toContain('Groupe comparé : 50 %')
    expect(projection.stateMessage).toBeNull()
    expect(projection.notes).toEqual([])

    const empty = captureCahierSection(inputFor(fixture, section, [
      layer('share', {}, 'mobilite-share-track'),
      mobileSectionState({ comparisonNone: true }),
    ], { control: { ...fixture.control, selection: { etat: 'vide' } } }))
    expect(empty.comparison.absent).toBe('empty-selection')
    const emptyProjection = projeterRequeteExportFigures(requestFor(empty))[0]!
    if (emptyProjection.family !== 'mobilite-share') throw new Error('share expected')
    expect(emptyProjection.comparisonDisplayed).toBe(false)
    expect(emptyProjection.comparisonLabel).toBeNull()
    expect(emptyProjection.comparisonAria).toBeNull()
    expect(emptyProjection.tables[0]?.rows[0]?.cells).toHaveLength(1)
    expect(emptyProjection.accessibleLabel).not.toContain('Groupe comparé')

    const unavailableSection = cloneSection(fixture, 'couverture-du-territoire', (entry) => {
      entry.evidence.unavailableResources = ['Ressource de test']
      entry.evidence.unavailableComparisons = ['Comparaison de test']
    })
    const unavailableCapture = captureCahierSection(inputFor(fixture, unavailableSection, [
      layer('share', { displayed: false, toggle: false }, 'mobilite-share-track'),
    ]))
    const unavailableProjection = projeterRequeteExportFigures(requestFor(unavailableCapture))[0]!
    if (unavailableProjection.family !== 'mobilite-share') throw new Error('share expected')
    expect(unavailableProjection.notes).toEqual([
      'Publication indisponible : Ressource de test',
      'Comparaison indisponible : Comparaison de test',
    ])
    expect(unavailableProjection.unavailable.map((item) => item.kind)).toEqual(['resource', 'comparison'])

    const ineligible = captureCahierSection(inputFor(fixture, section, [
      layer('share', {}, 'mobilite-share-track'),
      mobileSectionState({ comparisonNone: true }),
    ], { comparisonEligible: false, control: null }))
    expect(ineligible.comparison.absent).toBe('not-eligible')
    const ineligibleProjection = projeterRequeteExportFigures(requestFor(ineligible))[0]!
    if (ineligibleProjection.family !== 'mobilite-share') throw new Error('share expected')
    expect(ineligibleProjection.comparisonDisplayed).toBe(false)
    expect(ineligibleProjection.comparisonLabel).toBeNull()
    expect(ineligibleProjection.tables[0]?.rows[0]?.cells).toHaveLength(1)
  })

  it('projects the declared raccordement grid, marker and served marker rank', () => {
    const fixture = cahierExportFixture()
    const point = (
      detail: string,
      axisValue: number,
      value: number | null,
      label = detail,
      detailLabel: string | null = label,
    ): { label: string; fact: NumericFact } => ({
      label,
      fact: {
        key: 'raccordement_courbe', detail, axisValue, value, unit: '%',
        availability: 'complete', provenance: null, comparison: null,
        ...(detailLabel === null ? {} : { detailLabel }),
        comparisonBasis: 'territory-median', reason: null,
      },
    })
    const evidence: MobiliteRaccordementEvidence = {
      kind: 'mobilite-raccordement',
      figureTitle: 'Part de la population bretonne joignable',
      xAxisTitle: 'Temps de trajet',
      territoryName: 'Rennes',
      level: 'commune',
      comparisonLabel: 'Moyenne des communes bretonnes',
      prose: [], sources: [],
      points: [
        point('t0000', 0, 0, '0'),
        point('t0015', 15, null, '15'),
        point('t0090', 90, 0.9, '1 h 30'),
      ],
      comparison: {
        statistic: 'mean',
        scope: { kind: 'communes-bretagne', label: 'communes bretonnes' },
        selectedMemberCount: 3,
        eligibleCount: 2,
        modelZeroReasonCounts: {},
        points: [
          point('t0000', 0, 0.1, '0'),
          point('t0015', 15, 0.3, '15'),
          point('t0090', 90, 0.8, '1 h 30'),
        ],
      },
      trajectory: {
        endpoints: ['t0000', 't0090'],
        ticks: [
          { detail: 't0000', label: '0' },
          { detail: 't0090', label: '90 min' },
          { detail: 't0015', label: '15' },
        ],
        marker: { detail: 't0090', label: '90 minutes' },
      },
      axis: {
        values: [
          { detail: 't0015', numericValue: 15 },
          { detail: 't0000', numericValue: 0 },
          { detail: 't0090', numericValue: 90 },
        ],
        minimum: 0,
        maximum: 90,
      },
      markerValue: {
        label: '90 minutes',
        fact: {
          key: 'raccordement_courbe', detail: 't0090', axisValue: 90, value: 0.9, unit: '%',
          availability: 'complete', provenance: null,
          comparison: {
            direction: 'plus-est-mieux',
            scope: { kind: 'communes-bretagne', label: 'communes bretonnes' },
            reference: { kind: 'mean', value: 0.8 },
            rank: { position: 2, size: 5 },
          },
          comparisonBasis: 'territory-mean', reason: null,
        },
      },
    }
    const section = cloneSection(fixture, 'visiter-la-bretagne', (entry) => {
      entry.evidence = evidence
    })
    const capture = captureCahierSection(inputFor(fixture, section, [
      layer('curve', {}, 'mobilite-raccordement-curve'),
    ]))
    const projection = projeterRequeteExportFigures(requestFor(capture))[0]!
    if (projection.family !== 'mobilite-curve') throw new Error('curve expected')
    expect(projection.points.map((reading) => [reading.detail, reading.label, reading.display, reading.comparisonDisplay]))
      .toEqual([
        ['t0000', '0', '0', '10'],
        ['t0015', '15', 'Indisponible', '30'],
        ['t0090', '90 min', '90', '80'],
      ])
    expect(projection.tables[0]?.rows.map((row) => row.label))
      .toEqual(['0', '15', '90 min'])
    expect(projection.marker).toMatchObject({
      detail: 't0090',
      label: '90 minutes',
      axisValue: 90,
      value: 0.9,
      display: '90',
      rank: { position: 2, size: 5 },
      rankDisplay: '2e/5',
    })
    expect(projection.marker?.rankAria).toContain('2e/5')
    expect(projection.marker?.rankAria).toContain('communes bretonnes')
    expect(projection.marker?.rankAria).toContain('plus = mieux')
    expect(projection.tables[0]?.columns.map((column) => column.kind)).toEqual(['focal', 'comparison'])
    expect(projection.tables[0]?.rows.map((row) => row.key)).toEqual(['t0000', 't0015', 't0090'])

    const hidden = captureCahierSection(inputFor(fixture, section, [
      layer('curve', { displayed: false, toggle: false }, 'mobilite-raccordement-curve'),
    ]))
    const hiddenProjection = projeterRequeteExportFigures(requestFor(hidden))[0]!
    if (hiddenProjection.family !== 'mobilite-curve') throw new Error('curve expected')
    expect(hiddenProjection.points.every((reading) => reading.comparisonDisplay === null)).toBe(true)
    expect(hiddenProjection.marker?.rank).toBeNull()
    expect(hiddenProjection.comparisonLabel).toBeNull()
    expect(hiddenProjection.tables[0]?.columns.map((column) => column.kind)).toEqual(['focal'])

    // Declared metadata ticks are optional when the producer numeric axis is
    // present: the source-contract axis owns rows/order rather than a fallback
    // list or an array index.
    const withoutTicks = cloneSection(fixture, 'visiter-la-bretagne', (entry) => {
      entry.evidence = { ...evidence, trajectory: null }
    })
    const withoutTicksCapture = captureCahierSection(inputFor(fixture, withoutTicks, [
      layer('curve', {}, 'mobilite-raccordement-curve'),
    ]))
    const withoutTicksProjection = projeterRequeteExportFigures(requestFor(withoutTicksCapture))[0]!
    if (withoutTicksProjection.family !== 'mobilite-curve') throw new Error('curve expected')
    expect(withoutTicksProjection.points.map((reading) => [reading.detail, reading.axisValue]))
      .toEqual([['t0000', 0], ['t0015', 15], ['t0090', 90]])
    expect(withoutTicksProjection.points.map((reading) => reading.label))
      .toEqual(['0', '15', '1 h 30'])
    expect(withoutTicksProjection.tables[0]?.rows).toHaveLength(3)

    // Two declared tick labels do not truncate the three native points; a
    // marker detail outside the ticks still resolves through its source axis.
    const sparseTicksEvidence: MobiliteRaccordementEvidence = {
      ...evidence,
      trajectory: {
        ...evidence.trajectory!,
        ticks: [
          { detail: 't0000', label: '0' },
          { detail: 't0090', label: '90 min' },
        ],
        marker: { detail: 't0015', label: '15 minutes' },
      },
      markerValue: {
        ...evidence.markerValue!,
        fact: { ...evidence.markerValue!.fact, detail: 't0015', axisValue: 15, value: 0.3 },
      },
    }
    const sparseTicksSection = cloneSection(fixture, 'visiter-la-bretagne', (entry) => {
      entry.evidence = sparseTicksEvidence
    })
    const sparseTicksProjection = projeterRequeteExportFigures(requestFor(
      captureCahierSection(inputFor(fixture, sparseTicksSection, [
        layer('curve', {}, 'mobilite-raccordement-curve'),
      ])),
    ))[0]!
    if (sparseTicksProjection.family !== 'mobilite-curve') throw new Error('curve expected')
    expect(sparseTicksProjection.points.map((reading) => [reading.detail, reading.label]))
      .toEqual([
        ['t0000', '0'],
        ['t0015', '15'],
        ['t0090', '90 min'],
      ])
    expect(sparseTicksProjection.tables[0]?.rows).toHaveLength(3)
    expect(sparseTicksProjection.marker).toMatchObject({
      detail: 't0015',
      axisValue: 15,
      value: 0.3,
      display: '30',
    })

    // A marker declared by metadata and the native axis but absent from the
    // point rows still exports the same coordinate the mounted curve draws.
    const axisOnlyEvidence: MobiliteRaccordementEvidence = {
      ...evidence,
      points: [
        point('t0000', 0, 0, '0'),
        point('t0090', 90, 0.9, '1 h 30'),
      ],
      comparison: evidence.comparison
        ? {
          ...evidence.comparison,
          points: [point('t0000', 0, 0.1, '0'), point('t0090', 90, 0.8, '1 h 30')],
        }
        : null,
      trajectory: {
        ...evidence.trajectory!,
        ticks: [
          { detail: 't0000', label: '0' },
          { detail: 't0090', label: '90 min' },
        ],
        marker: { detail: 't0045', label: '45 minutes' },
      },
      axis: {
        values: [
          { detail: 't0000', numericValue: 0 },
          { detail: 't0045', numericValue: 45 },
          { detail: 't0090', numericValue: 90 },
        ],
        minimum: 0,
        maximum: 90,
      },
      markerValue: null,
    }
    const axisOnlyProjection = projeterRequeteExportFigures(requestFor(
      captureCahierSection(inputFor(fixture, cloneSection(fixture, 'visiter-la-bretagne', (entry) => {
        entry.evidence = axisOnlyEvidence
      }), [
        layer('curve', {}, 'mobilite-raccordement-curve'),
      ])),
    ))[0]!
    if (axisOnlyProjection.family !== 'mobilite-curve') throw new Error('curve expected')
    expect(axisOnlyProjection.points.map((reading) => reading.detail))
      .toEqual(['t0000', 't0090'])
    expect(axisOnlyProjection.marker).toMatchObject({
      detail: 't0045',
      axisValue: 45,
      value: null,
      display: 'Indisponible',
      rank: null,
      rankDisplay: null,
      rankAria: null,
    })

    // A point with no human source label must never expose the raw detail key.
    const rawLabelEvidence: MobiliteRaccordementEvidence = {
      ...evidence,
      points: [point('t0000', 0, 0, '0'), point('t0045', 45, 0.4, 't0045', null)],
      comparison: null,
      trajectory: {
        ...evidence.trajectory!,
        ticks: [
          { detail: 't0000', label: '0' },
          { detail: 't0090', label: '90 min' },
        ],
      },
      axis: {
        values: [
          { detail: 't0000', numericValue: 0 },
          { detail: 't0045', numericValue: 45 },
          { detail: 't0090', numericValue: 90 },
        ],
        minimum: 0,
        maximum: 90,
      },
      markerValue: null,
    }
    const rawLabelProjection = projeterRequeteExportFigures(requestFor(
      captureCahierSection(inputFor(fixture, cloneSection(fixture, 'visiter-la-bretagne', (entry) => {
        entry.evidence = rawLabelEvidence
      }), [
        layer('curve', {}, 'mobilite-raccordement-curve'),
      ])),
    ))[0]!
    if (rawLabelProjection.family !== 'mobilite-curve') throw new Error('curve expected')
    expect(rawLabelProjection.points.find((reading) => reading.detail === 't0045')?.label)
      .toBe('Libellé indisponible')
    expect(rawLabelProjection.points.find((reading) => reading.detail === 't0045')?.aria)
      .toBe('40 %')
    expect(rawLabelProjection.accessibleLabel).not.toContain('t0045')
    expect(rawLabelProjection.accessibleLabel).toContain('Libellé indisponible : 40 %')
    expect(rawLabelProjection.accessibleLabel).not.toContain('Indisponible : 40 %')
    expect(rawLabelProjection.tables[0]?.rows.map((row) => row.label))
      .toContain('Libellé indisponible')
    expect(rawLabelProjection.tables[0]?.rows.map((row) => row.label))
      .not.toContain('t0045')
  })
})

describe('Cahier export adapters — owner comparison absence and ratio proof (#1022)', () => {
  it('consumes the mobilite owner comparisonNone instead of inferring it from capture absence', () => {
    const fixture = cahierExportFixture()
    const section = cloneSection(fixture, 'reseaux', (entry) => {
      entry.evidence.figure.unavailableResources = ['Ressource test']
      entry.evidence.figure.unavailableComparisons = ['Comparaison test']
    })
    const barsLayer = layer('bars', {}, 'mobilite-comparison-bars')
    const cases = [
      {
        name: 'no control',
        options: { control: null },
        none: true,
        absent: 'no-selection-control',
      },
      {
        name: 'explicit empty',
        options: { control: { ...fixture.control, selection: { etat: 'vide' } } },
        none: true,
        absent: 'empty-selection',
      },
      {
        name: 'ineligible territory',
        options: { control: null, comparisonEligible: false },
        none: true,
        absent: 'not-eligible',
      },
      {
        name: 'normal selection',
        options: {},
        none: false,
        absent: null,
      },
    ] as const

    for (const entry of cases) {
      const capture = captureCahierSection(inputFor(
        fixture,
        section,
        [barsLayer, mobileSectionState({ comparisonNone: entry.none })],
        entry.options as Partial<CahierSectionCaptureInput>,
      ))
      expect(capture.comparison.absent, entry.name).toBe(entry.absent)
      expect(capture.comparison.none, entry.name).toBe(entry.none)
      const projection = projeterRequeteExportFigures(requestFor(capture))[0]!
      if (projection.family !== 'mobilite-bars') throw new Error('bars expected')
      expect(projection.comparisonDisplayed, entry.name).toBe(!entry.none)
      expect(projection.comparisonLabel === null, entry.name).toBe(entry.none)
      if (!entry.none) expect(projection.comparisonLabel, entry.name).toBeTruthy()
      expect(projection.tables[0]?.notes, entry.name)
        .toContain('Publication indisponible : Ressource test')
      expect(
        projection.tables[0]?.notes.includes('Comparaison indisponible : Comparaison test'),
        entry.name,
      ).toBe(!entry.none)
      expect(projection.unavailable.map((item) => item.kind), entry.name)
        .toEqual(entry.none ? ['resource'] : ['resource', 'comparison'])
      expect(
        projection.accessibleLabel.includes('Comparaison indisponible : Comparaison test'),
        entry.name,
      ).toBe(!entry.none)
    }
  })

  it('keeps an observed unavailable ratio reference distinct from an intentionally hidden comparison', () => {
    const fixture = cahierExportFixture()
    const section = cloneSection(fixture, 'stationnement-ravitaillement', (entry) => {
      entry.evidence.columns[0].ratio.value.fact.value = 1.2
      entry.evidence.columns[0].ratio.value.fact.comparison = null
    })
    const barsHidden = [
      layer('stationnement', { displayed: false, toggle: false }, 'mobilite-comparison-bars'),
      layer('ravitaillement', { displayed: false, toggle: false }, 'mobilite-comparison-bars'),
    ]

    // The group is selected but the owner serves no reference: the scalar
    // visibly says "Groupe comparé : Indisponible", so the export must keep
    // that observed absence instead of treating it as hidden proof.
    const observedCapture = captureCahierSection(inputFor(fixture, section, [
      ...barsHidden,
      mobileSectionState({ comparisonNone: false }),
    ]))
    const observed = projeterRequeteExportFigures(requestFor(observedCapture))[0]!
    if (observed.family !== 'mobilite-bars' || !observed.ratio) throw new Error('ratio expected')
    expect(observed.ratio).toMatchObject({
      comparisonDisplayed: true,
      comparisonValue: null,
      comparisonDisplay: null,
    })
    expect(observed.ratio.ariaLabel).toContain('Comparaison indisponible')
    expect(observed.ratio.ariaLabel).not.toContain('Référence')
    expect(observed.tables[0]?.columns.map((column) => column.key))
      .toEqual(['focal', 'comparison'])
    const observedRatioRow = observed.tables[0]?.rows.find((row) => row.key.endsWith(':ratio'))
    expect(observedRatioRow?.cells[1]).toMatchObject({
      columnKey: 'comparison',
      value: null,
      display: 'Indisponible',
    })

    const hiddenCapture = captureCahierSection(inputFor(fixture, section, [
      ...barsHidden,
      mobileSectionState({
        comparisonNone: true,
        ratioReferenceAvailable: true,
        ratioReferenceDisplayed: false,
      }),
    ]))
    const hidden = projeterRequeteExportFigures(requestFor(hiddenCapture))[0]!
    if (hidden.family !== 'mobilite-bars' || !hidden.ratio) throw new Error('ratio expected')
    expect(hidden.ratio.comparisonDisplayed).toBe(false)
    expect(hidden.ratio.ariaLabel).not.toContain('Référence')
    expect(hidden.ratio.ariaLabel).not.toContain('Comparaison indisponible')
    expect(hidden.tables[0]?.columns.map((column) => column.key)).toEqual(['focal'])
  })

  it('suppresses irrelevant curve comparison diagnostics from the same owner state', () => {
    const fixture = cahierExportFixture()
    const section = cloneSection(fixture, 'visiter-la-bretagne', (entry) => {
      entry.evidence.unavailableResources = ['Ressource test']
      entry.evidence.unavailableComparisons = ['Comparaison test']
    })
    const curveLayer = layer('curve', {}, 'mobilite-raccordement-curve')

    for (const entry of [
      {
        name: 'explicit empty',
        options: { control: { ...fixture.control, selection: { etat: 'vide' } } },
        none: true,
      },
      {
        name: 'no control',
        options: { control: null },
        none: true,
      },
    ] as const) {
      const capture = captureCahierSection(inputFor(
        fixture,
        section,
        [curveLayer, mobileSectionState({ comparisonNone: entry.none })],
        entry.options as Partial<CahierSectionCaptureInput>,
      ))
      const projection = projeterRequeteExportFigures(requestFor(capture))[0]!
      if (projection.family !== 'mobilite-curve') throw new Error('curve expected')
      expect(projection.unavailable.map((item) => item.kind), entry.name).toEqual(['resource'])
      expect(projection.tables[0]?.notes, entry.name)
        .toEqual(['Publication indisponible : Ressource test'])
      expect(projection.accessibleLabel, entry.name)
        .toContain('Publication indisponible : Ressource test')
      expect(projection.accessibleLabel, entry.name)
        .not.toContain('Comparaison indisponible : Comparaison test')
    }

    const normalCapture = captureCahierSection(inputFor(fixture, section, [
      curveLayer,
      mobileSectionState({ comparisonNone: false }),
    ]))
    const normal = projeterRequeteExportFigures(requestFor(normalCapture))[0]!
    if (normal.family !== 'mobilite-curve') throw new Error('curve expected')
    expect(normal.unavailable.map((item) => item.kind)).toEqual(['resource', 'comparison'])
    expect(normal.tables[0]?.notes).toEqual([
      'Publication indisponible : Ressource test',
      'Comparaison indisponible : Comparaison test',
    ])
    expect(normal.accessibleLabel).toContain('Comparaison indisponible : Comparaison test')
  })
})

describe('Cahier export adapters — owner comparison read state (#1022)', () => {
  it('keeps the bars owner loading/error/unavailable state in the projection and table notes', () => {
    const fixture = cahierExportFixture()
    const section = cloneSection(fixture, 'reseaux', (entry) => {
      entry.evidence.figure.unavailableResources = ['Ressource test']
      entry.evidence.figure.unavailableComparisons = []
      for (const category of entry.evidence.figure.categories) {
        category.splitNote = null
        delete category.comparisonSplitNote
        delete category.comparisonSplit
      }
    })
    const cases = [
      {
        status: 'loading',
        error: null,
        stateText: 'Chargement du groupe comparé…',
      },
      {
        status: 'error',
        error: 'Lecture échouée',
        stateText: 'Groupe comparé indisponible : Lecture échouée',
      },
      {
        status: 'unavailable',
        error: null,
        stateText: 'Groupe comparé indisponible pour cette sélection.',
      },
    ] as const

    for (const entry of cases) {
      const capture = captureCahierSection(inputFor(fixture, section, [
        layer('bars', { displayed: false, toggle: true }, 'mobilite-comparison-bars'),
        mobileSectionState({
          comparisonNone: false,
          comparisonStatus: entry.status,
          comparisonError: entry.error,
        }),
      ]))
      expect(capture.comparison.status, entry.status).toBe(entry.status)
      expect(capture.comparison.error, entry.status).toBe(entry.error)
      const projection = projeterRequeteExportFigures(requestFor(capture))[0]!
      if (projection.family !== 'mobilite-bars') throw new Error('bars expected')
      expect(projection.comparisonStatus, entry.status).toBe(entry.status)
      expect(projection.comparisonStateText, entry.status).toBe(entry.stateText)
      expect(projection.tables[0]?.notes, entry.status).toEqual([
        'Publication indisponible : Ressource test',
        entry.stateText,
      ])
      expect(projection.comparisonDisplayed, entry.status).toBe(false)
    }

    const hiddenCapture = captureCahierSection(inputFor(fixture, section, [
      layer('bars', { displayed: false, toggle: true }, 'mobilite-comparison-bars'),
      mobileSectionState({
        comparisonNone: true,
        comparisonStatus: 'error',
        comparisonError: 'Lecture échouée',
      }),
    ], { control: null }))
    const hidden = projeterRequeteExportFigures(requestFor(hiddenCapture))[0]!
    if (hidden.family !== 'mobilite-bars') throw new Error('bars expected')
    expect(hidden.comparisonStatus).toBe('error')
    expect(hidden.comparisonStateText).toBeNull()
    expect(hidden.tables[0]?.notes).toEqual(['Publication indisponible : Ressource test'])
  })

  it('keeps the curve owner loading/error/unavailable state in the projection and table notes', () => {
    const fixture = cahierExportFixture()
    const section = cloneSection(fixture, 'visiter-la-bretagne', (entry) => {
      entry.evidence.unavailableResources = ['Ressource test']
      entry.evidence.unavailableComparisons = []
    })
    const cases = [
      {
        status: 'loading',
        error: null,
        stateText: 'Comparaison en cours de chargement.',
      },
      {
        status: 'error',
        error: 'Lecture échouée',
        stateText: 'Comparaison indisponible : Lecture échouée',
      },
      {
        status: 'unavailable',
        error: null,
        stateText: 'Aucun groupe comparé actif.',
      },
    ] as const

    for (const entry of cases) {
      const capture = captureCahierSection(inputFor(fixture, section, [
        layer('curve', { displayed: false, toggle: true }, 'mobilite-raccordement-curve'),
        mobileSectionState({
          comparisonNone: false,
          comparisonStatus: entry.status,
          comparisonError: entry.error,
        }),
      ]))
      const projection = projeterRequeteExportFigures(requestFor(capture))[0]!
      if (projection.family !== 'mobilite-curve') throw new Error('curve expected')
      expect(projection.comparisonStatus, entry.status).toBe(entry.status)
      expect(projection.comparisonStateText, entry.status).toBe(entry.stateText)
      expect(projection.tables[0]?.notes, entry.status).toEqual([
        'Publication indisponible : Ressource test',
        entry.stateText,
      ])
      expect(projection.accessibleLabel, entry.status).toContain(entry.stateText)
    }

    const hiddenCapture = captureCahierSection(inputFor(fixture, section, [
      layer('curve', { displayed: false, toggle: true }, 'mobilite-raccordement-curve'),
      mobileSectionState({
        comparisonNone: true,
        comparisonStatus: 'error',
        comparisonError: 'Lecture échouée',
      }),
    ], { control: null }))
    const hidden = projeterRequeteExportFigures(requestFor(hiddenCapture))[0]!
    if (hidden.family !== 'mobilite-curve') throw new Error('curve expected')
    expect(hidden.comparisonStatus).toBe('error')
    expect(hidden.comparisonStateText).toBeNull()
    expect(hidden.tables[0]?.notes).toEqual(['Publication indisponible : Ressource test'])
  })
})
