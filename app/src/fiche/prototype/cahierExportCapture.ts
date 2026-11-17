/**
 * Public export capture for the shared Cahier section path (#1021).
 *
 * One immutable, screen-independent snapshot of a *resolved* section: identity,
 * generation, sources, the real comparison selection and its public names, the
 * native figure models, and the effective local selections that the mounted
 * owners currently hold. The PDF mode choice is a projection of this capture;
 * capturing never reads the DOM, never introspects private Vue state and never
 * starts an acquisition.
 *
 * The nine registered sections consume this interface; there is deliberately no
 * per-section exporter, second renderer registry or global metadata schema.
 */
import type {
  MembreSelection,
  PresetComparaison,
  SelectionComparaison,
} from '@/fiche/comparisonContext'
import {
  contexteMembresSelectionnes,
  contextesDepuisReference,
} from '@/fiche/comparisonContext'
import type { ComparisonScopeKind, FactAvailability, TerritoryIdentity } from '@/fiche/content/territoryFacts'
import type { AedarComparisonEvidence } from '@/fiche/content/aedarComparisonClient'
import type { AedarFact } from '@/fiche/content/aedarApiClient'
import type { AedarEquipmentHorizon } from '@/fiche/content/aedarEquipmentBuckets'
import { AEDAR_RAMP_MODE_LABELS, AEDAR_RAMP_MODES } from '@/fiche/content/aedarTimeRampFacts'
import type {
  AedarCarAccessOverviewScalar,
  AedarEvidenceSource,
  AedarRampMode,
  AedarTimeRampEvidence,
  ContentEvidence,
  ContentSection,
  ContentSource,
  MobiliteBarsFigureEvidence,
  MobiliteRatioEvidence,
  MobiliteRaccordementEvidence,
  MobiliteShareEvidence,
  TextBlock,
} from '@/fiche/content/themeContent'
import type { Territoire } from '@/payload/types'

/** One to three selectable series may be kept for a readable PDF table (PRD #1014). */
export const CAHIER_EXPORT_MAX_MODES = 3

/** Stable publication slots shared by the owners and the capture. */
export const CAHIER_EXPORT_SLOTS = {
  mobiliteNetworksMaps: 'maps',
  mobiliteNetworksBars: 'bars',
  mobiliteCurve: 'curve',
  aedarEquipment: 'aedar-equipment',
} as const

/** The distinct figure families the shared path actually renders. */
export type CahierCaptureFamily =
  | 'aedar-car-overview'
  | 'aedar-diversity-loss'
  | 'aedar-ramps'
  | 'aedar-equipment-profile'
  | 'aedar-equipment-explorer'
  | 'mobilite-bars'
  | 'mobilite-share'
  | 'mobilite-curve'

export type CahierCaptureReadinessReason =
  | 'chapter-loading'
  | 'chapter-pending'
  | 'chapter-error'
  | 'evidence-absent'
  | 'evidence-pending'
  | 'evidence-incomplete'
  | 'evidence-ready'

export interface CahierCaptureReadiness {
  readonly status: 'pending' | 'unavailable' | 'error' | 'ready'
  readonly reason: CahierCaptureReadinessReason
  readonly availability: FactAvailability
}

export interface CahierCaptureIdentity {
  readonly sectionKey: ContentSection['key']
  readonly evidenceKind: ContentEvidence['kind'] | null
  readonly sectionLabel: string
  readonly sectionAvailability: FactAvailability
  readonly unit: { readonly key: string; readonly label: string }
  readonly territory: {
    readonly type: TerritoryIdentity['type']
    readonly code: string
    readonly name: string
  }
}

/** Publication identity of the resolved evidence; never a recomputation. */
export interface CahierCaptureGeneration {
  readonly contentVersion: string | null
  readonly referenceContentVersion: string | null
}

export interface CahierCaptureSource {
  /** Full provenance identity: two identical labels with distinct records stay distinct. */
  readonly identity: string
  readonly id: string | null
  readonly label: string
  /** Producer-owned factual version. */
  readonly version: string
  /** App-owned compact stamp precision, when the producer version is opaque. */
  readonly displayVersion: string | null
  readonly referenceDate: string | null
  readonly publicationDate: string | null
  /** Published URL, possibly absent; the source itself is never dropped. */
  readonly url: string | null
  readonly licence: string | null
  readonly credit: string | null
}

export interface CahierCaptureComparisonMember {
  readonly type: MembreSelection['territory_type']
  readonly id: string
  /** Exact public name from the validated reference; null when unresolved. */
  readonly name: string | null
}

export interface CahierCaptureComparisonSelection {
  /** False for a standalone mount with no comparison control: no identity is claimed. */
  readonly known: boolean
  readonly state: 'defaut' | 'vide' | 'preset' | 'membres' | 'unknown'
  /** Effective preset (explicit, or the level-native default). */
  readonly preset: PresetComparaison | null
  readonly defaultPreset: PresetComparaison | null
  readonly level: TerritoryIdentity['type'] | null
  /** The members actually selected, in selection order — never measure contributors. */
  readonly members: readonly CahierCaptureComparisonMember[]
  /** Total selected member count for a custom group; null for presets/defaults. */
  readonly memberCount: number | null
}

export type CahierCaptureComparisonAbsence =
  | 'not-eligible'
  | 'no-selection-control'
  | 'empty-selection'
  | 'unresolved-selection'
  | 'no-comparative-evidence'

export interface CahierCaptureComparisonGroup {
  /** Canonical public scope label of the comparison context (source contract). */
  readonly label: string | null
  /** Exact public names the comparison header may use (EPCI name, preset scope, member names). */
  readonly names: readonly string[]
  readonly preset: PresetComparaison | null
  readonly level: TerritoryIdentity['type'] | null
  readonly scopeKind: ComparisonScopeKind | null
  /** Total members actually selected — never the eligible contributors of a measure. */
  readonly selectedMemberCount: number | null
  /** Producer-served eligible contributor count, only when the evidence declares it. */
  readonly eligibleContributorCount: number | null
}

/** One owner-observed comparative layer (figure-level truth, never a default). */
export interface CahierCaptureComparisonLayer {
  /** Stable slot inside the section (figure column, plate, composition layer). */
  readonly slot: string
  /** The reader's raw toggle where the figure exposes one; null when it has none. */
  readonly toggle: boolean | null
  /** The acquired evidence carries a served reference for at least one category/point/cell. */
  readonly referenceAvailable: boolean
  /** The effective visible subset (selected modes/horizon) carries a served reference. */
  readonly visibleReferenceAvailable: boolean
  /** The owner actually draws/reads the comparison layer now. */
  readonly displayed: boolean
}

