import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { jsPDF } from 'jspdf'
import AccessRampFigureCahier from '@/fiche/prototype/AccessRampFigureCahier.vue'
import CahierGroupedVerticalBarChart from '@/fiche/prototype/CahierGroupedVerticalBarChart.vue'
import CahierMobiliteComparisonBars from '@/fiche/prototype/CahierMobiliteComparisonBars.vue'
import CahierMobiliteRaccordementCurve from '@/fiche/prototype/CahierMobiliteRaccordementCurve.vue'
import { CAHIER_FIGURE_AXIS, CAHIER_FIGURE_RAIL } from '@/fiche/cahierFigureGrammaire'
import { ROLE_PDF } from '@/fiche/prototype/cahierPdfGrammaire'
import type { CahierGroupedVerticalBarFigureData } from '@/fiche/cahierFigureGrammaire'
import { dessinerFigurePdf, GAP_PANNEAUX_FIGURE_MM } from '@/fiche/prototype/cahierPdfFigures'
import { POLICES_PDF } from '@/fiche/prototype/cahierPdfFonts'
import { couleurPdf } from '@/fiche/prototype/cahierPdfPalette'
import { projeterRequeteExport } from '@/fiche/prototype/cahierExportCapture'
import { projeterRequeteExportFigures } from '@/fiche/prototype/cahierExportAdapters'
import type { CahierFigureProjection } from '@/fiche/prototype/cahierExportAdapters'
import type { MobiliteBarsFigureEvidence, MobiliteRaccordementEvidence } from '@/fiche/content/themeContent'
import type { CahierExportCapture } from '@/fiche/prototype/cahierExportCapture'
import {
  CAHIER_AEDAR_FIGURE_GEOMETRY,
  CAHIER_FIGURE_STROKE,
  CAHIER_MOBILITE_BARS_GEOMETRY,
  CSS_PX_EN_MM,
  cahierFigureStrokeVars,
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

/** Minimal native grouped figure used only to read the injected stroke metrics. */
function barresGroupeesNative(): CahierGroupedVerticalBarFigureData {
  return {
    categories: [
      { key: 'early', label: 'Début', axisLabel: 'Début' },
      { key: 'late', label: 'Fin', axisLabel: 'Fin' },
    ],
    series: [
      { key: 'north', label: 'Nord', color: '#356a83', values: [2, 5] },
      { key: 'south', label: 'Sud', color: '#a94b65', values: [3, 4] },
    ],
    xAxisTitle: 'Période',
    yAxisTitle: 'Mesure',
    description: 'Comparaison groupée de deux séries.',
  }
}

/** Minimal native compared-bars model, taken from the shared dense capture. */
function barresCompareesNative(): MobiliteBarsFigureEvidence {
  const capture = captureBarresDense()
  const figure = capture.figures.find((candidate) => candidate.family === 'mobilite-bars')!
  return (figure as unknown as { model: { figure: MobiliteBarsFigureEvidence } }).model.figure
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
        largeur: (text, font, size, espacement = 0) => {
          doc.setFont(font)
          doc.setFontSize(size)
          const width = doc.getTextWidth(text)
          // `getTextWidth` excludes the active char space (`Tc`): add the
          // per-glyph advances exactly like the production `MesureJsPdf`.
          return width + espacement * 25.4 / 72 * Array.from(text).length
        },
        hauteurLigne: (_font, size) => size * 25.4 / 72,
        espace: (font, size) => { doc.setFont(font); doc.setFontSize(size); return doc.getTextWidth(' ') },
      },
      ...(native.family === 'mobilite-curve' && !sansModeleCourbe ? { modeleCourbe: native.model as MobiliteRaccordementEvidence } : {}),
      ...(native.family === 'mobilite-bars' ? { modeleBars: native.model.figure } : {}),
    }, projection)
  }
  return { svgs, lecture: await lirePdf(doc.output('blob')), doc }
}

type ContratTrait = readonly [
  chemin: string,
  selecteur: string,
  propriete: string,
  variable: string,
]

