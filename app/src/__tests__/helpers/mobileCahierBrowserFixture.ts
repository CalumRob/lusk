import { createApp, nextTick } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'

import VarianteCahierLibre from '@/fiche/prototype/VarianteCahierLibre.vue'
import AccessRampFigureCahier from '@/fiche/prototype/AccessRampFigureCahier.vue'
import AedarEquipmentQuantileFigureCahier from '@/fiche/prototype/AedarEquipmentQuantileFigureCahier.vue'
import CahierOffreTransportsFigure from '@/fiche/prototype/CahierOffreTransportsFigure.vue'
import type { CahierPagination } from '@/fiche/prototype/cahierPagination'
import type { ContentFact, ThemeContent } from '@/fiche/content/themeContent'
import type { TimeRampFigureData } from '@/fiche/content/territoryFacts'
import type { TrajectoryMetadata } from '@/payload/types'
import { routes } from '@/router'

/** Return the rendered tick boxes that intersect a y-axis title lane. */
export function auditYAxisTitleTickOverlap(title: Element, labels: readonly Element[]) {
  const { x, y, right, bottom } = title.getBoundingClientRect()
  const titleRect = { x, y, right, bottom }
  const labelRects = labels.map((label) => {
    const rect = label.getBoundingClientRect()
    return { text: label.textContent?.trim() ?? '', x: rect.x, y: rect.y, right: rect.right, bottom: rect.bottom }
  })
  const overlaps = labelRects.filter((label) =>
    label.x < titleRect.right && label.right > titleRect.x &&
    label.y < titleRect.bottom && label.bottom > titleRect.y,
  )
  return { titleRect, labelRects, overlaps }
}

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
      distributionValueUnit: 'établissement',
      distributionDescription: 'Distribution synthétique par quantile.',
      distributionUnavailableDescription: 'Distribution indisponible.',
      source: null,
    },
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
