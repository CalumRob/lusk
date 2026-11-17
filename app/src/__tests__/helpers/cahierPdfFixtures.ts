/**
 * Fixtures for the shared PDF controls (#1023).
 *
 * Captures are built through the public #1021 seam (`captureCahierSection`)
 * from the real nine-section Cahier fixture. The publications below describe
 * owner-observed states only: a fully loaded map plate, a displayed comparison
 * layer, an acquired explorer equipment. They are test observations, never a
 * production default.
 */
import type {
  CahierAedarCaptureState,
  CahierCaptureReadiness,
  CahierExportCapture,
  CahierExportPublication,
  CahierMapAvailabilityCaptureState,
} from '@/fiche/prototype/cahierExportCapture'
import { captureCahierSection } from '@/fiche/prototype/cahierExportCapture'
import type { AedarEquipmentHorizon } from '@/fiche/content/aedarEquipmentBuckets'
import { AEDAR_EQUIPMENT_BUCKET_HORIZONS } from '@/fiche/content/aedarEquipmentBuckets'
import type { AedarRampMode } from '@/fiche/content/themeContent'
import type { ContentEvidence } from '@/fiche/content/themeContent'
import type { ControleComparaison } from '@/fiche/comparisonContext'
import { cahierExportFixture, sectionOf } from './cahierExportFixtures'
import type { CahierExportFixture } from './cahierExportFixtures'

export type PdfFixtureSectionKey =
  | 'aedar-car-overview'
  | 'aedar-diversity-loss'
  | 'aedar-access'
  | 'aedar-equipment-profile'
  | 'aedar-equipment-explorer'
  | 'reseaux'
  | 'stationnement-ravitaillement'
  | 'couverture-du-territoire'
  | 'visiter-la-bretagne'

export const PDF_FIXTURE_SECTION_KEYS: readonly PdfFixtureSectionKey[] = [
  'aedar-car-overview',
  'aedar-diversity-loss',
  'aedar-access',
  'aedar-equipment-profile',
  'aedar-equipment-explorer',
  'reseaux',
  'stationnement-ravitaillement',
  'couverture-du-territoire',
  'visiter-la-bretagne',
]

export const READY_READINESS: CahierCaptureReadiness = {
  status: 'ready',
  reason: 'evidence-ready',
  availability: 'complete',
}

export const READY_AEDAR: CahierAedarCaptureState = {
  modes: ['car', 'transit', 'bike_lts2'],
  horizonMinutes: 15,
  comparisonVisible: true,
  comparisonEligible: true,
  chapterActive: true,
}

export type LayerOwner =
  | 'aedar-comparison-layer'
  | 'mobilite-comparison-bars'
  | 'mobilite-raccordement-curve'
  | 'mobilite-share-track'

export function displayedLayer(
  owner: LayerOwner,
  slot = 'comparison',
  options: {
    toggle?: boolean | null
    referenceAvailable?: boolean
    visibleReferenceAvailable?: boolean
    displayed?: boolean
  } = {},
): CahierExportPublication {
  return {
    slot,
    state: {
      owner,
      state: {
        toggle: options.toggle ?? true,
        referenceAvailable: options.referenceAvailable ?? true,
        visibleReferenceAvailable: options.visibleReferenceAvailable ?? true,
        displayed: options.displayed ?? true,
      },
    },
  }
}

export function mapAvailability(
  maps: CahierMapAvailabilityCaptureState['maps'],
  legend: CahierMapAvailabilityCaptureState['legend'],
): CahierExportPublication {
  return { slot: 'maps', state: { owner: 'map-availability', state: { maps, legend } } }
}

export function loadedMaps(ids: readonly string[]): CahierMapAvailabilityCaptureState['maps'] {
  return ids.map((id) => ({
    id,
    label: id,
    declared: true,
    loaded: true,
    unavailable: false,
    inlineUrl: `https://example.test/${id}-inline.webp`,
  }))
}

function readyMobiliteSection(slot = ''): CahierExportPublication {
  return {
    slot,
    state: {
      owner: 'mobilite-section',
      state: {
        comparisonStatus: 'ready',
        comparisonError: null,
        comparisonNone: false,
        ratioReferenceAvailable: false,
        ratioReferenceDisplayed: false,
      },
    },
  }
}

