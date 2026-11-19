/**
 * Test-only paired-figure-row measurement for the PDF closure receipt.
 *
 * This lived in the screen-owning `cahierFigureNativeGeometry.ts`, which forced
 * a test-only dependency on the PDF font grammar (a screen→PDF import inversion).
 * It is kept here so the screen module imports no PDF code. Values are unchanged.
 */
import { mmDepuisCssPx } from '@/fiche/prototype/cahierPdfGrammaire'
import type { FigureRowLayout } from '@/fiche/prototype/cahierFigureNativeGeometry'

/** Measured gap between two side-by-side native figure panels, in mm. */
export const GAP_PANNEAUX_FIGURE_MM = 6

export function figureRowGeometry(
  largeurDisponible: number,
  layout: FigureRowLayout,
): {
  readonly columns: number
  readonly panelWidth: number
  readonly gap: number
  readonly figureWidthPx: number
} {
  const { columns, gapPx } = layout
  const contenuPx = largeurDisponible / mmDepuisCssPx(1)
  const figureWidthPx = (contenuPx - gapPx * (columns - 1)) / columns
  if (!(figureWidthPx > 0)) {
    throw new Error('Largeur de colonne native nulle : la rangée appairée ne peut pas être peinte.')
  }
  const ratio = gapPx / figureWidthPx
  const panelWidth = largeurDisponible / (columns + (columns - 1) * ratio)
  return { columns, panelWidth, gap: panelWidth * ratio, figureWidthPx }
}