export type CahierComparisonDisplayState =
  | 'displayed'
  | 'not-displayed'
  | 'unobserved'
  | 'not-applicable'

export type CahierComparisonDisplayReason =
  | 'shown'
  | 'capability-absent'
  | 'unpublished'
  | 'not-eligible'
  | 'empty-selection'
  | 'hidden-by-user'
  | 'hidden-by-selection'
  | 'no-served-reference'
  | 'loading'
  | 'error'
  | 'unavailable'

export interface CahierCaptureComparisonDisplay {
  readonly state: CahierComparisonDisplayState
  readonly reason: CahierComparisonDisplayReason
  /** Owner observations, in publication order; empty when nothing was published. */
  readonly layers: readonly CahierCaptureComparisonLayer[]
}

export type CahierCaptureReferenceStatus =
  | 'unobserved'
  | 'idle'
  | 'loading'
  | 'ready'
  | 'error'
  | 'unavailable'
  | null

export interface CahierCaptureComparison {
  /** Status of the comparison evidence read the section's figures consume. */
  readonly status: 'idle' | 'loading' | 'ready' | 'error' | 'unavailable'
  readonly error: string | null
  /**
   * Status of the direct reference read the section would display (AEDAR);
   * null when the section does not consume one. Kept distinct from `status`
   * so a failed reference read is never reported as a legitimate absence.
   */
  readonly referenceStatus: CahierCaptureReferenceStatus
  readonly eligible: boolean
  /** The section family can carry a comparative layer at all (not proof it is drawn). */
  readonly capable: boolean
  readonly selection: CahierCaptureComparisonSelection
  /** Resolved group identity metadata; never proof that a comparison is displayed. */
  readonly group: CahierCaptureComparisonGroup | null
  readonly absent: CahierCaptureComparisonAbsence | null
  /**
   * The mobilite section owner's exact comparisonNone predicate when it
   * publishes one; null for families whose owner does not publish this state.
   * Consumers must not reconstruct it from `absent`.
   */
  readonly none: boolean | null
  /** Owner-observed effective presentation of comparative evidence. */
  readonly display: CahierCaptureComparisonDisplay
  /** Distinct served statistic/scope labels carried by the section figures, in order. */
  readonly statisticLabels: readonly string[]
}

/** Native legend content observed by a map owner; never reconstructed from pixels. */
export interface CahierCaptureMapLegendDetail {
  readonly title: string
  readonly minimum: number | null
  readonly maximum: number | null
  readonly colors: readonly string[]
  readonly tickLabels: readonly string[]
  readonly note: string
  readonly ariaLabel: string | null
}

export interface CahierCaptureMapItem {
  readonly id: string
  readonly label: string
  /** The owner declares that a map is expected for this item. */
  readonly declared: boolean
  /** Owner-observed successful inline asset load; never derived from `declared`. */
  readonly loaded: boolean
  /** Owner-observed failed inline asset load. */
  readonly unavailable: boolean
  /** The actual inline figure asset URL from the owner's existing path contract. */
  readonly inlineUrl: string | null
}

export interface CahierCaptureMaps {
  /** `unknown` means no map owner has published an observation yet. */
  readonly status: 'none' | 'unknown' | 'pending' | 'available' | 'partial' | 'unavailable'
  readonly legend: 'none' | 'unknown' | 'pending' | 'available' | 'unavailable'
  readonly items: readonly CahierCaptureMapItem[]
  /** Owner-observed legend content; null until the owner reports it drawn. */
  readonly legendDetail: CahierCaptureMapLegendDetail | null
}

export interface CahierCaptureCapabilities {
  /** Series a PDF request may choose from; empty when the section offers no choice. */
  readonly selectableSeries: readonly { readonly id: string; readonly label: string }[]
  /** Series effectively selected on screen now. */
  readonly selectedSeries: readonly string[]
  readonly maps: CahierCaptureMaps
}

/** Shared AEDAR presentation state, read from its one existing owner. */
export interface CahierAedarCaptureState {
  readonly modes: readonly AedarRampMode[]
  readonly horizonMinutes: AedarEquipmentHorizon | null
  readonly comparisonVisible: boolean
  readonly comparisonEligible: boolean
  readonly chapterActive: boolean
}

export interface CahierEquipmentCaptureState {
  readonly typequ: string
  readonly typequLabel: string | null
  readonly selectedDetail: AedarFact | null
  readonly detailStatus: 'idle' | 'loading' | 'ready' | 'error'
  readonly comparisonStatus: 'idle' | 'loading' | 'ready' | 'error'
  readonly comparisonError: string | null
  readonly comparison: AedarComparisonEvidence | null
  readonly referenceDetail: AedarFact | null
}

export interface CahierComparisonLayerCaptureState {
  readonly toggle: boolean | null
  readonly referenceAvailable: boolean
  readonly visibleReferenceAvailable: boolean
  readonly displayed: boolean
}

export interface CahierMapAvailabilityCaptureState {
  readonly maps: readonly CahierCaptureMapItem[]
  readonly legend: 'none' | 'pending' | 'available' | 'unavailable'
  /** Raw owner legend content; the capture only exposes it with `legend: available`. */
  readonly legendDetail?: CahierCaptureMapLegendDetail | null
}

export interface CahierMobiliteSectionCaptureState {
  readonly comparisonStatus: 'idle' | 'loading' | 'ready' | 'error' | 'unavailable'
  readonly comparisonError: string | null
  /**
   * The section's own comparisonNone predicate: no injected control (including
   * an ineligible territory) or an explicit empty selection. This is the exact
   * value its figures receive, never an inferred capture absence.
   */
  readonly comparisonNone: boolean
  /** A served ratio reference exists for at least one paired column. */
  readonly ratioReferenceAvailable: boolean
  /** At least one paired ratio reference is actually drawn (not comparisonNone). */
  readonly ratioReferenceDisplayed: boolean
}

/** What each native owner publicly publishes; the venue only reads these thunks. */
export type CahierExportPublicationState =
  | { readonly owner: 'aedar-equipment-explorer'; readonly state: CahierEquipmentCaptureState }
  | { readonly owner: 'aedar-comparison-layer'; readonly state: CahierComparisonLayerCaptureState }
  | { readonly owner: 'mobilite-comparison-bars'; readonly state: CahierComparisonLayerCaptureState }
  | { readonly owner: 'mobilite-raccordement-curve'; readonly state: CahierComparisonLayerCaptureState }
  | { readonly owner: 'mobilite-share-track'; readonly state: CahierComparisonLayerCaptureState }
  | { readonly owner: 'map-availability'; readonly state: CahierMapAvailabilityCaptureState }
  | { readonly owner: 'mobilite-section'; readonly state: CahierMobiliteSectionCaptureState }

