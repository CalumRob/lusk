/**
 * Fixtures for the shared PDF controls (#1023).
 *
 * Captures are built through the public #1021 seam (`captureCahierSection`)
 * from the real nine-section Cahier fixture. The publications below describe
 * owner-observed states only: a fully loaded map plate, a displayed comparison
 * layer, an acquired explorer equipment. They are test observations, never a
 * production default.
 */
import { deflateSync } from 'node:zlib'

import type {
  CahierAedarCaptureState,
  CahierCaptureReadiness,
  CahierExportCapture,
  CahierExportPublication,
  CahierMapAvailabilityCaptureState,
} from '@/fiche/prototype/cahierExportCapture'
import { captureCahierSection } from '@/fiche/prototype/cahierExportCapture'
import { comparisonLabelFor } from '@/fiche/content/mobiliteSections'
import type { AedarEquipmentHorizon } from '@/fiche/content/aedarEquipmentBuckets'
import { AEDAR_EQUIPMENT_BUCKET_HORIZONS } from '@/fiche/content/aedarEquipmentBuckets'
import { AEDAR_RAMP_MODES } from '@/fiche/content/aedarTimeRampFacts'
import {
  AEDAR_EQUIPMENT_BUCKET_ORDER,
  AEDAR_EQUIPMENT_MODES,
} from '@/fiche/content/aedarEquipmentBuckets'
import type { AedarRampMode } from '@/fiche/content/themeContent'
import type { ContentEvidence } from '@/fiche/content/themeContent'
import type { ComparisonScopeKind } from '@/fiche/content/territoryFacts'
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

