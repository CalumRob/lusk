import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { jsPDF } from 'jspdf'
import AccessRampFigureCahier from '@/fiche/prototype/AccessRampFigureCahier.vue'
import CahierMobiliteRaccordementCurve from '@/fiche/prototype/CahierMobiliteRaccordementCurve.vue'
import { dessinerFigurePdf } from '@/fiche/prototype/cahierPdfFigures'
import { POLICES_PDF } from '@/fiche/prototype/cahierPdfFonts'
import { projeterRequeteExport } from '@/fiche/prototype/cahierExportCapture'
import { projeterRequeteExportFigures } from '@/fiche/prototype/cahierExportAdapters'
import type { CahierFigureProjection } from '@/fiche/prototype/cahierExportAdapters'
import type { MobiliteRaccordementEvidence } from '@/fiche/content/themeContent'
import type { CahierExportCapture } from '@/fiche/prototype/cahierExportCapture'
import {
  CAHIER_FIGURE_STROKE,
  CSS_PX_EN_MM,
  curveGeometry,
  cssPxToMm,
} from '@/fiche/prototype/cahierFigureNativeGeometry'
import type { TimeRampFigureData } from '@/fiche/content/territoryFacts'
import { mobiliteCurveCoordinateForDetail } from '@/fiche/prototype/cahierMobiliteReadings'
import { chargeurPoliceTest, chargeurImageTest, lirePdf } from './helpers/cahierPdfRuntime'
import { captureBarresDense, captureCourbeTrous, captureRampeDense, capturePdfFixture } from './helpers/cahierPdfFixtures'

/** Minimal native AEDAR ramp used only to read the injected stroke metrics. */
function rampeNative(): TimeRampFigureData {
  return {
    availability: 'incomplete',
    xAxis: { label: 'Temps d’accès', unit: 'minutes' },
    yAxis: { label: 'Diversité accessible', unit: 'types' },
    series: [{
      key: 'car',
      label: 'Voiture',
      points: [5, 10, 15].map((minute) => ({
        xValue: minute,
        xLabel: `${minute} min`,
        value: minute / 5,
        referenceValue: minute / 6,
      })),
    }],
    provenance: null,
    comparisonLabel: 'Territoires comparables',
  }
}

