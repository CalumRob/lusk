/**
 * #1025 real-data review regressions.
 *
 * Three defects were found by reading the exported PDFs against the mounted
 * screen: lost numeric separators in native figure text, crowded dense tables
 * whose raw cells were measured with the wrong role and whose `¹` marker
 * overflowed its column, and a map legend pressed against the plate edge. Each
 * fix is owned by the module that produces the ink; these checks keep the
 * seam honest without duplicating its logic in the composer.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { formatTimeRampNumber } from '@/fiche/prototype/cahierFigureReadings'
import { ROLE_PDF } from '@/fiche/prototype/cahierPdfGrammaire'
import { roleCelluleTableau } from '@/fiche/prototype/cahierPdfTableau'

const read = (relative: string) => readFileSync(join(process.cwd(), relative), 'utf-8')

describe('real-data PDF defect regressions (#1025)', () => {
  it('measures a raw/Mode cell with the same role the composer paints it with', () => {
    // A flat access table wraps `Transports en commun` in the Mode cell. The
    // painter uses the row-label role for raw cells; measuring them at the
    // smaller value role understated the line count and let the second line
    // cross the row separator.
    expect(roleCelluleTableau(true)).toEqual(ROLE_PDF.libelleTableau)
    expect(roleCelluleTableau(false)).toEqual(ROLE_PDF.valeurTableau)
  })

  it('wraps a compared header to the cell minus its appended ¹ marker', () => {
    const source = read('src/fiche/prototype/cahierPdfTableau.ts')
    expect(source).toMatch(/mesurerEntete\(item\.column, width - item\.marque/u)
    expect(source).toMatch(/marque: marqueComparaison/u)
  })

  it('keeps grouping separators visible in DOM-painted figure text', () => {
    // U+202F has no glyph in the embedded static face and is narrower than its
    // DOM advance, so the next digit overprinted it. A normal space advances
    // identically in both engines and survives the char-by-char painter.
    expect(formatTimeRampNumber(6440)).toBe('6 440')
    expect(formatTimeRampNumber(12881)).toBe('12 881')
    expect(formatTimeRampNumber(2.17)).toBe('2,2')
    expect(formatTimeRampNumber(6440)).not.toMatch(/[\u202f\u00a0]/u)
    const legend = read('src/fiche/prototype/CahierContinuousMapLegend.vue')
    expect(legend).toContain('\\u202f')
  })

  it('scopes export reflow to owner-declared layout containers only', () => {
    const surface = read('src/fiche/prototype/cahierExportSurface.ts')
    const native = read('src/fiche/prototype/cahierNativePdf.ts')
    expect(surface).toContain("layoutHook: 'data-cahier-export-layout'")
    expect(surface).toMatch(/\[\$\{surface\.layoutHook\}/u)
    expect(surface).toMatch(/repeat\(\$\{visible\.length\}/u)
    expect(native).toContain('reflowVisibleFigureTracks(root)')
    // Exactly one mechanism: no layout class-name rule remains in the shell.
    expect(native).not.toContain('figure-spread')
    expect(native).not.toContain('mobilite-section-spread')
    // Declared by the owning components, never by an internal figure grid.
    for (const file of ['VarianteCahierLibre.vue', 'CahierMobiliteSection.vue',
      'AedarDiversityLossMapsCahier.vue', 'CahierAedarAccessSection.vue']) {
      expect(read(`src/fiche/prototype/${file}`), file).toContain('data-cahier-export-layout')
    }
  })

  it('keeps the row-dimension header on the measured subheader block', () => {
    const composer = read('src/fiche/prototype/cahierPdfComposer.ts')
    // The row dimension used to be centred across the group band + subheader
    // band, leaving `Statistique` on a line above its one-line peers. It now
    // starts on the single-line subheader block, while each column still
    // centres its own wrapped block inside its header cell.
    expect(composer).toMatch(/const hautBlocEntete = sousEnteteTop \+ centreDans\(part\.headerHeight, 1, hauteurLigneEntete\)/u)
    expect(composer).toMatch(/texte\(doc, part\.rowHeader, x \+ 1, hautBlocEntete/u)
    expect(composer).toMatch(/centreDans\(part\.headerHeight, colonne\.headerLines\.length, hauteurLigneEntete\)/u)
  })

  it('gives the continuous map legend its own measured band below the plate', () => {
    const slots = read('src/fiche/prototype/CahierBlankMapSlots.vue')
    const legend = read('src/fiche/prototype/CahierContinuousMapLegend.vue')
    // Not the old fixed 8px that vanished when the figure was projected to A4.
    expect(slots).toMatch(/\.blank-map-slots__legend-grid\s*\{[^}]*margin-top:\s*clamp\(/u)
    expect(legend).toMatch(/\.cahier-map-legend\s*\{[^}]*gap:\s*6px/u)
    expect(legend).toMatch(/\.cahier-map-legend__title\s*\{[^}]*line-height:\s*1\.35/u)
  })
})