function readyExplorerEquipment(): CahierExportPublication {
  return {
    slot: 'equipment',
    state: {
      owner: 'aedar-equipment-explorer',
      state: {
        typequ: 'B207',
        typequLabel: 'Équipement test',
        selectedDetail: null,
        detailStatus: 'ready',
        comparisonStatus: 'ready',
        comparisonError: null,
        comparison: null,
        referenceDetail: null,
      },
    },
  }
}

/** Owner observations that make each section exportable when nothing is pending. */
export function readyPublications(key: PdfFixtureSectionKey): CahierExportPublication[] {
  switch (key) {
    case 'aedar-car-overview':
      return [
        mapAvailability(loadedMaps(['car']), 'available'),
        displayedLayer('aedar-comparison-layer'),
      ]
    case 'aedar-diversity-loss':
      return [mapAvailability(loadedMaps(['walk', 'transit', 'bike_lts2', 'bike_lts4']), 'available')]
    case 'aedar-access':
      return [displayedLayer('aedar-comparison-layer')]
    case 'aedar-equipment-profile':
      return []
    case 'aedar-equipment-explorer':
      return [readyExplorerEquipment(), displayedLayer('aedar-comparison-layer')]
    case 'reseaux':
      return [
        mapAvailability(loadedMaps(['walkTransit', 'bike', 'car']), 'none'),
        displayedLayer('mobilite-comparison-bars', 'bars'),
      ]
    case 'stationnement-ravitaillement':
      return [
        displayedLayer('mobilite-comparison-bars', 'stationnement'),
        displayedLayer('mobilite-comparison-bars', 'ravitaillement'),
        readyMobiliteSection(),
      ]
    case 'couverture-du-territoire':
      return [displayedLayer('mobilite-share-track', 'share'), readyMobiliteSection()]
    case 'visiter-la-bretagne':
      return [displayedLayer('mobilite-raccordement-curve', 'curve'), readyMobiliteSection()]
  }
}

export interface PdfCaptureOptions {
  readonly selection?: CahierExportFixture['control']['selection']
  readonly control?: ControleComparaison | null
  readonly readiness?: CahierCaptureReadiness
  readonly comparisonEligible?: boolean
  readonly comparisonStatus?: 'idle' | 'loading' | 'ready' | 'error' | 'unavailable'
  readonly comparisonError?: string | null
  readonly referenceStatus?:
    | 'unobserved'
    | 'idle'
    | 'loading'
    | 'ready'
    | 'error'
    | 'unavailable'
    | null
  readonly aedar?: CahierAedarCaptureState
  readonly publications?: readonly CahierExportPublication[]
  readonly evidencePatch?: Readonly<Record<string, unknown>>
}

function unitFor(fixture: CahierExportFixture, key: string) {
  const unit = fixture.content.units.find((candidate) =>
    candidate.sections.some((section) => section.key === key))
  if (!unit) throw new Error(`No unit for ${key}`)
  return { key: unit.key, label: unit.label }
}

/**
 * Capture the real fixture section with the given observed owner state.
 * Defaults describe a settled screen; a test mutates only the state it names.
 */
export function capturePdfFixture(
  key: PdfFixtureSectionKey,
  options: PdfCaptureOptions = {},
): CahierExportCapture {
  const fixture = cahierExportFixture({ selection: options.selection })
  const section = sectionOf(fixture.content, key)
  const evidence = section.evidence && options.evidencePatch
    ? { ...section.evidence, ...options.evidencePatch } as ContentEvidence
    : section.evidence
  const targetSection = evidence === section.evidence
    ? section
    : { ...section, evidence } as unknown as typeof section
  const capture = captureCahierSection({
    section: targetSection,
    unit: unitFor(fixture, key),
    territory: fixture.content.territory,
    readiness: options.readiness ?? READY_READINESS,
    referenceStatus: options.referenceStatus ?? 'ready',
    comparisonEligible: options.comparisonEligible ?? true,
    comparisonStatus: options.comparisonStatus ?? 'ready',
    comparisonError: options.comparisonError ?? null,
    control: options.control === null ? null : (options.control ?? fixture.control),
    aedar: options.aedar ?? READY_AEDAR,
    publications: options.publications ?? readyPublications(key),
  })
  return capture
}