// Public native painter -> SVG serialization boundary. Text still uses real
// embedded font metrics and a real PDF; mark assertions inspect emitted SVG,
// not a re-run of the geometry functions being tested. `peintre` is injectable
// only so an owner-mutation test can pass a freshly imported painter.
async function peindre(
  capture: CahierExportCapture,
  comparisonProof = true,
  modifier?: (projection: CahierFigureProjection) => CahierFigureProjection,
  sansModeleCourbe = false,
  peintre: typeof dessinerFigurePdf = dessinerFigurePdf,
) {
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
    await peintre({
      doc, signal, x: 12, y: 25, width: 186, chargerImage: chargeurImageTest, comparisonProof,
      mesure: {
        largeur: (text, font, size) => { doc.setFont(font); doc.setFontSize(size); return doc.getTextWidth(text) },
        hauteurLigne: (_font, size) => size * 25.4 / 72,
        espace: (font, size) => { doc.setFont(font); doc.setFontSize(size); return doc.getTextWidth(' ') },
      },
      ...(native.family === 'mobilite-curve' && !sansModeleCourbe ? { modeleCourbe: native.model as MobiliteRaccordementEvidence } : {}),
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
    expect(Number(marker.getAttribute('stroke-width')))
      .toBeCloseTo(cssPxToMm(CAHIER_FIGURE_STROKE.markerWidthPx), 6)
    expect(marker.getAttribute('stroke-dasharray')).toBe(
      CAHIER_FIGURE_STROKE.markerDashPx.map((value) => String(cssPxToMm(value))).join(' '),
    )
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

  it('reprend la grammaire de trait native des séries sur la courbe', async () => {
    const { svgs } = await peindre(captureCourbeTrous())
    const [focal, reference] = [...svgs[0]!.querySelectorAll('path')]
    expect(Number(focal!.getAttribute('stroke-width')))
      .toBeCloseTo(CAHIER_FIGURE_STROKE.widthPx * CSS_PX_EN_MM, 6)
    expect(Number(reference!.getAttribute('stroke-width')))
      .toBeCloseTo(CAHIER_FIGURE_STROKE.comparisonWidthPx * CSS_PX_EN_MM, 6)
    expect(Number(reference!.getAttribute('stroke-opacity')))
      .toBe(CAHIER_FIGURE_STROKE.comparisonOpacity)
    const tirets = reference!.getAttribute('stroke-dasharray')!.trim().split(/\s+/).map(Number)
    expect(tirets).toHaveLength(2)
    expect(tirets[0]).toBeCloseTo(CAHIER_FIGURE_STROKE.comparisonDashPx[0] * CSS_PX_EN_MM, 6)
    expect(tirets[1]).toBeCloseTo(CAHIER_FIGURE_STROKE.comparisonDashPx[1] * CSS_PX_EN_MM, 6)
    // The focal series is never translucent or dashed.
    expect(focal!.getAttribute('stroke-opacity')).toBeNull()
    expect(focal!.getAttribute('stroke-dasharray')).toBeNull()
  })

  it('applique la même grammaire de trait native aux rampes AEDAR', async () => {
    const { svgs } = await peindre(captureRampeDense())
    const paths = svgs.flatMap((svg) => [...svg.querySelectorAll('path')])
    expect(paths.length).toBeGreaterThan(4)
    for (const path of paths) {
      expect(Number(path.getAttribute('stroke-width')))
        .toBeCloseTo(CAHIER_FIGURE_STROKE.widthPx * CSS_PX_EN_MM, 6)
    }
    const references = paths.filter((path) => path.getAttribute('stroke-dasharray'))
    expect(references.length).toBeGreaterThan(0)
    for (const path of references) {
      expect(Number(path.getAttribute('stroke-opacity'))).toBe(CAHIER_FIGURE_STROKE.comparisonOpacity)
    }
  })

  it('injecte les métriques de trait du propriétaire dans les figures natives', () => {
    const ramp = mount(AccessRampFigureCahier, {
      props: { timeRamp: rampeNative(), territoryName: 'Rennes' },
    })
    const curveCapture = captureCourbeTrous()
    const curveModel = (curveCapture.figures.find((figure) => figure.family === 'mobilite-curve') as unknown as {
      model: MobiliteRaccordementEvidence
    }).model
    const curve = mount(CahierMobiliteRaccordementCurve, {
      props: { figure: curveModel, comparison: { status: 'ready' } },
    })
    const attendu: Record<string, string> = {
      '--cahier-figure-series-width': `${CAHIER_FIGURE_STROKE.widthPx}px`,
      '--cahier-figure-comparison-width': `${CAHIER_FIGURE_STROKE.comparisonWidthPx}px`,
      '--cahier-figure-comparison-dash': CAHIER_FIGURE_STROKE.comparisonDashPx.join(' '),
      '--cahier-figure-comparison-opacity': String(CAHIER_FIGURE_STROKE.comparisonOpacity),
      '--cahier-figure-marker-width': `${CAHIER_FIGURE_STROKE.markerWidthPx}px`,
      '--cahier-figure-marker-dash': CAHIER_FIGURE_STROKE.markerDashPx.join(' '),
      '--cahier-figure-grid-width': `${CAHIER_FIGURE_STROKE.gridWidthPx}px`,
      '--cahier-figure-axis-width': `${CAHIER_FIGURE_STROKE.axisWidthPx}px`,
    }
    for (const [propriete, valeur] of Object.entries(attendu)) {
      expect(ramp.get('svg').attributes('style'), propriete).toContain(`${propriete}: ${valeur}`)
      expect(curve.get('svg[role="img"]').attributes('style'), propriete)
        .toContain(`${propriete}: ${valeur}`)
    }
    expect(ramp.get('svg').attributes('style')).toContain(
      `--cahier-figure-series-cap: ${CAHIER_FIGURE_STROKE.linecap}`,
    )
    expect(curve.get('svg[role="img"]').attributes('style')).toContain(
      `--cahier-figure-series-join: ${CAHIER_FIGURE_STROKE.linejoin}`,
    )
  })

  it('consomme ces variables dans les règles de trait des SFC natives', () => {
    const ramp = readFileSync(resolve(process.cwd(), 'src/fiche/prototype/AccessRampFigureCahier.vue'), 'utf8')
    const curve = readFileSync(resolve(process.cwd(), 'src/fiche/prototype/CahierMobiliteRaccordementCurve.vue'), 'utf8')
    const regles: [string, string, string][] = [
      [ramp, '.access-ramp-line', '--cahier-figure-series-width'],
      [ramp, '.access-ramp-line--comparison', '--cahier-figure-comparison-dash'],
      [ramp, '.access-ramp-grid line', '--cahier-figure-grid-width'],
      [ramp, '.access-ramp-grid .access-ramp-axis', '--cahier-figure-axis-width'],
      [curve, '.mobilite-raccordement-curve__territory', '--cahier-figure-series-width'],
      [curve, '.mobilite-raccordement-curve__comparison', '--cahier-figure-comparison-width'],
      [curve, '.mobilite-raccordement-curve__marker-line', '--cahier-figure-marker-width'],
      [curve, '.mobilite-raccordement-curve__grid line', '--cahier-figure-grid-width'],
      [curve, '.mobilite-raccordement-curve__grid .mobilite-raccordement-curve__axis', '--cahier-figure-axis-width'],
    ]
    for (const [source, selecteur, variable] of regles) {
      const start = source.indexOf(`${selecteur} {`)
      expect(start, selecteur).toBeGreaterThanOrEqual(0)
      const open = source.indexOf('{', start)
      const close = source.indexOf('}', open)
      expect(source.slice(open + 1, close), selecteur).toContain(`var(${variable})`)
    }
  })

  it('reporte les largeurs natives de grille et d’axe et la jointure comparée', async () => {
    const { svgs } = await peindre(captureCourbeTrous())
    const lines = [...svgs[0]!.querySelectorAll('line')]
    const solides = lines.filter((line) => !line.getAttribute('stroke-dasharray'))
    const largeurs = solides.map((line) => Number(line.getAttribute('stroke-width')))
    expect(largeurs).toContainEqual(expect.closeTo(cssPxToMm(CAHIER_FIGURE_STROKE.gridWidthPx), 6))
    expect(largeurs).toContainEqual(expect.closeTo(cssPxToMm(CAHIER_FIGURE_STROKE.axisWidthPx), 6))
    const reference = [...svgs[0]!.querySelectorAll('path')][1]!
    expect(reference.getAttribute('stroke-linejoin')).toBe(CAHIER_FIGURE_STROKE.linejoin)
  })

  it('fait suivre une mutation du propriétaire aux SFC natives et au PDF', async () => {
    const mute = {
      ...CAHIER_FIGURE_STROKE,
      widthPx: 4.25,
      comparisonWidthPx: 3.75,
      comparisonDashPx: [12, 7] as const,
      comparisonOpacity: 0.5,
      markerWidthPx: 2.25,
      markerDashPx: [5, 4] as const,
      gridWidthPx: 2,
      axisWidthPx: 3,
    }
    vi.resetModules()
    vi.doMock('@/fiche/prototype/cahierFigureNativeGeometry', async () => {
      const actual = await vi.importActual<typeof import('@/fiche/prototype/cahierFigureNativeGeometry')>(
        '@/fiche/prototype/cahierFigureNativeGeometry',
      )
      return { ...actual, CAHIER_FIGURE_STROKE: mute }
    })
    try {
      const { mount: monter } = await import('@vue/test-utils')
      const [{ default: Ramp }, { default: Curve }, { dessinerFigurePdf: peintre }] = await Promise.all([
        import('@/fiche/prototype/AccessRampFigureCahier.vue'),
        import('@/fiche/prototype/CahierMobiliteRaccordementCurve.vue'),
        import('@/fiche/prototype/cahierPdfFigures'),
      ])
      const rampStyle = monter(Ramp, {
        props: { timeRamp: rampeNative(), territoryName: 'Rennes' },
      }).get('svg').attributes('style')!
      expect(rampStyle).toContain('--cahier-figure-series-width: 4.25px')
      expect(rampStyle).toContain('--cahier-figure-comparison-dash: 12 7')
      expect(rampStyle).toContain('--cahier-figure-grid-width: 2px')

      const curveCapture = captureCourbeTrous()
      const curveModel = (curveCapture.figures.find((figure) => figure.family === 'mobilite-curve') as unknown as {
        model: MobiliteRaccordementEvidence
      }).model
      const curveStyle = monter(Curve, {
        props: { figure: curveModel, comparison: { status: 'ready' } },
      }).get('svg[role="img"]').attributes('style')!
      expect(curveStyle).toContain('--cahier-figure-marker-width: 2.25px')
      expect(curveStyle).toContain('--cahier-figure-marker-dash: 5 4')

      const { svgs } = await peindre(curveCapture, true, undefined, false, peintre)
      const [focal, reference] = [...svgs[0]!.querySelectorAll('path')]
      expect(Number(focal!.getAttribute('stroke-width'))).toBeCloseTo(cssPxToMm(mute.widthPx), 6)
      expect(Number(reference!.getAttribute('stroke-width')))
        .toBeCloseTo(cssPxToMm(mute.comparisonWidthPx), 6)
      expect(Number(reference!.getAttribute('stroke-opacity'))).toBe(mute.comparisonOpacity)
      const marker = [...svgs[0]!.querySelectorAll('line')]
        .find((line) => line.getAttribute('stroke-dasharray'))!
      expect(Number(marker.getAttribute('stroke-width'))).toBeCloseTo(cssPxToMm(mute.markerWidthPx), 6)
      const solides = [...svgs[0]!.querySelectorAll('line')]
        .filter((line) => !line.getAttribute('stroke-dasharray'))
        .map((line) => Number(line.getAttribute('stroke-width')))
      expect(solides).toContainEqual(expect.closeTo(cssPxToMm(mute.gridWidthPx), 6))
      expect(solides).toContainEqual(expect.closeTo(cssPxToMm(mute.axisWidthPx), 6))
    } finally {
      vi.doUnmock('@/fiche/prototype/cahierFigureNativeGeometry')
      vi.resetModules()
    }
  })

  it('place le repère sur la projection native de la courbe, pas sur un axe recalculé', async () => {
    const capture = captureCourbeTrous()
    const { svgs } = await peindre(capture)
    const marker = [...svgs[0]!.querySelectorAll('line')]
      .find((line) => line.getAttribute('stroke-dasharray'))!
    const figure = capture.figures.find((candidate) => candidate.family === 'mobilite-curve')!
    const model = (figure as unknown as { model: MobiliteRaccordementEvidence }).model
    const geometry = curveGeometry(model, {
      width: 175,
      height: 45,
      margin: { top: 2, right: 2, bottom: 2, left: 9 },
    })
    const axisValue = mobiliteCurveCoordinateForDetail(model, model.trajectory!.marker!.detail)
    expect(axisValue).not.toBeNull()
    expect(Number(marker.getAttribute('x1'))).toBeCloseTo(geometry.x(axisValue!), 6)
    // The protected marker tick is also a native grid position.
    expect(geometry.xTicks.some((tick) =>
      Math.abs(tick.position - Number(marker.getAttribute('x1'))) < 1e-9)).toBe(true)
  })

  it('ne conserve aucun axe parallèle dans la projection de courbe', () => {
    const capture = captureCourbeTrous()
    const result = projeterRequeteExport(
      capture,
      capture.capabilities.selectableSeries.slice(0, 3).map((serie) => serie.id),
    )
    if (result.status !== 'ready') throw new Error(result.reason)
    const curve = projeterRequeteExportFigures(result.request)
      .find((projection) => projection.family === 'mobilite-curve')!
    expect(Object.hasOwn(curve, 'axis')).toBe(false)
  })

  it('refuse une courbe sans modèle natif au lieu d’un axe de repli silencieux', async () => {
    await expect(peindre(captureCourbeTrous(), true, undefined, true))
      .rejects.toThrow(/Modèle natif de courbe manquant/)
  })

  it('garde les sources du peintre en UTF-8 sans BOM', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/fiche/prototype/cahierPdfFigures.ts'), 'utf8')
    expect(source.charCodeAt(0)).not.toBe(0xfeff)
  })
})
