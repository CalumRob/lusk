/**
 * #1025 — the overview scalar figure must survive in BOTH export routes.
 * The aside that owns prose also owns figure.aedar-car-overview-scalars; a
 * prose match that hides the whole aside would silently delete the scalars.
 */
import { describe, expect, it } from 'vitest'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { projeterRequeteExport } from '@/fiche/prototype/cahierExportCapture'
import { aedarOverviewScalarDisplayValue } from '@/fiche/prototype/aedarFigureReadings'
import { capturePdfFixture } from './helpers/cahierPdfFixtures'
import { composerCahierPdfNativedansNavigateur } from './helpers/cahierPdfNativeRuntime'

async function textOf(blob: Blob) {
  const pdf = await getDocument({ data: new Uint8Array(await blob.arrayBuffer()) }).promise
  const items = (await (await pdf.getPage(1)).getTextContent()).items
  return items.map((item) => ('str' in item ? item.str : '')).join(' ').replace(/\s+/g, ' ')
}

describe('overview scalars in every export route (#1025)', () => {
  const capture = capturePdfFixture('aedar-car-overview')
  const projection = projeterRequeteExport(capture, [])
  if (projection.status !== 'ready') throw new Error(projection.reason)

  it('keeps the scalar figure in the document route', async () => {
    const result = await composerCahierPdfNativedansNavigateur(projection.request, {
      signal: new AbortController().signal,
    })
    const text = await textOf(result.blob)
    expect(text).toMatch(/Diversité de l’offre accessible/i)
    // Assert the exact served scalar tokens, not "any digit".
    const evidence = capture.nativeRender!.content.units[0]!.sections[0]!.evidence as any
    const tokens = (evidence.scalars as readonly unknown[])
      .map((scalar) => aedarOverviewScalarDisplayValue(scalar as any))
      .filter((token) => token !== '—')
    expect(tokens.length).toBeGreaterThan(0)
    for (const token of tokens) expect(text).toContain(token)
  }, 60000)

  it('pins two served 1er/43 ranks when the overview comparison supplies them', async () => {
    const base = capturePdfFixture('aedar-car-overview')
    const figure = base.nativeRender!.content.units[0]!.sections[0]!.evidence as any
    const patched = capturePdfFixture('aedar-car-overview', {
      evidencePatch: {
        scalars: figure.scalars.map((scalar: any) => ({
          ...scalar, rank: 1, rankSize: 43, rankTies: 1,
        })),
      },
    })
    const projection = projeterRequeteExport(patched, [])
    if (projection.status !== 'ready') throw new Error(projection.reason)
    const result = await composerCahierPdfNativedansNavigateur(projection.request, {
      signal: new AbortController().signal,
    })
    const text = await textOf(result.blob)
    expect(text.match(/1er\/43/gu)).toHaveLength(2)
  }, 60000)

  it('exports a territory-mean reference with the approved em dash, no ranks', async () => {
    const base = capturePdfFixture('aedar-car-overview')
    const evidence = base.nativeRender!.content.units[0]!.sections[0]!.evidence as any
    const patched = capturePdfFixture('aedar-car-overview', {
      evidencePatch: {
        scalars: evidence.scalars.map((scalar: any) => ({
          ...scalar,
          reference: { kind: 'territory-mean', label: 'Moyenne — EPCI', value: 42, unit: '%' },
          rank: null, rankSize: null,
        })),
      },
    })
    const projection = projeterRequeteExport(patched, [])
    if (projection.status !== 'ready') throw new Error(projection.reason)
    const result = await composerCahierPdfNativedansNavigateur(projection.request, {
      signal: new AbortController().signal,
    })
    const text = await textOf(result.blob)
    // The territory-mean value is served (42) but no rank exists: the Rang
    // column uses the approved em dash instead of stranding the action.
    expect(text).toContain('42')
    expect(text).not.toMatch(/\d+(er|e|ème)?\/\d+/u)
    expect(text).toContain('—')
  }, 60000)

  it('never paints comparison loading-state chrome in the PDF', async () => {
    const { cahierExportHiddenSelectors } = await import('@/fiche/prototype/cahierExportSurface')
    for (const document of [true, false]) {
      expect(cahierExportHiddenSelectors(document).join(' '))
        .toContain('.cahier-comparison-value__state')
    }
  })

  // The figure (body-only) route is covered behaviourally in
  // cahier-pdf-realdata-defects.spec.ts: the overview aside with its scalar
  // figure is mounted in both routes and the scalars survive the reflow pass.
  // A body-route PDF cannot be generated in happy-dom: native raster decode
  // needs a real browser, which the document-route helper provides.
})
