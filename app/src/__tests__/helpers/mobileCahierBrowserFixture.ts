import { createApp, nextTick } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'

import VarianteCahierLibre from '@/fiche/prototype/VarianteCahierLibre.vue'
import AccessRampFigureCahier from '@/fiche/prototype/AccessRampFigureCahier.vue'
import BpeProfilesChartCahier from '@/fiche/prototype/BpeProfilesChartCahier.vue'
import type { CahierPagination } from '@/fiche/prototype/cahierPagination'
import type { ThemeContent } from '@/fiche/content/themeContent'
import type { BpeAccessProfileFact, MobiliteAccessRamp, TimeRampFigureData } from '@/fiche/content/territoryFacts'
import { routes } from '@/router'

export async function mountPlainCahier(
  container: Element,
  content: ThemeContent,
  pagination: CahierPagination,
) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes,
  })
  const app = createApp(VarianteCahierLibre, {
    content,
    pagination,
    presentation: 'plain',
    showAllUnits: true,
  })
  app.use(router)
  await router.push('/')
  await router.isReady()
  app.mount(container)
  await nextTick()
  return app
}

/** Mounts a synthetic high-count profile plot so mobile checks exercise a long y-axis label. */
export async function mountLongYAxisFigure(container: Element) {
  const profiles: BpeAccessProfileFact[] = [
    { profile: 'acces-pied-tc', label: 'Profil synthétique A', count: 1234, exemplar: null, comparison: null },
    { profile: 'velo-compense', label: 'Profil synthétique B', count: 800, exemplar: null, comparison: null },
    { profile: 'voiture-requise', label: 'Profil synthétique C', count: 350, exemplar: null, comparison: null },
    { profile: 'inaccessible-20-minutes', label: 'Profil synthétique D', count: 100, exemplar: null, comparison: null },
  ]
  const app = createApp(BpeProfilesChartCahier, {
    profiles,
    totalTypes: 1234,
    territoryName: 'Territoire synthétique',
    donutTooltipTitle: 'Répartition synthétique',
    comparisonLabel: null,
    explorationTo: null,
  })
  app.mount(container)
  await nextTick()
  return app
}

/** Mounts the failing access-ramp family with the Rennes long tick labels. */
export async function mountAccessRampLongYAxisFigure(container: Element) {
  const timeRamp: TimeRampFigureData = {
    availability: 'complete',
    xAxis: { label: 'Temps de trajet', unit: 'min' },
    yAxis: { label: 'Volume de l’offre', unit: '' },
    series: [{
      key: 'car',
      label: 'Voiture',
      points: [
        { xValue: 0, xLabel: '0 min', value: 0, referenceValue: null },
        { xValue: 10, xLabel: '10 min', value: 6440, referenceValue: null },
        { xValue: 20, xLabel: '20 min', value: 12881, referenceValue: null },
      ],
    }],
    provenance: null,
    comparisonLabel: null,
  }
  const app = createApp(AccessRampFigureCahier, {
    timeRamp,
    territoryName: 'Rennes',
    showModeLegend: false,
  })
  app.mount(container)
  await nextTick()
  return app
}

/** Mounts the three-mode access-ramp variant with the same long y-axis values. */
export async function mountAccessRampRampFigure(container: Element) {
  const points = (maximum: number) => [
    { quantile: 0, quantileLabel: '0 %', accessibleTypes: 0, comparisonAccessibleTypes: null },
    { quantile: 0.5, quantileLabel: '50 %', accessibleTypes: 6440, comparisonAccessibleTypes: null },
    { quantile: 1, quantileLabel: '100 %', accessibleTypes: maximum, comparisonAccessibleTypes: null },
  ]
  const ramp: MobiliteAccessRamp = {
    availability: 'complete',
    xAxisLabel: 'Part cumulée de bâtiments',
    yAxisLabel: 'Volume de l’offre',
    curves: {
      car: { mode: 'car', modeLabel: 'Voiture', points: points(12881) },
      bike: { mode: 'bike', modeLabel: 'Vélo', points: points(9800) },
      walkTransit: { mode: 'walkTransit', modeLabel: 'À pied et transports', points: points(7600) },
    },
    totalBuildings: 12881,
    provenance: null,
    comparisonLabel: null,
    comparisonTotalBuildings: null,
  }
  const app = createApp(AccessRampFigureCahier, {
    ramp,
    territoryName: 'Rennes',
    showModeLegend: false,
  })
  app.mount(container)
  await nextTick()
  return app
}