export interface CahierExportPublication {
  readonly slot: string
  readonly state: CahierExportPublicationState
}

/**
 * Native sibling row of two figures (the stationnement/ravitaillement pair).
 * `columns` and `gapPx` are the source layout facts, not a per-section PDF
 * template: the composer pairs the captured siblings and only falls back to a
 * full-width stack on real measured overflow.
 */
export interface CahierCaptureFigureRow {
  readonly key: string
  readonly columns: number
  /** Source CSS column gap, at the approved desktop reading scale. */
  readonly gapPx: number
}

interface CahierCaptureFigureBase {
  readonly family: CahierCaptureFamily
  /** Stable slot inside the section (the paired terrain column, the sole figure, …). */
  readonly slot: string
  /** Present when the source renders this figure in a multi-column row. */
  readonly row?: CahierCaptureFigureRow
}

export interface CahierCarOverviewFigureCapture extends CahierCaptureFigureBase {
  readonly family: 'aedar-car-overview'
  readonly model: {
    readonly horizonMinutes: number
    readonly mapModes: readonly string[]
    readonly mapFigureTitle: TextBlock
    readonly scalarFigureTitle: string
    readonly scalars: readonly AedarCarAccessOverviewScalar[]
    readonly sourcePending: boolean
    readonly comparisonLabel: string | null
  }
}

export interface CahierDiversityLossFigureCapture extends CahierCaptureFigureBase {
  readonly family: 'aedar-diversity-loss'
  readonly model: {
    readonly horizonMinutes: number
    readonly mapFigureTitle: TextBlock
    readonly maps: readonly {
      readonly mode: string
      readonly label: string
      readonly inlineAvailable: boolean
      readonly inspectionAvailable: boolean
    }[]
    readonly legend: {
      readonly title: string
      readonly colors: readonly string[]
      readonly tickLabels: readonly string[]
      readonly note: string
      readonly ariaLabel: string
    } | null
    readonly metadataState: 'loading' | 'ready' | 'unavailable'
    readonly comparisonGroups: readonly { readonly key: string; readonly label: string }[]
  }
}

export interface CahierRampsFigureCapture extends CahierCaptureFigureBase {
  readonly family: 'aedar-ramps'
  readonly model: {
    readonly horizonMinutes: number
    readonly comparisonLabel: string | null
    readonly ramps: readonly AedarTimeRampEvidence[]
  }
  readonly effective: {
    readonly modes: readonly AedarRampMode[]
  }
}

export interface CahierProfileFigureCapture extends CahierCaptureFigureBase {
  readonly family: 'aedar-equipment-profile'
  readonly model: {
    readonly threshold: number
    readonly figureTitle: string
    readonly initialHorizonMinutes: AedarEquipmentHorizon
    readonly facts: readonly AedarFact[]
  }
  readonly effective: {
    readonly horizonMinutes: AedarEquipmentHorizon | null
  }
}

export interface CahierExplorerFigureCapture extends CahierCaptureFigureBase {
  readonly family: 'aedar-equipment-explorer'
  readonly model: {
    readonly contentVersion: string
    readonly referenceContentVersion: string
    readonly initialTypequ: string
    readonly initialHorizonMinutes: AedarEquipmentHorizon
    readonly volumeFigureTitle: string
    readonly volumeYAxisTitle: string
    readonly distributionFigureTitle: string
    readonly distributionAxisTitle: string
    readonly distributionYAxisTitle: string
    readonly distributionValueUnit: string
    /** Native explanatory copy displayed under the distribution bars (#1022). */
    readonly distributionDescription: string
    /** Native copy when the distribution model is unavailable (#1022). */
    readonly distributionUnavailableDescription: string
    readonly distributionStatistics: readonly {
      readonly key: string
      readonly label: string
      readonly axisLabel: string
    }[]
    readonly comparisonRequestLabel: string | null
    readonly referenceLabel: string | null
    readonly facts: readonly AedarFact[]
  }
  readonly effective: {
    readonly typequ: string
    readonly typequLabel: string | null
    readonly selectedDetail: AedarFact | null
    readonly detailStatus: 'idle' | 'loading' | 'ready' | 'error'
    readonly modes: readonly AedarRampMode[]
    readonly horizonMinutes: AedarEquipmentHorizon | null
    readonly comparisonStatus: 'idle' | 'loading' | 'ready' | 'error'
    readonly comparisonError: string | null
    readonly comparison: AedarComparisonEvidence | null
    readonly referenceDetail: AedarFact | null
  }
}

export interface CahierBarsFigureCapture extends CahierCaptureFigureBase {
  readonly family: 'mobilite-bars'
  readonly model: {
    readonly figure: MobiliteBarsFigureEvidence
    readonly ratio: MobiliteRatioEvidence | null
  }
}

export interface CahierShareFigureCapture extends CahierCaptureFigureBase {
  readonly family: 'mobilite-share'
  readonly model: {
    readonly figureTitle: string
    readonly territoryName: string
    readonly value: MobiliteShareEvidence['value']
    readonly unit: string
    readonly comparisonLabel: string | null
    readonly unavailableResources: readonly string[]
    readonly unavailableComparisons: readonly string[]
  }
}

export interface CahierCurveFigureCapture extends CahierCaptureFigureBase {
  readonly family: 'mobilite-curve'
  readonly model: {
    readonly figureTitle: string
    readonly xAxisTitle: string
    readonly territoryName: string
    readonly level: MobiliteRaccordementEvidence['level']
    readonly points: MobiliteRaccordementEvidence['points']
    readonly comparison: {
      readonly statistic: 'mean'
      readonly scope: NonNullable<MobiliteRaccordementEvidence['comparison']>['scope']
      readonly selectedMemberCount: number
      readonly eligibleCount: number
      readonly modelZeroReasonCounts: Readonly<Record<string, number>>
      readonly points: NonNullable<MobiliteRaccordementEvidence['comparison']>['points']
    } | null
    readonly trajectory: MobiliteRaccordementEvidence['trajectory']
    readonly axis: MobiliteRaccordementEvidence['axis']
    readonly markerValue: MobiliteRaccordementEvidence['markerValue']
    readonly comparisonLabel: string | null
    readonly unavailableResources: readonly string[]
    readonly unavailableComparisons: readonly string[]
  }
}

export type CahierCaptureFigure =
  | CahierCarOverviewFigureCapture
  | CahierDiversityLossFigureCapture
  | CahierRampsFigureCapture
  | CahierProfileFigureCapture
  | CahierExplorerFigureCapture
  | CahierBarsFigureCapture
  | CahierShareFigureCapture
  | CahierCurveFigureCapture

