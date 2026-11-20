/**
 * #1025 — owner-accepted diversity-loss plate geometry.
 *
 * The export shell does NOT reflow the diversity comparison row (an internal
 * figure grid). Its owner CSS `repeat(auto-fit, minmax(0, 1fr))` collapses the
 * prose track itself. On 2026-11-20 the owner accepted the resulting geometry:
 * four plates of 185.09 pt with an 80.02 pt gap, replacing 171.64 / 16.82.
 * This regression fails if either the shell or the owner CSS changes it again.
 */
import { describe, expect, it } from 'vitest'
import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { projeterRequeteExport } from '@/fiche/prototype/cahierExportCapture'
import { capturePdfFixture } from './helpers/cahierPdfFixtures'
import { composerCahierPdfNativedansNavigateur } from './helpers/cahierPdfNativeRuntime'

async function platePlacements(territory: { id: string; name: string }) {
  const capture = capturePdfFixture('aedar-diversity-loss', {
    evidencePatch: { territory: {
      ...territory, code: territory.id, territory_id: territory.id, territory_type: 'commune',
    } },
  })
  const projection = projeterRequeteExport(capture, [])
  if (projection.status !== 'ready') throw new Error(projection.reason)
  const result = await composerCahierPdfNativedansNavigateur(projection.request, {
    signal: new AbortController().signal,
  })
  const pdf = await getDocument({ data: new Uint8Array(await result.blob.arrayBuffer()) }).promise
  const ops = await (await pdf.getPage(1)).getOperatorList()
  let ctm = [1, 0, 0, 1, 0, 0]
  const plates: { x: number; width: number }[] = []
  for (let i = 0; i < ops.fnArray.length; i += 1) {
    if (ops.fnArray[i] === OPS.transform) ctm = ops.argsArray[i]
    else if (ops.fnArray[i] === OPS.paintImageXObject) {
      plates.push({ x: ctm[4], width: Math.abs(ctm[0]) })
    }
  }
  return { plates }
}

describe('accepted diversity-loss geometry (#1025)', () => {
  for (const territory of [
    { id: '35238', name: 'Rennes' },
    { id: '22001', name: 'Allineuc' },
  ]) {
    it(`keeps four 185.09 pt plates with an 80.02 pt gap — ${territory.name}`, async () => {
      const { plates } = await platePlacements(territory)
      expect(plates).toHaveLength(4)
      for (const plate of plates) expect(plate.width).toBeCloseTo(185.09, 1)
      const columns = [...new Set(plates.map((plate) => +plate.x.toFixed(2)))].sort((a, b) => a - b)
      expect(columns).toHaveLength(2)
      expect(columns[0]).toBeCloseTo(72.54, 1)
      expect(columns[1]).toBeCloseTo(337.65, 1)
      expect(columns[1]! - columns[0]! - 185.09).toBeCloseTo(80.02, 1)
      // Two plates per column, identical geometry in both rows.
      expect(plates.filter((plate) => plate.x === plates[0]!.x)).toHaveLength(2)
      // The accepted block stays centred on the A4 body (297.64 pt).
      const blockCentre = (Math.min(...plates.map((p) => p.x))
        + Math.max(...plates.map((p) => p.x + p.width))) / 2
      expect(blockCentre).toBeCloseTo(297.64, 1)
    }, 60000)
  }
})
