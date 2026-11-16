import { describe, expect, it } from 'vitest'
import { jsPDF } from 'jspdf'
import { dessinerFigurePdf } from '@/fiche/prototype/cahierPdfFigures'
import { POLICES_PDF } from '@/fiche/prototype/cahierPdfFonts'
import { projeterRequeteExport } from '@/fiche/prototype/cahierExportCapture'
import { projeterRequeteExportFigures } from '@/fiche/prototype/cahierExportAdapters'
import type { CahierFigureProjection } from '@/fiche/prototype/cahierExportAdapters'
import type { MobiliteRaccordementEvidence } from '@/fiche/content/themeContent'
import type { CahierExportCapture } from '@/fiche/prototype/cahierExportCapture'
import { chargeurPoliceTest, chargeurImageTest, lirePdf } from './helpers/cahierPdfRuntime'
import { captureBarresDense, captureCourbeTrous, captureRampeDense, capturePdfFixture } from './helpers/cahierPdfFixtures'

// Public native painter -> SVG serialization boundary. Text still uses real
// embedded font metrics and a real PDF; mark assertions inspect emitted SVG,
// not a re-run of the geometry functions being tested.
async function peindre(capture: CahierExportCapture, comparisonProof = true, modifier?: (projection: CahierFigureProjection) => CahierFigureProjection) {
  const result = projeterRequeteExport(capture, capture.capabilities.selectableSeries.slice(0, 3).map((s) => s.id))
  if (result.status !== 'ready') throw new Error(result.reason)
  const doc = new jsPDF({ unit: 'mm' })
  const signal = new AbortController().signal
  for (const face of POLICES_PDF) {
    doc.addFileToVFS(face.file, Buffer.from(await chargeurPoliceTest(face, { signal })).toString('base64'))
    doc.addFont(face.file, face.id, 'normal')
  }
  const svgs: SVGElement[] = []
  Object.assign(doc, { svg: async (svg: SVGElement) => { svgs.push(svg.cloneNode(true) as SVGElement); return doc } })
  const projections = projeterRequeteExportFigures(result.request)
  for (const original of projections) {
    const projection = modifier?.(original) ?? original
    const native = capture.figures.find((f) => f.slot === projection.slot)!
    await dessinerFigurePdf({
      doc, signal, x: 12, y: 25, width: 186, chargerImage: chargeurImageTest, comparisonProof,
      mesure: {
        largeur: (text, font, size) => { doc.setFont(font); doc.setFontSize(size); return doc.getTextWidth(text) },
        hauteurLigne: (_font, size) => size * 25.4 / 72,
        espace: (font, size) => { doc.setFont(font); doc.setFontSize(size); return doc.getTextWidth(' ') },
      },
      ...(native.family === 'mobilite-curve' ? { modeleCourbe: native.model as MobiliteRaccordementEvidence } : {}),
      ...(native.family === 'mobilite-bars' ? { modeleBars: native.model.figure } : {}),
    }, projection)
  }
  return { svgs, lecture: await lirePdf(doc.output('blob')) }
}

