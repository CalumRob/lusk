/**
 * Review-PDF generator for the #1024 native-switch handoff (not a normal test).
 * Set LUSK_WRITE_REVIEW_PDFS=1 to emit one real PDF per section plus a PNG
 * render into a new uniquely named folder under the worktree. The native mount
 * reads `capture.nativeRender.content`, so the populated synthetic inputs are
 * applied as evidence patches (both the DOM figures and the B tables use them).
 * Every served value below is synthetic and labelled as such in the manifest;
 * no genuine owner map or published statistic is claimed.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { projeterRequeteExport } from '@/fiche/prototype/cahierExportCapture'
import { comparisonLabelFor, raccordementProse } from '@/fiche/content/mobiliteSections'
import { capturePdfFixture, captureProfilRangsDense } from './helpers/cahierPdfFixtures'
import { cahierExportFixture, sectionOf } from './helpers/cahierExportFixtures'
import { composerCahierPdfNativedansNavigateur, rendrePngNatif } from './helpers/cahierPdfNativeRuntime'

const OUT = path.resolve('..', 'evidence-1034-native-switch-review7-waffle-20261118')

const MODES = ['car', 'transit', 'bike_lts2', 'bike_lts4', 'walk']
const CUTS = [5, 10, 15, 20, 25, 30]

function populatedAccess(evidence: any) {
  return {
    ...evidence,
    ramps: evidence.ramps.map((ramp: any, index: number) => ({
      ...ramp,
      xAxis: { ...ramp.xAxis, values: CUTS, labels: CUTS.map((cut) => `${cut} min`) },
      territory: Object.fromEntries(MODES.map((mode, modeIndex) => [mode,
        CUTS.map((_, cutIndex) => Number((1.4 * (index + 1) + 1.8 * modeIndex + 0.7 * cutIndex).toFixed(2))),
      ])),
      reference: Object.fromEntries(MODES.map((mode, modeIndex) => [mode,
        CUTS.map((_, cutIndex) => Number((0.8 * (index + 1) + 1.1 * modeIndex + 0.5 * cutIndex).toFixed(2))),
      ])),
      // Served ranks on the visible modes exercise the Rang column in PDF.
      referenceRanks: Object.fromEntries(MODES.map((mode) => [mode,
        CUTS.map((_, cutIndex) => ({ position: cutIndex % 2 === 0 ? 1 : 2, size: 2, ties: null })),
      ])),
    })),
  }
}

function populatedOverview(evidence: any) {
  return {
    ...evidence,
    scalars: (evidence.scalars as any[]).map((scalar, index) => ({
      ...scalar,
      value: index === 0 ? 6.4 : 18.2,
      reference: {
        kind: 'territory-mean',
        territory: { type: 'epci', id: 'test-epci', name: 'EPCI X' },
        label: 'communes de EPCI X',
        value: index === 0 ? 5.1 : 14.6,
        unit: scalar.unit,
      },
      // Served ranks in the exact fields `aedarOverviewScalarRank` reads.
      rank: index + 1,
      rankSize: 2,
      rankTies: null,
      rankDirection: index === 0 ? 'high' : 'high',
    })),
  }
}

function populatedStationnement(evidence: any) {
  const values: Record<string, number[]> = {
    stationnement: [12.4, 48.2],
    ravitaillement: [3.6, 7.9],
  }
  const columns = (evidence.columns as any[]).map((column) => ({
    ...column,
    bars: {
      ...column.bars,
      categories: (column.bars.categories as any[]).map((category, index) => ({
        ...category,
        value: {
          ...category.value,
          fact: {
            ...category.value.fact,
            value: values[column.key]?.[index] ?? 4,
            comparison: {
              ...category.value.fact.comparison,
              reference: { kind: 'median', value: (values[column.key]?.[index] ?? 4) * 0.8 },
              rank: { position: index + 1, size: 2, ties: null },
            },
          },
        },
      })),
    },
  }))
  // Recompute the OWNER label with the same producer function used by the real
  // section builder. The base fixture's label was frozen before these served
  // references existed, hence its stale "Comparaison indisponible — …" text.
  const servedLabel = comparisonLabelFor(
    columns.flatMap((column) => (column.bars.categories as any[]).map((category) => category.value)),
    cahierExportFixture({}).content.territory,
  )
  return {
    ...evidence,
    columns: columns.map((column) => ({
      ...column,
      bars: { ...column.bars, comparisonLabel: servedLabel ?? column.bars.comparisonLabel },
    })),
  }
}

function populatedCurve(evidence: any) {
  // Only the served values change; the owner's axis, trajectory and comparison
  // contracts stay exactly as published by the native content producer.
  const markerValue = {
    ...evidence.markerValue,
    fact: {
      ...evidence.markerValue.fact,
      // The served rank belongs to the declared trajectory marker; the base
      // fixture left this fact's detail empty, so no rank could be read.
      detail: evidence.trajectory.marker.detail,
      value: 0.13,
      comparison: {
        ...evidence.markerValue.fact.comparison,
        reference: { kind: 'mean', value: 0.16 },
        rank: { position: 1, size: 2, ties: null },
      },
    },
  }
  // Recompute the owner's prose through the same builder the screen uses: the
  // frozen fixture's sentence still describes the old 0 % marker value.
  const prose = raccordementProse(
    { territory: { type: 'commune' } } as any,
    markerValue as any,
    evidence.trajectory.marker.label,
    true,
  )
  return {
    ...evidence,
    prose,
    // The curve reader draws the peer series from `figure.comparison.points`
    // and the served rank from `figure.markerValue.fact.comparison`, not from
    // per-point comparison fields. Patch those owner-owned shapes explicitly.
    comparison: {
      ...evidence.comparison,
      points: (evidence.comparison.points as any[]).map((point, index, all) => ({
        ...point,
        fact: { ...point.fact, value: Number((0.21 * index / (all.length - 1)).toFixed(4)) },
      })),
    },
    markerValue,
    points: (evidence.points as any[]).map((point, index, all) => ({
      ...point,
      fact: { ...point.fact, value: Number((0.26 * index / (all.length - 1)).toFixed(4)) },
    })),
  }
}

const SECTIONS = [
  { key: 'aedar-access', patch: populatedAccess, modes: ['car', 'bike_lts2'] },
  { key: 'aedar-car-overview', patch: populatedOverview, modes: [] as string[] },
  { key: 'stationnement-ravitaillement', patch: populatedStationnement, modes: [] as string[] },
  { key: 'visiter-la-bretagne', patch: populatedCurve, modes: [] as string[] },
] as const

describe('native-switch review PDFs (opt-in)', () => {
  it.skipIf(process.env.LUSK_WRITE_REVIEW_PDFS !== '1')('emit one PDF and PNG per named section', async () => {
    mkdirSync(OUT, { recursive: true })
    const manifest: unknown[] = []
    for (const section of SECTIONS) {
      const base = sectionOf(cahierExportFixture({}).content, section.key as any).evidence
      const capture = capturePdfFixture(section.key as any, { evidencePatch: section.patch(base) } as any)
      const offered = capture.capabilities.selectableSeries.map((serie) => serie.id)
      const modes = section.modes.length ? section.modes : offered.slice(0, 3)
      const projection = projeterRequeteExport(capture, modes)
      if (projection.status !== 'ready') throw new Error(`${section.key}: ${projection.reason}`)
      const result = await composerCahierPdfNativedansNavigateur(projection.request, {
        signal: new AbortController().signal,
        urlAccueil: 'https://lusk.test/',
        urlPublique: 'https://lusk.test/territoire/commune/22001',
      })
      const bytes = new Uint8Array(await result.blob.arrayBuffer())
      writeFileSync(path.join(OUT, `${section.key}.pdf`), bytes)
      const pdf = await getDocument({ data: Uint8Array.from(bytes) }).promise
      const page = await pdf.getPage(1)
      const pages = pdf.numPages
      if (section.key === 'visiter-la-bretagne') {
        const text = ((await page.getTextContent()).items as any[]).map((item) => item.str ?? '').join(' ')
        // Owner decision: no prose in exports — including the recomputed
        // marker sentence. The figure/table still carry the served values.
        expect(text).not.toMatch(/\d+ % de la population bretonne est joignable/)
        expect(text).toContain('1er/2')
      }
      if (section.key === 'stationnement-ravitaillement') {
        const text = ((await page.getTextContent()).items as any[]).map((item) => item.str ?? '').join(' ')
        expect(text).not.toContain('Comparaison indisponible')
        expect(text).toContain('Médiane des communes de EPCI X')
      }
      const allText: string[] = []
      for (let pageNumber = 1; pageNumber <= pages; pageNumber += 1) {
        const suffix = pages === 1 ? '' : `-p${pageNumber}`
        const current = await pdf.getPage(pageNumber)
        allText.push(((await current.getTextContent()).items as any[]).map((item) => item.str ?? '').join(' '))
        writeFileSync(path.join(OUT, `${section.key}${suffix}.png`), await rendrePngNatif(bytes, 1.7, pageNumber))
      }
      // Every review section serves a comparison, so its exported Rang column
      // must carry at least one served rank (not a row of em dashes).
      expect(allText.join(' '), `${section.key} Rang`).toMatch(/\d+(?:er|e|ème)?\/\d+/)
      manifest.push({ key: section.key, file: `${section.key}.pdf`, pages,
        pngs: Array.from({ length: pages }, (_, i) => `${section.key}${pages === 1 ? '' : `-p${i + 1}`}.png`),
        bytes: bytes.length, modes, populated: 'synthetic native inputs applied as evidence patch' })
      expect(bytes.length).toBeGreaterThan(1000)
    }
    // Dense profile: a single native body taller than the useful area must
    // continue across real A4 pages at the fixed scale.
    const dense = captureProfilRangsDense() as any
    // The producer-shaped 40-type matrix was added to `figures`; freeze the
    // SAME matrix into the native snapshot so the mounted waffle has 40 tiles.
    dense.nativeRender.content.units[0].sections[0].evidence.facts = dense.figures
      .find((figure: any) => figure.family === 'aedar-equipment-profile').model.facts
    const denseProjection = projeterRequeteExport(dense, [])
    if (denseProjection.status !== 'ready') throw new Error(denseProjection.reason)
    const denseResult = await composerCahierPdfNativedansNavigateur(denseProjection.request, {
      signal: new AbortController().signal,
      urlAccueil: 'https://lusk.test/',
      urlPublique: 'https://lusk.test/territoire/commune/22001',
    })
    const denseBytes = new Uint8Array(await denseResult.blob.arrayBuffer())
    writeFileSync(path.join(OUT, 'aedar-equipment-profile-dense.pdf'), denseBytes)
    const densePdf = await getDocument({ data: Uint8Array.from(denseBytes) }).promise
    for (let pageNumber = 1; pageNumber <= densePdf.numPages; pageNumber += 1) {
      writeFileSync(path.join(OUT, `aedar-equipment-profile-dense-p${pageNumber}.png`),
        await rendrePngNatif(denseBytes, 1.7, pageNumber))
    }
    expect(densePdf.numPages).toBeGreaterThanOrEqual(2)
    manifest.push({ key: 'aedar-equipment-profile-dense', file: 'aedar-equipment-profile-dense.pdf',
      pages: densePdf.numPages,
      pngs: Array.from({ length: densePdf.numPages }, (_, i) => `aedar-equipment-profile-dense-p${i + 1}.png`),
      bytes: denseBytes.length, modes: [], populated: 'synthetic dense profile; continuation at fixed scale' })
    writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify({
      scope: 'Shared native Vue -> DOM-paint path, #1024 switch. Real generated PDF bytes and PNG renders, no preview, no approval.',
      inputs: 'Every served value is a labelled SYNTHETIC review fixture applied to both the native mount and the B projections; none is published data.',
      raster: 'Any captured map image is a labelled TEST-ONLY 720x720 synthetic solid disc placed by the bounded browser harness. Its red ring is the native `.map-viewport` CSS border (`--cahier-map-circle-border: 4px` solid `var(--mode-ring)`), not a painter artefact. No genuine owner map is available or claimed.',
      files: manifest,
    }, null, 2))
  }, 300000)
})
