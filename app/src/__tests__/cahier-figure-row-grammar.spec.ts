/**
 * #1024 — the native paired-row grammar has one owner.
 *
 * CSS cannot import TypeScript, so this contract test is what keeps the screen
 * clause and `CAHIER_FIGURE_ROW` identical: the SFC's own `column-gap:
 * clamp(...)` is parsed from its source and compared with the shared owner, and
 * the shared resolver is checked against the clause at several host widths.
 * A change to either side fails here instead of silently changing the PDF.
 */
import { describe, expect, it } from 'vitest'

import sectionSource from '@/fiche/prototype/CahierMobiliteSection.vue?raw'
import { CAHIER_FIGURE_ROW, figureRowLayout } from '@/fiche/prototype/cahierFigureNativeGeometry'

/** The one responsive clause of `.mobilite-paired`. */
function clausePaire(): { minimum: number; vw: number; maximum: number } {
  const bloc = /\.mobilite-paired\s*\{([^}]*)\}/.exec(sectionSource)
  if (!bloc) throw new Error('Bloc .mobilite-paired introuvable dans la section Mobilité.')
  const gap = /column-gap:\s*clamp\(\s*(\d+)px\s*,\s*([\d.]+)vw\s*,\s*(\d+)px\s*\)/.exec(bloc[1]!)
  if (!gap) throw new Error('La clause column-gap: clamp(…) de .mobilite-paired est introuvable.')
  return { minimum: Number(gap[1]), vw: Number(gap[2]), maximum: Number(gap[3]) }
}

describe('#1024 — rangée appairée native', () => {
  it('garde la même clause responsive dans la feuille et dans l’owner', () => {
    const clause = clausePaire()
    expect(clause).toEqual({
      minimum: CAHIER_FIGURE_ROW.gap.minimumPx,
      vw: CAHIER_FIGURE_ROW.gap.viewportVw,
      maximum: CAHIER_FIGURE_ROW.gap.maximumPx,
    })
  })

  it('garde deux colonnes égales', () => {
    const colonnes = /grid-template-columns:\s*repeat\(\s*2\s*,\s*minmax\(0,\s*1fr\)\s*\)/
    const bloc = /\.mobilite-paired\s*\{([^}]*)\}/.exec(sectionSource)!
    expect(colonnes.test(bloc[1]!)).toBe(true)
    expect(CAHIER_FIGURE_ROW.columns).toBe(2)
  })

  it('résout la borne au viewport de lecture et suit la même règle ailleurs', () => {
    const clause = clausePaire()
    const attendu = (viewport: number) => Math.min(
      clause.maximum,
      Math.max(clause.minimum, (clause.vw * viewport) / 100),
    )
    for (const viewport of [320, 760, 1024, 1280, 1400, 1440, 1800]) {
      expect(figureRowLayout(viewport).gapPx).toBeCloseTo(attendu(viewport), 6)
      expect(figureRowLayout(viewport).columns).toBe(CAHIER_FIGURE_ROW.columns)
    }
    // The export always reads the approved desktop layout, never a live window.
    expect(figureRowLayout()).toEqual({
      columns: CAHIER_FIGURE_ROW.columns,
      viewportPx: CAHIER_FIGURE_ROW.desktopViewportPx,
      gapPx: attendu(CAHIER_FIGURE_ROW.desktopViewportPx),
    })
  })
})