export interface CahierExportCapture {
  readonly identity: CahierCaptureIdentity
  readonly generation: CahierCaptureGeneration
  readonly readiness: CahierCaptureReadiness
  readonly capabilities: CahierCaptureCapabilities
  readonly comparison: CahierCaptureComparison
  readonly sources: readonly CahierCaptureSource[]
  readonly aedar: CahierAedarCaptureState | null
  readonly figures: readonly CahierCaptureFigure[]
}

export interface CahierSectionCaptureInput {
  readonly section: ContentSection
  readonly unit: { readonly key: string; readonly label: string }
  readonly territory: TerritoryIdentity
  /** The shell's honest chapter/evidence state, already computed for display. */
  readonly readiness: CahierCaptureReadiness
  /** Conditioned direct-reference read status from its existing production owner. */
  readonly referenceStatus?: CahierCaptureReferenceStatus
  /** Territory-level comparison capability (#768), from its existing owner. */
  readonly comparisonEligible: boolean
  /** Acquired comparison state consumed by this section's own figures. */
  readonly comparisonStatus: 'idle' | 'loading' | 'ready' | 'error' | 'unavailable'
  readonly comparisonError: string | null
  /** The header comparison selection, read from the fiche control (null when absent). */
  readonly control: {
    readonly focal: Territoire
    readonly territoires: readonly Territoire[]
    readonly selection: SelectionComparaison
    readonly presetDefaut: PresetComparaison | null
  } | null
  readonly aedar: CahierAedarCaptureState | null
  readonly publications: readonly CahierExportPublication[]
}

export interface CahierExportMode {
  readonly id: string
  readonly label: string
}

export interface CahierExportRequest {
  /** The frozen capture the request was projected from; retry reuses it. */
  readonly capture: CahierExportCapture
  /** One to three selectable series, or none when the section offers no choice. */
  readonly modes: readonly CahierExportMode[]
  readonly modeIds: readonly string[]
}

export type CahierExportProjection =
  | { readonly status: 'ready'; readonly request: CahierExportRequest }
  | {
      readonly status: 'invalid'
      readonly reason: 'no-modes' | 'too-many-modes' | 'unknown-mode' | 'duplicate-mode'
      readonly message: string
    }

/**
 * Closed mapping from the rendered evidence kind to its figure family. Adding a
 * `ContentEvidence` kind fails type checking here until it has a family.
 */
export function cahierCaptureFamily(kind: ContentEvidence['kind']): CahierCaptureFamily {
  switch (kind) {
    case 'aedar-car-overview': return 'aedar-car-overview'
    case 'aedar-diversity-loss': return 'aedar-diversity-loss'
    case 'aedar-access': return 'aedar-ramps'
    case 'aedar-equipment-profile': return 'aedar-equipment-profile'
    case 'aedar-equipment-explorer': return 'aedar-equipment-explorer'
    case 'mobilite-networks':
    case 'mobilite-stationnement-ravitaillement': return 'mobilite-bars'
    case 'mobilite-share': return 'mobilite-share'
    case 'mobilite-raccordement': return 'mobilite-curve'
  }
}

function deepPlain<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map((item) => deepPlain(item)) as unknown as T
  if (value instanceof Date) return new Date(value.getTime()) as unknown as T
  if (value instanceof Map) {
    const entries = [...value.entries()].map(([key, item]) => [deepPlain(key), deepPlain(item)] as const)
    return new Map(entries) as unknown as T
  }
  if (value instanceof Set) return new Set([...value].map((item) => deepPlain(item))) as unknown as T
  const result: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (typeof item === 'function') continue
    result[key] = deepPlain(item)
  }
  return result as T
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value
  if (Object.isFrozen(value)) return value
  for (const item of Object.values(value as Record<string, unknown>)) deepFreeze(item)
  return Object.freeze(value)
}

export function captureCahierSection(input: CahierSectionCaptureInput): CahierExportCapture {
  const section = input.section
  const evidence = section.evidence
  const family = evidence ? cahierCaptureFamily(evidence.kind) : null
  const publications = input.publications
  const selection = captureComparisonSelection(input)
  const { group, absent } = captureComparisonGroup({
    input,
    evidence,
    family,
    selection,
  })
  const comparisonStatus = captureComparisonStatus(family, input, publications)
  const comparisonError = captureComparisonError(family, input, publications)
  const comparisonNone = captureComparisonNone(family, publications)
  const referenceStatus = cahierCaptureConsumesReference(family)
    ? (input.referenceStatus ?? 'unobserved')
    : null
  const capture: CahierExportCapture = {
    identity: {
      sectionKey: section.key,
      evidenceKind: evidence?.kind ?? null,
      sectionLabel: section.label,
      sectionAvailability: section.availability,
      unit: { key: input.unit.key, label: input.unit.label },
      territory: {
        type: input.territory.type,
        code: input.territory.code,
        name: input.territory.name,
      },
    },
    generation: captureGeneration(evidence),
    readiness: {
      status: input.readiness.status,
      reason: input.readiness.reason,
      availability: input.readiness.availability,
    },
    capabilities: {
      selectableSeries: captureSelectableSeries(family, input.aedar),
      selectedSeries: captureSelectedSeries(family, input.aedar),
      maps: captureMaps({ family, evidence, publications }),
    },
    comparison: {
      status: comparisonStatus,
      error: comparisonError,
      referenceStatus,
      eligible: input.comparisonEligible,
      capable: family ? FAMILY_HAS_COMPARISON_EVIDENCE[family] : false,
      selection,
      group,
      absent,
      none: comparisonNone,
      display: captureComparisonDisplay({
        family,
        evidence,
        input,
        selection,
        publications,
        status: comparisonStatus,
        referenceStatus,
      }),
      statisticLabels: comparisonStatisticLabels(evidence, publications),
    },
    sources: captureSources(evidence),
    aedar: evidence && family?.startsWith('aedar-') ? deepPlain(input.aedar) : null,
    figures: evidence && family
      ? captureFigures({ evidence, family, input, publications })
      : [],
  }
  return deepFreeze(deepPlain(capture))
}

const FAMILY_HAS_COMPARISON_EVIDENCE: Readonly<Record<CahierCaptureFamily, boolean>> = {
  'aedar-car-overview': true,
  'aedar-diversity-loss': false,
  'aedar-ramps': true,
  'aedar-equipment-profile': false,
  'aedar-equipment-explorer': true,
  'mobilite-bars': true,
  'mobilite-share': true,
  'mobilite-curve': true,
}

const LAYER_OWNERS: ReadonlySet<CahierExportPublicationState['owner']> = new Set([
  'aedar-comparison-layer',
  'mobilite-comparison-bars',
  'mobilite-raccordement-curve',
  'mobilite-share-track',
])

