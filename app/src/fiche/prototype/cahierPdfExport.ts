/**
 * Activation policy for the shared Cahier PDF action (#1023).
 *
 * The owner's 2026-11-16 decision is *wait for completeness*: required data,
 * maps, legends, acquired equipment and requested comparisons that are still
 * pending, unobserved or failed block the export. A source-contract absence
 * (an explicit empty selection, an ineligible comparison, a served no-reference
 * state, an unavailable cell) is not a failure and remains exportable with its
 * own honest wording.
 *
 * This module reads only #1021's immutable capture. It starts no acquisition,
 * mutates no screen control and owns no factual predicate: each state below is
 * the one the figure owner actually published.
 */
import type {
  CahierCaptureComparison,
  CahierCaptureFigure,
  CahierCaptureMaps,
  CahierExportCapture,
} from './cahierExportCapture'

export type CahierPdfActivationReason =
  | 'section-pending'
  | 'section-error'
  | 'section-unavailable'
  | 'source-pending'
  | 'map-unknown'
  | 'map-pending'
  | 'map-partial'
  | 'map-unavailable'
  | 'legend-unknown'
  | 'legend-pending'
  | 'legend-unavailable'
  | 'comparison-unobserved'
  | 'comparison-unresolved-selection'
  | 'comparison-loading'
  | 'comparison-error'
  | 'comparison-unavailable'
  | 'reference-unobserved'
  | 'reference-loading'
  | 'reference-error'
  | 'reference-unavailable'
  | 'equipment-loading'
  | 'equipment-error'
  | 'resource-unavailable'
  | 'comparison-resource-unavailable'
  | 'generator-unavailable'
  | 'capture-unavailable'

export type CahierPdfActivation =
  | { readonly ready: true }
  | {
      readonly ready: false
      readonly reason: CahierPdfActivationReason
      readonly message: string
    }

const MESSAGES: Readonly<Record<CahierPdfActivationReason, string>> = {
  'section-pending': 'Les données de cette section sont encore en cours de chargement.',
  'section-error': 'Les données de cette section n’ont pas pu être chargées.',
  'section-unavailable': 'Cette section n’a pas de contenu exportable.',
  'source-pending': 'La source de cette section est encore en cours de chargement.',
  'map-unknown': 'L’état des cartes de cette section n’est pas encore connu.',
  'map-pending': 'Une carte de cette section est encore en cours de chargement.',
  'map-partial': 'Une carte de cette section est incomplète.',
  'map-unavailable': 'Une carte de cette section n’est pas disponible.',
  'legend-unknown': 'L’état de la légende n’est pas encore connu.',
  'legend-pending': 'La légende de cette section est encore en cours de chargement.',
  'legend-unavailable': 'La légende de cette section n’est pas disponible.',
  'comparison-unobserved': 'L’état de la comparaison affichée n’est pas encore connu.',
  'comparison-unresolved-selection': 'Le groupe de comparaison n’a pas pu être résolu.',
  'comparison-loading': 'La comparaison affichée est encore en cours de chargement.',
  'comparison-error': 'La comparaison affichée n’a pas pu être chargée.',
  'comparison-unavailable': 'La comparaison affichée n’est pas disponible.',
  'reference-unobserved': 'L’état de la référence affichée n’est pas encore connu.',
  'reference-loading': 'La référence affichée est encore en cours de chargement.',
  'reference-error': 'La référence affichée n’a pas pu être chargée.',
  'reference-unavailable': 'La référence affichée n’est pas disponible.',
  'equipment-loading': 'L’équipement sélectionné est encore en cours de chargement.',
  'equipment-error': 'L’équipement sélectionné n’a pas pu être chargé.',
  'resource-unavailable': 'Une ressource de cette section n’est pas disponible.',
  'comparison-resource-unavailable': 'La comparaison demandée n’a pas pu être chargée.',
  'generator-unavailable': 'La génération du PDF n’est pas encore disponible.',
  'capture-unavailable': 'Cette section n’est pas prête pour l’export.',
}

function bloque(reason: CahierPdfActivationReason): CahierPdfActivation {
  return { ready: false, reason, message: MESSAGES[reason] }
}

export function messageActivationPdf(reason: CahierPdfActivationReason): string {
  return MESSAGES[reason]
}

function mapsBlockReason(maps: CahierCaptureMaps): CahierPdfActivationReason | null {
  switch (maps.status) {
    case 'unknown':
      return 'map-unknown'
    case 'pending':
      return 'map-pending'
    case 'partial':
      return 'map-partial'
    case 'unavailable':
      // A declared map that did not load is a failure; an undeclared map is the
      // source contract saying that no map is expected here.
      return maps.items.some((item) => item.declared) ? 'map-unavailable' : null
    case 'none':
    case 'available':
      return null
  }
}

function legendBlockReason(legend: CahierCaptureMaps['legend']): CahierPdfActivationReason | null {
  switch (legend) {
    case 'unknown':
      return 'legend-unknown'
    case 'pending':
      return 'legend-pending'
    case 'unavailable':
      return 'legend-unavailable'
    case 'none':
    case 'available':
      return null
  }
}

const IGNORED_DISPLAY_REASONS = new Set([
  'capability-absent',
  'not-eligible',
  'empty-selection',
  'hidden-by-user',
  'hidden-by-selection',
])

/**
 * Whether every published layer is actually drawn with a visible reference.
 * A reader who selected modes that carry no served reference does not wait for
 * a reference the figure will not draw, even if its acquisition is still busy.
 */