/** Labelled TEST-ONLY raster bytes frozen into fixture map items. */
function fixturePng(size = 200): ArrayBuffer {
  const crcTable = new Uint32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let value = n
    for (let k = 0; k < 8; k += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
    crcTable[n] = value >>> 0
  }
  const chunk = (name: string, data: Buffer) => {
    const head = Buffer.alloc(8)
    head.writeUInt32BE(data.length, 0)
    head.write(name, 4, 'ascii')
    const body = Buffer.concat([Buffer.from(name, 'ascii'), data])
    let crcValue = 0xffffffff
    for (const byte of body) crcValue = crcTable[(crcValue ^ byte) & 0xff]! ^ (crcValue >>> 8)
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE((crcValue ^ 0xffffffff) >>> 0, 0)
    return Buffer.concat([head, data, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8; ihdr[9] = 6
  const row = Buffer.alloc(1 + size * 4)
  for (let x = 0; x < size; x += 1) {
    row[1 + x * 4] = 0x2f; row[2 + x * 4] = 0x5e; row[3 + x * 4] = 0x55; row[4 + x * 4] = 0xff
  }
  const raw = Buffer.concat(Array.from({ length: size }, () => row))
  const png = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
  return Uint8Array.from(png).buffer
}

export const PNG_FIXTURE_BYTES = fixturePng()

export function loadedMaps(ids: readonly string[]): CahierMapAvailabilityCaptureState['maps'] {
  return ids.map((id) => ({
    id,
    label: id,
    declared: true,
    loaded: true,
    unavailable: false,
    inlineUrl: `https://example.test/${id}-inline.webp`,
    bytes: PNG_FIXTURE_BYTES,
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
  const ownerUnit = fixture.content.units.find((unit) => unit.sections.some((candidate) => candidate.key === key))!
  const capture = captureCahierSection({
    nativeRender: {
      content: {
        theme: fixture.content.theme,
        label: fixture.content.label,
        territory: fixture.content.territory,
        introduction: [],
        sourceRegister: [],
        units: [{ key: ownerUnit.key, label: ownerUnit.label, introduction: [], sections: [targetSection] }],
      },
      presentation: 'plain',
      layoutVariant: 'indexed-sections',
      sectionIndex: ownerUnit.sections.findIndex((candidate) => candidate.key === key),
    },
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
  const groupe = capture.comparison.group as { scopeKind: ComparisonScopeKind | null; label: string | null } | null
  if (!groupe?.scopeKind || !groupe.label) {
    throw new Error('Fixture PDF : le groupe de comparaison natif est requis pour la courbe dense.')
  }
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
        // The curve's served cohort is the capture's own comparison group: one
        // scene, one cohort, never a second scope chosen by the fixture.
        scope: { kind: groupe.scopeKind, label: groupe.label },
        rank: { position: 1, size: 2, ties: null },
        reference: { kind: 'median', value: 0.8 },
      },
    },
    label: '1 h 30',
  }
  figure.model.comparison = {
    statistic: 'mean',
    scope: { kind: groupe.scopeKind, label: groupe.label },
    selectedMemberCount: 2,
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
    // Scope-correct served comparison for the fixture: the focal commune is
    // ranked among the EPCI communes, not among all Breton communes.
    scope: { kind: 'communes-epci', label: 'communes de EPCI X' },
    rank: { position: 1, size: 38, ties: null },
    reference: { kind: 'median', value: 0.8 },
  }
  figure.model.unit = '%'
  // The served reference above changes what the figure states: its comparison
  // sentence is derived by the section owner from these very facts, never a
  // copied string and never the pre-serving "indisponible" label.
  figure.model.comparisonLabel = comparisonLabelFor([figure.model.value], capture.identity.territory)
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

/**
 * A dense, populated "Réseaux" scene on ONE native family: the published
 * network categories (Réseau piéton / cyclable / automobile) keep the owner's
 * title, unit, axes and legend, and the cycling row carries its real
 * Protégé/Partagé partition. Only the served values are synthetic, inside the
 * capture's own declared comparison cohort: the total equals its two published
 * partitions and every compared cell is a served reference on that same scope
 * and cohort size. Nothing here is production data, and no rank or statistic is
 * recomputed by the app — the fixture provides the producer-shaped cells.
 */
export function captureBarresDense(): CahierExportCapture {
  const capture: any = structuredClone(capturePdfFixture('reseaux'))
  const figure = capture.figures.find((candidate: any) => candidate.family === 'mobilite-bars')
  const group = capture.comparison.group as { scopeKind: ComparisonScopeKind | null; label: string | null } | null
  if (!group?.scopeKind || !group.label) {
    throw new Error('Fixture PDF : le groupe de comparaison natif est requis pour les barres réseau.')
  }
  const scope = { kind: group.scopeKind, label: group.label }
  const cohorte = { position: 1, size: 2, ties: null }
  const modele = figure.model.figure
  /** The declared EPCI pair: focal 3,4 = 2,0 protégé + 1,4 partagé, peer mean 2,2. */
  const bike = modele.categories.find((category: any) => category.key === 'bike')
  if (!bike) throw new Error('Fixture PDF : la catégorie cyclable native est requise.')
  const base = bike.value.fact
  const totalReference = 2.2
  const segments = [
    { key: 'protege_km_1000', label: 'Protégé', value: 2, reference: 1.3 },
    { key: 'partage_km_1000', label: 'Partagé', value: 1.4, reference: 0.9 },
  ]
  bike.value.fact.value = segments.reduce((sum, segment) => sum + segment.value, 0)
  bike.value.fact.comparison = {
    direction: 'neutral', scope, rank: cohorte, reference: { kind: 'median', value: totalReference },
  }
  bike.segments = segments.map((segment) => ({
    key: segment.key,
    label: segment.label,
    legendLabel: `Réseau cyclable ${segment.label.toLocaleLowerCase('fr-FR')}`,
    value: {
      fact: {
        ...base,
        detail: segment.key,
        value: segment.value,
        comparison: { direction: 'neutral', scope, rank: cohorte, reference: { kind: 'median', value: segment.reference } },
      },
      label: segment.label,
    },
    rawValue: null,
  }))
  bike.comparisonSplit = true
  delete bike.comparisonSplitNote
  bike.splitNote = null
  // The figure keeps the owner's comparison sentence: only the served values
  // changed, and the sentence already names exactly this cohort and statistic.
  return capture as CahierExportCapture
}

/**
 * A coherent synthetic equipment profile. The 40 (or N) rows are explicitly
 * synthetic equipment labels, but their accessibility buckets and mode order
 * come from the published AEDAR owners (`AEDAR_EQUIPMENT_BUCKET_ORDER`,
 * `AEDAR_EQUIPMENT_MODES`): each row crosses the 25 % threshold in its bucket's
 * mode only, with a small deterministic within-bucket variation. No cyclic
 * modular ladder, no invented domain category, and never presented as real data.
 */
function profilSynthetique(
  count: number,
  baseFacts: readonly Record<string, unknown>[],
): Record<string, unknown>[] {
  const bucketKeys = [...AEDAR_EQUIPMENT_BUCKET_ORDER]
  const modes = AEDAR_EQUIPMENT_MODES.map(({ key }) => key)
  return Array.from({ length: count }, (_, index) => {
    const bucket = bucketKeys[index % bucketKeys.length]!
    const variant = Math.floor(index / bucketKeys.length)
    const measures = Object.fromEntries(modes.map((mode, modeIndex) => {
      const share = mode === bucket
        ? 0.72 + ((variant * 3 + modeIndex) % 9) / 100
        : 0.04 + ((modeIndex * 7 + variant * 5) % 18) / 100
      return [`count_15_${mode}_share`, Number(share.toFixed(2))]
    }))
    return {
      ...baseFacts[index % baseFacts.length],
      typequ: `T${String(index + 1).padStart(3, '0')}`,
      typequ_label: `Équipement ${index + 1}`,
      measures,
    }
  })
}

/**
 * The populated standalone bars section, with no map plate: a native
 * `stationnement-ravitaillement` capture whose compared cells carry served
 * references. The approval PDF set uses this fixture for the barred header /
 * table grammar instead of the synthetic map-block fixture.
 *
 * The compared scope is the capture's own resolved comparison group (the focal
 * commune compares with its EPCI), never a second scope chosen by the fixture,
 * and the served ordinal is the focal value's position inside that declared
 * pair. The values are synthetic fixture values on the published model; nothing
 * here is real producer data.
 */
export function captureBarresStationnement(): CahierExportCapture {
  const capture: any = structuredClone(capturePdfFixture('stationnement-ravitaillement'))
  const group = capture.comparison.group as { scopeKind: ComparisonScopeKind | null; label: string | null } | null
  if (!group?.scopeKind || !group.label) {
    throw new Error('Fixture PDF : le groupe de comparaison natif est requis pour les barres stationnement.')
  }
  const scope = { kind: group.scopeKind, label: group.label }
  /** The declared EPCI cohort: the focal commune and its one peer commune. */
  const paire = { size: 2, facteurPair: 0.76 }
  const synthetic = [12.4, 8.1]
  let index = 0
  for (const figure of capture.figures.filter((candidate: any) => candidate.family === 'mobilite-bars')) {
    for (const category of figure.model.figure.categories) {
      const unit = figure.model.figure.unit
      const focal = synthetic[index % synthetic.length]!
      index += 1
      const pair = Math.round(focal * paire.facteurPair * 100) / 100
      // The focal value leads the declared peer: a served 1er/2, and the mean of
      // the same two values is the compared reference.
      const reference = Math.round(((focal + pair) / 2) * 100) / 100
      category.value.fact.value = focal
      category.value.fact.unit = unit
      category.value.fact.comparison = {
        direction: 'neutral',
        scope,
        rank: { position: focal >= pair ? 1 : 2, size: paire.size, ties: null },
        reference: { kind: 'median', value: reference },
      }
    }
    // The served references above change what the figure states: the owner
    // derives the comparison sentence from these same facts, so the pre-serving
    // "indisponible" label cannot survive beside served cells.
    figure.model.figure.comparisonLabel = comparisonLabelFor(
      figure.model.figure.categories.map((category: any) => category.value),
      capture.identity.territory,
    )
  }
  return capture as CahierExportCapture
}

export function captureWaffleDense(): CahierExportCapture {
  const base = sectionOf(cahierExportFixture().content, 'aedar-equipment-profile')
  const evidence = base.evidence as unknown as { facts: readonly Record<string, unknown>[] }
  return capturePdfFixture('aedar-equipment-profile', {
    evidencePatch: { facts: profilSynthetique(12, evidence.facts) },
  })
}

/* ------------------------------------------------------------------ *
 * Populated comparison ranks (synthetic native contracts, truthfully
 * labelled: the fixture provides the producer-shaped cells; no value,
 * rank or eligibility is computed by the PDF)
 * ------------------------------------------------------------------ */

function servedRank(position: number | null, size = 43, ties: number | null = null) {
  return position === null ? null : { position, size, ties }
}

/**
 * A complete synthetic 43-territory cohort around one focal value. The fixture
 * derives the served rank and the compared group mean from those peers, so a
 * `1er/43` can never sit next to a compared value that is higher than the focal
 * (direction `high`). This is fixture data only: the application/PDF never
 * recomputes a served rank.
 */
function cohorteServie(focal: number, graine: number, egalite = false) {
  const pairs = Array.from({ length: 43 }, (_, index) => {
    if (egalite && index === 0) return focal
    if (index === 1) return focal - 2
    const spread = egalite
      ? -(((graine * 29 + index * 17) % 400) / 100)
      : (((graine * 37 + index * 53) % 401) / 100) - 2
    return Math.round((focal + spread) * 100) / 100
  })
  const meilleurs = pairs.filter((value) => value > focal + 1e-9).length
  const egaux = pairs.filter((value) => Math.abs(value - focal) < 1e-9).length
  const moyenne = pairs.reduce((sum, value) => sum + value, 0) / pairs.length
  return {
    group_value: Number(moyenne.toFixed(2)),
    rank: meilleurs + 1,
    rank_size: 43,
    rank_ties: egaux > 0 ? egaux + 1 : null,
  }
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
  for (const mode of modes) {
    // Canonical producer mode order, not the effective-modes order: a request
    // that shows a subset must read the same served cells for that mode.
    const modeIndex = AEDAR_RAMP_MODES.indexOf(mode as never)
    // Volume ramp: a served mean per horizon (same cells the screen reads).
    for (const [horizonIndex, horizon] of AEDAR_EQUIPMENT_BUCKET_HORIZONS.entries()) {
      const measure = `count_${horizon}_${mode}_mean`
      const focal = 10 + horizonIndex + modeIndex
      fact.measures[measure] = focal
      const graine = horizonIndex * 10 + modeIndex
      cells.push({
        ...source,
        measure,
        ...cohorteServie(focal, graine, graine % 5 === 0),
      })
    }
    // Distribution: every published statistic carries a focal and a served
    // comparison cell. Values vary by mode and statistic so the exported table
    // demonstrates a populated, complete comparison instead of a constant.
    for (const [statisticIndex, statistic] of statistics.entries()) {
      const index = modeIndex * statistics.length + statisticIndex
      const measure = `count_15_${mode}_${statistic.key}`
      const focal = 10 + index
      fact.measures[measure] = focal
      cells.push({
        ...source,
        measure,
        ...cohorteServie(focal, index, index % 7 === 0),
      })
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
 * A dense, honest continuation fixture: forty synthetic equipment types in the
 * equipment-profile panel. Rows are legitimate panel rows (types grouped by
 * their published accessibility bucket and mode order), never invented deciles
 * or extra domain categories. Synthetic like every fixture here, never
 * production data.
 */
export function captureProfilRangsDense(): CahierExportCapture {
  const capture: any = structuredClone(captureWaffleDense())
  const figure = capture.figures.find((candidate: any) => candidate.family === 'aedar-equipment-profile')
  const base = figure.model.facts as readonly Record<string, unknown>[]
  figure.model.facts = profilSynthetique(40, base)
  // The native mount reads the frozen snapshot, not `figures`: keep both in
  // sync so the waffle really has 40 small tiles in the export.
  const frozen = capture.nativeRender?.content.units[0]?.sections[0]?.evidence as any
  if (frozen) frozen.facts = figure.model.facts
  return capture as CahierExportCapture
}