const MODE_SELECTING_FAMILIES: ReadonlySet<CahierCaptureFamily> = new Set([
  'aedar-ramps',
  'aedar-equipment-explorer',
])

const DIRECT_REFERENCE_FAMILIES: ReadonlySet<CahierCaptureFamily> = new Set([
  'aedar-car-overview',
  'aedar-ramps',
  'aedar-equipment-explorer',
])

export function cahierCaptureConsumesReference(family: CahierCaptureFamily | null): boolean {
  return family !== null && DIRECT_REFERENCE_FAMILIES.has(family)
}

function captureSelectableSeries(
  family: CahierCaptureFamily | null,
  aedar: CahierAedarCaptureState | null,
): readonly { readonly id: string; readonly label: string }[] {
  if (!family || !aedar || !MODE_SELECTING_FAMILIES.has(family)) return []
  return AEDAR_RAMP_MODES.map((mode) => ({ id: mode, label: AEDAR_RAMP_MODE_LABELS[mode] }))
}

function captureSelectedSeries(
  family: CahierCaptureFamily | null,
  aedar: CahierAedarCaptureState | null,
): readonly string[] {
  if (!family || !aedar || !MODE_SELECTING_FAMILIES.has(family)) return []
  return [...aedar.modes]
}

function captureGeneration(evidence: ContentEvidence | null): CahierCaptureGeneration {
  if (evidence?.kind === 'aedar-equipment-explorer') {
    return {
      contentVersion: evidence.contentVersion,
      referenceContentVersion: evidence.referenceContentVersion,
    }
  }
  // Other AEDAR evidence carries the producer publication clock with its
  // section source; Mobilit? evidence has no content-version token, so its
  // generation stays explicitly absent rather than invented.
  if (evidence && 'source' in evidence && evidence.source) {
    return {
      contentVersion: evidence.source.contentVersion ?? null,
      referenceContentVersion: evidence.source.referenceContentVersion ?? null,
    }
  }
  return { contentVersion: null, referenceContentVersion: null }
}


function mobiliteSectionPublication(publications: readonly CahierExportPublication[]) {
  return publications.find((publication) => publication.state.owner === 'mobilite-section')
}

function explorerPublication(publications: readonly CahierExportPublication[]) {
  const publication = publications.find((entry) => entry.state.owner === 'aedar-equipment-explorer')
  return publication?.state.owner === 'aedar-equipment-explorer' ? publication.state.state : null
}

function captureComparisonStatus(
  family: CahierCaptureFamily | null,
  input: CahierSectionCaptureInput,
  publications: readonly CahierExportPublication[],
): CahierCaptureComparison['status'] {
  if (family === null) return 'idle'
  if (family === 'aedar-equipment-explorer') {
    const explorer = explorerPublication(publications)
    if (explorer) return explorer.comparisonStatus
    return 'idle'
  }
  if (family === 'aedar-equipment-profile' || family === 'aedar-diversity-loss') return 'idle'
  if (family === 'mobilite-bars' || family === 'mobilite-share' || family === 'mobilite-curve') {
    const delegate = mobiliteSectionPublication(publications)
    if (delegate?.state.owner === 'mobilite-section') {
      return delegate.state.state.comparisonStatus
    }
    return input.comparisonStatus
  }
  return input.comparisonStatus
}

function captureComparisonError(
  family: CahierCaptureFamily | null,
  input: CahierSectionCaptureInput,
  publications: readonly CahierExportPublication[],
): string | null {
  if (family === 'aedar-equipment-explorer') {
    const explorer = explorerPublication(publications)
    return explorer?.comparisonError ?? null
  }
  if (family === 'mobilite-bars' || family === 'mobilite-share' || family === 'mobilite-curve') {
    const delegate = mobiliteSectionPublication(publications)
    if (delegate?.state.owner === 'mobilite-section') return delegate.state.state.comparisonError
  }
  if (family === 'aedar-equipment-profile' || family === 'aedar-diversity-loss') return null
  return input.comparisonError
}

/**
 * The mobilite section's own comparisonNone predicate, read from its public
 * publication. No other family publishes this state; null keeps that absence
 * honest instead of turning a missing observation into false.
 */
function captureComparisonNone(
  family: CahierCaptureFamily | null,
  publications: readonly CahierExportPublication[],
): boolean | null {
  if (family === 'mobilite-bars' || family === 'mobilite-share' || family === 'mobilite-curve') {
    const delegate = mobiliteSectionPublication(publications)
    if (delegate?.state.owner === 'mobilite-section') return delegate.state.state.comparisonNone
  }
  return null
}

function captureComparisonSelection(input: CahierSectionCaptureInput): CahierCaptureComparisonSelection {
  const control = input.control
  const level = control?.focal.type ?? input.territory.type
  if (!control) {
    return {
      known: false,
      state: 'unknown',
      preset: null,
      defaultPreset: null,
      level,
      members: [],
      memberCount: null,
    }
  }
  const selection = control.selection
  const effectivePreset = selection.etat === 'preset'
    ? selection.preset
    : selection.etat === 'defaut' ? control.presetDefaut : null
  const members = selection.etat === 'membres'
    ? selection.membres.map((member) => ({
      type: member.territory_type,
      id: member.territory_id,
      name: publicNameFor(member.territory_type, member.territory_id, control.territoires),
    }))
    : []
  return {
    known: true,
    state: selection.etat,
    preset: effectivePreset,
    defaultPreset: control.presetDefaut,
    level,
    members,
    memberCount: selection.etat === 'membres' ? selection.membres.length : null,
  }
}

function publicNameFor(
  type: MembreSelection['territory_type'],
  id: string,
  territoires: readonly Territoire[],
): string | null {
  return territoires.find((candidate) => candidate.type === type && candidate.territoire === id)?.nom ?? null
}

function servedComparisonCounts(evidence: ContentEvidence | null): {
  selectedMemberCount: number | null
  eligibleContributorCount: number | null
} {
  if (evidence?.kind !== 'mobilite-raccordement' || !evidence.comparison) {
    return { selectedMemberCount: null, eligibleContributorCount: null }
  }
  return {
    selectedMemberCount: evidence.comparison.selectedMemberCount,
    eligibleContributorCount: evidence.comparison.eligibleCount,
  }
}