export function withAedarModes(
  modes: readonly AedarRampMode[],
  overrides: Partial<CahierAedarCaptureState> = {},
): CahierAedarCaptureState {
  return { ...READY_AEDAR, modes: [...modes], horizonMinutes: 15 as AedarEquipmentHorizon, ...overrides }
}

/* ------------------------------------------------------------------ *
 * Populated native scenes (test-only; no production data or API)
 * ------------------------------------------------------------------ */

export function captureCourbeDense(): CahierExportCapture {
  const capture: any = structuredClone(capturePdfFixture('visiter-la-bretagne'))
  const figure = capture.figures.find((candidate: any) => candidate.family === 'mobilite-curve')
  const base = figure.model.points[0]
  const points = Array.from({ length: 73 }, (_, index) => ({
    ...base,
    fact: { ...base.fact, detail: `t${String(index * 5).padStart(4, '0')}`, value: index / 72, unit: '%' },
  }))
  const ticks = points.map((point, index) => ({
    detail: point.fact.detail,
    label: `${index * 5} min`,
    mobile: index % 6 === 0,
  }))
  figure.model.points = points
  figure.model.trajectory = { ...figure.model.trajectory, ticks }
  figure.model.axis = {
    values: points.map((point, index) => ({ detail: point.fact.detail, numericValue: index * 5 })),
    minimum: 0,
    maximum: 360,
  }
  figure.model.markerValue = {
    fact: {
      ...points[18]!.fact,
      comparison: {
        direction: 'neutral',
        scope: { kind: 'communes-bretagne', label: 'communes bretonnes' },
        rank: { position: 1, size: 43, ties: null },
        reference: { value: 0.8, unit: '%' },
      },
    },
    label: '1 h 30',
  }
  figure.model.comparison = {
    statistic: 'mean',
    scope: { kind: 'communes-bretagne', label: 'communes bretonnes' },
    selectedMemberCount: 3,
    eligibleCount: 2,
    modelZeroReasonCounts: {},
    points: points.map((point) => ({ ...point, fact: { ...point.fact, value: point.fact.value * 0.9 } })),
  }
  return capture as CahierExportCapture
}

export function captureCourbeTrous(): CahierExportCapture {
  const capture: any = captureCourbeDense()
  const figure = capture.figures.find((candidate: any) => candidate.family === 'mobilite-curve')
  for (const index of [12, 13, 14]) {
    figure.model.points[index].fact.value = null
    figure.model.comparison.points[index].fact.value = null
  }
  return capture
}

export function capturePartDense(): CahierExportCapture {
  const capture: any = structuredClone(capturePdfFixture('couverture-du-territoire'))
  const figure = capture.figures.find((candidate: any) => candidate.family === 'mobilite-share')
  figure.model.value.fact.value = 0.9957355
  figure.model.value.fact.unit = '%'
  figure.model.value.fact.comparison = {
    direction: 'neutral',
    scope: { kind: 'communes-bretagne', label: 'communes bretonnes' },
    rank: null,
    reference: { value: 0.8, unit: '%' },
  }
  figure.model.unit = '%'
  return capture as CahierExportCapture
}

export function captureRampeDense(): CahierExportCapture {
  const capture: any = structuredClone(capturePdfFixture('aedar-access'))
  const figure = capture.figures.find((candidate: any) => candidate.family === 'aedar-ramps')
  for (const [index, ramp] of figure.model.ramps.entries()) {
    ramp.territory = {
      ...ramp.territory,
      car: index === 0 ? [0.2, 0.7, 1.1, 1.4] : [10, 20, 30, 40],
      bike_lts2: index === 0 ? [0.1, 0.5, 0.9, 1.2] : [5, 10, 20, 30],
      transit: [null, null, null, null],
      bike_lts4: [null, null, null, null],
      walk: [null, null, null, null],
    }
    ramp.reference = {
      car: index === 0 ? [0.1, 0.4, 0.8, 1.0] : [5, 10, 20, 30],
      bike_lts2: index === 0 ? [0.05, 0.3, 0.6, 0.9] : [2, 5, 10, 15],
      bike_lts4: [null, null, null, null],
      transit: [null, null, null, null],
      walk: [null, null, null, null],
    } as typeof ramp.reference
    ramp.yAxis.unit = index === 0 ? 'types' : 'établissements'
  }
  return capture as CahierExportCapture
}