/**
 * Every shared stroke metric the four affected SFCs actually paint with.
 * `propriete` is asserted, not a bare `var(--...)` occurrence: a rule that
 * declares the variable for something else cannot satisfy the contract.
 */
const CONTRAT_TRAIT: readonly ContratTrait[] = [
  ['src/fiche/prototype/AccessRampFigureCahier.vue', '.access-ramp-grid line', 'stroke-width', '--cahier-figure-stroke-grid-width'],
  ['src/fiche/prototype/AccessRampFigureCahier.vue', '.access-ramp-grid .access-ramp-axis', 'stroke-width', '--cahier-figure-stroke-axis-width'],
  ['src/fiche/prototype/AccessRampFigureCahier.vue', '.access-ramp-line', 'stroke-width', '--cahier-figure-stroke-series-width'],
  ['src/fiche/prototype/AccessRampFigureCahier.vue', '.access-ramp-line', 'stroke-linecap', '--cahier-figure-stroke-series-cap'],
  ['src/fiche/prototype/AccessRampFigureCahier.vue', '.access-ramp-line', 'stroke-linejoin', '--cahier-figure-stroke-series-join'],
  ['src/fiche/prototype/AccessRampFigureCahier.vue', '.access-ramp-line--comparison', 'stroke-width', '--cahier-figure-stroke-comparison-width'],
  ['src/fiche/prototype/AccessRampFigureCahier.vue', '.access-ramp-line--comparison', 'stroke-dasharray', '--cahier-figure-stroke-comparison-dash'],
  ['src/fiche/prototype/AccessRampFigureCahier.vue', '.access-ramp-line--comparison', 'opacity', '--cahier-figure-stroke-comparison-opacity'],
  ['src/fiche/prototype/CahierMobiliteRaccordementCurve.vue', '.mobilite-raccordement-curve__grid line', 'stroke-width', '--cahier-figure-stroke-grid-width'],
  ['src/fiche/prototype/CahierMobiliteRaccordementCurve.vue', '.mobilite-raccordement-curve__grid .mobilite-raccordement-curve__axis', 'stroke-width', '--cahier-figure-stroke-axis-width'],
  ['src/fiche/prototype/CahierMobiliteRaccordementCurve.vue', '.mobilite-raccordement-curve__territory', 'stroke-width', '--cahier-figure-stroke-series-width'],
  ['src/fiche/prototype/CahierMobiliteRaccordementCurve.vue', '.mobilite-raccordement-curve__territory', 'stroke-linecap', '--cahier-figure-stroke-series-cap'],
  ['src/fiche/prototype/CahierMobiliteRaccordementCurve.vue', '.mobilite-raccordement-curve__territory', 'stroke-linejoin', '--cahier-figure-stroke-series-join'],
  ['src/fiche/prototype/CahierMobiliteRaccordementCurve.vue', '.mobilite-raccordement-curve__comparison', 'stroke-width', '--cahier-figure-stroke-comparison-width'],
  ['src/fiche/prototype/CahierMobiliteRaccordementCurve.vue', '.mobilite-raccordement-curve__comparison', 'stroke-dasharray', '--cahier-figure-stroke-comparison-dash'],
  ['src/fiche/prototype/CahierMobiliteRaccordementCurve.vue', '.mobilite-raccordement-curve__comparison', 'stroke-linecap', '--cahier-figure-stroke-series-cap'],
  ['src/fiche/prototype/CahierMobiliteRaccordementCurve.vue', '.mobilite-raccordement-curve__comparison', 'stroke-linejoin', '--cahier-figure-stroke-series-join'],
  ['src/fiche/prototype/CahierMobiliteRaccordementCurve.vue', '.mobilite-raccordement-curve__comparison', 'opacity', '--cahier-figure-stroke-comparison-opacity'],
  ['src/fiche/prototype/CahierMobiliteRaccordementCurve.vue', '.mobilite-raccordement-curve__marker-line', 'stroke-width', '--cahier-figure-stroke-marker-width'],
  ['src/fiche/prototype/CahierMobiliteRaccordementCurve.vue', '.mobilite-raccordement-curve__marker-line', 'stroke-dasharray', '--cahier-figure-stroke-marker-dash'],
  ['src/fiche/prototype/CahierMobiliteComparisonBars.vue', '.mobilite-comparison-bars__grid line', 'stroke-width', '--cahier-figure-stroke-grid-width'],
  ['src/fiche/prototype/CahierMobiliteComparisonBars.vue', '.mobilite-comparison-bars__grid .mobilite-comparison-bars__axis', 'stroke-width', '--cahier-figure-stroke-axis-width'],
  ['src/fiche/prototype/CahierGroupedVerticalBarChart.vue', '.cahier-grouped-vertical-bar-chart__grid line', 'stroke-width', '--cahier-figure-stroke-grid-width'],
  ['src/fiche/prototype/CahierGroupedVerticalBarChart.vue', '.cahier-grouped-vertical-bar-chart__grid .cahier-grouped-vertical-bar-chart__axis', 'stroke-width', '--cahier-figure-stroke-axis-width'],
]