/** Distinct served statistic/scope labels the section figures actually carry. */
function comparisonStatisticLabels(
  evidence: ContentEvidence | null,
  publications: readonly CahierExportPublication[],
): readonly string[] {
  if (!evidence) return []
  const labels: string[] = []
  const add = (label: string | null | undefined): void => {
    if (label && !labels.includes(label)) labels.push(label)
  }
  switch (evidence.kind) {
    case 'aedar-car-overview':
    case 'aedar-access':
    case 'mobilite-share':
    case 'mobilite-raccordement':
      add(evidence.comparisonLabel)
      break
    case 'mobilite-networks':
      add(evidence.figure.comparisonLabel)
      break
    case 'mobilite-stationnement-ravitaillement':
      for (const column of evidence.columns) add(column.bars.comparisonLabel)
      break
    case 'aedar-equipment-explorer':
      add(evidence.comparisonRequest?.label)
      add(explorerPublication(publications)?.comparison?.label)
      break
    case 'aedar-diversity-loss':
    case 'aedar-equipment-profile':
      break
  }
  return labels
}

function captureComparisonGroup(options: {
  input: CahierSectionCaptureInput
  evidence: ContentEvidence | null
  family: CahierCaptureFamily | null
  selection: CahierCaptureComparisonSelection
}): {
  group: CahierCaptureComparisonGroup | null
  absent: CahierCaptureComparisonAbsence | null
} {
  const { input, evidence, family, selection } = options
  if (!input.comparisonEligible) return { group: null, absent: 'not-eligible' }
  if (!family || !FAMILY_HAS_COMPARISON_EVIDENCE[family]) {
    return { group: null, absent: 'no-comparative-evidence' }
  }
  const control = input.control
  if (!control) return { group: null, absent: 'no-selection-control' }
  const current = control.selection
  if (current.etat === 'vide' || (current.etat === 'membres' && current.membres.length === 0)) {
    return { group: null, absent: 'empty-selection' }
  }
  const contextes = contextesDepuisReference(control.focal, control.territoires)
  const served = servedComparisonCounts(evidence)
  if (current.etat === 'membres') {
    const scope = contexteMembresSelectionnes(current.membres)?.scope ?? null
    const names = current.membres
      .map((member) => publicNameFor(member.territory_type, member.territory_id, control.territoires))
      .filter((name): name is string => name !== null)
    return {
      group: {
        label: scope?.label ?? null,
        names,
        preset: null,
        level: control.focal.type,
        scopeKind: 'selection',
        // The total selected members, never the eligible contributors of a measure.
        selectedMemberCount: current.membres.length,
        eligibleContributorCount: served.eligibleContributorCount,
      },
      absent: null,
    }
  }
  const preset = selection.preset
  if (!preset) return { group: null, absent: 'unresolved-selection' }
  const contexte = contextes[preset] ?? null
  if (!contexte) return { group: null, absent: 'unresolved-selection' }
  const names = preset === 'epci'
    ? [epciNameFor(control)]
      .filter((name): name is string => name !== null)
    : [contexte.scope.label]
  return {
    group: {
      label: contexte.scope.label,
      names,
      preset,
      level: control.focal.type,
      scopeKind: contexte.scope.kind,
      selectedMemberCount: served.selectedMemberCount,
      eligibleContributorCount: served.eligibleContributorCount,
    },
    absent: null,
  }
}

function comparisonLayerPublications(
  publications: readonly CahierExportPublication[],
): readonly CahierExportPublication[] {
  return publications.filter((publication) => LAYER_OWNERS.has(publication.state.owner))
}

function comparisonLayerFrom(publication: CahierExportPublication): CahierCaptureComparisonLayer | null {
  switch (publication.state.owner) {
    case 'aedar-comparison-layer':
    case 'mobilite-comparison-bars':
    case 'mobilite-raccordement-curve':
    case 'mobilite-share-track':
      return {
        slot: publication.slot || 'comparison',
        toggle: publication.state.state.toggle,
        referenceAvailable: publication.state.state.referenceAvailable,
        visibleReferenceAvailable: publication.state.state.visibleReferenceAvailable,
        displayed: publication.state.state.displayed,
      }
    default:
      return null
  }
}

/**
 * Aggregate only the layers the owners actually published. Nothing is inferred
 * from a family's capability, a raw toggle default or evidence declarations.
 */
function captureComparisonDisplay(options: {
  family: CahierCaptureFamily | null
  evidence: ContentEvidence | null
  input: CahierSectionCaptureInput
  selection: CahierCaptureComparisonSelection
  publications: readonly CahierExportPublication[]
  status: CahierCaptureComparison['status']
  referenceStatus: CahierCaptureReferenceStatus
}): CahierCaptureComparisonDisplay {
  const { family, evidence, input, selection, publications, status, referenceStatus } = options
  const capable = family ? FAMILY_HAS_COMPARISON_EVIDENCE[family] : false
  if (!capable) {
    return { state: 'not-applicable', reason: 'capability-absent', layers: [] }
  }
  const layers = comparisonLayerPublications(publications)
    .map((publication) => comparisonLayerFrom(publication))
    .filter((layer): layer is CahierCaptureComparisonLayer => layer !== null)
  // The paired delegate owns a ratio reference surface independent of the bars'
  // own toggle. It is an observed layer only for the paired section kind.
  if (evidence?.kind === 'mobilite-stationnement-ravitaillement') {
    const delegate = mobiliteSectionPublication(publications)
    if (delegate?.state.owner === 'mobilite-section') {
      layers.push({
        slot: 'ratios',
        toggle: null,
        referenceAvailable: delegate.state.state.ratioReferenceAvailable,
        visibleReferenceAvailable: delegate.state.state.ratioReferenceAvailable,
        displayed: delegate.state.state.ratioReferenceDisplayed,
      })
    }
  }
  if (layers.length === 0) return { state: 'unobserved', reason: 'unpublished', layers: [] }
  if (!input.comparisonEligible) return { state: 'not-displayed', reason: 'not-eligible', layers }
  if (selection.state === 'vide' || (selection.state === 'membres' && selection.memberCount === 0)) {
    return { state: 'not-displayed', reason: 'empty-selection', layers }
  }
  if (layers.some((layer) => layer.displayed)) return { state: 'displayed', reason: 'shown', layers }
  if (layers.every((layer) => layer.toggle === false)) {
    return { state: 'not-displayed', reason: 'hidden-by-user', layers }
  }
  switch (status) {
    case 'loading':
      return { state: 'not-displayed', reason: 'loading', layers }
    case 'error':
      return { state: 'not-displayed', reason: 'error', layers }
    case 'unavailable':
      return { state: 'not-displayed', reason: 'unavailable', layers }
    case 'idle':
    case 'ready':
      break
  }
  switch (referenceStatus) {
    case 'loading':
      return { state: 'not-displayed', reason: 'loading', layers }
    case 'error':
      return { state: 'not-displayed', reason: 'error', layers }
    case 'unavailable':
      return { state: 'not-displayed', reason: 'unavailable', layers }
    case 'unobserved':
    case 'idle':
    case 'ready':
    case null:
      break
  }
  if (layers.every((layer) => !layer.referenceAvailable)) {
    return { state: 'not-displayed', reason: 'no-served-reference', layers }
  }
  if (layers.every((layer) => !layer.visibleReferenceAvailable)) {
    return { state: 'not-displayed', reason: 'hidden-by-selection', layers }
  }
  return { state: 'not-displayed', reason: 'unavailable', layers }
}

