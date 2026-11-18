/**
 * Test-only options builder for the retired figure-painter specs. Production
 * no longer has a painter options middle-man: figure bodies come from the
 * native mount. Kept here solely so the legacy geometry audits can still be
 * read without importing a production helper that nothing uses.
 */
import { preuveFigureComparative } from '../../fiche/prototype/cahierPdfComposer'
import type { CahierCaptureFigure } from '../../fiche/prototype/cahierExportCapture'
import type { CahierFigureProjection } from '../../fiche/prototype/cahierExportAdapters'

export function optionsFigurePdf(request: { capture: import('../../fiche/prototype/cahierExportCapture').CahierExportCapture },
  projection: CahierFigureProjection) {
  const capture = request.capture
  const parSlot = <F extends CahierCaptureFigure['family']>(family: F) => capture.figures.find(
    (figure): figure is Extract<CahierCaptureFigure, { family: F }> => (
      figure.family === family && figure.slot === projection.slot),
  )
  const bars = parSlot('mobilite-bars')
  const curve = parSlot('mobilite-curve')
  const explorer = parSlot('aedar-equipment-explorer')
  return {
    comparisonProof: preuveFigureComparative(projection, capture),
    ...(explorer ? {
      distributionTitle: explorer.model.distributionFigureTitle,
      distributionUnit: explorer.model.distributionValueUnit,
      explorerTypequLabel: explorer.effective.typequLabel,
    } : {}),
    ...(bars ? { modeleBars: bars.model.figure } : {}),
    ...(curve ? { modeleCourbe: curve.model } : {}),
  }
}