/** Inline `style` attribute of a mounted SVG -> exact custom-property map. */
function proprietesSvg(style: string): Record<string, string> {
  return Object.fromEntries(style.split(';').map((declaration) => declaration.trim()).filter(Boolean).map((declaration) => {
    const colon = declaration.indexOf(':')
    return [declaration.slice(0, colon).trim(), declaration.slice(colon + 1).trim()]
  }))
}

/** Flat SFC `<style>` rules -> declarations of one exact selector. */
function declarationsSfc(source: string, selector: string): Map<string, string> {
  const style = /<style[^>]*>([\s\S]*?)<\/style>/.exec(source)?.[1] ?? ''
  const attendu = selector.replace(/\s+/g, ' ').trim()
  for (const block of style.split('}')) {
    const open = block.indexOf('{')
    if (open < 0) continue
    const selecteurs = block.slice(0, open).split(',').map((value) => value.replace(/\s+/g, ' ').trim())
    if (!selecteurs.includes(attendu)) continue
    const declarations = new Map<string, string>()
    for (const declaration of block.slice(open + 1).split(';')) {
      const colon = declaration.indexOf(':')
      if (colon < 0) continue
      declarations.set(declaration.slice(0, colon).trim(), declaration.slice(colon + 1).trim())
    }
    return declarations
  }
  throw new Error(`Sélecteur de trait introuvable : ${selector}`)
}

/** Assert `selector { property: var(--variable) }`; `source` is injectable so
 * the negative tests prove the contract fails on a corrupted or removed rule. */
