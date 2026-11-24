/**
 * #1025 — screen plate indices (01/02/03/04) must stay out of the export text
 * layer. The production hide list is unit-tested here; rendered raster/text
 * overlap remains browser-level acceptance coverage.
 */
import { describe, expect, it } from 'vitest'

import { cahierExportHiddenSelectors } from '@/fiche/prototype/cahierExportSurface'
import { PDF_FIXTURE_SECTION_KEYS, capturePdfFixture, readyPublications, type PdfFixtureSectionKey } from './helpers/cahierPdfFixtures'

const PLATE_INDEX_ROLES = [
  '.map-panel-number', '.blank-map-slot__number', '.aedar-diversity-loss-map__number',
] as const

/** Plate-bearing sections derive from the captures, never from a hardcoded list. */
function plateBearingKeys(): PdfFixtureSectionKey[] {
  return PDF_FIXTURE_SECTION_KEYS.filter((key) => {
    const capture = capturePdfFixture(key, { publications: readyPublications(key) })
    return capture.capabilities.maps.items.some(
      (item) => item.declared && item.loaded && item.inlineUrl !== null)
  })
}

describe('no invisible plate indices in the export (#1025)', () => {
  it('keeps every plate-index role in the mount hide list and derives plate sections', () => {
    const hidden = [true, false].map((document) => cahierExportHiddenSelectors(document).join(' '))
    for (const role of PLATE_INDEX_ROLES) {
      for (const [index, css] of hidden.entries()) {
        expect(css, `${role} no longer hidden in ${index === 0 ? 'document' : 'figure'} route`).toContain(role)
      }
    }
    const plates = plateBearingKeys()
    expect(plates.length, 'no plate-bearing section derived from the captures').toBeGreaterThan(0)
    expect(plates.length).toBeLessThan(PDF_FIXTURE_SECTION_KEYS.length)
  })
})