export function captureBarresDense(): CahierExportCapture {
  const capture: any = structuredClone(capturePdfFixture('reseaux'))
  const figure = capture.figures.find((candidate: any) => candidate.family === 'mobilite-bars')
  const model = figure.model.figure
  model.yAxisTitle = 'Places'
  model.unit = 'places / 1 000 hab.'
  model.xAxisTitle = 'Type de stationnement'
  const category = model.categories[0]
  category.tone = 'brand'
  category.value.fact.value = 3.4
  category.value.fact.unit = 'places / 1 000 hab.'
  category.value.fact.comparison = {
    direction: 'neutral',
    scope: { kind: 'communes-bretagne', label: 'communes bretonnes' },
    rank: null,
    reference: { value: 2.2, unit: 'places / 1 000 hab.' },
  }
  const segment = (key: string, label: string, value: number, reference: number) => ({
    key,
    label,
    value: {
      fact: {
        ...category.value.fact,
        value,
        comparison: {
          direction: 'neutral',
          scope: { kind: 'communes-bretagne', label: 'communes bretonnes' },
          rank: null,
          reference: { value: reference, unit: 'places / 1 000 hab.' },
        },
      },
      label,
    },
    rawValue: null,
  })
  category.segments = [
    segment('protege_km_1000', 'Protégé', 2.0, 1.3),
    segment('partage_km_1000', 'Partagé', 1.4, 0.9),
  ]
  category.comparisonSplit = true
  return capture as CahierExportCapture
}

export function captureWaffleDense(): CahierExportCapture {
  const base = sectionOf(cahierExportFixture().content, 'aedar-equipment-profile')
  const evidence = base.evidence as unknown as { facts: readonly Record<string, unknown>[] }
  const facts = Array.from({ length: 12 }, (_, index) => ({
    ...evidence.facts[index % evidence.facts.length],
    typequ: `T${String(index + 1).padStart(3, '0')}`,
    typequ_label: `Équipement ${index + 1}`,
    measures: {
      count_15_walk_share: index % 5 === 0 ? 0.8 : 0.05,
      count_15_transit_share: index % 5 === 1 ? 0.8 : 0.05,
      count_15_bike_lts2_share: index % 5 === 2 ? 0.8 : 0.05,
      count_15_bike_lts4_share: index % 5 === 3 ? 0.8 : 0.05,
      count_15_car_share: index % 5 === 4 ? 0.8 : 0.05,
    },
  }))
  return capturePdfFixture('aedar-equipment-profile', { evidencePatch: { facts } })
}

/* ------------------------------------------------------------------ *
 * Populated comparison ranks (synthetic native contracts, truthfully
 * labelled: the fixture provides the producer-shaped cells; no value,
 * rank or eligibility is computed by the PDF)
 * ------------------------------------------------------------------ */

function servedRank(position: number | null, size = 43, ties: number | null = null) {
  return position === null ? null : { position, size, ties }
}

/** The access ramps with producer-served reference values AND ranks. */
export function captureRampeRangs(): CahierExportCapture {
  const capture: any = captureRampeDense()
  const figure = capture.figures.find((candidate: any) => candidate.family === 'aedar-ramps')
  for (const ramp of figure.model.ramps) {
    ramp.referenceRanks = {
      car: [1, 2, 1, 3].map((position, index) => servedRank(position, 43, index === 0 ? 2 : null)),
      bike_lts2: [2, 1, 1, 2].map((position) => servedRank(position, 43)),
      bike_lts4: [null, null, null, null],
      transit: [null, null, null, null],
      walk: [null, null, null, null],
    }
  }
  return capture as CahierExportCapture
}

/**
 * The equipment explorer with two value tables (volume ramp + decile
 * distribution) and producer-shaped comparison cells carrying served ranks.
 * This is the populated two-tables/continuation fixture.
 */