function exigerTrait(
  chemin: string,
  selecteur: string,
  propriete: string,
  variable: string,
  source = readFileSync(resolve(process.cwd(), chemin), 'utf8'),
): void {
  const declarations = declarationsSfc(source, selecteur)
  expect(declarations.has(propriete), `${selecteur} { ${propriete} } absent`).toBe(true)
  expect(declarations.get(propriete), `${selecteur} { ${propriete} }`).toBe(`var(${variable})`)
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
    // Native 640×300 frame scaled to the 186 mm test width: three equal
    // clusters, first centre at plot left + half a cluster (owner margins).
    const largeurSvg = 186
    const geo = CAHIER_MOBILITE_BARS_GEOMETRY
    const echelle = largeurSvg / geo.width
    const largeurPlot = (geo.width - geo.margin.left - geo.margin.right) * echelle
    const centreAttendu = geo.margin.left * echelle + largeurPlot / 6
    expect(centre).toBeCloseTo(centreAttendu, 2)
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
    const { svgs, lecture, doc } = await peindre(captureRampeDense())
    expect(svgs).toHaveLength(2)
    // Same final car value uses 70% of first panel (1.4/2), 100% of second (40/40).
    // Native 640×300 box: y(1.4) on a 0–2 domain = 86.8, y(40) on 0–40 = 22.
    const car1 = svgs[0]!.querySelector('path')!.getAttribute('d')!
    const car2 = svgs[1]!.querySelector('path')!.getAttribute('d')!
    expect(car1).toMatch(/ 86\.80$/)
    expect(car2).toMatch(/ 22\.00$/)
    expect(lecture.texteComplet).toContain('40')
    const title = lecture.textes.find((item) => item.str === 'VOLUME DE L’OFFRE (ÉTABLISSEMENTS)')!
    // Geometry is derived from the painter's own inputs and shared owners:
    // panel count from the painted SVGs, gap from the painter, title lane from
    // the grammar, viewBox width from the native AEDAR owner. No literal
    // 90/108/16/640 is repeated here.
    const nombrePanneaux = svgs.length
    const largeurFigureMm = 186
    const xFigureMm = 12
    const largeurPanneauMm = (largeurFigureMm - GAP_PANNEAUX_FIGURE_MM * (nombrePanneaux - 1)) / nombrePanneaux
    const xPanneauDroitMm = xFigureMm + largeurPanneauMm + GAP_PANNEAUX_FIGURE_MM
    const titreXAttendu = (xPanneauDroitMm
      + CAHIER_FIGURE_RAIL.titleLane * largeurPanneauMm / CAHIER_AEDAR_FIGURE_GEOMETRY.width) * 72 / 25.4
    expect(Math.abs(title.x - titreXAttendu)).toBeLessThan(0.3)
    // Restored from `cede60a4`: the rotated run must sit on the plot's native
    // vertical middle. The middle is read from the shared `40`/`0` tick labels
    // (owner positions), never from a 130/300 literal; the measured residual is
    // the embedded face's rotated baseline (< 8 pt, as originally asserted).
    const label40 = lecture.textes.find((item) => item.str === '40'
      && Math.abs(item.taille - ROLE_PDF.tick.taille) < 0.05)!
    const droite = label40.x + label40.largeur
    const label0 = lecture.textes.find((item) => item.str === '0'
      && Math.abs(item.taille - ROLE_PDF.tick.taille) < 0.05
      && Math.abs(item.x + item.largeur - droite) < 0.6)!
    const middle = (label40.y + label0.y) / 2
    expect(Math.abs(title.y + title.largeur / 2 - middle)).toBeLessThan(8)
    const ticks = lecture.textes.filter((item) => /^\d+$/.test(item.str)
      && Math.abs(item.taille - ROLE_PDF.tick.taille) < 0.05
      && Math.abs(item.x + item.largeur - droite) < 0.6)
    expect(ticks).toHaveLength(3)
    // The rotated run keeps the embedded face's exact advance (no shrink, no
    // 96 dpi conversion): the PDF run length equals the measured role width.
    doc.setFont(ROLE_PDF.axe.police, 'normal')
    doc.setFontSize(ROLE_PDF.axe.taille)
    const largeurAttendue = doc.getTextWidth('VOLUME DE L’OFFRE (ÉTABLISSEMENTS)') * 72 / 25.4
      + ROLE_PDF.axe.taille * ROLE_PDF.axe.espacementEm * Array.from('VOLUME DE L’OFFRE (ÉTABLISSEMENTS)').length
    expect(Math.abs(title.largeur - largeurAttendue)).toBeLessThan(0.6)
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
    // The native bar keeps its own series ink at the native 78% shape alpha,
    // so the grid beneath shows through instead of being painted over by a
    // pre-composited colour.
    const rect = svgs[1]!.querySelector('rect')!
    expect(rect.getAttribute('fill')).toBe(couleurPdf(
      'color-mix(in srgb, color-mix(in srgb, var(--cahier-mode-bike) 55%, var(--paper)) 45%, transparent)',
    ))
    expect(rect.getAttribute('fill-opacity')).toBe('0.78')
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
      // Native user units: the document transform scales the stroke once.
      expect(Number(path.getAttribute('stroke-width'))).toBe(CAHIER_FIGURE_STROKE.widthPx)
    }
    const references = paths.filter((path) => path.getAttribute('stroke-dasharray'))
    expect(references.length).toBeGreaterThan(0)
    for (const path of references) {
      expect(Number(path.getAttribute('stroke-opacity'))).toBe(CAHIER_FIGURE_STROKE.comparisonOpacity)
    }
  })

  it('injecte le propriétaire de trait complet sur les quatre figures natives', () => {
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
    const bars = mount(CahierMobiliteComparisonBars, {
      props: { figure: barresCompareesNative(), comparison: { status: 'ready' } },
    })
    const grouped = mount(CahierGroupedVerticalBarChart, {
      props: { figure: barresGroupeesNative() },
    })
    // The expectation is the owner's own mapping: one object, one substitution.
    const attendu = { ...cahierFigureStrokeVars() }
    expect(Object.keys(attendu)).toHaveLength(10)
    const figures = [
      ['rampe', ramp.get('svg').attributes('style')],
      ['courbe', curve.get('svg[role="img"]').attributes('style')],
      ['barres comparées', bars.get('.mobilite-comparison-bars__svg').attributes('style')],
      ['barres groupées', grouped.get('.cahier-grouped-vertical-bar-chart__svg').attributes('style')],
    ] as const
    for (const [nom, style] of figures) {
      expect(style, nom).toBeTruthy()
      expect(proprietesSvg(style!), nom).toEqual(attendu)
    }
  })

  it('consomme la variable du propriétaire sur chaque propriété de trait des quatre SFC', () => {
    for (const [chemin, selecteur, propriete, variable] of CONTRAT_TRAIT) {
      exigerTrait(chemin, selecteur, propriete, variable)
    }
  })

  it('échoue si une déclaration de trait est corrompue ou supprimée (contrôle négatif)', () => {
    const rampPath = 'src/fiche/prototype/AccessRampFigureCahier.vue'
    const ramp = readFileSync(resolve(process.cwd(), rampPath), 'utf8')
    const corrompu = ramp.replace(
      'stroke-width: var(--cahier-figure-stroke-axis-width)',
      'stroke-width: 1.5',
    )
    expect(corrompu).not.toBe(ramp)
    expect(() => exigerTrait(
      rampPath, '.access-ramp-grid .access-ramp-axis', 'stroke-width',
      '--cahier-figure-stroke-axis-width', corrompu,
    )).toThrow()

    const curvePath = 'src/fiche/prototype/CahierMobiliteRaccordementCurve.vue'
    const curve = readFileSync(resolve(process.cwd(), curvePath), 'utf8')
    const sansTirets = curve.replace(
      'stroke-dasharray: var(--cahier-figure-stroke-marker-dash);',
      'stroke-dasharray: 3 3;',
    )
    expect(sansTirets).not.toBe(curve)
    expect(() => exigerTrait(
      curvePath, '.mobilite-raccordement-curve__marker-line', 'stroke-dasharray',
      '--cahier-figure-stroke-marker-dash', sansTirets,
    )).toThrow()

    const barsPath = 'src/fiche/prototype/CahierMobiliteComparisonBars.vue'
    const bars = readFileSync(resolve(process.cwd(), barsPath), 'utf8')
    const supprime = bars.replace('; stroke-width: var(--cahier-figure-stroke-grid-width)', '')
    expect(supprime).not.toBe(bars)
    expect(() => exigerTrait(
      barsPath, '.mobilite-comparison-bars__grid line', 'stroke-width',
      '--cahier-figure-stroke-grid-width', supprime,
    )).toThrow()
  })

  it('garde des portées CSS distinctes pour la géométrie d’axe et la grammaire de trait native', () => {
    // Two grammars with the same axis theme: 1 px legacy axis geometry vs the
    // native 1.5 px stroke. Neither may be aliased to the other (#1024).
    expect(CAHIER_FIGURE_AXIS.width).toBe(1)
    expect(CAHIER_FIGURE_STROKE.axisWidthPx).toBe(1.5)
    const natives = Object.keys(cahierFigureStrokeVars())
    expect(natives).not.toContain('--cahier-figure-axis-width')
    expect(natives.every((nom) => nom.startsWith('--cahier-figure-stroke-'))).toBe(true)

    // The legacy owner keeps its own name, value and fallback.
    const axes = readFileSync(resolve(process.cwd(), 'src/fiche/prototype/CahierFigureAxes.vue'), 'utf8')
    expect(axes).toContain("'--cahier-figure-axis-width': `${CAHIER_FIGURE_AXIS.width}`")
    const figureCss = readFileSync(resolve(process.cwd(), 'src/fiche/prototype/cahierFigure.css'), 'utf8')
    expect(figureCss).toContain('stroke-width: var(--cahier-figure-axis-width, 1)')

    // No native figure reads or shadows the legacy geometry variable.
    for (const chemin of new Set(CONTRAT_TRAIT.map(([source]) => source))) {
      const source = readFileSync(resolve(process.cwd(), chemin), 'utf8')
      expect(source, chemin).not.toContain('var(--cahier-figure-axis-width')
      expect(source, chemin).not.toContain("'--cahier-figure-axis-width'")
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

  it('fait suivre une mutation du propriétaire aux quatre SFC natives et au PDF', async () => {
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
      const [
        { default: Ramp },
        { default: Curve },
        { default: Bars },
        { default: Grouped },
        { dessinerFigurePdf: peintre },
      ] = await Promise.all([
        import('@/fiche/prototype/AccessRampFigureCahier.vue'),
        import('@/fiche/prototype/CahierMobiliteRaccordementCurve.vue'),
        import('@/fiche/prototype/CahierMobiliteComparisonBars.vue'),
        import('@/fiche/prototype/CahierGroupedVerticalBarChart.vue'),
        import('@/fiche/prototype/cahierPdfFigures'),
      ])
      const rampStyle = monter(Ramp, {
        props: { timeRamp: rampeNative(), territoryName: 'Rennes' },
      }).get('svg').attributes('style')!
      expect(rampStyle).toContain('--cahier-figure-stroke-series-width: 4.25px')
      expect(rampStyle).toContain('--cahier-figure-stroke-comparison-dash: 12 7')
      expect(rampStyle).toContain('--cahier-figure-stroke-grid-width: 2px')

      const curveCapture = captureCourbeTrous()
      const curveModel = (curveCapture.figures.find((figure) => figure.family === 'mobilite-curve') as unknown as {
        model: MobiliteRaccordementEvidence
      }).model
      const curveStyle = monter(Curve, {
        props: { figure: curveModel, comparison: { status: 'ready' } },
      }).get('svg[role="img"]').attributes('style')!
      expect(curveStyle).toContain('--cahier-figure-stroke-marker-width: 2.25px')
      expect(curveStyle).toContain('--cahier-figure-stroke-marker-dash: 5 4')

      const barsStyle = monter(Bars, {
        props: { figure: barresCompareesNative(), comparison: { status: 'ready' } },
      }).get('.mobilite-comparison-bars__svg').attributes('style')!
      expect(barsStyle).toContain('--cahier-figure-stroke-grid-width: 2px')
      expect(barsStyle).toContain('--cahier-figure-stroke-axis-width: 3px')

      const groupedStyle = monter(Grouped, {
        props: { figure: barresGroupeesNative() },
      }).get('.cahier-grouped-vertical-bar-chart__svg').attributes('style')!
      expect(groupedStyle).toContain('--cahier-figure-stroke-grid-width: 2px')
      expect(groupedStyle).toContain('--cahier-figure-stroke-axis-width: 3px')

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

      // The bar family paints its grid/axis from the same mutated owner.
      const { svgs: barSvgs } = await peindre(captureBarresDense(), true, undefined, false, peintre)
      const barSolides = barSvgs
        .flatMap((svg) => [...svg.querySelectorAll('line')])
        .filter((line) => !line.getAttribute('stroke-dasharray'))
        .map((line) => Number(line.getAttribute('stroke-width')))
      expect(barSolides).toContainEqual(expect.closeTo(cssPxToMm(mute.gridWidthPx), 6))
      expect(barSolides).toContainEqual(expect.closeTo(cssPxToMm(mute.axisWidthPx), 6))
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