function epciNameFor(control: NonNullable<CahierSectionCaptureInput['control']>): string | null {
  const epciId = control.focal.epci
  if (!epciId) return null
  return control.territoires
    .find((candidate) => candidate.type === 'epci' && candidate.territoire === epciId)?.nom ?? null
}

function captureSources(evidence: ContentEvidence | null): readonly CahierCaptureSource[] {
  if (!evidence) return []
  const sources: CahierCaptureSource[] = []
  const seen = new Set<string>()
  const add = (source: CahierCaptureSource): void => {
    if (seen.has(source.identity)) return
    seen.add(source.identity)
    sources.push(source)
  }
  const addAedar = (source: AedarEvidenceSource | null): void => {
    if (source) add(aedarSourceCapture(source))
  }
  switch (evidence.kind) {
    case 'aedar-car-overview':
    case 'aedar-diversity-loss':
    case 'aedar-access':
    case 'aedar-equipment-profile':
    case 'aedar-equipment-explorer':
      addAedar(evidence.source)
      break
    case 'mobilite-networks':
    case 'mobilite-share':
    case 'mobilite-raccordement':
      for (const source of evidence.sources) add(contentSourceCapture(source))
      break
    case 'mobilite-stationnement-ravitaillement':
      for (const column of evidence.columns) {
        for (const source of column.sources) add(contentSourceCapture(source))
      }
      break
  }
  return sources
}

function contentSourceCapture(source: ContentSource): CahierCaptureSource {
  const url = source.url ?? null
  const licence = source.licence ?? null
  const displayVersion = source.displayVersion ?? null
  return {
    identity: [source.id, source.source, source.version, displayVersion, source.referenceDate,
      source.publicationDate, url, licence].join('\u0000'),
    id: source.id,
    label: source.source,
    version: source.version,
    displayVersion,
    referenceDate: source.referenceDate,
    publicationDate: source.publicationDate,
    url,
    licence,
    credit: null,
  }
}

function aedarSourceCapture(source: AedarEvidenceSource): CahierCaptureSource {
  const url = source.url || null
  const licence = source.licence ?? null
  const referenceDate = source.referenceDate ?? null
  const publicationDate = source.publicationDate ?? null
  const credit = source.credit ?? null
  return {
    // Display fields alone cannot identify a record: two AEDAR sources may show
    // the same attribution/vintage/URL while carrying different IDs, licences
    // or publication clocks.
    identity: ['aedar', source.sourceId ?? '', source.label, source.version, url, licence,
      referenceDate, publicationDate, credit].join('\u0000'),
    id: source.sourceId ?? null,
    label: source.label,
    version: source.version,
    displayVersion: null,
    referenceDate,
    publicationDate,
    url,
    licence,
    credit,
  }
}

function hasMapSurface(
  family: CahierCaptureFamily | null,
  evidence: ContentEvidence | null,
): boolean {
  if (family === 'aedar-car-overview' || family === 'aedar-diversity-loss') return true
  return family === 'mobilite-bars' && evidence?.kind === 'mobilite-networks'
}

/**
 * Map/legend state is published by the owning map plate. Before that
 * observation exists the capture says `unknown`; it never promotes a declared
 * map or an evidence flag into a loaded asset or a rendered legend.
 */
function captureMaps(options: {
  family: CahierCaptureFamily | null
  evidence: ContentEvidence | null
  publications: readonly CahierExportPublication[]
}): CahierCaptureMaps {
  const { family, evidence, publications } = options
  const published = publications.filter((publication) => publication.state.owner === 'map-availability')
  if (published.length === 0) {
    return hasMapSurface(family, evidence)
      ? { status: 'unknown', legend: 'unknown', items: [], legendDetail: null }
      : { status: 'none', legend: 'none', items: [], legendDetail: null }
  }
  const items = published.flatMap((publication) =>
    publication.state.owner === 'map-availability' ? publication.state.state.maps : [])
  const first = published[0]
  const legend = first?.state.owner === 'map-availability' ? first.state.state.legend : 'unknown'
  const legendDetail = first?.state.owner === 'map-availability'
    && first.state.state.legend === 'available'
    ? first.state.state.legendDetail ?? null
    : null
  return {
    status: mapStatus(items),
    legend,
    items: deepPlain(items),
    legendDetail: legendDetail ? deepPlain(legendDetail) : null,
  }
}

function mapStatus(items: readonly CahierCaptureMapItem[]): CahierCaptureMaps['status'] {
  if (items.length === 0) return 'unknown'
  const declared = items.filter((item) => item.declared)
  if (declared.length === 0) return 'unavailable'
  if (declared.every((item) => item.loaded && !item.unavailable)) return 'available'
  if (declared.every((item) => item.unavailable)) return 'unavailable'
  const loaded = declared.some((item) => item.loaded && !item.unavailable)
  const failed = declared.some((item) => item.unavailable)
  if (loaded && failed) return 'partial'
  return 'pending'
}

