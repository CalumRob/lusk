/**
 * #1025 — no selectable-but-invisible text under an export raster.
 * Screen plate indices (01/02/03/04) used to sit inside the map image box;
 * the image painted over them, so a render showed blank paper while the PDF
 * text layer still exposed the digits. The export hides those screen indices.
 *
 * The default run keeps a fast structural check. Rendering nine real PDFs
 * through spawned Chromium is opt-in with `LUSK_WRITE_REVIEW_PDFS=1`, the same
 * gate the other review-export specs use, so CI stays quick.
 */
import { describe, expect, it } from 'vitest'
import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { cahierExportHiddenSelectors } from '@/fiche/prototype/cahierExportSurface'
import { projeterRequeteExport } from '@/fiche/prototype/cahierExportCapture'
import { PDF_FIXTURE_SECTION_KEYS, capturePdfFixture, readyPublications, type PdfFixtureSectionKey } from './helpers/cahierPdfFixtures'
import { composerCahierPdfNativedansNavigateur } from './helpers/cahierPdfNativeRuntime'

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

async function inspect(key: PdfFixtureSectionKey) {
  const capture = capturePdfFixture(key, { publications: readyPublications(key) })
  const plateBearing = capture.capabilities.maps.items.some(
    (item) => item.declared && item.loaded && item.inlineUrl !== null)
  const modes = capture.capabilities.selectableSeries.slice(0, 3).map((serie) => serie.id)
  const projection = projeterRequeteExport(capture, modes)
  if (projection.status !== 'ready') throw new Error(`${key}: ${projection.reason}`)
  const result = await composerCahierPdfNativedansNavigateur(projection.request, {
    signal: new AbortController().signal,
  })
  const pdf = await getDocument({ data: new Uint8Array(await result.blob.arrayBuffer()) }).promise
  const pages: { images: number; indices: number; hidden: string[] }[] = []
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber)
    const ops = await page.getOperatorList()
    const images: { x: number; y: number; w: number; h: number }[] = []
    let ctm = [1, 0, 0, 1, 0, 0]
    for (let i = 0; i < ops.fnArray.length; i += 1) {
      if (ops.fnArray[i] === OPS.transform) ctm = ops.argsArray[i]
      else if (ops.fnArray[i] === OPS.paintImageXObject) {
        images.push({ x: ctm[4], y: ctm[5], w: Math.abs(ctm[0]), h: Math.abs(ctm[3]) })
      }
    }
    const items = (await page.getTextContent()).items.filter((item) =>
      'str' in item && 'transform' in item && /^\d{2}$/u.test((item.str as string).trim()))
    const hidden = items.filter((item) => {
      if (!('transform' in item)) return false
      const x = (item.transform as number[])[4], y = (item.transform as number[])[5]
      return images.some((box) => x >= box.x && x <= box.x + box.w && y >= box.y && y <= box.y + box.h)
    })
    pages.push({
      images: images.length,
      indices: items.length,
      hidden: hidden.map((item) => (item as { str: string }).str),
    })
  }
  return { plateBearing, numPages: pdf.numPages, pages }
}

describe('no invisible plate indices in the export (#1025)', () => {
  // Fast default gate: the hide list and the plate-bearing derivation stay in
  // place even when the Chromium matrix is not run.
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

  it.skipIf(process.env.LUSK_WRITE_REVIEW_PDFS !== '1')(
    'renders no two-digit text inside a raster on any page of any plate-bearing section',
    async () => {
      const plateSections: string[] = []
      for (const key of PDF_FIXTURE_SECTION_KEYS) {
        const result = await inspect(key)
        expect(result.numPages, `${key}: export has no pages`).toBeGreaterThan(0)
        if (result.plateBearing) {
          plateSections.push(key)
          // A plate-less render would make the "no index inside a raster" check
          // vacuous. Require EVERY derived plate-bearing section to actually
          // raster across ALL its pages, not just page 1 of a hardcoded subset.
          const images = result.pages.reduce((sum, page) => sum + page.images, 0)
          expect(images, `${key}: no raster image in any of ${result.numPages} pages`).toBeGreaterThan(0)
        }
        for (const [index, page] of result.pages.entries()) {
          const where = `${key} page ${index + 1}/${result.numPages}`
          // A page carrying two-digit indices with no raster would make its
          // per-page check vacuous (a continuation page carrying neither is fine).
          if (result.plateBearing && page.indices > 0) {
            expect(page.images, `${where}: indices but no raster beneath them`).toBeGreaterThan(0)
          }
          expect(page.hidden, `${where}: ${page.hidden.join(', ')}`).toEqual([])
        }
      }
      expect(plateSections, 'no plate-bearing section derived from the captures').toEqual(plateBearingKeys())
    }, 300000)
})