export function captureExplorerRangs(): CahierExportCapture {
  const capture: any = structuredClone(capturePdfFixture('aedar-equipment-explorer', {
    publications: [
      ...readyPublications('aedar-equipment-explorer'),
      displayedLayer('aedar-comparison-layer', 'distribution'),
    ],
  }))
  const figure = capture.figures.find((candidate: any) => candidate.family === 'aedar-equipment-explorer')
  const typequ = figure.effective.typequ as string
  const modes = figure.effective.modes as readonly string[]
  const statistics = figure.model.distributionStatistics as readonly { key: string }[]
  const fact = figure.model.facts.find((candidate: any) => candidate.typequ === typequ)
  if (!fact) throw new Error('Fixture PDF : fait focal introuvable pour les rangs.')
  // Native focal measures: four horizons × the selected modes (producer-shaped).
  let focalIndex = 0
  for (const mode of modes) {
    for (const horizon of AEDAR_EQUIPMENT_BUCKET_HORIZONS) {
      fact.measures[`count_${horizon}_${mode}_mean`] = 10 + horizon + (focalIndex % 3)
      focalIndex += 1
    }
  }
  const source = {
    typequ,
    source_id: 'aedar_bretagne',
    vintage_id: 'test',
    reference_date: '2026-01-01',
    publication_date: '2026-09-30',
    group_coverage_status: 'covered',
    group_n_addresses: 100,
    group_n_observed: 100,
    statistic: 'pooled' as const,
    direction: 'high' as const,
  }
  const cells: Record<string, unknown>[] = []
  let index = 0
  for (const mode of modes) {
    for (const horizon of AEDAR_EQUIPMENT_BUCKET_HORIZONS) {
      cells.push({
        ...source,
        measure: `count_${horizon}_${mode}_mean`,
        group_value: 10 + horizon,
        rank: 1 + (index % 3),
        rank_size: 43,
        rank_ties: index % 7 === 0 ? 2 : null,
      })
      for (const statistic of statistics) {
        cells.push({
          ...source,
          measure: `count_${horizon}_${mode}_${statistic.key}`,
          group_value: 5 + (index % 20),
          rank: 1 + ((index + 1) % 5),
          rank_size: 43,
          rank_ties: null,
        })
      }
      index += 1
    }
  }
  figure.effective.comparison = {
    label: capture.comparison.group?.label ?? 'communes de EPCI X',
    contentVersion: 'reference',
    referenceContentVersion: 'reference',
    cells,
  }
  // The owner-observed comparison request makes the volume ramp resolve the
  // same producer cells as the distribution table.
  figure.model.comparisonRequestLabel = capture.comparison.group?.label ?? 'communes de EPCI X'
  figure.model.referenceLabel = capture.comparison.group?.label ?? 'communes de EPCI X'
  return capture as CahierExportCapture
}

/**
 * A dense variant of the two-table explorer: 25 published distribution
 * thresholds (minimum, quantiles, maximum) with served focal values and ranks.
 * It is the measured-continuation proof for the two value tables; synthetic
 * like every fixture here, never production data.
 */
export function captureExplorerRangsDense(): CahierExportCapture {
  const capture: any = captureExplorerRangs()
  const figure = capture.figures.find((candidate: any) => candidate.family === 'aedar-equipment-explorer')
  const typequ = figure.effective.typequ as string
  const fact = figure.model.facts.find((candidate: any) => candidate.typequ === typequ)
  const source = {
    typequ,
    source_id: fact.source_id,
    vintage_id: fact.vintage_id,
    reference_date: fact.reference_date,
    publication_date: fact.publication_date,
    group_coverage_status: 'covered',
    group_n_addresses: 100,
    group_n_observed: 100,
    statistic: 'pooled' as const,
    direction: 'high' as const,
  }
  const statistics = Array.from({ length: 25 }, (_, index) => ({
    key: index === 0 ? 'min' : index === 24 ? 'max' : `decile${index}`,
    label: index === 0 ? 'Minimum' : index === 24 ? 'Maximum' : `Décile ${index}`,
    axisLabel: index === 0 ? 'Min' : index === 24 ? 'Max' : `D${index}`,
  }))
  figure.model.distributionStatistics = statistics
  const cells = figure.effective.comparison.cells as Record<string, unknown>[]
  const modes = figure.effective.modes as readonly string[]
  let index = 0
  for (const mode of modes) {
    for (const statistic of statistics) {
      const measure = `count_15_${mode}_${statistic.key}`
      fact.measures[measure] = 10 + (index % 47)
      cells.push({
        ...source,
        measure,
        group_value: 6 + (index % 21),
        rank: 1 + (index % 7),
        rank_size: 43,
        rank_ties: index % 11 === 0 ? 2 : null,
      })
      index += 1
    }
  }
  return capture as CahierExportCapture
}
