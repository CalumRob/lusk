import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import AccessRampFigureCahier from '@/fiche/prototype/AccessRampFigureCahier.vue'
import CahierGroupedVerticalBarChart from '@/fiche/prototype/CahierGroupedVerticalBarChart.vue'
import CahierMobiliteComparisonBars from '@/fiche/prototype/CahierMobiliteComparisonBars.vue'
import CahierMobiliteRaccordementCurve from '@/fiche/prototype/CahierMobiliteRaccordementCurve.vue'
import { CAHIER_FIGURE_AXIS } from '@/fiche/cahierFigureGrammaire'
import type { CahierGroupedVerticalBarFigureData } from '@/fiche/cahierFigureGrammaire'
import type { MobiliteBarsFigureEvidence, MobiliteRaccordementEvidence } from '@/fiche/content/themeContent'
import type { TimeRampFigureData } from '@/fiche/content/territoryFacts'
import { CAHIER_FIGURE_STROKE, cahierFigureStrokeVars } from '@/fiche/prototype/cahierFigureNativeGeometry'
import { projeterRequeteExport } from '@/fiche/prototype/cahierExportCapture'
import { projeterRequeteExportFigures } from '@/fiche/prototype/cahierExportAdapters'
import { captureBarresDense, captureCourbeTrous } from './helpers/cahierPdfFixtures'


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
  throw new Error(`S+�lecteur de trait introuvable : ${selector}`)
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

describe('grammaire native des traits de figure (contrat de source)', () => {
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
})
