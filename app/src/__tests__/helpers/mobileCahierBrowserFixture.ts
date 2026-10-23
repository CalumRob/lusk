import { createApp, nextTick } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'

import VarianteCahierLibre from '@/fiche/prototype/VarianteCahierLibre.vue'
import AccessRampFigureCahier from '@/fiche/prototype/AccessRampFigureCahier.vue'
import BpeProfilesChartCahier from '@/fiche/prototype/BpeProfilesChartCahier.vue'
import AedarEquipmentQuantileFigureCahier from '@/fiche/prototype/AedarEquipmentQuantileFigureCahier.vue'
import BivariateDistributionFigureCahier from '@/fiche/prototype/BivariateDistributionFigureCahier.vue'
import CahierOffreTransportsFigure from '@/fiche/prototype/CahierOffreTransportsFigure.vue'
import type { CahierPagination } from '@/fiche/prototype/cahierPagination'
import type { ContentFact, ThemeContent } from '@/fiche/content/themeContent'
import type { BpeAccessProfileFact, MobiliteAccessRamp, MobiliteBuildingDistribution, TimeRampFigureData } from '@/fiche/content/territoryFacts'
import type { TrajectoryMetadata } from '@/payload/types'
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

/** Mounts the sandbox quantile renderer with the Rennes grouped-bar axis labels. */
export async function mountSandboxGroupedBarFigure(container: Element) {
  const app = createApp(AedarEquipmentQuantileFigureCahier, {
    fact: {
      territory_id: '35238',
      territory_type: 'commune',
      typequ: 'SYNTHETIC',
      typequ_label: 'Équipements synthétiques',
      identity: {},
      n_addresses: 1,
      n_observed: 1,
      coverage_status: 'covered',
      measures: {
        count_20_car_min: 0,
        count_20_car_decile2: 6440,
        count_20_car_decile5: 9000,
        count_20_car_decile8: 11000,
        count_20_car_max: 12881,
      },
      source_id: 'synthetic',
      vintage_id: 'fixture',
      source_url: 'https://example.test/fixture',
      licence: 'Fixture',
      attribution: 'Synthetic browser fixture; not published facts',
      reference_date: null,
      publication_date: null,
    },
    horizonMinutes: 20,
    selectedModes: ['car'],
    evidence: {
      kind: 'aedar-equipment-explorer',
      contentVersion: 'fixture',
      referenceContentVersion: 'fixture',
      facts: [],
      initialTypequ: 'SYNTHETIC',
      initialHorizonMinutes: 20,
      introduction: [],
      volumeFigureTitle: 'Volume synthétique',
      volumeYAxisTitle: 'Établissements',
      distributionFigureTitle: 'Distribution synthétique',
      distributionStatistics: [
        { key: 'min', label: 'Minimum', axisLabel: 'Min.' },
        { key: 'decile2', label: '2e décile', axisLabel: 'D2' },
        { key: 'decile5', label: '5e décile', axisLabel: 'D5' },
        { key: 'decile8', label: '8e décile', axisLabel: 'D8' },
        { key: 'max', label: 'Maximum', axisLabel: 'Max.' },
      ],
      distributionAxisTitle: 'Quantile',
      distributionYAxisTitle: 'NOMBRE D’ÉTABLISSEMENTS',
      distributionDescription: 'Distribution synthétique par quantile.',
      distributionUnavailableDescription: 'Distribution indisponible.',
      source: null,
    },
  })
  app.mount(container)
  await nextTick()
  return app
}

/** Mounts the bivariate grid renderer with long depth-bin labels. */
export async function mountBivariateDistributionFigure(container: Element) {
  const distribution: MobiliteBuildingDistribution = {
    availability: 'complete',
    mode: 't',
    modeLabel: 'À pied et transports',
    breadthAxisLabel: 'Nombre de types d’équipements différents',
    depthAxisLabel: 'Équipements par type accessibles à pied',
    breadthBins: [
      { key: 'b1', min: 1, max: 1, label: '1 type' },
      { key: 'b2', min: 2, max: 2, label: '2 types' },
      { key: 'b3', min: 3, max: null, label: '3 types ou plus' },
    ],
    depthBins: [
      { key: 'd1', min: 1, max: 2, label: '1 à 2 équipements' },
      { key: 'd2', min: 3, max: 5, label: '3 à 5 équipements' },
      { key: 'd3', min: 6, max: null, label: '6 équipements ou plus' },
    ],
    cells: [
      { breadthBucket: 'b1', depthBucket: 'd1', buildingCount: 5, share: 0.2, comparisonBuildingCount: 8, comparisonShare: 0.3 },
      { breadthBucket: 'b2', depthBucket: 'd2', buildingCount: 10, share: 0.4, comparisonBuildingCount: 9, comparisonShare: 0.35 },
      { breadthBucket: 'b3', depthBucket: 'd3', buildingCount: 10, share: 0.4, comparisonBuildingCount: 9, comparisonShare: 0.35 },
    ],
    totalBuildings: 25,
    provenance: null,
    comparisonLabel: 'Bretagne',
    comparisonTotalBuildings: 26,
    comparisonStatistic: 'mean',
  }
  const app = createApp(BivariateDistributionFigureCahier, {
    distribution,
    territoryName: 'Rennes',
  })
  app.mount(container)
  await nextTick()
  return app
}

/** Mounts the transport-offer trajectory, whose y ticks are SVG text nodes. */
export async function mountCahierOffreTransportsFigure(container: Element) {
  const trajectory: ContentFact[] = [0, 0.5, 1].map((value, index) => ({
    label: `Période ${index + 1}`,
    fact: {
      key: `trajectory-${index}`,
      detail: `period-${index + 1}`,
      axisValue: index,
      value,
      unit: '%',
      availability: 'complete',
      provenance: null,
      comparison: null,
      comparisonBasis: 'territory-median',
      reason: null,
    },
  }))
  const metadata: TrajectoryMetadata = {
    endpoints: ['period-1', 'period-3'],
    axis: 'numeric',
    axisLabels: {
      x: 'Période observée',
      y: 'Établissements accessibles au fil du temps',
    },
    ticks: trajectory.map((item, index) => ({
      detail: item.fact.detail!,
      label: `Période ${index + 1}`,
    })),
  }
  const app = createApp(CahierOffreTransportsFigure, {
    offer: null,
    trajectory,
    metadata,
  })
  app.mount(container)
  await nextTick()
  return app
}
