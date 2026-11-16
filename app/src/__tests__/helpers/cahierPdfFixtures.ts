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