function captureFigures(options: {
  evidence: ContentEvidence
  family: CahierCaptureFamily
  input: CahierSectionCaptureInput
  publications: readonly CahierExportPublication[]
}): readonly CahierCaptureFigure[] {
  const { evidence, input, publications } = options
  switch (evidence.kind) {
    case 'aedar-car-overview':
      return [{
        family: 'aedar-car-overview',
        slot: 'overview',
        model: {
          horizonMinutes: evidence.horizonMinutes,
          mapModes: [...evidence.mapModes],
          mapFigureTitle: evidence.mapFigureTitle,
          scalarFigureTitle: evidence.scalarFigureTitle,
          scalars: evidence.scalars,
          sourcePending: evidence.sourcePending === true,
          comparisonLabel: evidence.comparisonLabel,
        },
      }]
    case 'aedar-diversity-loss':
      return [{
        family: 'aedar-diversity-loss',
        slot: 'maps',
        model: {
          horizonMinutes: evidence.horizonMinutes,
          mapFigureTitle: evidence.mapFigureTitle,
          maps: evidence.maps.map((map) => ({
            mode: map.mode,
            label: map.label,
            inlineAvailable: map.inlineAvailable,
            inspectionAvailable: map.inspectionAvailable,
          })),
          legend: evidence.legend,
          metadataState: evidence.metadataState,
          comparisonGroups: evidence.comparisonGroups.map((group) => ({ key: group.key, label: group.label })),
        },
      }]
    case 'aedar-access':
      return [{
        family: 'aedar-ramps',
        slot: 'ramps',
        model: {
          horizonMinutes: evidence.horizonMinutes,
          comparisonLabel: evidence.comparisonLabel,
          ramps: evidence.ramps,
        },
        effective: {
          modes: [...(input.aedar?.modes ?? [])],
        },
      }]
    case 'aedar-equipment-profile':
      return [{
        family: 'aedar-equipment-profile',
        slot: 'profile',
        model: {
          threshold: evidence.threshold,
          figureTitle: evidence.figureTitle,
          initialHorizonMinutes: evidence.initialHorizonMinutes,
          facts: evidence.facts,
        },
        effective: { horizonMinutes: input.aedar?.horizonMinutes ?? null },
      }]
    case 'aedar-equipment-explorer': {
      const explorer = explorerPublication(publications)
      return [{
        family: 'aedar-equipment-explorer',
        slot: CAHIER_EXPORT_SLOTS.aedarEquipment,
        model: {
          contentVersion: evidence.contentVersion,
          referenceContentVersion: evidence.referenceContentVersion,
          initialTypequ: evidence.initialTypequ,
          initialHorizonMinutes: evidence.initialHorizonMinutes,
          volumeFigureTitle: evidence.volumeFigureTitle,
          volumeYAxisTitle: evidence.volumeYAxisTitle,
          distributionFigureTitle: evidence.distributionFigureTitle,
          distributionAxisTitle: evidence.distributionAxisTitle,
          distributionYAxisTitle: evidence.distributionYAxisTitle,
          distributionValueUnit: evidence.distributionValueUnit,
          distributionDescription: evidence.distributionDescription,
          distributionUnavailableDescription: evidence.distributionUnavailableDescription,
          distributionStatistics: evidence.distributionStatistics.map((statistic) => ({
            key: statistic.key,
            label: statistic.label,
            axisLabel: statistic.axisLabel,
          })),
          comparisonRequestLabel: evidence.comparisonRequest?.label ?? null,
          referenceLabel: evidence.reference?.label ?? null,
          facts: evidence.facts,
        },
        effective: {
          typequ: explorer?.typequ ?? evidence.initialTypequ,
          typequLabel: explorer?.typequLabel ?? null,
          selectedDetail: explorer?.selectedDetail ?? null,
          detailStatus: explorer?.detailStatus ?? 'idle',
          modes: [...(input.aedar?.modes ?? [])],
          horizonMinutes: input.aedar?.horizonMinutes ?? null,
          comparisonStatus: explorer?.comparisonStatus ?? 'idle',
          comparisonError: explorer?.comparisonError ?? null,
          comparison: explorer?.comparison ?? null,
          referenceDetail: explorer?.referenceDetail ?? null,
        },
      }]
    }
    case 'mobilite-networks':
      return [{
        family: 'mobilite-bars',
        slot: 'bars',
        model: { figure: evidence.figure, ratio: null },
      }]
    case 'mobilite-stationnement-ravitaillement':
      return evidence.columns.map((column) => ({
        family: 'mobilite-bars' as const,
        slot: column.key,
        // `CahierMobiliteSection.vue`: two equal columns with
        // `column-gap: clamp(24px, 4vw, 56px)`; the approved desktop width
        // resolves the upper 56 px bound.
        row: { key: 'mobilite-paired', columns: 2, gapPx: 56 },
        model: { figure: column.bars, ratio: column.ratio },
      }))
    case 'mobilite-share':
      return [{
        family: 'mobilite-share',
        slot: 'share',
        model: {
          figureTitle: evidence.figureTitle,
          territoryName: evidence.territoryName,
          value: evidence.value,
          unit: evidence.unit,
          comparisonLabel: evidence.comparisonLabel,
          unavailableResources: evidence.unavailableResources ?? [],
          unavailableComparisons: evidence.unavailableComparisons ?? [],
        },
      }]
    case 'mobilite-raccordement':
      return [{
        family: 'mobilite-curve',
        slot: 'curve',
        model: {
          figureTitle: evidence.figureTitle,
          xAxisTitle: evidence.xAxisTitle,
          territoryName: evidence.territoryName,
          level: evidence.level,
          points: evidence.points,
          comparison: evidence.comparison
            ? {
              statistic: evidence.comparison.statistic,
              scope: evidence.comparison.scope,
              selectedMemberCount: evidence.comparison.selectedMemberCount,
              eligibleCount: evidence.comparison.eligibleCount,
              modelZeroReasonCounts: evidence.comparison.modelZeroReasonCounts,
              points: evidence.comparison.points,
            }
            : null,
          trajectory: evidence.trajectory,
          axis: evidence.axis,
          markerValue: evidence.markerValue,
          comparisonLabel: evidence.comparisonLabel,
          unavailableResources: evidence.unavailableResources ?? [],
          unavailableComparisons: evidence.unavailableComparisons ?? [],
        },
      }]
  }
}

export function projeterRequeteExport(
  capture: CahierExportCapture,
  modes: readonly string[],
): CahierExportProjection {
  const offered = capture.capabilities.selectableSeries
  if (offered.length === 0) {
    if (modes.length > 0) {
      return invalidProjection('unknown-mode',
        'Cette section ne propose aucune série à choisir pour le PDF.')
    }
    return {
      status: 'ready',
      request: Object.freeze({ capture, modes: Object.freeze([]), modeIds: Object.freeze([]) }),
    }
  }
  if (modes.length === 0) {
    return invalidProjection('no-modes', 'Choisissez au moins une série pour le PDF.')
  }
  if (new Set(modes).size !== modes.length) {
    return invalidProjection('duplicate-mode', 'Chaque série ne peut être choisie qu’une fois.')
  }
  if (modes.length > CAHIER_EXPORT_MAX_MODES) {
    return invalidProjection('too-many-modes',
      `Choisissez jusqu’à ${CAHIER_EXPORT_MAX_MODES} séries pour garder les tableaux lisibles.`)
  }
  const byId = new Map(offered.map((series) => [series.id, series]))
  if (modes.some((id) => !byId.has(id))) {
    return invalidProjection('unknown-mode', 'Série inconnue pour cette section.')
  }
  const request: CahierExportRequest = Object.freeze({
    capture,
    modes: Object.freeze(modes.map((id) => Object.freeze({ id, label: byId.get(id)!.label }))),
    modeIds: Object.freeze([...modes]),
  })
  return { status: 'ready', request }
}

function invalidProjection(
  reason: Extract<CahierExportProjection, { status: 'invalid' }>['reason'],
  message: string,
): CahierExportProjection {
  return Object.freeze({ status: 'invalid' as const, reason, message })
}
