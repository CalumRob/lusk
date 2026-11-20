/**
 * #1025 — no selectable-but-invisible text under an export raster.
 * Screen plate indices (01/02/03/04) used to sit inside the map image box;
 * the image painted over them, so a render showed blank paper while the PDF
 * text layer still exposed the digits. The export hides those screen indices.
 */
import { describe, expect, it } from 'vitest'
import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { projeterRequeteExport } from '@/fiche/prototype/cahierExportCapture'
import { PDF_FIXTURE_SECTION_KEYS, capturePdfFixture, readyPublications, type PdfFixtureSectionKey } from './helpers/cahierPdfFixtures'
import { composerCahierPdfNativedansNavigateur } from './helpers/cahierPdfNativeRuntime'

async function inspect(key: PdfFixtureSectionKey) {
  const capture = capturePdfFixture(key, { publications: readyPublications(key) })
  const modes = capture.capabilities.selectableSeries.slice(0, 3).map((serie) => serie.id)
  const projection = projeterRequeteExport(capture, modes)
  if (projection.status !== 'ready') throw new Error(`${key}: ${projection.reason}`)
  const result = await composerCahierPdfNativedansNavigateur(projection.request, {
    signal: new AbortController().signal,
  })
  const pdf = await getDocument({ data: new Uint8Array(await result.blob.arrayBuffer()) }).promise
  const page = await pdf.getPage(1)
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
  return { images: images.length, indices: items.length, hidden: hidden.map((item) => (item as { str: string }).str) }
}

describe('no invisible plate indices in the export (#1025)', () => {
  it('keeps no two-digit text inside a raster box in any figure', async () => {
    for (const key of PDF_FIXTURE_SECTION_KEYS) {
      const result = await inspect(key)
      expect(result.hidden, `${key}: ${result.hidden.join(', ')}`).toEqual([])
    }
  }, 300000)
})