function layersHiddenBySelection(comparison: CahierCaptureComparison): boolean {
  const layers = comparison.display.layers
  return layers.length > 0
    && !layers.some((layer) => layer.displayed)
    && layers.every((layer) => !layer.visibleReferenceAvailable)
    && layers.some((layer) => layer.referenceAvailable)
}

/**
 * Whether the current comparison is actually requested and included, rather
 * than voluntarily hidden, explicitly empty, ineligible or absent because the
 * section carries no comparative evidence.
 */
function comparisonRelevant(comparison: CahierCaptureComparison): boolean {
  if (!comparison.capable || !comparison.eligible) return false
  if (comparison.absent === 'not-eligible'
    || comparison.absent === 'empty-selection'
    || comparison.absent === 'no-selection-control'
    || comparison.absent === 'no-comparative-evidence') return false
  if (layersHiddenBySelection(comparison)) return false
  return !IGNORED_DISPLAY_REASONS.has(comparison.display.reason)
}

function referenceBlockReason(
  comparison: CahierCaptureComparison,
): CahierPdfActivationReason | null {
  if (comparison.referenceStatus === null || !comparisonRelevant(comparison)) return null
  switch (comparison.referenceStatus) {
    case 'unobserved':
      return 'reference-unobserved'
    case 'loading':
      return 'reference-loading'
    case 'error':
      return 'reference-error'
    case 'unavailable':
      return 'reference-unavailable'
    case 'idle':
    case 'ready':
      return null
  }
}

function comparisonBlockReason(
  comparison: CahierCaptureComparison,
): CahierPdfActivationReason | null {
  if (!comparison.capable) return null
  if (comparison.absent === 'unresolved-selection') return 'comparison-unresolved-selection'

  const display = comparison.display
  if (display.state === 'unobserved') return 'comparison-unobserved'
  const hiddenBySelection = layersHiddenBySelection(comparison)
  if (display.state === 'not-displayed') {
    switch (display.reason) {
      case 'loading':
      case 'error':
      case 'unavailable': {
        if (hiddenBySelection) return null
        // #1021 keeps the aggregate comparison status and the direct-reference
        // status distinct. The display reason alone cannot say which one is
        // busy; the owner statuses do.
        if (comparison.status === display.reason) return `comparison-${display.reason}`
        if (comparison.referenceStatus !== null
          && comparison.referenceStatus === display.reason
          && comparisonRelevant(comparison)) {
          return `reference-${display.reason}`
        }
        return comparison.status === 'loading' || comparison.status === 'error'
          || comparison.status === 'unavailable'
          ? `comparison-${comparison.status}`
          : referenceBlockReason(comparison) ?? `comparison-${display.reason}`
      }
      case 'unpublished':
        return 'comparison-unobserved'
      default:
        break
    }
  }

  // The direct-reference status is the owner's separate observation. An
  // `unobserved` direct reference must never be read as `no-served-reference`.
  return referenceBlockReason(comparison)
}

interface FigureResourceFailures {
  readonly resources: readonly string[]
  readonly comparisons: readonly string[]
}

function figureResourceFailures(figure: CahierCaptureFigure): FigureResourceFailures {
  switch (figure.family) {
    case 'mobilite-bars':
      return {
        resources: figure.model.figure.unavailableResources ?? [],
        comparisons: figure.model.figure.unavailableComparisons ?? [],
      }
    case 'mobilite-share':
    case 'mobilite-curve':
      return {
        resources: figure.model.unavailableResources ?? [],
        comparisons: figure.model.unavailableComparisons ?? [],
      }
    default:
      return { resources: [], comparisons: [] }
  }
}

function figureBlockReason(
  capture: CahierExportCapture,
  comparison: CahierCaptureComparison,
): CahierPdfActivationReason | null {
  for (const figure of capture.figures) {
    if (figure.family === 'aedar-equipment-explorer') {
      if (figure.effective.detailStatus === 'loading') return 'equipment-loading'
      if (figure.effective.detailStatus === 'error') return 'equipment-error'
    }
    const failures = figureResourceFailures(figure)
    if (failures.resources.length > 0) return 'resource-unavailable'
    if (failures.comparisons.length > 0 && comparisonRelevant(comparison)) {
      return 'comparison-resource-unavailable'
    }
  }
  return null
}

/**
 * Decide whether the current capture may produce a complete PDF.
 *
 * The order is deliberate: a settled section body, a settled source clock, the
 * required map/legend surfaces, the acquired equipment, then the requested
 * comparison and its direct reference. The first unmet required state wins.
 */
export function evaluerDisponibiliteExportPdf(capture: CahierExportCapture): CahierPdfActivation {
  switch (capture.readiness.status) {
    case 'pending':
      return bloque('section-pending')
    case 'error':
      return bloque('section-error')
    case 'unavailable':
      return bloque('section-unavailable')
    case 'ready':
      break
  }

  for (const figure of capture.figures) {
    if (figure.family === 'aedar-car-overview' && figure.model.sourcePending) {
      return bloque('source-pending')
    }
  }

  const maps = capture.capabilities.maps
  const mapReason = mapsBlockReason(maps)
  if (mapReason) return bloque(mapReason)
  const legendReason = legendBlockReason(maps.legend)
  if (legendReason) return bloque(legendReason)

  const comparisonReason = comparisonBlockReason(capture.comparison)
  if (comparisonReason) return bloque(comparisonReason)

  const figureReason = figureBlockReason(capture, capture.comparison)
  if (figureReason) return bloque(figureReason)

  return { ready: true }
}