describe('sortie native du peintre PDF', () => {
  it('émet deux sous-chemins sur les deux courbes trouées, sans point permanent', async () => {
    const { svgs, lecture } = await peindre(captureCourbeTrous())
    const paths = [...svgs[0]!.querySelectorAll('path')]
    expect(paths).toHaveLength(2)
    for (const path of paths) {
      expect(path.getAttribute('d')!.match(/M/g)).toHaveLength(2)
      expect(path.getAttribute('d')!.match(/L/g)).toHaveLength(68) // 70 known points, two subpaths
    }
    expect(paths[0]!.getAttribute('stroke')).toBe('#57726f')
    expect(paths[1]!.getAttribute('stroke')).toBe('#83aca7')
    expect(paths[1]!.getAttribute('stroke-opacity')).toBe('0.68')
    expect(svgs[0]!.querySelectorAll('circle')).toHaveLength(0)
    const marker = [...svgs[0]!.querySelectorAll('line')].find((line) => line.getAttribute('stroke-dasharray'))!
    expect(marker.getAttribute('stroke')).toBe('#62706c')
    expect(Number(marker.getAttribute('stroke-width'))).toBeCloseTo(0.396875, 6)
    expect(lecture.textes.filter((item) => /^\d+ min$/.test(item.str)).map((item) => item.str))
      .toEqual(['0 min', '30 min', '60 min', '90 min', '120 min', '150 min', '180 min', '210 min', '240 min', '270 min', '300 min', '330 min', '360 min'])
  })

  it('ne réserve qu’un slot focal quand la comparaison acquise est cachée', async () => {
    const { svgs } = await peindre(captureBarresDense(), false)
    const rects = [...svgs[0]!.querySelectorAll('rect')]
    // Three native categories; first is a two-segment focal bar. No references.
    expect(rects).toHaveLength(4)
    const first = rects[0]!
    const centre = Number(first.getAttribute('x')) + Number(first.getAttribute('width')) / 2
    expect(centre).toBeCloseTo(39, 2) // plot [10,184], three 58mm clusters
  })

  it('ne repeint pas la courbe de référence acquise lorsque son propriétaire la masque', async () => {
    const capture: any = captureCourbeTrous()
    capture.comparison.display = { ...capture.comparison.display, state: 'not-displayed', reason: 'hidden-by-user',
      layers: capture.comparison.display.layers.map((layer: any) => ({ ...layer, displayed: false })),
    }
    const { svgs, lecture } = await peindre(capture, false)
    expect(svgs[0]!.querySelectorAll('path')).toHaveLength(1)
    expect(lecture.texteComplet).not.toContain('Groupe comparé')
  })

  it('garde les deux axes de rampe indépendants avec maxima 1,4 et 40', async () => {
    const { svgs, lecture } = await peindre(captureRampeDense())
    expect(svgs).toHaveLength(2)
    // Same final car value uses 70% of first panel (1.4/2), 100% of second (40/40).
    const car1 = svgs[0]!.querySelector('path')!.getAttribute('d')!
    const car2 = svgs[1]!.querySelector('path')!.getAttribute('d')!
    expect(car1).toMatch(/ 13\.40$/)
    expect(car2).toMatch(/ 2\.00$/)
    expect(lecture.texteComplet).toContain('40')
    const title = lecture.textes.find((item) => item.str === 'Volume de l’offre (établissements)')!
    expect(title.x).toBeCloseTo(312.0945, 2) // panel starts at 108mm, title baseline at 110.1mm
    const tickNumbers = lecture.textes.filter((item) => /^(0|20|40)$/.test(item.str))
    expect(Math.min(...tickNumbers.map((item) => item.x))).toBeGreaterThan(title.x + 3.5)
    const ticks = lecture.textes.filter((item) => item.str === 'établissements')
    expect(ticks).toHaveLength(3)
    const middle = (Math.min(...ticks.map((tick) => tick.y)) + Math.max(...ticks.map((tick) => tick.y))) / 2
    expect(Math.abs(title.y + title.largeur / 2 - middle)).toBeLessThan(8)
  })

  it('retire la référence comparisonFor avec son mode focal des marques et légendes', async () => {
    const { svgs, lecture } = await peindre(capturePdfFixture('aedar-equipment-explorer'), true, (projection) => {
      if (projection.family !== 'aedar-equipment-explorer') return projection
      const distribution = projection.distribution
      const series = [
        { key: 'car', label: 'FOCAL MASQUÉ', color: '#a94562', values: distribution.figure.categories.map(() => 10) },
        { key: 'car:comparison', label: 'RÉFÉRENCE MASQUÉE', color: '#83aca7', comparisonFor: 'car', values: distribution.figure.categories.map(() => 20) },
      ]
      return { ...projection, distribution: {
        ...distribution, figure: { ...distribution.figure, series }, hiddenSeriesKeys: ['car'],
      } }
    })
    expect(svgs[1]!.querySelectorAll('rect')).toHaveLength(0)
    expect(lecture.texteComplet).not.toContain('RÉFÉRENCE MASQUÉE')
    expect(lecture.texteComplet).not.toContain('FOCAL MASQUÉ')
  })

  it('refuse un rôle de couleur inconnu au lieu de peindre de l’encre', async () => {
    await expect(peindre(capturePdfFixture('aedar-equipment-explorer'), true, (projection) => {
      if (projection.family !== 'aedar-equipment-explorer') return projection
      return { ...projection, distribution: {
        ...projection.distribution,
        hiddenSeriesKeys: [],
        figure: { ...projection.distribution.figure, series: [{
          key: 'unknown', label: 'Unknown', color: 'var(--missing-role)',
          values: projection.distribution.figure.categories.map(() => 10),
        }] },
      } }
    })).rejects.toThrow(/missing-role/)
  })

  it('peint le mélange imbriqué natif d’un mode clair de référence', async () => {
    const { svgs } = await peindre(capturePdfFixture('aedar-equipment-explorer'), true, (projection) => {
      if (projection.family !== 'aedar-equipment-explorer') return projection
      return { ...projection, distribution: {
        ...projection.distribution, hiddenSeriesKeys: [],
        figure: { ...projection.distribution.figure, series: [{
          key: 'bike_lts2:comparison', label: 'Vélo comparé', comparisonFor: 'bike_lts2',
          color: 'color-mix(in srgb, color-mix(in srgb, var(--cahier-mode-bike) 55%, var(--paper)) 45%, transparent)',
          values: projection.distribution.figure.categories.map(() => 10),
        }] },
      } }
    })
    expect(svgs[1]!.querySelector('rect')!.getAttribute('fill')).toBe('#c4cecd')
  })
})
